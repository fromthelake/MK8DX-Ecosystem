import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { registerPublicRatingRoutes } from "../src/rating/public-rating-routes.js";

describe("public rating leaderboard played flag", () => {
  it("passes through the schema so clients can hide a tier before the first rated race", async () => {
    const app = Fastify();
    await registerPublicRatingRoutes(app, {
      repository: {
        async listRatings() {
          return [
            { playerId: "player.veteran", username: "veteran", displayName: "Veteran",
              mu: 30, sigma: 2, updatedAtMs: 1, played: true },
            { playerId: "player.newcomer", username: "newcomer", displayName: "Newcomer",
              mu: 25, sigma: 25 / 3, updatedAtMs: 1, played: false },
          ];
        },
      },
    });
    const response = await app.inject({ method: "GET", url: "/v1/public/rating-leaderboard" });
    expect(response.statusCode).toBe(200);
    const entries = response.json().entries as Array<Record<string, unknown>>;
    expect(entries.map((entry) => [entry["playerId"], entry["rank"], entry["played"]])).toEqual([
      ["player.veteran", 1, true],
      ["player.newcomer", 2, false],
    ]);
    await app.close();
  });
});
