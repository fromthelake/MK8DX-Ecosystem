/**
 * ADR-0224 phase 2: one-tap account switching on a shared device, with an optional per-account
 * PIN that only the server checks. The design review is docs/product/ACCOUNT_SWITCHING_DESIGN.md.
 *
 * A browser holds one HttpOnly, SameSite=Strict "account device" cookie with a random value; the
 * server keeps only its HMAC and, per device, the accounts that signed in there. The cookie is not
 * a session and cannot be replayed as one: only the server-only switch endpoint accepts it, and
 * that endpoint applies the administrator and PIN rules. The page only ever sees labels and opaque
 * entry ids.
 */
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

import {
  MutationRateLimitExceeded,
  type MutationRateLimiter,
} from "../security/mysql-mutation-rate-limiter.js";

/** Six people on a family tablet is generous; the least recently used one is dropped beyond it. */
export const REMEMBERED_ACCOUNTS_PER_DEVICE = 6;
/** A remembered account not used for 90 days is no longer offered. */
export const REMEMBERED_ACCOUNT_IDLE_MS = 90 * 24 * 60 * 60 * 1_000;
export const ACCOUNT_DEVICE_COOKIE = "account_device";
export const ACCOUNT_DEVICE_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
/** Better Auth's freshAge: a real sign-in this recent may change or remove a forgotten PIN. */
export const ACCOUNT_SWITCH_FRESH_SIGN_IN_MS = 15 * 60 * 1_000;
/** PIN attempts, switching and settings together: per account and per device. */
export const ACCOUNT_SWITCH_PIN_ACCOUNT_LIMIT = Object.freeze({ windowSeconds: 900, maximum: 5 });
export const ACCOUNT_SWITCH_PIN_DEVICE_LIMIT = Object.freeze({ windowSeconds: 3_600, maximum: 20 });

const deviceValuePattern = /^[A-Za-z0-9_-]{43}$/;
export const entryIdPattern = /^[A-Za-z0-9_-]{22}$/;
export const pinPattern = /^[0-9]{4}$/;

export type AccountSwitchTarget = Readonly<{
  /** The UserAccount public id the Better Auth user is bound to. */
  userAccountId: string;
  administrator: boolean;
  /** The verified Player's display name, else the offline host label, else null. */
  label: string | null;
}>;

/** Runtime answer for a Better Auth user; null when it is not (or no longer) an active account. */
export interface AccountSwitchDirectory {
  resolve(authUserId: string): Promise<AccountSwitchTarget | null>;
}

export type RememberedAccountRow = Readonly<{
  entryId: string;
  authUserId: string;
  lastUsedAtMs: number;
}>;

export interface AccountSwitchStore {
  /** Insert or refresh (device, user); keeps the existing entry id; drops beyond `maximum`. */
  remember(deviceDigest: Buffer, authUserId: string, newEntryId: string, nowMs: number,
    maximum: number): Promise<void>;
  /** Rows used at or after `notBeforeMs`, most recently used first; older rows may be pruned. */
  list(deviceDigest: Buffer, notBeforeMs: number): Promise<readonly RememberedAccountRow[]>;
  touch(deviceDigest: Buffer, entryId: string, nowMs: number): Promise<void>;
  forget(deviceDigest: Buffer, authUserId: string): Promise<void>;
  forgetEverywhere(authUserId: string): Promise<void>;
  forgetElsewhere(authUserId: string, keepDeviceDigest: Buffer | null): Promise<void>;
  recordSwitchSession(sessionId: string, nowMs: number): Promise<void>;
  isSwitchSession(sessionId: string): Promise<boolean>;
}

export type StoredSwitchPin = Readonly<{ digest: Buffer; salt: Buffer; pepperVersion: number }>;

export interface AccountSwitchPinStore {
  get(userAccountId: string): Promise<StoredSwitchPin | null>;
  set(userAccountId: string, pin: StoredSwitchPin, nowMs: number): Promise<void>;
  clear(userAccountId: string): Promise<void>;
}

export type AccountSwitchKeys = Readonly<{
  deviceKey: Buffer;
  /** Newest first; a PIN records the version it was peppered with. */
  pinPeppers: readonly Readonly<{ version: number; key: Buffer }>[];
}>;

/** Derived from the auth secrets so nothing new has to be configured or stored. */
export function deriveAccountSwitchKeys(
  secrets: readonly Readonly<{ version: number; value: string }>[],
): AccountSwitchKeys {
  const derive = (value: string, label: string): Buffer =>
    createHmac("sha256", Buffer.from(value, "base64")).update(label, "ascii").digest();
  const newest = secrets[0];
  if (newest === undefined) { throw new Error("account switching needs an auth secret"); }
  return {
    deviceKey: derive(newest.value, "mk8dx.account-switch-device.v1"),
    pinPeppers: secrets.map(({ version, value }) => ({
      version, key: derive(value, "mk8dx.account-switch-pin.v1"),
    })),
  };
}

export function deviceDigest(keys: AccountSwitchKeys, cookieValue: string | null | undefined): Buffer | null {
  if (typeof cookieValue !== "string" || !deviceValuePattern.test(cookieValue)) { return null; }
  return createHmac("sha256", keys.deviceKey).update(cookieValue, "ascii").digest();
}

export function newDeviceValue(): string { return randomBytes(32).toString("base64url"); }
export function newEntryId(): string { return randomBytes(16).toString("base64url"); }
/** A limiter subject for a device that never contains the cookie value itself. */
export function deviceLimiterSubject(digest: Buffer): string {
  return `device.${digest.subarray(0, 16).toString("hex")}`;
}

const SCRYPT = Object.freeze({ N: 16_384, r: 8, p: 1, maxmem: 64 * 1_024 * 1_024 });

function scrypt(password: Buffer, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, 32, SCRYPT, (error, key) => {
      if (error !== null) { reject(error); } else { resolve(key); }
    });
  });
}

export class AccountSwitchPinHasher {
  public constructor(private readonly keys: AccountSwitchKeys) {}

  public async hash(pin: string): Promise<StoredSwitchPin> {
    if (!pinPattern.test(pin)) { throw new Error("invalid PIN"); }
    const pepper = this.keys.pinPeppers[0];
    if (pepper === undefined) { throw new Error("PIN pepper unavailable"); }
    const salt = randomBytes(16);
    return { digest: await this.derive(pin, salt, pepper.key), salt, pepperVersion: pepper.version };
  }

  public async verify(pin: string, stored: StoredSwitchPin): Promise<boolean> {
    if (!pinPattern.test(pin)) { return false; }
    const pepper = this.keys.pinPeppers.find(({ version }) => version === stored.pepperVersion);
    // A PIN peppered with a retired secret can no longer be checked; a fresh sign-in replaces it.
    if (pepper === undefined || stored.digest.length !== 32) { return false; }
    const candidate = await this.derive(pin, stored.salt, pepper.key);
    return timingSafeEqual(candidate, stored.digest);
  }

  private async derive(pin: string, salt: Buffer, pepper: Buffer): Promise<Buffer> {
    return scrypt(createHmac("sha256", pepper).update(pin, "ascii").digest(), salt);
  }
}

export type PinCheck =
  | Readonly<{ outcome: "ok" }>
  | Readonly<{ outcome: "not_set" }>
  | Readonly<{ outcome: "invalid" }>
  | Readonly<{ outcome: "rate_limited"; retryAfterSeconds: number }>;

/** The single place a PIN attempt is counted and checked, for switching and for settings alike. */
export class AccountSwitchPins {
  public constructor(
    private readonly store: AccountSwitchPinStore,
    private readonly hasher: AccountSwitchPinHasher,
    private readonly limiter: MutationRateLimiter,
  ) {}

  public async enabled(userAccountId: string): Promise<boolean> {
    return (await this.store.get(userAccountId)) !== null;
  }

  public async check(userAccountId: string, device: Buffer | null, pin: string): Promise<PinCheck> {
    const stored = await this.store.get(userAccountId);
    if (stored === null) { return { outcome: "not_set" }; }
    try {
      // Counted before the comparison: every attempt costs, right or wrong.
      await this.limiter.consume(userAccountId, "account-switch-pin",
        ACCOUNT_SWITCH_PIN_ACCOUNT_LIMIT.windowSeconds, ACCOUNT_SWITCH_PIN_ACCOUNT_LIMIT.maximum);
      if (device !== null) {
        await this.limiter.consume(deviceLimiterSubject(device), "account-switch-pin-device",
          ACCOUNT_SWITCH_PIN_DEVICE_LIMIT.windowSeconds, ACCOUNT_SWITCH_PIN_DEVICE_LIMIT.maximum);
      }
    } catch (error) {
      if (error instanceof MutationRateLimitExceeded) {
        return { outcome: "rate_limited", retryAfterSeconds: error.retryAfterSeconds };
      }
      throw error;
    }
    return await this.hasher.verify(pin, stored) ? { outcome: "ok" } : { outcome: "invalid" };
  }

  public async set(userAccountId: string, pin: string, nowMs: number): Promise<void> {
    await this.store.set(userAccountId, await this.hasher.hash(pin), nowMs);
  }

  public async clear(userAccountId: string): Promise<void> {
    await this.store.clear(userAccountId);
  }
}
