import type { FastifyInstance } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorContext, ActorResolver } from "../identity/types.js";
import {
  TimeTrialSubmissionError,
  validateTimeTrialSubmission,
  type TimeTrialSubmissionResult,
  type TimeTrialSubmissionService,
  type TimeTrialSubmissionV1,
} from "./submission-service.js";
import type {
  EphemeralAndroidScanTestService,
  EphemeralScanTestSummary,
} from "./ephemeral-scan-test-service.js";
import { MutationRateLimitExceeded, type MutationRateLimiter } from
  "../security/mysql-mutation-rate-limiter.js";
import {
  SUBMISSION_FEEDBACK_LAP_LIMIT,
  SUBMISSION_FEEDBACK_PASSED_LIMIT,
  SUBMISSION_FEEDBACK_VERSION,
  SUBMISSION_FEEDBACK_VERSION_V2,
  SUBMISSION_FEEDBACK_VERSIONS,
  type SubmissionFeedback,
  type SubmissionFeedbackService,
} from "./submission-feedback.js";

import { IMPLAUSIBLE_TIME_CODE, IMPLAUSIBLE_TIME_MESSAGE } from "./world-record-plausibility.js";

type ErrorResponse = Readonly<{ code: string; message: string }>;

export type TimeTrialSubmissionAuthorizationContext = Readonly<{
  actor: ActorContext;
  sourceKind: TimeTrialSubmissionV1["source"]["kind"];
  playerReferenceNamespace: TimeTrialSubmissionV1["playerReference"]["namespace"];
  centralPlayerId: string | null;
  revision: number;
}>;

export interface TimeTrialSubmissionAuthorizer {
  authorize(context: TimeTrialSubmissionAuthorizationContext): Promise<boolean>;
}

export interface TimeTrialWebCsrfVerifier {
  verify(actor: ActorContext, proof: string): boolean | Promise<boolean>;
}

export type TimeTrialSubmissionRouteOptions = Readonly<{
  resolveActor: ActorResolver;
  authorizer: TimeTrialSubmissionAuthorizer;
  csrfVerifier?: TimeTrialWebCsrfVerifier;
  service: Pick<TimeTrialSubmissionService, "submit">;
  testService?: Pick<EphemeralAndroidScanTestService, "submit" | "listForAccount">;
  rateLimiter?: MutationRateLimiter;
  /** Answers `?feedback=v1`; a failure here never fails the submission. */
  feedback?: Pick<SubmissionFeedbackService, "forSubmission">;
}>;

const passedPlayerSchema = {
  type: "object",
  additionalProperties: false,
  required: ["playerId", "username", "displayName", "bestMs", "rival"],
  properties: {
    playerId: { type: "string", minLength: 8, maxLength: 135 },
    username: { type: "string", minLength: 1, maxLength: 64 },
    displayName: { type: "string", minLength: 1, maxLength: 128 },
    bestMs: { type: "integer", minimum: 0 },
    rival: { type: "boolean" },
  },
} as const;

// Present only when the client asked with `?feedback=v1`; see
// submission-feedback.ts for why it is opt-in.
const submissionFeedbackSchema = {
  type: "object",
  additionalProperties: false,
  required: ["trackId", "modeCc", "totalTimeMs", "personalBest", "rank"],
  properties: {
    trackId: { type: "string", minLength: 1, maxLength: 128 },
    modeCc: { type: "integer", enum: [150, 200] },
    totalTimeMs: { type: "integer", minimum: 0 },
    personalBest: {
      type: "object",
      additionalProperties: false,
      required: ["previousBestMs", "deltaMs", "improved"],
      properties: {
        previousBestMs: { type: ["integer", "null"], minimum: 0 },
        deltaMs: { type: ["integer", "null"] },
        improved: { type: "boolean" },
        previousLaps: {
          type: "array",
          maxItems: SUBMISSION_FEEDBACK_LAP_LIMIT,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["lapNumber", "timeMs"],
            properties: {
              lapNumber: { type: "integer", minimum: 1 },
              timeMs: { type: "integer", minimum: 0 },
            },
          },
        },
      },
    },
    rank: {
      type: "object",
      additionalProperties: false,
      required: ["after", "before", "passed", "passedCount", "rivalsPassed"],
      properties: {
        after: { type: "integer", minimum: 1 },
        before: { type: ["integer", "null"], minimum: 1 },
        passed: {
          type: "array",
          maxItems: SUBMISSION_FEEDBACK_PASSED_LIMIT,
          items: passedPlayerSchema,
        },
        passedCount: { type: "integer", minimum: 0 },
        rivalsPassed: { type: "integer", minimum: 0 },
      },
    },
  },
} as const;

const submissionResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["submissionId", "revision"],
  properties: {
    submissionId: {
      type: "string",
      pattern: "^user_submission\\.time\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$",
    },
    revision: { type: "integer", minimum: 1 },
    feedback: submissionFeedbackSchema,
  },
} as const;

const submissionQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    feedback: { type: "string", enum: [...SUBMISSION_FEEDBACK_VERSIONS] },
  },
} as const;

const requestObjectSchema = { type: "object" } as const;

const scanTestListSchema = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "submissionId", "revision", "playerId", "mode", "trackId",
          "totalTimeMs", "createdAtMs", "expiresAtMs",
        ],
        properties: {
          submissionId: { type: "string" },
          revision: { type: "integer", minimum: 1 },
          playerId: { type: "string" },
          mode: { type: "integer", enum: [150, 200] },
          trackId: { type: "string" },
          totalTimeMs: { type: "integer", minimum: 1 },
          createdAtMs: { type: "integer", minimum: 0 },
          expiresAtMs: { type: "integer", minimum: 0 },
        },
      },
    },
  },
} as const;

const errorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  429: errorResponseSchema,
  500: errorResponseSchema,
} as const;

function failure(error: unknown): Readonly<{
  statusCode: 400 | 403 | 404 | 409 | 500;
  response: ErrorResponse;
}> {
  if (!(error instanceof TimeTrialSubmissionError)) {
    return {
      statusCode: 500,
      response: {
        code: "time_trial_submission_failed",
        message: "The Time Trial submission could not be completed.",
      },
    };
  }
  if (error.code === "invalid_submission" || error.code === "invalid_assets") {
    return {
      statusCode: 400,
      response: {
        code: "invalid_time_trial_submission",
        message: "The Time Trial submission is invalid.",
      },
    };
  }
  if (error.code === "implausible_time") {
    // Said in the owner's words; a client shows this message as it is (not retryable as sent).
    return {
      statusCode: 400,
      response: { code: IMPLAUSIBLE_TIME_CODE, message: IMPLAUSIBLE_TIME_MESSAGE },
    };
  }
  if (error.code === "player_not_found") {
    return {
      statusCode: 404,
      response: {
        code: "time_trial_player_not_found",
        message: "The referenced active Player was not found.",
      },
    };
  }
  if (error.code === "revision_conflict") {
    return {
      statusCode: 409,
      response: {
        code: "time_trial_revision_conflict",
        message: "The Time Trial submission revision conflicts with current state.",
      },
    };
  }
  return {
    statusCode: 500,
    response: {
      code: "time_trial_submission_failed",
      message: "The Time Trial submission could not be completed.",
    },
  };
}

export async function registerTimeTrialSubmissionRoutes(
  app: FastifyInstance,
  options: TimeTrialSubmissionRouteOptions,
): Promise<void> {
  app.post<{
    Body: unknown;
    Querystring: { feedback?: string };
    Reply:
      | TimeTrialSubmissionResult
      | (TimeTrialSubmissionResult & { feedback: SubmissionFeedback })
      | ErrorResponse;
  }>(
    "/v1/time-trial-submissions",
    {
      bodyLimit: 65_536,
      schema: {
        body: requestObjectSchema,
        querystring: submissionQuerySchema,
        response: {
          201: submissionResultSchema,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        validateTimeTrialSubmission(request.body);
        const actor = await options.resolveActor(request);
        // No source kind may be submitted anonymously, so a missing or expired
        // session is an authentication failure whatever the client is. Saying
        // 403 here told a native client "this account may genuinely not do
        // this", which is not retryable; the Android outbox then parked a saved
        // result permanently instead of re-driving it after the Player signed
        // in again. 403 stays reserved for an actor who is authenticated and
        // still not allowed.
        if (actor.role === "anonymous") {
          return reply.code(401).send({
            code: "time_trial_authentication_required",
            message: "Authentication is required.",
          });
        }
        // Both web kinds travel on a browser session, so both need the CSRF proof (ADR-0204).
        if (request.body.source.kind === "web_manual" || request.body.source.kind === "web_scan") {
          const proof = request.headers["x-mk8dx-csrf"];
          if (typeof proof !== "string" ||
            options.csrfVerifier === undefined ||
            !await options.csrfVerifier.verify(actor, proof)) {
            return reply.code(403).send({
              code: "time_trial_csrf_forbidden",
              message: "The CSRF proof is invalid.",
            });
          }
        }
        const authorized = await options.authorizer.authorize({
          actor,
          sourceKind: request.body.source.kind,
          playerReferenceNamespace: request.body.playerReference.namespace,
          centralPlayerId: request.body.playerReference.namespace === "player"
            ? request.body.playerReference.value
            : null,
          revision: request.body.revision,
        });
        if (!authorized) {
          return reply.code(403).send({
            code: "time_trial_submission_forbidden",
            message: "The Time Trial submission is not authorized.",
          });
        }
        if (options.rateLimiter !== undefined &&
            (actor.role === "account" || actor.role === "administrator")) {
          // Per-IP proxy limits do not protect against a distributed burst.
          // These shared budgets cap durable writes while retaining enough
          // room for a launch spike and normal scanner retries.
          await options.rateLimiter.consume(
            "global", "time-trial-submit-global-10s", 10, 50);
          await options.rateLimiter.consume(
            "global", "time-trial-submit-global-minute", 60, 300);
          await options.rateLimiter.consume(actor.userAccountId, "time-trial-submit-10m", 600, 240);
          await options.rateLimiter.consume(actor.userAccountId, "time-trial-submit-day", 86_400, 1_000);
        }
        let result: TimeTrialSubmissionResult;
        if (request.body.source.kind === "android_scan_test") {
          if ((actor.role !== "account" && actor.role !== "administrator") ||
            options.testService === undefined) {
            throw new TimeTrialSubmissionError(
              "invalid_submission",
              "an ephemeral scan test requires an account-enabled test service",
            );
          }
          result = await options.testService.submit(request.body, actor.userAccountId);
        } else {
          result = await options.service.submit(request.body, {
            publicationIntent: "trusted_runtime",
          });
          const requestedVersion = request.query.feedback;
          if ((requestedVersion === SUBMISSION_FEEDBACK_VERSION ||
               requestedVersion === SUBMISSION_FEEDBACK_VERSION_V2) &&
              options.feedback !== undefined) {
            const feedback = await options.feedback.forSubmission(
              result.submissionId,
              actor.role === "account" || actor.role === "administrator"
                ? actor.userAccountId
                : null,
              requestedVersion,
            ).catch((error: unknown) => {
              request.log.warn({ err: error }, "submission feedback unavailable");
              return null;
            });
            if (feedback !== null) {
              return reply.code(201).send({ ...result, feedback });
            }
          }
        }
        return reply.code(201).send(result);
      } catch (error) {
        if (error instanceof MutationRateLimitExceeded) {
          void reply.header("retry-after", String(error.retryAfterSeconds));
          return reply.code(429).send({
            code: "time_trial_submission_rate_limited",
            message: "Too many submissions were received. Wait before retrying.",
          });
        }
        const mapped = failure(error);
        return reply.code(mapped.statusCode).send(mapped.response);
      }
    },
  );

  if (options.testService !== undefined) {
    app.get<{
      Reply: { results: readonly EphemeralScanTestSummary[] } | ErrorResponse;
    }>(
      "/v1/time-trial-scan-tests",
      {
        schema: {
          response: { 200: scanTestListSchema, 401: errorResponseSchema, 500: errorResponseSchema },
        },
      },
      async (request, reply) => {
        try {
          const actor = await options.resolveActor(request);
          if (actor.role !== "account" && actor.role !== "administrator") {
            return reply.code(401).send({
              code: "time_trial_authentication_required",
              message: "Authentication is required.",
            });
          }
          return reply.code(200).send({
            results: await options.testService!.listForAccount(actor.userAccountId),
          });
        } catch {
          return reply.code(500).send({
            code: "time_trial_scan_tests_failed",
            message: "The test results could not be loaded.",
          });
        }
      },
    );
  }
}
