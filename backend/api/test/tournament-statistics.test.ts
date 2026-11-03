import { describe, expect, it } from "vitest";

import {
  assembleFromPlacements,
  assembleTournamentStatistics,
  canonicalRaceSequence,
  excludedSectionsClause,
  EXCLUDED_HISTORY_SECTIONS,
  replayTrackSkill,
  trackSkillFromPlacements,
} from "../src/tournaments/tournament-statistics.js";

/**
 * What the community has raced, counted over every finished night. The SQL
 * needs the corrected history and a database; what it means once counted does
 * not, and that is what this holds.
 */
describe("the community's own numbers", () => {
  const editions = [
    { editionNumber: 6, eventDate: "2024-01-26", heldAtMs: 1_706_000_000_000, participantCount: 23, races: 88, cumulativePlayers: 31 },
    { editionNumber: 4, eventDate: "2023-05-19", heldAtMs: 1_684_000_000_000, participantCount: 16, races: 46, cumulativePlayers: 16 },
  ];
  const tracks = [
    { trackId: "track.baby_park", races: 4, placements: 48, nights: 2, firstEdition: 4, lastEdition: 6 },
    { trackId: "track.mario_kart_stadium", races: 12, placements: 140, nights: 3, firstEdition: 4, lastEdition: 6 },
  ];

  it("reads the editions oldest first, because that is a growth curve", () => {
    const answer = assembleTournamentStatistics(editions, tracks, 31);
    expect(answer.editions.map((edition) => edition.editionNumber)).toEqual([4, 6]);
    expect(answer.editions.map((edition) => edition.participantCount)).toEqual([16, 23]);
  });

  it("reads the tracks most-raced first, because that is the question", () => {
    const answer = assembleTournamentStatistics(editions, tracks, 31);
    expect(answer.tracks.map((track) => track.trackId))
      .toEqual(["track.mario_kart_stadium", "track.baby_park"]);
  });

  it("counts the races the nights took and the ones a track is known for", () => {
    // 46 + 88 races were driven; 16 of them are named here. A race whose
    // track was never written down still happened, so the totals keep it and
    // the per-track rows do not invent one.
    const answer = assembleTournamentStatistics(editions, tracks, 31);
    expect(answer.totals).toEqual({
      editions: 2,
      races: 134,
      racesWithTrack: 16,
      placements: 188,
      players: 31,
      tracksRaced: 2,
    });
  });

  it("answers an empty history without inventing a night", () => {
    expect(assembleTournamentStatistics([], [], 0)).toEqual({
      editions: [], tracks: [],
      totals: { editions: 0, races: 0, racesWithTrack: 0, placements: 0, players: 0, tracksRaced: 0 },
    });
  });
});

/**
 * One track's own rating. The same engine and the same measured parameters
 * the site's Score uses, over that track's races alone, everybody from zero.
 */
describe("a track's own TrueSkill", () => {
  const race = (raceKey: number, order: readonly string[]) =>
    order.map((playerId, index) => ({
      raceKey,
      playerId,
      displayName: playerId.replace("player.", ""),
      finishPosition: index + 1,
    }));

  it("starts everybody at a Score of exactly zero", () => {
    // mu 25, sigma 25/3, and the published Score is mu - 3*sigma. Nobody
    // carries their general SP onto a track they have never driven.
    const skill = replayTrackSkill("track.x", []);
    expect(skill.players).toEqual([]);
    expect(skill.races).toBe(0);
    const one = replayTrackSkill("track.x", race(1, ["player.a", "player.b"]));
    expect(one.races).toBe(1);
    // One race is enough to separate them, and the winner leads.
    expect(one.players[0]!.playerId).toBe("player.a");
    expect(one.players[0]!.score).toBeGreaterThan(one.players[1]!.score);
  });

  it("rewards winning the same track again and again", () => {
    const rows = [
      ...race(1, ["player.a", "player.b", "player.c"]),
      ...race(2, ["player.a", "player.c", "player.b"]),
      ...race(3, ["player.a", "player.b", "player.c"]),
    ];
    const skill = replayTrackSkill("track.x", rows);
    expect(skill.races).toBe(3);
    expect(skill.players.map((entry) => entry.playerId)).toEqual([
      "player.a", "player.b", "player.c",
    ]);
    const leader = skill.players[0]!;
    expect(leader.rank).toBe(1);
    expect(leader.races).toBe(3);
    expect(leader.wins).toBe(3);
    expect(leader.bestFinish).toBe(1);
    expect(leader.averageFinish).toBe(1);
    // Three wins from a standing start is a positive Score; certainty grows
    // with every race, so sigma has come down from 25/3.
    expect(leader.score).toBeGreaterThan(0);
    expect(leader.sigma).toBeLessThan(25 / 3);
  });

  it("leaves out a race whose finishing order is not a finishing order", () => {
    // Two people cannot both be second. The engine refuses ties, and a
    // history row like that is dropped and counted rather than guessed at.
    const broken = [
      { raceKey: 1, playerId: "player.a", displayName: "a", finishPosition: 2 },
      { raceKey: 1, playerId: "player.b", displayName: "b", finishPosition: 2 },
    ];
    const skill = replayTrackSkill("track.x", broken);
    expect(skill.races).toBe(0);
    expect(skill.racesSkipped).toBe(1);
    expect(skill.players).toEqual([]);
  });
});

describe("the evening that was lost", () => {
  it("keeps TN8's third qualification group out of every count", () => {
    // Its capture card failed; three of twelve races survive and none of them
    // carries a track. The owner's decision is that it does not count here.
    expect(EXCLUDED_HISTORY_SECTIONS).toEqual([{
      editionNumber: 8, stage: "qualifier", sequence: 3,
      reason: "TN8 Kwalificatie Groep 3 - capture card defect, evening lost",
    }]);
    const clause = excludedSectionsClause();
    expect(clause.sql.trim()).toBe(
      "AND NOT (section.tournament_number = ? AND section.stage = ? AND section.sequence_number = ?)",
    );
    expect(clause.params).toEqual([8, "qualifier", 3]);
  });

  it("writes no clause at all when nothing is excluded", () => {
    expect(excludedSectionsClause([])).toEqual({ sql: "", params: [] });
  });
});

/**
 * The single pass. Everything the panel asks comes out of the placements
 * themselves, so the nights, the tracks and each track's leader are the same
 * rows read three ways rather than three queries that could disagree.
 */
describe("counting the history in one pass", () => {
  const placement = (
    editionNumber: number, raceKey: number, raceSequence: number,
    trackId: string | null, order: readonly string[],
  ) => order.map((playerId, index) => ({
    editionNumber, raceKey, raceSequence, trackId,
    playerId, displayName: playerId.replace("player.", ""),
    finishPosition: index + 1,
  }));

  const dates = (editionNumber: number) => ({
    eventDate: `2023-0${editionNumber}-01`, heldAtMs: editionNumber * 1_000_000,
  });

  it("counts everybody who has ever raced, night by night", () => {
    // Two people at the first night, one of them back for the second with
    // somebody new: the field is 2 then 2, but the community is 2 then 3.
    const rows = [
      ...placement(4, 1, 1, "track.a", ["player.a", "player.b"]),
      ...placement(5, 2, 1, "track.a", ["player.a", "player.c"]),
    ];
    const answer = assembleFromPlacements(rows, dates);
    expect(answer.editions.map((edition) => edition.participantCount)).toEqual([2, 2]);
    expect(answer.editions.map((edition) => edition.cumulativePlayers)).toEqual([2, 3]);
    expect(answer.totals.players).toBe(3);
  });

  it("names the Player each track belongs to", () => {
    const rows = [
      ...placement(4, 1, 1, "track.a", ["player.a", "player.b"]),
      ...placement(4, 2, 2, "track.a", ["player.a", "player.b"]),
      ...placement(4, 3, 3, "track.b", ["player.b", "player.a"]),
    ];
    const answer = assembleFromPlacements(rows, dates);
    const trackA = answer.tracks.find((track) => track.trackId === "track.a")!;
    const trackB = answer.tracks.find((track) => track.trackId === "track.b")!;
    expect(trackA.races).toBe(2);
    expect(trackA.placements).toBe(4);
    expect(trackA.bestPlayerName).toBe("a");
    // The same two people, the other way round on another track.
    expect(trackB.bestPlayerName).toBe("b");
    expect(trackA.bestScore).not.toBeNull();
  });

  it("carries the leader's username so two Mals can be told apart (ADR-0218)", () => {
    const rows = [
      ...placement(4, 1, 1, "track.a", ["player.mal", "player.b"]),
      ...placement(4, 2, 2, "track.b", ["player.mal_2", "player.b"]),
    ].map((row) => ({
      ...row,
      displayName: row.playerId.startsWith("player.mal") ? "Mal" : "B",
      username: row.playerId === "player.mal_2" ? "mal-2" : row.playerId === "player.mal" ? "mal" : null,
    }));
    const answer = assembleFromPlacements(rows, dates);
    expect(answer.tracks.map((track) => [track.trackId, track.bestPlayerName, track.bestPlayerUsername]))
      .toEqual([["track.a", "Mal", "mal"], ["track.b", "Mal", "mal-2"]]);
    expect(trackSkillFromPlacements("track.b", rows).players.map((entry) => entry.username))
      .toEqual(["mal-2", undefined]);
  });

  it("keeps a race whose track nobody wrote down in the totals only", () => {
    const rows = [
      ...placement(4, 1, 1, null, ["player.a", "player.b"]),
      ...placement(4, 2, 2, "track.a", ["player.a", "player.b"]),
    ];
    const answer = assembleFromPlacements(rows, dates);
    expect(answer.totals.races).toBe(2);
    expect(answer.totals.racesWithTrack).toBe(1);
    expect(answer.tracks).toHaveLength(1);
  });
});

/**
 * The nights the console ran itself sit beside the imported history, and a
 * track's own page counts them too (owner, 2026-09-17: TN13 was missing from
 * every track's TrueSkill).
 */
describe("a console night on a track's own page", () => {
  const placement = (
    editionNumber: number, raceKey: number, raceSequence: number,
    trackId: string | null, order: readonly string[],
  ) => order.map((playerId, index) => ({
    editionNumber, raceKey, raceSequence, trackId,
    playerId, displayName: playerId.replace("player.", ""),
    finishPosition: index + 1,
  }));
  const dates = (editionNumber: number) => ({ eventDate: null, heldAtMs: editionNumber });

  it("keeps race 5 of one group apart from race 5 of the next", () => {
    // TN13 raced 1..32 in six groups side by side; the race number alone
    // repeats, the ordinal does not.
    const kampioen = canonicalRaceSequence("final", 1, 5);
    const talent = canonicalRaceSequence("final", 2, 5);
    const group1 = canonicalRaceSequence("qualifier", 1, 5);
    expect(new Set([kampioen, talent, group1]).size).toBe(3);
    // Qualifiers come before the finals, and everything stays under the
    // million the edition key is multiplied by.
    expect(group1).toBeLessThan(kampioen);
    expect(canonicalRaceSequence("final", 99, 999)).toBeLessThan(1_000_000);
  });

  it("replays both groups' races, where one shared key threw both away", () => {
    // Two groups, the same track, both as their fifth race. Keyed by the race
    // number alone the two fields become one of four with the positions 1, 1,
    // 2, 2 - not a finishing order, so it was skipped.
    const rows = [
      ...placement(13, -101, canonicalRaceSequence("final", 1, 5), "track.w", ["player.a", "player.b"]),
      ...placement(13, -201, canonicalRaceSequence("final", 2, 5), "track.w", ["player.c", "player.d"]),
    ];
    const skill = trackSkillFromPlacements("track.w", rows);
    expect(skill.races).toBe(2);
    expect(skill.racesSkipped).toBe(0);
    expect(skill.players.map((player) => player.playerId).sort())
      .toEqual(["player.a", "player.b", "player.c", "player.d"]);
  });

  it("counts a console night after the history, on the track's own page", () => {
    // TN12 from the history, TN13 from the console, on the same track: the
    // page counts three races, not the history's two.
    const rows = [
      ...placement(12, 1, 1, "track.w", ["player.a", "player.b"]),
      ...placement(12, 2, 2, "track.w", ["player.a", "player.b"]),
      ...placement(13, -301, canonicalRaceSequence("final", 1, 1), "track.w", ["player.b", "player.a"]),
      ...placement(13, -302, canonicalRaceSequence("final", 1, 2), "track.other", ["player.b", "player.a"]),
    ];
    const skill = trackSkillFromPlacements("track.w", rows);
    expect(skill.races).toBe(3);
    // Whoever the page puts first is whoever the panel names for that track.
    const panel = assembleFromPlacements(rows, dates)
      .tracks.find((track) => track.trackId === "track.w")!;
    expect(panel.races).toBe(3);
    expect(skill.players[0]!.playerId).toBe(panel.bestPlayerId);
    expect(skill.players[0]!.score).toBeCloseTo(panel.bestScore!, 10);
  });
});
