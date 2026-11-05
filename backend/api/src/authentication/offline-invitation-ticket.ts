/** One-use offline invitation tickets. No browser route or account binding lives here. */
import { createHmac, randomBytes, randomUUID } from "node:crypto";

import type { ActorContext } from "../identity/types.js";

export const OFFLINE_INVITATION_LIFETIME_MS = 15 * 60 * 1_000;
export type OfflineInvitationRole = "account" | "administrator";
export type OfflineInvitationTarget = Readonly<{
  accountKey: string;
  userAccountId: string;
  authEmail: string;
  role: OfflineInvitationRole;
  active: boolean;
}>;
export type OfflineInvitationRecord = Readonly<{
  invitationId: string;
  tokenDigest: Uint8Array;
  accountKey: string;
  role: OfflineInvitationRole;
  issuedByAccountId: string;
  issuedAtMs: number;
  expiresAtMs: number;
}>;

export interface OfflineInvitationTicketRepository {
  target(accountKey: string): Promise<OfflineInvitationTarget | null>;
  create(record: OfflineInvitationRecord): Promise<void>;
  /** One atomic conditional consume checks expiry, revocation, account and role. */
  consume(tokenDigest: Uint8Array, nowMs: number): Promise<OfflineInvitationTarget | null>;
  revoke(invitationId: string, nowMs: number, actorAccountId: string): Promise<boolean>;
}

export class OfflineInvitationTicketError extends Error {
  public constructor(public readonly code: "forbidden" | "invalid" | "unavailable") {
    super(`offline invitation ${code}`);
    this.name = "OfflineInvitationTicketError";
  }
}

const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const accountKeyPattern = new RegExp(`^offline_account\\.${uuidPattern}$`);
const invitationIdPattern = new RegExp(`^offline_invitation\\.${uuidPattern}$`);
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export class OfflineInvitationTicketService {
  public constructor(
    private readonly repository: OfflineInvitationTicketRepository,
    private readonly hmacKey: Uint8Array,
    private readonly nowMs: () => number = Date.now,
  ) {
    if (hmacKey.byteLength !== 32) { throw new OfflineInvitationTicketError("invalid"); }
  }

  public async issue(actor: ActorContext, accountKey: string,
                     role: OfflineInvitationRole): Promise<Readonly<{
    invitationId: string; token: string; expiresAtMs: number;
  }>> {
    if (actor.role !== "administrator") { throw new OfflineInvitationTicketError("forbidden"); }
    if (!accountKeyPattern.test(accountKey) || !["account", "administrator"].includes(role)) {
      throw new OfflineInvitationTicketError("invalid");
    }
    const target = await this.repository.target(accountKey);
    if (target === null || !target.active || target.role !== role) {
      throw new OfflineInvitationTicketError("unavailable");
    }
    const issuedAtMs = this.clock();
    const token = randomBytes(32).toString("base64url");
    const invitationId = `offline_invitation.${randomUUID()}`;
    const expiresAtMs = issuedAtMs + OFFLINE_INVITATION_LIFETIME_MS;
    if (!Number.isSafeInteger(expiresAtMs)) { throw new OfflineInvitationTicketError("invalid"); }
    await this.repository.create({ invitationId, tokenDigest: this.digest(token),
      accountKey, role, issuedByAccountId: actor.userAccountId, issuedAtMs, expiresAtMs });
    return { invitationId, token, expiresAtMs };
  }

  public async redeem(token: string): Promise<OfflineInvitationTarget> {
    if (!tokenPattern.test(token)) { throw new OfflineInvitationTicketError("invalid"); }
    const target = await this.repository.consume(this.digest(token), this.clock());
    if (target === null || !target.active) { throw new OfflineInvitationTicketError("unavailable"); }
    return target;
  }

  public async revoke(actor: ActorContext, invitationId: string): Promise<void> {
    if (actor.role !== "administrator") { throw new OfflineInvitationTicketError("forbidden"); }
    if (!invitationIdPattern.test(invitationId)) { throw new OfflineInvitationTicketError("invalid"); }
    if (!await this.repository.revoke(invitationId, this.clock(), actor.userAccountId)) {
      throw new OfflineInvitationTicketError("unavailable");
    }
  }

  private clock(): number {
    const value = this.nowMs();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new OfflineInvitationTicketError("invalid");
    }
    return value;
  }

  private digest(token: string): Uint8Array {
    return createHmac("sha256", this.hmacKey).update(token, "ascii").digest();
  }
}
