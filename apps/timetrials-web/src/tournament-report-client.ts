import type { PublicReportRatings, PublicTournamentReportVisibility, TournamentDocument } from "./tournament-operation-client.js";

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;
export type TournamentReportVisibility = PublicTournamentReportVisibility;
/** What a report nobody has saved yet starts with; the API applies the same to an absent flag. */
export const NEW_REPORT_VISIBILITY: TournamentReportVisibility = {
  topTracks: true, benchmark: true, duel: true, distribution: true,
  intro: false, summary: true, groupNotes: false,
};
export type TournamentReportDraft = Readonly<{
  revision: number;
  titleText: string;
  introText: string;
  summaryText: string;
  tracksIntroText: string;
  playerNotes: Readonly<Record<string, string>>;
  groupNotes: Readonly<Record<string, string>>;
  visibility: TournamentReportVisibility;
  updatedAtMs: number;
  /** The revision the community is reading, when one has been published. */
  publishedRevision?: number;
  publishedAtMs?: number;
}>;
export type TournamentReportGrant = Readonly<{ grantId: string; userAccountId: string; status: "active" | "revoked"; revision: number; grantedAtMs: number }>;
export type TournamentReportDocument = Readonly<{ schemaVersion: "mk8dx.tournament-night-report.v1"; mayManageAccess: boolean; tournament: TournamentDocument; draft: TournamentReportDraft | null; ratings?: PublicReportRatings | null }>;

export class TournamentReportClientError extends Error { public constructor(public readonly status: number, message: string) { super(message); this.name = "TournamentReportClientError"; } }

async function json(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => null);
  if (!response.ok) { const message = typeof body === "object" && body !== null && typeof (body as Record<string, unknown>)["message"] === "string" ? String((body as Record<string, unknown>)["message"]) : "Report operation failed."; throw new TournamentReportClientError(response.status, message); }
  return body;
}

// `/v1/session/csrf` is a GET route and names the proof `value`; a POST there
// answers 404, so every report draft save and author grant used to fail.
async function csrf(fetchPort: FetchPort, signal?: AbortSignal): Promise<{ name: string; value: string }> {
  const body = await json(await fetchPort("/v1/session/csrf", { method: "GET", credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" }, ...(signal === undefined ? {} : { signal }) })) as Record<string, unknown>;
  if (typeof body["headerName"] !== "string" || typeof body["value"] !== "string") { throw new TournamentReportClientError(500, "CSRF proof is invalid."); }
  return { name: body["headerName"], value: body["value"] };
}

export function createTournamentReportClient(fetchPort: FetchPort = globalThis.fetch.bind(globalThis)) {
  const write = async (path: string, method: string, body: unknown, signal?: AbortSignal): Promise<unknown> => { const proof = await csrf(fetchPort, signal); return json(await fetchPort(path, { method, credentials: "same-origin", ...(signal === undefined ? {} : { signal }), headers: { "content-type": "application/json", [proof.name]: proof.value }, body: JSON.stringify(body) })); };
  return {
    async load(tournamentId: string, signal?: AbortSignal): Promise<TournamentReportDocument> { return await json(await fetchPort(`/v1/tournament-reports/${encodeURIComponent(tournamentId)}`, { method: "GET", credentials: "same-origin", ...(signal === undefined ? {} : { signal }) })) as TournamentReportDocument; },
    async save(tournamentId: string, body: Omit<TournamentReportDraft, "revision" | "updatedAtMs" | "publishedRevision" | "publishedAtMs"> & { expectedRevision: number | null }, signal?: AbortSignal): Promise<TournamentReportDraft> { return await write(`/v1/tournament-reports/${encodeURIComponent(tournamentId)}/draft`, "PUT", body, signal) as TournamentReportDraft; },
    // Fixing the report as the community's copy: its own act, never a side
    // effect of saving.
    async publish(tournamentId: string, expectedRevision: number, signal?: AbortSignal): Promise<TournamentReportDraft> { return await write(`/v1/tournament-reports/${encodeURIComponent(tournamentId)}/actions/publish`, "POST", { expectedRevision }, signal) as TournamentReportDraft; },
    async listGrants(signal?: AbortSignal): Promise<readonly TournamentReportGrant[]> { const body = await json(await fetchPort("/v1/administrator/tournament-report-capabilities", { method: "GET", credentials: "same-origin", ...(signal === undefined ? {} : { signal }) })) as { grants: readonly TournamentReportGrant[] }; return body.grants; },
    async grant(userAccountId: string, signal?: AbortSignal): Promise<TournamentReportGrant> { return await write("/v1/administrator/tournament-report-capabilities", "POST", { userAccountId, reasonCode: "report_author_access" }, signal) as TournamentReportGrant; },
    async revoke(userAccountId: string, signal?: AbortSignal): Promise<TournamentReportGrant> { return await write(`/v1/administrator/tournament-report-capabilities/${encodeURIComponent(userAccountId)}/actions/revoke`, "POST", { reasonCode: "report_author_access_revoked" }, signal) as TournamentReportGrant; },
  };
}
