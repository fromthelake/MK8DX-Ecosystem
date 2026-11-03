import { createHash } from "node:crypto";

import type { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";

import {
  NOTIFICATION_KINDS,
  type ClaimDecisionNotice,
  type ClaimReviewerNotice,
  type NotificationInbox,
  type NotificationKind,
  type NotificationEventView,
  type NotificationRepository,
  type NotificationView,
  type TournamentSignupNotice,
} from "./notification-service.js";

type PreparedQueryExecutor = Pick<Pool, "execute">;

interface NotificationRow extends RowDataPacket {
  notificationId: unknown;
  notificationKind: unknown;
  actorPlayerId: unknown;
  actorDisplayName: unknown;
  trackId: unknown;
  modeCc: unknown;
  groupId: unknown;
  groupName: unknown;
  tournamentId: unknown;
  tournamentName: unknown;
  detail: unknown;
  actorTimeMs: unknown;
  recipientTimeMs: unknown;
  recipientRank: unknown;
  eventCount: unknown;
  lastEventAtMs: unknown;
  readAtMs: unknown;
}

interface CountRow extends RowDataPacket {
  unreadCount: unknown;
}

interface MemberRow extends RowDataPacket {
  occurredAtMs: unknown;
  actorPlayerId: unknown;
  actorDisplayName: unknown;
  trackId: unknown;
  modeCc: unknown;
  detail: unknown;
  actorTimeMs: unknown;
  recipientTimeMs: unknown;
  recipientRank: unknown;
}

interface NewResultRow extends RowDataPacket {
  trackId: unknown;
  modeCc: unknown;
  totalTimeMs: unknown;
  actorInternalId: unknown;
  actorPublicId: unknown;
}

interface PreviousBestRow extends RowDataPacket {
  previousBestMs: unknown;
}

interface RecipientRow extends RowDataPacket {
  recipientAccountId: unknown;
  recipientBestMs: unknown;
  recipientRank: unknown;
}

interface OwnerRow extends RowDataPacket {
  recipientAccountId: unknown;
  trackId: unknown;
  modeCc: unknown;
}

interface AccountRow extends RowDataPacket {
  accountInternalId: unknown;
}

function kindOf(value: unknown): NotificationKind | null {
  return typeof value === "string" &&
    (NOTIFICATION_KINDS as readonly string[]).includes(value)
    ? value as NotificationKind
    : null;
}

const publishedResultJoin = `
  FROM time_trial_publications AS publication
  INNER JOIN time_trial_submissions AS submission
    ON submission.time_trial_submission_id =
       publication.time_trial_submission_id
  INNER JOIN time_trial_submission_revisions AS revision
    ON revision.time_trial_submission_revision_id =
       publication.current_revision_id`;

const OVERTAKE_COLLAPSE_WINDOW_MS = 2 * 60 * 60 * 1000;

function overtakeAggregationKey(
  actorPlayerId: string,
  trackId: string,
  modeCc: number,
  nowMs: number,
): string {
  const semantic = createHash("sha256")
    .update(`${actorPlayerId}\0${trackId}\0${modeCc}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `overtaken|${semantic}|${Math.floor(nowMs / OVERTAKE_COLLAPSE_WINDOW_MS)}`;
}

export class MysqlNotificationRepository implements NotificationRepository {
  public constructor(private readonly executor: PreparedQueryExecutor) {}

  public async listForAccount(
    userAccountId: string,
  ): Promise<NotificationInbox> {
    const [rows] = await this.executor.execute<NotificationRow[]>(
      `SELECT notification.notification_id AS notificationId,
              notification.notification_kind AS notificationKind,
              actor.public_id AS actorPlayerId,
              actor.display_name AS actorDisplayName,
              notification.track_id AS trackId,
              notification.mode_cc AS modeCc,
              social_group.public_id AS groupId,
              social_group.name AS groupName,
              tournament.public_id AS tournamentId,
              tournament.name AS tournamentName,
              notification.detail AS detail,
              notification.actor_time_ms AS actorTimeMs,
              notification.recipient_time_ms AS recipientTimeMs,
              notification.recipient_rank AS recipientRank,
              notification.event_count AS eventCount,
              notification.last_event_at_ms AS lastEventAtMs,
              notification.read_at_ms AS readAtMs
       FROM notifications AS notification
       INNER JOIN user_accounts AS account
         ON account.user_account_id = notification.user_account_id
       LEFT JOIN players AS actor
         ON actor.player_id = notification.actor_player_id
        AND actor.record_status = 'active'
        AND actor.visibility = 'public'
       LEFT JOIN social_groups AS social_group
         ON social_group.social_group_id = notification.social_group_id
       LEFT JOIN tournaments AS tournament
         ON tournament.tournament_id = notification.tournament_id
        AND tournament.lifecycle_status = 'active'
       WHERE account.public_id = ?
         AND (notification.mode_cc IS NULL
              OR account.time_trial_mode_preference = 'all'
              OR (account.time_trial_mode_preference = '150' AND notification.mode_cc = 150)
              OR (account.time_trial_mode_preference = '200' AND notification.mode_cc = 200))
       ORDER BY (notification.read_at_ms IS NULL) DESC,
                notification.last_event_at_ms DESC,
                notification.notification_id DESC
       LIMIT 30`,
      [userAccountId],
    );
    const [countRows] = await this.executor.execute<CountRow[]>(
      `SELECT COUNT(*) AS unreadCount
       FROM notifications AS notification
       INNER JOIN user_accounts AS account
         ON account.user_account_id = notification.user_account_id
       WHERE account.public_id = ? AND notification.read_at_ms IS NULL
         AND (notification.mode_cc IS NULL
              OR account.time_trial_mode_preference = 'all'
              OR (account.time_trial_mode_preference = '150' AND notification.mode_cc = 150)
              OR (account.time_trial_mode_preference = '200' AND notification.mode_cc = 200))`,
      [userAccountId],
    );
    const notifications: NotificationView[] = [];
    for (const row of rows) {
      const kind = kindOf(row.notificationKind);
      const count = Number(row.eventCount);
      const lastEventAtMs = Number(row.lastEventAtMs);
      if (kind === null || !Number.isSafeInteger(count) ||
          !Number.isSafeInteger(lastEventAtMs)) {
        continue;
      }
      const mode = Number(row.modeCc);
      const actorTimeMs = Number(row.actorTimeMs);
      const recipientTimeMs = Number(row.recipientTimeMs);
      const recipientRank = Number(row.recipientRank);
      notifications.push({
        notificationId: String(row.notificationId),
        kind,
        ...(typeof row.actorPlayerId === "string"
          ? { actorPlayerId: row.actorPlayerId }
          : {}),
        ...(typeof row.actorDisplayName === "string"
          ? { actorDisplayName: row.actorDisplayName }
          : {}),
        ...(typeof row.trackId === "string" ? { trackId: row.trackId } : {}),
        ...(mode === 150 || mode === 200 ? { mode } : {}),
        ...(typeof row.groupId === "string" ? { groupId: row.groupId } : {}),
        ...(typeof row.groupName === "string" ? { groupName: row.groupName } : {}),
        ...(typeof row.tournamentId === "string" ? { tournamentId: row.tournamentId } : {}),
        ...(typeof row.tournamentName === "string" ? { tournamentName: row.tournamentName } : {}),
        ...(typeof row.detail === "string" ? { detail: row.detail } : {}),
        ...(Number.isSafeInteger(actorTimeMs) && actorTimeMs > 0
          ? { actorTimeMs }
          : {}),
        ...(Number.isSafeInteger(recipientTimeMs) && recipientTimeMs > 0
          ? { recipientTimeMs }
          : {}),
        ...(Number.isSafeInteger(actorTimeMs) && actorTimeMs > 0 &&
            Number.isSafeInteger(recipientTimeMs) && recipientTimeMs > actorTimeMs
          ? { deltaMs: actorTimeMs - recipientTimeMs }
          : {}),
        ...(Number.isSafeInteger(recipientRank) && recipientRank > 0
          ? { recipientRank }
          : {}),
        count,
        lastEventAtMs,
        read: row.readAtMs !== null,
      });
    }
    const unreadCount = Number(countRows[0]?.unreadCount);
    return {
      unreadCount: Number.isSafeInteger(unreadCount) ? unreadCount : 0,
      notifications,
    };
  }

  public async markRead(
    userAccountId: string,
    notificationIds: readonly string[] | "all",
    nowMs: number,
  ): Promise<void> {
    if (notificationIds === "all") {
      await this.executor.execute<ResultSetHeader>(
        `UPDATE notifications AS notification
         INNER JOIN user_accounts AS account
           ON account.user_account_id = notification.user_account_id
         SET notification.read_at_ms = ?
         WHERE account.public_id = ? AND notification.read_at_ms IS NULL
           AND (notification.mode_cc IS NULL
                OR account.time_trial_mode_preference = 'all'
                OR (account.time_trial_mode_preference = '150' AND notification.mode_cc = 150)
                OR (account.time_trial_mode_preference = '200' AND notification.mode_cc = 200))`,
        [nowMs, userAccountId],
      );
      return;
    }
    const placeholders = notificationIds.map(() => "?").join(", ");
    await this.executor.execute<ResultSetHeader>(
      `UPDATE notifications AS notification
       INNER JOIN user_accounts AS account
         ON account.user_account_id = notification.user_account_id
       SET notification.read_at_ms = ?
       WHERE account.public_id = ? AND notification.read_at_ms IS NULL
         AND notification.notification_id IN (${placeholders})`,
      [nowMs, userAccountId, ...notificationIds],
    );
  }

  private async upsert(input: Readonly<{
    recipientInternalId: number;
    kind: NotificationKind;
    aggregationKey: string;
    actorInternalId?: number;
    trackId?: string;
    modeCc?: number;
    detail?: string;
    actorTimeMs?: number;
    recipientTimeMs?: number;
    recipientRank?: number;
    tournamentInternalId?: number;
    nowMs: number;
  }>): Promise<void> {
    const [header] = await this.executor.execute<ResultSetHeader>(
      `INSERT INTO notifications
         (user_account_id, notification_kind, aggregation_key,
          actor_player_id, track_id, mode_cc, detail,
          actor_time_ms, recipient_time_ms, recipient_rank, tournament_id, event_count,
          first_event_at_ms, last_event_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON DUPLICATE KEY UPDATE
         notification_id = LAST_INSERT_ID(notification_id),
         event_count = event_count + 1,
         last_event_at_ms = VALUES(last_event_at_ms),
         actor_player_id = VALUES(actor_player_id),
         track_id = VALUES(track_id),
         mode_cc = VALUES(mode_cc),
         detail = VALUES(detail),
         actor_time_ms = VALUES(actor_time_ms),
         recipient_time_ms = VALUES(recipient_time_ms),
         recipient_rank = VALUES(recipient_rank),
         tournament_id = VALUES(tournament_id)`,
      [
        input.recipientInternalId,
        input.kind,
        input.aggregationKey,
        input.actorInternalId ?? null,
        input.trackId ?? null,
        input.modeCc ?? null,
        input.detail ?? null,
        input.actorTimeMs ?? null,
        input.recipientTimeMs ?? null,
        input.recipientRank ?? null,
        input.tournamentInternalId ?? null,
        input.nowMs,
        input.nowMs,
      ],
    );
    // The aggregate keeps the count and the most recent event; this keeps the
    // ones it folded away, so "5 reactions on your time" can be opened and
    // read. `LAST_INSERT_ID(notification_id)` in the upsert above makes
    // `insertId` the aggregate's id on the update path as well as the insert
    // path, so a member always attaches to the entry that counted it.
    const aggregateId = Number(header.insertId);
    if (!Number.isSafeInteger(aggregateId) || aggregateId <= 0) { return; }
    await this.executor.execute(
      `INSERT INTO notification_events
         (notification_id, occurred_at_ms, actor_player_id, track_id, mode_cc,
          detail, actor_time_ms, recipient_time_ms, recipient_rank)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        aggregateId,
        input.nowMs,
        input.actorInternalId ?? null,
        input.trackId ?? null,
        input.modeCc ?? null,
        input.detail ?? null,
        input.actorTimeMs ?? null,
        input.recipientTimeMs ?? null,
        input.recipientRank ?? null,
      ],
    );
  }

  /**
   * What an entry counted, most recent first.
   *
   * Scoped by the account that owns the entry, not only by its id: an inbox is
   * the one place where reading somebody else's row would be a privacy failure
   * rather than a bug. An entry aggregated before members were kept answers
   * honestly with an empty list; it is not an error.
   */
  public async listEventsForAccount(
    userAccountId: string,
    notificationId: string,
    limit: number,
  ): Promise<readonly NotificationEventView[]> {
    const [rows] = await this.executor.execute<MemberRow[]>(
      `SELECT event.occurred_at_ms AS occurredAtMs,
              actor.public_id AS actorPlayerId,
              actor.display_name AS actorDisplayName,
              event.track_id AS trackId,
              event.mode_cc AS modeCc,
              event.detail AS detail,
              event.actor_time_ms AS actorTimeMs,
              event.recipient_time_ms AS recipientTimeMs,
              event.recipient_rank AS recipientRank
       FROM notification_events AS event
       INNER JOIN notifications AS notification
         ON notification.notification_id = event.notification_id
       INNER JOIN user_accounts AS account
         ON account.user_account_id = notification.user_account_id
       LEFT JOIN players AS actor ON actor.player_id = event.actor_player_id
       WHERE account.public_id = ? AND notification.notification_id = ?
       ORDER BY event.occurred_at_ms DESC, event.notification_event_id DESC
       LIMIT ${Math.trunc(limit)}`,
      [userAccountId, notificationId],
    );
    return rows.map((row) => ({
      occurredAtMs: Number(row.occurredAtMs),
      ...(typeof row.actorPlayerId === "string" ? { actorPlayerId: row.actorPlayerId } : {}),
      ...(typeof row.actorDisplayName === "string" ? { actorDisplayName: row.actorDisplayName } : {}),
      ...(typeof row.trackId === "string" ? { trackId: row.trackId } : {}),
      ...(Number(row.modeCc) === 150 || Number(row.modeCc) === 200
        ? { mode: Number(row.modeCc) as 150 | 200 } : {}),
      ...(typeof row.detail === "string" ? { detail: row.detail } : {}),
      ...(Number.isSafeInteger(Number(row.actorTimeMs)) && row.actorTimeMs !== null
        ? { actorTimeMs: Number(row.actorTimeMs) } : {}),
      ...(Number.isSafeInteger(Number(row.recipientTimeMs)) && row.recipientTimeMs !== null
        ? { recipientTimeMs: Number(row.recipientTimeMs) } : {}),
      ...(Number.isSafeInteger(Number(row.recipientRank)) && row.recipientRank !== null
        ? { recipientRank: Number(row.recipientRank) } : {}),
    }));
  }

  public async produceOvertaken(
    submissionPublicId: string,
    nowMs: number,
  ): Promise<void> {
    const [results] = await this.executor.execute<NewResultRow[]>(
      `SELECT revision.track_id AS trackId,
              revision.mode_cc AS modeCc,
              revision.total_time_ms AS totalTimeMs,
              revision.player_id AS actorInternalId,
              actor.public_id AS actorPublicId
       ${publishedResultJoin}
       INNER JOIN players AS actor ON actor.player_id = revision.player_id
        AND actor.player_kind = 'human'
        AND actor.record_status = 'active' AND actor.visibility = 'public'
       WHERE submission.public_id = ?
         AND publication.publication_status = 'published'
       LIMIT 1`,
      [submissionPublicId],
    );
    const newResult = results[0];
    if (newResult === undefined ||
        typeof newResult.trackId !== "string" ||
        typeof newResult.actorPublicId !== "string") {
      return;
    }
    const trackId = newResult.trackId;
    const modeCc = Number(newResult.modeCc);
    const totalTimeMs = Number(newResult.totalTimeMs);
    const actorInternalId = Number(newResult.actorInternalId);
    if (!Number.isSafeInteger(modeCc) || !Number.isSafeInteger(totalTimeMs) ||
        !Number.isSafeInteger(actorInternalId)) {
      return;
    }
    const [previousRows] = await this.executor.execute<PreviousBestRow[]>(
      `SELECT MIN(candidate.totalTimeMs) AS previousBestMs
       FROM (
         SELECT revision.total_time_ms AS totalTimeMs
         ${publishedResultJoin}
         WHERE publication.publication_status = 'published'
           AND revision.player_id = ?
           AND revision.track_id = ? AND revision.mode_cc = ?
           AND submission.public_id <> ?
         UNION ALL
         SELECT prior_revision.total_time_ms AS totalTimeMs
         FROM time_trial_publications AS current_publication
         INNER JOIN time_trial_submissions AS current_submission
           ON current_submission.time_trial_submission_id =
              current_publication.time_trial_submission_id
         INNER JOIN time_trial_publication_lifecycle AS lifecycle
           ON lifecycle.time_trial_publication_id =
              current_publication.time_trial_publication_id
          AND lifecycle.sequence_number < current_publication.publication_revision
          AND lifecycle.publication_status_after = 'published'
         INNER JOIN time_trial_submission_revisions AS prior_revision
           ON prior_revision.time_trial_submission_revision_id =
              lifecycle.time_trial_submission_revision_id
         WHERE current_submission.public_id = ?
           AND prior_revision.player_id = ?
           AND prior_revision.track_id = ? AND prior_revision.mode_cc = ?
       ) AS candidate`,
      [
        actorInternalId, trackId, modeCc, submissionPublicId,
        submissionPublicId, actorInternalId, trackId, modeCc,
      ],
    );
    const previousBest = Number(previousRows[0]?.previousBestMs);
    const previousBestMs = Number.isSafeInteger(previousBest)
      ? previousBest
      : null;
    if (previousBestMs !== null && previousBestMs <= totalTimeMs) {
      // Not a personal improvement: nobody was newly overtaken.
      return;
    }
    const aggregationKey = overtakeAggregationKey(
      newResult.actorPublicId, trackId, modeCc, nowMs,
    );
    const [recipients] = await this.executor.execute<RecipientRow[]>(
      `WITH ranked AS (
         SELECT best.player_id AS playerInternalId,
                best.total_time_ms AS totalTimeMs,
                RANK() OVER (ORDER BY best.total_time_ms ASC) AS recipientRank
         FROM time_trial_player_bests AS best
         INNER JOIN players AS player ON player.player_id = best.player_id
          AND player.player_kind = 'human'
          AND player.record_status = 'active' AND player.visibility = 'public'
         WHERE best.track_id = ? AND best.mode_cc = ?
           AND best.public_eligible = 1
       )
       SELECT claim.user_account_id AS recipientAccountId,
              ranked.totalTimeMs AS recipientBestMs,
              ranked.recipientRank AS recipientRank
       FROM ranked
       INNER JOIN player_claims AS claim
         ON claim.claim_status = 'verified'
        AND claim.player_id = ranked.playerInternalId
       WHERE ranked.playerInternalId <> ?
         AND ranked.totalTimeMs > ?
         AND ((? IS NULL OR ranked.totalTimeMs <= ?)
              OR EXISTS (
                SELECT 1 FROM notifications AS existing
                WHERE existing.user_account_id = claim.user_account_id
                  AND existing.notification_kind = 'overtaken'
                  AND existing.aggregation_key = ?
                  AND existing.read_at_ms IS NULL
              ))`,
      [
        trackId,
        modeCc,
        actorInternalId,
        totalTimeMs,
        previousBestMs,
        previousBestMs,
        aggregationKey,
      ],
    );
    for (const recipient of recipients) {
      const recipientInternalId = Number(recipient.recipientAccountId);
      const recipientTimeMs = Number(recipient.recipientBestMs);
      const recipientRank = Number(recipient.recipientRank);
      if (!Number.isSafeInteger(recipientInternalId) ||
          !Number.isSafeInteger(recipientTimeMs) ||
          !Number.isSafeInteger(recipientRank)) { continue; }
      await this.upsert({
        recipientInternalId,
        kind: "overtaken",
        aggregationKey,
        actorInternalId,
        trackId,
        modeCc,
        actorTimeMs: totalTimeMs,
        recipientTimeMs,
        recipientRank,
        nowMs,
      });
    }
  }

  public async produceReactionReceived(
    resultPublicId: string,
    nowMs: number,
  ): Promise<void> {
    const [owners] = await this.executor.execute<OwnerRow[]>(
      `SELECT claim.user_account_id AS recipientAccountId,
              revision.track_id AS trackId,
              revision.mode_cc AS modeCc
       ${publishedResultJoin}
       INNER JOIN player_claims AS claim
         ON claim.claim_status = 'verified'
        AND claim.player_id = revision.player_id
       WHERE submission.public_id = ?
         AND publication.publication_status = 'published'
       LIMIT 1`,
      [resultPublicId],
    );
    const owner = owners[0];
    if (owner === undefined) { return; }
    const recipientInternalId = Number(owner.recipientAccountId);
    const modeCc = Number(owner.modeCc);
    if (!Number.isSafeInteger(recipientInternalId)) { return; }
    await this.upsert({
      recipientInternalId,
      kind: "reaction_received",
      aggregationKey: `reaction|${resultPublicId}`,
      ...(typeof owner.trackId === "string"
        ? { trackId: owner.trackId }
        : {}),
      ...(Number.isSafeInteger(modeCc) ? { modeCc } : {}),
      nowMs,
    });
  }

  /**
   * Every active administrator, and every Director of a Tournament the Player
   * took part in (ADR-0216), hears that somebody asked to be linked to a
   * Player or answered a reviewer's question. The claimed Player is the
   * entry's actor, so the line can name it. One entry per claim, reviewer and
   * kind of news, however often it is re-read; the person asking is never
   * their own reviewer.
   */
  public async produceClaimRequested(
    playerClaimId: string,
    playerPublicId: string,
    nowMs: number,
    detail: ClaimReviewerNotice = "requested",
  ): Promise<void> {
    const [players] = await this.executor.execute<RowDataPacket[]>(
      `SELECT player_id AS playerInternalId FROM players WHERE public_id = ? LIMIT 1`,
      [playerPublicId],
    );
    const actorInternalId = Number(players[0]?.["playerInternalId"]);
    const [reviewers] = await this.executor.execute<AccountRow[]>(
      `SELECT reviewer.accountInternalId FROM (
         SELECT grant_record.user_account_id AS accountInternalId
         FROM administrator_grants AS grant_record
         INNER JOIN user_accounts AS account
           ON account.user_account_id = grant_record.user_account_id
         WHERE grant_record.grant_status = 'active'
           AND account.account_status = 'active'
         UNION
         SELECT tournament.director_user_account_id AS accountInternalId
         FROM tournaments AS tournament
         INNER JOIN tournament_participants AS participant
           ON participant.tournament_id = tournament.tournament_id
         INNER JOIN user_accounts AS director
           ON director.user_account_id = tournament.director_user_account_id
         WHERE participant.player_id = ? AND director.account_status = 'active'
       ) AS reviewer
       WHERE reviewer.accountInternalId NOT IN (
         SELECT claim.user_account_id FROM player_claims AS claim WHERE claim.public_id = ?
       )
       LIMIT 50`,
      [Number.isSafeInteger(actorInternalId) ? actorInternalId : 0, playerClaimId],
    );
    for (const reviewer of reviewers) {
      const recipientInternalId = Number(reviewer.accountInternalId);
      if (!Number.isSafeInteger(recipientInternalId)) { continue; }
      await this.upsert({
        recipientInternalId,
        kind: "claim_requested",
        aggregationKey: detail === "requested"
          ? `claim_requested|${playerClaimId}`
          : `claim_reply|${playerClaimId}`,
        ...(Number.isSafeInteger(actorInternalId) ? { actorInternalId } : {}),
        detail,
        nowMs,
      });
    }
  }

  public async produceClaimDecided(
    userAccountPublicId: string,
    decision: ClaimDecisionNotice,
    nowMs: number,
  ): Promise<void> {
    const [accounts] = await this.executor.execute<AccountRow[]>(
      `SELECT user_account_id AS accountInternalId
       FROM user_accounts WHERE public_id = ? LIMIT 1`,
      [userAccountPublicId],
    );
    const recipientInternalId = Number(accounts[0]?.accountInternalId);
    if (!Number.isSafeInteger(recipientInternalId)) { return; }
    await this.upsert({
      recipientInternalId,
      kind: "claim_decided",
      aggregationKey: `claim|${decision}`,
      detail: decision,
      nowMs,
    });
  }

  /**
   * Every active administrator hears that an account asked to host Tournaments (ADR-0220). The
   * asking account's first verified Player is the entry's actor, so the line can name who asks;
   * an account without one is "somebody". One entry per request and administrator.
   */
  public async produceHostRequested(requestPublicId: string, nowMs: number): Promise<void> {
    const [requests] = await this.executor.execute<RowDataPacket[]>(
      `SELECT request.user_account_id AS accountInternalId,
              (SELECT claim.player_id FROM player_claims AS claim
               WHERE claim.user_account_id = request.user_account_id AND claim.claim_status = 'verified'
               ORDER BY claim.updated_at_ms ASC LIMIT 1) AS actorInternalId
       FROM director_host_requests AS request
       WHERE request.public_id = ? LIMIT 1`,
      [requestPublicId],
    );
    const request = requests[0];
    if (request === undefined) { return; }
    const requesterInternalId = Number(request["accountInternalId"]);
    const actorInternalId = Number(request["actorInternalId"]);
    const [administrators] = await this.executor.execute<AccountRow[]>(
      `SELECT grant_record.user_account_id AS accountInternalId
       FROM administrator_grants AS grant_record
       INNER JOIN user_accounts AS account
         ON account.user_account_id = grant_record.user_account_id
       WHERE grant_record.grant_status = 'active'
         AND account.account_status = 'active'
         AND grant_record.user_account_id <> ?
       LIMIT 50`,
      [requesterInternalId],
    );
    for (const administrator of administrators) {
      const recipientInternalId = Number(administrator.accountInternalId);
      if (!Number.isSafeInteger(recipientInternalId)) { continue; }
      await this.upsert({
        recipientInternalId,
        kind: "host_requested",
        aggregationKey: `host_requested|${requestPublicId}`,
        ...(request["actorInternalId"] !== null && Number.isSafeInteger(actorInternalId)
          ? { actorInternalId } : {}),
        detail: "requested",
        nowMs,
      });
    }
  }

  /**
   * A Player's sign-up status changed (ADR-0222): the account that signed up hears it, with the
   * night attached so the entry opens that night's page. One entry per night and kind; a later
   * change of the same kind updates it.
   */
  public async produceTournamentSignup(notice: TournamentSignupNotice, nowMs: number): Promise<void> {
    if (!Number.isSafeInteger(notice.recipientInternalId) || !Number.isSafeInteger(notice.tournamentInternalId)) {
      return;
    }
    await this.upsert({
      recipientInternalId: notice.recipientInternalId,
      kind: notice.kind,
      aggregationKey: `${notice.kind}|${notice.tournamentInternalId}`,
      detail: notice.detail,
      tournamentInternalId: notice.tournamentInternalId,
      nowMs,
    });
  }

  /** The person who asked to host hears the answer: approved or declined (ADR-0220). */
  public async produceHostRequestDecided(
    requestPublicId: string,
    userAccountPublicId: string,
    decision: "approved" | "declined",
    nowMs: number,
  ): Promise<void> {
    const [accounts] = await this.executor.execute<AccountRow[]>(
      `SELECT user_account_id AS accountInternalId
       FROM user_accounts WHERE public_id = ? LIMIT 1`,
      [userAccountPublicId],
    );
    const recipientInternalId = Number(accounts[0]?.accountInternalId);
    if (!Number.isSafeInteger(recipientInternalId)) { return; }
    await this.upsert({
      recipientInternalId,
      kind: "host_request_decided",
      aggregationKey: `host_request_decided|${requestPublicId}`,
      detail: decision,
      nowMs,
    });
  }
}
