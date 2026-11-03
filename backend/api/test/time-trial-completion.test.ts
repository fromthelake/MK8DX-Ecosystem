// ADR-0210 rule 10: a later reading of the same run fills in only what a result is missing.
import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  TimeTrialCompletionError,
  planCompletion,
  validateTimeTrialCompletion,
  type CurrentLap,
  type CurrentLoadout,
  type TimeTrialCompletionV1,
} from "../src/timetrials/completion-service.js";
import { registerTimeTrialCompletionRoutes } from "../src/timetrials/completion-routes.js";

const empty: CurrentLoadout = {
  characterId: null, characterVariantId: null, bodyId: null, bodyVariantId: null,
  tireId: null, gliderId: null, gliderVariantId: null,
};
const scanned: CurrentLoadout = {
  ...empty, characterId: "character.inkling_boy", bodyId: "body.buggybud",
  tireId: "tire.azure_roller", gliderId: "glider.cloud_glider",
};
const lapsWithoutCounts: readonly CurrentLap[] = [
  { lapNumber: 1, timeMs: 26_381, coinsCollected: null, mushroomsUsed: null },
  { lapNumber: 2, timeMs: 25_209, coinsCollected: null, mushroomsUsed: null },
  { lapNumber: 3, timeMs: 25_285, coinsCollected: null, mushroomsUsed: null },
];
const ghostLaps = [
  { lapNumber: 1, timeMs: 26_381, coinsCollected: 5, mushroomsUsed: 1 },
  { lapNumber: 2, timeMs: 25_209, coinsCollected: 3, mushroomsUsed: 1 },
  { lapNumber: 3, timeMs: 25_285, coinsCollected: 2, mushroomsUsed: 1 },
];

function completion(overrides: Partial<TimeTrialCompletionV1> = {}): TimeTrialCompletionV1 {
  return {
    schemaVersion: "mk8dx.time-trial-completion.v1",
    expectedRevision: 1,
    trackId: "track.mario_kart_stadium",
    mode: 200,
    totalTimeMs: 76_875,
    laps: ghostLaps,
    loadout: {
      characterId: "character.inkling_boy", bodyId: "body.buggybud",
      bodyVariantId: "body_variant.buggybud.000_blue", tireId: "tire.azure_roller",
      gliderId: "glider.cloud_glider",
    },
    source: { kind: "livetrial_capture", producerVersion: "3.25.0" },
    evidence: [{ kind: "capture_session", reference: `livetrial/${"a".repeat(64)}` }],
    ...overrides,
  };
}

const code = (work: () => unknown): string => {
  try { work(); } catch (error) {
    if (error instanceof TimeTrialCompletionError) { return error.code; }
    throw error;
  }
  return "none";
};

describe("the fill rule", () => {
  it("fills empty lap counts and the colour variant, and nothing else", () => {
    const plan = planCompletion({ loadout: scanned, laps: lapsWithoutCounts }, completion());
    expect(plan.completedFields).toEqual(["coinsCollected", "mushroomsUsed", "bodyVariant"]);
    expect(plan.laps.map((lap) => [lap.coinsCollected, lap.mushroomsUsed])).toEqual([[5, 1], [3, 1], [2, 1]]);
    expect(plan.loadout).toEqual({ ...scanned, bodyVariantId: "body_variant.buggybud.000_blue" });
  });

  it("adds the laps and the combo to a result that had neither", () => {
    const plan = planCompletion({ loadout: empty, laps: [] }, completion());
    expect(plan.completedFields).toEqual([
      "laps", "coinsCollected", "mushroomsUsed", "character", "body", "bodyVariant", "tire", "glider",
    ]);
    expect(plan.laps).toHaveLength(3);
  });

  it("never replaces a stored value: a different one means a different run", () => {
    expect(code(() => planCompletion({ loadout: scanned, laps: lapsWithoutCounts }, completion({
      loadout: { characterId: "character.mario" },
    })))).toBe("different_result");
    expect(code(() => planCompletion({ loadout: scanned, laps: lapsWithoutCounts }, completion({
      laps: [{ ...ghostLaps[0]!, timeMs: 26_380 }, { ...ghostLaps[1]!, timeMs: 25_210 }, ghostLaps[2]!],
    })))).toBe("different_result");
    const counted = lapsWithoutCounts.map((lap) => ({ ...lap, coinsCollected: 4 }));
    expect(code(() => planCompletion({ loadout: scanned, laps: counted }, completion()))).toBe("different_result");
  });

  it("says so when there is nothing left to fill", () => {
    const full = ghostLaps.map((lap) => ({ ...lap }));
    const complete = { ...scanned, bodyVariantId: "body_variant.buggybud.000_blue" };
    expect(code(() => planCompletion({ loadout: complete, laps: full }, completion()))).toBe("nothing_missing");
  });

  it("does not attach a variant to another base part", () => {
    const plan = planCompletion(
      { loadout: { ...scanned, bodyId: "body.pipe_frame" }, laps: lapsWithoutCounts },
      completion({ loadout: { bodyVariantId: "body_variant.buggybud.000_blue", bodyId: "body.pipe_frame" } }),
    );
    expect(plan.loadout.bodyVariantId).toBeNull();
    expect(plan.completedFields).not.toContain("bodyVariant");
  });
});

describe("completion documents", () => {
  it("accepts a LiveTrial reading with one reference", () => {
    expect(() => validateTimeTrialCompletion(completion())).not.toThrow();
  });

  it.each([
    ["a web source", completion({ source: { kind: "web_manual" } as never })],
    ["no evidence", completion({ evidence: [] })],
    ["a screenshot as evidence", completion({ evidence: [{ kind: "screenshot", reference: "x" }] })],
    ["laps that do not add up", completion({ totalTimeMs: 76_876 })],
    ["neither laps nor loadout", (() => {
      const { laps: _laps, loadout: _loadout, ...rest } = completion();
      return rest as TimeTrialCompletionV1;
    })()],
    ["an unknown key", { ...completion(), note: "x" } as TimeTrialCompletionV1],
  ])("refuses %s", (_name, document) => {
    expect(code(() => validateTimeTrialCompletion(document))).toBe("invalid_completion");
  });
});

describe("the completion route", () => {
  const mount = async (role: "account" | "anonymous") => {
    const app = Fastify();
    const calls: unknown[] = [];
    await registerTimeTrialCompletionRoutes(app, {
      resolveActor: async () => role === "account"
        ? { role: "account", userAccountId: "user_account.one" }
        : { role: "anonymous" },
      service: {
        async complete(_actor, submissionId, body) {
          calls.push(body);
          if ((body as { expectedRevision?: number }).expectedRevision === 9) {
            throw new TimeTrialCompletionError("nothing_missing", "done");
          }
          return { submissionId, revision: 2, completedFields: ["coinsCollected"] };
        },
      },
    });
    return { app, calls };
  };
  const url = "/v1/time-trial-submissions/user_submission.time.ABCDEF01/completions";
  const bearer = { authorization: `Bearer ${"t".repeat(40)}` };

  it("completes for a signed-in native client", async () => {
    const { app } = await mount("account");
    const response = await app.inject({ method: "POST", url, headers: bearer, payload: completion() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schemaVersion: "mk8dx.time-trial-completion-result.v1",
      submissionId: "user_submission.time.ABCDEF01", revision: 2, completedFields: ["coinsCollected"],
    });
  });

  it("refuses a browser session without the native credential", async () => {
    const { app, calls } = await mount("account");
    const response = await app.inject({ method: "POST", url, payload: completion() });
    expect(response.statusCode).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("asks an anonymous caller to sign in", async () => {
    const { app } = await mount("anonymous");
    expect((await app.inject({ method: "POST", url, headers: bearer, payload: completion() })).statusCode).toBe(401);
  });

  it("answers 409 with a code the client can act on", async () => {
    const { app } = await mount("account");
    const response = await app.inject({
      method: "POST", url, headers: bearer, payload: completion({ expectedRevision: 9 }),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("time_trial_completion_nothing_missing");
  });
});
