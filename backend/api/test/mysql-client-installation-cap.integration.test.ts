import { randomUUID } from "node:crypto";

import mysql, { type Pool, type PoolOptions, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CLIENT_INSTALLATION_ROWS_PER_ACCOUNT,
  ClientInstallationService,
} from "../src/runtime/client-installations.js";
import { MysqlClientInstallationRepository } from "../src/runtime/mysql-client-installation-repository.js";
import { MutationRateLimitExceeded } from "../src/security/mysql-mutation-rate-limiter.js";

const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" ? describe : describe.skip;

// F04: client-chosen installation ids cannot grow one account's rows without bound.
integration("client check-in storage bound (real database)", () => {
  let pool: Pool;
  const run = randomUUID().slice(0, 8);
  const accounts = [`user_account.sec_s3_ci_a_${run}`, `user_account.sec_s3_ci_b_${run}`];
  let internalIds: number[] = [];

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
      connectionLimit: 4,
    };
    const password = process.env["MK8DX_MYSQL_TEST_PASSWORD"];
    if (password !== undefined) { options.password = password; }
    pool = mysql.createPool(options);
    for (const account of accounts) {
      await pool.execute(
        `INSERT INTO user_accounts (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
         VALUES (?, 1, 'private', 'active', 1, 1)`, [account]);
    }
    const [rows] = await pool.execute<Array<{ id: number } & RowDataPacket>>(
      "SELECT user_account_id AS id FROM user_accounts WHERE public_id IN (?, ?) ORDER BY public_id", [...accounts]);
    internalIds = rows.map((row) => Number(row.id));
  });

  afterAll(async () => {
    if (pool === undefined) { return; }
    await pool.execute("DELETE FROM client_installations WHERE user_account_id IN (?, ?)", internalIds);
    await pool.execute("DELETE FROM user_accounts WHERE public_id IN (?, ?)", accounts);
    await pool.end();
  });

  async function rowsOf(id: number): Promise<number> {
    const [rows] = await pool.execute<Array<{ total: number } & RowDataPacket>>(
      "SELECT COUNT(*) AS total FROM client_installations WHERE user_account_id = ?", [id]);
    return Number(rows[0]?.total);
  }

  it("keeps the newest rows of one account and leaves other accounts alone", async () => {
    let now = 2_000_000_000_000;
    const repository = new MysqlClientInstallationRepository(pool);
    await repository.record(accounts[1]!, { installationId: "other-device-1", client: "android", version: "1.0" },
      now, 0);
    for (let index = 0; index < CLIENT_INSTALLATION_ROWS_PER_ACCOUNT + 30; index += 1) {
      now += 1_000;
      await repository.record(accounts[0]!,
        { installationId: `made-up-${String(index).padStart(6, "0")}`, client: "android", version: "1.0" }, now, 0);
    }
    expect(await rowsOf(internalIds[0]!)).toBe(CLIENT_INSTALLATION_ROWS_PER_ACCOUNT);
    expect(await rowsOf(internalIds[1]!)).toBe(1);
    const [newest] = await pool.execute<Array<{ installation: string } & RowDataPacket>>(
      `SELECT installation_id AS installation FROM client_installations WHERE user_account_id = ?
       ORDER BY last_seen_at_ms DESC LIMIT 1`, [internalIds[0]!]);
    expect(newest[0]?.installation).toBe(`made-up-${String(CLIENT_INSTALLATION_ROWS_PER_ACCOUNT + 29).padStart(6, "0")}`);
  });

  it("acknowledges but does not record check-ins beyond the account budget", async () => {
    const recorded: string[] = [];
    let calls = 0;
    const service = new ClientInstallationService(
      { async record(_id, checkin) { recorded.push(checkin.installationId); }, async list() { return []; } },
      () => 2_000_000_000_000,
      { async consume() { calls += 1; if (calls > 2) { throw new MutationRateLimitExceeded(60); } } },
    );
    const actor = { role: "account" as const, userAccountId: accounts[0]! };
    for (let index = 0; index < 4; index += 1) {
      await expect(service.checkin(actor, { installationId: `device-${String(index)}-x`, client: "android", version: "1.0" }))
        .resolves.toBeUndefined();
    }
    expect(recorded).toEqual(["device-0-x", "device-1-x"]);
  });
});
