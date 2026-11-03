import { describe, expect, it, vi } from "vitest";

import {
  createPlayerVisibilityClient,
  createTimeTrialLifecycleClient,
  TimeTrialLifecycleClientError,
} from "../src/time-trial-lifecycle-client.js";

const submissionId = "user_submission.time.SYNTHETICLIFECYCLE01";
const playerId = "player.synthetic_racer_001";

const revision = {
  revision: 1,
  modeCc: 150,
  trackId: "track.mario_kart_stadium",
  totalTimeMs: 94_612,
  laps: [31_204, 31_704, 31_704],
  sourceKind: "web_manual",
  createdAtMs: 1_900_000_000_000,
};

const lifecycleEvent = {
  sequenceNumber: 1,
  eventType: "retired",
  retirementStateAfter: "retired",
  revision: 1,
  actorRole: "owner",
  reasonCode: "incorrect_time",
  occurredAtMs: 1_900_000_100_000,
};

const result = {
  submissionId,
  playerId,
  playerUsername: "SyntheticRacer",
  playerDisplayName: "Synthetic Racer",
  retirementState: "active",
  publicationStatus: "published",
  publicationReason: "policy_public",
  current: revision,
  revisions: [revision],
  events: [lifecycleEvent],
};

const visibilityDocument = {
  schemaVersion: "mk8dx.player-visibility.v1",
  playerId,
  username: "SyntheticRacer",
  displayName: "Synthetic Racer",
  visibility: "public",
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function empty(status: number): Response {
  return new Response(null, { status });
}

const proof = json({
  schemaVersion: "mk8dx.web-csrf.v1",
  headerName: "x-mk8dx-csrf",
  value: "fresh-proof",
});

function proofOnce(): Response {
  return proof.clone();
}

describe("Time Trial lifecycle browser client", () => {
  it("parses the closed managed document over a same-origin read", async () => {
    const fetchPort = vi.fn(async () => json({
      schemaVersion: "mk8dx.managed-time-trial.v1",
      result,
    }));
    const client = createTimeTrialLifecycleClient(fetchPort);
    await expect(client.read(submissionId)).resolves.toEqual(result);
    expect(fetchPort).toHaveBeenCalledWith(
      `/v1/time-trials/${submissionId}`,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
      }),
    );
  });

  it("refuses an unexpected key, a wrong schema, and a malformed identifier", async () => {
    const extra = createTimeTrialLifecycleClient(async () => json({
      schemaVersion: "mk8dx.managed-time-trial.v1",
      result: { ...result, evidence: "private" },
    }));
    await expect(extra.read(submissionId))
      .rejects.toMatchObject({ code: "invalid_response" });
    const wrongSchema = createTimeTrialLifecycleClient(async () => json({
      schemaVersion: "mk8dx.managed-time-trial.v2",
      result,
    }));
    await expect(wrongSchema.read(submissionId))
      .rejects.toMatchObject({ code: "invalid_response" });
    const unused = createTimeTrialLifecycleClient(async () => {
      throw new Error("must not be called");
    });
    await expect(unused.read("user_submission.time.x"))
      .rejects.toMatchObject({ code: "invalid_input" });
    await expect(unused.retire(submissionId, "not_a_reason" as never))
      .rejects.toBeInstanceOf(TimeTrialLifecycleClientError);
  });

  it("obtains a fresh CSRF proof before every correction", async () => {
    const fetchPort = vi.fn()
      .mockResolvedValueOnce(proofOnce())
      .mockResolvedValueOnce(json({
        schemaVersion: "mk8dx.managed-time-trial.v1",
        result,
      }));
    const client = createTimeTrialLifecycleClient(fetchPort);
    await expect(client.correct(submissionId, {
      totalTimeMs: 94_612,
      laps: [31_204, 31_704, 31_704],
      reasonCode: "incorrect_time",
      note: "Read the wrong row.",
    })).resolves.toEqual(result);
    expect(fetchPort.mock.calls[0]?.[0]).toBe("/v1/session/csrf");
    expect(fetchPort.mock.calls[1]?.[0]).toBe(
      `/v1/time-trials/${submissionId}/actions/correct`,
    );
    expect(fetchPort.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({ "x-mk8dx-csrf": "fresh-proof" }),
      body: JSON.stringify({
        totalTimeMs: 94_612,
        laps: [31_204, 31_704, 31_704],
        reasonCode: "incorrect_time",
        note: "Read the wrong row.",
      }),
    });
  });

  it("sends retire and restore with the reason and an optional note only", async () => {
    const fetchPort = vi.fn()
      .mockResolvedValueOnce(proofOnce())
      .mockResolvedValueOnce(json({
        schemaVersion: "mk8dx.managed-time-trial.v1",
        result: { ...result, retirementState: "retired" },
      }))
      .mockResolvedValueOnce(proofOnce())
      .mockResolvedValueOnce(json({
        schemaVersion: "mk8dx.managed-time-trial.v1",
        result,
      }));
    const client = createTimeTrialLifecycleClient(fetchPort);
    await client.retire(submissionId, "duplicate");
    expect(fetchPort.mock.calls[1]?.[0]).toBe(
      `/v1/time-trials/${submissionId}/actions/retire`,
    );
    expect(fetchPort.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ reasonCode: "duplicate" }),
    });
    await client.restore(submissionId, "other", "Recorded again correctly.");
    expect(fetchPort.mock.calls[3]?.[0]).toBe(
      `/v1/time-trials/${submissionId}/actions/restore`,
    );
    expect(fetchPort.mock.calls[3]?.[1]).toMatchObject({
      body: JSON.stringify({
        reasonCode: "other",
        note: "Recorded again correctly.",
      }),
    });
  });

  it("maps every documented lifecycle status to its own code", async () => {
    for (const [status, code] of [
      [400, "invalid_input"],
      [401, "not_authenticated"],
      [403, "forbidden"],
      [404, "not_found"],
      [409, "conflict"],
      [503, "unavailable"],
    ] as const) {
      const client = createTimeTrialLifecycleClient(async () => empty(status));
      await expect(client.read(submissionId)).rejects.toMatchObject({ code });
    }
    const offline = createTimeTrialLifecycleClient(async () => {
      throw new Error("network down");
    });
    await expect(offline.read(submissionId))
      .rejects.toMatchObject({ code: "unavailable" });
  });

  it("builds the administrator query from the chosen filters only", async () => {
    const fetchPort = vi.fn(async (_path: string, _init: RequestInit) => json({
      schemaVersion: "mk8dx.managed-time-trial-list.v1",
      results: [result],
    }));
    const client = createTimeTrialLifecycleClient(fetchPort);
    await expect(client.listForAdministrator({
      playerId,
      mode: 200,
      retirementState: "retired",
      limit: 25,
    })).resolves.toEqual([result]);
    expect(fetchPort.mock.calls[0]?.[0]).toBe(
      `/v1/administrator/time-trials?playerId=${
        encodeURIComponent(playerId)}&mode=200&retirementState=retired&limit=25`,
    );
    await expect(client.listForAdministrator({ playerId: "nonsense" }))
      .rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("Player visibility browser client", () => {
  it("reads the Player's own presence as a closed document", async () => {
    const fetchPort = vi.fn(
      async (_path: string, _init: RequestInit) => json(visibilityDocument),
    );
    const client = createPlayerVisibilityClient(fetchPort);
    await expect(client.read()).resolves.toEqual({
      playerId,
      username: "SyntheticRacer",
      displayName: "Synthetic Racer",
      visibility: "public",
    });
    expect(fetchPort.mock.calls[0]?.[0])
      .toBe("/v1/account/player-visibility");
  });

  it("proves the origin before changing the Player's own presence", async () => {
    const fetchPort = vi.fn()
      .mockResolvedValueOnce(proofOnce())
      .mockResolvedValueOnce(json({
        ...visibilityDocument,
        visibility: "private",
      }));
    const client = createPlayerVisibilityClient(fetchPort);
    await expect(client.setOwn("private")).resolves.toMatchObject({
      visibility: "private",
    });
    expect(fetchPort.mock.calls[1]?.[1]).toMatchObject({
      method: "PUT",
      headers: expect.objectContaining({ "x-mk8dx-csrf": "fresh-proof" }),
      body: JSON.stringify({ visibility: "private" }),
    });
  });

  it("reports a missing Player rather than a generic conflict", async () => {
    const client = createPlayerVisibilityClient(async () => empty(409));
    await expect(client.read())
      .rejects.toMatchObject({ code: "no_verified_player" });
  });

  it("records an administrator reason with the target Player", async () => {
    const fetchPort = vi.fn()
      .mockResolvedValueOnce(proofOnce())
      .mockResolvedValueOnce(json({
        ...visibilityDocument,
        visibility: "private",
      }));
    const client = createPlayerVisibilityClient(fetchPort);
    await client.setForPlayer(playerId, "private", "player_request");
    expect(fetchPort.mock.calls[1]?.[0]).toBe(
      `/v1/administrator/players/${encodeURIComponent(playerId)}/visibility`,
    );
    expect(fetchPort.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({
        visibility: "private",
        reasonCode: "player_request",
      }),
    });
    await expect(client.setForPlayer(playerId, "private", "Not A Code"))
      .rejects.toMatchObject({ code: "invalid_input" });
  });
});
