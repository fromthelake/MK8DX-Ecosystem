/**
 * ADR-0224 phase 2 inside Better Auth. Its only HTTP-reachable parts are hooks on Better Auth's own
 * routes; the list and switch endpoints are server-only (better-call never puts them on the
 * router), so the PIN and administrator checks in them cannot be bypassed from a browser. The
 * closed-schema Fastify routes in account-switch-routes.ts call them through `auth.api`.
 */
import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";

import {
  ACCOUNT_DEVICE_COOKIE,
  ACCOUNT_DEVICE_COOKIE_MAX_AGE_SECONDS,
  REMEMBERED_ACCOUNTS_PER_DEVICE,
  REMEMBERED_ACCOUNT_IDLE_MS,
  deviceDigest,
  entryIdPattern,
  newDeviceValue,
  newEntryId,
  pinPattern,
  type AccountSwitchDirectory,
  type AccountSwitchKeys,
  type AccountSwitchPins,
  type AccountSwitchStore,
} from "./account-switch.js";

export type AccountSwitchAuthPluginOptions = Readonly<{
  keys: AccountSwitchKeys;
  store: AccountSwitchStore;
  directory: AccountSwitchDirectory;
  pins: AccountSwitchPins;
  nowMs?: () => number;
}>;

/** The browser sign-ins that set a session cookie. Native (bearer) sign-in is not among them. */
const REMEMBERING_PATHS = new Set(["/magic-link/verify", "/offline-invitation/redeem"]);
/** Sent only by "Sign in with another account": that sign-out keeps the account remembered. */
export const KEEP_REMEMBERED_HEADER = "x-mk8dx-keep-remembered";

export type RememberedAccountView = Readonly<{
  entryId: string;
  label: string | null;
  pinRequired: boolean;
  current: boolean;
}>;

export type AccountSwitchOutcome =
  | Readonly<{ outcome: "switched" }>
  | Readonly<{ outcome: "unavailable" }>
  | Readonly<{ outcome: "forbidden" }>
  | Readonly<{ outcome: "pin_required" }>
  | Readonly<{ outcome: "pin_invalid" }>
  | Readonly<{ outcome: "rate_limited"; retryAfterSeconds: number }>;

type CookieContext = Readonly<{
  getCookie(name: string): string | null | undefined;
  setCookie(name: string, value: string, attributes?: Record<string, unknown>): unknown;
  context: Readonly<{
    createAuthCookie(name: string, overrides?: Record<string, unknown>): Readonly<{
      name: string;
      attributes: Record<string, unknown>;
    }>;
  }>;
}>;

function deviceCookie(ctx: CookieContext) {
  return ctx.context.createAuthCookie(ACCOUNT_DEVICE_COOKIE, {
    sameSite: "strict",
    httpOnly: true,
    maxAge: ACCOUNT_DEVICE_COOKIE_MAX_AGE_SECONDS,
  });
}

export function accountSwitchAuthPlugin(options: AccountSwitchAuthPluginOptions) {
  const nowMs = options.nowMs ?? Date.now;
  const currentDevice = (ctx: CookieContext): Buffer | null =>
    deviceDigest(options.keys, ctx.getCookie(deviceCookie(ctx).name));

  return {
    id: "mk8dx-account-switch",
    endpoints: {
      listRememberedAccounts: createAuthEndpoint.serverOnly({
        method: "GET",
        requireHeaders: true,
      }, async (ctx) => {
        const device = currentDevice(ctx as unknown as CookieContext);
        if (device === null) { return ctx.json({ accounts: [] as RememberedAccountView[] }); }
        const current = await getSessionFromCtx(ctx).catch(() => null);
        const rows = await options.store.list(device, nowMs() - REMEMBERED_ACCOUNT_IDLE_MS);
        const accounts: RememberedAccountView[] = [];
        for (const row of rows) {
          const target = await options.directory.resolve(row.authUserId);
          if (target === null) { continue; }
          if (target.administrator) {
            // A grant that appeared after the account was remembered: never offered, and gone.
            await options.store.forget(device, row.authUserId);
            continue;
          }
          accounts.push({
            entryId: row.entryId,
            label: target.label,
            pinRequired: await options.pins.enabled(target.userAccountId),
            current: current?.user.id === row.authUserId,
          });
        }
        return ctx.json({ accounts });
      }),

      switchRememberedAccount: createAuthEndpoint.serverOnly({
        method: "POST",
        requireHeaders: true,
      }, async (ctx) => {
        const answer = (value: AccountSwitchOutcome) => ctx.json(value);
        const body: unknown = ctx.body;
        if (typeof body !== "object" || body === null || Array.isArray(body)) {
          return answer({ outcome: "unavailable" });
        }
        const entryId = (body as Record<string, unknown>)["entryId"];
        const pin = (body as Record<string, unknown>)["pin"];
        if (typeof entryId !== "string" || !entryIdPattern.test(entryId) ||
            (pin !== undefined && (typeof pin !== "string" || !pinPattern.test(pin)))) {
          return answer({ outcome: "unavailable" });
        }
        const device = currentDevice(ctx as unknown as CookieContext);
        if (device === null) { return answer({ outcome: "unavailable" }); }
        const now = nowMs();
        const row = (await options.store.list(device, now - REMEMBERED_ACCOUNT_IDLE_MS))
          .find((candidate) => candidate.entryId === entryId);
        if (row === undefined) { return answer({ outcome: "unavailable" }); }
        const target = await options.directory.resolve(row.authUserId);
        if (target === null) { return answer({ outcome: "unavailable" }); }
        if (target.administrator) {
          await options.store.forget(device, row.authUserId);
          return answer({ outcome: "forbidden" });
        }
        if (await options.pins.enabled(target.userAccountId)) {
          if (pin === undefined) { return answer({ outcome: "pin_required" }); }
          const check = await options.pins.check(target.userAccountId, device, pin);
          if (check.outcome === "rate_limited") { return answer(check); }
          if (check.outcome === "invalid") { return answer({ outcome: "pin_invalid" }); }
          // "not_set" means the PIN was removed in the meantime: one tap is right again.
        }
        const found = await ctx.context.internalAdapter.findUserById(row.authUserId);
        if (found === null || found.emailVerified !== true) { return answer({ outcome: "unavailable" }); }
        const current = await getSessionFromCtx(ctx).catch(() => null);
        if (current !== null) {
          // The account switched away from stays remembered; only its session on this device ends.
          await ctx.context.internalAdapter.deleteSession(current.session.token);
        }
        const session = await ctx.context.internalAdapter.createSession(found.id);
        if (session === null) { return answer({ outcome: "unavailable" }); }
        await options.store.recordSwitchSession(session.id, now);
        await options.store.touch(device, row.entryId, now);
        await setSessionCookie(ctx, { session, user: found });
        return answer({ outcome: "switched" });
      }),
    },
    hooks: {
      before: [
        {
          matcher: (context) => context.path === "/sign-out",
          handler: createAuthMiddleware(async (ctx) => {
            if (ctx.headers?.get(KEEP_REMEMBERED_HEADER) === "1") { return; }
            const device = currentDevice(ctx as unknown as CookieContext);
            if (device === null) { return; }
            const session = await getSessionFromCtx(ctx).catch(() => null);
            // Leaving a shared device means leaving it: no one-tap way back for this account.
            if (session !== null) { await options.store.forget(device, session.user.id); }
          }),
        },
        {
          matcher: (context) => context.path === "/revoke-sessions" ||
            context.path === "/revoke-other-sessions",
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx).catch(() => null);
            if (session === null) { return; }
            if (ctx.path === "/revoke-sessions") {
              // "Sign out on all devices": no device may tap back in afterwards.
              await options.store.forgetEverywhere(session.user.id);
            } else {
              await options.store.forgetElsewhere(session.user.id,
                currentDevice(ctx as unknown as CookieContext));
            }
          }),
        },
      ],
      after: [
        {
          matcher: (context) => context.path !== undefined && REMEMBERING_PATHS.has(context.path),
          handler: createAuthMiddleware(async (ctx) => {
            const created = ctx.context.newSession;
            if (created === null || created === undefined) { return; }
            if (ctx.headers?.get("authorization") !== null &&
                ctx.headers?.get("authorization") !== undefined) { return; }
            const cookies = ctx as unknown as CookieContext;
            const cookie = deviceCookie(cookies);
            try {
              const target = await options.directory.resolve(created.user.id);
              const existing = cookies.getCookie(cookie.name);
              if (target?.administrator === true) {
                // Administrators always sign in afresh.
                const known = deviceDigest(options.keys, existing);
                if (known !== null) { await options.store.forget(known, created.user.id); }
                return;
              }
              const value = deviceDigest(options.keys, existing) === null ? newDeviceValue() : existing!;
              const device = deviceDigest(options.keys, value);
              if (device === null) { return; }
              // Set (or refreshed) on every remembering sign-in, so an active device never expires.
              cookies.setCookie(cookie.name, value, cookie.attributes);
              await options.store.remember(device, created.user.id, newEntryId(), nowMs(),
                REMEMBERED_ACCOUNTS_PER_DEVICE);
            } catch {
              // Remembering is a convenience: it must never fail the sign-in itself.
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
