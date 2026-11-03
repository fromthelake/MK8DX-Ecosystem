import type { FastifyInstance } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import {
  PublicCareerError,
  type PublicCareerService,
} from "./public-career-service.js";

type ErrorResponse = Readonly<{ code: string; message: string }>;

export type PublicCareerRouteOptions = Readonly<{
  service: Pick<PublicCareerService, "loadCareer">;
}>;

const paramsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["playerId"],
  properties: {
    playerId: {
      type: "string",
      maxLength: 135,
      pattern: "^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
    },
  },
} as const;

export const careerResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "playerId", "timeTrials"],
  properties: {
    schemaVersion: {
      type: "string",
      const: "mk8dx.public-player-career.v1",
    },
    playerId: {
      type: "string",
      pattern: "^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
    },
    timeTrials: {
      type: "object",
      additionalProperties: false,
      required: [
        "published", "published150", "published200", "tracks150", "tracks200",
        "firsts", "firsts150", "firsts200", "podiums", "podiums150", "podiums200",
      ],
      properties: {
        published: { type: "integer", minimum: 0 },
        published150: { type: "integer", minimum: 0 },
        published200: { type: "integer", minimum: 0 },
        tracks150: { type: "integer", minimum: 0 },
        tracks200: { type: "integer", minimum: 0 },
        firsts: { type: "integer", minimum: 0 },
        firsts150: { type: "integer", minimum: 0 },
        firsts200: { type: "integer", minimum: 0 },
        podiums: { type: "integer", minimum: 0 },
        podiums150: { type: "integer", minimum: 0 },
        podiums200: { type: "integer", minimum: 0 },
        mostPlayed: {
          type: "object",
          additionalProperties: false,
          required: ["trackId", "count", "count150", "count200"],
          properties: {
            trackId: {
              type: "string",
              pattern: "^track\\.[a-z0-9]+(?:_[a-z0-9]+)*$",
            },
            count: { type: "integer", minimum: 1 },
            count150: { type: "integer", minimum: 0 },
            count200: { type: "integer", minimum: 0 },
          },
        },
        latestResultAtMs: { type: "integer", minimum: 0 },
      },
    },
    rating: {
      type: "object",
      additionalProperties: false,
      required: ["score", "rank", "peakScore", "history"],
      properties: {
        score: { type: "number" },
        rank: { type: "integer", minimum: 1 },
        peakScore: { type: "number" },
        history: {
          type: "array",
          maxItems: 500,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["sequence", "eventType", "occurredAtMs", "score"],
            properties: {
              sequence: { type: "integer", minimum: 0 },
              eventType: { type: "string", enum: ["seed", "race"] },
              occurredAtMs: { type: "integer", minimum: 0 },
              score: { type: "number" },
              delta: { type: "number" },
            },
          },
        },
      },
    },
  },
} as const;

function errorReply(error: unknown): Readonly<{
  status: number;
  body: ErrorResponse;
}> {
  if (error instanceof PublicCareerError) {
    if (error.code === "invalid_input") {
      return {
        status: 400,
        body: {
          code: "career_invalid",
          message: "The Player reference is not valid.",
        },
      };
    }
    if (error.code === "not_found") {
      return {
        status: 404,
        body: {
          code: "player_not_found",
          message: "This public Player was not found.",
        },
      };
    }
  }
  return {
    status: 503,
    body: {
      code: "career_unavailable",
      message: "The Player career is temporarily unavailable.",
    },
  };
}

export async function registerPublicCareerRoutes(
  app: FastifyInstance,
  options: PublicCareerRouteOptions,
): Promise<void> {
  app.get<{ Params: Readonly<{ playerId: string }>; Reply: unknown }>(
    "/v1/public/players/:playerId/career",
    {
      schema: {
        params: paramsSchema,
        response: {
          200: careerResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const career = await options.service.loadCareer(
          request.params.playerId,
        );
        return reply.send({
          schemaVersion: "mk8dx.public-player-career.v1",
          ...career,
        });
      } catch (error) {
        const { status, body } = errorReply(error);
        return reply.code(status).send(body);
      }
    },
  );
}
