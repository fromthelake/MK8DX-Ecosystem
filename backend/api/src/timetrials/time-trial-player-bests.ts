import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";

type QueryExecutor = Pick<PoolConnection, "execute">;

interface PlayerRow extends RowDataPacket {
  playerId: unknown;
}

function playerIds(values: readonly number[]): readonly number[] {
  return [...new Set(values)].filter((value) =>
    Number.isSafeInteger(value) && value > 0);
}

/**
 * Rebuild the bounded derived PB rows for the affected Players inside the
 * caller's transaction. Historical publications remain authoritative; this
 * table is deliberately disposable and can be recreated by migration/backfill.
 */
export async function refreshTimeTrialPlayerBestsForPlayers(
  executor: QueryExecutor,
  values: readonly number[],
): Promise<void> {
  const ids = playerIds(values);
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(", ");
  await executor.execute<ResultSetHeader>(
    `DELETE FROM time_trial_player_bests
     WHERE player_id IN (${placeholders})`,
    [...ids],
  );
  await executor.execute<ResultSetHeader>(
    `INSERT INTO time_trial_player_bests (
       player_id, track_id, mode_cc, time_trial_publication_id,
       time_trial_submission_revision_id, total_time_ms, published_at_ms,
       public_eligible
     )
     SELECT ranked.player_id, ranked.track_id, ranked.mode_cc,
            ranked.time_trial_publication_id,
            ranked.time_trial_submission_revision_id,
            ranked.total_time_ms, ranked.published_at_ms,
            ranked.public_eligible
     FROM (
       SELECT revision.player_id, revision.track_id, revision.mode_cc,
              publication.time_trial_publication_id,
              revision.time_trial_submission_revision_id,
              revision.total_time_ms, publication.published_at_ms,
              (player.record_status = 'active' AND player.visibility = 'public')
                AS public_eligible,
              ROW_NUMBER() OVER (
                PARTITION BY revision.player_id, revision.track_id,
                             revision.mode_cc
                ORDER BY revision.total_time_ms ASC,
                         publication.published_at_ms DESC,
                         submission.public_id DESC
              ) AS player_best
       FROM time_trial_publications AS publication
       INNER JOIN time_trial_submission_revisions AS revision
         ON revision.time_trial_submission_revision_id =
            publication.current_revision_id
        AND revision.time_trial_submission_id =
            publication.time_trial_submission_id
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id =
            publication.time_trial_submission_id
       INNER JOIN players AS player ON player.player_id = revision.player_id
       WHERE publication.publication_status = 'published'
         AND revision.player_id IN (${placeholders})
     ) AS ranked
     WHERE ranked.player_best = 1`,
    [...ids],
  );
}

export async function refreshTimeTrialPlayerBestsForRevisions(
  executor: QueryExecutor,
  revisionInternalIds: readonly number[],
): Promise<void> {
  const ids = playerIds(revisionInternalIds);
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await executor.execute<PlayerRow[]>(
    `SELECT DISTINCT player_id AS playerId
     FROM time_trial_submission_revisions
     WHERE time_trial_submission_revision_id IN (${placeholders})
       AND player_id IS NOT NULL`,
    [...ids],
  );
  await refreshTimeTrialPlayerBestsForPlayers(
    executor,
    rows.map((row) => Number(row.playerId)),
  );
}
