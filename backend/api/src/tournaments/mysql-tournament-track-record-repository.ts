import type { Pool, RowDataPacket } from "mysql2/promise";

import { CONSOLE_NIGHT_PLACEMENTS } from "./console-night-placements.js";
import type {
  TournamentTrackRecordRepository,
  TournamentTrackRow,
} from "./tournament-track-record-service.js";

// Reads the corrected tournament history (0057), not the legacy tables: only
// the corrected history knows which track a race was run on, and only it holds
// the races the legacy record never had.
//
// Races that do not count toward the rating are still counted here. They were
// really raced, and a player asking where they are strong wants their whole
// record - the exclusion is about not letting a connection error move a
// rating, not about pretending the race did not happen.

class TournamentTrackRecordPersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TournamentTrackRecordPersistenceError";
  }
}

interface TrackRow extends RowDataPacket {
  trackId: unknown;
  finishPosition: unknown;
  fieldSize: unknown;
  racePoints: unknown;
  heldAtMs: unknown;
}

function integer(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TournamentTrackRecordPersistenceError(
      `${field} is not a number`);
  }
  return parsed;
}

export class MysqlTournamentTrackRecordRepository
implements TournamentTrackRecordRepository {
  readonly #pool: Pool;

  public constructor(pool: Pool) {
    this.#pool = pool;
  }

  public async listPlayerTrackRows(
    playerId: string,
  ): Promise<readonly TournamentTrackRow[]> {
    // The imported history (TN4-TN12) and the nights the console ran itself
    // (TN13 onward), in the order they were raced. Reading the history alone
    // left the card at TN12 while the ranking above it already counted TN13
    // (owner, 2026-09-17).
    const [rows] = await this.#pool.execute<TrackRow[]>(
      `SELECT trackId, finishPosition, fieldSize, racePoints, heldAtMs
       FROM (
         SELECT race.track_id AS trackId,
                placement.finish_position AS finishPosition,
                field.size AS fieldSize,
                placement.race_points AS racePoints,
                event.held_at_ms AS heldAtMs,
                race.race_sequence AS raceOrder
         FROM tournament_history_placements AS placement
         JOIN players AS player
           ON player.player_id = placement.player_id
         JOIN tournament_history_races AS race
           ON race.tournament_history_race_id
              = placement.tournament_history_race_id
         JOIN tournament_history_sections AS section
           ON section.tournament_history_section_id
              = race.tournament_history_section_id
         JOIN legacy_tournament_events AS event
           ON event.tournament_number = section.tournament_number
         JOIN (
           SELECT tournament_history_race_id, COUNT(*) AS size
           FROM tournament_history_placements
           GROUP BY tournament_history_race_id
         ) AS field
           ON field.tournament_history_race_id
              = placement.tournament_history_race_id
         WHERE player.public_id = ?
         UNION ALL
         SELECT night.track_id AS trackId,
                night.finish_position AS finishPosition,
                night.field_size AS fieldSize,
                night.race_points AS racePoints,
                night.held_at_ms AS heldAtMs,
                0 AS raceOrder
         FROM (${CONSOLE_NIGHT_PLACEMENTS}) AS night
         JOIN players AS player
           ON player.player_id = night.player_id
         WHERE player.public_id = ?
       ) AS raced
       ORDER BY heldAtMs, raceOrder`,
      [playerId, playerId],
    );
    return rows.map((row) => ({
      trackId: row.trackId === null ? null : String(row.trackId),
      modeCc: null,
      finishPosition: integer(row.finishPosition, "finishPosition"),
      fieldSize: integer(row.fieldSize, "fieldSize"),
      racePoints: row.racePoints === null
        ? null : integer(row.racePoints, "racePoints"),
      heldAtMs: integer(row.heldAtMs, "heldAtMs"),
    }));
  }
}
