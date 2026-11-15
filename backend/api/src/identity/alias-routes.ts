import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  AliasServiceError,
  type AliasReadRepository,
  type AliasService,
  type AliasSnapshot,
  type CreateAliasCommand,
  type PublicAliasProfile,
  type UpdateAliasCommand,
} from "./alias-service.js";
import {
  aliasIdParamsSchema,
  aliasMutationResponseSchema,
  createAliasBodySchema,
  publicAliasProfileSchema,
  publicPlayerAliasesSchema,
  updateAliasBodySchema,
} from "./alias-schemas.js";
import { errorResponseSchema, playerIdParamsSchema } from "./schemas.js";
import type { ActorContext, ActorResolver } from "./types.js";
import type { InstallationBudget } from "../security/abuse-budgets.js";
import {
  MutationRateLimitExceeded,
  type MutationRateLimiter,
} from "../security/mysql-mutation-rate-limiter.js";

type AliasParams = { aliasId: string };
type PlayerParams = { playerId: string };
type PlayerAliasQuery = { limit?: string; after?: string };
type ErrorResponse = { code: string; message: string };
type PublicPlayerAliases = Readonly<{
  schemaVersion: "mk8dx.public-player-aliases.v1";
  playerId: string;
  aliases: readonly PublicAliasProfile[];
  nextAfter?: string;
}>;

/** Alias writes per account and hour (an administrator reconciles in larger batches). */
export const ALIAS_MUTATIONS_PER_ACCOUNT_HOUR = 30;
export const ALIAS_MUTATIONS_PER_ADMINISTRATOR_HOUR = 300;
export const PUBLIC_ALIAS_PAGE_DEFAULT = 100;

export type AliasRouteOptions = Readonly<{
  repository?: AliasReadRepository;
  service?: Pick<AliasService, "createAlias" | "updateAlias">;
  resolveActor: ActorResolver;
  /** Durable per-account budget for alias writes, shared by API processes. */
  rateLimiter?: MutationRateLimiter;
  /** H1: the installation-wide budget for this path, consumed after the caller's own budget. */
  installationBudget?: InstallationBudget;
  /** A browser (cookie) write must carry the session's CSRF proof when this is configured. */
  csrfVerifier?: Readonly<{ verify(actor: ActorContext, proof: string): boolean | Promise<boolean> }>;
}>;

const notFound = (): ErrorResponse => ({
  code: "alias_not_found",
  message: "The requested Alias was not found.",
});

function mutationFailure(
  error: unknown,
  hideForbidden: boolean,
): Readonly<{
  statusCode: 400 | 403 | 404 | 409 | 429 | 500;
  response: ErrorResponse;
}> {
  if (!(error instanceof AliasServiceError)) {
    return {
      statusCode: 500,
      response: {
        code: "alias_operation_failed",
        message: "The Alias operation could not be completed.",
      },
    };
  }
  if (error.code === "forbidden") {
    return hideForbidden
      ? { statusCode: 404, response: notFound() }
      : {
          statusCode: 403,
          response: {
            code: "alias_forbidden",
            message: "The Alias operation is not authorized.",
          },
        };
  }
  if (error.code === "not_found") {
    return { statusCode: 404, response: notFound() };
  }
  if (error.code === "quota_exceeded") {
    return {
      statusCode: 409,
      response: {
        code: "alias_quota_exceeded",
        message: "This Player has reached the maximum number of names.",
      },
    };
  }
  if (error.code === "invalid_command") {
    return {
      statusCode: 400,
      response: {
        code: "invalid_alias_command",
        message: "The Alias command is invalid.",
      },
    };
  }
  return {
    statusCode: 409,
    response: {
      code: "alias_conflict",
      message: "The Alias operation conflicts with current state.",
    },
  };
}

const mutationErrorResponses = {
  400: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  429: errorResponseSchema,
  500: errorResponseSchema,
} as const;

const playerAliasQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: "^(?:[1-9][0-9]?|100)$" },
    after: aliasIdParamsSchema.properties.aliasId,
  },
} as const;

export async function registerAliasRoutes(
  app: FastifyInstance,
  options: AliasRouteOptions,
): Promise<void> {
  if (options.repository !== undefined) {
    const repository = options.repository;
    app.get<{
      Params: AliasParams;
      Reply: PublicAliasProfile | ErrorResponse;
    }>(
      "/v1/aliases/:aliasId",
      {
        schema: {
          params: aliasIdParamsSchema,
          response: {
            200: publicAliasProfileSchema,
            404: errorResponseSchema,
            500: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        try {
          const alias = await repository.findPublicAliasById(request.params.aliasId);
          return alias === null ? reply.code(404).send(notFound()) : alias;
        } catch {
          return reply.code(500).send({
            code: "alias_read_failed",
            message: "The Alias could not be read.",
          });
        }
      },
    );
    app.get<{
      Params: PlayerParams;
      Querystring: PlayerAliasQuery;
      Reply: PublicPlayerAliases | ErrorResponse;
    }>(
      "/v1/players/:playerId/aliases",
      {
        schema: {
          params: playerIdParamsSchema,
          querystring: playerAliasQuerySchema,
          response: {
            200: publicPlayerAliasesSchema,
            500: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        try {
          // Pages are opt-in: without `limit`/`after` the answer keeps its earlier shape (at most
          // 100 names, no `nextAfter`), which existing clients parse exactly.
          const paged = request.query.limit !== undefined || request.query.after !== undefined;
          const limit = request.query.limit === undefined
            ? PUBLIC_ALIAS_PAGE_DEFAULT : Number(request.query.limit);
          const rows = await repository.listPublicAliasesByPlayerId(
            request.params.playerId,
            { limit: paged ? limit + 1 : limit,
              ...(request.query.after === undefined ? {} : { after: request.query.after }) },
          );
          const page = rows.slice(0, limit);
          return {
            schemaVersion: "mk8dx.public-player-aliases.v1",
            playerId: request.params.playerId,
            aliases: page,
            ...(paged && rows.length > limit ? { nextAfter: page[page.length - 1]!.aliasId } : {}),
          };
        } catch {
          return reply.code(500).send({
            code: "alias_read_failed",
            message: "The Aliases could not be read.",
          });
        }
      },
    );
  }

  if (options.service === undefined) {
    return;
  }
  const service = options.service;
  /** CSRF proof for a browser write, then the account budget; null when the request may proceed. */
  const guard = async (
    actor: ActorContext,
    request: FastifyRequest,
  ): Promise<Readonly<{ statusCode: 403 | 429 | 500; response: ErrorResponse; retryAfter?: number }> | null> => {
    if (actor.role !== "account" && actor.role !== "administrator") { return null; }
    const proof = request.headers["x-mk8dx-csrf"];
    if (options.csrfVerifier !== undefined && request.headers.authorization === undefined &&
        (typeof proof !== "string" || !await options.csrfVerifier.verify(actor, proof))) {
      return { statusCode: 403, response: { code: "alias_csrf_invalid", message: "Reload the page and try again." } };
    }
    if (options.rateLimiter === undefined) { return null; }
    try {
      await options.rateLimiter.consume(actor.userAccountId, "alias-mutations-hour", 3_600,
        actor.role === "administrator" ? ALIAS_MUTATIONS_PER_ADMINISTRATOR_HOUR : ALIAS_MUTATIONS_PER_ACCOUNT_HOUR);
      await options.installationBudget?.consume();
      return null;
    } catch (error) {
      if (error instanceof MutationRateLimitExceeded) {
        return { statusCode: 429, retryAfter: error.retryAfterSeconds,
          response: { code: "alias_rate_limited", message: "Too many name changes. Wait before retrying." } };
      }
      return { statusCode: 500, response: { code: "alias_operation_failed", message: "The Alias operation could not be completed." } };
    }
  };
  app.post<{
    Body: CreateAliasCommand;
    Reply: AliasSnapshot | ErrorResponse;
  }>(
    "/v1/aliases",
    {
      schema: {
        body: createAliasBodySchema,
        response: {
          201: aliasMutationResponseSchema,
          ...mutationErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        const refused = await guard(actor, request);
        if (refused !== null) {
          if (refused.retryAfter !== undefined) { void reply.header("retry-after", String(refused.retryAfter)); }
          return reply.code(refused.statusCode).send(refused.response);
        }
        const alias = await service.createAlias(actor, request.body);
        return reply.code(201).send(alias);
      } catch (error) {
        const failure = mutationFailure(error, false);
        return reply.code(failure.statusCode).send(failure.response);
      }
    },
  );

  app.post<{
    Params: AliasParams;
    Body: Omit<UpdateAliasCommand, "aliasId">;
    Reply: AliasSnapshot | ErrorResponse;
  }>(
    "/v1/aliases/:aliasId/actions",
    {
      schema: {
        params: aliasIdParamsSchema,
        body: updateAliasBodySchema,
        response: {
          200: aliasMutationResponseSchema,
          ...mutationErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        const refused = await guard(actor, request);
        if (refused !== null) {
          if (refused.retryAfter !== undefined) { void reply.header("retry-after", String(refused.retryAfter)); }
          return reply.code(refused.statusCode).send(refused.response);
        }
        const alias = await service.updateAlias(actor, {
          aliasId: request.params.aliasId,
          ...request.body,
        } as UpdateAliasCommand);
        return reply.send(alias);
      } catch (error) {
        const failure = mutationFailure(error, true);
        return reply.code(failure.statusCode).send(failure.response);
      }
    },
  );
}
