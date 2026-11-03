import type { ActorContext, ClaimStatus, DisputeStatus } from
  "../identity/types.js";

/**
 * What the reviewer and the person asking read about a claim (ADR-0216): one card that says who
 * asks, what is asked for, what changes and what stands in the way, and the notes between them.
 */

export type ClaimNoteView = Readonly<{
  role: "requester" | "reviewer";
  kind: "request" | "question" | "reply" | "decision";
  body: string;
  /** The display name of the reviewer's own Player, when they have one; null for the requester. */
  authorName: string | null;
  createdAtMs: number;
}>;

export type ClaimPlayerRef = Readonly<{
  playerId: string;
  username: string;
  displayName: string;
}>;

/** The last decision on a claim, as the person asking should read it. */
export type ClaimDecisionView = Readonly<{
  decision: "verified" | "rejected" | "released" | "revoked";
  byRole: "requester" | "administrator" | "director";
  byName: string | null;
  reasonCode: string | null;
  decidedAtMs: number;
}>;

export type AccountClaimWalkItem = Readonly<{
  playerClaimId: string;
  player: ClaimPlayerRef;
  claimStatus: ClaimStatus;
  disputeStatus: DisputeStatus;
  requestedAtMs: number;
  updatedAtMs: number;
  /** The Directors who may decide besides the administrators; empty means the administrators decide. */
  reviewerDirectorNames: readonly string[];
  lastDecision: ClaimDecisionView | null;
  notes: readonly ClaimNoteView[];
}>;

export type ClaimReviewCard = Readonly<{
  playerClaimId: string;
  claimStatus: ClaimStatus;
  disputeStatus: DisputeStatus;
  requestedAtMs: number;
  updatedAtMs: number;
  /** The role the viewer reviews this claim in. */
  reviewerRole: "administrator" | "director";
  requester: Readonly<{
    userAccountId: string;
    accountCreatedAtMs: number;
    verifiedPlayers: readonly ClaimPlayerRef[];
  }>;
  player: ClaimPlayerRef & Readonly<{
    tournamentNights: number;
    lastNightName: string | null;
    lastNightDate: string | null;
    directorNames: readonly string[];
    conservativeRating: number | null;
    publishedTimeTrials: number;
    otherOpenClaims: number;
  }>;
  conflicts: Readonly<{
    playerAlreadyLinked: boolean;
    /** A Tournament where the claimed Player met one the account already owns (ADR-0178). */
    sharedTournament: string | null;
  }>;
  notes: readonly ClaimNoteView[];
}>;

/** A linked Player the viewer may unlink (revoke). */
export type LinkedClaimRow = Readonly<{
  playerClaimId: string;
  player: ClaimPlayerRef;
  /** Other Players the same account owns, so the reviewer sees whose account this is. */
  accountPlayers: readonly ClaimPlayerRef[];
  linkedAtMs: number;
  reviewerRole: "administrator" | "director";
}>;

export type ClaimReviewQueue = Readonly<{
  open: readonly ClaimReviewCard[];
  linked: readonly LinkedClaimRow[];
}>;

export type ClaimReviewer = Readonly<{
  userAccountId: string;
  administrator: boolean;
}>;

export interface ClaimReviewReadRepository {
  listClaimWalkForAccount(userAccountId: string): Promise<readonly AccountClaimWalkItem[]>;
  listReviewQueue(reviewer: ClaimReviewer): Promise<ClaimReviewQueue>;
}

export class ClaimReviewReadError extends Error {
  public constructor(public readonly code: "not_authenticated" | "not_authorized" | "unavailable") {
    super("The claim review read failed.");
    this.name = "ClaimReviewReadError";
  }
}

function signedInAccount(actor: ActorContext): ClaimReviewer {
  if (actor.role === "anonymous") {
    throw new ClaimReviewReadError("not_authenticated");
  }
  if (actor.role !== "account" && actor.role !== "administrator") {
    throw new ClaimReviewReadError("not_authorized");
  }
  return { userAccountId: actor.userAccountId, administrator: actor.role === "administrator" };
}

export class ClaimReviewReadService {
  public constructor(private readonly repository: ClaimReviewReadRepository) {}

  public async listMyClaimWalk(actor: ActorContext): Promise<readonly AccountClaimWalkItem[]> {
    const account = signedInAccount(actor);
    try {
      return await this.repository.listClaimWalkForAccount(account.userAccountId);
    } catch {
      throw new ClaimReviewReadError("unavailable");
    }
  }

  /**
   * Administrators see every open claim; a Director sees the claims on Players from their own
   * Tournaments, never their own claim. An account that reviews nothing gets an empty queue.
   */
  public async listReviewQueue(actor: ActorContext): Promise<ClaimReviewQueue> {
    const reviewer = signedInAccount(actor);
    try {
      return await this.repository.listReviewQueue(reviewer);
    } catch {
      throw new ClaimReviewReadError("unavailable");
    }
  }
}
