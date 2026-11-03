import type { FastifyInstance, FastifyReply } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorResolver } from "../identity/types.js";
import {
  NativeTimeTrialSessionError,
  type NativeTimeTrialBootstrapDocument,
  type NativeTimeTrialBootstrapV2Document,
  type NativeTimeTrialSessionService,
} from "./native-session-service.js";

type ErrorResponse = Readonly<{ code: string; message: string }>;

const playerIdSchema = {
  type: "string",
  maxLength: 135,
  pattern: "^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
} as const;

function sendBootstrapFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof NativeTimeTrialSessionError) {
    if (error.code === "not_authenticated") {
      return reply.code(401).send({
        code: "native_time_trial_authentication_required",
        message: "Authentication is required.",
      });
    }
    if (error.code === "not_authorized") {
      return reply.code(403).send({
        code: "native_time_trial_player_required",
        message: "An eligible verified Player claim is required.",
      });
    }
  }
  return reply.code(500).send({
    code: "native_time_trial_session_failed",
    message: "The native Time Trial session could not be established.",
  });
}

export async function registerNativeTimeTrialSessionRoutes(
  app: FastifyInstance,
  options: Readonly<{
    resolveActor: ActorResolver;
    service: Pick<NativeTimeTrialSessionService, "bootstrap" | "bootstrapV2">;
  }>,
): Promise<void> {
  app.get<{ Reply: NativeTimeTrialBootstrapDocument | ErrorResponse }>(
    "/v1/time-trial-submissions/native-bootstrap",
    {
      schema: {
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["schemaVersion", "playerId"],
            properties: {
              schemaVersion: {
                type: "string",
                const: "mk8dx.native-time-trial-bootstrap.v1",
              },
              playerId: playerIdSchema,
            },
          },
          401: errorResponseSchema,
          403: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const document = await options.service.bootstrap(
          await options.resolveActor(request),
        );
        reply.header("Cache-Control", "no-store");
        return reply.send(document);
      } catch (error) {
        return sendBootstrapFailure(reply, error);
      }
    },
  );

  // v2 names the Player. v1 stays exactly as installed clients expect it:
  // their parsers reject unknown keys by design, so identity ships as a new
  // route instead of new fields.
  app.get<{ Reply: NativeTimeTrialBootstrapV2Document | ErrorResponse }>(
    "/v1/time-trial-submissions/native-bootstrap-v2",
    {
      schema: {
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["schemaVersion", "playerId", "username", "displayName"],
            properties: {
              schemaVersion: {
                type: "string",
                const: "mk8dx.native-time-trial-bootstrap.v2",
              },
              playerId: playerIdSchema,
              username: {
                type: "string",
                pattern: "^[a-z0-9_-]{3,16}$",
              },
              displayName: {
                type: "string",
                minLength: 1,
                maxLength: 64,
              },
            },
          },
          401: errorResponseSchema,
          403: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const document = await options.service.bootstrapV2(
          await options.resolveActor(request),
        );
        reply.header("Cache-Control", "no-store");
        return reply.send(document);
      } catch (error) {
        return sendBootstrapFailure(reply, error);
      }
    },
  );
}
