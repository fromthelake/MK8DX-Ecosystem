import type { FastifyInstance } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorResolver } from "../identity/types.js";
import {
  ClaimReviewReadError,
  type AccountClaimWalkItem,
  type ClaimReviewQueue,
  type ClaimReviewReadService,
} from "./claim-review-read-service.js";

const playerIdSchema = { type: "string", pattern: "^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$" } as const;
const claimIdSchema = { type: "string", pattern: "^player_claim\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$" } as const;
const epochSchema = { type: "integer", minimum: 0 } as const;
const nameSchema = { type: "string", minLength: 1, maxLength: 128 } as const;
const nullableName = { anyOf: [nameSchema, { type: "null" }] } as const;
const claimStatusSchema = {
  type: "string",
  enum: ["requested", "under_review", "verified", "rejected", "released", "revoked"],
} as const;
const disputeStatusSchema = { type: "string", enum: ["none", "open", "resolved"] } as const;
const reviewerRoleSchema = { type: "string", enum: ["administrator", "director"] } as const;

const playerRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["playerId", "username", "displayName"],
  properties: {
    playerId: playerIdSchema,
    username: { type: "string", minLength: 1, maxLength: 64 },
    displayName: nameSchema,
  },
} as const;

const noteSchema = {
  type: "object",
  additionalProperties: false,
  required: ["role", "kind", "body", "authorName", "createdAtMs"],
  properties: {
    role: { type: "string", enum: ["requester", "reviewer"] },
    kind: { type: "string", enum: ["request", "question", "reply", "decision"] },
    body: { type: "string", minLength: 1, maxLength: 500 },
    authorName: nullableName,
    createdAtMs: epochSchema,
  },
} as const;

const notesSchema = { type: "array", maxItems: 50, items: noteSchema } as const;

export const accountClaimWalkSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "claims"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.account-player-claim-walk.v1" },
    claims: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "playerClaimId", "player", "claimStatus", "disputeStatus", "requestedAtMs", "updatedAtMs",
          "reviewerDirectorNames", "lastDecision", "notes",
        ],
        properties: {
          playerClaimId: claimIdSchema,
          player: playerRefSchema,
          claimStatus: claimStatusSchema,
          disputeStatus: disputeStatusSchema,
          requestedAtMs: epochSchema,
          updatedAtMs: epochSchema,
          reviewerDirectorNames: { type: "array", maxItems: 10, items: nameSchema },
          lastDecision: {
            anyOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["decision", "byRole", "byName", "reasonCode", "decidedAtMs"],
                properties: {
                  decision: { type: "string", enum: ["verified", "rejected", "released", "revoked"] },
                  byRole: { type: "string", enum: ["requester", "administrator", "director"] },
                  byName: nullableName,
                  reasonCode: { anyOf: [{ type: "string", maxLength: 64 }, { type: "null" }] },
                  decidedAtMs: epochSchema,
                },
              },
              { type: "null" },
            ],
          },
          notes: notesSchema,
        },
      },
    },
  },
} as const;

export const claimReviewQueueSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "open", "linked"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.player-claim-review-queue.v1" },
    open: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "playerClaimId", "claimStatus", "disputeStatus", "requestedAtMs", "updatedAtMs", "reviewerRole",
          "requester", "player", "conflicts", "notes",
        ],
        properties: {
          playerClaimId: claimIdSchema,
          claimStatus: claimStatusSchema,
          disputeStatus: disputeStatusSchema,
          requestedAtMs: epochSchema,
          updatedAtMs: epochSchema,
          reviewerRole: reviewerRoleSchema,
          requester: {
            type: "object",
            additionalProperties: false,
            required: ["userAccountId", "accountCreatedAtMs", "verifiedPlayers"],
            properties: {
              userAccountId: { type: "string", pattern: "^user_account\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$" },
              accountCreatedAtMs: epochSchema,
              verifiedPlayers: { type: "array", maxItems: 10, items: playerRefSchema },
            },
          },
          player: {
            type: "object",
            additionalProperties: false,
            required: [
              "playerId", "username", "displayName", "tournamentNights", "lastNightName", "lastNightDate",
              "directorNames", "conservativeRating", "publishedTimeTrials", "otherOpenClaims",
            ],
            properties: {
              ...playerRefSchema.properties,
              tournamentNights: { type: "integer", minimum: 0 },
              lastNightName: nullableName,
              lastNightDate: { anyOf: [{ type: "string", maxLength: 10 }, { type: "null" }] },
              directorNames: { type: "array", maxItems: 10, items: nameSchema },
              conservativeRating: { anyOf: [{ type: "number" }, { type: "null" }] },
              publishedTimeTrials: { type: "integer", minimum: 0 },
              otherOpenClaims: { type: "integer", minimum: 0 },
            },
          },
          conflicts: {
            type: "object",
            additionalProperties: false,
            required: ["playerAlreadyLinked", "sharedTournament"],
            properties: {
              playerAlreadyLinked: { type: "boolean" },
              sharedTournament: nullableName,
            },
          },
          notes: notesSchema,
        },
      },
    },
    linked: {
      type: "array",
      maxItems: 300,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["playerClaimId", "player", "accountPlayers", "linkedAtMs", "reviewerRole"],
        properties: {
          playerClaimId: claimIdSchema,
          player: playerRefSchema,
          accountPlayers: { type: "array", maxItems: 10, items: playerRefSchema },
          linkedAtMs: epochSchema,
          reviewerRole: reviewerRoleSchema,
        },
      },
    },
  },
} as const;

type ErrorResponse = Readonly<{ code: string; message: string }>;

function failure(error: unknown): Readonly<{ status: 401 | 403 | 503; body: ErrorResponse }> {
  const code = error instanceof ClaimReviewReadError ? error.code : "unavailable";
  if (code === "not_authenticated") {
    return { status: 401, body: { code: "claim_authentication_required", message: "Sign in to manage Player claims." } };
  }
  if (code === "not_authorized") {
    return { status: 403, body: { code: "claim_directory_forbidden", message: "Player claims are not available for this actor." } };
  }
  return { status: 503, body: { code: "claim_product_unavailable", message: "Player claims are temporarily unavailable." } };
}

const errorResponses = {
  401: errorResponseSchema,
  403: errorResponseSchema,
  503: errorResponseSchema,
} as const;

/** The claim walk of ADR-0216: what the person asking sees, and the reviewer's cards. */
export async function registerClaimReviewRoutes(
  app: FastifyInstance,
  options: Readonly<{
    resolveActor: ActorResolver;
    service: Pick<ClaimReviewReadService, "listMyClaimWalk" | "listReviewQueue">;
  }>,
): Promise<void> {
  app.get<{
    Reply: { schemaVersion: "mk8dx.account-player-claim-walk.v1"; claims: readonly AccountClaimWalkItem[] } | ErrorResponse;
  }>(
    "/v1/me/player-claim-walk",
    { schema: { response: { 200: accountClaimWalkSchema, ...errorResponses } } },
    async (request, reply) => {
      try {
        const claims = await options.service.listMyClaimWalk(await options.resolveActor(request));
        return { schemaVersion: "mk8dx.account-player-claim-walk.v1", claims };
      } catch (error) {
        const mapped = failure(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );

  app.get<{
    Reply: ({ schemaVersion: "mk8dx.player-claim-review-queue.v1" } & ClaimReviewQueue) | ErrorResponse;
  }>(
    "/v1/player-claim-reviews",
    { schema: { response: { 200: claimReviewQueueSchema, ...errorResponses } } },
    async (request, reply) => {
      try {
        const queue = await options.service.listReviewQueue(await options.resolveActor(request));
        return { schemaVersion: "mk8dx.player-claim-review-queue.v1", ...queue };
      } catch (error) {
        const mapped = failure(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );
}
