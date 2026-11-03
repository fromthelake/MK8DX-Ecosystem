import type { FastifyInstance } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorResolver } from "../identity/types.js";
import { MutationRateLimitExceeded, type MutationRateLimiter } from
  "../security/mysql-mutation-rate-limiter.js";
import {
  TimeTrialCompletionError,
  type TimeTrialCompletionService,
} from "./completion-service.js";

// POST /v1/time-trial-submissions/:submissionId/completions (ADR-0210 rule 10).
//
// Only a native producer that read the run from a screen completes a result, so the route is
// native-only: it requires the bearer credential those clients send. A browser cannot attach an
// Authorization header to a cross-site request, which is what the CSRF proof protects the web
// routes against (ADR-0204), so no proof is needed here and a cookie session alone is refused.

export type TimeTrialCompletionRouteOptions = Readonly<{
  resolveActor: ActorResolver;
  service: Pick<TimeTrialCompletionService, "complete">;
  rateLimiter?: MutationRateLimiter;
}>;

const resultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "submissionId", "revision", "completedFields"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.time-trial-completion-result.v1" },
    submissionId: { type: "string", minLength: 26, maxLength: 149 },
    revision: { type: "integer", minimum: 2 },
    completedFields: {
      type: "array", minItems: 1, maxItems: 10, uniqueItems: true,
      items: {
        type: "string",
        enum: ["laps", "coinsCollected", "mushroomsUsed", "character", "characterVariant", "body",
          "bodyVariant", "tire", "glider", "gliderVariant"],
      },
    },
  },
} as const;

function errorReply(error: unknown): Readonly<{ status: number; body: Readonly<{ code: string; message: string }> }> {
  if (error instanceof MutationRateLimitExceeded) {
    return { status: 429, body: { code: "time_trial_completion_rate_limited", message: "Try again later." } };
  }
  if (error instanceof TimeTrialCompletionError) {
    switch (error.code) {
      case "invalid_completion":
      case "invalid_assets":
        return { status: 400, body: { code: `time_trial_completion_${error.code}`, message: error.message } };
      case "not_authenticated":
        return { status: 401, body: { code: "time_trial_authentication_required", message: "Authentication is required." } };
      case "not_found":
        return { status: 404, body: { code: "time_trial_not_found", message: "That Time Trial was not found." } };
      case "revision_conflict":
      case "different_result":
      case "nothing_missing":
        return { status: 409, body: { code: `time_trial_completion_${error.code}`, message: error.message } };
      case "protection_failed":
        break;
    }
  }
  return {
    status: 503,
    body: { code: "time_trial_completion_unavailable", message: "The Time Trial could not be completed right now." },
  };
}

export async function registerTimeTrialCompletionRoutes(
  app: FastifyInstance,
  options: TimeTrialCompletionRouteOptions,
): Promise<void> {
  app.post<{ Params: Readonly<{ submissionId: string }>; Body: unknown }>(
    "/v1/time-trial-submissions/:submissionId/completions",
    {
      bodyLimit: 16_384,
      schema: {
        params: {
          type: "object", additionalProperties: false, required: ["submissionId"],
          properties: {
            submissionId: {
              type: "string", minLength: 26, maxLength: 149,
              pattern: "^user_submission\\.time\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$",
            },
          },
        },
        body: { type: "object" },
        response: {
          200: resultSchema,
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
        if (actor.role !== "account" && actor.role !== "administrator") {
          return reply.code(401).send({
            code: "time_trial_authentication_required", message: "Authentication is required.",
          });
        }
        const authorization = request.headers.authorization;
        if (typeof authorization !== "string" || !/^Bearer [A-Za-z0-9_-]{20,255}$/.test(authorization)) {
          return reply.code(403).send({
            code: "time_trial_completion_native_only",
            message: "Only a signed-in native client completes a result.",
          });
        }
        if (options.rateLimiter !== undefined) {
          await options.rateLimiter.consume(actor.userAccountId, "time-trial-complete-10m", 600, 120);
          await options.rateLimiter.consume(actor.userAccountId, "time-trial-complete-day", 86_400, 500);
        }
        const result = await options.service.complete(actor, request.params.submissionId, request.body);
        return reply.code(200).send({
          schemaVersion: "mk8dx.time-trial-completion-result.v1" as const,
          ...result,
        });
      } catch (error) {
        const { status, body } = errorReply(error);
        if (status === 503) { request.log.error({ err: error }, "time trial completion failed"); }
        return reply.code(status as 503).send(body);
      }
    },
  );
}
