// Reads one Player's per-track tournament record.
//
// Parsing is deliberately strict and total: every field is checked before the
// view sees it, so a shape change on the server surfaces as "unavailable"
// rather than as a section quietly rendering NaN.

export type TrackRecordEntry = Readonly<{
  trackId: string;
  races: number;
  wins: number;
  podiums: number;
  bestFinish: number;
  worstFinish: number;
  averageFinish: number;
  averagePoints: number | null;
  averageFieldShare: number;
  /** Negative is better than this player's own normal. */
  relativeToOwnAverage: number;
  lastRacedAtMs: number;
}>;

export type TrackRecord = Readonly<{
  playerId: string;
  racesWithTrack: number;
  racesWithoutTrack: number;
  overallFieldShare: number | null;
  tracks: readonly TrackRecordEntry[];
}>;

export type TournamentTrackClient = Readonly<{
  record(playerId: string, signal?: AbortSignal): Promise<TrackRecord>;
}>;

export class TournamentTrackClientError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TournamentTrackClientError";
  }
}

type FetchPort = typeof globalThis.fetch;

const MAXIMUM_BYTES = 512 * 1024;

function invalid(): never {
  throw new TournamentTrackClientError("unexpected response");
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid();
  }
  return value as Record<string, unknown>;
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    invalid();
  }
  return value;
}

function decimal(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) { invalid(); }
  return value;
}

function entry(value: unknown): TrackRecordEntry {
  const row = object(value);
  if (typeof row["trackId"] !== "string" || row["trackId"].length === 0) {
    invalid();
  }
  const points = row["averagePoints"];
  if (points !== null && typeof points !== "number") { invalid(); }
  return {
    trackId: row["trackId"],
    races: count(row["races"]),
    wins: count(row["wins"]),
    podiums: count(row["podiums"]),
    bestFinish: count(row["bestFinish"]),
    worstFinish: count(row["worstFinish"]),
    averageFinish: decimal(row["averageFinish"]),
    averagePoints: points === null ? null : decimal(points),
    averageFieldShare: decimal(row["averageFieldShare"]),
    relativeToOwnAverage: decimal(row["relativeToOwnAverage"]),
    lastRacedAtMs: count(row["lastRacedAtMs"]),
  };
}

async function bounded(response: Response): Promise<unknown> {
  const body = await response.text();
  if (body.length > MAXIMUM_BYTES) { invalid(); }
  try { return JSON.parse(body) as unknown; } catch { return invalid(); }
}

export function createTournamentTrackClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): TournamentTrackClient {
  return {
    async record(playerId, signal) {
      let response: Response;
      try {
        response = await fetchPort(
          `/v1/public/players/${encodeURIComponent(playerId)}/tournament-tracks`,
          {
            method: "GET",
            credentials: "same-origin",
            mode: "same-origin",
            redirect: "error",
            referrerPolicy: "same-origin",
            cache: "no-store",
            headers: { Accept: "application/json" },
            ...(signal === undefined ? {} : { signal }),
          },
        );
      } catch {
        throw new TournamentTrackClientError("unavailable");
      }
      if (response.status !== 200) {
        throw new TournamentTrackClientError("unavailable");
      }
      const document = object(await bounded(response));
      if (document["schemaVersion"] !== "mk8dx.tournament-track-record.v1" ||
        !Array.isArray(document["tracks"])) {
        invalid();
      }
      const share = document["overallFieldShare"];
      if (share !== null && typeof share !== "number") { invalid(); }
      return {
        playerId: String(document["playerId"]),
        racesWithTrack: count(document["racesWithTrack"]),
        racesWithoutTrack: count(document["racesWithoutTrack"]),
        overallFieldShare: share === null ? null : decimal(share),
        tracks: document["tracks"].map(entry),
      };
    },
  };
}
