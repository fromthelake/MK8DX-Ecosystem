/** Better Auth session redemption for the isolated A2 offline LAN mode. */
import { createHmac } from "node:crypto";

import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";

import {
  OfflineInvitationTicketService,
  type OfflineInvitationTarget,
} from "./offline-invitation-ticket.js";
import {
  MutationRateLimitExceeded,
  type MutationRateLimiter,
} from "../security/mysql-mutation-rate-limiter.js";

/**
 * Redemption limits (owner decision 2026-11-10). On Windows Docker Desktop
 * every LAN device reaches the gateway from the same address, so the
 * per-address limit cannot be the only one: a LAN night redeems many cards
 * within a minute from what looks like one client. The real guards are per
 * presented card (keyed on a keyed hash of the token, never the token) and a
 * global overload cap. The per-address limit stays, uniformly, but high enough
 * for one shared address: the API cannot reliably tell a collapsed gateway
 * address from a real client, so exempting "the gateway" would be guesswork.
 */
export const OFFLINE_INVITATION_REDEEM_LIMITS = {
  perAddress: { window: 60, max: 60 },
  perToken: { windowSeconds: 900, maximum: 5 },
  global: { windowSeconds: 60, maximum: 120 },
} as const;

export type OfflineInvitationAuthPluginOptions = Readonly<{
  origin: string;
  tickets: OfflineInvitationTicketService;
  bindAccount(authUserId: string, target: OfflineInvitationTarget): Promise<void>;
  /** Durable per-card and global redemption limits; the key hashes presented tokens. */
  attempts: Readonly<{ limiter: MutationRateLimiter; tokenKey: Uint8Array }>;
}>;

async function consumeRedemptionAttempt(
  attempts: OfflineInvitationAuthPluginOptions["attempts"],
  token: string,
): Promise<void> {
  const { perToken, global } = OFFLINE_INVITATION_REDEEM_LIMITS;
  // Unknown and malformed tokens are counted too: they share the global cap
  // and the bucket of their own hash. Only the hash is ever stored.
  const tokenHash = createHmac("sha256", attempts.tokenKey).update(token, "utf8").digest("hex");
  try {
    await attempts.limiter.consume("all", "offline-invitation-redeem-global",
      global.windowSeconds, global.maximum);
    await attempts.limiter.consume(tokenHash, "offline-invitation-redeem-token",
      perToken.windowSeconds, perToken.maximum);
  } catch (error) {
    if (error instanceof MutationRateLimitExceeded) {
      throw new APIError("TOO_MANY_REQUESTS", { code: "offline_invitation_rate_limited" },
        { "Retry-After": String(error.retryAfterSeconds) });
    }
    throw error;
  }
}

/** The exact JSON body both card routes accept: `{ token }` and nothing else. */
function presentedToken(ctx: Readonly<{ headers?: Headers; body: unknown }>, origin: string): string {
  // A token is submitted only in the JSON body, never a path or query.
  // Requiring the exact HTTPS origin also prevents a foreign LAN page
  // from spending somebody else's one-use ticket with the victim browser.
  if (ctx.headers?.get("origin") !== origin) {
    throw new APIError("FORBIDDEN", { code: "offline_invitation_origin_invalid" });
  }
  const body = ctx.body;
  if (typeof body !== "object" || body === null || Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      typeof (body as Record<string, unknown>)["token"] !== "string") {
    throw new APIError("BAD_REQUEST", { code: "offline_invitation_invalid" });
  }
  return (body as { token: string }).token;
}

const CARD_PATHS = new Set(["/offline-invitation/redeem", "/offline-invitation/preview"]);

/** The server-only native endpoints take the same exact `{ token }` body, without a browser Origin. */
function nativeToken(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      typeof (body as Record<string, unknown>)["token"] !== "string") {
    throw new APIError("BAD_REQUEST", { code: "offline_invitation_invalid" });
  }
  return (body as { token: string }).token;
}

/**
 * One card becomes one Better Auth session for its own account, for both the browser and the app: the
 * atomic consume, the verified-user rule and the binding to exactly that UserAccount are the same.
 */
async function redeemToSession(ctx: GenericEndpointContext, options: OfflineInvitationAuthPluginOptions,
                               token: string) {
  const adapter = ctx.context.internalAdapter;
  let target: OfflineInvitationTarget;
  try {
    target = await options.tickets.redeem(token);
  } catch {
    // Do not disclose whether a ticket was unknown, expired or revoked.
    throw new APIError("UNAUTHORIZED", { code: "offline_invitation_unavailable" });
  }
  const existing = await adapter.findUserByEmail(target.authEmail);
  let user = existing?.user;
  if (user !== undefined && user.emailVerified !== true) {
    throw new APIError("UNAUTHORIZED", { code: "offline_invitation_account_unavailable" });
  }
  if (user === undefined) {
    user = await adapter.createUser({
      email: target.authEmail,
      emailVerified: true,
      name: "MK8DX account",
    }, { method: "offline-invitation" });
  }
  if (user === undefined || user === null) {
    throw new APIError("INTERNAL_SERVER_ERROR", { code: "offline_invitation_account_unavailable" });
  }
  // The existing binding service enforces that the verified Better Auth
  // subject can only resolve to this explicit UserAccount.
  await options.bindAccount(user.id, target);
  const session = await adapter.createSession(user.id);
  if (session === null) {
    throw new APIError("INTERNAL_SERVER_ERROR", { code: "offline_invitation_session_unavailable" });
  }
  return { session, user };
}

export function offlineInvitationAuthPlugin(options: OfflineInvitationAuthPluginOptions) {
  return {
    id: "mk8dx-offline-invitation",
    endpoints: {
      // Who this card signs in as, shown before confirming. It never consumes the card and counts
      // against the same per-card, global and per-address limits as redemption.
      previewOfflineInvitation: createAuthEndpoint("/offline-invitation/preview", {
        method: "POST",
        requireHeaders: true,
      }, async (ctx) => {
        const token = presentedToken(ctx, options.origin);
        await consumeRedemptionAttempt(options.attempts, token);
        try {
          return ctx.json({ displayLabel: await options.tickets.preview(token) });
        } catch {
          throw new APIError("UNAUTHORIZED", { code: "offline_invitation_unavailable" });
        }
      }),
      redeemOfflineInvitation: createAuthEndpoint("/offline-invitation/redeem", {
        method: "POST",
        requireHeaders: true,
      }, async (ctx) => {
        const token = presentedToken(ctx, options.origin);
        await consumeRedemptionAttempt(options.attempts, token);
        const { session, user } = await redeemToSession(ctx, options, token);
        await setSessionCookie(ctx, { session, user });
        return ctx.json({ ok: true });
      }),
      /**
       * The Android app's own redemption (ADR-0224 amendment 2026-11-16): the same one-use card, limits,
       * account binding and Better Auth session as the browser route, but the session token is handed back to
       * the caller instead of being set as a cookie. Server-only: reachable solely through the Fastify route
       * that admits a native app on the installation's own origin (native-invitation-routes.ts).
       */
      previewOfflineInvitationNative: createAuthEndpoint.serverOnly({
        method: "POST",
      }, async (ctx) => {
        const token = nativeToken(ctx.body);
        await consumeRedemptionAttempt(options.attempts, token);
        try {
          return ctx.json({ displayLabel: await options.tickets.preview(token) });
        } catch {
          throw new APIError("UNAUTHORIZED", { code: "offline_invitation_unavailable" });
        }
      }),
      redeemOfflineInvitationNative: createAuthEndpoint.serverOnly({
        method: "POST",
      }, async (ctx) => {
        const token = nativeToken(ctx.body);
        await consumeRedemptionAttempt(options.attempts, token);
        const { session } = await redeemToSession(ctx, options, token);
        return ctx.json({ token: session.token, expiresAtMs: new Date(session.expiresAt).getTime() });
      }),
    },
    rateLimit: [{
      pathMatcher: (path: string) => CARD_PATHS.has(path),
      ...OFFLINE_INVITATION_REDEEM_LIMITS.perAddress,
    }],
  } satisfies BetterAuthPlugin;
}
