import type { FastifyRequest } from "fastify";

export type ActorRole =
  | "anonymous"
  | "account"
  | "administrator"
  | "migration_operator";

export type ActorContext =
  | Readonly<{ role: "anonymous" }>
  | Readonly<{ role: "migration_operator" }>
  | Readonly<{
      role: "account" | "administrator";
      userAccountId: string;
    }>;

export type PublicPlayerProfile = Readonly<{
  playerId: string;
  username: Readonly<{ value: string }>;
  displayName: string;
  countryId?: string;
  avatarId?: string;
  favoriteBodyId?: string;
  favoriteTireId?: string;
  favoriteGliderId?: string;
  timeTrialModePreference?: "all" | "150" | "200";
}>;

export type AccountStatus = "active" | "suspended" | "closed";

export type ClaimStatus =
  | "requested"
  | "under_review"
  | "verified"
  | "rejected"
  | "released"
  | "revoked";

export type DisputeStatus = "none" | "open" | "resolved";

export type PrivateUserAccountSummary = Readonly<{
  userAccountId: string;
  accountStatus: AccountStatus;
}>;

export type PrivatePlayerClaimSummary = Readonly<{
  playerClaimId: string;
  playerId: string;
  userAccountId: string;
  claimStatus: ClaimStatus;
  disputeStatus: DisputeStatus;
}>;

export interface IdentityReadRepository {
  findPublicPlayerById(playerId: string): Promise<PublicPlayerProfile | null>;
  findUserAccountSummaryById(
    userAccountId: string,
  ): Promise<PrivateUserAccountSummary | null>;
  findPlayerClaimSummaryById(
    playerClaimId: string,
  ): Promise<PrivatePlayerClaimSummary | null>;
}

export type ActorResolver = (request: FastifyRequest) => Promise<ActorContext>;
