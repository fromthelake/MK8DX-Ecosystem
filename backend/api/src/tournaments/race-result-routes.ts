import type { FastifyInstance } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorContext, ActorResolver } from "../identity/types.js";
import { consumeTournamentMutationBudget } from "../security/tournament-mutation-budget.js";
import {
  MutationRateLimitExceeded,
  type MutationRateLimiter,
} from "../security/mysql-mutation-rate-limiter.js";
import {
  TournamentResultServiceError,
  type TournamentRaceResultService,
} from "./race-result-service.js";
import {
  TournamentValidationError,
  validateTournamentRaceResult,
  type TournamentRaceResultV1,
} from "./race-result-validation.js";

type ErrorResponse = Readonly<{ code: string; message: string }>;
type TournamentSubmissionResult = Readonly<{ raceResultId: string; revision: number }>;

export type TournamentSubmissionAuthorizationContext = Readonly<{
  actor: ActorContext;
  producerKind: TournamentRaceResultV1["source"]["kind"];
  revision: number;
  placementCount: number;
}>;

export interface TournamentSubmissionAuthorizer {
  authorize(context: TournamentSubmissionAuthorizationContext): Promise<boolean>;
}

export interface TournamentWebCsrfVerifier {
  verify(actor: ActorContext, proof: string): boolean | Promise<boolean>;
}

export type TournamentSubmissionRouteOptions = Readonly<{
  resolveActor: ActorResolver;
  authorizer: TournamentSubmissionAuthorizer;
  // When configured, the route is a browser-facing administrator boundary:
  // an authenticated actor must present the same-origin CSRF proof header.
  csrfVerifier?: TournamentWebCsrfVerifier;
  service: Pick<TournamentRaceResultService, "submit">;
  rateLimiter: MutationRateLimiter;
}>;

const resultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["raceResultId", "revision"],
  properties: {
    raceResultId: {
      type: "string",
      pattern: "^tournament_race_result\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$",
    },
    revision: { type: "integer", minimum: 1 },
  },
} as const;

const errorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  500: errorResponseSchema,
} as const;

function failure(error: unknown): Readonly<{
  statusCode: 400 | 404 | 409 | 500;
  response: ErrorResponse;
}> {
  if (error instanceof TournamentValidationError ||
    (error instanceof TournamentResultServiceError && error.code === "invalid_assets")) {
    return {
      statusCode: 400,
      response: {
        code: "invalid_tournament_race_result",
        message: "The Tournament race result is invalid.",
      },
    };
  }
  if (error instanceof TournamentResultServiceError) {
    if (error.code === "player_not_found") {
      return {
        statusCode: 404,
        response: {
          code: "tournament_player_not_found",
          message: "One or more referenced active Players were not found.",
        },
      };
    }
    if (error.code === "revision_conflict") {
      return {
        statusCode: 409,
        response: {
          code: "tournament_revision_conflict",
          message: "The Tournament race-result revision conflicts with current state.",
        },
      };
    }
  }
  return {
    statusCode: 500,
    response: {
      code: "tournament_submission_failed",
      message: "The Tournament race result could not be submitted.",
    },
  };
}

export async function registerTournamentSubmissionRoutes(
  app: FastifyInstance,
  options: TournamentSubmissionRouteOptions,
): Promise<void> {
  app.post<{
    Body: unknown;
    Reply: TournamentSubmissionResult | ErrorResponse;
  }>(
    "/v1/tournament-race-results",
    {
      bodyLimit: 131_072,
      schema: {
        body: { type: "object" },
        response: {
          201: resultSchema,
          429: errorResponseSchema,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        validateTournamentRaceResult(request.body);
        const actor = await options.resolveActor(request);
        if (options.csrfVerifier !== undefined) {
          if (actor.role === "anonymous") {
            return reply.code(401).send({
              code: "tournament_authentication_required",
              message: "Authentication is required.",
            });
          }
          const proof = request.headers["x-mk8dx-csrf"];
          if (typeof proof !== "string" ||
            !await options.csrfVerifier.verify(actor, proof)) {
            return reply.code(403).send({
              code: "tournament_csrf_forbidden",
              message: "The CSRF proof is invalid.",
            });
          }
        }
        const authorized = await options.authorizer.authorize({
          actor,
          producerKind: request.body.source.kind,
          revision: request.body.revision,
          placementCount: request.body.placements.length,
        });
        if (!authorized) {
          return reply.code(403).send({
            code: "tournament_submission_forbidden",
            message: "The Tournament race-result submission is not authorized.",
          });
        }
        await consumeTournamentMutationBudget(actor, options.rateLimiter, "race-result");
        const result = await options.service.submit(request.body);
        return reply.code(201).send(result);
      } catch (error) {
        if (error instanceof MutationRateLimitExceeded) {
          void reply.header("retry-after", String(error.retryAfterSeconds));
          return reply.code(429).send({
            code: "tournament_submission_rate_limited",
            message: "Too many Tournament race results were received. Wait before retrying.",
          });
        }
        const mapped = failure(error);
        return reply.code(mapped.statusCode).send(mapped.response);
      }
    },
  );
}
