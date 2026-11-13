// ADR-0225 amendment (2026-11-12 late): the same carried time twice. An original already accepted is
// refused (409 carried_duplicate); a carried time equal to an active run of the same Player fills only
// that run's empty fields (200 mk8dx.carried-fill.v1) or answers 409 carried_nothing_to_fill. The
// MySQL side (revision, publication kept, audit, unique original) is in
// time-trial-lifecycle.integration.test.ts.

import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  TimeTrialSubmissionError,
  TimeTrialSubmissionService,
  planCarriedFill,
  type CarriedTimesPolicy,
  type TimeTrialCarriedFillPlan,
  type TimeTrialCarriedOriginal,
  type TimeTrialEqualRun,
  type TimeTrialRevisionPersistenceInput,
  type TimeTrialSubmissionV1,
  type TimeTrialWriteTransaction,
} from "../src/timetrials/submission-service.js";
import { registerTimeTrialSubmissionRoutes } from "../src/timetrials/submission-routes.js";

const ORIGIN = "https://club.example.org";
const PLAYER = "player.synthetic_fill_01";
const ACCOUNT = "user_account.synthetic_fill_01";
const EXISTING = "user_submission.time.SYNTHETICEXISTING01";

function carried(
  overrides: Partial<TimeTrialSubmissionV1> = {},
  originalSubmissionId: string | null = "user_submission.time.SYNTHETICORIGIN01",
): TimeTrialSubmissionV1 {
  return {
    schemaVersion: "mk8dx.time-trial-submission.v1",
    submissionId: "user_submission.time.SYNTHETICCARRIEDFILL1",
    revision: 1,
    mode: 150,
    trackId: "track.mario_kart_stadium",
    totalTimeMs: 90_000,
    laps: [
      { lapNumber: 1, timeMs: 30_000, coinsCollected: 4, mushroomsUsed: 1 },
      { lapNumber: 2, timeMs: 30_000, coinsCollected: 8, mushroomsUsed: 1 },
      { lapNumber: 3, timeMs: 30_000, coinsCollected: 10, mushroomsUsed: 1 },
    ],
    loadout: {
      characterId: "character.yoshi",
      characterVariantId: "character_variant.yoshi.018_black",
      bodyId: "body.mr_scooty",
      tireId: "tire.roller",
      gliderId: "glider.cloud_glider",
    },
    playerReference: { namespace: "player", value: PLAYER },
    source: { kind: "android_manual" },
    timestamps: { occurredAtMs: 1_786_900_000_000, createdAtMs: 1_786_990_000_000 },
    carriedFrom: {
      origin: ORIGIN,
      ...(originalSubmissionId === null ? {} : { originalSubmissionId }),
      originalSubmittedAtMs: 1_786_900_060_000,
    },
    ...overrides,
  };
}

const bare: TimeTrialEqualRun = { submissionId: EXISTING, revision: 1, loadout: {}, laps: [] };

describe("which empty fields a carried equal time fills", () => {
  it("fills every empty part and the whole lap list of a run that has none", () => {
    const plan = planCarriedFill(bare, carried());
    expect(plan.filledFields).toEqual(["characterId", "characterVariantId", "bodyId", "tireId", "gliderId", "laps"]);
    expect(plan.loadout).toEqual(carried().loadout);
    expect(plan.laps).toEqual(carried().laps);
  });

  it("never overwrites a present value, and fills a colour only for the same character", () => {
    const plan = planCarriedFill({
      ...bare,
      loadout: { characterId: "character.mario", bodyId: "body.standard_kart", tireId: "tire.standard" },
    }, carried());
    expect(plan.filledFields).toEqual(["gliderId", "laps"]);
    expect(plan.loadout).toEqual({
      characterId: "character.mario", bodyId: "body.standard_kart", tireId: "tire.standard",
      gliderId: "glider.cloud_glider",
    });
    const sameCharacter = planCarriedFill({ ...bare, loadout: { characterId: "character.yoshi" } }, carried());
    expect(sameCharacter.filledFields).toContain("characterVariantId");
    expect(sameCharacter.filledFields).not.toContain("characterId");
  });

  it("fills a lap's missing coins and mushrooms only when the lap times are the same", () => {
    const existingLaps = [
      { lapNumber: 1, timeMs: 30_000, coinsCollected: 3 },
      { lapNumber: 2, timeMs: 30_000 },
      { lapNumber: 3, timeMs: 30_000, mushroomsUsed: 0 },
    ];
    const plan = planCarriedFill({ ...bare, loadout: carried().loadout!, laps: existingLaps }, carried());
    expect(plan.filledFields).toEqual(["coins", "mushrooms"]);
    expect(plan.laps).toEqual([
      { lapNumber: 1, timeMs: 30_000, coinsCollected: 3, mushroomsUsed: 1 },
      { lapNumber: 2, timeMs: 30_000, coinsCollected: 8, mushroomsUsed: 1 },
      { lapNumber: 3, timeMs: 30_000, mushroomsUsed: 0, coinsCollected: 10 },
    ]);
    const otherSplits = planCarriedFill({
      ...bare, loadout: carried().loadout!,
      laps: [{ lapNumber: 1, timeMs: 29_000 }, { lapNumber: 2, timeMs: 31_000 }, { lapNumber: 3, timeMs: 30_000 }],
    }, carried());
    expect(otherSplits.filledFields).toEqual([]);
  });

  it("leaves mushrooms out when filling them would make more than three in the race", () => {
    const plan = planCarriedFill({
      ...bare, loadout: carried().loadout!,
      laps: [
        { lapNumber: 1, timeMs: 30_000, coinsCollected: 1, mushroomsUsed: 3 },
        { lapNumber: 2, timeMs: 30_000, coinsCollected: 1 },
        { lapNumber: 3, timeMs: 30_000, coinsCollected: 1 },
      ],
    }, carried());
    expect(plan.filledFields).toEqual([]);
  });

  it("has nothing to fill when the run already records everything", () => {
    const full = { ...bare, loadout: carried().loadout!, laps: carried().laps };
    expect(planCarriedFill(full, carried()).filledFields).toEqual([]);
  });
});

function harness(policy: CarriedTimesPolicy, store: Readonly<{
  taken?: string | null;
  equal?: TimeTrialEqualRun | null;
  raceOnRecord?: boolean;
}> = {}) {
  const written: TimeTrialRevisionPersistenceInput[] = [];
  const recorded: [TimeTrialCarriedOriginal, string][] = [];
  const looked: TimeTrialCarriedOriginal[] = [];
  const fills: Readonly<{ run: TimeTrialEqualRun; plan: TimeTrialCarriedFillPlan; original: TimeTrialCarriedOriginal; actorUserAccountId: string }>[] = [];
  const transaction: TimeTrialWriteTransaction = {
    async findSubmissionForUpdate() { return null; },
    async findActiveHumanPlayerForUpdate() { return true; },
    async insertSubmission() {},
    async insertRevision(input) { written.push(input); },
    async findCarriedOriginal(original) { looked.push(original); return store.taken ?? null; },
    async recordCarriedRun(original, submissionId) {
      if (store.raceOnRecord === true) {
        throw new TimeTrialSubmissionError("carried_duplicate", "This time was already carried here.");
      }
      recorded.push([original, submissionId]);
    },
    async findEqualActiveRunForUpdate() { return store.equal ?? null; },
    async fillEqualRun(input) { fills.push(input); return input.run.revision + 1; },
  };
  const service = new TimeTrialSubmissionService(
    { transaction: async (work) => work(transaction) },
    { async validateReferences() { return []; } },
    {
      async protectParticipantReference() { throw new Error("unused"); },
      async protectEvidenceReference() { throw new Error("unused"); },
    },
    undefined,
    { policy: async () => policy, ownOrigins: ["https://times.example.net"] },
  );
  return { service, written, recorded, looked, fills };
}

const context = { publicationIntent: "trusted_runtime" as const, actorUserAccountId: ACCOUNT };

describe("the same carried time twice (ADR-0225 amendment)", () => {
  it("refuses an original that was already accepted, as a run or a fill", async () => {
    const { service, written, looked } = harness("allowed", { taken: EXISTING });
    await expect(service.submit(carried(), context)).rejects.toMatchObject({ code: "carried_duplicate" });
    expect(written).toHaveLength(0);
    expect(looked).toEqual([{ origin: ORIGIN, originalSubmissionId: "user_submission.time.SYNTHETICORIGIN01" }]);
  });

  it("does not match a carried time without an original id, and records an accepted one", async () => {
    const without = harness("allowed", { taken: EXISTING });
    await without.service.submit(carried({}, null), context);
    expect(without.looked).toHaveLength(0);
    expect(without.written).toHaveLength(1);
    const accepted = harness("allowed");
    await accepted.service.submit(carried({ carriedFrom: {
      origin: "https://club.example.org:443", originalSubmissionId: "user_submission.time.SYNTHETICORIGIN01",
      originalSubmittedAtMs: 1,
    } }), context);
    // The origin is recorded normalised, so ":443" is the same community.
    expect(accepted.recorded).toEqual([[
      { origin: ORIGIN, originalSubmissionId: "user_submission.time.SYNTHETICORIGIN01" },
      "user_submission.time.SYNTHETICCARRIEDFILL1",
    ]]);
  });

  it("answers carried_duplicate when the same original was recorded meanwhile", async () => {
    const { service } = harness("allowed", { raceOnRecord: true });
    await expect(service.submit(carried(), context)).rejects.toMatchObject({ code: "carried_duplicate" });
  });

  it("fills the empty fields of an equal run instead of creating a second one, also under review", async () => {
    for (const policy of ["allowed", "review"] as const) {
      const { service, written, fills } = harness(policy, { equal: bare });
      const result = await service.submit(carried(), context);
      expect(result).toEqual({
        submissionId: EXISTING, revision: 2,
        carriedFill: { filledFields: ["characterId", "characterVariantId", "bodyId", "tireId", "gliderId", "laps"] },
      });
      expect(written).toHaveLength(0);
      expect(fills[0]).toMatchObject({
        run: bare, actorUserAccountId: ACCOUNT,
        original: { origin: ORIGIN, originalSubmissionId: "user_submission.time.SYNTHETICORIGIN01" },
      });
    }
  });

  it("answers carried_nothing_to_fill when the equal run records everything", async () => {
    const { service, fills } = harness("allowed", {
      equal: { ...bare, loadout: carried().loadout!, laps: carried().laps },
    });
    await expect(service.submit(carried(), context)).rejects.toMatchObject({ code: "carried_nothing_to_fill" });
    expect(fills).toHaveLength(0);
  });

  it("still refuses everything while carried times are off", async () => {
    const { service, fills, written } = harness("off", { equal: bare });
    await expect(service.submit(carried(), context)).rejects.toMatchObject({ code: "carried_times_disabled" });
    expect(fills).toHaveLength(0);
    expect(written).toHaveLength(0);
  });
});

describe("the same carried time twice over HTTP", () => {
  async function app(store: Parameters<typeof harness>[1]) {
    const server = Fastify();
    await registerTimeTrialSubmissionRoutes(server, {
      resolveActor: async () => ({ role: "account", userAccountId: ACCOUNT }),
      authorizer: { async authorize() { return true; } },
      service: harness("allowed", store).service,
    });
    return server;
  }

  it("answers 200 mk8dx.carried-fill.v1 with the filled fields", async () => {
    const server = await app({ equal: bare });
    const response = await server.inject({ method: "POST", url: "/v1/time-trial-submissions", payload: carried() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schemaVersion: "mk8dx.carried-fill.v1",
      submissionId: EXISTING,
      filledFields: ["characterId", "characterVariantId", "bodyId", "tireId", "gliderId", "laps"],
    });
  });

  it("answers 409 carried_duplicate and 409 carried_nothing_to_fill", async () => {
    const duplicate = await (await app({ taken: EXISTING }))
      .inject({ method: "POST", url: "/v1/time-trial-submissions", payload: carried() });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe("carried_duplicate");
    const nothing = await (await app({ equal: { ...bare, loadout: carried().loadout!, laps: carried().laps } }))
      .inject({ method: "POST", url: "/v1/time-trial-submissions", payload: carried() });
    expect(nothing.statusCode).toBe(409);
    expect(nothing.json().code).toBe("carried_nothing_to_fill");
  });
});
