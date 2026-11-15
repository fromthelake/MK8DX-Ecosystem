import { randomBytes } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  AdministratorRequestBudgetsService,
  MysqlAdministratorRequestBudgetsRepository,
  type AdministratorRequestBudgets,
} from "../src/administration/administrator-request-budgets.js";
import { buildApp } from "../src/app.js";
import { ClaimLifecycleService, CLAIM_QUOTAS } from "../src/identity/claim-lifecycle-service.js";
import { MysqlClaimWriteRepository } from "../src/identity/mysql-claim-write-repository.js";
import { MysqlIdentityReadRepository } from "../src/identity/mysql-identity-read-repository.js";
import { CLAIM_ACCOUNT_BUDGETS } from "../src/identity/routes.js";
import type { ActorContext } from "../src/identity/types.js";
import { AbuseBudgets, defaultAbuseBudgetSettings, type AbuseBudgetSettings } from "../src/security/abuse-budgets.js";
import { MysqlMutationRateLimiter } from "../src/security/mysql-mutation-rate-limiter.js";
import { RefusalLedger } from "../src/security/refusal-ledger.js";

const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" &&
  /^[a-z][a-z0-9_]*(?:_test|_contract)$/.test(database) ? describe : describe.skip;

// The administrator view of request budgets: real refusals through real HTTP injection into the
// real application (claim routes, durable limiter, quota hook), counted in the refusal ledger of a
// disposable MySQL/MariaDB database, then read back through the real report route.
integration("administrator request budget report (real HTTP + real database)", () => {
  let pool: Pool;
  const run = randomBytes(4).toString("hex");
  const apps: FastifyInstance[] = [];
  let clockMs = 1_900_000_000_000;

  const settings = (): AbuseBudgetSettings => {
    const base = defaultAbuseBudgetSettings();
    return {
      ...base,
      claimRequestsPerPlayerPerDay: { windowSeconds: base.claimRequestsPerPlayerPerDay.windowSeconds, maximum: 2 },
    };
  };

  let ledger: RefusalLedger;

  async function reportApp(): Promise<FastifyInstance> {
    ledger = new RefusalLedger(pool, () => clockMs);
    const limiter = new MysqlMutationRateLimiter(pool, () => clockMs, undefined, ledger);
    const budgetSettings = settings();
    const resolveActor = async (request: FastifyRequest): Promise<ActorContext> => {
      const [kind, id] = (request.headers.authorization ?? "").split(" ");
      if (kind === "Account" && id !== undefined) { return { role: "account", userAccountId: id }; }
      if (kind === "Administrator" && id !== undefined) { return { role: "administrator", userAccountId: id }; }
      return { role: "anonymous" };
    };
    const app = await buildApp({
      identityRepository: new MysqlIdentityReadRepository(pool),
      resolveActor,
      abuseBudgets: new AbuseBudgets(limiter, budgetSettings),
      quotaRefusals: ledger,
      administratorRequestBudgets: {
        service: new AdministratorRequestBudgetsService(
          new MysqlAdministratorRequestBudgetsRepository(pool), budgetSettings, { nowMs: () => clockMs },
          undefined, () => ledger.unflushed()),
      },
      claimLifecycle: new ClaimLifecycleService(new MysqlClaimWriteRepository(pool), {
        newPlayerClaimId: () => `player_claim.rb_${randomBytes(8).toString("hex")}`,
        newRestrictedReviewId: () => `restricted_review.rb_${randomBytes(8).toString("hex")}`,
      }, { nowMs: () => clockMs }),
      claimCsrfVerifier: { verify: (actor, token) => actor.role !== "anonymous" && token === "csrf" },
    });
    apps.push(app);
    return app;
  }

  let seeded = 0;
  async function seed(kind: "player" | "account", screenName?: string): Promise<string> {
    seeded += 1;
    const id = `${kind === "player" ? "player" : "user_account"}.rb_${run}_${String(seeded)}`;
    if (kind === "player") {
      await pool.execute(
        `INSERT INTO players (public_id, revision, player_kind, display_name, record_status, created_at_ms, updated_at_ms)
         VALUES (?, 1, 'human', ?, 'active', 1, 1)`, [id, `Racer ${String(seeded)}`]);
    } else {
      await pool.execute(
        `INSERT INTO user_accounts (public_id, revision, privacy_class, account_status, screen_name, created_at_ms, updated_at_ms)
         VALUES (?, 1, 'private', 'active', ?, 1, 1)`, [id, screenName ?? null]);
    }
    return id;
  }

  const claim = (app: FastifyInstance, account: string, playerId: string) => app.inject({
    method: "POST", url: "/v1/player-claims",
    headers: { authorization: `Account ${account}`, "x-mk8dx-csrf": "csrf" },
    payload: { playerId, evidenceIds: [] },
  });
  const report = (app: FastifyInstance, authorization: string) => app.inject({
    method: "GET", url: "/v1/administrator/request-budgets", headers: { authorization },
  });

  beforeAll(async () => {
    pool = mysql.createPool({
      host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
      port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306"),
      user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "mk8dx_test",
      password: process.env["MK8DX_MYSQL_TEST_PASSWORD"] ?? "",
      database,
      connectionLimit: 8,
    });
  });

  afterEach(async () => {
    await pool.execute("DELETE FROM api_mutation_rate_limits");
    clockMs += 3 * 86_400_000;
  });

  afterAll(async () => {
    for (const app of apps) { await app.close(); }
    if (pool === undefined) { return; }
    const players = `player.rb_${run}_%`;
    await pool.execute(`DELETE n FROM player_claim_notes n INNER JOIN player_claims c ON c.player_claim_id = n.player_claim_id
      INNER JOIN players p ON p.player_id = c.player_id WHERE p.public_id LIKE ?`, [players]);
    await pool.execute(`DELETE l FROM player_claim_lifecycle l INNER JOIN player_claims c ON c.player_claim_id = l.player_claim_id
      INNER JOIN players p ON p.player_id = c.player_id WHERE p.public_id LIKE ?`, [players]);
    await pool.execute(`DELETE c FROM player_claims c INNER JOIN players p ON p.player_id = c.player_id
      WHERE p.public_id LIKE ?`, [players]);
    await pool.execute("DELETE FROM players WHERE public_id LIKE ?", [players]);
    await pool.execute("DELETE FROM user_accounts WHERE public_id LIKE ?", [`user_account.rb_${run}_%`]);
    await pool.end();
  });

  it("counts target, account and quota refusals per scope, names only accounts, and shows headroom", async () => {
    const app = await reportApp();
    const victim = await seed("player");
    const attackers = [await seed("account"), await seed("account"), await seed("account"), await seed("account")];
    // Per-target budget of 2 claims per Player and day: two admitted, two refused (429).
    const targeted = [];
    for (const attacker of attackers) { targeted.push((await claim(app, attacker, victim)).statusCode); }
    expect(targeted).toEqual([201, 201, 429, 429]);

    // One account: five open claims, then the hard quota (409), until its own hourly budget refuses (429).
    const busy = await seed("account", "Budget Racer");
    const statuses: number[] = [];
    for (let index = 0; index <= CLAIM_ACCOUNT_BUDGETS.selfPerHour; index += 1) {
      statuses.push((await claim(app, busy, await seed("player"))).statusCode);
    }
    const quotaRefusals = CLAIM_ACCOUNT_BUDGETS.selfPerHour - CLAIM_QUOTAS.openRequestsPerAccount;
    expect(statuses.filter((status) => status === 201)).toHaveLength(CLAIM_QUOTAS.openRequestsPerAccount);
    expect(statuses.filter((status) => status === 409)).toHaveLength(quotaRefusals);
    expect(statuses.at(-1)).toBe(429);

    const administrator = await seed("account");
    const ledgerRows = async (): Promise<string[]> => {
      const [rows] = await pool.execute<RowDataPacket[]>(
        "SELECT scope_key AS scopeKey FROM api_mutation_rate_limits WHERE scope_key LIKE '!refused|%' ORDER BY scope_key");
      return rows.map((row) => String(row["scopeKey"]));
    };
    // Refusals cost no database write: nothing of the ledger is in the table before a flush, and the
    // report already shows this process's counts from memory.
    expect(await ledgerRows()).toEqual([]);
    const fromMemory = (await report(app, `Administrator ${administrator}`)).json<AdministratorRequestBudgets>();
    await ledger.flush();
    expect(ledger.unflushed()).toEqual([]);
    const response = await report(app, `Administrator ${administrator}`);
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json<AdministratorRequestBudgets>();
    // The same numbers from memory and, after the flush, from the database (no double count).
    expect({ ...fromMemory, generatedAtMs: 0 }).toEqual({ ...body, generatedAtMs: 0 });
    const scope = (name: string) => body.refusals.find((item) => item.scope === name);

    expect(scope("player-claims.requests.player.day")).toEqual({
      scope: "player-claims.requests.player.day", lastHour: 2, lastDay: 2,
      subjectKind: "target", subjectsLastDay: 1, topAccounts: [],
    });
    expect(scope("player-claims.self.hour")).toEqual({
      scope: "player-claims.self.hour", lastHour: 1, lastDay: 1, subjectKind: "account", subjectsLastDay: 1,
      topAccounts: [{ accountId: busy, screenName: "Budget Racer", refusedLastDay: 1 }],
    });
    expect(scope("quota.claim_quota_exceeded")).toEqual({
      scope: "quota.claim_quota_exceeded", lastHour: quotaRefusals, lastDay: quotaRefusals,
      subjectKind: null, subjectsLastDay: 0, topAccounts: [],
    });
    expect(body.refusalsTruncated).toBe(false);
    // Digests of targets never leave the server; the other accounts are not named.
    expect(response.body).not.toMatch(/target\.|recipient\.|preauth-slot\./);
    for (const attacker of attackers) { expect(response.body).not.toContain(attacker); }

    // Headroom of the installation claim budget: every request admitted by the account budgets counted.
    const admitted = attackers.length + CLAIM_ACCOUNT_BUDGETS.selfPerHour;
    expect(body.headroom.find((item) => item.scope === "player-claims.requests.hour")).toMatchObject({
      setting: "MK8DX_HOSTED_BUDGET_CLAIM_REQUESTS_PER_HOUR", windowSeconds: 3_600, used: admitted,
      maximum: 300, refused: 0,
    });
    expect(body.headroom.find((item) => item.scope === "tournament-evidence.installation"))
      .toMatchObject({ setting: null, used: 0, maximum: 6_000 });
    expect(body.settings.find((item) => item.name === "claimRequestsPerPlayerPerDay"))
      .toEqual({ name: "claimRequestsPerPlayerPerDay", setting: "MK8DX_HOSTED_BUDGET_CLAIM_REQUESTS_PER_PLAYER_PER_DAY",
        windowSeconds: 86_400, value: 2, defaultValue: 5 });

    // The ledger stores a subject row only for a refused subject: the target and the busy account.
    const keys = await ledgerRows();
    expect(keys.filter((key) => !key.endsWith("|*"))).toHaveLength(2);
    expect(keys.some((key) => key === `!refused|player-claims.self.hour|${busy}`)).toBe(true);

    // Two hours later the last hour is empty and the day still counts them.
    clockMs += 2 * 3_600_000;
    const later = (await report(app, `Administrator ${administrator}`)).json<AdministratorRequestBudgets>();
    expect(later.refusals.find((item) => item.scope === "player-claims.self.hour"))
      .toMatchObject({ lastHour: 0, lastDay: 1 });
    // After a day and a bit nothing is reported.
    clockMs += 24 * 3_600_000;
    const dayLater = (await report(app, `Administrator ${administrator}`)).json<AdministratorRequestBudgets>();
    expect(dayLater.refusals).toEqual([]);
  });

  it("counts every refusal of a concurrent burst from two API processes exactly, without a database error", async () => {
    // Regression (CI 2026-11-15): ledger writes on the refusal path deadlocked against the budget
    // upserts of a burst. Now the burst writes only budget rows; both processes then flush together.
    for (let round = 0; round < 3; round += 1) {
      const scope = `rb-burst-${run}-${String(round)}`;
      const ledgers = [0, 1].map(() => new RefusalLedger(pool, () => clockMs));
      const limiters = ledgers.map((owned) => new MysqlMutationRateLimiter(pool, () => clockMs, undefined, owned));
      const outcomes = await Promise.allSettled(Array.from({ length: 60 }, (_, index) =>
        limiters[index % 2]!.consume(index % 3 === 0 ? "installation" : `user_account.rb_${run}_burst`, scope, 3_600, 5)));
      const failed = outcomes.filter((outcome) => outcome.status === "rejected")
        .map((outcome) => (outcome as PromiseRejectedResult).reason as Error);
      expect(failed.filter((error) => error.name !== "MutationRateLimitExceeded").map((error) => error.message)).toEqual([]);
      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(10);
      const [before] = await pool.execute<RowDataPacket[]>(
        "SELECT COUNT(*) AS total FROM api_mutation_rate_limits WHERE scope_key LIKE ?", [`!refused|${scope}|%`]);
      expect(Number(before[0]?.["total"])).toBe(0);
      await Promise.all(ledgers.map((owned) => owned.flush()));
      const [rows] = await pool.execute<RowDataPacket[]>(
        "SELECT SUM(event_count) AS total FROM api_mutation_rate_limits WHERE scope_key = ?",
        [`!refused|${scope}|*`]);
      expect(Number(rows[0]?.["total"])).toBe(50);
    }
  });

  it("is for administrators only", async () => {
    const app = await reportApp();
    const account = await seed("account");
    const refused = await report(app, `Account ${account}`);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual({
      code: "administrator_request_budgets_forbidden", message: "Administrator access is required.",
    });
    expect((await report(app, "")).statusCode).toBe(403);
  });
});
