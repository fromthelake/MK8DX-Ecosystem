import type { FastifyInstance } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import {
  FINISH_POSITIONS,
  SHARED_RACES_MAX_PLAYERS,
  TournamentStandingError,
  type TournamentStandingService,
} from "./tournament-standing-service.js";

// Public, like the Time Trial boards and the rating leaderboard it sits next
// to: a Tournament standing is a fact about public Players, and somebody
// deciding whether to come along on a race night should be able to read it
// before they have an account.

const playerIdSchema = {
  type: "string", minLength: 8, maxLength: 135,
  pattern: "^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
} as const;

const standingSchema = {
  type: "object", additionalProperties: false,
  required: ["schemaVersion", "entries"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.tournament-standing.v1" },
    entries: {
      type: "array", maxItems: 200,
      items: {
        type: "object", additionalProperties: false,
        required: [
          "rank", "playerId", "username", "displayName", "tournaments", "races",
          "wins", "podiums", "points", "finishPositionTotal", "finishes",
        ],
        properties: {
          rank: { type: "integer", minimum: 1 },
          playerId: playerIdSchema,
          username: { type: "string", minLength: 1, maxLength: 64 },
          displayName: { type: "string", minLength: 1, maxLength: 128 },
          score: { type: "number" },
          tournaments: { type: "integer", minimum: 0 },
          races: { type: "integer", minimum: 0 },
          wins: { type: "integer", minimum: 0 },
          podiums: { type: "integer", minimum: 0 },
          points: { type: "integer", minimum: 0 },
          finishPositionTotal: { type: "integer", minimum: 0 },
          finishes: {
            type: "array",
            minItems: FINISH_POSITIONS, maxItems: FINISH_POSITIONS,
            items: { type: "integer", minimum: 0 },
          },
          lastRaceAtMs: { type: "integer", minimum: 0 },
        },
      },
    },
  },
} as const;

const rivalriesSchema = {
  type: "object", additionalProperties: false,
  required: ["schemaVersion", "playerId", "opponents"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.tournament-rivalries.v1" },
    playerId: playerIdSchema,
    opponents: {
      type: "array", maxItems: 50,
      items: {
        type: "object", additionalProperties: false,
        required: [
          "playerId", "username", "displayName", "sharedRaces", "ahead",
          "behind", "tied", "averagePointsDelta",
        ],
        properties: {
          playerId: playerIdSchema,
          username: { type: "string", minLength: 1, maxLength: 64 },
          displayName: { type: "string", minLength: 1, maxLength: 128 },
          sharedRaces: { type: "integer", minimum: 0 },
          ahead: { type: "integer", minimum: 0 },
          behind: { type: "integer", minimum: 0 },
          tied: { type: "integer", minimum: 0 },
          averagePointsDelta: { type: "number" },
        },
      },
    },
  },
} as const;

const sharedRacesSchema = {
  type: "object", additionalProperties: false,
  required: ["schemaVersion", "sharedRaces", "entries"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.tournament-shared-races.v1" },
    sharedRaces: { type: "integer", minimum: 0 },
    entries: {
      type: "array", maxItems: SHARED_RACES_MAX_PLAYERS,
      items: {
        type: "object", additionalProperties: false,
        required: [
          "playerId", "races", "wins", "podiums", "points",
          "finishPositionTotal", "finishes",
        ],
        properties: {
          playerId: playerIdSchema,
          races: { type: "integer", minimum: 0 },
          wins: { type: "integer", minimum: 0 },
          podiums: { type: "integer", minimum: 0 },
          points: { type: "integer", minimum: 0 },
          finishPositionTotal: { type: "integer", minimum: 0 },
          finishes: {
            type: "array",
            minItems: FINISH_POSITIONS, maxItems: FINISH_POSITIONS,
            items: { type: "integer", minimum: 0 },
          },
        },
      },
    },
  },
} as const;

export async function registerTournamentStandingRoutes(
  app: FastifyInstance,
  service: Pick<TournamentStandingService, "standing" | "rivalries" | "sharedRaces">,
): Promise<void> {
  app.get("/v1/public/tournament-standing", {
    schema: { response: { 200: standingSchema, 503: errorResponseSchema } },
  }, async (_request, reply) => {
    try {
      const standing = await service.standing();
      void reply.header("cache-control", "no-store");
      return reply.send({
        schemaVersion: "mk8dx.tournament-standing.v1",
        entries: standing.entries,
      });
    } catch {
      return reply.code(503).send({
        code: "tournament_standing_unavailable",
        message: "The Tournament standing is temporarily unavailable.",
      });
    }
  });

  app.get<{ Params: Readonly<{ playerId: string }> }>(
    "/v1/public/players/:playerId/tournament-rivalries",
    {
      schema: {
        params: {
          type: "object", additionalProperties: false, required: ["playerId"],
          properties: { playerId: playerIdSchema },
        },
        response: {
          200: rivalriesSchema,
          400: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const opponents = await service.rivalries(request.params.playerId);
        void reply.header("cache-control", "no-store");
        return reply.send({
          schemaVersion: "mk8dx.tournament-rivalries.v1",
          playerId: request.params.playerId,
          opponents,
        });
      } catch (error) {
        if (error instanceof TournamentStandingError &&
          error.code === "invalid_input") {
          return reply.code(400).send({
            code: "invalid_tournament_rivalry_query",
            message: "The Player query is invalid.",
          });
        }
        return reply.code(503).send({
          code: "tournament_standing_unavailable",
          message: "The Tournament standing is temporarily unavailable.",
        });
      }
    },
  );

  // A comparison counted over only the races every compared Player finished:
  // `?players=player.bas,player.matthijs[,player.volkert]`, main Player first.
  app.get<{ Querystring: Readonly<{ players: string }> }>(
    "/v1/public/tournament-shared-races",
    {
      schema: {
        querystring: {
          type: "object", additionalProperties: false, required: ["players"],
          properties: {
            players: { type: "string", minLength: 8, maxLength: 410 },
          },
        },
        response: {
          200: sharedRacesSchema,
          400: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const shared = await service.sharedRaces(request.query.players.split(","));
        void reply.header("cache-control", "no-store");
        return reply.send({
          schemaVersion: "mk8dx.tournament-shared-races.v1",
          sharedRaces: shared.sharedRaces,
          entries: shared.entries,
        });
      } catch (error) {
        if (error instanceof TournamentStandingError &&
          error.code === "invalid_input") {
          return reply.code(400).send({
            code: "invalid_tournament_shared_races_query",
            message: "Name two or three different Players.",
          });
        }
        return reply.code(503).send({
          code: "tournament_standing_unavailable",
          message: "The Tournament standing is temporarily unavailable.",
        });
      }
    },
  );
}
