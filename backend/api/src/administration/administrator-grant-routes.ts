import type { FastifyInstance } from "fastify";

import {
  AdministratorGrantServiceError,
  type AdministratorGrantService,
  type AdministratorGrantSnapshot,
} from "./administrator-grant-service.js";
import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorContext, ActorResolver } from "../identity/types.js";
import {
  MutationRateLimitExceeded,
  type MutationRateLimiter,
} from "../security/mysql-mutation-rate-limiter.js";

type ErrorResponse = { code: string; message: string };
type GrantBody = { userAccountId: string; reasonCode: string };
type RevokeBody = { reasonCode: string };
type GrantParams = { userAccountId: string };

export type AdministratorGrantRouteOptions = Readonly<{
  resolveActor: ActorResolver;
  service: Pick<AdministratorGrantService, "grantAdministrator" | "revokeAdministrator">;
  csrfVerifier: Readonly<{ verify(actor: ActorContext, token: string): boolean }>;
  rateLimiter: MutationRateLimiter;
}>;

const accountIdSchema = {
  type: "string",
  minLength: 14,
  maxLength: 141,
  pattern: "^user_account\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
} as const;
const reasonCodeSchema = {
  type: "string",
  minLength: 1,
  maxLength: 64,
  pattern: "^[a-z0-9]+(?:[._-][a-z0-9]+)*$",
} as const;
const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "administratorGrantId", "userAccountId", "status", "origin", "revision",
    "lastSequence", "grantedAtMs",
  ],
  properties: {
    administratorGrantId: {
      type: "string",
      pattern: "^administrator_grant\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
    },
    userAccountId: accountIdSchema,
    status: { type: "string", enum: ["active", "revoked"] },
    origin: { type: "string", enum: ["bootstrap_cli", "administrator"] },
    revision: { type: "integer", minimum: 1 },
    lastSequence: { type: "integer", minimum: 1 },
    grantedAtMs: { type: "integer", minimum: 0 },
    revokedAtMs: { type: "integer", minimum: 0 },
  },
} as const;
const errors = {
  400: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  429: errorResponseSchema,
  500: errorResponseSchema,
} as const;

function failure(error: unknown): Readonly<{
  statusCode: 400 | 403 | 404 | 409 | 429 | 500;
  response: ErrorResponse;
}> {
  if (error instanceof MutationRateLimitExceeded) {
    return { statusCode: 429, response: {
      code: "administrator_grant_rate_limited",
      message: "Too many administrator grant actions were received. Wait before retrying.",
    } };
  }
  if (!(error instanceof AdministratorGrantServiceError)) {
    return { statusCode: 500, response: {
      code: "administrator_grant_operation_failed",
      message: "The administrator grant operation could not be completed.",
    } };
  }
  const statuses = { forbidden: 403, not_found: 404, conflict: 409, invalid_command: 400 } as const;
  return {
    statusCode: statuses[error.code],
    response: {
      code: `administrator_grant_${error.code}`,
      message: "The administrator grant operation could not be completed.",
    },
  };
}

function csrfToken(headers: Readonly<Record<string, unknown>>): string | null {
  const value = headers["x-mk8dx-csrf"];
  return typeof value === "string" ? value : null;
}

async function limitAdministratorAction(
  actor: ActorContext,
  rateLimiter: MutationRateLimiter,
): Promise<void> {
  if (actor.role === "account" || actor.role === "administrator") {
    // Grant and revoke share one durable budget, including failed attempts.
    await rateLimiter.consume(actor.userAccountId, "administrator-grants-hour", 3_600, 20);
  }
}

export async function registerAdministratorGrantRoutes(
  app: FastifyInstance,
  options: AdministratorGrantRouteOptions,
): Promise<void> {
  app.post<{ Body: GrantBody; Reply: AdministratorGrantSnapshot | ErrorResponse }>(
    "/v1/administrator-grants",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["userAccountId", "reasonCode"],
          properties: { userAccountId: accountIdSchema, reasonCode: reasonCodeSchema },
        },
        response: { 201: responseSchema, ...errors },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        const token = csrfToken(request.headers);
        if (token === null || !options.csrfVerifier.verify(actor, token)) {
          return reply.code(403).send({
            code: "administrator_grant_csrf_rejected",
            message: "The administrator grant operation is not authorized.",
          });
        }
        await limitAdministratorAction(actor, options.rateLimiter);
        const result = await options.service.grantAdministrator(
          actor,
          request.body.userAccountId,
          request.body.reasonCode,
        );
        return reply.code(201).send(result);
      } catch (error) {
        if (error instanceof MutationRateLimitExceeded) {
          void reply.header("retry-after", String(error.retryAfterSeconds));
        }
        const mapped = failure(error);
        return reply.code(mapped.statusCode).send(mapped.response);
      }
    },
  );

  app.post<{
    Params: GrantParams;
    Body: RevokeBody;
    Reply: AdministratorGrantSnapshot | ErrorResponse;
  }>(
    "/v1/administrator-grants/:userAccountId/actions/revoke",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["userAccountId"],
          properties: { userAccountId: accountIdSchema },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["reasonCode"],
          properties: { reasonCode: reasonCodeSchema },
        },
        response: { 200: responseSchema, ...errors },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        const token = csrfToken(request.headers);
        if (token === null || !options.csrfVerifier.verify(actor, token)) {
          return reply.code(403).send({
            code: "administrator_grant_csrf_rejected",
            message: "The administrator grant operation is not authorized.",
          });
        }
        await limitAdministratorAction(actor, options.rateLimiter);
        return await options.service.revokeAdministrator(
          actor,
          request.params.userAccountId,
          request.body.reasonCode,
        );
      } catch (error) {
        if (error instanceof MutationRateLimitExceeded) {
          void reply.header("retry-after", String(error.retryAfterSeconds));
        }
        const mapped = failure(error);
        return reply.code(mapped.statusCode).send(mapped.response);
      }
    },
  );
}
