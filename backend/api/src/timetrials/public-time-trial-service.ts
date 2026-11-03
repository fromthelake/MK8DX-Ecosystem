import type { TimeTrialTrackScope } from "./track-scope.js";

const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const trackIdPattern = /^track\.[a-z0-9]+(?:_[a-z0-9]+)*$/;

export type PublicTimeTrialLap = Readonly<{
  lapNumber: number;
  timeMs: number;
  coinsCollected?: number;
  mushroomsUsed?: number;
}>;

export type PublicTimeTrialLoadout = Readonly<{
  characterId?: string;
  characterVariantId?: string;
  bodyId?: string;
  bodyVariantId?: string;
  tireId?: string;
  gliderId?: string;
  gliderVariantId?: string;
}>;

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
  laps: readonly PublicTimeTrialLap[];
  loadout?: PublicTimeTrialLoadout;
  sourceKind: string;
  correctedFields?: readonly string[];
  /** The Player's own YouTube video of this run (migration 0071). */
  videoUrl?: string;
  resultAtMs: number;
  publishedAtMs: number;
  rank?: number;
}>;

export type PublicTrackBest = Readonly<{
  trackId: string;
  mode: 150 | 200;
  totalTimeMs: number;
  // The player's position among published human bests on that combo. It
  // travels with the time because every caller that wants one wants the
  // other, and fetching a whole leaderboard to learn one number is a
  // round trip the page cannot afford.
  rank: number;
}>;

export type PublicTimeTrialStanding = Readonly<{
  rank: number;
  playerId: string;
  playerDisplayName: string;
  mode: 150 | 200;
  totalTimeMs: number;
  averageTimeMs: number;
  playedTracks: number;
  goldMedals: number;
  silverMedals: number;
  bronzeMedals: number;
}>;

export interface PublicTimeTrialRepository {
  listPlayerResults(playerId: string): Promise<readonly PublicTimeTrialResult[]>;
  listPlayerTrackBests(playerId: string): Promise<readonly PublicTrackBest[]>;
  listTrackBestsForPlayers(playerIds: readonly string[]):
    Promise<ReadonlyMap<string, readonly PublicTrackBest[]>>;
  listStandings(mode: 150 | 200, scope: TimeTrialTrackScope):
    Promise<readonly PublicTimeTrialStanding[]>;
  listRecentResults(): Promise<readonly PublicTimeTrialResult[]>;
  listLeaderboard(
    trackId: string,
    mode: 150 | 200,
  ): Promise<readonly PublicTimeTrialResult[]>;
}

export class PublicTimeTrialServiceError extends Error {
  public constructor(public readonly code: "invalid_input" | "unavailable") {
    super("The public Time Trial operation could not be completed.");
    this.name = "PublicTimeTrialServiceError";
  }
}

export class PublicTimeTrialService {
  public constructor(private readonly repository: PublicTimeTrialRepository) {}

  public async listPlayerResults(
    playerId: string,
  ): Promise<readonly PublicTimeTrialResult[]> {
    if (!playerIdPattern.test(playerId) || playerId.length > 135) {
      throw new PublicTimeTrialServiceError("invalid_input");
    }
    try {
      return await this.repository.listPlayerResults(playerId);
    } catch {
      throw new PublicTimeTrialServiceError("unavailable");
    }
  }

  public async listRecentResults(): Promise<readonly PublicTimeTrialResult[]> {
    try {
      return await this.repository.listRecentResults();
    } catch {
      throw new PublicTimeTrialServiceError("unavailable");
    }
  }

  public async listTrackBestsForPlayers(
    playerIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly PublicTrackBest[]>> {
    if (playerIds.length === 0 || playerIds.length > 10) {
      throw new PublicTimeTrialServiceError("invalid_input");
    }
    const unique = [...new Set(playerIds)];
    for (const playerId of unique) {
      if (!playerIdPattern.test(playerId) || playerId.length > 135) {
        throw new PublicTimeTrialServiceError("invalid_input");
      }
    }
    try {
      return await this.repository.listTrackBestsForPlayers(unique);
    } catch {
      throw new PublicTimeTrialServiceError("unavailable");
    }
  }

  public async listPlayerTrackBests(
    playerId: string,
  ): Promise<readonly PublicTrackBest[]> {
    if (!playerIdPattern.test(playerId) || playerId.length > 135) {
      throw new PublicTimeTrialServiceError("invalid_input");
    }
    try {
      return await this.repository.listPlayerTrackBests(playerId);
    } catch {
      throw new PublicTimeTrialServiceError("unavailable");
    }
  }

  public async listStandings(
    mode: number,
    scope: string = "all",
  ): Promise<readonly PublicTimeTrialStanding[]> {
    if ((mode !== 150 && mode !== 200) ||
        (scope !== "base" && scope !== "bcp" && scope !== "all")) {
      throw new PublicTimeTrialServiceError("invalid_input");
    }
    try {
      return await this.repository.listStandings(mode, scope);
    } catch {
      throw new PublicTimeTrialServiceError("unavailable");
    }
  }

  public async listLeaderboard(
    trackId: string,
    mode: number,
  ): Promise<readonly PublicTimeTrialResult[]> {
    if (!trackIdPattern.test(trackId) || trackId.length > 255 ||
        (mode !== 150 && mode !== 200)) {
      throw new PublicTimeTrialServiceError("invalid_input");
    }
    try {
      return await this.repository.listLeaderboard(trackId, mode);
    } catch {
      throw new PublicTimeTrialServiceError("unavailable");
    }
  }
}
