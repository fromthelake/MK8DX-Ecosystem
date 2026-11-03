import { describe, expect, it, vi } from "vitest";

import {
  createPublicTimeTrialClient,
  PublicTimeTrialClientError,
} from "../src/public-time-trial-client.js";

function result(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    resultId: "user_submission.time.SYNTHETICPUBLIC01",
    revision: 3,
    playerId: "player.synthetic_public_01",
    playerUsername: "SyntheticRacer",
    playerDisplayName: "Synthetic Racer",
    trackId: "track.mario_kart_stadium",
    mode: 150,
    totalTimeMs: 94_612,
    laps: [{ lapNumber: 1, timeMs: 31_537 }],
    sourceKind: "livetrial_recorded_video",
    correctedFields: ["track", "character"],
    resultAtMs: 1_900_000_000_000,
    publishedAtMs: 1_900_000_001_000,
    ...overrides,
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("public Time Trial client", () => {
  it("loads strict current Player history and encoded leaderboard queries", async () => {
    const fetchPort = vi.fn(async (path: string, _init: RequestInit) => json({
      schemaVersion: path.includes("leaderboard")
        ? "mk8dx.public-time-trial-leaderboard.v1"
        : "mk8dx.public-player-time-trials.v1",
      results: [result(path.includes("leaderboard") ? { rank: 1 } : {})],
    }));
    const client = createPublicTimeTrialClient(fetchPort);
    const history = await client.listPlayer("player.synthetic_public_01");
    expect(history.results[0]?.revision).toBe(3);
    expect(history.results[0]?.sourceKind).toBe("livetrial_recorded_video");
    expect(history.results[0]?.correctedFields).toEqual(["track", "character"]);
    const leaderboard = await client.leaderboard("track.mario_kart_stadium", 150);
    expect(leaderboard.results[0]?.rank).toBe(1);
    expect(fetchPort.mock.calls.map(([path]) => path)).toEqual([
      "/v1/public/players/player.synthetic_public_01/time-trials",
      "/v1/public/time-trial-leaderboard?trackId=track.mario_kart_stadium&mode=150",
    ]);
    expect(fetchPort.mock.calls[0]?.[1]).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
    });
  });

  it("rejects unknown fields so private data cannot leak through the view boundary", async () => {
    const client = createPublicTimeTrialClient(async () => json({
      schemaVersion: "mk8dx.public-player-time-trials.v1",
      results: [result({ email: "private@example.test" })],
    }));
    await expect(client.listPlayer("player.synthetic_public_01")).rejects.toMatchObject({
      name: "PublicTimeTrialClientError",
      code: "invalid_response",
    } satisfies Partial<PublicTimeTrialClientError>);
  });
});
