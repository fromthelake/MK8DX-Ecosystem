import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  SubmissionFeedbackService,
  computeSubmissionFeedback,
  type SubmissionFeedbackCompetitor,
} from "../src/timetrials/submission-feedback.js";

const field: readonly SubmissionFeedbackCompetitor[] = [
  { playerId: "player.evan", username: "evan", displayName: "Evan", bestMs: 100_000 },
  { playerId: "player.nova", username: "nova", displayName: "Nova", bestMs: 101_000 },
  { playerId: "player.matteo", username: "matteo", displayName: "Matteo", bestMs: 102_000 },
  { playerId: "player.valerio", username: "valerio", displayName: "Valerio", bestMs: 103_000 },
];

describe("submission feedback arithmetic", () => {
  it("names a first time on a combo as an improvement with no delta and no one passed", () => {
    const feedback = computeSubmissionFeedback(
      { trackId: "track.water_park", modeCc: 150, totalTimeMs: 101_500, previousBestMs: null },
      field,
      new Set(),
    );
    expect(feedback.personalBest).toEqual({ previousBestMs: null, deltaMs: null, improved: true });
    expect(feedback.rank).toEqual({
      after: 3, before: null, passed: [], passedCount: 0, rivalsPassed: 0,
    });
  });

  it("reports the improvement, the rank movement and whom it passed, rivals first", () => {
    const feedback = computeSubmissionFeedback(
      { trackId: "track.water_park", modeCc: 150, totalTimeMs: 100_500, previousBestMs: 103_500 },
      field,
      new Set(["player.matteo"]),
    );
    expect(feedback.personalBest).toEqual({
      previousBestMs: 103_500, deltaMs: -3_000, improved: true,
    });
    expect(feedback.rank.before).toBe(5);
    expect(feedback.rank.after).toBe(2);
    expect(feedback.rank.passed.map((entry) => `${entry.username}:${entry.rival}`))
      .toEqual(["matteo:true", "nova:false", "valerio:false"]);
    expect(feedback.rank.passedCount).toBe(3);
    expect(feedback.rank.rivalsPassed).toBe(1);
  });

  it("keeps the old best and rank when the new time is slower", () => {
    const feedback = computeSubmissionFeedback(
      { trackId: "track.water_park", modeCc: 200, totalTimeMs: 104_000, previousBestMs: 100_500 },
      field,
      new Set(["player.evan"]),
    );
    expect(feedback.personalBest).toEqual({
      previousBestMs: 100_500, deltaMs: 3_500, improved: false,
    });
    expect(feedback.rank).toEqual({
      after: 2, before: 2, passed: [], passedCount: 0, rivalsPassed: 0,
    });
  });

  it("promotes an equal-time enriched run without counting anybody as passed", () => {
    const feedback = computeSubmissionFeedback(
      { trackId: "track.water_park", modeCc: 150, totalTimeMs: 101_000, previousBestMs: 101_000 },
      field,
      new Set(),
    );
    expect(feedback.personalBest.improved).toBe(true);
    expect(feedback.personalBest.deltaMs).toBe(0);
    expect(feedback.rank.after).toBe(2);
    expect(feedback.rank.passed).toEqual([]);
  });

  it("caps the named list at five and still counts everybody", () => {
    const crowd = Array.from({ length: 9 }, (_, index) => ({
      playerId: `player.p${index}`, username: `p${index}`, displayName: `P${index}`,
      bestMs: 100_100 + index * 100,
    }));
    const feedback = computeSubmissionFeedback(
      { trackId: "track.water_park", modeCc: 150, totalTimeMs: 100_000, previousBestMs: 120_000 },
      crowd,
      new Set(),
    );
    expect(feedback.rank.passed).toHaveLength(5);
    expect(feedback.rank.passedCount).toBe(9);
    expect(feedback.rank.after).toBe(1);
    expect(feedback.rank.before).toBe(10);
  });
});

describe("SubmissionFeedbackService", () => {
  it("answers null for an unpublished submission and skips rivals without an account", async () => {
    const calls: string[] = [];
    const service = new SubmissionFeedbackService({
      async findSubject(id) {
        calls.push(`subject:${id}`);
        return id === "user_submission.time.known"
          ? { trackId: "track.water_park", modeCc: 150, totalTimeMs: 100_000,
              previousBestMs: null, playerInternalId: 7 }
          : null;
      },
      async listCompetitors() { calls.push("competitors"); return field; },
      async listRivalPlayerIds() { calls.push("rivals"); return ["player.evan"]; },
      async listLaps() { calls.push("laps"); return []; },
    });
    expect(await service.forSubmission("user_submission.time.missing", null)).toBeNull();
    const feedback = await service.forSubmission("user_submission.time.known", null);
    expect(feedback?.rank.after).toBe(1);
    expect(calls).toEqual([
      "subject:user_submission.time.missing",
      "subject:user_submission.time.known",
      "competitors",
    ]);
  });
});

describe("SubmissionFeedbackService v2", () => {
  it("adds the previous best's laps only when asked for v2 and a previous best exists", async () => {
    const service = new SubmissionFeedbackService({
      async findSubject() {
        return { trackId: "track.water_park", modeCc: 150, totalTimeMs: 100_000,
          previousBestMs: 101_000, previousBestRevisionInternalId: 42, playerInternalId: 7 };
      },
      async listCompetitors() { return field; },
      async listRivalPlayerIds() { return []; },
      async listLaps(revisionInternalId) {
        expect(revisionInternalId).toBe(42);
        return [{ lapNumber: 1, timeMs: 33_000 }, { lapNumber: 2, timeMs: 34_000 }, { lapNumber: 3, timeMs: 34_000 }];
      },
    });
    const v1 = await service.forSubmission("user_submission.time.known", "user_account.ben");
    expect(v1?.personalBest).toEqual({ previousBestMs: 101_000, deltaMs: -1_000, improved: true });
    const v2 = await service.forSubmission("user_submission.time.known", "user_account.ben", "v2");
    expect(v2?.personalBest.previousLaps).toEqual([
      { lapNumber: 1, timeMs: 33_000 }, { lapNumber: 2, timeMs: 34_000 }, { lapNumber: 3, timeMs: 34_000 },
    ]);
  });
});

// POST_A_TIME_ARCHITECTURE §5: the web's Post-a-Time panel predicts the outcome before publication
// with a port of the pure function above, over the leaderboard the track page already loaded. The
// two run the same case file, so "the prediction matches the feedback" is a checked fact. The web
// half is apps/timetrials-web/test/post-time-prediction.test.ts.
const predictionFixture = JSON.parse(readFileSync(
  new URL("../../../tooling/design-system/fixtures/prediction-cases.json", import.meta.url),
  "utf8",
)) as Readonly<{
  cases: readonly Readonly<{
    id: string;
    subject: Readonly<{ totalTimeMs: number; previousBestMs: number | null }>;
    competitors: readonly SubmissionFeedbackCompetitor[];
    rivals: readonly string[];
    expect: Readonly<{
      improved: boolean; deltaMs: number | null;
      rankAfter: number; rankBefore: number | null;
      passedCount: number; rivalsPassed: number; passed: readonly string[];
    }>;
  }>[];
}>;

describe("the client prediction and the server feedback agree (T-PAT-DIRECT)", () => {
  for (const testCase of predictionFixture.cases) {
    it(`answers ${testCase.id} the way the task predicts it`, () => {
      const feedback = computeSubmissionFeedback(
        {
          trackId: "track.water_park",
          modeCc: 150,
          totalTimeMs: testCase.subject.totalTimeMs,
          previousBestMs: testCase.subject.previousBestMs,
        },
        testCase.competitors,
        new Set(testCase.rivals),
      );
      expect(feedback.personalBest.improved).toBe(testCase.expect.improved);
      expect(feedback.personalBest.deltaMs).toBe(testCase.expect.deltaMs);
      expect(feedback.rank.after).toBe(testCase.expect.rankAfter);
      expect(feedback.rank.before).toBe(testCase.expect.rankBefore);
      expect(feedback.rank.passedCount).toBe(testCase.expect.passedCount);
      expect(feedback.rank.rivalsPassed).toBe(testCase.expect.rivalsPassed);
      expect(feedback.rank.passed.map((player) => player.playerId))
        .toEqual(testCase.expect.passed);
    });
  }
});
