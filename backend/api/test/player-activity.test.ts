import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { buildApp } from "../src/app.js";
import type { IdentityReadRepository } from "../src/identity/types.js";
import {
  PlayerActivityError,
  PlayerActivityService,
  type PlayerActivityDocument,
  type PlayerActivityRepository,
} from "../src/profiles/player-activity-service.js";

const accountId = "user_account.synthetic_profile_01";
const playerId = "player.synthetic_profile_01";

const document: PlayerActivityDocument = {
  schemaVersion: "mk8dx.player-activity.v1",
  player: {
    playerId,
    username: "SyntheticRacer",
    displayName: "Synthetic Racer",
  },
  timeTrials: [{
    submissionId: "user_submission.time.synthetic_profile_01",
    revision: 2,
    trackId: "track.mario_kart_stadium",
    modeCC: 150,
    totalTimeMs: 83_456,
    sourceKind: "web_manual",
    occurredAtMs: 1_787_011_200_000,
    createdAtMs: 1_787_011_200_100,
  }],
  tournamentRaces: [{
    raceResultId: "tournament_race_result.synthetic_profile_01",
    revision: 1,
    raceNumber: 4,
    trackId: "track.gcn_waluigi_stadium",
    modeCC: 150,
    countsTowardStandings: true,
    finishPosition: 2,
    racePoints: 12,
    totalAfterRace: 48,
    rankAfterRace: 1,
    sourceKind: "tournament_live_capture",
    occurredAtMs: null,
    createdAtMs: 1_787_011_300_000,
  }],
};

class ActivityRepository implements PlayerActivityRepository {
  public verifiedPlayer: string | null = playerId;
  public async findVerifiedPlayerForAccount(id: string): Promise<string | null> {
    return id === accountId ? this.verifiedPlayer : null;
  }
  public async findPlayerProfile(id: string) {
    return id === playerId ? document.player : null;
  }
  public async listTimeTrials(id: string) {
    return id === playerId ? document.timeTrials : [];
  }
  public async listTournamentRaces(id: string) {
    return id === playerId ? document.tournamentRaces : [];
  }
}

const identityRepository: IdentityReadRepository = {
  async findPublicPlayerById() { return null; },
  async findUserAccountSummaryById() { return null; },
  async findPlayerClaimSummaryById() { return null; },
};

const apps: FastifyInstance[] = [];

async function appWith(service: Pick<PlayerActivityService, "loadMine">) {
  const app = await buildApp({
    identityRepository,
    resolveActor: async (request: FastifyRequest) => {
      if (request.headers.authorization === "Synthetic account") {
        return { role: "account" as const, userAccountId: accountId };
      }
      return { role: "anonymous" as const };
    },
    playerActivity: { service },
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("verified-claim Player activity", () => {
  it("loads both histories only for the account's verified Player", async () => {
    const service = new PlayerActivityService(new ActivityRepository());
    await expect(service.loadMine({ role: "account", userAccountId: accountId }))
      .resolves.toEqual(document);
    await expect(service.loadMine({ role: "account", userAccountId: "user_account.other_01" }))
      .rejects.toMatchObject({ code: "not_authorized" });
    await expect(service.loadMine({ role: "anonymous" }))
      .rejects.toMatchObject({ code: "not_authenticated" });
  });

  it("mounts a closed self-profile response without private observations", async () => {
    const app = await appWith({
      async loadMine() {
        return {
          ...document,
          privateEvidence: "must-not-serialize",
          player: { ...document.player, email: "private@example.invalid" },
        } as PlayerActivityDocument;
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/me/player-activity",
      headers: { authorization: "Synthetic account" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(document);
    expect(response.body).not.toContain("privateEvidence");
    expect(response.body).not.toContain("private@example.invalid");
  });

  it("returns bounded authentication, claim, and dependency failures", async () => {
    const anonymous = await appWith(new PlayerActivityService(new ActivityRepository()));
    expect((await anonymous.inject({
      method: "GET",
      url: "/v1/me/player-activity",
    })).statusCode).toBe(401);

    const noClaimRepository = new ActivityRepository();
    noClaimRepository.verifiedPlayer = null;
    const noClaim = await appWith(new PlayerActivityService(noClaimRepository));
    const denied = await noClaim.inject({
      method: "GET",
      url: "/v1/me/player-activity",
      headers: { authorization: "Synthetic account" },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({
      code: "verified_player_claim_required",
      message: "A verified Player claim is required.",
    });

    const unavailable = await appWith({
      async loadMine() { throw new PlayerActivityError("unavailable"); },
    });
    const failed = await unavailable.inject({
      method: "GET",
      url: "/v1/me/player-activity",
      headers: { authorization: "Synthetic account" },
    });
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain("database");
  });
});
