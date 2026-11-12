import type { FastifyInstance, FastifyReply } from "fastify";

import type { ActorContext, ActorResolver } from "../identity/types.js";
import type { TournamentRetractionService } from "./tournament-retraction-service.js";
import { TournamentOperationError } from "./tournament-operation-service.js";

export function registerTournamentRetractionRoutes(app: FastifyInstance, dependencies: {
  resolveActor: ActorResolver;
  tournamentRetraction: TournamentRetractionService;
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
  app.post("/v1/administrator/tournaments/:tournamentId/actions/remove", async (request, reply) => handle(reply, async () => {
    const actor = await dependencies.resolveActor(request);
    const token = request.headers["x-mk8dx-csrf"];
    if (typeof token !== "string" || !dependencies.csrfVerifier.verify(actor, token)) {
      throw new TournamentOperationError("forbidden", "A valid same-origin request proof is required.");
    }
    const { tournamentId } = request.params as { tournamentId: string };
    return dependencies.tournamentRetraction.remove(actor, { tournamentId, reason: reasonOf(request.body) });
  }));

  // Owner decision 2026-09-15: a finalized night can be reopened to correct a
  // mistake found late. The result set is retracted, the rating recalculated
  // without the night, a published report goes back to draft, and the
  // Tournament stands at Step 10 again. Administrator only.
  app.post("/v1/administrator/tournaments/:tournamentId/actions/reopen", async (request, reply) => handle(reply, async () => {
    const actor = await dependencies.resolveActor(request);
    const token = request.headers["x-mk8dx-csrf"];
    if (typeof token !== "string" || !dependencies.csrfVerifier.verify(actor, token)) {
      throw new TournamentOperationError("forbidden", "A valid same-origin request proof is required.");
    }
    const { tournamentId } = request.params as { tournamentId: string };
    return dependencies.tournamentRetraction.reopen(actor, { tournamentId, reason: reasonOf(request.body) });
  }));

  // A request without a reason (or without a body) is a mistake by the caller: answer 400 with the same
  // message the service gives, not a 500 from reading a missing field (found 2026-11-12).
  const reasonOf = (body: unknown): string => {
    const reason = typeof body === "object" && body !== null ? (body as { reason?: unknown }).reason : undefined;
    if (typeof reason !== "string") {
      throw new TournamentOperationError("invalid_input", "Provide a reason between 3 and 512 characters.");
    }
    return reason;
  };

  // Owner decision 2026-08-28: removal hides a Tournament, so it can be undone.
  // The restore says what the Tournament counts towards again - the results for
  // the Players, and TrueSkill - because putting either back is a decision, not
  // a side effect.
  app.post("/v1/administrator/tournaments/:tournamentId/actions/restore", async (request, reply) => handle(reply, async () => {
    const actor = await dependencies.resolveActor(request);
    const token = request.headers["x-mk8dx-csrf"];
    if (typeof token !== "string" || !dependencies.csrfVerifier.verify(actor, token)) {
      throw new TournamentOperationError("forbidden", "A valid same-origin request proof is required.");
    }
    const { tournamentId } = request.params as { tournamentId: string };
    const reason = reasonOf(request.body);
    const body = request.body as { publicResults?: boolean; affectsRating?: boolean };
    return dependencies.tournamentRetraction.restore(actor, {
      tournamentId,
      reason,
      publicResults: body.publicResults === true,
      affectsRating: body.affectsRating === true,
    });
  }));
}
