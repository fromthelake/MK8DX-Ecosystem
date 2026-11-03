import type { FastifyInstance } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorResolver } from "../identity/types.js";
import type { TimeTrialWebCsrfVerifier } from
  "../timetrials/submission-routes.js";
import type { ActivityStoryService } from "./activity-story-service.js";
import {
  HomeComebackError,
  RivalPreferenceError,
  type FollowPreferenceService,
  type HomeComebackService,
  type RivalPreferenceService,
} from "./home-comeback-service.js";
import { HomeFocusError, type HomeFocusService } from
  "./home-focus-service.js";

type ErrorResponse = Readonly<{ code: string; message: string }>;

export type HomeRouteOptions = Readonly<{
  resolveActor: ActorResolver;
  comeback: Pick<HomeComebackService, "loadMine">;
  rivals: Pick<RivalPreferenceService, "listMine" | "add" | "remove">;
  follows: Pick<FollowPreferenceService, "listMine" | "add" | "remove">;
  focus: Pick<HomeFocusService, "loadMine">;
  stories: Pick<ActivityStoryService, "listStories">;
  csrfVerifier?: TimeTrialWebCsrfVerifier;
}>;

const playerIdPattern = "^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$";
const avatarIdPattern = "^character(_variant)?\\.[a-z0-9_.]+$";

const rivalEntrySchema = {
  type: "object",
  additionalProperties: false,
  required: ["playerId", "displayName"],
  properties: {
    playerId: { type: "string", pattern: playerIdPattern },
    displayName: { type: "string", minLength: 1, maxLength: 128 },
    avatarId: { type: "string", pattern: avatarIdPattern },
  },
} as const;

const comparisonProperties = {
  tracksAhead: { type: "integer", minimum: 0 },
  tracksBehind: { type: "integer", minimum: 0 },
  sharedCombos: { type: "integer", minimum: 0 },
  totalDeltaMs: { type: "integer" },
} as const;

export const comebackResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "player", "timeTrials", "rivals"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.home-comeback.v1" },
    player: rivalEntrySchema,
    tournament: {
      type: "object",
      additionalProperties: false,
      required: ["rank", "of", "score"],
      properties: {
        rank: { type: "integer", minimum: 1 },
        of: { type: "integer", minimum: 0 },
        score: { type: "number" },
      },
    },
    timeTrials: {
      type: "object",
      additionalProperties: false,
      required: ["standing", "of", "totalMs"],
      properties: {
        standing: { type: "integer", minimum: 0 },
        of: { type: "integer", minimum: 0 },
        totalMs: { type: "integer", minimum: 0 },
        previousStanding: { type: "integer", minimum: 0 },
      },
    },
    rivals: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "playerId", "displayName", "tracksAhead", "tracksBehind",
          "sharedCombos", "totalDeltaMs",
        ],
        properties: {
          playerId: { type: "string", pattern: playerIdPattern },
          displayName: { type: "string", minLength: 1, maxLength: 128 },
          avatarId: { type: "string", pattern: avatarIdPattern },
          ...comparisonProperties,
          previous: {
            type: "object",
            additionalProperties: false,
            required: [
              "tracksAhead", "tracksBehind", "sharedCombos", "totalDeltaMs",
            ],
            properties: comparisonProperties,
          },
        },
      },
    },
    reactions: {
      type: "object",
      additionalProperties: false,
      required: ["count", "resultCount", "kinds"],
      properties: {
        count: { type: "integer", minimum: 1 },
        resultCount: { type: "integer", minimum: 1 },
        kinds: {
          type: "array",
          maxItems: 3,
          items: { type: "string", pattern: "^[a-z_]+$" },
        },
      },
    },
    sinceMs: { type: "integer", minimum: 0 },
  },
} as const;

export const rivalsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "rivals"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.player-rivals.v1" },
    rivals: { type: "array", maxItems: 10, items: rivalEntrySchema },
  },
} as const;

const rivalBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["rivalPlayerId"],
  properties: {
    rivalPlayerId: {
      type: "string",
      maxLength: 135,
      pattern: playerIdPattern,
    },
  },
} as const;

const acknowledgedSchema = {
  type: "object",
  additionalProperties: false,
  required: ["acknowledged"],
  properties: { acknowledged: { type: "boolean", const: true } },
} as const;

export const followsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "follows"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.player-follows.v1" },
    follows: { type: "array", maxItems: 25, items: rivalEntrySchema },
  },
} as const;

const followBodySchema = {
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
} as const;

const trackIdPattern = "^track\\.[a-z0-9]+(?:_[a-z0-9]+)*$";

export const focusResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "modePreference", "trackAccess", "rows"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.home-focus.v1" },
    modePreference: { type: "string", enum: ["all", "150", "200"] },
    trackAccess: { type: "string", enum: ["unknown", "base_only", "base_and_bcp"] },
    rows: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "trackId", "mode", "myBestMs", "myRank", "humanCount",
          "leaderBestMs",
        ],
        properties: {
          trackId: { type: "string", pattern: trackIdPattern },
          mode: { type: "integer", enum: [150, 200] },
          myBestMs: { type: "integer", minimum: 1 },
          myRank: { type: "integer", minimum: 1 },
          humanCount: { type: "integer", minimum: 1 },
          leaderBestMs: { type: "integer", minimum: 1 },
          above: {
            type: "object",
            additionalProperties: false,
            required: ["playerId", "displayName", "bestMs", "rank"],
            properties: {
              playerId: { type: "string", pattern: playerIdPattern },
              displayName: { type: "string", minLength: 1, maxLength: 128 },
              bestMs: { type: "integer", minimum: 1 },
              rank: { type: "integer", minimum: 1 },
            },
          },
        },
      },
    },
  },
} as const;

export const storiesResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "stories"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.activity-stories.v1" },
    stories: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "player", "trackId", "mode", "runs", "startMs", "bestMs",
          "personalBest", "latestAtMs", "runDetails",
        ],
        properties: {
          player: {
            type: "object",
            additionalProperties: false,
            required: ["playerId", "displayName"],
            properties: {
              playerId: { type: "string", pattern: playerIdPattern },
              displayName: { type: "string", minLength: 1, maxLength: 128 },
              countryId: { type: "string", maxLength: 64 },
              avatarId: { type: "string", pattern: avatarIdPattern },
            },
          },
          trackId: { type: "string", pattern: trackIdPattern },
          mode: { type: "integer", enum: [150, 200] },
          runs: { type: "integer", minimum: 1 },
          startMs: { type: "integer", minimum: 1 },
          bestMs: { type: "integer", minimum: 1 },
          improvedMs: { type: "integer", minimum: 1 },
          personalBest: { type: "boolean" },
          personalBestDeltaMs: { type: "integer", minimum: 1 },
          playerDeltaMs: { type: "integer" },
          runRank: { type: "integer", minimum: 1 },
          rank: {
            type: "object",
            additionalProperties: false,
            required: ["after", "passed", "passedCount"],
            properties: {
              after: { type: "integer", minimum: 1 },
              before: { type: "integer", minimum: 1 },
              passed: {
                type: "array",
                maxItems: 3,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["playerId", "displayName"],
                  properties: {
                    playerId: { type: "string", pattern: playerIdPattern },
                    displayName: {
                      type: "string", minLength: 1, maxLength: 128,
                    },
                  },
                },
              },
              passedCount: { type: "integer", minimum: 0 },
            },
          },
          latestAtMs: { type: "integer", minimum: 0 },
          reactions: {
            type: "object",
            additionalProperties: false,
            required: ["count", "kinds"],
            properties: {
              count: { type: "integer", minimum: 1 },
              kinds: {
                type: "array",
                maxItems: 3,
                items: { type: "string", pattern: "^[a-z_]+$" },
              },
            },
          },
          viewerOvertake: {
            type: "object",
            additionalProperties: false,
            required: [
              "notificationId", "actorTimeMs", "recipientTimeMs",
              "deltaMs", "recipientRank",
            ],
            properties: {
              notificationId: { type: "string", pattern: "^[0-9]{1,19}$" },
              actorTimeMs: { type: "integer", minimum: 1, maximum: 599999 },
              recipientTimeMs: { type: "integer", minimum: 1, maximum: 599999 },
              deltaMs: { type: "integer", minimum: -599998, maximum: -1 },
              recipientRank: { type: "integer", minimum: 1 },
            },
          },
          runDetails: {
            type: "array",
            maxItems: 20,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["resultId", "timeMs", "atMs", "sourceKind"],
              properties: {
                resultId: { type: "string", maxLength: 160 },
                timeMs: { type: "integer", minimum: 1 },
                atMs: { type: "integer", minimum: 0 },
                sourceKind: {
                  type: "string", minLength: 1, maxLength: 48,
                },
                correctedFields: {
                  type: "array",
                  minItems: 1,
                  maxItems: 15,
                  uniqueItems: true,
                  items: {
                    type: "string", pattern: "^[A-Za-z][A-Za-z0-9]{0,31}$",
                  },
                },
                laps: {
                  type: "array",
                  maxItems: 7,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["lapNumber", "timeMs"],
                    properties: {
                      lapNumber: { type: "integer", minimum: 1, maximum: 7 },
                      timeMs: { type: "integer", minimum: 1 },
                      coinsCollected: {
                        type: "integer", minimum: 0, maximum: 10,
                      },
                      mushroomsUsed: {
                        type: "integer", minimum: 0, maximum: 3,
                      },
                    },
                  },
                },
                loadout: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    characterId: { type: "string", maxLength: 255 },
                    characterVariantId: { type: "string", maxLength: 255 },
                    bodyId: { type: "string", maxLength: 255 },
                    bodyVariantId: { type: "string", maxLength: 255 },
                    tireId: { type: "string", maxLength: 255 },
                    gliderId: { type: "string", maxLength: 255 },
                    gliderVariantId: { type: "string", maxLength: 255 },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

function comebackErrorReply(error: unknown): Readonly<{
  status: number;
  body: ErrorResponse;
}> {
  if (error instanceof HomeComebackError) {
    if (error.code === "not_authenticated") {
      return {
        status: 401,
        body: {
          code: "not_authenticated",
          message: "Sign in to load your Home overview.",
        },
      };
    }
    if (error.code === "no_player") {
      return {
        status: 409,
        body: {
          code: "no_verified_player",
          message: "A verified Player claim is required first.",
        },
      };
    }
  }
  return {
    status: 503,
    body: {
      code: "home_unavailable",
      message: "The Home overview is temporarily unavailable.",
    },
  };
}

function rivalErrorReply(error: unknown): Readonly<{
  status: number;
  body: ErrorResponse;
}> {
  if (error instanceof RivalPreferenceError) {
    switch (error.code) {
      case "invalid_input":
        return {
          status: 400,
          body: {
            code: "rival_invalid",
            message: "That rival selection is not valid.",
          },
        };
      case "not_authenticated":
        return {
          status: 401,
          body: {
            code: "not_authenticated",
            message: "Sign in to manage your rivals.",
          },
        };
      case "not_found":
        return {
          status: 404,
          body: {
            code: "rival_not_found",
            message: "That Player was not found (or is your own Player).",
          },
        };
      case "unavailable":
        break;
    }
  }
  return {
    status: 503,
    body: {
      code: "rivals_unavailable",
      message: "Rival preferences are temporarily unavailable.",
    },
  };
}

export async function registerHomeRoutes(
  app: FastifyInstance,
  options: HomeRouteOptions,
): Promise<void> {
  app.get<{ Reply: unknown }>(
    "/v1/home/comeback",
    {
      schema: {
        response: {
          200: comebackResponseSchema,
          401: errorResponseSchema,
          409: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        const comeback = await options.comeback.loadMine(actor);
        return reply.send({
          schemaVersion: "mk8dx.home-comeback.v1",
          ...comeback,
        });
      } catch (error) {
        const { status, body } = comebackErrorReply(error);
        return reply.code(status).send(body);
      }
    },
  );

  app.get<{ Reply: unknown }>(
    "/v1/account/rivals",
    {
      schema: {
        response: {
          200: rivalsResponseSchema,
          401: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        const rivals = await options.rivals.listMine(actor);
        return reply.send({
          schemaVersion: "mk8dx.player-rivals.v1",
          rivals,
        });
      } catch (error) {
        const { status, body } = rivalErrorReply(error);
        return reply.code(status).send(body);
      }
    },
  );

  const verifiedActor = async (request: Parameters<ActorResolver>[0]):
    Promise<ReturnType<ActorResolver>> => {
    const actor = await options.resolveActor(request);
    const proof = request.headers["x-mk8dx-csrf"];
    if (options.csrfVerifier !== undefined &&
        (typeof proof !== "string" ||
         !await options.csrfVerifier.verify(actor, proof))) {
      throw new RivalPreferenceError("not_authenticated");
    }
    return actor;
  };

  app.put<{ Body: Readonly<{ rivalPlayerId: string }> }>(
    "/v1/account/rivals",
    {
      schema: {
        body: rivalBodySchema,
        response: {
          200: acknowledgedSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await verifiedActor(request);
        await options.rivals.add(actor, request.body.rivalPlayerId);
        return reply.send({ acknowledged: true });
      } catch (error) {
        const { status, body } = rivalErrorReply(error);
        return reply.code(status).send(body);
      }
    },
  );

  app.delete<{ Body: Readonly<{ rivalPlayerId: string }> }>(
    "/v1/account/rivals",
    {
      schema: {
        body: rivalBodySchema,
        response: {
          200: acknowledgedSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await verifiedActor(request);
        await options.rivals.remove(actor, request.body.rivalPlayerId);
        return reply.send({ acknowledged: true });
      } catch (error) {
        const { status, body } = rivalErrorReply(error);
        return reply.code(status).send(body);
      }
    },
  );

  // FOLLOW preference: the second private Player list. Same contract as
  // rivals - private, bounded, no notification to the followed Player.
  app.get<{ Reply: unknown }>(
    "/v1/account/follows",
    {
      schema: {
        response: {
          200: followsResponseSchema,
          401: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        const follows = await options.follows.listMine(actor);
        return reply.send({
          schemaVersion: "mk8dx.player-follows.v1",
          follows,
        });
      } catch (error) {
        const { status, body } = rivalErrorReply(error);
        return reply.code(status).send(body);
      }
    },
  );

  app.put<{ Body: Readonly<{ playerId: string }> }>(
    "/v1/account/follows",
    {
      schema: {
        body: followBodySchema,
        response: {
          200: acknowledgedSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await verifiedActor(request);
        await options.follows.add(actor, request.body.playerId);
        return reply.send({ acknowledged: true });
      } catch (error) {
        const { status, body } = rivalErrorReply(error);
        return reply.code(status).send(body);
      }
    },
  );

  app.delete<{ Body: Readonly<{ playerId: string }> }>(
    "/v1/account/follows",
    {
      schema: {
        body: followBodySchema,
        response: {
          200: acknowledgedSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await verifiedActor(request);
        await options.follows.remove(actor, request.body.playerId);
        return reply.send({ acknowledged: true });
      } catch (error) {
        const { status, body } = rivalErrorReply(error);
        return reply.code(status).send(body);
      }
    },
  );

  // GLOBAL focus context for the signed-in Player: per driven combo the
  // human rank, count, leader, and the next human position above.
  app.get<{ Reply: unknown }>(
    "/v1/home/focus",
    {
      schema: {
        response: {
          200: focusResponseSchema,
          401: errorResponseSchema,
          409: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        const focus = await options.focus.loadMine(actor);
        return reply.send({ schemaVersion: "mk8dx.home-focus.v1", ...focus });
      } catch (error) {
        if (error instanceof HomeFocusError) {
          if (error.code === "not_authenticated") {
            return reply.code(401).send({
              code: "not_authenticated",
              message: "Sign in to load your focus context.",
            });
          }
          if (error.code === "no_player") {
            return reply.code(409).send({
              code: "no_verified_player",
              message: "A verified Player claim is required first.",
            });
          }
        }
        return reply.code(503).send({
          code: "focus_unavailable",
          message: "The focus context is temporarily unavailable.",
        });
      }
    },
  );

  // Community activity stories: public, clustered server-side. Never
  // probes the session.
  app.get<{ Reply: unknown }>(
    "/v1/public/activity-stories",
    {
      schema: {
        response: {
          200: storiesResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      try {
        const stories = await options.stories.listStories();
        return reply.send({
          schemaVersion: "mk8dx.activity-stories.v1",
          stories,
        });
      } catch {
        return reply.code(503).send({
          code: "stories_unavailable",
          message: "Community activity is temporarily unavailable.",
        });
      }
    },
  );
}
