import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MysqlOfflineHostAccounts } from "../src/administration/offline-host-accounts.js";
import type { OfflineHostAccount } from "../src/administration/offline-host-accounts.js";
import { MysqlOfflineInvitationTicketRepository } from
  "../src/authentication/mysql-offline-invitation-tickets.js";
import { OfflineInvitationTicketService } from
  "../src/authentication/offline-invitation-ticket.js";

const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" &&
  /^[a-z][a-z0-9_]*(?:_test|_contract)$/.test(database) ? describe : describe.skip;

integration("offline host accounts on disposable MySQL/MariaDB", () => {
  let pool: Pool;
  let accounts: MysqlOfflineHostAccounts;
  const created: OfflineHostAccount[] = [];
  const invitations: string[] = [];
  const now = 1_900_000_000_000;

  beforeAll(async () => {
    pool = mysql.createPool({ host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
      port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306"),
      user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "mk8dx_test",
      password: process.env["MK8DX_MYSQL_TEST_PASSWORD"] ?? "",
      database, connectionLimit: 3 });
    accounts = new MysqlOfflineHostAccounts(pool, () => now);
  });

  afterAll(async () => {
    if (pool === undefined) { return; }
    for (const invitationId of invitations) {
      await pool.execute("DELETE FROM offline_invitation_tickets WHERE invitation_id=?", [invitationId]);
    }
    for (const account of created.slice().reverse()) {
      await pool.execute(
        `DELETE lifecycle FROM administrator_grant_lifecycle lifecycle
         INNER JOIN administrator_grants grant_record
           ON grant_record.administrator_grant_id=lifecycle.administrator_grant_id
         INNER JOIN user_accounts user ON user.user_account_id=grant_record.user_account_id
         WHERE user.public_id=?`, [account.userAccountId]);
      await pool.execute(
        `DELETE grant_record FROM administrator_grants grant_record
         INNER JOIN user_accounts user ON user.user_account_id=grant_record.user_account_id
         WHERE user.public_id=?`, [account.userAccountId]);
      await pool.execute("DELETE FROM offline_auth_accounts WHERE account_key=?", [account.accountKey]);
      await pool.execute("DELETE FROM user_accounts WHERE public_id=?", [account.userAccountId]);
    }
    await pool.end();
  });

  it("commits the first offline administrator, audit and account atomically", async () => {
    const first = await accounts.create(null, "Local host owner", "administrator");
    created.push(first);
    const [grant] = await pool.execute<(RowDataPacket & { origin: string })[]>(
      `SELECT grant_record.grant_origin origin FROM administrator_grants grant_record
       INNER JOIN user_accounts user ON user.user_account_id=grant_record.user_account_id
       WHERE user.public_id=?`, [first.userAccountId]);
    expect(grant).toHaveLength(1);
    expect(grant[0]!.origin).toBe("bootstrap_cli");
    const [claims] = await pool.execute<RowDataPacket[]>(
      `SELECT claim.player_claim_id FROM player_claims claim
       INNER JOIN user_accounts user ON user.user_account_id=claim.user_account_id
       WHERE user.public_id=?`, [first.userAccountId]);
    expect(claims).toHaveLength(0);
    await expect(accounts.create(null, "Second owner", "administrator"))
      .rejects.toMatchObject({ code: "conflict" });
    const [users] = await pool.execute<(RowDataPacket & { countValue: number })[]>(
      "SELECT COUNT(*) countValue FROM user_accounts WHERE created_at_ms=?", [now]);
    expect(Number(users[0]!.countValue)).toBe(1);
  });

  it("creates a separate account and permits its one-use invitation", async () => {
    const first = created[0]!;
    const player = await accounts.create(first.userAccountId, "New player", "account");
    created.push(player);
    const listed = await accounts.list(first.userAccountId);
    expect(listed).toContainEqual(player);
    const tickets = new OfflineInvitationTicketService(
      new MysqlOfflineInvitationTicketRepository(pool), Buffer.alloc(32, 19), () => now);
    const invite = await tickets.issue({ role: "administrator", userAccountId: first.userAccountId },
      player.accountKey, "account");
    invitations.push(invite.invitationId);
    const target = await tickets.redeem(invite.token);
    expect(target).toMatchObject({ userAccountId: player.userAccountId,
      accountKey: player.accountKey, role: "account" });
  });

  it("signs another account out on every device and cannot sign out the actor", async () => {
    const first = created[0]!;
    const player = await accounts.create(first.userAccountId, "Lost phone", "account");
    created.push(player);
    const [emailRows] = await pool.execute<(RowDataPacket & { email: string })[]>(
      "SELECT auth_email email FROM offline_auth_accounts WHERE account_key=?", [player.accountKey]);
    const authUserId = "a5b2c3d4-0000-4000-8000-00000000c0de";
    await pool.execute(
      "INSERT INTO mk8dx_auth_user (id, name, email, emailVerified) VALUES (?, 'Lost phone', ?, TRUE)",
      [authUserId, emailRows[0]!.email]);
    try {
      for (const id of ["a5b2c3d4-0000-4000-8000-0000000005e1", "a5b2c3d4-0000-4000-8000-0000000005e2"]) {
        await pool.execute(
          `INSERT INTO mk8dx_auth_session (id, expiresAt, token, updatedAt, userId)
           VALUES (?, TIMESTAMPADD(DAY, 7, CURRENT_TIMESTAMP(3)), ?, CURRENT_TIMESTAMP(3), ?)`,
          [id, `token-${id}`, authUserId]);
      }
      await pool.execute(
        `INSERT INTO account_switch_remembered_accounts
          (entry_id, device_digest, auth_user_id, remembered_at_ms, last_used_at_ms)
         VALUES ('remembered000000000001', ?, ?, ?, ?)`, [Buffer.alloc(32, 7), authUserId, now, now]);
      const tickets = new OfflineInvitationTicketService(
        new MysqlOfflineInvitationTicketRepository(pool), Buffer.alloc(32, 23), () => now);
      const open = await tickets.issue({ role: "administrator", userAccountId: first.userAccountId },
        player.accountKey, "account");
      invitations.push(open.invitationId);

      await expect(accounts.signOutEverywhere(first.userAccountId, first.accountKey))
        .rejects.toMatchObject({ code: "forbidden" });
      await expect(accounts.signOutEverywhere(player.userAccountId, first.accountKey))
        .rejects.toMatchObject({ code: "forbidden" });
      expect(await accounts.signOutEverywhere(first.userAccountId, player.accountKey))
        .toEqual({ sessions: 2, invitations: 1 });

      const [sessions] = await pool.execute<RowDataPacket[]>(
        "SELECT id FROM mk8dx_auth_session WHERE userId=?", [authUserId]);
      expect(sessions).toHaveLength(0);
      const [remembered] = await pool.execute<RowDataPacket[]>(
        "SELECT entry_id FROM account_switch_remembered_accounts WHERE auth_user_id=?", [authUserId]);
      expect(remembered).toHaveLength(0);
      const [audit] = await pool.execute<RowDataPacket[]>(
        `SELECT session_id FROM mk8dx_auth_audit_event
         WHERE event_kind='auth_session_revoked' AND subject_id=?`, [authUserId]);
      expect(audit).toHaveLength(2);
      await expect(tickets.redeem(open.token)).rejects.toBeDefined();
    } finally {
      await pool.execute("DELETE FROM mk8dx_auth_audit_event WHERE subject_id=?", [authUserId]);
      await pool.execute("DELETE FROM mk8dx_auth_user WHERE id=?", [authUserId]);
    }
  });

  it("grants a second offline administrator only through the existing policy", async () => {
    const first = created[0]!;
    const second = await accounts.create(first.userAccountId, "Second host admin", "administrator");
    created.push(second);
    const [grants] = await pool.execute<(RowDataPacket & { origin: string })[]>(
      `SELECT grant_record.grant_origin origin FROM administrator_grants grant_record
       INNER JOIN user_accounts user ON user.user_account_id=grant_record.user_account_id
       WHERE user.public_id=?`, [second.userAccountId]);
    expect(grants).toHaveLength(1);
    expect(grants[0]!.origin).toBe("administrator");
  });
});
