import type { FastifyInstance, FastifyRequest } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorContext, ActorResolver } from "../identity/types.js";
import { ClaimCandidateError, type ClaimCandidateService } from "./claim-candidate-service.js";

// ADR-0219 request and response schemas, shared by the browser (CSRF) and the
// native (bearer) routes so Web and Android read one contract.

export const claimCandidateRequestSchema = {
  type: "object", additionalProperties: false, required: ["query", "timeTrials", "tournaments"],
  properties: {
    query: { type: "string", minLength: 2, maxLength: 64 },
    timeTrials: { type: "boolean" },
    tournaments: { type: "boolean" },
  },
} as const;

const nameSchema = { type: "string", minLength: 1, maxLength: 128 } as const;
const dateSchema = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;

export const claimCandidateResponseSchema = {
  type: "object", additionalProperties: false, required: ["schemaVersion", "candidates"],
  properties: {
    schemaVersion: { const: "mk8dx.claim-candidates.v1" },
    candidates: {
      type: "array", maxItems: 20,
      items: {
        type: "object", additionalProperties: false,
        required: [
          "playerId", "username", "displayName", "aliases", "claimed", "matchesAnswers", "timeTrials", "tournaments",
        ],
        properties: {
          playerId: { type: "string", pattern: "^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$" },
          username: { type: "string", minLength: 1, maxLength: 64 },
          displayName: nameSchema,
          aliases: { type: "array", maxItems: 8, items: nameSchema },
          claimed: { type: "boolean" },
          matchesAnswers: { type: "boolean" },
          timeTrials: {
            type: "object", additionalProperties: false, required: ["times", "lastAt", "classes"],
            properties: {
              times: { type: "integer", minimum: 0 },
              lastAt: { anyOf: [dateSchema, { type: "null" }] },
              classes: { type: "array", maxItems: 2, items: { enum: [150, 200] } },
            },
          },
          tournaments: {
            type: "object", additionalProperties: false, required: ["nights", "directorNames", "lastNight"],
            properties: {
              nights: { type: "integer", minimum: 0 },
              directorNames: { type: "array", maxItems: 5, items: nameSchema },
              lastNight: {
                anyOf: [
                  {
                    type: "object", additionalProperties: false, required: ["name", "date"],
                    properties: { name: { type: "string", minLength: 1, maxLength: 160 }, date: { anyOf: [dateSchema, { type: "null" }] } },
                  },
                  { type: "null" },
                ],
              },
            },
          },
        },
      },
    },
  },
} as const;

type ClaimCandidateBody = { query: string; timeTrials: boolean; tournaments: boolean };

function failure(error: unknown): Readonly<{ status: 400 | 401 | 403 | 503; body: { code: string; message: string } }> {
  const code = error instanceof ClaimCandidateError ? error.code : "unavailable";
  if (code === "invalid_query") {
    return { status: 400, body: { code: "invalid_player_query", message: "Enter at least two valid characters." } };
  }
  if (code === "not_authenticated") {
    return { status: 401, body: { code: "claim_authentication_required", message: "Sign in to find your Player." } };
  }
  if (code === "not_authorized") {
    return { status: 403, body: { code: "claim_candidates_forbidden", message: "A valid request proof is required." } };
  }
  return { status: 503, body: { code: "claim_product_unavailable", message: "Player claims are temporarily unavailable." } };
}

/**
 * ADR-0219: the Players a signed-in person may be, with public context. The
 * browser sends a cookie, so it proves the same origin; the phone sends a
 * bearer token, whose presence is checked (resolveActor stays authoritative).
 */
export async function registerClaimCandidateRoutes(
  app: FastifyInstance,
  options: Readonly<{
    resolveActor: ActorResolver;
    service: Pick<ClaimCandidateService, "search">;
    csrfVerifier: Readonly<{ verify(actor: ActorContext, token: string): boolean | Promise<boolean> }>;
  }>,
): Promise<void> {
  for (const native of [false, true]) {
    const proven = async (request: FastifyRequest): Promise<ActorContext> => {
      const actor = await options.resolveActor(request);
      if (native) {
        if (!/^Bearer [^\s]{20,512}$/iu.test(request.headers.authorization ?? "")) {
          throw new ClaimCandidateError("not_authorized");
        }
        return actor;
      }
      if (actor.role === "anonymous") { throw new ClaimCandidateError("not_authenticated"); }
      const proof = request.headers["x-mk8dx-csrf"];
      if (typeof proof !== "string" || !await options.csrfVerifier.verify(actor, proof)) {
        throw new ClaimCandidateError("not_authorized");
      }
      return actor;
    };
    app.post<{ Body: ClaimCandidateBody }>(
      native ? "/v1/native/claim-candidates" : "/v1/me/claim-candidates",
      {
        schema: {
          body: claimCandidateRequestSchema,
          response: {
            200: claimCandidateResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            503: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        try {
          const candidates = await options.service.search(await proven(request), request.body);
          void reply.header("cache-control", "no-store");
          return { schemaVersion: "mk8dx.claim-candidates.v1" as const, candidates };
        } catch (error) {
          const mapped = failure(error);
          return reply.code(mapped.status).send(mapped.body);
        }
      },
    );
  }
}
