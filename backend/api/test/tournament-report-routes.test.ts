import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerTournamentReportRoutes } from "../src/tournaments/tournament-report-routes.js";
import {
  TournamentReportService,
  type TournamentReportRepository,
} from "../src/tournaments/tournament-report-service.js";

function repository(authorized: boolean): TournamentReportRepository {
  return {
    hasCapability: vi.fn(async () => authorized),
    listActiveGrants: vi.fn(async () => []),
    grant: vi.fn(async (input) => ({
      grantId: input.grantId,
      userAccountId: input.userAccountId,
      capability: "tournament.analytics.night_report",
      status: "active",
      revision: 1,
      grantedAtMs: input.occurredAtMs,
    })),
    revoke: vi.fn(),
    loadDraft: vi.fn(async () => null),
    saveDraft: vi.fn(),
  } as never;
}

async function application(
  role: "account" | "administrator",
  authorized: boolean,
  csrf = true,
) {
  const app = Fastify();
  const service = new TournamentReportService(
    repository(authorized),
    { loadForReport: vi.fn(async () => ({
      schemaVersion: "mk8dx.tournament-operation.v1",
      summary: { tournamentId: "tournament.synthetic01" },
      participants: [], stations: [], groups: [], overall: [], lifecycle: [],
    })) } as never,
    { newGrantId: () => "account_capability_grant.synthetic01" },
    { nowMs: () => 42 },
  );
  await registerTournamentReportRoutes(app, {
    resolveActor: async () => ({ role, userAccountId: `user_account.${role}` }) as never,
    service,
    csrfVerifier: { verify: () => csrf },
  });
  await app.ready();
  return app;
}

describe("Tournament report HTTP authorization", () => {
  it("denies an ungranted account and serves the same report after explicit capability grant", async () => {
    const denied = await application("account", false);
    expect((await denied.inject({ method: "GET", url: "/v1/tournament-reports/tournament.synthetic01" })).statusCode).toBe(403);
    await denied.close();

    const allowed = await application("account", true);
    const response = await allowed.inject({ method: "GET", url: "/v1/tournament-reports/tournament.synthetic01" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ schemaVersion: "mk8dx.tournament-night-report.v1" });
    await allowed.close();
  });

  it("requires both Admin authority and a valid CSRF proof for delegation", async () => {
    const ordinary = await application("account", true);
    expect((await ordinary.inject({ method: "POST", url: "/v1/administrator/tournament-report-capabilities", headers: { "x-mk8dx-csrf": "valid" }, payload: { userAccountId: "user_account.evan", reasonCode: "report_author_access" } })).statusCode).toBe(403);
    await ordinary.close();

    const rejected = await application("administrator", true, false);
    expect((await rejected.inject({ method: "POST", url: "/v1/administrator/tournament-report-capabilities", headers: { "x-mk8dx-csrf": "invalid" }, payload: { userAccountId: "user_account.evan", reasonCode: "report_author_access" } })).statusCode).toBe(403);
    await rejected.close();

    const admin = await application("administrator", true);
    expect((await admin.inject({ method: "POST", url: "/v1/administrator/tournament-report-capabilities", headers: { "x-mk8dx-csrf": "valid" }, payload: { userAccountId: "user_account.evan", reasonCode: "report_author_access" } })).statusCode).toBe(200);
    await admin.close();
  });
});
