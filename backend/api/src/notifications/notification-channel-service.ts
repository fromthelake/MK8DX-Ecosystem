import { createHash } from "node:crypto";

import type { ActorContext } from "../identity/types.js";
import type { ProtectedValue } from "../timetrials/submission-service.js";

/**
 * The outer gate on delivery. The two kind switches say whether a specific kind
 * may notify; they cannot say "only World Records" or "nothing at all", which
 * is what an owner reaches for when a phone is buzzing. 'all' is exactly
 * today's behaviour.
 */
export const NOTIFICATION_SCOPES = ["all", "rivals", "world_records", "none"] as const;

export type NotificationScope = (typeof NOTIFICATION_SCOPES)[number];

/**
 * Who may reach a Player with a poke, a game or a challenge. Deliberately its
 * own setting rather than a reuse of the delivery scope above: what you want
 * delivered and who you want to hear from are different questions.
 */
export const ENGAGEMENT_ACCEPT_SCOPES = ["all", "rivals", "none"] as const;

export type EngagementAcceptScope = (typeof ENGAGEMENT_ACCEPT_SCOPES)[number];

export type NotificationPreferences = Readonly<{
  scope: NotificationScope;
  engagementAcceptScope: EngagementAcceptScope;
  competitiveOvertaken: boolean;
  activityReactions: boolean;
}>;

export type WebPushSubscriptionInput = Readonly<{
  endpoint: string;
  keys: Readonly<{ p256dh: string; auth: string }>;
}>;

export interface WebPushSubscriptionProtector {
  protectSubscription(document: string): ProtectedValue;
}

export interface NotificationChannelRepository {
  readPreferences(userAccountId: string): Promise<NotificationPreferences>;
  updatePreferences(
    userAccountId: string,
    preferences: NotificationPreferences,
    nowMs: number,
  ): Promise<void>;
  subscriptionCount(userAccountId: string): Promise<number>;
  saveSubscription(input: Readonly<{
    userAccountId: string;
    endpointSha256: Uint8Array;
    protectedSubscription: ProtectedValue;
    nowMs: number;
  }>): Promise<void>;
  revokeSubscription(
    userAccountId: string,
    endpointSha256: Uint8Array,
    nowMs: number,
  ): Promise<void>;
}

export class NotificationChannelError extends Error {
  public constructor(public readonly code:
    | "invalid_input" | "not_authenticated" | "unsupported" | "unavailable") {
    super("Notification settings could not be processed.");
    this.name = "NotificationChannelError";
  }
}

const base64UrlPattern = /^[A-Za-z0-9_-]+$/;

function accountId(actor: ActorContext): string {
  if (actor.role !== "account" && actor.role !== "administrator") {
    throw new NotificationChannelError("not_authenticated");
  }
  return actor.userAccountId;
}

function decodedLength(value: string): number {
  if (!base64UrlPattern.test(value)) { return -1; }
  try { return Buffer.from(value, "base64url").byteLength; } catch { return -1; }
}

export function validateWebPushSubscription(
  value: WebPushSubscriptionInput,
): WebPushSubscriptionInput {
  let endpoint: URL;
  try { endpoint = new URL(value.endpoint); } catch {
    throw new NotificationChannelError("invalid_input");
  }
  if (value.endpoint.length > 2048 || endpoint.protocol !== "https:" ||
      endpoint.username !== "" || endpoint.password !== "" ||
      endpoint.hash !== "" || decodedLength(value.keys.p256dh) !== 65 ||
      decodedLength(value.keys.auth) !== 16) {
    throw new NotificationChannelError("invalid_input");
  }
  return {
    endpoint: endpoint.href,
    keys: { p256dh: value.keys.p256dh, auth: value.keys.auth },
  };
}

export class NotificationChannelService {
  public constructor(
    private readonly repository: NotificationChannelRepository,
    private readonly protector: WebPushSubscriptionProtector,
    private readonly publicApplicationServerKey: string | null,
    private readonly now: () => number = Date.now,
  ) {}

  public async status(actor: ActorContext): Promise<Readonly<{
    preferences: NotificationPreferences;
    webPush: Readonly<{
      supported: boolean;
      applicationServerKey?: string;
      subscriptionCount: number;
    }>;
  }>> {
    const account = accountId(actor);
    try {
      const [preferences, subscriptionCount] = await Promise.all([
        this.repository.readPreferences(account),
        this.repository.subscriptionCount(account),
      ]);
      return {
        preferences,
        webPush: {
          supported: this.publicApplicationServerKey !== null,
          ...(this.publicApplicationServerKey === null
            ? {}
            : { applicationServerKey: this.publicApplicationServerKey }),
          subscriptionCount,
        },
      };
    } catch (error) {
      if (error instanceof NotificationChannelError) { throw error; }
      throw new NotificationChannelError("unavailable");
    }
  }

  public async updatePreferences(
    actor: ActorContext,
    preferences: NotificationPreferences,
  ): Promise<void> {
    const account = accountId(actor);
    if (typeof preferences.competitiveOvertaken !== "boolean" ||
        typeof preferences.activityReactions !== "boolean") {
      throw new NotificationChannelError("invalid_input");
    }
    try {
      await this.repository.updatePreferences(account, preferences, this.now());
    } catch { throw new NotificationChannelError("unavailable"); }
  }

  public async subscribe(
    actor: ActorContext,
    input: WebPushSubscriptionInput,
  ): Promise<void> {
    const account = accountId(actor);
    if (this.publicApplicationServerKey === null) {
      throw new NotificationChannelError("unsupported");
    }
    const subscription = validateWebPushSubscription(input);
    const document = JSON.stringify(subscription);
    let protectedSubscription: ProtectedValue;
    try { protectedSubscription = this.protector.protectSubscription(document); }
    catch { throw new NotificationChannelError("unavailable"); }
    if (protectedSubscription.ciphertext.byteLength > 4096) {
      throw new NotificationChannelError("invalid_input");
    }
    try {
      await this.repository.saveSubscription({
        userAccountId: account,
        endpointSha256: createHash("sha256").update(subscription.endpoint).digest(),
        protectedSubscription,
        nowMs: this.now(),
      });
    } catch { throw new NotificationChannelError("unavailable"); }
  }

  public async unsubscribe(
    actor: ActorContext,
    endpoint: string,
  ): Promise<void> {
    const account = accountId(actor);
    const subscription = validateWebPushSubscription({
      endpoint,
      // Endpoint validation is shared; fixed valid-length placeholders never persist.
      keys: {
        p256dh: Buffer.alloc(65).toString("base64url"),
        auth: Buffer.alloc(16).toString("base64url"),
      },
    });
    try {
      await this.repository.revokeSubscription(
        account,
        createHash("sha256").update(subscription.endpoint).digest(),
        this.now(),
      );
    } catch { throw new NotificationChannelError("unavailable"); }
  }
}
