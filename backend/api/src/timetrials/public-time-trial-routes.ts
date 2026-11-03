import type { FastifyInstance } from "fastify";

import { errorResponseSchema, playerIdParamsSchema } from "../identity/schemas.js";
import {
  PublicTimeTrialServiceError,
  type PublicTimeTrialResult,
  type PublicTimeTrialStanding,
  type PublicTimeTrialService,
} from "./public-time-trial-service.js";

type ErrorResponse = { code: string; message: string };
type PlayerParams = { playerId: string };
type LeaderboardQuery = { trackId: string; mode: "150" | "200" };
type StandingQuery = { mode: "150" | "200"; scope?: "base" | "bcp" | "all" };

const asset = { type: "string", minLength: 1, maxLength: 255 } as const;
const resultSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "resultId", "revision", "playerId", "playerUsername", "playerDisplayName",
    "trackId", "mode", "totalTimeMs", "laps", "sourceKind", "resultAtMs", "publishedAtMs",
  ],
  properties: {
    resultId: {
      type: "string",
      pattern: "^user_submission\\.time\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$",
    },
    revision: { type: "integer", minimum: 1 },
    playerId: playerIdParamsSchema.properties.playerId,
    playerUsername: { type: "string", minLength: 1, maxLength: 64 },
    playerDisplayName: { type: "string", minLength: 1, maxLength: 128 },
    countryId: {
      type: "string",
      pattern: "^country\.[a-z0-9_]+$",
      maxLength: 64,
    },
    trackId: { ...asset, pattern: "^track\\.[a-z0-9]+(?:_[a-z0-9]+)*$" },
    mode: { type: "integer", enum: [150, 200] },
    totalTimeMs: { type: "integer", minimum: 1, maximum: 599999 },
    laps: {
      type: "array",
      maxItems: 7,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["lapNumber", "timeMs"],
        properties: {
          lapNumber: { type: "integer", minimum: 1, maximum: 7 },
          timeMs: { type: "integer", minimum: 1, maximum: 599999 },
          coinsCollected: { type: "integer", minimum: 0, maximum: 10 },
          mushroomsUsed: { type: "integer", minimum: 0, maximum: 3 },
        },
      },
    },
    loadout: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: asset,
        characterVariantId: asset,
        bodyId: asset,
        bodyVariantId: asset,
        tireId: asset,
        gliderId: asset,
        gliderVariantId: asset,
      },
    },
    sourceKind: { type: "string", minLength: 1, maxLength: 48 },
    correctedFields: {
      type: "array",
      minItems: 1,
      maxItems: 15,
      uniqueItems: true,
      items: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9]{0,31}$" },
    },
    resultAtMs: { type: "integer", minimum: 0 },
    publishedAtMs: { type: "integer", minimum: 0 },
    rank: { type: "integer", minimum: 1 },
    videoUrl: { type: "string", pattern: "^https://www\\.youtube\\.com/watch\\?v=[A-Za-z0-9_-]{11}$" },
  },
} as const;

export const publicTrackBestsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "players"],
  properties: {
    schemaVersion: { const: "mk8dx.public-track-bests.v1" },
    players: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["playerId", "bests"],
        properties: {
          playerId: { type: "string" },
          bests: {
            type: "array",
            maxItems: 200,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["trackId", "mode", "totalTimeMs", "rank"],
              properties: {
                trackId: resultSchema.properties.trackId,
                mode: { type: "integer", enum: [150, 200] },
                totalTimeMs: { type: "integer", minimum: 1 },
                rank: { type: "integer", minimum: 1 },
              },
            },
          },
        },
      },
    },
  },
} as const;

function failure(error: unknown): Readonly<{
  status: 400 | 503;
  body: ErrorResponse;
}> {
  return error instanceof PublicTimeTrialServiceError && error.code === "invalid_input"
    ? { status: 400, body: {
        code: "invalid_public_time_trial_query",
        message: "The public Time Trial query is invalid.",
      } }
    : { status: 503, body: {
        code: "public_time_trials_unavailable",
        message: "Public Time Trial results are temporarily unavailable.",
      } };
}

export async function registerPublicTimeTrialRoutes(
  app: FastifyInstance,
  service: Pick<
    PublicTimeTrialService,
    "listPlayerResults" | "listLeaderboard" | "listPlayerTrackBests" |
    "listTrackBestsForPlayers" | "listRecentResults" | "listStandings"
  >,
): Promise<void> {
  app.get<{
    Querystring: StandingQuery;
    Reply: { schemaVersion: string; standings: readonly PublicTimeTrialStanding[] } | ErrorResponse;
  }>(
    "/v1/public/time-trial-standings",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["mode"],
          properties: {
            mode: { type: "string", enum: ["150", "200"] },
            scope: { type: "string", enum: ["base", "bcp", "all"], default: "all" },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["schemaVersion", "standings"],
            properties: {
              schemaVersion: { const: "mk8dx.public-time-trial-standings.v1" },
              standings: {
                type: "array",
                maxItems: 500,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "rank", "playerId", "playerDisplayName", "mode",
                    "totalTimeMs", "averageTimeMs", "playedTracks",
                    "goldMedals", "silverMedals", "bronzeMedals",
                  ],
                  properties: {
                    rank: { type: "integer", minimum: 1 },
                    playerId: playerIdParamsSchema.properties.playerId,
                    playerDisplayName: { type: "string", minLength: 1, maxLength: 128 },
                    mode: { type: "integer", enum: [150, 200] },
                    totalTimeMs: { type: "integer", minimum: 1 },
                    averageTimeMs: { type: "integer", minimum: 1 },
                    playedTracks: { type: "integer", minimum: 1, maximum: 96 },
                    goldMedals: { type: "integer", minimum: 0, maximum: 96 },
                    silverMedals: { type: "integer", minimum: 0, maximum: 96 },
                    bronzeMedals: { type: "integer", minimum: 0, maximum: 96 },
                  },
                },
              },
            },
          },
          400: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return {
          schemaVersion: "mk8dx.public-time-trial-standings.v1",
          standings: await service.listStandings(
            Number(request.query.mode), request.query.scope ?? "all",
          ),
        };
      } catch (error) {
        const mapped = failure(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );

  app.get<{
    Params: PlayerParams;
    Reply: { schemaVersion: string; results: readonly PublicTimeTrialResult[] } | ErrorResponse;
  }>(
    "/v1/public/players/:playerId/time-trials",
    {
      schema: {
        params: playerIdParamsSchema,
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["schemaVersion", "results"],
            properties: {
              schemaVersion: { const: "mk8dx.public-player-time-trials.v1" },
              results: { type: "array", maxItems: 100, items: resultSchema },
            },
          },
          400: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return {
          schemaVersion: "mk8dx.public-player-time-trials.v1",
          results: await service.listPlayerResults(request.params.playerId),
        };
      } catch (error) {
        const mapped = failure(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );

  app.get<{
    Reply: { schemaVersion: string; results: readonly PublicTimeTrialResult[] } | ErrorResponse;
  }>(
    "/v1/public/activity",
    {
      schema: {
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["schemaVersion", "results"],
            properties: {
              schemaVersion: { const: "mk8dx.public-activity.v1" },
              results: { type: "array", maxItems: 20, items: resultSchema },
            },
          },
          503: errorResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      try {
        return {
          schemaVersion: "mk8dx.public-activity.v1",
          results: await service.listRecentResults(),
        };
      } catch (error) {
        const mapped = failure(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );

  // One request for several players' bests. The Home page needs the
  // signed-in Player and every rival together; asking per player pushed
  // that wave past the five concurrent requests the hosting layer serves
  // without delay.
  app.get<{
    Querystring: Readonly<{ players?: string }>;
    Reply: { schemaVersion: string; players: readonly Readonly<{
      playerId: string;
      bests: readonly Readonly<{
        trackId: string; mode: 150 | 200; totalTimeMs: number; rank: number;
      }>[];
    }>[] } | ErrorResponse;
  }>(
    "/v1/public/track-bests",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["players"],
          properties: {
            players: { type: "string", minLength: 1, maxLength: 1_400 },
          },
        },
        response: {
          200: publicTrackBestsSchema,
          400: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const requested = (request.query.players ?? "")
          .split(",").map((value) => value.trim()).filter((v) => v.length > 0);
        const grouped = await service.listTrackBestsForPlayers(requested);
        return {
          schemaVersion: "mk8dx.public-track-bests.v1",
          players: [...grouped].map(([playerId, bests]) => (
            { playerId, bests }
          )),
        };
      } catch (error) {
        const mapped = failure(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );

  app.get<{
    Params: PlayerParams;
    Reply: { schemaVersion: string; bests: readonly Readonly<{
      trackId: string; mode: 150 | 200; totalTimeMs: number; rank: number;
    }>[] } | ErrorResponse;
  }>(
    "/v1/public/players/:playerId/track-bests",
    {
      schema: {
        params: playerIdParamsSchema,
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["schemaVersion", "bests"],
            properties: {
              schemaVersion: { const: "mk8dx.public-player-track-bests.v1" },
              bests: {
                type: "array",
                maxItems: 200,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["trackId", "mode", "totalTimeMs", "rank"],
                  properties: {
                    trackId: resultSchema.properties.trackId,
                    mode: { type: "integer", enum: [150, 200] },
                    totalTimeMs: { type: "integer", minimum: 1 },
                    rank: { type: "integer", minimum: 1 },
                  },
                },
              },
            },
          },
          400: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return {
          schemaVersion: "mk8dx.public-player-track-bests.v1",
          bests: await service.listPlayerTrackBests(request.params.playerId),
        };
      } catch (error) {
        const mapped = failure(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );

  app.get<{
    Querystring: LeaderboardQuery;
    Reply: { schemaVersion: string; results: readonly PublicTimeTrialResult[] } | ErrorResponse;
  }>(
    "/v1/public/time-trial-leaderboard",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["trackId", "mode"],
          properties: {
            trackId: resultSchema.properties.trackId,
            mode: { type: "string", enum: ["150", "200"] },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["schemaVersion", "results"],
            properties: {
              schemaVersion: { const: "mk8dx.public-time-trial-leaderboard.v1" },
              results: { type: "array", maxItems: 100, items: resultSchema },
            },
          },
          400: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return {
          schemaVersion: "mk8dx.public-time-trial-leaderboard.v1",
          results: await service.listLeaderboard(
            request.query.trackId,
            Number(request.query.mode),
          ),
        };
      } catch (error) {
        const mapped = failure(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );
}
