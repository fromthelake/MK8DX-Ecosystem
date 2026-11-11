/**
 * ADR-0224 phase 2 routes (docs/product/ACCOUNT_SWITCHING_DESIGN.md).
 *
 * - GET  /v1/session/remembered-accounts  the accounts this browser remembers: labels only
 * - POST /v1/session/account-switch       one tap (or the PIN) to become one of them
 * - GET  /v1/account/switch-pin           whether the signed-in Player account has a PIN
 * - PUT  /v1/account/switch-pin           turn it on or change it
 * - POST /v1/account/switch-pin/clear     turn it off
 *
 * Native apps (no cookies; an `X-MK8DX-Account-Device` header instead, ADR-0224 amendment):
 * - POST /v1/session/native-remember            remember the signed-in (bearer) account here
 * - GET  /v1/session/native-remembered-accounts the accounts this app device remembers
 * - POST /v1/session/native-account-switch      switch; answers with the new bearer token
 * - POST /v1/session/native-forget              remove one account from this app device's list
 *
 * The switch itself runs in a server-only Better Auth endpoint; these routes add closed response
 * schemas, the Origin and bearer refusals, CSRF proof for the settings and the mutation limit.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorContext, ActorResolver } from "../identity/types.js";
import {
  MutationRateLimitExceeded,
  type MutationRateLimiter,
} from "../security/mysql-mutation-rate-limiter.js";
import {
  ACCOUNT_SWITCH_FRESH_SIGN_IN_MS,
  NATIVE_ACCOUNT_DEVICE_HEADER,
  REMEMBERED_ACCOUNTS_PER_DEVICE,
  entryIdPattern,
  pinPattern,
  type AccountSwitchPins,
  type AccountSwitchStore,
} from "./account-switch.js";
import type {
  AccountSwitchOutcome,
  NativeRememberOutcome,
  RememberedAccountView,
} from "./account-switch-auth-plugin.js";

export const REMEMBERED_ACCOUNTS_PATH = "/v1/session/remembered-accounts";
export const ACCOUNT_SWITCH_PATH = "/v1/session/account-switch";
export const ACCOUNT_SWITCH_PIN_PATH = "/v1/account/switch-pin";
export const ACCOUNT_SWITCH_PIN_CLEAR_PATH = "/v1/account/switch-pin/clear";
export const REMEMBERED_ACCOUNTS_SCHEMA_VERSION = "mk8dx.remembered-accounts.v1";
export const ACCOUNT_SWITCH_SCHEMA_VERSION = "mk8dx.account-switch.v1";
export const ACCOUNT_SWITCH_PIN_SCHEMA_VERSION = "mk8dx.account-switch-pin.v1";
export const NATIVE_REMEMBER_PATH = "/v1/session/native-remember";
export const NATIVE_REMEMBERED_ACCOUNTS_PATH = "/v1/session/native-remembered-accounts";
export const NATIVE_ACCOUNT_SWITCH_PATH = "/v1/session/native-account-switch";
export const NATIVE_FORGET_PATH = "/v1/session/native-forget";
export const NATIVE_REMEMBERED_ACCOUNTS_SCHEMA_VERSION = "mk8dx.native-remembered-accounts.v1";
export const NATIVE_REMEMBER_SCHEMA_VERSION = "mk8dx.native-account-remember.v1";
export const NATIVE_ACCOUNT_SWITCH_SCHEMA_VERSION = "mk8dx.native-account-switch.v1";
/** Remembering is done once per sign-in (and once per account when an app upgrades). */
export const NATIVE_REMEMBERS_PER_DEVICE_HOUR = 30;
/** Turning a PIN on, changing or removing it: far beyond ordinary use. */
export const ACCOUNT_SWITCH_PIN_CHANGES_PER_HOUR = 10;

export const rememberedAccountsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "accounts"],
  properties: {
    schemaVersion: { type: "string", const: REMEMBERED_ACCOUNTS_SCHEMA_VERSION },
    accounts: {
      type: "array",
      maxItems: REMEMBERED_ACCOUNTS_PER_DEVICE,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["entryId", "pinRequired", "current"],
        properties: {
          entryId: { type: "string", pattern: "^[A-Za-z0-9_-]{22}$" },
          label: { type: "string", minLength: 1, maxLength: 128 },
          pinRequired: { type: "boolean" },
          current: { type: "boolean" },
        },
      },
    },
  },
} as const;

export const accountSwitchResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "switched"],
  properties: {
    schemaVersion: { type: "string", const: ACCOUNT_SWITCH_SCHEMA_VERSION },
    switched: { type: "boolean", const: true },
  },
} as const;

/** The browser list plus each account's Player id, which the app maps to its saved results. */
export const nativeRememberedAccountsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "accounts"],
  properties: {
    schemaVersion: { type: "string", const: NATIVE_REMEMBERED_ACCOUNTS_SCHEMA_VERSION },
    accounts: {
      type: "array",
      maxItems: REMEMBERED_ACCOUNTS_PER_DEVICE,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["entryId", "pinRequired", "current"],
        properties: {
          entryId: { type: "string", pattern: "^[A-Za-z0-9_-]{22}$" },
          label: { type: "string", minLength: 1, maxLength: 128 },
          playerId: { type: "string", pattern: "^player\\.[a-z0-9._-]{1,128}$" },
          pinRequired: { type: "boolean" },
          current: { type: "boolean" },
        },
      },
    },
  },
} as const;

export const nativeForgetResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "forgotten"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.native-account-forget.v1" },
    forgotten: { type: "boolean" },
  },
} as const;

export const nativeRememberResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "remembered"],
  properties: {
    schemaVersion: { type: "string", const: NATIVE_REMEMBER_SCHEMA_VERSION },
    remembered: { type: "boolean" },
  },
} as const;

export const nativeAccountSwitchResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "token", "expiresIn"],
  properties: {
    schemaVersion: { type: "string", const: NATIVE_ACCOUNT_SWITCH_SCHEMA_VERSION },
    token: { type: "string", minLength: 16, maxLength: 255 },
    expiresIn: { type: "integer", minimum: 60, maximum: 31_536_000 },
  },
} as const;

export const accountSwitchPinResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "enabled", "currentPinRequired"],
  properties: {
    schemaVersion: { type: "string", const: ACCOUNT_SWITCH_PIN_SCHEMA_VERSION },
    enabled: { type: "boolean" },
    currentPinRequired: { type: "boolean" },
  },
} as const;

type ErrorResponse = Readonly<{ code: string; message: string }>;
type RememberedAccountsDocument = Readonly<{
  schemaVersion: typeof REMEMBERED_ACCOUNTS_SCHEMA_VERSION;
  accounts: readonly Readonly<{ entryId: string; label?: string; pinRequired: boolean; current: boolean }>[];
}>;
type AccountSwitchDocument = Readonly<{ schemaVersion: typeof ACCOUNT_SWITCH_SCHEMA_VERSION; switched: true }>;
type AccountSwitchPinDocument = Readonly<{
  schemaVersion: typeof ACCOUNT_SWITCH_PIN_SCHEMA_VERSION;
  enabled: boolean;
  currentPinRequired: boolean;
}>;

/** The narrow part of the Better Auth instance these routes use. */
export interface AccountSwitchAuthApi {
  listRememberedAccounts(input: { headers: Headers }): Promise<{ accounts: readonly RememberedAccountView[] }>;
  switchRememberedAccount(input: { headers: Headers; body: unknown; returnHeaders: true }):
    Promise<{ headers: Headers; response: AccountSwitchOutcome }>;
  rememberNativeAccount(input: { headers: Headers }): Promise<NativeRememberOutcome>;
  forgetRememberedEntry(input: { headers: Headers; body: unknown }): Promise<{ forgotten: boolean }>;
  getSession(input: { headers: Headers }): Promise<{
    session: { id: string; createdAt: Date | string };
    user: { id: string };
  } | null>;
}

export type AccountSwitchRouteOptions = Readonly<{
  api: AccountSwitchAuthApi;
  resolveActor: ActorResolver;
  pins: AccountSwitchPins;
  store: Pick<AccountSwitchStore, "isSwitchSession">;
  rateLimiter: MutationRateLimiter;
  trustedOrigins: readonly string[];
  csrfVerifier?: Readonly<{ verify(actor: ActorContext, proof: string): boolean | Promise<boolean> }>;
  nowMs?: () => number;
}>;

function failure(code: string, message: string): ErrorResponse { return { code, message }; }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(body: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(body).every((key) => allowed.includes(key));
}

const errorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  429: errorResponseSchema,
  503: errorResponseSchema,
} as const;

export async function registerAccountSwitchRoutes(
  app: FastifyInstance,
  options: AccountSwitchRouteOptions,
): Promise<void> {
  const nowMs = options.nowMs ?? Date.now;
  const trusted = new Set(options.trustedOrigins);
  const sameSiteBrowser = (request: FastifyRequest): boolean => {
    const origin = request.headers.origin;
    return typeof origin === "string" && trusted.has(origin) &&
      request.headers.authorization === undefined;
  };

  /** A native app: its device header, and none of a browser's Origin or cookies. */
  const nativeApp = (request: FastifyRequest): boolean => {
    const device = request.headers[NATIVE_ACCOUNT_DEVICE_HEADER];
    return typeof device === "string" && /^[A-Za-z0-9_-]{43}$/.test(device) &&
      request.headers.origin === undefined && request.headers.cookie === undefined;
  };
  const deviceSubject = (request: FastifyRequest): string =>
    `native-device.${String(request.headers[NATIVE_ACCOUNT_DEVICE_HEADER]).slice(0, 16)}`;
  const listDocument = (accounts: readonly RememberedAccountView[]): RememberedAccountsDocument => ({
    schemaVersion: REMEMBERED_ACCOUNTS_SCHEMA_VERSION,
    accounts: accounts.slice(0, REMEMBERED_ACCOUNTS_PER_DEVICE).map((account) => ({
      entryId: account.entryId,
      ...(account.label === null || account.label.length === 0
        ? {} : { label: account.label.slice(0, 128) }),
      pinRequired: account.pinRequired,
      current: account.current,
    })),
  });

  app.post<{ Reply: Readonly<{ schemaVersion: typeof NATIVE_REMEMBER_SCHEMA_VERSION; remembered: boolean }> | ErrorResponse }>(
    NATIVE_REMEMBER_PATH, {
      schema: { response: { 200: nativeRememberResponseSchema, ...errorResponses } },
    }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (!nativeApp(request) || request.headers.authorization === undefined) {
        return reply.code(403).send(failure("native_remember_forbidden", "Only the signed-in app can do this."));
      }
      try {
        await options.rateLimiter.consume(deviceSubject(request), "native-account-remember",
          3_600, NATIVE_REMEMBERS_PER_DEVICE_HOUR);
      } catch (error) {
        if (error instanceof MutationRateLimitExceeded) {
          reply.header("retry-after", String(error.retryAfterSeconds));
          return reply.code(429).send(failure("native_remember_rate_limited", "Try again later."));
        }
        return reply.code(503).send(failure("native_remember_unavailable", "Try again later."));
      }
      let outcome: NativeRememberOutcome;
      try {
        outcome = await options.api.rememberNativeAccount({ headers: fromNodeHeaders(request.headers) });
      } catch {
        return reply.code(503).send(failure("native_remember_unavailable", "Try again later."));
      }
      if (outcome.outcome === "unavailable") {
        return reply.code(401).send(failure("session_authentication_required", "Authentication is required."));
      }
      return reply.send({ schemaVersion: NATIVE_REMEMBER_SCHEMA_VERSION, remembered: outcome.outcome === "remembered" });
    });

  app.post<{ Reply: Readonly<{ schemaVersion: "mk8dx.native-account-forget.v1"; forgotten: boolean }> | ErrorResponse }>(
    NATIVE_FORGET_PATH, {
      schema: { response: { 200: nativeForgetResponseSchema, ...errorResponses } },
    }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (!nativeApp(request)) {
        return reply.code(403).send(failure("native_forget_forbidden", "Only the app can do this."));
      }
      const body: unknown = request.body;
      if (!isPlainObject(body) || !onlyKeys(body, ["entryId"]) ||
          typeof body["entryId"] !== "string" || !entryIdPattern.test(body["entryId"])) {
        return reply.code(400).send(failure("native_forget_invalid", "Choose an account from the list."));
      }
      try {
        const { forgotten } = await options.api.forgetRememberedEntry({
          headers: fromNodeHeaders(request.headers), body: { entryId: body["entryId"] } });
        return reply.send({ schemaVersion: "mk8dx.native-account-forget.v1", forgotten });
      } catch {
        return reply.code(503).send(failure("native_forget_unavailable", "Try again later."));
      }
    });

  app.get<{ Reply: (Omit<RememberedAccountsDocument, "schemaVersion" | "accounts"> & {
    schemaVersion: typeof NATIVE_REMEMBERED_ACCOUNTS_SCHEMA_VERSION;
    accounts: readonly Readonly<{ entryId: string; label?: string; playerId?: string; pinRequired: boolean; current: boolean }>[];
  }) | ErrorResponse }>(NATIVE_REMEMBERED_ACCOUNTS_PATH, {
    schema: { response: { 200: nativeRememberedAccountsResponseSchema, ...errorResponses } },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!nativeApp(request)) {
      return reply.code(403).send(failure("native_remembered_accounts_forbidden", "Only the app can list this."));
    }
    try {
      const { accounts } = await options.api.listRememberedAccounts({ headers: fromNodeHeaders(request.headers) });
      return reply.send({
        schemaVersion: NATIVE_REMEMBERED_ACCOUNTS_SCHEMA_VERSION,
        accounts: accounts.slice(0, REMEMBERED_ACCOUNTS_PER_DEVICE).map((account) => ({
          entryId: account.entryId,
          ...(account.label === null || account.label.length === 0 ? {} : { label: account.label.slice(0, 128) }),
          ...(account.playerId === null ? {} : { playerId: account.playerId }),
          pinRequired: account.pinRequired,
          current: account.current,
        })),
      });
    } catch {
      return reply.code(503).send(failure("remembered_accounts_unavailable",
        "Remembered accounts are temporarily unavailable."));
    }
  });

  app.post<{ Reply: Readonly<{ schemaVersion: typeof NATIVE_ACCOUNT_SWITCH_SCHEMA_VERSION; token: string; expiresIn: number }> | ErrorResponse }>(
    NATIVE_ACCOUNT_SWITCH_PATH, {
      schema: { response: { 200: nativeAccountSwitchResponseSchema, ...errorResponses } },
    }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (!nativeApp(request)) {
        return reply.code(403).send(failure("account_switch_origin_invalid", "Switch accounts from the app."));
      }
      const body: unknown = request.body;
      if (!isPlainObject(body) || !onlyKeys(body, ["entryId", "pin"]) ||
          typeof body["entryId"] !== "string" || !entryIdPattern.test(body["entryId"]) ||
          (body["pin"] !== undefined && (typeof body["pin"] !== "string" || !pinPattern.test(body["pin"])))) {
        return reply.code(400).send(failure("account_switch_invalid", "Choose an account from the list."));
      }
      let result: Awaited<ReturnType<AccountSwitchAuthApi["switchRememberedAccount"]>>;
      try {
        result = await options.api.switchRememberedAccount({
          headers: fromNodeHeaders(request.headers),
          body: { entryId: body["entryId"], ...(body["pin"] === undefined ? {} : { pin: body["pin"] }) },
          returnHeaders: true,
        });
      } catch {
        return reply.code(503).send(failure("account_switch_unavailable",
          "Switching accounts is temporarily unavailable."));
      }
      const outcome = result.response;
      if (outcome.outcome === "switched") {
        const expiresIn = Math.floor((outcome.expiresAtMs - nowMs()) / 1_000);
        if (!Number.isSafeInteger(expiresIn) || expiresIn < 60) {
          return reply.code(503).send(failure("account_switch_unavailable",
            "Switching accounts is temporarily unavailable."));
        }
        return reply.send({ schemaVersion: NATIVE_ACCOUNT_SWITCH_SCHEMA_VERSION, token: outcome.token,
          expiresIn: Math.min(expiresIn, 31_536_000) });
      }
      return sendSwitchFailure(reply, outcome);
    });

  app.get<{ Reply: RememberedAccountsDocument | ErrorResponse }>(REMEMBERED_ACCOUNTS_PATH, {
    schema: { response: { 200: rememberedAccountsResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    // A native client has no remembered device; it gets the empty list, never someone's labels.
    if (request.headers.authorization !== undefined) {
      return reply.send({ schemaVersion: REMEMBERED_ACCOUNTS_SCHEMA_VERSION, accounts: [] });
    }
    try {
      const { accounts } = await options.api.listRememberedAccounts({
        headers: fromNodeHeaders(request.headers),
      });
      return reply.send(listDocument(accounts));
    } catch {
      return reply.code(503).send(failure("remembered_accounts_unavailable",
        "Remembered accounts are temporarily unavailable."));
    }
  });

  app.post<{ Reply: AccountSwitchDocument | ErrorResponse }>(ACCOUNT_SWITCH_PATH, {
    schema: { response: { 200: accountSwitchResponseSchema, ...errorResponses } },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!sameSiteBrowser(request)) {
      return reply.code(403).send(failure("account_switch_origin_invalid",
        "Switch accounts from this installation's own page."));
    }
    const body: unknown = request.body;
    if (!isPlainObject(body) || !onlyKeys(body, ["entryId", "pin"]) ||
        typeof body["entryId"] !== "string" || !entryIdPattern.test(body["entryId"]) ||
        (body["pin"] !== undefined && (typeof body["pin"] !== "string" || !pinPattern.test(body["pin"])))) {
      return reply.code(400).send(failure("account_switch_invalid", "Choose an account from the list."));
    }
    let result: Awaited<ReturnType<AccountSwitchAuthApi["switchRememberedAccount"]>>;
    try {
      result = await options.api.switchRememberedAccount({
        headers: fromNodeHeaders(request.headers),
        body: { entryId: body["entryId"], ...(body["pin"] === undefined ? {} : { pin: body["pin"] }) },
        returnHeaders: true,
      });
    } catch {
      return reply.code(503).send(failure("account_switch_unavailable",
        "Switching accounts is temporarily unavailable."));
    }
    const outcome = result.response;
    if (outcome.outcome === "switched") {
      // The browser gets the session cookie only; the token in the outcome is for native routes.
      const cookies = result.headers.getSetCookie();
      if (cookies.length > 0) { reply.header("set-cookie", cookies); }
      return reply.send({ schemaVersion: ACCOUNT_SWITCH_SCHEMA_VERSION, switched: true });
    }
    return sendSwitchFailure(reply, outcome);
  });

  function sendSwitchFailure(reply: FastifyReply, outcome: Exclude<AccountSwitchOutcome, { outcome: "switched" }>) {
    switch (outcome.outcome) {
      case "pin_required":
        return reply.code(403).send(failure("account_switch_pin_required", "Enter this account's PIN."));
      case "pin_invalid":
        return reply.code(403).send(failure("account_switch_pin_invalid", "That PIN is not right."));
      case "forbidden":
        return reply.code(403).send(failure("account_switch_forbidden",
          "This account signs in afresh every time."));
      case "rate_limited":
        reply.header("retry-after", String(outcome.retryAfterSeconds));
        return reply.code(429).send(failure("account_switch_rate_limited",
          "Too many PIN attempts. Wait before trying again."));
      default:
        return reply.code(404).send(failure("account_switch_unavailable",
          "This account is no longer remembered here. Sign in instead."));
    }
  }

  type PinContext = Readonly<{
    actor: Readonly<{ role: "account"; userAccountId: string }>;
    enabled: boolean;
    freshSignIn: boolean;
    currentPinRequired: boolean;
  }>;
  /** Resolves the Player account and whether changing its PIN needs the current one. */
  const pinContext = async (request: FastifyRequest, reply: FastifyReply): Promise<PinContext | null> => {
    let actor: ActorContext;
    try {
      actor = await options.resolveActor(request);
    } catch {
      await reply.code(503).send(failure("account_switch_pin_unavailable", "The PIN setting is temporarily unavailable."));
      return null;
    }
    if (actor.role === "anonymous") {
      await reply.code(401).send(failure("session_authentication_required", "Authentication is required."));
      return null;
    }
    if (actor.role !== "account") {
      await reply.code(403).send(failure("account_switch_pin_forbidden",
        "Administrator accounts are never switched to; they sign in afresh."));
      return null;
    }
    try {
      const enabled = await options.pins.enabled(actor.userAccountId);
      const session = await options.api.getSession({ headers: fromNodeHeaders(request.headers) });
      const createdAtMs = session === null ? Number.NaN : new Date(session.session.createdAt).getTime();
      // A forgotten PIN: a real sign-in in the last 15 minutes (not a switch) may change or remove it.
      const freshSignIn = session !== null && Number.isFinite(createdAtMs) &&
        nowMs() - createdAtMs < ACCOUNT_SWITCH_FRESH_SIGN_IN_MS &&
        !await options.store.isSwitchSession(session.session.id);
      return { actor: { role: "account", userAccountId: actor.userAccountId }, enabled, freshSignIn, currentPinRequired: enabled && !freshSignIn };
    } catch {
      await reply.code(503).send(failure("account_switch_pin_unavailable", "The PIN setting is temporarily unavailable."));
      return null;
    }
  };
  const document = (enabled: boolean, currentPinRequired: boolean): AccountSwitchPinDocument => ({
    schemaVersion: ACCOUNT_SWITCH_PIN_SCHEMA_VERSION, enabled, currentPinRequired,
  });

  app.get<{ Reply: AccountSwitchPinDocument | ErrorResponse }>(ACCOUNT_SWITCH_PIN_PATH, {
    schema: { response: { 200: accountSwitchPinResponseSchema, ...errorResponses } },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const context = await pinContext(request, reply);
    if (context === null) { return reply; }
    return reply.send(document(context.enabled, context.currentPinRequired));
  });

  const change = async (
    request: FastifyRequest,
    reply: FastifyReply,
    newPin: string | null,
  ): Promise<FastifyReply> => {
    reply.header("Cache-Control", "no-store");
    if (!sameSiteBrowser(request)) {
      return reply.code(403).send(failure("account_switch_pin_origin_invalid", "Reload the page and try again."));
    }
    const context = await pinContext(request, reply);
    if (context === null) { return reply; }
    const body = request.body as Record<string, unknown>;
    const proof = request.headers["x-mk8dx-csrf"];
    try {
      if (options.csrfVerifier !== undefined &&
          (typeof proof !== "string" || !await options.csrfVerifier.verify(context.actor, proof))) {
        return reply.code(403).send(failure("account_switch_pin_csrf_invalid", "Reload the page and try again."));
      }
      await options.rateLimiter.consume(context.actor.userAccountId, "account-switch-pin-change",
        3_600, ACCOUNT_SWITCH_PIN_CHANGES_PER_HOUR);
    } catch (error) {
      if (error instanceof MutationRateLimitExceeded) {
        reply.header("retry-after", String(error.retryAfterSeconds));
        return reply.code(429).send(failure("account_switch_pin_rate_limited",
          "Too many PIN changes. Wait before trying again."));
      }
      return reply.code(503).send(failure("account_switch_pin_unavailable", "The PIN setting is temporarily unavailable."));
    }
    try {
      if (context.currentPinRequired) {
        const currentPin = body["currentPin"];
        if (typeof currentPin !== "string") {
          return reply.code(403).send(failure("account_switch_pin_current_required", "Enter the current PIN."));
        }
        const check = await options.pins.check(context.actor.userAccountId, null, currentPin);
        if (check.outcome === "rate_limited") {
          reply.header("retry-after", String(check.retryAfterSeconds));
          return reply.code(429).send(failure("account_switch_rate_limited",
            "Too many PIN attempts. Wait before trying again."));
        }
        if (check.outcome === "invalid") {
          return reply.code(403).send(failure("account_switch_pin_invalid", "That PIN is not right."));
        }
      }
      if (newPin === null) {
        await options.pins.clear(context.actor.userAccountId);
      } else {
        await options.pins.set(context.actor.userAccountId, newPin, nowMs());
      }
      return reply.send(document(newPin !== null, newPin !== null && !context.freshSignIn));
    } catch {
      return reply.code(503).send(failure("account_switch_pin_unavailable", "The PIN setting is temporarily unavailable."));
    }
  };

  const validPinBody = (body: unknown, allowed: readonly string[], needsPin: boolean): boolean =>
    isPlainObject(body) && onlyKeys(body, allowed) &&
    (!needsPin || (typeof body["pin"] === "string" && pinPattern.test(body["pin"]))) &&
    (body["currentPin"] === undefined ||
      (typeof body["currentPin"] === "string" && pinPattern.test(body["currentPin"])));

  app.put<{ Reply: AccountSwitchPinDocument | ErrorResponse }>(ACCOUNT_SWITCH_PIN_PATH, {
    schema: { response: { 200: accountSwitchPinResponseSchema, ...errorResponses } },
  }, async (request, reply) => {
    if (!validPinBody(request.body, ["pin", "currentPin"], true)) {
      reply.header("Cache-Control", "no-store");
      return reply.code(400).send(failure("account_switch_pin_invalid_input", "A PIN is four digits."));
    }
    return change(request, reply, (request.body as { pin: string }).pin);
  });

  app.post<{ Reply: AccountSwitchPinDocument | ErrorResponse }>(ACCOUNT_SWITCH_PIN_CLEAR_PATH, {
    schema: { response: { 200: accountSwitchPinResponseSchema, ...errorResponses } },
  }, async (request, reply) => {
    if (!validPinBody(request.body ?? {}, ["currentPin"], false)) {
      reply.header("Cache-Control", "no-store");
      return reply.code(400).send(failure("account_switch_pin_invalid_input", "A PIN is four digits."));
    }
    if (request.body === undefined || request.body === null) { request.body = {}; }
    return change(request, reply, null);
  });
}
