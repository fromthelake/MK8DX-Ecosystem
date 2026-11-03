import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";

import {
  AuthenticationProvisioningError,
  type AuthenticationBindingSnapshot,
  type AuthenticationProvisioningRepository,
  type AuthenticationProvisioningTransaction,
  type CreateAuthenticationAccountInput,
  type CreateAuthenticationBindingInput,
} from "./authentication-provisioning-service.js";
import type { VerifiedAuthenticationSubject } from "./authentication-binding-resolver.js";

const keyPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const userAccountIdPattern = /^user_account\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const authenticationBindingIdPattern =
  /^restricted_auth_binding\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const accountStatuses = new Set(["active", "suspended", "closed"] as const);

interface BindingRow extends RowDataPacket {
  authenticationBindingId: unknown;
  userAccountId: unknown;
  accountStatus: unknown;
}

interface AccountStatusRow extends RowDataPacket {
  accountStatus: unknown;
}

export class AuthenticationProvisioningPersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AuthenticationProvisioningPersistenceError";
  }
}

function requiredString(value: unknown, field: string, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new AuthenticationProvisioningPersistenceError(
      `${field} has an invalid persisted value`,
    );
  }
  return value;
}

function requiredStatus(value: unknown): "active" | "suspended" | "closed" {
  if (typeof value !== "string" || !accountStatuses.has(value as never)) {
    throw new AuthenticationProvisioningPersistenceError(
      "UserAccount status has an invalid persisted value",
    );
  }
  return value as "active" | "suspended" | "closed";
}

function singleRow<T extends RowDataPacket>(rows: T[], resource: string): T | null {
  if (rows.length === 0) {
    return null;
  }
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new AuthenticationProvisioningPersistenceError(
      `${resource} lookup returned an invalid row count`,
    );
  }
  return rows[0];
}

function subjectHmac(subject: VerifiedAuthenticationSubject): Buffer {
  if (
    subject.issuerKey.length > 64 ||
    !keyPattern.test(subject.issuerKey) ||
    subject.lookupKeyVersion.length > 64 ||
    !keyPattern.test(subject.lookupKeyVersion) ||
    subject.subjectLookupHmac.byteLength !== 32
  ) {
    throw new AuthenticationProvisioningPersistenceError(
      "verified authentication subject lookup material is invalid",
    );
  }
  return Buffer.from(subject.subjectLookupHmac);
}

function assertAffected(
  result: ResultSetHeader,
  expected: number,
  operation: string,
): void {
  if (result.affectedRows !== expected) {
    throw new AuthenticationProvisioningError(
      "conflict",
      `${operation} could not be completed`,
    );
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; errno?: unknown };
  return candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062;
}

class MysqlAuthenticationProvisioningTransaction
  implements AuthenticationProvisioningTransaction
{
  public constructor(private readonly connection: PoolConnection) {}

  public async findActiveBindingForUpdate(
    subject: VerifiedAuthenticationSubject,
  ): Promise<AuthenticationBindingSnapshot | null> {
    const hmac = subjectHmac(subject);
    const [rows] = await this.connection.execute<BindingRow[]>(
      `SELECT
         b.public_id AS authenticationBindingId,
         a.public_id AS userAccountId,
         a.account_status AS accountStatus
       FROM restricted_authentication_bindings AS b
       INNER JOIN user_accounts AS a ON a.user_account_id = b.user_account_id
       WHERE b.active_issuer_key = ?
         AND b.active_lookup_key_version = ?
         AND b.active_subject_lookup_hmac = ?
       LIMIT 2
       FOR UPDATE`,
      [subject.issuerKey, subject.lookupKeyVersion, hmac],
    );
    const row = singleRow(rows, "authentication binding");
    if (row === null) {
      return null;
    }
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
      accountStatus: requiredStatus(row.accountStatus),
    };
  }

  public async findUserAccountStatusForUpdate(
    userAccountId: string,
  ): Promise<"active" | "suspended" | "closed" | null> {
    const [rows] = await this.connection.execute<AccountStatusRow[]>(
      `SELECT account_status AS accountStatus
       FROM user_accounts
       WHERE public_id = ?
       LIMIT 1
       FOR UPDATE`,
      [userAccountId],
    );
    const row = singleRow(rows, "UserAccount");
    return row === null ? null : requiredStatus(row.accountStatus);
  }

  public async createUserAccount(
    input: CreateAuthenticationAccountInput,
  ): Promise<void> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO user_accounts (
         public_id, revision, privacy_class, account_status,
         created_at_ms, updated_at_ms
       ) VALUES (?, 1, 'private', 'active', ?, ?)`,
      [input.userAccountId, input.createdAtMs, input.createdAtMs],
    );
    assertAffected(result, 1, "UserAccount creation");
  }

  public async createAuthenticationBinding(
    input: CreateAuthenticationBindingInput,
  ): Promise<void> {
    const hmac = subjectHmac(input.subject);
    const [bindingResult] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO restricted_authentication_bindings (
         public_id, revision, privacy_class, user_account_id, issuer_key,
         subject_lookup_hmac, lookup_key_version, binding_status,
         bound_at_ms, ended_at_ms, updated_at_ms
       )
       SELECT ?, 1, 'private', a.user_account_id, ?, ?, ?, 'active', ?, NULL, ?
       FROM user_accounts AS a
       WHERE a.public_id = ?
         AND a.account_status = 'active'`,
      [
        input.authenticationBindingId,
        input.subject.issuerKey,
        hmac,
        input.subject.lookupKeyVersion,
        input.createdAtMs,
        input.createdAtMs,
        input.userAccountId,
      ],
    );
    assertAffected(bindingResult, 1, "authentication binding creation");
    const bindingInternalId = bindingResult.insertId;
    if (!Number.isSafeInteger(bindingInternalId) || bindingInternalId < 1) {
      throw new AuthenticationProvisioningPersistenceError(
        "authentication binding insert returned an invalid identifier",
      );
    }
    const [lifecycleResult] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO restricted_authentication_binding_lifecycle (
         authentication_binding_id, sequence_number, event_type, actor_type,
         actor_user_account_id, actor_reference, reason_code, occurred_at_ms
       ) VALUES (?, 1, 'binding_created', 'authentication', NULL, ?, NULL, ?)`,
      [bindingInternalId, input.provisionerReference, input.createdAtMs],
    );
    assertAffected(lifecycleResult, 1, "authentication binding lifecycle append");
  }
}

export class MysqlAuthenticationProvisioningRepository
  implements AuthenticationProvisioningRepository
{
  public constructor(private readonly pool: Pool) {}

  public async transaction<T>(
    work: (transaction: AuthenticationProvisioningTransaction) => Promise<T>,
  ): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(
        new MysqlAuthenticationProvisioningTransaction(connection),
      );
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      if (isDuplicateKeyError(error)) {
        throw new AuthenticationProvisioningError(
          "conflict",
          "an authentication provisioning uniqueness constraint was occupied concurrently",
        );
      }
      throw error;
    } finally {
      connection.release();
    }
  }
}
