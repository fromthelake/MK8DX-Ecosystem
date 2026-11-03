import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";

import {
  MysqlTimeTrialWriteTransaction,
  TimeTrialPersistenceError,
} from "../timetrials/mysql-time-trial-write-repository.js";
import {
  TimeTrialSubmissionError,
  type ProtectedLookupValue,
} from "../timetrials/submission-service.js";
import type {
  FirebaseImportCheckpointState,
  FirebaseImportOutcome,
  FirebaseImportProvenance,
  FirebaseImportRepository,
  FirebaseImportTransaction,
} from "./firebase-import-service.js";

const LEGACY_SOURCE_SYSTEM = "timetrials_firebase";
const LEGACY_IDENTIFIER_KIND = "firebase_auth_uid";
const LEGACY_ACCESS_PURPOSE = "firebase_timetrial_import";

interface InternalIdRow extends RowDataPacket {
  internalId: unknown;
}

interface PlayerRevisionRow extends RowDataPacket {
  internalId: unknown;
  playerRevision: unknown;
}

interface ImportRecordRow extends RowDataPacket {
  internalId: unknown;
  candidateSha256Hex: unknown;
  importStatus: unknown;
  attemptCount: unknown;
}

interface LegacyIdentifierRow extends RowDataPacket {
  internalId: unknown;
  linkedPlayerId: unknown;
  linkedUserAccountId: unknown;
  lookupKeyVersion: unknown;
}

function safeInteger(value: unknown, field: string, minimum: number): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isSafeInteger(numeric) ||
    numeric < minimum) {
    throw new TimeTrialPersistenceError(`${field} has an invalid persisted value`);
  }
  return numeric;
}

function singleRow<T extends RowDataPacket>(rows: T[], resource: string): T | null {
  if (rows.length === 0) {
    return null;
  }
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new TimeTrialPersistenceError(
      `${resource} lookup returned an invalid row count`,
    );
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

function sha256Buffer(hexValue: string): Buffer {
  return Buffer.from(hexValue, "hex");
}

function requireSingleWrite(result: ResultSetHeader, resource: string): void {
  if (result.affectedRows !== 1) {
    throw new TimeTrialPersistenceError(`${resource} was not written`);
  }
}

class MysqlFirebaseImportTransaction implements FirebaseImportTransaction {
  private readonly canonical: MysqlTimeTrialWriteTransaction;

  public constructor(
    private readonly connection: PoolConnection,
    private readonly runInternalId: number,
    private readonly runPublicId: string,
    clock: Readonly<{ nowMs(): number }>,
  ) {
    this.canonical = new MysqlTimeTrialWriteTransaction(connection, clock);
  }

  public findSubmissionForUpdate(
    submissionId: string,
  ): ReturnType<MysqlTimeTrialWriteTransaction["findSubmissionForUpdate"]> {
    return this.canonical.findSubmissionForUpdate(submissionId);
  }

  public findActiveHumanPlayerForUpdate(playerId: string): Promise<boolean> {
    return this.canonical.findActiveHumanPlayerForUpdate(playerId);
  }

  public insertSubmission(
    submissionId: string,
    firstCreatedAtMs: number,
  ): Promise<void> {
    return this.canonical.insertSubmission(submissionId, firstCreatedAtMs);
  }

  public insertRevision(
    input: Parameters<MysqlTimeTrialWriteTransaction["insertRevision"]>[0],
  ): Promise<void> {
    return this.canonical.insertRevision(input);
  }

  public async findImportRecordForUpdate(
    recordKey: string,
  ): Promise<FirebaseImportCheckpointState | null> {
    const [rows] = await this.connection.execute<ImportRecordRow[]>(
      `SELECT firebase_timetrial_import_record_id AS internalId,
              LOWER(HEX(candidate_sha256)) AS candidateSha256Hex,
              import_status AS importStatus,
              attempt_count AS attemptCount
       FROM firebase_timetrial_import_records
       WHERE record_key = ?
       LIMIT 1 FOR UPDATE`,
      [recordKey],
    );
    const row = singleRow(rows, "Firebase import record");
    if (row === null) {
      return null;
    }
    if (typeof row.candidateSha256Hex !== "string" ||
      (row.importStatus !== "imported" && row.importStatus !== "failed" &&
        row.importStatus !== "backed_out")) {
      throw new TimeTrialPersistenceError(
        "Firebase import record has an invalid persisted state",
      );
    }
    return {
      importRecordId: safeInteger(row.internalId, "FirebaseImportRecord.id", 1),
      candidateSha256: row.candidateSha256Hex,
      importStatus: row.importStatus,
      attemptCount: safeInteger(
        row.attemptCount,
        "FirebaseImportRecord.attemptCount",
        1,
      ),
    };
  }

  public async findActiveHumanPlayerRevisionForUpdate(
    playerId: string,
  ): Promise<number | null> {
    const [rows] = await this.connection.execute<PlayerRevisionRow[]>(
      `SELECT player_id AS internalId, revision AS playerRevision
       FROM players
       WHERE public_id = ? AND player_kind = 'human' AND record_status = 'active'
       LIMIT 1 FOR UPDATE`,
      [playerId],
    );
    const row = singleRow(rows, "active human Player");
    if (row === null) {
      return null;
    }
    safeInteger(row.internalId, "Player.internalId", 1);
    return safeInteger(row.playerRevision, "Player.revision", 1);
  }

  public async ensureLegacyOwnerIdentifier(input: Readonly<{
    protectedOwner: ProtectedLookupValue;
    targetPlayerId: string;
    nowMs: number;
  }>): Promise<number | "conflict"> {
    const playerInternalId = await this.findPlayerInternalId(input.targetPlayerId);
    if (playerInternalId === null) {
      return "conflict";
    }
    const lookupHmac = Buffer.from(input.protectedOwner.lookupHmac);
    const [rows] = await this.connection.execute<LegacyIdentifierRow[]>(
      `SELECT legacy_identifier_id AS internalId,
              linked_player_id AS linkedPlayerId,
              linked_user_account_id AS linkedUserAccountId,
              lookup_key_version AS lookupKeyVersion
       FROM restricted_legacy_identity_identifiers
       WHERE source_system = ? AND identifier_kind = ? AND lookup_hash = ?
       LIMIT 1 FOR UPDATE`,
      [LEGACY_SOURCE_SYSTEM, LEGACY_IDENTIFIER_KIND, lookupHmac],
    );
    const row = singleRow(rows, "restricted legacy identifier");
    if (row !== null) {
      const internalId = safeInteger(row.internalId, "LegacyIdentifier.id", 1);
      if (row.linkedUserAccountId !== null ||
        row.lookupKeyVersion !== input.protectedOwner.lookupKeyVersion ||
        safeInteger(row.linkedPlayerId, "LegacyIdentifier.linkedPlayerId", 1) !==
          playerInternalId) {
        return "conflict";
      }
      const [updated] = await this.connection.execute<ResultSetHeader>(
        `UPDATE restricted_legacy_identity_identifiers
         SET last_accessed_at_ms = ?
         WHERE legacy_identifier_id = ?`,
        [input.nowMs, internalId],
      );
      requireSingleWrite(updated, "restricted legacy identifier access time");
      const [logged] = await this.connection.execute<ResultSetHeader>(
        `INSERT INTO restricted_identity_access_log (
           resource_type, legacy_identifier_id, accessor_type,
           accessor_reference, purpose_code, accessed_at_ms
         ) VALUES ('legacy_identifier', ?, 'migration_operator', ?, ?, ?)`,
        [internalId, this.runPublicId, LEGACY_ACCESS_PURPOSE, input.nowMs],
      );
      requireSingleWrite(logged, "restricted legacy identifier access log");
      return internalId;
    }
    const [inserted] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO restricted_legacy_identity_identifiers (
         source_system, identifier_kind, lookup_hash, lookup_key_version,
         identifier_ciphertext, encryption_key_version, linked_player_id,
         linked_user_account_id, created_at_ms, last_accessed_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
      [
        LEGACY_SOURCE_SYSTEM,
        LEGACY_IDENTIFIER_KIND,
        lookupHmac,
        input.protectedOwner.lookupKeyVersion,
        Buffer.from(input.protectedOwner.ciphertext),
        input.protectedOwner.encryptionKeyVersion,
        playerInternalId,
        input.nowMs,
      ],
    );
    if (inserted.affectedRows !== 1 || inserted.insertId < 1) {
      throw new TimeTrialPersistenceError(
        "restricted legacy identifier was not inserted",
      );
    }
    return inserted.insertId;
  }

  public async findRevisionInternalId(
    submissionId: string,
    revision: number,
  ): Promise<number> {
    const [rows] = await this.connection.execute<InternalIdRow[]>(
      `SELECT r.time_trial_submission_revision_id AS internalId
       FROM time_trial_submission_revisions r
       JOIN time_trial_submissions s
         ON s.time_trial_submission_id = r.time_trial_submission_id
       WHERE s.public_id = ? AND r.revision_number = ?
       LIMIT 1`,
      [submissionId, revision],
    );
    const row = singleRow(rows, "Time Trial revision internal ID");
    if (row === null) {
      throw new TimeTrialPersistenceError("imported revision was not found");
    }
    return safeInteger(row.internalId, "TimeTrialRevision.internalId", 1);
  }

  public async markImported(input: Readonly<{
    existing: FirebaseImportCheckpointState | null;
    provenance: FirebaseImportProvenance;
    legacyIdentifierId: number | null;
    revisionInternalId: number;
    nowMs: number;
  }>): Promise<void> {
    let playerInternalId: number | null = null;
    if (input.provenance.recordKind === "reviewed_player") {
      if (input.provenance.targetPlayerId === null ||
        input.legacyIdentifierId === null) {
        throw new TimeTrialPersistenceError(
          "reviewed import provenance is incomplete",
        );
      }
      playerInternalId = await this.findPlayerInternalId(
        input.provenance.targetPlayerId,
      );
      if (playerInternalId === null) {
        throw new TimeTrialPersistenceError("imported Player row was lost");
      }
    } else if (input.legacyIdentifierId !== null) {
      throw new TimeTrialPersistenceError(
        "a system-reference import cannot link a legacy human identifier",
      );
    }
    let importRecordId: number;
    let attemptNumber: number;
    if (input.existing === null) {
      const [inserted] = await this.connection.execute<ResultSetHeader>(
        `INSERT INTO firebase_timetrial_import_records (
           record_key, candidate_sha256, record_kind, resolution_id,
           administrator_grant_id, review_reason_code, reviewed_at_ms,
           legacy_visible, expected_player_revision, target_player_public_id,
           player_id, legacy_identifier_id, import_status,
           time_trial_submission_revision_id, attempt_count,
           created_at_ms, updated_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'imported', ?, 1, ?, ?)`,
        [
          input.provenance.recordKey,
          sha256Buffer(input.provenance.candidateSha256),
          input.provenance.recordKind,
          input.provenance.resolutionId,
          input.provenance.administratorGrantId,
          input.provenance.reasonCode,
          input.provenance.reviewedAtMs,
          input.provenance.legacyVisible,
          input.provenance.expectedPlayerRevision,
          input.provenance.targetPlayerId,
          playerInternalId,
          input.legacyIdentifierId,
          input.revisionInternalId,
          input.nowMs,
          input.nowMs,
        ],
      );
      if (inserted.affectedRows !== 1 || inserted.insertId < 1) {
        throw new TimeTrialPersistenceError(
          "Firebase import record was not inserted",
        );
      }
      importRecordId = inserted.insertId;
      attemptNumber = 1;
    } else {
      const [updated] = await this.connection.execute<ResultSetHeader>(
        `UPDATE firebase_timetrial_import_records
         SET candidate_sha256 = ?, record_kind = ?, resolution_id = ?,
             administrator_grant_id = ?, review_reason_code = ?,
             reviewed_at_ms = ?, legacy_visible = ?,
             expected_player_revision = ?, target_player_public_id = ?,
             player_id = ?, legacy_identifier_id = ?, import_status = 'imported',
             time_trial_submission_revision_id = ?,
             attempt_count = attempt_count + 1, updated_at_ms = ?
         WHERE firebase_timetrial_import_record_id = ?
           AND import_status IN ('failed', 'backed_out')`,
        [
          sha256Buffer(input.provenance.candidateSha256),
          input.provenance.recordKind,
          input.provenance.resolutionId,
          input.provenance.administratorGrantId,
          input.provenance.reasonCode,
          input.provenance.reviewedAtMs,
          input.provenance.legacyVisible,
          input.provenance.expectedPlayerRevision,
          input.provenance.targetPlayerId,
          playerInternalId,
          input.legacyIdentifierId,
          input.revisionInternalId,
          input.nowMs,
          input.existing.importRecordId,
        ],
      );
      requireSingleWrite(updated, "Firebase import record retry");
      importRecordId = input.existing.importRecordId;
      attemptNumber = input.existing.attemptCount + 1;
    }
    await this.insertAttempt(
      importRecordId,
      attemptNumber,
      "imported",
      input.provenance.candidateSha256,
      input.nowMs,
    );
  }

  public async appendAttempt(input: Readonly<{
    existing: FirebaseImportCheckpointState;
    outcome: "skipped_already_imported" | "failed_candidate_conflict";
    candidateSha256: string;
    nowMs: number;
  }>): Promise<void> {
    const [updated] = await this.connection.execute<ResultSetHeader>(
      `UPDATE firebase_timetrial_import_records
       SET attempt_count = attempt_count + 1, updated_at_ms = ?
       WHERE firebase_timetrial_import_record_id = ?`,
      [input.nowMs, input.existing.importRecordId],
    );
    requireSingleWrite(updated, "Firebase import record attempt count");
    await this.insertAttempt(
      input.existing.importRecordId,
      input.existing.attemptCount + 1,
      input.outcome,
      input.candidateSha256,
      input.nowMs,
    );
  }

  public async insertAttempt(
    importRecordId: number,
    attemptNumber: number,
    outcome: FirebaseImportOutcome,
    candidateSha256: string,
    nowMs: number,
  ): Promise<void> {
    const [inserted] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO firebase_timetrial_import_attempts (
         firebase_timetrial_import_record_id, firebase_timetrial_import_run_id,
         attempt_number, outcome, candidate_sha256, occurred_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        importRecordId,
        this.runInternalId,
        attemptNumber,
        outcome,
        sha256Buffer(candidateSha256),
        nowMs,
      ],
    );
    requireSingleWrite(inserted, "Firebase import attempt");
  }

  public async findPlayerInternalId(playerId: string): Promise<number | null> {
    const [rows] = await this.connection.execute<InternalIdRow[]>(
      `SELECT player_id AS internalId FROM players WHERE public_id = ? LIMIT 1`,
      [playerId],
    );
    const row = singleRow(rows, "Player internal ID");
    if (row === null) {
      return null;
    }
    return safeInteger(row.internalId, "Player.internalId", 1);
  }
}

export class MysqlFirebaseImportRepository implements FirebaseImportRepository {
  public constructor(
    private readonly pool: Pool,
    private readonly clock: Readonly<{ nowMs(): number }> = {
      nowMs: () => Date.now(),
    },
  ) {}

  public async createRun(input: Readonly<{
    publicId: string;
    planSha256: string;
    runnerVersion: string;
    startedAtMs: number;
  }>): Promise<void> {
    const [inserted] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO firebase_timetrial_import_runs (
         public_id, plan_sha256, runner_version, started_at_ms
       ) VALUES (?, ?, ?, ?)`,
      [
        input.publicId,
        sha256Buffer(input.planSha256),
        input.runnerVersion,
        input.startedAtMs,
      ],
    );
    requireSingleWrite(inserted, "Firebase import run");
  }

  public async transaction<T>(
    runPublicId: string,
    work: (transaction: FirebaseImportTransaction) => Promise<T>,
  ): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const runInternalId = await this.findRunInternalId(connection, runPublicId);
      const result = await work(new MysqlFirebaseImportTransaction(
        connection,
        runInternalId,
        runPublicId,
        this.clock,
      ));
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      if (isDuplicateKeyError(error)) {
        throw new TimeTrialSubmissionError(
          "revision_conflict",
          "submission or revision was occupied concurrently",
        );
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  public async recordFailure(input: Readonly<{
    runPublicId: string;
    provenance: FirebaseImportProvenance;
    outcome: Exclude<FirebaseImportOutcome, "imported" | "skipped_already_imported">;
    nowMs: number;
  }>): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const runInternalId = await this.findRunInternalId(
        connection,
        input.runPublicId,
      );
      const transaction = new MysqlFirebaseImportTransaction(
        connection,
        runInternalId,
        input.runPublicId,
        this.clock,
      );
      const existing = await transaction.findImportRecordForUpdate(
        input.provenance.recordKey,
      );
      if (existing === null) {
        const playerInternalId = input.provenance.targetPlayerId === null
          ? null
          : await transaction.findPlayerInternalId(
            input.provenance.targetPlayerId,
          );
        const [inserted] = await connection.execute<ResultSetHeader>(
          `INSERT INTO firebase_timetrial_import_records (
             record_key, candidate_sha256, record_kind, resolution_id,
             administrator_grant_id, review_reason_code, reviewed_at_ms,
             legacy_visible, expected_player_revision, target_player_public_id,
             player_id, legacy_identifier_id, import_status,
             time_trial_submission_revision_id, attempt_count,
             created_at_ms, updated_at_ms
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'failed', NULL, 1, ?, ?)`,
          [
            input.provenance.recordKey,
            sha256Buffer(input.provenance.candidateSha256),
            input.provenance.recordKind,
            input.provenance.resolutionId,
            input.provenance.administratorGrantId,
            input.provenance.reasonCode,
            input.provenance.reviewedAtMs,
            input.provenance.legacyVisible,
            input.provenance.expectedPlayerRevision,
            input.provenance.targetPlayerId,
            input.provenance.recordKind === "system_reference"
              ? null
              : playerInternalId,
            input.nowMs,
            input.nowMs,
          ],
        );
        if (inserted.affectedRows !== 1 || inserted.insertId < 1) {
          throw new TimeTrialPersistenceError(
            "Firebase import failure record was not inserted",
          );
        }
        await transaction.insertAttempt(
          inserted.insertId,
          1,
          input.outcome,
          input.provenance.candidateSha256,
          input.nowMs,
        );
      } else if (existing.importStatus !== "imported") {
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE firebase_timetrial_import_records
           SET candidate_sha256 = ?, record_kind = ?, resolution_id = ?,
               administrator_grant_id = ?, review_reason_code = ?,
               reviewed_at_ms = ?, legacy_visible = ?,
               expected_player_revision = ?, target_player_public_id = ?,
               attempt_count = attempt_count + 1, updated_at_ms = ?
           WHERE firebase_timetrial_import_record_id = ?`,
          [
            sha256Buffer(input.provenance.candidateSha256),
            input.provenance.recordKind,
            input.provenance.resolutionId,
            input.provenance.administratorGrantId,
            input.provenance.reasonCode,
            input.provenance.reviewedAtMs,
            input.provenance.legacyVisible,
            input.provenance.expectedPlayerRevision,
            input.provenance.targetPlayerId,
            input.nowMs,
            existing.importRecordId,
          ],
        );
        requireSingleWrite(updated, "Firebase import failure retry");
        await transaction.insertAttempt(
          existing.importRecordId,
          existing.attemptCount + 1,
          input.outcome,
          input.provenance.candidateSha256,
          input.nowMs,
        );
      } else {
        // Imported checkpoint state is never downgraded by a later failed
        // attempt; only the attempt history records it.
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE firebase_timetrial_import_records
           SET attempt_count = attempt_count + 1, updated_at_ms = ?
           WHERE firebase_timetrial_import_record_id = ?`,
          [input.nowMs, existing.importRecordId],
        );
        requireSingleWrite(updated, "Firebase import attempt count");
        await transaction.insertAttempt(
          existing.importRecordId,
          existing.attemptCount + 1,
          input.outcome,
          input.provenance.candidateSha256,
          input.nowMs,
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async findRunInternalId(
    connection: PoolConnection,
    runPublicId: string,
  ): Promise<number> {
    const [rows] = await connection.execute<InternalIdRow[]>(
      `SELECT firebase_timetrial_import_run_id AS internalId
       FROM firebase_timetrial_import_runs
       WHERE public_id = ?
       LIMIT 1`,
      [runPublicId],
    );
    const row = singleRow(rows, "Firebase import run");
    if (row === null) {
      throw new TimeTrialPersistenceError("Firebase import run was not found");
    }
    return safeInteger(row.internalId, "FirebaseImportRun.internalId", 1);
  }
}
