import type { ActorContext } from "../identity/types.js";

export type TimeTrialPersonalBest = Readonly<{
  trackId: string;
  modeCC: 150 | 200;
  bestTimeMs: number;
  attemptCount: number;
}>;

export type TournamentSummary = Readonly<{
  raceCount: number;
  countedRaceCount: number;
  wins: number;
  podiums: number;
  countedPoints: number;
  countedFinishPositionTotal: number;
}>;

export type PlayerInsightsDocument = Readonly<{
  schemaVersion: "mk8dx.player-insights.v1";
  playerId: string;
  timeTrials: Readonly<{
    submissionCount: number;
    personalBests: readonly TimeTrialPersonalBest[];
  }>;
  tournaments: TournamentSummary;
}>;

export interface PlayerInsightsRepository {
  findVerifiedPlayerForAccount(userAccountId: string): Promise<string | null>;
  listTimeTrialPersonalBests(playerId: string): Promise<readonly TimeTrialPersonalBest[]>;
  summarizeTournaments(playerId: string): Promise<TournamentSummary>;
}

export class PlayerInsightsError extends Error {
  public constructor(
    public readonly code: "not_authenticated" | "not_authorized" | "unavailable",
  ) {
    super("Player insights could not be loaded.");
    this.name = "PlayerInsightsError";
  }
}

export class PlayerInsightsService {
  public constructor(private readonly repository: PlayerInsightsRepository) {}

  public async loadMine(actor: ActorContext): Promise<PlayerInsightsDocument> {
    if (actor.role === "anonymous") {
      throw new PlayerInsightsError("not_authenticated");
    }
    if (actor.role === "migration_operator") {
      throw new PlayerInsightsError("not_authorized");
    }
    try {
      const playerId = await this.repository.findVerifiedPlayerForAccount(
        actor.userAccountId,
      );
      if (playerId === null) { throw new PlayerInsightsError("not_authorized"); }
      const [personalBests, tournaments] = await Promise.all([
        this.repository.listTimeTrialPersonalBests(playerId),
        this.repository.summarizeTournaments(playerId),
      ]);
      const keys = new Set(personalBests.map((record) =>
        `${record.trackId}\u0000${record.modeCC}`));
      const submissionCount = personalBests.reduce(
        (total, record) => total + record.attemptCount,
        0,
      );
      if (keys.size !== personalBests.length || !Number.isSafeInteger(submissionCount) ||
        tournaments.countedRaceCount > tournaments.raceCount ||
        tournaments.wins > tournaments.podiums ||
        tournaments.podiums > tournaments.countedRaceCount ||
        tournaments.countedFinishPositionTotal < tournaments.countedRaceCount ||
        tournaments.countedFinishPositionTotal > tournaments.countedRaceCount * 12) {
        throw new PlayerInsightsError("unavailable");
      }
      return {
        schemaVersion: "mk8dx.player-insights.v1",
        playerId,
        timeTrials: {
          submissionCount,
          personalBests,
        },
        tournaments,
      };
    } catch (error) {
      if (error instanceof PlayerInsightsError) { throw error; }
      throw new PlayerInsightsError("unavailable");
    }
  }
}
