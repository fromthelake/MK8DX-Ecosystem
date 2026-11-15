import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export class MutationRateLimitExceeded extends Error {
  public constructor(public readonly retryAfterSeconds: number) {
    super("The mutation rate limit was exceeded.");
    this.name = "MutationRateLimitExceeded";
  }
}

export interface MutationRateLimiter {
  consume(subject: string, scope: string, windowSeconds: number, maximum: number): Promise<void>;
}

/**
 * The refusal ledger (administrator view of request budgets). Every refusal is also counted in
 * `api_mutation_rate_limits` itself, under keys that no budget can produce (`!` is outside the scope
 * alphabet): `!refused|<scope>|*` per five minutes for the whole installation, and
 * `!refused|<scope>|<subject>` per hour for the subject that was refused. A subject row exists only
 * for a subject that already has its own budget row, so the ledger never adds caller-chosen keys the
 * limiter did not already store, and the ordinary 48-hour cleanup removes it. Quota refusals that
 * do not pass through the limiter (a full alias list, a missing fresh confirmation) are counted with
 * `recordQuotaRefusal` under `quota.<code>` without a subject.
 */
export const REFUSAL_LEDGER_PREFIX = "!refused|";
export const REFUSAL_LEDGER_TOTAL_SUBJECT = "*";
export const REFUSAL_LEDGER_TOTAL_WINDOW_MS = 300_000;
export const REFUSAL_LEDGER_SUBJECT_WINDOW_MS = 3_600_000;
const QUOTA_REFUSAL_CODE = /^[a-z0-9_]{1,64}$/;

/**
 * What the limiter reports for operators. Scopes are fixed code strings and counts are numbers:
 * no subject (account id, slot, device digest) and no error message ever leaves the limiter.
 */
export interface MutationRateLimiterObserver {
  /** One cleanup pass finished; `deletedRows` rows past the retention were removed. */
  cleanupCompleted(deletedRows: number, complete: boolean): void;
  /** A cleanup pass failed; the limiter itself keeps working. */
  cleanupFailed(errorName: string): void;
  /** Refusals per scope since the previous report (bounded number of scopes). */
  refusalsSinceLastReport(refusals: Readonly<Record<string, number>>): void;
  /** Writing the refusal ledger failed; the refusal itself still stands. */
  ledgerFailed?(errorName: string): void;
}

/** Rows older than this are removed. Every window the API uses is at most one day long. */
export const MUTATION_RATE_LIMIT_RETENTION_MS = 172_800_000;
/** Cleanup runs at most this often per process (on use, or from `startCleanupTimer`). */
export const MUTATION_RATE_LIMIT_CLEANUP_INTERVAL_MS = 3_600_000;
/** One DELETE removes at most this many rows; a pass repeats it a bounded number of times. */
const CLEANUP_BATCH_ROWS = 5_000;
const CLEANUP_MAXIMUM_BATCHES = 20;
const MAXIMUM_REPORTED_SCOPES = 64;

interface CountRow extends RowDataPacket { eventCount: unknown; }

export class MysqlMutationRateLimiter implements MutationRateLimiter {
  private lastCleanupAtMs = 0;
  private cleanupRunning: Promise<void> | null = null;
  private refusals = new Map<string, number>();

  public constructor(
    private readonly pool: Pick<Pool, "execute">,
    private readonly nowMs: () => number = Date.now,
    private readonly observer?: MutationRateLimiterObserver,
  ) {}

  public async consume(subject: string, scope: string, windowSeconds: number, maximum: number): Promise<void> {
    if (!/^[A-Za-z0-9._-]{1,141}$/.test(subject) || !/^[a-z0-9._-]{1,48}$/.test(scope) ||
        !Number.isSafeInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 86_400 ||
        !Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1_000_000) {
      throw new Error("invalid mutation rate-limit policy");
    }
    const now = this.nowMs();
    const windowMs = windowSeconds * 1_000;
    const started = Math.floor(now / windowMs) * windowMs;
    const key = `${scope}|${subject}`;
    // The statement returns this request's own count (LAST_INSERT_ID(expr) is per connection), so
    // concurrent requests in different processes each see their own position in the window: a
    // burst admits exactly `maximum`, instead of every request reading the burst's final total.
    // InnoDB may pick this single statement as a deadlock victim under a concurrent burst on
    // neighbouring keys; it is then rolled back whole, so running it again counts it exactly once.
    const [inserted] = await retryOnDeadlock(() => this.pool.execute<ResultSetHeader>(
      `INSERT INTO api_mutation_rate_limits (scope_key, window_started_at_ms, event_count, updated_at_ms)
       VALUES (?, ?, LAST_INSERT_ID(1), ?)
       ON DUPLICATE KEY UPDATE event_count = LAST_INSERT_ID(event_count + 1),
         updated_at_ms = VALUES(updated_at_ms)`,
      [key, started, now],
    ));
    let count = Number(inserted?.insertId);
    if (!Number.isSafeInteger(count) || count < 1) {
      // A driver or adapter that does not report the value: read it back (fails closed in a burst).
      const [rows] = await this.pool.execute<CountRow[]>(
        `SELECT event_count AS eventCount FROM api_mutation_rate_limits
         WHERE scope_key = ? AND window_started_at_ms = ? LIMIT 1`,
        [key, started],
      );
      count = Number(rows[0]?.eventCount);
    }
    if (now - this.lastCleanupAtMs >= MUTATION_RATE_LIMIT_CLEANUP_INTERVAL_MS) {
      await this.cleanupExpired();
    }
    if (!Number.isSafeInteger(count) || count > maximum) {
      this.countRefusal(scope);
      await this.recordRefusal(scope, subject, now);
      throw new MutationRateLimitExceeded(Math.max(1, Math.ceil((started + windowMs - now) / 1_000)));
    }
  }

  /**
   * Removes rows past the retention in bounded batches. Never throws: a failed cleanup is reported
   * to the observer and retried on the next interval, and it never refuses a valid mutation.
   */
  public async cleanupExpired(): Promise<void> {
    if (this.cleanupRunning !== null) { return this.cleanupRunning; }
    const now = this.nowMs();
    this.lastCleanupAtMs = now;
    this.cleanupRunning = (async () => {
      let deleted = 0;
      let complete = false;
      try {
        for (let batch = 0; batch < CLEANUP_MAXIMUM_BATCHES; batch += 1) {
          const [result] = await this.pool.execute<ResultSetHeader>(
            `DELETE FROM api_mutation_rate_limits WHERE updated_at_ms < ? LIMIT ${String(CLEANUP_BATCH_ROWS)}`,
            [Math.max(0, now - MUTATION_RATE_LIMIT_RETENTION_MS)],
          );
          const affected = Number(result?.affectedRows ?? 0);
          deleted += Number.isSafeInteger(affected) ? affected : 0;
          if (!(affected >= CLEANUP_BATCH_ROWS)) { complete = true; break; }
        }
        this.observer?.cleanupCompleted(deleted, complete);
      } catch (error) {
        this.observer?.cleanupFailed(error instanceof Error ? error.name : "UnknownError");
      }
      const refusals = this.refusals;
      this.refusals = new Map();
      if (refusals.size > 0) { this.observer?.refusalsSinceLastReport(Object.fromEntries(refusals)); }
    })().finally(() => { this.cleanupRunning = null; });
    return this.cleanupRunning;
  }

  /**
   * An independent cleanup timer, so retention does not depend on traffic. The timer never keeps
   * the process alive; the returned function stops it.
   */
  public startCleanupTimer(intervalMs: number = MUTATION_RATE_LIMIT_CLEANUP_INTERVAL_MS): () => void {
    const timer = setInterval(() => { void this.cleanupExpired(); }, intervalMs);
    timer.unref?.();
    return () => { clearInterval(timer); };
  }

  /**
   * Counts one quota refusal (a fixed server code such as `alias_quota_exceeded`) for the whole
   * installation. Never throws; an unknown shape is ignored.
   */
  public async recordQuotaRefusal(code: string): Promise<void> {
    if (!QUOTA_REFUSAL_CODE.test(code)) { return; }
    await this.recordRefusal(`quota.${code}`, null, this.nowMs());
  }

  /** One refusal in the ledger: the installation total and, when known, the refused subject. Never throws. */
  private async recordRefusal(scope: string, subject: string | null, now: number): Promise<void> {
    const total = Math.floor(now / REFUSAL_LEDGER_TOTAL_WINDOW_MS) * REFUSAL_LEDGER_TOTAL_WINDOW_MS;
    const hour = Math.floor(now / REFUSAL_LEDGER_SUBJECT_WINDOW_MS) * REFUSAL_LEDGER_SUBJECT_WINDOW_MS;
    // One row per statement: a statement holding a single row lock cannot form a lock cycle with
    // the budget upserts of a concurrent burst (a two-row upsert did, CI 2026-11-15).
    const rows: [string, number][] = [
      [`${REFUSAL_LEDGER_PREFIX}${scope}|${REFUSAL_LEDGER_TOTAL_SUBJECT}`, total],
      ...(subject === null ? [] : [[`${REFUSAL_LEDGER_PREFIX}${scope}|${subject}`, hour] as [string, number]]),
    ];
    for (const [ledgerKey, windowStartedAtMs] of rows) {
      try {
        await retryOnDeadlock(() => this.pool.execute<ResultSetHeader>(
          `INSERT INTO api_mutation_rate_limits (scope_key, window_started_at_ms, event_count, updated_at_ms)
           VALUES (?, ?, 1, ?)
           ON DUPLICATE KEY UPDATE event_count = event_count + 1, updated_at_ms = VALUES(updated_at_ms)`,
          [ledgerKey, windowStartedAtMs, now],
        ));
      } catch (error) {
        this.observer?.ledgerFailed?.(error instanceof Error ? error.name : "UnknownError");
      }
    }
  }

  private countRefusal(scope: string): void {
    const current = this.refusals.get(scope);
    if (current !== undefined) { this.refusals.set(scope, current + 1); return; }
    if (this.refusals.size < MAXIMUM_REPORTED_SCOPES) { this.refusals.set(scope, 1); return; }
    this.refusals.set("other", (this.refusals.get("other") ?? 0) + 1);
  }
}

const DEADLOCK_ATTEMPTS = 4;

/** Runs one autocommit statement again when InnoDB chose it as a deadlock victim (bounded, short jitter). */
async function retryOnDeadlock<T>(statement: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await statement();
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code !== "ER_LOCK_DEADLOCK" || attempt >= DEADLOCK_ATTEMPTS) { throw error; }
      await new Promise((resolve) => { setTimeout(resolve, Math.floor(Math.random() * 20 * attempt)); });
    }
  }
}
