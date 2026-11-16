/**
 * ADR-0224 amendment (2026-11-16): the Android app redeems a personal sign-in card itself.
 *
 * - POST /v1/session/native-invitation-preview  who the card signs in as (does not use it up)
 * - POST /v1/session/native-invitation-redeem   use the card; answers with a bearer session token
 *
 * Registered only in an offline-invitation (A2) installation. The card is the same one-use, 15-minute
 * ticket the browser page `/offline-invite` redeems: the same atomic consume, the same per-card and
 * global limits, the same account binding and the same Better Auth session (bearer instead of cookie),
 * so the app gains nothing that card plus browser plus device approval did not already give it.
 *
 * What keeps it on the right installation and away from browsers:
 * - only a native app: the app device header, and no Origin, Cookie or Authorization header. A web
 *   page cannot send this request without an Origin, so no foreign page can spend a victim's card;
 * - the body names the installation origin the card was printed for, and it must be this
 *   installation's own origin (the app compares the card's origin with the origin it pinned before it
 *   sends anything, so the token only ever travels to its own host over pinned TLS);
 * - a per-address budget before any work, then the card's own limits (keyed by an HMAC of the token).
 * The token is never logged: it travels only in the JSON body, and no failure answer echoes it.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import {
  MutationRateLimitExceeded,
} from "../security/mysql-mutation-rate-limiter.js";
import type { PreAuthBudget } from "../security/pre-auth-budget.js";
import { NATIVE_ACCOUNT_DEVICE_HEADER } from "./account-switch.js";
import { OFFLINE_INVITATION_REDEEM_LIMITS } from "./offline-invitation-auth-plugin.js";

export const NATIVE_INVITATION_PREVIEW_PATH = "/v1/session/native-invitation-preview";
export const NATIVE_INVITATION_REDEEM_PATH = "/v1/session/native-invitation-redeem";
export const NATIVE_INVITATION_PREVIEW_SCHEMA_VERSION = "mk8dx.native-invitation-preview.v1";
export const NATIVE_INVITATION_SESSION_SCHEMA_VERSION = "mk8dx.native-invitation-session.v1";

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const devicePattern = /^[A-Za-z0-9_-]{43}$/;

export const nativeInvitationPreviewResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "displayLabel"],
  properties: {
    schemaVersion: { type: "string", const: NATIVE_INVITATION_PREVIEW_SCHEMA_VERSION },
    displayLabel: { type: "string", minLength: 1, maxLength: 128 },
  },
} as const;

export const nativeInvitationSessionResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "token", "expiresIn"],
  properties: {
    schemaVersion: { type: "string", const: NATIVE_INVITATION_SESSION_SCHEMA_VERSION },
    token: { type: "string", minLength: 16, maxLength: 255 },
    expiresIn: { type: "integer", minimum: 60, maximum: 31_536_000 },
  },
} as const;

const requestBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["token", "origin"],
  properties: {
    token: { type: "string", minLength: 1, maxLength: 128 },
    origin: { type: "string", minLength: 1, maxLength: 128 },
  },
} as const;

/** The narrow part of the Better Auth instance these routes use (server-only endpoints). */
export interface NativeInvitationAuthApi {
  previewOfflineInvitationNative(input: { body: { token: string } }): Promise<{ displayLabel: string }>;
  redeemOfflineInvitationNative(input: { body: { token: string } }): Promise<{ token: string; expiresAtMs: number }>;
  /** Ends a session this route created but could not hand over. */
  revokeOfflineInvitationNativeSession(input: { body: { token: string } }): Promise<{ revoked: boolean }>;
}

export type NativeInvitationRouteOptions = Readonly<{
  api: NativeInvitationAuthApi;
  /** The installation's exact public HTTPS origin, the one its cards are printed for. */
  origin: string;
  preAuthBudget: PreAuthBudget;
  nowMs?: () => number;
}>;

type ErrorResponse = Readonly<{ code: string; message: string }>;
type Body = Readonly<{ token: string; origin: string }>;

function failure(code: string, message: string): ErrorResponse { return { code, message }; }

const errorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  429: errorResponseSchema,
  503: errorResponseSchema,
} as const;

/** Better Auth's APIError carries the HTTP status and our `code` in its body. */
function authErrorCode(error: unknown): Readonly<{ status: number; code: string | null; retryAfter: string | null }> {
  if (typeof error !== "object" || error === null) { return { status: 0, code: null, retryAfter: null }; }
  const record = error as { statusCode?: unknown; body?: { code?: unknown }; headers?: unknown };
  const status = typeof record.statusCode === "number" ? record.statusCode : 0;
  const code = typeof record.body?.code === "string" ? record.body.code : null;
  let retryAfter: string | null = null;
  const headers = record.headers;
  if (headers instanceof Headers) { retryAfter = headers.get("retry-after"); }
  else if (typeof headers === "object" && headers !== null) {
    const value = (headers as Record<string, unknown>)["Retry-After"] ?? (headers as Record<string, unknown>)["retry-after"];
    retryAfter = typeof value === "string" ? value : null;
  }
  return { status, code, retryAfter };
}

export async function registerNativeInvitationRoutes(
  app: FastifyInstance,
  options: NativeInvitationRouteOptions,
): Promise<void> {
  const origin = new URL(options.origin).origin;
  if (origin !== options.origin || !origin.startsWith("https://")) {
    throw new Error("native invitation routes need the installation's exact HTTPS origin");
  }
  const nowMs = options.nowMs ?? Date.now;

  /** A native app: its device header, and none of a browser's Origin or cookies, and no session yet. */
  const nativeApp = (request: FastifyRequest): boolean => {
    const device = request.headers[NATIVE_ACCOUNT_DEVICE_HEADER];
    return typeof device === "string" && devicePattern.test(device) &&
      request.headers.origin === undefined && request.headers.cookie === undefined &&
      request.headers.authorization === undefined;
  };

  /** Shared gate of both routes; answers and returns null when the request may not go on. */
  const admit = async (request: FastifyRequest<{ Body: Body }>, reply: FastifyReply): Promise<string | null> => {
    void reply.header("Cache-Control", "no-store");
    if (!nativeApp(request)) {
      await reply.code(403).send(failure("native_invitation_forbidden", "Scan the card with the app."));
      return null;
    }
    try {
      const { window, max } = OFFLINE_INVITATION_REDEEM_LIMITS.perAddress;
      await options.preAuthBudget.consume(request, "native-invitation-preauth", window, max);
    } catch (error) {
      if (error instanceof MutationRateLimitExceeded) {
        void reply.header("retry-after", String(error.retryAfterSeconds));
        await reply.code(429).send(failure("native_invitation_rate_limited", "Wait a moment, then try again."));
        return null;
      }
      await reply.code(503).send(failure("native_invitation_unavailable_now", "Try again later."));
      return null;
    }
    const body = request.body;
    if (body.origin !== origin) {
      await reply.code(403).send(failure("native_invitation_origin_invalid",
        "This card belongs to another installation."));
      return null;
    }
    if (!tokenPattern.test(body.token)) {
      await reply.code(400).send(failure("native_invitation_invalid", "This is not a sign-in card."));
      return null;
    }
    return body.token;
  };

  const refused = async (reply: FastifyReply, error: unknown) => {
    const { status, code, retryAfter } = authErrorCode(error);
    if (status === 429 || code === "offline_invitation_rate_limited") {
      void reply.header("retry-after", retryAfter ?? "60");
      return reply.code(429).send(failure("native_invitation_rate_limited", "Wait a moment, then try again."));
    }
    if (status === 401 || code === "offline_invitation_unavailable" ||
        code === "offline_invitation_account_unavailable") {
      // Unknown, used, expired and revoked cards all read the same.
      return reply.code(401).send(failure("native_invitation_unavailable",
        "This card can no longer be used. Ask for a new one."));
    }
    if (status === 400) {
      return reply.code(400).send(failure("native_invitation_invalid", "This is not a sign-in card."));
    }
    return reply.code(503).send(failure("native_invitation_unavailable_now", "Try again later."));
  };

  app.post<{ Body: Body; Reply: Readonly<{ schemaVersion: string; displayLabel: string }> | ErrorResponse }>(
    NATIVE_INVITATION_PREVIEW_PATH, {
      config: { requestBudget: "pre-auth" },
      bodyLimit: 1_024,
      schema: { body: requestBodySchema, response: { 200: nativeInvitationPreviewResponseSchema, ...errorResponses } },
    }, async (request, reply) => {
      const token = await admit(request, reply);
      if (token === null) { return reply; }
      try {
        const { displayLabel } = await options.api.previewOfflineInvitationNative({ body: { token } });
        return reply.send({ schemaVersion: NATIVE_INVITATION_PREVIEW_SCHEMA_VERSION,
          displayLabel: displayLabel.slice(0, 128) });
      } catch (error) {
        return refused(reply, error);
      }
    });

  app.post<{ Body: Body; Reply: Readonly<{ schemaVersion: string; token: string; expiresIn: number }> | ErrorResponse }>(
    NATIVE_INVITATION_REDEEM_PATH, {
      config: { requestBudget: "pre-auth" },
      bodyLimit: 1_024,
      schema: { body: requestBodySchema, response: { 200: nativeInvitationSessionResponseSchema, ...errorResponses } },
    }, async (request, reply) => {
      const token = await admit(request, reply);
      if (token === null) { return reply; }
      let session: { token: string; expiresAtMs: number };
      try {
        session = await options.api.redeemOfflineInvitationNative({ body: { token } });
      } catch (error) {
        return refused(reply, error);
      }
      const expiresIn = Math.floor((session.expiresAtMs - nowMs()) / 1_000);
      if (!Number.isSafeInteger(expiresIn) || expiresIn < 60) {
        // The card is used and a session exists that nobody will hold: end it before answering.
        await options.api.revokeOfflineInvitationNativeSession({ body: { token: session.token } }).catch(() => undefined);
        return reply.code(503).send(failure("native_invitation_unavailable_now", "Try again later."));
      }
      return reply.send({ schemaVersion: NATIVE_INVITATION_SESSION_SCHEMA_VERSION,
        token: session.token, expiresIn: Math.min(expiresIn, 31_536_000) });
    });
}
