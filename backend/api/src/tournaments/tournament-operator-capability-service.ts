import type { ActorContext } from "../identity/types.js";

export const TOURNAMENT_OPERATION_CAPABILITY = "tournament.operation" as const;

export type TournamentOperatorGrant = Readonly<{
  grantId: string; userAccountId: string; status: "active" | "revoked";
  revision: number; grantedAtMs: number; revokedAtMs?: number;
}>;

export interface TournamentOperatorCapabilityRepository {
  has(userAccountId: string): Promise<boolean>;
  list(): Promise<readonly TournamentOperatorGrant[]>;
  grant(input: Readonly<{ grantId: string; userAccountId: string; actorUserAccountId: string; reasonCode: string; occurredAtMs: number }>): Promise<TournamentOperatorGrant>;
  revoke(input: Readonly<{ userAccountId: string; actorUserAccountId: string; reasonCode: string; occurredAtMs: number }>): Promise<TournamentOperatorGrant>;
}

export class TournamentOperatorCapabilityError extends Error {
  public constructor(public readonly code: "forbidden" | "not_found" | "conflict" | "invalid_input", message: string) {
    super(message); this.name = "TournamentOperatorCapabilityError";
  }
}

const accountId = /^user_account\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const reasonCode = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export class TournamentOperatorCapabilityService {
  public constructor(
    private readonly repository: TournamentOperatorCapabilityRepository,
    private readonly ids: Readonly<{ newGrantId(): string }>,
    private readonly clock: Readonly<{ nowMs(): number }>,
  ) {}

  public has(userAccountId: string): Promise<boolean> { return this.repository.has(userAccountId); }
  public list(actor: ActorContext): Promise<readonly TournamentOperatorGrant[]> { this.administrator(actor); return this.repository.list(); }
  public async grant(actor: ActorContext, userAccountId: string, reason: string): Promise<TournamentOperatorGrant> {
    const actorUserAccountId = this.administrator(actor); this.command(userAccountId, reason);
    return await this.repository.grant({ grantId: this.ids.newGrantId(), userAccountId, actorUserAccountId, reasonCode: reason, occurredAtMs: this.now() });
  }
  public async revoke(actor: ActorContext, userAccountId: string, reason: string): Promise<TournamentOperatorGrant> {
    const actorUserAccountId = this.administrator(actor); this.command(userAccountId, reason);
    return await this.repository.revoke({ userAccountId, actorUserAccountId, reasonCode: reason, occurredAtMs: this.now() });
  }
  private administrator(actor: ActorContext): string {
    if (actor.role !== "administrator") throw new TournamentOperatorCapabilityError("forbidden", "administrator actor required");
    return actor.userAccountId;
  }
  private command(userAccountId: string, reason: string): void {
    if (!accountId.test(userAccountId) || !reasonCode.test(reason) || reason.length > 64) throw new TournamentOperatorCapabilityError("invalid_input", "capability command is invalid");
  }
  private now(): number { const value = this.clock.nowMs(); if (!Number.isSafeInteger(value) || value < 0) throw new TournamentOperatorCapabilityError("conflict", "clock is invalid"); return value; }
}
