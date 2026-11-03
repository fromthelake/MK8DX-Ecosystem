import type { FastifyInstance } from "fastify";

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
import type { ActorResolver } from "./types.js";

type AliasParams = { aliasId: string };
type PlayerParams = { playerId: string };
type ErrorResponse = { code: string; message: string };
type PublicPlayerAliases = Readonly<{
  schemaVersion: "mk8dx.public-player-aliases.v1";
  playerId: string;
  aliases: readonly PublicAliasProfile[];
}>;

export type AliasRouteOptions = Readonly<{
  repository?: AliasReadRepository;
  service?: Pick<AliasService, "createAlias" | "updateAlias">;
  resolveActor: ActorResolver;
}>;

const notFound = (): ErrorResponse => ({
  code: "alias_not_found",
  message: "The requested Alias was not found.",
});

function mutationFailure(
  error: unknown,
  hideForbidden: boolean,
): Readonly<{
  statusCode: 400 | 403 | 404 | 409 | 500;
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
  500: errorResponseSchema,
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
      Reply: PublicPlayerAliases | ErrorResponse;
    }>(
      "/v1/players/:playerId/aliases",
      {
        schema: {
          params: playerIdParamsSchema,
          response: {
            200: publicPlayerAliasesSchema,
            500: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        try {
          return {
            schemaVersion: "mk8dx.public-player-aliases.v1",
            playerId: request.params.playerId,
            aliases: await repository.listPublicAliasesByPlayerId(
              request.params.playerId,
            ),
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
