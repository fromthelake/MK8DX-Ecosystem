import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

import type { ActorContext } from "../identity/types.js";


const keyVersionPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const tokenPattern =
  /^v1\.([a-z0-9]+(?:[._-][a-z0-9]+)*)\.([0-9]{1,15})\.([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{43})$/;
const accountIdPattern = /^user_account\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const maxEpochMs = 253_402_300_799_999;
const csrfDomain = Buffer.from("mk8dx.web-csrf.v1\0", "ascii");

export const WEB_CSRF_HEADER_NAME = "X-MK8DX-CSRF";
export const WEB_CSRF_NONCE_BYTES = 24;
export const WEB_CSRF_DEFAULT_TTL_MS = 15 * 60 * 1_000;
export const WEB_CSRF_MAX_FUTURE_SKEW_MS = 60 * 1_000;

export type WebCsrfKeyMaterial = Readonly<{
  activeKeyVersion: string;
  keys: Readonly<Record<string, Uint8Array>>;
}>;

export interface WebCsrfClock { nowMs(): number; }
export interface WebCsrfNonceGenerator { newNonce(): Uint8Array; }

export type WebCsrfProofDocument = Readonly<{
  schemaVersion: "mk8dx.web-csrf.v1";
  headerName: typeof WEB_CSRF_HEADER_NAME;
  value: string;
}>;

export class WebCsrfConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WebCsrfConfigurationError";
  }
}

export class WebCsrfIssuanceError extends Error {
  public constructor(public readonly code: "not_authenticated" | "not_authorized") {
    super("The CSRF proof could not be issued.");
    this.name = "WebCsrfIssuanceError";
  }
}

function accountId(actor: ActorContext): string | null {
  if (actor.role === "account" || actor.role === "administrator") {
    return actor.userAccountId;
  }
  return null;
}

function lengthPrefixed(value: string): Buffer {
  const encoded = Buffer.from(value, "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(encoded.byteLength);
  return Buffer.concat([length, encoded]);
}

function message(
  userAccountId: string,
  keyVersion: string,
  issuedAtMs: string,
  nonce: string,
): Buffer {
  return Buffer.concat([
    csrfDomain,
    lengthPrefixed(userAccountId),
    lengthPrefixed(keyVersion),
    lengthPrefixed(issuedAtMs),
    lengthPrefixed(nonce),
  ]);
}

export class WebCsrfService {
  private readonly keys = new Map<string, Buffer>();
  private readonly activeKeyVersion: string;

  public constructor(
    keyMaterial: WebCsrfKeyMaterial,
    private readonly clock: WebCsrfClock,
    private readonly nonceGenerator: WebCsrfNonceGenerator,
    private readonly ttlMs = WEB_CSRF_DEFAULT_TTL_MS,
  ) {
    if (!keyVersionPattern.test(keyMaterial.activeKeyVersion) ||
      !Number.isSafeInteger(ttlMs) || ttlMs < 60_000 || ttlMs > 86_400_000) {
      throw new WebCsrfConfigurationError("CSRF configuration is invalid");
    }
    for (const [version, key] of Object.entries(keyMaterial.keys)) {
      if (!keyVersionPattern.test(version) || key.byteLength !== 32) {
        throw new WebCsrfConfigurationError("CSRF key material is invalid");
      }
      this.keys.set(version, Buffer.from(key));
    }
    if (!this.keys.has(keyMaterial.activeKeyVersion)) {
      throw new WebCsrfConfigurationError("active CSRF key is unavailable");
    }
    this.activeKeyVersion = keyMaterial.activeKeyVersion;
  }

  public issue(actor: ActorContext): WebCsrfProofDocument {
    const userAccountId = accountId(actor);
    if (userAccountId === null) {
      throw new WebCsrfIssuanceError(
        actor.role === "anonymous" ? "not_authenticated" : "not_authorized",
      );
    }
    const nowMs = this.clock.nowMs();
    const nonceBytes = this.nonceGenerator.newNonce();
    if (!accountIdPattern.test(userAccountId) || userAccountId.length > 141 ||
      !Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > maxEpochMs ||
      nonceBytes.byteLength !== WEB_CSRF_NONCE_BYTES) {
      throw new WebCsrfConfigurationError("CSRF runtime dependency is invalid");
    }
    const keyVersion = this.activeKeyVersion;
    const nonce = Buffer.from(nonceBytes).toString("base64url");
    const issuedAtMs = nowMs.toString(10);
    const signature = createHmac("sha256", this.keys.get(keyVersion)!)
      .update(message(userAccountId, keyVersion, issuedAtMs, nonce))
      .digest("base64url");
    return {
      schemaVersion: "mk8dx.web-csrf.v1",
      headerName: WEB_CSRF_HEADER_NAME,
      value: `v1.${keyVersion}.${issuedAtMs}.${nonce}.${signature}`,
    };
  }

  public verify(actor: ActorContext, token: string): boolean {
    const userAccountId = accountId(actor);
    if (userAccountId === null || !accountIdPattern.test(userAccountId) ||
      userAccountId.length > 141) {
      return false;
    }
    const match = token.match(tokenPattern);
    if (match === null) { return false; }
    const [, keyVersion, issuedText, nonce, suppliedSignature] = match;
    if (keyVersion === undefined || issuedText === undefined || nonce === undefined ||
      suppliedSignature === undefined) {
      return false;
    }
    const key = this.keys.get(keyVersion);
    const issuedAtMs = Number(issuedText);
    const nowMs = this.clock.nowMs();
    if (key === undefined || !Number.isSafeInteger(issuedAtMs) ||
      !Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > maxEpochMs ||
      issuedAtMs > nowMs + WEB_CSRF_MAX_FUTURE_SKEW_MS ||
      nowMs - issuedAtMs > this.ttlMs) {
      return false;
    }
    const expected = createHmac("sha256", key)
      .update(message(userAccountId, keyVersion, issuedText, nonce))
      .digest();
    const supplied = Buffer.from(suppliedSignature, "base64url");
    return supplied.byteLength === expected.byteLength &&
      timingSafeEqual(supplied, expected);
  }

}
