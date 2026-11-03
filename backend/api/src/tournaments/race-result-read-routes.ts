import type { FastifyInstance } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorResolver } from "../identity/types.js";
import {
  TournamentRevisionReadError,
  type TournamentRevisionReadService,
} from "./race-result-read-service.js";
import {
  validateTournamentRaceResult,
  type TournamentRaceResultV1,
} from "./race-result-validation.js";

type ErrorResponse = Readonly<{ code: string; message: string }>;

export type TournamentRevisionReadRouteOptions = Readonly<{
  resolveActor: ActorResolver;
  service: Pick<TournamentRevisionReadService, "readRevision">;
}>;

const resultIdPattern =
  /^tournament_race_result\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const revisionPattern = /^[1-9][0-9]{0,15}$/;
const purposePattern = /^[a-z][a-z0-9._-]{1,63}$/;

const closedObject = (properties: Readonly<Record<string, unknown>>) => ({
  type: "object",
  additionalProperties: false,
  properties,
});

const referenceSchema = {
  ...closedObject({
    namespace: { type: "string" },
    value: { type: "string" },
  }),
  required: ["namespace", "value"],
} as const;

const tournamentRaceResultResponseSchema = {
  ...closedObject({
    schemaVersion: { type: "string", const: "mk8dx.tournament-race-result.v1" },
    raceResultId: { type: "string" },
    revision: { type: "integer" },
    raceNumber: { type: "integer" },
    scoringSegment: { type: "integer" },
    mode: { type: "integer", enum: [50, 100, 150, 200] },
    mirror: { type: "boolean", const: true },
    trackId: { type: "string" },
    countsTowardStandings: { type: "boolean" },
    scoringNote: { type: "string" },
    context: closedObject({
      tournamentReference: referenceSchema,
      stageReference: referenceSchema,
      groupReference: referenceSchema,
      observedStageLabel: { type: "string" },
      observedGroupLabel: { type: "string" },
    }),
    placements: {
      type: "array",
      items: {
        ...closedObject({
          finishPosition: { type: "integer" },
          participantReference: referenceSchema,
          observedPlayerName: { type: "string" },
          characterId: { type: "string" },
          characterVariantId: { type: "string" },
          scoring: {
            ...closedObject({
              racePoints: { type: "integer" },
              totalBeforeRace: { type: "integer" },
              totalAfterRace: { type: "integer" },
              rankAfterRace: { type: "integer" },
            }),
            required: [
              "racePoints", "totalBeforeRace", "totalAfterRace", "rankAfterRace",
            ],
          },
          confidence: closedObject({
            finishPosition: { type: "number" },
            playerName: { type: "number" },
            character: { type: "number" },
            racePoints: { type: "number" },
            totalAfterRace: { type: "number" },
          }),
        }),
        required: ["finishPosition", "participantReference", "scoring"],
      },
    },
    source: {
      ...closedObject({
        kind: { type: "string" },
        transport: { type: "string" },
        producerVersion: { type: "string" },
        localRecordId: { type: "string" },
        sessionId: { type: "string" },
        streamId: { type: "string" },
        sourceMediaId: { type: "string" },
        raceOffsetMs: { type: "integer" },
        frameIndex: { type: "integer" },
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
        confidence: { type: "number" },
        fieldConfidence: closedObject({
          track: { type: "number" },
          playerCount: { type: "number" },
          finishPositions: { type: "number" },
          playerNames: { type: "number" },
          characters: { type: "number" },
          racePoints: { type: "number" },
          totalScores: { type: "number" },
        }),
        issues: {
          type: "array",
          items: {
            ...closedObject({
              code: { type: "string" },
              message: { type: "string" },
            }),
            required: ["code", "message"],
          },
        },
      }),
      required: ["status"],
    },
  }),
  required: [
    "schemaVersion", "raceResultId", "revision", "raceNumber", "scoringSegment",
    "trackId", "countsTowardStandings", "placements", "source", "timestamps",
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
): Readonly<{ raceResultId: string; revision: number; purposeCode: string }> | null {
  if (!exactObject(params, ["raceResultId", "revision"]) ||
    !exactObject(query, ["purposeCode"])) {
    return null;
  }
  const { raceResultId, revision } = params;
  const { purposeCode } = query;
  if (typeof raceResultId !== "string" || !resultIdPattern.test(raceResultId) ||
    typeof revision !== "string" || !revisionPattern.test(revision) ||
    typeof purposeCode !== "string" || !purposePattern.test(purposeCode)) {
    return null;
  }
  const parsedRevision = Number(revision);
  return Number.isSafeInteger(parsedRevision)
    ? { raceResultId, revision: parsedRevision, purposeCode }
    : null;
}

function project(input: TournamentRaceResultV1): TournamentRaceResultV1 {
  validateTournamentRaceResult(input);
  return {
    schemaVersion: input.schemaVersion,
    raceResultId: input.raceResultId,
    revision: input.revision,
    raceNumber: input.raceNumber,
    scoringSegment: input.scoringSegment,
    ...(input.mode === undefined ? {} : { mode: input.mode }),
    ...(input.mirror === undefined ? {} : { mirror: input.mirror }),
    trackId: input.trackId,
    countsTowardStandings: input.countsTowardStandings,
    ...(input.scoringNote === undefined ? {} : { scoringNote: input.scoringNote }),
    ...(input.context === undefined
      ? {}
      : {
          context: {
            ...(input.context.tournamentReference === undefined
              ? {}
              : { tournamentReference: { ...input.context.tournamentReference } }),
            ...(input.context.stageReference === undefined
              ? {}
              : { stageReference: { ...input.context.stageReference } }),
            ...(input.context.groupReference === undefined
              ? {}
              : { groupReference: { ...input.context.groupReference } }),
            ...(input.context.observedStageLabel === undefined
              ? {}
              : { observedStageLabel: input.context.observedStageLabel }),
            ...(input.context.observedGroupLabel === undefined
              ? {}
              : { observedGroupLabel: input.context.observedGroupLabel }),
          },
        }),
    placements: input.placements.map((placement) => ({
      finishPosition: placement.finishPosition,
      participantReference: { ...placement.participantReference },
      ...(placement.observedPlayerName === undefined
        ? {}
        : { observedPlayerName: placement.observedPlayerName }),
      ...(placement.characterId === undefined ? {} : { characterId: placement.characterId }),
      ...(placement.characterVariantId === undefined
        ? {}
        : { characterVariantId: placement.characterVariantId }),
      scoring: { ...placement.scoring },
      ...(placement.confidence === undefined
        ? {}
        : { confidence: { ...placement.confidence } }),
    })),
    source: { ...input.source },
    timestamps: { ...input.timestamps },
    ...(input.evidence === undefined
      ? {}
      : { evidence: input.evidence.map((item) => ({ ...item })) }),
    ...(input.verification === undefined
      ? {}
      : {
          verification: {
            status: input.verification.status,
            ...(input.verification.method === undefined
              ? {}
              : { method: input.verification.method }),
            ...(input.verification.confidence === undefined
              ? {}
              : { confidence: input.verification.confidence }),
            ...(input.verification.fieldConfidence === undefined
              ? {}
              : { fieldConfidence: { ...input.verification.fieldConfidence } }),
            ...(input.verification.issues === undefined
              ? {}
              : { issues: input.verification.issues.map((item) => ({ ...item })) }),
          },
        }),
  };
}

function invalidRequest() {
  return {
    code: "invalid_tournament_revision_read",
    message: "The Tournament revision read request is invalid.",
  } as const;
}

function failure(error: unknown): Readonly<{
  statusCode: 400 | 404 | 500;
  response: ErrorResponse;
}> {
  if (error instanceof TournamentRevisionReadError) {
    if (error.code === "invalid_request") {
      return { statusCode: 400, response: invalidRequest() };
    }
    if (error.code === "forbidden" || error.code === "not_found") {
      return {
        statusCode: 404,
        response: {
          code: "tournament_revision_not_found",
          message: "The Tournament revision was not found.",
        },
      };
    }
  }
  return {
    statusCode: 500,
    response: {
      code: "tournament_revision_read_failed",
      message: "The Tournament revision could not be read.",
    },
  };
}

export async function registerTournamentRevisionReadRoutes(
  app: FastifyInstance,
  options: TournamentRevisionReadRouteOptions,
): Promise<void> {
  app.get<{
    Params: unknown;
    Querystring: unknown;
    Reply: TournamentRaceResultV1 | ErrorResponse;
  }>(
    "/v1/tournament-race-results/:raceResultId/revisions/:revision",
    {
      schema: {
        response: {
          200: tournamentRaceResultResponseSchema,
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
          parsed.raceResultId,
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
