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
 *
 * 2026-11-16 (security review of the native route): a stream of made-up tokens
 * must not be able to fill the bucket real cards need. After the per-address
 * limit, a presented token is first looked up (one indexed read of its digest):
 * a token that is not a live card spends only the separate `failures` budget and
 * creates no row of its own; a live card spends its own per-card budget and the
 * global bucket of its operation, previews and redemptions apart.
 */
export const OFFLINE_INVITATION_REDEEM_LIMITS = {
  perAddress: { window: 60, max: 60 },
  perToken: { windowSeconds: 900, maximum: 5 },
  /** Redemptions of live cards, all clients together. */
  global: { windowSeconds: 60, maximum: 120 },
  /** Previews of live cards, all clients together; separate from redemptions. */
  previewGlobal: { windowSeconds: 60, maximum: 120 },
  /** Tokens that are no live card (unknown, used, expired, revoked, malformed), all clients together. */
  failures: { windowSeconds: 60, maximum: 600 },
} as const;

export type OfflineInvitationAuthPluginOptions = Readonly<{
  origin: string;
  tickets: OfflineInvitationTicketService;
  bindAccount(authUserId: string, target: OfflineInvitationTarget): Promise<void>;
  /** Durable per-card and global redemption limits; the key hashes presented tokens. */
  attempts: Readonly<{ limiter: MutationRateLimiter; tokenKey: Uint8Array }>;
}>;

function rateLimited(error: unknown): never {
  if (error instanceof MutationRateLimitExceeded) {
    throw new APIError("TOO_MANY_REQUESTS", { code: "offline_invitation_rate_limited" },
      { "Retry-After": String(error.retryAfterSeconds) });
  }
  throw error;
}

/**
 * Spends the budgets of one presented token and answers the card's label when it is a live card. A token that
 * is no live card is refused here as "unavailable" (the same answer as everywhere) after spending only the
 * failure budget. Only the hash of a live card's token is ever stored as a bucket subject.
 */
async function consumeRedemptionAttempt(
  options: Pick<OfflineInvitationAuthPluginOptions, "attempts" | "tickets">,
  token: string,
  operation: "preview" | "redeem",
): Promise<void> {
  const { perToken, global, previewGlobal, failures } = OFFLINE_INVITATION_REDEEM_LIMITS;
  const live = await options.tickets.preview(token).then(() => true, () => false);
  try {
    if (!live) {
      await options.attempts.limiter.consume("all", "offline-invitation-failure-global",
        failures.windowSeconds, failures.maximum);
    } else {
      const tokenHash = createHmac("sha256", options.attempts.tokenKey).update(token, "utf8").digest("hex");
      await options.attempts.limiter.consume(tokenHash, "offline-invitation-redeem-token",
        perToken.windowSeconds, perToken.maximum);
      const bucket = operation === "preview" ? previewGlobal : global;
      await options.attempts.limiter.consume("all",
        operation === "preview" ? "offline-invitation-preview-global" : "offline-invitation-redeem-global",
        bucket.windowSeconds, bucket.maximum);
    }
  } catch (error) {
    rateLimited(error);
  }
  if (!live) {
    // Do not disclose whether a ticket was unknown, expired or revoked.
    throw new APIError("UNAUTHORIZED", { code: "offline_invitation_unavailable" });
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
        await consumeRedemptionAttempt(options, token, "preview");
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
        await consumeRedemptionAttempt(options, token, "redeem");
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
        await consumeRedemptionAttempt(options, token, "preview");
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
        await consumeRedemptionAttempt(options, token, "redeem");
        const { session } = await redeemToSession(ctx, options, token);
        const expiresAtMs = new Date(session.expiresAt).getTime();
        if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs - Date.now() < 60_000) {
          // Nobody will hold this session: end it now rather than leave it behind.
          await ctx.context.internalAdapter.deleteSession(session.token);
          throw new APIError("SERVICE_UNAVAILABLE", { code: "offline_invitation_session_unavailable" });
        }
        return ctx.json({ token: session.token, expiresAtMs });
      }),
      /**
       * Ends a session the native route created but could not hand over (the route's own last check failed).
       * Server-only; takes the session token the route itself just received.
       */
      revokeOfflineInvitationNativeSession: createAuthEndpoint.serverOnly({
        method: "POST",
      }, async (ctx) => {
        const token = nativeToken(ctx.body);
        await ctx.context.internalAdapter.deleteSession(token);
        return ctx.json({ revoked: true });
      }),
    },
    rateLimit: [{
      pathMatcher: (path: string) => CARD_PATHS.has(path),
      ...OFFLINE_INVITATION_REDEEM_LIMITS.perAddress,
    }],
  } satisfies BetterAuthPlugin;
}
