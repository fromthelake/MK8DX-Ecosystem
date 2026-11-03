import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorContext, ActorResolver } from "../identity/types.js";
import {
  InstallationSettingsError,
  type InstallationSettingsService,
} from "./installation-settings-service.js";

/**
 * Installation settings (ADR-0221). Anyone may read who creates Players and
 * who counts for the rating (the Web and the phone explain a missing button
 * with it); only administrators read the audit-facing view, change the
 * settings and start the explicit rating recalculation. Browser writes need
 * the CSRF proof.
 */

const playerCreationSchema = { type: "string", enum: ["self_and_directors", "self_only", "directors_only"] } as const;
const ratingEligibilitySchema = { type: "string", enum: ["all_players", "claimed_only"] } as const;
const epochSchema = { type: "integer", minimum: 0 } as const;

export const installationSettingsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "playerCreation", "ratingEligibility"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.installation-settings.v1" },
    playerCreation: playerCreationSchema,
    ratingEligibility: ratingEligibilitySchema,
  },
} as const;

export const ratingRecomputeStatusSchema = {
  type: "object",
  additionalProperties: false,
  required: ["needed", "eligibilityChanged", "claimChanges", "lastRecalculatedAtMs"],
  properties: {
    needed: { type: "boolean" },
    eligibilityChanged: { type: "boolean" },
    claimChanges: { type: "integer", minimum: 0 },
    lastRecalculatedAtMs: { anyOf: [epochSchema, { type: "null" }] },
  },
} as const;

export const installationSettingsAdministrationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "playerCreation", "ratingEligibility", "revision", "updatedAtMs", "ratingRecompute"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.installation-settings-administration.v1" },
    playerCreation: playerCreationSchema,
    ratingEligibility: ratingEligibilitySchema,
    revision: { type: "integer", minimum: 0 },
    updatedAtMs: { anyOf: [epochSchema, { type: "null" }] },
    ratingRecompute: ratingRecomputeStatusSchema,
  },
} as const;

export const installationRatingRecomputeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "epoch", "includedPublications", "appliedRaces", "skippedRaces", "ratedPlayers"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.installation-rating-recompute.v1" },
    epoch: { type: "integer", minimum: 0 },
    includedPublications: { type: "integer", minimum: 0 },
    appliedRaces: { type: "integer", minimum: 0 },
    skippedRaces: { type: "integer", minimum: 0 },
    ratedPlayers: { type: "integer", minimum: 0 },
  },
} as const;

const updateBody = {
  type: "object",
  additionalProperties: false,
  required: ["expectedRevision"],
  properties: {
    expectedRevision: { type: "integer", minimum: 0 },
    playerCreation: playerCreationSchema,
    ratingEligibility: ratingEligibilitySchema,
  },
} as const;
const emptyBody = { type: "object", additionalProperties: false, properties: {} } as const;

const errors = {
  400: errorResponseSchema,
  403: errorResponseSchema,
  409: errorResponseSchema,
  503: errorResponseSchema,
} as const;

const statuses = {
  forbidden: 403,
  invalid_input: 400,
  conflict: 409,
  recompute_unavailable: 409,
  unavailable: 503,
} as const;

function send(reply: FastifyReply, error: unknown) {
  if (error instanceof InstallationSettingsError) {
    return reply.code(statuses[error.code]).send({ code: `installation_settings_${error.code}`, message: error.message });
  }
  return reply.code(503).send({
    code: "installation_settings_unavailable",
    message: "Installation settings are temporarily unavailable.",
  });
}

export async function registerInstallationSettingsRoutes(
  app: FastifyInstance,
  options: Readonly<{
    resolveActor: ActorResolver;
    service: Pick<InstallationSettingsService, "current" | "administration" | "update" | "recomputeRatings">;
    csrfVerifier: Readonly<{ verify(actor: ActorContext, token: string): boolean }>;
  }>,
): Promise<void> {
  const browserWriter = async (request: FastifyRequest): Promise<ActorContext> => {
    const actor = await options.resolveActor(request);
    const token = request.headers["x-mk8dx-csrf"];
    if (typeof token !== "string" || !options.csrfVerifier.verify(actor, token)) {
      throw new InstallationSettingsError("forbidden", "A fresh request proof is required.");
    }
    return actor;
  };

  app.get("/v1/installation-settings", { schema: { response: { 200: installationSettingsSchema, ...errors } } }, async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      return { schemaVersion: "mk8dx.installation-settings.v1" as const, ...await options.service.current() };
    } catch (error) {
      return send(reply, error);
    }
  });

  app.get(
    "/v1/administrator/installation-settings",
    { schema: { response: { 200: installationSettingsAdministrationSchema, ...errors } } },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        return {
          schemaVersion: "mk8dx.installation-settings-administration.v1" as const,
          ...await options.service.administration(await options.resolveActor(request)),
        };
      } catch (error) {
        return send(reply, error);
      }
    },
  );

  app.post<{ Body: { expectedRevision: number; playerCreation?: string; ratingEligibility?: string } }>(
    "/v1/administrator/installation-settings",
    { schema: { body: updateBody, response: { 200: installationSettingsAdministrationSchema, ...errors } } },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        return {
          schemaVersion: "mk8dx.installation-settings-administration.v1" as const,
          ...await options.service.update(await browserWriter(request), request.body),
        };
      } catch (error) {
        return send(reply, error);
      }
    },
  );

  app.post<{ Body: Record<string, never> }>(
    "/v1/administrator/installation-settings/actions/recompute-ratings",
    { schema: { body: emptyBody, response: { 200: installationRatingRecomputeSchema, ...errors } } },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        return {
          schemaVersion: "mk8dx.installation-rating-recompute.v1" as const,
          ...await options.service.recomputeRatings(await browserWriter(request)),
        };
      } catch (error) {
        return send(reply, error);
      }
    },
  );
}
