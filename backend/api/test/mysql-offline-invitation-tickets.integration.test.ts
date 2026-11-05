import { randomUUID } from "node:crypto";

import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MysqlOfflineInvitationTicketRepository } from
  "../src/authentication/mysql-offline-invitation-tickets.js";
import { OfflineInvitationTicketService } from
  "../src/authentication/offline-invitation-ticket.js";

const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" &&
  /^[a-z][a-z0-9_]*(?:_test|_contract)$/.test(database) ? describe : describe.skip;

integration("offline invitation MySQL/MariaDB transaction", () => {
  const suffix = randomUUID();
  const issuerId = `user_account.offline_issuer_${suffix}`;
  const targetId = `user_account.offline_target_${suffix}`;
  const accountKey = `offline_account.${suffix}`;
  const grantId = `administrator_grant.offline_${suffix}`;
  const authEmail = `${suffix}@accounts.mk8dx.invalid`;
  let pool: Pool;
  let now = 1_900_000_000_000;
  let service: OfflineInvitationTicketService;

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
       VALUES (?, 1, 'private', 'active', ?, ?),
              (?, 1, 'private', 'active', ?, ?)`,
      [issuerId, now, now, targetId, now, now],
    );
    await pool.execute(
      `INSERT INTO administrator_grants
         (public_id, revision, user_account_id, grant_status, grant_origin,
          granted_at_ms, revoked_at_ms, updated_at_ms)
       SELECT ?, 1, user_account_id, 'active', 'administrator', ?, NULL, ?
       FROM user_accounts WHERE public_id=?`,
      [grantId, now, now, issuerId],
    );
    await pool.execute(
      `INSERT INTO offline_auth_accounts
         (account_key, auth_email, display_label, account_role, active,
          user_account_id, created_at_ms, updated_at_ms)
       SELECT ?, ?, 'Synthetic offline target', 'account', TRUE,
              user_account_id, ?, ?
       FROM user_accounts WHERE public_id=?`,
      [accountKey, authEmail, now, now, targetId],
    );
    service = new OfflineInvitationTicketService(
      new MysqlOfflineInvitationTicketRepository(pool), Buffer.alloc(32, 17), () => now,
    );
  });

  afterAll(async () => {
    if (pool === undefined) { return; }
    await pool.execute("DELETE FROM offline_invitation_tickets WHERE account_key=?", [accountKey]);
    await pool.execute("DELETE FROM offline_auth_accounts WHERE account_key=?", [accountKey]);
    await pool.execute("DELETE FROM administrator_grants WHERE public_id=?", [grantId]);
    await pool.execute("DELETE FROM user_accounts WHERE public_id IN (?,?)", [issuerId, targetId]);
    await pool.end();
  });

  const actor = { role: "administrator" as const, userAccountId: issuerId };

  it("stores only a digest and permits exactly one atomic redemption", async () => {
    const ticket = await service.issue(actor, accountKey, "account");
    const [rows] = await pool.execute<(RowDataPacket & { tokenDigest: Buffer })[]>(
      "SELECT token_digest tokenDigest FROM offline_invitation_tickets WHERE invitation_id=?",
      [ticket.invitationId],
    );
    expect(rows[0]?.tokenDigest).toHaveLength(32);
    expect(rows[0]?.tokenDigest.toString("utf8")).not.toContain(ticket.token);
    const attempts = await Promise.allSettled([service.redeem(ticket.token), service.redeem(ticket.token)]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    const accepted = attempts.find((attempt) => attempt.status === "fulfilled");
    expect(accepted).toMatchObject({ value: {
      accountKey, authEmail, userAccountId: targetId, role: "account", active: true,
    } });
  });

  it("rejects revoked, expired, inactive and role-changed targets", async () => {
    const revoked = await service.issue(actor, accountKey, "account");
    await service.revoke(actor, revoked.invitationId);
    await expect(service.redeem(revoked.token)).rejects.toMatchObject({ code: "unavailable" });
    const expired = await service.issue(actor, accountKey, "account");
    now = expired.expiresAtMs;
    await expect(service.redeem(expired.token)).rejects.toMatchObject({ code: "unavailable" });
    const inactive = await service.issue(actor, accountKey, "account");
    await pool.execute("UPDATE offline_auth_accounts SET active=FALSE WHERE account_key=?", [accountKey]);
    await expect(service.redeem(inactive.token)).rejects.toMatchObject({ code: "unavailable" });
    await pool.execute("UPDATE offline_auth_accounts SET active=TRUE, account_role='administrator' WHERE account_key=?", [accountKey]);
    await expect(service.redeem(inactive.token)).rejects.toMatchObject({ code: "unavailable" });
  });
});
