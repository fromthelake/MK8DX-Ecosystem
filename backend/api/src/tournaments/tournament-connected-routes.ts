import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { ActorResolver } from "../identity/types.js";
import type { ActorContext } from "../identity/types.js";
import { MutationRateLimitExceeded } from "../security/mysql-mutation-rate-limiter.js";
import { TournamentOperationError } from "./tournament-operation-service.js";
import {
  TournamentEvidenceLimitError,
  type TournamentConnectedService,
} from "./tournament-connected-service.js";

/**
 * F04: the answers a refused evidence upload gets. Nothing was stored; the
 * client keeps its local copy. 429 carries Retry-After; a full quota (409)
 * clears when the Director links or dismisses records or retention runs.
 */
export function evidenceLimitFailure(error: unknown, prefix: string): {
  status: number; retryAfterSeconds?: number; body: { code: string; message: string };
} | null {
  if (error instanceof MutationRateLimitExceeded) {
    return {
      status: 429, retryAfterSeconds: error.retryAfterSeconds,
      body: { code: `${prefix}evidence_rate_limited`, message: "Too many evidence uploads; try again later." },
    };
  }
  if (error instanceof TournamentEvidenceLimitError) {
    if (error.limit === "record_bytes") {
      return { status: 413, body: { code: `${prefix}evidence_record_too_large`, message: error.message } };
    }
    if (error.retryAfterSeconds !== undefined) {
      return {
        status: 429, retryAfterSeconds: error.retryAfterSeconds,
        body: { code: `${prefix}evidence_rate_limited`, message: error.message },
      };
    }
    return { status: 409, body: { code: `${prefix}evidence_quota_exceeded`, message: error.message } };
  }
  return null;
}

/**
 * F05: one capture delegation as the administrator routes serve it. The web
 * Director view parses exactly these keys (tournament-incoming-client.ts).
 */
export const liveCaptureDelegationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "delegationId", "tournamentId", "delegateUserAccountId", "delegateDisplayName", "status", "reason",
    "grantedByUserAccountId", "grantedAtMs", "expiresAtMs", "revokedByUserAccountId", "revokeReason", "revokedAtMs",
  ],
  properties: {
    delegationId: { type: "string" },
    tournamentId: { type: "string" },
    delegateUserAccountId: { type: "string" },
    delegateDisplayName: { type: "string" },
    status: { type: "string", enum: ["active", "revoked"] },
    reason: { type: "string" },
    grantedByUserAccountId: { type: "string" },
    grantedAtMs: { type: "integer" },
    expiresAtMs: { type: "integer" },
    revokedByUserAccountId: { type: ["string", "null"] },
    revokeReason: { type: ["string", "null"] },
    revokedAtMs: { type: ["integer", "null"] },
  },
} as const;

const liveCaptureDelegationListSchema = {
  type: "object",
  additionalProperties: false,
  required: ["delegations"],
  properties: { delegations: { type: "array", maxItems: 200, items: liveCaptureDelegationSchema } },
} as const;

const liveCaptureDelegationDocumentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["delegation"],
  properties: { delegation: liveCaptureDelegationSchema },
} as const;

function requireBearer(request: FastifyRequest): void {
  if (!/^Bearer\s+\S+$/i.test(request.headers.authorization ?? "")) {
    throw new TournamentOperationError("forbidden", "A native-app bearer token is required.");
  }
}

export function registerTournamentConnectedRoutes(app: FastifyInstance, dependencies: {
  resolveActor: ActorResolver;
  tournamentConnected: TournamentConnectedService;
  csrfVerifier: Readonly<{ verify(actor: ActorContext, token: string): boolean }>;
}): void {
  const handle = async <T>(reply: FastifyReply, work: () => Promise<T>): Promise<T> => {
    try { return await work(); } catch (error) {
      const limited = evidenceLimitFailure(error, "tournament_");
      if (limited !== null) {
        if (limited.retryAfterSeconds !== undefined) void reply.header("retry-after", String(limited.retryAfterSeconds));
        return reply.code(limited.status).send(limited.body) as T;
      }
      if (error instanceof TournamentOperationError) {
        const status = error.code === "forbidden" ? 403 : error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 400;
        return reply.code(status).send({ code: `tournament_${error.code}`, message: error.message }) as T;
      }
      throw error;
    }
  };
  app.get("/v1/tournament-connections", async (request, reply) => handle(reply, async () => {
    requireBearer(request);
    const actor = await dependencies.resolveActor(request);
    return { tournaments: await dependencies.tournamentConnected.listEligible(actor) };
  }));

  app.post("/v1/tournament-incoming-results", async (request, reply) => handle(reply, async () => {
    requireBearer(request);
    const actor = await dependencies.resolveActor(request);
    const body = request.body as {
      tournamentId: string;
      entries: readonly {
        result: unknown;
        suggestedPhase?: string;
        suggestedGroupId?: string;
        suggestedRaceNumber?: number;
        occurredAtMs?: number;
      }[];
    };
    return { results: await dependencies.tournamentConnected.upload(actor, body) };
  }));

  app.post("/v1/tournament-evidence-records", async (request, reply) => handle(reply, async () => {
    requireBearer(request);
    const actor = await dependencies.resolveActor(request);
    const body = request.body as Parameters<TournamentConnectedService["uploadEvidenceRecord"]>[1];
    return { record: await dependencies.tournamentConnected.uploadEvidenceRecord(actor, body) };
  }));

  app.post("/v1/tournament-evidence-records/:recordId/actions/stopping", async (request, reply) => handle(reply, async () => {
    requireBearer(request);
    const actor = await dependencies.resolveActor(request);
    const { recordId } = request.params as { recordId: string };
    return { record: await dependencies.tournamentConnected.markLiveStopping(actor, recordId) };
  }));

  app.get("/v1/public/tournaments/:tournamentId/live-standings", async (request) => {
    const { tournamentId } = request.params as { tournamentId: string };
    return {
      schemaVersion: "mk8dx.public-tournament-live-groups.v1",
      groups: await dependencies.tournamentConnected.publicLiveGroups(tournamentId),
    };
  });

  // Newest-written first and bounded; `?limit=` (1-200) and `?before=` (the
  // previous page's nextCursor) page through an account's history.
  app.get("/v1/tournament-evidence-records/own", async (request, reply) => handle(reply, async () => {
    requireBearer(request);
    const actor = await dependencies.resolveActor(request);
    const query = (request.query ?? {}) as { limit?: unknown; before?: unknown };
    const limit = query.limit === undefined ? undefined : Number(query.limit);
    if (limit !== undefined && !/^\d{1,3}$/u.test(String(query.limit))) {
      throw new TournamentOperationError("invalid_input", "limit must be between 1 and 200.");
    }
    if (query.before !== undefined && typeof query.before !== "string") {
      throw new TournamentOperationError("invalid_input", "before is not a valid cursor.");
    }
    const page = await dependencies.tournamentConnected.listOwnEvidenceRecordsPage(actor, {
      ...(limit === undefined ? {} : { limit }),
      ...(typeof query.before === "string" ? { before: query.before } : {}),
    });
    return { records: page.records, nextCursor: page.nextCursor };
  }));

  app.get("/v1/administrator/tournaments/:tournamentId/evidence-records", async (request, reply) => handle(reply, async () => {
    const actor = await dependencies.resolveActor(request);
    const { tournamentId } = request.params as { tournamentId: string };
    return { records: await dependencies.tournamentConnected.listEvidenceRecords(actor, tournamentId) };
  }));

  app.post("/v1/administrator/tournaments/:tournamentId/evidence-records/:recordId/actions/link", async (request, reply) => handle(reply, async () => {
    const actor = await dependencies.resolveActor(request);
    const token = request.headers["x-mk8dx-csrf"];
    if (typeof token !== "string" || !dependencies.csrfVerifier.verify(actor, token)) {
      throw new TournamentOperationError("forbidden", "A valid same-origin request proof is required.");
    }
    const { tournamentId, recordId } = request.params as { tournamentId: string; recordId: string };
    const body = request.body as Omit<Parameters<TournamentConnectedService["linkEvidenceRecord"]>[1], "tournamentId" | "recordId">;
    return { results: await dependencies.tournamentConnected.linkEvidenceRecord(actor, { ...body, tournamentId, recordId }) };
  }));

  app.post("/v1/administrator/tournaments/:tournamentId/evidence-records/:recordId/actions/approve-live", async (request, reply) => handle(reply, async () => {
    const actor = await dependencies.resolveActor(request);
    const token = request.headers["x-mk8dx-csrf"];
    if (typeof token !== "string" || !dependencies.csrfVerifier.verify(actor, token)) {
      throw new TournamentOperationError("forbidden", "A valid same-origin request proof is required.");
    }
    const { tournamentId, recordId } = request.params as { tournamentId: string; recordId: string };
    const body = request.body as Omit<Parameters<TournamentConnectedService["approveLiveAssociation"]>[1], "tournamentId" | "recordId">;
    return { record: await dependencies.tournamentConnected.approveLiveAssociation(actor, { ...body, tournamentId, recordId }) };
  }));

  app.post("/v1/administrator/tournaments/:tournamentId/evidence-records/:recordId/actions/dismiss-live", async (request, reply) => handle(reply, async () => {
    const actor = await dependencies.resolveActor(request);
    const token = request.headers["x-mk8dx-csrf"];
    if (typeof token !== "string" || !dependencies.csrfVerifier.verify(actor, token)) {
      throw new TournamentOperationError("forbidden", "A valid same-origin request proof is required.");
    }
    const { tournamentId, recordId } = request.params as { tournamentId: string; recordId: string };
    const body = (request.body ?? {}) as Omit<Parameters<TournamentConnectedService["dismissLiveRequest"]>[1], "tournamentId" | "recordId">;
    return { record: await dependencies.tournamentConnected.dismissLiveRequest(actor, {
      expectedRevision: body.expectedRevision,
      ...(body.reason === undefined ? {} : { reason: body.reason }),
      tournamentId,
      recordId,
    }) };
  }));

  app.post("/v1/administrator/tournaments/:tournamentId/evidence-records/:recordId/actions/withdraw-live", async (request, reply) => handle(reply, async () => {
    const actor = await dependencies.resolveActor(request);
    const token = request.headers["x-mk8dx-csrf"];
    if (typeof token !== "string" || !dependencies.csrfVerifier.verify(actor, token)) {
      throw new TournamentOperationError("forbidden", "A valid same-origin request proof is required.");
    }
    const { tournamentId, recordId } = request.params as { tournamentId: string; recordId: string };
    const body = (request.body ?? {}) as { expectedRevision: number; reason?: string };
    return { record: await dependencies.tournamentConnected.withdrawLiveAssociation(actor, {
      expectedRevision: body.expectedRevision,
      ...(body.reason === undefined ? {} : { reason: body.reason }),
      tournamentId,
      recordId,
    }) };
  }));

  // F05: the Director's explicit, revocable capture delegations for one night.
  app.get("/v1/administrator/tournaments/:tournamentId/live-capture-delegations", {
    schema: { response: { 200: liveCaptureDelegationListSchema } },
  }, async (request, reply) => handle(reply, async () => {
    const actor = await dependencies.resolveActor(request);
    const { tournamentId } = request.params as { tournamentId: string };
    return { delegations: await dependencies.tournamentConnected.listLiveCaptureDelegations(actor, tournamentId) };
  }));

  app.post("/v1/administrator/tournaments/:tournamentId/live-capture-delegations", {
    schema: { response: { 200: liveCaptureDelegationDocumentSchema } },
  }, async (request, reply) => handle(reply, async () => {
    const actor = await dependencies.resolveActor(request);
    const token = request.headers["x-mk8dx-csrf"];
    if (typeof token !== "string" || !dependencies.csrfVerifier.verify(actor, token)) {
      throw new TournamentOperationError("forbidden", "A valid same-origin request proof is required.");
    }
    const { tournamentId } = request.params as { tournamentId: string };
    const body = (request.body ?? {}) as { delegateUserAccountId: string; reason: string; expiresInMinutes?: number };
    return { delegation: await dependencies.tournamentConnected.grantLiveCaptureDelegation(actor, {
      tournamentId,
      delegateUserAccountId: body.delegateUserAccountId,
      reason: body.reason,
      ...(body.expiresInMinutes === undefined ? {} : { expiresInMinutes: body.expiresInMinutes }),
    }) };
  }));

  app.post("/v1/administrator/tournaments/:tournamentId/live-capture-delegations/:delegationId/actions/revoke", {
    schema: { response: { 200: liveCaptureDelegationDocumentSchema } },
  }, async (request, reply) => handle(reply, async () => {
    const actor = await dependencies.resolveActor(request);
    const token = request.headers["x-mk8dx-csrf"];
    if (typeof token !== "string" || !dependencies.csrfVerifier.verify(actor, token)) {
      throw new TournamentOperationError("forbidden", "A valid same-origin request proof is required.");
    }
    const { tournamentId, delegationId } = request.params as { tournamentId: string; delegationId: string };
    const body = (request.body ?? {}) as { reason: string };
    return { delegation: await dependencies.tournamentConnected.revokeLiveCaptureDelegation(actor, {
      tournamentId, delegationId, reason: body.reason,
    }) };
  }));

  app.get("/v1/administrator/tournaments/:tournamentId/incoming-results", async (request, reply) => handle(reply, async () => {
    const actor = await dependencies.resolveActor(request);
    const { tournamentId } = request.params as { tournamentId: string };
    return { results: await dependencies.tournamentConnected.listIncoming(actor, tournamentId) };
  }));

  app.post("/v1/administrator/tournament-incoming-results/:incomingResultId/actions/accept", async (request, reply) => handle(reply, async () => {
    const actor = await dependencies.resolveActor(request);
    const token = request.headers["x-mk8dx-csrf"];
    if (typeof token !== "string" || !dependencies.csrfVerifier.verify(actor, token)) {
      throw new TournamentOperationError("forbidden", "A valid same-origin request proof is required.");
    }
    const { incomingResultId } = request.params as { incomingResultId: string };
    const body = request.body as Omit<Parameters<TournamentConnectedService["accept"]>[1], "incomingResultId">;
    return dependencies.tournamentConnected.accept(actor, { ...body, incomingResultId });
  }));

  app.post("/v1/administrator/tournament-incoming-results/actions/accept-group", async (request, reply) => handle(reply, async () => {
    const actor = await dependencies.resolveActor(request);
    const token = request.headers["x-mk8dx-csrf"];
    if (typeof token !== "string" || !dependencies.csrfVerifier.verify(actor, token)) {
      throw new TournamentOperationError("forbidden", "A valid same-origin request proof is required.");
    }
    const body = request.body as Parameters<TournamentConnectedService["acceptGroup"]>[1];
    return dependencies.tournamentConnected.acceptGroup(actor, body);
  }));

  app.post("/v1/administrator/tournament-incoming-results/:incomingResultId/actions/reject", async (request, reply) => handle(reply, async () => {
    const actor = await dependencies.resolveActor(request);
    const token = request.headers["x-mk8dx-csrf"];
    if (typeof token !== "string" || !dependencies.csrfVerifier.verify(actor, token)) {
      throw new TournamentOperationError("forbidden", "A valid same-origin request proof is required.");
    }
    const { incomingResultId } = request.params as { incomingResultId: string };
    const body = request.body as { expectedRevision: number; reason: string };
    await dependencies.tournamentConnected.reject(actor, { ...body, incomingResultId });
    return { status: "rejected" };
  }));
}
