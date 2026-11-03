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
  }>): Promise<void> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO web_push_subscriptions
         (user_account_id, endpoint_sha256, subscription_ciphertext,
          encryption_key_version, created_at_ms, updated_at_ms, revoked_at_ms)
       SELECT user_account_id, ?, ?, ?, ?, ?, NULL
       FROM user_accounts WHERE public_id = ?
       ON DUPLICATE KEY UPDATE
         user_account_id = VALUES(user_account_id),
         subscription_ciphertext = VALUES(subscription_ciphertext),
         encryption_key_version = VALUES(encryption_key_version),
         created_at_ms = VALUES(created_at_ms),
         updated_at_ms = VALUES(updated_at_ms),
         revoked_at_ms = NULL`,
      [
        Buffer.from(input.endpointSha256),
        Buffer.from(input.protectedSubscription.ciphertext),
        input.protectedSubscription.encryptionKeyVersion,
        input.nowMs,
        input.nowMs,
        input.userAccountId,
      ],
    );
    if (result.affectedRows < 1) { throw new Error("web push subscription was not saved"); }
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
