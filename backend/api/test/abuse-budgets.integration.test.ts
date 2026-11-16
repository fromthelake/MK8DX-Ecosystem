import { randomBytes } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";
import Fastify from "fastify";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { AuthEmailBudgets } from "../src/authentication/auth-email-budgets.js";
import { registerNativeEmailApprovalRoutes } from "../src/authentication/native-email-approval-routes.js";
import { ClaimLifecycleService, CLAIM_QUOTAS } from "../src/identity/claim-lifecycle-service.js";
import { MysqlClaimWriteRepository } from "../src/identity/mysql-claim-write-repository.js";
import { MysqlIdentityReadRepository } from "../src/identity/mysql-identity-read-repository.js";
import type { ActorContext } from "../src/identity/types.js";
import { withNotificationFanOutBudget } from "../src/notifications/notification-fan-out-budget.js";
import {
  AbuseBudgets,
  defaultAbuseBudgetSettings,
  type AbuseBudgetName,
  type AbuseBudgetSettings,
} from "../src/security/abuse-budgets.js";
import { MysqlMutationRateLimiter } from "../src/security/mysql-mutation-rate-limiter.js";
import { PreAuthBudget } from "../src/security/pre-auth-budget.js";

const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" &&
  /^[a-z][a-z0-9_]*(?:_test|_contract)$/.test(database) ? describe : describe.skip;

// H1: per-account, installation-wide and per-target budgets plus hard claim quotas, through real
// HTTP injection into the real application, the real claim service and repository, and the real
// durable limiter on a disposable MySQL/MariaDB database.
integration("H1 abuse budgets (real HTTP + real database)", () => {
  let pool: Pool;
  const run = randomBytes(4).toString("hex");
  const players: string[] = [];
  const accounts: string[] = [];
  const apps: FastifyInstance[] = [];
  let clockMs = 1_900_000_000_000;

  const settings = (overrides: Partial<Record<AbuseBudgetName, number>>): AbuseBudgetSettings => {
    const base = defaultAbuseBudgetSettings();
    const result: Record<string, { windowSeconds: number; maximum: number }> = { ...base };
    for (const [name, maximum] of Object.entries(overrides)) {
      result[name] = { windowSeconds: base[name as AbuseBudgetName].windowSeconds, maximum: maximum! };
    }
    return result as AbuseBudgetSettings;
  };

  async function claimApp(overrides: Partial<Record<AbuseBudgetName, number>> = {}): Promise<FastifyInstance> {
    const limiter = new MysqlMutationRateLimiter(pool, () => clockMs);
    const resolveActor = async (request: FastifyRequest): Promise<ActorContext> => {
      const header = request.headers.authorization ?? "";
      const [kind, id] = header.split(" ");
      if (kind === "Account" && id !== undefined) { return { role: "account", userAccountId: id }; }
      if (kind === "Administrator" && id !== undefined) { return { role: "administrator", userAccountId: id }; }
      return { role: "anonymous" };
    };
    const app = await buildApp({
      identityRepository: new MysqlIdentityReadRepository(pool),
      resolveActor,
      abuseBudgets: new AbuseBudgets(limiter, settings(overrides)),
      claimLifecycle: new ClaimLifecycleService(new MysqlClaimWriteRepository(pool), {
        newPlayerClaimId: () => `player_claim.h1_${randomBytes(8).toString("hex")}`,
        newRestrictedReviewId: () => `restricted_review.h1_${randomBytes(8).toString("hex")}`,
      }, { nowMs: () => clockMs }),
      claimCsrfVerifier: { verify: (actor, token) => actor.role !== "anonymous" && token === "csrf" },
    });
    apps.push(app);
    return app;
  }

  async function seed(kind: "players" | "accounts", count: number): Promise<string[]> {
    const created: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const id = kind === "players"
        ? `player.h1_${run}_${String(players.length + index)}`
        : `user_account.h1_${run}_${String(accounts.length + index)}`;
      if (kind === "players") {
        await pool.execute(
          `INSERT INTO players (public_id, revision, player_kind, display_name, record_status, created_at_ms, updated_at_ms)
           VALUES (?, 1, 'human', ?, 'active', 1, 1)`, [id, `Racer ${id.slice(-6)}`]);
      } else {
        await pool.execute(
          `INSERT INTO user_accounts (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
           VALUES (?, 1, 'private', 'active', 1, 1)`, [id]);
      }
      created.push(id);
    }
    (kind === "players" ? players : accounts).push(...created);
    return created;
  }

  const claim = (app: FastifyInstance, account: string, playerId: string, note?: string) => app.inject({
    method: "POST", url: "/v1/player-claims",
    headers: { authorization: `Account ${account}`, "x-mk8dx-csrf": "csrf" },
    payload: { playerId, evidenceIds: [], ...(note === undefined ? {} : { note }) },
  });
  const reply = (app: FastifyInstance, account: string, claimId: string) => app.inject({
    method: "POST", url: `/v1/player-claims/${claimId}/replies`,
    headers: { authorization: `Account ${account}`, "x-mk8dx-csrf": "csrf" },
    payload: { note: "Here is where I played." },
  });

  async function count(sql: string, values: (string | number)[]): Promise<number> {
    const [rows] = await pool.execute<Array<{ total: number } & RowDataPacket>>(sql, values);
    return Number(rows[0]?.total);
  }
  const claimsOnPlayer = (playerId: string) => count(
    `SELECT COUNT(*) AS total FROM player_claims c INNER JOIN players p ON p.player_id = c.player_id
     WHERE p.public_id = ?`, [playerId]);
  const claimsOfAccount = (account: string) => count(
    `SELECT COUNT(*) AS total FROM player_claims c INNER JOIN user_accounts a ON a.user_account_id = c.user_account_id
     WHERE a.public_id = ?`, [account]);

  beforeAll(async () => {
    pool = mysql.createPool({
      host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
      port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306"),
      user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "mk8dx_test",
      password: process.env["MK8DX_MYSQL_TEST_PASSWORD"] ?? "",
      database,
      connectionLimit: 16,
    });
  });

  afterEach(async () => {
    // Every case starts with empty budgets (this schema belongs to this suite alone).
    await pool.execute("DELETE FROM api_mutation_rate_limits");
    clockMs += 3 * 86_400_000;
  });

  afterAll(async () => {
    for (const app of apps) { await app.close(); }
    if (pool === undefined) { return; }
    await pool.execute(`DELETE n FROM player_claim_notes n INNER JOIN player_claims c ON c.player_claim_id = n.player_claim_id
      INNER JOIN players p ON p.player_id = c.player_id WHERE p.public_id LIKE ?`, [`player.h1_${run}_%`]);
    await pool.execute(`DELETE l FROM player_claim_lifecycle l INNER JOIN player_claims c ON c.player_claim_id = l.player_claim_id
      INNER JOIN players p ON p.player_id = c.player_id WHERE p.public_id LIKE ?`, [`player.h1_${run}_%`]);
    await pool.execute(`DELETE c FROM player_claims c INNER JOIN players p ON p.player_id = c.player_id
      WHERE p.public_id LIKE ?`, [`player.h1_${run}_%`]);
    await pool.execute("DELETE FROM players WHERE public_id LIKE ?", [`player.h1_${run}_%`]);
    await pool.execute("DELETE FROM user_accounts WHERE public_id LIKE ?", [`user_account.h1_${run}_%`]);
    await pool.end();
  });

  it("caps open claim requests per account just under and over the quota, without touching another account", async () => {
    const app = await claimApp();
    const [first, second] = await seed("accounts", 2);
    const targets = await seed("players", CLAIM_QUOTAS.openRequestsPerAccount + 2);
    for (let index = 0; index < CLAIM_QUOTAS.openRequestsPerAccount; index += 1) {
      expect((await claim(app, first!, targets[index]!)).statusCode).toBe(201);
    }
    const over = await claim(app, first!, targets[CLAIM_QUOTAS.openRequestsPerAccount]!);
    expect(over.statusCode).toBe(409);
    expect(over.json()).toMatchObject({ code: "claim_quota_exceeded" });
    expect(await claimsOfAccount(first!)).toBe(CLAIM_QUOTAS.openRequestsPerAccount);
    expect(await claimsOnPlayer(targets[CLAIM_QUOTAS.openRequestsPerAccount]!)).toBe(0);
    // Another person is unaffected.
    expect((await claim(app, second!, targets[CLAIM_QUOTAS.openRequestsPerAccount + 1]!)).statusCode).toBe(201);
  });

  it("holds the account quota under a concurrent burst (row lock, no double admission)", async () => {
    const app = await claimApp();
    const [account] = await seed("accounts", 1);
    const targets = await seed("players", 12);
    const responses = await Promise.all(targets.map((playerId) => claim(app, account!, playerId)));
    const created = responses.filter((response) => response.statusCode === 201).length;
    expect(created).toBe(CLAIM_QUOTAS.openRequestsPerAccount);
    expect(responses.every((response) => [201, 409].includes(response.statusCode))).toBe(true);
    expect(await claimsOfAccount(account!)).toBe(CLAIM_QUOTAS.openRequestsPerAccount);
  });

  it("protects one Player from many accounts: per-target budget (429) and per-Player quota (409)", async () => {
    const budgeted = await claimApp({ claimRequestsPerPlayerPerDay: 3 });
    const [victim] = await seed("players", 1);
    const attackers = await seed("accounts", 6);
    const results = [];
    for (const attacker of attackers) { results.push(await claim(budgeted, attacker, victim!)); }
    expect(results.slice(0, 3).map((response) => response.statusCode)).toEqual([201, 201, 201]);
    for (const refused of results.slice(3)) {
      expect(refused.statusCode).toBe(429);
      expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
      expect(refused.json()).toMatchObject({ code: "claim_rate_limited" });
    }
    expect(await claimsOnPlayer(victim!)).toBe(3);

    // With a generous target budget the database quota still holds the Player at its limit.
    await pool.execute("DELETE FROM api_mutation_rate_limits");
    const quotaOnly = await claimApp({ claimRequestsPerPlayerPerDay: 1_000 });
    const [second] = await seed("players", 1);
    const many = await seed("accounts", CLAIM_QUOTAS.openRequestsPerPlayer + 3);
    const burst = await Promise.all(many.map((attacker) => claim(quotaOnly, attacker, second!)));
    expect(burst.filter((response) => response.statusCode === 201)).toHaveLength(CLAIM_QUOTAS.openRequestsPerPlayer);
    expect(burst.filter((response) => response.statusCode === 409)).toHaveLength(3);
    expect(await claimsOnPlayer(second!)).toBe(CLAIM_QUOTAS.openRequestsPerPlayer);
  });

  it("stops many fresh accounts at the installation budget, concurrently and exactly", async () => {
    const app = await claimApp({ claimRequestsPerHour: 10 });
    const attackers = await seed("accounts", 16);
    const targets = await seed("players", 16);
    const responses = await Promise.all(attackers.map((attacker, index) => claim(app, attacker, targets[index]!)));
    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(10);
    const refused = responses.filter((response) => response.statusCode === 429);
    expect(refused).toHaveLength(6);
    expect(refused.every((response) => Number(response.headers["retry-after"]) > 0)).toBe(true);
    let stored = 0;
    for (const playerId of targets) { stored += await claimsOnPlayer(playerId); }
    expect(stored).toBe(10);
  });

  it("limits messages per claim, then admits a retry after the window (no side effects while refused)", async () => {
    const app = await claimApp({ claimMessagesPerClaimPerDay: 4 });
    const [account] = await seed("accounts", 1);
    const [playerId] = await seed("players", 1);
    const created = await claim(app, account!, playerId!);
    const claimId = created.json<{ playerClaimId: string }>().playerClaimId;
    const notes = () => count(`SELECT COUNT(*) AS total FROM player_claim_notes n
      INNER JOIN player_claims c ON c.player_claim_id = n.player_claim_id WHERE c.public_id = ?`, [claimId]);
    const statuses = [];
    for (let index = 0; index < 6; index += 1) { statuses.push((await reply(app, account!, claimId)).statusCode); }
    expect(statuses).toEqual([200, 200, 200, 200, 429, 429]);
    expect(await notes()).toBe(4);
    clockMs += 86_400_000; // the next day's window
    expect((await reply(app, account!, claimId)).statusCode).toBe(200);
    expect(await notes()).toBe(5);
  });

  it("keeps the hard note quota per claim even with generous budgets", async () => {
    const app = await claimApp({ claimMessagesPerClaimPerDay: 1_000 });
    const [account] = await seed("accounts", 1);
    const [playerId] = await seed("players", 1);
    const claimId = (await claim(app, account!, playerId!)).json<{ playerClaimId: string }>().playerClaimId;
    await pool.execute(`INSERT INTO player_claim_notes (player_claim_id, author_user_account_id, author_role, note_kind, body, created_at_ms)
      SELECT c.player_claim_id, c.user_account_id, 'requester', 'reply', 'filler', 1
      FROM player_claims c CROSS JOIN (SELECT 1 FROM information_schema.columns LIMIT ${String(CLAIM_QUOTAS.notesPerClaim - 1)}) AS fill
      WHERE c.public_id = ?`, [claimId]);
    const outcomes = await Promise.all([0, 1, 2].map(() => reply(app, account!, claimId)));
    expect(outcomes.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect(outcomes.filter((response) => response.statusCode === 409)).toHaveLength(2);
    expect(outcomes.find((response) => response.statusCode === 409)!.json()).toMatchObject({ code: "claim_quota_exceeded" });
  });

  it("backstops every signed-in mutation per account, higher but finite for administrators", async () => {
    const app = await claimApp({ accountMutationsPer10Minutes: 5, administratorMutationsPer10Minutes: 8 });
    const [account, administrator] = await seed("accounts", 2);
    const missing = `player_claim.h1_${run}_missing`;
    const accountStatuses = [];
    for (let index = 0; index < 6; index += 1) {
      accountStatuses.push((await reply(app, account!, missing)).statusCode);
    }
    expect(accountStatuses.slice(0, 5).every((status) => status === 404)).toBe(true);
    expect(accountStatuses[5]).toBe(429);
    const refused = await reply(app, account!, missing);
    expect(refused.json()).toMatchObject({ code: "mutation_rate_limited" });
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
    const adminStatuses = [];
    for (let index = 0; index < 9; index += 1) {
      adminStatuses.push((await app.inject({
        method: "POST", url: `/v1/player-claims/${missing}/actions`,
        headers: { authorization: `Administrator ${administrator!}`, "x-mk8dx-csrf": "csrf" },
        payload: { action: "start_review" },
      })).statusCode);
    }
    expect(adminStatuses.slice(0, 8).every((status) => status !== 429)).toBe(true);
    expect(adminStatuses[8]).toBe(429);
    // Reads are never counted.
    expect((await app.inject({ method: "GET", url: `/v1/player-claims/${missing}`,
      headers: { authorization: `Account ${account!}` } })).statusCode).toBe(404);
  });

  it("lets a legitimate offline batch and a busy Tournament night through with the defaults", { timeout: 300_000 }, async () => {
    const app = await claimApp();
    const [phone, director] = await seed("accounts", 2);
    const crew = await seed("accounts", 40);
    // Every signed-in /v1 write passes the backstop first, also one that no route answers, so an
    // unrouted write measures exactly the general budgets (route-specific budgets are tested above).
    const write = (account: string) => app.inject({
      method: "POST", url: "/v1/h1-volume-probe",
      headers: { authorization: `Account ${account}` }, payload: {},
    });
    // A phone that was offline replays 400 queued writes in one burst (200 runs + 200 completions).
    const burst = await Promise.all(Array.from({ length: 400 }, () => write(phone!)));
    expect(burst.filter((response) => response.statusCode === 429)).toHaveLength(0);
    // A Tournament night: the Director's 500 writes and 40 helpers with 60 writes each in ten minutes.
    const night: Promise<{ statusCode: number }>[] = [];
    for (let index = 0; index < 500; index += 1) { night.push(write(director!)); }
    for (const member of crew) {
      for (let index = 0; index < 60; index += 1) { night.push(write(member)); }
    }
    const outcomes = await Promise.all(night);
    expect(outcomes.filter((response) => response.statusCode === 429)).toHaveLength(0);
    expect(outcomes.every((response) => response.statusCode === 404)).toBe(true);
  });

  it("skips notifications beyond the installation fan-out budget without failing the cause", async () => {
    const budgets = new AbuseBudgets(new MysqlMutationRateLimiter(pool, () => clockMs),
      settings({ notificationsPerHour: 10 }));
    let written = 0;
    const repository = withNotificationFanOutBudget({
      async produceClaimRequested(): Promise<void> { written += 1; },
      async listForAccount(): Promise<string> { return "untouched"; },
    }, budgets);
    const results = await Promise.allSettled(Array.from({ length: 25 }, () => repository.produceClaimRequested()));
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(written).toBe(10);
    expect(await repository.listForAccount()).toBe("untouched");
  });

  it("bounds app sign-in mail per recipient, per address and for the installation (real HTTP)", async () => {
    const limiter = new MysqlMutationRateLimiter(pool, () => clockMs);
    const budgets = new AbuseBudgets(limiter, settings({
      authEmailsPerRecipientPerHour: 3, authEmailsPerAddressPerHour: 5, authEmailsPerHour: 20,
    }));
    const proxy = { async resolve(_peer: string | undefined, headers: Readonly<Record<string, unknown>>) {
      return String(headers["x-real-ip"] ?? "198.51.100.1");
    } };
    // Clients that share a pre-authentication slot share its budget (pre-auth-budget.ts, by design).
    // Under a random slot key, about 1 run in 60 put two of the addresses below in one slot (the
    // single address then got 4 of its 5 mails). This case measures each budget on its own, so it
    // uses a key under which every address it asks from has a slot of its own.
    const victimAddresses = Array.from({ length: 8 }, (_, index) => `203.0.113.${String(index)}`);
    const singleAddress = "192.0.2.77";
    const spreadAddresses = Array.from({ length: 10 }, (_, index) => `198.18.0.${String(index)}`);
    const allAddresses = [...victimAddresses, singleAddress, ...spreadAddresses];
    let preAuth = new PreAuthBudget(limiter, randomBytes(32), proxy);
    const ownSlots = async (budget: PreAuthBudget) => new Set(await Promise.all(allAddresses.map((address) =>
      budget.subject({ headers: { "x-real-ip": address }, raw: {} })))).size === allAddresses.length;
    while (!(await ownSlots(preAuth))) { preAuth = new PreAuthBudget(limiter, randomBytes(32), proxy); }
    const mail = new AuthEmailBudgets(budgets, preAuth, randomBytes(32));
    let sent = 0;
    const app = Fastify();
    apps.push(app);
    await registerNativeEmailApprovalRoutes(app, {
      service: {
        async request() { sent += 1; return true; },
        async verifyCode() { return null as never; },
        async inspectLink() { return null as never; },
        async approveLink() { return null as never; },
      },
      budgets: mail,
    });
    const ask = (email: string, address: string) => app.inject({
      method: "POST", url: "/v1/native/device-authorization/email",
      headers: { "x-real-ip": address }, payload: { userCode: "ABCD-EFGH", email },
    });
    // One victim inbox from many addresses: only the per-recipient budget gets through.
    const victim = await Promise.all(victimAddresses.map((address) => ask("Victim@Example.org ", address)));
    expect(victim.filter((response) => response.statusCode === 202)).toHaveLength(3);
    expect(victim.filter((response) => response.statusCode === 429)).toHaveLength(5);
    // One address with many recipients: the per-address budget.
    const single = [];
    for (let index = 0; index < 7; index += 1) { single.push((await ask(`p${String(index)}@example.org`, singleAddress)).statusCode); }
    expect(single.filter((status) => status === 202)).toHaveLength(5);
    // Many addresses and recipients together: the installation budget (20 per hour in total; the
    // eight victim and five single-address requests above already used 13 of it).
    const spread = await Promise.all(spreadAddresses.map((address, index) =>
      ask(`q${String(index)}@example.org`, address)));
    expect(spread.filter((response) => response.statusCode === 202)).toHaveLength(7);
    expect(spread.filter((response) => response.statusCode === 429 &&
      Number(response.headers["retry-after"]) > 0)).toHaveLength(3);
    expect(sent).toBe(3 + 5 + 7);
  });
});
