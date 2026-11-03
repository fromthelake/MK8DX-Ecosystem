import type { Pool, RowDataPacket } from "mysql2/promise";

// A time more than 12 % faster than the current World Record is not a real run (owner 2026-09-28:
// "any one that all of sudden tries to put in times which are more than -12% of the WR is absolutely
// not possible ... I want to avoid people spamming BS records in"). Every way a time reaches the
// canonical store — a submission or revision from any client, and an owner/administrator correction —
// is refused with the one message below. The World Record is the daily mkwrs snapshot
// (`world_records`, migration 0036); a track without one is not checked.

export const IMPLAUSIBLE_TIME_CODE = "time_trial_time_implausible";
export const IMPLAUSIBLE_TIME_MESSAGE =
  "The proposed time is highly unreasonable, please double check all information.";
/** How much faster than the World Record a time may be before it is refused. */
export const WORLD_RECORD_MARGIN_PERCENT = 12;

export interface WorldRecordTimes {
  timeMs(trackId: string, modeCc: 150 | 200): Promise<number | null>;
}

/** True when `totalTimeMs` beats the World Record by more than the margin. Integer arithmetic only. */
export function isImplausiblyFast(totalTimeMs: number, worldRecordMs: number | null): boolean {
  return worldRecordMs !== null && worldRecordMs > 0 &&
    totalTimeMs * 100 < worldRecordMs * (100 - WORLD_RECORD_MARGIN_PERCENT);
}

export class MysqlWorldRecordTimes implements WorldRecordTimes {
  public constructor(private readonly pool: Pool) {}

  public async timeMs(trackId: string, modeCc: 150 | 200): Promise<number | null> {
    const [rows] = await this.pool.execute<(RowDataPacket & { totalTimeMs: unknown })[]>(
      "SELECT total_time_ms AS totalTimeMs FROM world_records WHERE mode_cc = ? AND track_id = ? LIMIT 1",
      [modeCc, trackId],
    );
    const value = Number(rows[0]?.totalTimeMs);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
}
