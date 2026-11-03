import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import {
  AdministratorOverviewError,
  AdministratorOverviewService,
  MysqlAdministratorOverviewRepository,
  type AdministratorOverviewRepository,
} from "../src/administration/administrator-overview.js";
import type { IdentityReadRepository } from "../src/identity/types.js";

class NullIdentityReads implements IdentityReadRepository {
  async findPublicPlayerById(): Promise<null> { return null; }
  async findUserAccountSummaryById(): Promise<null> { return null; }
  async findPlayerClaimSummaryById(): Promise<null> { return null; }
}

const NOW = 1_800_000_000_000;

function repository(): AdministratorOverviewRepository & { windows: number[] } {
  const windows: number[] = [];
  return {
    windows,
    async registered() {
      return { signInIdentities: 9, accounts: 8, players: 71, linkedPlayers: 7, administrators: 1 };
    },
    async activeSince(sinceMs) {
      windows.push(NOW - sinceMs);
      const hours = (NOW - sinceMs) / 3_600_000;
      return { signedIn: hours <= 24 ? 2 : hours <= 24 * 7 ? 5 : 8, submitted: hours <= 24 ? 1 : 3 };
    },
    async pendingPlayerClaims() { return 2; },
  };
}

describe("administrator overview service", () => {
  it("refuses everybody but an administrator", async () => {
    const service = new AdministratorOverviewService(repository(), { nowMs: () => NOW });
    await expect(service.overview({ role: "account", userAccountId: "user_account.x" }))
      .rejects.toBeInstanceOf(AdministratorOverviewError);
    await expect(service.overview({ role: "anonymous" }))
      .rejects.toMatchObject({ code: "forbidden" });
  });

  it("asks for the three windows and assembles one document", async () => {
    const source = repository();
    const service = new AdministratorOverviewService(source, { nowMs: () => NOW });
    const overview = await service.overview({ role: "administrator", userAccountId: "user_account.ben" });
    expect(source.windows).toEqual([24 * 3_600_000, 7 * 24 * 3_600_000, 30 * 24 * 3_600_000]);
    expect(overview).toEqual({
      schemaVersion: "mk8dx.administrator-overview.v1",
      generatedAtMs: NOW,
      registered: { signInIdentities: 9, accounts: 8, players: 71, linkedPlayers: 7, administrators: 1 },
      active: {
        last24h: { signedIn: 2, submitted: 1 },
        last7d: { signedIn: 5, submitted: 3 },
        last30d: { signedIn: 8, submitted: 3 },
      },
      pending: { playerClaims: 2 },
    });
  });

  it("counts with bounded SQL and treats a missing count as zero", async () => {
    const seen: string[] = [];
    const executor = {
      async execute(sql: string, parameters: unknown[] = []) {
        seen.push(sql.replace(/\s+/gu, " ").trim());
        if (sql.includes("mk8dx_auth_session")) {
          expect(parameters).toEqual([NOW - 1, NOW - 1]);
          return [[{ countValue: "3" }], []];
        }
        if (sql.includes("player_claims") && sql.includes("'requested'")) { return [[], []]; }
        return [[{ countValue: 4 }], []];
      },
    };
    const repo = new MysqlAdministratorOverviewRepository(executor as never);
    expect(await repo.activeSince(NOW - 1)).toEqual({ signedIn: 3, submitted: 4 });
    expect(await repo.pendingPlayerClaims()).toBe(0);
    expect((await repo.registered()).players).toBe(4);
    expect(seen.some((sql) => sql.includes("player_kind = 'human' AND record_status = 'active'"))).toBe(true);
    expect(seen.some((sql) => sql.includes("publication_status = 'published'"))).toBe(true);
  });
});

const openApps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(openApps.splice(0).map((app) => app.close())); });

describe("administrator overview routes", () => {
  it("serves administrators on both paths and refuses the rest", async () => {
    let role: "administrator" | "account" = "administrator";
    const service = new AdministratorOverviewService(repository(), { nowMs: () => NOW });
    const app = await buildApp({
      identityRepository: new NullIdentityReads(),
      resolveActor: async () => ({ role, userAccountId: "user_account.ben" }),
      administratorOverview: { service },
    });
    openApps.push(app);

    const web = await app.inject({ method: "GET", url: "/v1/administrator/overview" });
    expect(web.statusCode).toBe(200);
    expect(web.headers["cache-control"]).toBe("no-store");
    expect(web.json()).toMatchObject({ pending: { playerClaims: 2 }, registered: { players: 71 } });

    const nativeWithoutToken = await app.inject({ method: "GET", url: "/v1/native/administrator/overview" });
    expect(nativeWithoutToken.statusCode).toBe(403);
    const native = await app.inject({
      method: "GET", url: "/v1/native/administrator/overview",
      headers: { authorization: `Bearer ${"t".repeat(40)}` },
    });
    expect(native.statusCode).toBe(200);

    role = "account";
    const refused = await app.inject({ method: "GET", url: "/v1/administrator/overview" });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual({
      code: "administrator_overview_forbidden", message: "Administrator access is required.",
    });
  });
});
