import type { ActorContext, ClaimStatus, DisputeStatus } from
  "../identity/types.js";

export type ClaimablePlayerSummary = Readonly<{
  playerId: string;
  username: string;
  displayName: string;
  /**
   * Public active aliases, so a caller can resolve a name that is not the
   * display name - the Tournament Manager's in-game handles, for instance
   * "Sounder" for Sander. Additive on `mk8dx.player-directory.v1`; ADR-0006
   * still forbids a name match from approving a claim or merging identities.
   */
  aliases: readonly string[];
}>;

export type AccountPlayerClaimSummary = Readonly<{
  playerClaimId: string;
  playerId: string;
  playerUsername: string;
  playerDisplayName: string;
  claimStatus: ClaimStatus;
  disputeStatus: DisputeStatus;
  updatedAtMs: number;
}>;

/**
 * A Player with the account that holds its verified claim. Administrator-only:
 * it is the mapping needed to grant a capability to a person by name instead
 * of by opaque identifier.
 */
export type LinkedPlayerAccountSummary = Readonly<{
  playerId: string;
  username: string;
  displayName: string;
  userAccountId: string;
}>;

export interface PlayerClaimProductRepository {
  searchActivePlayers(query: string): Promise<readonly ClaimablePlayerSummary[]>;
  listActivePlayers(): Promise<readonly ClaimablePlayerSummary[]>;
  listLinkedPlayerAccounts(): Promise<readonly LinkedPlayerAccountSummary[]>;
  listClaimsForAccount(
    userAccountId: string,
  ): Promise<readonly AccountPlayerClaimSummary[]>;
  listClaimsForAdministrator(): Promise<readonly AccountPlayerClaimSummary[]>;
}

export class PlayerClaimProductError extends Error {
  public constructor(
    public readonly code:
      | "not_authenticated"
      | "not_authorized"
      | "invalid_query"
      | "unavailable",
  ) {
    super("The Player claim product operation failed.");
    this.name = "PlayerClaimProductError";
  }
}

function accountId(actor: ActorContext): string {
  if (actor.role === "anonymous") {
    throw new PlayerClaimProductError("not_authenticated");
  }
  if (actor.role === "migration_operator") {
    throw new PlayerClaimProductError("not_authorized");
  }
  return actor.userAccountId;
}

export class PlayerClaimProductService {
  public constructor(private readonly repository: PlayerClaimProductRepository) {}

  public async search(
    actor: ActorContext,
    rawQuery: string,
  ): Promise<readonly ClaimablePlayerSummary[]> {
    accountId(actor);
    return this.searchPublic(rawQuery);
  }

  public async list(actor: ActorContext): Promise<readonly ClaimablePlayerSummary[]> {
    accountId(actor);
    try {
      return await this.repository.listActivePlayers();
    } catch {
      throw new PlayerClaimProductError("unavailable");
    }
  }

  public async searchPublic(
    rawQuery: string,
  ): Promise<readonly ClaimablePlayerSummary[]> {
    const query = rawQuery.trim();
    if (query.length < 2 || query.length > 64 || /[\u0000-\u001f\u007f]/.test(query)) {
      throw new PlayerClaimProductError("invalid_query");
    }
    try {
      return await this.repository.searchActivePlayers(query);
    } catch {
      throw new PlayerClaimProductError("unavailable");
    }
  }

  public async listMine(
    actor: ActorContext,
  ): Promise<readonly AccountPlayerClaimSummary[]> {
    const userAccountId = accountId(actor);
    try {
      return await this.repository.listClaimsForAccount(userAccountId);
    } catch {
      throw new PlayerClaimProductError("unavailable");
    }
  }

  public async listLinkedPlayerAccounts(
    actor: ActorContext,
  ): Promise<readonly LinkedPlayerAccountSummary[]> {
    if (actor.role !== "administrator") {
      throw new PlayerClaimProductError(
        actor.role === "anonymous" ? "not_authenticated" : "not_authorized",
      );
    }
    try {
      return await this.repository.listLinkedPlayerAccounts();
    } catch {
      throw new PlayerClaimProductError("unavailable");
    }
  }

  public async listReviewQueue(
    actor: ActorContext,
  ): Promise<readonly AccountPlayerClaimSummary[]> {
    if (actor.role !== "administrator") {
      throw new PlayerClaimProductError(
        actor.role === "anonymous" ? "not_authenticated" : "not_authorized",
      );
    }
    try {
      return await this.repository.listClaimsForAdministrator();
    } catch {
      throw new PlayerClaimProductError("unavailable");
    }
  }
}
