import type { FastifyInstance } from "fastify";

import { type AbuseBudgets, targetSubject } from "../security/abuse-budgets.js";
import { MutationRateLimitExceeded } from "../security/mysql-mutation-rate-limiter.js";
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
  /** H1: per-account, installation and per-target budgets for claims and their messages. */
  claimBudgets?: AbuseBudgets;
}>;

/**
 * Per-account claim budgets (H1). Self-service covers asking, replying, disputing and giving a claim
 * up; a person does that a few times in total. Reviewers (Directors and administrators) decide many
 * claims on a launch day, administrators most.
 */
export const CLAIM_ACCOUNT_BUDGETS = Object.freeze({
  selfPerHour: 20,
  selfPerDay: 60,
  reviewPerHour: 120,
  administratorReviewPerHour: 600,
});

type ClaimBudgetKind = "request" | "reply" | "dispute" | "release" | "review";

async function consumeClaimBudgets(
  budgets: AbuseBudgets | undefined,
  actor: ActorContext,
  kind: ClaimBudgetKind,
  target: string,
): Promise<void> {
  if (budgets === undefined || (actor.role !== "account" && actor.role !== "administrator")) { return; }
  const limiter = budgets.limiter;
  if (kind === "review") {
    await limiter.consume(actor.userAccountId, "player-claims.review.hour", 3_600,
      actor.role === "administrator"
        ? CLAIM_ACCOUNT_BUDGETS.administratorReviewPerHour
        : CLAIM_ACCOUNT_BUDGETS.reviewPerHour);
  } else {
    await limiter.consume(actor.userAccountId, "player-claims.self.hour", 3_600, CLAIM_ACCOUNT_BUDGETS.selfPerHour);
    await limiter.consume(actor.userAccountId, "player-claims.self.day", 86_400, CLAIM_ACCOUNT_BUDGETS.selfPerDay);
  }
  if (kind === "request") {
    // Every new request reaches all administrators and the Player's Directors.
    await budgets.installation("player-claims.requests", "claimRequestsPerHour", "claimRequestsPerDay");
    await budgets.target(targetSubject("player", target), "player-claims.requests.player",
      "claimRequestsPerPlayerPerDay");
  } else if (kind !== "release") {
    // A reply or dispute reaches the reviewers; a reviewer's action reaches the person asking.
    // Separate counters per direction, so neither side can use up the other's.
    await budgets.installation("player-claims.messages", "claimMessagesPerHour", "claimMessagesPerDay");
    await budgets.target(targetSubject("player-claim", target),
      kind === "review" ? "player-claims.messages.to-requester" : "player-claims.messages.to-reviewers",
      "claimMessagesPerClaimPerDay");
  }
}

const notFound = (): ErrorResponse => ({
  code: "identity_not_found",
  message: "The requested identity resource was not found.",
});

type MutationFailure = Readonly<{
  statusCode: 400 | 403 | 404 | 409 | 429 | 500;
  response: ErrorResponse;
  retryAfterSeconds?: number;
}>;

function mutationFailure(error: unknown, hideForbidden: boolean): MutationFailure {
  if (error instanceof MutationRateLimitExceeded) {
    return {
      statusCode: 429,
      retryAfterSeconds: error.retryAfterSeconds,
      response: { code: "claim_rate_limited", message: "Too many claim changes were received. Wait before retrying." },
    };
  }
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
  if (error.code === "quota_exceeded") {
    return {
      statusCode: 409,
      response: { code: "claim_quota_exceeded", message: "The claim limit was reached." },
    };
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
  429: errorResponseSchema,
  500: errorResponseSchema,
} as const;

type FailureReply = Readonly<{
  header(name: string, value: string): unknown;
  code(statusCode: number): Readonly<{ send(body: ErrorResponse): unknown }>;
}>;

function sendFailure(reply: FailureReply, failure: MutationFailure): unknown {
  if (failure.retryAfterSeconds !== undefined) {
    reply.header("retry-after", String(failure.retryAfterSeconds));
  }
  return reply.code(failure.statusCode).send(failure.response);
}

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
        await consumeClaimBudgets(options.claimBudgets, actor, "request", request.body.playerId);
        const claim = await claimLifecycle.requestClaim(actor, request.body);
        return reply.code(201).send(claim);
      } catch (error) {
        return sendFailure(reply, mutationFailure(error, false)) as never;
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
        await consumeClaimBudgets(options.claimBudgets, actor, "review", request.params.playerClaimId);
        const claim = await claimLifecycle.administratorAction(actor, {
          playerClaimId: request.params.playerClaimId,
          ...request.body,
        });
        return reply.send(claim);
      } catch (error) {
        return sendFailure(reply, mutationFailure(error, true)) as never;
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
        await consumeClaimBudgets(options.claimBudgets, actor, "dispute", request.params.playerClaimId);
        const claim = await claimLifecycle.openDispute(actor, {
          playerClaimId: request.params.playerClaimId,
          ...request.body,
        });
        return reply.send(claim);
      } catch (error) {
        return sendFailure(reply, mutationFailure(error, true)) as never;
      }
    },
  );

  // The person asking answers a question or unlinks themselves ("This is not me", ADR-0216).
  for (const [path, schema, budgetKind, act] of [
    [
      "/v1/player-claims/:playerClaimId/replies",
      claimReplyBodySchema,
      "reply",
      (actor: ActorContext, playerClaimId: string, body: Readonly<{ note?: string }>) =>
        claimLifecycle.replyToClaim(actor, { playerClaimId, note: body.note ?? "" } satisfies ClaimNoteCommand),
    ],
    [
      "/v1/player-claims/:playerClaimId/release",
      releaseOwnClaimBodySchema,
      "release",
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
          await consumeClaimBudgets(options.claimBudgets, actor, budgetKind, request.params.playerClaimId);
          const claim = await act(actor, request.params.playerClaimId, request.body ?? {});
          return reply.send(claim);
        } catch (error) {
          return sendFailure(reply, mutationFailure(error, true)) as never;
        }
      },
    );
  }
}
