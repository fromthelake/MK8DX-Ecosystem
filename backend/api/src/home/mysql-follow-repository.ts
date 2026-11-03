import type { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";

import type {
  RivalPreference,
  RivalPreferenceRepository,
} from "./home-comeback-service.js";

type PreparedQueryExecutor = Pick<Pool, "execute">;

// FOLLOW preference persistence: same private-list contract as rivals
// (bounded, no notification, never publicly readable), its own table.
// The own verified Player is excluded - following yourself is
// meaningless and the exclusion keeps the two lists symmetric.
export class MysqlFollowPreferenceRepository
implements RivalPreferenceRepository {
  public constructor(private readonly executor: PreparedQueryExecutor) {}

  public async listRivals(
    userAccountId: string,
  ): Promise<readonly RivalPreference[]> {
    const [rows] = await this.executor.execute<RowDataPacket[]>(
      `SELECT player.public_id AS playerId,
              player.display_name AS displayName,
              player.avatar_id AS avatarId
       FROM player_follows AS follow
       INNER JOIN user_accounts AS account
         ON account.user_account_id = follow.user_account_id
       INNER JOIN players AS player
         ON player.player_id = follow.followed_player_id
        AND player.record_status = 'active'
       WHERE account.public_id = ?
       ORDER BY follow.created_at_ms ASC
       LIMIT 25`,
      [userAccountId],
    );
    return rows.flatMap((row) =>
      typeof row["playerId"] === "string" &&
      typeof row["displayName"] === "string"
        ? [{
            playerId: row["playerId"],
            displayName: row["displayName"],
            ...(typeof row["avatarId"] === "string"
              ? { avatarId: row["avatarId"] }
              : {}),
          }]
        : []);
  }

  public async addRival(
    userAccountId: string,
    followedPlayerId: string,
    nowMs: number,
  ): Promise<boolean> {
    const [result] = await this.executor.execute<ResultSetHeader>(
      `INSERT INTO player_follows
         (user_account_id, followed_player_id, created_at_ms)
       SELECT account.user_account_id, player.player_id, ?
       FROM user_accounts AS account
       INNER JOIN players AS player
         ON player.public_id = ? AND player.record_status = 'active'
       WHERE account.public_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM player_claims AS claim
           WHERE claim.claim_status = 'verified'
             AND claim.user_account_id = account.user_account_id
             AND claim.player_id = player.player_id
         )
       ON DUPLICATE KEY UPDATE created_at_ms = player_follows.created_at_ms`,
      [nowMs, followedPlayerId, userAccountId],
    );
    if (result.affectedRows > 0) { return true; }
    const [rows] = await this.executor.execute<RowDataPacket[]>(
      `SELECT follow.player_follow_id
       FROM player_follows AS follow
       INNER JOIN user_accounts AS account
         ON account.user_account_id = follow.user_account_id
       INNER JOIN players AS player
         ON player.player_id = follow.followed_player_id
       WHERE account.public_id = ? AND player.public_id = ?
       LIMIT 1`,
      [userAccountId, followedPlayerId],
    );
    return rows.length > 0;
  }

  public async removeRival(
    userAccountId: string,
    followedPlayerId: string,
  ): Promise<void> {
    await this.executor.execute<ResultSetHeader>(
      `DELETE follow FROM player_follows AS follow
       INNER JOIN user_accounts AS account
         ON account.user_account_id = follow.user_account_id
       INNER JOIN players AS player
         ON player.player_id = follow.followed_player_id
       WHERE account.public_id = ? AND player.public_id = ?`,
      [userAccountId, followedPlayerId],
    );
  }
}
