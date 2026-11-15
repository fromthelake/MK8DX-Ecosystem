// Fresh e-mail confirmation (step-up) for dangerous actions; see step-up-policy.ts for which ones.
//
// A signed-in session asks for a link. The link goes to the account's own verified address only, is
// stored only as a digest, works once and only for a few minutes, and confirms the session that asked
// for it, wherever the link is opened (a phone's mail app may open it in another browser). Confirming
// is an explicit button press on the page the link opens, never the GET itself, because mail scanners
// open links. Afterwards that one session may perform dangerous actions for a short window. Every step
// is audited without tokens or addresses; sending is rate limited per account in the database.

import { createHash, randomBytes } from "node:crypto";

import {
  MutationRateLimitExceeded,
  type MutationRateLimiter,
} from "./mysql-mutation-rate-limiter.js";

export const STEP_UP_DEFAULT_WINDOW_SECONDS = 600;
export const STEP_UP_MINIMUM_WINDOW_SECONDS = 60;
export const STEP_UP_MAXIMUM_WINDOW_SECONDS = 3_600;
/** How long a sent link can be used. */
export const STEP_UP_LINK_LIFETIME_SECONDS = 600;
/** Links per account: a short burst and a daily ceiling. */
export const STEP_UP_SENDS_PER_TEN_MINUTES = 3;
export const STEP_UP_SENDS_PER_DAY = 10;
/** Audit rows are kept this long. */
export const STEP_UP_AUDIT_RETENTION_MS = 400 * 24 * 60 * 60 * 1_000;

const linkTokenPattern = /^[A-Za-z0-9_-]{43}$/;
const authUserIdPattern = /^[A-Za-z0-9_-]{1,64}$/;

export type StepUpClientKind = "web" | "native";

export type StepUpSession = Readonly<{
  sessionId: string;
  authUserId: string;
  email: string;
  emailVerified: boolean;
}>;

export type StepUpAuditKind =
  | "step_up_requested" | "step_up_rate_limited" | "step_up_confirmed" | "step_up_link_refused"
  | "step_up_action_allowed" | "step_up_action_refused"
  // A host operator issued the link of a pending request on the server itself (step-up-operator-main.ts).
  | "step_up_operator_link";

export type StepUpAuditEvent = Readonly<{
  kind: StepUpAuditKind;
  authUserId?: string;
  sessionDigest?: Buffer;
  clientKind?: StepUpClientKind;
  routePattern?: string;
}>;

export type StepUpChallengeView = Readonly<{
  clientKind: StepUpClientKind;
  requestedAtMs: number;
  linkExpiresAtMs: number;
}>;

export interface StepUpStore {
  /** Stores a new link for the session; any earlier unused link of the same session stops working. */
  createChallenge(challenge: Readonly<{
    sessionDigest: Buffer; authUserId: string; linkDigest: Buffer; clientKind: StepUpClientKind;
    nowMs: number; linkExpiresAtMs: number;
  }>): Promise<void>;
  /** The unused, unexpired link with this digest, or null. */
  findPendingLink(linkDigest: Buffer, nowMs: number): Promise<StepUpChallengeView | null>;
  /**
   * Marks the link used and opens the window, atomically: of any number of concurrent calls with the
   * same digest at most one returns the row. Null when the link is unknown, used or expired.
   */
  confirmLink(linkDigest: Buffer, nowMs: number, grantExpiresAtMs: number):
    Promise<Readonly<{ authUserId: string; sessionDigest: Buffer; clientKind: StepUpClientKind }> | null>;
  /** The latest open window of this session for this account, or null. */
  activeGrant(sessionDigest: Buffer, authUserId: string, nowMs: number): Promise<Readonly<{ expiresAtMs: number }> | null>;
  /** Whether this session has a link that was sent and not used yet. */
  hasPendingLink(sessionDigest: Buffer, authUserId: string, nowMs: number): Promise<boolean>;
  record(event: StepUpAuditEvent, nowMs: number): Promise<void>;
  /** Bounded cleanup of rows past their use; returns the number removed. */
  purge(nowMs: number): Promise<number>;
}

export type StepUpEmail = Readonly<{
  email: string;
  url: string;
  clientKind: StepUpClientKind;
  expiresInMinutes: number;
}>;

export interface StepUpDelivery {
  sendStepUp(message: StepUpEmail): Promise<void>;
}

export class StepUpRateLimited extends Error {
  public constructor(public readonly retryAfterSeconds: number) {
    super("Too many confirmation emails were requested.");
    this.name = "StepUpRateLimited";
  }
}

export class StepUpUnavailable extends Error {
  public constructor() {
    super("This account has no verified email address to confirm with.");
    this.name = "StepUpUnavailable";
  }
}

export type StepUpStatus = Readonly<{
  active: boolean;
  expiresAtMs: number | null;
  pending: boolean;
  windowSeconds: number;
}>;

export function sessionDigest(sessionId: string): Buffer {
  return createHash("sha256").update(`mk8dx.step-up.session.v1:${sessionId}`, "utf8").digest();
}

export function stepUpLinkDigest(token: string): Buffer {
  return createHash("sha256").update(`mk8dx.step-up.link.v1:${token}`, "utf8").digest();
}

export function isStepUpLinkToken(value: unknown): value is string {
  return typeof value === "string" && linkTokenPattern.test(value);
}

export class StepUpService {
  public readonly windowSeconds: number;

  public constructor(
    private readonly store: StepUpStore,
    private readonly delivery: StepUpDelivery,
    private readonly limiter: MutationRateLimiter,
    private readonly options: Readonly<{
      linkOrigin: string;
      windowSeconds?: number;
      nowMs?: () => number;
      newLinkToken?: () => string;
    }>,
  ) {
    const window = options.windowSeconds ?? STEP_UP_DEFAULT_WINDOW_SECONDS;
    if (!Number.isSafeInteger(window) || window < STEP_UP_MINIMUM_WINDOW_SECONDS ||
        window > STEP_UP_MAXIMUM_WINDOW_SECONDS) {
      throw new Error("step-up window is invalid");
    }
    this.windowSeconds = window;
  }

  private now(): number {
    return (this.options.nowMs ?? Date.now)();
  }

  /** Sends a new confirmation link to the session's own verified address. */
  public async request(session: StepUpSession, clientKind: StepUpClientKind): Promise<Readonly<{ linkExpiresAtMs: number }>> {
    if (!session.emailVerified || !authUserIdPattern.test(session.authUserId) || session.email.length < 3) {
      throw new StepUpUnavailable();
    }
    const digest = sessionDigest(session.sessionId);
    try {
      await this.limiter.consume(session.authUserId, "step-up-email", 600, STEP_UP_SENDS_PER_TEN_MINUTES);
      await this.limiter.consume(session.authUserId, "step-up-email-day", 86_400, STEP_UP_SENDS_PER_DAY);
    } catch (error) {
      if (error instanceof MutationRateLimitExceeded) {
        await this.store.record({ kind: "step_up_rate_limited", authUserId: session.authUserId,
          sessionDigest: digest, clientKind }, this.now());
        throw new StepUpRateLimited(error.retryAfterSeconds);
      }
      throw error;
    }
    const now = this.now();
    // Expired rows go first, a bounded batch, so the table never grows with use.
    await this.store.purge(now);
    const token = this.options.newLinkToken?.() ?? randomBytes(32).toString("base64url");
    if (!linkTokenPattern.test(token)) { throw new Error("step-up link token is invalid"); }
    const linkExpiresAtMs = now + STEP_UP_LINK_LIFETIME_SECONDS * 1_000;
    await this.store.createChallenge({
      sessionDigest: digest, authUserId: session.authUserId, linkDigest: stepUpLinkDigest(token),
      clientKind, nowMs: now, linkExpiresAtMs,
    });
    const url = new URL("/", this.options.linkOrigin);
    url.searchParams.set("step-up", token);
    await this.delivery.sendStepUp({
      email: session.email, url: url.toString(), clientKind,
      expiresInMinutes: Math.round(STEP_UP_LINK_LIFETIME_SECONDS / 60),
    });
    await this.store.record({ kind: "step_up_requested", authUserId: session.authUserId,
      sessionDigest: digest, clientKind }, now);
    return { linkExpiresAtMs };
  }

  public async status(session: Pick<StepUpSession, "sessionId" | "authUserId">): Promise<StepUpStatus> {
    const digest = sessionDigest(session.sessionId);
    const now = this.now();
    const grant = await this.store.activeGrant(digest, session.authUserId, now);
    return {
      active: grant !== null,
      expiresAtMs: grant?.expiresAtMs ?? null,
      pending: grant === null && await this.store.hasPendingLink(digest, session.authUserId, now),
      windowSeconds: this.windowSeconds,
    };
  }

  /** What the link page shows before the person confirms. Never confirms. */
  public async inspectLink(token: unknown): Promise<StepUpChallengeView | null> {
    if (!isStepUpLinkToken(token)) { return null; }
    return this.store.findPendingLink(stepUpLinkDigest(token), this.now());
  }

  /** The person pressed Confirm on the link page. */
  public async confirmLink(token: unknown): Promise<Readonly<{ grantExpiresAtMs: number }> | null> {
    const now = this.now();
    if (!isStepUpLinkToken(token)) {
      await this.store.record({ kind: "step_up_link_refused" }, now);
      return null;
    }
    const grantExpiresAtMs = now + this.windowSeconds * 1_000;
    const confirmed = await this.store.confirmLink(stepUpLinkDigest(token), now, grantExpiresAtMs);
    if (confirmed === null) {
      await this.store.record({ kind: "step_up_link_refused" }, now);
      return null;
    }
    await this.store.record({ kind: "step_up_confirmed", authUserId: confirmed.authUserId,
      sessionDigest: confirmed.sessionDigest, clientKind: confirmed.clientKind }, now);
    return { grantExpiresAtMs };
  }

  /** Whether this session may perform a dangerous action now; the decision is audited. */
  public async authorize(
    session: Pick<StepUpSession, "sessionId" | "authUserId">,
    routePattern: string,
  ): Promise<boolean> {
    const digest = sessionDigest(session.sessionId);
    const now = this.now();
    const grant = await this.store.activeGrant(digest, session.authUserId, now);
    if (grant === null) {
      // Refusals are audited too, but a stream of them cannot grow the table without bound.
      try {
        await this.limiter.consume(session.authUserId, "step-up-refusal-audit", 3_600, 60);
      } catch (error) {
        if (error instanceof MutationRateLimitExceeded) { return false; }
        throw error;
      }
    }
    await this.store.record({
      kind: grant === null ? "step_up_action_refused" : "step_up_action_allowed",
      authUserId: session.authUserId, sessionDigest: digest, routePattern,
    }, now);
    return grant !== null;
  }
}
