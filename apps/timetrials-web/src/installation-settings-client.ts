/**
 * Installation settings (ADR-0221): who creates Players and who counts for the rating, and (ADR-0225)
 * whether times carried from another community are accepted. Anyone reads the public settings (pages
 * explain a missing button with them); administrators read the audit-facing view,
 * save changes and start the explicit rating recalculation. Responses are checked key for key, like
 * every client here; tests/contracts binds the keys to the API schemas.
 */

export const INSTALLATION_SETTINGS_PATH = "/v1/installation-settings";
export const INSTALLATION_SETTINGS_ADMINISTRATION_PATH = "/v1/administrator/installation-settings";
export const INSTALLATION_RECOMPUTE_PATH = "/v1/administrator/installation-settings/actions/recompute-ratings";
const CSRF_PATH = "/v1/session/csrf";

const maximumResponseBytes = 16_384;

export type PlayerCreationPolicy = "self_and_directors" | "self_only" | "directors_only";
export type RatingEligibilityPolicy = "all_players" | "claimed_only";
export type CarriedTimesPolicy = "off" | "review" | "allowed";

export type InstallationSettings = Readonly<{
  playerCreation: PlayerCreationPolicy;
  ratingEligibility: RatingEligibilityPolicy;
  carriedTimes: CarriedTimesPolicy;
}>;

export const DEFAULT_INSTALLATION_SETTINGS: InstallationSettings = {
  playerCreation: "self_and_directors",
  ratingEligibility: "all_players",
  carriedTimes: "off",
};

export type RatingRecomputeStatus = Readonly<{
  needed: boolean;
  eligibilityChanged: boolean;
  claimChanges: number;
  lastRecalculatedAtMs: number | null;
}>;

export type InstallationSettingsAdministration = InstallationSettings & Readonly<{
  revision: number;
  updatedAtMs: number | null;
  /** ADR-0225: carried runs withheld for review right now. */
  carriedTimesAwaitingReview: number;
  ratingRecompute: RatingRecomputeStatus;
}>;

export type InstallationRatingRecompute = Readonly<{
  epoch: number;
  includedPublications: number;
  appliedRaces: number;
  skippedRaces: number;
  ratedPlayers: number;
}>;

/** ADR-0225: what happened to the carried runs that were still waiting. */
export type CarriedWaitingResolution = Readonly<{
  decision: "publish" | "refuse";
  resolved: number;
  left: number;
}>;

export const CARRIED_WAITING_RESOLUTION_PATH = "/v1/administrator/time-trials/actions/resolve-carried-waiting";

export type InstallationSettingsErrorCode =
  | "not_authorized" | "conflict" | "invalid_input" | "unavailable" | "invalid_response";

export class InstallationSettingsClientError extends Error {
  public constructor(
    public readonly code: InstallationSettingsErrorCode,
    public readonly serverCode: string | null = null,
    public readonly serverMessage: string | null = null,
  ) {
    super(`Installation settings failed: ${code}`);
    this.name = "InstallationSettingsClientError";
  }
}

export interface InstallationSettingsClient {
  current(signal?: AbortSignal): Promise<InstallationSettings>;
  administration(signal?: AbortSignal): Promise<InstallationSettingsAdministration>;
  update(input: Readonly<{
    expectedRevision: number;
    playerCreation?: PlayerCreationPolicy;
    ratingEligibility?: RatingEligibilityPolicy;
    carriedTimes?: CarriedTimesPolicy;
  }>, signal?: AbortSignal): Promise<InstallationSettingsAdministration>;
  recomputeRatings(signal?: AbortSignal): Promise<InstallationRatingRecompute>;
  /** Publishes or refuses every carried run still waiting; expectedCount is the number on screen. */
  resolveCarriedWaiting(
    decision: "publish" | "refuse",
    expectedCount: number,
    signal?: AbortSignal,
  ): Promise<CarriedWaitingResolution>;
}

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;

function fail(): never { throw new InstallationSettingsClientError("invalid_response"); }

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) { fail(); }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) { fail(); }
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) { fail(); }
  return value;
}

function flag(value: unknown): boolean {
  if (typeof value !== "boolean") { fail(); }
  return value;
}

function text(value: unknown, maximum: number, pattern: RegExp): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || !pattern.test(value)) { fail(); }
  return value;
}

function playerCreation(value: unknown): PlayerCreationPolicy {
  if (value !== "self_and_directors" && value !== "self_only" && value !== "directors_only") { fail(); }
  return value;
}

function ratingEligibility(value: unknown): RatingEligibilityPolicy {
  if (value !== "all_players" && value !== "claimed_only") { fail(); }
  return value;
}

function carriedTimes(value: unknown): CarriedTimesPolicy {
  if (value !== "off" && value !== "review" && value !== "allowed") { fail(); }
  return value;
}

function settingsDocument(value: unknown): InstallationSettings {
  const row = object(value);
  exact(row, ["schemaVersion", "playerCreation", "ratingEligibility", "carriedTimes"]);
  if (row["schemaVersion"] !== "mk8dx.installation-settings.v1") { fail(); }
  return {
    playerCreation: playerCreation(row["playerCreation"]),
    ratingEligibility: ratingEligibility(row["ratingEligibility"]),
    carriedTimes: carriedTimes(row["carriedTimes"]),
  };
}

function recomputeStatus(value: unknown): RatingRecomputeStatus {
  const row = object(value);
  exact(row, ["needed", "eligibilityChanged", "claimChanges", "lastRecalculatedAtMs"]);
  return {
    needed: flag(row["needed"]),
    eligibilityChanged: flag(row["eligibilityChanged"]),
    claimChanges: count(row["claimChanges"]),
    lastRecalculatedAtMs: row["lastRecalculatedAtMs"] === null ? null : count(row["lastRecalculatedAtMs"]),
  };
}

function administrationDocument(value: unknown): InstallationSettingsAdministration {
  const row = object(value);
  exact(row, [
    "schemaVersion", "playerCreation", "ratingEligibility", "carriedTimes", "revision", "updatedAtMs",
    "carriedTimesAwaitingReview", "ratingRecompute",
  ]);
  if (row["schemaVersion"] !== "mk8dx.installation-settings-administration.v1") { fail(); }
  return {
    playerCreation: playerCreation(row["playerCreation"]),
    ratingEligibility: ratingEligibility(row["ratingEligibility"]),
    carriedTimes: carriedTimes(row["carriedTimes"]),
    revision: count(row["revision"]),
    updatedAtMs: row["updatedAtMs"] === null ? null : count(row["updatedAtMs"]),
    carriedTimesAwaitingReview: count(row["carriedTimesAwaitingReview"]),
    ratingRecompute: recomputeStatus(row["ratingRecompute"]),
  };
}

function resolutionDocument(value: unknown): CarriedWaitingResolution {
  const row = object(value);
  exact(row, ["schemaVersion", "decision", "resolved", "left"]);
  if (row["schemaVersion"] !== "mk8dx.carried-waiting-resolution.v1") { fail(); }
  const decision = row["decision"];
  if (decision !== "publish" && decision !== "refuse") { fail(); }
  return { decision, resolved: count(row["resolved"]), left: count(row["left"]) };
}

function recomputeDocument(value: unknown): InstallationRatingRecompute {
  const row = object(value);
  exact(row, ["schemaVersion", "epoch", "includedPublications", "appliedRaces", "skippedRaces", "ratedPlayers"]);
  if (row["schemaVersion"] !== "mk8dx.installation-rating-recompute.v1") { fail(); }
  return {
    epoch: count(row["epoch"]),
    includedPublications: count(row["includedPublications"]),
    appliedRaces: count(row["appliedRaces"]),
    skippedRaces: count(row["skippedRaces"]),
    ratedPlayers: count(row["ratedPlayers"]),
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
  if (response.status === 200) { return; }
  let serverCode: string | null = null;
  let serverMessage: string | null = null;
  try {
    const body = await response.json() as { code?: unknown; message?: unknown };
    serverCode = typeof body.code === "string" ? body.code : null;
    serverMessage = typeof body.message === "string" ? body.message.slice(0, 400) : null;
  } catch { /* the status alone answers */ }
  const code: InstallationSettingsErrorCode = response.status === 401 || response.status === 403 ? "not_authorized"
    : response.status === 409 ? "conflict"
    : response.status === 400 ? "invalid_input"
    : response.status >= 500 ? "unavailable"
    : "invalid_response";
  throw new InstallationSettingsClientError(code, serverCode, serverMessage);
}

export function createInstallationSettingsClient(
  fetchPort: FetchPort = (input, init) => globalThis.fetch(input, init),
): InstallationSettingsClient {
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
      throw new InstallationSettingsClientError("unavailable");
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
  return {
    async current(signal) { return settingsDocument(await get(INSTALLATION_SETTINGS_PATH, signal)); },
    async administration(signal) { return administrationDocument(await get(INSTALLATION_SETTINGS_ADMINISTRATION_PATH, signal)); },
    async update(input, signal) {
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
        throw new InstallationSettingsClientError("invalid_input");
      }
      return administrationDocument(await post(INSTALLATION_SETTINGS_ADMINISTRATION_PATH, {
        expectedRevision: input.expectedRevision,
        ...(input.playerCreation === undefined ? {} : { playerCreation: input.playerCreation }),
        ...(input.ratingEligibility === undefined ? {} : { ratingEligibility: input.ratingEligibility }),
        ...(input.carriedTimes === undefined ? {} : { carriedTimes: input.carriedTimes }),
      }, signal));
    },
    async recomputeRatings(signal) { return recomputeDocument(await post(INSTALLATION_RECOMPUTE_PATH, {}, signal)); },
    async resolveCarriedWaiting(decision, expectedCount, signal) {
      if ((decision !== "publish" && decision !== "refuse") || !Number.isSafeInteger(expectedCount) || expectedCount < 1) {
        throw new InstallationSettingsClientError("invalid_input");
      }
      return resolutionDocument(await post(CARRIED_WAITING_RESOLUTION_PATH, { decision, expectedCount }, signal));
    },
  };
}

/**
 * The public settings for a page that only needs to know whether to offer a button. A failed read
 * falls back to the defaults: the server still refuses what the setting closes, with a clear code.
 */
export async function loadInstallationSettings(
  client: Pick<InstallationSettingsClient, "current"> = createInstallationSettingsClient(),
  signal?: AbortSignal,
): Promise<InstallationSettings> {
  try {
    return await client.current(signal);
  } catch {
    return DEFAULT_INSTALLATION_SETTINGS;
  }
}
