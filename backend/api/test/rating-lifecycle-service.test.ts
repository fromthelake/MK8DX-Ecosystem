import { describe, expect, it } from "vitest";

import { decayRating } from "../src/rating/inactivity-decay.js";
import {
  RatingLifecycleService,
  type RatingLifecycleTransaction,
  type RatingPublicationRace,
} from "../src/rating/rating-lifecycle-service.js";
import {
  RATING_INITIAL_MU,
  initialRating,
  MEASURED_RATING_PARAMETERS,
  rateFreeForAllRace,
  type Rating,
} from "../src/rating/trueskill-engine.js";

type PublicationFixture = {
  internalId: number;
  publicationStatus: string;
  publishedAtMs: number;
  races: RatingPublicationRace[];
};

type Store = {
  administrators: Map<string, number>;
  publications: Map<string, PublicationFixture>;
  decisions: { publicationInternalId: number; sequenceNumber: number;
    ratingIncluded: boolean; reasonCode: string }[];
  events: {
    playerInternalId: number; epoch: number; sequenceNumber: number;
    eventType: string; muAfter: number; sigmaAfter: number;
    sourceReference: string; revisionInternalId: number | null;
  }[];
  ratings: Map<number, Rating>;
  /** When each Player last had a race rated, for the inactivity rule. */
  lastRatedAtMs: Map<number, number>;
  recalculations: { id: number; reasonCode: string;
    includedPublications?: number; appliedRaces?: number;
    skippedRaces?: number }[];
  seedBaseline: { playerInternalId: number; mu: number; sigma: number;
    sourceReference: string }[];
};

function makeService(store: Store, nowMs = 5_000) {
  const transaction: RatingLifecycleTransaction = {
    async findActiveAdministratorAccount(publicId) {
      return store.administrators.get(publicId) ?? null;
    },
    async findPublication(publicId) {
      const publication = store.publications.get(publicId);
      return publication === undefined ? null : {
        internalId: publication.internalId,
        publicationStatus: publication.publicationStatus,
      };
    },
    async isPublicationIncluded(publicationInternalId) {
      const latest = [...store.decisions]
        .filter((d) => d.publicationInternalId === publicationInternalId)
        .sort((a, b) => b.sequenceNumber - a.sequenceNumber)[0];
      return latest?.ratingIncluded ?? true;
    },
    async latestDecisionSequence(publicationInternalId) {
      return Math.max(0, ...store.decisions
        .filter((d) => d.publicationInternalId === publicationInternalId)
        .map((d) => d.sequenceNumber));
    },
    async appendDecision(input) {
      store.decisions.push({
        publicationInternalId: input.publicationInternalId,
        sequenceNumber: input.sequenceNumber,
        ratingIncluded: input.ratingIncluded,
        reasonCode: input.reasonCode,
      });
    },
    async currentEpoch() {
      return Math.max(0, ...store.recalculations.map((r) => r.id));
    },
    async loadPublicationRaces(publicationInternalId) {
      for (const publication of store.publications.values()) {
        if (publication.internalId === publicationInternalId) {
          return publication.races;
        }
      }
      return [];
    },
    async hasRaceEventsForRevisions(revisionInternalIds, epoch) {
      return store.events.some((event) => event.epoch === epoch &&
        event.revisionInternalId !== null &&
        revisionInternalIds.includes(event.revisionInternalId));
    },
    async loadCurrentRatings() {
      return new Map(store.ratings);
    },
    async loadLastRatedAtMs() {
      return new Map(store.lastRatedAtMs);
    },
    async loadNextSequences(epoch) {
      const sequences = new Map<number, number>();
      for (const event of store.events) {
        if (event.epoch === epoch) {
          sequences.set(event.playerInternalId, Math.max(
            sequences.get(event.playerInternalId) ?? 0,
            event.sequenceNumber,
          ));
        }
      }
      return sequences;
    },
    async appendRatingEvent(input) {
      store.events.push({
        playerInternalId: input.playerInternalId,
        epoch: input.epoch,
        sequenceNumber: input.sequenceNumber,
        eventType: input.eventType,
        muAfter: input.muAfter,
        sigmaAfter: input.sigmaAfter,
        sourceReference: input.sourceReference,
        revisionInternalId: input.revisionInternalId,
      });
    },
    async upsertCurrentRating(input) {
      store.ratings.set(input.playerInternalId, {
        mu: input.mu,
        sigma: input.sigma,
      });
    },
    async deleteCurrentRatingsExcept(playerInternalIds) {
      let removed = 0;
      for (const playerInternalId of [...store.ratings.keys()]) {
        if (!playerInternalIds.includes(playerInternalId)) {
          store.ratings.delete(playerInternalId);
          removed += 1;
        }
      }
      return removed;
    },
    async insertRecalculation(input) {
      const id = store.recalculations.length + 1;
      store.recalculations.push({ id, reasonCode: input.reasonCode });
      return id;
    },
    async finishRecalculation(input) {
      const row = store.recalculations
        .find((r) => r.id === input.recalculationId)!;
      row.includedPublications = input.includedPublications;
      row.appliedRaces = input.appliedRaces;
      row.skippedRaces = input.skippedRaces;
    },
    async loadSeedBaseline() {
      return store.seedBaseline;
    },
    async listIncludedPublicationsInOrder() {
      return [...store.publications.entries()]
        .filter(([, p]) => p.publicationStatus === "published")
        .filter(([, p]) => {
          const latest = [...store.decisions]
            .filter((d) => d.publicationInternalId === p.internalId)
            .sort((a, b) => b.sequenceNumber - a.sequenceNumber)[0];
          return latest?.ratingIncluded ?? true;
        })
        .sort(([, a], [, b]) => a.publishedAtMs - b.publishedAtMs)
        .map(([publicId, p]) => ({
          internalId: p.internalId,
          publicationPublicId: publicId,
        }));
    },
  };
  return new RatingLifecycleService(
    { async transaction(work) { return work(transaction); } },
    { nowMs: () => nowMs },
  );
}

function emptyStore(overrides: Partial<Store> = {}): Store {
  return {
    administrators: new Map([["user_account.admin", 77]]),
    publications: new Map(),
    decisions: [],
    events: [],
    ratings: new Map(),
    lastRatedAtMs: new Map(),
    recalculations: [],
    seedBaseline: [],
    ...overrides,
  };
}

const raceOneTwo: RatingPublicationRace = {
  revisionInternalId: 900,
  placements: [
    { playerInternalId: 1, finishPosition: 1 },
    { playerInternalId: 2, finishPosition: 2 },
  ],
};

describe("tournament rating lifecycle", () => {
  it("fades an absent Player when a Tournament is rated, and writes it down", async () => {
    // ADR-0189: a Tournament is the clock. Somebody who did not turn up has no
    // race to record, but their standing has still moved and the table has to
    // say so - otherwise a Player who stopped three years ago keeps their
    // score for ever.
    const day = 86_400_000;
    const now = 1_000 * day;
    const store = emptyStore();
    store.ratings.set(1, initialRating());
    store.ratings.set(2, initialRating());
    // Player 3 is not in this Tournament and has been away for 800 days.
    store.ratings.set(3, { mu: 30, sigma: 1 });
    store.lastRatedAtMs.set(1, now - 100 * day);
    store.lastRatedAtMs.set(2, now - 100 * day);
    store.lastRatedAtMs.set(3, now - 800 * day);
    store.publications.set("tournament_publication.t1", {
      internalId: 10, publicationStatus: "published", publishedAtMs: 1,
      races: [raceOneTwo],
    });
    const service = makeService(store, now);
    const result = await service.applyPublication("tournament_publication.t1");

    const before = { mu: 30, sigma: 1 };
    const expected = decayRating(before, 800);
    expect(store.ratings.get(3)!.mu).toBeCloseTo(expected.mu, 12);
    expect(store.ratings.get(3)!.sigma).toBeCloseTo(expected.sigma, 12);
    // The two who raced are within the grace year, so only their race moved
    // them - nothing was faded out from under them.
    expect(store.ratings.get(1)!.mu).not.toBe(30);
    // Fading is not a rating event; there was no race.
    expect(store.events.some((e) => e.playerInternalId === 3)).toBe(false);
    // But the fade is persisted, so the standing shows it.
    expect(result.ratedPlayers).toBe(3);
  });

  it("leaves everybody alone while they are inside the grace year", async () => {
    const day = 86_400_000;
    const now = 1_000 * day;
    const store = emptyStore();
    store.ratings.set(3, { mu: 30, sigma: 1 });
    store.lastRatedAtMs.set(3, now - 300 * day);
    store.publications.set("tournament_publication.t1", {
      internalId: 10, publicationStatus: "published", publishedAtMs: 1,
      races: [raceOneTwo],
    });
    const service = makeService(store, now);
    const result = await service.applyPublication("tournament_publication.t1");
    expect(store.ratings.get(3)).toEqual({ mu: 30, sigma: 1 });
    expect(result.ratedPlayers).toBe(2);
  });

  it("applies published races per race through the engine in member order", async () => {
    const store = emptyStore();
    store.publications.set("tournament_publication.t1", {
      internalId: 10,
      publicationStatus: "published",
      publishedAtMs: 1,
      races: [
        raceOneTwo,
        {
          revisionInternalId: 901,
          placements: [
            { playerInternalId: 2, finishPosition: 1 },
            { playerInternalId: 1, finishPosition: 2 },
          ],
        },
      ],
    });
    const service = makeService(store);
    const result = await service.applyPublication("tournament_publication.t1");
    expect(result).toMatchObject({
      appliedRaces: 2,
      skippedRaces: 0,
      ratedPlayers: 2,
      epoch: 0,
      alreadyApplied: false,
    });

    // independent expectation via the engine directly
    const [w1, l1] = rateFreeForAllRace(
      [initialRating(), initialRating()], [1, 2], MEASURED_RATING_PARAMETERS);
    const [l2, w2] = rateFreeForAllRace(
      [w1!, l1!], [2, 1], MEASURED_RATING_PARAMETERS);
    expect(store.ratings.get(1)!.mu).toBeCloseTo(l2!.mu, 12);
    expect(store.ratings.get(2)!.mu).toBeCloseTo(w2!.mu, 12);
    expect(store.events.filter((e) => e.eventType === "race_result"))
      .toHaveLength(4);
    expect(store.events.map((e) => e.sequenceNumber)).toEqual([1, 1, 2, 2]);
  });

  it("skips unrateable races and is idempotent per epoch", async () => {
    const store = emptyStore();
    store.publications.set("tournament_publication.t1", {
      internalId: 10,
      publicationStatus: "published",
      publishedAtMs: 1,
      races: [
        raceOneTwo,
        {
          revisionInternalId: 901,
          placements: [
            { playerInternalId: 1, finishPosition: 1 },
            { playerInternalId: null, finishPosition: 2 },
          ],
        },
        {
          revisionInternalId: 902,
          placements: [{ playerInternalId: 1, finishPosition: 1 }],
        },
      ],
    });
    const service = makeService(store);
    const first = await service.applyPublication("tournament_publication.t1");
    expect(first).toMatchObject({ appliedRaces: 1, skippedRaces: 2 });
    const second = await service.applyPublication("tournament_publication.t1");
    expect(second.alreadyApplied).toBe(true);
    expect(store.events.filter((e) => e.eventType === "race_result"))
      .toHaveLength(2);
  });

  it("refuses unpublished and decision-excluded publications", async () => {
    const store = emptyStore();
    store.publications.set("tournament_publication.retracted", {
      internalId: 11,
      publicationStatus: "retracted",
      publishedAtMs: 1,
      races: [raceOneTwo],
    });
    store.publications.set("tournament_publication.excluded", {
      internalId: 12,
      publicationStatus: "published",
      publishedAtMs: 2,
      races: [raceOneTwo],
    });
    store.decisions.push({
      publicationInternalId: 12,
      sequenceNumber: 1,
      ratingIncluded: false,
      reasonCode: "not_counted",
    });
    const service = makeService(store);
    await expect(service.applyPublication("tournament_publication.retracted"))
      .rejects.toMatchObject({ code: "conflict" });
    await expect(service.applyPublication("tournament_publication.excluded"))
      .rejects.toMatchObject({ code: "conflict" });
    await expect(service.applyPublication("tournament_publication.absent"))
      .rejects.toMatchObject({ code: "not_found" });
  });

  it("records append-only decisions and requires an administrator", async () => {
    const store = emptyStore();
    store.publications.set("tournament_publication.t1", {
      internalId: 10,
      publicationStatus: "published",
      publishedAtMs: 1,
      races: [raceOneTwo],
    });
    const service = makeService(store);
    await service.recordDecision({
      administratorAccountId: "user_account.admin",
      publicationPublicId: "tournament_publication.t1",
      ratingIncluded: false,
      reasonCode: "exhibition_only",
    });
    await service.recordDecision({
      administratorAccountId: "user_account.admin",
      publicationPublicId: "tournament_publication.t1",
      ratingIncluded: true,
      reasonCode: "counts_again",
    });
    expect(store.decisions.map((d) => [d.sequenceNumber, d.ratingIncluded]))
      .toEqual([[1, false], [2, true]]);
    await expect(service.recordDecision({
      administratorAccountId: "user_account.stranger",
      publicationPublicId: "tournament_publication.t1",
      ratingIncluded: false,
      reasonCode: "nope",
    })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("recalculates a full epoch from the seed baseline honoring exclusions", async () => {
    const store = emptyStore();
    store.seedBaseline = [
      { playerInternalId: 1, mu: 29.0, sigma: 0.62,
        sourceReference: "mariokart8.nl#seed" },
    ];
    // player 3 only ever appeared in the excluded tournament
    store.ratings.set(3, { mu: 27, sigma: 5 });
    store.publications.set("tournament_publication.counted", {
      internalId: 20,
      publicationStatus: "published",
      publishedAtMs: 10,
      races: [raceOneTwo],
    });
    store.publications.set("tournament_publication.excluded", {
      internalId: 21,
      publicationStatus: "published",
      publishedAtMs: 20,
      races: [{
        revisionInternalId: 950,
        placements: [
          { playerInternalId: 3, finishPosition: 1 },
          { playerInternalId: 1, finishPosition: 2 },
        ],
      }],
    });
    store.decisions.push({
      publicationInternalId: 21,
      sequenceNumber: 1,
      ratingIncluded: false,
      reasonCode: "excluded",
    });
    const service = makeService(store);
    const result = await service.recalculate({
      administratorAccountId: "user_account.admin",
      reasonCode: "tournament_excluded",
    });
    expect(result).toMatchObject({
      epoch: 1,
      includedPublications: 1,
      appliedRaces: 1,
      skippedRaces: 0,
      ratedPlayers: 2,
    });
    // player 3's rating disappeared with its excluded tournament
    expect(store.ratings.has(3)).toBe(false);
    // player 1 restarted from the seed baseline, player 2 from initial
    const [w, l] = rateFreeForAllRace(
      [{ mu: 29.0, sigma: 0.62 }, initialRating()], [1, 2],
      MEASURED_RATING_PARAMETERS);
    expect(store.ratings.get(1)!.mu).toBeCloseTo(w!.mu, 12);
    expect(store.ratings.get(2)!.mu).toBeCloseTo(l!.mu, 12);
    // epoch 1 events: seed replay + one race
    const epochOne = store.events.filter((e) => e.epoch === 1);
    expect(epochOne.map((e) => e.eventType).sort())
      .toEqual(["race_result", "race_result", "seed_import"]);
    expect(store.recalculations[0]).toMatchObject({
      appliedRaces: 1,
      includedPublications: 1,
    });
    expect(store.ratings.get(2)!.mu).toBeLessThan(RATING_INITIAL_MU);
  });
});
