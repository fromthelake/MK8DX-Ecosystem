import { createHash } from "node:crypto";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { NATIVE_EMAIL_CODE_ATTEMPTS, type NativeEmailAttemptLimiter } from "./native-email-approval.js";

interface CountRow extends RowDataPacket { eventCount: unknown; }

/** One atomic counter per device challenge, shared by every API process. */
export class MysqlNativeEmailAttemptLimiter implements NativeEmailAttemptLimiter {
  public constructor(
    private readonly pool: Pick<Pool, "execute">,
    private readonly nowMs: () => number = Date.now,
  ) {}

  public async consume(deviceCodeId: string): Promise<boolean> {
    if (typeof deviceCodeId !== "string" || deviceCodeId.length === 0 || deviceCodeId.length > 200) {
      throw new Error("invalid native device challenge");
    }
    // The device ID is never stored in the rate-limit table or emitted in logs.
    const digest = createHash("sha256").update(deviceCodeId, "utf8").digest("hex");
    const key = `native-email-code.${digest}`;
    const now = this.nowMs();
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO api_mutation_rate_limits (scope_key, window_started_at_ms, event_count, updated_at_ms)
       VALUES (?, 0, 1, ?)
       ON DUPLICATE KEY UPDATE event_count = event_count + 1, updated_at_ms = VALUES(updated_at_ms)`,
      [key, now],
    );
    const [rows] = await this.pool.execute<CountRow[]>(
      `SELECT event_count AS eventCount FROM api_mutation_rate_limits
       WHERE scope_key = ? AND window_started_at_ms = 0 LIMIT 1`,
      [key],
    );
    const count = Number(rows[0]?.eventCount);
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new Error("native device attempt counter unavailable");
    }
    return count <= NATIVE_EMAIL_CODE_ATTEMPTS;
  }
}
