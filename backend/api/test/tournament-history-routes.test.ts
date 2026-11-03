import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { buildApp } from "../src/app.js";
import type {
  ActorContext,
  IdentityReadRepository,
} from "../src/identity/types.js";
import {
  ObservedIdentityAdminService,
  type ObservedIdentityLink,
  type ObservedIdentityRepository,
} from "../src/tournament-history/observed-identity-admin-service.js";
import {
  TournamentTrackRecordService,
  type TournamentTrackRow,
} from "../src/tournaments/tournament-track-record-service.js";

// Fastify serialises a response against its schema and silently drops anything
// the schema does not name, so a field can exist in the service, be tested
// there, and still never reach a client. These tests read the wire.

const playerId = "player.synthetic_history_01";
const otherPlayerId = "player.synthetic_history_02";
const adminAccountId = "user_account.synthetic_history_admin_01";

class NullIdentityReads implements IdentityReadRepository {
  async findPublicPlayerById(): Promise<null> { return null; }
  async findUserAccountSummaryById(): Promise<null> { return null; }
  async findPlayerClaimSummaryById(): Promise<null> { return null; }
}

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

function trackRow(
  trackId: string | null, finishPosition: number, fieldSize = 12,
): TournamentTrackRow {
  return {
    trackId, modeCc: 150, finishPosition, fieldSize,
    racePoints: 15, heldAtMs: 1_774_569_600_000,
  };
}

const link: ObservedIdentityLink = {
  linkId: "12", tournamentNumber: 7, sectionId: "3", sectionName: "Talent",
  legacySectionLabel: "TN7: 2e Divisie", observedName: "Wanda",
  playerId, playerName: "Tobias", decisionSource: "derived",
  orderAgreement: 0.94, videoPoints: 274, historyPoints: 263,
  note: null, placements: 27,
};

async function testApp(
  actor: ActorContext = { role: "anonymous" },
  repository?: Partial<ObservedIdentityRepository>,
): Promise<FastifyInstance> {
  const observed: ObservedIdentityRepository = {
    async listLinks() { return [link]; },
    async listLinkablePlayers() {
      return [{
        playerId, displayName: "Tobias", tournamentRaces: 92,
      }, {
        playerId: otherPlayerId, displayName: "Wanda", tournamentRaces: 120,
      }];
    },
    async assign() { return true; },
    async restoreDerived() { return true; },
    ...repository,
  };
  const app = await buildApp({
    identityRepository: new NullIdentityReads(),
    resolveActor: async (_request: FastifyRequest) => actor,
    tournamentTrackRecord: {
      service: new TournamentTrackRecordService({
        async listPlayerTrackRows() {
          return [
            trackRow("track.gcn_baby_park", 1),
            trackRow("track.gcn_baby_park", 2),
            trackRow("track.gcn_baby_park", 1),
            trackRow("track.snes_rainbow_road", 11),
            trackRow("track.snes_rainbow_road", 12),
            trackRow("track.snes_rainbow_road", 10),
            trackRow(null, 6),
          ];
        },
      }),
    },
    observedIdentityAdmin: {
      service: new ObservedIdentityAdminService(observed, () => 1_700_000),
      csrfVerifier: { verify: (_actor, proof) => proof === "good-proof" },
    },
  });
  apps.push(app);
  return app;
}

describe("tournament track record HTTP boundary", () => {
  it("serves a public track record with every field the view needs", async () => {
    const app = await testApp();
    const response = await app.inject({
      method: "GET", url: `/v1/public/players/${playerId}/tournament-tracks`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body["schemaVersion"]).toBe("mk8dx.tournament-track-record.v1");
    expect(body["racesWithTrack"]).toBe(6);
    // The race with no track is reported, not averaged away.
    expect(body["racesWithoutTrack"]).toBe(1);
    const tracks = body["tracks"] as Array<Record<string, unknown>>;
    expect(tracks[0]!["trackId"]).toBe("track.gcn_baby_park");
    expect(tracks.at(-1)!["trackId"]).toBe("track.snes_rainbow_road");
    // The number the ranking is built on has to survive serialisation.
    expect(typeof tracks[0]!["relativeToOwnAverage"]).toBe("number");
    expect(tracks[0]!["relativeToOwnAverage"] as number).toBeLessThan(0);
    expect(tracks[0]!["wins"]).toBe(2);
    expect(tracks[0]!["bestFinish"]).toBe(1);
    expect(typeof tracks[0]!["averagePoints"]).toBe("number");
  });

  it("refuses a player reference that is not one", async () => {
    const app = await testApp();
    const response = await app.inject({
      method: "GET", url: "/v1/public/players/not-a-player/tournament-tracks",
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("observed identity HTTP boundary", () => {
  it("is closed to anonymous and ordinary accounts", async () => {
    for (const actor of [
      { role: "anonymous" } as ActorContext,
      { role: "account", userAccountId: adminAccountId } as ActorContext,
    ]) {
      const app = await testApp(actor);
      const response = await app.inject({
        method: "GET", url: "/v1/administrator/tournament-identities",
      });
      expect(response.statusCode).toBe(403);
    }
  });

  it("serves the links with the evidence a reviewer needs", async () => {
    const app = await testApp({
      role: "administrator", userAccountId: adminAccountId,
    });
    const response = await app.inject({
      method: "GET", url: "/v1/administrator/tournament-identities",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    const links = body["links"] as Array<Record<string, unknown>>;
    expect(links[0]!["observedName"]).toBe("Wanda");
    expect(links[0]!["playerName"]).toBe("Tobias");
    // Without these three the screen cannot say why the binder concluded this.
    expect(links[0]!["orderAgreement"]).toBeCloseTo(0.94, 6);
    expect(links[0]!["videoPoints"]).toBe(274);
    expect(links[0]!["historyPoints"]).toBe(263);
    expect((body["players"] as unknown[]).length).toBe(2);
  });

  it("will not write without the same-origin proof", async () => {
    const app = await testApp({
      role: "administrator", userAccountId: adminAccountId,
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/administrator/tournament-identities/actions/assign",
      payload: { linkId: "12", playerId: otherPlayerId },
    });
    expect(response.statusCode).toBe(403);
  });

  it("accepts a correction from an administrator with the proof", async () => {
    let assigned: unknown = null;
    const app = await testApp({
      role: "administrator", userAccountId: adminAccountId,
    }, {
      async assign(command) { assigned = command; return true; },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/administrator/tournament-identities/actions/assign",
      headers: { "x-mk8dx-csrf": "good-proof" },
      payload: { linkId: "12", playerId: otherPlayerId, note: "it was Wanda" },
    });
    expect(response.statusCode).toBe(204);
    expect(assigned).toEqual({
      linkId: "12", playerId: otherPlayerId, note: "it was Wanda",
      decidedByUserAccountId: adminAccountId, decidedAtMs: 1_700_000,
    });
  });

  it("reports a seat that is gone rather than pretending it saved", async () => {
    const app = await testApp({
      role: "administrator", userAccountId: adminAccountId,
    }, { async assign() { return false; } });
    const response = await app.inject({
      method: "POST",
      url: "/v1/administrator/tournament-identities/actions/assign",
      headers: { "x-mk8dx-csrf": "good-proof" },
      payload: { linkId: "999", playerId: otherPlayerId },
    });
    expect(response.statusCode).toBe(404);
  });

  it("hands a seat back to the binder", async () => {
    let restored: string | null = null;
    const app = await testApp({
      role: "administrator", userAccountId: adminAccountId,
    }, {
      async restoreDerived(linkId) { restored = linkId; return true; },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/administrator/tournament-identities/actions/restore",
      headers: { "x-mk8dx-csrf": "good-proof" },
      payload: { linkId: "12" },
    });
    expect(response.statusCode).toBe(204);
    expect(restored).toBe("12");
  });
});
