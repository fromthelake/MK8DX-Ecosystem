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

interface CountRow extends RowDataPacket { eventCount: unknown; }

export class MysqlMutationRateLimiter implements MutationRateLimiter {
  private lastCleanupAtMs = 0;

  public constructor(
    private readonly pool: Pick<Pool, "execute">,
    private readonly nowMs: () => number = Date.now,
  ) {}

  public async consume(subject: string, scope: string, windowSeconds: number, maximum: number): Promise<void> {
    if (!/^[A-Za-z0-9._-]{1,141}$/.test(subject) || !/^[a-z0-9._-]{1,48}$/.test(scope) ||
        !Number.isSafeInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 86_400 ||
        !Number.isSafeInteger(maximum) || maximum < 1 || maximum > 10_000) {
      throw new Error("invalid mutation rate-limit policy");
    }
    const now = this.nowMs();
    const windowMs = windowSeconds * 1_000;
    const started = Math.floor(now / windowMs) * windowMs;
    const key = `${scope}|${subject}`;
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO api_mutation_rate_limits (scope_key, window_started_at_ms, event_count, updated_at_ms)
       VALUES (?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE event_count = event_count + 1, updated_at_ms = VALUES(updated_at_ms)`,
      [key, started, now],
    );
    const [rows] = await this.pool.execute<CountRow[]>(
      `SELECT event_count AS eventCount FROM api_mutation_rate_limits
       WHERE scope_key = ? AND window_started_at_ms = ? LIMIT 1`,
      [key, started],
    );
    const count = Number(rows[0]?.eventCount);
    if (now - this.lastCleanupAtMs >= 3_600_000) {
      this.lastCleanupAtMs = now;
      await this.pool.execute<ResultSetHeader>(
        `DELETE FROM api_mutation_rate_limits WHERE updated_at_ms < ?`,
        [Math.max(0, now - 172_800_000)],
      ).catch(() => undefined);
    }
    if (!Number.isSafeInteger(count) || count > maximum) {
      throw new MutationRateLimitExceeded(Math.max(1, Math.ceil((started + windowMs - now) / 1_000)));
    }
  }
}
