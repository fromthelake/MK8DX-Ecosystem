import type { FastifyInstance } from "fastify";

import { RATING_SCORE_MULTIPLIER } from "./trueskill-engine.js";
import type { MysqlPublicRatingRepository } from "./mysql-rating-repository.js";

// Public rating projection: rank, Player identity, and the conservative
// score only — mu/sigma stay non-public, matching the recovered legacy
// product surface (the public legacy site never exposed them).

const errorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "message"],
  properties: { code: { type: "string" }, message: { type: "string" } },
} as const;

export const leaderboardResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "entries"],
  properties: {
    schemaVersion: {
      type: "string",
      const: "mk8dx.public-rating-leaderboard.v1",
    },
    entries: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rank", "playerId", "username", "displayName", "score"],
        properties: {
          rank: { type: "integer", minimum: 1 },
          playerId: { type: "string" },
          username: { type: "string" },
          displayName: { type: "string" },
          score: { type: "number" },
          // False until the Player's first rated race; clients then show the position without a tier.
          played: { type: "boolean" },
        },
      },
    },
  },
} as const;

const playerIdPattern = "^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$";

export const ratingHistoryResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "points"],
  properties: {
    schemaVersion: {
      type: "string",
      const: "mk8dx.public-rating-history.v1",
    },
    points: {
      type: "array",
      maxItems: 2000,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "sequence", "tournamentNumber", "sectionLabel", "raceIndex",
          "finishPosition", "score",
        ],
        properties: {
          sequence: { type: "integer", minimum: 1 },
          tournamentNumber: { type: "integer", minimum: 1 },
          sectionLabel: { type: "string", minLength: 1, maxLength: 96 },
          raceIndex: { type: "integer", minimum: 1 },
          finishPosition: { type: "integer", minimum: 1, maximum: 12 },
          score: { type: "number" },
          mu: { type: "number" },
          sigma: { type: "number" },
        },
      },
    },
  },
} as const;

export const opponentsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "opponents"],
  properties: {
    schemaVersion: {
      type: "string",
      const: "mk8dx.public-tournament-opponents.v1",
    },
    opponents: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "playerId", "displayName", "sharedRaces", "aheadOfMe", "meAhead",
        ],
        properties: {
          playerId: { type: "string" },
          displayName: { type: "string", minLength: 1, maxLength: 128 },
          sharedRaces: { type: "integer", minimum: 1 },
          aheadOfMe: { type: "integer", minimum: 0 },
          meAhead: { type: "integer", minimum: 0 },
        },
      },
    },
  },
} as const;

export const tournamentStandingsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "sections"],
  properties: {
    schemaVersion: {
      type: "string",
      const: "mk8dx.public-tournament-standings.v1",
    },
    sections: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tournamentNumber", "sectionLabel", "standings"],
        properties: {
          tournamentNumber: { type: "integer", minimum: 1 },
          sectionLabel: { type: "string", minLength: 1, maxLength: 96 },
          standings: {
            type: "array",
            maxItems: 12,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["playerId", "displayName", "points", "races"],
              properties: {
                playerId: { type: "string" },
                displayName: {
                  type: "string", minLength: 1, maxLength: 128,
                },
                points: { type: "integer", minimum: 0 },
                races: { type: "integer", minimum: 1 },
                characterId: { type: "string", minLength: 1, maxLength: 255 },
                characterVariantId: { type: "string", minLength: 1, maxLength: 255 },
              },
            },
          },
        },
      },
    },
  },
} as const;

const headToHeadResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion", "sharedRaces", "aAhead", "bAhead",
    "averageFinishA", "averageFinishB", "byTournament",
  ],
  properties: {
    schemaVersion: {
      type: "string",
      const: "mk8dx.public-head-to-head.v1",
    },
    sharedRaces: { type: "integer", minimum: 0 },
    aAhead: { type: "integer", minimum: 0 },
    bAhead: { type: "integer", minimum: 0 },
    averageFinishA: { type: "number" },
    averageFinishB: { type: "number" },
    byTournament: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tournamentNumber", "sharedRaces", "aAhead", "bAhead"],
        properties: {
          tournamentNumber: { type: "integer", minimum: 1 },
          sharedRaces: { type: "integer", minimum: 1 },
          aAhead: { type: "integer", minimum: 0 },
          bAhead: { type: "integer", minimum: 0 },
        },
      },
    },
  },
} as const;

export type PublicRatingRouteOptions = Readonly<{
  repository: Pick<MysqlPublicRatingRepository, "listRatings">;
  history?: Readonly<{
    listRatingHistory(playerId: string): Promise<readonly unknown[]>;
    listOpponents(playerId: string): Promise<readonly unknown[]>;
    listTournamentStandings(): Promise<readonly unknown[]>;
    headToHead(playerAId: string, playerBId: string): Promise<unknown>;
  }>;
}>;

// The rank and the display score are derived here so every caller that
// serves this document - the route and the page bootstrap - derives them
// the same way.
export function ratingLeaderboardDocument(
  ratings: readonly Readonly<{
    playerId: string;
    username: string;
    displayName: string;
    mu: number;
    sigma: number;
    played?: boolean;
  }>[],
): Readonly<{ schemaVersion: string; entries: readonly unknown[] }> {
  return {
    schemaVersion: "mk8dx.public-rating-leaderboard.v1",
    entries: ratings.map((entry, index) => ({
      rank: index + 1,
      playerId: entry.playerId,
      username: entry.username,
      displayName: entry.displayName,
      score: entry.mu - RATING_SCORE_MULTIPLIER * entry.sigma,
      ...(entry.played === undefined ? {} : { played: entry.played }),
    })),
  };
}

export async function registerPublicRatingRoutes(
  app: FastifyInstance,
  options: PublicRatingRouteOptions,
): Promise<void> {
  app.get(
    "/v1/public/rating-leaderboard",
    {
      schema: {
        response: { 200: leaderboardResponseSchema, 503: errorResponseSchema },
      },
    },
    async (_request, reply) => {
      try {
        const ratings = await options.repository.listRatings(200);
        return ratingLeaderboardDocument(ratings);
      } catch {
        return reply.code(503).send({
          code: "rating_leaderboard_unavailable",
          message: "The rating leaderboard is temporarily unavailable.",
        });
      }
    },
  );

  if (options.history === undefined) { return; }
  const history = options.history;

  // Per-race TrueSkill trajectory (legacy TN4..TN12 history): display
  // scores only, in the canonical replay order.
  app.get<{ Params: Readonly<{ playerId: string }> }>(
    "/v1/public/players/:playerId/rating-history",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["playerId"],
          properties: {
            playerId: {
              type: "string",
              maxLength: 135,
              pattern: playerIdPattern,
            },
          },
        },
        response: {
          200: ratingHistoryResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const points = await history.listRatingHistory(
          request.params.playerId);
        return reply.send({
          schemaVersion: "mk8dx.public-rating-history.v1",
          points,
        });
      } catch {
        return reply.code(503).send({
          code: "rating_history_unavailable",
          message: "The rating history is temporarily unavailable.",
        });
      }
    },
  );

  app.get<{ Params: Readonly<{ playerId: string }> }>(
    "/v1/public/players/:playerId/tournament-opponents",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["playerId"],
          properties: {
            playerId: {
              type: "string",
              maxLength: 135,
              pattern: playerIdPattern,
            },
          },
        },
        response: {
          200: opponentsResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const opponents = await history.listOpponents(
          request.params.playerId);
        return reply.send({
          schemaVersion: "mk8dx.public-tournament-opponents.v1",
          opponents,
        });
      } catch {
        return reply.code(503).send({
          code: "opponents_unavailable",
          message: "Tournament opponents are temporarily unavailable.",
        });
      }
    },
  );

  // Derived tournament section standings (official 15..1 scoring over
  // the imported finish positions; owner-validated).
  app.get(
    "/v1/public/tournament-standings",
    {
      schema: {
        response: {
          200: tournamentStandingsResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      try {
        const sections = await history.listTournamentStandings();
        return reply.send({
          schemaVersion: "mk8dx.public-tournament-standings.v1",
          sections,
        });
      } catch {
        return reply.code(503).send({
          code: "tournament_standings_unavailable",
          message: "Tournament standings are temporarily unavailable.",
        });
      }
    },
  );

  app.get<{ Querystring: Readonly<{ playerA: string; playerB: string }> }>(
    "/v1/public/head-to-head",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["playerA", "playerB"],
          properties: {
            playerA: {
              type: "string",
              maxLength: 135,
              pattern: playerIdPattern,
            },
            playerB: {
              type: "string",
              maxLength: 135,
              pattern: playerIdPattern,
            },
          },
        },
        response: {
          200: headToHeadResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const summary = await history.headToHead(
          request.query.playerA, request.query.playerB);
        return reply.send({
          schemaVersion: "mk8dx.public-head-to-head.v1",
          ...(summary as Record<string, unknown>),
        });
      } catch {
        return reply.code(503).send({
          code: "head_to_head_unavailable",
          message: "Head-to-head statistics are temporarily unavailable.",
        });
      }
    },
  );
}
