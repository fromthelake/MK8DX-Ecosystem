import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { buildApp } from "../src/app.js";
import type { IdentityReadRepository } from "../src/identity/types.js";
import {
  PlayerInsightsService,
  type PlayerInsightsRepository,
} from "../src/profiles/player-insights-service.js";

const accountId = "user_account.synthetic_insights_01";
const playerId = "player.synthetic_insights_01";

class Repository implements PlayerInsightsRepository {
  async findVerifiedPlayerForAccount(id: string) {
    return id === accountId ? playerId : null;
  }
  async listTimeTrialPersonalBests(id: string) {
    return id === playerId ? [{
      trackId: "track.mario_kart_stadium",
      modeCC: 150 as const,
      bestTimeMs: 83456,
      attemptCount: 2,
    }] : [];
  }
  async summarizeTournaments() {
    return {
      raceCount: 3,
      countedRaceCount: 2,
      wins: 1,
      podiums: 2,
      countedPoints: 27,
      countedFinishPositionTotal: 3,
    };
  }
}

const identityRepository: IdentityReadRepository = {
  async findPublicPlayerById() { return null; },
  async findUserAccountSummaryById() { return null; },
  async findPlayerClaimSummaryById() { return null; },
};
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("claimed Player insights", () => {
  it("derives exact personal attempt and Tournament totals", async () => {
    const service = new PlayerInsightsService(new Repository());
    await expect(service.loadMine({ role: "account", userAccountId: accountId }))
      .resolves.toEqual({
        schemaVersion: "mk8dx.player-insights.v1",
        playerId,
        timeTrials: {
          submissionCount: 2,
          personalBests: [{
            trackId: "track.mario_kart_stadium",
            modeCC: 150,
            bestTimeMs: 83456,
            attemptCount: 2,
          }],
        },
        tournaments: {
          raceCount: 3,
          countedRaceCount: 2,
          wins: 1,
          podiums: 2,
          countedPoints: 27,
          countedFinishPositionTotal: 3,
        },
      });
  });

  it("mounts only for the session's verified claim", async () => {
    const app = await buildApp({
      identityRepository,
      resolveActor: async (request: FastifyRequest) =>
        request.headers.authorization === "Synthetic account"
          ? { role: "account" as const, userAccountId: accountId }
          : { role: "anonymous" as const },
      playerInsights: { service: new PlayerInsightsService(new Repository()) },
    });
    apps.push(app);
    const denied = await app.inject({ method: "GET", url: "/v1/me/player-insights" });
    expect(denied.statusCode).toBe(401);
    const response = await app.inject({
      method: "GET",
      url: "/v1/me/player-insights",
      headers: { authorization: "Synthetic account" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      playerId,
      timeTrials: { submissionCount: 2 },
      tournaments: { countedPoints: 27 },
    });
    expect(response.body).not.toMatch(/evidence|observed|email|rating/i);
  });
});
