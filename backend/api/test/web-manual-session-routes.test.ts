import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import type {
  ActorContext,
  IdentityReadRepository,
} from "../src/identity/types.js";
import {
  WebManualSessionError,
  WebManualSessionService,
} from "../src/timetrials/web-manual-session-service.js";


class NullIdentityReads implements IdentityReadRepository {
  async findPublicPlayerById(): Promise<null> { return null; }
  async findUserAccountSummaryById(): Promise<null> { return null; }
  async findPlayerClaimSummaryById(): Promise<null> { return null; }
}

const accountActor: ActorContext = {
  role: "account",
  userAccountId: "user_account.web_manual_01",
};

function dependencies() {
  const repository = {
    findVerifiedPlayerForAccount: vi.fn(async (): Promise<{
      playerId: string;
      username: string;
      displayName: string;
    } | null> => ({
      playerId: "player.web_manual_01",
      username: "web_manual_01",
      displayName: "Web Manual 01",
    })),
  };
  const catalog = {
    containsTrack: vi.fn(async (trackId: string) =>
      trackId === "track.mario_kart_stadium"),
  };
  const ids = ["web-manual-session-0001", "web-manual-session-0002"];
  const idGenerator = {
    newOpaqueId: vi.fn(() => ids.shift() ?? "web-manual-session-fallback"),
  };
  const clock = { nowMs: vi.fn(() => 1_786_914_000_000) };
  const service = new WebManualSessionService(
    repository,
    catalog,
    idGenerator,
    clock,
    "timetrials-web-test",
  );
  return { repository, catalog, idGenerator, clock, service };
}

const openApps: FastifyInstance[] = [];

async function harness(actor: ActorContext = accountActor) {
  const seams = dependencies();
  const resolveActor = vi.fn(async () => actor);
  const app = await buildApp({
    identityRepository: new NullIdentityReads(),
    resolveActor,
    webManualSession: { service: seams.service },
  });
  openApps.push(app);
  return { app, resolveActor, ...seams };
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("web manual authenticated bootstrap HTTP boundary", () => {
  it("issues fresh revision-one context for the verified Player and exact track", async () => {
    const test = await harness();
    const first = await test.app.inject({
      method: "GET",
      url: "/v1/time-trial-submissions/manual-bootstrap" +
        "?trackId=track.mario_kart_stadium",
    });
    const second = await test.app.inject({
      method: "GET",
      url: "/v1/time-trial-submissions/manual-bootstrap" +
        "?trackId=track.mario_kart_stadium",
    });

    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.json()).toEqual({
      schemaVersion: "mk8dx.web-manual-bootstrap.v1",
      context: {
        schemaVersion: "mk8dx.web-manual-context.v1",
        submissionId: "user_submission.time.web-manual-session-0001",
        revision: 1,
        trackId: "track.mario_kart_stadium",
        playerReference: {
          namespace: "player",
          value: "player.web_manual_01",
        },
        producer: {
          version: "timetrials-web-test",
          localRecordId: "web-manual-session-0001",
        },
        timestamps: { createdAtMs: 1_786_914_000_000 },
      },
    });
    expect(second.json().context.submissionId)
      .toBe("user_submission.time.web-manual-session-0002");
    expect(test.repository.findVerifiedPlayerForAccount)
      .toHaveBeenCalledWith("user_account.web_manual_01");
    expect(test.catalog.containsTrack)
      .toHaveBeenCalledWith("track.mario_kart_stadium");
  });

  it("returns authentication required before reading claim or catalog", async () => {
    const test = await harness({ role: "anonymous" });
    const response = await test.app.inject({
      method: "GET",
      url: "/v1/time-trial-submissions/manual-bootstrap" +
        "?trackId=track.mario_kart_stadium",
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      code: "web_manual_authentication_required",
      message: "Authentication is required.",
    });
    expect(test.repository.findVerifiedPlayerForAccount).not.toHaveBeenCalled();
    expect(test.catalog.containsTrack).not.toHaveBeenCalled();
  });

  it("requires an administrator-reviewed verified Player claim", async () => {
    const test = await harness();
    test.repository.findVerifiedPlayerForAccount.mockResolvedValueOnce(null);
    const response = await test.app.inject({
      method: "GET",
      url: "/v1/time-trial-submissions/manual-bootstrap" +
        "?trackId=track.mario_kart_stadium",
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      code: "web_manual_player_required",
      message: "An eligible verified Player claim is required.",
    });
  });

  it("rejects unknown catalog tracks and malformed queries", async () => {
    const test = await harness();
    let response = await test.app.inject({
      method: "GET",
      url: "/v1/time-trial-submissions/manual-bootstrap?trackId=track.unknown",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: "web_manual_track_invalid",
      message: "The selected track is invalid.",
    });

    response = await test.app.inject({
      method: "GET",
      url: "/v1/time-trial-submissions/manual-bootstrap?trackId=00_MarioKartStadium",
    });
    expect(response.statusCode).toBe(400);
    expect(test.resolveActor).toHaveBeenCalledOnce();
  });

  it("rejects non-account migration actors", async () => {
    const test = await harness({ role: "migration_operator" });
    const response = await test.app.inject({
      method: "GET",
      url: "/v1/time-trial-submissions/manual-bootstrap" +
        "?trackId=track.mario_kart_stadium",
    });
    expect(response.statusCode).toBe(403);
    expect(test.repository.findVerifiedPlayerForAccount).not.toHaveBeenCalled();
  });

  it("redacts repository, catalog, ID, and clock dependency failures", async () => {
    const failures: Array<(test: ReturnType<typeof dependencies>) => void> = [
      (test) => test.repository.findVerifiedPlayerForAccount
        .mockRejectedValueOnce(new Error("private claim SQL")),
      (test) => test.catalog.containsTrack
        .mockRejectedValueOnce(new Error("private catalog path")),
      (test) => test.repository.findVerifiedPlayerForAccount
        .mockResolvedValueOnce({ playerId: "player.Invalid", username: "synthetic01", displayName: "Synthetic 01" }),
      (test) => test.idGenerator.newOpaqueId.mockReturnValueOnce("bad.id"),
      (test) => test.clock.nowMs.mockReturnValueOnce(Number.NaN),
    ];
    for (const configure of failures) {
      const seams = dependencies();
      configure(seams);
      const app = await buildApp({
        identityRepository: new NullIdentityReads(),
        resolveActor: async () => accountActor,
        webManualSession: { service: seams.service },
      });
      openApps.push(app);
      const response = await app.inject({
        method: "GET",
        url: "/v1/time-trial-submissions/manual-bootstrap" +
          "?trackId=track.mario_kart_stadium",
      });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        code: "web_manual_session_failed",
        message: "The web manual session could not be established.",
      });
      expect(response.body).not.toMatch(/private|SQL|catalog path|Invalid|bad\.id|NaN/);
    }
  });

  it("validates fixed producer configuration at construction", () => {
    const seams = dependencies();
    expect(() => new WebManualSessionService(
      seams.repository,
      seams.catalog,
      seams.idGenerator,
      seams.clock,
      "invalid\nproducer",
    )).toThrowError(WebManualSessionError);
  });
});
