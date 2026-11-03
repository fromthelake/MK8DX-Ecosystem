/**
 * "Request to host" (ADR-0220): the person's own request on the Tournaments page, and the
 * administrators' queue with Approve and Decline in the Directors section. Responses are checked
 * key for key, like every client here; tests/contracts binds the keys to the API schemas.
 */

export const HOST_REQUEST_PATH = "/v1/me/director-host-request";
export const HOST_REQUEST_QUEUE_PATH = "/v1/administrator/director-host-requests";
export const HOST_REQUEST_NOTE_MAXIMUM = 300;
const CSRF_PATH = "/v1/session/csrf";

const maximumResponseBytes = 131_072;
const requestIdPattern = /^director_host_request\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const accountIdPattern = /^user_account\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export type HostRequest = Readonly<{
  requestId: string;
  status: "open" | "approved" | "declined";
  note: string | null;
  requestedAtMs: number;
  decidedAtMs: number | null;
  declineReason: string | null;
}>;
export type HostRequestStanding = Readonly<{
  administrator: boolean;
  director: boolean;
  request: HostRequest | null;
}>;
export type HostRequestPlayer = Readonly<{ playerId: string; username: string; displayName: string }>;
export type HostRequestQueueItem = Readonly<{
  requestId: string;
  userAccountId: string;
  accountCreatedAtMs: number;
  players: readonly HostRequestPlayer[];
  note: string | null;
  requestedAtMs: number;
}>;

export type HostRequestErrorCode =
  | "not_authenticated" | "not_authorized" | "conflict" | "invalid_input" | "unavailable" | "invalid_response";

export class HostRequestClientError extends Error {
  public constructor(public readonly code: HostRequestErrorCode, public readonly serverCode: string | null = null) {
    super(`Host request failed: ${code}`);
    this.name = "HostRequestClientError";
  }
}

export interface DirectorHostRequestClient {
  standing(signal?: AbortSignal): Promise<HostRequestStanding>;
  submit(note: string, signal?: AbortSignal): Promise<HostRequestStanding>;
  queue(signal?: AbortSignal): Promise<readonly HostRequestQueueItem[]>;
  approve(requestId: string, signal?: AbortSignal): Promise<void>;
  decline(requestId: string, reason: string, signal?: AbortSignal): Promise<void>;
}

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;

function fail(): never { throw new HostRequestClientError("invalid_response"); }

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) { fail(); }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) { fail(); }
}

function text(value: unknown, maximum: number, pattern?: RegExp): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum ||
    (pattern !== undefined && !pattern.test(value))) { fail(); }
  return value;
}

function nullableText(value: unknown, maximum: number): string | null {
  return value === null ? null : text(value, maximum);
}

function epoch(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) { fail(); }
  return value;
}

function flag(value: unknown): boolean {
  if (typeof value !== "boolean") { fail(); }
  return value;
}

function hostRequest(value: unknown): HostRequest {
  const row = object(value);
  exact(row, ["requestId", "status", "note", "requestedAtMs", "decidedAtMs", "declineReason"]);
  const status = row["status"];
  if (status !== "open" && status !== "approved" && status !== "declined") { fail(); }
  return {
    requestId: text(row["requestId"], 180, requestIdPattern),
    status,
    note: nullableText(row["note"], 1200),
    requestedAtMs: epoch(row["requestedAtMs"]),
    decidedAtMs: row["decidedAtMs"] === null ? null : epoch(row["decidedAtMs"]),
    declineReason: nullableText(row["declineReason"], 1200),
  };
}

function standingDocument(value: unknown): HostRequestStanding {
  const row = object(value);
  exact(row, ["schemaVersion", "administrator", "director", "request"]);
  if (row["schemaVersion"] !== "mk8dx.director-host-request.v1") { fail(); }
  return {
    administrator: flag(row["administrator"]),
    director: flag(row["director"]),
    request: row["request"] === null ? null : hostRequest(row["request"]),
  };
}

function hostRequestPlayer(value: unknown): HostRequestPlayer {
  const row = object(value);
  exact(row, ["playerId", "username", "displayName"]);
  return {
    playerId: text(row["playerId"], 135, playerIdPattern),
    username: text(row["username"], 64),
    displayName: text(row["displayName"], 128),
  };
}

function queueItem(value: unknown): HostRequestQueueItem {
  const row = object(value);
  exact(row, ["requestId", "userAccountId", "accountCreatedAtMs", "players", "note", "requestedAtMs"]);
  const players = row["players"];
  if (!Array.isArray(players) || players.length > 10) { fail(); }
  return {
    requestId: text(row["requestId"], 180, requestIdPattern),
    userAccountId: text(row["userAccountId"], 141, accountIdPattern),
    accountCreatedAtMs: epoch(row["accountCreatedAtMs"]),
    players: players.map(hostRequestPlayer),
    note: nullableText(row["note"], 1200),
    requestedAtMs: epoch(row["requestedAtMs"]),
  };
}

function queueDocument(value: unknown): readonly HostRequestQueueItem[] {
  const row = object(value);
  exact(row, ["schemaVersion", "requests"]);
  if (row["schemaVersion"] !== "mk8dx.director-host-request-queue.v1") { fail(); }
  const requests = row["requests"];
  if (!Array.isArray(requests) || requests.length > 100) { fail(); }
  return requests.map(queueItem);
}

function decisionDocument(value: unknown): void {
  const row = object(value);
  exact(row, ["schemaVersion", "requestId", "userAccountId", "status", "decidedAtMs"]);
  if (row["schemaVersion"] !== "mk8dx.director-host-request-decision.v1") { fail(); }
}

async function bounded(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!/^application\/json(?:\s*;|$)/.test(contentType)) { fail(); }
  const body = await response.text().catch(() => fail());
  if (body.length > maximumResponseBytes) { fail(); }
  try { return JSON.parse(body) as unknown; } catch { return fail(); }
}

async function checkStatus(response: Response): Promise<void> {
  if (response.status === 200 || response.status === 201) { return; }
  let serverCode: string | null = null;
  try {
    const body = await response.json() as { code?: unknown };
    serverCode = typeof body.code === "string" ? body.code : null;
  } catch { /* the status alone answers */ }
  const code: HostRequestErrorCode = response.status === 401 ? "not_authenticated"
    : response.status === 403 ? "not_authorized"
    : response.status === 404 || response.status === 409 ? "conflict"
    : response.status === 400 ? "invalid_input"
    : response.status >= 500 ? "unavailable"
    : "invalid_response";
  throw new HostRequestClientError(code, serverCode);
}

/** A trimmed note of at most 300 characters; an empty one is sent as no note. */
export function cleanHostRequestNote(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) { return undefined; }
  if ([...trimmed].length > HOST_REQUEST_NOTE_MAXIMUM) { throw new HostRequestClientError("invalid_input"); }
  return trimmed;
}

export function createDirectorHostRequestClient(
  fetchPort: FetchPort = (input, init) => globalThis.fetch(input, init),
): DirectorHostRequestClient {
  const send = async (path: string, init: RequestInit): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetchPort(path, {
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        referrerPolicy: "same-origin",
        cache: "no-store",
        ...init,
      });
    } catch {
      throw new HostRequestClientError("unavailable");
    }
    await checkStatus(response);
    return bounded(response);
  };
  const get = (path: string, signal?: AbortSignal): Promise<unknown> => send(path, {
    method: "GET",
    headers: { Accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  });
  const post = async (path: string, body: unknown, signal?: AbortSignal): Promise<unknown> => {
    const proof = object(await get(CSRF_PATH, signal));
    exact(proof, ["schemaVersion", "headerName", "value"]);
    if (proof["schemaVersion"] !== "mk8dx.web-csrf.v1") { fail(); }
    const headerName = text(proof["headerName"], 64, /^x-[a-z0-9-]{1,62}$/i);
    const value = text(proof["value"], 4096, /^[\x21-\x7e]+$/);
    return send(path, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", [headerName]: value },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    });
  };
  const requestPath = (requestId: string, action: "approve" | "decline"): string => {
    if (requestId.length > 180 || !requestIdPattern.test(requestId)) {
      throw new HostRequestClientError("invalid_input");
    }
    return `${HOST_REQUEST_QUEUE_PATH}/${encodeURIComponent(requestId)}/actions/${action}`;
  };
  return {
    async standing(signal) { return standingDocument(await get(HOST_REQUEST_PATH, signal)); },
    async submit(rawNote, signal) {
      const note = cleanHostRequestNote(rawNote);
      return standingDocument(await post(HOST_REQUEST_PATH, note === undefined ? {} : { note }, signal));
    },
    async queue(signal) { return queueDocument(await get(HOST_REQUEST_QUEUE_PATH, signal)); },
    async approve(requestId, signal) { decisionDocument(await post(requestPath(requestId, "approve"), {}, signal)); },
    async decline(requestId, rawReason, signal) {
      const reason = cleanHostRequestNote(rawReason);
      decisionDocument(await post(requestPath(requestId, "decline"), reason === undefined ? {} : { reason }, signal));
    },
  };
}
