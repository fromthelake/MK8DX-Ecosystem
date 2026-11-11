/** Offline-only UserAccounts. Never create a Player, claim or alias here. */
import { randomBytes, randomUUID } from "node:crypto";

import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { AdministratorGrantService } from "./administrator-grant-service.js";
import { MysqlAdministratorGrantTransaction } from "./mysql-administrator-grant-repository.js";
import { activeOfflineAdministrator } from "./offline-host-unlock-main.js";

export type OfflineHostAccountRole = "account" | "administrator";
export type OfflineHostAccount = Readonly<{
  accountKey: string;
  userAccountId: string;
  displayLabel: string;
  role: OfflineHostAccountRole;
  active: boolean;
}>;

type AccountRow = RowDataPacket & {
  accountKey: string; userAccountId: string; displayLabel: string;
  role: string; active: number;
};
type LockRow = RowDataPacket & { acquired: number | null };
const bootstrapLock = "mk8dx.offline-host-first-administrator";

export class OfflineHostAccountError extends Error {
  public constructor(public readonly code: "invalid" | "forbidden" | "conflict") {
    super(`offline host account ${code}`);
    this.name = "OfflineHostAccountError";
  }
}

function label(value: string): string {
  const cleaned = value.trim();
  if (!cleaned || Array.from(cleaned).length > 80 || /[\u0000-\u001f\u007f]/u.test(cleaned)) {
    throw new OfflineHostAccountError("invalid");
  }
  return cleaned;
}

function decode(row: AccountRow): OfflineHostAccount {
  if (!["account", "administrator"].includes(row.role) || ![0, 1].includes(row.active)) {
    throw new OfflineHostAccountError("conflict");
  }
  return { accountKey: row.accountKey, userAccountId: row.userAccountId,
    displayLabel: row.displayLabel, role: row.role as OfflineHostAccountRole,
    active: row.active === 1 };
}

export class MysqlOfflineHostAccounts {
  public constructor(private readonly pool: Pool,
                     private readonly nowMs: () => number = Date.now) {}

  public async create(actorAccountId: string | null, displayLabel: string,
                      role: OfflineHostAccountRole): Promise<OfflineHostAccount> {
    if (role !== "account" && role !== "administrator") {
      throw new OfflineHostAccountError("invalid");
    }
    if (actorAccountId === null && role !== "administrator") {
      throw new OfflineHostAccountError("forbidden");
    }
    const display = label(displayLabel);
    const now = this.nowMs();
    if (!Number.isSafeInteger(now) || now < 0) { throw new OfflineHostAccountError("invalid"); }
    const userAccountId = `user_account.${randomUUID()}`;
    const accountKey = `offline_account.${randomUUID()}`;
    const authEmail = `${randomBytes(16).toString("hex")}@accounts.mk8dx.invalid`;
    const connection = await this.pool.getConnection();
    let locked = false;
    try {
      if (actorAccountId === null) {
        const [rows] = await connection.execute<LockRow[]>(
          "SELECT GET_LOCK(?, 5) acquired", [bootstrapLock]);
        if (rows.length !== 1 || rows[0]!.acquired !== 1) {
          throw new OfflineHostAccountError("conflict");
        }
        locked = true;
      }
      await connection.beginTransaction();
      const transaction = new MysqlAdministratorGrantTransaction(connection);
      if (actorAccountId === null) {
        if (await transaction.hasAnyGrantForUpdate()) {
          throw new OfflineHostAccountError("conflict");
        }
      } else {
        const actorStatus = await transaction.findUserAccountStatus(actorAccountId);
        const actorGrant = await transaction.findActiveGrantForUpdate(actorAccountId);
        const [offlineActor] = await connection.execute<RowDataPacket[]>(
          `SELECT offline.account_key FROM offline_auth_accounts offline
           INNER JOIN user_accounts user ON user.user_account_id=offline.user_account_id
           WHERE user.public_id=? AND offline.account_role='administrator'
             AND offline.active=TRUE LIMIT 1 FOR UPDATE`, [actorAccountId]);
        if (actorStatus !== "active" || actorGrant === null ||
            offlineActor.length !== 1) {
          throw new OfflineHostAccountError("forbidden");
        }
      }
      const [user] = await connection.execute<ResultSetHeader>(
        `INSERT INTO user_accounts
          (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
         VALUES (?, 1, 'private', 'active', ?, ?)`, [userAccountId, now, now]);
      if (user.affectedRows !== 1 || !Number.isSafeInteger(user.insertId) || user.insertId < 1) {
        throw new OfflineHostAccountError("conflict");
      }
      const [offline] = await connection.execute<ResultSetHeader>(
        `INSERT INTO offline_auth_accounts
          (account_key, auth_email, display_label, account_role, active,
           user_account_id, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, TRUE, ?, ?, ?)`,
        [accountKey, authEmail, display, role, user.insertId, now, now]);
      if (offline.affectedRows !== 1) { throw new OfflineHostAccountError("conflict"); }
      const grants = new AdministratorGrantService({
        transaction: (work) => work(transaction),
      }, { newAdministratorGrantId: () => `administrator_grant.${randomUUID()}` },
      { nowMs: () => now });
      if (actorAccountId === null) {
        await grants.bootstrapFirstAdministrator(userAccountId);
      } else if (role === "administrator") {
        await grants.grantAdministrator(
          { role: "administrator", userAccountId: actorAccountId }, userAccountId,
          "offline_host_account");
      }
      await connection.commit();
      return { accountKey, userAccountId, displayLabel: display, role, active: true };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      try {
        if (locked) { await connection.execute("SELECT RELEASE_LOCK(?)", [bootstrapLock]); }
      } finally {
        connection.release();
      }
    }
  }

  public async list(actorAccountId: string): Promise<readonly OfflineHostAccount[]> {
    if (!await activeOfflineAdministrator(this.pool, actorAccountId)) {
      throw new OfflineHostAccountError("forbidden");
    }
    const [rows] = await this.pool.execute<AccountRow[]>(
      `SELECT offline.account_key accountKey, user.public_id userAccountId,
              offline.display_label displayLabel, offline.account_role role,
              offline.active active
       FROM offline_auth_accounts offline
       INNER JOIN user_accounts user ON user.user_account_id=offline.user_account_id
       ORDER BY offline.created_at_ms, offline.account_key LIMIT 500`);
    return rows.map(decode);
  }

  /**
   * An administrator signs another account out on every device (ADR-0224 amendment,
   * owner 2026-11-11): every web and app session ends, no shared device can switch back
   * to it with one tap, and its open sign-in cards stop working. Each ended session is
   * audited as `auth_session_revoked`. The acting administrator uses "Sign out on all
   * devices" for their own account instead.
   */
  public async signOutEverywhere(actorAccountId: string, accountKey: string):
  Promise<{ sessions: number; invitations: number }> {
    if (!/^offline_account\.[0-9a-f-]{36}$/.test(accountKey)) {
      throw new OfflineHostAccountError("invalid");
    }
    const now = this.nowMs();
    if (!Number.isSafeInteger(now) || now < 0) { throw new OfflineHostAccountError("invalid"); }
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [actor] = await connection.execute<RowDataPacket[]>(
        `SELECT user.public_id FROM user_accounts user
         INNER JOIN administrator_grants grant_record
           ON grant_record.user_account_id=user.user_account_id AND grant_record.grant_status='active'
         INNER JOIN offline_auth_accounts offline
           ON offline.user_account_id=user.user_account_id
           AND offline.account_role='administrator' AND offline.active=TRUE
         WHERE user.public_id=? AND user.account_status='active' LIMIT 2 FOR UPDATE`, [actorAccountId]);
      if (actor.length !== 1) { throw new OfflineHostAccountError("forbidden"); }
      const [target] = await connection.execute<(RowDataPacket & {
        authUserId: string | null; userAccountId: string; })[]>(
        `SELECT auth_user.id authUserId, user.public_id userAccountId
         FROM offline_auth_accounts offline
         INNER JOIN user_accounts user ON user.user_account_id=offline.user_account_id
         LEFT JOIN mk8dx_auth_user auth_user ON auth_user.email=offline.auth_email
         WHERE offline.account_key=? LIMIT 2 FOR UPDATE`, [accountKey]);
      if (target.length !== 1) { throw new OfflineHostAccountError("invalid"); }
      if (target[0]!.userAccountId === actorAccountId) { throw new OfflineHostAccountError("forbidden"); }
      const [invitations] = await connection.execute<ResultSetHeader>(
        `UPDATE offline_invitation_tickets SET revoked_at_ms=?
         WHERE account_key=? AND consumed_at_ms IS NULL AND revoked_at_ms IS NULL
           AND expires_at_ms > ?`, [now, accountKey, now]);
      const authUserId = target[0]!.authUserId;
      let sessions = 0;
      if (authUserId !== null) {
        const [ended] = await connection.execute<(RowDataPacket & { id: string })[]>(
          "SELECT id FROM mk8dx_auth_session WHERE userId=? FOR UPDATE", [authUserId]);
        for (const session of ended) {
          await connection.execute(
            `INSERT INTO mk8dx_auth_audit_event
              (event_kind, privacy_class, subject_id, session_id, client_id, occurred_at_ms)
             VALUES ('auth_session_revoked', 'private', ?, ?, NULL, ?)`,
            [authUserId, session.id, now]);
        }
        await connection.execute("DELETE FROM mk8dx_auth_session WHERE userId=?", [authUserId]);
        await connection.execute(
          "DELETE FROM account_switch_remembered_accounts WHERE auth_user_id=?", [authUserId]);
        sessions = ended.length;
      }
      await connection.commit();
      return { sessions, invitations: invitations.affectedRows };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
