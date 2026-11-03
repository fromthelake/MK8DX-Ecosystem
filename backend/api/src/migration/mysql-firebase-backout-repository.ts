import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";

import { TimeTrialPersistenceError } from
  "../timetrials/mysql-time-trial-write-repository.js";
import { refreshTimeTrialPlayerBestsForPlayers } from
  "../timetrials/time-trial-player-bests.js";
import type {
  FirebaseBackoutOutcome,
  FirebaseBackoutRecordState,
  FirebaseBackoutRepository,
  FirebaseBackoutTarget,
  FirebaseBackoutTransaction,
  FirebaseSubmissionRevisionRow,
} from "./firebase-backout-service.js";

interface InternalIdRow extends RowDataPacket {
  internalId: unknown;
  playerId?: unknown;
}

interface TargetRow extends RowDataPacket {
  recordKey: unknown;
  importStatus: unknown;
  submissionPublicId: unknown;
  revisionNumber: unknown;
}

interface BackoutRecordRow extends RowDataPacket {
  internalId: unknown;
  recordKey: unknown;
  importStatus: unknown;
  attemptCount: unknown;
  candidateSha256Hex: unknown;
  revisionInternalId: unknown;
}

interface RevisionRow extends RowDataPacket {
  revisionInternalId: unknown;
  revisionNumber: unknown;
}

interface PublicationRow extends RowDataPacket {
  publicationInternalId: unknown;
  publicationStatus: unknown;
  publishedEventCount: unknown;
}

function safeInteger(value: unknown, field: string, minimum: number): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isSafeInteger(numeric) ||
    numeric < minimum) {
    throw new TimeTrialPersistenceError(`${field} has an invalid persisted value`);
  }
  return numeric;
}

function importStatus(value: unknown): "imported" | "failed" | "backed_out" {
  if (value !== "imported" && value !== "failed" && value !== "backed_out") {
    throw new TimeTrialPersistenceError(
      "Firebase import record has an invalid persisted status",
    );
  }
  return value;
}

function requireSingleWrite(result: ResultSetHeader, resource: string): void {
  if (result.affectedRows !== 1) {
    throw new TimeTrialPersistenceError(`${resource} was not written`);
  }
}

class MysqlFirebaseBackoutTransaction implements FirebaseBackoutTransaction {
  public constructor(
    private readonly connection: PoolConnection,
    private readonly runInternalId: number,
  ) {}

  public async findBackoutRecordForUpdate(
    recordKey: string,
  ): Promise<FirebaseBackoutRecordState | null> {
    const [rows] = await this.connection.execute<BackoutRecordRow[]>(
      `SELECT firebase_timetrial_import_record_id AS internalId,
              record_key AS recordKey,
              import_status AS importStatus,
              attempt_count AS attemptCount,
              LOWER(HEX(candidate_sha256)) AS candidateSha256Hex,
              time_trial_submission_revision_id AS revisionInternalId
       FROM firebase_timetrial_import_records
       WHERE record_key = ?
       LIMIT 1 FOR UPDATE`,
      [recordKey],
    );
    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    if (typeof row.candidateSha256Hex !== "string" ||
      typeof row.recordKey !== "string") {
      throw new TimeTrialPersistenceError(
        "Firebase import record has an invalid persisted state",
      );
    }
    return {
      importRecordId: safeInteger(row.internalId, "FirebaseImportRecord.id", 1),
      recordKey: row.recordKey,
      importStatus: importStatus(row.importStatus),
      attemptCount: safeInteger(
        row.attemptCount,
        "FirebaseImportRecord.attemptCount",
        1,
      ),
      candidateSha256: row.candidateSha256Hex,
      revisionInternalId: row.revisionInternalId === null
        ? null
        : safeInteger(
          row.revisionInternalId,
          "FirebaseImportRecord.revisionId",
          1,
        ),
    };
  }

  public async lockSubmissionRevisions(
    submissionId: string,
  ): Promise<readonly FirebaseSubmissionRevisionRow[]> {
    const [rows] = await this.connection.execute<RevisionRow[]>(
      `SELECT r.time_trial_submission_revision_id AS revisionInternalId,
              r.revision_number AS revisionNumber
       FROM time_trial_submission_revisions r
       JOIN time_trial_submissions s
         ON s.time_trial_submission_id = r.time_trial_submission_id
       WHERE s.public_id = ?
       ORDER BY r.revision_number
       FOR UPDATE`,
      [submissionId],
    );
    return rows.map((row) => ({
      revisionInternalId: safeInteger(
        row.revisionInternalId,
        "TimeTrialRevision.internalId",
        1,
      ),
      revisionNumber: safeInteger(
        row.revisionNumber,
        "TimeTrialRevision.revisionNumber",
        1,
      ),
    }));
  }

  public async findPublicationStateForUpdate(
    submissionId: string,
  ): Promise<Readonly<{
    publicationStatus: string;
    publishedEventCount: number;
  }> | null> {
    const [rows] = await this.connection.execute<PublicationRow[]>(
      `SELECT p.time_trial_publication_id AS publicationInternalId,
              p.publication_status AS publicationStatus,
              (SELECT COUNT(*)
               FROM time_trial_publication_lifecycle lifecycle
               WHERE lifecycle.time_trial_publication_id =
                     p.time_trial_publication_id
                 AND lifecycle.event_type = 'revision_published'
              ) AS publishedEventCount
       FROM time_trial_publications p
       JOIN time_trial_submissions s
         ON s.time_trial_submission_id = p.time_trial_submission_id
       WHERE s.public_id = ?
       LIMIT 1 FOR UPDATE`,
      [submissionId],
    );
    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    if (typeof row.publicationStatus !== "string") {
      throw new TimeTrialPersistenceError(
        "Time Trial publication has an invalid persisted state",
      );
    }
    return {
      publicationStatus: row.publicationStatus,
      publishedEventCount: safeInteger(
        row.publishedEventCount,
        "TimeTrialPublication.publishedEventCount",
        0,
      ),
    };
  }

  public async deleteRevisionWithChildren(
    revisionInternalId: number,
  ): Promise<void> {
    for (const childTable of [
      "restricted_time_trial_evidence",
      "restricted_time_trial_participant_references",
      "time_trial_laps",
    ]) {
      await this.connection.execute<ResultSetHeader>(
        `DELETE FROM ${childTable}
         WHERE time_trial_submission_revision_id = ?`,
        [revisionInternalId],
      );
    }
    const [deleted] = await this.connection.execute<ResultSetHeader>(
      `DELETE FROM time_trial_submission_revisions
       WHERE time_trial_submission_revision_id = ?`,
      [revisionInternalId],
    );
    requireSingleWrite(deleted, "backed-out Time Trial revision");
  }

  public async deletePublicationState(submissionId: string): Promise<void> {
    const [rows] = await this.connection.execute<InternalIdRow[]>(
      `SELECT p.time_trial_publication_id AS internalId,
              r.player_id AS playerId
       FROM time_trial_publications p
       JOIN time_trial_submissions s
         ON s.time_trial_submission_id = p.time_trial_submission_id
       JOIN time_trial_submission_revisions r
         ON r.time_trial_submission_revision_id = p.current_revision_id
       WHERE s.public_id = ?
       LIMIT 1 FOR UPDATE`,
      [submissionId],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new TimeTrialPersistenceError(
        "backed-out publication state was lost",
      );
    }
    const publicationId = safeInteger(
      row.internalId,
      "TimeTrialPublication.internalId",
      1,
    );
    await this.connection.execute<ResultSetHeader>(
      `DELETE FROM time_trial_publication_lifecycle
       WHERE time_trial_publication_id = ?`,
      [publicationId],
    );
    const [deleted] = await this.connection.execute<ResultSetHeader>(
      `DELETE FROM time_trial_publications
       WHERE time_trial_publication_id = ?`,
      [publicationId],
    );
    requireSingleWrite(deleted, "backed-out Time Trial publication");
    const playerId = Number(row.playerId);
    if (Number.isSafeInteger(playerId) && playerId > 0) {
      await refreshTimeTrialPlayerBestsForPlayers(
        this.connection,
        [playerId],
      );
    }
  }

  public async deleteSubmission(submissionId: string): Promise<void> {
    const [deleted] = await this.connection.execute<ResultSetHeader>(
      `DELETE FROM time_trial_submissions WHERE public_id = ?`,
      [submissionId],
    );
    requireSingleWrite(deleted, "backed-out Time Trial submission");
  }

  public async markBackedOut(
    record: FirebaseBackoutRecordState,
    nowMs: number,
  ): Promise<void> {
    const [updated] = await this.connection.execute<ResultSetHeader>(
      `UPDATE firebase_timetrial_import_records
       SET import_status = 'backed_out',
           time_trial_submission_revision_id = NULL,
           attempt_count = attempt_count + 1,
           updated_at_ms = ?
       WHERE firebase_timetrial_import_record_id = ?
         AND import_status = 'imported'`,
      [nowMs, record.importRecordId],
    );
    requireSingleWrite(updated, "Firebase import backout record");
  }

  public async appendBackoutAttempt(
    record: FirebaseBackoutRecordState,
    outcome: FirebaseBackoutOutcome,
    nowMs: number,
  ): Promise<void> {
    let attemptNumber = record.attemptCount + 1;
    if (outcome !== "backed_out") {
      const [updated] = await this.connection.execute<ResultSetHeader>(
        `UPDATE firebase_timetrial_import_records
         SET attempt_count = attempt_count + 1, updated_at_ms = ?
         WHERE firebase_timetrial_import_record_id = ?`,
        [nowMs, record.importRecordId],
      );
      requireSingleWrite(updated, "Firebase import backout attempt count");
    }
    const [inserted] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO firebase_timetrial_import_attempts (
         firebase_timetrial_import_record_id, firebase_timetrial_import_run_id,
         attempt_number, outcome, candidate_sha256, occurred_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        record.importRecordId,
        this.runInternalId,
        attemptNumber,
        outcome,
        Buffer.from(record.candidateSha256, "hex"),
        nowMs,
      ],
    );
    requireSingleWrite(inserted, "Firebase import backout attempt");
  }
}

export class MysqlFirebaseBackoutRepository implements FirebaseBackoutRepository {
  public constructor(private readonly pool: Pool) {}

  public async resolveImportedRunTargets(
    importRunId: string,
  ): Promise<readonly string[]> {
    const [rows] = await this.pool.execute<TargetRow[]>(
      `SELECT DISTINCT record.record_key AS recordKey
       FROM firebase_timetrial_import_records record
       JOIN firebase_timetrial_import_attempts attempt
         ON attempt.firebase_timetrial_import_record_id =
            record.firebase_timetrial_import_record_id
       JOIN firebase_timetrial_import_runs run
         ON run.firebase_timetrial_import_run_id =
            attempt.firebase_timetrial_import_run_id
       WHERE run.public_id = ?
         AND attempt.outcome = 'imported'
         AND record.import_status IN ('imported', 'backed_out')
       ORDER BY record.record_key`,
      [importRunId],
    );
    return rows.map((row) => {
      if (typeof row.recordKey !== "string") {
        throw new TimeTrialPersistenceError(
          "Firebase import record key has an invalid persisted value",
        );
      }
      return row.recordKey;
    });
  }

  public async describeTargets(
    recordKeys: readonly string[],
  ): Promise<readonly FirebaseBackoutTarget[]> {
    const targets: FirebaseBackoutTarget[] = [];
    for (const recordKey of recordKeys) {
      const [rows] = await this.pool.execute<TargetRow[]>(
        `SELECT record.record_key AS recordKey,
                record.import_status AS importStatus,
                submission.public_id AS submissionPublicId,
                revision.revision_number AS revisionNumber
         FROM firebase_timetrial_import_records record
         LEFT JOIN time_trial_submission_revisions revision
           ON revision.time_trial_submission_revision_id =
              record.time_trial_submission_revision_id
         LEFT JOIN time_trial_submissions submission
           ON submission.time_trial_submission_id =
              revision.time_trial_submission_id
         WHERE record.record_key = ?
         LIMIT 1`,
        [recordKey],
      );
      const row = rows[0];
      if (row === undefined) {
        throw new TimeTrialPersistenceError(
          "a backout target record does not exist",
        );
      }
      targets.push({
        recordKey,
        importStatus: importStatus(row.importStatus),
        submissionId: typeof row.submissionPublicId === "string"
          ? row.submissionPublicId
          : null,
        revision: row.revisionNumber === null
          ? null
          : safeInteger(row.revisionNumber, "TimeTrialRevision.revisionNumber", 1),
      });
    }
    return targets;
  }

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
        Buffer.from(input.planSha256, "hex"),
        input.runnerVersion,
        input.startedAtMs,
      ],
    );
    requireSingleWrite(inserted, "Firebase backout run");
  }

  public async transaction<T>(
    backoutRunPublicId: string,
    work: (transaction: FirebaseBackoutTransaction) => Promise<T>,
  ): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const runInternalId = await this.findRunInternalId(
        connection,
        backoutRunPublicId,
      );
      const result = await work(new MysqlFirebaseBackoutTransaction(
        connection,
        runInternalId,
      ));
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  public async recordRefusal(input: Readonly<{
    backoutRunPublicId: string;
    recordKey: string;
    outcome: Exclude<
      FirebaseBackoutOutcome,
      "backed_out" | "skipped_already_backed_out"
    >;
    nowMs: number;
  }>): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const runInternalId = await this.findRunInternalId(
        connection,
        input.backoutRunPublicId,
      );
      const transaction = new MysqlFirebaseBackoutTransaction(
        connection,
        runInternalId,
      );
      const record = await transaction.findBackoutRecordForUpdate(
        input.recordKey,
      );
      if (record !== null) {
        await transaction.appendBackoutAttempt(record, input.outcome, input.nowMs);
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
    const row = rows[0];
    if (row === undefined) {
      throw new TimeTrialPersistenceError("Firebase backout run was not found");
    }
    return safeInteger(row.internalId, "FirebaseImportRun.internalId", 1);
  }
}
