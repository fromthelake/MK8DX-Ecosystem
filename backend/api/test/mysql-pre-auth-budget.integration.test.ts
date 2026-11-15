import { randomBytes } from "node:crypto";

import mysql, { type Pool, type PoolOptions, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  MUTATION_RATE_LIMIT_RETENTION_MS,
  MutationRateLimitExceeded,
  MysqlMutationRateLimiter,
} from "../src/security/mysql-mutation-rate-limiter.js";
import { PreAuthBudget } from "../src/security/pre-auth-budget.js";

const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" ? describe : describe.skip;

// F03: limiter rows for requests made before authentication are bounded by a fixed slot count,
// shared by API processes, and removed by an observable cleanup. Real disposable database.
integration("durable pre-authentication budget", () => {
  let pool: Pool;

  beforeAll(async () => {
    const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
    if (!/^[a-z][a-z0-9_]*(?:_test|_contract)$/.test(database)) {
      throw new Error("integration database must be an explicit _test/_contract schema");
    }
    const options: PoolOptions = {
      host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
      port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306"),
      user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "mk8dx_test",
      database,
      connectionLimit: 8,
    };
    const password = process.env["MK8DX_MYSQL_TEST_PASSWORD"];
    if (password !== undefined) { options.password = password; }
    pool = mysql.createPool(options);
    await pool.execute("SELECT scope_key FROM api_mutation_rate_limits LIMIT 1");
  });

  afterAll(async () => { await pool?.end(); });

  const request = (address: string) => ({
    headers: { "x-real-ip": address },
    raw: { socket: { remoteAddress: "127.0.0.1" } },
  });
  const proxy = { async resolve(_peer: string | undefined, headers: Readonly<Record<string, unknown>>) {
    return String(headers["x-real-ip"]);
  } };

  async function rowsFor(scope: string): Promise<number> {
    const [rows] = await pool.execute<Array<{ total: number } & RowDataPacket>>(
      "SELECT COUNT(*) AS total FROM api_mutation_rate_limits WHERE scope_key LIKE ?", [`${scope}|%`]);
    return Number(rows[0]?.total);
  }

  it("keeps at most one row per slot however many addresses ask", async () => {
    const scope = `sec-s3-slots-${randomBytes(4).toString("hex")}`;
    const key = randomBytes(32);
    const first = new PreAuthBudget(new MysqlMutationRateLimiter(pool), key, proxy, 4);
    const second = new PreAuthBudget(new MysqlMutationRateLimiter(pool), key, proxy, 4);
    try {
      await Promise.all(Array.from({ length: 60 }, (_, index) =>
        (index % 2 === 0 ? first : second).consume(request(`198.51.100.${String(index)}`), scope, 3_600, 10_000)));
      expect(await rowsFor(scope)).toBeLessThanOrEqual(4);
    } finally {
      await pool.execute("DELETE FROM api_mutation_rate_limits WHERE scope_key LIKE ?", [`${scope}|%`]);
    }
  });

  it("shares one budget across two API processes under concurrency", async () => {
    const scope = `sec-s3-shared-${randomBytes(4).toString("hex")}`;
    const key = randomBytes(32);
    const instances = [0, 1].map(() => new PreAuthBudget(new MysqlMutationRateLimiter(pool), key, proxy, 1_024));
    try {
      const outcomes = await Promise.allSettled(Array.from({ length: 30 }, (_, index) =>
        instances[index % 2]!.consume(request("203.0.113.9"), scope, 3_600, 10)));
      const admitted = outcomes.filter((outcome) => outcome.status === "fulfilled").length;
      const refused = outcomes.filter((outcome) => outcome.status === "rejected" &&
        outcome.reason instanceof MutationRateLimitExceeded).length;
      expect(admitted).toBe(10);
      expect(refused).toBe(20);
    } finally {
      await pool.execute("DELETE FROM api_mutation_rate_limits WHERE scope_key LIKE ?", [`${scope}|%`]);
    }
  });

  it("removes rows past the retention and reports it without subjects", async () => {
    const scope = `sec-s3-cleanup-${randomBytes(4).toString("hex")}`;
    const now = Date.now();
    await pool.execute(
      `INSERT INTO api_mutation_rate_limits (scope_key, window_started_at_ms, event_count, updated_at_ms)
       VALUES (?, 0, 1, ?), (?, 0, 1, ?)`,
      [`${scope}|old`, now - MUTATION_RATE_LIMIT_RETENTION_MS - 60_000, `${scope}|fresh`, now]);
    const reports: Array<Readonly<{ deleted: number; complete: boolean }>> = [];
    const refusals: Array<Readonly<Record<string, number>>> = [];
    const limiter = new MysqlMutationRateLimiter(pool, () => now, {
      cleanupCompleted(deleted, complete) { reports.push({ deleted, complete }); },
      cleanupFailed() { throw new Error("unexpected cleanup failure"); },
      refusalsSinceLastReport(counts) { refusals.push(counts); },
    });
    try {
      // The first use runs cleanup; the refusal is reported at the next pass.
      await limiter.consume("subject.a", scope, 3_600, 1);
      await expect(limiter.consume("subject.a", scope, 3_600, 1)).rejects.toBeInstanceOf(MutationRateLimitExceeded);
      await limiter.cleanupExpired();
      expect(reports.length).toBe(2);
      expect(reports[0]!.deleted).toBeGreaterThanOrEqual(1);
      expect(reports[0]!.complete).toBe(true);
      expect(refusals).toEqual([{ [scope]: 1 }]);
      expect(JSON.stringify(refusals)).not.toContain("subject.a");
      expect(await rowsFor(scope)).toBe(2);
      const [old] = await pool.execute<RowDataPacket[]>(
        "SELECT 1 FROM api_mutation_rate_limits WHERE scope_key = ?", [`${scope}|old`]);
      expect(old).toHaveLength(0);
    } finally {
      await pool.execute("DELETE FROM api_mutation_rate_limits WHERE scope_key LIKE ?", [`${scope}|%`]);
    }
  });
});
