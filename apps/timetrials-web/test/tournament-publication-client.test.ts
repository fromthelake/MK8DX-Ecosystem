import { describe, expect, it, vi } from "vitest";

import {
  createTournamentPublicationClient,
  TournamentPublicationClientError,
} from "../src/tournament-publication-client.js";

const publicationId = "tournament_publication.synthetic_event_001";
const raceResultId = "tournament_race_result.synthetic_race_001";
const snapshot = {
  publicationId,
  eventName: "Synthetic Cup",
  status: "published",
  revision: 1,
  resultCount: 1,
  publishedAtMs: 1_900_000_000_000,
  updatedAtMs: 1_900_000_000_000,
};
const candidate = {
  raceResultId,
  currentRevision: 1,
  raceNumber: 1,
  scoringSegment: 1,
  trackId: "track.mario_kart_stadium",
  mode: 150,
  placementCount: 1,
  publishable: true,
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Tournament publication browser client", () => {
  it("parses the closed administrator review document", async () => {
    const fetchPort = vi.fn(async () => json({
      publications: [snapshot],
      candidates: [candidate],
    }));
    const client = createTournamentPublicationClient(fetchPort);
    await expect(client.listReview()).resolves.toEqual({
      publications: [snapshot],
      candidates: [{ ...candidate, revision: 1 }],
    });
    expect(fetchPort).toHaveBeenCalledWith(
      "/v1/administrator/tournament-publications/review",
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
  });

  it("obtains a fresh CSRF proof before one exact publication mutation", async () => {
    const fetchPort = vi.fn()
      .mockResolvedValueOnce(json({
        schemaVersion: "mk8dx.web-csrf.v1",
        headerName: "x-mk8dx-csrf",
        value: "fresh-proof",
      }))
      .mockResolvedValueOnce(json(snapshot));
    const client = createTournamentPublicationClient(fetchPort);
    await expect(client.create(
      "Synthetic Cup",
      [{ raceResultId, revision: 1 }],
      "event_completed",
    )).resolves.toEqual(snapshot);
    expect(fetchPort.mock.calls[1]?.[0]).toBe("/v1/tournament-publications");
    expect(fetchPort.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({ "x-mk8dx-csrf": "fresh-proof" }),
      body: JSON.stringify({
        eventName: "Synthetic Cup",
        targets: [{ raceResultId, revision: 1 }],
        reasonCode: "event_completed",
      }),
    });
  });

  it("parses public Player Tournament history without private fields", async () => {
    const result = {
      publicationId,
      eventName: "Synthetic Cup",
      publishedAtMs: 1_900_000_000_000,
      raceResultId,
      revision: 1,
      raceNumber: 1,
      scoringSegment: 1,
      trackId: "track.mario_kart_stadium",
      mode: 150,
      finishPosition: 1,
      racePoints: 15,
      totalAfterRace: 15,
      rankAfterRace: 1,
      resultAtMs: 1_899_999_999_000,
    };
    const client = createTournamentPublicationClient(async () => json({
      schemaVersion: "mk8dx.public-player-tournaments.v1",
      results: [result],
    }));
    await expect(client.listPlayer("player.synthetic_racer_001"))
      .resolves.toEqual([result]);
  });

  it("accepts every race class and Mirror only as a 150cc race (ADR-0217)", async () => {
    const review = (rows: readonly Record<string, unknown>[]) => createTournamentPublicationClient(async () => json({
      publications: [], candidates: rows,
    })).listReview();
    const accepted = await review([{ ...candidate, mode: 50 }, { ...candidate, raceResultId: `${raceResultId}_b`, mirror: true }]);
    expect(accepted.candidates.map(({ mode, mirror }) => [mode, mirror])).toEqual([[50, undefined], [150, true]]);
    await expect(review([{ ...candidate, mode: 200, mirror: true }])).rejects.toBeInstanceOf(TournamentPublicationClientError);
    await expect(review([{ ...candidate, mode: 75 }])).rejects.toBeInstanceOf(TournamentPublicationClientError);
  });

  it("rejects extra public fields and duplicate publication targets", async () => {
    const client = createTournamentPublicationClient(async () => json({
      publications: [],
      candidates: [{ ...candidate, evidence: "private" }],
    }));
    await expect(client.listReview()).rejects.toBeInstanceOf(
      TournamentPublicationClientError,
    );
    await expect(client.create(
      "Synthetic Cup",
      [{ raceResultId, revision: 1 }, { raceResultId, revision: 1 }],
      "event_completed",
    )).rejects.toMatchObject({ code: "invalid_input" });
  });
});
