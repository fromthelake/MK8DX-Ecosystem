import type { Pool, RowDataPacket } from "mysql2/promise";

import type {
  CareerRatingEvent,
  PublicCareerRepository,
  PublicPlayerCareer,
} from "./public-career-service.js";

type PreparedQueryExecutor = Pick<Pool, "execute">;

interface PlayerRow extends RowDataPacket {
  playerInternalId: unknown;
}

interface TotalsRow extends RowDataPacket {
  published: unknown;
  published150: unknown;
  published200: unknown;
  tracks150: unknown;
  tracks200: unknown;
  latestResultAtMs: unknown;
}

interface PodiumRow extends RowDataPacket {
  firsts: unknown;
  firsts150: unknown;
  firsts200: unknown;
  podiums: unknown;
  podiums150: unknown;
  podiums200: unknown;
}

interface MostPlayedRow extends RowDataPacket {
  trackId: unknown;
  playedCount: unknown;
  played150: unknown;
  played200: unknown;
}

interface RatingRow extends RowDataPacket {
  score: unknown;
  playerRank: unknown;
}

interface RatingEventRow extends RowDataPacket {
  sequenceNumber: unknown;
  eventType: unknown;
  scoreAfter: unknown;
  scoreBefore: unknown;
  occurredAtMs: unknown;
}

const publishedResultJoin = `
  FROM time_trial_publications AS publication
  INNER JOIN time_trial_submission_revisions AS revision
    ON revision.time_trial_submission_revision_id =
       publication.current_revision_id
  WHERE publication.publication_status = 'published'`;

export class MysqlPublicCareerRepository implements PublicCareerRepository {
  public constructor(private readonly executor: PreparedQueryExecutor) {}

  public async loadCareer(
    playerId: string,
  ): Promise<PublicPlayerCareer | null> {
    const [players] = await this.executor.execute<PlayerRow[]>(
      `SELECT player_id AS playerInternalId FROM players
       WHERE public_id = ? AND record_status = 'active' LIMIT 1`,
      [playerId],
    );
    const internalId = Number(players[0]?.playerInternalId);
    if (!Number.isSafeInteger(internalId)) { return null; }

    const [totals] = await this.executor.execute<TotalsRow[]>(
      `SELECT COUNT(*) AS published,
              SUM(revision.mode_cc = 150) AS published150,
              SUM(revision.mode_cc = 200) AS published200,
              COUNT(DISTINCT CASE WHEN revision.mode_cc = 150
                THEN revision.track_id END) AS tracks150,
              COUNT(DISTINCT CASE WHEN revision.mode_cc = 200
                THEN revision.track_id END) AS tracks200,
              MAX(COALESCE(revision.occurred_at_ms, revision.submitted_at_ms,
                           revision.created_at_ms)) AS latestResultAtMs
       ${publishedResultJoin}
         AND revision.player_id = ?`,
      [internalId],
    );

    const [podiumRows] = await this.executor.execute<PodiumRow[]>(
      `WITH bests AS (
         SELECT revision.player_id, revision.track_id, revision.mode_cc,
                MIN(revision.total_time_ms) AS best_time
         ${publishedResultJoin}
           AND revision.player_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM players AS ranked_player
             WHERE ranked_player.player_id = revision.player_id
               AND ranked_player.record_status = 'active'
               AND ranked_player.visibility = 'public'
           )
         GROUP BY revision.player_id, revision.track_id, revision.mode_cc
       ),
       ranked AS (
         SELECT player_id, mode_cc,
                RANK() OVER (
                  PARTITION BY track_id, mode_cc
                  ORDER BY best_time ASC
                ) AS position
         FROM bests
       )
       SELECT SUM(position = 1) AS firsts,
              SUM(position = 1 AND mode_cc = 150) AS firsts150,
              SUM(position = 1 AND mode_cc = 200) AS firsts200,
              SUM(position <= 3) AS podiums,
              SUM(position <= 3 AND mode_cc = 150) AS podiums150,
              SUM(position <= 3 AND mode_cc = 200) AS podiums200
       FROM ranked WHERE player_id = ?`,
      [internalId],
    );

    const [mostPlayedRows] = await this.executor.execute<MostPlayedRow[]>(
      `SELECT revision.track_id AS trackId, COUNT(*) AS playedCount,
              SUM(revision.mode_cc = 150) AS played150,
              SUM(revision.mode_cc = 200) AS played200
       ${publishedResultJoin}
         AND revision.player_id = ?
       GROUP BY revision.track_id
       ORDER BY playedCount DESC, revision.track_id ASC
       LIMIT 1`,
      [internalId],
    );

    const [ratingRows] = await this.executor.execute<RatingRow[]>(
      `SELECT (mine.mu - 3 * mine.sigma) AS score,
              1 + (SELECT COUNT(*) FROM player_ratings AS other
                   INNER JOIN players AS otherPlayer
                     ON otherPlayer.player_id = other.player_id
                    AND otherPlayer.record_status = 'active'
                    AND otherPlayer.visibility = 'public'
                   WHERE (other.mu - 3 * other.sigma) >
                         (mine.mu - 3 * mine.sigma)) AS playerRank
       FROM player_ratings AS mine
       WHERE mine.player_id = ?`,
      [internalId],
    );

    const published = Number(totals[0]?.published) || 0;
    const latest = Number(totals[0]?.latestResultAtMs);
    const mostPlayedCount = Number(mostPlayedRows[0]?.playedCount);
    const base: Omit<PublicPlayerCareer, "rating"> = {
      playerId,
      timeTrials: {
        published,
        published150: Number(totals[0]?.published150) || 0,
        published200: Number(totals[0]?.published200) || 0,
        tracks150: Number(totals[0]?.tracks150) || 0,
        tracks200: Number(totals[0]?.tracks200) || 0,
        firsts: Number(podiumRows[0]?.firsts) || 0,
        firsts150: Number(podiumRows[0]?.firsts150) || 0,
        firsts200: Number(podiumRows[0]?.firsts200) || 0,
        podiums: Number(podiumRows[0]?.podiums) || 0,
        podiums150: Number(podiumRows[0]?.podiums150) || 0,
        podiums200: Number(podiumRows[0]?.podiums200) || 0,
        ...(typeof mostPlayedRows[0]?.trackId === "string" &&
          Number.isSafeInteger(mostPlayedCount)
          ? {
              mostPlayed: {
                trackId: mostPlayedRows[0].trackId,
                count: mostPlayedCount,
                count150: Number(mostPlayedRows[0].played150) || 0,
                count200: Number(mostPlayedRows[0].played200) || 0,
              },
            }
          : {}),
        ...(Number.isSafeInteger(latest)
          ? { latestResultAtMs: latest }
          : {}),
      },
    };

    const score = Number(ratingRows[0]?.score);
    const playerRank = Number(ratingRows[0]?.playerRank);
    if (Number.isFinite(score) && Number.isSafeInteger(playerRank)) {
      const [eventRows] = await this.executor.execute<RatingEventRow[]>(
        `SELECT sequence_number AS sequenceNumber,
                event_type AS eventType,
                (mu_after - 3 * sigma_after) AS scoreAfter,
                CASE WHEN mu_before IS NULL OR sigma_before IS NULL
                  THEN NULL ELSE (mu_before - 3 * sigma_before) END
                  AS scoreBefore,
                occurred_at_ms AS occurredAtMs
         FROM player_rating_events
         WHERE player_id = ?
         ORDER BY sequence_number ASC
         LIMIT 500`,
        [internalId],
      );
      // Peak includes the imported legacy trajectory (the highest
      // display score ever reached), not only post-seed events.
      const [peakRows] = await this.executor.execute<RowDataPacket[]>(
        `SELECT MAX(score_after) AS legacyPeak
         FROM legacy_race_placements WHERE player_id = ?`,
        [internalId],
      );
      const legacyPeak = Number(peakRows[0]?.["legacyPeak"]);
      const history: CareerRatingEvent[] = [];
      let peak = Number.isFinite(legacyPeak)
        ? Math.max(score, legacyPeak)
        : score;
      for (const row of eventRows) {
        const sequence = Number(row.sequenceNumber);
        const eventScore = Number(row.scoreAfter);
        const occurredAtMs = Number(row.occurredAtMs);
        if (!Number.isSafeInteger(sequence) || !Number.isFinite(eventScore) ||
            !Number.isSafeInteger(occurredAtMs)) {
          continue;
        }
        const before = Number(row.scoreBefore);
        const seed = row.eventType === "seed_import";
        peak = Math.max(peak, eventScore);
        history.push({
          sequence,
          eventType: seed ? "seed" : "race",
          occurredAtMs,
          score: eventScore,
          // The transition checkpoint has no meaningful delta.
          ...(Number.isFinite(before) && !seed
            ? { delta: eventScore - before }
            : {}),
        });
      }
      return {
        ...base,
        rating: {
          score,
          rank: playerRank,
          peakScore: peak,
          history,
        },
      };
    }
    return base;
  }
}
