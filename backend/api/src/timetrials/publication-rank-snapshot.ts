import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";

type QueryExecutor = Pick<PoolConnection, "execute">;

interface RankSnapshotRow extends RowDataPacket {
  revisionInternalId: unknown;
  rankAtPublication: unknown;
}

function positiveInteger(value: unknown): number | null {
  const numeric = typeof value === "string" ? Number(value) : value;
  return typeof numeric === "number" && Number.isSafeInteger(numeric) && numeric >= 1
    ? numeric
    : null;
}

/**
 * Calculate human-leaderboard positions for revisions that are about to
 * become public. One query handles the normal single result and bulk profile
 * restores alike. Equal times share a rank; another submission by the same
 * Player never competes with the candidate revision.
 */
export async function publicationRankSnapshots(
  executor: QueryExecutor,
  revisionInternalIds: readonly number[],
): Promise<ReadonlyMap<number, number>> {
  const uniqueIds = [...new Set(revisionInternalIds)];
  const requestedIds = new Set(uniqueIds);
  if (uniqueIds.length === 0) { return new Map(); }
  if (uniqueIds.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw new Error("publication rank candidate has an invalid revision ID");
  }
  const placeholders = uniqueIds.map(() => "?").join(", ");
  const [rows] = await executor.execute<RankSnapshotRow[]>(
    `SELECT candidate.time_trial_submission_revision_id AS revisionInternalId,
            1 + COUNT(DISTINCT CASE
                  WHEN competitor.player_id IS NOT NULL
                  THEN competitor.player_id
                END) AS rankAtPublication
     FROM time_trial_submission_revisions AS candidate
     LEFT JOIN time_trial_player_bests AS competitor
       ON competitor.track_id = candidate.track_id
      AND competitor.mode_cc = candidate.mode_cc
      AND competitor.player_id <> candidate.player_id
      AND competitor.total_time_ms < candidate.total_time_ms
      AND competitor.public_eligible = 1
     WHERE candidate.time_trial_submission_revision_id IN (${placeholders})
       AND candidate.player_id IS NOT NULL
     GROUP BY candidate.time_trial_submission_revision_id`,
    uniqueIds,
  );
  const snapshots = new Map<number, number>();
  for (const row of rows) {
    const revisionInternalId = positiveInteger(row.revisionInternalId);
    const rankAtPublication = positiveInteger(row.rankAtPublication);
    if (revisionInternalId !== null && rankAtPublication !== null &&
        requestedIds.has(revisionInternalId)) {
      snapshots.set(revisionInternalId, rankAtPublication);
    }
  }
  if (snapshots.size !== uniqueIds.length) {
    throw new Error("publication rank snapshot could not be calculated");
  }
  return snapshots;
}
