import type { FastifyInstance } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorResolver } from "../identity/types.js";
import {
  WebCsrfIssuanceError,
  type WebCsrfProofDocument,
  type WebCsrfService,
} from "./web-csrf-service.js";


type ErrorResponse = Readonly<{ code: string; message: string }>;

export type WebCsrfRouteOptions = Readonly<{
  resolveActor: ActorResolver;
  service: Pick<WebCsrfService, "issue">;
}>;

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "headerName", "value"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.web-csrf.v1" },
    headerName: { type: "string", const: "X-MK8DX-CSRF" },
    value: { type: "string", minLength: 1, maxLength: 4_096 },
  },
} as const;

function failure(error: unknown): Readonly<{
  statusCode: 401 | 403 | 500;
  response: ErrorResponse;
}> {
  if (error instanceof WebCsrfIssuanceError) {
    if (error.code === "not_authenticated") {
      return {
        statusCode: 401,
        response: {
          code: "csrf_authentication_required",
          message: "Authentication is required.",
        },
      };
    }
    return {
      statusCode: 403,
      response: {
        code: "csrf_forbidden",
        message: "A CSRF proof is not available for this actor.",
      },
    };
  }
  return {
    statusCode: 500,
    response: {
      code: "csrf_issuance_failed",
      message: "The CSRF proof could not be issued.",
    },
  };
}

export async function registerWebCsrfRoutes(
  app: FastifyInstance,
  options: WebCsrfRouteOptions,
): Promise<void> {
  app.get<{ Reply: WebCsrfProofDocument | ErrorResponse }>(
    "/v1/session/csrf",
    {
      schema: {
        response: {
          200: responseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        const result = options.service.issue(actor);
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
