import type { ActorContext } from "../identity/types.js";

export type PlayerActivityProfile = Readonly<{
  playerId: string;
  username: string;
  displayName: string;
}>;

export type PlayerTimeTrialActivity = Readonly<{
  submissionId: string;
  revision: number;
  trackId: string;
  modeCC: 150 | 200;
  totalTimeMs: number;
  sourceKind: string;
  occurredAtMs: number | null;
  createdAtMs: number;
}>;

export type PlayerTournamentActivity = Readonly<{
  raceResultId: string;
  revision: number;
  raceNumber: number;
  trackId: string;
  modeCC: 50 | 100 | 150 | 200 | null;
  /** ADR-0217: only on a Mirror race, which is 150cc. */
  mirror?: true;
  countsTowardStandings: boolean;
  finishPosition: number;
  racePoints: number;
  totalAfterRace: number;
  rankAfterRace: number;
  sourceKind: string;
  occurredAtMs: number | null;
  createdAtMs: number;
}>;

export type PlayerActivityDocument = Readonly<{
  schemaVersion: "mk8dx.player-activity.v1";
  player: PlayerActivityProfile;
  timeTrials: readonly PlayerTimeTrialActivity[];
  tournamentRaces: readonly PlayerTournamentActivity[];
}>;

export interface PlayerActivityRepository {
  findVerifiedPlayerForAccount(userAccountId: string): Promise<string | null>;
  findPlayerProfile(playerId: string): Promise<PlayerActivityProfile | null>;
  listTimeTrials(playerId: string): Promise<readonly PlayerTimeTrialActivity[]>;
  listTournamentRaces(playerId: string): Promise<readonly PlayerTournamentActivity[]>;
}

export type PlayerActivityErrorCode =
  | "not_authenticated"
  | "not_authorized"
  | "unavailable";

export class PlayerActivityError extends Error {
  public constructor(public readonly code: PlayerActivityErrorCode) {
    super("The Player activity could not be loaded.");
    this.name = "PlayerActivityError";
  }
}

export class PlayerActivityService {
  public constructor(private readonly repository: PlayerActivityRepository) {}

  public async loadMine(actor: ActorContext): Promise<PlayerActivityDocument> {
    if (actor.role === "anonymous") {
      throw new PlayerActivityError("not_authenticated");
    }
    if (actor.role === "migration_operator") {
      throw new PlayerActivityError("not_authorized");
    }
    try {
      const playerId = await this.repository.findVerifiedPlayerForAccount(
        actor.userAccountId,
      );
      if (playerId === null) {
        throw new PlayerActivityError("not_authorized");
      }
      const [player, timeTrials, tournamentRaces] = await Promise.all([
        this.repository.findPlayerProfile(playerId),
        this.repository.listTimeTrials(playerId),
        this.repository.listTournamentRaces(playerId),
      ]);
      if (player === null || player.playerId !== playerId) {
        throw new PlayerActivityError("unavailable");
      }
      return {
        schemaVersion: "mk8dx.player-activity.v1",
        player,
        timeTrials,
        tournamentRaces,
      };
    } catch (error) {
      if (error instanceof PlayerActivityError) { throw error; }
      throw new PlayerActivityError("unavailable");
    }
  }
}
