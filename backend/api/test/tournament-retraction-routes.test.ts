// Removing, reopening or restoring without a reason is the caller's mistake: 400, never a 500 (found 2026-11-12).
import assert from "node:assert/strict";
import Fastify from "fastify";
import { it } from "vitest";

import { registerTournamentRetractionRoutes } from "../src/tournaments/tournament-retraction-routes.js";

async function app() {
  const calls: string[] = [];
  const server = Fastify();
  const service = {
    async remove(_actor: unknown, input: { reason: string }) { calls.push(`remove:${input.reason}`); return { ok: true }; },
    async reopen(_actor: unknown, input: { reason: string }) { calls.push(`reopen:${input.reason}`); return { ok: true }; },
    async restore(_actor: unknown, input: { reason: string }) { calls.push(`restore:${input.reason}`); return { ok: true }; },
  };
  registerTournamentRetractionRoutes(server, {
    resolveActor: (async () => ({ kind: "user_account" })) as never,
    tournamentRetraction: service as never,
    csrfVerifier: { verify: () => true },
  });
  await server.ready();
  return { server, calls };
}

for (const action of ["remove", "reopen", "restore"]) {
  it(`answers 400 when ${action} has no reason`, async () => {
    const { server, calls } = await app();
    for (const payload of [{}, { reasonCode: "readme-demo" }, { reason: 7 }]) {
      const response = await server.inject({
        method: "POST", url: `/v1/administrator/tournaments/tournament.x/actions/${action}`,
        headers: { "x-mk8dx-csrf": "proof" }, payload,
      });
      assert.equal(response.statusCode, 400, JSON.stringify(payload));
      assert.equal(response.json().code, "tournament_invalid_input");
    }
    assert.deepEqual(calls, []);
    const ok = await server.inject({
      method: "POST", url: `/v1/administrator/tournaments/tournament.x/actions/${action}`,
      headers: { "x-mk8dx-csrf": "proof" }, payload: { reason: "a real reason" },
    });
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(calls, [`${action}:a real reason`]);
    await server.close();
  });
}
