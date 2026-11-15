import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import {
  STEP_UP_AUDIT_RETENTION_MS,
  type StepUpAuditEvent,
  type StepUpChallengeView,
  type StepUpClientKind,
  type StepUpStore,
} from "./step-up-service.js";

const PURGE_BATCH_ROWS = 500;
/** A used or expired link row is kept one more day for diagnosis, then removed. */
const CHALLENGE_RETENTION_MS = 24 * 60 * 60 * 1_000;

interface ChallengeRow extends RowDataPacket {
  clientKind: unknown;
  requestedAtMs: unknown;
  linkExpiresAtMs: unknown;
}

interface ConfirmedRow extends RowDataPacket {
  authUserId: unknown;
  sessionDigest: unknown;
  clientKind: unknown;
}

interface GrantRow extends RowDataPacket { expiresAtMs: unknown; }

function clientKind(value: unknown): StepUpClientKind {
  if (value === "web" || value === "native") { return value; }
  throw new Error("stored step-up client kind is invalid");
}

function integer(value: unknown): number {
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0) {
    throw new Error("stored step-up time is invalid");
  }
  return number;
}

export class MysqlStepUpStore implements StepUpStore {
  public constructor(
    private readonly pool: Pick<Pool, "execute" | "getConnection">,
  ) {}

  public async createChallenge(challenge: Parameters<StepUpStore["createChallenge"]>[0]): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      // Only the newest link of a session works: an older one in a mailbox is ended here.
      await connection.execute(
        `UPDATE api_step_up_challenges
            SET link_expires_at_ms = ?
          WHERE session_digest = ? AND confirmed_at_ms IS NULL AND link_expires_at_ms > ?`,
        [challenge.nowMs, challenge.sessionDigest, challenge.nowMs],
      );
      await connection.execute(
        `INSERT INTO api_step_up_challenges
           (session_digest, auth_user_id, link_digest, client_kind, requested_at_ms, link_expires_at_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [challenge.sessionDigest, challenge.authUserId, challenge.linkDigest, challenge.clientKind,
          challenge.nowMs, challenge.linkExpiresAtMs],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  public async findPendingLink(linkDigest: Buffer, nowMs: number): Promise<StepUpChallengeView | null> {
    const [rows] = await this.pool.execute<ChallengeRow[]>(
      `SELECT client_kind AS clientKind, requested_at_ms AS requestedAtMs, link_expires_at_ms AS linkExpiresAtMs
         FROM api_step_up_challenges
        WHERE link_digest = ? AND confirmed_at_ms IS NULL AND link_expires_at_ms > ?`,
      [linkDigest, nowMs],
    );
    const row = rows[0];
    return row === undefined ? null : {
      clientKind: clientKind(row.clientKind),
      requestedAtMs: integer(row.requestedAtMs),
      linkExpiresAtMs: integer(row.linkExpiresAtMs),
    };
  }

  public async confirmLink(linkDigest: Buffer, nowMs: number, grantExpiresAtMs: number) {
    // One conditional UPDATE decides; concurrent confirmations of the same link cannot both succeed.
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE api_step_up_challenges
          SET confirmed_at_ms = ?, grant_expires_at_ms = ?
        WHERE link_digest = ? AND confirmed_at_ms IS NULL AND link_expires_at_ms > ?`,
      [nowMs, grantExpiresAtMs, linkDigest, nowMs],
    );
    if (result.affectedRows !== 1) { return null; }
    const [rows] = await this.pool.execute<ConfirmedRow[]>(
      `SELECT auth_user_id AS authUserId, session_digest AS sessionDigest, client_kind AS clientKind
         FROM api_step_up_challenges WHERE link_digest = ?`,
      [linkDigest],
    );
    const row = rows[0];
    if (row === undefined || typeof row.authUserId !== "string" || !Buffer.isBuffer(row.sessionDigest)) {
      return null;
    }
    return { authUserId: row.authUserId, sessionDigest: row.sessionDigest, clientKind: clientKind(row.clientKind) };
  }

  public async activeGrant(sessionDigest: Buffer, authUserId: string, nowMs: number) {
    const [rows] = await this.pool.execute<GrantRow[]>(
      `SELECT MAX(grant_expires_at_ms) AS expiresAtMs
         FROM api_step_up_challenges
        WHERE session_digest = ? AND auth_user_id = ? AND confirmed_at_ms IS NOT NULL
          AND grant_expires_at_ms > ?`,
      [sessionDigest, authUserId, nowMs],
    );
    const value = rows[0]?.expiresAtMs;
    return value === null || value === undefined ? null : { expiresAtMs: integer(value) };
  }

  public async hasPendingLink(sessionDigest: Buffer, authUserId: string, nowMs: number): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT 1 AS pending FROM api_step_up_challenges
        WHERE session_digest = ? AND auth_user_id = ? AND confirmed_at_ms IS NULL AND link_expires_at_ms > ?
        LIMIT 1`,
      [sessionDigest, authUserId, nowMs],
    );
    return rows.length > 0;
  }

  public async record(event: StepUpAuditEvent, nowMs: number): Promise<void> {
    if (event.routePattern !== undefined && !/^\/[A-Za-z0-9/:._-]{1,159}$/.test(event.routePattern)) {
      throw new Error("step-up audit route is invalid");
    }
    await this.pool.execute(
      `INSERT INTO api_step_up_audit_events
         (event_kind, auth_user_id, session_digest, client_kind, route_pattern, occurred_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [event.kind, event.authUserId ?? null, event.sessionDigest ?? null, event.clientKind ?? null,
        event.routePattern ?? null, nowMs],
    );
  }

  public async purge(nowMs: number): Promise<number> {
    const cutoff = Math.max(0, nowMs - CHALLENGE_RETENTION_MS);
    const [challenges] = await this.pool.execute<ResultSetHeader>(
      `DELETE FROM api_step_up_challenges
        WHERE link_expires_at_ms < ? AND (grant_expires_at_ms IS NULL OR grant_expires_at_ms < ?)
        ORDER BY link_expires_at_ms LIMIT ${PURGE_BATCH_ROWS}`,
      [cutoff, cutoff],
    );
    const [audit] = await this.pool.execute<ResultSetHeader>(
      `DELETE FROM api_step_up_audit_events WHERE occurred_at_ms < ?
        ORDER BY occurred_at_ms LIMIT ${PURGE_BATCH_ROWS}`,
      [Math.max(0, nowMs - STEP_UP_AUDIT_RETENTION_MS)],
    );
    return challenges.affectedRows + audit.affectedRows;
  }
}
