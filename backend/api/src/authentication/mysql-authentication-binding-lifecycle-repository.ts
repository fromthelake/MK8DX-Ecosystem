import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";

import {
  AuthenticationBindingLifecycleError,
  type AppendAuthenticationBindingLifecycleInput,
  type AuthenticationBindingLifecycleRepository,
  type AuthenticationBindingLifecycleSnapshot,
  type AuthenticationBindingLifecycleTransaction,
  type AuthenticationBindingStatus,
} from "./authentication-binding-lifecycle-service.js";
import type { AccountStatus } from "../identity/types.js";

const accountStatuses = new Set<AccountStatus>(["active", "suspended", "closed"]);
const bindingStatuses = new Set<AuthenticationBindingStatus>([
  "active",
  "released",
  "revoked",
]);
const authenticationBindingIdPattern =
  /^restricted_auth_binding\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const userAccountIdPattern = /^user_account\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

interface StatusRow extends RowDataPacket { statusValue: unknown; }

interface BindingRow extends RowDataPacket {
  authenticationBindingId: unknown;
  userAccountId: unknown;
  bindingStatus: unknown;
  revision: unknown;
  lastSequence: unknown;
  updatedAtMs: unknown;
}

interface InternalIdRow extends RowDataPacket { bindingInternalId: unknown; }

export class AuthenticationBindingLifecyclePersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AuthenticationBindingLifecyclePersistenceError";
  }
}

function requiredString(value: unknown, field: string, pattern?: RegExp): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    throw new AuthenticationBindingLifecyclePersistenceError(
      `${field} has an invalid persisted value`,
    );
  }
  return value;
}

function requiredEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: ReadonlySet<T>,
): T {
  const text = requiredString(value, field);
  if (!allowed.has(text as T)) {
    throw new AuthenticationBindingLifecyclePersistenceError(
      `${field} has an unsupported persisted value`,
    );
  }
  return text as T;
}

function requiredSafeInteger(value: unknown, field: string, minimum: number): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (
    typeof numeric !== "number" ||
    !Number.isSafeInteger(numeric) ||
    numeric < minimum
  ) {
    throw new AuthenticationBindingLifecyclePersistenceError(
      `${field} has an invalid persisted value`,
    );
  }
  return numeric;
}

function singleRow<T extends RowDataPacket>(rows: T[], resource: string): T | null {
  if (rows.length === 0) { return null; }
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new AuthenticationBindingLifecyclePersistenceError(
      `${resource} lookup returned an invalid row count`,
    );
  }
  return rows[0];
}

function assertAffected(result: ResultSetHeader, operation: string): void {
  if (result.affectedRows !== 1) {
    throw new AuthenticationBindingLifecycleError(
      "conflict",
      `${operation} conflicted`,
    );
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) { return false; }
  const candidate = error as { code?: unknown; errno?: unknown };
  return candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062;
}

class MysqlAuthenticationBindingLifecycleTransaction
  implements AuthenticationBindingLifecycleTransaction
{
  public constructor(private readonly connection: PoolConnection) {}

  public async findUserAccountStatusForUpdate(
    userAccountId: string,
  ): Promise<AccountStatus | null> {
    const [rows] = await this.connection.execute<StatusRow[]>(
      `SELECT account_status AS statusValue
       FROM user_accounts
       WHERE public_id = ?
       LIMIT 1 FOR UPDATE`,
      [userAccountId],
    );
    const row = singleRow(rows, "UserAccount");
    return row === null
      ? null
      : requiredEnum(row.statusValue, "UserAccount.accountStatus", accountStatuses);
  }

  public async findAuthenticationBindingForUpdate(
    authenticationBindingId: string,
  ): Promise<AuthenticationBindingLifecycleSnapshot | null> {
    const [rows] = await this.connection.execute<BindingRow[]>(
      `SELECT
         binding.public_id AS authenticationBindingId,
         account.public_id AS userAccountId,
         binding.binding_status AS bindingStatus,
         binding.revision AS revision,
         binding.updated_at_ms AS updatedAtMs,
         COALESCE((
           SELECT MAX(lifecycle.sequence_number)
           FROM restricted_authentication_binding_lifecycle AS lifecycle
           WHERE lifecycle.authentication_binding_id = binding.authentication_binding_id
         ), 0) AS lastSequence
       FROM restricted_authentication_bindings AS binding
       INNER JOIN user_accounts AS account
         ON account.user_account_id = binding.user_account_id
       WHERE binding.public_id = ?
       LIMIT 1 FOR UPDATE`,
      [authenticationBindingId],
    );
    const row = singleRow(rows, "authentication binding");
    if (row === null) { return null; }
    return {
      authenticationBindingId: requiredString(
        row.authenticationBindingId,
        "authenticationBindingId",
        authenticationBindingIdPattern,
      ),
      userAccountId: requiredString(
        row.userAccountId,
        "userAccountId",
        userAccountIdPattern,
      ),
      bindingStatus: requiredEnum(
        row.bindingStatus,
        "authenticationBinding.bindingStatus",
        bindingStatuses,
      ),
      revision: requiredSafeInteger(
        row.revision,
        "authenticationBinding.revision",
        1,
      ),
      lastSequence: requiredSafeInteger(
        row.lastSequence,
        "authenticationBinding.lastSequence",
        1,
      ),
      updatedAtMs: requiredSafeInteger(
        row.updatedAtMs,
        "authenticationBinding.updatedAtMs",
        0,
      ),
    };
  }

  public async appendAuthenticationBindingLifecycle(
    input: AppendAuthenticationBindingLifecycleInput,
  ): Promise<void> {
    if (
      input.nextSnapshot.authenticationBindingId !== input.authenticationBindingId ||
      input.nextSnapshot.revision !== input.expectedRevision + 1 ||
      input.nextSnapshot.lastSequence !== input.event.sequence ||
      input.nextSnapshot.updatedAtMs !== input.event.occurredAtMs ||
      (input.event.eventType === "binding_released" &&
        input.nextSnapshot.bindingStatus !== "released") ||
      (input.event.eventType === "binding_revoked" &&
        input.nextSnapshot.bindingStatus !== "revoked")
    ) {
      throw new AuthenticationBindingLifecyclePersistenceError(
        "authentication binding lifecycle invariant failed",
      );
    }
    const [updateResult] = await this.connection.execute<ResultSetHeader>(
      `UPDATE restricted_authentication_bindings
       SET revision = ?, binding_status = ?, ended_at_ms = ?, updated_at_ms = ?
       WHERE public_id = ?
         AND revision = ?
         AND binding_status = 'active'`,
      [
        input.nextSnapshot.revision,
        input.nextSnapshot.bindingStatus,
        input.event.occurredAtMs,
        input.event.occurredAtMs,
        input.authenticationBindingId,
        input.expectedRevision,
      ],
    );
    assertAffected(updateResult, "authentication binding lifecycle update");
    const [internalRows] = await this.connection.execute<InternalIdRow[]>(
      `SELECT authentication_binding_id AS bindingInternalId
       FROM restricted_authentication_bindings
       WHERE public_id = ?
       LIMIT 1`,
      [input.authenticationBindingId],
    );
    const internalRow = singleRow(internalRows, "authentication binding internal ID");
    if (internalRow === null) {
      throw new AuthenticationBindingLifecycleError(
        "conflict",
        "authentication binding lifecycle update was lost",
      );
    }
    const bindingInternalId = requiredSafeInteger(
      internalRow.bindingInternalId,
      "authenticationBinding.internalId",
      1,
    );
    const [lifecycleResult] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO restricted_authentication_binding_lifecycle (
         authentication_binding_id, sequence_number, event_type, actor_type,
         actor_user_account_id, actor_reference, reason_code, occurred_at_ms
       )
       SELECT ?, ?, ?, 'administrator', administrator.user_account_id,
              NULL, ?, ?
       FROM user_accounts AS administrator
       WHERE administrator.public_id = ?
         AND administrator.account_status = 'active'`,
      [
        bindingInternalId,
        input.event.sequence,
        input.event.eventType,
        input.event.reasonCode,
        input.event.occurredAtMs,
        input.event.actorUserAccountId,
      ],
    );
    assertAffected(lifecycleResult, "authentication binding lifecycle append");
  }
}

export class MysqlAuthenticationBindingLifecycleRepository
  implements AuthenticationBindingLifecycleRepository
{
  public constructor(private readonly pool: Pool) {}

  public async transaction<T>(
    work: (transaction: AuthenticationBindingLifecycleTransaction) => Promise<T>,
  ): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(
        new MysqlAuthenticationBindingLifecycleTransaction(connection),
      );
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      if (isDuplicateKeyError(error)) {
        throw new AuthenticationBindingLifecycleError(
          "conflict",
          "an authentication binding lifecycle constraint was occupied concurrently",
        );
      }
      throw error;
    } finally {
      connection.release();
    }
  }
}
