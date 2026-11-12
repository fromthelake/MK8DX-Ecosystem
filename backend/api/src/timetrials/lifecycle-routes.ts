import type { FastifyInstance } from "fastify";

import { errorResponseSchema, playerIdParamsSchema } from
  "../identity/schemas.js";
import type { ActorContext, ActorResolver } from "../identity/types.js";
import {
  TimeTrialLifecycleError,
  retirementReasons,
  type ManagedTimeTrial,
  type ManagedTimeTrialQuery,
  type TimeTrialLifecycleService,
} from "./lifecycle-service.js";
import type { TimeTrialWebCsrfVerifier } from "./submission-routes.js";

type ErrorResponse = Readonly<{ code: string; message: string }>;

export type TimeTrialLifecycleRouteOptions = Readonly<{
  resolveActor: ActorResolver;
  service: Pick<
    TimeTrialLifecycleService,
    "readOwnedOrAdministered" | "listOwn" | "listForAdministrator" | "correct"
    | "retire" | "restore" | "setVideo"
  >;
  csrfVerifier?: TimeTrialWebCsrfVerifier;
}>;

const submissionIdSchema = {
  type: "string",
  minLength: 26,
  maxLength: 149,
  pattern: "^user_submission\\.time\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$",
} as const;

const lapCountsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    coinsCollected: { type: "integer", minimum: 0, maximum: 10 },
    mushroomsUsed: { type: "integer", minimum: 0, maximum: 3 },
  },
} as const;

const correctionLoadoutSchema = {
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(["characterId", "bodyId", "tireId", "gliderId"]
    .map((key) => [key, { type: "string", minLength: 1, maxLength: 255 }])),
} as const;

const revisionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["revision", "modeCc", "trackId", "totalTimeMs", "laps",
    "sourceKind", "createdAtMs"],
  properties: {
    revision: { type: "integer", minimum: 1 },
    modeCc: { type: "integer", enum: [150, 200] },
    trackId: { type: "string", minLength: 1, maxLength: 255 },
    totalTimeMs: { type: "integer", minimum: 1 },
    laps: { type: "array", maxItems: 7, items: { type: "integer", minimum: 1 } },
    lapDetails: { type: "array", maxItems: 7, items: lapCountsSchema },
    loadout: {
      type: "object", additionalProperties: false,
      properties: Object.fromEntries(["characterId", "characterVariantId", "bodyId", "bodyVariantId",
        "tireId", "gliderId", "gliderVariantId"].map((key) => [key, { type: "string", minLength: 1, maxLength: 255 }])),
    },
    sourceKind: { type: "string", minLength: 1, maxLength: 64 },
    createdAtMs: { type: "integer", minimum: 0 },
  },
} as const;

const youTubeWatchUrlSchema = {
  type: "string", pattern: "^https://www\\.youtube\\.com/watch\\?v=[A-Za-z0-9_-]{11}$",
} as const;

const eventSchema = {
  type: "object",
  additionalProperties: false,
  required: ["sequenceNumber", "eventType", "retirementStateAfter", "revision",
    "actorRole", "reasonCode", "occurredAtMs"],
  properties: {
    sequenceNumber: { type: "integer", minimum: 1 },
    eventType: { type: "string", enum: ["corrected", "retired", "restored"] },
    retirementStateAfter: { type: "string", enum: ["active", "retired"] },
    revision: { type: "integer", minimum: 1 },
    actorRole: { type: "string", enum: ["owner", "administrator"] },
    reasonCode: { type: "string", minLength: 1, maxLength: 64 },
    note: { type: "string", maxLength: 256 },
    occurredAtMs: { type: "integer", minimum: 0 },
  },
} as const;

// Where a carried run comes from (ADR-0225), as the submission stated it.
export const carriedFromSchema = {
  type: "object",
  additionalProperties: false,
  required: ["origin", "originalSubmittedAtMs"],
  properties: {
    origin: { type: "string", minLength: 9, maxLength: 255, pattern: "^https://[^/?#\\s]+$" },
    communityName: { type: "string", minLength: 1, maxLength: 80 },
    originalSubmissionId: { type: "string", minLength: 1, maxLength: 128 },
    originalSubmittedAtMs: { type: "integer", minimum: 0 },
  },
} as const;

const managedSchema = {
  type: "object",
  additionalProperties: false,
  required: ["submissionId", "playerId", "playerUsername", "playerDisplayName",
    "retirementState", "publicationStatus", "publicationReason", "current",
    "revisions", "events"],
  properties: {
    submissionId: submissionIdSchema,
    playerId: playerIdParamsSchema.properties.playerId,
    playerUsername: { type: "string", minLength: 1, maxLength: 64 },
    playerDisplayName: { type: "string", minLength: 1, maxLength: 128 },
    retirementState: { type: "string", enum: ["active", "retired"] },
    publicationStatus: { type: "string", enum: ["published", "withheld"] },
    publicationReason: { type: "string", minLength: 1, maxLength: 64 },
    current: revisionSchema,
    revisions: { type: "array", maxItems: 200, items: revisionSchema },
    events: { type: "array", maxItems: 200, items: eventSchema },
    videoUrl: youTubeWatchUrlSchema,
    carriedFrom: carriedFromSchema,
  },
} as const;

const documentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "result"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.managed-time-trial.v1" },
    result: managedSchema,
  },
} as const;

const listSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "results"],
  properties: {
    schemaVersion: {
      type: "string", const: "mk8dx.managed-time-trial-list.v1",
    },
    results: { type: "array", maxItems: 200, items: managedSchema },
  },
} as const;

const reasonSchema = {
  type: "string", enum: [...retirementReasons],
} as const;

const correctionBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["totalTimeMs", "laps", "reasonCode"],
  properties: {
    totalTimeMs: { type: "integer", minimum: 1, maximum: 599999 },
    laps: {
      type: "array", maxItems: 7,
      items: { type: "integer", minimum: 1, maximum: 599999 },
    },
    lapDetails: { type: "array", maxItems: 7, items: lapCountsSchema },
    loadout: correctionLoadoutSchema,
    reasonCode: reasonSchema,
    note: { type: "string", maxLength: 256 },
  },
} as const;

const videoBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["videoUrl"],
  properties: {
    videoUrl: { anyOf: [{ type: "string", maxLength: 512 }, { type: "null" }] },
  },
} as const;

const retirementBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["reasonCode"],
  properties: {
    reasonCode: reasonSchema,
    note: { type: "string", maxLength: 256 },
  },
} as const;

function errorReply(error: unknown): Readonly<{
  status: number;
  body: ErrorResponse;
}> {
  if (error instanceof TimeTrialLifecycleError) {
    switch (error.code) {
      case "invalid_input":
        return {
          status: 400,
          body: { code: "time_trial_lifecycle_invalid", message: error.message },
        };
      case "not_authenticated":
        return {
          status: 401,
          body: {
            code: "not_authenticated",
            message: "Sign in to manage Time Trials.",
          },
        };
      case "forbidden":
        return {
          status: 403,
          body: {
            code: "time_trial_lifecycle_forbidden",
            message: "That action is not allowed for this account.",
          },
        };
      case "not_found":
        return {
          status: 404,
          body: {
            code: "time_trial_not_found",
            message: "That Time Trial was not found.",
          },
        };
      case "conflict":
        return {
          status: 409,
          body: { code: "time_trial_lifecycle_conflict", message: error.message },
        };
      case "unavailable":
        break;
    }
  }
  return {
    status: 503,
    body: {
      code: "time_trial_lifecycle_unavailable",
      message: "The Time Trial could not be managed right now.",
    },
  };
}

export async function registerTimeTrialLifecycleRoutes(
  app: FastifyInstance,
  options: TimeTrialLifecycleRouteOptions,
): Promise<void> {
  const responses = {
    200: documentSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
    503: errorResponseSchema,
  };
  const wrap = (result: ManagedTimeTrial) => ({
    schemaVersion: "mk8dx.managed-time-trial.v1" as const, result,
  });

  app.get<{ Params: Readonly<{ submissionId: string }> }>(
    "/v1/time-trials/:submissionId",
    {
      schema: {
        params: {
          type: "object", additionalProperties: false,
          required: ["submissionId"],
          properties: { submissionId: submissionIdSchema },
        },
        response: responses,
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        return reply.send(wrap(await options.service.readOwnedOrAdministered(
          actor, request.params.submissionId,
        )));
      } catch (error) {
        const { status, body } = errorReply(error);
        return reply.code(status as 503).send(body as never);
      }
    },
  );

  const action = <Body>(
    path: string,
    bodySchema: unknown,
    run: (
      actor: ActorContext,
      submissionId: string,
      body: Body,
    ) => Promise<ManagedTimeTrial>,
  ): void => {
    app.post<{ Params: Readonly<{ submissionId: string }>; Body: Body }>(
      path,
      {
        schema: {
          params: {
            type: "object", additionalProperties: false,
            required: ["submissionId"],
            properties: { submissionId: submissionIdSchema },
          },
          body: bodySchema,
          response: responses,
        },
      },
      async (request, reply) => {
        try {
          const actor = await options.resolveActor(request);
          await requireProof(options, actor, request.headers["x-mk8dx-csrf"]);
          return reply.send(wrap(
            await run(
              actor, request.params.submissionId, request.body as Body,
            ),
          ));
        } catch (error) {
          const { status, body } = errorReply(error);
          return reply.code(status as 503).send(body as never);
        }
      },
    );
  };

  action<Readonly<{
    totalTimeMs: number; laps: readonly number[];
    reasonCode: string; note?: string;
  }>>(
    "/v1/time-trials/:submissionId/actions/correct",
    correctionBodySchema,
    (actor, submissionId, body) => options.service.correct(
      actor, submissionId, body as never,
    ),
  );

  // The Player's YouTube video of this run: a link attaches it, null removes it (migration 0071).
  action<Readonly<{ videoUrl: string | null }>>(
    "/v1/time-trials/:submissionId/actions/video",
    videoBodySchema,
    (actor, submissionId, body) => options.service.setVideo(actor, submissionId, body.videoUrl),
  );

  action<Readonly<{ reasonCode: string; note?: string }>>(
    "/v1/time-trials/:submissionId/actions/retire",
    retirementBodySchema,
    (actor, submissionId, body) => options.service.retire(
      actor, submissionId, body.reasonCode, body.note,
    ),
  );

  action<Readonly<{ reasonCode: string; note?: string }>>(
    "/v1/time-trials/:submissionId/actions/restore",
    retirementBodySchema,
    (actor, submissionId, body) => options.service.restore(
      actor, submissionId, body.reasonCode, body.note,
    ),
  );

  app.get<{ Querystring: Record<string, string | undefined> }>(
    "/v1/account/time-trials",
    {
      schema: {
        querystring: {
          type: "object", additionalProperties: false,
          properties: { limit: { type: "string", pattern: "^[0-9]{1,3}$" } },
        },
        response: {
          200: listSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        const limit = request.query["limit"];
        const results = await options.service.listOwn(
          actor, limit === undefined ? 100 : Number(limit),
        );
        return reply.send({
          schemaVersion: "mk8dx.managed-time-trial-list.v1" as const, results,
        });
      } catch (error) {
        const { status, body } = errorReply(error);
        return reply.code(status as 503).send(body as never);
      }
    },
  );

  app.get<{ Querystring: Record<string, string | undefined> }>(
    "/v1/administrator/time-trials",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            playerId: playerIdParamsSchema.properties.playerId,
            trackId: { type: "string", minLength: 1, maxLength: 255 },
            mode: { type: "string", enum: ["150", "200"] },
            retirementState: { type: "string", enum: ["active", "retired"] },
            publicationStatus: {
              type: "string", enum: ["published", "withheld"],
            },
            sourceKind: { type: "string", minLength: 1, maxLength: 64 },
            limit: { type: "string", pattern: "^[0-9]{1,3}$" },
          },
        },
        response: {
          200: listSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        const query = request.query;
        const parsedMode = query["mode"] === undefined
          ? undefined
          : Number(query["mode"]) as 150 | 200;
        const managed: ManagedTimeTrialQuery = {
          ...(query["playerId"] === undefined
            ? {} : { playerId: query["playerId"] }),
          ...(query["trackId"] === undefined
            ? {} : { trackId: query["trackId"] }),
          ...(parsedMode === undefined ? {} : { modeCc: parsedMode }),
          ...(query["retirementState"] === undefined
            ? {}
            : {
              retirementState:
                query["retirementState"] as "active" | "retired",
            }),
          ...(query["publicationStatus"] === undefined
            ? {}
            : {
              publicationStatus:
                query["publicationStatus"] as "published" | "withheld",
            }),
          ...(query["sourceKind"] === undefined
            ? {} : { sourceKind: query["sourceKind"] }),
          limit: query["limit"] === undefined ? 50 : Number(query["limit"]),
        };
        const results = await options.service.listForAdministrator(
          actor, managed,
        );
        return reply.send({
          schemaVersion: "mk8dx.managed-time-trial-list.v1" as const, results,
        });
      } catch (error) {
        const { status, body } = errorReply(error);
        return reply.code(status as 503).send(body as never);
      }
    },
  );
}

async function requireProof(
  options: TimeTrialLifecycleRouteOptions,
  actor: ActorContext,
  proof: unknown,
): Promise<void> {
  if (options.csrfVerifier === undefined) { return; }
  if (actor.role === "anonymous") {
    throw new TimeTrialLifecycleError("not_authenticated");
  }
  if (typeof proof !== "string" ||
    !await options.csrfVerifier.verify(actor, proof)) {
    throw new TimeTrialLifecycleError("forbidden");
  }
}
