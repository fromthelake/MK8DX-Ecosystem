import type { RowDataPacket } from "mysql2";

import type { PreparedQueryExecutor } from
  "../identity/mysql-identity-read-repository.js";
import type {
  PublicTimeTrialLap,
  PublicTimeTrialLoadout,
  PublicTimeTrialRepository,
  PublicTimeTrialResult,
  PublicTimeTrialStanding,
  PublicTrackBest,
} from "./public-time-trial-service.js";
import {
  TIME_TRIAL_SCOPE_TRACK_COUNT,
  timeTrialScopeSql,
  type TimeTrialTrackScope,
} from "./track-scope.js";

interface TrackBestRow extends RowDataPacket {
  trackId: unknown;
  mode: unknown;
  totalTimeMs: unknown;
}

interface StandingRow extends RowDataPacket {
  rankValue: unknown;
  playerId: unknown;
  playerDisplayName: unknown;
  mode: unknown;
  totalTimeMs: unknown;
  playedTracks: unknown;
  goldMedals: unknown;
  silverMedals: unknown;
  bronzeMedals: unknown;
}

interface ResultRow extends RowDataPacket {
  revisionInternalId: unknown;
  resultId: unknown;
  revision: unknown;
  playerId: unknown;
  playerUsername: unknown;
  playerDisplayName: unknown;
  countryId: unknown;
  trackId: unknown;
  mode: unknown;
  totalTimeMs: unknown;
  characterId: unknown;
  characterVariantId: unknown;
  bodyId: unknown;
  bodyVariantId: unknown;
  tireId: unknown;
  gliderId: unknown;
  gliderVariantId: unknown;
  sourceKind: unknown;
  correctedFieldsJson: unknown;
  resultAtMs: unknown;
  publishedAtMs: unknown;
  rankValue: unknown;
  videoId?: unknown;
}
interface LapRow extends RowDataPacket {
  revisionInternalId: unknown;
  lapNumber: unknown;
  timeMs: unknown;
  coinsCollected: unknown;
  mushroomsUsed: unknown;
}

import { youTubeWatchUrl } from "./youtube-video.js";

const resultIdPattern =/^user_submission\.time\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const trackIdPattern = /^track\.[a-z0-9]+(?:_[a-z0-9]+)*$/;
const assetIdPattern = /^[a-z_]+\.[a-z0-9_.]+$/;

export class PublicTimeTrialPersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PublicTimeTrialPersistenceError";
  }
}

function text(value: unknown, field: string, pattern?: RegExp): string {
  if (typeof value !== "string" || value.length === 0 ||
      (pattern !== undefined && !pattern.test(value))) {
    throw new PublicTimeTrialPersistenceError(`${field} is invalid`);
  }
  return value;
}

function optionalText(value: unknown, field: string, pattern: RegExp): string | undefined {
  return value === null ? undefined : text(value, field, pattern);
}

function integer(value: unknown, field: string, minimum = 0): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new PublicTimeTrialPersistenceError(`${field} is invalid`);
  }
  return parsed;
}

function correctionFields(value: unknown): readonly string[] | undefined {
  if (value === null) { return undefined; }
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch {
      throw new PublicTimeTrialPersistenceError("correctedFields is invalid");
    }
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 15 ||
      parsed.some((field) => typeof field !== "string" || field.length > 32)) {
    throw new PublicTimeTrialPersistenceError("correctedFields is invalid");
  }
  return parsed;
}

type PartialResult = Omit<PublicTimeTrialResult, "laps"> &
  Readonly<{ revisionInternalId: number }>;

function result(row: ResultRow): PartialResult {
  const mode = integer(row.mode, "mode");
  if (mode !== 150 && mode !== 200) {
    throw new PublicTimeTrialPersistenceError("mode is invalid");
  }
  const loadout: Record<string, string> = {};
  for (const [field, value] of [
    ["characterId", row.characterId],
    ["characterVariantId", row.characterVariantId],
    ["bodyId", row.bodyId],
    ["bodyVariantId", row.bodyVariantId],
    ["tireId", row.tireId],
    ["gliderId", row.gliderId],
    ["gliderVariantId", row.gliderVariantId],
  ] as const) {
    const parsed = optionalText(value, field, assetIdPattern);
    if (parsed !== undefined) { loadout[field] = parsed; }
  }
  const rank = row.rankValue === null ? undefined : integer(row.rankValue, "rank", 1);
  const correctedFields = correctionFields(row.correctedFieldsJson);
  return {
    revisionInternalId: integer(row.revisionInternalId, "revisionInternalId", 1),
    resultId: text(row.resultId, "resultId", resultIdPattern),
    revision: integer(row.revision, "revision", 1),
    playerId: text(row.playerId, "playerId", playerIdPattern),
    playerUsername: text(row.playerUsername, "playerUsername"),
    playerDisplayName: text(row.playerDisplayName, "playerDisplayName"),
    ...(typeof row.countryId === "string" && row.countryId.length > 0
      ? { countryId: text(row.countryId, "countryId") }
      : {}),
    trackId: text(row.trackId, "trackId", trackIdPattern),
    mode,
    totalTimeMs: integer(row.totalTimeMs, "totalTimeMs", 1),
    ...(Object.keys(loadout).length === 0
      ? {}
      : { loadout: loadout as PublicTimeTrialLoadout }),
    sourceKind: text(row.sourceKind, "sourceKind"),
    ...(correctedFields === undefined ? {} : { correctedFields }),
    resultAtMs: integer(row.resultAtMs, "resultAtMs"),
    publishedAtMs: integer(row.publishedAtMs, "publishedAtMs"),
    ...(rank === undefined ? {} : { rank }),
    ...(typeof row.videoId === "string" && /^[A-Za-z0-9_-]{11}$/.test(row.videoId)
      ? { videoUrl: youTubeWatchUrl(row.videoId) } : {}),
  };
}

function lap(row: LapRow): PublicTimeTrialLap & { revisionInternalId: number } {
  return {
    revisionInternalId: integer(row.revisionInternalId, "revisionInternalId", 1),
    lapNumber: integer(row.lapNumber, "lapNumber", 1),
    timeMs: integer(row.timeMs, "timeMs", 1),
    ...(row.coinsCollected === null
      ? {} : { coinsCollected: integer(row.coinsCollected, "coinsCollected") }),
    ...(row.mushroomsUsed === null
      ? {} : { mushroomsUsed: integer(row.mushroomsUsed, "mushroomsUsed") }),
  };
}

const projection = `SELECT revision.time_trial_submission_revision_id AS revisionInternalId,
       submission.public_id AS resultId, revision.revision_number AS revision,
       player.public_id AS playerId, username.username_value AS playerUsername,
       player.display_name AS playerDisplayName,
       player.country_id AS countryId, revision.track_id AS trackId,
       revision.mode_cc AS mode, revision.total_time_ms AS totalTimeMs,
       revision.character_id AS characterId,
       revision.character_variant_id AS characterVariantId,
       revision.body_id AS bodyId, revision.body_variant_id AS bodyVariantId,
       revision.tire_id AS tireId, revision.glider_id AS gliderId,
       revision.glider_variant_id AS gliderVariantId,
       revision.source_kind AS sourceKind,
       revision.corrected_fields_json AS correctedFieldsJson,
       COALESCE(revision.occurred_at_ms, revision.submitted_at_ms,
                revision.created_at_ms) AS resultAtMs,
       publication.published_at_ms AS publishedAtMs,
       (SELECT video.youtube_video_id FROM time_trial_videos AS video
         WHERE video.time_trial_submission_id = submission.time_trial_submission_id) AS videoId`;

export class MysqlPublicTimeTrialRepository implements PublicTimeTrialRepository {
  public constructor(private readonly executor: PreparedQueryExecutor) {}

  public async listPlayerResults(playerId: string): Promise<readonly PublicTimeTrialResult[]> {
    const [rows] = await this.executor.execute<ResultRow[]>(
      `${projection}, NULL AS rankValue
       FROM time_trial_publications AS publication
       INNER JOIN time_trial_submission_revisions AS revision
         ON revision.time_trial_submission_revision_id = publication.current_revision_id
        AND revision.time_trial_submission_id = publication.time_trial_submission_id
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = publication.time_trial_submission_id
       INNER JOIN players AS player ON player.player_id = revision.player_id
       INNER JOIN player_username_history AS username
         ON username.player_id = player.player_id AND username.released_at_ms IS NULL
       WHERE publication.publication_status = 'published'
         AND player.record_status = 'active' AND player.public_id = ?
       ORDER BY publication.published_at_ms DESC, submission.public_id ASC
       LIMIT 100`,
      [playerId],
    );
    return this.attachLaps(rows);
  }

  public async listRecentResults(): Promise<readonly PublicTimeTrialResult[]> {
    const [rows] = await this.executor.execute<ResultRow[]>(
      `${projection}, NULL AS rankValue
       FROM time_trial_publications AS publication
       INNER JOIN time_trial_submission_revisions AS revision
         ON revision.time_trial_submission_revision_id = publication.current_revision_id
        AND revision.time_trial_submission_id = publication.time_trial_submission_id
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = publication.time_trial_submission_id
       INNER JOIN players AS player ON player.player_id = revision.player_id
       INNER JOIN player_username_history AS username
         ON username.player_id = player.player_id AND username.released_at_ms IS NULL
       WHERE publication.publication_status = 'published'
         AND player.record_status = 'active'
       ORDER BY COALESCE(revision.occurred_at_ms, revision.submitted_at_ms,
                         revision.created_at_ms) DESC,
                publication.published_at_ms DESC, submission.public_id ASC
       LIMIT 20`,
    );
    return this.attachLaps(rows);
  }

  // Several players' bests in one answer. The page needs the signed-in
  // Player and every rival at the same moment, and the hosting layer only
  // serves five requests at a time before the rest wait about half a
  // second, so asking six times is the difference between fast and slow.
  public async listTrackBestsForPlayers(
    playerIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly PublicTrackBest[]>> {
    const result = new Map<string, readonly PublicTrackBest[]>();
    if (playerIds.length === 0) { return result; }
    const placeholders = playerIds.map(() => "?").join(", ");
    const [rows] = await this.executor.execute<TrackBestRow[]>(
      `SELECT player.public_id AS publicId,
              best.track_id AS trackId,
              best.mode_cc AS mode,
              best.total_time_ms AS totalTimeMs,
              1 + (
                SELECT COUNT(*)
                FROM time_trial_player_bests AS faster
                WHERE faster.track_id = best.track_id
                  AND faster.mode_cc = best.mode_cc
                  AND faster.public_eligible = 1
                  AND faster.total_time_ms < best.total_time_ms
              ) AS rank_position
       FROM players AS player
       STRAIGHT_JOIN time_trial_player_bests AS best
         ON best.player_id = player.player_id
       WHERE player.public_id IN (${placeholders})
         AND player.record_status = 'active'
         AND best.public_eligible = 1
       ORDER BY player.public_id ASC, best.track_id ASC, best.mode_cc ASC
       LIMIT 2000`,
      [...playerIds],
    );
    const grouped = new Map<string, PublicTrackBest[]>();
    for (const playerId of playerIds) { grouped.set(playerId, []); }
    for (const row of rows) {
      const record = row as unknown as Record<string, unknown>;
      const publicId = record["publicId"];
      const mode = Number(row.mode);
      const totalTimeMs = Number(row.totalTimeMs);
      const rank = Number(record["rank_position"]);
      if (typeof publicId !== "string" || typeof row.trackId !== "string" ||
        (mode !== 150 && mode !== 200) ||
        !Number.isSafeInteger(totalTimeMs) || totalTimeMs <= 0 ||
        !Number.isSafeInteger(rank) || rank <= 0) {
        throw new PublicTimeTrialPersistenceError("track best row is invalid");
      }
      grouped.get(publicId)?.push(
        { trackId: row.trackId, mode, totalTimeMs, rank },
      );
    }
    for (const [playerId, bests] of grouped) { result.set(playerId, bests); }
    return result;
  }

  public async listStandings(
    mode: 150 | 200,
    scope: TimeTrialTrackScope = "all",
  ): Promise<readonly PublicTimeTrialStanding[]> {
    const trackScope = timeTrialScopeSql(scope, "best.track_id");
    const trackCount = TIME_TRIAL_SCOPE_TRACK_COUNT[scope];
    const [rows] = await this.executor.execute<StandingRow[]>(
      `WITH track_ranks AS (
         SELECT player.player_id AS playerInternalId,
                player.public_id AS playerId,
                player.display_name AS playerDisplayName,
                best.track_id AS trackId,
                best.mode_cc AS mode,
                best.total_time_ms AS totalTimeMs,
                RANK() OVER (
                  PARTITION BY best.track_id, best.mode_cc
                  ORDER BY best.total_time_ms ASC
                ) AS trackRank
         FROM time_trial_player_bests AS best
         INNER JOIN players AS player ON player.player_id = best.player_id
         WHERE player.record_status = 'active'
           AND best.mode_cc = ?
           AND best.public_eligible = 1
           ${trackScope.clause}
       ), totals AS (
         SELECT playerInternalId, playerId, playerDisplayName, mode,
                SUM(totalTimeMs) + (${trackCount} - COUNT(*)) * 600000 AS totalTimeMs,
                COUNT(*) AS playedTracks,
                SUM(trackRank = 1) AS goldMedals,
                SUM(trackRank = 2) AS silverMedals,
                SUM(trackRank = 3) AS bronzeMedals
         FROM track_ranks
         GROUP BY playerInternalId, playerId, playerDisplayName, mode
       )
       SELECT RANK() OVER (
                PARTITION BY mode
                ORDER BY totalTimeMs ASC, playerInternalId ASC
              ) AS rankValue,
              playerId, playerDisplayName, mode, totalTimeMs, playedTracks,
              goldMedals, silverMedals, bronzeMedals
       FROM totals
       ORDER BY rankValue ASC, playerId ASC
       LIMIT 500`,
      [mode, ...trackScope.parameters],
    );
    return rows.map((row) => {
      const parsedMode = integer(row.mode, "mode");
      if (parsedMode !== 150 && parsedMode !== 200) {
        throw new PublicTimeTrialPersistenceError("standing mode is invalid");
      }
      const totalTimeMs = integer(row.totalTimeMs, "totalTimeMs", 1);
      return {
        rank: integer(row.rankValue, "rank", 1),
        playerId: text(row.playerId, "playerId", playerIdPattern),
        playerDisplayName: text(row.playerDisplayName, "playerDisplayName"),
        mode: parsedMode,
        totalTimeMs,
        averageTimeMs: Math.round(totalTimeMs / trackCount),
        playedTracks: integer(row.playedTracks, "playedTracks"),
        goldMedals: integer(row.goldMedals, "goldMedals"),
        silverMedals: integer(row.silverMedals, "silverMedals"),
        bronzeMedals: integer(row.bronzeMedals, "bronzeMedals"),
      };
    });
  }

  public async listPlayerTrackBests(
    playerId: string,
  ): Promise<readonly PublicTrackBest[]> {
    const [rows] = await this.executor.execute<TrackBestRow[]>(
      // Population, per-player best selection and ordering are the same as
      // listLeaderboard, so a position stated here is the position the
      // leaderboard shows. Only the final filter differs: one player's rows
      // instead of one combo's.
      `SELECT best.track_id AS trackId,
              best.mode_cc AS mode,
              best.total_time_ms AS totalTimeMs,
              1 + (
                SELECT COUNT(*)
                FROM time_trial_player_bests AS faster
                WHERE faster.track_id = best.track_id
                  AND faster.mode_cc = best.mode_cc
                  AND faster.public_eligible = 1
                  AND faster.total_time_ms < best.total_time_ms
              ) AS rank_position
       FROM players AS player
       STRAIGHT_JOIN time_trial_player_bests AS best
         ON best.player_id = player.player_id
       WHERE player.public_id = ? AND player.record_status = 'active'
         AND best.public_eligible = 1
       ORDER BY best.track_id ASC, best.mode_cc ASC
       LIMIT 200`,
      [playerId],
    );
    return rows.map((row) => {
      const mode = Number(row.mode);
      const totalTimeMs = Number(row.totalTimeMs);
      const rank = Number((row as unknown as
        Record<string, unknown>)["rank_position"]);
      if (typeof row.trackId !== "string" ||
        (mode !== 150 && mode !== 200) ||
        !Number.isSafeInteger(totalTimeMs) || totalTimeMs <= 0 ||
        !Number.isSafeInteger(rank) || rank <= 0) {
        throw new PublicTimeTrialPersistenceError("track best row is invalid");
      }
      return { trackId: row.trackId, mode, totalTimeMs, rank };
    });
  }

  public async listLeaderboard(
    trackId: string,
    mode: 150 | 200,
  ): Promise<readonly PublicTimeTrialResult[]> {
    const [rows] = await this.executor.execute<ResultRow[]>(
      `WITH ranked AS (
         ${projection},
         RANK() OVER (ORDER BY best.total_time_ms ASC) AS rankValue
         FROM time_trial_player_bests AS best
         STRAIGHT_JOIN time_trial_publications AS publication
           ON publication.time_trial_publication_id =
              best.time_trial_publication_id
         STRAIGHT_JOIN time_trial_submission_revisions AS revision
           ON revision.time_trial_submission_revision_id =
              best.time_trial_submission_revision_id
         STRAIGHT_JOIN time_trial_submissions AS submission
           ON submission.time_trial_submission_id = publication.time_trial_submission_id
         STRAIGHT_JOIN players AS player ON player.player_id = best.player_id
         STRAIGHT_JOIN player_username_history AS username
           ON username.player_id = player.player_id AND username.released_at_ms IS NULL
         WHERE player.record_status = 'active'
           AND best.public_eligible = 1
           AND best.track_id = ? AND best.mode_cc = ?
       )
       SELECT * FROM ranked ORDER BY rankValue ASC, playerId ASC LIMIT 100`,
      [trackId, mode],
    );
    return this.attachLaps(rows);
  }

  /**
   * ADR-0225 amendment: each named Player's best published run per track and class, with laps and
   * kart setup, for a signed-in Player's offline copy of their rivals. The same public bests the
   * leaderboards rank (public_eligible), so a private Player's or a withheld run never appears.
   */
  public async listBestResultsForPlayers(
    playerIds: readonly string[],
  ): Promise<readonly PublicTimeTrialResult[]> {
    if (playerIds.length === 0) { return []; }
    const placeholders = playerIds.map(() => "?").join(", ");
    const [rows] = await this.executor.execute<ResultRow[]>(
      `${projection}, NULL AS rankValue
       FROM players AS player
       STRAIGHT_JOIN time_trial_player_bests AS best ON best.player_id = player.player_id
       STRAIGHT_JOIN time_trial_publications AS publication
         ON publication.time_trial_publication_id = best.time_trial_publication_id
       STRAIGHT_JOIN time_trial_submission_revisions AS revision
         ON revision.time_trial_submission_revision_id = best.time_trial_submission_revision_id
       STRAIGHT_JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = publication.time_trial_submission_id
       STRAIGHT_JOIN player_username_history AS username
         ON username.player_id = player.player_id AND username.released_at_ms IS NULL
       WHERE player.public_id IN (${placeholders}) AND player.record_status = 'active'
         AND best.public_eligible = 1 AND publication.publication_status = 'published'
       ORDER BY player.public_id ASC, best.track_id ASC, best.mode_cc ASC
       LIMIT 2000`,
      [...playerIds],
    );
    return this.attachLaps(rows);
  }

  private async attachLaps(rows: ResultRow[]): Promise<readonly PublicTimeTrialResult[]> {
    const partials = rows.map(result);
    if (partials.length === 0) { return []; }
    const placeholders = partials.map(() => "?").join(", ");
    const [lapRows] = await this.executor.execute<LapRow[]>(
      `SELECT time_trial_submission_revision_id AS revisionInternalId,
              lap_number AS lapNumber, time_ms AS timeMs,
              coins_collected AS coinsCollected, mushrooms_used AS mushroomsUsed
       FROM time_trial_laps
       WHERE time_trial_submission_revision_id IN (${placeholders})
       ORDER BY time_trial_submission_revision_id ASC, lap_number ASC`,
      partials.map((item) => item.revisionInternalId),
    );
    const laps = new Map<number, PublicTimeTrialLap[]>();
    for (const row of lapRows) {
      const mapped = lap(row);
      const values = laps.get(mapped.revisionInternalId) ?? [];
      const { revisionInternalId: _internal, ...publicLap } = mapped;
      values.push(publicLap);
      laps.set(mapped.revisionInternalId, values);
    }
    return partials.map(({ revisionInternalId, ...item }) => ({
      ...item,
      laps: laps.get(revisionInternalId) ?? [],
    }));
  }
}
