import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool } from "mysql2/promise";

import type {
  AuthenticationBindingRepository,
  BoundUserAccount,
  VerifiedAuthenticationSubject,
} from "./authentication-binding-resolver.js";

const keyPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const userAccountIdPattern = /^user_account\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const authenticationBindingIdPattern =
  /^restricted_auth_binding\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

interface AuthenticationBindingRow extends RowDataPacket {
  authenticationBindingInternalId: unknown;
  authenticationBindingId: unknown;
  userAccountId: unknown;
}

export interface AuthenticationClock {
  nowMs(): number;
}

export class AuthenticationBindingPersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AuthenticationBindingPersistenceError";
  }
}

function requiredString(value: unknown, field: string, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new AuthenticationBindingPersistenceError(
      `${field} has an invalid persisted value`,
    );
  }
  return value;
}

function requiredInternalId(value: unknown): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (
    typeof numeric !== "number" ||
    !Number.isSafeInteger(numeric) ||
    numeric < 1
  ) {
    throw new AuthenticationBindingPersistenceError(
      "authentication binding has an invalid internal identifier",
    );
  }
  return numeric;
}

function validateSubject(subject: VerifiedAuthenticationSubject): Buffer {
  if (
    subject.issuerKey.length > 64 ||
    !keyPattern.test(subject.issuerKey) ||
    subject.lookupKeyVersion.length > 64 ||
    !keyPattern.test(subject.lookupKeyVersion) ||
    subject.subjectLookupHmac.byteLength !== 32
  ) {
    throw new AuthenticationBindingPersistenceError(
      "verified authentication subject lookup material is invalid",
    );
  }
  return Buffer.from(subject.subjectLookupHmac);
}

export class MysqlAuthenticationBindingRepository
  implements AuthenticationBindingRepository
{
  public constructor(
    private readonly pool: Pool,
    private readonly clock: AuthenticationClock,
  ) {}

  public async resolveActiveAccount(
    subject: VerifiedAuthenticationSubject,
  ): Promise<BoundUserAccount | null> {
    const subjectLookupHmac = validateSubject(subject);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<AuthenticationBindingRow[]>(
        `SELECT
           b.authentication_binding_id AS authenticationBindingInternalId,
           b.public_id AS authenticationBindingId,
           a.public_id AS userAccountId
         FROM restricted_authentication_bindings AS b
         INNER JOIN user_accounts AS a ON a.user_account_id = b.user_account_id
         WHERE b.issuer_key = ?
           AND b.lookup_key_version = ?
           AND b.subject_lookup_hmac = ?
           AND b.binding_status = 'active'
           AND a.account_status = 'active'
         LIMIT 2
         LOCK IN SHARE MODE`,
        [subject.issuerKey, subject.lookupKeyVersion, subjectLookupHmac],
      );
      if (rows.length === 0) {
        await connection.commit();
        return null;
      }
      if (rows.length !== 1 || rows[0] === undefined) {
        throw new AuthenticationBindingPersistenceError(
          "authentication binding lookup returned an invalid row count",
        );
      }
      const row = rows[0];
      const authenticationBindingInternalId = requiredInternalId(
        row.authenticationBindingInternalId,
      );
      const authenticationBindingId = requiredString(
        row.authenticationBindingId,
        "authenticationBindingId",
        authenticationBindingIdPattern,
      );
      const userAccountId = requiredString(
        row.userAccountId,
        "userAccountId",
        userAccountIdPattern,
      );
      const [auditResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO restricted_identity_access_log (
           resource_type, claim_evidence_id, claim_review_id,
           legacy_identifier_id, authentication_binding_id,
           accessor_type, accessor_reference, purpose_code, accessed_at_ms
         )
         VALUES ('authentication_binding', NULL, NULL, NULL, ?,
                 'authentication', ?, 'actor_resolution', ?)`,
        [authenticationBindingInternalId, authenticationBindingId, this.clock.nowMs()],
      );
      if (auditResult.affectedRows !== 1) {
        throw new AuthenticationBindingPersistenceError(
          "authentication binding access audit could not be appended",
        );
      }
      await connection.commit();
      return { userAccountId };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  public async rotateActiveSubject(
    previous: VerifiedAuthenticationSubject,
    active: VerifiedAuthenticationSubject,
  ): Promise<void> {
    if (previous.issuerKey !== active.issuerKey) {
      throw new AuthenticationBindingPersistenceError(
        "authentication binding rotation issuer is invalid",
      );
    }
    const previousHmac = validateSubject(previous);
    const activeHmac = validateSubject(active);
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE restricted_authentication_bindings
       SET subject_lookup_hmac = ?, lookup_key_version = ?,
           revision = revision + 1, updated_at_ms = ?
       WHERE issuer_key = ? AND lookup_key_version = ?
         AND subject_lookup_hmac = ? AND binding_status = 'active'`,
      [activeHmac, active.lookupKeyVersion, this.clock.nowMs(),
        previous.issuerKey, previous.lookupKeyVersion, previousHmac],
    );
    if (result.affectedRows !== 1) {
      throw new AuthenticationBindingPersistenceError(
        "authentication binding lookup rotation conflicted",
      );
    }
  }
}
