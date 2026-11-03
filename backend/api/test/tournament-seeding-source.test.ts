// ADR-0221 per-night options on the operation service, against a fake: the
// seeding source decides the qualifier draw's order (community rating, the
// Director's own nights, by hand, random) and is the one seeding field
// clients see, and "only verified Players" is a night setting
// fixed once the night is finalized.

import { describe, expect, it } from "vitest";

import {
  TournamentOperationService,
  type GroupRecord,
  type ParticipantRecord,
  type TournamentOperationTransaction,
  type TournamentRecord,
} from "../src/tournaments/tournament-operation-service.js";
import type { DirectorNightRace } from "../src/rating/director-night-ratings.js";

const actor = { role: "administrator" as const, userAccountId: "user_account.synthetic_director" };
const id = "tournament.synthetic_seeding_source";

function fixture(overrides: Partial<TournamentRecord> = {}, directorNights: readonly DirectorNightRace[] = []) {
  let tournament: TournamentRecord = {
    internalId: 1, tournamentId: id, name: "Synthetic seeding night",
    editionNumber: null, eventDate: "2026-11-02", stage: "setup", workflowStep: 2,
    qualifierRounds: true, maxParticipants: null, revision: 3, seedOrder: "ranked",
    placementStrategy: "minimal_move", ownerSeatingMode: "owner_soft",
    qualifierTieBreakMode: "sp", finalTieBreakMode: "sp", publicResults: true,
    affectsRating: true, publicationId: null, publicationVisibility: null,
    directorInternalId: 9, finalizedAtMs: null, createdAtMs: 1000, updatedAtMs: 2000,
    ...overrides,
  };
  // 24 present racers: community rank = number, names run the other way
  // (racer 1 is "Zed 01"), so every source gives a different first group.
  let participants: ParticipantRecord[] = Array.from({ length: 24 }, (_, index) => ({
    player: { internalId: index + 1, playerId: `player.synthetic_seed_${index + 1}`,
      username: `synthetic_seed_${index + 1}`,
      displayName: `${String.fromCharCode(90 - Math.floor(index / 2))}ed ${String(index + 1).padStart(2, "0")}`,
      visibility: "public", active: true },
    attendance: "present", hasSwitch1: index % 2 === 0, hasSwitch2: false,
    seedRank: index + 1, seedScore: 40 - index, lastPresentAtMs: 1000,
  }));
  let groups: GroupRecord[] = [];
  let sequence = 50;
  const updates: Record<string, unknown>[] = [];
  const transaction = {
    findTournamentOperatorAccount: async () => ({ internalId: 9, isAdministrator: true }),
    findActiveAdministratorAccount: async () => 9,
    findTournamentForUpdate: async () => tournament,
    findTournament: async () => tournament,
    loadParticipants: async () => participants,
    loadGroups: async () => groups,
    loadGroupRaces: async () => [],
    loadManualScores: async () => [],
    loadLifecycle: async () => [],
    loadCompletedTournamentTimes: async () => [],
    // The community rating: rank = racer number.
    ratingSnapshot: async (ids: readonly number[]) => new Map(ids.map((internalId) => [internalId, { score: 40 - internalId, rank: internalId }])),
    loadDirectorNightRaces: async () => directorNights,
    loadStationCables: async () => [],
    resolvePlayers: async () => new Map(),
    upsertParticipant: async (input: { playerInternalId: number; seedRank: number | null; seedScore: number | null }) => {
      participants = participants.map((p) => p.player.internalId !== input.playerInternalId ? p : {
        ...p, seedRank: input.seedRank, seedScore: input.seedScore,
      });
    },
    updateTournament: async (input: Record<string, unknown>) => {
      updates.push(input);
      tournament = { ...tournament, ...input } as TournamentRecord;
    },
    appendLifecycle: async () => undefined,
    deleteGroupsForStage: async () => { groups = []; },
    insertGroup: async (input: Omit<GroupRecord, "internalId" | "locked" | "manualScoreSegments" | "tieBreakOrders" | "members" | "stations">) => {
      const internalId = ++sequence;
      groups.push({ ...input, internalId, locked: false, manualScoreSegments: 1, tieBreakOrders: [], members: [], stations: [] });
      return internalId;
    },
    replaceGroupMembers: async (groupInternalId: number, members: readonly { playerInternalId: number; seatOrder: number }[]) => {
      groups = groups.map((group) => group.internalId !== groupInternalId ? group : {
        ...group, members: members.map((member) => ({
          playerId: participants.find((p) => p.player.internalId === member.playerInternalId)!.player.playerId,
          seatOrder: member.seatOrder, character: null, station: null,
        })),
      });
    },
    replaceGroupStations: async () => undefined,
  } satisfies Partial<TournamentOperationTransaction>;
  const service = new TournamentOperationService({
    repository: { transaction: async (work: (tx: TournamentOperationTransaction) => Promise<unknown>) =>
      work(transaction as unknown as TournamentOperationTransaction) } as never,
    raceResults: {} as never, publications: {} as never, rating: {} as never,
    ids: { newTournamentId: () => id, newGroupId: () => `tournament_group.synthetic_seed_${++sequence}` },
    clock: { nowMs: () => 3000 },
    random: () => 0.5,
  });
  const firstGroup = () => groups.find((group) => group.sequence === 1)!.members
    .map((member) => Number(member.playerId.split("_").at(-1))).sort((a, b) => a - b);
  return { service, firstGroup, updates, tournament: () => tournament };
}

const twelve = (from: number) => Array.from({ length: 12 }, (_, index) => from + index);

describe("the night's seeding source (ADR-0221)", () => {
  it("draws by the community rating, as before", async () => {
    const { service, firstGroup } = fixture();
    await service.generateGroups(actor, id, { expectedRevision: 3, stage: "qualifier" });
    expect(firstGroup()).toEqual(twelve(1));
  });

  it("draws by a rating from the Director's own nights only", async () => {
    // In the Director's nights racers 13-24 always beat racers 1-12.
    const losers = twelve(1);
    const winners = twelve(13);
    const nights: DirectorNightRace[] = [1_000, 2_000, 3_000].map((heldAtMs) => ({
      heldAtMs,
      placements: [...winners, ...losers].map((playerInternalId, index) => ({ playerInternalId, finishPosition: index + 1 })),
    }));
    const { service, firstGroup } = fixture({ seedingSource: "director_nights" }, nights);
    await service.generateGroups(actor, id, { expectedRevision: 3, stage: "qualifier" });
    expect(firstGroup()).toEqual(twelve(13));
  });

  it("puts Players the Director's nights never rated last", async () => {
    const nights: DirectorNightRace[] = [{
      heldAtMs: 1_000,
      placements: [24, 23].map((playerInternalId, index) => ({ playerInternalId, finishPosition: index + 1 })),
    }];
    const { service, firstGroup } = fixture({ seedingSource: "director_nights" }, nights);
    await service.generateGroups(actor, id, { expectedRevision: 3, stage: "qualifier" });
    expect(firstGroup()).toContain(24);
    expect(firstGroup()).toContain(23);
  });

  it("draws by hand without any rating (by name), leaving the arranging to the Director", async () => {
    const { service, firstGroup } = fixture({ seedingSource: "manual" });
    await service.generateGroups(actor, id, { expectedRevision: 3, stage: "qualifier" });
    // Names run from "Zed 01" (racer 1) down to "Oed 24": the first twelve by name are racers 13-24.
    expect(firstGroup()).toEqual(twelve(13));
  });

  it("reports the source as the one seeding field (no seedOrder for old clients, 2026-11-02)", async () => {
    const { service } = fixture({ seedingSource: "director_nights" });
    const document = await service.loadForAdministrator(actor, id);
    expect(document.summary).toMatchObject({ seedingSource: "director_nights", verifiedOnly: false });
    expect(document.summary).not.toHaveProperty("seedOrder");
    const random = fixture({ seedOrder: "random", seedingSource: "manual" });
    expect((await random.service.loadForAdministrator(actor, id)).summary)
      .toMatchObject({ seedingSource: "random" });
  });
});

describe("saving the night's settings (ADR-0221)", () => {
  it("stores a named source with the matching seedOrder", async () => {
    const { service, updates } = fixture();
    await service.update(actor, id, { expectedRevision: 3, seedingSource: "director_nights", verifiedOnly: true });
    expect(updates.at(-1)).toMatchObject({ seedOrder: "ranked", seedingSource: "director_nights", verifiedOnly: true });
    await service.update(actor, id, { expectedRevision: 4, seedingSource: "random" });
    expect(updates.at(-1)).toMatchObject({ seedOrder: "random", seedingSource: null });
    await service.update(actor, id, { expectedRevision: 5, seedingSource: "community_rating" });
    expect(updates.at(-1)).toMatchObject({ seedOrder: "ranked", seedingSource: null });
  });

  it("keeps the Director's choice when another setting is saved without a source", async () => {
    const { service, updates, tournament } = fixture({ seedingSource: "manual" });
    await service.update(actor, id, { expectedRevision: 3, placementStrategy: "balanced" });
    expect(updates.at(-1)).not.toHaveProperty("seedingSource");
    expect(updates.at(-1)).not.toHaveProperty("seedOrder");
    expect(tournament().seedingSource).toBe("manual");
  });

  it("fixes 'only verified Players' once the night is finalized", async () => {
    const { service } = fixture({ stage: "finalized", finalizedAtMs: 2500 });
    await expect(service.update(actor, id, { expectedRevision: 3, verifiedOnly: true })).rejects.toMatchObject({ code: "conflict" });
  });
});
