import { describe, expect, it } from "vitest";

import {
  NotificationChannelError,
  NotificationChannelService,
  type NotificationChannelRepository,
  type NotificationPreferences,
} from "../src/notifications/notification-channel-service.js";

class FakeRepository implements NotificationChannelRepository {
  public preferences: NotificationPreferences = { scope: "all", engagementAcceptScope: "all", competitiveOvertaken: true, activityReactions: true };
  public savedAccount: string | null = null;
  public revokedAccount: string | null = null;
  async readPreferences() { return this.preferences; }
  async updatePreferences(_id: string, value: NotificationPreferences) { this.preferences = value; }
  async subscriptionCount() { return 2; }
  async saveSubscription(input: Parameters<NotificationChannelRepository["saveSubscription"]>[0]) {
    this.savedAccount = input.userAccountId;
  }
  async revokeSubscription(id: string) { this.revokedAccount = id; }
}

const valid = {
  endpoint: "https://push.example.test/device/capability",
  keys: {
    p256dh: Buffer.alloc(65, 1).toString("base64url"),
    auth: Buffer.alloc(16, 2).toString("base64url"),
  },
};

describe("notification channel service", () => {
  it("binds protected device subscriptions to the authenticated UserAccount", async () => {
    const repository = new FakeRepository();
    const service = new NotificationChannelService(
      repository,
      { protectSubscription: () => ({ ciphertext: Uint8Array.of(1, 2, 3), encryptionKeyVersion: "active" }) },
      Buffer.alloc(65, 3).toString("base64url"),
      () => 123,
    );
    const actor = { role: "account" as const, userAccountId: "user_account.ben" };
    expect((await service.status(actor)).webPush.subscriptionCount).toBe(2);
    await service.subscribe(actor, valid);
    await service.unsubscribe(actor, valid.endpoint);
    expect(repository.savedAccount).toBe("user_account.ben");
    expect(repository.revokedAccount).toBe("user_account.ben");
  });

  it("rejects anonymous, malformed, and unconfigured subscription writes", async () => {
    const repository = new FakeRepository();
    const configured = new NotificationChannelService(
      repository,
      { protectSubscription: () => ({ ciphertext: Uint8Array.of(1), encryptionKeyVersion: "active" }) },
      Buffer.alloc(65, 3).toString("base64url"),
    );
    await expect(configured.status({ role: "anonymous" })).rejects.toMatchObject({ code: "not_authenticated" });
    await expect(configured.subscribe(
      { role: "account", userAccountId: "user_account.ben" },
      { ...valid, endpoint: "http://push.example.test/not-secure" },
    )).rejects.toBeInstanceOf(NotificationChannelError);
    const unavailable = new NotificationChannelService(repository, {
      protectSubscription: () => ({ ciphertext: Uint8Array.of(1), encryptionKeyVersion: "active" }),
    }, null);
    await expect(unavailable.subscribe(
      { role: "account", userAccountId: "user_account.ben" }, valid,
    )).rejects.toMatchObject({ code: "unsupported" });
  });
});
