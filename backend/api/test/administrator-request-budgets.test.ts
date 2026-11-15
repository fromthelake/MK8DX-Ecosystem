import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { registerAdministratorRequestBudgetRoutes } from "../src/administration/administrator-request-budgets-routes.js";
import {
  AdministratorRequestBudgetsService,
  requestBudgetSubjectKind,
  type AdministratorRequestBudgetsRepository,
} from "../src/administration/administrator-request-budgets.js";
import {
  INSTALLATION_BUDGET_SCOPES,
  defaultAbuseBudgetSettings,
  quotaRefusalCode,
} from "../src/security/abuse-budgets.js";
import { MysqlMutationRateLimiter, MutationRateLimitExceeded } from "../src/security/mysql-mutation-rate-limiter.js";

const NOW = 1_900_000_000_000;

function repository(overrides: Partial<AdministratorRequestBudgetsRepository> = {}): AdministratorRequestBudgetsRepository {
  return {
    refusalTotals: async () => [],
    refusalSubjects: async () => [],
    accountScreenNames: async () => new Map(),
    budgetCounts: async () => [],
    ...overrides,
  };
}

describe("administrator request budget report", () => {
  it("is for administrators only", async () => {
    const service = new AdministratorRequestBudgetsService(repository(), undefined, { nowMs: () => NOW });
    await expect(service.report({ role: "account", userAccountId: "user_account.a" }))
      .rejects.toMatchObject({ code: "forbidden" });
    await expect(service.report({ role: "anonymous" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("groups refusals per scope, names only accounts and computes headroom from the current windows", async () => {
    const asked: string[][] = [];
    const service = new AdministratorRequestBudgetsService(repository({
      refusalTotals: async () => [
        { scope: "player-claims.self.hour", lastHour: 3, lastDay: 7 },
        { scope: "auth-email.recipient.hour", lastHour: 0, lastDay: 9 },
        { scope: "quota.alias_quota_exceeded", lastHour: 1, lastDay: 1 },
      ],
      refusalSubjects: async () => [
        { scope: "player-claims.self.hour", subject: "user_account.b", refused: 5 },
        { scope: "player-claims.self.hour", subject: "user_account.a", refused: 2 },
        { scope: "auth-email.recipient.hour", subject: "recipient.0123456789abcdef", refused: 9 },
      ],
      accountScreenNames: async (ids) => { asked.push([...ids]); return new Map([["user_account.b", "Bee"]]); },
      budgetCounts: async (keys) => keys.includes("auth-email.hour|installation")
        ? [{ scopeKey: "auth-email.hour|installation", windowStartedAtMs: Math.floor(NOW / 3_600_000) * 3_600_000, eventCount: 650 },
          // An earlier window of the same budget does not count.
          { scopeKey: "aliases.hour|installation", windowStartedAtMs: 0, eventCount: 999 }]
        : [],
    }), defaultAbuseBudgetSettings(), { nowMs: () => NOW });

    const report = await service.report({ role: "administrator", userAccountId: "user_account.admin" });
    expect(report.refusals.map((item) => item.scope))
      .toEqual(["auth-email.recipient.hour", "player-claims.self.hour", "quota.alias_quota_exceeded"]);
    expect(report.refusals[0]).toEqual({
      scope: "auth-email.recipient.hour", lastHour: 0, lastDay: 9, subjectKind: "recipient", subjectsLastDay: 1, topAccounts: [],
    });
    expect(report.refusals[1]!.topAccounts).toEqual([
      { accountId: "user_account.b", screenName: "Bee", refusedLastDay: 5 },
      { accountId: "user_account.a", screenName: null, refusedLastDay: 2 },
    ]);
    expect(report.refusals[2]).toMatchObject({ subjectKind: null, subjectsLastDay: 0 });
    expect(asked).toEqual([["user_account.b", "user_account.a"]]);
    expect(JSON.stringify(report)).not.toContain("recipient.0123");

    const authHour = report.headroom.find((item) => item.scope === "auth-email.hour");
    expect(authHour).toMatchObject({ used: 600, maximum: 600, refused: 50, setting: "MK8DX_HOSTED_BUDGET_AUTH_EMAILS_PER_HOUR" });
    expect(authHour!.windowEndsAtMs).toBe(Math.floor(NOW / 3_600_000) * 3_600_000 + 3_600_000);
    expect(report.headroom.find((item) => item.scope === "aliases.hour")).toMatchObject({ used: 0, refused: 0 });
    expect(report.settings).toHaveLength(Object.keys(defaultAbuseBudgetSettings()).length);
    expect(report.refusalsTruncated).toBe(false);
  });

  it("classifies limiter subjects by prefix only", () => {
    expect(requestBudgetSubjectKind("user_account.x")).toBe("account");
    expect(requestBudgetSubjectKind("installation")).toBe("installation");
    expect(requestBudgetSubjectKind("target.ab")).toBe("target");
    expect(requestBudgetSubjectKind("preauth-slot.12")).toBe("address");
    expect(requestBudgetSubjectKind("device.ab")).toBe("device");
    expect(requestBudgetSubjectKind("3f7c1b9e-0000-4000-8000-000000000000")).toBe("other");
  });

  it("answers through its response schema and refuses an unknown key from the service", async () => {
    const app = Fastify();
    const service = new AdministratorRequestBudgetsService(repository(), undefined, { nowMs: () => NOW });
    await registerAdministratorRequestBudgetRoutes(app, {
      resolveActor: async (request) => request.headers.authorization === "admin"
        ? { role: "administrator", userAccountId: "user_account.admin" } : { role: "anonymous" },
      service,
    });
    const ok = await app.inject({ method: "GET", url: "/v1/administrator/request-budgets", headers: { authorization: "admin" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ schemaVersion: "mk8dx.administrator-request-budgets.v1", refusals: [] });
    expect((await app.inject({ method: "GET", url: "/v1/administrator/request-budgets" })).statusCode).toBe(403);
    await app.close();
  });
});

describe("web and API agree on the report", () => {
  it("the website parses exactly what the response schema lets through, and refuses an unknown key", async () => {
    const app = Fastify();
    const service = new AdministratorRequestBudgetsService(repository({
      refusalTotals: async () => [{ scope: "player-claims.self.hour", lastHour: 1, lastDay: 2 },
        { scope: "quota.step_up_required", lastHour: 1, lastDay: 1 }],
      refusalSubjects: async () => [{ scope: "player-claims.self.hour", subject: "user_account.b", refused: 2 }],
      accountScreenNames: async () => new Map([["user_account.b", "Bee"]]),
      budgetCounts: async () => [{ scopeKey: "aliases.day|installation",
        windowStartedAtMs: Math.floor(NOW / 86_400_000) * 86_400_000, eventCount: 12 }],
    }), undefined, { nowMs: () => NOW });
    await registerAdministratorRequestBudgetRoutes(app, {
      resolveActor: async () => ({ role: "administrator", userAccountId: "user_account.admin" }),
      service,
    });
    const response = await app.inject({ method: "GET", url: "/v1/administrator/request-budgets" });
    await app.close();
    expect(response.statusCode).toBe(200);
    // Outside this package's rootDir, so imported by a computed path.
    const path = new URL("../../../apps/timetrials-web/src/administrator-request-budgets-client.ts", import.meta.url).href;
    const web = await import(/* @vite-ignore */ path) as {
      parseAdministratorRequestBudgets(body: unknown): Readonly<Record<string, unknown>>;
    };
    const body = response.json<Record<string, unknown>>();
    const parsed = web.parseAdministratorRequestBudgets(body);
    expect({ schemaVersion: body["schemaVersion"], ...parsed }).toEqual(body);
    expect(() => web.parseAdministratorRequestBudgets({ ...body, extra: 1 })).toThrow();
    const refusals = body["refusals"] as Record<string, unknown>[];
    expect(() => web.parseAdministratorRequestBudgets({ ...body, refusals: [{ ...refusals[0], subject: "x" }] })).toThrow();
  });
});

describe("refusal ledger", () => {
  it("counts a limiter refusal for the installation and the refused subject, and still refuses when the ledger fails", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    let failLedger = false;
    const executor = {
      async execute(sql: string, values: unknown[]) {
        statements.push({ sql, values });
        if (sql.includes("event_count = event_count + 1")) {
          if (failLedger) { throw new Error("ledger down"); }
          return [{ affectedRows: 2 }, []];
        }
        if (sql.includes("INSERT INTO")) { return [{ insertId: 3 }, []]; }
        return [{ affectedRows: 0 }, []];
      },
    };
    const failures: string[] = [];
    const limiter = new MysqlMutationRateLimiter(executor as never, () => NOW, {
      cleanupCompleted() {}, cleanupFailed() {}, refusalsSinceLastReport() {},
      ledgerFailed(name) { failures.push(name); },
    });
    await expect(limiter.consume("user_account.ben", "alias-mutations-hour", 3_600, 2))
      .rejects.toBeInstanceOf(MutationRateLimitExceeded);
    // One row per statement (a two-row upsert deadlocked against a concurrent burst).
    const ledger = statements.filter((statement) => statement.sql.includes("event_count = event_count + 1"));
    expect(ledger.map((statement) => statement.values)).toEqual([
      ["!refused|alias-mutations-hour|*", Math.floor(NOW / 300_000) * 300_000, NOW],
      ["!refused|alias-mutations-hour|user_account.ben", Math.floor(NOW / 3_600_000) * 3_600_000, NOW],
    ]);

    failLedger = true;
    await expect(limiter.consume("user_account.ben", "alias-mutations-hour", 3_600, 2))
      .rejects.toBeInstanceOf(MutationRateLimitExceeded);
    expect(failures).toEqual(["Error", "Error"]);

    statements.length = 0;
    failLedger = false;
    await limiter.recordQuotaRefusal("alias_quota_exceeded");
    await limiter.recordQuotaRefusal("Not A Code");
    expect(statements).toHaveLength(1);
    expect(statements[0]!.values).toEqual(["!refused|quota.alias_quota_exceeded|*", Math.floor(NOW / 300_000) * 300_000, NOW]);
  });

  it("runs a deadlock victim again instead of failing the request", async () => {
    let deadlocks = 2;
    let inserts = 0;
    const executor = {
      async execute(sql: string) {
        if (sql.includes("LAST_INSERT_ID(1)")) {
          if (deadlocks > 0) { deadlocks -= 1; throw Object.assign(new Error("Deadlock found"), { code: "ER_LOCK_DEADLOCK" }); }
          inserts += 1;
          return [{ insertId: 1 }, []];
        }
        return [{ affectedRows: 0 }, []];
      },
    };
    await new MysqlMutationRateLimiter(executor as never, () => NOW).consume("user_account.ben", "alias-mutations-hour", 3_600, 2);
    expect(inserts).toBe(1);
    const other = { async execute() { throw Object.assign(new Error("gone"), { code: "ER_ACCESS_DENIED_ERROR" }); } };
    await expect(new MysqlMutationRateLimiter(other as never, () => NOW).consume("user_account.ben", "x", 60, 1))
      .rejects.toThrow("gone");
  });

  it("recognises quota refusals by their fixed code only", () => {
    expect(quotaRefusalCode(409, JSON.stringify({ code: "alias_quota_exceeded", message: "x" }))).toBe("alias_quota_exceeded");
    expect(quotaRefusalCode(409, JSON.stringify({ code: "native_tournament_evidence_quota_exceeded", message: "x" })))
      .toBe("native_tournament_evidence_quota_exceeded");
    expect(quotaRefusalCode(403, JSON.stringify({ statusCode: 403, error: "Forbidden", code: "step_up_required" })))
      .toBe("step_up_required");
    expect(quotaRefusalCode(429, JSON.stringify({ code: "engagement_recipient_limit", message: "x" }))).toBe("engagement_recipient_limit");
    // Limiter refusals are counted by the limiter, not again here; other errors are not quotas.
    expect(quotaRefusalCode(429, JSON.stringify({ code: "alias_rate_limited", message: "x" }))).toBeNull();
    expect(quotaRefusalCode(403, JSON.stringify({ code: "forbidden", message: "x" }))).toBeNull();
    expect(quotaRefusalCode(200, JSON.stringify({ code: "alias_quota_exceeded" }))).toBeNull();
    expect(quotaRefusalCode(409, Buffer.from("{}"))).toBeNull();
  });

  it("lists every installation budget a route spends (bound to the source)", () => {
    const root = fileURLToPath(new URL("../src", import.meta.url));
    const found = new Set<string>();
    const walk = (directory: string): void => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) { walk(path); continue; }
        if (!name.endsWith(".ts")) { continue; }
        const text = readFileSync(path, "utf8");
        for (const match of text.matchAll(/(?:forInstallation|budgets\.installation|\.installation)\(\s*"([a-z0-9._-]+)"/g)) {
          found.add(match[1]!);
        }
      }
    };
    walk(root);
    expect([...found].sort()).toEqual(INSTALLATION_BUDGET_SCOPES.map((entry) => entry.scope).sort());
  });
});
