// What the time you are about to publish would do (POST_A_TIME_ARCHITECTURE §5).
//
// A port of the server's pure `computeSubmissionFeedback`
// (backend/api/src/timetrials/submission-feedback.ts), run on the client over data the track page
// already loaded: the (track, mode) leaderboard and the Player's own best. Equal times share a
// rank, exactly as on the server, so the prediction and the `?feedback=` answer that replaces it
// after publication agree.
//
// Exactness is stated, never guessed. The public leaderboard is the top 100, so a time that lands
// outside it is reported as "outside the top 100" rather than with an invented number.

export type PredictionCompetitor = Readonly<{
  playerId: string;
  username: string;
  displayName: string;
  bestMs: number;
}>;

export type PredictionSubject = Readonly<{
  totalTimeMs: number;
  /** The Player's fastest published time on this (track, mode), or null for a first time. */
  previousBestMs: number | null;
}>;

export type PredictionPassedPlayer = PredictionCompetitor & Readonly<{ rival: boolean }>;

export type PredictionNeighbour = Readonly<{
  displayName: string;
  username: string;
  bestMs: number;
  /** The effective leaderboard time minus this neighbour's best; negative means the Player is ahead. */
  gapMs: number;
  rival: boolean;
}>;

export type SubmissionPrediction = Readonly<{
  totalTimeMs: number;
  personalBest: Readonly<{
    previousBestMs: number | null;
    deltaMs: number | null;
    improved: boolean;
  }>;
  rank: Readonly<{
    /** Null when the time lands outside the loaded board, where no exact rank can be honest. */
    after: number | null;
    before: number | null;
    exact: boolean;
    passed: readonly PredictionPassedPlayer[];
    passedCount: number;
    rivalsPassed: number;
  }>;
  /** How many Players the board holds, and whether that is all of them. */
  field: Readonly<{ count: number; complete: boolean }>;
  ahead: PredictionNeighbour | null;
  behind: PredictionNeighbour | null;
}>;

export const PREDICTION_PASSED_LIMIT = 5;
/** The public leaderboard the client can see (`/v1/public/time-trial-leaderboard`). */
export const PREDICTION_BOARD_LIMIT = 100;

/**
 * The same arithmetic as the server's `computeSubmissionFeedback`, plus the two neighbours and the
 * honesty flag the panel needs. `competitors` excludes the submitting Player.
 */
export function predictSubmission(
  subject: PredictionSubject,
  competitors: readonly PredictionCompetitor[],
  rivalPlayerIds: ReadonlySet<string>,
  boardComplete: boolean,
): SubmissionPrediction {
  const { totalTimeMs, previousBestMs } = subject;
  // Matching the PB still promotes this submission: it may enrich that same
  // run with lap, coin, mushroom or kart-setup details.
  const improved = previousBestMs === null || totalTimeMs <= previousBestMs;
  // The run remains the subject of the summary. Only the leaderboard outcome
  // keeps the older PB when this run is slower.
  const currentBestMs = previousBestMs === null
    ? totalTimeMs
    : Math.min(totalTimeMs, previousBestMs);
  const rankFor = (timeMs: number): number =>
    1 + competitors.filter((competitor) => competitor.bestMs < timeMs).length;
  const passedAll = previousBestMs !== null && totalTimeMs < previousBestMs
    ? competitors
      .filter((competitor) =>
        competitor.bestMs > totalTimeMs && competitor.bestMs <= previousBestMs)
      .sort((a, b) => {
        const rivalOrder = Number(rivalPlayerIds.has(b.playerId)) -
          Number(rivalPlayerIds.has(a.playerId));
        return rivalOrder !== 0 ? rivalOrder : a.bestMs - b.bestMs;
      })
    : [];
  const rivalsPassed = passedAll
    .filter((competitor) => rivalPlayerIds.has(competitor.playerId)).length;

  // Inside the loaded board every rank is exact. Beyond its slowest row the true position depends on
  // Players the client cannot see, so no number is printed.
  const slowest = competitors.reduce(
    (worst, competitor) => Math.max(worst, competitor.bestMs), 0);
  const exact = boardComplete || competitors.length === 0 || currentBestMs <= slowest;
  const after = exact ? rankFor(currentBestMs) : null;
  const before = previousBestMs === null
    ? null
    : (boardComplete || previousBestMs <= slowest ? rankFor(previousBestMs) : null);

  const neighbour = (
    competitor: PredictionCompetitor | undefined,
  ): PredictionNeighbour | null => competitor === undefined ? null : {
    displayName: competitor.displayName,
    username: competitor.username,
    bestMs: competitor.bestMs,
    gapMs: currentBestMs - competitor.bestMs,
    rival: rivalPlayerIds.has(competitor.playerId),
  };
  const faster = competitors
    .filter((competitor) => competitor.bestMs < currentBestMs)
    .sort((a, b) => b.bestMs - a.bestMs);
  const slower = competitors
    .filter((competitor) => competitor.bestMs >= currentBestMs)
    .sort((a, b) => a.bestMs - b.bestMs);

  return {
    totalTimeMs,
    personalBest: {
      previousBestMs,
      deltaMs: previousBestMs === null ? null : totalTimeMs - previousBestMs,
      improved,
    },
    rank: {
      after,
      before,
      exact,
      passed: passedAll.slice(0, PREDICTION_PASSED_LIMIT).map((competitor) => ({
        ...competitor, rival: rivalPlayerIds.has(competitor.playerId),
      })),
      passedCount: passedAll.length,
      rivalsPassed,
    },
    field: { count: competitors.length + 1, complete: boardComplete },
    ahead: neighbour(faster[0]),
    behind: neighbour(slower[0]),
  };
}

export type BoardRow = Readonly<{
  playerId: string;
  playerUsername: string;
  playerDisplayName: string;
  totalTimeMs: number;
}>;

export type PredictionInput = Readonly<{
  rows: readonly BoardRow[];
  ownPlayerId: string | null;
  /** The Player's own best, when the board does not carry it (outside the top 100). */
  ownBestMs: number | null;
  rivalPlayerIds: ReadonlySet<string>;
}>;

/**
 * Turns the loaded leaderboard into a prediction for a candidate time. The submitting Player's own
 * row is removed from the field, exactly as the server excludes it.
 */
export function predictFromBoard(
  totalTimeMs: number, input: PredictionInput,
): SubmissionPrediction {
  const own = input.ownPlayerId === null
    ? undefined
    : input.rows.find((row) => row.playerId === input.ownPlayerId);
  const competitors = input.rows
    .filter((row) => row.playerId !== input.ownPlayerId)
    .map((row) => ({
      playerId: row.playerId,
      username: row.playerUsername,
      displayName: row.playerDisplayName,
      bestMs: row.totalTimeMs,
    }));
  const previousBestMs = own?.totalTimeMs ?? input.ownBestMs;
  return predictSubmission(
    { totalTimeMs, previousBestMs: previousBestMs ?? null },
    competitors,
    input.rivalPlayerIds,
    input.rows.length < PREDICTION_BOARD_LIMIT,
  );
}
