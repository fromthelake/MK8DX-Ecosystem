import type { FastifyInstance } from "fastify";

import type { ActorResolver } from "../identity/types.js";
import type { MutationRateLimiter } from "../security/mysql-mutation-rate-limiter.js";
import type { TimeTrialWebCsrfVerifier } from "../timetrials/submission-routes.js";
import {
  ENGAGEMENT_KINDS,
  PlayerEngagementError,
  type EngagementFailure,
  type PlayerEngagementService,
} from "./player-engagement-service.js";

const playerIdPattern = "^player\\.[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$";

const errorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "message"],
  properties: { code: { type: "string" }, message: { type: "string" } },
} as const;

const engagementResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["engagementId", "kind", "recipientPlayerId", "createdAtMs"],
  properties: {
    engagementId: { type: "string" },
    kind: { type: "string", enum: [...ENGAGEMENT_KINDS] },
    recipientPlayerId: { type: "string", pattern: playerIdPattern },
    createdAtMs: { type: "integer", minimum: 0 },
    detail: { type: "object", additionalProperties: true },
  },
} as const;

const requestBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind"],
  properties: {
    kind: { type: "string", enum: [...ENGAGEMENT_KINDS] },
    detail: {
      type: "object",
      additionalProperties: false,
      properties: {
        hand: { type: "string", enum: ["rock", "paper", "scissors"] },
        // Accepted by the parser only so the service can explicitly reject
        // forged rolls/times; silently stripping them would hide bad clients.
        face: { type: "integer", minimum: 1, maximum: 6 },
        trackId: { type: "string", maxLength: 128 },
        mode: { type: "integer", enum: [150, 200] },
        totalTimeMs: { type: "integer", minimum: 1, maximum: 3_600_000 },
        deltaMs: { type: "integer", minimum: -3_600_000, maximum: 3_600_000 },
      },
    },
  },
} as const;

const engagementRecordSchema = {
  type: "object",
  additionalProperties: false,
  required: ["engagementId", "kind", "actorPlayerId", "recipientPlayerId", "createdAtMs"],
  properties: {
    engagementId: { type: "string" },
    kind: { type: "string", enum: [...ENGAGEMENT_KINDS] },
    actorPlayerId: { type: "string", pattern: playerIdPattern },
    recipientPlayerId: { type: "string", pattern: playerIdPattern },
    actorDisplayName: { type: "string" },
    recipientDisplayName: { type: "string" },
    detail: { type: "object", additionalProperties: true },
    createdAtMs: { type: "integer", minimum: 0 },
  },
} as const;

const allowanceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["available"],
  properties: {
    available: { type: "boolean" },
    reason: { type: "string", enum: ["cooldown", "awaiting_answer", "not_accepted", "recipient_limit", "no_account"] },
    availableAtMs: { type: "integer", minimum: 0 },
    engagementId: { type: "string" },
  },
} as const;

const conversationResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "playerId", "accepted", "actions", "engagements"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.player-engagement-conversation.v1" },
    playerId: { type: "string", pattern: playerIdPattern },
    accepted: { type: "boolean" },
    actions: {
      type: "object",
      additionalProperties: false,
      required: [...ENGAGEMENT_KINDS],
      properties: Object.fromEntries(ENGAGEMENT_KINDS.map((kind) => [kind, allowanceSchema])),
    },
    engagements: { type: "array", maxItems: 50, items: engagementRecordSchema },
  },
} as const;

/** What each refusal is, in HTTP terms and in words a person can act on. */
const refusals: Readonly<Record<EngagementFailure, Readonly<{
  status: number; code: string; message: string;
}>>> = {
  not_authenticated: {
    status: 401, code: "engagement_authentication_required",
    message: "Sign in to reach another Player.",
  },
  no_verified_player: {
    status: 403, code: "engagement_no_verified_player",
    message: "Claim your Player before reaching another one.",
  },
  recipient_not_found: {
    status: 404, code: "engagement_recipient_not_found",
    message: "That Player was not found.",
  },
  self_engagement: {
    status: 400, code: "engagement_self",
    message: "You cannot send this to yourself.",
  },
  not_accepted: {
    status: 403, code: "engagement_not_accepted",
    message: "That Player does not accept this from you.",
  },
  recipient_unreachable: {
    status: 409, code: "engagement_recipient_unreachable",
    message: "That Player has no account yet, so nobody would be notified.",
  },
  // 429 for all three so builds that only know "a limit" still say something sensible.
  cooldown: {
    status: 429, code: "engagement_cooldown",
    message: "You can send this to that Player once an hour.",
  },
  awaiting_answer: {
    status: 429, code: "engagement_awaiting_answer",
    message: "Your last game with that Player is still waiting for an answer.",
  },
  recipient_limit_reached: {
    status: 429, code: "engagement_recipient_limit",
    message: "That Player has received the most interactions allowed today.",
  },
  invalid_detail: {
    status: 400, code: "engagement_invalid_detail",
    message: "That is not a valid move.",
  },
  engagement_not_found: {
    status: 404, code: "engagement_not_found",
    message: "That game was not found.",
  },
  already_answered: {
    status: 409, code: "engagement_already_answered",
    message: "This game has already been answered.",
  },
};

export async function registerPlayerEngagementRoutes(
  app: FastifyInstance,
  options: Readonly<{
    resolveActor: ActorResolver;
    service: Pick<PlayerEngagementService, "send" | "list" | "answer" | "conversation">;
    csrfVerifier?: TimeTrialWebCsrfVerifier;
    rateLimiter?: MutationRateLimiter;
  }>,
): Promise<void> {
  app.post<{ Params: { playerId: string }; Body: { kind: string; detail?: unknown } }>(
    "/v1/players/:playerId/engagements",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["playerId"],
          properties: { playerId: { type: "string", pattern: playerIdPattern } },
        },
        body: requestBodySchema,
        response: {
          201: engagementResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          429: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        if (options.csrfVerifier !== undefined) {
          const proof = request.headers["x-mk8dx-csrf"];
          if (typeof proof !== "string" || !await options.csrfVerifier.verify(actor, proof)) {
            throw new PlayerEngagementError("not_authenticated");
          }
        }
        // A coarse per-account ceiling on top of the per-Player budgets: the
        // budgets protect a recipient, this protects the service.
        if (options.rateLimiter !== undefined &&
          (actor.role === "account" || actor.role === "administrator")) {
          await options.rateLimiter.consume(
            actor.userAccountId, "player-engagements-hour", 3_600, 60,
          );
        }
        const engagement = await options.service.send(actor, {
          kind: request.body.kind as never,
          recipientPlayerId: request.params.playerId,
          ...(request.body.detail === undefined
            ? {}
            : { detail: request.body.detail as never }),
        });
        return reply.code(201).send({
          engagementId: engagement.engagementId,
          kind: engagement.kind,
          recipientPlayerId: engagement.recipientPlayerId,
          createdAtMs: engagement.createdAtMs,
          ...(engagement.detail === undefined ? {} : { detail: engagement.detail }),
        });
      } catch (error) {
        if (error instanceof PlayerEngagementError) {
          const refusal = refusals[error.failure];
          return reply.code(refusal.status)
            .send({ code: refusal.code, message: refusal.message });
        }
        return reply.code(503).send({
          code: "engagement_unavailable",
          message: "Engagements are unavailable.",
        });
      }
    },
  );

  // The viewer's history with one Player and what they can send them now (owner 2026-09-26).
  app.get<{ Params: { playerId: string } }>(
    "/v1/players/:playerId/engagements",
    { schema: {
      params: { type: "object", additionalProperties: false, required: ["playerId"],
        properties: { playerId: { type: "string", pattern: playerIdPattern } } },
      response: {
        200: conversationResponseSchema,
        400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema,
        404: errorResponseSchema, 503: errorResponseSchema,
      },
    } },
    async (request, reply) => {
      try {
        const conversation = await options.service.conversation(
          await options.resolveActor(request), request.params.playerId);
        return reply.send({ schemaVersion: "mk8dx.player-engagement-conversation.v1", ...conversation });
      } catch (error) {
        if (error instanceof PlayerEngagementError) {
          const refusal = refusals[error.failure];
          return reply.code(refusal.status).send({ code: refusal.code, message: refusal.message });
        }
        return reply.code(503).send({ code: "engagement_unavailable", message: "Engagements are unavailable." });
      }
    },
  );

  app.get("/v1/player-engagements", async (request, reply) => {
    try {
      const inbox = await options.service.list(await options.resolveActor(request));
      return reply.send({ schemaVersion: "mk8dx.player-engagements.v1", ...inbox });
    } catch (error) {
      if (error instanceof PlayerEngagementError) {
        const refusal = refusals[error.failure];
        return reply.code(refusal.status).send({ code: refusal.code, message: refusal.message });
      }
      return reply.code(503).send({ code: "engagement_unavailable", message: "Engagements are unavailable." });
    }
  });

  app.post<{ Params: { engagementId: string }; Body: { hand?: "rock" | "paper" | "scissors" } }>(
    "/v1/player-engagements/:engagementId/reply",
    { schema: {
      params: { type: "object", additionalProperties: false, required: ["engagementId"],
        properties: { engagementId: { type: "string", pattern: "^player_engagement\\.[A-Za-z0-9_-]{6,128}$" } } },
      // A hand answers rock-paper-scissors; an empty body answers a dice duel with a server roll.
      body: { type: "object", additionalProperties: false,
        properties: { hand: { type: "string", enum: ["rock", "paper", "scissors"] } } },
    } },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        if (options.csrfVerifier !== undefined) {
          const proof = request.headers["x-mk8dx-csrf"];
          if (typeof proof !== "string" || !await options.csrfVerifier.verify(actor, proof)) {
            throw new PlayerEngagementError("not_authenticated");
          }
        }
        if (options.rateLimiter !== undefined &&
            (actor.role === "account" || actor.role === "administrator")) {
          await options.rateLimiter.consume(actor.userAccountId, "player-engagement-replies-hour", 3_600, 60);
        }
        const engagement = await options.service.answer(actor, request.params.engagementId, request.body?.hand);
        return reply.send({ schemaVersion: "mk8dx.player-engagement-result.v1", engagement });
      } catch (error) {
        if (error instanceof PlayerEngagementError) {
          const refusal = refusals[error.failure];
          return reply.code(refusal.status).send({ code: refusal.code, message: refusal.message });
        }
        return reply.code(503).send({ code: "engagement_unavailable", message: "Engagements are unavailable." });
      }
    },
  );
}
