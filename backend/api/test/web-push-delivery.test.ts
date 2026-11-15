import { beforeEach, describe, expect, it, vi } from "vitest";

// The same named-export shape as the real web-push 4 module (test/web-push-package.test.ts uses the real one).
// The request body stays the plain payload here so the projection can be read back.
vi.mock("web-push", () => ({
  setVapidDetails: vi.fn(),
  generateRequestDetails: vi.fn((subscription: { endpoint: string }, payload: string) => ({
    method: "POST", endpoint: subscription.endpoint, headers: { TTL: 21_600 }, body: Buffer.from(payload),
  })),
}));

import { WebPushDeliveryWorker } from
  "../src/notifications/web-push-delivery.js";
import {
  WebPushTransportError,
  type WebPushRequest,
  type WebPushTransport,
  type WebPushTransportFailure,
} from "../src/notifications/web-push-transport.js";

const delivery = {
  deliveryId: 9,
  subscriptionId: 4,
  notificationId: "41",
  eventRevision: 2,
  subscription: {
    endpoint: "https://fcm.googleapis.com/fcm/send/device-1",
    keys: {
      p256dh: Buffer.alloc(65, 1).toString("base64url"),
      auth: Buffer.alloc(16, 2).toString("base64url"),
    },
  },
  kind: "overtaken",
  actorDisplayName: "Floyd",
  trackId: "track.mario_circuit",
  mode: 150,
  actorTimeMs: 116_200,
  recipientTimeMs: 116_942,
  recipientRank: 4,
  unreadCount: 1,
} as const;

const configuration = {
  subject: "mailto:operator@example.test",
  publicKey: Buffer.alloc(65, 3).toString("base64url"),
  privateKey: Buffer.alloc(32, 4).toString("base64url"),
};

function repository(claimed: readonly unknown[] = [delivery]) {
  return {
    materialize: vi.fn(async () => undefined),
    claim: vi.fn(async () => claimed),
    delivered: vi.fn(async () => undefined),
    failed: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  };
}

class RecordingTransport implements WebPushTransport {
  public readonly sent: WebPushRequest[] = [];
  public constructor(private readonly answer: (request: WebPushRequest) => Promise<{ statusCode: number }>) {}
  async send(request: WebPushRequest) { this.sent.push(request); return this.answer(request); }
}

const respond = (statusCode: number) => new RecordingTransport(async () => ({ statusCode }));
const fail = (failure: WebPushTransportFailure) =>
  new RecordingTransport(async () => { throw new WebPushTransportError(failure); });
const payloadOf = (request: WebPushRequest | undefined) =>
  JSON.parse(Buffer.from(request!.body!).toString("utf8")) as Record<string, unknown>;

describe("Web Push delivery projection", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("delivers one canonical event revision with its ID and deep link", async () => {
    const target = repository();
    const transport = respond(201);
    const worker = new WebPushDeliveryWorker(target as never, configuration, () => 1_900_000_000_000, { transport });

    const round = await worker.tick();

    expect(target.materialize).toHaveBeenCalledWith(1_900_000_000_000);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]!.endpoint).toBe(delivery.subscription.endpoint);
    expect(payloadOf(transport.sent[0])).toMatchObject({
      schemaVersion: "mk8dx.web-push.v1",
      notificationId: "41",
      eventRevision: 2,
      title: "Floyd was 0,742s sneller op Mario Circuit",
      body: "150cc · 1:56.200 tegen jouw 1:56.942 · jij staat nu #4",
      url: "/?leaderboard=track.mario_circuit&mode=150&notification=41",
      tag: "mk8dx-notification-41",
      unreadCount: 1,
    });
    expect(target.delivered).toHaveBeenCalledWith(9, 1_900_000_000_000);
    expect(target.failed).not.toHaveBeenCalled();
    expect(round).toMatchObject({ claimed: 1, delivered: 1, retried: 0, dead: 0 });
  });

  it("sends pokes and games to the sender's page, where they are answered", async () => {
    const pushed = async (extra: Record<string, unknown>) => {
      const target = repository([{
        ...delivery, trackId: undefined, mode: undefined, actorTimeMs: undefined,
        recipientTimeMs: undefined, recipientRank: undefined, actorPlayerId: "player.ben",
        actorDisplayName: "Ben", ...extra,
      }]);
      const transport = respond(201);
      await new WebPushDeliveryWorker(target as never, configuration, () => 1_900_000_000_000, { transport }).tick();
      return payloadOf(transport.sent[0]);
    };
    expect(await pushed({ kind: "poke" })).toMatchObject({ url: "/?player=player.ben#interactions" });
    expect(await pushed({ kind: "rock_paper_scissors", detail: "invite" }))
      .toMatchObject({ url: "/?player=player.ben#interactions", body: "Kies jouw zet." });
    expect(await pushed({ kind: "dice_roll", detail: "4" }))
      .toMatchObject({ title: "Ben gooide 4", body: "🎲 Gooi terug om te winnen.", url: "/?player=player.ben#interactions" });
    expect(await pushed({ kind: "dice_roll", detail: "3 vs 5" }))
      .toMatchObject({ title: "Ben gooide 3 tegen jouw 5", body: "🎲 jij wint" });
  });

  it("revokes an expired capability endpoint without throwing into publication", async () => {
    const target = repository();
    await new WebPushDeliveryWorker(target as never, configuration, () => 1_900_000_000_000,
      { transport: respond(410) }).tick();
    expect(target.failed).toHaveBeenCalledWith(expect.objectContaining({
      deliveryId: 9, subscriptionId: 4,
      permanent: true, expiredSubscription: true, errorCode: "http_410",
    }));
  });

  it.each([
    ["timeout", false, false, "transport_timeout"],
    ["tls_failed", false, false, "tls_failed"],
    ["transport_failed", false, false, "transport_failed"],
    ["dns_failed", false, false, "dns_failed"],
    ["destination_refused", true, false, "destination_refused"],
    ["provider_not_allowed", true, true, "provider_not_allowed"],
    ["invalid_endpoint", true, true, "invalid_endpoint"],
  ] as const)("classifies a %s failure (permanent %s, revoke %s)", async (failure, permanent, expired, errorCode) => {
    const target = repository();
    await new WebPushDeliveryWorker(target as never, configuration, () => 5, { transport: fail(failure) }).tick();
    expect(target.failed).toHaveBeenCalledOnce();
    expect(target.failed).toHaveBeenCalledWith(expect.objectContaining({
      permanent, expiredSubscription: expired, errorCode,
    }));
    expect(target.delivered).not.toHaveBeenCalled();
  });

  it.each([
    [301, true, "redirect_refused"], [307, true, "redirect_refused"], [400, true, "http_400"],
    [408, false, "http_408"], [429, false, "http_429"], [500, false, "http_500"], [503, false, "http_503"],
  ] as const)("classifies HTTP %s", async (statusCode, permanent, errorCode) => {
    const target = repository();
    await new WebPushDeliveryWorker(target as never, configuration, () => 5, { transport: respond(statusCode) }).tick();
    expect(target.failed).toHaveBeenCalledWith(expect.objectContaining({
      permanent, expiredSubscription: false, errorCode,
    }));
  });
});

describe("Web Push delivery fairness", () => {
  const forSubscription = (subscriptionId: number, deliveryId: number) => ({
    ...delivery, deliveryId, subscriptionId,
    subscription: { ...delivery.subscription, endpoint: `https://fcm.googleapis.com/fcm/send/device-${subscriptionId}` },
  });

  it("keeps serving other subscriptions while one endpoint hangs until its deadline", async () => {
    const claimed = [forSubscription(1, 11), forSubscription(1, 12), forSubscription(1, 13),
      forSubscription(2, 21), forSubscription(3, 31), forSubscription(4, 41)];
    const target = repository(claimed);
    const healthyDone: string[] = [];
    let releaseHang: () => void = () => undefined;
    const transport = new RecordingTransport((request) => {
      if (request.endpoint.endsWith("device-1")) {
        // Stands in for the transport's own deadline: fails only when released.
        return new Promise((_, reject) => {
          releaseHang = () => reject(new WebPushTransportError("timeout"));
        });
      }
      healthyDone.push(request.endpoint);
      return Promise.resolve({ statusCode: 201 });
    });
    const worker = new WebPushDeliveryWorker(target as never, configuration, () => 1_000,
      { transport, concurrency: 2, releaseDelayMs: 60_000 });
    const round = worker.tick();
    await vi.waitFor(() => { expect(target.delivered).toHaveBeenCalledTimes(3); });
    // The hanging endpoint holds one slot; the other slot served everyone else.
    expect(healthyDone).toHaveLength(3);
    expect(await worker.tick()).toBeNull();
    releaseHang();
    const summary = await round;
    expect(summary).toMatchObject({ claimed: 6, delivered: 3, retried: 1, timeouts: 1, released: 2 });
    // Only the first delivery of the broken subscription paid for the deadline;
    // its other two were handed back once, without being sent or counted.
    expect(transport.sent.filter((request) => request.endpoint.endsWith("device-1"))).toHaveLength(1);
    expect(target.release).toHaveBeenCalledWith([12, 13], 61_000);
    expect(target.failed).toHaveBeenCalledOnce();
    expect(target.failed).toHaveBeenCalledWith(expect.objectContaining({ deliveryId: 11, permanent: false }));
    expect(worker.metrics()).toMatchObject({ ticks: 1, skippedTicks: 1, timeouts: 1, released: 2, delivered: 3 });
  });

  it("frees the round after a database failure, so the next tick runs", async () => {
    const target = repository();
    target.delivered.mockRejectedValueOnce(new Error("database unavailable"));
    const worker = new WebPushDeliveryWorker(target as never, configuration, () => 1, { transport: respond(201) });
    await expect(worker.tick()).rejects.toThrow("database unavailable");
    // Nothing reports the delivery as failed as well: the claim lease retries it.
    expect(target.failed).not.toHaveBeenCalled();
    await expect(worker.tick()).resolves.toMatchObject({ delivered: 1 });
  });

  it("never sends one claimed delivery twice in a round", async () => {
    const claimed = Array.from({ length: 20 }, (_, index) => forSubscription(index % 5, 100 + index));
    const target = repository(claimed);
    const transport = respond(201);
    await new WebPushDeliveryWorker(target as never, configuration, () => 1, { transport, concurrency: 4 }).tick();
    expect(transport.sent).toHaveLength(20);
    expect(new Set(target.delivered.mock.calls.map((call) => (call as unknown[])[0])).size).toBe(20);
    expect(target.failed).not.toHaveBeenCalled();
  });
});
