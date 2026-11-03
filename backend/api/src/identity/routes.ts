import type { FastifyInstance } from "fastify";

import { canReadPlayerClaim, canReadUserAccount } from "./authorization.js";
import {
  ClaimLifecycleError,
  type AdministratorClaimCommand,
  type ClaimLifecycleService,
  type ClaimNoteCommand,
  type ClaimSnapshot,
  type OpenDisputeCommand,
  type ReleaseOwnClaimCommand,
  type RequestClaimCommand,
} from "./claim-lifecycle-service.js";
import {
  administratorClaimActionBodySchema,
  claimMutationResponseSchema,
  claimReplyBodySchema,
  errorResponseSchema,
  openClaimDisputeBodySchema,
  playerClaimIdParamsSchema,
  playerIdParamsSchema,
  privatePlayerClaimSummarySchema,
  privateUserAccountSummarySchema,
  publicPlayerProfileSchema,
  releaseOwnClaimBodySchema,
  requestPlayerClaimBodySchema,
  userAccountIdParamsSchema,
} from "./schemas.js";
import type {
  ActorContext,
  ActorResolver,
  IdentityReadRepository,
  PrivatePlayerClaimSummary,
  PrivateUserAccountSummary,
  PublicPlayerProfile,
} from "./types.js";

type PlayerParams = { playerId: string };
type UserAccountParams = { userAccountId: string };
type PlayerClaimParams = { playerClaimId: string };
type ErrorResponse = { code: string; message: string };

export type IdentityRouteOptions = Readonly<{
  repository: IdentityReadRepository;
  resolveActor: ActorResolver;
  claimLifecycle?: Pick<
    ClaimLifecycleService,
    "requestClaim" | "administratorAction" | "openDispute" | "releaseOwnClaim" | "replyToClaim"
  >;
  claimCsrfVerifier?: Readonly<{
    verify(actor: ActorContext, token: string): boolean;
  }>;
}>;

const notFound = (): ErrorResponse => ({
  code: "identity_not_found",
  message: "The requested identity resource was not found.",
});

type MutationFailure = Readonly<{
  statusCode: 400 | 403 | 404 | 409 | 500;
  response: ErrorResponse;
}>;

function mutationFailure(error: unknown, hideForbidden: boolean): MutationFailure {
  if (!(error instanceof ClaimLifecycleError)) {
    return {
      statusCode: 500,
      response: {
        code: "claim_operation_failed",
        message: "The claim operation could not be completed.",
      },
    };
  }
  if (error.code === "forbidden") {
    return hideForbidden
      ? { statusCode: 404, response: notFound() }
      : {
          statusCode: 403,
          response: {
            code: "claim_forbidden",
            message: "The claim operation is not authorized.",
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
        code: "invalid_claim_command",
        message: "The claim command is invalid.",
      },
    };
  }
  return {
    statusCode: 409,
    response: {
      code: "claim_conflict",
      message: "The claim operation conflicts with current state.",
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

function validClaimCsrf(
  request: { headers: Readonly<Record<string, unknown>> },
  actor: ActorContext,
  verifier: IdentityRouteOptions["claimCsrfVerifier"],
): boolean {
  if (verifier === undefined) { return true; }
  const token = request.headers["x-mk8dx-csrf"];
  return typeof token === "string" && verifier.verify(actor, token);
}

const csrfFailure = (): ErrorResponse => ({
  code: "claim_csrf_invalid",
  message: "A fresh request proof is required.",
});

export async function registerIdentityRoutes(
  app: FastifyInstance,
  options: IdentityRouteOptions,
): Promise<void> {
  app.get<{ Params: PlayerParams; Reply: PublicPlayerProfile | ErrorResponse }>(
    "/v1/players/:playerId",
    {
      schema: {
        params: playerIdParamsSchema,
        response: {
          200: publicPlayerProfileSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const player = await options.repository.findPublicPlayerById(
        request.params.playerId,
      );
      if (player === null) {
        return reply.code(404).send(notFound());
      }
      return player;
    },
  );

  app.get<{
    Params: UserAccountParams;
    Reply: PrivateUserAccountSummary | ErrorResponse;
  }>(
    "/v1/user-accounts/:userAccountId",
    {
      schema: {
        params: userAccountIdParamsSchema,
        response: {
          200: privateUserAccountSummarySchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = await options.resolveActor(request);
      if (!canReadUserAccount(actor, request.params.userAccountId)) {
        return reply.code(404).send(notFound());
      }
      const account = await options.repository.findUserAccountSummaryById(
        request.params.userAccountId,
      );
      if (account === null) {
        return reply.code(404).send(notFound());
      }
      return account;
    },
  );

  app.get<{
    Params: PlayerClaimParams;
    Reply: PrivatePlayerClaimSummary | ErrorResponse;
  }>(
    "/v1/player-claims/:playerClaimId",
    {
      schema: {
        params: playerClaimIdParamsSchema,
        response: {
          200: privatePlayerClaimSummarySchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = await options.resolveActor(request);
      const claim = await options.repository.findPlayerClaimSummaryById(
        request.params.playerClaimId,
      );
      if (claim === null || !canReadPlayerClaim(actor, claim.userAccountId)) {
        return reply.code(404).send(notFound());
      }
      return claim;
    },
  );

  if (options.claimLifecycle === undefined) {
    return;
  }
  const claimLifecycle = options.claimLifecycle;

  app.post<{
    Body: RequestClaimCommand;
    Reply: ClaimSnapshot | ErrorResponse;
  }>(
    "/v1/player-claims",
    {
      schema: {
        body: requestPlayerClaimBodySchema,
        response: {
          201: claimMutationResponseSchema,
          ...mutationErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        if (!validClaimCsrf(request, actor, options.claimCsrfVerifier)) {
          return reply.code(403).send(csrfFailure());
        }
        const claim = await claimLifecycle.requestClaim(actor, request.body);
        return reply.code(201).send(claim);
      } catch (error) {
        const failure = mutationFailure(error, false);
        return reply.code(failure.statusCode).send(failure.response);
      }
    },
  );

  app.post<{
    Params: PlayerClaimParams;
    Body: Omit<AdministratorClaimCommand, "playerClaimId">;
    Reply: ClaimSnapshot | ErrorResponse;
  }>(
    "/v1/player-claims/:playerClaimId/actions",
    {
      schema: {
        params: playerClaimIdParamsSchema,
        body: administratorClaimActionBodySchema,
        response: {
          200: claimMutationResponseSchema,
          ...mutationErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        if (!validClaimCsrf(request, actor, options.claimCsrfVerifier)) {
          return reply.code(403).send(csrfFailure());
        }
        const claim = await claimLifecycle.administratorAction(actor, {
          playerClaimId: request.params.playerClaimId,
          ...request.body,
        });
        return reply.send(claim);
      } catch (error) {
        const failure = mutationFailure(error, true);
        return reply.code(failure.statusCode).send(failure.response);
      }
    },
  );

  app.post<{
    Params: PlayerClaimParams;
    Body: Omit<OpenDisputeCommand, "playerClaimId">;
    Reply: ClaimSnapshot | ErrorResponse;
  }>(
    "/v1/player-claims/:playerClaimId/disputes",
    {
      schema: {
        params: playerClaimIdParamsSchema,
        body: openClaimDisputeBodySchema,
        response: {
          200: claimMutationResponseSchema,
          ...mutationErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        if (!validClaimCsrf(request, actor, options.claimCsrfVerifier)) {
          return reply.code(403).send(csrfFailure());
        }
        const claim = await claimLifecycle.openDispute(actor, {
          playerClaimId: request.params.playerClaimId,
          ...request.body,
        });
        return reply.send(claim);
      } catch (error) {
        const failure = mutationFailure(error, true);
        return reply.code(failure.statusCode).send(failure.response);
      }
    },
  );

  // The person asking answers a question or unlinks themselves ("This is not me", ADR-0216).
  for (const [path, schema, act] of [
    [
      "/v1/player-claims/:playerClaimId/replies",
      claimReplyBodySchema,
      (actor: ActorContext, playerClaimId: string, body: Readonly<{ note?: string }>) =>
        claimLifecycle.replyToClaim(actor, { playerClaimId, note: body.note ?? "" } satisfies ClaimNoteCommand),
    ],
    [
      "/v1/player-claims/:playerClaimId/release",
      releaseOwnClaimBodySchema,
      (actor: ActorContext, playerClaimId: string, body: Readonly<{ note?: string }>) =>
        claimLifecycle.releaseOwnClaim(actor, {
          playerClaimId,
          ...(body.note === undefined ? {} : { note: body.note }),
        } satisfies ReleaseOwnClaimCommand),
    ],
  ] as const) {
    app.post<{
      Params: PlayerClaimParams;
      Body: Readonly<{ note?: string }>;
      Reply: ClaimSnapshot | ErrorResponse;
    }>(
      path,
      {
        schema: {
          params: playerClaimIdParamsSchema,
          body: schema,
          response: {
            200: claimMutationResponseSchema,
            ...mutationErrorResponses,
          },
        },
      },
      async (request, reply) => {
        try {
          const actor = await options.resolveActor(request);
          if (!validClaimCsrf(request, actor, options.claimCsrfVerifier)) {
            return reply.code(403).send(csrfFailure());
          }
          const claim = await act(actor, request.params.playerClaimId, request.body ?? {});
          return reply.send(claim);
        } catch (error) {
          const failure = mutationFailure(error, true);
          return reply.code(failure.statusCode).send(failure.response);
        }
      },
    );
  }
}
