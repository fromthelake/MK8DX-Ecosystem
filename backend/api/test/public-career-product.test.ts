import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import {
  PublicCareerService,
  type PublicCareerRepository,
} from "../src/profiles/public-career-service.js";
import type { IdentityReadRepository } from "../src/identity/types.js";

const identityRepository: IdentityReadRepository = {
  async findPublicPlayerById() { return null; },
  async findUserAccountSummaryById() { return null; },
  async findPlayerClaimSummaryById() { return null; },
};

const repository: PublicCareerRepository = {
  async loadCareer(playerId) {
    if (playerId !== "player.synthetic") { return null; }
    return {
      playerId,
      timeTrials: {
        published: 105,
        published150: 101,
        published200: 4,
        tracks150: 96,
        tracks200: 4,
        firsts: 41,
        firsts150: 39,
        firsts200: 2,
        podiums: 88,
        podiums150: 84,
        podiums200: 4,
        mostPlayed: {
          trackId: "track.mario_kart_stadium", count: 9, count150: 8, count200: 1,
        },
        latestResultAtMs: 1_900_000_000_000,
      },
      rating: {
        score: 27.15,
        rank: 4,
        peakScore: 28.4,
        history: [
          {
            sequence: 0,
            eventType: "seed",
            occurredAtMs: 1_899_000_000_000,
            score: 27.15,
          },
        ],
      },
    };
  },
};

describe("public player career product", () => {
  it("serves the career document and typed 404", async () => {
    const app = await buildApp({
      identityRepository,
      publicCareer: { service: new PublicCareerService(repository) },
    });
    const found = await app.inject({
      method: "GET",
      url: "/v1/public/players/player.synthetic/career",
    });
    expect(found.statusCode).toBe(200);
    const body = found.json();
    expect(body.schemaVersion).toBe("mk8dx.public-player-career.v1");
    expect(body.timeTrials.firsts).toBe(41);
    expect(body.timeTrials.firsts150).toBe(39);
    expect(body.rating.rank).toBe(4);
    expect(body.rating.history[0].eventType).toBe("seed");

    const missing = await app.inject({
      method: "GET",
      url: "/v1/public/players/player.unknown/career",
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});
