import { describe, expect, it } from "vitest";

import {
  CORRECTIONS_ARTIFACT_KIND,
  HistoryBuildError,
  applyOrderCorrection,
  buildHistory,
  parseSectionLabel,
  type CorrectionsDocument,
  type LegacyRaceRow,
} from "../src/tournament-history/history-corrections.js";

function legacyRace(
  sectionLabel: string,
  raceIndex: number,
  order: readonly number[],
): LegacyRaceRow {
  return {
    tournamentNumber: 11,
    sectionLabel,
    raceIndex,
    placements: order.map((playerId, offset) => ({
      playerId, finishPosition: offset + 1, scoreAfter: "25.00",
    })),
  };
}

function document(
  overrides: Partial<CorrectionsDocument> = {},
): CorrectionsDocument {
  return {
    artifactKind: CORRECTIONS_ARTIFACT_KIND,
    producerVersion: "test",
    raceOrderCorrections: [],
    races: [],
    identityLinks: [],
    ...overrides,
  };
}

describe("parseSectionLabel", () => {
  it("reads both namings of a qualification group as the same group", () => {
    const letter = parseSectionLabel(8, "TN8: Poule C", 12);
    const numbered = parseSectionLabel(12, "TN12: Kwalificatie Groep 3", 12);
    expect(letter.stage).toBe("qualifier");
    expect(letter.sequenceNumber).toBe(3);
    expect(letter.displayName).toBe("Kwalificatie Groep 3");
    expect(numbered.sequenceNumber).toBe(letter.sequenceNumber);
    expect(numbered.displayName).toBe(letter.displayName);
  });

  it("reads both namings of a final division as the same division", () => {
    const ordinal = parseSectionLabel(9, "TN9: 2e Divisie", 12);
    const named = parseSectionLabel(12, "TN12: Talent", 12);
    expect(ordinal.stage).toBe("final");
    expect(ordinal.tierKey).toBe("talent");
    expect(ordinal.displayName).toBe("Talent");
    expect(named.tierKey).toBe(ordinal.tierKey);
    expect(named.sequenceNumber).toBe(ordinal.sequenceNumber);
  });

  it("keeps the names TN4 and TN5 actually used", () => {
    // Those two ran one winners' pool and one losers' pool, with no
    // qualification round. They are finals, but calling a Winnaarspoule
    // "Kampioen" would assert an equivalence with the later three-division
    // format that nobody established.
    const winners = parseSectionLabel(4, "TN4: Winnaarspoule", 12);
    expect(winners.stage).toBe("final");
    expect(winners.sequenceNumber).toBe(1);
    expect(winners.displayName).toBe("Winnaarspoule");
    expect(winners.tierKey).toBe("winners");
    const losers = parseSectionLabel(5, "TN5: Verliezerspoule", 12);
    expect(losers.sequenceNumber).toBe(2);
    expect(losers.displayName).toBe("Verliezerspoule");
  });

  it("refuses a label it does not recognise rather than guessing", () => {
    expect(() => parseSectionLabel(4, "TN4: Ronde 1", 12))
      .toThrow(HistoryBuildError);
  });
});

describe("applyOrderCorrection", () => {
  it("moves the race that was played first to the front", () => {
    const moved = applyOrderCorrection([1, 2, 3, 4, 5], 5, 1);
    expect(moved.get(5)).toBe(1);
    expect(moved.get(1)).toBe(2);
    expect(moved.get(4)).toBe(5);
  });

  it("leaves the rest of the order intact when moving inwards", () => {
    const moved = applyOrderCorrection([1, 2, 3, 4], 1, 3);
    expect([...moved.entries()].sort()).toEqual([[1, 3], [2, 1], [3, 2], [4, 4]]);
  });

  it("refuses to move a race the section does not have", () => {
    expect(() => applyOrderCorrection([1, 2, 3], 9, 1))
      .toThrow(HistoryBuildError);
  });
});

describe("buildHistory", () => {
  const poule = [
    legacyRace("TN11: Poule B", 1, [10, 20]),
    legacyRace("TN11: Poule B", 2, [20, 10]),
    legacyRace("TN11: Poule B", 3, [10, 20]),
  ];

  it("renumbers a section around the race that was played first", () => {
    const built = buildHistory(poule, document({
      raceOrderCorrections: [{
        tournamentNumber: 11, legacySectionLabel: "TN11: Poule B",
        legacyRaceIndex: 3, raceIndex: 1, reason: "played first",
      }],
    }));
    expect(built.map((race) => [race.raceIndex, race.legacyRaceIndex]))
      .toEqual([[1, 3], [2, 1], [3, 2]]);
    // Renumbering must not renumber anybody's results.
    const first = built.find((race) => race.legacyRaceIndex === 3)!;
    expect(first.placements.map((p) => p.playerId)).toEqual([10, 20]);
  });

  it("inserts a recovered race and pushes the later legacy races up", () => {
    const built = buildHistory(poule, document({
      races: [{
        tournamentNumber: 11, legacySectionLabel: "TN11: Poule B",
        raceIndex: 2, legacyRaceIndex: null, origin: "video_recovered",
        countsTowardRating: true, exclusionReason: null,
        trackId: "track.baby_park", evidence: null,
        placements: [
          {
            finishPosition: 1, playerId: 20, observedName: "Bloomie",
            characterId: "character.waluigi", racePoints: 15,
            totalAfterRace: 15, rankAfterRace: 1,
          },
          {
            finishPosition: 2, playerId: 10, observedName: "Soudler",
            characterId: null, racePoints: 12, totalAfterRace: 12,
            rankAfterRace: 2,
          },
        ],
      }],
    }));
    expect(built.map((race) => [race.raceIndex, race.legacyRaceIndex]))
      .toEqual([[1, 1], [2, null], [3, 2], [4, 3]]);
    expect(built[1]!.origin).toBe("video_recovered");
    expect(built[1]!.trackId).toBe("track.baby_park");
  });

  it("carries observed detail onto a legacy race without touching its order", () => {
    const built = buildHistory([legacyRace("TN11: Poule B", 1, [10, 20])],
      document({
        races: [{
          tournamentNumber: 11, legacySectionLabel: "TN11: Poule B",
          raceIndex: 1, legacyRaceIndex: 1, origin: "legacy",
          countsTowardRating: true, exclusionReason: null,
          trackId: "track.rainbow_road", evidence: null,
          // The recording read the pair the other way round. The rated history
          // decides who finished where; the recording only says what was on
          // screen.
          placements: [
            {
              finishPosition: 1, playerId: 20, observedName: "Wanda",
              characterId: "character.yoshi", racePoints: 15,
              totalAfterRace: 15, rankAfterRace: 1,
            },
            {
              finishPosition: 2, playerId: 10, observedName: "Tobias",
              characterId: "character.mario", racePoints: 12,
              totalAfterRace: 12, rankAfterRace: 2,
            },
          ],
        }],
      }));
    const [race] = built;
    expect(race!.placements.map((p) => [p.playerId, p.finishPosition]))
      .toEqual([[10, 1], [20, 2]]);
    expect(race!.placements[0]!.observedPlayerName).toBe("Tobias");
    expect(race!.placements[0]!.characterId).toBe("character.mario");
    expect(race!.placements[0]!.legacyScoreAfter).toBe("25.00");
  });

  it("numbers races globally with qualification before finals", () => {
    const built = buildHistory([
      legacyRace("TN11: 1e Divisie", 1, [10, 20]),
      legacyRace("TN11: Poule B", 1, [10, 20]),
      legacyRace("TN11: Poule A", 1, [10, 20]),
    ], document());
    expect(built.map((race) => [
      race.section.displayName, race.raceSequence,
    ])).toEqual([
      ["Kwalificatie Groep 1", 1],
      ["Kwalificatie Groep 2", 2],
      ["Kampioen", 3],
    ]);
  });

  it("refuses a recovered race with a seat nobody is linked to", () => {
    expect(() => buildHistory(poule, document({
      races: [{
        tournamentNumber: 11, legacySectionLabel: "TN11: Poule B",
        raceIndex: 4, legacyRaceIndex: null, origin: "video_recovered",
        countsTowardRating: true, exclusionReason: null, trackId: null,
        evidence: null,
        placements: [{
          finishPosition: 1, playerId: null, observedName: "Player",
          characterId: null, racePoints: 15, totalAfterRace: 15,
          rankAfterRace: 1,
        }],
      }],
    }))).toThrow(/every seat is identified/);
  });

  it("refuses an unexpected corrections artifact", () => {
    expect(() => buildHistory(poule, document({ artifactKind: "something.else" })))
      .toThrow(HistoryBuildError);
  });

  it("keeps a race that does not score, with its reason", () => {
    const built = buildHistory([legacyRace("TN11: Poule B", 1, [10, 20])],
      document({
        races: [{
          tournamentNumber: 11, legacySectionLabel: "TN11: Poule B",
          raceIndex: 1, legacyRaceIndex: 1, origin: "legacy",
          countsTowardRating: false, exclusionReason: "field of 10 in a group of 12",
          trackId: null, evidence: null, placements: [],
        }],
      }));
    expect(built[0]!.countsTowardRating).toBe(false);
    expect(built[0]!.exclusionReason).toContain("group of 12");
  });
});
