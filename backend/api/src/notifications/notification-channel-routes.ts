import type { FastifyInstance, FastifyRequest } from "fastify";

import type { ActorResolver } from "../identity/types.js";
import { errorResponseSchema } from "../identity/schemas.js";
import type { TimeTrialWebCsrfVerifier } from "../timetrials/submission-routes.js";
import {
  ENGAGEMENT_ACCEPT_SCOPES,
  type EngagementAcceptScope,
  NOTIFICATION_SCOPES,
  NotificationChannelError,
  type NotificationChannelService,
  type NotificationScope,
} from "./notification-channel-service.js";

const statusSchema = {
  type: "object", additionalProperties: false,
  required: ["schemaVersion", "preferences", "webPush"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.notification-settings.v1" },
    preferences: {
      type: "object", additionalProperties: false,
      required: [
        "scope", "engagementAcceptScope", "competitiveOvertaken", "activityReactions",
      ],
      properties: {
        scope: { type: "string", enum: [...NOTIFICATION_SCOPES] },
        engagementAcceptScope: { type: "string", enum: [...ENGAGEMENT_ACCEPT_SCOPES] },
        competitiveOvertaken: { type: "boolean" },
        activityReactions: { type: "boolean" },
      },
    },
    webPush: {
      type: "object", additionalProperties: false,
      required: ["supported", "subscriptionCount"],
      properties: {
        supported: { type: "boolean" },
        applicationServerKey: { type: "string", minLength: 80, maxLength: 100 },
        subscriptionCount: { type: "integer", minimum: 0, maximum: 100 },
      },
    },
  },
} as const;
const preferencesSchema = {
  type: "object", additionalProperties: false,
  // Both scopes are optional and a missing one keeps its stored value: the
  // Android client offers no delivery scope and omits a default accept scope.
  required: ["competitiveOvertaken", "activityReactions"],
  properties: {
    scope: { type: "string", enum: [...NOTIFICATION_SCOPES] },
    engagementAcceptScope: { type: "string", enum: [...ENGAGEMENT_ACCEPT_SCOPES] },
    competitiveOvertaken: { type: "boolean" },
    activityReactions: { type: "boolean" },
  },
} as const;
const subscriptionSchema = {
  type: "object", additionalProperties: false,
  required: ["endpoint", "keys"],
  properties: {
    endpoint: { type: "string", minLength: 12, maxLength: 2048 },
    keys: {
      type: "object", additionalProperties: false,
      required: ["p256dh", "auth"],
      properties: {
        p256dh: { type: "string", minLength: 80, maxLength: 120 },
        auth: { type: "string", minLength: 20, maxLength: 32 },
      },
    },
  },
} as const;
const unsubscribeSchema = {
  type: "object", additionalProperties: false, required: ["endpoint"],
  properties: { endpoint: { type: "string", minLength: 12, maxLength: 2048 } },
} as const;
const acknowledgedSchema = {
  type: "object", additionalProperties: false, required: ["acknowledged"],
  properties: { acknowledged: { type: "boolean", const: true } },
} as const;

function replyFor(error: unknown): Readonly<{
  status: number;
  body: Readonly<{ code: string; message: string }>;
}> {
  if (error instanceof NotificationChannelError) {
    if (error.code === "invalid_input") return { status: 400, body: { code: "notification_settings_invalid", message: "Check the notification settings and try again." } };
    if (error.code === "not_authenticated") return { status: 401, body: { code: "not_authenticated", message: "Sign in to manage notifications." } };
    if (error.code === "unsupported") return { status: 409, body: { code: "web_push_unsupported", message: "Web notifications are not available on this installation." } };
  }
  return { status: 503, body: { code: "notification_settings_unavailable", message: "Notification settings are temporarily unavailable." } };
}

async function requireWrite(
  request: FastifyRequest,
  actor: Awaited<ReturnType<ActorResolver>>,
  verifier: TimeTrialWebCsrfVerifier | undefined,
): Promise<void> {
  if (verifier === undefined) { return; }
  // Native clients authenticate with a bearer credential that a cross-site
  // browser request cannot attach. Cookie-backed web writes still require the
  // short-lived account-bound CSRF proof.
  if (typeof request.headers.authorization === "string" &&
      request.headers.authorization.startsWith("Bearer ")) { return; }
  const proof = request.headers["x-mk8dx-csrf"];
  if (typeof proof !== "string" || !await verifier.verify(actor, proof)) {
    throw new NotificationChannelError("not_authenticated");
  }
}

export async function registerNotificationChannelRoutes(
  app: FastifyInstance,
  options: Readonly<{
    resolveActor: ActorResolver;
    service: NotificationChannelService;
    csrfVerifier?: TimeTrialWebCsrfVerifier;
  }>,
): Promise<void> {
  app.get("/v1/notification-settings", {
    schema: { response: { 200: statusSchema, 401: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    try {
      const value = await options.service.status(await options.resolveActor(request));
      return reply.send({ schemaVersion: "mk8dx.notification-settings.v1", ...value });
    } catch (error) {
      const result = replyFor(error);
      if (result.status === 401) return reply.code(401).send(result.body);
      return reply.code(503).send(result.body);
    }
  });

  app.put<{ Body: {
    scope?: NotificationScope;
    engagementAcceptScope?: EngagementAcceptScope;
    competitiveOvertaken: boolean;
    activityReactions: boolean;
  } }>(
    "/v1/notification-settings/preferences",
    { schema: { body: preferencesSchema, response: { 200: acknowledgedSchema, 400: errorResponseSchema, 401: errorResponseSchema, 503: errorResponseSchema } } },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        await requireWrite(request, actor, options.csrfVerifier);
        const current = await options.service.status(actor);
        await options.service.updatePreferences(actor, {
          scope: request.body.scope ?? current.preferences.scope,
          engagementAcceptScope: request.body.engagementAcceptScope
            ?? current.preferences.engagementAcceptScope,
          competitiveOvertaken: request.body.competitiveOvertaken,
          activityReactions: request.body.activityReactions,
        });
        return reply.send({ acknowledged: true });
      } catch (error) {
        const result = replyFor(error);
        if (result.status === 400) return reply.code(400).send(result.body);
        if (result.status === 401) return reply.code(401).send(result.body);
        return reply.code(503).send(result.body);
      }
    },
  );

  app.post<{ Body: { endpoint: string; keys: { p256dh: string; auth: string } } }>(
    "/v1/web-push/subscriptions",
    { schema: { body: subscriptionSchema, response: { 200: acknowledgedSchema, 400: errorResponseSchema, 401: errorResponseSchema, 409: errorResponseSchema, 503: errorResponseSchema } } },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        await requireWrite(request, actor, options.csrfVerifier);
        await options.service.subscribe(actor, request.body);
        return reply.send({ acknowledged: true });
      } catch (error) {
        const result = replyFor(error);
        if (result.status === 400) return reply.code(400).send(result.body);
        if (result.status === 401) return reply.code(401).send(result.body);
        if (result.status === 409) return reply.code(409).send(result.body);
        return reply.code(503).send(result.body);
      }
    },
  );

  app.delete<{ Body: { endpoint: string } }>(
    "/v1/web-push/subscriptions",
    { schema: { body: unsubscribeSchema, response: { 200: acknowledgedSchema, 400: errorResponseSchema, 401: errorResponseSchema, 503: errorResponseSchema } } },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        await requireWrite(request, actor, options.csrfVerifier);
        await options.service.unsubscribe(actor, request.body.endpoint);
        return reply.send({ acknowledged: true });
      } catch (error) {
        const result = replyFor(error);
        if (result.status === 400) return reply.code(400).send(result.body);
        if (result.status === 401) return reply.code(401).send(result.body);
        return reply.code(503).send(result.body);
      }
    },
  );
}
