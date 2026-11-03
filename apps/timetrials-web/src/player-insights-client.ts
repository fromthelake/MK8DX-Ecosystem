export const PLAYER_INSIGHTS_PATH = "/v1/me/player-insights";

const maximumResponseBytes = 131_072;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const trackIdPattern = /^track\.[a-z0-9]+(?:_[a-z0-9]+)*$/;

export type PlayerInsightsDocument = Readonly<{
  schemaVersion: "mk8dx.player-insights.v1";
  playerId: string;
  timeTrials: Readonly<{
    submissionCount: number;
    personalBests: readonly Readonly<{
      trackId: string;
      modeCC: 150 | 200;
      bestTimeMs: number;
      attemptCount: number;
    }>[];
  }>;
  tournaments: Readonly<{
    raceCount: number;
    countedRaceCount: number;
    wins: number;
    podiums: number;
    countedPoints: number;
    countedFinishPositionTotal: number;
  }>;
}>;

export class PlayerInsightsClientError extends Error {
  public constructor(public readonly code: "claim_required" | "unavailable" | "invalid_response") {
    super("Player insights could not be loaded.");
    this.name = "PlayerInsightsClientError";
  }
}

export interface PlayerInsightsClient {
  loadMine(signal?: AbortSignal): Promise<PlayerInsightsDocument>;
}

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PlayerInsightsClientError("invalid_response");
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) {
    throw new PlayerInsightsClientError("invalid_response");
  }
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) ||
    value < minimum || value > maximum) {
    throw new PlayerInsightsClientError("invalid_response");
  }
  return value;
}

function parse(value: unknown): PlayerInsightsDocument {
  const root = object(value);
  exact(root, ["schemaVersion", "playerId", "timeTrials", "tournaments"]);
  if (root["schemaVersion"] !== "mk8dx.player-insights.v1" ||
    typeof root["playerId"] !== "string" || !playerIdPattern.test(root["playerId"])) {
    throw new PlayerInsightsClientError("invalid_response");
  }
  const trials = object(root["timeTrials"]);
  exact(trials, ["submissionCount", "personalBests"]);
  if (!Array.isArray(trials["personalBests"]) || trials["personalBests"].length > 192) {
    throw new PlayerInsightsClientError("invalid_response");
  }
  const personalBests = trials["personalBests"].map((value) => {
    const row = object(value);
    exact(row, ["trackId", "modeCC", "bestTimeMs", "attemptCount"]);
    const modeCC = integer(row["modeCC"], 150, 200);
    if (typeof row["trackId"] !== "string" || !trackIdPattern.test(row["trackId"]) ||
      (modeCC !== 150 && modeCC !== 200)) {
      throw new PlayerInsightsClientError("invalid_response");
    }
    const canonicalModeCC: 150 | 200 = modeCC === 150 ? 150 : 200;
    return {
      trackId: row["trackId"],
      modeCC: canonicalModeCC,
      bestTimeMs: integer(row["bestTimeMs"], 1, 599999),
      attemptCount: integer(row["attemptCount"], 1),
    };
  });
  const tournaments = object(root["tournaments"]);
  exact(tournaments, ["raceCount", "countedRaceCount", "wins", "podiums",
    "countedPoints", "countedFinishPositionTotal"]);
  const submissionCount = integer(trials["submissionCount"]);
  const parsedTournaments = {
    raceCount: integer(tournaments["raceCount"]),
    countedRaceCount: integer(tournaments["countedRaceCount"]),
    wins: integer(tournaments["wins"]),
    podiums: integer(tournaments["podiums"]),
    countedPoints: integer(tournaments["countedPoints"]),
    countedFinishPositionTotal: integer(tournaments["countedFinishPositionTotal"]),
  };
  const uniqueRecords = new Set(personalBests.map((record) =>
    `${record.trackId}\u0000${record.modeCC}`));
  if (personalBests.reduce((total, record) => total + record.attemptCount, 0) !==
      submissionCount || uniqueRecords.size !== personalBests.length ||
    parsedTournaments.countedRaceCount > parsedTournaments.raceCount ||
    parsedTournaments.wins > parsedTournaments.podiums ||
    parsedTournaments.podiums > parsedTournaments.countedRaceCount ||
    parsedTournaments.countedFinishPositionTotal < parsedTournaments.countedRaceCount ||
    parsedTournaments.countedFinishPositionTotal >
      parsedTournaments.countedRaceCount * 12) {
    throw new PlayerInsightsClientError("invalid_response");
  }
  return {
    schemaVersion: root["schemaVersion"],
    playerId: root["playerId"],
    timeTrials: {
      submissionCount,
      personalBests,
    },
    tournaments: parsedTournaments,
  };
}

async function bounded(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!/^application\/json(?:\s*;|$)/.test(contentType) || response.body === null) {
    throw new PlayerInsightsClientError("invalid_response");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) { break; }
      size += chunk.value.byteLength;
      if (size > maximumResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new PlayerInsightsClientError("invalid_response");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof PlayerInsightsClientError) { throw error; }
    throw new PlayerInsightsClientError("invalid_response");
  }
}

export function createPlayerInsightsClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): PlayerInsightsClient {
  return {
    async loadMine(signal) {
      let response: Response;
      try {
        response = await fetchPort(PLAYER_INSIGHTS_PATH, {
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
        throw new PlayerInsightsClientError("unavailable");
      }
      const body = await bounded(response);
      if (response.status === 403) {
        throw new PlayerInsightsClientError("claim_required");
      }
      if (response.status !== 200) {
        throw new PlayerInsightsClientError("unavailable");
      }
      return parse(body);
    },
  };
}
