import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

import {
  TournamentOperationService,
  type GroupRaceRecord,
  type GroupRecord,
  type ManualScoreRecord,
  type ParticipantRecord,
  type TournamentOperationTransaction,
  type TournamentRecord,
} from "../src/tournaments/tournament-operation-service.js";

const actor = { role: "administrator" as const, userAccountId: "user_account.synthetic_director" };
const id = "tournament.synthetic_equipment_recovery";

/** A faithful small Step 6: four racers, two physically assigned consoles,
 * one console lent by an absent roster member, and accepted qualifier data.
 * All identities and scores are synthetic; no TN13 private row enters Git. */
function fixture(Service = TournamentOperationService, productionShape = false) {
  let tournament: TournamentRecord = {
    internalId: 1, tournamentId: id, name: "Synthetic borrowed-console night",
    editionNumber: null, eventDate: "2026-09-11", stage: "qualifiers", workflowStep: 6,
    qualifierRounds: true, maxParticipants: null, revision: 12, seedOrder: "ranked",
    placementStrategy: "balanced", ownerSeatingMode: "owner_strict",
    qualifierTieBreakMode: "sp", finalTieBreakMode: "sp", publicResults: false,
    affectsRating: false, publicationId: null, publicationVisibility: null,
    directorInternalId: 9, finalizedAtMs: null, createdAtMs: 1000, updatedAtMs: 2000,
  };
  let participants: ParticipantRecord[] = Array.from({ length: 5 }, (_, index) => ({
    player: { internalId: index + 1, playerId: `player.synthetic_equipment_${index + 1}`,
      username: `synthetic_equipment_${index + 1}`, displayName: `Synthetic racer ${index + 1}`,
      visibility: "public", active: true },
    attendance: index === 4 ? "absent" : "present", hasSwitch1: index === 0,
    hasSwitch2: false, seedRank: index + 1, seedScore: 30 - index, lastPresentAtMs: 1000,
  }));
  let groups: GroupRecord[] = [{
    internalId: 11, groupId: "tournament_group.synthetic_qualifier", stage: "qualifier",
    sequence: 1, name: "Groep 1", tierKey: null, locked: true, manualScoreSegments: 1,
    tieBreakOrders: [],
    members: participants.slice(0, 4).map((participant, index) => ({
      playerId: participant.player.playerId, seatOrder: index + 1, character: { key: "character.mario", label: "Mario", roster: "mk8dx" },
      station: { ownerPlayerId: participants[index < 2 ? 0 : 4]!.player.playerId,
        switchType: index < 2 ? "ns1" : "ns2", seatNumber: index % 2 === 0 ? 1 : 2 },
    })),
    stations: [
      { slotIndex: 1, ownerPlayerId: participants[0]!.player.playerId, switchType: "ns1" },
      { slotIndex: 2, ownerPlayerId: participants[4]!.player.playerId, switchType: "ns2" },
    ],
  }];
  let races: GroupRaceRecord[] = [{
    groupInternalId: 11, raceNumber: 1, raceResultId: "tournament_race_result.synthetic_accepted",
    revision: 1, scoringSegment: 1, sourceKind: "tournament_spreadsheet_import",
    scoringNote: null, trackId: "track.mario_kart_stadium", mode: 150, countsTowardStandings: true,
    placements: participants.slice(0, 4).map((participant, index) => ({
      playerId: participant.player.playerId, finishPosition: index + 1, racePoints: 4 - index,
    })),
  }];
  let manual: ManualScoreRecord[] = [];
  if (productionShape) {
    // Same counts and relationships as the reviewed TN13 snapshot, never its
    // private identities: 36 racers, 17 playing lenders and one absent lender.
    participants = Array.from({ length: 37 }, (_, index) => ({
      ...participants[0]!,
      player: { ...participants[0]!.player, internalId: index + 1,
        playerId: `player.synthetic_equipment_${index + 1}`,
        username: `synthetic_equipment_${index + 1}`, displayName: `Synthetic racer ${index + 1}` },
      attendance: index === 36 ? "absent" : "present",
      hasSwitch1: index < 17 || index === 36, hasSwitch2: false,
      seedRank: index + 1, seedScore: 100 - index,
    }));
    const owners = [...participants.slice(0, 17), participants[36]!];
    groups = Array.from({ length: 3 }, (_, groupIndex) => ({
      ...groups[0]!, internalId: 11 + groupIndex,
      groupId: `tournament_group.synthetic_qualifier_${groupIndex + 1}`,
      name: `Groep ${groupIndex + 1}`, sequence: groupIndex + 1,
      members: participants.slice(groupIndex * 12, groupIndex * 12 + 12).map((participant, index) => ({
        playerId: participant.player.playerId, seatOrder: index + 1, character: null,
        station: { ownerPlayerId: owners[groupIndex * 6 + Math.floor(index / 2)]!.player.playerId,
          switchType: "ns1", seatNumber: index % 2 === 0 ? 1 : 2 },
      })),
      stations: owners.slice(groupIndex * 6, groupIndex * 6 + 6).map((owner, index) => ({
        slotIndex: index + 1, ownerPlayerId: owner.player.playerId, switchType: "ns1",
      })),
    }));
    const race = races[0]!;
    races = groups.flatMap((group) => Array.from({ length: 12 }, (_, raceIndex) => ({
      ...race, groupInternalId: group.internalId, raceNumber: raceIndex + 1,
      raceResultId: `tournament_race_result.synthetic_${group.internalId}_${raceIndex + 1}`,
      placements: group.members.map((member, index) => ({
        playerId: member.playerId, finishPosition: index + 1, racePoints: 15 - index,
      })),
    })));
  }
  let lifecycle: Record<string, unknown>[] = [];
  let sequence = 20;
  const transaction = {
    findTournamentOperatorAccount: async () => ({ internalId: 9, isAdministrator: true }),
    findActiveAdministratorAccount: async () => 9,
    findTournamentForUpdate: async () => tournament,
    findTournament: async () => tournament,
    loadParticipants: async () => participants,
    loadGroups: async () => groups,
    loadGroupRaces: async () => races,
    loadManualScores: async () => manual,
    loadLifecycle: async () => [],
    loadCompletedTournamentTimes: async () => [],
    ratingSnapshot: async () => new Map(),
    loadStationCables: async () => [],
    resolvePlayers: async (ids: readonly string[]) => new Map(participants.filter((p) => ids.includes(p.player.playerId)).map((p) => [p.player.playerId, p.player])),
    upsertParticipant: async (input) => {
      participants = participants.map((p) => p.player.internalId !== input.playerInternalId ? p : {
        ...p, attendance: input.attendance, hasSwitch1: input.hasSwitch1, hasSwitch2: input.hasSwitch2,
        seedRank: input.seedRank, seedScore: input.seedScore,
      });
    },
    updateTournament: async (input) => { tournament = { ...tournament, ...input }; },
    appendLifecycle: async (input) => { lifecycle.push(input); },
    deleteGroupsForStage: async (_id, stage) => { groups = groups.filter((group) => group.stage !== stage); },
    insertGroup: async (input) => {
      const internalId = ++sequence;
      groups.push({ ...input, internalId, locked: false, manualScoreSegments: 1, tieBreakOrders: [], members: [], stations: [] });
      return internalId;
    },
    replaceGroupMembers: async (groupInternalId, members) => {
      groups = groups.map((group) => group.internalId !== groupInternalId ? group : {
        ...group, members: members.map((member) => ({
          playerId: participants.find((p) => p.player.internalId === member.playerInternalId)!.player.playerId,
          seatOrder: member.seatOrder, character: null,
          station: member.stationOwnerInternalId === null ? null : {
            ownerPlayerId: participants.find((p) => p.player.internalId === member.stationOwnerInternalId)!.player.playerId,
            switchType: member.stationSwitchType!, seatNumber: member.seatNumber!,
          },
        })),
      });
    },
    replaceGroupStations: async (groupInternalId, stations) => {
      groups = groups.map((group) => group.internalId !== groupInternalId ? group : {
        ...group, stations: stations.map((station) => ({
          slotIndex: station.slotIndex,
          ownerPlayerId: participants.find((p) => p.player.internalId === station.ownerInternalId)!.player.playerId,
          switchType: station.switchType,
        })),
      });
    },
    updateGroupMemberStations: async (groupInternalId, members) => {
      groups = groups.map((group) => group.internalId !== groupInternalId ? group : {
        ...group, members: group.members.map((member) => {
          const change = members.find((row) => participants.find((p) => p.player.internalId === row.playerInternalId)?.player.playerId === member.playerId)!;
          return { ...member, station: change.stationOwnerInternalId === null ? null : {
            ownerPlayerId: participants.find((p) => p.player.internalId === change.stationOwnerInternalId)!.player.playerId,
            switchType: change.stationSwitchType!, seatNumber: change.seatNumber!,
          } };
        }),
      });
    },
    updateGroup: async (input) => {
      groups = groups.map((group) => group.internalId !== input.groupInternalId ? group : { ...group, ...input });
    },
    reopenAcceptedEvidenceForStage: vi.fn(async () => 0),
    clearGroupResultsForStage: vi.fn(async (_id, stage) => {
      const ids = new Set(groups.filter((group) => group.stage === stage).map((group) => group.internalId));
      races = races.filter((race) => !ids.has(race.groupInternalId));
      manual = manual.filter((row) => !ids.has(row.groupInternalId));
    }),
  } satisfies Partial<TournamentOperationTransaction>;
  const snapshot = () => structuredClone({ tournament, participants, groups, races, manual, lifecycle });
  const service = new Service({
    repository: { transaction: async (work: (tx: TournamentOperationTransaction) => Promise<unknown>) => {
      const before = snapshot();
      try { return await work(transaction as unknown as TournamentOperationTransaction); }
      catch (error) {
        ({ tournament, participants, groups, races, manual, lifecycle } = before);
        throw error;
      }
    } } as never,
    raceResults: {} as never, publications: {} as never, rating: {} as never,
    ids: { newTournamentId: () => id, newGroupId: () => `tournament_group.synthetic_final_${++sequence}` },
    clock: { nowMs: () => 3000 },
  });
  return { service, snapshot, transaction,
    replaceParticipants: (next: ParticipantRecord[]) => { participants = next; },
    replaceManual: (next: ManualScoreRecord[]) => { manual = next; },
  };
}

function reviewedLayout(groups: GroupRecord[]) {
  return groups.map((group) => ({ name: group.name,
    seats: group.members.map((member) => ({ playerId: member.playerId,
      stationOwnerPlayerId: member.station?.ownerPlayerId ?? null,
      switchType: member.station?.switchType ?? null, seatNumber: member.station?.seatNumber ?? null,
    })),
    stations: group.stations.map((station) => ({ stationOwnerPlayerId: station.ownerPlayerId, switchType: station.switchType })),
  }));
}

describe("seating recovery preserves accepted qualifier results", () => {
  it("advances the reviewed TN13 shape with 36 racers, 18 consoles and 36 accepted qualifier races", async () => {
    const { service, snapshot } = fixture(TournamentOperationService, true);
    const before = snapshot();
    const document = await service.generateGroups(actor, id, { expectedRevision: 12, stage: "final" });
    expect(document.summary.workflowStep).toBe(7);
    expect(document.summary.presentCount).toBe(36);
    expect(document.stations).toHaveLength(18);
    expect(document.groups.filter((group) => group.stage === "final").map((group) => group.members.length)).toEqual([12, 12, 12]);
    expect(document.groups.filter((group) => group.stage === "final").flatMap((group) => group.members).every((member) => member.station !== undefined)).toBe(true);
    expect(snapshot().groups.filter((group) => group.stage === "qualifier")).toEqual(before.groups);
    expect(snapshot().races).toEqual(before.races);
    expect(snapshot().races).toHaveLength(36);
    expect(snapshot().manual).toEqual([]);
    expect(snapshot().participants[36]).toMatchObject({ attendance: "absent", hasSwitch1: true });
  });
  it("recovers a legacy borrowed-Switch layout by explicit equipment review without losing accepted scores", async () => {
    const { service, snapshot } = fixture();
    const before = snapshot();
    await expect(service.generateGroups(actor, id, { expectedRevision: 12, stage: "final" })).rejects.toMatchObject({ code: "conflict" });
    const reviewed = await service.importGroupLayout(actor, id, { expectedRevision: 12, stage: "qualifier",
      groups: reviewedLayout(before.groups), equipmentCorrectionReason: "Confirmed both physical Switches are available",
    });
    expect(reviewed.summary.workflowStep).toBe(6);
    expect(snapshot().groups).toEqual(before.groups);
    expect(snapshot().races).toEqual(before.races);
    expect(snapshot().participants[4]).toMatchObject({ attendance: "absent", hasSwitch2: true });
    const document = await service.generateGroups(actor, id, { expectedRevision: 13, stage: "final" });
    expect(document.summary.workflowStep).toBe(7);
    expect(snapshot().groups.filter((group) => group.stage === "qualifier")).toEqual(before.groups);
    expect(snapshot().races).toEqual(before.races);
    expect(snapshot().manual).toEqual(before.manual);
    expect(document.groups.find((group) => group.stage === "final")?.members.every((member) => member.station !== undefined)).toBe(true);
    expect(document.stations).toHaveLength(2);
    expect(snapshot().lifecycle.some((row) => String(row.detail).includes("equipment_review;stage=qualifier;results=preserved"))).toBe(true);
  });

  it("counts a declared lent Switch independently of its owner's attendance", async () => {
    const { service, snapshot, replaceParticipants } = fixture();
    replaceParticipants(snapshot().participants.map((p, index) => index === 4 ? { ...p, hasSwitch2: true } : p));
    const document = await service.generateGroups(actor, id, { expectedRevision: 12, stage: "final" });
    expect(document.summary.workflowStep).toBe(7);
    expect(document.summary.presentCount).toBe(4);
    expect(document.stations).toHaveLength(2);
  });

  it("preserves manual totals and character metadata during an actual console replacement", async () => {
    const { service, snapshot, replaceManual } = fixture();
    replaceManual([{ groupInternalId: 11, playerId: "player.synthetic_equipment_1", segmentNumber: 1, points: 22 }]);
    const before = snapshot();
    const layout = reviewedLayout(before.groups);
    layout[0]!.seats = layout[0]!.seats.map((seat) => seat.switchType === "ns2"
      ? { ...seat, stationOwnerPlayerId: "player.synthetic_equipment_2", switchType: "ns1" } : seat);
    layout[0]!.stations[1] = { stationOwnerPlayerId: "player.synthetic_equipment_2", switchType: "ns1" };
    await service.importGroupLayout(actor, id, { expectedRevision: 12, stage: "qualifier", groups: layout,
      equipmentCorrectionReason: "Replaced the broken borrowed console with a spare" });
    const after = snapshot();
    expect(after.groups[0]!.members.map((member) => [member.playerId, member.seatOrder, member.character]))
      .toEqual(before.groups[0]!.members.map((member) => [member.playerId, member.seatOrder, member.character]));
    expect(after.groups[0]!.members[2]!.station).toMatchObject({ ownerPlayerId: "player.synthetic_equipment_2", switchType: "ns1" });
    expect(after.races).toEqual(before.races);
    expect(after.manual).toEqual(before.manual);
    expect(after.tournament.workflowStep).toBe(6);
    expect(after.groups[0]!.locked).toBe(true);
  });

  it("rejects a correction that changes membership or repeats a Switch seat and keeps all prior state", async () => {
    const { service, snapshot } = fixture();
    const before = snapshot();
    const layout = reviewedLayout(before.groups);
    layout[0]!.seats.reverse();
    await expect(service.importGroupLayout(actor, id, { expectedRevision: 12, stage: "qualifier",
      groups: layout, equipmentCorrectionReason: "Synthetic attempted membership change",
    })).rejects.toThrow("preserve every group's Players and order");
    expect(snapshot()).toEqual(before);
    const duplicate = reviewedLayout(before.groups);
    duplicate[0]!.seats[1] = { ...duplicate[0]!.seats[0]!, playerId: duplicate[0]!.seats[1]!.playerId };
    await expect(service.importGroupLayout(actor, id, { expectedRevision: 12, stage: "qualifier",
      groups: duplicate, equipmentCorrectionReason: "Synthetic duplicate seat",
    })).rejects.toThrow("same Switch seat twice");
    expect(snapshot()).toEqual(before);
  });

  it("rejects stale correction without changing scores or availability", async () => {
    const { service, snapshot } = fixture();
    const before = snapshot();
    await expect(service.importGroupLayout(actor, id, { expectedRevision: 11, stage: "qualifier",
      groups: reviewedLayout(before.groups), equipmentCorrectionReason: "Stale synthetic review",
    })).rejects.toThrow("the tournament changed");
    expect(snapshot()).toEqual(before);
  });

  it("does not partially update a failed final draw or its seeds", async () => {
    const { service, snapshot, transaction } = fixture();
    transaction.loadGroups = async () => snapshot().groups.map((group) => ({ ...group,
      stations: group.stations.slice(0, 1), members: group.members.map((member, index) => index < 2 ? member : { ...member, station: null }),
    }));
    const before = snapshot();
    await expect(service.generateGroups(actor, id, { expectedRevision: 12, stage: "final" })).rejects.toMatchObject({ code: "conflict" });
    expect(snapshot()).toEqual(before);
  });

  it("keeps the existing result-bearing layout unlock safeguard", async () => {
    const { service, snapshot } = fixture();
    const before = snapshot();
    await expect(service.lockGroups(actor, id, { expectedRevision: 12, stage: "qualifier", locked: false }))
      .rejects.toThrow("groups with entered races stay locked");
    expect(snapshot()).toEqual(before);
  });

  const deployedPath = resolve("../../artifacts/deploy257/api/dist/tournaments/tournament-operation-service.js");
  it.skipIf(!existsSync(deployedPath))("records that the immutable deploy257 implementation reproduces the borrowed-console rejection", async () => {
    const deployed = await import(pathToFileURL(deployedPath).href) as { TournamentOperationService: typeof TournamentOperationService };
    const { service, snapshot } = fixture(deployed.TournamentOperationService);
    const before = snapshot();
    await expect(service.generateGroups(actor, id, { expectedRevision: 12, stage: "final" }))
      .rejects.toThrow("2 Nintendo Switches are required for 4 present Players");
    expect(snapshot()).toEqual(before);
  });
  it.skipIf(!existsSync(deployedPath))("reproduces deploy257's 17/18-console failure with the reviewed 36-racer shape", async () => {
    const deployed = await import(pathToFileURL(deployedPath).href) as { TournamentOperationService: typeof TournamentOperationService };
    const { service, snapshot } = fixture(deployed.TournamentOperationService, true);
    const before = snapshot();
    await expect(service.generateGroups(actor, id, { expectedRevision: 12, stage: "final" }))
      .rejects.toThrow("18 Nintendo Switches are required for 36 present Players");
    expect(snapshot()).toEqual(before);
  });
});
