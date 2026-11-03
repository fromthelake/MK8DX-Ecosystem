import type { FastifyInstance } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorResolver } from "../identity/types.js";
import {
  CLIENT_NAMES,
  ClientInstallationError,
  type ClientInstallationService,
  type ClientName,
} from "./client-installations.js";

const checkinSchema = {
  type: "object",
  additionalProperties: false,
  required: ["installationId", "client", "version"],
  properties: {
    installationId: { type: "string", minLength: 8, maxLength: 64 },
    client: { type: "string", enum: [...CLIENT_NAMES] },
    version: { type: "string", minLength: 1, maxLength: 64 },
    build: { type: "integer", minimum: 1, maximum: 100000 },
    deviceModel: { type: "string", minLength: 1, maxLength: 64 },
  },
} as const;

const acknowledgedSchema = {
  type: "object", additionalProperties: false, required: ["acknowledged"],
  properties: { acknowledged: { type: "boolean", const: true } },
} as const;

const installationsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "installations"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.client-installations.v1" },
    installations: {
      type: "array",
      maxItems: 1000,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "userAccountId", "installationId", "client", "version",
          "firstSeenAtMs", "lastSeenAtMs", "checkinCount",
        ],
        properties: {
          userAccountId: { type: "string" },
          playerId: { type: "string" },
          displayName: { type: "string" },
          installationId: { type: "string" },
          client: { type: "string", enum: [...CLIENT_NAMES] },
          version: { type: "string" },
          build: { type: "integer" },
          deviceModel: { type: "string" },
          firstSeenAtMs: { type: "integer" },
          lastSeenAtMs: { type: "integer" },
          checkinCount: { type: "integer" },
        },
      },
    },
  },
} as const;

/**
 * A client says which build it is, and an administrator can read the list.
 *
 * The check-in needs a session and nothing else: no CSRF proof, because a
 * browser is not what sends it and there is nothing here for a cross-site
 * request to achieve - the worst it could do is claim a version for its own
 * account. The reading needs an administrator, because it is about everybody.
 */
export async function registerClientInstallationRoutes(
  app: FastifyInstance,
  options: Readonly<{
    resolveActor: ActorResolver;
    service: ClientInstallationService;
  }>,
): Promise<void> {
  app.post<{
    Body: {
      installationId: string;
      client: ClientName;
      version: string;
      build?: number;
      deviceModel?: string;
    };
  }>("/v1/native/client-checkin", {
    schema: {
      body: checkinSchema,
      response: {
        200: acknowledgedSchema,
        400: errorResponseSchema,
        401: errorResponseSchema,
        503: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    try {
      await options.service.checkin(await options.resolveActor(request), request.body);
      return reply.send({ acknowledged: true });
    } catch (error) {
      if (error instanceof ClientInstallationError) {
        if (error.code === "not_authenticated") {
          return reply.code(401).send({
            code: "not_authenticated",
            message: "Sign in before checking in a client.",
          });
        }
        return reply.code(400).send({
          code: "client_checkin_invalid",
          message: "The client check-in was not understood.",
        });
      }
      return reply.code(503).send({
        code: "client_checkin_unavailable",
        message: "Client check-in is temporarily unavailable.",
      });
    }
  });

  app.get("/v1/administration/client-installations", {
    schema: {
      response: {
        200: installationsSchema,
        401: errorResponseSchema,
        503: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const installations = await options.service.list(
        await options.resolveActor(request),
      );
      return reply.send({
        schemaVersion: "mk8dx.client-installations.v1",
        installations,
      });
    } catch (error) {
      if (error instanceof ClientInstallationError) {
        return reply.code(401).send({
          code: "not_authenticated",
          message: "Administration is for administrators.",
        });
      }
      return reply.code(503).send({
        code: "client_installations_unavailable",
        message: "The installation list is temporarily unavailable.",
      });
    }
  });
}
