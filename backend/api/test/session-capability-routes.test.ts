import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import type { ActorContext, IdentityReadRepository } from "../src/identity/types.js";


class NullIdentityReads implements IdentityReadRepository {
  async findPublicPlayerById(): Promise<null> { return null; }
  async findUserAccountSummaryById(): Promise<null> { return null; }
  async findPlayerClaimSummaryById(): Promise<null> { return null; }
}

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

async function app(actor: ActorContext): Promise<FastifyInstance> {
  const instance = await buildApp({
    identityRepository: new NullIdentityReads(),
    resolveActor: async () => actor,
  });
  openApps.push(instance);
  return instance;
}

describe("closed web session capability boundary", () => {
  it("distinguishes only current account and administrator capability", async () => {
    for (const [actor, administrator] of [
      [{ role: "account", userAccountId: "user_account.session_account_01" }, false],
      [{ role: "administrator", userAccountId: "user_account.session_admin_01" }, true],
    ] as const) {
      const response = await (await app(actor)).inject({
        method: "GET",
        url: "/v1/session/capabilities",
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toEqual({
        schemaVersion: "mk8dx.web-session-capabilities.v1",
        administrator,
        tournamentOperation: administrator,
      });
      expect(response.body).not.toMatch(/user_account|email|grant|claim/i);
    }
  });

  it("projects the bounded Tournament operator capability without administrator access", async () => {
    const actor = { role: "account" as const, userAccountId: "user_account.evan" };
    const instance = await buildApp({
      identityRepository: new NullIdentityReads(),
      resolveActor: async () => actor,
      tournamentOperatorCapabilities: {
        service: { has: async (userAccountId: string) => userAccountId === "user_account.evan" } as never,
        csrfVerifier: { verify: () => true },
      },
    });
    openApps.push(instance);
    const response = await instance.inject({ method: "GET", url: "/v1/session/capabilities" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schemaVersion: "mk8dx.web-session-capabilities.v1",
      administrator: false,
      tournamentOperation: true,
    });
  });

  it("does not expose capabilities to non-account actors", async () => {
    for (const [actor, status] of [
      [{ role: "anonymous" }, 401],
      [{ role: "migration_operator" }, 403],
    ] as const) {
      const response = await (await app(actor)).inject({
        method: "GET",
        url: "/v1/session/capabilities",
      });
      expect(response.statusCode).toBe(status);
      expect(response.headers["cache-control"]).toBe("no-store");
    }
  });
});
