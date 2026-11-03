import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import type {
  DirectorHostRequestRepository,
  HostRequestDecision,
  HostRequestPlayer,
  HostRequestQueueItem,
  HostRequestView,
} from "./director-host-request-service.js";
import { insertTournamentOperationGrant } from "./mysql-tournament-operator-capability-repository.js";
import { TOURNAMENT_OPERATION_CAPABILITY } from "./tournament-operator-capability-service.js";

type Row = RowDataPacket & Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function epoch(value: unknown): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) { throw new Error("invalid epoch"); }
  return number;
}

function view(row: Row): HostRequestView {
  const status = row["requestStatus"];
  if (status !== "open" && status !== "approved" && status !== "declined") { throw new Error("invalid status"); }
  return {
    requestId: String(row["requestId"]),
    status,
    note: text(row["note"]),
    requestedAtMs: epoch(row["requestedAtMs"]),
    decidedAtMs: row["decidedAtMs"] === null || row["decidedAtMs"] === undefined ? null : epoch(row["decidedAtMs"]),
    declineReason: text(row["declineReason"]),
  };
}

/** Prepared SQL for director_host_requests (migration 0080, ADR-0220). */
export class MysqlDirectorHostRequestRepository implements DirectorHostRequestRepository {
  public constructor(private readonly pool: Pool) {}

  public async latestForAccount(userAccountId: string): Promise<HostRequestView | null> {
    const [rows] = await this.pool.execute<Row[]>(
      `SELECT request.public_id AS requestId, request.request_status AS requestStatus, request.note,
              request.requested_at_ms AS requestedAtMs, request.decided_at_ms AS decidedAtMs,
              request.decline_reason AS declineReason
       FROM director_host_requests AS request
       INNER JOIN user_accounts AS account ON account.user_account_id = request.user_account_id
       WHERE account.public_id = ?
       ORDER BY request.requested_at_ms DESC, request.director_host_request_id DESC
       LIMIT 1`,
      [userAccountId],
    );
    return rows[0] === undefined ? null : view(rows[0]);
  }

  public async insert(input: Parameters<DirectorHostRequestRepository["insert"]>[0]): ReturnType<DirectorHostRequestRepository["insert"]> {
    try {
      const [result] = await this.pool.execute<ResultSetHeader>(
        `INSERT INTO director_host_requests (public_id, user_account_id, request_status, note, requested_at_ms)
         SELECT ?, account.user_account_id, 'open', ?, ?
         FROM user_accounts AS account
         WHERE account.public_id = ? AND account.account_status = 'active'`,
        [input.requestId, input.note, input.nowMs, input.userAccountId],
      );
      return result.affectedRows === 1 ? "created" : "account_not_found";
    } catch (error) {
      // The generated open-account key: this account already waits for an answer.
      if ((error as { code?: unknown }).code === "ER_DUP_ENTRY") { return "open_exists"; }
      throw error;
    }
  }

  public async listOpen(limit: number): Promise<readonly HostRequestQueueItem[]> {
    const [rows] = await this.pool.execute<Row[]>(
      `SELECT request.public_id AS requestId, account.public_id AS userAccountId,
              account.user_account_id AS accountInternalId, account.created_at_ms AS accountCreatedAtMs,
              request.note, request.requested_at_ms AS requestedAtMs
       FROM director_host_requests AS request
       INNER JOIN user_accounts AS account ON account.user_account_id = request.user_account_id
       WHERE request.request_status = 'open'
       ORDER BY request.requested_at_ms ASC, request.director_host_request_id ASC
       LIMIT ${Math.max(1, Math.min(200, Math.trunc(limit)))}`,
    );
    const items: HostRequestQueueItem[] = [];
    for (const row of rows) {
      items.push({
        requestId: String(row["requestId"]),
        userAccountId: String(row["userAccountId"]),
        accountCreatedAtMs: epoch(row["accountCreatedAtMs"]),
        players: await this.verifiedPlayers(Number(row["accountInternalId"])),
        note: text(row["note"]),
        requestedAtMs: epoch(row["requestedAtMs"]),
      });
    }
    return items;
  }

  public approve(input: Parameters<DirectorHostRequestRepository["approve"]>[0]): ReturnType<DirectorHostRequestRepository["approve"]> {
    return this.transaction(async (connection) => {
      const locked = await this.lockRequest(connection, input.requestId);
      if (typeof locked === "string") { return locked; }
      // An account that became a Director some other way since it asked keeps that grant; the
      // request is answered and linked to it rather than refused.
      const [existing] = await connection.execute<Row[]>(
        `SELECT account_capability_grant_id AS grantInternalId FROM account_capability_grants
         WHERE user_account_id = ? AND capability_code = ? AND grant_status = 'active' LIMIT 1 FOR UPDATE`,
        [locked.accountInternalId, TOURNAMENT_OPERATION_CAPABILITY],
      );
      const grantInternalId = existing[0] === undefined
        ? (await insertTournamentOperationGrant(connection, {
          grantId: input.grantId,
          userAccountId: locked.userAccountId,
          actorUserAccountId: input.actorUserAccountId,
          reasonCode: input.reasonCode,
          occurredAtMs: input.nowMs,
        })).grantInternalId
        : Number(existing[0]["grantInternalId"]);
      const [updated] = await connection.execute<ResultSetHeader>(
        `UPDATE director_host_requests AS request
         INNER JOIN user_accounts AS actor ON actor.public_id = ?
         SET request.request_status = 'approved', request.decided_by_user_account_id = actor.user_account_id,
             request.decided_at_ms = ?, request.account_capability_grant_id = ?
         WHERE request.director_host_request_id = ? AND request.request_status = 'open'`,
        [input.actorUserAccountId, input.nowMs, grantInternalId, locked.requestInternalId],
      );
      if (updated.affectedRows !== 1) { throw new Error("request decision was not written"); }
      return {
        requestId: input.requestId, userAccountId: locked.userAccountId, status: "approved", decidedAtMs: input.nowMs,
      } satisfies HostRequestDecision;
    });
  }

  public decline(input: Parameters<DirectorHostRequestRepository["decline"]>[0]): ReturnType<DirectorHostRequestRepository["decline"]> {
    return this.transaction(async (connection) => {
      const locked = await this.lockRequest(connection, input.requestId);
      if (typeof locked === "string") { return locked; }
      const [updated] = await connection.execute<ResultSetHeader>(
        `UPDATE director_host_requests AS request
         INNER JOIN user_accounts AS actor ON actor.public_id = ?
         SET request.request_status = 'declined', request.decided_by_user_account_id = actor.user_account_id,
             request.decided_at_ms = ?, request.decline_reason = ?
         WHERE request.director_host_request_id = ? AND request.request_status = 'open'`,
        [input.actorUserAccountId, input.nowMs, input.reason, locked.requestInternalId],
      );
      if (updated.affectedRows !== 1) { throw new Error("request decision was not written"); }
      return {
        requestId: input.requestId, userAccountId: locked.userAccountId, status: "declined", decidedAtMs: input.nowMs,
      } satisfies HostRequestDecision;
    });
  }

  private async lockRequest(connection: PoolConnection, requestId: string): Promise<
    Readonly<{ requestInternalId: number; accountInternalId: number; userAccountId: string }> | "not_found" | "not_open"
  > {
    const [rows] = await connection.execute<Row[]>(
      `SELECT request.director_host_request_id AS requestInternalId, request.request_status AS requestStatus,
              account.user_account_id AS accountInternalId, account.public_id AS userAccountId
       FROM director_host_requests AS request
       INNER JOIN user_accounts AS account ON account.user_account_id = request.user_account_id
       WHERE request.public_id = ?
       LIMIT 1 FOR UPDATE`,
      [requestId],
    );
    const row = rows[0];
    if (row === undefined) { return "not_found"; }
    if (row["requestStatus"] !== "open") { return "not_open"; }
    return {
      requestInternalId: Number(row["requestInternalId"]),
      accountInternalId: Number(row["accountInternalId"]),
      userAccountId: String(row["userAccountId"]),
    };
  }

  private async verifiedPlayers(accountInternalId: number): Promise<readonly HostRequestPlayer[]> {
    const [rows] = await this.pool.execute<Row[]>(
      `SELECT player.public_id AS playerId, username.username_value AS username, player.display_name AS displayName
       FROM player_claims AS claim
       INNER JOIN players AS player ON player.player_id = claim.player_id
       INNER JOIN player_username_history AS username
         ON username.player_id = player.player_id AND username.released_at_ms IS NULL
       WHERE claim.user_account_id = ? AND claim.claim_status = 'verified'
       ORDER BY claim.updated_at_ms ASC
       LIMIT 10`,
      [accountInternalId],
    );
    return rows.map((row) => ({
      playerId: String(row["playerId"]),
      username: String(row["username"]),
      displayName: String(row["displayName"]),
    }));
  }

  private async transaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const value = await work(connection);
      await connection.commit();
      return value;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
