import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorContext, ActorResolver } from "../identity/types.js";
import {
  DirectorHostRequestError,
  type DirectorHostRequestService,
} from "./director-host-request-service.js";

/**
 * "Request to host" (ADR-0220). The person's own standing and request on the Tournaments page
 * (browser with the CSRF proof, native with the bearer), and the administrators' queue with
 * Approve and Decline in the Directors section.
 */

const epochSchema = { type: "integer", minimum: 0 } as const;
const nullableEpoch = { anyOf: [epochSchema, { type: "null" }] } as const;
const shortText = { type: "string", minLength: 1, maxLength: 300 } as const;
const nullableText = { anyOf: [shortText, { type: "null" }] } as const;
const requestIdSchema = {
  type: "string", maxLength: 180, pattern: "^director_host_request\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
} as const;
const accountIdSchema = { type: "string", maxLength: 141, pattern: "^user_account\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$" } as const;

export const hostRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["requestId", "status", "note", "requestedAtMs", "decidedAtMs", "declineReason"],
  properties: {
    requestId: requestIdSchema,
    status: { type: "string", enum: ["open", "approved", "declined"] },
    note: nullableText,
    requestedAtMs: epochSchema,
    decidedAtMs: nullableEpoch,
    declineReason: nullableText,
  },
} as const;

export const hostRequestStandingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "administrator", "director", "request"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.director-host-request.v1" },
    administrator: { type: "boolean" },
    director: { type: "boolean" },
    request: { anyOf: [hostRequestSchema, { type: "null" }] },
  },
} as const;

export const hostRequestPlayerSchema = {
  type: "object",
  additionalProperties: false,
  required: ["playerId", "username", "displayName"],
  properties: {
    playerId: { type: "string", pattern: "^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$" },
    username: { type: "string", minLength: 1, maxLength: 64 },
    displayName: { type: "string", minLength: 1, maxLength: 128 },
  },
} as const;

export const hostRequestQueueSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "requests"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.director-host-request-queue.v1" },
    requests: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["requestId", "userAccountId", "accountCreatedAtMs", "players", "note", "requestedAtMs"],
        properties: {
          requestId: requestIdSchema,
          userAccountId: accountIdSchema,
          accountCreatedAtMs: epochSchema,
          players: { type: "array", maxItems: 10, items: hostRequestPlayerSchema },
          note: nullableText,
          requestedAtMs: epochSchema,
        },
      },
    },
  },
} as const;

export const hostRequestDecisionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "requestId", "userAccountId", "status", "decidedAtMs"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.director-host-request-decision.v1" },
    requestId: requestIdSchema,
    userAccountId: accountIdSchema,
    status: { type: "string", enum: ["approved", "declined"] },
    decidedAtMs: epochSchema,
  },
} as const;

// The service counts characters and refuses more than 300; the transport bound only keeps a body small.
const noteBody = {
  type: "object",
  additionalProperties: false,
  properties: { note: { type: "string", maxLength: 1200 } },
} as const;
const declineBody = {
  type: "object",
  additionalProperties: false,
  properties: { reason: { type: "string", maxLength: 1200 } },
} as const;
const emptyBody = { type: "object", additionalProperties: false, properties: {} } as const;
const requestParams = {
  type: "object", additionalProperties: false, required: ["requestId"], properties: { requestId: requestIdSchema },
} as const;

const errors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  503: errorResponseSchema,
} as const;

const statuses = {
  not_authenticated: 401,
  forbidden: 403,
  invalid_input: 400,
  already_director: 409,
  already_open: 409,
  not_found: 404,
  conflict: 409,
  unavailable: 503,
} as const;

function send(reply: FastifyReply, error: unknown) {
  if (error instanceof DirectorHostRequestError) {
    return reply.code(statuses[error.code]).send({
      code: `director_host_request_${error.code}`,
      message: error.message,
    });
  }
  return reply.code(503).send({
    code: "director_host_request_unavailable",
    message: "Host requests are temporarily unavailable.",
  });
}

function csrfToken(request: FastifyRequest): string | null {
  const value = request.headers["x-mk8dx-csrf"];
  return typeof value === "string" ? value : null;
}

function requireNativeBearer(request: FastifyRequest): void {
  // Shape-check only, as on the native Tournament routes; resolveActor stays authoritative.
  if (!/^Bearer [^\s]{20,512}$/i.test(request.headers.authorization ?? "")) {
    throw new DirectorHostRequestError("not_authenticated", "A native-app bearer token is required.");
  }
}

export async function registerDirectorHostRequestRoutes(
  app: FastifyInstance,
  options: Readonly<{
    resolveActor: ActorResolver;
    service: Pick<DirectorHostRequestService, "standing" | "submit" | "queue" | "approve" | "decline">;
    csrfVerifier: Readonly<{ verify(actor: ActorContext, token: string): boolean }>;
  }>,
): Promise<void> {
  const browserWriter = async (request: FastifyRequest): Promise<ActorContext> => {
    const actor = await options.resolveActor(request);
    const token = csrfToken(request);
    if (token === null || !options.csrfVerifier.verify(actor, token)) {
      throw new DirectorHostRequestError("forbidden", "The request is not authorized.");
    }
    return actor;
  };
  const nativeActor = async (request: FastifyRequest): Promise<ActorContext> => {
    requireNativeBearer(request);
    return await options.resolveActor(request);
  };
  const standing = (document: Awaited<ReturnType<DirectorHostRequestService["standing"]>>) => ({
    schemaVersion: "mk8dx.director-host-request.v1" as const,
    ...document,
  });

  for (const [path, resolve, writer] of [
    ["/v1/me/director-host-request", options.resolveActor, browserWriter],
    ["/v1/native/director-host-request", nativeActor, nativeActor],
  ] as const) {
    app.get(path, { schema: { response: { 200: hostRequestStandingSchema, ...errors } } }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        return standing(await options.service.standing(await resolve(request)));
      } catch (error) {
        return send(reply, error);
      }
    });
    app.post<{ Body: { note?: string } }>(
      path,
      { schema: { body: noteBody, response: { 201: hostRequestStandingSchema, ...errors } } },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        try {
          const actor = await writer(request);
          return reply.code(201).send(standing(await options.service.submit(actor, request.body?.note)));
        } catch (error) {
          return send(reply, error);
        }
      },
    );
  }

  app.get(
    "/v1/administrator/director-host-requests",
    { schema: { response: { 200: hostRequestQueueSchema, ...errors } } },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        const requests = await options.service.queue(await options.resolveActor(request));
        return { schemaVersion: "mk8dx.director-host-request-queue.v1" as const, requests };
      } catch (error) {
        return send(reply, error);
      }
    },
  );

  app.post<{ Params: { requestId: string }; Body: Record<string, never> }>(
    "/v1/administrator/director-host-requests/:requestId/actions/approve",
    { schema: { params: requestParams, body: emptyBody, response: { 200: hostRequestDecisionSchema, ...errors } } },
    async (request, reply) => {
      try {
        const decision = await options.service.approve(await browserWriter(request), request.params.requestId);
        return { schemaVersion: "mk8dx.director-host-request-decision.v1" as const, ...decision };
      } catch (error) {
        return send(reply, error);
      }
    },
  );

  app.post<{ Params: { requestId: string }; Body: { reason?: string } }>(
    "/v1/administrator/director-host-requests/:requestId/actions/decline",
    { schema: { params: requestParams, body: declineBody, response: { 200: hostRequestDecisionSchema, ...errors } } },
    async (request, reply) => {
      try {
        const decision = await options.service.decline(
          await browserWriter(request), request.params.requestId, request.body?.reason,
        );
        return { schemaVersion: "mk8dx.director-host-request-decision.v1" as const, ...decision };
      } catch (error) {
        return send(reply, error);
      }
    },
  );
}
