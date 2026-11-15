import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { ActorResolver } from "../identity/types.js";
import { MutationRateLimitExceeded } from "./mysql-mutation-rate-limiter.js";
import type { PreAuthBudget } from "./pre-auth-budget.js";
import {
  STEP_UP_HEADER,
  STEP_UP_LINK_PATH,
  STEP_UP_PATH,
  STEP_UP_SCHEMA_VERSION,
  stepUpPolicyFor,
  stepUpRequiredBody,
} from "./step-up-policy.js";
import {
  StepUpRateLimited,
  StepUpUnavailable,
  type StepUpClientKind,
  type StepUpService,
  type StepUpSession,
} from "./step-up-service.js";

/** The Better Auth session behind a request (cookie or bearer), or null when signed out. */
export type StepUpSessionResolver = (request: FastifyRequest) => Promise<StepUpSession | null>;

export type StepUpRouteOptions = Readonly<{
  service: Pick<StepUpService, "request" | "status" | "inspectLink" | "confirmLink" | "authorize" | "windowSeconds">;
  resolveSession: StepUpSessionResolver;
  resolveActor: ActorResolver;
  /** Origins a browser request to send a link must come from. */
  trustedOrigins: readonly string[];
  /** Per-address budget for the unauthenticated confirmation endpoint. */
  preAuthBudget: Pick<PreAuthBudget, "consume">;
}>;

const errorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "message"],
  properties: { code: { type: "string" }, message: { type: "string" } },
} as const;

// Read by the web's step-up-client.ts and Android's AndroidStepUpClient.kt; tests bind both sides.
const statusSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "active", "expiresAtMs", "pending", "windowSeconds"],
  properties: {
    schemaVersion: { type: "string", const: STEP_UP_SCHEMA_VERSION },
    active: { type: "boolean" },
    expiresAtMs: { type: ["integer", "null"] },
    pending: { type: "boolean" },
    windowSeconds: { type: "integer" },
  },
} as const;

function clientKindOf(request: FastifyRequest): StepUpClientKind {
  const authorization = request.headers.authorization;
  return typeof authorization === "string" && /^bearer\s/i.test(authorization) ? "native" : "web";
}

function failure(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ code, message });
}

/**
 * The guard: a dangerous route (step-up-policy.ts) answers 403 `step_up_required` unless this session
 * confirmed a fresh e-mail link within the window. It runs before the route's own checks and never
 * replaces them: a signed-out request, or a caller without administrator rights on an
 * administrator route, continues to the route and meets the refusal it always met.
 */
/**
 * The guard runs at onRequest: the route is already known there, the body is not read yet, and app.ts
 * registers it before the H1 mutation backstop, so a refused dangerous request costs no budget (its
 * refusal audit is bounded on its own). The step-up routes themselves are not guarded and stay behind
 * the backstop and their own per-account budget.
 */
export function registerStepUpGuard(app: FastifyInstance, options: StepUpRouteOptions): void {
  app.addHook("onRequest", async (request, reply) => {
    const policy = stepUpPolicyFor(request.method, request.routeOptions?.url);
    if (policy === null) { return; }
    const session = await options.resolveSession(request);
    if (session === null) { return; }
    if (policy.audience === "administrator") {
      const actor = await options.resolveActor(request);
      if (actor.role !== "administrator") { return; }
    }
    if (await options.service.authorize(session, policy.url)) { return; }
    void reply.header(STEP_UP_HEADER, "required");
    void reply.header("cache-control", "no-store");
    // The route's own response schema does not describe this answer, so it is serialized here.
    return reply.code(403).type("application/json; charset=utf-8")
      .serializer((value: unknown) => JSON.stringify(value))
      .send(stepUpRequiredBody(options.service.windowSeconds));
  });
}

export async function registerStepUpRoutes(app: FastifyInstance, options: StepUpRouteOptions): Promise<void> {
  const trusted = new Set(options.trustedOrigins.map((origin) => new URL(origin).origin));
  const window = options.service.windowSeconds;

  app.post(STEP_UP_PATH, {
    schema: {
      response: {
        202: {
          type: "object",
          additionalProperties: false,
          required: ["schemaVersion", "status", "linkExpiresAtMs", "windowSeconds"],
          properties: {
            schemaVersion: { type: "string", const: STEP_UP_SCHEMA_VERSION },
            status: { type: "string", const: "sent" },
            linkExpiresAtMs: { type: "integer" },
            windowSeconds: { type: "integer" },
          },
        },
        401: errorSchema, 403: errorSchema, 409: errorSchema, 429: errorSchema,
      },
    },
  }, async (request, reply) => {
    void reply.header("cache-control", "no-store");
    const session = await options.resolveSession(request);
    if (session === null) {
      return failure(reply, 401, "step_up_unauthenticated", "Sign in again.");
    }
    const clientKind = clientKindOf(request);
    // A browser sends its cookie on any request, so it has to come from this installation's own page.
    // A bearer cannot be attached by another site.
    if (clientKind === "web") {
      const origin = request.headers.origin;
      if (typeof origin !== "string" || !trusted.has(origin)) {
        return failure(reply, 403, "step_up_origin_invalid", "Reload the page and try again.");
      }
    }
    try {
      const sent = await options.service.request(session, clientKind);
      return reply.code(202).send({
        schemaVersion: STEP_UP_SCHEMA_VERSION, status: "sent",
        linkExpiresAtMs: sent.linkExpiresAtMs, windowSeconds: window,
      });
    } catch (error) {
      if (error instanceof StepUpRateLimited) {
        void reply.header("retry-after", String(error.retryAfterSeconds));
        return failure(reply, 429, "step_up_rate_limited", "Too many emails were requested. Try again later.");
      }
      if (error instanceof StepUpUnavailable) {
        return failure(reply, 409, "step_up_unavailable", "This account has no verified email address.");
      }
      throw error;
    }
  });

  app.get(STEP_UP_PATH, {
    schema: { response: { 200: statusSchema, 401: errorSchema } },
  }, async (request, reply) => {
    void reply.header("cache-control", "no-store");
    const session = await options.resolveSession(request);
    if (session === null) {
      return failure(reply, 401, "step_up_unauthenticated", "Sign in again.");
    }
    return reply.send({ schemaVersion: STEP_UP_SCHEMA_VERSION, ...(await options.service.status(session)) });
  });

  app.get<{ Querystring: { token?: string } }>(STEP_UP_LINK_PATH, {
    schema: {
      querystring: {
        type: "object", additionalProperties: false,
        properties: { token: { type: "string", maxLength: 64 } },
      },
      response: {
        200: {
          type: "object",
          additionalProperties: false,
          required: ["schemaVersion", "clientKind", "requestedAtMs", "linkExpiresAtMs", "windowSeconds"],
          properties: {
            schemaVersion: { type: "string", const: STEP_UP_SCHEMA_VERSION },
            clientKind: { type: "string", enum: ["web", "native"] },
            requestedAtMs: { type: "integer" },
            linkExpiresAtMs: { type: "integer" },
            windowSeconds: { type: "integer" },
          },
        },
        404: errorSchema,
      },
    },
  }, async (request, reply) => {
    void reply.header("cache-control", "no-store");
    void reply.header("referrer-policy", "no-referrer");
    const view = await options.service.inspectLink(request.query.token);
    if (view === null) {
      return failure(reply, 404, "step_up_link_invalid", "This link has expired or was already used.");
    }
    return reply.send({ schemaVersion: STEP_UP_SCHEMA_VERSION, ...view, windowSeconds: window });
  });

  app.post<{ Body: { token: string } }>(STEP_UP_LINK_PATH, {
    schema: {
      body: {
        type: "object", additionalProperties: false, required: ["token"],
        properties: { token: { type: "string", maxLength: 64 } },
      },
      response: {
        200: {
          type: "object",
          additionalProperties: false,
          required: ["schemaVersion", "status", "windowSeconds"],
          properties: {
            schemaVersion: { type: "string", const: STEP_UP_SCHEMA_VERSION },
            status: { type: "string", const: "confirmed" },
            windowSeconds: { type: "integer" },
          },
        },
        404: errorSchema, 429: errorSchema,
      },
    },
  }, async (request, reply) => {
    void reply.header("cache-control", "no-store");
    try {
      await options.preAuthBudget.consume(request, "step-up-confirm", 600, 30);
    } catch (error) {
      if (error instanceof MutationRateLimitExceeded) {
        void reply.header("retry-after", String(error.retryAfterSeconds));
        return failure(reply, 429, "step_up_rate_limited", "Too many attempts. Try again later.");
      }
      throw error;
    }
    if ((await options.service.confirmLink(request.body.token)) === null) {
      return failure(reply, 404, "step_up_link_invalid", "This link has expired or was already used.");
    }
    return reply.send({ schemaVersion: STEP_UP_SCHEMA_VERSION, status: "confirmed", windowSeconds: window });
  });
}
