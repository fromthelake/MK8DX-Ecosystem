import { describe, expect, it, vi } from "vitest";

import { createPlayerInsightsClient } from "../src/player-insights-client.js";

const insights = {
  schemaVersion: "mk8dx.player-insights.v1",
  playerId: "player.synthetic_insights_01",
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
} as const;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("same-origin Player insights client", () => {
  it("accepts the closed integer-based personal summary", async () => {
    const fetchPort = vi.fn(async () => response(insights));
    await expect(createPlayerInsightsClient(fetchPort).loadMine())
      .resolves.toEqual(insights);
    expect(fetchPort).toHaveBeenCalledWith(
      "/v1/me/player-insights",
      expect.objectContaining({ credentials: "same-origin", redirect: "error" }),
    );
  });

  it("rejects rating/private extensions and malformed totals", async () => {
    const extended = createPlayerInsightsClient(async () => response({
      ...insights,
      rating: { mu: 25, sigma: 8.333 },
    }));
    await expect(extended.loadMine()).rejects.toMatchObject({ code: "invalid_response" });
    const malformed = createPlayerInsightsClient(async () => response({
      ...insights,
      tournaments: { ...insights.tournaments, wins: 1.5 },
    }));
    await expect(malformed.loadMine()).rejects.toMatchObject({ code: "invalid_response" });
  });
});
