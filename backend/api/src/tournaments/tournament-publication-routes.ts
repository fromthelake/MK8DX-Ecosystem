import type { FastifyInstance } from "fastify";

import { errorResponseSchema, playerIdParamsSchema } from "../identity/schemas.js";
import type { ActorContext, ActorResolver } from "../identity/types.js";
import { consumeTournamentMutationBudget } from "../security/tournament-mutation-budget.js";
import {
  MutationRateLimitExceeded,
  type MutationRateLimiter,
} from "../security/mysql-mutation-rate-limiter.js";
import {
  PublicTournamentServiceError,
  type PublicTournament,
  type PublicTournamentService,
  type PublicPlayerTournamentResult,
} from "./public-tournament-service.js";
import {
  TournamentPublicationServiceError,
  type TournamentPublicationReview,
  type TournamentPublicationService,
  type TournamentPublicationSnapshot,
  type TournamentPublicationTarget,
} from "./tournament-publication-service.js";

type ErrorResponse = { code: string; message: string };
type PublicationParams = { publicationId: string };
type PlayerParams = { playerId: string };
type CsrfHeaders = { "x-mk8dx-csrf": string };
type PublishBody = {
  expectedRevision?: number;
  eventName: string;
  targets: TournamentPublicationTarget[];
  reasonCode: string;
};
type RetractBody = { expectedRevision: number; reasonCode: string };

const publicationIdSchema = {
  type: "string",
  minLength: 30,
  maxLength: 151,
  pattern: "^tournament_publication\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$",
} as const;
const raceResultIdSchema = {
  type: "string",
  minLength: 30,
  maxLength: 151,
  pattern: "^tournament_race_result\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$",
} as const;
const targetSchema = {
  type: "object",
  additionalProperties: false,
  required: ["raceResultId", "revision"],
  properties: {
    raceResultId: raceResultIdSchema,
    revision: { type: "integer", minimum: 1 },
  },
} as const;
const publishBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["eventName", "targets", "reasonCode"],
  properties: {
    expectedRevision: { type: "integer", minimum: 1 },
    eventName: { type: "string", minLength: 1, maxLength: 128 },
    targets: { type: "array", minItems: 1, maxItems: 200, items: targetSchema },
    reasonCode: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      pattern: "^[a-z0-9]+(?:[._-][a-z0-9]+)*$",
    },
  },
} as const;
const snapshotSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "publicationId", "eventName", "status", "revision", "resultCount",
    "updatedAtMs",
  ],
  properties: {
    publicationId: publicationIdSchema,
    eventName: { type: "string", minLength: 1, maxLength: 128 },
    status: { type: "string", enum: ["published", "retracted"] },
    revision: { type: "integer", minimum: 1 },
    resultCount: { type: "integer", minimum: 0, maximum: 200 },
    publishedAtMs: { type: "integer", minimum: 0 },
    updatedAtMs: { type: "integer", minimum: 0 },
  },
} as const;
const candidateSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "raceResultId", "currentRevision", "raceNumber", "scoringSegment",
    "trackId", "placementCount", "publishable",
  ],
  properties: {
    raceResultId: raceResultIdSchema,
    currentRevision: { type: "integer", minimum: 1 },
    raceNumber: { type: "integer", minimum: 1 },
    scoringSegment: { type: "integer", minimum: 1 },
    trackId: { type: "string", minLength: 1, maxLength: 255 },
    mode: { type: "integer", enum: [50, 100, 150, 200] },
    mirror: { type: "boolean", const: true },
    occurredAtMs: { type: "integer", minimum: 0 },
    placementCount: { type: "integer", minimum: 1, maximum: 12 },
    publishable: { type: "boolean" },
    currentPublicationId: publicationIdSchema,
  },
} as const;
const csrfHeadersSchema = {
  type: "object",
  required: ["x-mk8dx-csrf"],
  properties: {
    "x-mk8dx-csrf": { type: "string", minLength: 1, maxLength: 1024 },
  },
} as const;

function failure(error: unknown): Readonly<{ status: 400 | 403 | 404 | 409 | 503; body: ErrorResponse }> {
  if (error instanceof TournamentPublicationServiceError) {
    if (error.code === "invalid_input") {
      return { status: 400, body: { code: "invalid_tournament_publication", message: "The Tournament publication request is invalid." } };
    }
    if (error.code === "forbidden") {
      return { status: 403, body: { code: "tournament_publication_forbidden", message: "The Tournament publication operation is not authorized." } };
    }
    if (error.code === "not_found") {
      return { status: 404, body: { code: "tournament_publication_not_found", message: "The Tournament publication target was not found." } };
    }
    if (error.code === "conflict") {
      return { status: 409, body: { code: "tournament_publication_conflict", message: "Tournament publication state changed or is not publishable." } };
    }
  }
  return { status: 503, body: { code: "tournament_publication_unavailable", message: "Tournament publication is temporarily unavailable." } };
}

async function authorizedActor(
  resolveActor: ActorResolver,
  verify: (actor: ActorContext, token: string) => boolean,
  request: Parameters<ActorResolver>[0],
  token: string,
): Promise<ActorContext> {
  const actor = await resolveActor(request);
  if (!verify(actor, token)) {
    throw new TournamentPublicationServiceError("forbidden");
  }
  return actor;
}

export async function registerTournamentPublicationRoutes(
  app: FastifyInstance,
  dependencies: Readonly<{
    resolveActor: ActorResolver;
    service: Pick<
      TournamentPublicationService,
      "listReview" | "createPublication" | "republish" | "retract"
    >;
    csrfVerifier: Readonly<{ verify(actor: ActorContext, token: string): boolean }>;
    rateLimiter: MutationRateLimiter;
    // Called after a successful publish/republish so the rating lifecycle
    // can apply the published races (ADR-0155). The callback owns its own
    // error handling: a rating failure never un-publishes the tournament
    // and never fails this route's response.
    onPublished?: (publicationId: string) => Promise<void>;
  }>,
): Promise<void> {
  const notifyPublished = async (publicationId: string): Promise<void> => {
    try {
      await dependencies.onPublished?.(publicationId);
    } catch {
      // The composition-supplied callback is expected to log; the publish
      // response must not fail after the publication is committed.
    }
  };
  app.get<{ Reply: TournamentPublicationReview | ErrorResponse }>(
    "/v1/administrator/tournament-publications/review",
    { schema: { response: {
      200: {
        type: "object", additionalProperties: false,
        required: ["publications", "candidates"],
        properties: {
          publications: { type: "array", maxItems: 100, items: snapshotSchema },
          candidates: { type: "array", maxItems: 200, items: candidateSchema },
        },
      },
      403: errorResponseSchema, 503: errorResponseSchema,
    } } },
    async (request, reply) => {
      try {
        return await dependencies.service.listReview(await dependencies.resolveActor(request));
      } catch (error) {
        const mapped = failure(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );

  app.post<{ Headers: CsrfHeaders; Body: PublishBody; Reply: TournamentPublicationSnapshot | ErrorResponse }>(
    "/v1/tournament-publications",
    { schema: { headers: csrfHeadersSchema, body: publishBodySchema, response: {
      200: snapshotSchema, 400: errorResponseSchema, 403: errorResponseSchema,
      404: errorResponseSchema, 409: errorResponseSchema,
      429: errorResponseSchema, 503: errorResponseSchema,
    } } },
    async (request, reply) => {
      try {
        if (request.body.expectedRevision !== undefined) {
          throw new TournamentPublicationServiceError("invalid_input");
        }
        const actor = await authorizedActor(
          dependencies.resolveActor,
          dependencies.csrfVerifier.verify.bind(dependencies.csrfVerifier),
          request,
          request.headers["x-mk8dx-csrf"],
        );
        await consumeTournamentMutationBudget(actor, dependencies.rateLimiter, "publication");
        const snapshot =
          await dependencies.service.createPublication(actor, request.body);
        await notifyPublished(snapshot.publicationId);
        return snapshot;
      } catch (error) {
        if (error instanceof MutationRateLimitExceeded) {
          void reply.header("retry-after", String(error.retryAfterSeconds));
          return reply.code(429).send({ code: "tournament_publication_rate_limited", message: "Too many Tournament publication actions were received. Wait before retrying." });
        }
        const mapped = failure(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );

  app.post<{ Params: PublicationParams; Headers: CsrfHeaders; Body: PublishBody; Reply: TournamentPublicationSnapshot | ErrorResponse }>(
    "/v1/tournament-publications/:publicationId/actions/publish",
    { schema: {
      params: { type: "object", additionalProperties: false, required: ["publicationId"], properties: { publicationId: publicationIdSchema } },
      headers: csrfHeadersSchema,
      body: { ...publishBodySchema, required: ["expectedRevision", "eventName", "targets", "reasonCode"] },
      response: { 200: snapshotSchema, 400: errorResponseSchema, 403: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema, 429: errorResponseSchema, 503: errorResponseSchema },
    } },
    async (request, reply) => {
      try {
        const actor = await authorizedActor(
          dependencies.resolveActor,
          dependencies.csrfVerifier.verify.bind(dependencies.csrfVerifier),
          request,
          request.headers["x-mk8dx-csrf"],
        );
        await consumeTournamentMutationBudget(actor, dependencies.rateLimiter, "publication");
        const snapshot = await dependencies.service.republish(
          actor,
          request.params.publicationId,
          request.body as Required<PublishBody>,
        );
        await notifyPublished(snapshot.publicationId);
        return snapshot;
      } catch (error) {
        if (error instanceof MutationRateLimitExceeded) {
          void reply.header("retry-after", String(error.retryAfterSeconds));
          return reply.code(429).send({ code: "tournament_publication_rate_limited", message: "Too many Tournament publication actions were received. Wait before retrying." });
        }
        const mapped = failure(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );

  app.post<{ Params: PublicationParams; Headers: CsrfHeaders; Body: RetractBody; Reply: TournamentPublicationSnapshot | ErrorResponse }>(
    "/v1/tournament-publications/:publicationId/actions/retract",
    { schema: {
      params: { type: "object", additionalProperties: false, required: ["publicationId"], properties: { publicationId: publicationIdSchema } },
      headers: csrfHeadersSchema,
      body: {
        type: "object", additionalProperties: false,
        required: ["expectedRevision", "reasonCode"],
        properties: {
          expectedRevision: { type: "integer", minimum: 1 },
          reasonCode: publishBodySchema.properties.reasonCode,
        },
      },
      response: { 200: snapshotSchema, 400: errorResponseSchema, 403: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema, 429: errorResponseSchema, 503: errorResponseSchema },
    } },
    async (request, reply) => {
      try {
        const actor = await authorizedActor(
          dependencies.resolveActor,
          dependencies.csrfVerifier.verify.bind(dependencies.csrfVerifier),
          request,
          request.headers["x-mk8dx-csrf"],
        );
        await consumeTournamentMutationBudget(actor, dependencies.rateLimiter, "publication");
        return await dependencies.service.retract(
          actor,
          request.params.publicationId,
          request.body,
        );
      } catch (error) {
        if (error instanceof MutationRateLimitExceeded) {
          void reply.header("retry-after", String(error.retryAfterSeconds));
          return reply.code(429).send({ code: "tournament_publication_rate_limited", message: "Too many Tournament publication actions were received. Wait before retrying." });
        }
        const mapped = failure(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );
}

const publicPlacementSchema = {
  type: "object", additionalProperties: false,
  // playerId/playerUsername are absent when the Player is private: the
  // placement keeps its finish position and rank so the race stays whole.
  required: ["finishPosition", "playerDisplayName", "racePoints", "totalAfterRace", "rankAfterRace"],
  properties: {
    finishPosition: { type: "integer", minimum: 1, maximum: 12 },
    playerId: playerIdParamsSchema.properties.playerId,
    playerUsername: { type: "string", minLength: 1, maxLength: 64 },
    playerDisplayName: { type: "string", minLength: 1, maxLength: 128 },
    racePoints: { type: "integer", minimum: 0 }, totalAfterRace: { type: "integer", minimum: 0 },
    rankAfterRace: { type: "integer", minimum: 1, maximum: 12 },
    characterId: { type: "string", minLength: 1, maxLength: 255 },
    characterVariantId: { type: "string", minLength: 1, maxLength: 255 },
  },
} as const;
const publicRaceProperties = {
  raceResultId: raceResultIdSchema,
  revision: { type: "integer", minimum: 1 }, raceNumber: { type: "integer", minimum: 1 },
  scoringSegment: { type: "integer", minimum: 1 }, trackId: { type: "string", minLength: 1, maxLength: 255 },
  mode: { type: "integer", enum: [50, 100, 150, 200] }, mirror: { type: "boolean", const: true },
  countsTowardStandings: { type: "boolean" },
  resultAtMs: { type: "integer", minimum: 0 },
} as const;

export async function registerPublicTournamentRoutes(
  app: FastifyInstance,
  service: Pick<PublicTournamentService, "loadPublication" | "listPlayerResults">,
): Promise<void> {
  app.get<{ Params: PublicationParams; Reply: PublicTournament | ErrorResponse }>(
    "/v1/public/tournaments/:publicationId",
    { schema: {
      params: { type: "object", additionalProperties: false, required: ["publicationId"], properties: { publicationId: publicationIdSchema } },
      response: {
        200: {
          type: "object", additionalProperties: false,
          required: ["publicationId", "eventName", "publishedAtMs", "races", "standings"],
          properties: {
            publicationId: publicationIdSchema, eventName: { type: "string", minLength: 1, maxLength: 128 },
            publishedAtMs: { type: "integer", minimum: 0 },
            races: { type: "array", minItems: 1, maxItems: 200, items: {
              type: "object", additionalProperties: false,
              required: ["raceResultId", "revision", "raceNumber", "scoringSegment", "trackId", "countsTowardStandings", "resultAtMs", "placements"],
              properties: { ...publicRaceProperties, placements: { type: "array", minItems: 1, maxItems: 12, items: publicPlacementSchema } },
            } },
            standings: { type: "array", minItems: 1, maxItems: 2400, items: {
              type: "object", additionalProperties: false,
              required: ["scoringSegment", "playerDisplayName", "totalPoints", "rank"],
              properties: {
                scoringSegment: { type: "integer", minimum: 1 }, playerId: playerIdParamsSchema.properties.playerId,
                playerUsername: { type: "string", minLength: 1, maxLength: 64 }, playerDisplayName: { type: "string", minLength: 1, maxLength: 128 },
                totalPoints: { type: "integer", minimum: 0 }, rank: { type: "integer", minimum: 1, maximum: 12 },
              },
            } },
          },
        },
        400: errorResponseSchema, 404: errorResponseSchema, 503: errorResponseSchema,
      },
    } },
    async (request, reply) => {
      try {
        const result = await service.loadPublication(request.params.publicationId);
        return result ?? reply.code(404).send({ code: "public_tournament_not_found", message: "The published Tournament was not found." });
      } catch (error) {
        if (error instanceof PublicTournamentServiceError && error.code === "invalid_input") {
          return reply.code(400).send({ code: "invalid_public_tournament_query", message: "The public Tournament query is invalid." });
        }
        return reply.code(503).send({ code: "public_tournaments_unavailable", message: "Public Tournament results are temporarily unavailable." });
      }
    },
  );

  app.get<{ Params: PlayerParams; Reply: { schemaVersion: string; results: readonly PublicPlayerTournamentResult[] } | ErrorResponse }>(
    "/v1/public/players/:playerId/tournaments",
    { schema: { params: playerIdParamsSchema, response: {
      200: {
        type: "object", additionalProperties: false, required: ["schemaVersion", "results"],
        properties: {
          schemaVersion: { const: "mk8dx.public-player-tournaments.v1" },
          results: { type: "array", maxItems: 100, items: {
            type: "object", additionalProperties: false,
            required: ["publicationId", "eventName", "publishedAtMs", "raceResultId", "revision", "raceNumber", "scoringSegment", "trackId", "finishPosition", "racePoints", "totalAfterRace", "rankAfterRace", "resultAtMs"],
            properties: {
              publicationId: publicationIdSchema, eventName: { type: "string", minLength: 1, maxLength: 128 }, publishedAtMs: { type: "integer", minimum: 0 },
              ...publicRaceProperties,
              finishPosition: { type: "integer", minimum: 1, maximum: 12 }, racePoints: { type: "integer", minimum: 0 }, totalAfterRace: { type: "integer", minimum: 0 }, rankAfterRace: { type: "integer", minimum: 1, maximum: 12 },
            },
          } },
        },
      },
      400: errorResponseSchema, 503: errorResponseSchema,
    } } },
    async (request, reply) => {
      try {
        return { schemaVersion: "mk8dx.public-player-tournaments.v1", results: await service.listPlayerResults(request.params.playerId) };
      } catch (error) {
        if (error instanceof PublicTournamentServiceError && error.code === "invalid_input") {
          return reply.code(400).send({ code: "invalid_public_tournament_query", message: "The public Tournament query is invalid." });
        }
        return reply.code(503).send({ code: "public_tournaments_unavailable", message: "Public Tournament results are temporarily unavailable." });
      }
    },
  );
}
