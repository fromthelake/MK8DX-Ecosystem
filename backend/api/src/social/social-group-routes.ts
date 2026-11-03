import type { FastifyInstance } from "fastify";
import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorResolver } from "../identity/types.js";
import type { TimeTrialWebCsrfVerifier } from "../timetrials/submission-routes.js";
import {
  MutationRateLimitExceeded,
  type MutationRateLimiter,
} from "../security/mysql-mutation-rate-limiter.js";
import { SocialGroupError, type SocialGroupService } from "./social-group-service.js";

type ErrorResponse = Readonly<{ code: string; message: string }>;
const groupIdPattern = "^social_group\\.[a-z0-9-]{8,64}$";
const playerIdPattern = "^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$";
const acknowledged = { type: "object", additionalProperties: false, required: ["acknowledged"], properties: { acknowledged: { const: true } } } as const;

function failure(error: unknown): { status: 400 | 401 | 403 | 429 | 503; body: ErrorResponse } {
  if (error instanceof MutationRateLimitExceeded) return {
    status: 429,
    body: {
      code: "social_group_rate_limited",
      message: "Too many Group changes were received. Wait before retrying.",
    },
  };
  const code = error instanceof SocialGroupError ? error.code : "unavailable";
  if (code === "invalid_input") return { status: 400, body: { code: "social_group_invalid", message: "Check the group selection and try again." } };
  if (code === "not_authenticated") return { status: 401, body: { code: "not_authenticated", message: "Sign in to manage Groups." } };
  if (code === "not_allowed" || code === "not_found") return { status: 403, body: { code: "social_group_forbidden", message: "This private Group action is not available to you." } };
  return { status: 503, body: { code: "social_groups_unavailable", message: "Groups are temporarily unavailable." } };
}

export async function registerSocialGroupRoutes(app: FastifyInstance, options: Readonly<{
  resolveActor: ActorResolver;
  service: Pick<SocialGroupService, "listMine" | "create" | "invite" | "respond" | "leave" | "removeMember" | "setRole" | "archive" | "saveRankScope">;
  csrfVerifier?: TimeTrialWebCsrfVerifier;
  rateLimiter?: MutationRateLimiter;
}>): Promise<void> {
  const actor = async (request: Parameters<ActorResolver>[0], write = false) => {
    const resolved = await options.resolveActor(request);
    if (write && options.csrfVerifier !== undefined) {
      const proof = request.headers["x-mk8dx-csrf"];
      if (typeof proof !== "string" || !await options.csrfVerifier.verify(resolved, proof)) throw new SocialGroupError("not_authenticated");
    }
    if (write && options.rateLimiter !== undefined &&
        (resolved.role === "account" || resolved.role === "administrator")) {
      await options.rateLimiter.consume(
        resolved.userAccountId,
        "social-group-mutations-hour",
        3_600,
        200,
      );
    }
    return resolved;
  };
  app.get("/v1/account/groups", { schema: { response: { 400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema, 429: errorResponseSchema, 503: errorResponseSchema } } },
    async (request, reply) => { try { return { schemaVersion: "mk8dx.social-groups.v1", ...await options.service.listMine(await actor(request)) }; } catch (error) { const f = failure(error); return reply.code(f.status).send(f.body); } });
  app.post<{ Body: { name: string } }>("/v1/account/groups", { schema: { body: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 2, maxLength: 80 } } }, response: { 400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema, 429: errorResponseSchema, 503: errorResponseSchema } } },
    async (request, reply) => { try { return reply.code(201).send({ groupId: await options.service.create(await actor(request, true), request.body.name) }); } catch (error) { const f = failure(error); return reply.code(f.status).send(f.body); } });
  const params = { type: "object", additionalProperties: false, required: ["groupId"], properties: { groupId: { type: "string", pattern: groupIdPattern } } } as const;
  app.post<{ Params: { groupId: string }; Body: { playerId: string } }>("/v1/account/groups/:groupId/invitations", { schema: { params, body: { type: "object", additionalProperties: false, required: ["playerId"], properties: { playerId: { type: "string", pattern: playerIdPattern } } }, response: { 200: acknowledged, 400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema, 429: errorResponseSchema, 503: errorResponseSchema } } },
    async (request, reply) => { try { await options.service.invite(await actor(request, true), request.params.groupId, request.body.playerId); return { acknowledged: true }; } catch (error) { const f = failure(error); return reply.code(f.status).send(f.body); } });
  app.put<{ Params: { groupId: string }; Body: { accept: boolean } }>("/v1/account/groups/:groupId/invitation", { schema: { params, body: { type: "object", additionalProperties: false, required: ["accept"], properties: { accept: { type: "boolean" } } }, response: { 200: acknowledged, 400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema, 429: errorResponseSchema, 503: errorResponseSchema } } },
    async (request, reply) => { try { await options.service.respond(await actor(request, true), request.params.groupId, request.body.accept); return { acknowledged: true }; } catch (error) { const f = failure(error); return reply.code(f.status).send(f.body); } });
  app.delete<{ Params: { groupId: string } }>("/v1/account/groups/:groupId/members/me", { schema: { params, response: { 200: acknowledged, 400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema, 429: errorResponseSchema, 503: errorResponseSchema } } },
    async (request, reply) => { try { await options.service.leave(await actor(request, true), request.params.groupId); return { acknowledged: true }; } catch (error) { const f = failure(error); return reply.code(f.status).send(f.body); } });
  const memberParams = { type: "object", additionalProperties: false, required: ["groupId", "playerId"], properties: { groupId: { type: "string", pattern: groupIdPattern }, playerId: { type: "string", pattern: playerIdPattern } } } as const;
  app.delete<{ Params: { groupId: string; playerId: string } }>("/v1/account/groups/:groupId/members/:playerId", { schema: { params: memberParams, response: { 200: acknowledged, 400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema, 429: errorResponseSchema, 503: errorResponseSchema } } },
    async (request, reply) => { try { await options.service.removeMember(await actor(request, true), request.params.groupId, request.params.playerId); return { acknowledged: true }; } catch (error) { const f = failure(error); return reply.code(f.status).send(f.body); } });
  app.put<{ Params: { groupId: string; playerId: string }; Body: { role: "admin" | "member" } }>("/v1/account/groups/:groupId/members/:playerId/role", { schema: { params: memberParams, body: { type: "object", additionalProperties: false, required: ["role"], properties: { role: { type: "string", enum: ["admin", "member"] } } }, response: { 200: acknowledged, 400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema, 429: errorResponseSchema, 503: errorResponseSchema } } },
    async (request, reply) => { try { await options.service.setRole(await actor(request, true), request.params.groupId, request.params.playerId, request.body.role); return { acknowledged: true }; } catch (error) { const f = failure(error); return reply.code(f.status).send(f.body); } });
  app.delete<{ Params: { groupId: string } }>("/v1/account/groups/:groupId", { schema: { params, response: { 200: acknowledged, 400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema, 429: errorResponseSchema, 503: errorResponseSchema } } },
    async (request, reply) => { try { await options.service.archive(await actor(request, true), request.params.groupId); return { acknowledged: true }; } catch (error) { const f = failure(error); return reply.code(f.status).send(f.body); } });
  app.put<{ Body: { global: boolean; rivals: boolean; groupIds: string[] } }>("/v1/account/rank-scope", { schema: { body: { type: "object", additionalProperties: false, required: ["global", "rivals", "groupIds"], properties: { global: { type: "boolean" }, rivals: { type: "boolean" }, groupIds: { type: "array", maxItems: 20, uniqueItems: true, items: { type: "string", pattern: groupIdPattern } } } }, response: { 200: acknowledged, 400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema, 429: errorResponseSchema, 503: errorResponseSchema } } },
    async (request, reply) => { try { await options.service.saveRankScope(await actor(request, true), request.body); return { acknowledged: true }; } catch (error) { const f = failure(error); return reply.code(f.status).send(f.body); } });
}
