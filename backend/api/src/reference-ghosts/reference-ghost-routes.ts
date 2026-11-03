import type { FastifyInstance } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorResolver } from "../identity/types.js";
import { MutationRateLimitExceeded, type MutationRateLimiter } from
  "../security/mysql-mutation-rate-limiter.js";
import {
  ReferenceGhostReadingError,
  type ReferenceGhostReadingService,
} from "./reference-ghost-readings.js";

// POST /v1/reference-ghost-readings and GET /v1/public/reference-ghost-readings (ADR-0212).
//
// Only a signed-in native client that read the ghost from a screen sends a reading, so the POST
// requires the bearer credential those clients send, as a completion does (ADR-0210 rule 10); a
// cookie session alone is refused and no CSRF proof is needed.

export type ReferenceGhostRouteOptions = Readonly<{
  resolveActor: ActorResolver;
  service: Pick<ReferenceGhostReadingService, "record" | "list">;
  rateLimiter?: MutationRateLimiter;
}>;

const numbers = (maximum: number, itemMaximum: number) =>
  ({ type: "array", maxItems: maximum, items: { type: "integer", minimum: 0, maximum: itemMaximum } }) as const;
const nullable = <T extends Record<string, unknown>>(schema: T) => ({ anyOf: [schema, { type: "null" }] }) as const;

const eventsSchema = {
  type: "object", additionalProperties: false,
  required: ["status", "timeBase", "coinEvents", "mushroomEvents"],
  properties: {
    status: { type: "string", const: "available" },
    timeBase: { type: "string", const: "race_elapsed_ms" },
    coinEvents: {
      type: "array", maxItems: 400,
      items: {
        type: "object", additionalProperties: false, required: ["raceMs", "lap", "from", "to"],
        properties: {
          raceMs: { type: "integer", minimum: 0 }, lap: { type: "integer", minimum: 1 },
          from: { type: "integer", minimum: 0 }, to: { type: "integer", minimum: 0 },
        },
      },
    },
    mushroomEvents: {
      type: "array", maxItems: 3,
      items: {
        type: "object", additionalProperties: false, required: ["raceMs", "lap"],
        properties: { raceMs: { type: "integer", minimum: 0 }, lap: { type: "integer", minimum: 1 } },
      },
    },
  },
} as const;

const loadoutSchema = {
  type: "object", additionalProperties: false, required: ["characterId", "bodyId", "tireId", "gliderId"],
  properties: {
    characterId: { type: "string", maxLength: 96 }, bodyId: { type: "string", maxLength: 96 },
    tireId: { type: "string", maxLength: 96 }, gliderId: { type: "string", maxLength: 96 },
  },
} as const;

const readingSchema = {
  type: "object", additionalProperties: false,
  required: ["kind", "trackId", "mode", "totalTimeMs", "observedName", "countryId", "loadout", "lapTimesMs",
    "coinsPerLap", "mushroomsPerLap", "events", "source", "confirmations", "conflicts", "updatedAtMs"],
  properties: {
    kind: { type: "string", enum: ["nintendo_staff", "world_record"] },
    trackId: { type: "string", maxLength: 96 },
    mode: { type: "integer", enum: [150, 200] },
    totalTimeMs: { type: "integer", minimum: 1 },
    observedName: { type: "string", maxLength: 96 },
    countryId: nullable({ type: "string", maxLength: 64 }),
    loadout: nullable(loadoutSchema),
    lapTimesMs: numbers(7, 3_599_999),
    coinsPerLap: nullable(numbers(7, 10)),
    mushroomsPerLap: nullable(numbers(7, 3)),
    events: nullable(eventsSchema),
    source: { type: "string", enum: ["ghost_panel", "ghost_replay"] },
    confirmations: { type: "integer", minimum: 0 },
    conflicts: { type: "integer", minimum: 0 },
    updatedAtMs: { type: "integer", minimum: 0 },
  },
} as const;

function errorReply(error: unknown): Readonly<{ status: number; body: Readonly<{ code: string; message: string }> }> {
  if (error instanceof MutationRateLimitExceeded) {
    return { status: 429, body: { code: "reference_ghost_reading_rate_limited", message: "Try again later." } };
  }
  if (error instanceof ReferenceGhostReadingError) {
    switch (error.code) {
      case "invalid_reading":
      case "invalid_assets":
        return { status: 400, body: { code: `reference_ghost_${error.code}`, message: error.message } };
      case "not_authenticated":
        return { status: 401, body: { code: "reference_ghost_authentication_required", message: "Authentication is required." } };
      case "not_a_reference":
        return { status: 409, body: { code: "reference_ghost_not_a_reference", message: error.message } };
    }
  }
  return {
    status: 503,
    body: { code: "reference_ghost_readings_unavailable", message: "Ghost readings are unavailable right now." },
  };
}

export async function registerReferenceGhostRoutes(
  app: FastifyInstance,
  options: ReferenceGhostRouteOptions,
): Promise<void> {
  app.post<{ Body: unknown }>(
    "/v1/reference-ghost-readings",
    {
      bodyLimit: 65_536,
      schema: {
        body: { type: "object" },
        response: {
          200: {
            type: "object", additionalProperties: false, required: ["schemaVersion", "outcome"],
            properties: {
              schemaVersion: { type: "string", const: "mk8dx.reference-ghost-reading-result.v1" },
              outcome: { type: "string", enum: ["recorded", "completed", "confirmed", "conflict"] },
            },
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
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
            code: "reference_ghost_authentication_required", message: "Authentication is required.",
          });
        }
        const authorization = request.headers.authorization;
        if (typeof authorization !== "string" || !/^Bearer [A-Za-z0-9_-]{20,255}$/.test(authorization)) {
          return reply.code(403).send({
            code: "reference_ghost_native_only",
            message: "Only a signed-in native client sends a ghost reading.",
          });
        }
        if (options.rateLimiter !== undefined) {
          await options.rateLimiter.consume(actor.userAccountId, "reference-ghost-10m", 600, 400);
          await options.rateLimiter.consume(actor.userAccountId, "reference-ghost-day", 86_400, 2_000);
        }
        const outcome = await options.service.record(actor, request.body);
        return reply.code(200).send({ schemaVersion: "mk8dx.reference-ghost-reading-result.v1" as const, outcome });
      } catch (error) {
        const { status, body } = errorReply(error);
        if (status === 503) { request.log.error({ err: error }, "reference ghost reading failed"); }
        return reply.code(status as 503).send(body);
      }
    },
  );

  app.get<{ Querystring: Readonly<{ trackId?: string; mode?: "150" | "200" }> }>(
    "/v1/public/reference-ghost-readings",
    {
      schema: {
        querystring: {
          type: "object", additionalProperties: false,
          properties: {
            trackId: { type: "string", pattern: "^track\\.[a-z0-9]+(?:_[a-z0-9]+)*$", maxLength: 96 },
            // A query value is text; the app does not coerce types (app.ts).
            mode: { type: "string", enum: ["150", "200"] },
          },
        },
        response: {
          200: {
            type: "object", additionalProperties: false, required: ["schemaVersion", "readings"],
            properties: {
              schemaVersion: { type: "string", const: "mk8dx.reference-ghost-readings.v1" },
              readings: { type: "array", maxItems: 2_000, items: readingSchema },
            },
          },
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const mode = request.query.mode === undefined ? undefined : Number(request.query.mode) === 200 ? 200 : 150;
        const filter: { trackId?: string; mode?: 150 | 200 } = {
          ...(request.query.trackId === undefined ? {} : { trackId: request.query.trackId }),
          ...(mode === undefined ? {} : { mode }),
        };
        return { schemaVersion: "mk8dx.reference-ghost-readings.v1" as const, readings: await options.service.list(filter) };
      } catch (error) {
        request.log.error({ err: error }, "reference ghost readings unavailable");
        return reply.code(503).send({
          code: "reference_ghost_readings_unavailable", message: "Ghost readings are unavailable right now.",
        });
      }
    },
  );
}
