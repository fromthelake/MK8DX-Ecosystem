import type { FastifyInstance } from "fastify";

import type { ActorResolver } from "../identity/types.js";
import {
  PlayerActivityError,
  type PlayerActivityDocument,
  type PlayerActivityService,
} from "./player-activity-service.js";

const errorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "message"],
  properties: {
    code: { type: "string" },
    message: { type: "string" },
  },
} as const;

const activitySchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "player", "timeTrials", "tournamentRaces"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.player-activity.v1" },
    player: {
      type: "object",
      additionalProperties: false,
      required: ["playerId", "username", "displayName"],
      properties: {
        playerId: { type: "string", pattern: "^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$" },
        username: { type: "string", minLength: 1, maxLength: 64 },
        displayName: { type: "string", minLength: 1, maxLength: 128 },
      },
    },
    timeTrials: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["submissionId", "revision", "trackId", "modeCC", "totalTimeMs", "sourceKind", "occurredAtMs", "createdAtMs"],
        properties: {
          submissionId: { type: "string", pattern: "^user_submission\\.time\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$" },
          revision: { type: "integer", minimum: 1 },
          trackId: { type: "string", pattern: "^track\\.[a-z0-9]+(?:_[a-z0-9]+)*$" },
          modeCC: { type: "integer", enum: [150, 200] },
          totalTimeMs: { type: "integer", minimum: 1, maximum: 599999 },
          sourceKind: { type: "string", minLength: 1, maxLength: 32 },
          occurredAtMs: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
          createdAtMs: { type: "integer", minimum: 0 },
        },
      },
    },
    tournamentRaces: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["raceResultId", "revision", "raceNumber", "trackId", "modeCC", "countsTowardStandings", "finishPosition", "racePoints", "totalAfterRace", "rankAfterRace", "sourceKind", "occurredAtMs", "createdAtMs"],
        properties: {
          raceResultId: { type: "string", pattern: "^tournament_race_result\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$" },
          revision: { type: "integer", minimum: 1 },
          raceNumber: { type: "integer", minimum: 1 },
          trackId: { type: "string", pattern: "^track\\.[a-z0-9]+(?:_[a-z0-9]+)*$" },
          modeCC: { anyOf: [{ type: "integer", enum: [50, 100, 150, 200] }, { type: "null" }] },
          mirror: { type: "boolean", const: true },
          countsTowardStandings: { type: "boolean" },
          finishPosition: { type: "integer", minimum: 1, maximum: 12 },
          racePoints: { type: "integer", minimum: 0 },
          totalAfterRace: { type: "integer", minimum: 0 },
          rankAfterRace: { type: "integer", minimum: 1, maximum: 12 },
          sourceKind: { type: "string", minLength: 1, maxLength: 48 },
          occurredAtMs: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
          createdAtMs: { type: "integer", minimum: 0 },
        },
      },
    },
  },
} as const;

type ErrorResponse = Readonly<{ code: string; message: string }>;

export async function registerPlayerActivityRoutes(
  app: FastifyInstance,
  options: Readonly<{
    resolveActor: ActorResolver;
    service: Pick<PlayerActivityService, "loadMine">;
  }>,
): Promise<void> {
  app.get<{ Reply: PlayerActivityDocument | ErrorResponse }>(
    "/v1/me/player-activity",
    {
      schema: {
        response: {
          200: activitySchema,
          401: errorSchema,
          403: errorSchema,
          503: errorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await options.service.loadMine(await options.resolveActor(request));
      } catch (error) {
        const code = error instanceof PlayerActivityError
          ? error.code
          : "unavailable";
        if (code === "not_authenticated") {
          return reply.code(401).send({
            code: "player_activity_not_authenticated",
            message: "Sign in to view your Player activity.",
          });
        }
        if (code === "not_authorized") {
          return reply.code(403).send({
            code: "verified_player_claim_required",
            message: "A verified Player claim is required.",
          });
        }
        return reply.code(503).send({
          code: "player_activity_unavailable",
          message: "Player activity is temporarily unavailable.",
        });
      }
    },
  );
}
