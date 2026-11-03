import type { FastifyInstance } from "fastify";

import {
  PlayerOnboardingError,
  type PlayerOnboardingService,
} from "./player-onboarding-service.js";
import type { ActorContext, ActorResolver } from "./types.js";
import {
  MutationRateLimitExceeded,
  type MutationRateLimiter,
} from "../security/mysql-mutation-rate-limiter.js";

type ErrorResponse = Readonly<{ code: string; message: string }>;

const errorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "message"],
  properties: {
    code: { type: "string" },
    message: { type: "string" },
  },
} as const;

const createOwnPlayerBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["username"],
  properties: {
    username: {
      type: "string",
      minLength: 3,
      maxLength: 16,
      pattern: "^[a-z0-9_-]{3,16}$",
    },
    displayName: { type: "string", minLength: 1, maxLength: 64 },
  },
} as const;

const createdResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "playerId",
    "username",
    "displayName",
    "playerClaimId",
  ],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.own-player-created.v1" },
    playerId: { type: "string" },
    username: { type: "string" },
    displayName: { type: "string" },
    playerClaimId: { type: "string" },
  },
} as const;

type CreateOwnPlayerBody = Readonly<{ username: string; displayName?: string }>;
type CreatedResponse = Readonly<{
  schemaVersion: "mk8dx.own-player-created.v1";
  playerId: string;
  username: string;
  displayName: string;
  playerClaimId: string;
}>;

export type PlayerOnboardingRouteOptions = Readonly<{
  resolveActor: ActorResolver;
  service: Pick<PlayerOnboardingService, "createOwnPlayer" | "createPlayerForAdministrator">;
  csrfVerifier?: Readonly<{
    verify(actor: ActorContext, token: string): boolean;
  }>;
  rateLimiter?: MutationRateLimiter;
}>;

function failure(error: unknown): Readonly<{
  statusCode: 400 | 401 | 403 | 409 | 429 | 500;
  response: ErrorResponse;
}> {
  if (error instanceof MutationRateLimitExceeded) {
    return {
      statusCode: 429,
      response: {
        code: "player_onboarding_rate_limited",
        message: "Too many Player creation attempts were received. Wait before retrying.",
      },
    };
  }
  if (error instanceof PlayerOnboardingError) {
    switch (error.code) {
      case "invalid_command":
        return {
          statusCode: 400,
          response: { code: "player_onboarding_invalid", message: error.message },
        };
      case "forbidden":
        return {
          statusCode: 403,
          response: {
            code: "player_onboarding_forbidden",
            message: "Sign in to create a Player.",
          },
        };
      case "username_taken":
        return {
          statusCode: 409,
          response: {
            code: "username_taken",
            message: "This username is already in use.",
          },
        };
      case "display_name_taken":
        return {
          statusCode: 409,
          response: {
            code: "display_name_taken",
            message: "This Player name is already in use. Select the existing Player instead.",
          },
        };
      case "player_creation_disabled":
        return {
          statusCode: 403,
          response: {
            code: error.closedPath === "self" ? "player_creation_self_disabled" : "player_creation_directors_disabled",
            message: error.message,
          },
        };
      case "already_linked":
        return {
          statusCode: 409,
          response: {
            code: "player_already_linked",
            message: "This account is already linked to a Player.",
          },
        };
      case "conflict":
        return {
          statusCode: 409,
          response: {
            code: "player_onboarding_conflict",
            message: "The Player could not be created. Please retry.",
          },
        };
    }
  }
  return {
    statusCode: 500,
    response: {
      code: "player_onboarding_failed",
      message: "The Player could not be created.",
    },
  };
}

export async function registerPlayerOnboardingRoutes(
  app: FastifyInstance,
  options: PlayerOnboardingRouteOptions,
): Promise<void> {
  app.post<{ Body: CreateOwnPlayerBody; Reply: CreatedResponse | ErrorResponse }>(
    "/v1/me/player",
    {
      schema: {
        body: createOwnPlayerBodySchema,
        response: {
          201: createdResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          409: errorResponseSchema,
          429: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        if (actor.role === "anonymous") {
          return reply.code(401).send({
            code: "player_onboarding_authentication_required",
            message: "Sign in to create a Player.",
          });
        }
        if (options.csrfVerifier !== undefined) {
          const token = request.headers["x-mk8dx-csrf"];
          if (typeof token !== "string" ||
            !options.csrfVerifier.verify(actor, token)) {
            return reply.code(403).send({
              code: "player_onboarding_csrf_invalid",
              message: "A fresh request proof is required.",
            });
          }
        }
        if (options.rateLimiter !== undefined &&
            (actor.role === "account" || actor.role === "administrator")) {
          await options.rateLimiter.consume(
            actor.userAccountId,
            "player-onboarding-day",
            86_400,
            20,
          );
        }
        const created = await options.service.createOwnPlayer(
          actor,
          request.body,
        );
        return reply.code(201).send({
          schemaVersion: "mk8dx.own-player-created.v1",
          ...created,
        });
      } catch (error) {
        if (error instanceof MutationRateLimitExceeded) {
          void reply.header("retry-after", String(error.retryAfterSeconds));
        }
        const mapped = failure(error);
        return reply.code(mapped.statusCode).send(mapped.response);
      }
    },
  );

  app.post<{ Body: CreateOwnPlayerBody; Reply: { schemaVersion: string; playerId: string; username: string; displayName: string } | ErrorResponse }>(
    "/v1/administrator/players",
    {
      schema: {
        body: createOwnPlayerBodySchema,
        response: {
          201: {
            type: "object",
            additionalProperties: false,
            required: ["schemaVersion", "playerId", "username", "displayName"],
            properties: {
              schemaVersion: { const: "mk8dx.administrator-player-created.v1" },
              playerId: { type: "string", minLength: 8, maxLength: 135 },
              username: { type: "string", minLength: 3, maxLength: 16 },
              displayName: { type: "string", minLength: 1, maxLength: 64 },
            },
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          409: errorResponseSchema,
          429: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        if (actor.role === "anonymous") {
          return reply.code(401).send({
            code: "player_onboarding_authentication_required",
            message: "Sign in to create a Player.",
          });
        }
        if (options.csrfVerifier !== undefined) {
          const token = request.headers["x-mk8dx-csrf"];
          if (typeof token !== "string" ||
            !options.csrfVerifier.verify(actor, token)) {
            return reply.code(403).send({
              code: "player_onboarding_csrf_invalid",
              message: "A fresh request proof is required.",
            });
          }
        }
        if (options.rateLimiter !== undefined &&
            (actor.role === "account" || actor.role === "administrator")) {
          await options.rateLimiter.consume(
            actor.userAccountId,
            "administrator-player-create-day",
            86_400,
            100,
          );
        }
        const created = await options.service.createPlayerForAdministrator(
          actor,
          request.body,
        );
        return reply.code(201).send({
          schemaVersion: "mk8dx.administrator-player-created.v1",
          ...created,
        });
      } catch (error) {
        if (error instanceof MutationRateLimitExceeded) {
          void reply.header("retry-after", String(error.retryAfterSeconds));
        }
        const mapped = failure(error);
        return reply.code(mapped.statusCode).send(mapped.response);
      }
    },
  );
}
