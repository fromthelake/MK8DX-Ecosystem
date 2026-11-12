// ADR-0225 amendment: what the app reads for its offline copy of a community. The Player's own runs
// with full detail come from GET /v1/account/time-trials (now with occurredAtMs and opt-in paging);
// the chosen rivals' best runs from GET /v1/account/rivals/best-times. The SQL (private Players never
// appear, only published bests) is in time-trial-lifecycle.integration.test.ts.

import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { registerHomeRoutes } from "../src/home/home-routes.js";
import { RivalPreferenceError } from "../src/home/home-comeback-service.js";
import { registerTimeTrialLifecycleRoutes } from "../src/timetrials/lifecycle-routes.js";
import {
  TimeTrialLifecycleService,
  type ManagedTimeTrial,
  type ManagedTimeTrialQuery,
  type TimeTrialLifecycleRepository,
} from "../src/timetrials/lifecycle-service.js";
import type { PublicTimeTrialResult } from "../src/timetrials/public-time-trial-service.js";
import type { ActorContext } from "../src/identity/types.js";

const owner: ActorContext = { role: "account", userAccountId: "user_account.synthetic_copy_01" };

function run(index: number): ManagedTimeTrial {
  const current = {
    revision: 1, modeCc: 150 as const, trackId: "track.mario_kart_stadium", totalTimeMs: 90_000 + index,
    laps: [], sourceKind: "android_manual", createdAtMs: 1_786_990_000_000 - index,
    occurredAtMs: 1_786_900_000_000 - index,
  };
  return {
    submissionId: `user_submission.time.SYNTHETICCOPY${String(index).padStart(4, "0")}`,
    playerId: "player.synthetic_copy_01", playerUsername: "copy", playerDisplayName: "Synthetic Copy",
    retirementState: "active", publicationStatus: "published", publicationReason: "verified_claim_runtime_acceptance",
    current, revisions: [current], events: [],
  };
}

describe("the Player's own runs for the offline copy", () => {
  const all = Array.from({ length: 250 }, (_, index) => run(index));
  const queries: ManagedTimeTrialQuery[] = [];
  const repository: TimeTrialLifecycleRepository = {
    async findClaimedPlayer() { return "player.synthetic_copy_01"; },
    async read() { return null; },
    async list(query) {
      queries.push(query);
      return all.slice(query.offset ?? 0, (query.offset ?? 0) + query.limit);
    },
    async correct() { throw new Error("unused"); },
    async setRetirement() { throw new Error("unused"); },
    async setVideo() { throw new Error("unused"); },
    async publishReviewed() { throw new Error("unused"); },
    async resolveCarriedWaiting() { throw new Error("unused"); },
  };

  async function app() {
    const server = Fastify();
    await registerTimeTrialLifecycleRoutes(server, {
      resolveActor: async () => owner,
      service: new TimeTrialLifecycleService(repository),
    });
    return server;
  }

  it("pages through a few hundred runs when an offset is named, with occurredAtMs", async () => {
    const server = await app();
    const first = await server.inject({ method: "GET", url: "/v1/account/time-trials?limit=200&offset=0" });
    expect(first.statusCode).toBe(200);
    expect(first.json().results).toHaveLength(200);
    expect(first.json().nextOffset).toBe(200);
    expect(first.json().results[0].current.occurredAtMs).toBe(1_786_900_000_000);
    const second = await server.inject({ method: "GET", url: "/v1/account/time-trials?limit=200&offset=200" });
    expect(second.json().results).toHaveLength(50);
    expect(second.json()).not.toHaveProperty("nextOffset");
    expect(queries.at(-1)).toEqual({ playerId: "player.synthetic_copy_01", limit: 200, offset: 200 });
  });

  it("keeps the old answer for a client that names no offset", async () => {
    const server = await app();
    const plain = await server.inject({ method: "GET", url: "/v1/account/time-trials?limit=100" });
    expect(Object.keys(plain.json()).sort()).toEqual(["results", "schemaVersion"]);
    expect(plain.json().results).toHaveLength(100);
    expect((await server.inject({ method: "GET", url: "/v1/account/time-trials?limit=999" })).statusCode).toBe(400);
  });
});

describe("the chosen rivals' best times for the offline copy", () => {
  const best = (playerId: string, trackId: string): PublicTimeTrialResult => ({
    resultId: `user_submission.time.SYNTHETIC${trackId.slice(6, 12).toUpperCase()}${playerId.slice(-2)}`,
    revision: 1, playerId, playerUsername: "rival", playerDisplayName: "Rival", trackId, mode: 150,
    totalTimeMs: 91_000, laps: [{ lapNumber: 1, timeMs: 30_000 }, { lapNumber: 2, timeMs: 30_000 }, { lapNumber: 3, timeMs: 31_000 }],
    loadout: { characterId: "character.yoshi" }, sourceKind: "android_scan",
    resultAtMs: 1_786_900_000_000, publishedAtMs: 1_786_900_100_000,
  });

  async function app(rivals: readonly { playerId: string; displayName: string }[], fail = false) {
    const asked: string[][] = [];
    const server = Fastify();
    await registerHomeRoutes(server, {
      resolveActor: async (request) => (request.headers["x-test-actor"] === "nobody" ? { role: "anonymous" } : owner),
      comeback: {} as never,
      follows: {} as never,
      focus: {} as never,
      stories: {} as never,
      rivals: {
        async listMine(actor) {
          if (actor.role === "anonymous") { throw new RivalPreferenceError("not_authenticated"); }
          return rivals;
        },
        async add() {}, async remove() {},
      },
      rivalBestTimes: {
        async listBestResultsForPlayers(ids) {
          asked.push([...ids]);
          if (fail) { throw new Error("database down"); }
          return ids.flatMap((id) => [best(id, "track.mario_kart_stadium"), best(id, "track.water_park")]);
        },
      },
    });
    return { server, asked };
  }

  it("answers each rival's best run per track and class with laps and kart setup", async () => {
    const { server, asked } = await app([
      { playerId: "player.synthetic_rival_01", displayName: "Rival One" },
      { playerId: "player.synthetic_rival_02", displayName: "Rival Two" },
    ]);
    const response = await server.inject({ method: "GET", url: "/v1/account/rivals/best-times" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json();
    expect(body.schemaVersion).toBe("mk8dx.rival-best-times.v1");
    expect(body.rivals.map((rival: { playerId: string }) => rival.playerId))
      .toEqual(["player.synthetic_rival_01", "player.synthetic_rival_02"]);
    expect(body.rivals[0].bests).toHaveLength(2);
    expect(body.rivals[0].bests[0]).toMatchObject({ trackId: "track.mario_kart_stadium", mode: 150, totalTimeMs: 91_000 });
    expect(body.rivals[0].bests[0].laps).toHaveLength(3);
    expect(asked).toEqual([["player.synthetic_rival_01", "player.synthetic_rival_02"]]);
  });

  it("needs a signed-in Player and says when the times are unavailable", async () => {
    const { server } = await app([]);
    expect((await server.inject({ method: "GET", url: "/v1/account/rivals/best-times", headers: { "x-test-actor": "nobody" } })).statusCode)
      .toBe(401);
    expect((await server.inject({ method: "GET", url: "/v1/account/rivals/best-times" })).json())
      .toEqual({ schemaVersion: "mk8dx.rival-best-times.v1", rivals: [] });
    const broken = await app([{ playerId: "player.synthetic_rival_01", displayName: "Rival One" }], true);
    expect((await broken.server.inject({ method: "GET", url: "/v1/account/rivals/best-times" })).statusCode).toBe(503);
  });
});
