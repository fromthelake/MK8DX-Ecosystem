import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  predictFromBoard, predictSubmission, PREDICTION_BOARD_LIMIT,
} from "../src/post-time-prediction.js";

// T-PAT-DIRECT: "the prediction matches the server feedback after publish". The task's panel is a
// port of the server's pure computeSubmissionFeedback, so both are run over one case file
// (backend/api/test/submission-feedback.test.ts runs the other half).
const fixture = JSON.parse(readFileSync(
  new URL("../../../tooling/design-system/fixtures/prediction-cases.json", import.meta.url),
  "utf8",
)) as Readonly<{
  cases: readonly Readonly<{
    id: string;
    subject: Readonly<{ totalTimeMs: number; previousBestMs: number | null }>;
    competitors: readonly Readonly<{
      playerId: string; username: string; displayName: string; bestMs: number;
    }>[];
    rivals: readonly string[];
    expect: Readonly<{
      improved: boolean; deltaMs: number | null;
      rankAfter: number; rankBefore: number | null;
      passedCount: number; rivalsPassed: number; passed: readonly string[];
    }>;
  }>[];
}>;

describe("the Post-a-Time prediction is the server's arithmetic, run on the client", () => {
  for (const testCase of fixture.cases) {
    it(`agrees with the server on ${testCase.id}`, () => {
      const prediction = predictSubmission(
        testCase.subject, testCase.competitors, new Set(testCase.rivals), true,
      );
      expect(prediction.personalBest.improved).toBe(testCase.expect.improved);
      expect(prediction.personalBest.deltaMs).toBe(testCase.expect.deltaMs);
      expect(prediction.rank.after).toBe(testCase.expect.rankAfter);
      expect(prediction.rank.before).toBe(testCase.expect.rankBefore);
      expect(prediction.rank.passedCount).toBe(testCase.expect.passedCount);
      expect(prediction.rank.rivalsPassed).toBe(testCase.expect.rivalsPassed);
      expect(prediction.rank.passed.map((player) => player.playerId))
        .toEqual(testCase.expect.passed);
    });
  }

  it("says 'outside the top 100' rather than inventing a rank the board cannot show", () => {
    // A full board is the top 100; a time slower than its slowest row has no honest number.
    const rows = Array.from({ length: PREDICTION_BOARD_LIMIT }, (_value, index) => ({
      playerId: `player.p${index}`,
      playerUsername: `p${index}`,
      playerDisplayName: `P${index}`,
      totalTimeMs: 100_000 + index * 100,
    }));
    const outside = predictFromBoard(300_000, {
      rows, ownPlayerId: "player.me", ownBestMs: null, rivalPlayerIds: new Set(),
    });
    expect(outside.rank.exact).toBe(false);
    expect(outside.rank.after).toBeNull();

    const inside = predictFromBoard(100_050, {
      rows, ownPlayerId: "player.me", ownBestMs: null, rivalPlayerIds: new Set(),
    });
    expect(inside.rank.exact).toBe(true);
    expect(inside.rank.after).toBe(2);
  });

  it("names the neighbour ahead and behind with an exact gap, and counts the field", () => {
    const rows = [
      { playerId: "player.evan", playerUsername: "evan", playerDisplayName: "Evan", totalTimeMs: 104_500 },
      { playerId: "player.nova", playerUsername: "nova", playerDisplayName: "Nova", totalTimeMs: 106_400 },
      { playerId: "player.me", playerUsername: "ben", playerDisplayName: "Ben", totalTimeMs: 109_000 },
    ];
    const prediction = predictFromBoard(105_000, {
      rows, ownPlayerId: "player.me", ownBestMs: null, rivalPlayerIds: new Set(["player.nova"]),
    });
    // The Player's own row leaves the field, exactly as the server excludes the submitter.
    expect(prediction.field).toEqual({ count: 3, complete: true });
    expect(prediction.personalBest.previousBestMs).toBe(109_000);
    expect(prediction.ahead?.displayName).toBe("Evan");
    expect(prediction.ahead?.gapMs).toBe(500);
    expect(prediction.behind?.displayName).toBe("Nova");
    expect(prediction.behind?.gapMs).toBe(-1_400);
    expect(prediction.behind?.rival).toBe(true);
  });

  it("reads the Player's own best from the board, or from track-bests when they are not on it", () => {
    const rows = [
      { playerId: "player.evan", playerUsername: "evan", playerDisplayName: "Evan", totalTimeMs: 104_500 },
    ];
    const offBoard = predictFromBoard(105_000, {
      rows, ownPlayerId: "player.me", ownBestMs: 111_000, rivalPlayerIds: new Set(),
    });
    expect(offBoard.personalBest.previousBestMs).toBe(111_000);
    expect(offBoard.personalBest.improved).toBe(true);
  });
});
