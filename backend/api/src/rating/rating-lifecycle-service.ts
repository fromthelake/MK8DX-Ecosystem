// Tournament-driven rating lifecycle (ADR-0155): apply published canonical
// tournament races per race through the proven engine, record append-only
// per-publication rating decisions, and rebuild complete rating epochs
// deterministically from the seed baseline.

import {
  MILLISECONDS_PER_DAY,
  decayRating,
} from "./inactivity-decay.js";
import {
  countingPlacements,
  EVERYONE_COUNTS,
  type RatingEligibility,
} from "./rating-eligibility.js";
import {
  MEASURED_RATING_PARAMETERS,
  initialRating,
  rateFreeForAllRace,
  type Rating,
} from "./trueskill-engine.js";

const reasonCodePattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export class RatingLifecycleError extends Error {
  public constructor(
    public readonly code:
      | "not_found"
      | "forbidden"
      | "invalid_command"
      | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "RatingLifecycleError";
  }
}

export type RatingPlacement = Readonly<{
  playerInternalId: number | null;
  finishPosition: number;
}>;

export type RatingPublicationRace = Readonly<{
  revisionInternalId: number;
  placements: readonly RatingPlacement[];
}>;

export type RatingApplicationResult = Readonly<{
  publicationId: string;
  epoch: number;
  appliedRaces: number;
  skippedRaces: number;
  ratedPlayers: number;
  alreadyApplied: boolean;
}>;

export type RatingRecalculationResult = Readonly<{
  epoch: number;
  includedPublications: number;
  appliedRaces: number;
  skippedRaces: number;
  ratedPlayers: number;
}>;

export interface RatingLifecycleTransaction {
  findActiveAdministratorAccount(
    userAccountPublicId: string,
  ): Promise<number | null>;
  findPublication(publicationPublicId: string): Promise<Readonly<{
    internalId: number;
    publicationStatus: string;
  }> | null>;
  isPublicationIncluded(publicationInternalId: number): Promise<boolean>;
  latestDecisionSequence(publicationInternalId: number): Promise<number>;
  appendDecision(input: Readonly<{
    publicationInternalId: number;
    sequenceNumber: number;
    ratingIncluded: boolean;
    reasonCode: string;
    decidedByInternalId: number;
    nowMs: number;
  }>): Promise<void>;
  currentEpoch(): Promise<number>;
  loadPublicationRaces(
    publicationInternalId: number,
  ): Promise<readonly RatingPublicationRace[]>;
  /**
   * ADR-0221: who counts for this result set's races (the installation's
   * eligibility and the night's "only verified Players"), or for the seeds
   * when `publicationInternalId` is null. Optional: without it everybody counts.
   */
  loadRatingEligibility?(publicationInternalId: number | null): Promise<RatingEligibility>;
  hasRaceEventsForRevisions(
    revisionInternalIds: readonly number[],
    epoch: number,
  ): Promise<boolean>;
  loadCurrentRatings(): Promise<ReadonlyMap<number, Rating>>;
  /** When each Player last had a race rated, for the inactivity rule. */
  loadLastRatedAtMs?(epoch: number): Promise<ReadonlyMap<number, number>>;
  loadNextSequences(epoch: number): Promise<ReadonlyMap<number, number>>;
  appendRatingEvent(input: Readonly<{
    playerInternalId: number;
    epoch: number;
    sequenceNumber: number;
    eventType: "seed_import" | "race_result";
    muBefore: number | null;
    sigmaBefore: number | null;
    muAfter: number;
    sigmaAfter: number;
    sourceReference: string;
    revisionInternalId: number | null;
    nowMs: number;
  }>): Promise<void>;
  upsertCurrentRating(input: Readonly<{
    playerInternalId: number;
    mu: number;
    sigma: number;
    nowMs: number;
  }>): Promise<void>;
  deleteCurrentRatingsExcept(
    playerInternalIds: readonly number[],
  ): Promise<number>;
  insertRecalculation(input: Readonly<{
    reasonCode: string;
    triggeredByInternalId: number;
    nowMs: number;
  }>): Promise<number>;
  finishRecalculation(input: Readonly<{
    recalculationId: number;
    includedPublications: number;
    appliedRaces: number;
    skippedRaces: number;
  }>): Promise<void>;
  loadSeedBaseline(): Promise<readonly Readonly<{
    playerInternalId: number;
    mu: number;
    sigma: number;
    sourceReference: string;
  }>[]>;
  listIncludedPublicationsInOrder(): Promise<readonly Readonly<{
    internalId: number;
    publicationPublicId: string;
  }>[]>;
}

export interface RatingLifecycleRepository {
  transaction<T>(
    work: (transaction: RatingLifecycleTransaction) => Promise<T>,
  ): Promise<T>;
}

function validReasonCode(reasonCode: string): string {
  if (!reasonCodePattern.test(reasonCode) || reasonCode.length > 64) {
    throw new RatingLifecycleError(
      "invalid_command",
      "reasonCode must be short lower-case dotted/dashed words",
    );
  }
  return reasonCode;
}

// A race is rated only when every placement is an identified canonical
// Player and at least two Players raced (ADR-0155). Ranks pass to the
// engine order-preservingly (only the order is semantically meaningful for
// no-draw TrueSkill).
function rateableObservations(
  race: RatingPublicationRace,
): readonly Readonly<{ playerInternalId: number; rank: number }>[] | null {
  if (race.placements.length < 2 ||
    race.placements.some((placement) => placement.playerInternalId === null)) {
    return null;
  }
  const ordered = [...race.placements]
    .sort((a, b) => a.finishPosition - b.finishPosition);
  return ordered.map((placement, index) => ({
    playerInternalId: placement.playerInternalId!,
    rank: index + 1,
  }));
}

function countingRaces(
  races: readonly RatingPublicationRace[],
  eligibility: RatingEligibility,
): readonly RatingPublicationRace[] {
  if (!eligibility.requireClaim) { return races; }
  return races.map((race) => ({ ...race, placements: countingPlacements(race.placements, eligibility) }));
}

async function applyRaces(
  transaction: RatingLifecycleTransaction,
  races: readonly RatingPublicationRace[],
  ratings: Map<number, Rating>,
  sequences: Map<number, number>,
  epoch: number,
  sourceReference: string,
  nowMs: number,
): Promise<Readonly<{ appliedRaces: number; skippedRaces: number }>> {
  let appliedRaces = 0;
  let skippedRaces = 0;
  for (const race of races) {
    const observations = rateableObservations(race);
    if (observations === null) {
      skippedRaces += 1;
      continue;
    }
    const before = observations.map((observation) =>
      ratings.get(observation.playerInternalId) ?? null);
    const participants = before.map((rating) => rating ?? initialRating());
    // The parameters ADR-0189 adopted, measured on the whole history, not the
    // library defaults this path used to fall back to. The epoch this appends
    // to was built with them, so rating a new tournament with the old beta
    // and tau would put two different models in one timeline.
    const updated = rateFreeForAllRace(
      participants,
      observations.map((observation) => observation.rank),
      MEASURED_RATING_PARAMETERS,
    );
    for (const [index, observation] of observations.entries()) {
      const playerInternalId = observation.playerInternalId;
      const result = updated[index]!;
      const sequenceNumber = (sequences.get(playerInternalId) ?? 0) + 1;
      sequences.set(playerInternalId, sequenceNumber);
      await transaction.appendRatingEvent({
        playerInternalId,
        epoch,
        sequenceNumber,
        eventType: "race_result",
        muBefore: before[index]?.mu ?? null,
        sigmaBefore: before[index]?.sigma ?? null,
        muAfter: result.mu,
        sigmaAfter: result.sigma,
        sourceReference,
        revisionInternalId: race.revisionInternalId,
        nowMs,
      });
      ratings.set(playerInternalId, result);
    }
    appliedRaces += 1;
  }
  return { appliedRaces, skippedRaces };
}

export class RatingLifecycleService {
  public constructor(
    private readonly repository: RatingLifecycleRepository,
    private readonly clock: Readonly<{ nowMs(): number }>,
  ) {}

  public async applyPublication(
    publicationPublicId: string,
  ): Promise<RatingApplicationResult> {
    const nowMs = this.clock.nowMs();
    return this.repository.transaction(async (transaction) => {
      const publication =
        await transaction.findPublication(publicationPublicId);
      if (publication === null) {
        throw new RatingLifecycleError("not_found", "publication not found");
      }
      if (publication.publicationStatus !== "published") {
        throw new RatingLifecycleError(
          "conflict",
          "only a published tournament can be rated",
        );
      }
      if (!(await transaction.isPublicationIncluded(publication.internalId))) {
        throw new RatingLifecycleError(
          "conflict",
          "this publication is excluded from rating by decision",
        );
      }
      const epoch = await transaction.currentEpoch();
      const loaded =
        await transaction.loadPublicationRaces(publication.internalId);
      if (loaded.length === 0) {
        throw new RatingLifecycleError(
          "conflict",
          "the publication has no current member races",
        );
      }
      const races = countingRaces(
        loaded,
        await transaction.loadRatingEligibility?.(publication.internalId) ?? EVERYONE_COUNTS,
      );
      if (await transaction.hasRaceEventsForRevisions(
        races.map((race) => race.revisionInternalId), epoch)) {
        return {
          publicationId: publicationPublicId,
          epoch,
          appliedRaces: 0,
          skippedRaces: 0,
          ratedPlayers: 0,
          alreadyApplied: true,
        };
      }
      const ratings = new Map(await transaction.loadCurrentRatings());
      const sequences = new Map(await transaction.loadNextSequences(epoch));
      // Inactivity decay (ADR-0189). A Tournament is the clock: everybody is
      // faded by the time since their own last rated race before this one is
      // rated, so somebody returning after two years is rated from near the
      // prior and re-learns quickly - and somebody who did not turn up at all
      // slides down without a race being invented for them.
      //
      // This runs before the races, not after, or a returning Player would be
      // rated at full old strength and only then faded.
      const faded = new Set<number>();
      const lastRatedAtMs = await transaction.loadLastRatedAtMs?.(epoch);
      if (lastRatedAtMs !== undefined) {
        for (const [playerInternalId, rating] of ratings) {
          const lastAt = lastRatedAtMs.get(playerInternalId);
          if (lastAt === undefined) { continue; }
          const days = Math.max(
            0, Math.floor((nowMs - lastAt) / MILLISECONDS_PER_DAY));
          const decayed = decayRating(rating, days);
          if (decayed !== rating) {
            ratings.set(playerInternalId, decayed);
            faded.add(playerInternalId);
          }
        }
      }
      const touched = new Set<number>();
      for (const race of races) {
        for (const placement of race.placements) {
          if (placement.playerInternalId !== null) {
            touched.add(placement.playerInternalId);
          }
        }
      }
      const { appliedRaces, skippedRaces } = await applyRaces(
        transaction, races, ratings, sequences, epoch,
        publicationPublicId, nowMs,
      );
      let ratedPlayers = 0;
      // Whoever raced, plus whoever faded: the second group has no event, but
      // their standing has moved and the table has to say so.
      for (const playerInternalId of new Set([...touched, ...faded])) {
        const rating = ratings.get(playerInternalId);
        if (rating !== undefined) {
          await transaction.upsertCurrentRating({
            playerInternalId,
            mu: rating.mu,
            sigma: rating.sigma,
            nowMs,
          });
          ratedPlayers += 1;
        }
      }
      return {
        publicationId: publicationPublicId,
        epoch,
        appliedRaces,
        skippedRaces,
        ratedPlayers,
        alreadyApplied: false,
      };
    });
  }

  /**
   * The faithful recalculation, when the runtime provides it (ADR-0155
   * addendum 2026-09-15): the corrected history replayed with the measured
   * parameters and decay, then every counting result set on top. Set once by
   * the composition; without it `recalculate` keeps its seed-only replay,
   * which the unit tests exercise and which no production path runs.
   */
  private historyReplay: ((input: Readonly<{ administratorAccountId: string; reasonCode: string }>) => Promise<RatingRecalculationResult>) | null = null;

  public useHistoryReplay(replay: (input: Readonly<{ administratorAccountId: string; reasonCode: string }>) => Promise<RatingRecalculationResult>): void {
    this.historyReplay = replay;
  }

  /** The pinned result sets that count for the rating, oldest first: what a replay applies after the history. */
  public async listIncludedPublications(): Promise<readonly string[]> {
    return this.repository.transaction(async (transaction) =>
      (await transaction.listIncludedPublicationsInOrder()).map((publication) => publication.publicationPublicId));
  }

  public async recordDecision(input: Readonly<{
    administratorAccountId: string;
    publicationPublicId: string;
    ratingIncluded: boolean;
    reasonCode: string;
  }>): Promise<Readonly<{ publicationId: string; ratingIncluded: boolean }>> {
    const reasonCode = validReasonCode(input.reasonCode);
    const nowMs = this.clock.nowMs();
    return this.repository.transaction(async (transaction) => {
      const actor = await transaction.findActiveAdministratorAccount(
        input.administratorAccountId,
      );
      if (actor === null) {
        throw new RatingLifecycleError(
          "forbidden",
          "an active administrator account is required",
        );
      }
      const publication =
        await transaction.findPublication(input.publicationPublicId);
      if (publication === null) {
        throw new RatingLifecycleError("not_found", "publication not found");
      }
      const sequenceNumber =
        (await transaction.latestDecisionSequence(publication.internalId)) + 1;
      await transaction.appendDecision({
        publicationInternalId: publication.internalId,
        sequenceNumber,
        ratingIncluded: input.ratingIncluded,
        reasonCode,
        decidedByInternalId: actor,
        nowMs,
      });
      return {
        publicationId: input.publicationPublicId,
        ratingIncluded: input.ratingIncluded,
      };
    });
  }

  public async recalculate(input: Readonly<{
    administratorAccountId: string;
    reasonCode: string;
  }>): Promise<RatingRecalculationResult> {
    const reasonCode = validReasonCode(input.reasonCode);
    const nowMs = this.clock.nowMs();
    if (this.historyReplay !== null) {
      const authorized = await this.repository.transaction(async (transaction) =>
        transaction.findActiveAdministratorAccount(input.administratorAccountId));
      if (authorized === null) {
        throw new RatingLifecycleError("forbidden", "an active administrator account is required");
      }
      return this.historyReplay({ administratorAccountId: input.administratorAccountId, reasonCode });
    }
    return this.repository.transaction(async (transaction) => {
      const actor = await transaction.findActiveAdministratorAccount(
        input.administratorAccountId,
      );
      if (actor === null) {
        throw new RatingLifecycleError(
          "forbidden",
          "an active administrator account is required",
        );
      }
      const epoch = await transaction.insertRecalculation({
        reasonCode,
        triggeredByInternalId: actor,
        nowMs,
      });
      const ratings = new Map<number, Rating>();
      const sequences = new Map<number, number>();
      const seedEligibility = await transaction.loadRatingEligibility?.(null) ?? EVERYONE_COUNTS;
      for (const seed of await transaction.loadSeedBaseline()) {
        if (seedEligibility.requireClaim && !seedEligibility.claimedPlayerIds.has(seed.playerInternalId)) { continue; }
        ratings.set(seed.playerInternalId, {
          mu: seed.mu,
          sigma: seed.sigma,
        });
        const sequenceNumber = 1;
        sequences.set(seed.playerInternalId, sequenceNumber);
        await transaction.appendRatingEvent({
          playerInternalId: seed.playerInternalId,
          epoch,
          sequenceNumber,
          eventType: "seed_import",
          muBefore: null,
          sigmaBefore: null,
          muAfter: seed.mu,
          sigmaAfter: seed.sigma,
          sourceReference: seed.sourceReference,
          revisionInternalId: null,
          nowMs,
        });
      }
      const publications =
        await transaction.listIncludedPublicationsInOrder();
      let appliedRaces = 0;
      let skippedRaces = 0;
      for (const publication of publications) {
        const races = countingRaces(
          await transaction.loadPublicationRaces(publication.internalId),
          await transaction.loadRatingEligibility?.(publication.internalId) ?? EVERYONE_COUNTS,
        );
        const outcome = await applyRaces(
          transaction, races, ratings, sequences, epoch,
          publication.publicationPublicId, nowMs,
        );
        appliedRaces += outcome.appliedRaces;
        skippedRaces += outcome.skippedRaces;
      }
      for (const [playerInternalId, rating] of ratings) {
        await transaction.upsertCurrentRating({
          playerInternalId,
          mu: rating.mu,
          sigma: rating.sigma,
          nowMs,
        });
      }
      await transaction.deleteCurrentRatingsExcept([...ratings.keys()]);
      await transaction.finishRecalculation({
        recalculationId: epoch,
        includedPublications: publications.length,
        appliedRaces,
        skippedRaces,
      });
      return {
        epoch,
        includedPublications: publications.length,
        appliedRaces,
        skippedRaces,
        ratedPlayers: ratings.size,
      };
    });
  }
}
