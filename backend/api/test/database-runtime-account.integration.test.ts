// The website's runtime database account may read and write rows, but must not change or remove the
// schema, users or grants: even SQL that reached the database through some future bug cannot wipe it.
//
// The CI harness (tooling/run_database_integration_ci.sh) runs every database suite with
// MK8DX_MYSQL_TEST_USER set to such a restricted account and MK8DX_MYSQL_EXPECT_RUNTIME_ACCOUNT=1.
import { randomUUID } from "node:crypto";

import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { inspectDatabaseAccount } from "../src/composition/database-account-check-main.js";

const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
const restricted = process.env["MK8DX_MYSQL_EXPECT_RUNTIME_ACCOUNT"] === "1";
const integration = (database.endsWith("_test") || database.endsWith("_contract")) && restricted
  ? describe
  : describe.skip;

// Access-denied error numbers: table/command (1142), database (1044), global privilege (1227),
// "you are not allowed to create a user with GRANT" (1410), CREATE USER denied (1227 on MySQL).
const denied = new Set(["ER_TABLEACCESS_DENIED_ERROR", "ER_DBACCESS_DENIED_ERROR", "ER_SPECIFIC_ACCESS_DENIED_ERROR",
  "ER_CANT_CREATE_USER_WITH_GRANT", "ER_ACCESS_DENIED_NO_PASSWORD_ERROR", "ER_COLUMNACCESS_DENIED_ERROR"]);

async function expectDenied(pool: Pool, statement: string): Promise<void> {
  let failure: unknown;
  try {
    await pool.query(statement);
  } catch (error) {
    failure = error;
  }
  expect(failure, statement).toBeDefined();
  const code = String((failure as { code?: unknown }).code ?? "");
  expect(denied.has(code), `${statement} -> ${code}`).toBe(true);
}

integration("restricted runtime database account", () => {
  let pool: Pool;
  const suffix = randomUUID();
  const accountId = `user_account.runtime_account_${suffix}`;

  beforeAll(() => {
    pool = mysql.createPool({
      host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
      port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306"),
      user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "mk8dx_test",
      password: process.env["MK8DX_MYSQL_TEST_PASSWORD"] ?? "",
      database,
      connectionLimit: 2,
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("reads and writes rows", async () => {
    const now = 1_900_000_000_000;
    await pool.execute(
      `INSERT INTO user_accounts(public_id,revision,privacy_class,account_status,created_at_ms,updated_at_ms)
       VALUES(?,1,'private','active',?,?)`, [accountId, now, now],
    );
    await pool.execute("UPDATE user_accounts SET updated_at_ms=? WHERE public_id=?", [now + 1, accountId]);
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT updated_at_ms AS updated FROM user_accounts WHERE public_id=?", [accountId]);
    expect(Number(rows[0]?.["updated"])).toBe(now + 1);
    await pool.execute("DELETE FROM user_accounts WHERE public_id=?", [accountId]);
  });

  it("is refused DROP, ALTER, TRUNCATE, CREATE and GRANT, and the schema stays intact", async () => {
    const [before] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE()");
    await expectDenied(pool, "DROP TABLE user_accounts");
    await expectDenied(pool, "ALTER TABLE user_accounts ADD COLUMN runtime_probe INT NULL");
    await expectDenied(pool, "TRUNCATE TABLE user_accounts");
    await expectDenied(pool, "CREATE TABLE runtime_probe (id INT PRIMARY KEY)");
    await expectDenied(pool, "CREATE INDEX runtime_probe ON user_accounts(created_at_ms)");
    await expectDenied(pool, `DROP DATABASE \`${database}\``);
    await expectDenied(pool, `GRANT ALL PRIVILEGES ON \`${database}\`.* TO CURRENT_USER()`);
    await expectDenied(pool, "CREATE USER 'mk8dx_runtime_probe'@'%' IDENTIFIED BY 'not-used-anywhere-1'");
    const [after] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE()");
    expect(Number(after[0]?.["total"])).toBe(Number(before[0]?.["total"]));
    expect(Number(after[0]?.["total"])).toBeGreaterThan(50);
  });

  it("is reported as an account that cannot change the schema", async () => {
    const connection = await pool.getConnection();
    try {
      await expect(inspectDatabaseAccount(connection, database)).resolves.toEqual({
        dataAccess: true, canChangeSchema: false, extraPrivileges: [],
      });
    } finally {
      connection.release();
    }
  });
});
