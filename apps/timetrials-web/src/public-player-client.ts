export const publicPlayerPath = (playerId: string): string =>
  `/v1/players/${encodeURIComponent(playerId)}`;

export const PUBLIC_PLAYER_DIRECTORY_PATH = "/v1/public/player-directory";

/** `player.<something>` identifiers, as opposed to a `@username`. */
export function isPlayerId(value: string): boolean {
  return /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value);
}

/**
 * Resolves a username to its Player identifier so `/?player=nola` works.
 * Anonymous-safe: it uses the public directory, which is the same source the
 * signed-out Player search already reads.
 */
export async function resolvePlayerReference(
  reference: string,
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
  signal?: AbortSignal,
): Promise<string | null> {
  if (isPlayerId(reference)) { return reference; }
  const query = reference.trim();
  if (query.length < 2 || query.length > 64) { return null; }
  try {
    const response = await fetchPort(
      `${PUBLIC_PLAYER_DIRECTORY_PATH}?query=${encodeURIComponent(query)}`,
      {
        method: "GET", credentials: "same-origin", mode: "same-origin",
        redirect: "error", referrerPolicy: "same-origin", cache: "no-store",
        headers: { Accept: "application/json" },
        ...(signal === undefined ? {} : { signal }),
      },
    );
    if (response.status !== 200) { return null; }
    const body = await response.json() as { players?: unknown };
    if (!Array.isArray(body.players)) { return null; }
    const wanted = query.toLowerCase();
    for (const row of body.players) {
      const candidate = row as { playerId?: unknown; username?: unknown };
      if (typeof candidate.username === "string" &&
          candidate.username.toLowerCase() === wanted &&
          typeof candidate.playerId === "string" &&
          isPlayerId(candidate.playerId)) {
        return candidate.playerId;
      }
    }
    return null;
  } catch {
    return null;
  }
}

const maximumResponseBytes = 16_384;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export type PublicPlayerProfile = Readonly<{
  playerId: string;
  username: string;
  displayName: string;
  countryId?: string;
  avatarId?: string;
  favoriteBodyId?: string;
  favoriteTireId?: string;
  favoriteGliderId?: string;
  timeTrialModePreference?: "all" | "150" | "200";
}>;

export class PublicPlayerClientError extends Error {
  public constructor(public readonly code: "not_found" | "unavailable" | "invalid_response") {
    super("The public Player profile could not be loaded.");
    this.name = "PublicPlayerClientError";
  }
}

export interface PublicPlayerClient {
  load(playerId: string, signal?: AbortSignal): Promise<PublicPlayerProfile>;
}

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PublicPlayerClientError("invalid_response");
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) {
    throw new PublicPlayerClientError("invalid_response");
  }
}

function text(value: unknown, maximum: number, pattern?: RegExp): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum ||
    (pattern !== undefined && !pattern.test(value))) {
    throw new PublicPlayerClientError("invalid_response");
  }
  return value;
}

async function boundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const declared = response.headers.get("content-length");
  if (!/^application\/json(?:\s*;|$)/.test(contentType) || response.body === null ||
    (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > maximumResponseBytes))) {
    throw new PublicPlayerClientError("invalid_response");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let result = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) { break; }
      bytes += chunk.value.byteLength;
      if (bytes > maximumResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new PublicPlayerClientError("invalid_response");
      }
      result += decoder.decode(chunk.value, { stream: true });
    }
    result += decoder.decode();
    return JSON.parse(result) as unknown;
  } catch (error) {
    if (error instanceof PublicPlayerClientError) { throw error; }
    throw new PublicPlayerClientError("invalid_response");
  }
}

export function createPublicPlayerClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): PublicPlayerClient {
  return {
    async load(playerId, signal) {
      if (!playerIdPattern.test(playerId) || playerId.length > 135) {
        throw new PublicPlayerClientError("invalid_response");
      }
      let response: Response;
      try {
        response = await fetchPort(publicPlayerPath(playerId), {
          method: "GET",
          headers: { Accept: "application/json" },
          credentials: "same-origin",
          mode: "same-origin",
          redirect: "error",
          referrerPolicy: "same-origin",
          cache: "no-store",
          ...(signal === undefined ? {} : { signal }),
        });
      } catch {
        throw new PublicPlayerClientError("unavailable");
      }
      const body = await boundedJson(response);
      if (response.status === 404) { throw new PublicPlayerClientError("not_found"); }
      if (response.status !== 200) { throw new PublicPlayerClientError("unavailable"); }
      const root = object(body);
      if ("countryId" in root &&
          (typeof root["countryId"] !== "string" ||
           !/^country\.[a-z0-9_]+$/.test(root["countryId"]))) {
        throw new PublicPlayerClientError("invalid_response");
      }
      if ("avatarId" in root &&
          (typeof root["avatarId"] !== "string" ||
           !/^character(_variant)?\.[a-z0-9_.]+$/.test(root["avatarId"]))) {
        throw new PublicPlayerClientError("invalid_response");
      }
      for (const [field, pattern] of [
        ["favoriteBodyId", /^body\.[a-z0-9_]+$/],
        ["favoriteTireId", /^tire\.[a-z0-9_]+$/],
        ["favoriteGliderId", /^glider\.[a-z0-9_]+$/],
      ] as const) {
        if (field in root && (typeof root[field] !== "string" || !pattern.test(root[field]))) {
          throw new PublicPlayerClientError("invalid_response");
        }
      }
      if ("timeTrialModePreference" in root && root["timeTrialModePreference"] !== "all" &&
          root["timeTrialModePreference"] !== "150" && root["timeTrialModePreference"] !== "200") {
        throw new PublicPlayerClientError("invalid_response");
      }
      {
        const keys = ["playerId", "username", "displayName"];
        if ("countryId" in root) { keys.push("countryId"); }
        if ("avatarId" in root) { keys.push("avatarId"); }
        for (const key of ["favoriteBodyId", "favoriteTireId", "favoriteGliderId", "timeTrialModePreference"]) {
          if (key in root) { keys.push(key); }
        }
        exact(root, keys);
      }
      const username = object(root["username"]);
      exact(username, ["value"]);
      if (root["playerId"] !== playerId) {
        throw new PublicPlayerClientError("invalid_response");
      }
      return {
        playerId: text(root["playerId"], 135, playerIdPattern),
        username: text(username["value"], 64),
        displayName: text(root["displayName"], 128),
        ...(typeof root["countryId"] === "string"
          ? { countryId: root["countryId"] }
          : {}),
        ...(typeof root["avatarId"] === "string"
          ? { avatarId: root["avatarId"] }
          : {}),
        ...(typeof root["favoriteBodyId"] === "string" ? { favoriteBodyId: root["favoriteBodyId"] } : {}),
        ...(typeof root["favoriteTireId"] === "string" ? { favoriteTireId: root["favoriteTireId"] } : {}),
        ...(typeof root["favoriteGliderId"] === "string" ? { favoriteGliderId: root["favoriteGliderId"] } : {}),
        ...(root["timeTrialModePreference"] === "all" || root["timeTrialModePreference"] === "150" || root["timeTrialModePreference"] === "200"
          ? { timeTrialModePreference: root["timeTrialModePreference"] } : {}),
      };
    },
  };
}
