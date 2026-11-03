import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

import type {
  EngagementAcceptScope,
  EngagementDetail,
  EngagementKind,
  EngagementRecord,
  GameReply,
  PlayerEngagementRepository,
  RpsStats,
} from "./player-engagement-service.js";
import { diceOutcome, isOpenGame, PlayerEngagementError, rpsOutcome } from "./player-engagement-service.js";

/** One engagement with both Players' public ids and names. */
const ENGAGEMENT_SELECT = `SELECT engagement.public_id AS engagementId,
              engagement.engagement_kind AS kind,
              actor.public_id AS actorPlayerId,
              recipient.public_id AS recipientPlayerId,
              actor.display_name AS actorDisplayName,
              recipient.display_name AS recipientDisplayName,
              engagement.detail, engagement.created_at_ms AS createdAtMs
       FROM player_engagements AS engagement
       INNER JOIN players AS actor ON actor.player_id = engagement.actor_player_id
       INNER JOIN players AS recipient ON recipient.player_id = engagement.recipient_player_id`;

interface CountRow extends RowDataPacket { total: number }
interface IdRow extends RowDataPacket { id: number }
interface ScopeRow extends RowDataPacket { scope: string }
interface EngagementRow extends RowDataPacket {
  engagementId: string; kind: EngagementRecord["kind"];
  actorPlayerId: string; recipientPlayerId: string;
  actorDisplayName: string; recipientDisplayName: string;
  detail: string | EngagementDetail | null; createdAtMs: number;
}

const ACCEPT_SCOPES: ReadonlySet<string> = new Set(["all", "rivals", "none"]);

/**
 * Engagement persistence. The public Player id never reaches a foreign key: it
 * is resolved to the internal id in the same statement, so an unknown Player
 * simply does not match rather than half-writing a row.
 */
export class MysqlPlayerEngagementRepository implements PlayerEngagementRepository {
  public constructor(private readonly pool: Pool) {}

  public async verifiedPlayerId(userAccountId: string): Promise<string | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT player.public_id AS playerId
       FROM user_accounts AS account
       INNER JOIN player_claims AS claim
         ON claim.user_account_id = account.user_account_id
        AND claim.claim_status = 'verified'
       INNER JOIN players AS player
         ON player.player_id = claim.player_id
        AND player.record_status = 'active'
       WHERE account.public_id = ?
       LIMIT 1`,
      [userAccountId],
    );
    const value = rows[0]?.["playerId"];
    return typeof value === "string" ? value : null;
  }

  public async playerExists(playerId: string): Promise<boolean> {
    const [rows] = await this.pool.execute<IdRow[]>(
      `SELECT player_id AS id FROM players
       WHERE public_id = ? AND record_status = 'active' AND player_kind = 'human'
       LIMIT 1`,
      [playerId],
    );
    return rows.length === 1;
  }

  public async hasVerifiedAccount(playerId: string): Promise<boolean> {
    const [rows] = await this.pool.execute<IdRow[]>(
      `SELECT claim.user_account_id AS id
       FROM player_claims AS claim
       INNER JOIN players AS player ON player.player_id = claim.player_id
       WHERE player.public_id = ? AND claim.claim_status = 'verified'
       LIMIT 1`,
      [playerId],
    );
    return rows.length === 1;
  }

  /**
   * A Player who has never touched the setting accepts everything, which is
   * what the column default says too.
   */
  public async acceptScope(playerId: string): Promise<EngagementAcceptScope> {
    const [rows] = await this.pool.execute<ScopeRow[]>(
      `SELECT preference.engagement_accept_scope AS scope
       FROM notification_preferences AS preference
       INNER JOIN player_claims AS claim
         ON claim.user_account_id = preference.user_account_id
        AND claim.claim_status = 'verified'
       INNER JOIN players AS player ON player.player_id = claim.player_id
       WHERE player.public_id = ?
       LIMIT 1`,
      [playerId],
    );
    const scope = rows[0]?.scope;
    return typeof scope === "string" && ACCEPT_SCOPES.has(scope)
      ? scope as EngagementAcceptScope
      : "all";
  }

  /** Is the actor on the recipient's own rival list? The recipient's list decides. */
  public async isRivalOf(
    recipientPlayerId: string,
    actorPlayerId: string,
  ): Promise<boolean> {
    const [rows] = await this.pool.execute<IdRow[]>(
      `SELECT rival.player_rival_id AS id
       FROM player_rivals AS rival
       INNER JOIN players AS owner ON owner.player_id = rival.player_id
       INNER JOIN players AS target ON target.player_id = rival.rival_player_id
       WHERE owner.public_id = ? AND target.public_id = ?
       LIMIT 1`,
      [recipientPlayerId, actorPlayerId],
    );
    return rows.length === 1;
  }

  public async recentFromActor(
    actorPlayerId: string,
    recipientPlayerId: string,
    kind: EngagementKind,
    sinceMs: number,
  ): Promise<readonly EngagementRecord[]> {
    // Newest first and bounded: the service reads the latest for a cooldown and scans these few
    // for an open game. JSON is judged in the service, so MySQL and MariaDB agree.
    const [rows] = await this.pool.execute<EngagementRow[]>(
      `${ENGAGEMENT_SELECT}
       WHERE actor.public_id = ? AND recipient.public_id = ?
         AND engagement.engagement_kind = ? AND engagement.created_at_ms >= ?
       ORDER BY engagement.created_at_ms DESC LIMIT 20`,
      [actorPlayerId, recipientPlayerId, kind, sinceMs],
    );
    return rows.map(MysqlPlayerEngagementRepository.fromRow);
  }

  public async listBetween(
    playerId: string, otherPlayerId: string, limit: number,
  ): Promise<readonly EngagementRecord[]> {
    const bounded = Math.max(1, Math.min(50, Math.trunc(limit)));
    const [rows] = await this.pool.execute<EngagementRow[]>(
      `${ENGAGEMENT_SELECT}
       WHERE (actor.public_id = ? AND recipient.public_id = ?)
          OR (actor.public_id = ? AND recipient.public_id = ?)
       ORDER BY engagement.created_at_ms DESC LIMIT ${bounded}`,
      [playerId, otherPlayerId, otherPlayerId, playerId],
    );
    return rows.map(MysqlPlayerEngagementRepository.fromRow);
  }

  public async countForRecipient(
    recipientPlayerId: string,
    sinceMs: number,
  ): Promise<number> {
    const [rows] = await this.pool.execute<CountRow[]>(
      `SELECT COUNT(*) AS total
       FROM player_engagements AS engagement
       INNER JOIN players AS recipient ON recipient.player_id = engagement.recipient_player_id
       WHERE recipient.public_id = ? AND engagement.created_at_ms >= ?`,
      [recipientPlayerId, sinceMs],
    );
    return Number(rows[0]?.total ?? 0);
  }

  public async publishedBest(playerId: string, trackId: string,
    mode: 150 | 200): Promise<number | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT best.total_time_ms AS totalTimeMs
       FROM time_trial_player_bests AS best
       INNER JOIN players AS player ON player.player_id = best.player_id
       WHERE player.public_id = ? AND best.track_id = ? AND best.mode_cc = ?
         AND best.public_eligible = 1
       LIMIT 1`, [playerId, trackId, mode],
    );
    const value = rows[0]?.["totalTimeMs"];
    return typeof value === "number" ? value : null;
  }

  private static fromRow(row: EngagementRow): EngagementRecord {
    const detail = row.detail === null ? undefined :
      typeof row.detail === "string" ? JSON.parse(row.detail) as EngagementDetail : row.detail;
    return {
      engagementId: row.engagementId, kind: row.kind,
      actorPlayerId: row.actorPlayerId, recipientPlayerId: row.recipientPlayerId,
      actorDisplayName: row.actorDisplayName, recipientDisplayName: row.recipientDisplayName,
      ...(detail === undefined ? {} : { detail }),
      createdAtMs: Number(row.createdAtMs),
    };
  }

  public async listForPlayer(playerId: string): Promise<readonly EngagementRecord[]> {
    const [rows] = await this.pool.execute<EngagementRow[]>(
      `SELECT engagement.public_id AS engagementId,
              engagement.engagement_kind AS kind,
              actor.public_id AS actorPlayerId,
              recipient.public_id AS recipientPlayerId,
              actor.display_name AS actorDisplayName,
              recipient.display_name AS recipientDisplayName,
              engagement.detail, engagement.created_at_ms AS createdAtMs
       FROM player_engagements AS engagement
       INNER JOIN players AS actor ON actor.player_id = engagement.actor_player_id
       INNER JOIN players AS recipient ON recipient.player_id = engagement.recipient_player_id
       WHERE actor.public_id = ? OR recipient.public_id = ?
       ORDER BY engagement.created_at_ms DESC LIMIT 50`, [playerId, playerId],
    );
    return rows.map(MysqlPlayerEngagementRepository.fromRow);
  }

  public async rpsStats(playerId: string): Promise<RpsStats> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS played,
              SUM(CASE WHEN outcome = 'draw' THEN 1 ELSE 0 END) AS draws,
              SUM(CASE WHEN (actorPublicId = ? AND outcome = 'actor')
                         OR (recipientPublicId = ? AND outcome = 'recipient')
                       THEN 1 ELSE 0 END) AS wins
       FROM (
         SELECT actor.public_id AS actorPublicId,
                recipient.public_id AS recipientPublicId,
                JSON_UNQUOTE(JSON_EXTRACT(engagement.detail, '$.outcome')) AS outcome
         FROM player_engagements AS engagement
         INNER JOIN players AS actor ON actor.player_id = engagement.actor_player_id
         INNER JOIN players AS recipient ON recipient.player_id = engagement.recipient_player_id
         WHERE engagement.engagement_kind = 'rock_paper_scissors'
           AND (actor.public_id = ? OR recipient.public_id = ?)
           AND JSON_EXTRACT(engagement.detail, '$.recipientHand') IS NOT NULL
       ) AS completed`, [playerId, playerId, playerId, playerId],
    );
    const played = Number(rows[0]?.["played"] ?? 0);
    const draws = Number(rows[0]?.["draws"] ?? 0);
    const wins = Number(rows[0]?.["wins"] ?? 0);
    return { played, wins, draws, losses: played - wins - draws };
  }

  public async answerGame(engagementId: string, recipientPlayerId: string,
    reply: GameReply, nowMs: number): Promise<EngagementRecord | null> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<EngagementRow[]>(
        `${ENGAGEMENT_SELECT}
         WHERE engagement.public_id = ? AND recipient.public_id = ?
         FOR UPDATE`, [engagementId, recipientPlayerId],
      );
      const row = rows[0];
      if (row === undefined || row.kind !== reply.kind) {
        await connection.rollback(); return null;
      }
      const engagement = MysqlPlayerEngagementRepository.fromRow(row);
      if (engagement.detail?.respondedAtMs !== undefined || engagement.detail?.recipientHand !== undefined) {
        throw new PlayerEngagementError("already_answered");
      }
      if (!isOpenGame(engagement)) {
        // A roll from before duels existed has nothing to answer.
        await connection.rollback(); return null;
      }
      let detail: EngagementDetail;
      let resultDetail: string;
      if (reply.kind === "rock_paper_scissors") {
        const actorHand = engagement.detail?.hand;
        if (actorHand !== "rock" && actorHand !== "paper" && actorHand !== "scissors") {
          throw new PlayerEngagementError("invalid_detail");
        }
        detail = {
          hand: actorHand, recipientHand: reply.hand,
          outcome: rpsOutcome(actorHand, reply.hand), respondedAtMs: nowMs,
        };
        resultDetail = "result";
      } else {
        const actorFace = engagement.detail?.face;
        if (typeof actorFace !== "number") { throw new PlayerEngagementError("invalid_detail"); }
        detail = {
          face: actorFace, duel: true, recipientFace: reply.face,
          outcome: diceOutcome(actorFace, reply.face), respondedAtMs: nowMs,
        };
        // Reads the same in either language and in older app builds: "<responder> rolled 6 vs 4".
        resultDetail = `${reply.face} vs ${actorFace}`;
      }
      await connection.execute(
        `UPDATE player_engagements SET detail = ? WHERE public_id = ?`,
        [JSON.stringify(detail), engagementId],
      );
      // The original invite went to the recipient; the response goes to the
      // sender as its own inbox entry, never merging with a pending invite.
      await connection.execute(
        `INSERT INTO notifications (
           user_account_id, notification_kind, aggregation_key, actor_player_id,
           detail, event_count, first_event_at_ms, last_event_at_ms
         )
         SELECT claim.user_account_id, ?,
                CONCAT(?, ?, '|', claim.user_account_id),
                responder.player_id, ?, 1, ?, ?
         FROM player_claims AS claim
         INNER JOIN players AS owner ON owner.player_id = claim.player_id
         INNER JOIN players AS responder ON responder.public_id = ?
         WHERE owner.public_id = ? AND claim.claim_status = 'verified'
         ON DUPLICATE KEY UPDATE last_event_at_ms = VALUES(last_event_at_ms)`,
        [reply.kind, reply.kind === "rock_paper_scissors" ? "rps-result|" : "dice-result|", engagementId,
          resultDetail, nowMs, nowMs, recipientPlayerId, engagement.actorPlayerId],
      );
      await connection.commit();
      return { ...engagement, detail };
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally { connection.release(); }
  }

  /**
   * The act and the notification it produces are written together: a Player
   * who is told about a poke must have been poked, and one who was poked must
   * be told.
   */
  public async record(engagement: EngagementRecord): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO player_engagements (
           public_id, engagement_kind, actor_player_id, recipient_player_id,
           detail, created_at_ms
         )
         SELECT ?, ?, actor.player_id, recipient.player_id, ?, ?
         FROM players AS actor, players AS recipient
         WHERE actor.public_id = ? AND recipient.public_id = ?`,
        [
          engagement.engagementId,
          engagement.kind,
          engagement.detail === undefined ? null : JSON.stringify(engagement.detail),
          engagement.createdAtMs,
          engagement.actorPlayerId,
          engagement.recipientPlayerId,
        ],
      );
      await this.notify(connection, engagement);
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  private async notify(
    connection: PoolConnection,
    engagement: EngagementRecord,
  ): Promise<void> {
    // Repeated pokes collapse. Games and challenges stay individually
    // addressable so an invitation can be answered and each target retained.
    await connection.execute(
      `INSERT INTO notifications (
         user_account_id, notification_kind, aggregation_key, actor_player_id,
         track_id, mode_cc, actor_time_ms, detail,
         event_count, first_event_at_ms, last_event_at_ms
       )
       SELECT claim.user_account_id, ?,
              CONCAT(?, '|', ?, '|', claim.user_account_id),
              actor.player_id, ?, ?, ?, ?, 1, ?, ?
       FROM player_claims AS claim
       INNER JOIN players AS recipient
         ON recipient.player_id = claim.player_id AND recipient.public_id = ?
       INNER JOIN players AS actor ON actor.public_id = ?
       WHERE claim.claim_status = 'verified'
       ON DUPLICATE KEY UPDATE
         event_count = event_count + 1,
         last_event_at_ms = VALUES(last_event_at_ms),
         detail = VALUES(detail)`,
      [
        engagement.kind,
        engagement.kind,
        engagement.kind === "poke" ? engagement.actorPlayerId : engagement.engagementId,
        engagement.detail?.trackId ?? null,
        engagement.detail?.mode ?? null,
        engagement.detail?.totalTimeMs ?? null,
        engagement.kind === "rock_paper_scissors" ? "invite" :
          engagement.kind === "dice_roll" ? String(engagement.detail?.face ?? "") :
          engagement.kind === "challenge" ? "challenge" : null,
        engagement.createdAtMs,
        engagement.createdAtMs,
        engagement.recipientPlayerId,
        engagement.actorPlayerId,
      ],
    );
  }
}
