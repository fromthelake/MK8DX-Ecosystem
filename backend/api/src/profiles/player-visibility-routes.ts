import type { FastifyInstance } from "fastify";

import { errorResponseSchema, playerIdParamsSchema } from
  "../identity/schemas.js";
import type { ActorResolver } from "../identity/types.js";
import type { TimeTrialWebCsrfVerifier } from
  "../timetrials/submission-routes.js";
import {
  PlayerVisibilityError,
  type PlayerVisibilityService,
  type PlayerVisibilityState,
} from "./player-visibility-service.js";

type ErrorResponse = Readonly<{ code: string; message: string }>;

export type PlayerVisibilityRouteOptions = Readonly<{
  resolveActor: ActorResolver;
  service: Pick<PlayerVisibilityService, "readOwn" | "setOwn" | "setForPlayer">;
  csrfVerifier?: TimeTrialWebCsrfVerifier;
}>;

const stateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "playerId", "username", "displayName",
    "visibility"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.player-visibility.v1" },
    playerId: playerIdParamsSchema.properties.playerId,
    username: { type: "string", minLength: 1, maxLength: 64 },
    displayName: { type: "string", minLength: 1, maxLength: 128 },
    visibility: { type: "string", enum: ["public", "private"] },
  },
} as const;

const ownBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["visibility"],
  properties: { visibility: { type: "string", enum: ["public", "private"] } },
} as const;

const administratorBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["visibility", "reasonCode"],
  properties: {
    visibility: { type: "string", enum: ["public", "private"] },
    reasonCode: {
      type: "string", minLength: 1, maxLength: 64,
      pattern: "^[a-z0-9]+(?:[._-][a-z0-9]+)*$",
    },
  },
} as const;

function document(state: PlayerVisibilityState): Readonly<{
  schemaVersion: "mk8dx.player-visibility.v1";
} & PlayerVisibilityState> {
  return { schemaVersion: "mk8dx.player-visibility.v1", ...state };
}

function errorReply(error: unknown): Readonly<{
  status: number;
  body: ErrorResponse;
}> {
  if (error instanceof PlayerVisibilityError) {
    switch (error.code) {
      case "invalid_input":
        return {
          status: 400,
          body: {
            code: "visibility_invalid",
            message: "That Player visibility is not supported.",
          },
        };
      case "not_authenticated":
        return {
          status: 401,
          body: {
            code: "not_authenticated",
            message: "Sign in to change Player visibility.",
          },
        };
      case "forbidden":
        return {
          status: 403,
          body: {
            code: "visibility_forbidden",
            message: "Only an administrator may change another Player.",
          },
        };
      case "no_verified_player":
        return {
          status: 409,
          body: {
            code: "no_verified_player",
            message: "A verified Player claim is required first.",
          },
        };
      case "player_not_found":
        return {
          status: 404,
          body: {
            code: "player_not_found",
            message: "That Player was not found.",
          },
        };
      case "unavailable":
        break;
    }
  }
  return {
    status: 503,
    body: {
      code: "visibility_unavailable",
      message: "Player visibility could not be read or changed.",
    },
  };
}

export async function registerPlayerVisibilityRoutes(
  app: FastifyInstance,
  options: PlayerVisibilityRouteOptions,
): Promise<void> {
  const responses = {
    200: stateSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
    503: errorResponseSchema,
  };

  app.get("/v1/account/player-visibility", {
    schema: { response: responses },
  }, async (request, reply) => {
    try {
      const actor = await options.resolveActor(request);
      return reply.send(document(await options.service.readOwn(actor)));
    } catch (error) {
      const { status, body } = errorReply(error);
      return reply.code(status as 503).send(body as never);
    }
  });

  app.put<{ Body: Readonly<{ visibility: "public" | "private" }> }>(
    "/v1/account/player-visibility",
    { schema: { body: ownBodySchema, response: responses } },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        await requireProof(options, actor, request.headers["x-mk8dx-csrf"]);
        const state = await options.service.setOwn(
          actor, request.body.visibility,
        );
        return reply.send(document(state));
      } catch (error) {
        const { status, body } = errorReply(error);
        return reply.code(status as 503).send(body as never);
      }
    },
  );

  // An administrator may set any Player's presence; the reason is recorded.
  app.put<{
    Params: Readonly<{ playerId: string }>;
    Body: Readonly<{ visibility: "public" | "private"; reasonCode: string }>;
  }>(
    "/v1/administrator/players/:playerId/visibility",
    {
      schema: {
        params: playerIdParamsSchema,
        body: administratorBodySchema,
        response: responses,
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        await requireProof(options, actor, request.headers["x-mk8dx-csrf"]);
        const state = await options.service.setForPlayer(
          actor,
          request.params.playerId,
          request.body.visibility,
          request.body.reasonCode,
        );
        return reply.send(document(state));
      } catch (error) {
        const { status, body } = errorReply(error);
        return reply.code(status as 503).send(body as never);
      }
    },
  );
}

async function requireProof(
  options: PlayerVisibilityRouteOptions,
  actor: Parameters<TimeTrialWebCsrfVerifier["verify"]>[0],
  proof: unknown,
): Promise<void> {
  if (options.csrfVerifier === undefined) { return; }
  if (actor.role === "anonymous") {
    throw new PlayerVisibilityError("not_authenticated");
  }
  if (typeof proof !== "string" ||
    !await options.csrfVerifier.verify(actor, proof)) {
    throw new PlayerVisibilityError("forbidden");
  }
}
