import { randomBytes, randomUUID } from "node:crypto";

import mysql, { type Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccountSwitchPinHasher, deriveAccountSwitchKeys } from "../src/authentication/account-switch.js";
import {
  MysqlAccountSwitchLabels,
  MysqlAccountSwitchPinStore,
  MysqlAccountSwitchStore,
} from "../src/authentication/mysql-account-switch-store.js";

const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" &&
  /^[a-z][a-z0-9_]*(?:_test|_contract)$/.test(database) ? describe : describe.skip;

integration("account switching MySQL/MariaDB store (0085)", () => {
  const suffix = randomUUID();
  const accountId = `user_account.switch_${suffix}`;
  const authUsers = [randomUUID(), randomUUID(), randomUUID()];
  const sessionId = randomUUID();
  const device = randomBytes(32);
  const otherDevice = randomBytes(32);
  let pool: Pool;
  const now = 1_900_000_000_000;

  beforeAll(async () => {
    pool = mysql.createPool({
      host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
      port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306"),
      user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "mk8dx_test",
      password: process.env["MK8DX_MYSQL_TEST_PASSWORD"] ?? "",
      database,
      connectionLimit: 3,
    });
    await pool.execute(
      `INSERT INTO user_accounts
         (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
       VALUES (?, 1, 'private', 'active', ?, ?)`,
      [accountId, now, now],
    );
    for (const [index, id] of authUsers.entries()) {
      await pool.execute(
        `INSERT INTO mk8dx_auth_user (id, name, email, emailVerified) VALUES (?, 'MK8DX account', ?, TRUE)`,
        [id, `switch-${String(index)}-${suffix}@example.test`],
      );
    }
    await pool.execute(
      `INSERT INTO mk8dx_auth_session (id, expiresAt, token, updatedAt, userId)
       VALUES (?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY), ?, CURRENT_TIMESTAMP(3), ?)`,
      [sessionId, `switch-token-${suffix}`, authUsers[0]!],
    );
  });

  afterAll(async () => {
    await pool.execute("DELETE FROM account_switch_pins WHERE user_account_id IN (SELECT user_account_id FROM user_accounts WHERE public_id=?)", [accountId]);
    await pool.execute("DELETE FROM mk8dx_auth_session WHERE id=?", [sessionId]);
    for (const id of authUsers) { await pool.execute("DELETE FROM mk8dx_auth_user WHERE id=?", [id]); }
    await pool.execute("DELETE FROM user_accounts WHERE public_id=?", [accountId]);
    await pool.end();
  });

  it("remembers per device, keeps the entry id, drops beyond the maximum and forgets", async () => {
    const store = new MysqlAccountSwitchStore(pool);
    await store.remember(device, authUsers[0]!, "a".repeat(22), now, 2);
    await store.remember(device, authUsers[0]!, "z".repeat(22), now + 1, 2);
    await store.remember(device, authUsers[1]!, "b".repeat(22), now + 2, 2);
    await store.remember(otherDevice, authUsers[1]!, "c".repeat(22), now + 2, 2);
    expect((await store.list(device, 0)).map((row) => row.entryId)).toEqual(["b".repeat(22), "a".repeat(22)]);
    await store.remember(device, authUsers[2]!, "d".repeat(22), now + 3, 2);
    expect((await store.list(device, 0)).map((row) => row.authUserId)).toEqual([authUsers[2], authUsers[1]]);
    await store.forgetElsewhere(authUsers[1]!, device);
    expect(await store.list(otherDevice, 0)).toEqual([]);
    await store.forget(device, authUsers[2]!);
    await store.forgetEverywhere(authUsers[1]!);
    expect(await store.list(device, 0)).toEqual([]);
    await store.recordSwitchSession(sessionId, now);
    expect(await store.isSwitchSession(sessionId)).toBe(true);
    expect(await store.isSwitchSession(randomUUID())).toBe(false);
  });

  it("stores only peppered digests and labels nothing it cannot see", async () => {
    const pins = new MysqlAccountSwitchPinStore(pool);
    const hasher = new AccountSwitchPinHasher(deriveAccountSwitchKeys([
      { version: 1, value: "n1DLRIGl7jpbMj99RFVrBcMeOrBAvccvREek3FWYjzk=" },
    ]));
    expect(await pins.get(accountId)).toBeNull();
    await pins.set(accountId, await hasher.hash("2468"), now);
    const stored = await pins.get(accountId);
    expect(stored).not.toBeNull();
    expect(await hasher.verify("2468", stored!)).toBe(true);
    await pins.set(accountId, await hasher.hash("1357"), now + 1);
    expect(await hasher.verify("1357", (await pins.get(accountId))!)).toBe(true);
    await pins.clear(accountId);
    expect(await pins.get(accountId)).toBeNull();
    expect(await new MysqlAccountSwitchLabels(pool).describe(accountId))
      .toEqual({ label: null, offlineAdministrator: false });
  });
});
