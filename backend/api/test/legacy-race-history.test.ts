import { describe, expect, it } from "vitest";

import {
  buildLegacyRaces,
  verifyReplay,
  type LegacyHistoryDocument,
} from "../src/rating/legacy-race-history.js";
import {
  conservativeScore,
  initialRating,
  rateFreeForAllRace,
} from "../src/rating/trueskill-engine.js";

const mapping = [
  { legacyPlayerId: 1, playerId: "player.ben" },
  { legacyPlayerId: 2, playerId: "player.floyd" },
];

function displayScore(position: number, opponent: number): number {
  const updated = rateFreeForAllRace(
    [initialRating(), initialRating()], [position, opponent]);
  return Math.round(conservativeScore(updated[0]!) * 100) / 100;
}

describe("legacy race history import core", () => {
  it("orders races canonically and groups placements", () => {
    const history: LegacyHistoryDocument = {
      artifactKind: "mk8dx.private-mariokart8nl-race-history.v2",
      perPlayer: {
        "1": [
          // Finals section listed first: qualification must still sort
          // ahead of it inside the tournament.
          { section: "TN6: 1e Divisie", raceIndex: 1, position: 2,
            scoreAfter: 0 },
          { section: "TN6: Poule A", raceIndex: 1, position: 1,
            scoreAfter: 0 },
          { section: "TN4: Winnaarspoule", raceIndex: 2, position: 1,
            scoreAfter: 0 },
          { section: "TN4: Winnaarspoule", raceIndex: 1, position: 2,
            scoreAfter: 0 },
        ],
        "2": [
          { section: "TN4: Winnaarspoule", raceIndex: 1, position: 1,
            scoreAfter: 0 },
        ],
      },
    };
    const races = buildLegacyRaces(history, mapping);
    expect(races.map((race) =>
      `${race.sectionLabel}#${race.raceIndex}`)).toEqual([
      "TN4: Winnaarspoule#1",
      "TN4: Winnaarspoule#2",
      "TN6: Poule A#1",
      "TN6: 1e Divisie#1",
    ]);
    expect(races.map((race) => race.raceSequence)).toEqual([1, 2, 3, 4]);
    // Both players share the first race, positions grouped correctly.
    expect(races[0]!.placements).toEqual([
      { playerId: "player.floyd", finishPosition: 1, scoreAfter: 0 },
      { playerId: "player.ben", finishPosition: 2, scoreAfter: 0 },
    ]);
  });

  it("refuses unmapped players and duplicate finish positions", () => {
    expect(() => buildLegacyRaces({
      artifactKind: "mk8dx.private-mariokart8nl-race-history.v2",
      perPlayer: { "99": [{ section: "TN4: Winnaarspoule", raceIndex: 1,
        position: 1, scoreAfter: 0 }] },
    }, mapping)).toThrow(/no canonical mapping/);
    expect(() => buildLegacyRaces({
      artifactKind: "mk8dx.private-mariokart8nl-race-history.v2",
      perPlayer: {
        "1": [{ section: "TN4: Winnaarspoule", raceIndex: 1, position: 3,
          scoreAfter: 0 }],
        "2": [{ section: "TN4: Winnaarspoule", raceIndex: 1, position: 3,
          scoreAfter: 0 }],
      },
    }, mapping)).toThrow(/duplicate finish position/);
  });

  it("verifies the trajectory against the canonical engine", () => {
    const winner = displayScore(1, 2);
    const loser = displayScore(2, 1);
    const good = verifyReplay(buildLegacyRaces({
      artifactKind: "mk8dx.private-mariokart8nl-race-history.v2",
      perPlayer: {
        "1": [{ section: "TN4: Winnaarspoule", raceIndex: 1, position: 1,
          scoreAfter: winner }],
        "2": [{ section: "TN4: Winnaarspoule", raceIndex: 1, position: 2,
          scoreAfter: loser }],
      },
    }, mapping));
    expect(good.races).toBe(1);
    expect(good.observations).toBe(2);
    expect(good.trajectoryMismatches).toBe(0);
    // A corrupted recorded score is detected.
    const bad = verifyReplay(buildLegacyRaces({
      artifactKind: "mk8dx.private-mariokart8nl-race-history.v2",
      perPlayer: {
        "1": [{ section: "TN4: Winnaarspoule", raceIndex: 1, position: 1,
          scoreAfter: winner + 1 }],
        "2": [{ section: "TN4: Winnaarspoule", raceIndex: 1, position: 2,
          scoreAfter: loser }],
      },
    }, mapping));
    expect(bad.trajectoryMismatches).toBe(1);
  });
});
