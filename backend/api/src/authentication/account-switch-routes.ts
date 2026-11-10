/**
 * ADR-0224 phase 2 routes (docs/product/ACCOUNT_SWITCHING_DESIGN.md).
 *
 * - GET  /v1/session/remembered-accounts  the accounts this browser remembers: labels only
 * - POST /v1/session/account-switch       one tap (or the PIN) to become one of them
 * - GET  /v1/account/switch-pin           whether the signed-in Player account has a PIN
 * - PUT  /v1/account/switch-pin           turn it on or change it
 * - POST /v1/account/switch-pin/clear     turn it off
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
  REMEMBERED_ACCOUNTS_PER_DEVICE,
  entryIdPattern,
  pinPattern,
  type AccountSwitchPins,
  type AccountSwitchStore,
} from "./account-switch.js";
import type { AccountSwitchOutcome, RememberedAccountView } from "./account-switch-auth-plugin.js";

export const REMEMBERED_ACCOUNTS_PATH = "/v1/session/remembered-accounts";
export const ACCOUNT_SWITCH_PATH = "/v1/session/account-switch";
export const ACCOUNT_SWITCH_PIN_PATH = "/v1/account/switch-pin";
export const ACCOUNT_SWITCH_PIN_CLEAR_PATH = "/v1/account/switch-pin/clear";
export const REMEMBERED_ACCOUNTS_SCHEMA_VERSION = "mk8dx.remembered-accounts.v1";
export const ACCOUNT_SWITCH_SCHEMA_VERSION = "mk8dx.account-switch.v1";
export const ACCOUNT_SWITCH_PIN_SCHEMA_VERSION = "mk8dx.account-switch-pin.v1";
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
      return reply.send({
        schemaVersion: REMEMBERED_ACCOUNTS_SCHEMA_VERSION,
        accounts: accounts.slice(0, REMEMBERED_ACCOUNTS_PER_DEVICE).map((account) => ({
          entryId: account.entryId,
          ...(account.label === null || account.label.length === 0
            ? {} : { label: account.label.slice(0, 128) }),
          pinRequired: account.pinRequired,
          current: account.current,
        })),
      });
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
    switch (outcome.outcome) {
      case "switched": {
        const cookies = result.headers.getSetCookie();
        if (cookies.length > 0) { reply.header("set-cookie", cookies); }
        return reply.send({ schemaVersion: ACCOUNT_SWITCH_SCHEMA_VERSION, switched: true });
      }
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
  });

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
