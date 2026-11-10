import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import type {
  OfflineInvitationRecord,
  OfflineInvitationTarget,
  OfflineInvitationTicketRepository,
} from "./offline-invitation-ticket.js";

type TargetRow = RowDataPacket & {
  accountKey: string; userAccountId: string; authEmail: string;
  accountRole: string; active: number;
};
type TicketRow = TargetRow & {
  invitationId: string; expiresAtMs: number;
  consumedAtMs: number | null; revokedAtMs: number | null; ticketRole: string;
};

function target(row: TargetRow): OfflineInvitationTarget {
  if (!/^[a-z0-9-]+@accounts\.mk8dx\.invalid$/.test(row.authEmail) ||
      !["account", "administrator"].includes(row.accountRole) ||
      ![0, 1].includes(row.active)) {
    throw new Error("invalid offline account row");
  }
  return { accountKey: row.accountKey, userAccountId: row.userAccountId,
    authEmail: row.authEmail,
    role: row.accountRole as OfflineInvitationTarget["role"], active: row.active === 1 };
}

export class MysqlOfflineInvitationTicketRepository implements OfflineInvitationTicketRepository {
  public constructor(private readonly pool: Pool) {}

  public async target(accountKey: string): Promise<OfflineInvitationTarget | null> {
    const [rows] = await this.pool.execute<TargetRow[]>(
      `SELECT account.account_key accountKey, user.public_id userAccountId,
              account.auth_email authEmail, account.account_role accountRole,
              (account.active=TRUE AND user.account_status='active' AND
               (account.account_role<>'administrator' OR EXISTS (
                 SELECT 1 FROM administrator_grants grant_record
                 WHERE grant_record.user_account_id=user.user_account_id
                   AND grant_record.grant_status='active'))) active
       FROM offline_auth_accounts account
       INNER JOIN user_accounts user ON user.user_account_id=account.user_account_id
       WHERE account.account_key=? LIMIT 1`, [accountKey]);
    return rows.length === 0 ? null : target(rows[0]!);
  }

  public async ownTarget(userAccountId: string): Promise<OfflineInvitationTarget | null> {
    const [rows] = await this.pool.execute<TargetRow[]>(
      `SELECT account.account_key accountKey, user.public_id userAccountId,
              account.auth_email authEmail, account.account_role accountRole,
              (account.active=TRUE AND user.account_status='active' AND
               (account.account_role<>'administrator' OR EXISTS (
                 SELECT 1 FROM administrator_grants grant_record
                 WHERE grant_record.user_account_id=user.user_account_id
                   AND grant_record.grant_status='active'))) active
       FROM user_accounts user
       INNER JOIN offline_auth_accounts account ON account.user_account_id=user.user_account_id
       WHERE user.public_id=? LIMIT 1`, [userAccountId]);
    return rows.length === 0 ? null : target(rows[0]!);
  }

  public async createOwn(record: OfflineInvitationRecord): Promise<void> {
    if (record.role !== "account") { throw new Error("own offline invitation must be an account ticket"); }
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      // The previous card this account made for itself stops working: one live card at a time.
      // Tickets an administrator issued from the host page are left alone.
      await connection.execute<ResultSetHeader>(
        `UPDATE offline_invitation_tickets ticket
         INNER JOIN offline_auth_accounts account ON account.account_key=ticket.account_key
         INNER JOIN user_accounts user ON user.user_account_id=account.user_account_id
         SET ticket.revoked_at_ms=?
         WHERE user.public_id=? AND ticket.issued_by_user_account_id=user.user_account_id
           AND ticket.consumed_at_ms IS NULL AND ticket.revoked_at_ms IS NULL
           AND ticket.expires_at_ms>?`,
        [record.issuedAtMs, record.issuedByAccountId, record.issuedAtMs]);
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO offline_invitation_tickets
          (invitation_id, token_digest, account_key, account_role,
           issued_by_user_account_id, issued_at_ms, expires_at_ms)
         SELECT ?, ?, account.account_key, account.account_role,
                user.user_account_id, ?, ?
         FROM offline_auth_accounts account
         INNER JOIN user_accounts user ON user.user_account_id=account.user_account_id
         WHERE account.account_key=? AND user.public_id=?
           AND account.account_role='account' AND account.active=TRUE
           AND user.account_status='active'
           AND NOT EXISTS (
             SELECT 1 FROM administrator_grants grant_record
             WHERE grant_record.user_account_id=user.user_account_id
               AND grant_record.grant_status='active')`,
        [record.invitationId, Buffer.from(record.tokenDigest), record.issuedAtMs,
         record.expiresAtMs, record.accountKey, record.issuedByAccountId]);
      if (result.affectedRows !== 1) { throw new Error("own offline invitation was not authorized"); }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  public async create(record: OfflineInvitationRecord): Promise<void> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO offline_invitation_tickets
        (invitation_id, token_digest, account_key, account_role,
         issued_by_user_account_id, issued_at_ms, expires_at_ms)
       SELECT ?, ?, account.account_key, account.account_role,
              issuer.user_account_id, ?, ?
       FROM offline_auth_accounts account
       INNER JOIN user_accounts target_user ON target_user.user_account_id=account.user_account_id
       INNER JOIN user_accounts issuer ON issuer.public_id=? AND issuer.account_status='active'
       INNER JOIN administrator_grants grant_record
         ON grant_record.user_account_id=issuer.user_account_id AND grant_record.grant_status='active'
       WHERE account.account_key=? AND account.account_role=? AND account.active=TRUE
         AND target_user.account_status='active'
         AND (account.account_role<>'administrator' OR EXISTS (
           SELECT 1 FROM administrator_grants target_grant
           WHERE target_grant.user_account_id=target_user.user_account_id
             AND target_grant.grant_status='active'))`,
      [record.invitationId, Buffer.from(record.tokenDigest), record.issuedAtMs,
       record.expiresAtMs, record.issuedByAccountId, record.accountKey, record.role]);
    if (result.affectedRows !== 1) { throw new Error("offline invitation issuance was not authorized"); }
  }

  public async consume(tokenDigest: Uint8Array, nowMs: number): Promise<OfflineInvitationTarget | null> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<TicketRow[]>(
        `SELECT ticket.invitation_id invitationId, ticket.account_role ticketRole,
                ticket.expires_at_ms expiresAtMs,
                ticket.consumed_at_ms consumedAtMs, ticket.revoked_at_ms revokedAtMs,
                account.account_key accountKey, user.public_id userAccountId,
                account.auth_email authEmail, account.account_role accountRole,
                (account.active=TRUE AND user.account_status='active' AND
                 (account.account_role<>'administrator' OR EXISTS (
                   SELECT 1 FROM administrator_grants target_grant
                   WHERE target_grant.user_account_id=user.user_account_id
                     AND target_grant.grant_status='active'))) active
         FROM offline_invitation_tickets ticket
         INNER JOIN offline_auth_accounts account ON account.account_key=ticket.account_key
         INNER JOIN user_accounts user ON user.user_account_id=account.user_account_id
         WHERE ticket.token_digest=? LIMIT 1 FOR UPDATE`, [Buffer.from(tokenDigest)]);
      const row = rows[0];
      if (row === undefined || rows.length !== 1 || row.consumedAtMs !== null ||
          row.revokedAtMs !== null || Number(row.expiresAtMs) <= nowMs ||
          row.accountRole !== row.ticketRole || row.active !== 1) {
        await connection.rollback();
        return null;
      }
      const [updated] = await connection.execute<ResultSetHeader>(
        `UPDATE offline_invitation_tickets SET consumed_at_ms=?
         WHERE invitation_id=? AND consumed_at_ms IS NULL AND revoked_at_ms IS NULL`,
        [nowMs, row.invitationId]);
      if (updated.affectedRows !== 1) { throw new Error("offline invitation consumed concurrently"); }
      const account = target(row);
      await connection.commit();
      return account;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  public async revoke(invitationId: string, nowMs: number,
                      actorAccountId: string): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE offline_invitation_tickets ticket
       INNER JOIN user_accounts issuer ON issuer.public_id=? AND issuer.account_status='active'
       INNER JOIN administrator_grants grant_record
         ON grant_record.user_account_id=issuer.user_account_id AND grant_record.grant_status='active'
       SET ticket.revoked_at_ms=?
       WHERE ticket.invitation_id=? AND ticket.consumed_at_ms IS NULL
         AND ticket.revoked_at_ms IS NULL AND ticket.expires_at_ms>?`,
      [actorAccountId, nowMs, invitationId, nowMs]);
    return result.affectedRows === 1;
  }
}
