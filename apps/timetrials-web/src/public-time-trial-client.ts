const maximumResponseBytes = 131_072;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const trackIdPattern = /^track\.[a-z0-9]+(?:_[a-z0-9]+)*$/;
const resultIdPattern = /^user_submission\.time\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const assetIdPattern = /^[a-z_]+\.[a-z0-9_.]+$/;

export type PublicTimeTrialResult = Readonly<{
  resultId: string;
  revision: number;
  playerId: string;
  playerUsername: string;
  playerDisplayName: string;
  countryId?: string;
  trackId: string;
  mode: 150 | 200;
  totalTimeMs: number;
  laps: readonly Readonly<{
    lapNumber: number;
    timeMs: number;
    coinsCollected?: number;
    mushroomsUsed?: number;
  }>[];
  loadout?: Readonly<Record<string, string>>;
  sourceKind: string;
  correctedFields?: readonly string[];
  resultAtMs: number;
  publishedAtMs: number;
  rank?: number;
  /** The Player's own YouTube video of this run (always https://www.youtube.com/watch?v=…). */
  videoUrl?: string;
}>;

export type PublicTimeTrialDocument = Readonly<{
  schemaVersion:
    | "mk8dx.public-player-time-trials.v1"
    | "mk8dx.public-time-trial-leaderboard.v1"
    | "mk8dx.public-activity.v1";
  results: readonly PublicTimeTrialResult[];
}>;

export class PublicTimeTrialClientError extends Error {
  public constructor(public readonly code: "invalid_input" | "unavailable" | "invalid_response") {
    super("Public Time Trial results could not be loaded.");
    this.name = "PublicTimeTrialClientError";
  }
}

export interface PublicTimeTrialClient {
  listPlayer(playerId: string, signal?: AbortSignal): Promise<PublicTimeTrialDocument>;
  activity(signal?: AbortSignal): Promise<PublicTimeTrialDocument>;
  leaderboard(
    trackId: string,
    mode: 150 | 200,
    signal?: AbortSignal,
  ): Promise<PublicTimeTrialDocument>;
}

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PublicTimeTrialClientError("invalid_response");
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
    throw new PublicTimeTrialClientError("invalid_response");
  }
}

function text(value: unknown, maximum: number, pattern?: RegExp): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum ||
      (pattern !== undefined && !pattern.test(value))) {
    throw new PublicTimeTrialClientError("invalid_response");
  }
  return value;
}

function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) ||
      value < minimum || value > maximum) {
    throw new PublicTimeTrialClientError("invalid_response");
  }
  return value;
}

function optionalInteger(
  source: Record<string, unknown>,
  name: string,
  minimum: number,
  maximum: number,
): number | undefined {
  return name in source ? integer(source[name], minimum, maximum) : undefined;
}

function parseResult(value: unknown): PublicTimeTrialResult {
  const row = object(value);
  const required = [
    "resultId", "revision", "playerId", "playerUsername", "playerDisplayName",
    "trackId", "mode", "totalTimeMs", "laps", "sourceKind", "resultAtMs", "publishedAtMs",
  ] as const;
  keys(row, required, ["loadout", "rank", "countryId", "correctedFields", "videoUrl"]);
  const mode = integer(row["mode"], 150, 200);
  if (mode !== 150 && mode !== 200) {
    throw new PublicTimeTrialClientError("invalid_response");
  }
  if (!Array.isArray(row["laps"]) || row["laps"].length > 7) {
    throw new PublicTimeTrialClientError("invalid_response");
  }
  const laps = row["laps"].map((value) => {
    const lap = object(value);
    keys(lap, ["lapNumber", "timeMs"], ["coinsCollected", "mushroomsUsed"]);
    const coinsCollected = optionalInteger(lap, "coinsCollected", 0, 10);
    const mushroomsUsed = optionalInteger(lap, "mushroomsUsed", 0, 3);
    return {
      lapNumber: integer(lap["lapNumber"], 1, 7),
      timeMs: integer(lap["timeMs"], 1, 599_999),
      ...(coinsCollected === undefined ? {} : { coinsCollected }),
      ...(mushroomsUsed === undefined ? {} : { mushroomsUsed }),
    };
  });
  let loadout: Readonly<Record<string, string>> | undefined;
  if ("loadout" in row) {
    const source = object(row["loadout"]);
    const allowed = [
      "characterId", "characterVariantId", "bodyId", "bodyVariantId", "tireId",
      "gliderId", "gliderVariantId",
    ];
    keys(source, [], allowed);
    loadout = Object.fromEntries(
      Object.entries(source).map(([name, id]) => [name, text(id, 255, assetIdPattern)]),
    );
  }
  const rank = optionalInteger(row, "rank", 1, 100);
  let correctedFields: readonly string[] | undefined;
  if ("correctedFields" in row) {
    if (!Array.isArray(row["correctedFields"]) ||
        row["correctedFields"].length < 1 || row["correctedFields"].length > 15) {
      throw new PublicTimeTrialClientError("invalid_response");
    }
    correctedFields = row["correctedFields"].map((field) =>
      text(field, 32, /^[A-Za-z][A-Za-z0-9]*$/));
    if (new Set(correctedFields).size !== correctedFields.length) {
      throw new PublicTimeTrialClientError("invalid_response");
    }
  }
  return {
    resultId: text(row["resultId"], 160, resultIdPattern),
    revision: integer(row["revision"], 1),
    playerId: text(row["playerId"], 135, playerIdPattern),
    playerUsername: text(row["playerUsername"], 64),
    playerDisplayName: text(row["playerDisplayName"], 128),
    ...(typeof row["countryId"] === "string" &&
      /^country\.[a-z0-9_]+$/.test(row["countryId"])
      ? { countryId: row["countryId"] }
      : {}),
    trackId: text(row["trackId"], 255, trackIdPattern),
    mode,
    totalTimeMs: integer(row["totalTimeMs"], 1, 599_999),
    laps,
    ...(loadout === undefined ? {} : { loadout }),
    sourceKind: text(row["sourceKind"], 48, /^[a-z0-9]+(?:_[a-z0-9]+)*$/),
    ...(correctedFields === undefined ? {} : { correctedFields }),
    resultAtMs: integer(row["resultAtMs"], 0),
    publishedAtMs: integer(row["publishedAtMs"], 0),
    ...(rank === undefined ? {} : { rank }),
    // Only ever a canonical YouTube watch link, so the page can open it without a second check.
    ...("videoUrl" in row
      ? { videoUrl: text(row["videoUrl"], 64, /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/) }
      : {}),
  };
}

async function boundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const declared = response.headers.get("content-length");
  if (!/^application\/json(?:\s*;|$)/.test(contentType) || response.body === null ||
      (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > maximumResponseBytes))) {
    throw new PublicTimeTrialClientError("invalid_response");
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
        throw new PublicTimeTrialClientError("invalid_response");
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof PublicTimeTrialClientError) { throw error; }
    throw new PublicTimeTrialClientError("invalid_response");
  }
}

function parseDocument(value: unknown, schemaVersion: PublicTimeTrialDocument["schemaVersion"]): PublicTimeTrialDocument {
  const document = object(value);
  keys(document, ["schemaVersion", "results"]);
  if (document["schemaVersion"] !== schemaVersion || !Array.isArray(document["results"]) ||
      document["results"].length > 100) {
    throw new PublicTimeTrialClientError("invalid_response");
  }
  return { schemaVersion, results: document["results"].map(parseResult) };
}

export function createPublicTimeTrialClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): PublicTimeTrialClient {
  const get = async (
    path: string,
    schemaVersion: PublicTimeTrialDocument["schemaVersion"],
    signal?: AbortSignal,
  ): Promise<PublicTimeTrialDocument> => {
    let response: Response;
    try {
      response = await fetchPort(path, {
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
      throw new PublicTimeTrialClientError("unavailable");
    }
    const body = await boundedJson(response);
    if (response.status !== 200) { throw new PublicTimeTrialClientError("unavailable"); }
    return parseDocument(body, schemaVersion);
  };
  return {
    activity(signal) {
      return get(
        "/v1/public/activity",
        "mk8dx.public-activity.v1",
        signal,
      );
    },
    listPlayer(playerId, signal) {
      if (!playerIdPattern.test(playerId) || playerId.length > 135) {
        return Promise.reject(new PublicTimeTrialClientError("invalid_input"));
      }
      return get(
        `/v1/public/players/${encodeURIComponent(playerId)}/time-trials`,
        "mk8dx.public-player-time-trials.v1",
        signal,
      );
    },
    leaderboard(trackId, mode, signal) {
      if (!trackIdPattern.test(trackId) || trackId.length > 255 ||
          (mode !== 150 && mode !== 200)) {
        return Promise.reject(new PublicTimeTrialClientError("invalid_input"));
      }
      const query = new URLSearchParams({ trackId, mode: String(mode) });
      return get(
        `/v1/public/time-trial-leaderboard?${query.toString()}`,
        "mk8dx.public-time-trial-leaderboard.v1",
        signal,
      );
    },
  };
}
