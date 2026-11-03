import webPush, { type PushSubscription } from "web-push";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { TRACK_SOCIAL } from "../runtime/track-social-manifest.js";
import type { ProtectedValue } from "../timetrials/submission-service.js";
import type { WebPushSubscriptionInput } from "./notification-channel-service.js";

export type WebPushConfiguration = Readonly<{
  subject: string;
  publicKey: string;
  privateKey: string;
}>;

export interface WebPushSubscriptionReader {
  decryptSubscription(value: ProtectedValue): string;
}

interface DeliveryRow extends RowDataPacket {
  deliveryId: unknown;
  subscriptionId: unknown;
  notificationId: unknown;
  eventRevision: unknown;
  subscriptionCiphertext: unknown;
  encryptionKeyVersion: unknown;
  kind: unknown;
  actorPlayerId: unknown;
  actorDisplayName: unknown;
  detail: unknown;
  tournamentId: unknown;
  tournamentName: unknown;
  trackId: unknown;
  modeCc: unknown;
  actorTimeMs: unknown;
  recipientTimeMs: unknown;
  recipientRank: unknown;
  unreadCount: unknown;
}

type ClaimedDelivery = Readonly<{
  deliveryId: number;
  subscriptionId: number;
  notificationId: string;
  eventRevision: number;
  subscription: PushSubscription;
  kind: string;
  actorPlayerId?: string;
  actorDisplayName?: string;
  detail?: string;
  tournamentId?: string;
  tournamentName?: string;
  trackId?: string;
  mode?: 150 | 200;
  actorTimeMs?: number;
  recipientTimeMs?: number;
  recipientRank?: number;
  unreadCount: number;
}>;

function integer(value: unknown, minimum: number): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) throw new Error("invalid delivery row");
  return number;
}

export class MysqlWebPushDeliveryRepository {
  public constructor(
    private readonly pool: Pool,
    private readonly reader: WebPushSubscriptionReader,
  ) {}

  public async materialize(nowMs: number): Promise<void> {
    // A process interrupted during network I/O leaves a bounded lease. The
    // same target/revision unique key prevents a second delivery row.
    await this.pool.execute<ResultSetHeader>(
      `UPDATE notification_deliveries
       SET delivery_status = 'retry', next_attempt_at_ms = ?
       WHERE delivery_status = 'processing'
         AND last_attempt_at_ms < ?`,
      [nowMs, Math.max(0, nowMs - 10 * 60 * 1000)],
    );
    await this.pool.execute<ResultSetHeader>(
      `UPDATE notification_deliveries AS delivery
       INNER JOIN notifications AS notification
         ON notification.notification_id = delivery.notification_id
       INNER JOIN web_push_subscriptions AS subscription
         ON subscription.web_push_subscription_id = delivery.web_push_subscription_id
       LEFT JOIN notification_preferences AS preference
         ON preference.user_account_id = notification.user_account_id
       SET delivery.delivery_status = 'dead',
           delivery.last_error_code = 'no_longer_eligible'
       WHERE delivery.delivery_status IN ('pending', 'retry')
         AND (notification.read_at_ms IS NOT NULL
              OR subscription.user_account_id <> notification.user_account_id
              OR subscription.revoked_at_ms IS NOT NULL
              OR (notification.notification_kind = 'overtaken'
                  AND NOT COALESCE(preference.competitive_overtaken, TRUE))
              OR (notification.notification_kind = 'reaction_received'
                  AND NOT COALESCE(preference.activity_reactions, TRUE))
              -- The scope is the outer gate: it decides whether a kind may be
              -- delivered at all, before the per-kind switches are consulted.
              OR COALESCE(preference.notification_scope, 'all') = 'none'
              OR (COALESCE(preference.notification_scope, 'all') = 'world_records'
                  AND notification.notification_kind <> 'world_record')
              OR (COALESCE(preference.notification_scope, 'all') = 'rivals'
                  AND notification.notification_kind NOT IN
                      ('overtaken', 'reaction_received', 'result_published')))`,
    );
    await this.pool.execute<ResultSetHeader>(
      `INSERT IGNORE INTO notification_deliveries
         (notification_id, web_push_subscription_id, event_revision,
          delivery_status, attempt_count, next_attempt_at_ms)
       SELECT notification.notification_id,
              subscription.web_push_subscription_id,
              notification.event_count, 'pending', 0, ?
       FROM notifications AS notification
       INNER JOIN web_push_subscriptions AS subscription
         ON subscription.user_account_id = notification.user_account_id
        AND subscription.revoked_at_ms IS NULL
        AND notification.last_event_at_ms >= subscription.created_at_ms
       LEFT JOIN notification_preferences AS preference
         ON preference.user_account_id = notification.user_account_id
       WHERE notification.read_at_ms IS NULL
         AND (notification.notification_kind <> 'overtaken'
              OR COALESCE(preference.competitive_overtaken, TRUE))
         AND (notification.notification_kind <> 'reaction_received'
              OR COALESCE(preference.activity_reactions, TRUE))
         AND COALESCE(preference.notification_scope, 'all') <> 'none'
         AND (COALESCE(preference.notification_scope, 'all') <> 'world_records'
              OR notification.notification_kind = 'world_record')
         AND (COALESCE(preference.notification_scope, 'all') <> 'rivals'
              OR notification.notification_kind IN
                 ('overtaken', 'reaction_received', 'result_published'))`,
      [nowMs],
    );
  }

  public async claim(nowMs: number, limit = 20): Promise<readonly ClaimedDelivery[]> {
    const [rows] = await this.pool.execute<DeliveryRow[]>(
      `SELECT delivery.notification_delivery_id AS deliveryId,
              subscription.web_push_subscription_id AS subscriptionId,
              notification.notification_id AS notificationId,
              delivery.event_revision AS eventRevision,
              subscription.subscription_ciphertext AS subscriptionCiphertext,
              subscription.encryption_key_version AS encryptionKeyVersion,
              notification.notification_kind AS kind,
              actor.public_id AS actorPlayerId,
              actor.display_name AS actorDisplayName,
              notification.detail AS detail,
              tournament.public_id AS tournamentId,
              tournament.name AS tournamentName,
              notification.track_id AS trackId,
              notification.mode_cc AS modeCc,
              notification.actor_time_ms AS actorTimeMs,
              notification.recipient_time_ms AS recipientTimeMs,
              notification.recipient_rank AS recipientRank,
              (SELECT COUNT(*) FROM notifications AS unread
               WHERE unread.user_account_id = notification.user_account_id
                 AND unread.read_at_ms IS NULL) AS unreadCount
       FROM notification_deliveries AS delivery
       INNER JOIN notifications AS notification
         ON notification.notification_id = delivery.notification_id
       INNER JOIN web_push_subscriptions AS subscription
         ON subscription.web_push_subscription_id = delivery.web_push_subscription_id
        AND subscription.user_account_id = notification.user_account_id
        AND subscription.revoked_at_ms IS NULL
       LEFT JOIN players AS actor ON actor.player_id = notification.actor_player_id
       LEFT JOIN tournaments AS tournament ON tournament.tournament_id = notification.tournament_id
       WHERE delivery.delivery_status IN ('pending', 'retry')
         AND delivery.next_attempt_at_ms <= ?
       ORDER BY delivery.next_attempt_at_ms ASC, delivery.notification_delivery_id ASC
       LIMIT ${Math.max(1, Math.min(50, limit))}`,
      [nowMs],
    );
    const claimed: ClaimedDelivery[] = [];
    for (const row of rows) {
      const deliveryId = integer(row.deliveryId, 1);
      const [result] = await this.pool.execute<ResultSetHeader>(
        `UPDATE notification_deliveries
         SET delivery_status = 'processing', attempt_count = attempt_count + 1,
             last_attempt_at_ms = ?
         WHERE notification_delivery_id = ?
           AND delivery_status IN ('pending', 'retry')`,
        [nowMs, deliveryId],
      );
      if (result.affectedRows !== 1) continue;
      const plaintext = this.reader.decryptSubscription({
        ciphertext: Uint8Array.from(row.subscriptionCiphertext as Uint8Array),
        encryptionKeyVersion: String(row.encryptionKeyVersion),
      });
      const subscription = JSON.parse(plaintext) as WebPushSubscriptionInput;
      const mode = Number(row.modeCc);
      const actorTimeMs = Number(row.actorTimeMs);
      const recipientTimeMs = Number(row.recipientTimeMs);
      const recipientRank = Number(row.recipientRank);
      claimed.push({
        deliveryId,
        subscriptionId: integer(row.subscriptionId, 1),
        notificationId: String(row.notificationId),
        eventRevision: integer(row.eventRevision, 1),
        subscription,
        kind: String(row.kind),
        ...(typeof row.actorPlayerId === "string" ? { actorPlayerId: row.actorPlayerId } : {}),
        ...(typeof row.actorDisplayName === "string" ? { actorDisplayName: row.actorDisplayName } : {}),
        ...(typeof row.detail === "string" ? { detail: row.detail } : {}),
        ...(typeof row.tournamentId === "string" ? { tournamentId: row.tournamentId } : {}),
        ...(typeof row.tournamentName === "string" ? { tournamentName: row.tournamentName } : {}),
        ...(typeof row.trackId === "string" ? { trackId: row.trackId } : {}),
        ...(mode === 150 || mode === 200 ? { mode } : {}),
        ...(Number.isSafeInteger(actorTimeMs) && actorTimeMs > 0 ? { actorTimeMs } : {}),
        ...(Number.isSafeInteger(recipientTimeMs) && recipientTimeMs > 0 ? { recipientTimeMs } : {}),
        ...(Number.isSafeInteger(recipientRank) && recipientRank > 0 ? { recipientRank } : {}),
        unreadCount: integer(row.unreadCount, 0),
      });
    }
    return claimed;
  }

  public async delivered(deliveryId: number, nowMs: number): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `UPDATE notification_deliveries
       SET delivery_status = 'delivered', delivered_at_ms = ?, last_error_code = NULL
       WHERE notification_delivery_id = ? AND delivery_status = 'processing'`,
      [nowMs, deliveryId],
    );
  }

  public async failed(input: Readonly<{
    deliveryId: number;
    subscriptionId: number;
    nowMs: number;
    permanent: boolean;
    expiredSubscription: boolean;
    errorCode: string;
  }>): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT attempt_count AS attemptCount FROM notification_deliveries
         WHERE notification_delivery_id = ? FOR UPDATE`,
        [input.deliveryId],
      );
      const attempts = integer(rows[0]?.attemptCount, 1);
      const dead = input.permanent || attempts >= 5;
      const delay = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000][
        Math.min(attempts - 1, 3)
      ]!;
      await connection.execute<ResultSetHeader>(
        `UPDATE notification_deliveries
         SET delivery_status = ?, next_attempt_at_ms = ?, last_error_code = ?
         WHERE notification_delivery_id = ?`,
        [dead ? "dead" : "retry", input.nowMs + delay, input.errorCode.slice(0, 32), input.deliveryId],
      );
      if (input.expiredSubscription) {
        await connection.execute<ResultSetHeader>(
          `UPDATE web_push_subscriptions SET revoked_at_ms = ?, updated_at_ms = ?
           WHERE web_push_subscription_id = ? AND revoked_at_ms IS NULL`,
          [input.nowMs, input.nowMs, input.subscriptionId],
        );
      }
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
}

function seconds(milliseconds: number): string {
  return `${(Math.abs(milliseconds) / 1000).toFixed(3)}s`;
}

/** "1:59.317", or nothing when there is no time to show. */
function lapTime(totalMs: number | undefined): string | undefined {
  if (totalMs === undefined || totalMs <= 0) return undefined;
  const minutes = Math.floor(totalMs / 60_000);
  const rest = Math.floor((totalMs % 60_000) / 1000);
  return `${minutes}:${String(rest).padStart(2, "0")}.${String(totalMs % 1000).padStart(3, "0")}`;
}

/**
 * What a push says, and where it opens.
 *
 * A push is read on a lock screen next to twenty others, so the title names
 * the thing that happened - who, how much, which track - and the body carries
 * the evidence. The wording is the twin of the inbox line in
 * `apps/timetrials-web/src/notification-section.ts` and of the phone's own
 * `androidNotificationPresentation`; three surfaces, one sentence.
 */
function presentation(delivery: ClaimedDelivery): Readonly<{
  title: string; body: string; url: string;
}> {
  const actor = delivery.actorDisplayName ?? "Iemand";
  const track = delivery.trackId === undefined
    ? undefined
    : TRACK_SOCIAL[delivery.trackId]?.name ?? delivery.trackId;
  const onTrack = track === undefined ? "" : ` op ${track}`;
  const mode = delivery.mode === undefined ? undefined : `${delivery.mode}cc`;
  const yours = lapTime(delivery.recipientTimeMs);
  const theirs = lapTime(delivery.actorTimeMs);
  const url = delivery.trackId === undefined
    ? "/?notifications=1"
    : `/?leaderboard=${encodeURIComponent(delivery.trackId)}&mode=${delivery.mode ?? 150}&notification=${delivery.notificationId}`;
  const line = (...parts: ReadonlyArray<string | undefined>): string =>
    parts.filter((part): part is string => part !== undefined && part !== "").join(" · ");
  if (delivery.kind === "overtaken") {
    const gap = delivery.actorTimeMs !== undefined && delivery.recipientTimeMs !== undefined
      ? seconds(delivery.actorTimeMs - delivery.recipientTimeMs).replace(".", ",")
      : undefined;
    return {
      title: gap === undefined
        ? `${actor} was sneller dan jij${onTrack}`
        : `${actor} was ${gap} sneller${onTrack}`,
      body: line(
        mode,
        theirs === undefined || yours === undefined ? theirs : `${theirs} tegen jouw ${yours}`,
        delivery.recipientRank === undefined ? undefined : `jij staat nu #${delivery.recipientRank}`,
      ),
      url,
    };
  }
  if (delivery.kind === "world_record") {
    return {
      title: `Nieuw wereldrecord${onTrack}`,
      body: line(mode, theirs, "tik om de run te bekijken"),
      url: delivery.trackId === undefined ? "/?ranking=timetrials" : url,
    };
  }
  if (delivery.kind === "reaction_received") {
    return {
      title: `${actor} reageerde op je tijd${onTrack}`,
      body: line(mode, yours),
      url,
    };
  }
  if (delivery.kind === "result_published") {
    return { title: `Je tijd${onTrack} staat online`, body: line(mode, yours), url };
  }
  // Administrators and Directors review under Beheer (ADR-0216).
  if (delivery.kind === "claim_requested") {
    return {
      title: delivery.detail === "reply"
        ? `Antwoord op je vraag over ${actor}`
        : `Iemand wil gekoppeld worden aan ${actor}`,
      body: "Beoordeel het onder Beheer.",
      url: "/?admin=1",
    };
  }
  if (delivery.kind === "claim_decided") {
    const titles: Readonly<Record<string, string>> = {
      verified: "Je koppelverzoek is goedgekeurd",
      rejected: "Je koppelverzoek is afgewezen",
      info_requested: "Een vraag over je koppelverzoek",
      revoked: "Je spelerkoppeling is verwijderd",
      released: "Je spelerkoppeling is gesloten",
    };
    return {
      title: titles[delivery.detail ?? ""] ?? "Je koppelverzoek is beoordeeld",
      body: delivery.detail === "info_requested"
        ? "Beantwoord de vraag in Instellingen."
        : "Open Instellingen voor de uitkomst.",
      url: "/?settings=1",
    };
  }
  // "Verzoek om te hosten" (ADR-0220): administrators decide in Beheer, the person reads the answer
  // on the Toernooien page.
  if (delivery.kind === "host_requested") {
    return {
      title: delivery.actorDisplayName === undefined
        ? "Iemand wil toernooien hosten"
        : `${actor} wil toernooien hosten`,
      body: "Beslis onder Beheer → Toernooien → Directeuren.",
      url: "/?admin=tournaments",
    };
  }
  if (delivery.kind === "host_request_decided") {
    return {
      title: delivery.detail === "approved"
        ? "Je bent nu Directeur"
        : "Je verzoek om te hosten is afgewezen",
      body: delivery.detail === "approved"
        ? "Je kunt nu zelf toernooien hosten."
        : "Open Toernooien voor de reden.",
      url: "/?tournaments=1",
    };
  }
  // Open sign-up (ADR-0222): every change of a Player's status opens that night's page.
  if (delivery.kind === "tournament_signup_selected" || delivery.kind === "tournament_signup_moved_up" ||
      delivery.kind === "tournament_signup_removed") {
    const night = delivery.tournamentName ?? "het toernooi";
    const nightUrl = delivery.tournamentId === undefined
      ? "/?tournaments=1"
      : `/?tournaments=${encodeURIComponent(delivery.tournamentId)}`;
    if (delivery.kind === "tournament_signup_removed") {
      return { title: `De Directeur heeft je van de lijst gehaald`, body: night, url: nightUrl };
    }
    if (delivery.kind === "tournament_signup_moved_up") {
      return { title: `Je doet mee: je bent van de wachtlijst doorgeschoven`, body: night, url: nightUrl };
    }
    return delivery.detail === "waiting"
      ? { title: "Je staat op de wachtlijst", body: night, url: nightUrl }
      : { title: "Je doet mee", body: night, url: nightUrl };
  }
  // Pokes and games open "Jij en <speler>" on the sender's page, where they are answered.
  const conversation = delivery.actorPlayerId === undefined
    ? "/?notifications=1#player-games"
    : `/?player=${encodeURIComponent(delivery.actorPlayerId)}#interactions`;
  if (delivery.kind === "poke") {
    return { title: `${actor} gaf je een por`, body: "Open om terug te porren.", url: conversation };
  }
  if (delivery.kind === "rock_paper_scissors") {
    return {
      title: delivery.detail === "result"
        ? `${actor} beantwoordde je steen-papier-schaarspel`
        : `${actor} daagde je uit voor steen-papier-schaar`,
      body: delivery.detail === "result" ? "Bekijk de uitslag." : "Kies jouw zet.",
      url: conversation,
    };
  }
  if (delivery.kind === "dice_roll") {
    // An invitation carries the sender's face ("4"); an answer "<their face> vs <yours>".
    const result = /^(\d) vs (\d)$/u.exec(delivery.detail ?? "");
    if (result !== null) {
      const [theirs, yours] = [Number(result[1]), Number(result[2])];
      const verdict = theirs === yours ? "gelijkspel" : yours > theirs ? "jij wint" : `${actor} wint`;
      return { title: `${actor} gooide ${theirs} tegen jouw ${yours}`, body: `🎲 ${verdict}`, url: conversation };
    }
    return /^\d$/u.test(delivery.detail ?? "")
      ? { title: `${actor} gooide ${delivery.detail ?? ""}`, body: "🎲 Gooi terug om te winnen.", url: conversation }
      : { title: `${actor} gooide een dobbelsteen`, body: "🎲", url: conversation };
  }
  if (delivery.kind === "challenge") {
    return {
      title: `${actor} daagde je uit${onTrack}`,
      body: line(mode, theirs === undefined ? undefined : `verbeter ${theirs}`),
      url,
    };
  }
  return {
    title: "Nieuw in MK8DX",
    body: "Open de app om het te lezen.",
    url: "/?notifications=1",
  };
}

export class WebPushDeliveryWorker {
  private running = false;

  public constructor(
    private readonly repository: MysqlWebPushDeliveryRepository,
    configuration: WebPushConfiguration,
    private readonly now: () => number = Date.now,
  ) {
    webPush.setVapidDetails(configuration.subject, configuration.publicKey, configuration.privateKey);
  }

  public async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const nowMs = this.now();
    try {
      await this.repository.materialize(nowMs);
      for (const delivery of await this.repository.claim(nowMs)) {
        const display = presentation(delivery);
        try {
          await webPush.sendNotification(delivery.subscription, JSON.stringify({
            schemaVersion: "mk8dx.web-push.v1",
            notificationId: delivery.notificationId,
            eventRevision: delivery.eventRevision,
            title: display.title,
            body: display.body,
            url: display.url,
            tag: `mk8dx-notification-${delivery.notificationId}`,
            unreadCount: delivery.unreadCount,
          }), { TTL: 6 * 60 * 60, urgency: "high", topic: `n${delivery.notificationId}`.slice(0, 32) });
          await this.repository.delivered(delivery.deliveryId, this.now());
        } catch (error) {
          const status = typeof error === "object" && error !== null &&
            "statusCode" in error ? Number((error as { statusCode?: unknown }).statusCode) : 0;
          await this.repository.failed({
            deliveryId: delivery.deliveryId,
            subscriptionId: delivery.subscriptionId,
            nowMs: this.now(),
            permanent: status >= 400 && status < 500 && status !== 408 && status !== 429,
            expiredSubscription: status === 404 || status === 410,
            errorCode: status > 0 ? `http_${status}` : "transport_error",
          });
        }
      }
    } finally { this.running = false; }
  }
}
