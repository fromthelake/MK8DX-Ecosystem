import type { FastifyInstance } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorResolver } from "../identity/types.js";


type SessionCapabilityDocument = Readonly<{
  schemaVersion: "mk8dx.web-session-capabilities.v1";
  administrator: boolean;
  tournamentOperation: boolean;
}>;
type ErrorResponse = Readonly<{ code: string; message: string }>;

export async function registerSessionCapabilityRoutes(
  app: FastifyInstance,
  resolveActor: ActorResolver,
  hasTournamentOperation: (userAccountId: string) => Promise<boolean> = async () => false,
): Promise<void> {
  app.get<{ Reply: SessionCapabilityDocument | ErrorResponse }>(
    "/v1/session/capabilities",
    {
      schema: {
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["schemaVersion", "administrator", "tournamentOperation"],
            properties: {
              schemaVersion: {
                type: "string",
                const: "mk8dx.web-session-capabilities.v1",
              },
              administrator: { type: "boolean" },
              tournamentOperation: { type: "boolean" },
            },
          },
          401: errorResponseSchema,
          403: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await resolveActor(request);
        reply.header("Cache-Control", "no-store");
        if (actor.role === "anonymous") {
          return reply.code(401).send({
            code: "session_authentication_required",
            message: "Authentication is required.",
          });
        }
        if (actor.role !== "account" && actor.role !== "administrator") {
          return reply.code(403).send({
            code: "session_capabilities_forbidden",
            message: "Session capabilities are not available for this actor.",
          });
        }
        return reply.send({
          schemaVersion: "mk8dx.web-session-capabilities.v1",
          administrator: actor.role === "administrator",
          tournamentOperation: actor.role === "administrator" ||
            await hasTournamentOperation(actor.userAccountId),
        });
      } catch {
        reply.header("Cache-Control", "no-store");
        return reply.code(503).send({
          code: "session_capabilities_unavailable",
          message: "Session capabilities are temporarily unavailable.",
        });
      }
    },
  );
}
