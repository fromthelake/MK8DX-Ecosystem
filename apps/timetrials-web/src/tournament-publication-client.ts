import { isTournamentRaceMode, type TournamentRaceMode } from "./tournament-race-class.js";

const maximumResponseBytes = 262_144;
const publicationIdPattern =
  /^tournament_publication\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const raceResultIdPattern =
  /^tournament_race_result\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const reasonPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export type TournamentPublicationTarget = Readonly<{
  raceResultId: string;
  revision: number;
}>;
export type TournamentPublicationSnapshot = Readonly<{
  publicationId: string;
  eventName: string;
  status: "published" | "retracted";
  revision: number;
  resultCount: number;
  publishedAtMs?: number;
  updatedAtMs: number;
}>;
export type TournamentPublicationCandidate = TournamentPublicationTarget & Readonly<{
  currentRevision: number;
  raceNumber: number;
  scoringSegment: number;
  trackId: string;
  mode?: TournamentRaceMode;
  mirror?: true;
  occurredAtMs?: number;
  placementCount: number;
  publishable: boolean;
  currentPublicationId?: string;
}>;
export type TournamentPublicationReview = Readonly<{
  publications: readonly TournamentPublicationSnapshot[];
  candidates: readonly TournamentPublicationCandidate[];
}>;
export type PublicPlayerTournamentResult = Readonly<{
  publicationId: string;
  eventName: string;
  publishedAtMs: number;
  raceResultId: string;
  revision: number;
  raceNumber: number;
  scoringSegment: number;
  trackId: string;
  mode?: TournamentRaceMode;
  mirror?: true;
  finishPosition: number;
  racePoints: number;
  totalAfterRace: number;
  rankAfterRace: number;
  resultAtMs: number;
}>;
export type PublicTournament = Readonly<{
  publicationId: string;
  eventName: string;
  publishedAtMs: number;
  races: readonly Readonly<{
    raceResultId: string;
    revision: number;
    raceNumber: number;
    scoringSegment: number;
    trackId: string;
    mode?: TournamentRaceMode;
    mirror?: true;
    countsTowardStandings: boolean;
    resultAtMs: number;
    placements: readonly Readonly<{
      finishPosition: number;
      playerId: string;
      playerUsername: string;
      playerDisplayName: string;
      racePoints: number;
      totalAfterRace: number;
      rankAfterRace: number;
      characterId?: string;
      characterVariantId?: string;
    }>[];
  }>[];
  standings: readonly Readonly<{
    scoringSegment: number;
    playerId: string;
    playerUsername: string;
    playerDisplayName: string;
    totalPoints: number;
    rank: number;
  }>[];
}>;

export class TournamentPublicationClientError extends Error {
  public constructor(public readonly code: "invalid_input" | "not_authorized" | "conflict" | "not_found" | "unavailable" | "invalid_response") {
    super("The Tournament publication operation could not be completed.");
    this.name = "TournamentPublicationClientError";
  }
}

export type CanonicalParticipantReference = Readonly<{
  namespace: string;
  value: string;
}>;
export type CanonicalRaceDocument = Readonly<{
  raceResultId: string;
  revision: number;
  trackId: string;
  placements: readonly Readonly<{
    participantReference: CanonicalParticipantReference;
    observedPlayerName?: string;
  }>[];
}> & Record<string, unknown>;
export type CanonicalImportOutcome =
  | "imported"
  | "already_imported"
  | "player_not_found"
  | "failed";

export interface TournamentPublicationClient {
  listReview(signal?: AbortSignal): Promise<TournamentPublicationReview>;
  submitRaceResult(
    document: CanonicalRaceDocument,
    signal?: AbortSignal,
  ): Promise<CanonicalImportOutcome>;
  create(eventName: string, targets: readonly TournamentPublicationTarget[], reasonCode: string, signal?: AbortSignal): Promise<TournamentPublicationSnapshot>;
  republish(publicationId: string, expectedRevision: number, eventName: string, targets: readonly TournamentPublicationTarget[], reasonCode: string, signal?: AbortSignal): Promise<TournamentPublicationSnapshot>;
  retract(publicationId: string, expectedRevision: number, reasonCode: string, signal?: AbortSignal): Promise<TournamentPublicationSnapshot>;
  listPlayer(playerId: string, signal?: AbortSignal): Promise<readonly PublicPlayerTournamentResult[]>;
  loadPublic(publicationId: string, signal?: AbortSignal): Promise<PublicTournament>;
}

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TournamentPublicationClientError("invalid_response");
  }
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !(key in value)) || Object.keys(value).some((key) => !allowed.has(key))) {
    throw new TournamentPublicationClientError("invalid_response");
  }
}
function text(value: unknown, maximum: number, pattern?: RegExp): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum ||
      (pattern !== undefined && !pattern.test(value))) {
    throw new TournamentPublicationClientError("invalid_response");
  }
  return value;
}
function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TournamentPublicationClientError("invalid_response");
  }
  return value;
}
function optionalInteger(row: Record<string, unknown>, name: string, minimum = 0): number | undefined {
  return name in row ? integer(row[name], minimum) : undefined;
}
function parsedMode(row: Record<string, unknown>): TournamentRaceMode | undefined {
  if (!("mode" in row)) { return undefined; }
  const value = integer(row["mode"], 50, 200);
  if (!isTournamentRaceMode(value)) { throw new TournamentPublicationClientError("invalid_response"); }
  return value;
}
// ADR-0217: only `true`, only beside mode 150.
function parsedMirror(row: Record<string, unknown>, mode: TournamentRaceMode | undefined): Readonly<{ mirror?: true }> {
  if (!("mirror" in row)) { return {}; }
  if (row["mirror"] !== true || mode !== 150) { throw new TournamentPublicationClientError("invalid_response"); }
  return { mirror: true };
}
async function bounded(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const declared = response.headers.get("content-length");
  if (!/^application\/json(?:\s*;|$)/.test(contentType) || response.body === null ||
      (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > maximumResponseBytes))) {
    throw new TournamentPublicationClientError("invalid_response");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let body = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) { break; }
      bytes += chunk.value.byteLength;
      if (bytes > maximumResponseBytes) { throw new TournamentPublicationClientError("invalid_response"); }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof TournamentPublicationClientError) { throw error; }
    throw new TournamentPublicationClientError("invalid_response");
  }
}
async function send(fetchPort: FetchPort, path: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await fetchPort(path, { credentials: "same-origin", mode: "same-origin", redirect: "error", referrerPolicy: "same-origin", cache: "no-store", ...init });
  } catch { throw new TournamentPublicationClientError("unavailable"); }
  return { status: response.status, body: await bounded(response) };
}
function status(value: number, administrator = false): void {
  if (value === 403 || value === 401) { throw new TournamentPublicationClientError(administrator ? "not_authorized" : "unavailable"); }
  if (value === 404) { throw new TournamentPublicationClientError("not_found"); }
  if (value === 409) { throw new TournamentPublicationClientError("conflict"); }
  if (value !== 200) { throw new TournamentPublicationClientError(value >= 500 ? "unavailable" : "invalid_response"); }
}
function snapshot(value: unknown): TournamentPublicationSnapshot {
  const row = object(value);
  keys(row, ["publicationId", "eventName", "status", "revision", "resultCount", "updatedAtMs"], ["publishedAtMs"]);
  if (row["status"] !== "published" && row["status"] !== "retracted") { throw new TournamentPublicationClientError("invalid_response"); }
  const publishedAtMs = optionalInteger(row, "publishedAtMs");
  if ((row["status"] === "published") !== (publishedAtMs !== undefined)) { throw new TournamentPublicationClientError("invalid_response"); }
  return {
    publicationId: text(row["publicationId"], 151, publicationIdPattern),
    eventName: text(row["eventName"], 128), status: row["status"], revision: integer(row["revision"], 1),
    resultCount: integer(row["resultCount"], 0, 200), ...(publishedAtMs === undefined ? {} : { publishedAtMs }),
    updatedAtMs: integer(row["updatedAtMs"]),
  };
}
function candidate(value: unknown): TournamentPublicationCandidate {
  const row = object(value);
  keys(row, ["raceResultId", "currentRevision", "raceNumber", "scoringSegment", "trackId", "placementCount", "publishable"], ["mode", "mirror", "occurredAtMs", "currentPublicationId"]);
  if (typeof row["publishable"] !== "boolean") { throw new TournamentPublicationClientError("invalid_response"); }
  const mode = parsedMode(row); const occurredAtMs = optionalInteger(row, "occurredAtMs");
  const currentPublicationId = "currentPublicationId" in row ? text(row["currentPublicationId"], 151, publicationIdPattern) : undefined;
  const currentRevision = integer(row["currentRevision"], 1);
  return {
    raceResultId: text(row["raceResultId"], 151, raceResultIdPattern), revision: currentRevision, currentRevision,
    raceNumber: integer(row["raceNumber"], 1), scoringSegment: integer(row["scoringSegment"], 1), trackId: text(row["trackId"], 255),
    ...(mode === undefined ? {} : { mode }), ...parsedMirror(row, mode), ...(occurredAtMs === undefined ? {} : { occurredAtMs }),
    placementCount: integer(row["placementCount"], 1, 12), publishable: row["publishable"],
    ...(currentPublicationId === undefined ? {} : { currentPublicationId }),
  };
}
function playerResult(value: unknown): PublicPlayerTournamentResult {
  const row = object(value);
  keys(row, ["publicationId", "eventName", "publishedAtMs", "raceResultId", "revision", "raceNumber", "scoringSegment", "trackId", "finishPosition", "racePoints", "totalAfterRace", "rankAfterRace", "resultAtMs"], ["mode", "mirror"]);
  const mode = parsedMode(row);
  return {
    publicationId: text(row["publicationId"], 151, publicationIdPattern), eventName: text(row["eventName"], 128), publishedAtMs: integer(row["publishedAtMs"]),
    raceResultId: text(row["raceResultId"], 151, raceResultIdPattern), revision: integer(row["revision"], 1), raceNumber: integer(row["raceNumber"], 1), scoringSegment: integer(row["scoringSegment"], 1), trackId: text(row["trackId"], 255),
    ...(mode === undefined ? {} : { mode }), ...parsedMirror(row, mode), finishPosition: integer(row["finishPosition"], 1, 12), racePoints: integer(row["racePoints"]), totalAfterRace: integer(row["totalAfterRace"]), rankAfterRace: integer(row["rankAfterRace"], 1, 12), resultAtMs: integer(row["resultAtMs"]),
  };
}
function publicTournament(value: unknown): PublicTournament {
  const row = object(value);
  keys(row, ["publicationId", "eventName", "publishedAtMs", "races", "standings"]);
  if (!Array.isArray(row["races"]) || row["races"].length < 1 || row["races"].length > 200 ||
      !Array.isArray(row["standings"]) || row["standings"].length < 1 || row["standings"].length > 2400) {
    throw new TournamentPublicationClientError("invalid_response");
  }
  const races = row["races"].map((value) => {
    const race = object(value);
    keys(race, ["raceResultId", "revision", "raceNumber", "scoringSegment", "trackId", "countsTowardStandings", "resultAtMs", "placements"], ["mode", "mirror"]);
    if (typeof race["countsTowardStandings"] !== "boolean" || !Array.isArray(race["placements"]) || race["placements"].length < 1 || race["placements"].length > 12) {
      throw new TournamentPublicationClientError("invalid_response");
    }
    const mode = parsedMode(race);
    const placements = race["placements"].map((value) => {
      const placement = object(value);
      keys(placement, ["finishPosition", "playerId", "playerUsername", "playerDisplayName", "racePoints", "totalAfterRace", "rankAfterRace"], ["characterId", "characterVariantId"]);
      const characterId = "characterId" in placement ? text(placement["characterId"], 255) : undefined;
      const characterVariantId = "characterVariantId" in placement ? text(placement["characterVariantId"], 255) : undefined;
      return {
        finishPosition: integer(placement["finishPosition"], 1, 12),
        playerId: text(placement["playerId"], 135, playerIdPattern),
        playerUsername: text(placement["playerUsername"], 64),
        playerDisplayName: text(placement["playerDisplayName"], 128),
        racePoints: integer(placement["racePoints"]), totalAfterRace: integer(placement["totalAfterRace"]), rankAfterRace: integer(placement["rankAfterRace"], 1, 12),
        ...(characterId === undefined ? {} : { characterId }),
        ...(characterVariantId === undefined ? {} : { characterVariantId }),
      };
    });
    return {
      raceResultId: text(race["raceResultId"], 151, raceResultIdPattern), revision: integer(race["revision"], 1), raceNumber: integer(race["raceNumber"], 1), scoringSegment: integer(race["scoringSegment"], 1), trackId: text(race["trackId"], 255),
      ...(mode === undefined ? {} : { mode }), ...parsedMirror(race, mode), countsTowardStandings: race["countsTowardStandings"], resultAtMs: integer(race["resultAtMs"]), placements,
    };
  });
  const standings = row["standings"].map((value) => {
    const standing = object(value);
    keys(standing, ["scoringSegment", "playerId", "playerUsername", "playerDisplayName", "totalPoints", "rank"]);
    return {
      scoringSegment: integer(standing["scoringSegment"], 1), playerId: text(standing["playerId"], 135, playerIdPattern), playerUsername: text(standing["playerUsername"], 64), playerDisplayName: text(standing["playerDisplayName"], 128), totalPoints: integer(standing["totalPoints"]), rank: integer(standing["rank"], 1, 12),
    };
  });
  return {
    publicationId: text(row["publicationId"], 151, publicationIdPattern), eventName: text(row["eventName"], 128), publishedAtMs: integer(row["publishedAtMs"]), races, standings,
  };
}
async function csrf(fetchPort: FetchPort, signal?: AbortSignal): Promise<{ name: string; value: string }> {
  const response = await send(fetchPort, "/v1/session/csrf", { method: "GET", headers: { Accept: "application/json" }, ...(signal === undefined ? {} : { signal }) });
  status(response.status);
  const row = object(response.body); keys(row, ["schemaVersion", "headerName", "value"]);
  if (row["schemaVersion"] !== "mk8dx.web-csrf.v1") { throw new TournamentPublicationClientError("invalid_response"); }
  return { name: text(row["headerName"], 64, /^x-[a-z0-9-]+$/i), value: text(row["value"], 4096, /^[\x21-\x7e]+$/) };
}
function validateCommand(eventName: string, targets: readonly TournamentPublicationTarget[], reasonCode: string): void {
  if (eventName.trim() !== eventName || eventName.length < 1 || eventName.length > 128 || !reasonPattern.test(reasonCode) || reasonCode.length > 64 || targets.length < 1 || targets.length > 200 || new Set(targets.map((item) => item.raceResultId)).size !== targets.length || targets.some((item) => !raceResultIdPattern.test(item.raceResultId) || !Number.isSafeInteger(item.revision) || item.revision < 1)) {
    throw new TournamentPublicationClientError("invalid_input");
  }
}

export function createTournamentPublicationClient(fetchPort: FetchPort = globalThis.fetch.bind(globalThis)): TournamentPublicationClient {
  const mutate = async (path: string, body: unknown, signal?: AbortSignal): Promise<TournamentPublicationSnapshot> => {
    const proof = await csrf(fetchPort, signal);
    const response = await send(fetchPort, path, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", [proof.name]: proof.value }, body: JSON.stringify(body), ...(signal === undefined ? {} : { signal }) });
    status(response.status, true); return snapshot(response.body);
  };
  return {
    async listReview(signal) {
      const response = await send(fetchPort, "/v1/administrator/tournament-publications/review", { method: "GET", headers: { Accept: "application/json" }, ...(signal === undefined ? {} : { signal }) });
      status(response.status, true); const row = object(response.body); keys(row, ["publications", "candidates"]);
      if (!Array.isArray(row["publications"]) || row["publications"].length > 100 || !Array.isArray(row["candidates"]) || row["candidates"].length > 200) { throw new TournamentPublicationClientError("invalid_response"); }
      return { publications: row["publications"].map(snapshot), candidates: row["candidates"].map(candidate) };
    },
    // The canonical race document is delivered verbatim; the browser only
    // rewrote participant references to reconciled central Players. A repeated
    // import of an unchanged race is a conflict, which the operator reads as
    // "already imported" rather than an error.
    async submitRaceResult(document, signal) {
      const proof = await csrf(fetchPort, signal);
      const response = await send(fetchPort, "/v1/tournament-race-results", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          [proof.name]: proof.value,
        },
        body: JSON.stringify(document),
        ...(signal === undefined ? {} : { signal }),
      });
      if (response.status === 201) { return "imported"; }
      if (response.status === 409) { return "already_imported"; }
      if (response.status === 404) { return "player_not_found"; }
      if (response.status === 401 || response.status === 403) {
        throw new TournamentPublicationClientError("not_authorized");
      }
      return "failed";
    },
    async create(eventName, targets, reasonCode, signal) { validateCommand(eventName, targets, reasonCode); return mutate("/v1/tournament-publications", { eventName, targets, reasonCode }, signal); },
    async republish(publicationId, expectedRevision, eventName, targets, reasonCode, signal) { validateCommand(eventName, targets, reasonCode); if (!publicationIdPattern.test(publicationId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) { throw new TournamentPublicationClientError("invalid_input"); } return mutate(`/v1/tournament-publications/${encodeURIComponent(publicationId)}/actions/publish`, { expectedRevision, eventName, targets, reasonCode }, signal); },
    async retract(publicationId, expectedRevision, reasonCode, signal) { if (!publicationIdPattern.test(publicationId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || !reasonPattern.test(reasonCode) || reasonCode.length > 64) { throw new TournamentPublicationClientError("invalid_input"); } return mutate(`/v1/tournament-publications/${encodeURIComponent(publicationId)}/actions/retract`, { expectedRevision, reasonCode }, signal); },
    async listPlayer(playerId, signal) {
      if (!playerIdPattern.test(playerId)) { throw new TournamentPublicationClientError("invalid_input"); }
      const response = await send(fetchPort, `/v1/public/players/${encodeURIComponent(playerId)}/tournaments`, { method: "GET", headers: { Accept: "application/json" }, ...(signal === undefined ? {} : { signal }) }); status(response.status);
      const row = object(response.body); keys(row, ["schemaVersion", "results"]); if (row["schemaVersion"] !== "mk8dx.public-player-tournaments.v1" || !Array.isArray(row["results"]) || row["results"].length > 100) { throw new TournamentPublicationClientError("invalid_response"); }
      return row["results"].map(playerResult);
    },
    async loadPublic(publicationId, signal) {
      if (!publicationIdPattern.test(publicationId)) { throw new TournamentPublicationClientError("invalid_input"); }
      const response = await send(fetchPort, `/v1/public/tournaments/${encodeURIComponent(publicationId)}`, { method: "GET", headers: { Accept: "application/json" }, ...(signal === undefined ? {} : { signal }) }); status(response.status);
      return publicTournament(response.body);
    },
  };
}
