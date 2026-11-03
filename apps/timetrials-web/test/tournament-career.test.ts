import { describe, expect, it } from "vitest";

import {
  sectionPlacement,
  toughestOpponent,
  tournamentCareer,
  tournamentChampions,
  tournamentOverallPlacement,
  type SectionStandings,
} from "../src/tournament-career.js";
import type { RatingHistoryPoint } from "../src/rating-graph.js";

const point = (
  sequence: number,
  tournamentNumber: number,
  section: string,
  finishPosition: number,
): RatingHistoryPoint => ({
  sequence,
  tournamentNumber,
  sectionLabel: `TN${tournamentNumber}: ${section}`,
  raceIndex: sequence,
  finishPosition,
  score: 20,
});

describe("tournament career", () => {
  it("aggregates wins, podiums and the final section per tournament", () => {
    const career = tournamentCareer([
      point(1, 6, "Poule A", 1),
      point(2, 6, "Poule A", 4),
      point(3, 6, "1e Divisie", 2),
      point(4, 6, "1e Divisie", 3),
      point(5, 7, "Poule B", 1),
      point(6, 7, "2e Divisie", 7),
    ])!;
    expect(career.tournaments).toEqual([
      {
        tournamentNumber: 6,
        finalSection: "1e Divisie",
        races: 4,
        wins: 1,
        podiums: 3,
        averageFinish: 2.5,
      },
      {
        tournamentNumber: 7,
        finalSection: "2e Divisie",
        races: 2,
        wins: 1,
        podiums: 1,
        averageFinish: 4,
      },
    ]);
    expect(career.totals).toEqual({
      tournaments: 2,
      races: 6,
      wins: 2,
      podiums: 4,
      averageFinish: 3,
    });
    // No history means no career block, never a fabricated zero row.
    expect(tournamentCareer([])).toBeNull();
  });

  it("picks the toughest opponent deterministically", () => {
    const opponents = [
      { playerId: "player.floyd", displayName: "Floyd",
        sharedRaces: 20, aheadOfMe: 2, meAhead: 18 },
      { playerId: "player.matteo", displayName: "Matteo",
        sharedRaces: 118, aheadOfMe: 61, meAhead: 55 },
      { playerId: "player.lex", displayName: "Lex",
        sharedRaces: 40, aheadOfMe: 61, meAhead: 30 },
    ];
    // Equal ahead counts: more shared races is the tougher rivalry.
    expect(toughestOpponent(opponents)?.playerId).toBe("player.matteo");
    expect(toughestOpponent([])).toBeNull();
  });

  it("derives final placements and champions from section standings", () => {
    const sections: SectionStandings[] = [
      {
        tournamentNumber: 12,
        sectionLabel: "TN12: Kampioen",
        standings: [
          { playerId: "player.gideon", displayName: "Gideon",
            points: 300, races: 32 },
          { playerId: "player.matteo", displayName: "Matteo",
            points: 282, races: 32 },
          { playerId: "player.ben", displayName: "Ben",
            points: 256, races: 32 },
        ],
      },
      {
        tournamentNumber: 12,
        sectionLabel: "TN12: Talent",
        standings: [
          { playerId: "player.wilbur", displayName: "Wilbur",
            points: 282, races: 32 },
        ],
      },
      {
        tournamentNumber: 8,
        sectionLabel: "TN8: 1e Divisie",
        standings: [
          { playerId: "player.evan", displayName: "Evan",
            points: 290, races: 32 },
          // Tied points share the position (RANK semantics).
          { playerId: "player.ben", displayName: "Ben",
            points: 250, races: 32 },
          { playerId: "player.lex", displayName: "Lex",
            points: 250, races: 32 },
        ],
      },
    ];
    expect(sectionPlacement(sections[0]!, "player.ben")).toEqual({
      position: 3, points: 256, participants: 3,
    });
    expect(sectionPlacement(sections[2]!, "player.lex")?.position).toBe(2);
    expect(sectionPlacement(sections[2]!, "player.ben")?.position).toBe(2);
    expect(sectionPlacement(sections[0]!, "player.ghost")).toBeNull();
    // Champions: the top section per tournament (Kampioen beats Talent;
    // 1e Divisie is the top of its era).
    expect(tournamentChampions(sections)).toEqual([
      {
        tournamentNumber: 8,
        sectionLabel: "TN8: 1e Divisie",
        playerId: "player.evan",
        displayName: "Evan",
        points: 290,
      },
      {
        tournamentNumber: 12,
        sectionLabel: "TN12: Kampioen",
        playerId: "player.gideon",
        displayName: "Gideon",
        points: 300,
      },
    ]);
  });

  it("computes the OVERALL tournament placement across divisions", () => {
    const sections: SectionStandings[] = [
      {
        tournamentNumber: 6,
        // Non-full championship division: eleven players, so the
        // second division starts at overall position 12.
        sectionLabel: "TN6: 1e Divisie",
        standings: Array.from({ length: 11 }, (_, index) => ({
          playerId: `player.a${index}`,
          displayName: `A${index}`,
          points: 300 - index,
          races: 30,
        })),
      },
      {
        tournamentNumber: 6,
        sectionLabel: "TN6: 2e Divisie",
        standings: [
          { playerId: "player.ben", displayName: "Ben",
            points: 200, races: 30 },
          { playerId: "player.lex", displayName: "Lex",
            points: 150, races: 30 },
        ],
      },
      {
        // Qualification groups never count toward the overall result.
        tournamentNumber: 6,
        sectionLabel: "TN6: Poule A",
        standings: [
          { playerId: "player.ben", displayName: "Ben",
            points: 90, races: 6 },
        ],
      },
    ];
    expect(tournamentOverallPlacement(sections, 6, "player.ben")).toEqual({
      position: 12,
      of: 13,
      points: 200,
      sectionName: "2e Divisie",
    });
    expect(tournamentOverallPlacement(sections, 6, "player.a0"))
      .toEqual({
        position: 1,
        of: 13,
        points: 300,
        sectionName: "1e Divisie",
      });
    // A player only seen in qualification has no overall placement.
    expect(tournamentOverallPlacement(sections, 6, "player.ghost"))
      .toBeNull();
  });
});
