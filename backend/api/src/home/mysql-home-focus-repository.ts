import type { Pool, RowDataPacket } from "mysql2/promise";

import type {
  FocusRow,
  HomeFocusRepository,
} from "./home-focus-service.js";

type PreparedQueryExecutor = Pick<Pool, "execute">;

// Loads the bounded, transactionally refreshed PB projection for exactly the
// combos the own Player drives. Exact rank/count/leader calculations remain in
// MySQL and only one result per owned combo crosses into Node. This matters at
// launch scale: 96 owned combos must not turn into 96 * community-size rows in
// the Home response process.
export class MysqlHomeFocusRepository implements HomeFocusRepository {
  public constructor(private readonly executor: PreparedQueryExecutor) {}

  public async loadFocusInput(userAccountId: string): Promise<Readonly<{
    modePreference: "all" | "150" | "200";
    trackAccess: "unknown" | "base_only" | "base_and_bcp";
    rows: readonly FocusRow[];
  }> | null> {
    const [ownRows] = await this.executor.execute<RowDataPacket[]>(
      `SELECT player.player_id AS internalId, player.public_id AS playerId,
              account.time_trial_mode_preference AS modePreference,
              account.time_trial_track_access AS trackAccess
       FROM players AS player
       INNER JOIN player_claims AS claim
         ON claim.player_id = player.player_id
        AND claim.claim_status = 'verified'
       INNER JOIN user_accounts AS account
         ON account.user_account_id = claim.user_account_id
       WHERE account.public_id = ? AND player.record_status = 'active'
       LIMIT 1`,
      [userAccountId],
    );
    const own = ownRows[0];
    if (own === undefined || typeof own["playerId"] !== "string") {
      return null;
    }
    const preference = own["modePreference"];
    const normalizedPreference = preference === "150" || preference === "200"
      ? preference : "all";
    const [rows] = await this.executor.execute<RowDataPacket[]>(
      `WITH own_bests AS (
         SELECT own_best.player_id, own_best.track_id, own_best.mode_cc,
                own_best.total_time_ms
         FROM time_trial_player_bests AS own_best
         STRAIGHT_JOIN players AS own_player
           ON own_player.player_id = own_best.player_id
          AND own_player.record_status = 'active'
          AND own_player.visibility = 'public'
         WHERE own_best.player_id = ?
           AND own_best.public_eligible = 1
           AND (? = 'all' OR own_best.mode_cc = CAST(? AS UNSIGNED))
       ), focus_aggregate AS (
         SELECT own_best.track_id AS trackId,
                own_best.mode_cc AS mode,
                own_best.total_time_ms AS myBestMs,
                1 + SUM(community.total_time_ms < own_best.total_time_ms)
                  AS myRank,
                COUNT(*) AS humanCount,
                MIN(community.total_time_ms) AS leaderBestMs,
                MAX(CASE WHEN community.total_time_ms < own_best.total_time_ms
                         THEN community.total_time_ms ELSE NULL END)
                  AS aboveBestMs
         FROM own_bests AS own_best
         STRAIGHT_JOIN time_trial_player_bests AS community
           ON community.track_id = own_best.track_id
          AND community.mode_cc = own_best.mode_cc
          AND community.public_eligible = 1
         GROUP BY own_best.track_id, own_best.mode_cc,
                  own_best.total_time_ms
       ), focus_rows AS (
         SELECT focus_aggregate.*,
                MIN(above_player.player_id) AS aboveInternalId,
                CASE WHEN focus_aggregate.aboveBestMs IS NULL THEN NULL
                     ELSE focus_aggregate.myRank - COUNT(above_player.player_id)
                END AS aboveRank
         FROM focus_aggregate
         LEFT JOIN time_trial_player_bests AS above_best
          ON above_best.track_id = focus_aggregate.trackId
         AND above_best.mode_cc = focus_aggregate.mode
         AND above_best.total_time_ms = focus_aggregate.aboveBestMs
         AND above_best.public_eligible = 1
         LEFT JOIN players AS above_player
           ON above_player.player_id = above_best.player_id
          AND above_player.record_status = 'active'
          AND above_player.visibility = 'public'
         GROUP BY focus_aggregate.trackId, focus_aggregate.mode,
                  focus_aggregate.myBestMs, focus_aggregate.myRank,
                  focus_aggregate.humanCount,
                  focus_aggregate.leaderBestMs,
                  focus_aggregate.aboveBestMs
       )
       SELECT focus_rows.trackId, focus_rows.mode, focus_rows.myBestMs,
              focus_rows.myRank, focus_rows.humanCount,
              focus_rows.leaderBestMs,
              above_player.public_id AS abovePlayerId,
              above_player.display_name AS aboveDisplayName,
              focus_rows.aboveBestMs,
              focus_rows.aboveRank
       FROM focus_rows
       LEFT JOIN players AS above_player
         ON above_player.player_id = focus_rows.aboveInternalId
       ORDER BY focus_rows.trackId ASC, focus_rows.mode ASC`,
      [own["internalId"], normalizedPreference, normalizedPreference],
    );
    const focusRows: FocusRow[] = [];
    for (const row of rows) {
      const mode = Number(row["mode"]);
      const myBestMs = Number(row["myBestMs"]);
      const myRank = Number(row["myRank"]);
      const humanCount = Number(row["humanCount"]);
      const leaderBestMs = Number(row["leaderBestMs"]);
      if (typeof row["trackId"] !== "string" ||
          (mode !== 150 && mode !== 200) ||
          !Number.isSafeInteger(myBestMs) || myBestMs <= 0 ||
          !Number.isSafeInteger(myRank) || myRank <= 0 ||
          !Number.isSafeInteger(humanCount) || humanCount <= 0 ||
          !Number.isSafeInteger(leaderBestMs) || leaderBestMs <= 0) {
        continue;
      }
      const aboveBestMs = Number(row["aboveBestMs"]);
      const aboveRank = Number(row["aboveRank"]);
      const hasAbove = typeof row["abovePlayerId"] === "string" &&
        typeof row["aboveDisplayName"] === "string" &&
        Number.isSafeInteger(aboveBestMs) && aboveBestMs > 0 &&
        Number.isSafeInteger(aboveRank) && aboveRank > 0;
      focusRows.push({
        trackId: row["trackId"],
        mode,
        myBestMs,
        myRank,
        humanCount,
        leaderBestMs,
        ...(hasAbove ? {
          above: {
            playerId: row["abovePlayerId"] as string,
            displayName: row["aboveDisplayName"] as string,
            bestMs: aboveBestMs,
            rank: aboveRank,
          },
        } : {}),
      });
    }
    const trackAccess = own["trackAccess"];
    return {
      modePreference: normalizedPreference,
      trackAccess: trackAccess === "base_only" || trackAccess === "base_and_bcp"
        ? trackAccess : "unknown",
      rows: focusRows,
    };
  }
}
