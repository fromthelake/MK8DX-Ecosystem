import type { FastifyInstance, FastifyReply } from "fastify";

import { errorResponseSchema } from "./schemas.js";
import type { ActorResolver } from "./types.js";
import {
  IdentityLinkAdminError, type IdentityLinkAdminService,
} from "./identity-link-admin-service.js";

type ErrorResponse = Readonly<{ code: string; message: string }>;

const accountSchema = {
  type: "object",
  additionalProperties: false,
  required: ["userAccountId", "email", "accountStatus", "linkedPlayerId"],
  properties: {
    userAccountId: { type: "string", maxLength: 141 },
    email: { type: ["string", "null"], maxLength: 255 },
    accountStatus: { type: "string", maxLength: 32 },
    screenName: { type: ["string", "null"], maxLength: 32 },
    linkedPlayerId: { type: ["string", "null"], maxLength: 135 },
    linkedPlayerName: { type: ["string", "null"], maxLength: 128 },
    playerClaimId: { type: ["string", "null"], maxLength: 141 },
    lastSeenAtMs: { type: ["integer", "null"] },
  },
} as const;

const playerSchema = {
  type: "object",
  additionalProperties: false,
  required: ["playerId", "displayName", "timeTrials", "tournamentRaces"],
  properties: {
    playerId: { type: "string", maxLength: 135 },
    displayName: { type: "string", maxLength: 128 },
    username: { type: ["string", "null"], maxLength: 64 },
    timeTrials: { type: "integer", minimum: 0 },
    tournamentRaces: { type: "integer", minimum: 0 },
    linkedAccountId: { type: ["string", "null"], maxLength: 141 },
  },
} as const;

function send(reply: FastifyReply, error: unknown): FastifyReply {
  const code = error instanceof IdentityLinkAdminError ? error.code : "unavailable";
  const message = error instanceof Error ? error.message : "Player linking failed.";
  if (code === "not_authorized") {
    return reply.code(403).send({ code: "identity_link_forbidden", message });
  }
  if (code === "invalid_input") {
    return reply.code(400).send({ code: "identity_link_invalid", message });
  }
  // A conflict raised by the claim lifecycle - "already linked" - is the one an
  // administrator meets most, so it keeps its own status rather than becoming
  // an unexplained failure.
  if (error instanceof Error && /already linked|already occupies/u.test(error.message)) {
    return reply.code(409).send({ code: "identity_link_conflict", message });
  }
  if (error instanceof Error && /not found/u.test(error.message)) {
    return reply.code(404).send({ code: "identity_link_not_found", message });
  }
  return reply.code(503).send({ code: "identity_link_unavailable", message });
}

/**
 * The same surface is offered twice, because the two clients authenticate
 * differently and neither protection fits the other. The browser sends a
 * cookie, so a write needs the same-origin proof; the phone sends a bearer
 * token, which a third-party page cannot obtain, so it needs the token's
 * presence checked instead. The service, the rules and the audit trail behind
 * them are one and the same.
 */
export async function registerIdentityLinkAdminRoutes(
  app: FastifyInstance,
  options: Readonly<{
    resolveActor: ActorResolver;
    service: IdentityLinkAdminService;
    csrfVerifier: { verify(actor: unknown, proof: string): boolean | Promise<boolean> };
  }>,
): Promise<void> {
  await registerRoutes(app, options, "");
  await registerRoutes(app, options, "/native");
}

async function registerRoutes(
  app: FastifyInstance,
  options: Readonly<{
    resolveActor: ActorResolver;
    service: IdentityLinkAdminService;
    csrfVerifier: { verify(actor: unknown, proof: string): boolean | Promise<boolean> };
  }>,
  prefix: "" | "/native",
): Promise<void> {
  const native = prefix === "/native";
  const proven = async (request: Parameters<ActorResolver>[0]) => {
    const actor = await options.resolveActor(request);
    if (native) {
      // Shape-check only; resolveActor stays authoritative for the signature,
      // expiry, revocation and whether this account is an administrator.
      if (!/^Bearer [^\s]{20,512}$/iu.test(request.headers.authorization ?? "")) {
        throw new IdentityLinkAdminError(
          "not_authorized", "A native-app bearer token is required.",
        );
      }
      return actor;
    }
    const proof = request.headers["x-mk8dx-csrf"];
    if (typeof proof !== "string" || !await options.csrfVerifier.verify(actor, proof)) {
      throw new IdentityLinkAdminError(
        "not_authorized", "A valid same-origin request proof is required.",
      );
    }
    return actor;
  };

  app.get(
    `/v1${prefix}/administrator/identity-links`,
    {
      schema: {
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["schemaVersion", "accounts", "players"],
            properties: {
              schemaVersion: { type: "string", const: "mk8dx.administrator-identity-links.v1" },
              accounts: { type: "array", maxItems: 500, items: accountSchema },
              players: { type: "array", maxItems: 1000, items: playerSchema },
            },
          },
          403: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        const overview = await options.service.overview(actor);
        void reply.header("cache-control", "no-store");
        return reply.send({
          schemaVersion: "mk8dx.administrator-identity-links.v1" as const,
          accounts: overview.accounts,
          players: overview.players,
        });
      } catch (error) { return send(reply, error); }
    },
  );

  app.post<{ Body: { userAccountId: string; playerId: string; reasonCode?: string } }>(
    `/v1${prefix}/administrator/identity-links/actions/link`,
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["userAccountId", "playerId"],
          properties: {
            userAccountId: { type: "string", maxLength: 141 },
            playerId: { type: "string", maxLength: 135 },
            reasonCode: { type: "string", maxLength: 64 },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["schemaVersion", "playerClaimId"],
            properties: {
              schemaVersion: { type: "string", const: "mk8dx.administrator-identity-link.v1" },
              playerClaimId: { type: "string", maxLength: 141 },
            },
          },
          400: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await proven(request);
        const linked = await options.service.link(actor, request.body);
        return reply.send({
          schemaVersion: "mk8dx.administrator-identity-link.v1" as const,
          playerClaimId: linked.playerClaimId,
        });
      } catch (error) { return send(reply, error); }
    },
  );

  app.post<{ Body: { userAccountId: string; reasonCode?: string } }>(
    `/v1${prefix}/administrator/identity-links/actions/unlink`,
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["userAccountId"],
          properties: {
            userAccountId: { type: "string", maxLength: 141 },
            reasonCode: { type: "string", maxLength: 64 },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["schemaVersion", "unlinked"],
            properties: {
              schemaVersion: { type: "string", const: "mk8dx.administrator-identity-unlink.v1" },
              unlinked: { type: "boolean" },
            },
          },
          400: errorResponseSchema,
          403: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await proven(request);
        const result = await options.service.unlink(actor, request.body);
        return reply.send({
          schemaVersion: "mk8dx.administrator-identity-unlink.v1" as const,
          unlinked: result.unlinked,
        });
      } catch (error) { return send(reply, error); }
    },
  );
}

export type { ErrorResponse };
