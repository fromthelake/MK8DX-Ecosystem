import { describe, expect, it } from "vitest";

import {
  scoreCandidateNames,
  scoreConfidencePercent,
  scoreMatchLabel,
  scoreNameKey,
  scoreSimilarity,
  suggestScoreMapping,
} from "../src/tournament-score-matching.js";

/**
 * Step 5 and Step 9 map names out of a spreadsheet onto Players. Getting that
 * wrong writes one racer's night onto another racer's record, and it is the one
 * form in the product that had no test at all. These pin the behaviour the
 * original Manager had, including the thresholds the badges are tuned to.
 */
describe("matching workbook names onto Players", () => {
  it("folds case and whitespace the way a typed name arrives", () => {
    expect(scoreNameKey("  Ben   van der  Berg ")).toBe("ben van der berg");
    expect(scoreNameKey("BEN")).toBe(scoreNameKey("ben"));
  });

  it("scores exact, prefix, containment and overlap on the tuned scale", () => {
    expect(scoreSimilarity("Ben", "ben")).toBe(1);
    expect(scoreSimilarity("Ben", "Bentiaan")).toBe(0.93);
    expect(scoreSimilarity("van der Berg", "der")).toBe(0.89);
    expect(scoreSimilarity("Ben Berg", "Berg Jansen")).toBeCloseTo(1 / 3, 5);
    expect(scoreSimilarity("", "Ben")).toBe(0);
  });

  it("offers every name a Player answers to, display name first and no repeats", () => {
    expect(scoreCandidateNames("Ben", ["Bensie", "ben", "  "])).toEqual([
      { name: "Ben", viaAlias: false },
      { name: "Bensie", viaAlias: true },
    ]);
  });

  it("names each degree of certainty, and says when a human decided", () => {
    expect(scoreMatchLabel(1, false, false).tone).toBe("settled");
    expect(scoreMatchLabel(0.95, false, false).tone).toBe("strong");
    expect(scoreMatchLabel(0.8, false, false).tone).toBe("likely");
    expect(scoreMatchLabel(0.4, false, false).tone).toBe("attention");
    expect(scoreMatchLabel(null, false, false).tone).toBe("attention");
    // An alias hit is a settled fact about the Player, not a guess.
    expect(scoreMatchLabel(0.5, true, false).tone).toBe("settled");
    // A hand-made link outranks everything, including no confidence at all.
    expect(scoreMatchLabel(null, false, true)).toEqual({
      label: "Matched by hand", tone: "settled",
    });
    expect(scoreMatchLabel(1, false, false).label).toBe("Exact match");
  });

  it("shows the similarity as a whole percentage, and nothing when unknown", () => {
    expect(scoreConfidencePercent(0.937)).toBe("93% similar");
    expect(scoreConfidencePercent(null)).toBeNull();
  });

  const targets = [
    { playerId: "player.ben", displayName: "Ben", aliases: ["Bensie"] },
    { playerId: "player.nova", displayName: "Nova", aliases: [] },
    { playerId: "player.valerio", displayName: "Valerio", aliases: ["V"] },
  ];

  it("maps each row to one Player and never reuses a Player", () => {
    const suggestions = suggestScoreMapping(
      [
        { playerName: "ben", totalPoints: 40 },
        { playerName: "Nova", totalPoints: 38 },
        { playerName: "Valerio", totalPoints: 30 },
      ],
      targets,
    );
    expect(suggestions.map((row) => row.playerId))
      .toEqual(["player.ben", "player.nova", "player.valerio"]);
    expect(new Set(suggestions.map((row) => row.playerId)).size).toBe(3);
  });

  it("matches through an alias and says which name did it", () => {
    const [suggestion] = suggestScoreMapping(
      [{ playerName: "Bensie", totalPoints: 40 }], targets,
    );
    expect(suggestion).toMatchObject({
      playerId: "player.ben", viaAlias: true, matchedName: "Bensie",
    });
  });

  it("leaves a name it cannot place unmatched rather than guessing", () => {
    const [suggestion] = suggestScoreMapping(
      [{ playerName: "Zzzzz", totalPoints: 12 }], targets,
    );
    expect(suggestion?.playerId).toBeNull();
    expect(suggestion?.confidence).toBeNull();
  });

  it("gives a contested name to its best claimant and leaves the other unmatched", () => {
    const suggestions = suggestScoreMapping(
      [
        { playerName: "Ben", totalPoints: 40 },
        { playerName: "Ben", totalPoints: 20 },
      ],
      [{ playerId: "player.ben", displayName: "Ben", aliases: [] }],
    );
    const matched = suggestions.filter((row) => row.playerId !== null);
    expect(matched).toHaveLength(1);
    expect(suggestions.filter((row) => row.playerId === null)).toHaveLength(1);
  });

  it("prefers a display name over an alias at the same strength", () => {
    const [suggestion] = suggestScoreMapping(
      [{ playerName: "V", totalPoints: 10 }],
      [
        { playerId: "player.v", displayName: "V", aliases: [] },
        { playerId: "player.valerio", displayName: "Valerio", aliases: ["V"] },
      ],
    );
    expect(suggestion).toMatchObject({ playerId: "player.v", viaAlias: false });
  });

  it("returns one suggestion per workbook row, in the workbook's order", () => {
    const rows = [
      { playerName: "Nova", totalPoints: 1 },
      { playerName: "Ben", totalPoints: 2 },
      { playerName: "unknown", totalPoints: 3 },
    ];
    const suggestions = suggestScoreMapping(rows, targets);
    expect(suggestions).toHaveLength(3);
    expect(suggestions.map((row) => row.workbookName))
      .toEqual(["Nova", "Ben", "unknown"]);
  });
});
