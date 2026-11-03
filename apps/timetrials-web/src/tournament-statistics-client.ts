// What the community has raced, over every finished night.
//
// One small table from the server, because the evidence behind it is 1.15 MB
// of night documents. The parse is strict in the same way every other client
// here is: a key nobody knows is a contract change, and it says so rather
// than rendering half a page.

export type TournamentStatisticsEdition = Readonly<{
  editionNumber: number;
  eventDate: string | null;
  heldAtMs: number | null;
  participantCount: number;
  races: number;
  /** Everybody who had raced a tournament by the end of this night. */
  cumulativePlayers: number;
}>;

export type TournamentStatisticsTrack = Readonly<{
  trackId: string;
  races: number;
  /** How many Players drove it, summed over its races. */
  placements: number;
  /** How many different nights it was raced on. */
  nights: number;
  firstEdition: number;
  lastEdition: number;
  /** Whoever tops this track's own TrueSkill. */
  bestPlayerId: string | null;
  bestPlayerName: string | null;
  /** ADR-0218: tells two leaders with the same name apart. */
  bestPlayerUsername?: string;
  bestScore: number | null;
}>;

export type TournamentStatistics = Readonly<{
  editions: readonly TournamentStatisticsEdition[];
  tracks: readonly TournamentStatisticsTrack[];
  totals: Readonly<{
    editions: number;
    races: number;
    racesWithTrack: number;
    placements: number;
    players: number;
    tracksRaced: number;
  }>;
}>;

export class TournamentStatisticsClientError extends Error {
  public constructor(public readonly code: string) {
    super("tournament statistics client error: " + code);
    this.name = "TournamentStatisticsClientError";
  }
}

export type FetchPort = (input: string, init?: RequestInit) => Promise<Response>;

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TournamentStatisticsClientError("invalid_response");
  }
  return value as Record<string, unknown>;
}

function keys(row: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  for (const key of required) {
    if (!(key in row)) { throw new TournamentStatisticsClientError("invalid_response"); }
  }
  for (const key of Object.keys(row)) {
    if (!required.includes(key) && !optional.includes(key)) {
      throw new TournamentStatisticsClientError("invalid_response");
    }
  }
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TournamentStatisticsClientError("invalid_response");
  }
  return value;
}

function list(value: unknown, limit: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > limit) {
    throw new TournamentStatisticsClientError("invalid_response");
  }
  return value;
}

export function parseTournamentStatistics(value: unknown): TournamentStatistics {
  const row = object(value);
  keys(row, ["schemaVersion", "editions", "tracks", "totals"]);
  if (row["schemaVersion"] !== "mk8dx.public-tournament-statistics.v1") {
    throw new TournamentStatisticsClientError("invalid_response");
  }
  const totals = object(row["totals"]);
  keys(totals, ["editions", "races", "racesWithTrack", "placements", "players", "tracksRaced"]);
  return {
    editions: list(row["editions"], 200).map((entry) => {
      const edition = object(entry);
      keys(edition, ["editionNumber", "participantCount", "races", "cumulativePlayers"],
        ["eventDate", "heldAtMs"]);
      const date = edition["eventDate"];
      const held = edition["heldAtMs"];
      return {
        editionNumber: count(edition["editionNumber"]),
        eventDate: typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
        heldAtMs: typeof held === "number" && Number.isFinite(held) ? held : null,
        participantCount: count(edition["participantCount"]),
        races: count(edition["races"]),
        cumulativePlayers: count(edition["cumulativePlayers"]),
      };
    }),
    tracks: list(row["tracks"], 300).map((entry) => {
      const track = object(entry);
      keys(track, ["trackId", "races", "placements", "nights", "firstEdition",
        "lastEdition", "bestPlayerId", "bestPlayerName", "bestScore"], ["bestPlayerUsername"]);
      const trackId = track["trackId"];
      if (typeof trackId !== "string" || trackId.length === 0 || trackId.length > 160) {
        throw new TournamentStatisticsClientError("invalid_response");
      }
      return {
        trackId,
        races: count(track["races"]),
        placements: count(track["placements"]),
        nights: count(track["nights"]),
        firstEdition: count(track["firstEdition"]),
        lastEdition: count(track["lastEdition"]),
        bestPlayerId: typeof track["bestPlayerId"] === "string" ? track["bestPlayerId"] : null,
        bestPlayerName: typeof track["bestPlayerName"] === "string" ? track["bestPlayerName"] : null,
        ...(typeof track["bestPlayerUsername"] === "string" ? { bestPlayerUsername: track["bestPlayerUsername"] } : {}),
        bestScore: typeof track["bestScore"] === "number" ? track["bestScore"] : null,
      };
    }),
    totals: {
      editions: count(totals["editions"]),
      races: count(totals["races"]),
      racesWithTrack: count(totals["racesWithTrack"]),
      placements: count(totals["placements"]),
      players: count(totals["players"]),
      tracksRaced: count(totals["tracksRaced"]),
    },
  };
}

/** One Player's standing on one track, counted from a Score of zero. */
export type TrackSkillEntry = Readonly<{
  rank: number;
  playerId: string;
  displayName: string;
  username?: string;
  score: number;
  mu: number;
  sigma: number;
  races: number;
  wins: number;
  top3: number;
  bestFinish: number;
  averageFinish: number;
}>;

export type TrackSkill = Readonly<{
  trackId: string;
  races: number;
  racesSkipped: number;
  players: readonly TrackSkillEntry[];
}>;

function decimal(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TournamentStatisticsClientError("invalid_response");
  }
  return value;
}

export function parseTrackSkill(value: unknown): TrackSkill {
  const row = object(value);
  keys(row, ["schemaVersion", "trackId", "races", "racesSkipped", "players"]);
  if (row["schemaVersion"] !== "mk8dx.public-track-skill.v1") {
    throw new TournamentStatisticsClientError("invalid_response");
  }
  const trackId = row["trackId"];
  if (typeof trackId !== "string" || trackId.length === 0) {
    throw new TournamentStatisticsClientError("invalid_response");
  }
  return {
    trackId,
    races: count(row["races"]),
    racesSkipped: count(row["racesSkipped"]),
    players: list(row["players"], 300).map((entry) => {
      const player = object(entry);
      keys(player, ["rank", "playerId", "displayName", "score", "mu", "sigma",
        "races", "wins", "top3", "bestFinish", "averageFinish"], ["username"]);
      const playerId = player["playerId"];
      const displayName = player["displayName"];
      const username = player["username"];
      if (typeof playerId !== "string" || typeof displayName !== "string" ||
        (username !== undefined && (typeof username !== "string" || username.length === 0))) {
        throw new TournamentStatisticsClientError("invalid_response");
      }
      return {
        rank: count(player["rank"]),
        playerId,
        displayName,
        ...(typeof username === "string" ? { username } : {}),
        score: decimal(player["score"]),
        mu: decimal(player["mu"]),
        sigma: decimal(player["sigma"]),
        races: count(player["races"]),
        wins: count(player["wins"]),
        top3: count(player["top3"]),
        bestFinish: count(player["bestFinish"]),
        averageFinish: decimal(player["averageFinish"]),
      };
    }),
  };
}

export interface TournamentStatisticsClient {
  load(signal?: AbortSignal): Promise<TournamentStatistics>;
  loadTrack(trackId: string, signal?: AbortSignal): Promise<TrackSkill>;
}

export function createTournamentStatisticsClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): TournamentStatisticsClient {
  return {
    async load(signal?: AbortSignal): Promise<TournamentStatistics> {
      const response = await fetchPort("/v1/public/tournament-statistics", {
        method: "GET", headers: { Accept: "application/json" },
        ...(signal === undefined ? {} : { signal }),
      });
      if (!response.ok) { throw new TournamentStatisticsClientError("unavailable"); }
      return parseTournamentStatistics(await response.json());
    },
    async loadTrack(trackId: string, signal?: AbortSignal): Promise<TrackSkill> {
      const response = await fetchPort(
        `/v1/public/tournament-statistics/tracks/${encodeURIComponent(trackId)}`,
        {
          method: "GET", headers: { Accept: "application/json" },
          ...(signal === undefined ? {} : { signal }),
        },
      );
      if (!response.ok) { throw new TournamentStatisticsClientError("unavailable"); }
      return parseTrackSkill(await response.json());
    },
  };
}
