import { type TournamentRaceMode } from "./race-result-validation.js";
const publicationIdPattern =
  /^tournament_publication\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

// playerId/playerUsername are absent when the Player is private: the
// placement keeps its finish position and rank so the published race stays
// whole, and only the identity is withheld.
export type PublicTournamentPlacement = Readonly<{
  finishPosition: number;
  playerId?: string;
  playerUsername?: string;
  playerDisplayName: string;
  racePoints: number;
  totalAfterRace: number;
  rankAfterRace: number;
  characterId?: string;
  characterVariantId?: string;
}>;

export type PublicTournamentRace = Readonly<{
  raceResultId: string;
  revision: number;
  raceNumber: number;
  scoringSegment: number;
  trackId: string;
  mode?: TournamentRaceMode;
  mirror?: true;
  countsTowardStandings: boolean;
  resultAtMs: number;
  placements: readonly PublicTournamentPlacement[];
}>;

export type PublicTournamentStanding = Readonly<{
  scoringSegment: number;
  playerId?: string;
  playerUsername?: string;
  playerDisplayName: string;
  totalPoints: number;
  rank: number;
}>;

export type PublicTournament = Readonly<{
  publicationId: string;
  eventName: string;
  publishedAtMs: number;
  races: readonly PublicTournamentRace[];
  standings: readonly PublicTournamentStanding[];
}>;

export type PublicPlayerTournamentResult = Readonly<{
  publicationId: string;
  eventName: string;
  publishedAtMs: number;
  raceResultId: string;
  revision: number;
  raceNumber: number;
  scoringSegment: number;
  trackId: string;
  mode?: TournamentRaceMode;
  mirror?: true;
  finishPosition: number;
  racePoints: number;
  totalAfterRace: number;
  rankAfterRace: number;
  resultAtMs: number;
}>;

export interface PublicTournamentRepository {
  loadPublication(publicationId: string): Promise<PublicTournament | null>;
  listPlayerResults(playerId: string): Promise<readonly PublicPlayerTournamentResult[]>;
}

export class PublicTournamentServiceError extends Error {
  public constructor(public readonly code: "invalid_input" | "unavailable") {
    super("The public Tournament operation could not be completed.");
    this.name = "PublicTournamentServiceError";
  }
}

export class PublicTournamentService {
  public constructor(private readonly repository: PublicTournamentRepository) {}

  public async loadPublication(publicationId: string): Promise<PublicTournament | null> {
    if (!publicationIdPattern.test(publicationId) || publicationId.length > 151) {
      throw new PublicTournamentServiceError("invalid_input");
    }
    try {
      return await this.repository.loadPublication(publicationId);
    } catch {
      throw new PublicTournamentServiceError("unavailable");
    }
  }

  public async listPlayerResults(
    playerId: string,
  ): Promise<readonly PublicPlayerTournamentResult[]> {
    if (!playerIdPattern.test(playerId) || playerId.length > 135) {
      throw new PublicTournamentServiceError("invalid_input");
    }
    try {
      return await this.repository.listPlayerResults(playerId);
    } catch {
      throw new PublicTournamentServiceError("unavailable");
    }
  }
}
