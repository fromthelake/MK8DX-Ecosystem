import type { FastifyInstance } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorResolver } from "../identity/types.js";
import type { TimeTrialWebCsrfVerifier } from
  "../timetrials/submission-routes.js";
import {
  accountSettingRateLimitFailure,
  consumeAccountSettingMutationBudget,
} from "../security/account-setting-mutation-budget.js";
import type { MutationRateLimiter } from "../security/mysql-mutation-rate-limiter.js";
import {
  NOTIFICATION_KINDS,
  NotificationError,
  type NotificationService,
} from "./notification-service.js";

type ErrorResponse = Readonly<{ code: string; message: string }>;

export type NotificationRouteOptions = Readonly<{
  resolveActor: ActorResolver;
  service: Pick<NotificationService, "listMine" | "markRead" | "listEvents">;
  csrfVerifier?: TimeTrialWebCsrfVerifier;
  rateLimiter: MutationRateLimiter;
}>;

export const inboxResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "unreadCount", "notifications"],
  properties: {
    schemaVersion: {
      type: "string",
      const: "mk8dx.notifications.v1",
    },
    unreadCount: { type: "integer", minimum: 0 },
    notifications: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["notificationId", "kind", "count", "lastEventAtMs", "read"],
        properties: {
          notificationId: { type: "string", pattern: "^[0-9]{1,19}$" },
          kind: { type: "string", enum: [...NOTIFICATION_KINDS] },
          actorPlayerId: {
            type: "string",
            pattern: "^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
          },
          actorDisplayName: { type: "string", minLength: 1, maxLength: 128 },
          trackId: {
            type: "string",
            pattern: "^track\\.[a-z0-9]+(?:_[a-z0-9]+)*$",
          },
          mode: { type: "integer", enum: [150, 200] },
          groupId: { type: "string", pattern: "^social_group\\.[a-z0-9-]{8,64}$" },
          groupName: { type: "string", minLength: 1, maxLength: 80 },
          // ADR-0222: the night a sign-up entry is about.
          tournamentId: { type: "string", pattern: "^tournament\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$" },
          tournamentName: { type: "string", minLength: 1, maxLength: 128 },
          detail: { type: "string", minLength: 1, maxLength: 32 },
          actorTimeMs: { type: "integer", minimum: 1, maximum: 599999 },
          recipientTimeMs: { type: "integer", minimum: 1, maximum: 599999 },
          deltaMs: { type: "integer", minimum: -599998, maximum: -1 },
          recipientRank: { type: "integer", minimum: 1 },
          count: { type: "integer", minimum: 1 },
          lastEventAtMs: { type: "integer", minimum: 0 },
          read: { type: "boolean" },
        },
      },
    },
  },
} as const;

export const notificationEventsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "notificationId", "events"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.notification-events.v1" },
    notificationId: { type: "string", pattern: "^[0-9]{1,19}$" },
    events: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["occurredAtMs"],
        properties: {
          occurredAtMs: { type: "integer", minimum: 0 },
          actorPlayerId: {
            type: "string",
            pattern: "^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
          },
          actorDisplayName: { type: "string", minLength: 1, maxLength: 128 },
          trackId: {
            type: "string",
            pattern: "^track\.[a-z0-9]+(?:_[a-z0-9]+)*$",
          },
          mode: { type: "integer", enum: [150, 200] },
          detail: { type: "string", minLength: 1, maxLength: 32 },
          actorTimeMs: { type: "integer", minimum: 1, maximum: 599999 },
          recipientTimeMs: { type: "integer", minimum: 1, maximum: 599999 },
          recipientRank: { type: "integer", minimum: 1 },
        },
      },
    },
  },
} as const;

const markReadBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    all: { type: "boolean", const: true },
    notificationIds: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: { type: "string", pattern: "^[0-9]{1,19}$" },
    },
  },
} as const;

const acknowledgedSchema = {
  type: "object",
  additionalProperties: false,
  required: ["acknowledged"],
  properties: { acknowledged: { type: "boolean", const: true } },
} as const;

function errorReply(error: unknown): Readonly<{
  status: number;
  body: ErrorResponse;
}> {
  if (error instanceof NotificationError) {
    if (error.code === "invalid_input") {
      return {
        status: 400,
        body: {
          code: "notifications_invalid",
          message: "The notification request is not valid.",
        },
      };
    }
    if (error.code === "not_authenticated") {
      return {
        status: 401,
        body: {
          code: "not_authenticated",
          message: "Sign in to read notifications.",
        },
      };
    }
  }
  return {
    status: 503,
    body: {
      code: "notifications_unavailable",
      message: "Notifications are temporarily unavailable.",
    },
  };
}

export async function registerNotificationRoutes(
  app: FastifyInstance,
  options: NotificationRouteOptions,
): Promise<void> {
  app.get<{ Reply: unknown }>(
    "/v1/notifications",
    {
      schema: {
        response: {
          200: inboxResponseSchema,
          401: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        const inbox = await options.service.listMine(actor);
        return reply.send({
          schemaVersion: "mk8dx.notifications.v1",
          ...inbox,
        });
      } catch (error) {
        const { status, body } = errorReply(error);
        return reply.code(status).send(body);
      }
    },
  );

  // Reading what an entry counted. A GET, and read-only: no same-origin proof
  // is required beyond the session the inbox itself already needs, because it
  // discloses exactly what the entry above it already summarises.
  app.get<{ Params: Readonly<{ notificationId: string }> }>(
    "/v1/notifications/:notificationId/events",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["notificationId"],
          properties: {
            notificationId: { type: "string", pattern: "^[0-9]{1,19}$" },
          },
        },
        response: {
          200: notificationEventsResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        const events = await options.service.listEvents(
          actor, request.params.notificationId,
        );
        void reply.header("cache-control", "no-store");
        return reply.send({
          schemaVersion: "mk8dx.notification-events.v1",
          notificationId: request.params.notificationId,
          events,
        });
      } catch (error) {
        const { status, body } = errorReply(error);
        return reply.code(status).send(body);
      }
    },
  );

  app.post<{
    Body: Readonly<{ all?: true; notificationIds?: readonly string[] }>;
  }>(
    "/v1/notifications/read",
    {
      schema: {
        body: markReadBodySchema,
        response: {
          200: acknowledgedSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          429: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        const proof = request.headers["x-mk8dx-csrf"];
        const nativeBearer = typeof request.headers.authorization === "string" &&
          request.headers.authorization.startsWith("Bearer ");
        if (options.csrfVerifier !== undefined && !nativeBearer &&
            (typeof proof !== "string" ||
             !await options.csrfVerifier.verify(actor, proof))) {
          throw new NotificationError("not_authenticated");
        }
        const target = request.body.all === true
          ? "all" as const
          : request.body.notificationIds;
        if (target === undefined) {
          throw new NotificationError("invalid_input");
        }
        await consumeAccountSettingMutationBudget(actor, options.rateLimiter);
        await options.service.markRead(actor, target);
        return reply.send({ acknowledged: true });
      } catch (error) {
        const limited = accountSettingRateLimitFailure(error);
        if (limited !== null) {
          void reply.header("retry-after", String(limited.retryAfterSeconds));
          return reply.code(429).send(limited.body);
        }
        const { status, body } = errorReply(error);
        return reply.code(status).send(body);
      }
    },
  );
}
