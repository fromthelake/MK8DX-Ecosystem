import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { ActorResolver } from "../identity/types.js";
import type { ActorContext } from "../identity/types.js";
import { TournamentOperationError } from "./tournament-operation-service.js";
import type { TournamentConnectedService } from "./tournament-connected-service.js";

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

  app.get("/v1/tournament-evidence-records/own", async (request, reply) => handle(reply, async () => {
    requireBearer(request);
    const actor = await dependencies.resolveActor(request);
    return { records: await dependencies.tournamentConnected.listOwnEvidenceRecords(actor) };
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
