import { describe, expect, it } from "vitest";

import {
  HISTORY_EDITION_NUMBERS,
  buildHistoryEdition,
  historyEditionId,
  historyEditionNumber,
  historyEditionSeeds,
  historyEditionSummary,
} from "../src/tournaments/history-edition-projection.js";

const players = new Map([
  [1, { playerId: "player.gideon", displayName: "Gideon", isPublic: true }],
  [2, { playerId: "player.evan", displayName: "Evan", isPublic: true }],
  [3, { playerId: "player.nova", displayName: "Nova", isPublic: false }],
  [4, { playerId: "player.ben", displayName: "Ben", isPublic: true }],
]);

const input = {
  editionNumber: 12,
  eventDate: "2026-03-27",
  heldAtMs: 1774569600000,
  sections: [
    { id: 20, stage: "final", sequence: 1, tierKey: "champion", displayName: "Kampioen" },
    { id: 10, stage: "qualifier", sequence: 1, tierKey: null, displayName: "Kwalificatie Groep 1" },
  ],
  races: [
    { id: 100, sectionId: 10, raceIndex: 1, countsTowardRating: true, trackId: null },
    { id: 101, sectionId: 10, raceIndex: 2, countsTowardRating: false, trackId: "track.mario_kart_stadium" },
    { id: 200, sectionId: 20, raceIndex: 1, countsTowardRating: true, trackId: null },
  ],
  placements: [
    { raceId: 100, playerInternalId: 1, finishPosition: 1 },
    { raceId: 100, playerInternalId: 2, finishPosition: 2 },
    { raceId: 100, playerInternalId: 3, finishPosition: 3 },
    { raceId: 100, playerInternalId: 4, finishPosition: 4 },
    { raceId: 101, playerInternalId: 4, finishPosition: 1 },
    { raceId: 101, playerInternalId: 1, finishPosition: 2 },
    { raceId: 101, playerInternalId: 2, finishPosition: 3 },
    { raceId: 101, playerInternalId: 3, finishPosition: 4 },
    { raceId: 200, playerInternalId: 2, finishPosition: 1 },
    { raceId: 200, playerInternalId: 1, finishPosition: 2 },
  ],
  players,
  characters: new Map([
    ["10:1", "character.yoshi"], ["10:2", "character.tanooki_mario"],
    // The final group recorded nothing for Gideon; the night did.
    ["1", "character.yoshi"],
  ]),
  seeds: historyEditionSeeds([
    { playerInternalId: 2, score: 28.4 }, { playerInternalId: 1, score: 31.257 }, { playerInternalId: 4, score: 12 },
  ]),
} as const;

const edition = buildHistoryEdition(input);

describe("the community's past editions, projected as public events", () => {
  it("carries the character each Player drove, from the recorded history", () => {
    const qualifier = edition.groups[0]!;
    expect(qualifier.standings.map((row) => [row.displayName, row.character?.label ?? null])).toEqual([
      ["Gideon", "Yoshi"], ["Evan", "Tanooki Mario"], ["Nova", null], ["Ben", null],
    ]);
    expect(qualifier.standings[0]!.character?.key).toBe("character.yoshi");
    expect(qualifier.seating[0]).toMatchObject({ displayName: "Gideon", character: { key: "character.yoshi" } });
  });

  it("falls back to the character of the same night when a group recorded none", () => {
    // Gideon's final group has no character of its own; the night has one.
    const final = edition.groups.find((group) => group.stage === "final")!;
    expect(final.standings.find((row) => row.displayName === "Gideon")?.character?.key).toBe("character.yoshi");
    expect(final.standings.find((row) => row.displayName === "Nova")?.character).toBeUndefined();
  });

  it("carries the SP rank each Player held when the night started, and none for a newcomer", () => {
    const qualifier = edition.groups[0]!;
    expect(qualifier.standings.map((row) => [row.displayName, row.seedRank ?? null, row.seedScore ?? null])).toEqual([
      ["Gideon", 1, 31.26], ["Evan", 2, 28.4], ["Nova", null, null], ["Ben", 3, 12],
    ]);
    expect(qualifier.seating[0]).toMatchObject({ displayName: "Gideon", seedRank: 1 });
  });

  it("names the edition, its id and its date, and never invents a track", () => {
    expect(historyEditionId(12)).toBe("tournament.history-tn12");
    expect(historyEditionNumber("tournament.history-tn12")).toBe(12);
    expect(historyEditionNumber("tournament.11ce5a0d-4154-4d18-a779-1b2051b59409")).toBeNull();
    expect(edition).toMatchObject({
      schemaVersion: "mk8dx.public-tournament-event.v1",
      tournamentId: "tournament.history-tn12",
      name: "Toernooi 12",
      editionNumber: 12,
      eventDate: "2026-03-27",
      stage: "finalized",
      finalizedAtMs: 1774569600000,
      publicResults: true,
      participantCount: 4,
    });
    const qualifier = edition.groups[0]!;
    expect(qualifier.races[0]).not.toHaveProperty("trackId");
    expect(qualifier.races[1]!.trackId).toBe("track.mario_kart_stadium");
  });

  it("orders qualifiers before finals, scores races on the history's table and skips races that do not count", () => {
    expect(edition.groups.map((group) => [group.stage, group.name, group.tierKey])).toEqual([
      ["qualifier", "Kwalificatie Groep 1", undefined],
      ["final", "Kampioen", "champion"],
    ]);
    const qualifier = edition.groups[0]!;
    // A race scores on its own size: these are four-Player races, not twelve.
    expect(qualifier.races[0]!.placements.map((placement) => placement.racePoints)).toEqual([4, 3, 2, 1]);
    expect(qualifier.races[1]!.countsTowardStandings).toBe(false);
    expect(qualifier.standings.map((row) => [row.rank, row.displayName, row.points, row.races, row.wins])).toEqual([
      [1, "Gideon", 4, 2, 1],
      [2, "Evan", 3, 2, 0],
      [3, "Nova", 2, 2, 0],
      [4, "Ben", 1, 2, 0],
    ]);
  });

  it("takes the points the record itself kept over any table", () => {
    // The corrected history stores what a finish actually scored; a night that
    // raced with ten Players is not the twelve-Player table.
    const recorded = buildHistoryEdition({
      ...input,
      placements: input.placements.map((placement) => placement.raceId === 100
        ? { ...placement, racePoints: 12 - placement.finishPosition }
        : { ...placement }),
    });
    expect(recorded.groups[0]!.races[0]!.placements.map((placement) => placement.racePoints)).toEqual([11, 10, 9, 8]);
  });

  it("keeps a private Player nameable but never identifiable", () => {
    const qualifier = edition.groups[0]!;
    const nova = qualifier.standings.find((row) => row.displayName === "Nova")!;
    expect(nova).not.toHaveProperty("playerId");
    expect(qualifier.standings.find((row) => row.displayName === "Gideon")!.playerId).toBe("player.gideon");
  });

  it("seats the members in finishing order, two to a console, the first of each pair the owner", () => {
    const qualifier = edition.groups[0]!;
    expect(qualifier.seating.map((seat) => [seat.seatOrder, seat.displayName, seat.stationOwnerDisplayName, seat.switchType, seat.seatNumber])).toEqual([
      [1, "Gideon", "Gideon", "ns1", 1],
      [2, "Evan", "Gideon", "ns1", 2],
      [3, "Nova", "Nova", "ns1", 1],
      [4, "Ben", "Nova", "ns1", 2],
    ]);
  });

  it("reads the overall result from the final groups, top to bottom", () => {
    expect(edition.overall.map((row) => [row.placement, row.displayName, row.groupName, row.groupRank, row.points])).toEqual([
      // Two Players raced this final, so the pair scored 2 and 1.
      [1, "Evan", "Kampioen", 1, 2],
      [2, "Gideon", "Kampioen", 2, 1],
    ]);
  });

  it("summarises an edition for the list with the night it was held as its clock", () => {
    expect(historyEditionSummary({ editionNumber: 7, eventDate: "2024-05-31", heldAtMs: 1717113600000, participantCount: 24 })).toEqual({
      tournamentId: "tournament.history-tn7",
      name: "Toernooi 7",
      editionNumber: 7,
      eventDate: "2024-05-31",
      stage: "finalized",
      finalizedAtMs: 1717113600000,
      participantCount: 24,
      updatedAtMs: 1717113600000,
    });
  });
});

describe("the first editions the community reported per round", () => {
  it("publishes TN4 and projects its two poules without a character in sight", () => {
    expect(HISTORY_EDITION_NUMBERS).toContain(4);
    for (const number of HISTORY_EDITION_NUMBERS) {
      expect(historyEditionNumber(historyEditionId(number))).toBe(number);
    }
    // TN4's night was two final groups of eight; nobody wrote down a
    // character, and the tracks came later from the community's own reports.
    const tn4 = buildHistoryEdition({
      editionNumber: 4,
      eventDate: "2023-05-19",
      heldAtMs: 1684454400000,
      sections: [
        { id: 1, stage: "final", sequence: 1, tierKey: "winners", displayName: "Winnaarspoule" },
        { id: 2, stage: "final", sequence: 2, tierKey: "losers", displayName: "Verliezerspoule" },
      ],
      races: [
        { id: 1, sectionId: 1, raceIndex: 1, countsTowardRating: true, trackId: "track.wii_moo_moo_meadows" },
        { id: 2, sectionId: 2, raceIndex: 1, countsTowardRating: true, trackId: "track.dolphin_shoals" },
      ],
      placements: [
        { raceId: 1, playerInternalId: 2, finishPosition: 1 },
        { raceId: 1, playerInternalId: 1, finishPosition: 2 },
        { raceId: 2, playerInternalId: 4, finishPosition: 1 },
        { raceId: 2, playerInternalId: 3, finishPosition: 2 },
      ],
      players,
      // Nothing was recorded and nothing is invented.
      seeds: historyEditionSeeds([]),
    });
    expect(tn4.groups.map((group) => [group.name, group.tierKey])).toEqual([
      ["Winnaarspoule", "winners"], ["Verliezerspoule", "losers"],
    ]);
    expect(tn4.groups[0]!.races[0]!.trackId).toBe("track.wii_moo_moo_meadows");
    expect(tn4.groups.flatMap((group) => group.standings).every((row) =>
      row.character === undefined && row.seedRank === undefined)).toBe(true);
    // Both groups are finals, so the overall result reads them in order.
    expect(tn4.overall.map((row) => row.displayName)).toEqual(["Evan", "Gideon", "Ben", "Nova"]);
  });
});
