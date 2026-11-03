import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorResolver } from "../src/identity/types.js";
import type { TournamentConnectedService } from "../src/tournaments/tournament-connected-service.js";
import { registerTournamentNativeOperationRoutes } from
  "../src/tournaments/tournament-native-operation-routes.js";
import {
  TournamentOperationError,
  type TournamentOperationService,
} from "../src/tournaments/tournament-operation-service.js";

const tournamentId = "tournament.synthetic_native_0001";
const groupId = "tournament_group.synthetic_native_0001";
const playerId = "player.synthetic_native_01";
const bearer = "nativeBearerToken1234567890.signedPart_abc";
const authorization = { authorization: `Bearer ${bearer}` };

const apps: FastifyInstance[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

async function setup(role: "administrator" | "account" = "administrator", granted = false) {
  const document = {
    schemaVersion: "mk8dx.tournament-operation.v1",
    summary: { tournamentId, revision: 4, seedingSource: "community_rating", placementStrategy: "balanced" },
  };
  const operations = {
    listForAdministrator: vi.fn(async () => [{ tournamentId, name: "Native Cup" }]),
    loadForAdministrator: vi.fn(async () => document),
    setParticipant: vi.fn(async () => document),
    importParticipants: vi.fn(async () => document),
    enterRaces: vi.fn(async () => document),
    addHistoricalParticipants: vi.fn(async () => document),
    addRecentParticipants: vi.fn(async () => document),
    updateGroups: vi.fn(async () => document),
    enterRace: vi.fn(async () => document),
    recordIncident: vi.fn(async () => document),
    create: vi.fn(async () => document.summary),
    removeParticipant: vi.fn(async () => document),
    generateGroups: vi.fn(async () => document),
    importGroupLayout: vi.fn(async () => document),
    lockGroups: vi.fn(async () => document),
    setWorkflowStep: vi.fn(async () => document),
    setManualScores: vi.fn(async () => document),
    finalize: vi.fn(async () => ({ publicationId: "publication.native" })),
    deleteDraft: vi.fn(async () => undefined),
    update: vi.fn(async () => document.summary),
  };
  const connected = {
    listIncoming: vi.fn(async () => []),
    accept: vi.fn(async () => ({ raceResultId: "tournament_race_result.native", tournamentRevision: 5 })),
    reject: vi.fn(async () => undefined),
  };
  const resolveActor: ActorResolver = async () => ({ role, userAccountId: "user_account.native_admin" });
  const app = Fastify();
  await registerTournamentNativeOperationRoutes(app, {
    resolveActor,
    operations: operations as unknown as Pick<TournamentOperationService,
      "listForAdministrator" | "loadForAdministrator" | "setParticipant" | "updateGroups" | "recordIncident" | "setManualScores">,
    connected: connected as unknown as TournamentConnectedService,
    hasOperationCapability: async () => granted,
  });
  apps.push(app);
  return { app, operations, connected };
}

describe("native Tournament operation routes", () => {
  it("applies an imported group layout", async () => {
    const { app, operations } = await setup();
    const response = await app.inject({
      method: "POST",
      url: `/v1/native/tournaments/${tournamentId}/actions/import-group-layout`,
      headers: authorization,
      payload: {
        expectedRevision: 3,
        stage: "qualifier",
        groups: [{
          name: "Groep 1",
          seats: [
            { playerId: "player.evan", stationOwnerPlayerId: "player.evan", switchType: "ns1", seatNumber: 1 },
            { playerId: "player.merle", stationOwnerPlayerId: "player.evan", switchType: "ns1", seatNumber: 2 },
          ],
        }],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(operations.importGroupLayout).toHaveBeenCalledOnce();
  });

  it("refuses a layout naming an unknown console", async () => {
    const { app, operations } = await setup();
    const response = await app.inject({
      method: "POST",
      url: `/v1/native/tournaments/${tournamentId}/actions/import-group-layout`,
      headers: authorization,
      payload: {
        expectedRevision: 3,
        stage: "qualifier",
        groups: [{ name: "Groep 1", seats: [{ playerId: "player.evan", switchType: "ns3" }] }],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(operations.importGroupLayout).not.toHaveBeenCalled();
  });

  it("requires a native bearer token before resolving an operator action", async () => {
    const { app, operations } = await setup();
    const missing = await app.inject({ method: "GET", url: "/v1/native/tournaments" });
    expect(missing.statusCode).toBe(403);
    expect(operations.listForAdministrator).not.toHaveBeenCalled();

    const malformed = await app.inject({
      method: "GET", url: "/v1/native/tournaments", headers: { authorization: "Basic abc" },
    });
    expect(malformed.statusCode).toBe(403);
  });

  it("serves the complete race-day workflow without browser CSRF", async () => {
    const { app, operations } = await setup();
    const list = await app.inject({ method: "GET", url: "/v1/native/tournaments", headers: authorization });
    expect(list.statusCode).toBe(200);
    expect(list.json().schemaVersion).toBe("mk8dx.native-tournaments.v1");

    const loaded = await app.inject({ method: "GET", url: `/v1/native/tournaments/${tournamentId}`, headers: authorization });
    expect(loaded.statusCode).toBe(200);

    const participant = await app.inject({
      method: "POST", url: `/v1/native/tournaments/${tournamentId}/participants`, headers: authorization,
      payload: { expectedRevision: 4, playerId, attendance: "present", hasSwitch1: true },
    });
    expect(participant.statusCode).toBe(200);
    expect(operations.setParticipant).toHaveBeenCalledWith(
      expect.objectContaining({ role: "administrator" }), tournamentId,
      { expectedRevision: 4, playerId, attendance: "present", hasSwitch1: true },
    );

    const imported = await app.inject({
      method: "POST", url: `/v1/native/tournaments/${tournamentId}/participants/actions/import`, headers: authorization,
      payload: { expectedRevision: 4, rows: [{ playerId, attendance: "present", hasSwitch1: true, hasSwitch2: false }] },
    });
    expect(imported.statusCode).toBe(200);
    expect(operations.importParticipants).toHaveBeenCalledWith(
      expect.objectContaining({ role: "administrator" }), tournamentId,
      { expectedRevision: 4, rows: [{ playerId, attendance: "present", hasSwitch1: true, hasSwitch2: false }] },
    );
    const races = await app.inject({
      method: "POST", url: `/v1/native/tournaments/${tournamentId}/actions/enter-races`, headers: authorization,
      payload: { expectedRevision: 4, groupId, races: [{ trackId: "track.mario_kart_stadium", finishOrder: [playerId, "player.native_two"] }] },
    });
    expect(races.statusCode).toBe(200);
    expect(operations.enterRaces).toHaveBeenCalledWith(
      expect.objectContaining({ role: "administrator" }), tournamentId,
      { expectedRevision: 4, groupId, races: [{ trackId: "track.mario_kart_stadium", finishOrder: [playerId, "player.native_two"] }] },
    );

    const active = await app.inject({
      method: "POST", url: `/v1/native/tournaments/${tournamentId}/participants/actions/add-historical`,
      headers: authorization, payload: { expectedRevision: 4 },
    });
    expect(active.statusCode).toBe(200);
    expect(operations.addHistoricalParticipants).toHaveBeenCalledWith(
      expect.objectContaining({ role: "administrator" }), tournamentId, { expectedRevision: 4 },
    );

    const recent = await app.inject({
      method: "POST", url: `/v1/native/tournaments/${tournamentId}/participants/actions/add-recent`,
      headers: authorization, payload: { expectedRevision: 4 },
    });
    expect(recent.statusCode).toBe(200);
    expect(operations.addRecentParticipants).toHaveBeenCalledWith(
      expect.objectContaining({ role: "administrator" }), tournamentId, { expectedRevision: 4 },
    );

    const groups = await app.inject({
      method: "POST", url: `/v1/native/tournaments/${tournamentId}/groups`, headers: authorization,
      payload: {
        expectedRevision: 4, stage: "qualifier",
        groups: [{ groupId, members: [playerId] }],
      },
    });
    expect(groups.statusCode).toBe(200);
    expect(operations.updateGroups).toHaveBeenCalledWith(
      expect.objectContaining({ role: "administrator" }), tournamentId,
      { expectedRevision: 4, stage: "qualifier", groups: [{ groupId, members: [playerId] }] },
    );

    const scores = await app.inject({
      method: "POST", url: `/v1/native/tournaments/${tournamentId}/manual-scores`, headers: authorization,
      payload: {
        expectedRevision: 4, groupId, segments: 1,
        scores: [{ playerId, segmentPoints: [40] }],
      },
    });
    expect(scores.statusCode).toBe(200);
    expect(operations.setManualScores).toHaveBeenCalledOnce();
    const removedRaceEntry = await app.inject({
      method: "POST", url: `/v1/native/tournaments/${tournamentId}/races`, headers: authorization,
      payload: { expectedRevision: 4, groupId, trackId: "track.water_park", finishOrder: [playerId, "player.synthetic_native_02"] },
    });
    expect(removedRaceEntry.statusCode).toBe(404);

    const incident = await app.inject({
      method: "POST", url: `/v1/native/tournaments/${tournamentId}/incidents`, headers: authorization,
      payload: { expectedRevision: 4, category: "equipment", note: "Cable replaced" },
    });
    expect(incident.statusCode).toBe(200);
    expect(operations.recordIncident).toHaveBeenCalledOnce();

    const generated = await app.inject({ method: "POST", url: `/v1/native/tournaments/${tournamentId}/actions/generate-groups`, headers: authorization, payload: { expectedRevision: 4, stage: "qualifier" } });
    expect(generated.statusCode).toBe(200);
    const advanced = await app.inject({
      method: "POST", url: `/v1/native/tournaments/${tournamentId}/actions/set-workflow-step`,
      headers: authorization, payload: { expectedRevision: 4, targetStep: 4 },
    });
    expect(advanced.statusCode).toBe(200);
    expect(operations.setWorkflowStep).toHaveBeenCalledWith(
      expect.objectContaining({ role: "administrator" }), tournamentId,
      { expectedRevision: 4, targetStep: 4 },
    );
    const manual = await app.inject({
      method: "POST", url: `/v1/native/tournaments/${tournamentId}/manual-scores`,
      headers: authorization,
      payload: {
        expectedRevision: 4, groupId, segments: 2,
        scores: [{ playerId, segmentPoints: [48, 52] }],
      },
    });
    expect(manual.statusCode).toBe(200);
    expect(operations.setManualScores).toHaveBeenCalledWith(
      expect.objectContaining({ role: "administrator" }), tournamentId,
      { expectedRevision: 4, groupId, segments: 2, scores: [{ playerId, segmentPoints: [48, 52] }] },
    );
    const finalized = await app.inject({ method: "POST", url: `/v1/native/tournaments/${tournamentId}/actions/finalize`, headers: authorization, payload: { expectedRevision: 4, publicResults: true, affectsRating: false, reasonCode: "native_test" } });
    expect(finalized.statusCode).toBe(200);
  });

  it("keeps incoming accept/reject behind the same administrator and revision services", async () => {
    const { app, connected } = await setup();
    const incoming = await app.inject({
      method: "GET", url: `/v1/native/tournaments/${tournamentId}/incoming-results`, headers: authorization,
    });
    expect(incoming.statusCode).toBe(200);
    expect(incoming.json().schemaVersion).toBe("mk8dx.native-tournament-incoming.v1");

    const rejected = await app.inject({
      method: "POST", url: "/v1/native/tournament-incoming-results/incoming.native.01/actions/reject",
      headers: authorization, payload: { expectedRevision: 1, reason: "Wrong group" },
    });
    expect(rejected.statusCode).toBe(200);
    expect(connected.reject).toHaveBeenCalledWith(
      expect.objectContaining({ role: "administrator" }),
      { incomingResultId: "incoming.native.01", expectedRevision: 1, reason: "Wrong group" },
    );
  });

  it("maps stale optimistic revisions and admits only explicitly granted accounts", async () => {
    const { app, operations } = await setup("account");
    operations.listForAdministrator.mockRejectedValueOnce(new TournamentOperationError("forbidden"));
    const forbidden = await app.inject({ method: "GET", url: "/v1/native/tournaments", headers: authorization });
    expect(forbidden.statusCode).toBe(403);

    const granted = await setup("account", true);
    granted.operations.setManualScores!.mockRejectedValueOnce(new TournamentOperationError("conflict", "the tournament changed; reload and retry"));
    const stale = await granted.app.inject({
      method: "POST", url: `/v1/native/tournaments/${tournamentId}/manual-scores`, headers: authorization,
      payload: {
        expectedRevision: 3, groupId, segments: 1,
        scores: [{ playerId, segmentPoints: [40] }],
      },
    });
    expect(stale.statusCode).toBe(409);
  });

  // ADR-0177 decision 7.
  it("updates the Step 2 qualification layout and answers with the document", async () => {
    const { app, operations } = await setup();

    const response = await app.inject({
      method: "POST",
      url: `/v1/native/tournaments/${tournamentId}/actions/update-settings`,
      headers: authorization,
      payload: { expectedRevision: 4, seedingSource: "random", placementStrategy: "minimal_move", maxParticipants: 24 },
    });

    expect(response.statusCode).toBe(200);
    expect(operations.update).toHaveBeenCalledWith(
      expect.objectContaining({ role: "administrator" }),
      tournamentId,
      { expectedRevision: 4, seedingSource: "random", placementStrategy: "minimal_move", maxParticipants: 24 },
    );
    expect(response.json()).toMatchObject({ schemaVersion: "mk8dx.tournament-operation.v1" });
  });

  it("accepts clearing the participant limit and refuses an unknown setting", async () => {
    const { app, operations } = await setup();

    const cleared = await app.inject({
      method: "POST",
      url: `/v1/native/tournaments/${tournamentId}/actions/update-settings`,
      headers: authorization,
      payload: { expectedRevision: 4, maxParticipants: null },
    });
    expect(cleared.statusCode).toBe(200);

    // qualifierRounds is deliberately not exposed: the compact workflow is
    // historical only. The route schema drops it, so it can never reach the
    // service even when a client sends it.
    await app.inject({
      method: "POST",
      url: `/v1/native/tournaments/${tournamentId}/actions/update-settings`,
      headers: authorization,
      payload: { expectedRevision: 4, maxParticipants: 12, qualifierRounds: false },
    });
    expect(operations.update).toHaveBeenLastCalledWith(
      expect.anything(),
      tournamentId,
      { expectedRevision: 4, maxParticipants: 12 },
    );
  });

  it("carries the editable layout in every summary it answers with", async () => {
    // Without these the phone cannot show what it is about to change, and a
    // saved change silently reads back as the default.
    const { app } = await setup();
    const response = await app.inject({
      method: "GET", url: `/v1/native/tournaments/${tournamentId}`, headers: authorization,
    });
    expect(response.statusCode).toBe(200);
    expect(Object.keys(response.json().summary)).toEqual(
      expect.arrayContaining(["seedingSource", "placementStrategy"]),
    );
  });

  it("surfaces the service conflict once groups exist", async () => {
    const { app, operations } = await setup();
    operations.update.mockRejectedValueOnce(
      new TournamentOperationError("conflict", "workflow settings are fixed after groups are generated"),
    );

    const response = await app.inject({
      method: "POST",
      url: `/v1/native/tournaments/${tournamentId}/actions/update-settings`,
      headers: authorization,
      payload: { expectedRevision: 4, maxParticipants: 12 },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain("after groups are generated");
  });

  it("refuses the settings update without operator authority", async () => {
    const { app, operations } = await setup("account", false);

    const response = await app.inject({
      method: "POST",
      url: `/v1/native/tournaments/${tournamentId}/actions/update-settings`,
      headers: authorization,
      payload: { expectedRevision: 4, maxParticipants: 12 },
    });

    expect(response.statusCode).toBe(403);
    expect(operations.update).not.toHaveBeenCalled();
  });
});
