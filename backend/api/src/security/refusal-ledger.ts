import type { Pool, ResultSetHeader } from "mysql2/promise";

/**
 * The refusal ledger behind the administrator view of request budgets.
 *
 * A refused request must not cost the database anything extra, otherwise a flood that is being
 * refused would still buy itself writes. Refusals are therefore counted in this process's memory
 * only, in a bounded map, and written to `api_mutation_rate_limits` by a periodic flush (every 30
 * seconds and on a graceful shutdown) as one batched upsert. The keys are ones no budget can produce
 * (`!` is outside the scope alphabet):
 *
 * - `!refused|<scope>|*` per five minutes: every refusal of a scope, for the whole installation;
 * - `!refused|<scope>|<subject>` per hour: the refused subject (an account id, or a digest/slot that
 *   the limiter itself already keys its budget row by).
 *
 * At most `maximumEntries` distinct keys are held between flushes; beyond that a refusal is still
 * counted, under `!refused|other|*` and `!refused|other|other`, so the map cannot grow with what a
 * caller sends. A crash or kill loses at most one flush interval of counts; the refusals themselves
 * are unaffected. The ordinary 48-hour cleanup of the table removes ledger rows.
 */
export const REFUSAL_LEDGER_PREFIX = "!refused|";
export const REFUSAL_LEDGER_TOTAL_SUBJECT = "*";
export const REFUSAL_LEDGER_OVERFLOW = "other";
export const REFUSAL_LEDGER_TOTAL_WINDOW_MS = 300_000;
export const REFUSAL_LEDGER_SUBJECT_WINDOW_MS = 3_600_000;
export const REFUSAL_LEDGER_FLUSH_INTERVAL_MS = 30_000;
export const REFUSAL_LEDGER_MAXIMUM_ENTRIES = 4_096;
const QUOTA_REFUSAL_CODE = /^[a-z0-9_]{1,64}$/;
const DEADLOCK_ATTEMPTS = 4;

export type RefusalLedgerEntry = Readonly<{ scopeKey: string; windowStartedAtMs: number; count: number }>;

export type RefusalLedgerObserver = Readonly<{ ledgerFailed?(errorName: string): void }>;

type Mutable = { scopeKey: string; windowStartedAtMs: number; count: number };

export class RefusalLedger {
  private pending = new Map<string, Mutable>();
  private inFlight = new Map<string, Mutable>();
  private flushing: Promise<void> | null = null;

  public constructor(
    private readonly pool: Pick<Pool, "execute">,
    private readonly nowMs: () => number = Date.now,
    private readonly observer?: RefusalLedgerObserver,
    private readonly maximumEntries: number = REFUSAL_LEDGER_MAXIMUM_ENTRIES,
  ) {
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 2 || maximumEntries > 65_536) {
      throw new Error("refusal ledger size is invalid");
    }
  }

  /** One limiter refusal. Memory only: no database work on the refusal path. */
  public record(scope: string, subject: string | null): void {
    const now = this.nowMs();
    const total = Math.floor(now / REFUSAL_LEDGER_TOTAL_WINDOW_MS) * REFUSAL_LEDGER_TOTAL_WINDOW_MS;
    const hour = Math.floor(now / REFUSAL_LEDGER_SUBJECT_WINDOW_MS) * REFUSAL_LEDGER_SUBJECT_WINDOW_MS;
    this.add(`${REFUSAL_LEDGER_PREFIX}${scope}|${REFUSAL_LEDGER_TOTAL_SUBJECT}`, total,
      `${REFUSAL_LEDGER_PREFIX}${REFUSAL_LEDGER_OVERFLOW}|${REFUSAL_LEDGER_TOTAL_SUBJECT}`);
    if (subject !== null) {
      this.add(`${REFUSAL_LEDGER_PREFIX}${scope}|${subject}`, hour,
        `${REFUSAL_LEDGER_PREFIX}${REFUSAL_LEDGER_OVERFLOW}|${REFUSAL_LEDGER_OVERFLOW}`);
    }
  }

  /** A quota refusal by its fixed response code (`quota.<code>`, no subject). An unknown shape is ignored. */
  public recordQuotaRefusal(code: string): void {
    if (QUOTA_REFUSAL_CODE.test(code)) { this.record(`quota.${code}`, null); }
  }

  /** Counts not yet in the database (waiting, or in a flush that has not finished). */
  public unflushed(): readonly RefusalLedgerEntry[] {
    return [...this.pending.values(), ...this.inFlight.values()].map((entry) => ({ ...entry }));
  }

  /**
   * Writes everything counted so far as one batched upsert. Never throws: on failure the counts go
   * back into the (still bounded) map and the next flush tries again.
   */
  public flush(): Promise<void> {
    if (this.flushing !== null) { return this.flushing; }
    if (this.pending.size === 0) { return Promise.resolve(); }
    this.inFlight = this.pending;
    this.pending = new Map();
    this.flushing = (async () => {
      const entries = [...this.inFlight.values()].sort((left, right) =>
        left.scopeKey < right.scopeKey ? -1 : left.scopeKey > right.scopeKey ? 1
          : left.windowStartedAtMs - right.windowStartedAtMs);
      const now = this.nowMs();
      try {
        await retryOnDeadlock(() => this.pool.execute<ResultSetHeader>(
          `INSERT INTO api_mutation_rate_limits (scope_key, window_started_at_ms, event_count, updated_at_ms)
           VALUES ${entries.map(() => "(?, ?, ?, ?)").join(", ")}
           ON DUPLICATE KEY UPDATE event_count = event_count + VALUES(event_count),
             updated_at_ms = VALUES(updated_at_ms)`,
          entries.flatMap((entry) => [entry.scopeKey, entry.windowStartedAtMs, entry.count, now]),
        ));
      } catch (error) {
        this.observer?.ledgerFailed?.(error instanceof Error ? error.name : "UnknownError");
        for (const entry of entries) {
          this.add(entry.scopeKey, entry.windowStartedAtMs,
            entry.scopeKey.endsWith(`|${REFUSAL_LEDGER_TOTAL_SUBJECT}`)
              ? `${REFUSAL_LEDGER_PREFIX}${REFUSAL_LEDGER_OVERFLOW}|${REFUSAL_LEDGER_TOTAL_SUBJECT}`
              : `${REFUSAL_LEDGER_PREFIX}${REFUSAL_LEDGER_OVERFLOW}|${REFUSAL_LEDGER_OVERFLOW}`,
            entry.count);
        }
      }
    })().finally(() => {
      this.inFlight = new Map();
      this.flushing = null;
    });
    return this.flushing;
  }

  /** The periodic flush; never keeps the process alive. The returned function stops it. */
  public startFlushTimer(intervalMs: number = REFUSAL_LEDGER_FLUSH_INTERVAL_MS): () => void {
    const timer = setInterval(() => { void this.flush(); }, intervalMs);
    timer.unref?.();
    return () => { clearInterval(timer); };
  }

  private add(scopeKey: string, windowStartedAtMs: number, overflowKey: string, count = 1): void {
    const key = `${scopeKey}@${String(windowStartedAtMs)}`;
    const existing = this.pending.get(key);
    if (existing !== undefined) { existing.count += count; return; }
    if (this.pending.size < this.maximumEntries) {
      this.pending.set(key, { scopeKey, windowStartedAtMs, count });
      return;
    }
    // Full: counted under the overflow key of the same window. Overflow keys are few (two per
    // window), so they are allowed past the bound.
    const overflow = `${overflowKey}@${String(windowStartedAtMs)}`;
    const held = this.pending.get(overflow);
    if (held !== undefined) { held.count += count; return; }
    this.pending.set(overflow, { scopeKey: overflowKey, windowStartedAtMs, count });
  }
}

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
