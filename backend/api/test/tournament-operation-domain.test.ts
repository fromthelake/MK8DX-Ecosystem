import { describe, expect, it } from "vitest";

import {
  assignSeating,
  buildRaceDocument,
  computeFinalGroups,
  computeStandings,
  overallPlacements,
  qualifierGroupCount,
  raceResultIdFor,
  racePointsForPlayerCount,
  seedQualifierGroups,
  stationsFrom,
  type SeedParticipant,
  TOURNAMENT_TIER_DEFINITIONS,
} from "../src/tournaments/tournament-operation-domain.js";
import { validateTournamentRaceResult } from
  "../src/tournaments/race-result-validation.js";

function participant(index: number, overrides: Partial<SeedParticipant> = {}): SeedParticipant {
  return {
    playerId: `player.synthetic_${String(index).padStart(2, "0")}`,
    displayName: `Player ${index}`,
    seedRank: index,
    seedScore: 40 - index,
    hasSwitch1: index % 2 === 0,
    hasSwitch2: index % 5 === 0,
    ...overrides,
  };
}

const seed = (players: readonly SeedParticipant[]) => (playerId: string) => {
  const found = players.find((candidate) => candidate.playerId === playerId);
  return {
    seedScore: found?.seedScore ?? null,
    seedRank: found?.seedRank ?? null,
    displayName: found?.displayName ?? playerId,
  };
};

describe("recovered tournament rules", () => {
  it("derives the group count from twelve-player lobbies, capped at five", () => {
    expect(qualifierGroupCount(0)).toBe(1);
    expect(qualifierGroupCount(12)).toBe(1);
    expect(qualifierGroupCount(13)).toBe(2);
    expect(qualifierGroupCount(36)).toBe(3);
    expect(qualifierGroupCount(60)).toBe(5);
    expect(qualifierGroupCount(61)).toBe(5);
  });

  it("uses the recovered race points table and a labelled fallback below six", () => {
    expect(racePointsForPlayerCount(12)).toEqual([15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(racePointsForPlayerCount(6)).toEqual([7, 5, 4, 3, 2, 1]);
    expect(racePointsForPlayerCount(4)).toEqual([4, 3, 2, 1]);
    expect(() => racePointsForPlayerCount(1)).toThrow(RangeError);
    expect(() => racePointsForPlayerCount(13)).toThrow(RangeError);
  });

  it("seeds balanced groups: every group gets anchors, sizes stay within twelve", () => {
    const players = Array.from({ length: 36 }, (_, index) => participant(index + 1));
    const groups = seedQualifierGroups(players, {
      strategy: "balanced", seedOrder: "ranked", random: () => 0.5,
    });
    expect(groups).toHaveLength(3);
    const all = groups.flatMap((group) => group.members);
    expect(new Set(all).size).toBe(36);
    for (const group of groups) {
      expect(group.members.length).toBe(12);
      // top-12 anchors are spread: at most ceil(12/3) = 4 per group
      const top = group.members.filter((id) => Number(id.slice(-2)) <= 12).length;
      expect(top).toBe(4);
    }
    expect(groups.map((group) => group.name)).toEqual(["Groep 1", "Groep 2", "Groep 3"]);
  });

  it.each([
    { count: 32, sizes: [12, 10, 10] },
    { count: 36, sizes: [12, 12, 12] },
  ])("completes the recovered manual qualifier/final flow for $count Players", ({ count, sizes }) => {
    const players = Array.from({ length: count }, (_, index) => participant(index + 1, {
      hasSwitch1: index % 2 === 0,
      hasSwitch2: false,
    }));
    const qualifiers = seedQualifierGroups(players, {
      strategy: "balanced", seedOrder: "ranked", random: () => 0.5,
    });
    expect(qualifiers.map((group) => group.members.length)).toEqual(sizes);
    const qualifierSeats = assignSeating(
      qualifiers.map((group) => group.members),
      stationsFrom(players),
    );
    expect(qualifierSeats.flat().every((seat) => seat.station !== null)).toBe(true);

    const qualifierStandings = qualifiers.map((group, groupIndex) => {
      const segments = groupIndex === 0 ? 2 : 1;
      const manual = group.members.map((playerId, index) => {
        const total = 120 - index * 3;
        return {
          playerId,
          segmentPoints: segments === 1
            ? [total]
            : [Math.floor(total / 2), Math.ceil(total / 2)],
        };
      });
      const standings = computeStandings(group.members, [], manual, segments, seed(players));
      expect(standings.source).toBe("manual");
      expect(standings.rows.every((row) => row.complete)).toBe(true);
      return { name: group.name, standings: standings.rows };
    });
    const finals = computeFinalGroups(qualifierStandings, seed(players));
    expect(finals.map((group) => group.members.length)).toEqual(sizes);
    expect(new Set(finals.flatMap((group) => group.members)).size).toBe(count);
    expect(assignSeating(
      finals.map((group) => group.members),
      stationsFrom(players),
    ).flat().every((seat) => seat.station !== null)).toBe(true);

    const finalStandings = finals.map((group, groupIndex) => {
      const segments = groupIndex === 0 ? 4 : 1;
      const manual = group.members.map((playerId, index) => {
        const total = 240 - index * 4;
        const part = Math.floor(total / segments);
        const points = Array.from({ length: segments }, () => part);
        const last = points.length - 1;
        points[last] = points[last]! + total - part * segments;
        return { playerId, segmentPoints: points };
      });
      return {
        name: group.tier.name,
        standings: computeStandings(group.members, [], manual, segments, seed(players)).rows,
      };
    });
    expect(finalStandings.flatMap((group) => group.standings).every((row) => row.complete)).toBe(true);
    expect(overallPlacements(finalStandings)).toHaveLength(count);
  });

  it("minimal_move fills groups sequentially in rank order", () => {
    const players = Array.from({ length: 15 }, (_, index) => participant(index + 1));
    const groups = seedQualifierGroups(players, {
      strategy: "minimal_move", seedOrder: "ranked", random: () => 0,
    });
    expect(groups[0]!.members).toHaveLength(12);
    expect(groups[1]!.members).toHaveLength(3);
    expect(groups[0]!.members[0]).toBe("player.synthetic_01");
    expect(groups[1]!.members).toEqual([
      "player.synthetic_13", "player.synthetic_14", "player.synthetic_15",
    ]);
  });

  it("random seed order is deterministic for a given random source and still complete", () => {
    const players = Array.from({ length: 20 }, (_, index) => participant(index + 1));
    let calls = 0;
    const random = () => { calls += 1; return ((calls * 7919) % 1000) / 1000; };
    const groups = seedQualifierGroups(players, { strategy: "balanced", seedOrder: "random", random });
    expect(groups.flatMap((group) => group.members)).toHaveLength(20);
    expect(groups.every((group) => group.members.length <= 12)).toBe(true);
  });

  it("seats owners at seat 1 of their own Switch and pools surplus stations", () => {
    const players = [
      participant(1, { hasSwitch1: true, hasSwitch2: true }),
      participant(2, { hasSwitch1: false, hasSwitch2: false }),
      participant(3, { hasSwitch1: false, hasSwitch2: false }),
      participant(4, { hasSwitch1: false, hasSwitch2: false }),
      participant(5, { hasSwitch1: true, hasSwitch2: false }),
      participant(6, { hasSwitch1: false, hasSwitch2: false }),
    ];
    const stations = stationsFrom(players);
    expect(stations).toHaveLength(3);
    // Group A (two players) needs one station, so the owner's second Switch
    // is surplus and must reach group B, which needs two.
    const [groupA, groupB] = assignSeating(
      [["player.synthetic_01", "player.synthetic_02"],
       ["player.synthetic_03", "player.synthetic_04", "player.synthetic_05", "player.synthetic_06"]],
      stations,
    );
    const owner = groupA!.find((seat) => seat.playerId === "player.synthetic_01")!;
    expect(owner.station).toEqual({ ownerPlayerId: "player.synthetic_01", switchType: "ns1", seatNumber: 1 });
    expect(groupA!.every((seat) => seat.station !== null)).toBe(true);
    // group B needs two stations: the owner's own plus the pooled surplus ns2
    expect(groupB!.every((seat) => seat.station !== null)).toBe(true);
    expect(groupB!.some((seat) => seat.station?.ownerPlayerId === "player.synthetic_01" &&
      seat.station.switchType === "ns2")).toBe(true);
    const fiveSeat = groupB!.find((seat) => seat.playerId === "player.synthetic_05")!;
    expect(fiveSeat.station?.ownerPlayerId).toBe("player.synthetic_05");
    expect(fiveSeat.station?.seatNumber).toBe(1);
  });

  it("leaves members unseated when there are not enough Switches", () => {
    const [group] = assignSeating([["a", "b", "c", "d", "e"]], [{ ownerPlayerId: "a", switchType: "ns1" }]);
    expect(group!.filter((seat) => seat.station === null)).toHaveLength(3);
  });

  it("computes standings from counted races with the recovered tie-break ladder", () => {
    const players = [participant(1), participant(2), participant(3)];
    const members = players.map((player) => player.playerId);
    const races = [
      { raceNumber: 1, countsTowardStandings: true, placements: [
        { playerId: members[0]!, finishPosition: 1, racePoints: 3 },
        { playerId: members[1]!, finishPosition: 2, racePoints: 2 },
        { playerId: members[2]!, finishPosition: 3, racePoints: 1 },
      ] },
      { raceNumber: 2, countsTowardStandings: true, placements: [
        { playerId: members[1]!, finishPosition: 1, racePoints: 3 },
        { playerId: members[0]!, finishPosition: 2, racePoints: 2 },
        { playerId: members[2]!, finishPosition: 3, racePoints: 1 },
      ] },
      { raceNumber: 3, countsTowardStandings: false, placements: [
        { playerId: members[2]!, finishPosition: 1, racePoints: 3 },
        { playerId: members[0]!, finishPosition: 2, racePoints: 2 },
        { playerId: members[1]!, finishPosition: 3, racePoints: 1 },
      ] },
    ];
    const standings = computeStandings(members, races, [], 1, seed(players));
    expect(standings.source).toBe("races");
    // 1 and 2 tie on 5 points and 1 win each; best race ties at 3; seed score decides (player 1 higher)
    expect(standings.rows.map((row) => [row.rank, row.playerId, row.points, row.wins])).toEqual([
      [1, members[0], 5, 1], [2, members[1], 5, 1], [3, members[2], 2, 0],
    ]);
    expect(standings.rows[2]!.races).toBe(2);
  });

  it("lets a total entered by hand correct what the races add up to", () => {
    // A scored night is not always a correct one - a missed race, a dropped
    // lap, somebody scored under the wrong name - so the Director's own total
    // wins, and the row still says what the races said.
    const players = [participant(1), participant(2), participant(3)];
    const members = players.map((player) => player.playerId);
    const races = [
      { raceNumber: 1, countsTowardStandings: true, placements: [
        { playerId: members[0]!, finishPosition: 1, racePoints: 3 },
        { playerId: members[1]!, finishPosition: 2, racePoints: 2 },
        { playerId: members[2]!, finishPosition: 3, racePoints: 1 },
      ] },
    ];
    const standings = computeStandings(members, races, [
      { playerId: members[2]!, segmentPoints: [9] },
    ], 1, seed(players));
    // The races are still the source; one row was corrected over them.
    expect(standings.source).toBe("races");
    expect(standings.rows.map((row) => [row.playerId, row.points])).toEqual([
      [members[2], 9], [members[0], 3], [members[1], 2],
    ]);
    const corrected = standings.rows.find((row) => row.playerId === members[2]);
    expect(corrected?.correctedFromRaces).toBe(1);
    // The race record underneath is untouched: still one race, no win.
    expect(corrected?.races).toBe(1);
    expect(corrected?.wins).toBe(0);
    // Nobody else is marked as corrected.
    expect(standings.rows.filter((row) => row.correctedFromRaces !== undefined)).toHaveLength(1);
  });

  it("does not call a hand-entered total a correction when it agrees with the races", () => {
    const players = [participant(1), participant(2)];
    const members = players.map((player) => player.playerId);
    const races = [
      { raceNumber: 1, countsTowardStandings: true, placements: [
        { playerId: members[0]!, finishPosition: 1, racePoints: 3 },
        { playerId: members[1]!, finishPosition: 2, racePoints: 2 },
      ] },
    ];
    const standings = computeStandings(members, races, [
      { playerId: members[0]!, segmentPoints: [3] },
      // An unfinished entry is not a correction either.
      { playerId: members[1]!, segmentPoints: [null] },
    ], 1, seed(players));
    expect(standings.rows.every((row) => row.correctedFromRaces === undefined)).toBe(true);
    expect(standings.rows.map((row) => row.points)).toEqual([3, 2]);
  });

  it("falls back to manual totals with segments and marks incomplete entries", () => {
    const players = [participant(1), participant(2)];
    const members = players.map((player) => player.playerId);
    const standings = computeStandings(members, [], [
      { playerId: members[0]!, segmentPoints: [40, 35] },
      { playerId: members[1]!, segmentPoints: [50, null] },
    ], 2, seed(players));
    expect(standings.source).toBe("manual");
    expect(standings.rows[0]).toMatchObject({ playerId: members[0], points: 75, complete: true });
    expect(standings.rows[1]).toMatchObject({ playerId: members[1], points: 50, complete: false });
  });

  it("uses the phase policy immediately after equal total points", () => {
    const players = [participant(1), participant(2)];
    const [strongSeed, weakSeed] = players.map((player) => player.playerId);
    const races = [
      { raceNumber: 1, countsTowardStandings: true, placements: [
        { playerId: weakSeed!, finishPosition: 1, racePoints: 5 },
        { playerId: strongSeed!, finishPosition: 2, racePoints: 3 },
      ] },
      { raceNumber: 2, countsTowardStandings: true, placements: [
        { playerId: strongSeed!, finishPosition: 2, racePoints: 2 },
        { playerId: weakSeed!, finishPosition: 3, racePoints: 0 },
      ] },
    ];
    const bySp = computeStandings(
      [strongSeed!, weakSeed!], races, [], 1, seed(players), { mode: "sp" },
    );
    expect(bySp.rows.map((row) => row.playerId)).toEqual([strongSeed, weakSeed]);
    expect(bySp.rows[1]).toMatchObject({ wins: 1, bestRace: 5 });
    expect(bySp.tieGroups).toEqual([{
      points: 5, playerIds: [strongSeed, weakSeed], resolved: true,
    }]);

    const manual = computeStandings(
      [strongSeed!, weakSeed!], races, [], 1, seed(players), {
        mode: "manual", orders: [{ points: 5, playerIds: [weakSeed!, strongSeed!] }],
      },
    );
    expect(manual.rows.map((row) => row.playerId)).toEqual([weakSeed, strongSeed]);
    expect(manual.tieGroups[0]?.resolved).toBe(true);
  });

  it("keeps lottery order stable and reports unresolved manual ties", () => {
    const players = [participant(1), participant(2), participant(3)];
    const members = players.map((player) => player.playerId);
    const scores = members.map((playerId) => ({ playerId, segmentPoints: [42] }));
    const first = computeStandings(members, [], scores, 1, seed(players), {
      mode: "lottery", lotteryKey: "tournament.demo:qualifier:group.1",
    });
    const second = computeStandings([...members].reverse(), [], scores, 1, seed(players), {
      mode: "lottery", lotteryKey: "tournament.demo:qualifier:group.1",
    });
    expect(second.rows.map((row) => row.playerId)).toEqual(first.rows.map((row) => row.playerId));

    const unresolved = computeStandings(members, [], scores, 1, seed(players), { mode: "manual" });
    expect(unresolved.tieGroups).toHaveLength(1);
    expect(unresolved.tieGroups[0]?.resolved).toBe(false);
  });

  it("slices qualifier groups horizontally into tiers (recovered computeTiers)", () => {
    const players = Array.from({ length: 24 }, (_, index) => participant(index + 1));
    const standingsFor = (ids: readonly string[]) => ids.map((playerId, index) => ({
      rank: index + 1, playerId, points: 100 - index, races: 8, wins: 0, bestRace: 15, complete: true,
    }));
    const groupA = players.slice(0, 12).map((player) => player.playerId);
    const groupB = players.slice(12).map((player) => player.playerId);
    const finals = computeFinalGroups([
      { name: "Groep 1", standings: standingsFor(groupA) },
      { name: "Groep 2", standings: standingsFor(groupB) },
    ], seed(players));
    expect(finals).toHaveLength(2);
    expect(finals[0]!.tier).toBe(TOURNAMENT_TIER_DEFINITIONS[0]);
    expect(finals[0]!.members).toHaveLength(12);
    // ranks 1-6 of every group go to Kampioen, 7-12 to Talent
    expect(finals[0]!.members).toContain(groupA[0]);
    expect(finals[0]!.members).toContain(groupB[5]);
    expect(finals[1]!.members).toContain(groupA[6]);
    expect(finals[1]!.members).toContain(groupB[11]);
    // inside a tier the standing decides first: both group winners lead
    expect(finals[0]!.members.slice(0, 2)).toEqual([groupA[0], groupB[0]]);
  });

  it("refuses to compute finals while a qualifier group is incomplete", () => {
    expect(() => computeFinalGroups([{ name: "Groep 1", standings: [
      { rank: 1, playerId: "a", points: 0, races: 0, wins: 0, bestRace: 0, complete: false },
    ] }], () => ({ seedScore: null, seedRank: null, displayName: "a" }))).toThrow(RangeError);
  });

  it("numbers overall placements across groups in tier order", () => {
    const rows = overallPlacements([
      { name: "Kampioen", standings: [
        { rank: 1, playerId: "a", points: 90, races: 8, wins: 3, bestRace: 15, complete: true },
        { rank: 2, playerId: "b", points: 80, races: 8, wins: 2, bestRace: 15, complete: true },
      ] },
      { name: "Talent", standings: [
        { rank: 1, playerId: "c", points: 95, races: 8, wins: 5, bestRace: 15, complete: true },
      ] },
    ]);
    expect(rows.map((row) => [row.placement, row.playerId, row.groupName])).toEqual([
      [1, "a", "Kampioen"], [2, "b", "Kampioen"], [3, "c", "Talent"],
    ]);
  });

  it("carries a Mirror race as mode 150 with mirror, never with another class (ADR-0217)", () => {
    const finishOrder = Array.from({ length: 12 }, (_, index) =>
      `player.synthetic_racer_${String(index + 1).padStart(2, "0")}`);
    const base = {
      raceResultId: raceResultIdFor("tournament_group.synthetic_group_001", 1),
      revision: 1,
      raceNumber: 1,
      trackId: "track.mario_kart_stadium",
      tournamentId: "tournament.synthetic_event_001",
      groupId: "tournament_group.synthetic_group_001",
      stage: "qualifier" as const,
      groupName: "Groep 1",
      finishOrder,
      totalsBefore: new Map<string, number>(),
      countsTowardStandings: true,
      nowMs: 1_787_400_000_000,
    };
    const mirror = buildRaceDocument({ ...base, mode: 150, mirror: true });
    expect(mirror.mirror).toBe(true);
    expect(() => validateTournamentRaceResult(mirror)).not.toThrow();
    const fifty = buildRaceDocument({ ...base, mode: 50 });
    expect(fifty.mode).toBe(50);
    expect(Object.hasOwn(fifty, "mirror")).toBe(false);
    expect(Object.hasOwn(buildRaceDocument({ ...base, mode: 200, mirror: true }), "mirror")).toBe(false);
  });

  it("builds a canonical V1 race document that passes the platform validator", () => {
    const finishOrder = Array.from({ length: 6 }, (_, index) => `player.synthetic_0${index + 1}`);
    const document = buildRaceDocument({
      raceResultId: raceResultIdFor("tournament_group.synthetic_group_001", 2),
      revision: 1,
      raceNumber: 2,
      trackId: "track.mario_kart_stadium",
      mode: 150,
      tournamentId: "tournament.synthetic_event_001",
      groupId: "tournament_group.synthetic_group_001",
      stage: "qualifier",
      groupName: "Groep 1",
      finishOrder,
      totalsBefore: new Map([[finishOrder[5]!, 7], [finishOrder[0]!, 1]]),
      countsTowardStandings: true,
      nowMs: 1_787_400_000_000,
    });
    expect(() => validateTournamentRaceResult(document)).not.toThrow();
    expect(document.raceResultId).toBe("tournament_race_result.synthetic_group_001_r02");
    expect(document.source.kind).toBe("tournament_manual_entry");
    expect(document.placements[0]!.scoring).toEqual({
      racePoints: 7, totalBeforeRace: 1, totalAfterRace: 8, rankAfterRace: 1,
    });
    // last finisher already had 7 and earns 1 -> total 8, tied rank 1 with the winner
    expect(document.placements[5]!.scoring).toEqual({
      racePoints: 1, totalBeforeRace: 7, totalAfterRace: 8, rankAfterRace: 1,
    });
    expect(document.placements[1]!.scoring.rankAfterRace).toBe(3);
  });

  it("builds a voided race that earns nothing and requires a note", () => {
    const document = buildRaceDocument({
      raceResultId: raceResultIdFor("tournament_group.synthetic_group_001", 1),
      revision: 2,
      raceNumber: 1,
      trackId: "track.mario_kart_stadium",
      tournamentId: "tournament.synthetic_event_001",
      groupId: "tournament_group.synthetic_group_001",
      stage: "final",
      groupName: "Kampioen",
      finishOrder: ["player.synthetic_01", "player.synthetic_02"],
      totalsBefore: new Map(),
      countsTowardStandings: false,
      scoringNote: "voided by the operator: connection error",
      nowMs: 1_787_400_000_000,
    });
    expect(() => validateTournamentRaceResult(document)).not.toThrow();
    expect(document.placements.every((placement) => placement.scoring.totalAfterRace === 0)).toBe(true);
  });
});

describe("owner seating mode", () => {
  // ADR-0177 decision 7, mirroring the source Manager's ownerSeatingMode.
  const players = Array.from({ length: 8 }, (_unused, index) => participant(index + 1));
  const group = [players.map((player) => player.playerId)];

  it("strict puts an owner on their own console in seat 1", () => {
    const stations = stationsFrom(players);
    const seats = assignSeating(group, stations, "owner_strict").flat();

    // A group only takes the consoles it needs, so not every owner's own
    // console is in play. Whoever does sit on their own console sits in seat 1.
    const onOwnConsole = seats.filter((seat) => seat.station?.ownerPlayerId === seat.playerId);
    expect(onOwnConsole.length).toBeGreaterThan(0);
    expect(onOwnConsole.every((seat) => seat.station?.seatNumber === 1)).toBe(true);
  });

  it("soft stops pinning owners while still seating everyone exactly once", () => {
    const stations = stationsFrom(players);
    const strict = assignSeating(group, stations, "owner_strict").flat();
    const soft = assignSeating(group, stations, "owner_soft").flat();

    // Every Player still gets exactly one seat, and no seat is shared.
    expect(soft.every((seat) => seat.station !== null)).toBe(true);
    const occupied = soft.map((seat) =>
      `${seat.station?.ownerPlayerId}|${seat.station?.switchType}|${seat.station?.seatNumber}`);
    expect(new Set(occupied).size).toBe(occupied.length);

    // and the two modes really do produce different seating.
    const pinned = (rows: typeof soft) => rows.filter((seat) =>
      seat.station?.ownerPlayerId === seat.playerId && seat.station?.seatNumber === 1).length;
    expect(pinned(soft)).toBeLessThan(pinned(strict));
  });

  it("defaults to strict when no mode is given", () => {
    const stations = stationsFrom(players);
    expect(assignSeating(group, stations)).toEqual(assignSeating(group, stations, "owner_strict"));
  });
});
