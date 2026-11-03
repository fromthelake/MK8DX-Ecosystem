import { describe, expect, it } from "vitest";

import {
  TOURNAMENT_SEAT_PALETTE,
  tournamentBoardModel,
  tournamentGroupGradient,
  tournamentMoveStationMutation,
  tournamentParkPlayerMutation,
  tournamentParkStationMutation,
  tournamentSeatPlayerInGroupMutation,
  tournamentSeatPlayerMutation,
  tournamentSeatTone,
  tournamentTierForPlayer,
  tournamentUtpByStation,
} from "../src/tournament-group-board.js";
import type { TournamentDocument } from "../src/tournament-operation-client.js";

const station = (owner: string, type: "ns1" | "ns2", seat: 1 | 2) => ({
  ownerPlayerId: `player.${owner}`,
  ownerDisplayName: owner[0]!.toUpperCase() + owner.slice(1),
  switchType: type,
  seatNumber: seat,
});

const member = (name: string, seatOrder: number, seatedAt?: ReturnType<typeof station>) => ({
  playerId: `player.${name}`,
  displayName: name[0]!.toUpperCase() + name.slice(1),
  seatOrder,
  ...(seatedAt === undefined ? {} : { station: seatedAt }),
});

function documentWith(groups: unknown[], participants: string[], stations: unknown[] = []): TournamentDocument {
  return {
    summary: { tournamentId: "tournament.synthetic_board", revision: 4 },
    participants: participants.map((name) => ({
      playerId: `player.${name}`,
      username: name,
      displayName: name[0]!.toUpperCase() + name.slice(1),
      attendance: "present",
      hasSwitch1: false,
      hasSwitch2: false,
    })),
    stations,
    groups,
    overall: [],
    lifecycle: [],
  } as never;
}

const twoGroups = () => documentWith([
  {
    groupId: "tournament_group.board_g1", stage: "qualifier", sequence: 1, name: "Groep 1",
    locked: false, manualScoreSegments: 1,
    stations: [],
    members: [
      member("ace", 1, station("ace", "ns1", 1)),
      member("ben", 2, station("ace", "ns1", 2)),
      member("nova", 3),
    ],
    races: [], manualScores: [], standings: { source: "none", rows: [] },
  },
  {
    groupId: "tournament_group.board_g2", stage: "qualifier", sequence: 2, name: "Groep 2",
    locked: false, manualScoreSegments: 1,
    stations: [],
    members: [
      member("evan", 1, station("evan", "ns2", 1)),
    ],
    races: [], manualScores: [], standings: { source: "none", rows: [] },
  },
], ["ace", "ben", "nova", "evan", "daisy"], [
  { ownerPlayerId: "player.ace", ownerDisplayName: "Ace", switchType: "ns1" },
  { ownerPlayerId: "player.evan", ownerDisplayName: "Evan", switchType: "ns2" },
  { ownerPlayerId: "player.daisy", ownerDisplayName: "Daisy", switchType: "ns1" },
]);

describe("tournament group board (source Manager parity)", () => {
  it("keeps an absent lender's declared equipment in parking without adding the lender as a racer", () => {
    const original = twoGroups();
    const value = { ...original, participants: original.participants.map((player) => player.playerId === "player.daisy"
      ? { ...player, attendance: "absent" as const } : player) };
    const model = tournamentBoardModel(value, "qualifier");
    expect(model.parkedStations.map((station) => station.ownerPlayerId)).toEqual(["player.daisy"]);
    expect(model.parkedPlayers).toEqual([]);
  });
  it("colours groups by index and seats by slot, with the source palette", () => {
    expect(TOURNAMENT_SEAT_PALETTE).toHaveLength(5);
    expect(tournamentSeatTone(0, 0)).toEqual({ hex: "#93C5FD", tone: "dark" });
    expect(tournamentSeatTone(1, 5)).toEqual({ hex: "#166534", tone: "light" });
    expect(tournamentSeatTone(5, 0).hex).toBe("#93C5FD");
    expect(tournamentGroupGradient(2)).toEqual({ start: "#FCA5A5", end: "#991B1B" });
  });

  it("maps SP rank bands onto the source tiers", () => {
    expect(tournamentTierForPlayer({ seedRank: 1 })).toEqual({ key: "champion", name: "Kampioen" });
    expect(tournamentTierForPlayer({ seedRank: 24 })).toEqual({ key: "talent", name: "Talent" });
    expect(tournamentTierForPlayer({ seedRank: 60 })).toEqual({ key: "feest", name: "Feest" });
    expect(tournamentTierForPlayer({ seedRank: 3, isNew: true })).toEqual({ key: "new", name: "Nieuw" });
    expect(tournamentTierForPlayer({})).toEqual({ key: "unknown", name: "Onbekend" });
  });

  it("builds the board model with slots, parking and derived UTP numbers", () => {
    const model = tournamentBoardModel(twoGroups(), "qualifier");
    expect(model.groups).toHaveLength(2);
    expect(model.groups[0]!.slots.filter((slot) => slot !== null)).toHaveLength(1);
    expect(model.groups[0]!.slots).toHaveLength(6);
    expect(model.groups[0]!.slots[0]!.utpCableNumber).toBe(1);
    expect(model.groups[1]!.slots[0]!.utpCableNumber).toBe(2);
    expect(model.groups[0]!.unseated.map((entry) => entry.displayName)).toEqual(["Nova"]);
    expect(model.parkedPlayers.map((entry) => entry.displayName)).toEqual(["Daisy"]);
    expect(model.parkedStations.map((entry) => entry.ownerDisplayName)).toEqual(["Daisy"]);
    expect([...tournamentUtpByStation(twoGroups()).values()]).toEqual([1, 2]);
  });

  it("swaps two seated players when one is dropped on the other's seat", () => {
    const model = tournamentBoardModel(twoGroups(), "qualifier");
    const result = tournamentSeatPlayerMutation(
      model, "player.evan", "Evan", "tournament_group.board_g1", "player.ace|ns1", 2,
    );
    expect(result.kind).toBe("apply");
    if (result.kind !== "apply") { return; }
    // A cross-group swap keeps the stage population identical, so the
    // atomic layout call alone expresses it (regrouping included).
    expect(result.membershipChange).toBe(false);
    const groupOne = result.layout.find((group) => group.name === "Groep 1")!;
    const groupTwo = result.layout.find((group) => group.name === "Groep 2")!;
    expect(groupOne.seats).toContainEqual({
      playerId: "player.evan", stationOwnerPlayerId: "player.ace", switchType: "ns1", seatNumber: 2,
    });
    // Ben took Evan's vacated seat on Evan's own Switch.
    expect(groupTwo.seats).toContainEqual({
      playerId: "player.ben", stationOwnerPlayerId: "player.evan", switchType: "ns2", seatNumber: 1,
    });
  });

  it("evicts the occupant to unplaced when the dragger comes from parking", () => {
    const model = tournamentBoardModel(twoGroups(), "qualifier");
    const result = tournamentSeatPlayerMutation(
      model, "player.daisy", "Daisy", "tournament_group.board_g1", "player.ace|ns1", 1,
    );
    expect(result.kind).toBe("apply");
    if (result.kind !== "apply") { return; }
    expect(result.membershipChange).toBe(true);
    const groupOne = result.layout.find((group) => group.name === "Groep 1")!;
    expect(groupOne.seats).toContainEqual({
      playerId: "player.daisy", stationOwnerPlayerId: "player.ace", switchType: "ns1", seatNumber: 1,
    });
    // Ace was evicted: no seat anywhere in the new layout.
    expect(result.layout.flatMap((group) => group.seats)
      .some((seat) => seat.playerId === "player.ace")).toBe(false);
  });

  it("drops into the first free seat on a group drop and denies a full group", () => {
    const model = tournamentBoardModel(twoGroups(), "qualifier");
    const result = tournamentSeatPlayerInGroupMutation(
      model, "player.nova", "Nova", "tournament_group.board_g2",
    );
    expect(result.kind).toBe("apply");
    if (result.kind !== "apply") { return; }
    const groupTwo = result.layout.find((group) => group.name === "Groep 2")!;
    expect(groupTwo.seats).toContainEqual({
      playerId: "player.nova", stationOwnerPlayerId: "player.evan", switchType: "ns2", seatNumber: 2,
    });
    const noSeats = tournamentSeatPlayerInGroupMutation(
      tournamentBoardModel(documentWith([
        {
          groupId: "tournament_group.board_g3", stage: "qualifier", sequence: 1, name: "Groep 3",
          locked: false, manualScoreSegments: 1, members: [], races: [], manualScores: [],
          standings: { source: "none", rows: [] },
        },
      ], ["daisy"]), "qualifier"),
      "player.daisy", "Daisy", "tournament_group.board_g3",
    );
    expect(noSeats).toEqual({
      kind: "denied",
      message: "Geen vrije zitplaats in Groep 3. Voeg een Nintendo Switch toe of verplaats eerst een deelnemer.",
    });
  });

  it("parks a player out of the stage", () => {
    const model = tournamentBoardModel(twoGroups(), "qualifier");
    const result = tournamentParkPlayerMutation(model, "player.ben");
    expect(result.kind).toBe("apply");
    if (result.kind !== "apply") { return; }
    expect(result.membershipChange).toBe(true);
    expect(result.members.find((group) => group.groupId === "tournament_group.board_g1")!.members)
      .toEqual(["player.ace", "player.nova"]);
  });

  it("moves a Switch with its players in the qualifier and swaps a bumped Switch", () => {
    const model = tournamentBoardModel(twoGroups(), "qualifier");
    const result = tournamentMoveStationMutation(
      model, "player.ace|ns1", "tournament_group.board_g2", 0,
    );
    expect(result.kind).toBe("apply");
    if (result.kind !== "apply") { return; }
    const groupOne = result.layout.find((group) => group.name === "Groep 1")!;
    const groupTwo = result.layout.find((group) => group.name === "Groep 2")!;
    // Ace and Ben travelled with Ace's Switch; Evan's Switch swapped back.
    expect(groupTwo.seats.map((seat) => seat.playerId))
      .toEqual(expect.arrayContaining(["player.ace", "player.ben"]));
    expect(groupOne.seats).toContainEqual({
      playerId: "player.evan", stationOwnerPlayerId: "player.evan", switchType: "ns2", seatNumber: 1,
    });
  });

  it("detaches every involved player on a cross-final-group Switch move", () => {
    const finalDocument = documentWith([
      {
        groupId: "tournament_group.board_f1", stage: "final", sequence: 1, name: "Kampioen",
        locked: false, manualScoreSegments: 1,
        stations: [],
        members: [member("ace", 1, station("ace", "ns1", 1)), member("ben", 2, station("ace", "ns1", 2))],
        races: [], manualScores: [], standings: { source: "none", rows: [] },
      },
      {
        groupId: "tournament_group.board_f2", stage: "final", sequence: 2, name: "Talent",
        locked: false, manualScoreSegments: 1,
        stations: [],
        members: [member("evan", 1, station("evan", "ns2", 1))],
        races: [], manualScores: [], standings: { source: "none", rows: [] },
      },
    ], ["ace", "ben", "evan"]);
    const result = tournamentMoveStationMutation(
      tournamentBoardModel(finalDocument, "final"), "player.ace|ns1", "tournament_group.board_f2", 0,
    );
    expect(result.kind).toBe("apply");
    if (result.kind !== "apply") { return; }
    expect(result.membershipChange).toBe(true);
    // Both Switches moved, every seat empty: the players went to parking.
    expect(result.layout.flatMap((group) => group.seats)).toHaveLength(0);
  });

  it("parks a Switch and leaves its players unplaced out of the stage", () => {
    const model = tournamentBoardModel(twoGroups(), "qualifier");
    const result = tournamentParkStationMutation(model, "player.ace|ns1");
    expect(result.kind).toBe("apply");
    if (result.kind !== "apply") { return; }
    expect(result.membershipChange).toBe(true);
    expect(result.layout.find((group) => group.name === "Groep 1")!.seats
      .filter((seat) => seat.seatNumber !== null)).toHaveLength(0);
  });

  it("denies over-capacity moves with the source messages", () => {
    const fullMembers = Array.from({ length: 12 }, (_, index) => member(`p${index}`, index + 1));
    const fullDocument = documentWith([
      {
        groupId: "tournament_group.board_full", stage: "qualifier", sequence: 1, name: "Groep 1",
        locked: false, manualScoreSegments: 1, members: fullMembers,
        races: [], manualScores: [], standings: { source: "none", rows: [] },
      },
    ], [...Array.from({ length: 12 }, (_, index) => `p${index}`), "daisy"]);
    const denied = tournamentSeatPlayerInGroupMutation(
      tournamentBoardModel(fullDocument, "qualifier"), "player.daisy", "Daisy", "tournament_group.board_full",
    );
    expect(denied.kind).toBe("denied");
  });

  it("draws the stored slot order first, an empty Switch included, and writes it back with every layout", () => {
    const document_ = documentWith([
      {
        groupId: "tournament_group.synthetic_q1", stage: "qualifier", sequence: 1, name: "Groep 1", locked: false,
        manualScoreSegments: 1,
        stations: [
          { slotIndex: 1, ownerPlayerId: "player.bravo", ownerDisplayName: "Bravo", switchType: "ns1" },
          { slotIndex: 2, ownerPlayerId: "player.alpha", ownerDisplayName: "Alpha", switchType: "ns2" },
        ],
        members: [member("alpha", 1, station("alpha", "ns2", 1))],
        races: [], manualScores: [], standings: { source: "none", rows: [] },
      },
    ], ["alpha", "bravo"]);
    const model = tournamentBoardModel(document_, "qualifier");
    const slots = model.groups[0]!.slots;
    // Bravo's empty console keeps slot 1; Alpha sits at their own in slot 2.
    expect(slots[0]?.key).toBe("player.bravo|ns1");
    expect(slots[0]?.seats).toEqual([null, null]);
    expect(slots[1]?.key).toBe("player.alpha|ns2");
    expect(slots[1]?.seats[0]?.playerId).toBe("player.alpha");
    const mutation = tournamentParkPlayerMutation(model, "player.alpha");
    expect(mutation.kind).toBe("apply");
    if (mutation.kind === "apply") {
      expect(mutation.layout[0]!.stations).toEqual([
        { stationOwnerPlayerId: "player.bravo", switchType: "ns1" },
        { stationOwnerPlayerId: "player.alpha", switchType: "ns2" },
      ]);
      expect(mutation.layout[0]!.seats).toEqual([]);
    }
  });
});
