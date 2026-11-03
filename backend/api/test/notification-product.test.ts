import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import {
  NotificationService,
  type NotificationInbox,
  type NotificationEventView,
  type NotificationRepository,
  type TournamentSignupNotice,
} from "../src/notifications/notification-service.js";
import type {
  ActorContext,
  IdentityReadRepository,
} from "../src/identity/types.js";

const identityRepository: IdentityReadRepository = {
  async findPublicPlayerById() { return null; },
  async findUserAccountSummaryById() { return null; },
  async findPlayerClaimSummaryById() { return null; },
};

class FakeNotificationRepository implements NotificationRepository {
  inbox: NotificationInbox = { unreadCount: 0, notifications: [] };
  readonly markedRead: (readonly string[] | "all")[] = [];
  readonly produced: string[] = [];

  events: Record<string, readonly NotificationEventView[]> = {};

  async listForAccount(): Promise<NotificationInbox> { return this.inbox; }
  async listEventsForAccount(
    _userAccountId: string,
    notificationId: string,
  ): Promise<readonly NotificationEventView[]> {
    return this.events[notificationId] ?? [];
  }
  async markRead(
    _userAccountId: string,
    notificationIds: readonly string[] | "all",
  ): Promise<void> {
    this.markedRead.push(notificationIds);
  }
  async produceOvertaken(submissionPublicId: string): Promise<void> {
    this.produced.push(`overtaken|${submissionPublicId}`);
  }
  async produceReactionReceived(resultPublicId: string): Promise<void> {
    this.produced.push(`reaction|${resultPublicId}`);
  }
  async produceClaimRequested(playerClaimId: string): Promise<void> {
    this.produced.push(`claim_requested:${playerClaimId}`);
  }
  async produceClaimDecided(
    userAccountPublicId: string,
    decision: string,
  ): Promise<void> {
    this.produced.push(`claim|${userAccountPublicId}|${decision}`);
  }
  async produceHostRequested(requestPublicId: string): Promise<void> {
    this.produced.push(`host_requested|${requestPublicId}`);
  }
  async produceHostRequestDecided(
    requestPublicId: string,
    userAccountPublicId: string,
    decision: string,
  ): Promise<void> {
    this.produced.push(`host_request_decided|${requestPublicId}|${userAccountPublicId}|${decision}`);
  }
  async produceTournamentSignup(notice: TournamentSignupNotice): Promise<void> {
    this.produced.push(`${notice.kind}|${notice.tournamentInternalId}|${notice.recipientInternalId}|${notice.detail}`);
  }
}

async function appWith(
  repository: FakeNotificationRepository,
  actor: ActorContext,
): Promise<ReturnType<typeof buildApp>> {
  return buildApp({
    identityRepository,
    notifications: { service: new NotificationService({ repository }) },
    resolveActor: async () => actor,
  });
}

describe("notifications product", () => {
  it("opens a grouped entry and lists what it counted", async () => {
    const repository = new FakeNotificationRepository();
    repository.inbox = {
      unreadCount: 1,
      notifications: [{
        notificationId: "77",
        kind: "world_record",
        trackId: "track.rainbow_road",
        mode: 200,
        count: 3,
        lastEventAtMs: 1_700_000_000_000,
        read: false,
      }],
    };
    repository.events = {
      "77": [
        { occurredAtMs: 1_700_000_000_000, trackId: "track.rainbow_road", mode: 200 },
        { occurredAtMs: 1_699_999_000_000, trackId: "track.baby_park", mode: 150 },
        { occurredAtMs: 1_699_998_000_000, trackId: "track.mario_kart_stadium", mode: 200 },
      ],
    };
    const app = await appWith(repository, {
      role: "account", userAccountId: "user_account.reader",
    } as ActorContext);

    const response = await app.inject({
      method: "GET", url: "/v1/notifications/77/events",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      schemaVersion: string;
      notificationId: string;
      events: readonly Record<string, unknown>[];
    };
    expect(body.schemaVersion).toBe("mk8dx.notification-events.v1");
    expect(body.notificationId).toBe("77");
    expect(body.events).toHaveLength(3);
    expect(body.events[0]).toEqual({
      occurredAtMs: 1_700_000_000_000, trackId: "track.rainbow_road", mode: 200,
    });
    expect(body.events[1]?.["trackId"]).toBe("track.baby_park");

    // An entry aggregated before members were kept is empty, not an error:
    // the count it shows is still true.
    const empty = await app.inject({
      method: "GET", url: "/v1/notifications/78/events",
    });
    expect(empty.statusCode).toBe(200);
    expect((empty.json() as { events: unknown[] }).events).toEqual([]);

    // A malformed id never reaches the repository.
    const invalid = await app.inject({
      method: "GET", url: "/v1/notifications/not-a-number/events",
    });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });

  it("refuses to open a grouped entry without a session", async () => {
    const repository = new FakeNotificationRepository();
    repository.events = { "77": [{ occurredAtMs: 1 }] };
    const app = await appWith(repository, { role: "anonymous" } as ActorContext);
    const response = await app.inject({
      method: "GET", url: "/v1/notifications/77/events",
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("lists the aggregated inbox and marks notifications read", async () => {
    const repository = new FakeNotificationRepository();
    repository.inbox = {
      unreadCount: 2,
      notifications: [
        {
          notificationId: "7",
          kind: "overtaken",
          actorPlayerId: "player.floyd",
          actorDisplayName: "Floyd",
          trackId: "track.mount_wario",
          mode: 150,
          count: 4,
          lastEventAtMs: 1_900_000_000_000,
          read: false,
        },
        {
          notificationId: "6",
          kind: "reaction_received",
          trackId: "track.mario_circuit",
          mode: 200,
          count: 2,
          lastEventAtMs: 1_899_000_000_000,
          read: true,
        },
      ],
    };
    const app = await appWith(
      repository,
      { role: "account", userAccountId: "user_account.synthetic" },
    );
    const inbox = await app.inject({ method: "GET", url: "/v1/notifications" });
    expect(inbox.statusCode).toBe(200);
    const body = inbox.json();
    expect(body.schemaVersion).toBe("mk8dx.notifications.v1");
    expect(body.unreadCount).toBe(2);
    expect(body.notifications).toHaveLength(2);
    expect(body.notifications[0].actorDisplayName).toBe("Floyd");
    expect(body.notifications[0].count).toBe(4);

    const markSome = await app.inject({
      method: "POST",
      url: "/v1/notifications/read",
      payload: { notificationIds: ["7"] },
    });
    expect(markSome.statusCode).toBe(200);
    const markAll = await app.inject({
      method: "POST",
      url: "/v1/notifications/read",
      payload: { all: true },
    });
    expect(markAll.statusCode).toBe(200);
    expect(repository.markedRead).toEqual([["7"], "all"]);
    await app.close();
  });

  it("refuses anonymous access and swallows producer failures", async () => {
    const repository = new FakeNotificationRepository();
    const app = await appWith(repository, { role: "anonymous" });
    const inbox = await app.inject({ method: "GET", url: "/v1/notifications" });
    expect(inbox.statusCode).toBe(401);
    const mark = await app.inject({
      method: "POST",
      url: "/v1/notifications/read",
      payload: { all: true },
    });
    expect(mark.statusCode).toBe(401);
    await app.close();

    const errors: string[] = [];
    const failing = new NotificationService({
      repository: {
        ...repository,
        async produceOvertaken(): Promise<void> {
          throw new Error("boom");
        },
        async listForAccount() { return repository.inbox; },
        async listEventsForAccount() { return []; },
        async markRead() {},
        async produceReactionReceived() {},
        async produceClaimRequested() {},
        async produceClaimDecided() {},
        async produceHostRequested(): Promise<void> { throw new Error("boom"); },
        async produceHostRequestDecided() {},
        async produceTournamentSignup(): Promise<void> { throw new Error("boom"); },
      },
      onProducerError: (context) => { errors.push(context); },
    });
    await failing.notifyOvertaken("user_submission.time.SYNTHETIC01");
    // A host request is saved even when its inbox entry cannot be written (ADR-0220).
    await failing.notifyHostRequested("director_host_request.synthetic01");
    // A sign-up change is saved even when its inbox entry cannot be written (ADR-0222).
    await failing.notifyTournamentSignup({
      kind: "tournament_signup_moved_up", tournamentInternalId: 7, recipientInternalId: 9, detail: "moved_up",
    });
    expect(errors).toEqual(["overtaken", "host_requested", "tournament_signup_moved_up"]);
    await new NotificationService({ repository }).notifyTournamentSignup({
      kind: "tournament_signup_selected", tournamentInternalId: 7, recipientInternalId: 9, detail: "waiting",
    });
    expect(repository.produced.at(-1)).toBe("tournament_signup_selected|7|9|waiting");
  });
});
