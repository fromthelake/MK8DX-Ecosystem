// Administrator rating operations over HTTP (ADR-0155 boundary): the
// per-publication rating decision (include/exclude) and the audited
// deterministic recalculation, previously reachable only through the
// `rating:lifecycle` CLI. Every action re-authorizes server-side and
// requires the same-origin CSRF proof; nothing here edits history.

import type { FastifyInstance, FastifyReply } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorContext, ActorResolver } from "../identity/types.js";
import {
  RatingLifecycleError,
  type RatingLifecycleService,
} from "./rating-lifecycle-service.js";

type ErrorResponse = { code: string; message: string };
type CsrfHeaders = { "x-mk8dx-csrf": string };

export type RatingDecisionOverview = Readonly<{
  publicationId: string;
  eventName: string;
  publicationStatus: string;
  publicVisibility: string;
  publishedAtMs?: number;
  ratingIncluded: boolean;
  decidedAtMs?: number;
  appliedRaces: number;
}>;

export type RatingAdministrationOverview = Readonly<{
  schemaVersion: "mk8dx.rating-administration.v1";
  currentEpoch: number;
  ratedPlayers: number;
  publications: readonly RatingDecisionOverview[];
  recalculations: readonly Readonly<{
    epoch: number;
    reasonCode: string;
    includedPublications: number;
    appliedRaces: number;
    skippedRaces: number;
    occurredAtMs: number;
  }>[];
}>;

export interface RatingAdministrationReadRepository {
  overview(): Promise<Omit<RatingAdministrationOverview, "schemaVersion">>;
}

const publicationIdSchema = {
  type: "string", minLength: 30, maxLength: 160,
  pattern: "^tournament_publication\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$",
} as const;
const reasonCodeSchema = {
  type: "string", minLength: 1, maxLength: 64,
  pattern: "^[a-z0-9]+(?:[._-][a-z0-9]+)*$",
} as const;
const csrfHeadersSchema = {
  type: "object", required: ["x-mk8dx-csrf"],
  properties: { "x-mk8dx-csrf": { type: "string", minLength: 1, maxLength: 1024 } },
} as const;

function failure(error: unknown): Readonly<{ status: 400 | 403 | 404 | 409 | 503; body: ErrorResponse }> {
  if (error instanceof RatingLifecycleError) {
    switch (error.code) {
      case "invalid_command":
        return { status: 400, body: { code: "invalid_rating_command", message: error.message } };
      case "forbidden":
        return { status: 403, body: { code: "rating_operation_forbidden", message: "The rating operation is not authorized." } };
      case "not_found":
        return { status: 404, body: { code: "rating_publication_not_found", message: error.message } };
      case "conflict":
        return { status: 409, body: { code: "rating_operation_conflict", message: error.message } };
      default:
        break;
    }
  }
  return { status: 503, body: { code: "rating_operation_unavailable", message: "Rating operations are temporarily unavailable." } };
}

export async function registerRatingAdministrationRoutes(
  app: FastifyInstance,
  dependencies: Readonly<{
    resolveActor: ActorResolver;
    service: Pick<RatingLifecycleService, "recordDecision" | "recalculate" | "applyPublication">;
    readRepository: RatingAdministrationReadRepository;
    csrfVerifier: Readonly<{ verify(actor: ActorContext, token: string): boolean }>;
  }>,
): Promise<void> {
  const administrator = async (
    request: Parameters<ActorResolver>[0],
    token?: string,
  ): Promise<Readonly<{ userAccountId: string }>> => {
    const actor = await dependencies.resolveActor(request);
    if (actor.role !== "administrator") {
      throw new RatingLifecycleError("forbidden", "administrator required");
    }
    if (token !== undefined && !dependencies.csrfVerifier.verify(actor, token)) {
      throw new RatingLifecycleError("forbidden", "request proof required");
    }
    return actor;
  };
  const handle = async <T>(reply: FastifyReply, work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      const mapped = failure(error);
      return reply.code(mapped.status).send(mapped.body) as unknown as T;
    }
  };

  app.get<{ Reply: RatingAdministrationOverview | ErrorResponse }>(
    "/v1/administrator/rating/overview",
    { schema: { response: {
      200: {
        type: "object", additionalProperties: false,
        required: ["schemaVersion", "currentEpoch", "ratedPlayers", "publications", "recalculations"],
        properties: {
          schemaVersion: { const: "mk8dx.rating-administration.v1" },
          currentEpoch: { type: "integer", minimum: 0 },
          ratedPlayers: { type: "integer", minimum: 0 },
          publications: { type: "array", maxItems: 200, items: {
            type: "object", additionalProperties: false,
            required: ["publicationId", "eventName", "publicationStatus", "publicVisibility", "ratingIncluded", "appliedRaces"],
            properties: {
              publicationId: publicationIdSchema,
              eventName: { type: "string", minLength: 1, maxLength: 128 },
              publicationStatus: { type: "string", minLength: 1, maxLength: 32 },
              publicVisibility: { type: "string", minLength: 1, maxLength: 16 },
              publishedAtMs: { type: "integer", minimum: 0 },
              ratingIncluded: { type: "boolean" },
              decidedAtMs: { type: "integer", minimum: 0 },
              appliedRaces: { type: "integer", minimum: 0 },
            },
          } },
          recalculations: { type: "array", maxItems: 50, items: {
            type: "object", additionalProperties: false,
            required: ["epoch", "reasonCode", "includedPublications", "appliedRaces", "skippedRaces", "occurredAtMs"],
            properties: {
              epoch: { type: "integer", minimum: 1 },
              reasonCode: { type: "string", minLength: 1, maxLength: 64 },
              includedPublications: { type: "integer", minimum: 0 },
              appliedRaces: { type: "integer", minimum: 0 },
              skippedRaces: { type: "integer", minimum: 0 },
              occurredAtMs: { type: "integer", minimum: 0 },
            },
          } },
        },
      },
      403: errorResponseSchema, 503: errorResponseSchema,
    } } },
    async (request, reply) => handle(reply, async () => {
      await administrator(request);
      return { schemaVersion: "mk8dx.rating-administration.v1" as const, ...await dependencies.readRepository.overview() };
    }),
  );

  app.post<{ Headers: CsrfHeaders; Body: { publicationId: string; ratingIncluded: boolean; reasonCode: string };
    Reply: { publicationId: string; ratingIncluded: boolean } | ErrorResponse }>(
    "/v1/administrator/rating/decisions",
    { schema: { headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false,
      required: ["publicationId", "ratingIncluded", "reasonCode"],
      properties: {
        publicationId: publicationIdSchema,
        ratingIncluded: { type: "boolean" },
        reasonCode: reasonCodeSchema,
      },
    }, response: {
      200: {
        type: "object", additionalProperties: false, required: ["publicationId", "ratingIncluded"],
        properties: { publicationId: publicationIdSchema, ratingIncluded: { type: "boolean" } },
      },
      400: errorResponseSchema, 403: errorResponseSchema, 404: errorResponseSchema,
      409: errorResponseSchema, 503: errorResponseSchema,
    } } },
    async (request, reply) => handle(reply, async () => {
      const actor = await administrator(request, request.headers["x-mk8dx-csrf"]);
      return dependencies.service.recordDecision({
        administratorAccountId: actor.userAccountId,
        publicationPublicId: request.body.publicationId,
        ratingIncluded: request.body.ratingIncluded,
        reasonCode: request.body.reasonCode,
      });
    }),
  );

  app.post<{ Headers: CsrfHeaders; Body: { reasonCode: string; confirmRecalculation: true };
    Reply: { epoch: number; includedPublications: number; appliedRaces: number; skippedRaces: number; ratedPlayers: number } | ErrorResponse }>(
    "/v1/administrator/rating/actions/recalculate",
    { schema: { headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false,
      required: ["reasonCode", "confirmRecalculation"],
      properties: {
        reasonCode: reasonCodeSchema,
        confirmRecalculation: { type: "boolean", const: true },
      },
    }, response: {
      200: {
        type: "object", additionalProperties: false,
        required: ["epoch", "includedPublications", "appliedRaces", "skippedRaces", "ratedPlayers"],
        properties: {
          epoch: { type: "integer", minimum: 1 },
          includedPublications: { type: "integer", minimum: 0 },
          appliedRaces: { type: "integer", minimum: 0 },
          skippedRaces: { type: "integer", minimum: 0 },
          ratedPlayers: { type: "integer", minimum: 0 },
        },
      },
      400: errorResponseSchema, 403: errorResponseSchema, 409: errorResponseSchema, 503: errorResponseSchema,
    } } },
    async (request, reply) => handle(reply, async () => {
      const actor = await administrator(request, request.headers["x-mk8dx-csrf"]);
      return dependencies.service.recalculate({
        administratorAccountId: actor.userAccountId,
        reasonCode: request.body.reasonCode,
      });
    }),
  );

  app.post<{ Headers: CsrfHeaders; Body: { publicationId: string };
    Reply: { publicationId: string; epoch: number; appliedRaces: number; skippedRaces: number; ratedPlayers: number; alreadyApplied: boolean } | ErrorResponse }>(
    "/v1/administrator/rating/actions/apply-publication",
    { schema: { headers: csrfHeadersSchema, body: {
      type: "object", additionalProperties: false, required: ["publicationId"],
      properties: { publicationId: publicationIdSchema },
    }, response: {
      200: {
        type: "object", additionalProperties: false,
        required: ["publicationId", "epoch", "appliedRaces", "skippedRaces", "ratedPlayers", "alreadyApplied"],
        properties: {
          publicationId: publicationIdSchema,
          epoch: { type: "integer", minimum: 0 },
          appliedRaces: { type: "integer", minimum: 0 },
          skippedRaces: { type: "integer", minimum: 0 },
          ratedPlayers: { type: "integer", minimum: 0 },
          alreadyApplied: { type: "boolean" },
        },
      },
      400: errorResponseSchema, 403: errorResponseSchema, 404: errorResponseSchema,
      409: errorResponseSchema, 503: errorResponseSchema,
    } } },
    async (request, reply) => handle(reply, async () => {
      await administrator(request, request.headers["x-mk8dx-csrf"]);
      return dependencies.service.applyPublication(request.body.publicationId);
    }),
  );
}
