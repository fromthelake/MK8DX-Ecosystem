import type { Pool, RowDataPacket } from "mysql2/promise";

import {
  FINISH_POSITIONS,
  rankStanding,
  type TournamentRivalry,
  type TournamentSharedRaces,
  type TournamentStandingEntry,
  type TournamentStandingRepository,
} from "./tournament-standing-service.js";
import { CORRECTED_HISTORY_PLACEMENTS } from
  "../tournament-history/corrected-history-sql.js";

// Every figure here comes from the current revision of a race that belongs to a
// **finalized** tournament and counts toward standings. A night in progress is
// deliberately invisible: it would move everybody's averages between races, and
// the rating it will eventually produce does not exist yet either.

class TournamentStandingPersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TournamentStandingPersistenceError";
  }
}

interface StandingRow extends RowDataPacket {
  playerId: unknown;
  username: unknown;
  displayName: unknown;
  mu: unknown;
  sigma: unknown;
  tournaments: unknown;
  races: unknown;
  wins: unknown;
  podiums: unknown;
  points: unknown;
  finishPositionTotal: unknown;
  lastRaceAtMs: unknown;
}

interface SharedRow extends RowDataPacket {
  playerId: unknown;
  races: unknown;
  wins: unknown;
  podiums: unknown;
  points: unknown;
  finishPositionTotal: unknown;
}

interface RivalryRow extends RowDataPacket {
  playerId: unknown;
  username: unknown;
  displayName: unknown;
  sharedRaces: unknown;
  ahead: unknown;
  behind: unknown;
  pointsDelta: unknown;
}

function whole(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TournamentStandingPersistenceError(`${field} is invalid`);
  }
  return parsed;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TournamentStandingPersistenceError(`${field} is invalid`);
  }
  return value;
}

/**
 * Every race placement this standing counts, from both eras, in one shape.
 *
 * A completed Tournament is a completed Tournament whichever system recorded
 * it. The community's own history - TN4 to TN12, 865 races - lives in the
 * imported legacy tables, and events run since the migration land in the
 * canonical ones. Counting only the canonical side made the ranking describe
 * whatever happened to be finalized there, which for a long time was nothing
 * real at all.
 *
 * The two sources differ in three ways, all handled here so the callers stay
 * ignorant of the split:
 *
 * - legacy races carry no per-placement points, so the MK8DX race table is
 *   applied, exactly as the existing legacy standings endpoint does;
 * - the tournament and race identifiers are namespaced, because a legacy
 *   tournament number and a canonical tournament id would otherwise collide
 *   in `COUNT(DISTINCT ...)` and in the head-to-head join;
 * - legacy races carry no timestamp, so their `occurred_at_ms` is NULL and a
 *   Player with only legacy races simply reports no last race, rather than a
 *   fabricated one.
 */
const COUNTED_PLACEMENTS = `
  SELECT canonicalPlacement.player_id AS player_id,
         canonicalPlacement.finish_position AS finish_position,
         CAST(canonicalPlacement.race_points AS SIGNED) AS race_points,
         CONCAT('canonical:', tournament.tournament_id) AS tournament_key,
         CONCAT('canonical:', revision.tournament_race_result_id) AS race_key,
         COALESCE(revision.occurred_at_ms, revision.captured_at_ms,
                  revision.created_at_ms) AS occurred_at_ms
    FROM tournament_race_placements AS canonicalPlacement
    INNER JOIN tournament_race_result_revisions AS revision
      ON revision.tournament_race_result_revision_id =
         canonicalPlacement.tournament_race_result_revision_id
     AND revision.counts_toward_standings = 1
     AND revision.revision_number = (
       SELECT MAX(latest.revision_number)
       FROM tournament_race_result_revisions AS latest
       WHERE latest.tournament_race_result_id = revision.tournament_race_result_id
     )
    INNER JOIN tournament_group_races AS groupRace
      ON groupRace.tournament_race_result_id = revision.tournament_race_result_id
    INNER JOIN tournament_groups AS tournamentGroup
      ON tournamentGroup.tournament_group_id = groupRace.tournament_group_id
    INNER JOIN tournaments AS tournament
      ON tournament.tournament_id = tournamentGroup.tournament_id
     AND tournament.stage = 'finalized'
     -- Removal hides a Tournament and can be undone, so the ranking has to
     -- honour it: a retracted Tournament stops counting the moment it is
     -- removed and counts again if it is restored.
     AND tournament.lifecycle_status = 'active'
  UNION ALL
  ${CORRECTED_HISTORY_PLACEMENTS}`;

const PUBLIC_PLAYER = `
  INNER JOIN players AS player
    ON player.player_id = placement.player_id
   AND player.player_kind = 'human'
   AND player.record_status = 'active'
   AND player.visibility = 'public'
  INNER JOIN player_username_history AS username
    ON username.player_id = player.player_id
   AND username.released_at_ms IS NULL`;

const finishColumns = Array.from(
  { length: FINISH_POSITIONS },
  (_unused, index) =>
    `COALESCE(SUM(placement.finish_position = ${index + 1}), 0) AS finish${index + 1}`,
).join(",\n              ");

export class MysqlTournamentStandingRepository
implements TournamentStandingRepository {
  public constructor(private readonly pool: Pool) {}

  public async listStanding(
    limit: number,
  ): Promise<readonly TournamentStandingEntry[]> {
    const bounded = Math.min(Math.max(1, Math.trunc(limit)), 200);
    const [rows] = await this.pool.query<StandingRow[]>(
      `SELECT player.public_id AS playerId,
              username.username_value AS username,
              player.display_name AS displayName,
              rating.mu AS mu,
              rating.sigma AS sigma,
              COUNT(DISTINCT placement.tournament_key) AS tournaments,
              COUNT(*) AS races,
              COALESCE(SUM(placement.finish_position = 1), 0) AS wins,
              COALESCE(SUM(placement.finish_position <= 3), 0) AS podiums,
              COALESCE(SUM(placement.race_points), 0) AS points,
              COALESCE(SUM(placement.finish_position), 0) AS finishPositionTotal,
              -- Legacy placements carry no date, and every Tournament so far
              -- is legacy, so this was always NULL and the field never
              -- reached a reader. The rating events do have dates, and the
              -- inactivity rule measures an absence from exactly that: the
              -- last race that moved somebody's rating.
              COALESCE(MAX(placement.occurred_at_ms), rated.lastRatedAtMs)
                AS lastRaceAtMs,
              ${finishColumns}
       FROM (${COUNTED_PLACEMENTS}) AS placement
       ${PUBLIC_PLAYER}
       LEFT JOIN player_ratings AS rating ON rating.player_id = player.player_id
       -- The current epoch only. Epochs 0-2 were written by the seed import
       -- and the legacy replay and carry the date those ran, not the date a
       -- race was held; taking the maximum across all of them made everybody
       -- look like they raced in August.
       LEFT JOIN (SELECT player_id, MAX(occurred_at_ms) AS lastRatedAtMs
                    FROM player_rating_events
                   WHERE rating_epoch = (SELECT MAX(rating_epoch)
                                           FROM player_rating_events)
                   GROUP BY player_id) AS rated
              ON rated.player_id = player.player_id
       GROUP BY player.player_id, player.public_id, username.username_value,
                player.display_name, rating.mu, rating.sigma,
                rated.lastRatedAtMs
       LIMIT ${bounded}`,
    );
    return rankStanding(rows.map((row) => {
      const mu = row.mu === null ? null : Number(row.mu);
      const sigma = row.sigma === null ? null : Number(row.sigma);
      const rated = mu !== null && sigma !== null &&
        Number.isFinite(mu) && Number.isFinite(sigma) && sigma > 0;
      const lastRaceAtMs = Number(row.lastRaceAtMs);
      const finishes: number[] = [];
      for (let position = 1; position <= FINISH_POSITIONS; position += 1) {
        finishes.push(whole(
          (row as unknown as Record<string, unknown>)[`finish${position}`],
          `finish${position}`,
        ));
      }
      return {
        playerId: text(row.playerId, "playerId"),
        username: text(row.username, "username"),
        displayName: text(row.displayName, "displayName"),
        ...(rated ? { score: mu - 3 * sigma } : {}),
        tournaments: whole(row.tournaments, "tournaments"),
        races: whole(row.races, "races"),
        wins: whole(row.wins, "wins"),
        podiums: whole(row.podiums, "podiums"),
        points: whole(row.points, "points"),
        finishPositionTotal: whole(row.finishPositionTotal, "finishPositionTotal"),
        finishes,
        ...(Number.isSafeInteger(lastRaceAtMs) && lastRaceAtMs > 0
          ? { lastRaceAtMs }
          : {}),
      };
    }));
  }

  public async listRivalries(
    playerId: string,
    limit: number,
  ): Promise<readonly TournamentRivalry[]> {
    const bounded = Math.min(Math.max(1, Math.trunc(limit)), 50);
    const [rows] = await this.pool.query<RivalryRow[]>(
      `SELECT opponentPlayer.public_id AS playerId,
              opponentName.username_value AS username,
              opponentPlayer.display_name AS displayName,
              COUNT(*) AS sharedRaces,
              COALESCE(SUM(placement.finish_position < opponent.finish_position), 0) AS ahead,
              COALESCE(SUM(placement.finish_position > opponent.finish_position), 0) AS behind,
              -- The counted-placement view already casts race_points to a
              -- signed value, because the canonical column is unsigned and
              -- losing a race underflows otherwise.
              COALESCE(SUM(placement.race_points - opponent.race_points), 0)
                AS pointsDelta
       FROM (${COUNTED_PLACEMENTS}) AS placement
       ${PUBLIC_PLAYER}
       INNER JOIN (${COUNTED_PLACEMENTS}) AS opponent
         ON opponent.race_key = placement.race_key
        AND opponent.player_id <> placement.player_id
       INNER JOIN players AS opponentPlayer
         ON opponentPlayer.player_id = opponent.player_id
        AND opponentPlayer.player_kind = 'human'
        AND opponentPlayer.record_status = 'active'
        AND opponentPlayer.visibility = 'public'
       INNER JOIN player_username_history AS opponentName
         ON opponentName.player_id = opponentPlayer.player_id
        AND opponentName.released_at_ms IS NULL
       WHERE player.public_id = ?
       GROUP BY opponentPlayer.player_id, opponentPlayer.public_id,
                opponentName.username_value, opponentPlayer.display_name
       ORDER BY sharedRaces DESC, opponentName.username_value ASC
       LIMIT ${bounded}`,
      [playerId],
    );
    return rows.map((row) => {
      const sharedRaces = whole(row.sharedRaces, "sharedRaces");
      const ahead = whole(row.ahead, "ahead");
      const behind = whole(row.behind, "behind");
      const pointsDelta = Number(row.pointsDelta);
      if (!Number.isFinite(pointsDelta) || ahead + behind > sharedRaces) {
        throw new TournamentStandingPersistenceError("rivalry row is invalid");
      }
      return {
        playerId: text(row.playerId, "playerId"),
        username: text(row.username, "username"),
        displayName: text(row.displayName, "displayName"),
        sharedRaces,
        ahead,
        behind,
        tied: sharedRaces - ahead - behind,
        averagePointsDelta: sharedRaces === 0 ? 0 : pointsDelta / sharedRaces,
      };
    });
  }

  public async listSharedRaces(
    playerIds: readonly string[],
  ): Promise<TournamentSharedRaces> {
    const marks = playerIds.map(() => "?").join(", ");
    // `together` is the set of races every requested Player finished: a race
    // qualifies only when all of them appear in it. Every figure below is
    // counted over that set alone.
    const [rows] = await this.pool.query<SharedRow[]>(
      `SELECT player.public_id AS playerId,
              COUNT(*) AS races,
              COALESCE(SUM(placement.finish_position = 1), 0) AS wins,
              COALESCE(SUM(placement.finish_position <= 3), 0) AS podiums,
              COALESCE(SUM(placement.race_points), 0) AS points,
              COALESCE(SUM(placement.finish_position), 0) AS finishPositionTotal,
              ${finishColumns}
       FROM (${COUNTED_PLACEMENTS}) AS placement
       ${PUBLIC_PLAYER}
       INNER JOIN (
         SELECT member.race_key
         FROM (${COUNTED_PLACEMENTS}) AS member
         INNER JOIN players AS memberPlayer
           ON memberPlayer.player_id = member.player_id
          AND memberPlayer.player_kind = 'human'
          AND memberPlayer.record_status = 'active'
          AND memberPlayer.visibility = 'public'
         WHERE memberPlayer.public_id IN (${marks})
         GROUP BY member.race_key
         HAVING COUNT(DISTINCT member.player_id) = ?
       ) AS together
         ON together.race_key = placement.race_key
       WHERE player.public_id IN (${marks})
       GROUP BY player.player_id, player.public_id`,
      [...playerIds, playerIds.length, ...playerIds],
    );
    const entries = rows.map((row) => {
      const finishes: number[] = [];
      for (let position = 1; position <= FINISH_POSITIONS; position += 1) {
        finishes.push(whole(
          (row as unknown as Record<string, unknown>)[`finish${position}`],
          `finish${position}`,
        ));
      }
      return {
        playerId: text(row.playerId, "playerId"),
        races: whole(row.races, "races"),
        wins: whole(row.wins, "wins"),
        podiums: whole(row.podiums, "podiums"),
        points: whole(row.points, "points"),
        finishPositionTotal: whole(row.finishPositionTotal, "finishPositionTotal"),
        finishes,
      };
    });
    // Every Player in the set finished each shared race exactly once, so any
    // one of them carries the count; disagreeing counts mean a broken join.
    const counts = new Set(entries.map((row) => row.races));
    if (counts.size > 1) {
      throw new TournamentStandingPersistenceError("shared race counts disagree");
    }
    return {
      sharedRaces: entries.length === playerIds.length ? (entries[0]?.races ?? 0) : 0,
      entries: entries.length === playerIds.length ? entries : [],
    };
  }
}
