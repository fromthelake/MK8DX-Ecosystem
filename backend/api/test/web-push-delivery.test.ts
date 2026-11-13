import { beforeEach, describe, expect, it, vi } from "vitest";

// The same named-export shape as the real web-push 4 module (test/web-push-package.test.ts uses the real one).
vi.mock("web-push", () => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
}));

import * as webPush from "web-push";
import { WebPushDeliveryWorker } from
  "../src/notifications/web-push-delivery.js";

const delivery = {
  deliveryId: 9,
  subscriptionId: 4,
  notificationId: "41",
  eventRevision: 2,
  subscription: {
    endpoint: "https://push.example.test/device/1",
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

function repository() {
  return {
    materialize: vi.fn(async () => undefined),
    claim: vi.fn(async () => [delivery]),
    delivered: vi.fn(async () => undefined),
    failed: vi.fn(async () => undefined),
  };
}

describe("Web Push delivery projection", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("delivers one canonical event revision with its ID and deep link", async () => {
    const target = repository();
    vi.mocked(webPush.sendNotification).mockResolvedValue({ statusCode: 201, headers: {}, body: "" });
    const worker = new WebPushDeliveryWorker(target as never, {
      subject: "mailto:operator@example.test",
      publicKey: Buffer.alloc(65, 3).toString("base64url"),
      privateKey: Buffer.alloc(32, 4).toString("base64url"),
    }, () => 1_900_000_000_000);

    await worker.tick();

    expect(target.materialize).toHaveBeenCalledWith(1_900_000_000_000);
    expect(webPush.sendNotification).toHaveBeenCalledOnce();
    const payload = JSON.parse(vi.mocked(webPush.sendNotification).mock.calls[0]![1] as string);
    expect(payload).toMatchObject({
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
  });

  it("sends pokes and games to the sender's page, where they are answered", async () => {
    const pushed = async (extra: Record<string, unknown>) => {
      vi.clearAllMocks();
      const target = { ...repository(), claim: vi.fn(async () => [{
        ...delivery, trackId: undefined, mode: undefined, actorTimeMs: undefined,
        recipientTimeMs: undefined, recipientRank: undefined, actorPlayerId: "player.ben",
        actorDisplayName: "Ben", ...extra,
      }]) };
      vi.mocked(webPush.sendNotification).mockResolvedValue({ statusCode: 201, headers: {}, body: "" });
      await new WebPushDeliveryWorker(target as never, {
        subject: "mailto:operator@example.test",
        publicKey: Buffer.alloc(65, 3).toString("base64url"),
        privateKey: Buffer.alloc(32, 4).toString("base64url"),
      }, () => 1_900_000_000_000).tick();
      return JSON.parse(vi.mocked(webPush.sendNotification).mock.calls[0]![1] as string);
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
    vi.mocked(webPush.sendNotification).mockRejectedValue(Object.assign(
      new Error("gone"), { statusCode: 410 },
    ));
    const worker = new WebPushDeliveryWorker(target as never, {
      subject: "https://example.test/contact",
      publicKey: Buffer.alloc(65, 3).toString("base64url"),
      privateKey: Buffer.alloc(32, 4).toString("base64url"),
    }, () => 1_900_000_000_000);
    await worker.tick();
    expect(target.failed).toHaveBeenCalledWith(expect.objectContaining({
      deliveryId: 9, subscriptionId: 4,
      permanent: true, expiredSubscription: true,
    }));
  });
});
