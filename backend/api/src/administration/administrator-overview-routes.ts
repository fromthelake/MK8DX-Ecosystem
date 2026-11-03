import type { FastifyInstance, FastifyReply } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorResolver } from "../identity/types.js";
import {
  ADMINISTRATOR_OVERVIEW_SCHEMA_VERSION,
  AdministratorOverviewError,
  type AdministratorOverview,
  type AdministratorOverviewService,
} from "./administrator-overview.js";

const windowSchema = {
  type: "object",
  additionalProperties: false,
  required: ["signedIn", "submitted"],
  properties: {
    signedIn: { type: "integer", minimum: 0 },
    submitted: { type: "integer", minimum: 0 },
  },
} as const;

const overviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "generatedAtMs", "registered", "active", "pending"],
  properties: {
    schemaVersion: { type: "string", const: ADMINISTRATOR_OVERVIEW_SCHEMA_VERSION },
    generatedAtMs: { type: "integer", minimum: 0 },
    registered: {
      type: "object",
      additionalProperties: false,
      required: ["signInIdentities", "accounts", "players", "linkedPlayers", "administrators"],
      properties: {
        signInIdentities: { type: "integer", minimum: 0 },
        accounts: { type: "integer", minimum: 0 },
        players: { type: "integer", minimum: 0 },
        linkedPlayers: { type: "integer", minimum: 0 },
        administrators: { type: "integer", minimum: 0 },
      },
    },
    active: {
      type: "object",
      additionalProperties: false,
      required: ["last24h", "last7d", "last30d"],
      properties: { last24h: windowSchema, last7d: windowSchema, last30d: windowSchema },
    },
    pending: {
      type: "object",
      additionalProperties: false,
      required: ["playerClaims"],
      properties: { playerClaims: { type: "integer", minimum: 0 } },
    },
  },
} as const;

function send(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof AdministratorOverviewError && error.code === "forbidden") {
    return reply.code(403).send({
      code: "administrator_overview_forbidden",
      message: "Administrator access is required.",
    });
  }
  return reply.code(503).send({
    code: "administrator_overview_unavailable",
    message: "The administrator overview is unavailable.",
  });
}

/**
 * Offered on the browser path and on the native path, like the identity-link
 * surface: the phone sends a bearer token, the browser a cookie, and a GET
 * needs no request proof on either.
 */
export async function registerAdministratorOverviewRoutes(
  app: FastifyInstance,
  options: Readonly<{
    resolveActor: ActorResolver;
    service: Pick<AdministratorOverviewService, "overview">;
  }>,
): Promise<void> {
  for (const prefix of ["", "/native"] as const) {
    app.get<{ Reply: AdministratorOverview | { code: string; message: string } }>(
      `/v1${prefix}/administrator/overview`,
      {
        schema: {
          response: { 200: overviewSchema, 403: errorResponseSchema, 503: errorResponseSchema },
        },
      },
      async (request, reply) => {
        try {
          const actor = await options.resolveActor(request);
          if (prefix === "/native" &&
              !/^Bearer [^\s]{20,512}$/iu.test(request.headers.authorization ?? "")) {
            throw new AdministratorOverviewError("forbidden", "bearer token required");
          }
          const overview = await options.service.overview(actor);
          void reply.header("cache-control", "no-store");
          return reply.send(overview);
        } catch (error) {
          return send(reply, error);
        }
      },
    );
  }
}
