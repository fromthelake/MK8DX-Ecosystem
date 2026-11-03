import type { FastifyInstance } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorResolver } from "../identity/types.js";
import {
  WebManualSessionError,
  type WebManualBootstrapDocument,
  type WebManualSessionService,
} from "./web-manual-session-service.js";


type ErrorResponse = Readonly<{ code: string; message: string }>;

export type WebManualSessionRouteOptions = Readonly<{
  resolveActor: ActorResolver;
  service: Pick<WebManualSessionService, "bootstrap">;
}>;

const querySchema = {
  type: "object",
  additionalProperties: false,
  required: ["trackId"],
  properties: {
    trackId: {
      type: "string",
      maxLength: 255,
      pattern: "^track\\.[a-z0-9]+(?:_[a-z0-9]+)*$",
    },
  },
} as const;

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "context"],
  properties: {
    schemaVersion: {
      type: "string",
      const: "mk8dx.web-manual-bootstrap.v1",
    },
    context: {
      type: "object",
      additionalProperties: false,
      required: [
        "schemaVersion",
        "submissionId",
        "revision",
        "trackId",
        "playerReference",
        "producer",
        "timestamps",
      ],
      properties: {
        schemaVersion: {
          type: "string",
          const: "mk8dx.web-manual-context.v1",
        },
        submissionId: {
          type: "string",
          pattern: "^user_submission\\.time\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$",
        },
        revision: { type: "integer", const: 1 },
        trackId: {
          type: "string",
          pattern: "^track\\.[a-z0-9]+(?:_[a-z0-9]+)*$",
        },
        playerReference: {
          type: "object",
          additionalProperties: false,
          required: ["namespace", "value"],
          properties: {
            namespace: { type: "string", const: "player" },
            value: {
              type: "string",
              maxLength: 135,
              pattern: "^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
            },
          },
        },
        producer: {
          type: "object",
          additionalProperties: false,
          required: ["version", "localRecordId"],
          properties: {
            version: { type: "string", minLength: 1, maxLength: 64 },
            localRecordId: {
              type: "string",
              pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{5,127}$",
            },
          },
        },
        timestamps: {
          type: "object",
          additionalProperties: false,
          required: ["createdAtMs"],
          properties: {
            createdAtMs: {
              type: "integer",
              minimum: 0,
              maximum: 253_402_300_799_999,
            },
          },
        },
      },
    },
  },
} as const;

function failure(error: unknown): Readonly<{
  statusCode: 400 | 401 | 403 | 500;
  response: ErrorResponse;
}> {
  if (error instanceof WebManualSessionError) {
    if (error.code === "invalid_track") {
      return {
        statusCode: 400,
        response: {
          code: "web_manual_track_invalid",
          message: "The selected track is invalid.",
        },
      };
    }
    if (error.code === "not_authenticated") {
      return {
        statusCode: 401,
        response: {
          code: "web_manual_authentication_required",
          message: "Authentication is required.",
        },
      };
    }
    if (error.code === "not_authorized") {
      return {
        statusCode: 403,
        response: {
          code: "web_manual_player_required",
          message: "An eligible verified Player claim is required.",
        },
      };
    }
  }
  return {
    statusCode: 500,
    response: {
      code: "web_manual_session_failed",
      message: "The web manual session could not be established.",
    },
  };
}

export async function registerWebManualSessionRoutes(
  app: FastifyInstance,
  options: WebManualSessionRouteOptions,
): Promise<void> {
  app.get<{
    Querystring: { trackId: string };
    Reply: WebManualBootstrapDocument | ErrorResponse;
  }>(
    "/v1/time-trial-submissions/manual-bootstrap",
    {
      schema: {
        querystring: querySchema,
        response: {
          200: responseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        const result = await options.service.bootstrap(
          actor,
          request.query.trackId,
        );
        reply.header("Cache-Control", "no-store");
        return reply.send(result);
      } catch (error) {
        const mapped = failure(error);
        reply.header("Cache-Control", "no-store");
        return reply.code(mapped.statusCode).send(mapped.response);
      }
    },
  );
}
