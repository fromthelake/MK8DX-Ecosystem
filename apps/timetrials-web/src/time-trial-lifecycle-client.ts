// Managing an already-recorded Time Trial, and the Player's own public
// presence.
//
// Both are account-management surfaces rather than public reading, so they
// share one transport here: every mutation first fetches a same-origin CSRF
// proof, every success document is parsed CLOSED (an unexpected key is a
// failure, never silently trusted), and the reader is byte-bounded.
//
// Nothing here deletes anything. A correction is an ordinary revision
// (N -> N+1), retiring withdraws public presence while every revision and
// every audit event remain, and restoring returns the result through the
// ordinary publication policy. Server authorization is authoritative: the
// browser only decides what to OFFER, never what is allowed.

const maximumResponseBytes = 262_144;
const submissionIdPattern =
  /^user_submission\.time\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const trackIdPattern = /^track\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const reasonPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const sourceKindPattern = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const maximumTimeMs = 599_999;

export const TIME_TRIAL_REASON_CODES = [
  "incorrect_time",
  "wrong_track_or_mode",
  "duplicate",
  "test_result",
  "invalid_result",
  "other",
] as const;

export type TimeTrialReasonCode = typeof TIME_TRIAL_REASON_CODES[number];

export function isTimeTrialReasonCode(
  value: string,
): value is TimeTrialReasonCode {
  return (TIME_TRIAL_REASON_CODES as readonly string[]).includes(value);
}

/** A lap's coin balance at its end and the mushrooms used (both optional, as recorded). */
export type ManagedLapCounts = Readonly<{ coinsCollected?: number; mushroomsUsed?: number }>;

export type ManagedTimeTrialRevision = Readonly<{
  revision: number;
  modeCc: 150 | 200;
  trackId: string;
  totalTimeMs: number;
  laps: readonly number[];
  /** One entry per lap, what that lap recorded besides its time. */
  lapDetails?: readonly ManagedLapCounts[];
  loadout?: Readonly<Record<string, string>>;
  sourceKind: string;
  createdAtMs: number;
}>;

export type ManagedTimeTrialEvent = Readonly<{
  sequenceNumber: number;
  eventType: "corrected" | "retired" | "restored";
  retirementStateAfter: "active" | "retired";
  revision: number;
  actorRole: "owner" | "administrator";
  reasonCode: string;
  note?: string;
  occurredAtMs: number;
}>;

/** Where a carried run comes from (ADR-0225), as the submission stated it. */
export type ManagedCarriedFrom = Readonly<{
  origin: string;
  communityName?: string;
  originalSubmissionId?: string;
  originalSubmittedAtMs: number;
}>;

export type ManagedTimeTrial = Readonly<{
  submissionId: string;
  playerId: string;
  playerUsername: string;
  playerDisplayName: string;
  retirementState: "active" | "retired";
  publicationStatus: "published" | "withheld";
  publicationReason: string;
  current: ManagedTimeTrialRevision;
  revisions: readonly ManagedTimeTrialRevision[];
  events: readonly ManagedTimeTrialEvent[];
  /** The Player's own YouTube video of this run. */
  videoUrl?: string;
  /** Present when the run was carried from another community. */
  carriedFrom?: ManagedCarriedFrom;
}>;

export type TimeTrialCorrection = Readonly<{
  totalTimeMs: number;
  laps: readonly number[];
  /** Present: restates every lap's coins and mushrooms (one entry per lap). */
  lapDetails?: readonly ManagedLapCounts[];
  /** Present: restates the kart setup by base part ids; a part left out is cleared. */
  loadout?: Readonly<{ characterId?: string; bodyId?: string; tireId?: string; gliderId?: string }>;
  reasonCode: TimeTrialReasonCode;
  note?: string;
}>;

export type ManagedTimeTrialQuery = Readonly<{
  playerId?: string;
  trackId?: string;
  mode?: 150 | 200;
  retirementState?: "active" | "retired";
  publicationStatus?: "published" | "withheld";
  sourceKind?: string;
  limit?: number;
}>;

export type PlayerVisibility = "public" | "private";

export type PlayerVisibilityState = Readonly<{
  playerId: string;
  username: string;
  displayName: string;
  visibility: PlayerVisibility;
}>;

export class TimeTrialLifecycleClientError extends Error {
  public constructor(
    public readonly code:
      | "invalid_input"
      | "not_authenticated"
      | "forbidden"
      | "not_found"
      | "conflict"
      | "no_verified_player"
      | "unavailable"
      | "invalid_response",
    /** The server's own sentence for a refused value (a 400), when it gave one. */
    public readonly detail?: string,
  ) {
    super("The requested management operation could not be completed.");
    this.name = "TimeTrialLifecycleClientError";
  }
}

export interface TimeTrialLifecycleClient {
  read(submissionId: string, signal?: AbortSignal): Promise<ManagedTimeTrial>;
  correct(
    submissionId: string,
    correction: TimeTrialCorrection,
    signal?: AbortSignal,
  ): Promise<ManagedTimeTrial>;
  retire(
    submissionId: string,
    reasonCode: TimeTrialReasonCode,
    note?: string,
    signal?: AbortSignal,
  ): Promise<ManagedTimeTrial>;
  restore(
    submissionId: string,
    reasonCode: TimeTrialReasonCode,
    note?: string,
    signal?: AbortSignal,
  ): Promise<ManagedTimeTrial>;
  /** Attaches a YouTube link to the result, or removes it (null). */
  setVideo(
    submissionId: string,
    videoUrl: string | null,
    signal?: AbortSignal,
  ): Promise<ManagedTimeTrial>;
  listForAdministrator(
    query: ManagedTimeTrialQuery,
    signal?: AbortSignal,
  ): Promise<readonly ManagedTimeTrial[]>;
}

export interface PlayerVisibilityClient {
  read(signal?: AbortSignal): Promise<PlayerVisibilityState>;
  setOwn(
    visibility: PlayerVisibility,
    signal?: AbortSignal,
  ): Promise<PlayerVisibilityState>;
  setForPlayer(
    playerId: string,
    visibility: PlayerVisibility,
    reasonCode: string,
    signal?: AbortSignal,
  ): Promise<PlayerVisibilityState>;
}

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;

const baseInit = {
  credentials: "same-origin",
  mode: "same-origin",
  redirect: "error",
  referrerPolicy: "same-origin",
  cache: "no-store",
} as const;

function fail(
  code: TimeTrialLifecycleClientError["code"],
): TimeTrialLifecycleClientError {
  return new TimeTrialLifecycleClientError(code);
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw fail("invalid_response");
  }
  return value as Record<string, unknown>;
}

function keys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !(key in value)) ||
      Object.keys(value).some((key) => !allowed.has(key))) {
    throw fail("invalid_response");
  }
}

function text(value: unknown, maximum: number, pattern?: RegExp): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum ||
      (pattern !== undefined && !pattern.test(value))) {
    throw fail("invalid_response");
  }
  return value;
}

function integer(
  value: unknown,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) ||
      value < minimum || value > maximum) {
    throw fail("invalid_response");
  }
  return value;
}

function literal<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw fail("invalid_response");
  }
  return value as T;
}

const loadoutKeys = ["characterId", "characterVariantId", "bodyId", "bodyVariantId", "tireId", "gliderId", "gliderVariantId"] as const;
const assetIdPattern = /^[a-z_]+\.[a-z0-9_.]+$/;
const youTubeWatchPattern = /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/;

function lapCounts(value: unknown): ManagedLapCounts {
  const row = object(value);
  keys(row, [], ["coinsCollected", "mushroomsUsed"]);
  return {
    ...("coinsCollected" in row ? { coinsCollected: integer(row["coinsCollected"], 0, 10) } : {}),
    ...("mushroomsUsed" in row ? { mushroomsUsed: integer(row["mushroomsUsed"], 0, 3) } : {}),
  };
}

function revision(value: unknown): ManagedTimeTrialRevision {
  const row = object(value);
  keys(row, [
    "revision", "modeCc", "trackId", "totalTimeMs", "laps", "sourceKind",
    "createdAtMs",
  ], ["lapDetails", "loadout"]);
  const modeCc = integer(row["modeCc"], 150, 200);
  if (modeCc !== 150 && modeCc !== 200) { throw fail("invalid_response"); }
  if (!Array.isArray(row["laps"]) || row["laps"].length > 7) {
    throw fail("invalid_response");
  }
  let lapDetails: ManagedLapCounts[] | undefined;
  if ("lapDetails" in row) {
    if (!Array.isArray(row["lapDetails"]) || row["lapDetails"].length > 7) { throw fail("invalid_response"); }
    lapDetails = row["lapDetails"].map(lapCounts);
  }
  let loadout: Record<string, string> | undefined;
  if ("loadout" in row) {
    const source = object(row["loadout"]);
    keys(source, [], loadoutKeys);
    loadout = Object.fromEntries(Object.entries(source).map(([key, part]) => [key, text(part, 255, assetIdPattern)]));
  }
  return {
    revision: integer(row["revision"], 1),
    modeCc,
    trackId: text(row["trackId"], 255, trackIdPattern),
    totalTimeMs: integer(row["totalTimeMs"], 1, maximumTimeMs),
    laps: row["laps"].map((lap) => integer(lap, 1, maximumTimeMs)),
    ...(lapDetails === undefined ? {} : { lapDetails }),
    ...(loadout === undefined ? {} : { loadout }),
    sourceKind: text(row["sourceKind"], 64, sourceKindPattern),
    createdAtMs: integer(row["createdAtMs"]),
  };
}

function event(value: unknown): ManagedTimeTrialEvent {
  const row = object(value);
  keys(row, [
    "sequenceNumber", "eventType", "retirementStateAfter", "revision",
    "actorRole", "reasonCode", "occurredAtMs",
  ], ["note"]);
  const note = "note" in row ? text(row["note"], 256) : undefined;
  return {
    sequenceNumber: integer(row["sequenceNumber"], 1),
    eventType: literal(row["eventType"], ["corrected", "retired", "restored"] as const),
    retirementStateAfter: literal(row["retirementStateAfter"], ["active", "retired"] as const),
    revision: integer(row["revision"], 1),
    actorRole: literal(row["actorRole"], ["owner", "administrator"] as const),
    reasonCode: text(row["reasonCode"], 64, reasonPattern),
    ...(note === undefined ? {} : { note }),
    occurredAtMs: integer(row["occurredAtMs"]),
  };
}

const carriedOriginPattern = /^https:\/\/[^/?#\s]+$/;

function carriedFrom(value: unknown): ManagedCarriedFrom {
  const row = object(value);
  keys(row, ["origin", "originalSubmittedAtMs"], ["communityName", "originalSubmissionId"]);
  return {
    origin: text(row["origin"], 255, carriedOriginPattern),
    ...("communityName" in row ? { communityName: text(row["communityName"], 160) } : {}),
    ...("originalSubmissionId" in row ? { originalSubmissionId: text(row["originalSubmissionId"], 256) } : {}),
    originalSubmittedAtMs: integer(row["originalSubmittedAtMs"]),
  };
}

function managed(value: unknown): ManagedTimeTrial {
  const row = object(value);
  keys(row, [
    "submissionId", "playerId", "playerUsername", "playerDisplayName",
    "retirementState", "publicationStatus", "publicationReason", "current",
    "revisions", "events",
  ], ["videoUrl", "carriedFrom"]);
  if (!Array.isArray(row["revisions"]) || row["revisions"].length > 200 ||
      !Array.isArray(row["events"]) || row["events"].length > 200) {
    throw fail("invalid_response");
  }
  return {
    submissionId: text(row["submissionId"], 149, submissionIdPattern),
    playerId: text(row["playerId"], 135, playerIdPattern),
    playerUsername: text(row["playerUsername"], 64),
    playerDisplayName: text(row["playerDisplayName"], 128),
    retirementState: literal(row["retirementState"], ["active", "retired"] as const),
    publicationStatus: literal(row["publicationStatus"], ["published", "withheld"] as const),
    publicationReason: text(row["publicationReason"], 64, reasonPattern),
    current: revision(row["current"]),
    revisions: row["revisions"].map(revision),
    events: row["events"].map(event),
    ...("videoUrl" in row ? { videoUrl: text(row["videoUrl"], 64, youTubeWatchPattern) } : {}),
    ...("carriedFrom" in row ? { carriedFrom: carriedFrom(row["carriedFrom"]) } : {}),
  };
}

function visibilityState(value: unknown): PlayerVisibilityState {
  const row = object(value);
  keys(row, [
    "schemaVersion", "playerId", "username", "displayName", "visibility",
  ]);
  if (row["schemaVersion"] !== "mk8dx.player-visibility.v1") {
    throw fail("invalid_response");
  }
  return {
    playerId: text(row["playerId"], 135, playerIdPattern),
    username: text(row["username"], 64),
    displayName: text(row["displayName"], 128),
    visibility: literal(row["visibility"], ["public", "private"] as const),
  };
}

async function bounded(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const declared = response.headers.get("content-length");
  if (!/^application\/json(?:\s*;|$)/.test(contentType) ||
      response.body === null ||
      (declared !== null &&
        (!/^[0-9]+$/.test(declared) || Number(declared) > maximumResponseBytes))) {
    throw fail("invalid_response");
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
      if (bytes > maximumResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw fail("invalid_response");
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof TimeTrialLifecycleClientError) { throw error; }
    throw fail("invalid_response");
  }
}

// Only a 200 carries a document worth parsing. A failure status is mapped
// from the status alone so that a proxy error page (or any non-JSON body)
// still reports the real outcome instead of "invalid response".
async function send(
  fetchPort: FetchPort,
  path: string,
  init: RequestInit,
): Promise<Readonly<{ status: number; body: unknown }>> {
  let response: Response;
  try {
    response = await fetchPort(path, { ...baseInit, ...init });
  } catch {
    throw fail("unavailable");
  }
  if (response.status === 400) {
    // A refused value carries the server's own sentence (the 12 % World Record guard, "YouTube
    // links only"), which the page shows as it is. Anything unreadable is just a refusal.
    const refusal = await bounded(response).catch(() => undefined);
    return { status: 400, body: refusal };
  }
  if (response.status !== 200) {
    return { status: response.status, body: undefined };
  }
  return { status: 200, body: await bounded(response) };
}

function refusalDetail(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) { return undefined; }
  const message = (body as Record<string, unknown>)["message"];
  return typeof message === "string" && message.length > 0 && message.length <= 300 &&
    message !== "The Time Trial could not be updated." ? message : undefined;
}

function requireOk(
  status: number,
  conflictCode: "conflict" | "no_verified_player",
  body?: unknown,
): void {
  if (status === 200) { return; }
  if (status === 400) { throw new TimeTrialLifecycleClientError("invalid_input", refusalDetail(body)); }
  if (status === 401) { throw fail("not_authenticated"); }
  if (status === 403) { throw fail("forbidden"); }
  if (status === 404) { throw fail("not_found"); }
  if (status === 409) { throw fail(conflictCode); }
  throw fail(status >= 500 ? "unavailable" : "invalid_response");
}

async function csrf(
  fetchPort: FetchPort,
  signal?: AbortSignal,
): Promise<Readonly<{ name: string; value: string }>> {
  const response = await send(fetchPort, "/v1/session/csrf", {
    method: "GET",
    headers: { Accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  });
  requireOk(response.status, "conflict");
  const row = object(response.body);
  keys(row, ["schemaVersion", "headerName", "value"]);
  if (row["schemaVersion"] !== "mk8dx.web-csrf.v1") {
    throw fail("invalid_response");
  }
  return {
    name: text(row["headerName"], 64, /^x-[a-z0-9-]+$/i),
    value: text(row["value"], 4096, /^[\x21-\x7e]+$/),
  };
}

function validateReason(reasonCode: string, note?: string): void {
  if (!isTimeTrialReasonCode(reasonCode) ||
      (note !== undefined && (note.length === 0 || note.length > 256))) {
    throw fail("invalid_input");
  }
}

function validateCorrection(correction: TimeTrialCorrection): void {
  validateReason(correction.reasonCode, correction.note);
  const laps = correction.laps;
  if (!Number.isSafeInteger(correction.totalTimeMs) ||
      correction.totalTimeMs < 1 || correction.totalTimeMs > maximumTimeMs ||
      laps.length > 7 ||
      laps.some((lap) =>
        !Number.isSafeInteger(lap) || lap < 1 || lap > maximumTimeMs)) {
    throw fail("invalid_input");
  }
  if (correction.lapDetails !== undefined &&
      (correction.lapDetails.length !== laps.length ||
        correction.lapDetails.some((lap) =>
          (lap.coinsCollected !== undefined && (!Number.isSafeInteger(lap.coinsCollected) || lap.coinsCollected < 0 || lap.coinsCollected > 10)) ||
          (lap.mushroomsUsed !== undefined && (!Number.isSafeInteger(lap.mushroomsUsed) || lap.mushroomsUsed < 0 || lap.mushroomsUsed > 3))))) {
    throw fail("invalid_input");
  }
}

export function createTimeTrialLifecycleClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): TimeTrialLifecycleClient {
  const document = (body: unknown): ManagedTimeTrial => {
    const row = object(body);
    keys(row, ["schemaVersion", "result"]);
    if (row["schemaVersion"] !== "mk8dx.managed-time-trial.v1") {
      throw fail("invalid_response");
    }
    return managed(row["result"]);
  };
  const act = async (
    submissionId: string,
    action: "correct" | "retire" | "restore" | "video",
    body: unknown,
    signal?: AbortSignal,
  ): Promise<ManagedTimeTrial> => {
    if (!submissionIdPattern.test(submissionId)) {
      throw fail("invalid_input");
    }
    const proof = await csrf(fetchPort, signal);
    const response = await send(
      fetchPort,
      `/v1/time-trials/${encodeURIComponent(submissionId)}/actions/${action}`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          [proof.name]: proof.value,
        },
        body: JSON.stringify(body),
        ...(signal === undefined ? {} : { signal }),
      },
    );
    requireOk(response.status, "conflict", response.body);
    return document(response.body);
  };
  // Local validation rejects rather than throwing synchronously: every
  // caller awaits one promise, whatever the reason for the failure.
  const retirement = async (
    submissionId: string,
    action: "retire" | "restore",
    reasonCode: TimeTrialReasonCode,
    note?: string,
    signal?: AbortSignal,
  ): Promise<ManagedTimeTrial> => {
    validateReason(reasonCode, note);
    return act(
      submissionId,
      action,
      { reasonCode, ...(note === undefined ? {} : { note }) },
      signal,
    );
  };
  return {
    async read(submissionId, signal) {
      if (!submissionIdPattern.test(submissionId)) {
        throw fail("invalid_input");
      }
      const response = await send(
        fetchPort,
        `/v1/time-trials/${encodeURIComponent(submissionId)}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          ...(signal === undefined ? {} : { signal }),
        },
      );
      requireOk(response.status, "conflict");
      return document(response.body);
    },
    async correct(submissionId, correction, signal) {
      validateCorrection(correction);
      return act(submissionId, "correct", {
        totalTimeMs: correction.totalTimeMs,
        laps: [...correction.laps],
        ...(correction.lapDetails === undefined ? {} : {
          lapDetails: correction.lapDetails.map((lap) => ({
            ...(lap.coinsCollected === undefined ? {} : { coinsCollected: lap.coinsCollected }),
            ...(lap.mushroomsUsed === undefined ? {} : { mushroomsUsed: lap.mushroomsUsed }),
          })),
        }),
        ...(correction.loadout === undefined ? {} : { loadout: { ...correction.loadout } }),
        reasonCode: correction.reasonCode,
        ...(correction.note === undefined ? {} : { note: correction.note }),
      }, signal);
    },
    async setVideo(submissionId, videoUrl, signal) {
      if (videoUrl !== null && (typeof videoUrl !== "string" || videoUrl.length > 512)) {
        throw fail("invalid_input");
      }
      return act(submissionId, "video", { videoUrl }, signal);
    },
    retire(submissionId, reasonCode, note, signal) {
      return retirement(submissionId, "retire", reasonCode, note, signal);
    },
    restore(submissionId, reasonCode, note, signal) {
      return retirement(submissionId, "restore", reasonCode, note, signal);
    },
    async listForAdministrator(query, signal) {
      const limit = query.limit ?? 50;
      if ((query.playerId !== undefined && !playerIdPattern.test(query.playerId)) ||
          (query.trackId !== undefined && !trackIdPattern.test(query.trackId)) ||
          (query.sourceKind !== undefined &&
            !sourceKindPattern.test(query.sourceKind)) ||
          !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
        throw fail("invalid_input");
      }
      const parameters = new URLSearchParams();
      if (query.playerId !== undefined) { parameters.set("playerId", query.playerId); }
      if (query.trackId !== undefined) { parameters.set("trackId", query.trackId); }
      if (query.mode !== undefined) { parameters.set("mode", String(query.mode)); }
      if (query.retirementState !== undefined) {
        parameters.set("retirementState", query.retirementState);
      }
      if (query.publicationStatus !== undefined) {
        parameters.set("publicationStatus", query.publicationStatus);
      }
      if (query.sourceKind !== undefined) {
        parameters.set("sourceKind", query.sourceKind);
      }
      parameters.set("limit", String(limit));
      const response = await send(
        fetchPort,
        `/v1/administrator/time-trials?${parameters.toString()}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          ...(signal === undefined ? {} : { signal }),
        },
      );
      requireOk(response.status, "conflict");
      const row = object(response.body);
      keys(row, ["schemaVersion", "results"]);
      if (row["schemaVersion"] !== "mk8dx.managed-time-trial-list.v1" ||
          !Array.isArray(row["results"]) || row["results"].length > 200) {
        throw fail("invalid_response");
      }
      return row["results"].map(managed);
    },
  };
}

export function createPlayerVisibilityClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): PlayerVisibilityClient {
  const put = async (
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<PlayerVisibilityState> => {
    const proof = await csrf(fetchPort, signal);
    const response = await send(fetchPort, path, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        [proof.name]: proof.value,
      },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    });
    requireOk(response.status, "no_verified_player");
    return visibilityState(response.body);
  };
  return {
    async read(signal) {
      const response = await send(fetchPort, "/v1/account/player-visibility", {
        method: "GET",
        headers: { Accept: "application/json" },
        ...(signal === undefined ? {} : { signal }),
      });
      requireOk(response.status, "no_verified_player");
      return visibilityState(response.body);
    },
    setOwn(visibility, signal) {
      if (visibility !== "public" && visibility !== "private") {
        return Promise.reject(fail("invalid_input"));
      }
      return put("/v1/account/player-visibility", { visibility }, signal);
    },
    setForPlayer(playerId, visibility, reasonCode, signal) {
      if (!playerIdPattern.test(playerId) ||
          (visibility !== "public" && visibility !== "private") ||
          !reasonPattern.test(reasonCode) || reasonCode.length > 64) {
        return Promise.reject(fail("invalid_input"));
      }
      return put(
        `/v1/administrator/players/${encodeURIComponent(playerId)}/visibility`,
        { visibility, reasonCode },
        signal,
      );
    },
  };
}
