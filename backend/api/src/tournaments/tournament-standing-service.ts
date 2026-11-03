// The Tournament standing: what a Player has actually done across tournament
// nights, next to the skill the rating gives them.
//
// The Time Trial ranking answers "how fast are you". This answers "how do you
// do against people", which is a different question and needs different facts:
// races run, how often you won, how often you were on the podium, where your
// finishes actually land, and who you keep running into.
//
// Only **finalized** tournaments count. A night in progress would otherwise
// reshuffle everybody's averages between races, and the rating already moves
// only when a tournament is finalized — the two should agree.

export const FINISH_POSITIONS = 12;

export type TournamentStandingEntry = Readonly<{
  rank: number;
  playerId: string;
  username: string;
  displayName: string;
  /** Conservative TrueSkill score, absent for a Player who has no rating yet. */
  score?: number;
  tournaments: number;
  races: number;
  wins: number;
  podiums: number;
  points: number;
  /** Sum of finishing positions, so an average can be shown without a float. */
  finishPositionTotal: number;
  /** How often each finishing position 1..12 happened, in order. */
  finishes: readonly number[];
  lastRaceAtMs?: number;
}>;

export type TournamentStanding = Readonly<{
  entries: readonly TournamentStandingEntry[];
}>;

/** One opponent a Player keeps meeting, and how that has gone. */
export type TournamentRivalry = Readonly<{
  playerId: string;
  username: string;
  displayName: string;
  sharedRaces: number;
  ahead: number;
  behind: number;
  tied: number;
  /** Mean race-points difference, this Player minus the opponent. */
  averagePointsDelta: number;
}>;

/**
 * One Player's record over only the races a whole comparison shared.
 *
 * Setting three Players' careers side by side is not a comparison: Matteo
 * has nights Ben never raced, and those nights moved Matteo's bars. The
 * owner's rule (2026-09-17): a comparison has one main Player and up to two
 * others, and every figure counts only the races **all** of them finished.
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
  /** How many races every requested Player finished together. */
  sharedRaces: number;
  /** One record per requested Player, in the order they were asked for. */
  entries: readonly TournamentSharedRecord[];
}>;

/** A comparison is the main Player and one or two others. */
export const SHARED_RACES_MIN_PLAYERS = 2;
export const SHARED_RACES_MAX_PLAYERS = 3;

export class TournamentStandingError extends Error {
  public constructor(
    public readonly code: "invalid_input" | "unavailable",
  ) {
    super("The Tournament standing could not be loaded.");
    this.name = "TournamentStandingError";
  }
}

export interface TournamentStandingRepository {
  listStanding(limit: number): Promise<readonly TournamentStandingEntry[]>;
  listRivalries(
    playerId: string, limit: number,
  ): Promise<readonly TournamentRivalry[]>;
  /** Records over the races every one of these Players finished. */
  listSharedRaces(
    playerIds: readonly string[],
  ): Promise<TournamentSharedRaces>;
}

const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

/** Rating first, then the Players who have raced but are not rated yet. */
export function rankStanding(
  entries: readonly Omit<TournamentStandingEntry, "rank">[],
): readonly TournamentStandingEntry[] {
  const ordered = [...entries].sort((left, right) => {
    if (left.score !== undefined && right.score !== undefined) {
      if (left.score !== right.score) { return right.score - left.score; }
    } else if (left.score !== right.score) {
      return left.score === undefined ? 1 : -1;
    }
    if (left.races !== right.races) { return right.races - left.races; }
    return left.username.localeCompare(right.username);
  });
  return ordered.map((entry, index) => ({ ...entry, rank: index + 1 }));
}

/**
 * Who a Player actually competes with. Ordered by how many races they have
 * shared, because the person you race most is the person your evenings are
 * really about; the record beside it says who has been winning them.
 */
export class TournamentStandingService {
  public constructor(
    private readonly repository: TournamentStandingRepository,
  ) {}

  public async standing(): Promise<TournamentStanding> {
    try {
      return { entries: await this.repository.listStanding(200) };
    } catch {
      throw new TournamentStandingError("unavailable");
    }
  }

  public async rivalries(
    playerId: string,
  ): Promise<readonly TournamentRivalry[]> {
    if (!playerIdPattern.test(playerId) || playerId.length > 135) {
      throw new TournamentStandingError("invalid_input");
    }
    try {
      return await this.repository.listRivalries(playerId, 12);
    } catch (error) {
      if (error instanceof TournamentStandingError) { throw error; }
      throw new TournamentStandingError("unavailable");
    }
  }

  public async sharedRaces(
    playerIds: readonly string[],
  ): Promise<TournamentSharedRaces> {
    const distinct = new Set(playerIds);
    if (
      playerIds.length < SHARED_RACES_MIN_PLAYERS ||
      playerIds.length > SHARED_RACES_MAX_PLAYERS ||
      distinct.size !== playerIds.length ||
      playerIds.some((id) => !playerIdPattern.test(id) || id.length > 135)
    ) {
      throw new TournamentStandingError("invalid_input");
    }
    let found: TournamentSharedRaces;
    try {
      found = await this.repository.listSharedRaces(playerIds);
    } catch {
      throw new TournamentStandingError("unavailable");
    }
    // A Player with no shared race, or one that is not public, still gets a
    // row of zeros, so a reader can always line the answer up with its ask.
    const byId = new Map(found.entries.map((row) => [row.playerId, row]));
    return {
      sharedRaces: found.sharedRaces,
      entries: playerIds.map((playerId) => byId.get(playerId) ?? {
        playerId, races: 0, wins: 0, podiums: 0, points: 0,
        finishPositionTotal: 0,
        finishes: Array.from({ length: FINISH_POSITIONS }, () => 0),
      }),
    };
  }
}
