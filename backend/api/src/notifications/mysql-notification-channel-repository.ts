import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import {
  ENGAGEMENT_ACCEPT_SCOPES,
  type EngagementAcceptScope,
  NOTIFICATION_SCOPES,
  type NotificationChannelRepository,
  type NotificationPreferences,
  type NotificationScope,
} from "./notification-channel-service.js";

interface PreferenceRow extends RowDataPacket {
  notificationScope: unknown;
  engagementAcceptScope: unknown;
  competitiveOvertaken: unknown;
  activityReactions: unknown;
}
interface CountRow extends RowDataPacket { subscriptionCount: unknown; }
interface IdRow extends RowDataPacket { id: number; }

export class MysqlNotificationChannelRepository
implements NotificationChannelRepository {
  public constructor(private readonly pool: Pool) {}

  public async readPreferences(userAccountId: string): Promise<NotificationPreferences> {
    const [rows] = await this.pool.execute<PreferenceRow[]>(
      `SELECT COALESCE(preference.notification_scope, 'all') AS notificationScope,
              COALESCE(preference.engagement_accept_scope, 'all') AS engagementAcceptScope,
              COALESCE(preference.competitive_overtaken, TRUE) AS competitiveOvertaken,
              COALESCE(preference.activity_reactions, TRUE) AS activityReactions
       FROM user_accounts AS account
       LEFT JOIN notification_preferences AS preference
         ON preference.user_account_id = account.user_account_id
       WHERE account.public_id = ? LIMIT 1`,
      [userAccountId],
    );
    if (rows.length !== 1) { throw new Error("notification account was not found"); }
    const scope = String(rows[0]!.notificationScope);
    const acceptScope = String(rows[0]!.engagementAcceptScope);
    return {
      scope: NOTIFICATION_SCOPES.includes(scope as NotificationScope)
        ? scope as NotificationScope
        : "all",
      engagementAcceptScope:
        ENGAGEMENT_ACCEPT_SCOPES.includes(acceptScope as EngagementAcceptScope)
          ? acceptScope as EngagementAcceptScope
          : "all",
      competitiveOvertaken: Boolean(rows[0]!.competitiveOvertaken),
      activityReactions: Boolean(rows[0]!.activityReactions),
    };
  }

  public async updatePreferences(
    userAccountId: string,
    preferences: NotificationPreferences,
    nowMs: number,
  ): Promise<void> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO notification_preferences
         (user_account_id, notification_scope, engagement_accept_scope,
          competitive_overtaken, activity_reactions, updated_at_ms)
       SELECT user_account_id, ?, ?, ?, ?, ? FROM user_accounts WHERE public_id = ?
       ON DUPLICATE KEY UPDATE
         notification_scope = VALUES(notification_scope),
         engagement_accept_scope = VALUES(engagement_accept_scope),
         competitive_overtaken = VALUES(competitive_overtaken),
         activity_reactions = VALUES(activity_reactions),
         updated_at_ms = VALUES(updated_at_ms)`,
      [preferences.scope, preferences.engagementAcceptScope,
        preferences.competitiveOvertaken, preferences.activityReactions,
        nowMs, userAccountId],
    );
    if (result.affectedRows < 1) { throw new Error("notification preferences were not saved"); }
  }

  public async subscriptionCount(userAccountId: string): Promise<number> {
    const [rows] = await this.pool.execute<CountRow[]>(
      `SELECT COUNT(*) AS subscriptionCount
       FROM web_push_subscriptions AS subscription
       INNER JOIN user_accounts AS account
         ON account.user_account_id = subscription.user_account_id
       WHERE account.public_id = ? AND subscription.revoked_at_ms IS NULL`,
      [userAccountId],
    );
    const count = Number(rows[0]?.subscriptionCount);
    if (!Number.isSafeInteger(count) || count < 0) { throw new Error("invalid subscription count"); }
    return count;
  }

  public async saveSubscription(input: Readonly<{
    userAccountId: string;
    endpointSha256: Uint8Array;
    protectedSubscription: Readonly<{ ciphertext: Uint8Array; encryptionKeyVersion: string }>;
    nowMs: number;
    maximumActive: number;
  }>): Promise<void> {
    if (!Number.isSafeInteger(input.maximumActive) || input.maximumActive < 1 ||
        input.maximumActive > 100) {
      throw new Error("invalid subscription quota");
    }
    const endpoint = Buffer.from(input.endpointSha256);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      // The account row is the per-account mutex: concurrent registrations
      // from one account are counted one after the other, across API processes.
      const [accounts] = await connection.execute<IdRow[]>(
        `SELECT user_account_id AS id FROM user_accounts WHERE public_id = ? FOR UPDATE`,
        [input.userAccountId],
      );
      if (accounts.length !== 1) { throw new Error("web push account was not found"); }
      const account = accounts[0]!.id;
      const [same] = await connection.execute<IdRow[]>(
        `SELECT web_push_subscription_id AS id FROM web_push_subscriptions
         WHERE active_endpoint_sha256 = ? AND user_account_id = ? FOR UPDATE`,
        [endpoint, account],
      );
      if (same.length === 0) {
        // A new browser for this account: make room for it within the quota,
        // retiring the least recently registered ones first.
        const [active] = await connection.execute<IdRow[]>(
          `SELECT web_push_subscription_id AS id FROM web_push_subscriptions
           WHERE user_account_id = ? AND revoked_at_ms IS NULL
           ORDER BY updated_at_ms DESC, web_push_subscription_id DESC
           FOR UPDATE`,
          [account],
        );
        const retire = active.slice(input.maximumActive - 1).map((row) => row.id);
        if (retire.length > 0) {
          await connection.query<ResultSetHeader>(
            `UPDATE web_push_subscriptions SET revoked_at_ms = GREATEST(?, created_at_ms), updated_at_ms = ?
             WHERE web_push_subscription_id IN (?) AND revoked_at_ms IS NULL`,
            [input.nowMs, input.nowMs, retire],
          );
        }
      }
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO web_push_subscriptions
           (user_account_id, endpoint_sha256, subscription_ciphertext,
            encryption_key_version, created_at_ms, updated_at_ms, revoked_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, NULL)
         ON DUPLICATE KEY UPDATE
           user_account_id = VALUES(user_account_id),
           subscription_ciphertext = VALUES(subscription_ciphertext),
           encryption_key_version = VALUES(encryption_key_version),
           created_at_ms = VALUES(created_at_ms),
           updated_at_ms = VALUES(updated_at_ms),
           revoked_at_ms = NULL`,
        [
          account,
          endpoint,
          Buffer.from(input.protectedSubscription.ciphertext),
          input.protectedSubscription.encryptionKeyVersion,
          input.nowMs,
          input.nowMs,
        ],
      );
      if (result.affectedRows < 1) { throw new Error("web push subscription was not saved"); }
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Retention for push subscriptions: trims accounts that hold more active
   * subscriptions than the quota (older installations had none), and deletes
   * subscriptions revoked longer than `revokedRetentionMs` ago together with
   * their finished delivery rows. Each call does a bounded amount of work.
   */
  public async purgeStaleSubscriptions(input: Readonly<{
    nowMs: number;
    maximumActive: number;
    revokedRetentionMs: number;
    batchSize?: number;
  }>): Promise<Readonly<{ trimmed: number; deleted: number }>> {
    const batch = Math.max(1, Math.min(500, input.batchSize ?? 200));
    const [over] = await this.pool.execute<IdRow[]>(
      `SELECT user_account_id AS id FROM web_push_subscriptions
       WHERE revoked_at_ms IS NULL
       GROUP BY user_account_id HAVING COUNT(*) > ?
       LIMIT ${batch}`,
      [input.maximumActive],
    );
    let trimmed = 0;
    for (const { id } of over) {
      const [active] = await this.pool.execute<IdRow[]>(
        `SELECT web_push_subscription_id AS id FROM web_push_subscriptions
         WHERE user_account_id = ? AND revoked_at_ms IS NULL
         ORDER BY updated_at_ms DESC, web_push_subscription_id DESC`,
        [id],
      );
      const retire = active.slice(input.maximumActive).map((row) => row.id);
      if (retire.length === 0) continue;
      const [result] = await this.pool.query<ResultSetHeader>(
        `UPDATE web_push_subscriptions SET revoked_at_ms = GREATEST(?, created_at_ms), updated_at_ms = ?
         WHERE web_push_subscription_id IN (?) AND revoked_at_ms IS NULL`,
        [input.nowMs, input.nowMs, retire],
      );
      trimmed += result.affectedRows;
    }
    const [stale] = await this.pool.execute<IdRow[]>(
      `SELECT web_push_subscription_id AS id FROM web_push_subscriptions
       WHERE revoked_at_ms IS NOT NULL AND revoked_at_ms < ?
       ORDER BY revoked_at_ms ASC
       LIMIT ${batch}`,
      [Math.max(0, input.nowMs - input.revokedRetentionMs)],
    );
    let deleted = 0;
    if (stale.length > 0) {
      const ids = stale.map((row) => row.id);
      const connection = await this.pool.getConnection();
      try {
        await connection.beginTransaction();
        // A revoked subscription has no deliverable rows left; materialize
        // already marked them dead. 'processing' rows are left for their lease.
        await connection.query<ResultSetHeader>(
          `DELETE FROM notification_deliveries
           WHERE web_push_subscription_id IN (?) AND delivery_status <> 'processing'`,
          [ids],
        );
        const [result] = await connection.query<ResultSetHeader>(
          `DELETE FROM web_push_subscriptions
           WHERE web_push_subscription_id IN (?) AND revoked_at_ms IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM notification_deliveries AS delivery
                             WHERE delivery.web_push_subscription_id = web_push_subscriptions.web_push_subscription_id)`,
          [ids],
        );
        deleted = result.affectedRows;
        await connection.commit();
      } catch (error) {
        await connection.rollback().catch(() => undefined);
        throw error;
      } finally {
        connection.release();
      }
    }
    return { trimmed, deleted };
  }

  public async revokeSubscription(
    userAccountId: string,
    endpointSha256: Uint8Array,
    nowMs: number,
  ): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `UPDATE web_push_subscriptions AS subscription
       INNER JOIN user_accounts AS account
         ON account.user_account_id = subscription.user_account_id
       SET subscription.revoked_at_ms = ?, subscription.updated_at_ms = ?
       WHERE account.public_id = ? AND subscription.endpoint_sha256 = ?
         AND subscription.revoked_at_ms IS NULL`,
      [nowMs, nowMs, userAccountId, Buffer.from(endpointSha256)],
    );
  }
}
