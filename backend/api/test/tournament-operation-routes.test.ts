import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import ExcelJS from "exceljs";

import { buildApp } from "../src/app.js";
import type { IdentityReadRepository } from "../src/identity/types.js";
import {
  TournamentOperationError,
  type PublicTournamentEvent,
  type TournamentDocument,
  type TournamentOperationService,
  type TournamentSummary,
} from "../src/tournaments/tournament-operation-service.js";

const identityRepository: IdentityReadRepository = {
  async findPublicPlayerById() { return null; },
  async findUserAccountSummaryById() { return null; },
  async findPlayerClaimSummaryById() { return null; },
};
const tournamentId = "tournament.synthetic_event_0001";
const groupId = "tournament_group.synthetic_group_0001";
const playerId = "player.synthetic_operation_01";
const summary: TournamentSummary = {
  tournamentId,
  name: "Synthetic Night",
  editionNumber: 13,
  eventDate: "2026-08-22",
  stage: "qualifiers",
  seedingSource: "community_rating",
  verifiedOnly: false,
  placementStrategy: "balanced",
  ownerSeatingMode: "owner_strict",
  qualifierTieBreakMode: "sp",
  finalTieBreakMode: "sp",
  workflowStep: 5,
  qualifierRounds: true,
  revision: 3,
  participantCount: 2,
  presentCount: 2,
  publicResults: true,
  affectsRating: true,
  updatedAtMs: 1_900_000_000_000,
};
const document: TournamentDocument = {
  schemaVersion: "mk8dx.tournament-operation.v1",
  summary,
  participants: [{
    playerId, username: "racer", displayName: "Synthetic Racer", attendance: "present",
    hasSwitch1: true, hasSwitch2: false, inactive: false, isNew: false, seedScore: 27.5, seedRank: 4,
  }],
  stations: [{ ownerPlayerId: playerId, ownerDisplayName: "Synthetic Racer", switchType: "ns1" }],
  groups: [{
    groupId, stage: "qualifier", sequence: 1, name: "Groep 1", locked: true, manualScoreSegments: 1,
    stations: [],
    members: [{
      playerId, displayName: "Synthetic Racer", seatOrder: 1,
      station: { ownerPlayerId: playerId, ownerDisplayName: "Synthetic Racer", switchType: "ns1", seatNumber: 1 },
    }],
    races: [{
      raceNumber: 1, raceResultId: "tournament_race_result.synthetic_group_0001_r01", revision: 1,
      scoringSegment: 1, sourceKind: "tournament_live",
      trackId: "track.mario_kart_stadium", mode: 150, countsTowardStandings: true,
      placements: [{ finishPosition: 1, playerId, displayName: "Synthetic Racer", racePoints: 15 }],
    }],
    manualScores: [{ playerId, segmentPoints: [40, null] }],
    standings: { source: "races", rows: [{
      rank: 1, playerId, displayName: "Synthetic Racer", points: 15, races: 1, wins: 1, bestRace: 15, complete: true,
    }], tieGroups: [] },
  }],
  overall: [{ placement: 1, playerId, displayName: "Synthetic Racer", groupName: "Groep 1", groupRank: 1, points: 15 }],
  lifecycle: [{ sequence: 1, eventType: "created", detail: "Synthetic Night", occurredAtMs: 1_900_000_000_000 }],
};
const publicEvent: PublicTournamentEvent = {
  schemaVersion: "mk8dx.public-tournament-event.v1",
  tournamentId, name: "Synthetic Night", stage: "finalized", finalizedAtMs: 1_900_000_000_000,
  publicResults: true, participantCount: 2,
  groups: [{ groupId, stage: "final", sequence: 1, name: "Kampioen", tierKey: "champion",
    seating: [{
      displayName: "Private Racer", seatOrder: 0,
      stationOwnerDisplayName: "Ben", switchType: "ns2", seatNumber: 1,
    }],
    standings: [{ rank: 1, displayName: "Private Racer", points: 15, races: 1, wins: 1, complete: true }],
    races: [{ raceNumber: 1, trackId: "track.mario_kart_stadium", countsTowardStandings: true,
      placements: [{ finishPosition: 1, displayName: "Private Racer", racePoints: 15 }] }],
  }],
  overall: [{ placement: 1, displayName: "Private Racer", groupName: "Kampioen", groupRank: 1, points: 15 }],
};

const apps: FastifyInstance[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

type Service = NonNullable<Parameters<typeof buildApp>[0]["tournamentOperations"]>["service"];

async function setup(role: "administrator" | "account" | "anonymous" = "administrator") {
  const service = {
    listForAdministrator: vi.fn(async () => [summary]),
    listSelectableDirectors: vi.fn(async () => ({
      canActForOthers: true,
      directors: [
        { userAccountId: "user_account.synthetic_admin", displayName: "Ben", isAdministrator: true },
        { userAccountId: "user_account.synthetic_director", displayName: "Evan", isAdministrator: false },
      ],
    })),
    loadForAdministrator: vi.fn(async () => document),
    listPublic: vi.fn(async () => [{ tournamentId, name: "Synthetic Night", stage: "finalized" as const, participantCount: 2, updatedAtMs: 1 }]),
    loadPublic: vi.fn(async (): Promise<PublicTournamentEvent | null> => publicEvent),
    loadPublicPlacements: vi.fn(async () => [{
      tournamentId, fieldSize: 2, placements: [{ playerId, placement: 1 }],
    }]),
    create: vi.fn(async () => summary),
    update: vi.fn(async () => summary),
    setWorkflowStep: vi.fn(async () => document),
    setParticipant: vi.fn(async () => document),
    importParticipants: vi.fn(async () => document),
    enterRaces: vi.fn(async () => document),
    addHistoricalParticipants: vi.fn(async () => document),
    addRecentParticipants: vi.fn(async () => document),
    removeParticipant: vi.fn(async () => document),
    generateGroups: vi.fn(async () => document),
    updateGroups: vi.fn(async () => document),
    importGroupLayout: vi.fn(async () => document),
    lockGroups: vi.fn(async () => document),
    enterRace: vi.fn(async () => document),
    attachRaces: vi.fn(async () => document),
    setManualScores: vi.fn(async () => document),
    finalizationPreview: vi.fn(async () => ({
      schemaVersion: "mk8dx.tournament-finalization-preview.v1" as const,
      tournamentId, name: "Synthetic Night", revision: 3, presentCount: 2, qualifierGroups: 1, finalGroups: 0,
      raceCount: 1, rateableRaceCount: 1, manualOnlyGroups: 0, incompleteGroups: 0,
      publicResults: true, affectsRating: true, alreadyFinalized: false, warnings: ["No final groups were generated; the overall result follows the qualifier groups."],
      overall: document.overall,
    })),
    finalize: vi.fn(async () => ({
      tournamentId, revision: 4, publicationId: "tournament_publication.synthetic_event_0001", publicResults: true, affectsRating: true,
      rating: { appliedRaces: 1, skippedRaces: 0, alreadyApplied: false },
    })),
    setResultsVisibility: vi.fn(async () => summary),
    recordIncident: vi.fn(async () => document),
    deleteDraft: vi.fn(async () => undefined),
    rosterPlayerCandidates: vi.fn(async () => [{
      name: "Mal",
      sameNameInOwnNights: true,
      candidates: [{
        playerId: "player.mal", username: "mal", displayName: "Mal", matchedBy: "display_name" as const,
        claimed: true, inTournament: false, nights: 12, nightsWithDirector: 3,
        lastNightName: "TN13", lastNightDate: "2026-10-04", directorNames: ["Ben"],
        characterKey: "character.yoshi", characterLabel: "Yoshi",
      }, {
        playerId: "player.mal_2", username: "mal-2", displayName: "Malie", matchedBy: "alias" as const,
        aliasText: "Mal", aliasScope: "director" as const,
        claimed: false, inTournament: true, nights: 0, nightsWithDirector: 0, directorNames: [],
      }],
    }]),
    rememberRosterAliases: vi.fn(async () => ({ created: [{ playerId: "player.mal", aliasText: "Malie" }], existing: 1 })),
  } satisfies Record<keyof Pick<TournamentOperationService, "listForAdministrator">, unknown> & Record<string, unknown>;
  const createRosterPlayers = vi.fn(async () => [
    { playerId: "player.synthetic_roster_new", username: "roster_new", displayName: "Roster New" },
  ]);
  const app = await buildApp({
    identityRepository,
    resolveActor: async () => role === "anonymous"
      ? { role: "anonymous" as const }
      : { role, userAccountId: "user_account.synthetic_admin" },
    tournamentOperations: {
      service: service as unknown as Service,
      csrfVerifier: { verify: (_actor, token) => token === "valid-csrf" },
    },
    playerOnboarding: {
      service: {
        createOwnPlayer: vi.fn(async () => { throw new Error("not in this test"); }),
        createPlayerForAdministrator: vi.fn(async () => { throw new Error("not in this test"); }),
        createRosterPlayers,
      } as never,
      csrfVerifier: { verify: (_actor, token) => token === "valid-csrf" },
    },
  });
  apps.push(app);
  return { app, service, createRosterPlayers };
}

describe("tournament operation routes", () => {
  it("lists and loads tournaments for an administrator with every section intact", async () => {
    const { app } = await setup();
    const list = await app.inject({ method: "GET", url: "/v1/administrator/tournaments" });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({ schemaVersion: "mk8dx.administrator-tournaments.v1", tournaments: [summary] });
    const loaded = await app.inject({ method: "GET", url: `/v1/administrator/tournaments/${tournamentId}` });
    expect(loaded.statusCode).toBe(200);
    // The serializer must not silently drop anything the operator board renders.
    expect(loaded.json()).toEqual(document);
  });

  it("serves Step 0 selectable directors and threads acting-as into list and create", async () => {
    const { app, service } = await setup();
    const directors = await app.inject({ method: "GET", url: "/v1/administrator/tournament-directors" });
    expect(directors.statusCode).toBe(200);
    expect(directors.json()).toEqual({
      schemaVersion: "mk8dx.administrator-tournament-directors.v1",
      canActForOthers: true,
      directors: [
        { userAccountId: "user_account.synthetic_admin", displayName: "Ben", isAdministrator: true },
        { userAccountId: "user_account.synthetic_director", displayName: "Evan", isAdministrator: false },
      ],
    });

    const filtered = await app.inject({
      method: "GET",
      url: "/v1/administrator/tournaments?director=user_account.synthetic_director",
    });
    expect(filtered.statusCode).toBe(200);
    expect(service.listForAdministrator).toHaveBeenLastCalledWith(
      expect.anything(),
      { directorUserAccountId: "user_account.synthetic_director" },
    );
    // Without the query the options stay absent so the service acts as self.
    await app.inject({ method: "GET", url: "/v1/administrator/tournaments" });
    expect(service.listForAdministrator).toHaveBeenLastCalledWith(expect.anything(), undefined);
    const malformed = await app.inject({
      method: "GET",
      url: "/v1/administrator/tournaments?director=not-an-account",
    });
    expect(malformed.statusCode).toBe(400);

    const created = await app.inject({
      method: "POST", url: "/v1/tournaments",
      headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: {
        name: "Night", startAtMs: 1_700_000_000_000, timezone: "Europe/Amsterdam",
        directorUserAccountId: "user_account.synthetic_director",
      },
    });
    expect(created.statusCode).toBe(200);
    expect(service.create).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ directorUserAccountId: "user_account.synthetic_director" }),
    );
  });

  it("lists roster candidates with context and remembers a Director's names (ADR-0218)", async () => {
    const { app, service, createRosterPlayers } = await setup();
    const listed = await app.inject({
      method: "POST", url: "/v1/administrator/roster-player-candidates",
      headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: { names: ["Mal"], tournamentId, partial: true },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().schemaVersion).toBe("mk8dx.roster-player-candidates.v1");
    expect(listed.json().entries[0].candidates.map((entry: { username: string }) => entry.username)).toEqual(["mal", "mal-2"]);
    expect(service.rosterPlayerCandidates).toHaveBeenLastCalledWith(
      expect.anything(), { names: ["Mal"], tournamentId, partial: true },
    );
    const unproven = await app.inject({
      method: "POST", url: "/v1/administrator/roster-player-candidates", payload: { names: ["Mal"] },
    });
    expect(unproven.statusCode).toBe(400);

    const remembered = await app.inject({
      method: "POST", url: `/v1/tournaments/${tournamentId}/roster-aliases`,
      headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: { aliases: [{ playerId: "player.mal", name: "Malie" }] },
    });
    expect(remembered.statusCode).toBe(200);
    expect(remembered.json()).toEqual({
      schemaVersion: "mk8dx.roster-aliases.v1",
      created: [{ playerId: "player.mal", aliasText: "Malie" }],
      existing: 1,
    });

    const confirmed = await app.inject({
      method: "POST", url: "/v1/administrator/roster-players",
      headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: { tournamentId, players: [{ row: 1, displayName: "Mal", confirmSameName: true }] },
    });
    expect(confirmed.statusCode).toBe(201);
    expect(createRosterPlayers).toHaveBeenLastCalledWith(
      expect.anything(), [{ row: 1, displayName: "Mal", confirmSameName: true }], undefined, { tournamentId },
    );
  });

  it("creates roster Players in one batch and passes ownerSeatingMode through update", async () => {
    const { app, service, createRosterPlayers } = await setup();
    const created = await app.inject({
      method: "POST", url: "/v1/administrator/roster-players",
      headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: { players: [{ row: 1, displayName: "Roster New" }] },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({
      schemaVersion: "mk8dx.native-roster-players.v1",
      created: [{ playerId: "player.synthetic_roster_new", username: "roster_new", displayName: "Roster New" }],
    });
    const rejection = Object.assign(new Error("roster rejected"), {
      rejections: [{ row: 2, displayName: "Roster New", reason: "display_name_taken" }],
    });
    createRosterPlayers.mockRejectedValueOnce(rejection);
    const rejected = await app.inject({
      method: "POST", url: "/v1/administrator/roster-players",
      headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: { players: [{ row: 2, displayName: "Roster New" }] },
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json()).toEqual({
      schemaVersion: "mk8dx.native-roster-players-rejected.v1",
      code: "roster_rejected",
      rejections: [{ row: 2, displayName: "Roster New", reason: "display_name_taken" }],
    });
    const missingProof = await app.inject({
      method: "POST", url: "/v1/administrator/roster-players",
      payload: { players: [{ row: 1, displayName: "Roster New" }] },
    });
    expect(missingProof.statusCode).toBe(400);

    const updated = await app.inject({
      method: "POST", url: `/v1/tournaments/${tournamentId}/actions/update`,
      headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: { expectedRevision: 2, ownerSeatingMode: "owner_soft" },
    });
    expect(updated.statusCode).toBe(200);
    expect(service.update).toHaveBeenLastCalledWith(
      expect.anything(), tournamentId,
      expect.objectContaining({ ownerSeatingMode: "owner_soft" }),
    );
  });

  it("requires the CSRF proof on every write and maps service errors", async () => {
    const { app, service } = await setup();
    const missing = await app.inject({ method: "POST", url: "/v1/tournaments", payload: { name: "Night" } });
    expect(missing.statusCode).toBe(400);
    const wrong = await app.inject({
      method: "POST", url: "/v1/tournaments", headers: { "x-mk8dx-csrf": "stale" }, payload: { name: "Night" },
    });
    expect(wrong.statusCode).toBe(403);
    expect(service.create).not.toHaveBeenCalled();
    const created = await app.inject({
      method: "POST", url: "/v1/tournaments", headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: { name: "Night", editionNumber: 13, eventDate: "2026-08-22" },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toEqual(summary);
    const active = await app.inject({
      method: "POST",
      url: `/v1/tournaments/${tournamentId}/participants/actions/add-historical`,
      headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: { expectedRevision: 2 },
    });
    expect(active.statusCode).toBe(200);
    expect(service.addHistoricalParticipants).toHaveBeenCalledWith(
      expect.objectContaining({ role: "administrator" }), tournamentId, { expectedRevision: 2 },
    );
    const recent = await app.inject({
      method: "POST",
      url: `/v1/tournaments/${tournamentId}/participants/actions/add-recent`,
      headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: { expectedRevision: 2 },
    });
    expect(recent.statusCode).toBe(200);
    expect(service.addRecentParticipants).toHaveBeenCalledWith(
      expect.objectContaining({ role: "administrator" }), tournamentId, { expectedRevision: 2 },
    );
    const exactLayout = await app.inject({
      method: "POST",
      url: `/v1/tournaments/${tournamentId}/actions/import-group-layout`,
      headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: {
        expectedRevision: 2,
        stage: "qualifier",
        equipmentCorrectionReason: "Reviewed the physical borrowed Switch",
        groups: [{
          name: "Groep 1",
          seats: [
            { playerId, stationOwnerPlayerId: playerId, switchType: "ns1", seatNumber: 1 },
            { playerId: "player.synthetic_operation_02", stationOwnerPlayerId: playerId, switchType: "ns1", seatNumber: 2 },
          ],
        }],
      },
    });
    expect(exactLayout.statusCode).toBe(200);
    expect(service.importGroupLayout).toHaveBeenCalledWith(
      expect.objectContaining({ role: "administrator" }), tournamentId,
      expect.objectContaining({ equipmentCorrectionReason: "Reviewed the physical borrowed Switch", groups: [expect.objectContaining({ seats: expect.any(Array) })] }),
    );
    service.setManualScores.mockRejectedValueOnce(new TournamentOperationError("conflict", "the tournament changed; reload and retry"));
    const conflict = await app.inject({
      method: "POST", url: `/v1/tournaments/${tournamentId}/manual-scores`, headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: { expectedRevision: 2, groupId, segments: 1, scores: [{ playerId, segmentPoints: [40] }] },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ code: "tournament_operation_conflict", message: "the tournament changed; reload and retry" });
    const invalid = await app.inject({
      method: "POST", url: `/v1/tournaments/${tournamentId}/manual-scores`, headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: { expectedRevision: 2, groupId, segments: 0, scores: [] },
    });
    expect(invalid.statusCode).toBe(400);
    const removedRaceEntry = await app.inject({
      method: "POST", url: `/v1/tournaments/${tournamentId}/races`, headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: { expectedRevision: 2, groupId, trackId: "track.mario_kart_stadium", finishOrder: [playerId, "player.synthetic_operation_02"] },
    });
    expect(removedRaceEntry.statusCode).toBe(404);
  });

  it("imports a roster file and a workbook's races in one request each", async () => {
    const { app, service } = await setup();
    const imported = await app.inject({
      method: "POST", url: `/v1/tournaments/${tournamentId}/participants/actions/import`,
      headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: { expectedRevision: 3, rows: [
        { playerId, attendance: "present", hasSwitch1: true, hasSwitch2: false },
        { playerId: "player.synthetic_operation_02", attendance: "absent" },
      ] },
    });
    expect(imported.statusCode).toBe(200);
    expect(service.importParticipants).toHaveBeenCalledWith(
      expect.objectContaining({ role: "administrator" }), tournamentId,
      { expectedRevision: 3, rows: [
        { playerId, attendance: "present", hasSwitch1: true, hasSwitch2: false },
        { playerId: "player.synthetic_operation_02", attendance: "absent" },
      ] },
    );
    const empty = await app.inject({
      method: "POST", url: `/v1/tournaments/${tournamentId}/participants/actions/import`,
      headers: { "x-mk8dx-csrf": "valid-csrf" }, payload: { expectedRevision: 3, rows: [] },
    });
    expect(empty.statusCode).toBe(400);

    const races = await app.inject({
      method: "POST", url: `/v1/tournaments/${tournamentId}/actions/enter-races`,
      headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: { expectedRevision: 3, groupId, races: [
        { raceNumber: 1, trackId: "track.mario_kart_stadium", finishOrder: [playerId, "player.synthetic_operation_02"] },
        { raceNumber: 2, trackId: "track.toad_harbor", mode: 150, finishOrder: ["player.synthetic_operation_02", playerId] },
      ] },
    });
    expect(races.statusCode).toBe(200);
    expect(service.enterRaces).toHaveBeenCalledWith(
      expect.objectContaining({ role: "administrator" }), tournamentId,
      { expectedRevision: 3, groupId, races: [
        { raceNumber: 1, trackId: "track.mario_kart_stadium", finishOrder: [playerId, "player.synthetic_operation_02"] },
        { raceNumber: 2, trackId: "track.toad_harbor", mode: 150, finishOrder: ["player.synthetic_operation_02", playerId] },
      ] },
    );
    const badTrack = await app.inject({
      method: "POST", url: `/v1/tournaments/${tournamentId}/actions/enter-races`,
      headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: { expectedRevision: 3, groupId, races: [{ trackId: "Toad Harbour", finishOrder: [playerId, "player.synthetic_operation_02"] }] },
    });
    expect(badTrack.statusCode).toBe(400);
  });

  it("enters imported races through the canonical action and exports a reusable Excel workbook", async () => {
    const { app, service } = await setup();
    const entered = await app.inject({
      method: "POST", url: `/v1/tournaments/${tournamentId}/actions/enter-race`,
      headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: {
        expectedRevision: 3, groupId, raceNumber: 2, trackId: "track.toad_harbor", mode: 150,
        finishOrder: [playerId, "player.synthetic_operation_02"],
      },
    });
    expect(entered.statusCode).toBe(200);
    expect(service.enterRace).toHaveBeenCalledWith(
      expect.objectContaining({ role: "administrator" }), tournamentId,
      { expectedRevision: 3, groupId, raceNumber: 2, trackId: "track.toad_harbor", mode: 150,
        finishOrder: [playerId, "player.synthetic_operation_02"] },
    );

    const exported = await app.inject({
      method: "POST", url: `/v1/tournaments/${tournamentId}/score-workbook-export`,
      headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: {
        expectedRevision: 3, step: 6,
        trackLabels: [{ trackId: "track.mario_kart_stadium", displayName: "Mario Kart Stadium", cupName: "Mushroom Cup" }],
      },
    });
    expect(exported.statusCode).toBe(200);
    const body = exported.json();
    expect(body).toMatchObject({
      schemaVersion: "mk8dx.score-workbook-export.v1",
      mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(Buffer.from(body.workbookBase64, "base64")).buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Results", "Final Standings"]);
    // Cup is filled from the catalog the console sends, and the character sits
    // beside the Player exactly as the original workbook has it.
    expect(workbook.getWorksheet("Results")?.getRow(1).values).toEqual([
      undefined, "Video", "Race", "Track", "Cup", "Position", "Player",
      "Character", "Character Roster", "Race Points",
      "Total Points (Cumulative)", "Total Points (Final)", "Race Voided", "Scoring Notes",
    ]);
    expect(workbook.getWorksheet("Results")?.getRow(2).values).toEqual([
      undefined, "Groep 1", 1, "Mario Kart Stadium", "Mushroom Cup", 1, "Synthetic Racer", "", "", 15, 15, 15, "", "",
    ]);

    const stale = await app.inject({
      method: "POST", url: `/v1/tournaments/${tournamentId}/score-workbook-export`,
      headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: { expectedRevision: 2, step: 6, trackLabels: [] },
    });
    expect(stale.statusCode).toBe(409);
  });

  it("runs the finalization preview and finalize with both settings", async () => {
    const { app, service } = await setup();
    const preview = await app.inject({ method: "GET", url: `/v1/administrator/tournaments/${tournamentId}/finalization-preview` });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().warnings).toHaveLength(1);
    const finalize = await app.inject({
      method: "POST", url: `/v1/tournaments/${tournamentId}/actions/finalize`, headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: { expectedRevision: 3, publicResults: false, affectsRating: true, reasonCode: "night_done" },
    });
    expect(finalize.statusCode).toBe(200);
    expect(finalize.json().rating).toEqual({ appliedRaces: 1, skippedRaces: 0, alreadyApplied: false });
    expect(service.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ role: "administrator" }), tournamentId,
      { expectedRevision: 3, publicResults: false, affectsRating: true, reasonCode: "night_done" },
    );
    const visibility = await app.inject({
      method: "POST", url: `/v1/tournaments/${tournamentId}/actions/set-results-visibility`, headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: { expectedRevision: 4, publicResults: true, reasonCode: "show" },
    });
    expect(visibility.statusCode).toBe(200);
    const incident = await app.inject({
      method: "POST", url: `/v1/tournaments/${tournamentId}/incidents`, headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: { expectedRevision: 4, category: "equipment", playerId, note: "Capture station reconnected" },
    });
    expect(incident.statusCode).toBe(200);
    expect(service.recordIncident).toHaveBeenCalledWith(
      expect.objectContaining({ role: "administrator" }), tournamentId,
      { expectedRevision: 4, category: "equipment", playerId, note: "Capture station reconnected" },
    );
  });

  it("refuses non-administrators through the service guard", async () => {
    const { app, service } = await setup("account");
    service.listForAdministrator.mockRejectedValueOnce(new TournamentOperationError("forbidden"));
    const list = await app.inject({ method: "GET", url: "/v1/administrator/tournaments" });
    expect(list.statusCode).toBe(403);
  });

  it("serves the public event list and detail, with private identities absent", async () => {
    const { app, service } = await setup("anonymous");
    const list = await app.inject({ method: "GET", url: "/v1/public/tournament-events" });
    expect(list.statusCode).toBe(200);
    expect(list.json().tournaments).toHaveLength(1);
    const detail = await app.inject({ method: "GET", url: `/v1/public/tournament-events/${tournamentId}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toEqual(publicEvent);
    expect(detail.json().overall[0].playerId).toBeUndefined();
    const placements = await app.inject({
      method: "GET", url: `/v1/public/tournament-placements?ids=${encodeURIComponent(tournamentId)}`,
    });
    expect(placements.statusCode).toBe(200);
    expect(placements.json().tournaments).toEqual([{
      tournamentId, fieldSize: 2, placements: [{ playerId, placement: 1 }],
    }]);
    expect(service.loadPublicPlacements).toHaveBeenCalledWith(
      expect.objectContaining({ role: "anonymous" }), [tournamentId],
    );
    service.loadPublic.mockResolvedValueOnce(null);
    const missing = await app.inject({ method: "GET", url: `/v1/public/tournament-events/${tournamentId}` });
    expect(missing.statusCode).toBe(404);
  });
});
