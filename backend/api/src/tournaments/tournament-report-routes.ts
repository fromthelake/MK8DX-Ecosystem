import type { FastifyInstance } from "fastify";

import type { ActorContext, ActorResolver } from "../identity/types.js";
import {
  TournamentReportError,
  type TournamentReportDocument,
  type TournamentReportDraft,
  type TournamentReportGrant,
  type TournamentReportService,
  type TournamentReportVisibility,
} from "./tournament-report-service.js";

type ErrorResponse = { code: string; message: string };
type TournamentParams = { tournamentId: string };
type AccountParams = { userAccountId: string };
type GrantBody = { userAccountId: string; reasonCode: string };
type RevokeBody = { reasonCode: string };
type DraftBody = {
  expectedRevision: number | null; titleText?: string; introText: string;
  summaryText?: string; tracksIntroText: string;
  playerNotes: Record<string, string>; groupNotes?: Record<string, string>;
  visibility?: Partial<TournamentReportVisibility>;
};
type PublishBody = { expectedRevision: number };

export type TournamentReportRouteDependencies = Readonly<{
  resolveActor: ActorResolver;
  service: Pick<TournamentReportService, "listGrants" | "grant" | "revoke" | "load" | "saveDraft" | "publish">;
  csrfVerifier: Readonly<{ verify(actor: ActorContext, token: string): boolean }>;
}>;

function failure(error: unknown): Readonly<{ status: 400 | 403 | 404 | 409 | 500; body: ErrorResponse }> {
  if (!(error instanceof TournamentReportError)) {
    return { status: 500, body: { code: "tournament_report_failed", message: "The report operation failed." } };
  }
  const statuses = { invalid_input: 400, forbidden: 403, not_found: 404, conflict: 409 } as const;
  return { status: statuses[error.code], body: { code: `tournament_report_${error.code}`, message: error.message } };
}

export async function registerTournamentReportRoutes(
  app: FastifyInstance,
  dependencies: TournamentReportRouteDependencies,
): Promise<void> {
  const actor = (request: Parameters<ActorResolver>[0]) => dependencies.resolveActor(request);
  const proven = async (request: Parameters<ActorResolver>[0]): Promise<ActorContext> => {
    const resolved = await actor(request);
    const token = request.headers["x-mk8dx-csrf"];
    if (typeof token !== "string" || !dependencies.csrfVerifier.verify(resolved, token)) {
      throw new TournamentReportError("forbidden", "CSRF proof rejected");
    }
    return resolved;
  };
  const handle = async <T>(reply: { code(status: number): { send(body: ErrorResponse): unknown } }, work: () => Promise<T>): Promise<T | unknown> => {
    try { return await work(); } catch (error) { const mapped = failure(error); return reply.code(mapped.status).send(mapped.body); }
  };

  app.get("/v1/administrator/tournament-report-capabilities", async (request, reply) =>
    handle(reply, async () => ({ schemaVersion: "mk8dx.tournament-report-capabilities.v1", grants: await dependencies.service.listGrants(await actor(request)) })));
  app.post<{ Body: GrantBody; Reply: TournamentReportGrant | ErrorResponse }>(
    "/v1/administrator/tournament-report-capabilities",
    async (request, reply) => handle(reply, async () => dependencies.service.grant(
      await proven(request), request.body.userAccountId, request.body.reasonCode)) as Promise<TournamentReportGrant>);
  app.post<{ Params: AccountParams; Body: RevokeBody; Reply: TournamentReportGrant | ErrorResponse }>(
    "/v1/administrator/tournament-report-capabilities/:userAccountId/actions/revoke",
    async (request, reply) => handle(reply, async () => dependencies.service.revoke(
      await proven(request), request.params.userAccountId, request.body.reasonCode)) as Promise<TournamentReportGrant>);
  app.get<{ Params: TournamentParams; Reply: TournamentReportDocument | ErrorResponse }>(
    "/v1/tournament-reports/:tournamentId",
    async (request, reply) => handle(reply, async () => dependencies.service.load(
      await actor(request), request.params.tournamentId)) as Promise<TournamentReportDocument>);
  app.put<{ Params: TournamentParams; Body: DraftBody; Reply: TournamentReportDraft | ErrorResponse }>(
    "/v1/tournament-reports/:tournamentId/draft",
    async (request, reply) => handle(reply, async () => dependencies.service.saveDraft(
      await proven(request), request.params.tournamentId, request.body)) as Promise<TournamentReportDraft>);
  // Fixing the report as the community's copy is its own act, deliberately not
  // a side effect of saving: the Director saves as often as they like.
  app.post<{ Params: TournamentParams; Body: PublishBody; Reply: TournamentReportDraft | ErrorResponse }>(
    "/v1/tournament-reports/:tournamentId/actions/publish",
    async (request, reply) => handle(reply, async () => dependencies.service.publish(
      await proven(request), request.params.tournamentId, request.body.expectedRevision)) as Promise<TournamentReportDraft>);
}
