import type { FastifyInstance } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorResolver } from "../identity/types.js";
import type { TimeTrialWebCsrfVerifier } from "./submission-routes.js";
import {
  MutationRateLimitExceeded,
  type MutationRateLimiter,
} from "../security/mysql-mutation-rate-limiter.js";
import {
  REACTION_KINDS,
  ReactionError,
  type ReactionKind,
  type ReactionService,
} from "./reaction-service.js";

type ErrorResponse = Readonly<{ code: string; message: string }>;

export type ReactionRouteOptions = Readonly<{
  resolveActor: ActorResolver;
  service: Pick<ReactionService, "summarize" | "react" | "remove">;
  csrfVerifier?: TimeTrialWebCsrfVerifier;
  rateLimiter?: MutationRateLimiter;
}>;

const resultIdPattern =
  "^user_submission\\.time\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$";

const summaryQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["resultIds"],
  properties: {
    resultIds: { type: "string", minLength: 1, maxLength: 3210 },
  },
} as const;

export const summaryResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "reactions"],
  properties: {
    schemaVersion: {
      type: "string",
      const: "mk8dx.public-time-trial-reactions.v1",
    },
    reactions: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["resultId", "counts"],
        properties: {
          resultId: { type: "string", pattern: resultIdPattern },
          counts: {
            type: "object",
            additionalProperties: false,
            properties: Object.fromEntries(REACTION_KINDS.map((kind) =>
              [kind, { type: "integer", minimum: 0 }])),
          },
          mine: { type: "string", enum: [...REACTION_KINDS] },
        },
      },
    },
  },
} as const;

const reactBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["resultId", "kind"],
  properties: {
    resultId: { type: "string", pattern: resultIdPattern },
    kind: { type: "string", enum: [...REACTION_KINDS] },
  },
} as const;

const removeBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["resultId"],
  properties: {
    resultId: { type: "string", pattern: resultIdPattern },
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
  if (error instanceof MutationRateLimitExceeded) {
    return {
      status: 429,
      body: {
        code: "reaction_rate_limited",
        message: "Too many reactions were received. Wait before retrying.",
      },
    };
  }
  if (error instanceof ReactionError) {
    switch (error.code) {
      case "invalid_input":
        return {
          status: 400,
          body: {
            code: "reaction_invalid",
            message: "The reaction request is not valid.",
          },
        };
      case "not_authenticated":
        return {
          status: 401,
          body: {
            code: "not_authenticated",
            message: "Sign in to react to Time Trials.",
          },
        };
      case "not_found":
        return {
          status: 404,
          body: {
            code: "reaction_target_not_found",
            message: "That Time Trial is not published.",
          },
        };
      case "own_result":
        return {
          status: 403,
          body: {
            code: "own_result",
            message: "You cannot react to your own Time Trial.",
          },
        };
      case "unavailable":
        break;
    }
  }
  return {
    status: 503,
    body: {
      code: "reactions_unavailable",
      message: "Reactions are temporarily unavailable.",
    },
  };
}

export async function registerReactionRoutes(
  app: FastifyInstance,
  options: ReactionRouteOptions,
): Promise<void> {
  app.get<{
    Querystring: Readonly<{ resultIds: string }>;
  }>(
    "/v1/public/time-trial-reactions",
    {
      schema: {
        querystring: summaryQuerySchema,
        response: { 200: summaryResponseSchema, 400: errorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        const reactions = await options.service.summarize(
          actor,
          request.query.resultIds.split(","),
        );
        return reply.send({
          schemaVersion: "mk8dx.public-time-trial-reactions.v1",
          reactions,
        });
      } catch (error) {
        const { status, body } = errorReply(error);
        return reply.code(status).send(body);
      }
    },
  );

  const verifiedActor = async (request: Parameters<ActorResolver>[0]):
    Promise<ReturnType<ActorResolver>> => {
    const actor = await options.resolveActor(request);
    const proof = request.headers["x-mk8dx-csrf"];
    if (options.csrfVerifier !== undefined &&
        (typeof proof !== "string" ||
         !await options.csrfVerifier.verify(actor, proof))) {
      throw new ReactionError("not_authenticated");
    }
    if (options.rateLimiter !== undefined &&
        (actor.role === "account" || actor.role === "administrator")) {
      await options.rateLimiter.consume(
        actor.userAccountId,
        "time-trial-reactions-hour",
        3_600,
        600,
      );
    }
    return actor;
  };

  app.put<{ Body: Readonly<{ resultId: string; kind: ReactionKind }> }>(
    "/v1/time-trial-reactions",
    {
      schema: {
        body: reactBodySchema,
        response: {
          200: acknowledgedSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          429: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await verifiedActor(request);
        await options.service.react(
          actor,
          request.body.resultId,
          request.body.kind,
        );
        return reply.send({ acknowledged: true });
      } catch (error) {
        if (error instanceof MutationRateLimitExceeded) {
          void reply.header("retry-after", String(error.retryAfterSeconds));
        }
        const { status, body } = errorReply(error);
        return reply.code(status).send(body);
      }
    },
  );

  app.delete<{ Body: Readonly<{ resultId: string }> }>(
    "/v1/time-trial-reactions",
    {
      schema: {
        body: removeBodySchema,
        response: {
          200: acknowledgedSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          429: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await verifiedActor(request);
        await options.service.remove(actor, request.body.resultId);
        return reply.send({ acknowledged: true });
      } catch (error) {
        if (error instanceof MutationRateLimitExceeded) {
          void reply.header("retry-after", String(error.retryAfterSeconds));
        }
        const { status, body } = errorReply(error);
        return reply.code(status).send(body);
      }
    },
  );
}
