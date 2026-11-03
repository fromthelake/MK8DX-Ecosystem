// The Tournament standing and the head-to-head record behind it.
//
// Both are public: a Tournament standing is a fact about public Players, and
// somebody deciding whether to come along on a race night should be able to
// read it before they have an account.

export const TOURNAMENT_STANDING_PATH = "/v1/public/tournament-standing";

export const FINISH_POSITIONS = 12;

const maximumResponseBytes = 262_144;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export type TournamentStandingEntry = Readonly<{
  rank: number;
  playerId: string;
  username: string;
  displayName: string;
  score?: number;
  tournaments: number;
  races: number;
  wins: number;
  podiums: number;
  points: number;
  finishPositionTotal: number;
  finishes: readonly number[];
  lastRaceAtMs?: number;
}>;

export type TournamentRivalry = Readonly<{
  playerId: string;
  username: string;
  displayName: string;
  sharedRaces: number;
  ahead: number;
  behind: number;
  tied: number;
  averagePointsDelta: number;
}>;

/**
 * One Player's record over only the races a whole comparison finished, so the
 * bars next to each other describe the same races (owner, 2026-09-17).
 */
export type TournamentSharedRecord = Readonly<{
  playerId: string;
  races: number;
  wins: number;
  podiums: number;
  points: number;
  finishPositionTotal: number;
  finishes: readonly number[];
}>;

export type TournamentSharedRaces = Readonly<{
  sharedRaces: number;
  entries: readonly TournamentSharedRecord[];
}>;

export const TOURNAMENT_SHARED_RACES_PATH = "/v1/public/tournament-shared-races";

export class TournamentStandingClientError extends Error {
  public constructor(public readonly code: "unavailable" | "invalid_response") {
    super("The Tournament standing could not be loaded.");
    this.name = "TournamentStandingClientError";
  }
}

export interface TournamentStandingClient {
  standing(signal?: AbortSignal): Promise<readonly TournamentStandingEntry[]>;
  rivalries(
    playerId: string, signal?: AbortSignal,
  ): Promise<readonly TournamentRivalry[]>;
  /** The main Player first, then one or two others. */
  sharedRaces(
    playerIds: readonly string[], signal?: AbortSignal,
  ): Promise<TournamentSharedRaces>;
}

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;

function invalid(): never {
  throw new TournamentStandingClientError("invalid_response");
}

function whole(value: unknown, maximum = 1_000_000): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) ||
    value < 0 || value > maximum) { invalid(); }
  return value;
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 ||
    value.length > maximum) { invalid(); }
  return value;
}

function playerId(value: unknown): string {
  const candidate = text(value, 135);
  if (!playerIdPattern.test(candidate)) { invalid(); }
  return candidate;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid();
  }
  return value as Record<string, unknown>;
}

function entry(value: unknown): TournamentStandingEntry {
  const row = object(value);
  const finishes = row["finishes"];
  if (!Array.isArray(finishes) || finishes.length !== FINISH_POSITIONS) {
    invalid();
  }
  const score = row["score"];
  if (score !== undefined && (typeof score !== "number" || !Number.isFinite(score))) {
    invalid();
  }
  const lastRaceAtMs = row["lastRaceAtMs"];
  return {
    rank: whole(row["rank"]),
    playerId: playerId(row["playerId"]),
    username: text(row["username"], 64),
    displayName: text(row["displayName"], 128),
    ...(typeof score === "number" ? { score } : {}),
    tournaments: whole(row["tournaments"]),
    races: whole(row["races"]),
    wins: whole(row["wins"]),
    podiums: whole(row["podiums"]),
    points: whole(row["points"], 10_000_000),
    finishPositionTotal: whole(row["finishPositionTotal"], 10_000_000),
    finishes: finishes.map((count) => whole(count)),
    ...(lastRaceAtMs === undefined
      ? {}
      : { lastRaceAtMs: whole(lastRaceAtMs, Number.MAX_SAFE_INTEGER) }),
  };
}

function rivalry(value: unknown): TournamentRivalry {
  const row = object(value);
  const delta = row["averagePointsDelta"];
  if (typeof delta !== "number" || !Number.isFinite(delta)) { invalid(); }
  return {
    playerId: playerId(row["playerId"]),
    username: text(row["username"], 64),
    displayName: text(row["displayName"], 128),
    sharedRaces: whole(row["sharedRaces"]),
    ahead: whole(row["ahead"]),
    behind: whole(row["behind"]),
    tied: whole(row["tied"]),
    averagePointsDelta: delta,
  };
}

function sharedRecord(value: unknown): TournamentSharedRecord {
  const row = object(value);
  const finishes = row["finishes"];
  if (!Array.isArray(finishes) || finishes.length !== FINISH_POSITIONS) {
    invalid();
  }
  return {
    playerId: playerId(row["playerId"]),
    races: whole(row["races"]),
    wins: whole(row["wins"]),
    podiums: whole(row["podiums"]),
    points: whole(row["points"], 10_000_000),
    finishPositionTotal: whole(row["finishPositionTotal"], 10_000_000),
    finishes: finishes.map((count) => whole(count)),
  };
}

async function bounded(response: Response): Promise<unknown> {
  const body = await response.text();
  if (body.length > maximumResponseBytes) { invalid(); }
  try { return JSON.parse(body) as unknown; } catch { return invalid(); }
}

export function createTournamentStandingClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): TournamentStandingClient {
  const read = async (path: string, signal?: AbortSignal): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetchPort(path, {
        method: "GET",
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        referrerPolicy: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
        ...(signal === undefined ? {} : { signal }),
      });
    } catch {
      throw new TournamentStandingClientError("unavailable");
    }
    if (response.status !== 200) {
      throw new TournamentStandingClientError("unavailable");
    }
    return bounded(response);
  };

  return {
    async standing(signal) {
      const document = object(await read(TOURNAMENT_STANDING_PATH, signal));
      if (document["schemaVersion"] !== "mk8dx.tournament-standing.v1" ||
        !Array.isArray(document["entries"])) { invalid(); }
      return document["entries"].map(entry);
    },
    async rivalries(player, signal) {
      const document = object(await read(
        `/v1/public/players/${encodeURIComponent(player)}/tournament-rivalries`,
        signal,
      ));
      if (document["schemaVersion"] !== "mk8dx.tournament-rivalries.v1" ||
        !Array.isArray(document["opponents"])) { invalid(); }
      return document["opponents"].map(rivalry);
    },
    async sharedRaces(players, signal) {
      const document = object(await read(
        `${TOURNAMENT_SHARED_RACES_PATH}?players=${
          players.map((player) => encodeURIComponent(player)).join(",")}`,
        signal,
      ));
      if (document["schemaVersion"] !== "mk8dx.tournament-shared-races.v1" ||
        !Array.isArray(document["entries"])) { invalid(); }
      const entries = document["entries"].map(sharedRecord);
      // The answer has to line up with the ask, one record per Player in order.
      if (entries.length !== players.length ||
        entries.some((row, index) => row.playerId !== players[index])) { invalid(); }
      return { sharedRaces: whole(document["sharedRaces"]), entries };
    },
  };
}
