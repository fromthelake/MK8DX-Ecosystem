import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";

type QueryExecutor = Pick<PoolConnection, "execute">;

interface JobRow extends RowDataPacket {
  jobId: unknown;
  submissionId: unknown;
}

interface BacklogRow extends RowDataPacket {
  readyCount: unknown;
  processingCount: unknown;
  deadRecentCount: unknown;
  oldestReadyAtMs: unknown;
}

export type NotificationProducerJob = Readonly<{
  jobId: number;
  submissionId: string;
}>;

export type NotificationProducerBacklog = Readonly<{
  readyCount: number;
  processingCount: number;
  deadRecentCount: number;
  oldestReadyAgeMs: number;
}>;

export async function enqueueOvertakenNotificationJob(
  executor: QueryExecutor,
  publicationInternalId: number,
  publicationRevision: number,
  nowMs: number,
): Promise<void> {
  await executor.execute<ResultSetHeader>(
    `INSERT IGNORE INTO notification_producer_jobs (
       producer_kind, time_trial_publication_id, publication_revision,
       job_status, attempt_count, next_attempt_at_ms,
       created_at_ms, updated_at_ms
     ) VALUES ('overtaken', ?, ?, 'pending', 0, ?, ?, ?)`,
    [publicationInternalId, publicationRevision, nowMs, nowMs, nowMs],
  );
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${field} is invalid`);
  }
  return parsed;
}

export class MysqlNotificationProducerJobRepository {
  public constructor(private readonly pool: Pool) {}

  public async claim(nowMs: number, limit = 2): Promise<readonly NotificationProducerJob[]> {
    const boundedLimit = Math.max(1, Math.min(10, Math.trunc(limit)));
    // A dead process cannot hold work forever. Jobs for a superseded or
    // withheld publication revision are terminal: the newer revision owns its
    // own idempotent job and stale competitive state must never be delivered.
    await this.pool.execute<ResultSetHeader>(
      `UPDATE notification_producer_jobs
       SET job_status = 'retry', next_attempt_at_ms = ?, claimed_at_ms = NULL,
           updated_at_ms = ?, last_error_code = 'lease_expired'
       WHERE job_status = 'processing' AND claimed_at_ms < ?`,
      [nowMs, nowMs, Math.max(0, nowMs - 10 * 60 * 1000)],
    );
    await this.pool.execute<ResultSetHeader>(
      `UPDATE notification_producer_jobs AS job
       INNER JOIN time_trial_publications AS publication
         ON publication.time_trial_publication_id =
            job.time_trial_publication_id
       SET job.job_status = 'dead', job.updated_at_ms = ?,
           job.last_error_code = 'source_superseded'
       WHERE job.job_status IN ('pending', 'retry')
         AND (publication.publication_status <> 'published'
              OR publication.publication_revision <> job.publication_revision)`,
      [nowMs],
    );
    const [rows] = await this.pool.execute<JobRow[]>(
      `SELECT job.notification_producer_job_id AS jobId,
              submission.public_id AS submissionId
       FROM notification_producer_jobs AS job
       INNER JOIN time_trial_publications AS publication
         ON publication.time_trial_publication_id =
            job.time_trial_publication_id
        AND publication.publication_status = 'published'
        AND publication.publication_revision = job.publication_revision
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id =
            publication.time_trial_submission_id
       WHERE job.job_status IN ('pending', 'retry')
         AND job.next_attempt_at_ms <= ?
       ORDER BY job.next_attempt_at_ms, job.notification_producer_job_id
       LIMIT ${boundedLimit}`,
      [nowMs],
    );
    const claimed: NotificationProducerJob[] = [];
    for (const row of rows) {
      const jobId = positiveInteger(row.jobId, "notification producer job id");
      if (typeof row.submissionId !== "string") continue;
      const [result] = await this.pool.execute<ResultSetHeader>(
        `UPDATE notification_producer_jobs
         SET job_status = 'processing', attempt_count = attempt_count + 1,
             claimed_at_ms = ?, updated_at_ms = ?, last_error_code = NULL
         WHERE notification_producer_job_id = ?
           AND job_status IN ('pending', 'retry')`,
        [nowMs, nowMs, jobId],
      );
      if (result.affectedRows === 1) {
        claimed.push({ jobId, submissionId: row.submissionId });
      }
    }
    return claimed;
  }

  public async completed(jobId: number, nowMs: number): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `UPDATE notification_producer_jobs
       SET job_status = 'completed', completed_at_ms = ?, claimed_at_ms = NULL,
           updated_at_ms = ?, last_error_code = NULL
       WHERE notification_producer_job_id = ? AND job_status = 'processing'`,
      [nowMs, nowMs, jobId],
    );
  }

  public async failed(jobId: number, nowMs: number, error: unknown): Promise<void> {
    const code = error instanceof Error
      ? error.name.replaceAll(/[^A-Za-z0-9_]/g, "_").slice(0, 32)
      : "UnknownError";
    await this.pool.execute<ResultSetHeader>(
      `UPDATE notification_producer_jobs
       SET job_status = IF(attempt_count >= 5, 'dead', 'retry'),
           next_attempt_at_ms = ?, claimed_at_ms = NULL,
           updated_at_ms = ?, last_error_code = ?
       WHERE notification_producer_job_id = ? AND job_status = 'processing'`,
      [nowMs + 60_000, nowMs, code || "Error", jobId],
    );
  }

  public async backlog(nowMs: number): Promise<NotificationProducerBacklog> {
    const [rows] = await this.pool.execute<BacklogRow[]>(
      `SELECT
         SUM(job_status IN ('pending', 'retry')) AS readyCount,
         SUM(job_status = 'processing') AS processingCount,
         SUM(job_status = 'dead' AND updated_at_ms >= ?) AS deadRecentCount,
         MIN(CASE WHEN job_status IN ('pending', 'retry')
                  THEN next_attempt_at_ms ELSE NULL END) AS oldestReadyAtMs
       FROM notification_producer_jobs`,
      [Math.max(0, nowMs - 24 * 60 * 60 * 1000)],
    );
    const row = rows[0];
    const readyCount = Math.max(0, Number(row?.readyCount ?? 0));
    const processingCount = Math.max(0, Number(row?.processingCount ?? 0));
    const deadRecentCount = Math.max(0, Number(row?.deadRecentCount ?? 0));
    const oldestReadyAtMs = Number(row?.oldestReadyAtMs);
    return {
      readyCount: Number.isSafeInteger(readyCount) ? readyCount : 0,
      processingCount: Number.isSafeInteger(processingCount) ? processingCount : 0,
      deadRecentCount: Number.isSafeInteger(deadRecentCount) ? deadRecentCount : 0,
      oldestReadyAgeMs: Number.isFinite(oldestReadyAtMs)
        ? Math.max(0, nowMs - oldestReadyAtMs) : 0,
    };
  }

  public async purgeTerminal(
    nowMs: number,
    retentionMs = 90 * 24 * 60 * 60 * 1000,
    limit = 1_000,
  ): Promise<number> {
    const boundedLimit = Math.max(1, Math.min(10_000, Math.trunc(limit)));
    const [result] = await this.pool.execute<ResultSetHeader>(
      `DELETE FROM notification_producer_jobs
       WHERE job_status IN ('completed', 'dead') AND updated_at_ms < ?
       ORDER BY notification_producer_job_id
       LIMIT ${boundedLimit}`,
      [Math.max(0, nowMs - retentionMs)],
    );
    return result.affectedRows;
  }
}

export class NotificationProducerWorker {
  private running = false;

  public constructor(
    private readonly jobs: MysqlNotificationProducerJobRepository,
    private readonly producer: Readonly<{
      produceOvertaken(submissionPublicId: string, nowMs: number): Promise<void>;
    }>,
    private readonly now: () => number = Date.now,
  ) {}

  public async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const claimedAt = this.now();
      for (const job of await this.jobs.claim(claimedAt)) {
        try {
          await this.producer.produceOvertaken(job.submissionId, this.now());
          await this.jobs.completed(job.jobId, this.now());
        } catch (error) {
          await this.jobs.failed(job.jobId, this.now(), error);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
