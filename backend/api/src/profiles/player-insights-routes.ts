import type { FastifyInstance } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorResolver } from "../identity/types.js";
import {
  PlayerInsightsError,
  type PlayerInsightsDocument,
  type PlayerInsightsService,
} from "./player-insights-service.js";

const nonnegative = { type: "integer", minimum: 0 } as const;
const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "playerId", "timeTrials", "tournaments"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.player-insights.v1" },
    playerId: { type: "string", pattern: "^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$" },
    timeTrials: {
      type: "object",
      additionalProperties: false,
      required: ["submissionCount", "personalBests"],
      properties: {
        submissionCount: nonnegative,
        personalBests: {
          type: "array",
          maxItems: 192,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["trackId", "modeCC", "bestTimeMs", "attemptCount"],
            properties: {
              trackId: { type: "string", pattern: "^track\\.[a-z0-9]+(?:_[a-z0-9]+)*$" },
              modeCC: { type: "integer", enum: [150, 200] },
              bestTimeMs: { type: "integer", minimum: 1, maximum: 599999 },
              attemptCount: { type: "integer", minimum: 1 },
            },
          },
        },
      },
    },
    tournaments: {
      type: "object",
      additionalProperties: false,
      required: ["raceCount", "countedRaceCount", "wins", "podiums", "countedPoints", "countedFinishPositionTotal"],
      properties: {
        raceCount: nonnegative,
        countedRaceCount: nonnegative,
        wins: nonnegative,
        podiums: nonnegative,
        countedPoints: nonnegative,
        countedFinishPositionTotal: nonnegative,
      },
    },
  },
} as const;

type ErrorResponse = Readonly<{ code: string; message: string }>;

export async function registerPlayerInsightsRoutes(
  app: FastifyInstance,
  options: Readonly<{
    resolveActor: ActorResolver;
    service: Pick<PlayerInsightsService, "loadMine">;
  }>,
): Promise<void> {
  app.get<{ Reply: PlayerInsightsDocument | ErrorResponse }>(
    "/v1/me/player-insights",
    {
      schema: {
        response: {
          200: responseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await options.service.loadMine(await options.resolveActor(request));
      } catch (error) {
        const code = error instanceof PlayerInsightsError
          ? error.code
          : "unavailable";
        if (code === "not_authenticated") {
          return reply.code(401).send({
            code: "player_insights_not_authenticated",
            message: "Sign in to view Player insights.",
          });
        }
        if (code === "not_authorized") {
          return reply.code(403).send({
            code: "verified_player_claim_required",
            message: "A verified Player claim is required.",
          });
        }
        return reply.code(503).send({
          code: "player_insights_unavailable",
          message: "Player insights are temporarily unavailable.",
        });
      }
    },
  );
}
