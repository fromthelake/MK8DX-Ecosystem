import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";

import type {
  AdministratorGrantSnapshot,
  AdministratorGrantWriteRepository,
  AdministratorGrantWriteTransaction,
  CreateAdministratorGrantInput,
  RevokeAdministratorGrantInput,
} from "./administrator-grant-service.js";
import { AdministratorGrantServiceError } from "./administrator-grant-service.js";
import type { AccountStatus } from "../identity/types.js";

interface StatusRow extends RowDataPacket { statusValue: unknown }
interface CountRow extends RowDataPacket { countValue: unknown }
interface GrantRow extends RowDataPacket {
  administratorGrantId: unknown;
  userAccountId: unknown;
  status: unknown;
  origin: unknown;
  revision: unknown;
  lastSequence: unknown;
  grantedAtMs: unknown;
  revokedAtMs: unknown;
}

const accountStatuses = new Set<AccountStatus>(["active", "suspended", "closed"]);
const grantIdPattern = /^administrator_grant\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const accountIdPattern = /^user_account\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export class AdministratorGrantPersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AdministratorGrantPersistenceError";
  }
}

function text(value: unknown, field: string, pattern?: RegExp): string {
  if (typeof value !== "string" || value.length === 0 ||
      (pattern !== undefined && !pattern.test(value))) {
    throw new AdministratorGrantPersistenceError(`${field} is invalid`);
  }
  return value;
}

function integer(value: unknown, field: string, minimum = 0): number {
  const result = typeof value === "string" ? Number(value) : value;
  if (typeof result !== "number" || !Number.isSafeInteger(result) || result < minimum) {
    throw new AdministratorGrantPersistenceError(`${field} is invalid`);
  }
  return result;
}

function duplicate(error: unknown): boolean {
  if (typeof error !== "object" || error === null) { return false; }
  const candidate = error as { code?: unknown; errno?: unknown };
  return candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062;
}

class MysqlAdministratorGrantTransaction implements AdministratorGrantWriteTransaction {
  public constructor(private readonly connection: PoolConnection) {}

  public async findUserAccountStatus(userAccountId: string): Promise<AccountStatus | null> {
    const [rows] = await this.connection.execute<StatusRow[]>(
      `SELECT account_status AS statusValue
       FROM user_accounts WHERE public_id = ? LIMIT 1 FOR UPDATE`,
      [userAccountId],
    );
    if (rows.length === 0) { return null; }
    if (rows.length !== 1 || rows[0] === undefined) {
      throw new AdministratorGrantPersistenceError("UserAccount lookup is ambiguous");
    }
    const status = text(rows[0].statusValue, "UserAccount status") as AccountStatus;
    if (!accountStatuses.has(status)) {
      throw new AdministratorGrantPersistenceError("UserAccount status is unsupported");
    }
    return status;
  }

  public async hasAnyGrantForUpdate(): Promise<boolean> {
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT administrator_grant_id
       FROM administrator_grants ORDER BY administrator_grant_id LIMIT 1 FOR UPDATE`,
    );
    return rows.length > 0;
  }

  public async findActiveGrantForUpdate(
    userAccountId: string,
  ): Promise<AdministratorGrantSnapshot | null> {
    const [rows] = await this.connection.execute<GrantRow[]>(
      `SELECT grant_record.public_id AS administratorGrantId,
              account.public_id AS userAccountId,
              grant_record.grant_status AS status,
              grant_record.grant_origin AS origin,
              grant_record.revision AS revision,
              COALESCE(MAX(lifecycle.sequence_number), 0) AS lastSequence,
              grant_record.granted_at_ms AS grantedAtMs,
              grant_record.revoked_at_ms AS revokedAtMs
       FROM administrator_grants AS grant_record
       INNER JOIN user_accounts AS account
         ON account.user_account_id = grant_record.user_account_id
       LEFT JOIN administrator_grant_lifecycle AS lifecycle
         ON lifecycle.administrator_grant_id = grant_record.administrator_grant_id
       WHERE account.public_id = ? AND grant_record.grant_status = 'active'
       GROUP BY grant_record.administrator_grant_id, account.public_id
       LIMIT 1 FOR UPDATE`,
      [userAccountId],
    );
    if (rows.length === 0) { return null; }
    if (rows.length !== 1 || rows[0] === undefined) {
      throw new AdministratorGrantPersistenceError("administrator grant lookup is ambiguous");
    }
    const row = rows[0];
    const status = text(row.status, "administrator grant status");
    const origin = text(row.origin, "administrator grant origin");
    if (status !== "active" || (origin !== "bootstrap_cli" && origin !== "administrator")) {
      throw new AdministratorGrantPersistenceError("administrator grant state is unsupported");
    }
    return {
      administratorGrantId: text(
        row.administratorGrantId,
        "administrator grant ID",
        grantIdPattern,
      ),
      userAccountId: text(row.userAccountId, "UserAccount ID", accountIdPattern),
      status,
      origin,
      revision: integer(row.revision, "administrator grant revision", 1),
      lastSequence: integer(row.lastSequence, "administrator grant sequence", 1),
      grantedAtMs: integer(row.grantedAtMs, "administrator grant timestamp"),
    };
  }

  public async countActiveGrantsForUpdate(): Promise<number> {
    const [rows] = await this.connection.execute<CountRow[]>(
      `SELECT COUNT(*) AS countValue FROM administrator_grants
       WHERE grant_status = 'active' FOR UPDATE`,
    );
    if (rows.length !== 1 || rows[0] === undefined) {
      throw new AdministratorGrantPersistenceError("administrator grant count is invalid");
    }
    return integer(rows[0].countValue, "administrator grant count");
  }

  public async createGrant(input: CreateAdministratorGrantInput): Promise<void> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO administrator_grants (
         public_id, revision, user_account_id, grant_status, grant_origin,
         granted_at_ms, revoked_at_ms, updated_at_ms
       )
       SELECT ?, ?, account.user_account_id, 'active', ?, ?, NULL, ?
       FROM user_accounts AS account WHERE account.public_id = ?`,
      [
        input.snapshot.administratorGrantId,
        input.snapshot.revision,
        input.snapshot.origin,
        input.snapshot.grantedAtMs,
        input.snapshot.grantedAtMs,
        input.snapshot.userAccountId,
      ],
    );
    if (result.affectedRows !== 1) {
      throw new AdministratorGrantServiceError("conflict", "administrator grant was not created");
    }
    const [lifecycle] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO administrator_grant_lifecycle (
         administrator_grant_id, sequence_number, event_type, actor_type,
         actor_user_account_id, grant_status_after, reason_code, occurred_at_ms
       )
       SELECT ?, 1, ?, ?, actor.user_account_id, 'active', ?, ?
       FROM (SELECT 1) AS singleton
       LEFT JOIN user_accounts AS actor ON actor.public_id = ?`,
      [
        result.insertId,
        input.snapshot.origin === "bootstrap_cli" ? "bootstrap_granted" : "granted",
        input.snapshot.origin,
        input.reasonCode,
        input.snapshot.grantedAtMs,
        input.actorUserAccountId ?? null,
      ],
    );
    if (lifecycle.affectedRows !== 1) {
      throw new AdministratorGrantPersistenceError("administrator grant audit was not appended");
    }
  }

  public async revokeGrant(input: RevokeAdministratorGrantInput): Promise<void> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `UPDATE administrator_grants
       SET grant_status = 'revoked', revision = revision + 1,
           revoked_at_ms = ?, updated_at_ms = ?
       WHERE public_id = ? AND revision = ? AND grant_status = 'active'`,
      [
        input.revokedAtMs,
        input.revokedAtMs,
        input.current.administratorGrantId,
        input.expectedRevision,
      ],
    );
    if (result.affectedRows !== 1) {
      throw new AdministratorGrantServiceError("conflict", "administrator grant changed concurrently");
    }
    const [lifecycle] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO administrator_grant_lifecycle (
         administrator_grant_id, sequence_number, event_type, actor_type,
         actor_user_account_id, grant_status_after, reason_code, occurred_at_ms
       )
       SELECT grant_record.administrator_grant_id, ?, 'revoked', 'administrator',
              actor.user_account_id, 'revoked', ?, ?
       FROM administrator_grants AS grant_record
       INNER JOIN user_accounts AS actor ON actor.public_id = ?
       WHERE grant_record.public_id = ?`,
      [
        input.current.lastSequence + 1,
        input.reasonCode,
        input.revokedAtMs,
        input.actorUserAccountId,
        input.current.administratorGrantId,
      ],
    );
    if (lifecycle.affectedRows !== 1) {
      throw new AdministratorGrantPersistenceError("administrator revocation audit was not appended");
    }
  }
}

export class MysqlAdministratorGrantWriteRepository
  implements AdministratorGrantWriteRepository {
  public constructor(private readonly pool: Pool) {}

  public async transaction<T>(
    work: (transaction: AdministratorGrantWriteTransaction) => Promise<T>,
  ): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(new MysqlAdministratorGrantTransaction(connection));
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      if (duplicate(error)) {
        throw new AdministratorGrantServiceError(
          "conflict",
          "administrator grant conflicts with current state",
        );
      }
      throw error;
    } finally {
      connection.release();
    }
  }
}

export class MysqlAdministratorGrantStatusRepository {
  public constructor(private readonly pool: Pool) {}

  public async isActiveAdministrator(userAccountId: string): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT grant_record.administrator_grant_id
       FROM administrator_grants AS grant_record
       INNER JOIN user_accounts AS account
         ON account.user_account_id = grant_record.user_account_id
       WHERE account.public_id = ?
         AND account.account_status = 'active'
         AND grant_record.grant_status = 'active'
       LIMIT 1`,
      [userAccountId],
    );
    return rows.length === 1;
  }
}
