import type { FastifyInstance } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorResolver } from "../identity/types.js";
import {
  PlayerClaimProductError,
  type AccountPlayerClaimSummary,
  type ClaimablePlayerSummary,
  type LinkedPlayerAccountSummary,
  type PlayerClaimProductService,
} from "./player-claim-product-service.js";

const playerSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["playerId", "username", "displayName", "aliases"],
  properties: {
    playerId: { type: "string", pattern: "^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$" },
    username: { type: "string", minLength: 1, maxLength: 64 },
    displayName: { type: "string", minLength: 1, maxLength: 128 },
    // Public active aliases, so a roster or workbook import can resolve a name
    // that is not the display name. ADR-0006: a name match never approves a
    // claim and never merges identities.
    aliases: {
      type: "array",
      maxItems: 32,
      items: { type: "string", minLength: 1, maxLength: 128 },
    },
  },
} as const;

const claimSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["playerClaimId", "playerId", "playerUsername", "playerDisplayName", "claimStatus", "disputeStatus", "updatedAtMs"],
  properties: {
    playerClaimId: { type: "string", pattern: "^player_claim\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$" },
    playerId: playerSummarySchema.properties.playerId,
    playerUsername: playerSummarySchema.properties.username,
    playerDisplayName: playerSummarySchema.properties.displayName,
    claimStatus: { type: "string", enum: ["requested", "under_review", "verified", "rejected", "released", "revoked"] },
    disputeStatus: { type: "string", enum: ["none", "open", "resolved"] },
    updatedAtMs: { type: "integer", minimum: 0 },
  },
} as const;

export const accountPlayerClaimsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "claims"],
  properties: {
    schemaVersion: {
      type: "string", const: "mk8dx.account-player-claims.v1",
    },
    claims: { type: "array", maxItems: 20, items: claimSummarySchema },
  },
} as const;

type ErrorResponse = Readonly<{ code: string; message: string }>;
type SearchReply = Readonly<{
  schemaVersion: "mk8dx.player-directory.v1";
  players: readonly ClaimablePlayerSummary[];
}>;
type ClaimsReply = Readonly<{
  schemaVersion: "mk8dx.account-player-claims.v1";
  claims: readonly AccountPlayerClaimSummary[];
}>;
type ReviewQueueReply = Readonly<{
  schemaVersion: "mk8dx.administrator-player-claim-queue.v1";
  claims: readonly AccountPlayerClaimSummary[];
}>;
type LinkedAccountsReply = Readonly<{
  schemaVersion: "mk8dx.administrator-linked-player-accounts.v1";
  players: readonly LinkedPlayerAccountSummary[];
}>;

function failure(error: unknown): Readonly<{
  status: 400 | 401 | 403 | 503;
  body: ErrorResponse;
}> {
  const code = error instanceof PlayerClaimProductError
    ? error.code
    : "unavailable";
  if (code === "invalid_query") {
    return { status: 400, body: { code: "invalid_player_query", message: "Enter at least two valid characters." } };
  }
  if (code === "not_authenticated") {
    return { status: 401, body: { code: "claim_authentication_required", message: "Sign in to manage Player claims." } };
  }
  if (code === "not_authorized") {
    return { status: 403, body: { code: "claim_directory_forbidden", message: "Player claims are not available for this actor." } };
  }
  return { status: 503, body: { code: "claim_product_unavailable", message: "Player claims are temporarily unavailable." } };
}

export async function registerPlayerClaimProductRoutes(
  app: FastifyInstance,
  options: Readonly<{
    resolveActor: ActorResolver;
    service: Pick<
      PlayerClaimProductService,
      "search" | "searchPublic" | "list" | "listMine" | "listReviewQueue" |
      "listLinkedPlayerAccounts"
    >;
  }>,
): Promise<void> {
  app.get<{ Querystring: { query: string }; Reply: SearchReply | ErrorResponse }>(
    "/v1/public/player-directory",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["query"],
          properties: { query: { type: "string", minLength: 2, maxLength: 64 } },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["schemaVersion", "players"],
            properties: {
              schemaVersion: { type: "string", const: "mk8dx.player-directory.v1" },
              players: { type: "array", maxItems: 20, items: playerSummarySchema },
            },
          },
          400: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const players = await options.service.searchPublic(request.query.query);
        return { schemaVersion: "mk8dx.player-directory.v1", players };
      } catch (error) {
        const mapped = failure(error);
        return reply.code(mapped.status === 400 ? 400 : 503).send(mapped.body);
      }
    },
  );

  app.get<{ Querystring: { query?: string }; Reply: SearchReply | ErrorResponse }>(
    "/v1/player-directory",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { query: { type: "string", minLength: 2, maxLength: 64 } },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["schemaVersion", "players"],
            properties: {
              schemaVersion: { type: "string", const: "mk8dx.player-directory.v1" },
              players: { type: "array", maxItems: 500, items: playerSummarySchema },
            },
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        const players = request.query.query === undefined
          ? await options.service.list(actor)
          : await options.service.search(actor, request.query.query);
        return { schemaVersion: "mk8dx.player-directory.v1", players };
      } catch (error) {
        const mapped = failure(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );

  app.get<{ Reply: ClaimsReply | ErrorResponse }>(
    "/v1/me/player-claims",
    {
      schema: {
        response: {
          200: accountPlayerClaimsSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const claims = await options.service.listMine(await options.resolveActor(request));
        return { schemaVersion: "mk8dx.account-player-claims.v1", claims };
      } catch (error) {
        const mapped = failure(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );

  // Who is who, for an administrator granting a capability by name.
  app.get<{ Reply: LinkedAccountsReply | ErrorResponse }>(
    "/v1/administrator/linked-player-accounts",
    {
      schema: {
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["schemaVersion", "players"],
            properties: {
              schemaVersion: {
                type: "string",
                const: "mk8dx.administrator-linked-player-accounts.v1",
              },
              players: {
                type: "array",
                maxItems: 500,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["playerId", "username", "displayName", "userAccountId"],
                  properties: {
                    playerId: playerSummarySchema.properties.playerId,
                    username: playerSummarySchema.properties.username,
                    displayName: playerSummarySchema.properties.displayName,
                    userAccountId: {
                      type: "string",
                      pattern: "^user_account\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
                    },
                  },
                },
              },
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
        const players = await options.service.listLinkedPlayerAccounts(
          await options.resolveActor(request),
        );
        return {
          schemaVersion: "mk8dx.administrator-linked-player-accounts.v1",
          players,
        };
      } catch (error) {
        const mapped = failure(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );

  app.get<{ Reply: ReviewQueueReply | ErrorResponse }>(
    "/v1/administrator/player-claims",
    {
      schema: {
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["schemaVersion", "claims"],
            properties: {
              schemaVersion: {
                type: "string",
                const: "mk8dx.administrator-player-claim-queue.v1",
              },
              claims: { type: "array", maxItems: 50, items: claimSummarySchema },
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
        const claims = await options.service.listReviewQueue(
          await options.resolveActor(request),
        );
        return {
          schemaVersion: "mk8dx.administrator-player-claim-queue.v1",
          claims,
        };
      } catch (error) {
        const mapped = failure(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );
}
