// The signed-in Player's own recent Time Trial runs (`/v1/me/player-activity`), for the momentum on
// My records & stats (owner 2026-09-26). Only the runs are read; the tournament races in the same
// document stay the Tournament sections' business, but the document's shape is still checked.

export type ActivityRun = Readonly<{
  trackId: string;
  modeCC: 150 | 200;
  totalTimeMs: number;
  /** When the run was driven, or when it reached the server if that is unknown. */
  atMs: number;
}>;

export type PlayerActivityDocument = Readonly<{
  playerId: string;
  displayName: string;
  runs: readonly ActivityRun[];
}>;

export class PlayerActivityClientError extends Error {
  public constructor(public readonly code: "unavailable" | "invalid_response") {
    super("Player activity could not be loaded.");
    this.name = "PlayerActivityClientError";
  }
}

const trackIdPattern = /^track\.[a-z0-9]+(?:_[a-z0-9]+)*$/u;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PlayerActivityClientError("invalid_response");
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) {
    throw new PlayerActivityClientError("invalid_response");
  }
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new PlayerActivityClientError("invalid_response");
  }
  return value;
}

function document(value: unknown): PlayerActivityDocument {
  const root = object(value);
  exact(root, ["schemaVersion", "player", "timeTrials", "tournamentRaces"]);
  if (root["schemaVersion"] !== "mk8dx.player-activity.v1" || !Array.isArray(root["timeTrials"]) ||
    !Array.isArray(root["tournamentRaces"]) || root["timeTrials"].length > 100) {
    throw new PlayerActivityClientError("invalid_response");
  }
  const player = object(root["player"]);
  exact(player, ["playerId", "username", "displayName"]);
  if (typeof player["playerId"] !== "string" || !playerIdPattern.test(player["playerId"]) ||
    typeof player["displayName"] !== "string") {
    throw new PlayerActivityClientError("invalid_response");
  }
  return { playerId: player["playerId"], displayName: player["displayName"], runs: root["timeTrials"].map(run) };
}

function run(value: unknown): ActivityRun {
  const row = object(value);
  exact(row, ["submissionId", "revision", "trackId", "modeCC", "totalTimeMs", "sourceKind", "occurredAtMs", "createdAtMs"]);
  const modeCC = integer(row["modeCC"], 150, 200);
  if (typeof row["trackId"] !== "string" || !trackIdPattern.test(row["trackId"]) || (modeCC !== 150 && modeCC !== 200)) {
    throw new PlayerActivityClientError("invalid_response");
  }
  const createdAtMs = integer(row["createdAtMs"]);
  const occurredAtMs = row["occurredAtMs"] === null ? null : integer(row["occurredAtMs"]);
  return {
    trackId: row["trackId"],
    modeCC: modeCC === 150 ? 150 : 200,
    totalTimeMs: integer(row["totalTimeMs"], 1, 599_999),
    atMs: occurredAtMs ?? createdAtMs,
  };
}

/** Null when the reader has no verified Player (the page then simply leaves momentum out). */
export async function fetchMyActivity(signal?: AbortSignal): Promise<PlayerActivityDocument | null> {
  const response = await fetch("/v1/me/player-activity", {
    method: "GET", headers: { Accept: "application/json" }, credentials: "same-origin",
    mode: "same-origin", redirect: "error", referrerPolicy: "same-origin", cache: "no-store",
    ...(signal === undefined ? {} : { signal }),
  });
  if (response.status === 403 || response.status === 401) { return null; }
  if (response.status !== 200) { throw new PlayerActivityClientError("unavailable"); }
  return document(await response.json());
}

export const parsePlayerActivity = document;
