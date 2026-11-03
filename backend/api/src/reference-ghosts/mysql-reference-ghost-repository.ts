import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

import {
  ReferenceGhostReadingError,
  mergeReading,
  type PublishedReferenceGhostReading,
  type ReadingOutcome,
  type ReferenceGhostEvents,
  type ReferenceGhostLoadout,
  type ReferenceGhostReading,
  type ReferenceGhostReadingRepository,
  type ReferenceKind,
  type StoredReferenceGhostReading,
} from "./reference-ghost-readings.js";

interface ReadingRow extends RowDataPacket {
  kind: string; mode: number | string; trackId: string; totalTimeMs: number | string;
  observedName: string; countryId: string | null;
  characterId: string | null; bodyId: string | null; tireId: string | null; gliderId: string | null;
  lapTimes: unknown; coins: unknown; mushrooms: unknown; events: unknown;
  source: string; confirmations: number | string; conflicts: number | string; updatedAtMs: number | string;
}

const COLUMNS = `reference_kind AS kind, mode_cc AS mode, track_id AS trackId, total_time_ms AS totalTimeMs,
  observed_name AS observedName, country_id AS countryId,
  character_id AS characterId, body_id AS bodyId, tire_id AS tireId, glider_id AS gliderId,
  lap_times_json AS lapTimes, coins_per_lap_json AS coins, mushrooms_per_lap_json AS mushrooms,
  events_json AS events, reading_source AS source,
  confirmation_count AS confirmations, conflict_count AS conflicts, updated_at_ms AS updatedAtMs`;

// MySQL returns a JSON column parsed, MariaDB (the host) as text.
function json<T>(value: unknown): T | null {
  if (value === null || value === undefined) { return null; }
  if (typeof value === "string") { return JSON.parse(value) as T; }
  if (Buffer.isBuffer(value)) { return JSON.parse(value.toString("utf8")) as T; }
  return value as T;
}

function loadoutOf(row: ReadingRow): ReferenceGhostLoadout | null {
  return row.characterId === null || row.bodyId === null || row.tireId === null || row.gliderId === null
    ? null
    : { characterId: row.characterId, bodyId: row.bodyId, tireId: row.tireId, gliderId: row.gliderId };
}

function stored(row: ReadingRow): StoredReferenceGhostReading {
  return {
    lapTimesMs: json<number[]>(row.lapTimes) ?? [],
    coinsPerLap: json<number[]>(row.coins),
    mushroomsPerLap: json<number[]>(row.mushrooms),
    events: json<ReferenceGhostEvents>(row.events),
    loadout: loadoutOf(row),
    countryId: row.countryId,
  };
}

function published(row: ReadingRow): PublishedReferenceGhostReading {
  const reading = stored(row);
  return {
    kind: row.kind as ReferenceKind,
    trackId: row.trackId,
    mode: Number(row.mode) === 200 ? 200 : 150,
    totalTimeMs: Number(row.totalTimeMs),
    observedName: row.observedName,
    countryId: reading.countryId,
    loadout: reading.loadout,
    lapTimesMs: reading.lapTimesMs,
    coinsPerLap: reading.coinsPerLap,
    mushroomsPerLap: reading.mushroomsPerLap,
    events: reading.events,
    source: row.source === "ghost_replay" ? "ghost_replay" : "ghost_panel",
    confirmations: Number(row.confirmations),
    conflicts: Number(row.conflicts),
    updatedAtMs: Number(row.updatedAtMs),
  };
}

const text = (value: unknown): string | null => value === null ? null : JSON.stringify(value);

export class MysqlReferenceGhostReadingRepository implements ReferenceGhostReadingRepository {
  public constructor(private readonly pool: Pool) {}

  public async record(reading: ReferenceGhostReading, userAccountId: string, nowMs: number): Promise<ReadingOutcome> {
    try {
      return await this.recordOnce(reading, userAccountId, nowMs);
    } catch (error) {
      // Two first readings of the same ghost at once: the loser reads the winner's row and merges.
      if ((error as { code?: unknown }).code !== "ER_DUP_ENTRY") { throw error; }
      return this.recordOnce(reading, userAccountId, nowMs);
    }
  }

  private async recordOnce(reading: ReferenceGhostReading, userAccountId: string, nowMs: number): Promise<ReadingOutcome> {
    return this.transaction(async (connection) => {
      const [accounts] = await connection.execute<RowDataPacket[]>(
        "SELECT user_account_id AS id FROM user_accounts WHERE public_id = ? LIMIT 1", [userAccountId]);
      const accountId = accounts[0]?.["id"];
      if (accountId === undefined) {
        throw new ReferenceGhostReadingError("not_authenticated", "Authentication is required.");
      }
      const key = [reading.kind, reading.mode, reading.trackId, reading.totalTimeMs];
      const [rows] = await connection.execute<ReadingRow[]>(
        `SELECT ${COLUMNS} FROM reference_ghost_readings
          WHERE reference_kind = ? AND mode_cc = ? AND track_id = ? AND total_time_ms = ? FOR UPDATE`, key);
      const current = rows[0] === undefined ? null : stored(rows[0]);
      const { outcome, next } = mergeReading(current, reading);
      if (outcome === "conflict") {
        await connection.execute(
          `UPDATE reference_ghost_readings
              SET conflict_count = conflict_count + 1, last_conflict_json = ?, last_conflict_at_ms = ?
            WHERE reference_kind = ? AND mode_cc = ? AND track_id = ? AND total_time_ms = ?`,
          [JSON.stringify(reading), nowMs, ...key]);
        return outcome;
      }
      const value = next!;
      const parts = value.loadout;
      if (current === null) {
        await connection.execute(
          `INSERT INTO reference_ghost_readings (
             reference_kind, mode_cc, track_id, total_time_ms, observed_name, country_id,
             character_id, body_id, tire_id, glider_id,
             lap_times_json, coins_per_lap_json, mushrooms_per_lap_json, events_json, reading_source,
             first_user_account_id, first_read_at_ms, updated_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [...key, reading.observedName, value.countryId,
            parts?.characterId ?? null, parts?.bodyId ?? null, parts?.tireId ?? null, parts?.gliderId ?? null,
            JSON.stringify(value.lapTimesMs), text(value.coinsPerLap), text(value.mushroomsPerLap), text(value.events),
            reading.source, accountId, nowMs, nowMs]);
        return outcome;
      }
      await connection.execute(
        `UPDATE reference_ghost_readings
            SET country_id = ?, character_id = ?, body_id = ?, tire_id = ?, glider_id = ?,
                coins_per_lap_json = ?, mushrooms_per_lap_json = ?, events_json = ?,
                reading_source = ?, confirmation_count = confirmation_count + 1, updated_at_ms = ?
          WHERE reference_kind = ? AND mode_cc = ? AND track_id = ? AND total_time_ms = ?`,
        [value.countryId, parts?.characterId ?? null, parts?.bodyId ?? null, parts?.tireId ?? null, parts?.gliderId ?? null,
          text(value.coinsPerLap), text(value.mushroomsPerLap), text(value.events),
          value.coinsPerLap === null ? "ghost_panel" : "ghost_replay", nowMs, ...key]);
      return outcome;
    });
  }

  public async list(filter: Readonly<{ trackId?: string; mode?: 150 | 200 }>): Promise<readonly PublishedReferenceGhostReading[]> {
    const where: string[] = [];
    const values: (string | number)[] = [];
    if (filter.trackId !== undefined) { where.push("track_id = ?"); values.push(filter.trackId); }
    if (filter.mode !== undefined) { where.push("mode_cc = ?"); values.push(filter.mode); }
    const [rows] = await this.pool.execute<ReadingRow[]>(
      `SELECT ${COLUMNS} FROM reference_ghost_readings
        ${where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`}
        ORDER BY mode_cc, track_id, reference_kind, total_time_ms`, values);
    return rows.map(published);
  }

  private async transaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
