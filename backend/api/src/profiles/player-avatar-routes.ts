import type { FastifyInstance } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorResolver } from "../identity/types.js";
import type { TimeTrialWebCsrfVerifier } from
  "../timetrials/submission-routes.js";
import {
  PlayerAvatarError,
  type PlayerAvatarService,
} from "./player-avatar-service.js";

type ErrorResponse = Readonly<{ code: string; message: string }>;

export type PlayerAvatarRouteOptions = Readonly<{
  resolveActor: ActorResolver;
  service: Pick<PlayerAvatarService, "setOwnAvatar">;
  csrfVerifier?: TimeTrialWebCsrfVerifier;
}>;

const bodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["avatarId"],
  properties: {
    avatarId: {
      anyOf: [
        {
          type: "string",
          maxLength: 128,
          pattern: "^character(_variant)?\\.[a-z0-9_.]+$",
        },
        { type: "null" },
      ],
    },
  },
} as const;

const acknowledgedSchema = {
  type: "object",
  additionalProperties: false,
  required: ["acknowledged"],
  properties: { acknowledged: { type: "boolean", const: true } },
} as const;

function errorReply(error: unknown): Readonly<{
  status: number;
  body: ErrorResponse;
}> {
  if (error instanceof PlayerAvatarError) {
    switch (error.code) {
      case "invalid_input":
        return {
          status: 400,
          body: {
            code: "avatar_invalid",
            message: "That character is not in the canonical catalog.",
          },
        };
      case "not_authenticated":
        return {
          status: 401,
          body: {
            code: "not_authenticated",
            message: "Sign in to choose your profile character.",
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
      case "unavailable":
        break;
    }
  }
  return {
    status: 503,
    body: {
      code: "avatar_unavailable",
      message: "The profile character could not be updated.",
    },
  };
}

export async function registerPlayerAvatarRoutes(
  app: FastifyInstance,
  options: PlayerAvatarRouteOptions,
): Promise<void> {
  app.put<{ Body: Readonly<{ avatarId: string | null }> }>(
    "/v1/account/player-avatar",
    {
      schema: {
        body: bodySchema,
        response: {
          200: acknowledgedSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          409: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        const proof = request.headers["x-mk8dx-csrf"];
        if (options.csrfVerifier !== undefined &&
            (typeof proof !== "string" ||
             !await options.csrfVerifier.verify(actor, proof))) {
          throw new PlayerAvatarError("not_authenticated");
        }
        await options.service.setOwnAvatar(actor, request.body.avatarId);
        return reply.send({ acknowledged: true });
      } catch (error) {
        const { status, body } = errorReply(error);
        return reply.code(status).send(body);
      }
    },
  );
}
