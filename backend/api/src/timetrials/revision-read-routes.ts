import type { FastifyInstance } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorResolver } from "../identity/types.js";
import {
  TimeTrialRevisionReadError,
  type TimeTrialRevisionReadService,
} from "./revision-read-service.js";
import {
  validateTimeTrialSubmission,
  type TimeTrialSubmissionV1,
} from "./submission-service.js";

type ErrorResponse = Readonly<{ code: string; message: string }>;

export type TimeTrialRevisionReadRouteOptions = Readonly<{
  resolveActor: ActorResolver;
  service: Pick<TimeTrialRevisionReadService, "readRevision">;
}>;

const submissionIdPattern =
  /^user_submission\.time\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const revisionPattern = /^[1-9][0-9]{0,15}$/;
const purposePattern = /^[a-z][a-z0-9._-]{1,63}$/;

const closedObject = (properties: Readonly<Record<string, unknown>>) => ({
  type: "object",
  additionalProperties: false,
  properties,
});

const timeTrialSubmissionResponseSchema = {
  ...closedObject({
    schemaVersion: { type: "string", const: "mk8dx.time-trial-submission.v1" },
    submissionId: { type: "string" },
    revision: { type: "integer" },
    mode: { type: "integer" },
    trackId: { type: "string" },
    totalTimeMs: { type: "integer" },
    laps: {
      type: "array",
      items: {
        ...closedObject({
          lapNumber: { type: "integer" },
          timeMs: { type: "integer" },
          coinsCollected: { type: "integer" },
          mushroomsUsed: { type: "integer" },
          confidence: { type: "number" },
        }),
        required: ["lapNumber", "timeMs"],
      },
    },
    loadout: closedObject({
      characterId: { type: "string" },
      characterVariantId: { type: "string" },
      bodyId: { type: "string" },
      bodyVariantId: { type: "string" },
      tireId: { type: "string" },
      gliderId: { type: "string" },
      gliderVariantId: { type: "string" },
    }),
    countryId: { type: "string" },
    playerReference: {
      ...closedObject({
        namespace: { type: "string" },
        value: { type: "string" },
      }),
      required: ["namespace", "value"],
    },
    observedPlayerName: { type: "string" },
    source: {
      ...closedObject({
        kind: { type: "string" },
        producerVersion: { type: "string" },
        localRecordId: { type: "string" },
      }),
      required: ["kind"],
    },
    timestamps: {
      ...closedObject({
        occurredAtMs: { type: "integer" },
        capturedAtMs: { type: "integer" },
        createdAtMs: { type: "integer" },
        submittedAtMs: { type: "integer" },
      }),
      required: ["createdAtMs"],
    },
    evidence: {
      type: "array",
      items: {
        ...closedObject({
          kind: { type: "string" },
          reference: { type: "string" },
          sha256: { type: "string" },
          mediaType: { type: "string" },
        }),
        required: ["kind", "reference"],
      },
    },
    verification: {
      ...closedObject({
        status: { type: "string" },
        method: { type: "string" },
        lapSumMatches: { type: "boolean" },
        confidence: { type: "number" },
        fieldConfidence: closedObject({
          totalTime: { type: "number" },
          track: { type: "number" },
          character: { type: "number" },
          characterVariant: { type: "number" },
          body: { type: "number" },
          tire: { type: "number" },
          glider: { type: "number" },
          country: { type: "number" },
          playerName: { type: "number" },
        }),
      }),
      required: ["status"],
    },
  }),
  required: [
    "schemaVersion", "submissionId", "revision", "mode", "trackId",
    "totalTimeMs", "laps", "playerReference", "source", "timestamps",
  ],
} as const;

function exactObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

function target(
  params: unknown,
  query: unknown,
): Readonly<{ submissionId: string; revision: number; purposeCode: string }> | null {
  if (!exactObject(params, ["submissionId", "revision"]) ||
    !exactObject(query, ["purposeCode"])) {
    return null;
  }
  const { submissionId, revision } = params;
  const { purposeCode } = query;
  if (typeof submissionId !== "string" || !submissionIdPattern.test(submissionId) ||
    typeof revision !== "string" || !revisionPattern.test(revision) ||
    typeof purposeCode !== "string" || !purposePattern.test(purposeCode)) {
    return null;
  }
  const parsedRevision = Number(revision);
  return Number.isSafeInteger(parsedRevision)
    ? { submissionId, revision: parsedRevision, purposeCode }
    : null;
}

function project(input: TimeTrialSubmissionV1): TimeTrialSubmissionV1 {
  validateTimeTrialSubmission(input);
  return {
    schemaVersion: input.schemaVersion,
    submissionId: input.submissionId,
    revision: input.revision,
    mode: input.mode,
    trackId: input.trackId,
    totalTimeMs: input.totalTimeMs,
    laps: input.laps.map((lap) => ({
      lapNumber: lap.lapNumber,
      timeMs: lap.timeMs,
      ...(lap.coinsCollected === undefined ? {} : { coinsCollected: lap.coinsCollected }),
      ...(lap.mushroomsUsed === undefined ? {} : { mushroomsUsed: lap.mushroomsUsed }),
      ...(lap.confidence === undefined ? {} : { confidence: lap.confidence }),
    })),
    ...(input.loadout === undefined ? {} : { loadout: { ...input.loadout } }),
    ...(input.countryId === undefined ? {} : { countryId: input.countryId }),
    playerReference: { ...input.playerReference },
    ...(input.observedPlayerName === undefined
      ? {}
      : { observedPlayerName: input.observedPlayerName }),
    source: { ...input.source },
    timestamps: { ...input.timestamps },
    ...(input.evidence === undefined
      ? {}
      : { evidence: input.evidence.map((item) => ({ ...item })) }),
    ...(input.verification === undefined
      ? {}
      : {
          verification: {
            ...input.verification,
            ...(input.verification.fieldConfidence === undefined
              ? {}
              : { fieldConfidence: { ...input.verification.fieldConfidence } }),
          },
        }),
  };
}

function invalidRequest() {
  return {
    code: "invalid_time_trial_revision_read",
    message: "The Time Trial revision read request is invalid.",
  } as const;
}

function failure(error: unknown): Readonly<{
  statusCode: 400 | 404 | 500;
  response: ErrorResponse;
}> {
  if (error instanceof TimeTrialRevisionReadError) {
    if (error.code === "invalid_request") {
      return { statusCode: 400, response: invalidRequest() };
    }
    if (error.code === "forbidden" || error.code === "not_found") {
      return {
        statusCode: 404,
        response: {
          code: "time_trial_revision_not_found",
          message: "The Time Trial revision was not found.",
        },
      };
    }
  }
  return {
    statusCode: 500,
    response: {
      code: "time_trial_revision_read_failed",
      message: "The Time Trial revision could not be read.",
    },
  };
}

export async function registerTimeTrialRevisionReadRoutes(
  app: FastifyInstance,
  options: TimeTrialRevisionReadRouteOptions,
): Promise<void> {
  app.get<{
    Params: unknown;
    Querystring: unknown;
    Reply: TimeTrialSubmissionV1 | ErrorResponse;
  }>(
    "/v1/time-trial-submissions/:submissionId/revisions/:revision",
    {
      schema: {
        response: {
          200: timeTrialSubmissionResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = target(request.params, request.query);
      if (parsed === null) {
        return reply.code(400).send(invalidRequest());
      }
      try {
        const actor = await options.resolveActor(request);
        const result = await options.service.readRevision(
          actor,
          parsed.submissionId,
          parsed.revision,
          parsed.purposeCode,
        );
        return reply.send(project(result));
      } catch (error) {
        const mapped = failure(error);
        return reply.code(mapped.statusCode).send(mapped.response);
      }
    },
  );
}
