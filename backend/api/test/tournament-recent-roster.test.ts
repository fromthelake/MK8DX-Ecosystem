import { describe, expect, it, vi } from "vitest";

import {
  TournamentOperationService,
  type ParticipantRecord,
  type PlayerRecord,
  type TournamentRecord,
} from "../src/tournaments/tournament-operation-service.js";

const tournament: TournamentRecord = {
  internalId: 44,
  directorInternalId: 9,
  tournamentId: "tournament.synthetic_recent_roster",
  name: "TN14",
  seriesLabel: "TN",
  editionNumber: 14,
  eventDate: "2026-08-26",
  startAtMs: 1_900_000_000_000,
  timezone: "Europe/Amsterdam",
  stage: "setup",
  ownerSeatingMode: "owner_strict",
  qualifierTieBreakMode: "sp",
  finalTieBreakMode: "sp",
  workflowStep: 2,
  qualifierRounds: true,
  maxParticipants: null,
  revision: 2,
  seedOrder: "ranked",
  placementStrategy: "balanced",
  publicResults: false,
  affectsRating: false,
  publicationId: null,
  publicationVisibility: null,
  finalizedAtMs: null,
  createdAtMs: 1_900_000_000_000,
  updatedAtMs: 1_900_000_000_000,
};
const player = (internalId: number, name: string): PlayerRecord => ({
  internalId,
  playerId: `player.${name.toLowerCase()}`,
  username: name.toLowerCase(),
  displayName: name,
  visibility: "public",
  active: true,
});

describe("recent TN roster action", () => {
  it("adds missing latest-three TN4+ Players as absent in current TrueSkill order", async () => {
    const existing = player(1, "Ben");
    const ace = player(2, "Ace");
    const floyd = player(3, "Floyd");
    const participants: ParticipantRecord[] = [{
      player: existing, attendance: "present", hasSwitch1: true, hasSwitch2: false,
      seedScore: 35, seedRank: 2, lastPresentAtMs: null,
    }];
    const writes: Array<{ playerInternalId: number; attendance: string; seedRank: number | null }> = [];
    const transaction = {
      findActiveAdministratorAccount: vi.fn(async () => 9),
      findTournamentOperatorAccount: vi.fn(async () => ({ internalId: 9, isAdministrator: true })),
      listSelectableDirectors: vi.fn(async () => []),
      findTournamentForUpdate: vi.fn(async () => tournament),
      findTournament: vi.fn(async () => ({ ...tournament, revision: 3 })),
      loadGroups: vi.fn(async () => []),
      // ADR-0177 decision 16: fewer than three completed Tournaments, so the
      // window cannot call anybody inactive yet.
      loadCompletedTournamentTimes: vi.fn(async () => []),
      loadParticipants: vi.fn(async () => [...participants].sort((left, right) =>
        (left.seedRank ?? Number.MAX_SAFE_INTEGER) - (right.seedRank ?? Number.MAX_SAFE_INTEGER))),
      loadRecentPresentPlayers: vi.fn(async () => [floyd, existing, ace]),
      ratingSnapshot: vi.fn(async () => new Map([
        [ace.internalId, { score: 42, rank: 1 }],
        [floyd.internalId, { score: 31, rank: 8 }],
      ])),
      upsertParticipant: vi.fn(async (input: { playerInternalId: number; attendance: string; seedRank: number | null }) => {
        writes.push(input);
        const added = input.playerInternalId === ace.internalId ? ace : floyd;
        participants.push({
          player: added, attendance: "absent", hasSwitch1: false, hasSwitch2: false,
          seedScore: input.playerInternalId === ace.internalId ? 42 : 31,
          seedRank: input.seedRank, lastPresentAtMs: null,
        });
      }),
      updateTournament: vi.fn(async () => undefined),
      appendLifecycle: vi.fn(async () => undefined),
      loadGroupRaces: vi.fn(async () => []),
      loadManualScores: vi.fn(async () => []),
      loadLifecycle: vi.fn(async () => []),
    };
    const service = new TournamentOperationService({
      repository: { transaction: async (work: (value: typeof transaction) => unknown) => work(transaction) } as never,
      raceResults: {} as never,
      publications: {} as never,
      rating: {} as never,
      ids: { newTournamentId: () => "unused", newGroupId: () => "unused" },
      clock: { nowMs: () => 1_900_000_001_000 },
    });

    const document = await service.addRecentParticipants(
      { role: "administrator", userAccountId: "user_account.owner" },
      tournament.tournamentId,
      { expectedRevision: 2 },
    );

    expect(writes.map((write) => [write.playerInternalId, write.attendance, write.seedRank]))
      .toEqual([[ace.internalId, "absent", 1], [floyd.internalId, "absent", 8]]);
    expect(document.participants.map((row) => [row.displayName, row.attendance, row.seedRank]))
      .toEqual([["Ace", "absent", 1], ["Ben", "present", 2], ["Floyd", "absent", 8]]);
    expect(transaction.appendLifecycle).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "recent_participants_added",
      detail: "added=2;source=latest_three_tn4_plus",
    }));
  });
});
