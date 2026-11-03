import type { FastifyInstance, FastifyReply } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorResolver } from "../identity/types.js";
import {
  ObservedIdentityAdminError,
  type ObservedIdentityAdminService,
} from "./observed-identity-admin-service.js";

// Administrator-only, and a mutation here changes what the whole product says
// about who raced what - so both writes carry the same same-origin proof the
// rest of the administrator surface requires.

const linkSchema = {
  type: "object", additionalProperties: false,
  required: [
    "linkId", "tournamentNumber", "sectionId", "sectionName", "observedName",
    "playerId", "playerName", "decisionSource", "placements",
  ],
  properties: {
    linkId: { type: "string", maxLength: 32 },
    tournamentNumber: { type: "integer", minimum: 1 },
    sectionId: { type: "string", maxLength: 32 },
    sectionName: { type: "string", maxLength: 96 },
    legacySectionLabel: { type: ["string", "null"], maxLength: 96 },
    observedName: { type: "string", maxLength: 64 },
    playerId: { type: "string", maxLength: 135 },
    playerName: { type: "string", maxLength: 128 },
    decisionSource: { type: "string", enum: ["derived", "manual"] },
    // The evidence the binder had, so a reviewer can see why it concluded this
    // rather than being asked to trust it.
    orderAgreement: { type: ["number", "null"] },
    videoPoints: { type: ["number", "null"] },
    historyPoints: { type: ["number", "null"] },
    note: { type: ["string", "null"], maxLength: 240 },
    placements: { type: "integer", minimum: 0 },
  },
} as const;

const playerSchema = {
  type: "object", additionalProperties: false,
  required: ["playerId", "displayName", "tournamentRaces"],
  properties: {
    playerId: { type: "string", maxLength: 135 },
    displayName: { type: "string", maxLength: 128 },
    tournamentRaces: { type: "integer", minimum: 0 },
  },
} as const;

function send(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof ObservedIdentityAdminError) {
    const status = error.code === "not_authorized"
      ? 403
      : error.code === "invalid_input" ? 400
        : error.code === "not_found" ? 404 : 503;
    return reply.code(status).send({
      code: `observed_identity_${error.code}`, message: error.message,
    });
  }
  return reply.code(503).send({
    code: "observed_identity_unavailable",
    message: "The observed identity mapping is temporarily unavailable.",
  });
}

export async function registerObservedIdentityAdminRoutes(
  app: FastifyInstance,
  options: Readonly<{
    resolveActor: ActorResolver;
    service: ObservedIdentityAdminService;
    csrfVerifier: {
      verify(actor: unknown, proof: string): boolean | Promise<boolean>;
    };
  }>,
): Promise<void> {
  const proven = async (request: Parameters<ActorResolver>[0]) => {
    const actor = await options.resolveActor(request);
    const proof = request.headers["x-mk8dx-csrf"];
    if (typeof proof !== "string" ||
      !await options.csrfVerifier.verify(actor, proof)) {
      throw new ObservedIdentityAdminError(
        "not_authorized", "A valid same-origin request proof is required.");
    }
    return actor;
  };

  app.get(
    "/v1/administrator/tournament-identities",
    {
      schema: {
        response: {
          200: {
            type: "object", additionalProperties: false,
            required: ["schemaVersion", "links", "players"],
            properties: {
              schemaVersion: {
                type: "string", const: "mk8dx.administrator-tournament-identities.v1",
              },
              links: { type: "array", maxItems: 2000, items: linkSchema },
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
          schemaVersion: "mk8dx.administrator-tournament-identities.v1" as const,
          links: overview.links,
          players: overview.players,
        });
      } catch (error) { return send(reply, error); }
    },
  );

  app.post<{ Body: { linkId: string; playerId: string; note?: string } }>(
    "/v1/administrator/tournament-identities/actions/assign",
    {
      schema: {
        body: {
          type: "object", additionalProperties: false,
          required: ["linkId", "playerId"],
          properties: {
            linkId: { type: "string", minLength: 1, maxLength: 32 },
            playerId: { type: "string", minLength: 8, maxLength: 135 },
            note: { type: "string", maxLength: 240 },
          },
        },
        response: {
          204: { type: "null" },
          400: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await proven(request);
        await options.service.assign(actor, {
          linkId: request.body.linkId,
          playerId: request.body.playerId,
          ...(request.body.note === undefined
            ? {} : { note: request.body.note }),
        });
        return reply.code(204).send();
      } catch (error) { return send(reply, error); }
    },
  );

  app.post<{ Body: { linkId: string } }>(
    "/v1/administrator/tournament-identities/actions/restore",
    {
      schema: {
        body: {
          type: "object", additionalProperties: false, required: ["linkId"],
          properties: {
            linkId: { type: "string", minLength: 1, maxLength: 32 },
          },
        },
        response: {
          204: { type: "null" },
          400: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await proven(request);
        await options.service.restoreDerived(actor, request.body.linkId);
        return reply.code(204).send();
      } catch (error) { return send(reply, error); }
    },
  );
}
