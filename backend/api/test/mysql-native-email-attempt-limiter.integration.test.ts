import { createHash, randomUUID } from "node:crypto";

import mysql, { type Pool, type PoolOptions } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MysqlNativeEmailAttemptLimiter } from
  "../src/authentication/mysql-native-email-attempt-limiter.js";

const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" ? describe : describe.skip;

integration("durable native email code attempts", () => {
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
      connectionLimit: 6,
      multipleStatements: false,
      namedPlaceholders: false,
    };
    const password = process.env["MK8DX_MYSQL_TEST_PASSWORD"];
    if (password !== undefined) { options.password = password; }
    pool = mysql.createPool(options);
    await pool.execute("SELECT scope_key FROM api_mutation_rate_limits LIMIT 1");
  });

  afterAll(async () => { await pool?.end(); });

  it("admits at most five attempts across instances and keeps the opaque ID out of storage", async () => {
    const id = randomUUID();
    const key = `native-email-code.${createHash("sha256").update(id).digest("hex")}`;
    const first = new MysqlNativeEmailAttemptLimiter(pool);
    const second = new MysqlNativeEmailAttemptLimiter(pool);
    try {
      const allowed = await Promise.all(Array.from({ length: 10 }, (_, index) =>
        (index % 2 === 0 ? first : second).consume(id)));
      expect(allowed.filter(Boolean).length).toBeLessThanOrEqual(5);
      expect(await new MysqlNativeEmailAttemptLimiter(pool).consume(id)).toBe(false);
      const [rows] = await pool.execute<Array<{ eventCount: number } & import("mysql2").RowDataPacket>>(
        "SELECT event_count AS eventCount FROM api_mutation_rate_limits WHERE scope_key = ? AND window_started_at_ms = 0",
        [key],
      );
      expect(rows[0]?.eventCount).toBe(11);
      expect(key).not.toContain(id);
    } finally {
      await pool.execute("DELETE FROM api_mutation_rate_limits WHERE scope_key = ? AND window_started_at_ms = 0", [key]);
    }
  });
});
