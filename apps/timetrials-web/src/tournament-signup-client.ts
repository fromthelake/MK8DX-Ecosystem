/**
 * Open sign-up (ADR-0222): a night's sign-up and the viewer's own status, signing up, changing the
 * consoles and withdrawing, and the Director's board (settings, sign-ups, the console warning).
 * Responses are checked key for key, like every client here; tests/contracts binds the keys to the
 * API schemas.
 */

const CSRF_PATH = "/v1/session/csrf";
const maximumResponseBytes = 262_144;
const tournamentIdPattern = /^tournament\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const seedPattern = /^[0-9a-f]{64}$/;

export type SignupMode = "director" | "open";
export type SignupSelection = "first_come" | "draw";
export type SignupStatus = "director" | "open" | "closed";
export type SignupViewerState =
  | "signed_out" | "no_player" | "director_roster" | "not_signed_up" | "pending" | "selected" | "waiting"
  | "withdrawn" | "removed" | "closed";
export type SignupEntryStatus = "pending" | "selected" | "waiting" | "withdrawn" | "removed";

export type SignupListEntry = Readonly<{ position: number; playerId: string | null; displayName: string }>;
export type SignupViewer = Readonly<{
  state: SignupViewerState;
  playerId: string | null;
  hasSwitch1: boolean;
  hasSwitch2: boolean;
  waitingPosition: number | null;
  canSignUp: boolean;
  canWithdraw: boolean;
  canChangeConsoles: boolean;
}>;
export type TournamentSignup = Readonly<{
  tournamentId: string;
  mode: SignupMode;
  selection: SignupSelection | null;
  status: SignupStatus;
  closesAtMs: number | null;
  timezone: string | null;
  capacity: number | null;
  taken: number;
  closedAtMs: number | null;
  drawSeed: string | null;
  drawAlgorithm: string | null;
  active: readonly SignupListEntry[];
  waiting: readonly SignupListEntry[];
  viewer: SignupViewer;
}>;
export type SignupBoardEntry = Readonly<{
  playerId: string;
  displayName: string;
  status: SignupEntryStatus;
  position: number | null;
  signedUpAtMs: number;
  attendance: "present" | "waiting" | "absent" | null;
  hasSwitch1: boolean;
  hasSwitch2: boolean;
}>;
export type SignupBoard = Readonly<{
  tournamentId: string;
  editable: boolean;
  settings: Readonly<{
    mode: SignupMode;
    selection: SignupSelection | null;
    status: SignupStatus;
    closesAtMs: number | null;
    capacity: number | null;
    closedAtMs: number | null;
    drawSeed: string | null;
    drawAlgorithm: string | null;
  }>;
  entries: readonly SignupBoardEntry[];
  consoles: Readonly<{ players: number; coming: number; needed: number; warning: boolean }>;
}>;

export type SignupClientErrorCode =
  | "not_authenticated" | "not_authorized" | "not_found" | "conflict" | "invalid_input" | "unavailable"
  | "invalid_response";

export class SignupClientError extends Error {
  public constructor(public readonly code: SignupClientErrorCode, public readonly serverCode: string | null = null) {
    super(`Sign-up failed: ${code}`);
    this.name = "SignupClientError";
  }
}

export interface TournamentSignupClient {
  load(tournamentId: string, signal?: AbortSignal): Promise<TournamentSignup>;
  signUp(tournamentId: string, consoles: Readonly<{ hasSwitch1: boolean; hasSwitch2: boolean }>, signal?: AbortSignal): Promise<TournamentSignup>;
  withdraw(tournamentId: string, signal?: AbortSignal): Promise<TournamentSignup>;
  board(tournamentId: string, signal?: AbortSignal): Promise<SignupBoard>;
  configure(tournamentId: string, settings: Readonly<{
    mode: SignupMode; selection?: SignupSelection; closesAtMs?: number; capacity?: number;
  }>, signal?: AbortSignal): Promise<SignupBoard>;
  close(tournamentId: string, signal?: AbortSignal): Promise<SignupBoard>;
  move(tournamentId: string, move: Readonly<{
    playerId: string; to: "selected" | "waiting" | "removed"; position?: number;
  }>, signal?: AbortSignal): Promise<SignupBoard>;
}

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;

function fail(): never { throw new SignupClientError("invalid_response"); }

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

function nullableText(value: unknown, maximum: number, pattern?: RegExp): string | null {
  return value === null ? null : text(value, maximum, pattern);
}

function count(value: unknown, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) { fail(); }
  return value;
}

function nullableCount(value: unknown, minimum = 0): number | null {
  return value === null ? null : count(value, minimum);
}

function flag(value: unknown): boolean {
  if (typeof value !== "boolean") { fail(); }
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) { fail(); }
  return value as T;
}

function nullableSelection(value: unknown): SignupSelection | null {
  return value === null ? null : oneOf(value, ["first_come", "draw"] as const);
}

function listEntry(value: unknown): SignupListEntry {
  const row = object(value);
  exact(row, ["position", "playerId", "displayName"]);
  return {
    position: count(row["position"], 1),
    playerId: nullableText(row["playerId"], 135, playerIdPattern),
    displayName: text(row["displayName"], 128),
  };
}

function signupViewer(value: unknown): SignupViewer {
  const row = object(value);
  exact(row, [
    "state", "playerId", "hasSwitch1", "hasSwitch2", "waitingPosition", "canSignUp", "canWithdraw",
    "canChangeConsoles",
  ]);
  return {
    state: oneOf(row["state"], [
      "signed_out", "no_player", "director_roster", "not_signed_up", "pending", "selected", "waiting",
      "withdrawn", "removed", "closed",
    ] as const),
    playerId: nullableText(row["playerId"], 135, playerIdPattern),
    hasSwitch1: flag(row["hasSwitch1"]),
    hasSwitch2: flag(row["hasSwitch2"]),
    waitingPosition: nullableCount(row["waitingPosition"], 1),
    canSignUp: flag(row["canSignUp"]),
    canWithdraw: flag(row["canWithdraw"]),
    canChangeConsoles: flag(row["canChangeConsoles"]),
  };
}

function list(value: unknown, maximum: number): readonly SignupListEntry[] {
  if (!Array.isArray(value) || value.length > maximum) { fail(); }
  return value.map(listEntry);
}

export function signupDocument(value: unknown): TournamentSignup {
  const row = object(value);
  exact(row, [
    "schemaVersion", "tournamentId", "mode", "selection", "status", "closesAtMs", "timezone", "capacity",
    "taken", "closedAtMs", "drawSeed", "drawAlgorithm", "active", "waiting", "viewer",
  ]);
  if (row["schemaVersion"] !== "mk8dx.tournament-signup.v1") { fail(); }
  return {
    tournamentId: text(row["tournamentId"], 160, tournamentIdPattern),
    mode: oneOf(row["mode"], ["director", "open"] as const),
    selection: nullableSelection(row["selection"]),
    status: oneOf(row["status"], ["director", "open", "closed"] as const),
    closesAtMs: nullableCount(row["closesAtMs"]),
    timezone: nullableText(row["timezone"], 64),
    capacity: nullableCount(row["capacity"], 1),
    taken: count(row["taken"]),
    closedAtMs: nullableCount(row["closedAtMs"]),
    drawSeed: nullableText(row["drawSeed"], 64, seedPattern),
    drawAlgorithm: nullableText(row["drawAlgorithm"], 48),
    active: list(row["active"], 200),
    waiting: list(row["waiting"], 500),
    viewer: signupViewer(row["viewer"]),
  };
}

function boardEntry(value: unknown): SignupBoardEntry {
  const row = object(value);
  exact(row, ["playerId", "displayName", "status", "position", "signedUpAtMs", "attendance", "hasSwitch1", "hasSwitch2"]);
  return {
    playerId: text(row["playerId"], 135, playerIdPattern),
    displayName: text(row["displayName"], 128),
    status: oneOf(row["status"], ["pending", "selected", "waiting", "withdrawn", "removed"] as const),
    position: nullableCount(row["position"], 1),
    signedUpAtMs: count(row["signedUpAtMs"]),
    attendance: row["attendance"] === null ? null : oneOf(row["attendance"], ["present", "waiting", "absent"] as const),
    hasSwitch1: flag(row["hasSwitch1"]),
    hasSwitch2: flag(row["hasSwitch2"]),
  };
}

function boardSettings(value: unknown): SignupBoard["settings"] {
  const row = object(value);
  exact(row, ["mode", "selection", "status", "closesAtMs", "capacity", "closedAtMs", "drawSeed", "drawAlgorithm"]);
  return {
    mode: oneOf(row["mode"], ["director", "open"] as const),
    selection: nullableSelection(row["selection"]),
    status: oneOf(row["status"], ["director", "open", "closed"] as const),
    closesAtMs: nullableCount(row["closesAtMs"]),
    capacity: nullableCount(row["capacity"], 1),
    closedAtMs: nullableCount(row["closedAtMs"]),
    drawSeed: nullableText(row["drawSeed"], 64, seedPattern),
    drawAlgorithm: nullableText(row["drawAlgorithm"], 48),
  };
}

function boardConsoles(value: unknown): SignupBoard["consoles"] {
  const row = object(value);
  exact(row, ["players", "coming", "needed", "warning"]);
  return {
    players: count(row["players"]),
    coming: count(row["coming"]),
    needed: count(row["needed"]),
    warning: flag(row["warning"]),
  };
}

export function boardDocument(value: unknown): SignupBoard {
  const row = object(value);
  exact(row, ["schemaVersion", "tournamentId", "editable", "settings", "entries", "consoles"]);
  if (row["schemaVersion"] !== "mk8dx.tournament-signup-board.v1") { fail(); }
  const entries = row["entries"];
  if (!Array.isArray(entries) || entries.length > 500) { fail(); }
  return {
    tournamentId: text(row["tournamentId"], 160, tournamentIdPattern),
    editable: flag(row["editable"]),
    settings: boardSettings(row["settings"]),
    entries: entries.map(boardEntry),
    consoles: boardConsoles(row["consoles"]),
  };
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
  const code: SignupClientErrorCode = response.status === 401 ? "not_authenticated"
    : response.status === 403 ? "not_authorized"
    : response.status === 404 ? "not_found"
    : response.status === 409 ? "conflict"
    : response.status === 400 ? "invalid_input"
    : response.status >= 500 ? "unavailable"
    : "invalid_response";
  throw new SignupClientError(code, serverCode);
}

export function createTournamentSignupClient(
  fetchPort: FetchPort = (input, init) => globalThis.fetch(input, init),
): TournamentSignupClient {
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
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") { throw error; }
      throw new SignupClientError("unavailable");
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
  const base = (tournamentId: string): string => {
    if (!tournamentIdPattern.test(tournamentId) || tournamentId.length > 160) {
      throw new SignupClientError("invalid_input");
    }
    return `/v1/tournaments/${encodeURIComponent(tournamentId)}`;
  };
  return {
    async load(tournamentId, signal) { return signupDocument(await get(`${base(tournamentId)}/signup`, signal)); },
    async signUp(tournamentId, consoles, signal) {
      return signupDocument(await post(`${base(tournamentId)}/signup`, {
        hasSwitch1: consoles.hasSwitch1, hasSwitch2: consoles.hasSwitch2,
      }, signal));
    },
    async withdraw(tournamentId, signal) {
      return signupDocument(await post(`${base(tournamentId)}/signup/actions/withdraw`, {}, signal));
    },
    async board(tournamentId, signal) { return boardDocument(await get(`${base(tournamentId)}/signups`, signal)); },
    async configure(tournamentId, settings, signal) {
      return boardDocument(await post(`${base(tournamentId)}/signup-settings`, settings, signal));
    },
    async close(tournamentId, signal) {
      return boardDocument(await post(`${base(tournamentId)}/signups/actions/close`, {}, signal));
    },
    async move(tournamentId, move, signal) {
      return boardDocument(await post(`${base(tournamentId)}/signups/actions/move`, move, signal));
    },
  };
}
