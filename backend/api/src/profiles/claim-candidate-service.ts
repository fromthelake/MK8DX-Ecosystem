import type { ActorContext } from "../identity/types.js";
import {
  matchClaimPlayers,
  rankClaimCandidates,
  type ClaimCandidate,
  type ClaimCandidateAnswers,
  type ClaimCandidateContext,
  type NamedClaimPlayer,
} from "./claim-candidates.js";

export interface ClaimCandidateRepository {
  /** Every active human Player with its username and installation-wide public aliases. */
  listNamedPlayers(): Promise<readonly NamedClaimPlayer[]>;
  /** Public context for these Players (internal ids); a private Player gets an empty context. */
  loadContexts(playerInternalIds: readonly number[]): Promise<ReadonlyMap<number, ClaimCandidateContext>>;
}

export class ClaimCandidateError extends Error {
  public constructor(public readonly code: "not_authenticated" | "not_authorized" | "invalid_query" | "unavailable") {
    super("The claim candidates could not be read.");
    this.name = "ClaimCandidateError";
  }
}

export type ClaimCandidateQuery = ClaimCandidateAnswers & Readonly<{ query: string }>;

/** ADR-0219: the Players a signed-in person may be, with public context, sorted by their answers. */
export class ClaimCandidateService {
  public constructor(private readonly repository: ClaimCandidateRepository) {}

  public async search(actor: ActorContext, input: ClaimCandidateQuery): Promise<readonly ClaimCandidate[]> {
    if (actor.role === "anonymous") { throw new ClaimCandidateError("not_authenticated"); }
    if (actor.role !== "account" && actor.role !== "administrator") {
      throw new ClaimCandidateError("not_authorized");
    }
    const query = input.query.trim();
    if (query.length < 2 || query.length > 64 || /[\u0000-\u001f\u007f]/u.test(query)) {
      throw new ClaimCandidateError("invalid_query");
    }
    try {
      const matched = matchClaimPlayers(await this.repository.listNamedPlayers(), query);
      if (matched.length === 0) { return []; }
      const contexts = await this.repository.loadContexts(matched.map((entry) => entry.player.internalId));
      return rankClaimCandidates(matched, contexts, { timeTrials: input.timeTrials, tournaments: input.tournaments });
    } catch (error) {
      if (error instanceof ClaimCandidateError) { throw error; }
      throw new ClaimCandidateError("unavailable");
    }
  }
}
