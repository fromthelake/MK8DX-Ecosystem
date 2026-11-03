import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";

import {
  AliasServiceError,
  type AliasRecordStatus,
  type AliasSnapshot,
  type AliasType,
  type AliasVisibility,
  type AliasWriteRepository,
  type AliasWriteTransaction,
  type AppendAliasEventInput,
  type CreateAliasInput,
} from "./alias-service.js";
import type { AccountStatus } from "./types.js";

interface StatusRow extends RowDataPacket {
  statusValue: unknown;
}

interface AliasRow extends RowDataPacket {
  aliasId: unknown;
  playerId: unknown;
  aliasText: unknown;
  aliasType: unknown;
  visibility: unknown;
  recordStatus: unknown;
  revision: unknown;
  lastSequence: unknown;
  reviewedByUserAccountId: unknown;
  reviewedAtMs: unknown;
}

const accountStatuses = new Set<AccountStatus>(["active", "suspended", "closed"]);
const aliasTypes = new Set<AliasType>([
  "declared",
  "legacy_handle",
  "tournament_name",
  "ocr_observation",
  "other_observation",
]);
const visibilities = new Set<AliasVisibility>(["public", "restricted"]);
const recordStatuses = new Set<AliasRecordStatus>(["active", "retired"]);
const aliasIdPattern = /^alias\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const userAccountIdPattern = /^user_account\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export class AliasPersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AliasPersistenceError";
  }
}

function requiredString(value: unknown, field: string, pattern?: RegExp): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    throw new AliasPersistenceError(`${field} has an invalid persisted value`);
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
    throw new AliasPersistenceError(`${field} has an unsupported persisted value`);
  }
  return text as T;
}

function requiredSafeInteger(
  value: unknown,
  field: string,
  minimum = 0,
): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (
    typeof numeric !== "number" ||
    !Number.isSafeInteger(numeric) ||
    numeric < minimum
  ) {
    throw new AliasPersistenceError(`${field} has an invalid persisted value`);
  }
  return numeric;
}

function singleRow<T extends RowDataPacket>(rows: T[], resource: string): T | null {
  if (rows.length === 0) {
    return null;
  }
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new AliasPersistenceError(`${resource} lookup returned an invalid row count`);
  }
  return rows[0];
}

function isDuplicateKeyError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; errno?: unknown };
  return candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062;
}

class MysqlAliasWriteTransaction implements AliasWriteTransaction {
  public constructor(private readonly connection: PoolConnection) {}

  /**
   * True when the account holds the active verified claim on that Player, so
   * the profile may manage its own aliases (owner decision 2026-08-28).
   * ADR-0178 permits several claims per account, so this is asked per Player.
   */
  public async hasVerifiedClaimOnPlayer(
    userAccountId: string,
    playerId: string,
  ): Promise<boolean> {
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT 1
       FROM player_claims AS c
       INNER JOIN user_accounts AS a ON a.user_account_id = c.user_account_id
       INNER JOIN players AS p ON p.player_id = c.player_id
       WHERE a.public_id = ?
         AND p.public_id = ?
         AND a.account_status = 'active'
         AND c.claim_status = 'verified'
       LIMIT 1`,
      [userAccountId, playerId],
    );
    return rows.length > 0;
  }

  public async findHumanPlayerStatus(
    playerId: string,
  ): Promise<"active" | "archived" | null> {
    const [rows] = await this.connection.execute<StatusRow[]>(
      `SELECT record_status AS statusValue
       FROM players
       WHERE public_id = ? AND player_kind = 'human'
       LIMIT 1 FOR UPDATE`,
      [playerId],
    );
    const row = singleRow(rows, "Player");
    return row === null
      ? null
      : requiredEnum(
          row.statusValue,
          "Player.recordStatus",
          new Set(["active", "archived"] as const),
        );
  }

  public async findUserAccountStatus(
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

  public async findAliasForUpdate(aliasId: string): Promise<AliasSnapshot | null> {
    const [rows] = await this.connection.execute<AliasRow[]>(
      `SELECT
         alias_record.public_id AS aliasId,
         player.public_id AS playerId,
         alias_record.alias_text AS aliasText,
         alias_record.alias_type AS aliasType,
         alias_record.visibility AS visibility,
         alias_record.record_status AS recordStatus,
         alias_record.revision AS revision,
         COALESCE((
           SELECT MAX(lifecycle.sequence_number)
           FROM alias_lifecycle AS lifecycle
           WHERE lifecycle.alias_id = alias_record.alias_id
         ), 0) AS lastSequence,
         reviewer.public_id AS reviewedByUserAccountId,
         alias_record.reviewed_at_ms AS reviewedAtMs
       FROM aliases AS alias_record
       INNER JOIN players AS player ON player.player_id = alias_record.player_id
       INNER JOIN user_accounts AS reviewer
         ON reviewer.user_account_id = alias_record.reviewed_by_user_account_id
       WHERE alias_record.public_id = ?
       LIMIT 1 FOR UPDATE`,
      [aliasId],
    );
    const row = singleRow(rows, "Alias");
    if (row === null) {
      return null;
    }
    return {
      aliasId: requiredString(row.aliasId, "Alias.aliasId", aliasIdPattern),
      playerId: requiredString(row.playerId, "Alias.playerId", playerIdPattern),
      aliasText: requiredString(row.aliasText, "Alias.aliasText"),
      aliasType: requiredEnum(row.aliasType, "Alias.aliasType", aliasTypes),
      visibility: requiredEnum(row.visibility, "Alias.visibility", visibilities),
      recordStatus: requiredEnum(
        row.recordStatus,
        "Alias.recordStatus",
        recordStatuses,
      ),
      revision: requiredSafeInteger(row.revision, "Alias.revision", 1),
      lastSequence: requiredSafeInteger(row.lastSequence, "Alias.lastSequence", 1),
      reviewedByUserAccountId: requiredString(
        row.reviewedByUserAccountId,
        "Alias.reviewedByUserAccountId",
        userAccountIdPattern,
      ),
      reviewedAtMs: requiredSafeInteger(row.reviewedAtMs, "Alias.reviewedAtMs"),
    };
  }

  public async createAlias(input: CreateAliasInput): Promise<void> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO aliases (
         public_id, revision, player_id, alias_text, alias_type, visibility,
         record_status, reviewed_by_user_account_id, reviewed_at_ms,
         created_at_ms, updated_at_ms
       )
       SELECT ?, ?, player.player_id, ?, ?, ?, ?, reviewer.user_account_id,
              ?, ?, ?
       FROM players AS player
       INNER JOIN user_accounts AS reviewer ON reviewer.public_id = ?
       WHERE player.public_id = ? AND player.player_kind = 'human'`,
      [
        input.snapshot.aliasId,
        input.snapshot.revision,
        input.snapshot.aliasText,
        input.snapshot.aliasType,
        input.snapshot.visibility,
        input.snapshot.recordStatus,
        input.snapshot.reviewedAtMs,
        input.createdAtMs,
        input.createdAtMs,
        input.snapshot.reviewedByUserAccountId,
        input.snapshot.playerId,
      ],
    );
    if (result.affectedRows !== 1) {
      throw new AliasServiceError("conflict", "Alias creation could not be completed");
    }
    const aliasInternalId = result.insertId;
    for (const [index, provenance] of input.provenance.entries()) {
      const [provenanceResult] = await this.connection.execute<ResultSetHeader>(
        `INSERT INTO alias_provenance (
           alias_id, sequence_number, source_type, source_reference, observed_at_ms
         ) VALUES (?, ?, ?, ?, ?)`,
        [
          aliasInternalId,
          index + 1,
          provenance.sourceType,
          provenance.sourceReference,
          provenance.observedAtMs,
        ],
      );
      if (provenanceResult.affectedRows !== 1) {
        throw new AliasPersistenceError("Alias provenance could not be appended");
      }
    }
    await this.insertLifecycle(aliasInternalId, input.initialEvent);
  }

  public async appendAliasEvent(input: AppendAliasEventInput): Promise<void> {
    if (
      input.nextSnapshot.aliasId !== input.aliasId ||
      input.nextSnapshot.revision !== input.expectedRevision + 1 ||
      input.nextSnapshot.lastSequence !== input.event.sequence
    ) {
      throw new AliasPersistenceError("Alias event revision invariant failed");
    }
    const [result] = await this.connection.execute<ResultSetHeader>(
      `UPDATE aliases AS alias_record
       INNER JOIN user_accounts AS reviewer ON reviewer.public_id = ?
       SET alias_record.revision = ?, alias_record.visibility = ?,
           alias_record.record_status = ?,
           alias_record.reviewed_by_user_account_id = reviewer.user_account_id,
           alias_record.reviewed_at_ms = ?, alias_record.updated_at_ms = ?
       WHERE alias_record.public_id = ? AND alias_record.revision = ?`,
      [
        input.event.actorUserAccountId,
        input.nextSnapshot.revision,
        input.nextSnapshot.visibility,
        input.nextSnapshot.recordStatus,
        input.nextSnapshot.reviewedAtMs,
        input.event.occurredAtMs,
        input.aliasId,
        input.expectedRevision,
      ],
    );
    if (result.affectedRows !== 1) {
      throw new AliasServiceError("conflict", "Alias lifecycle update conflicted");
    }
    const aliasInternalId = await this.findInternalAliasId(input.aliasId);
    await this.insertLifecycle(aliasInternalId, input.event);
  }

  private async findInternalAliasId(aliasId: string): Promise<number> {
    const [rows] = await this.connection.execute<
      (RowDataPacket & { aliasInternalId: unknown })[]
    >(
      `SELECT alias_id AS aliasInternalId FROM aliases
       WHERE public_id = ? LIMIT 1`,
      [aliasId],
    );
    const row = singleRow(rows, "Alias internal ID");
    if (row === null) {
      throw new AliasServiceError("conflict", "Alias lifecycle update was lost");
    }
    return requiredSafeInteger(row.aliasInternalId, "Alias.internalId", 1);
  }

  private async insertLifecycle(
    aliasInternalId: number,
    event: CreateAliasInput["initialEvent"] | AppendAliasEventInput["event"],
  ): Promise<void> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO alias_lifecycle (
         alias_id, sequence_number, event_type, actor_user_account_id,
         visibility_after, record_status_after, reason_code, occurred_at_ms
       )
       SELECT ?, ?, ?, reviewer.user_account_id, ?, ?, ?, ?
       FROM user_accounts AS reviewer WHERE reviewer.public_id = ?`,
      [
        aliasInternalId,
        event.sequence,
        event.eventType,
        event.visibilityAfter,
        event.recordStatusAfter,
        event.reasonCode ?? null,
        event.occurredAtMs,
        event.actorUserAccountId,
      ],
    );
    if (result.affectedRows !== 1) {
      throw new AliasPersistenceError("Alias lifecycle audit could not be appended");
    }
  }
}

export class MysqlAliasWriteRepository implements AliasWriteRepository {
  public constructor(private readonly pool: Pool) {}

  public async transaction<T>(
    work: (transaction: AliasWriteTransaction) => Promise<T>,
  ): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(new MysqlAliasWriteTransaction(connection));
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      if (isDuplicateKeyError(error)) {
        throw new AliasServiceError(
          "conflict",
          "an Alias uniqueness constraint was occupied concurrently",
        );
      }
      throw error;
    } finally {
      connection.release();
    }
  }
}
