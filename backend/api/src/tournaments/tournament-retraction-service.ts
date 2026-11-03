import type { ActorContext } from "../identity/types.js";
import { TournamentOperationError } from "./tournament-operation-service.js";

export interface TournamentRetractionState {
  tournamentId: string;
  alreadyRetracted: boolean;
  publicationId: string | null;
  publicationRevision: number | null;
  publicationStatus: string | null;
  publicationWasPublic: boolean;
  ratingWasIncluded: boolean;
  ratingEpochId: number | null;
}

export interface TournamentRetractionRepository {
  prepareRetraction(input: {
    tournamentId: string;
    actorUserAccountId: string;
    reason: string;
    nowMs: number;
  }): Promise<TournamentRetractionState | null>;
  markRatingReplayCompleted(input: {
    tournamentId: string;
    ratingEpochId: number;
    nowMs: number;
  }): Promise<void>;
  /**
   * Puts a removed Tournament back in view. Owner decision 2026-08-28: removal
   * hides a Tournament rather than destroying it, so an administrator can undo
   * it. Returns null when the Tournament does not exist.
   */
  restoreTournament(input: {
    tournamentId: string;
    actorUserAccountId: string;
    reason: string;
    publicResults: boolean;
    affectsRating: boolean;
    nowMs: number;
  }): Promise<TournamentRestoreState | null>;
  /**
   * What the last publication of this Tournament said, so a restore can put
   * exactly that back rather than inventing a new one. Null when it was never
   * published.
   */
  loadRepublishPlan(tournamentId: string): Promise<TournamentRepublishPlan | null>;
  /** True when this account is the Tournament's own director. */
  isDirectorOf(tournamentId: string, userAccountId: string): Promise<boolean>;
  /**
   * Takes a finalized Tournament back to Step 10 as one that is not finalized:
   * the stage, the pinned result set reference and the finalized time are
   * cleared together (the schema requires that), the groups, seats and scores
   * stay, and the act is written to the Tournament's lifecycle. Returns null
   * when the Tournament does not exist; `wasFinalized` false when there was
   * nothing to reopen.
   */
  prepareReopen(input: {
    tournamentId: string;
    actorUserAccountId: string;
    reason: string;
    nowMs: number;
  }): Promise<TournamentReopenState | null>;
}

/**
 * What reopening a finalized night found and did in the database: the pinned
 * result set to retract, whether the night counted for the rating, and
 * whether there was anything to reopen at all.
 */
export interface TournamentReopenState {
  tournamentId: string;
  wasFinalized: boolean;
  publicationId: string | null;
  publicationRevision: number | null;
  publicationStatus: string | null;
  publicationWasPublic: boolean;
  ratingWasIncluded: boolean;
  ratingEpochId: number | null;
}

/** The night's written report: reopening puts a published one back to draft. */
export interface RetractionReportRepository {
  unpublish(input: { tournamentId: string; nowMs: number }): Promise<void>;
}

export interface TournamentRepublishPlan {
  publicationId: string;
  expectedRevision: number;
  eventName: string;
  targets: readonly { raceResultId: string; revision: number }[];
}

export interface TournamentRestoreState {
  tournamentId: string;
  wasRetracted: boolean;
  /** What publication and rating looked like before the removal, from the audit. */
  publicationWasPublic: boolean;
  ratingWasIncluded: boolean;
  /** The rating epoch a full replay produced, when the restore asked for one. */
  ratingEpochId: number | null;
  republished: boolean;
}

export interface RetractionPublicationService {
  republish(
    actor: ActorContext,
    publicationId: string,
    input: {
      expectedRevision: number;
      eventName: string;
      targets: readonly { raceResultId: string; revision: number }[];
      reasonCode: string;
    },
  ): Promise<unknown>;
  retract(
    actor: ActorContext,
    publicationId: string,
    input: { expectedRevision: number; reasonCode: string },
  ): Promise<unknown>;
}

export interface RetractionRatingLifecycleService {
  recordDecision(input: {
    administratorAccountId: string;
    publicationPublicId: string;
    ratingIncluded: boolean;
    reasonCode: string;
  }): Promise<unknown>;
  /**
   * The full audited replay (ADR-0155). In the runtime this is the faithful
   * one: the corrected TN4+ history with the measured parameters and decay,
   * then every result set that still counts, oldest first - so a removal or
   * a reopen lands where the night was never applied.
   */
  recalculate(input: {
    administratorAccountId: string;
    reasonCode: string;
  }): Promise<{ epoch: number }>;
}

function requireAdministrator(actor: ActorContext): string {
  if (actor.role !== "administrator") {
    throw new TournamentOperationError("forbidden", "Administrator authority is required.");
  }
  return actor.userAccountId;
}

/**
 * Owner decision 2026-08-28: a Tournament's own director may remove it, not
 * only an administrator - removal hides rather than destroys, so the blast
 * radius of a director's mistake is an administrator's restore away.
 */
function actingAccountId(actor: ActorContext): string {
  if (actor.role !== "administrator" && actor.role !== "account") {
    throw new TournamentOperationError("forbidden", "An account actor is required.");
  }
  return actor.userAccountId;
}

export class TournamentRetractionService {
  public constructor(
    private readonly repository: TournamentRetractionRepository,
    private readonly publications: RetractionPublicationService,
    private readonly ratings: RetractionRatingLifecycleService,
    private readonly now: () => number = Date.now,
    private readonly reports: RetractionReportRepository | null = null,
  ) {}

  /**
   * Undoes a finalization so a mistake found late - typically while writing
   * the report - can be corrected in the steps. Owner decision 2026-09-15.
   *
   * It is the removal's correction path pointed the other way: the pinned
   * result set is retracted, and when the night counted for TrueSkill the
   * rating is recalculated without it - a full audited replay, exactly as a
   * removal does (ADR-0155). A published report goes back to draft, because
   * the standing it printed is no longer the night's result. Groups, seats,
   * scores and the report's text all stay; the Tournament stands at Step 10
   * again and can be finalized anew, which pins a fresh result set and
   * applies it once.
   *
   * Administrator only: it moves the rating for everybody.
   */
  public async reopen(actor: ActorContext, input: { tournamentId: string; reason: string }): Promise<TournamentReopenState> {
    const administratorAccountId = requireAdministrator(actor);
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 512) {
      throw new TournamentOperationError("invalid_input", "Provide a reason between 3 and 512 characters.");
    }
    const state = await this.repository.prepareReopen({
      tournamentId: input.tournamentId,
      actorUserAccountId: administratorAccountId,
      reason,
      nowMs: this.now(),
    });
    if (state === null) {
      throw new TournamentOperationError("not_found", "The Tournament was not found.");
    }
    if (!state.wasFinalized) {
      throw new TournamentOperationError("conflict", "The Tournament is not finalized.");
    }
    if (
      state.publicationId !== null
      && state.publicationRevision !== null
      && state.publicationStatus === "published"
    ) {
      await this.publications.retract(actor, state.publicationId, {
        expectedRevision: state.publicationRevision,
        reasonCode: "tournament_reopened",
      });
    }
    await this.reports?.unpublish({ tournamentId: input.tournamentId, nowMs: this.now() });
    let ratingEpochId = state.ratingEpochId;
    if (state.ratingWasIncluded && state.publicationId !== null) {
      await this.ratings.recordDecision({
        administratorAccountId,
        publicationPublicId: state.publicationId,
        ratingIncluded: false,
        reasonCode: "tournament_reopened",
      });
      try {
        const replay = await this.ratings.recalculate({
          administratorAccountId,
          reasonCode: "tournament_reopened",
        });
        ratingEpochId = replay.epoch;
      } catch (error) {
        // The night is reopened and its result set excluded; only the rating
        // still carries it. Say so, and say what puts it right, instead of a
        // bare failure: the QA mirror has no history to replay, production has.
        const message = error instanceof Error ? error.message : String(error);
        throw new TournamentOperationError(
          "conflict",
          `The night is reopened, but the rating could not be replayed without it (${message}). ` +
          "Run the rating recompute before finalizing again.",
        );
      }
    }
    return { ...state, ratingEpochId };
  }

  public async remove(actor: ActorContext, input: { tournamentId: string; reason: string }): Promise<TournamentRetractionState> {
    const administratorAccountId = actingAccountId(actor);
    if (actor.role !== "administrator") {
      const own = await this.repository.isDirectorOf(input.tournamentId, administratorAccountId);
      if (!own) {
        throw new TournamentOperationError(
          "forbidden", "Only an administrator or the Tournament's own director may remove it.",
        );
      }
    }
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 512) {
      throw new TournamentOperationError("invalid_input", "Provide a removal reason between 3 and 512 characters.");
    }

    const state = await this.repository.prepareRetraction({
      tournamentId: input.tournamentId,
      actorUserAccountId: administratorAccountId,
      reason,
      nowMs: this.now(),
    });
    if (state === null) {
      throw new TournamentOperationError("not_found", "The Tournament was not found.");
    }

    if (
      state.publicationId !== null
      && state.publicationRevision !== null
      && state.publicationStatus === "published"
    ) {
      await this.publications.retract(actor, state.publicationId, {
        expectedRevision: state.publicationRevision,
        reasonCode: "tournament_removed",
      });
    }

    if (state.ratingWasIncluded && state.publicationId !== null && state.ratingEpochId === null) {
      await this.ratings.recordDecision({
        administratorAccountId,
        publicationPublicId: state.publicationId,
        ratingIncluded: false,
        reasonCode: "tournament_removed",
      });
      const recalculation = await this.ratings.recalculate({
        administratorAccountId,
        reasonCode: "tournament_removed",
      });
      await this.repository.markRatingReplayCompleted({
        tournamentId: input.tournamentId,
        ratingEpochId: recalculation.epoch,
        nowMs: this.now(),
      });
      return { ...state, ratingEpochId: recalculation.epoch };
    }

    return state;
  }

  /**
   * Undoes a removal, and says what the restored Tournament counts towards.
   *
   * Owner decision 2026-08-28: a restore may put everything back at once, or
   * the administrator may choose per side - whether the results count for the
   * Players again, and whether the Tournament counts for TrueSkill again.
   *
   * Putting it back into TrueSkill is not a local edit: the ratings are a
   * replay, so including a Tournament again means replaying every rated race
   * from the seed baseline into a fresh epoch. That is what `recalculate` does
   * and why it is only run when this restore actually asks for it.
   */
  public async restore(
    actor: ActorContext,
    input: {
      tournamentId: string;
      reason: string;
      publicResults: boolean;
      affectsRating: boolean;
    },
  ): Promise<TournamentRestoreState> {
    const administratorAccountId = requireAdministrator(actor);
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 512) {
      throw new TournamentOperationError(
        "invalid_input", "Provide a restore reason between 3 and 512 characters.",
      );
    }
    const state = await this.repository.restoreTournament({
      tournamentId: input.tournamentId,
      actorUserAccountId: administratorAccountId,
      reason,
      publicResults: input.publicResults,
      affectsRating: input.affectsRating,
      nowMs: this.now(),
    });
    if (state === null) {
      throw new TournamentOperationError("not_found", "The Tournament was not found.");
    }

    // The results count for the Players again: put back the publication that
    // was withdrawn, with the races it actually carried.
    let republished = false;
    if (input.publicResults) {
      const plan = await this.repository.loadRepublishPlan(input.tournamentId);
      if (plan !== null) {
        await this.publications.republish(actor, plan.publicationId, {
          expectedRevision: plan.expectedRevision,
          eventName: plan.eventName,
          targets: plan.targets,
          reasonCode: "tournament_restored",
        });
        republished = true;
      }
    }

    // TrueSkill counts it again: record the decision and replay everything.
    let ratingEpochId: number | null = null;
    if (input.affectsRating) {
      const plan = await this.repository.loadRepublishPlan(input.tournamentId);
      if (plan !== null) {
        await this.ratings.recordDecision({
          administratorAccountId,
          publicationPublicId: plan.publicationId,
          ratingIncluded: true,
          reasonCode: "tournament_restored",
        });
      }
      const recalculation = await this.ratings.recalculate({
        administratorAccountId,
        reasonCode: "tournament_restored",
      });
      ratingEpochId = recalculation.epoch;
      await this.repository.markRatingReplayCompleted({
        tournamentId: input.tournamentId,
        ratingEpochId: recalculation.epoch,
        nowMs: this.now(),
      });
    }

    return { ...state, republished, ratingEpochId };
  }
}
