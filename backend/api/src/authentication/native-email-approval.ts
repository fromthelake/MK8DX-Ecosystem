// Approve a native client's pending device code from the account's own inbox.
//
// Owner 2026-09-27: someone adding an account in LiveTrial (or signing in
// again) should be able to click a link in their email or type a code into the
// desktop, instead of first signing in on the website. This builds on the
// device authorization that already exists: the client still asks Better Auth
// for a device code and still redeems it at the normal token endpoint. The only
// new step is who may mark the pending code "approved": whoever can read the
// inbox of an account with an eligible verified Player claim.
//
// One email carries both a one-time link and a six-digit code. The link opens a
// page with an explicit Approve button (a GET never approves, because mail
// scanners open links); the code is typed into the client. Using either one
// consumes both. The code is attempt-limited, both are stored only as hashes,
// and every answer to the request is the same whether or not an account exists.

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import {
  MK8DX_ANDROID_CLIENT_ID,
  MK8DX_DESKTOP_CLIENT_ID,
  MK8DX_TOURNAMENT_DESKTOP_CLIENT_ID,
  type EmbeddedPasswordlessAuth,
} from "./embedded-passwordless-auth.js";

export const NATIVE_EMAIL_CODE_ATTEMPTS = 5;
export const NATIVE_EMAIL_MAX_SENDS_PER_DEVICE_CODE = 3;
export const NATIVE_EMAIL_LIFETIME_SECONDS = 600;
const CHALLENGE_PREFIX = "mk8dx-native-email:";
const LINK_PREFIX = "mk8dx-native-email-link:";

const CLIENT_NAMES: Readonly<Record<string, string>> = {
  [MK8DX_DESKTOP_CLIENT_ID]: "LiveTrial for Windows",
  [MK8DX_ANDROID_CLIENT_ID]: "MK8DX Time Trials for Android",
  [MK8DX_TOURNAMENT_DESKTOP_CLIENT_ID]: "MK8DX Tournament tools",
};

const emailPattern = /^[^\s@]{1,64}@[^\s@]{1,255}$/;
const userCodePattern = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;
const codePattern = /^[0-9]{6}$/;
const linkTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export type NativeEmailSignIn = Readonly<{
  email: string;
  code: string;
  url: string;
  userCode: string;
  clientName: string;
  expiresInMinutes: number;
}>;

export interface NativeEmailApprovalDelivery {
  sendNativeSignIn(message: NativeEmailSignIn): Promise<void>;
}

/** Whether a Better Auth user may sign a native client in (an eligible verified Player). */
export interface NativeEmailEligibility {
  isEligible(authUserId: string): Promise<boolean>;
}

export type NativeEmailAuditEvent = Readonly<{
  kind: "native_email_approval_sent" | "native_email_approval_approved" | "native_email_approval_locked";
  subjectId: string;
  clientId: string;
  via?: "code" | "link";
}>;

export interface NativeEmailAuditSink {
  record(event: NativeEmailAuditEvent): Promise<void>;
}

export type NativeEmailCodeOutcome =
  | Readonly<{ status: "approved" }>
  | Readonly<{ status: "invalid"; attemptsLeft: number }>
  | Readonly<{ status: "expired" }>
  | Readonly<{ status: "locked" }>;

export type NativeEmailLinkView = Readonly<{
  userCode: string;
  clientName: string;
  expiresAtMs: number;
}>;

type Challenge = {
  deviceCodeId: string;
  userId: string;
  clientId: string;
  userCode: string;
  codeHash: string;
  linkHash: string;
  attempts: number;
  sends: number;
};

type DeviceCodeRecord = Readonly<{
  id: string;
  userCode: string;
  userId?: string | null;
  status: string;
  clientId?: string | null;
  expiresAt: Date | string;
}>;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export function normalizeUserCode(value: unknown): string | null {
  if (typeof value !== "string") { return null; }
  const code = value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return userCodePattern.test(code) ? code : null;
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") { return null; }
  const email = value.trim().toLowerCase();
  return email.length <= 320 && emailPattern.test(email) ? email : null;
}

/** A small in-process sliding window; the device plugin's own limits still apply. */
export class NativeEmailRateLimiter {
  private readonly hits = new Map<string, number[]>();

  public constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  public allow(key: string): boolean {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) {
      for (const [entry, times] of this.hits) {
        if (times.every((at) => now - at >= this.windowMs)) { this.hits.delete(entry); }
      }
    }
    return true;
  }
}

export class NativeEmailApprovalService {
  private readonly perEmail: NativeEmailRateLimiter;
  private readonly perAddress: NativeEmailRateLimiter;
  // Guesses per device code, counted in memory as well: the stored attempt
  // counter is not updated atomically, so parallel guesses must not add up.
  private readonly guesses: NativeEmailRateLimiter;

  public constructor(
    private readonly auth: EmbeddedPasswordlessAuth,
    private readonly delivery: NativeEmailApprovalDelivery,
    private readonly eligibility: NativeEmailEligibility,
    private readonly audit: NativeEmailAuditSink,
    private readonly options: Readonly<{
      linkOrigin: string;
      now?: () => number;
      newLinkToken?: () => string;
      newCode?: () => string;
    }>,
  ) {
    const now = options.now ?? Date.now;
    this.perEmail = new NativeEmailRateLimiter(5, 60 * 60 * 1000, now);
    this.perAddress = new NativeEmailRateLimiter(20, 60 * 60 * 1000, now);
    this.guesses = new NativeEmailRateLimiter(NATIVE_EMAIL_CODE_ATTEMPTS, NATIVE_EMAIL_LIFETIME_SECONDS * 1000, now);
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private async context() {
    return this.auth.$context;
  }

  private async deviceCodeByUserCode(userCode: string): Promise<DeviceCodeRecord | null> {
    const context = await this.context();
    const record = await context.adapter.findOne<DeviceCodeRecord>({
      model: "deviceCode",
      where: [{ field: "userCode", value: userCode }],
    });
    return record !== null && record.userCode === userCode ? record : null;
  }

  private async deviceCodeById(id: string): Promise<DeviceCodeRecord | null> {
    const context = await this.context();
    return context.adapter.findOne<DeviceCodeRecord>({
      model: "deviceCode",
      where: [{ field: "id", value: id }],
    });
  }

  private pendingFor(record: DeviceCodeRecord | null, userId?: string): record is DeviceCodeRecord {
    if (record === null || record.status !== "pending") { return false; }
    if (new Date(record.expiresAt).getTime() <= this.now()) { return false; }
    if (typeof record.clientId !== "string" || CLIENT_NAMES[record.clientId] === undefined) { return false; }
    // A code someone already claimed on the website stays theirs.
    return record.userId == null || record.userId === "" || userId === undefined || record.userId === userId;
  }

  private async readChallenge(deviceCodeId: string): Promise<{ id: string; challenge: Challenge; expiresAt: Date } | null> {
    const context = await this.context();
    const row = await context.internalAdapter.findVerificationValue(`${CHALLENGE_PREFIX}${deviceCodeId}`);
    if (row === null || row === undefined) { return null; }
    try {
      return { id: row.id, challenge: JSON.parse(row.value) as Challenge, expiresAt: new Date(row.expiresAt) };
    } catch {
      return null;
    }
  }

  private async forget(challenge: Challenge): Promise<void> {
    const context = await this.context();
    await context.internalAdapter.deleteVerificationByIdentifier(`${CHALLENGE_PREFIX}${challenge.deviceCodeId}`);
    await context.internalAdapter.deleteVerificationByIdentifier(`${LINK_PREFIX}${challenge.linkHash}`);
  }

  /**
   * Send the link and code when the address belongs to an eligible account.
   * Resolves the same way in every case, so the answer never tells whether an
   * address has an account.
   */
  public async request(userCodeInput: unknown, emailInput: unknown, requester: string): Promise<boolean> {
    const userCode = normalizeUserCode(userCodeInput);
    const email = normalizeEmail(emailInput);
    if (userCode === null || email === null) { return false; }
    if (!this.perAddress.allow(requester) || !this.perEmail.allow(email)) { return true; }
    const context = await this.context();
    const found = await context.internalAdapter.findUserByEmail(email);
    const user = found?.user;
    if (user === undefined || user === null || user.emailVerified !== true) { return true; }
    const deviceCode = await this.deviceCodeByUserCode(userCode);
    if (!this.pendingFor(deviceCode, user.id)) { return true; }
    if (!(await this.eligibility.isEligible(user.id))) { return true; }

    const previous = await this.readChallenge(deviceCode.id);
    const sends = (previous?.challenge.sends ?? 0) + 1;
    if (sends > NATIVE_EMAIL_MAX_SENDS_PER_DEVICE_CODE) { return true; }
    if (previous !== null) { await this.forget(previous.challenge); }

    const code = this.options.newCode?.() ?? String(randomInt(0, 1_000_000)).padStart(6, "0");
    const linkToken = this.options.newLinkToken?.() ?? randomBytes(32).toString("base64url");
    const linkHash = sha256(linkToken);
    const expiresAtMs = Math.min(
      new Date(deviceCode.expiresAt).getTime(),
      this.now() + NATIVE_EMAIL_LIFETIME_SECONDS * 1000,
    );
    const challenge: Challenge = {
      deviceCodeId: deviceCode.id,
      userId: user.id,
      clientId: deviceCode.clientId as string,
      userCode,
      codeHash: sha256(`${deviceCode.id}:${code}`),
      linkHash,
      attempts: 0,
      sends,
    };
    await context.internalAdapter.createVerificationValue({
      identifier: `${CHALLENGE_PREFIX}${deviceCode.id}`,
      value: JSON.stringify(challenge),
      expiresAt: new Date(expiresAtMs),
    });
    await context.internalAdapter.createVerificationValue({
      identifier: `${LINK_PREFIX}${linkHash}`,
      value: deviceCode.id,
      expiresAt: new Date(expiresAtMs),
    });
    const url = new URL("/", this.options.linkOrigin);
    url.searchParams.set("device-email", linkToken);
    await this.delivery.sendNativeSignIn({
      email,
      code,
      url: url.toString(),
      userCode: `${userCode.slice(0, 4)}-${userCode.slice(4)}`,
      clientName: CLIENT_NAMES[challenge.clientId] ?? "MK8DX",
      expiresInMinutes: Math.max(1, Math.round((expiresAtMs - this.now()) / 60_000)),
    });
    await this.audit.record({ kind: "native_email_approval_sent", subjectId: user.id, clientId: challenge.clientId });
    return true;
  }

  private async approve(challenge: Challenge, via: "code" | "link"): Promise<boolean> {
    const deviceCode = await this.deviceCodeById(challenge.deviceCodeId);
    if (!this.pendingFor(deviceCode, challenge.userId)) {
      await this.forget(challenge);
      return false;
    }
    const context = await this.context();
    // Exactly what Better Auth's own /device/approve writes; the client then
    // redeems the code at the normal token endpoint.
    await context.adapter.update({
      model: "deviceCode",
      where: [{ field: "id", value: deviceCode.id }],
      update: { status: "approved", userId: challenge.userId },
    });
    await this.forget(challenge);
    await this.audit.record({
      kind: "native_email_approval_approved", subjectId: challenge.userId, clientId: challenge.clientId, via,
    });
    return true;
  }

  /** The client types the six-digit code from the email. */
  public async verifyCode(userCodeInput: unknown, codeInput: unknown): Promise<NativeEmailCodeOutcome> {
    const userCode = normalizeUserCode(userCodeInput);
    const code = typeof codeInput === "string" ? codeInput.replace(/\s+/g, "") : null;
    if (userCode === null || code === null || !codePattern.test(code)) {
      return { status: "invalid", attemptsLeft: 0 };
    }
    if (!this.guesses.allow(userCode)) { return { status: "locked" }; }
    const deviceCode = await this.deviceCodeByUserCode(userCode);
    if (deviceCode === null) { return { status: "expired" }; }
    const stored = await this.readChallenge(deviceCode.id);
    if (stored === null || stored.expiresAt.getTime() <= this.now()) {
      if (stored !== null) { await this.forget(stored.challenge); }
      return { status: "expired" };
    }
    const { challenge } = stored;
    if (sameHash(challenge.codeHash, sha256(`${deviceCode.id}:${code}`))) {
      return (await this.approve(challenge, "code")) ? { status: "approved" } : { status: "expired" };
    }
    challenge.attempts += 1;
    const context = await this.context();
    if (challenge.attempts >= NATIVE_EMAIL_CODE_ATTEMPTS) {
      await this.forget(challenge);
      await this.audit.record({ kind: "native_email_approval_locked", subjectId: challenge.userId, clientId: challenge.clientId });
      return { status: "locked" };
    }
    await context.internalAdapter.deleteVerificationByIdentifier(`${CHALLENGE_PREFIX}${challenge.deviceCodeId}`);
    await context.internalAdapter.createVerificationValue({
      identifier: `${CHALLENGE_PREFIX}${challenge.deviceCodeId}`,
      value: JSON.stringify(challenge),
      expiresAt: stored.expiresAt,
    });
    return { status: "invalid", attemptsLeft: NATIVE_EMAIL_CODE_ATTEMPTS - challenge.attempts };
  }

  private async challengeForLink(token: unknown): Promise<{ challenge: Challenge; expiresAt: Date } | null> {
    if (typeof token !== "string" || !linkTokenPattern.test(token)) { return null; }
    const context = await this.context();
    const pointer = await context.internalAdapter.findVerificationValue(`${LINK_PREFIX}${sha256(token)}`);
    if (pointer === null || pointer === undefined) { return null; }
    const stored = await this.readChallenge(pointer.value);
    if (stored === null || !sameHash(stored.challenge.linkHash, sha256(token))) { return null; }
    if (stored.expiresAt.getTime() <= this.now()) {
      await this.forget(stored.challenge);
      return null;
    }
    return stored;
  }

  /** What the link page shows before the person approves. Never approves. */
  public async inspectLink(token: unknown): Promise<NativeEmailLinkView | null> {
    const stored = await this.challengeForLink(token);
    if (stored === null) { return null; }
    const code = stored.challenge.userCode;
    return {
      userCode: `${code.slice(0, 4)}-${code.slice(4)}`,
      clientName: CLIENT_NAMES[stored.challenge.clientId] ?? "MK8DX",
      expiresAtMs: stored.expiresAt.getTime(),
    };
  }

  /** The person pressed Approve on the link page. */
  public async approveLink(token: unknown): Promise<boolean> {
    const stored = await this.challengeForLink(token);
    return stored !== null && this.approve(stored.challenge, "link");
  }
}
