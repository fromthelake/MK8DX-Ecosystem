// ADR-0221: who counts for the rating. A Player who does not count still
// raced, but the remaining field is rated among itself in the same order;
// the corrected history is replayed with only the eligible Players; seeding
// from a Director's own nights replays only those nights.

import { describe, expect, it } from "vitest";

import { directorNightRatings } from "../src/rating/director-night-ratings.js";
import { eligibleHistory } from "../src/rating/history-recompute-main.js";
import { countingPlacements, EVERYONE_COUNTS, type RatingEligibility } from "../src/rating/rating-eligibility.js";
import {
  RatingLifecycleService,
  type RatingLifecycleTransaction,
  type RatingPublicationRace,
} from "../src/rating/rating-lifecycle-service.js";
import {
  initialRating,
  MEASURED_RATING_PARAMETERS,
  rateFreeForAllRace,
  type Rating,
} from "../src/rating/trueskill-engine.js";

const claimedOneAndThree: RatingEligibility = { requireClaim: true, claimedPlayerIds: new Set([1, 3]) };

describe("counting placements", () => {
  it("keeps everybody when everybody counts", () => {
    const placements = [{ playerInternalId: 2, finishPosition: 1 }, { playerInternalId: 1, finishPosition: 2 }];
    expect(countingPlacements(placements, EVERYONE_COUNTS)).toBe(placements);
  });

  it("drops Players without a verified claim and re-ranks the rest in their finishing order", () => {
    expect(countingPlacements([
      { playerInternalId: 2, finishPosition: 1 },
      { playerInternalId: 3, finishPosition: 2 },
      { playerInternalId: 4, finishPosition: 3 },
      { playerInternalId: 1, finishPosition: 4 },
    ], claimedOneAndThree)).toEqual([
      { playerInternalId: 3, finishPosition: 1 },
      { playerInternalId: 1, finishPosition: 2 },
    ]);
  });

  it("keeps an unidentified placement, so that race stays unrateable as before", () => {
    expect(countingPlacements([
      { playerInternalId: null, finishPosition: 1 },
      { playerInternalId: 1, finishPosition: 2 },
    ], claimedOneAndThree)).toEqual([
      { playerInternalId: null, finishPosition: 1 },
      { playerInternalId: 1, finishPosition: 2 },
    ]);
  });
});

describe("the corrected history with only the eligible Players", () => {
  const race = {
    raceSequence: 1, tournamentNumber: 4, heldAtMs: 1_000, countsTowardRating: true,
    placements: [
      { playerId: 5, finishPosition: 1 }, { playerId: 6, finishPosition: 2 }, { playerId: 7, finishPosition: 3 },
    ],
  };

  it("is the whole history when everybody counts", () => {
    expect(eligibleHistory([race], null)).toEqual([race]);
  });

  it("leaves the others out, re-ranks, and stops counting a race with fewer than two left", () => {
    expect(eligibleHistory([race], new Set([5, 7]))).toEqual([
      { ...race, placements: [{ playerId: 5, finishPosition: 1 }, { playerId: 7, finishPosition: 2 }] },
    ]);
    expect(eligibleHistory([race], new Set([6]))[0]).toMatchObject({
      countsTowardRating: false, placements: [{ playerId: 6, finishPosition: 1 }],
    });
  });
});

function lifecycle(options: Readonly<{
  races: readonly RatingPublicationRace[];
  eligibility: (publicationInternalId: number | null) => RatingEligibility;
  seeds?: readonly Readonly<{ playerInternalId: number; mu: number; sigma: number; sourceReference: string }>[];
}>) {
  const ratings = new Map<number, Rating>();
  const events: { playerInternalId: number; epoch: number }[] = [];
  const transaction: RatingLifecycleTransaction = {
    async findActiveAdministratorAccount() { return 77; },
    async findPublication() { return { internalId: 10, publicationStatus: "published" }; },
    async isPublicationIncluded() { return true; },
    async latestDecisionSequence() { return 0; },
    async appendDecision() {},
    async currentEpoch() { return 0; },
    async loadPublicationRaces() { return options.races; },
    async loadRatingEligibility(publicationInternalId) { return options.eligibility(publicationInternalId); },
    async hasRaceEventsForRevisions() { return false; },
    async loadCurrentRatings() { return new Map(ratings); },
    async loadNextSequences() { return new Map(); },
    async appendRatingEvent(input) { events.push({ playerInternalId: input.playerInternalId, epoch: input.epoch }); },
    async upsertCurrentRating(input) { ratings.set(input.playerInternalId, { mu: input.mu, sigma: input.sigma }); },
    async deleteCurrentRatingsExcept(ids) {
      for (const id of [...ratings.keys()]) { if (!ids.includes(id)) { ratings.delete(id); } }
      return 0;
    },
    async insertRecalculation() { return 1; },
    async finishRecalculation() {},
    async loadSeedBaseline() { return options.seeds ?? []; },
    async listIncludedPublicationsInOrder() { return [{ internalId: 10, publicationPublicId: "tournament_publication.night" }]; },
  };
  const service = new RatingLifecycleService({ async transaction(work) { return work(transaction); } }, { nowMs: () => 5_000 });
  return { service, ratings, events };
}

describe("applying a night under the eligibility rules", () => {
  const race: RatingPublicationRace = {
    revisionInternalId: 900,
    placements: [
      { playerInternalId: 2, finishPosition: 1 },
      { playerInternalId: 1, finishPosition: 2 },
      { playerInternalId: 3, finishPosition: 3 },
    ],
  };

  it("rates only the verified Players, among themselves, and leaves the unclaimed winner unrated", async () => {
    const { service, ratings, events } = lifecycle({ races: [race], eligibility: () => claimedOneAndThree });
    const result = await service.applyPublication("tournament_publication.night");
    expect(result).toMatchObject({ appliedRaces: 1, skippedRaces: 0, ratedPlayers: 2 });
    const [first, second] = rateFreeForAllRace([initialRating(), initialRating()], [1, 2], MEASURED_RATING_PARAMETERS);
    expect(ratings.get(1)).toEqual(first);
    expect(ratings.get(3)).toEqual(second);
    expect(ratings.has(2)).toBe(false);
    expect(events.map((event) => event.playerInternalId).sort()).toEqual([1, 3]);
  });

  it("changes nobody when fewer than two verified Players raced", async () => {
    const { service, ratings } = lifecycle({
      races: [race], eligibility: () => ({ requireClaim: true, claimedPlayerIds: new Set([1]) }),
    });
    expect(await service.applyPublication("tournament_publication.night")).toMatchObject({ appliedRaces: 0, skippedRaces: 1 });
    expect(ratings.size).toBe(0);
  });

  it("rates everybody when everybody counts (the default)", async () => {
    const { service, ratings } = lifecycle({ races: [race], eligibility: () => EVERYONE_COUNTS });
    await service.applyPublication("tournament_publication.night");
    expect([...ratings.keys()].sort()).toEqual([1, 2, 3]);
  });

  it("gives an unclaimed Player no seed in a seed-only recalculation", async () => {
    const { service, ratings } = lifecycle({
      races: [race],
      eligibility: () => claimedOneAndThree,
      seeds: [
        { playerInternalId: 1, mu: 25, sigma: 8, sourceReference: "seed" },
        { playerInternalId: 2, mu: 30, sigma: 2, sourceReference: "seed" },
      ],
    });
    await service.recalculate({ administratorAccountId: "user_account.admin", reasonCode: "installation_rating_eligibility" });
    expect([...ratings.keys()].sort()).toEqual([1, 3]);
  });
});

describe("seeding from a Director's own nights", () => {
  it("replays only those nights, oldest first, and ranks by the conservative score", () => {
    const seeds = directorNightRatings([
      // Listed out of order on purpose: the later night must be applied last.
      { heldAtMs: 2_000, placements: [{ playerInternalId: 30, finishPosition: 1 }, { playerInternalId: 10, finishPosition: 2 }] },
      { heldAtMs: 1_000, placements: [{ playerInternalId: 10, finishPosition: 1 }, { playerInternalId: 20, finishPosition: 2 }] },
      { heldAtMs: 1_000, placements: [{ playerInternalId: 10, finishPosition: 1 }, { playerInternalId: null, finishPosition: 2 }] },
    ]);
    expect([...seeds.keys()].sort()).toEqual([10, 20, 30]);
    // 10 won once and lost once; 30 beat 10; 20 only lost.
    expect(seeds.get(20)!.rank).toBe(3);
    const ranks = [seeds.get(10)!.rank, seeds.get(30)!.rank].sort();
    expect(ranks).toEqual([1, 2]);
    expect(seeds.get(10)!.score).toBeGreaterThan(seeds.get(20)!.score);
  });

  it("rates nobody without nights", () => {
    expect(directorNightRatings([]).size).toBe(0);
  });
});
