import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import type { IdentityReadRepository } from "../src/identity/types.js";
import {
  PublicTimeTrialService,
  type PublicTimeTrialRepository,
} from "../src/timetrials/public-time-trial-service.js";

const result = {
  resultId: "user_submission.time.PUBLICRESULT01",
  revision: 2,
  playerId: "player.synthetic_public_result_01",
  playerUsername: "PublicRacer",
  playerDisplayName: "Public Racer",
  trackId: "track.mario_kart_stadium",
  mode: 150 as const,
  totalTimeMs: 91_234,
  laps: [
    { lapNumber: 1, timeMs: 30_000 },
    { lapNumber: 2, timeMs: 30_500 },
    { lapNumber: 3, timeMs: 30_734 },
  ],
  loadout: { characterId: "character.mario", tireId: "tire.standard" },
  sourceKind: "android_scan",
  correctedFields: ["character"],
  resultAtMs: 1_900_000_000_000,
  publishedAtMs: 1_900_000_000_100,
};

class Repository implements PublicTimeTrialRepository {
  async listStandings() {
    return [{
      rank: 1,
      playerId: result.playerId,
      playerDisplayName: result.playerDisplayName,
      mode: 150 as const,
      totalTimeMs: 57_600_000,
      averageTimeMs: 600_000,
      playedTracks: 1,
      goldMedals: 1,
      silverMedals: 0,
      bronzeMedals: 0,
    }];
  }
  async listPlayerTrackBests() { return []; }
  async listTrackBestsForPlayers() { return new Map(); }
  async listRecentResults() { return []; }
  async listPlayerResults() { return [result]; }
  async listLeaderboard() { return [{ ...result, rank: 1 }]; }
}

const identityRepository: IdentityReadRepository = {
  async findPublicPlayerById() { return null; },
  async findUserAccountSummaryById() { return null; },
  async findPlayerClaimSummaryById() { return null; },
};
const apps: FastifyInstance[] = [];

afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("public current Time Trial product", () => {
  it("serves anonymous Player history and ranked best-per-Player results", async () => {
    const app = await buildApp({
      identityRepository,
      publicTimeTrials: { service: new PublicTimeTrialService(new Repository()) },
    });
    apps.push(app);
    const history = await app.inject({
      method: "GET",
      url: `/v1/public/players/${result.playerId}/time-trials`,
    });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toEqual({
      schemaVersion: "mk8dx.public-player-time-trials.v1",
      results: [result],
    });
    const leaderboard = await app.inject({
      method: "GET",
      url: `/v1/public/time-trial-leaderboard?trackId=${result.trackId}&mode=150`,
    });
    expect(leaderboard.statusCode).toBe(200);
    expect(leaderboard.json()).toMatchObject({
      schemaVersion: "mk8dx.public-time-trial-leaderboard.v1",
      results: [{ playerId: result.playerId, rank: 1 }],
    });
    const standings = await app.inject({
      method: "GET",
      url: "/v1/public/time-trial-standings?mode=150",
    });
    expect(standings.statusCode).toBe(200);
    expect(standings.json()).toMatchObject({
      schemaVersion: "mk8dx.public-time-trial-standings.v1",
      standings: [{ rank: 1, playerId: result.playerId, playedTracks: 1 }],
    });
    const baseStandings = await app.inject({
      method: "GET",
      url: "/v1/public/time-trial-standings?mode=150&scope=base",
    });
    expect(baseStandings.statusCode).toBe(200);
    expect(`${history.body}${leaderboard.body}${standings.body}`).not.toMatch(
      /email|userAccount|evidence|verification|confidence|firebase|review/i,
    );
  });

  it("rejects malformed typed targets and extra query parameters", async () => {
    const app = await buildApp({
      identityRepository,
      publicTimeTrials: { service: new PublicTimeTrialService(new Repository()) },
    });
    apps.push(app);
    const invalid = await app.inject({
      method: "GET",
      url: "/v1/public/time-trial-leaderboard?trackId=1&mode=150&private=true",
    });
    expect(invalid.statusCode).toBe(400);
  });
});
