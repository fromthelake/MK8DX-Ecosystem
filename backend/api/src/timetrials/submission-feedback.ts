import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * What a Player hears back the moment a Time Trial is accepted: whether it
 * beat their personal best on that track and engine class and by how much,
 * where it puts them on the public leaderboard, and whom they passed on the
 * way - rivals named first. The figures are the ones the overtake
 * notification and the activity stories already derive after the fact; here
 * they travel with the submission answer so the entry form can say so at
 * once.
 *
 * The block is opt-in per request (`?feedback=v1`): every installed Android
 * build and LiveTrial checks the acknowledgement for exactly `submissionId`
 * and `revision`, and an unasked-for key would fail their sync.
 */

export const SUBMISSION_FEEDBACK_VERSION = "v1";
/**
 * v2 adds the previous personal best's lap times under `personalBest`, so a
 * client can show the gap per lap. v1 keeps its exact shape: the installed
 * clients that asked for v1 check every key set.
 */
export const SUBMISSION_FEEDBACK_VERSION_V2 = "v2";
export const SUBMISSION_FEEDBACK_VERSIONS = [SUBMISSION_FEEDBACK_VERSION, SUBMISSION_FEEDBACK_VERSION_V2] as const;
export type SubmissionFeedbackVersion = (typeof SUBMISSION_FEEDBACK_VERSIONS)[number];
export const SUBMISSION_FEEDBACK_PASSED_LIMIT = 5;
export const SUBMISSION_FEEDBACK_LAP_LIMIT = 7;

export type SubmissionFeedbackLap = Readonly<{ lapNumber: number; timeMs: number }>;

export type SubmissionFeedbackPassedPlayer = Readonly<{
  playerId: string;
  username: string;
  displayName: string;
  bestMs: number;
  rival: boolean;
}>;

export type SubmissionFeedback = Readonly<{
  trackId: string;
  modeCc: number;
  totalTimeMs: number;
  personalBest: Readonly<{
    /** The Player's fastest published time on this combo before this one. */
    previousBestMs: number | null;
    /** `totalTimeMs - previousBestMs`; negative means faster. */
    deltaMs: number | null;
    /** True for a first time, improvement, or equal-time replacement on the combo. */
    improved: boolean;
    /** v2 only: the previous best's laps, when it recorded them. */
    previousLaps?: readonly SubmissionFeedbackLap[];
  }>;
  rank: Readonly<{
    /** Public leaderboard position after this submission, 1-based. */
    after: number;
    /** Position the previous best held, or null for a first time. */
    before: number | null;
    /** Players newly behind the submitter, rivals first, fastest first. */
    passed: readonly SubmissionFeedbackPassedPlayer[];
    passedCount: number;
    rivalsPassed: number;
  }>;
}>;

export type SubmissionFeedbackSubject = Readonly<{
  trackId: string;
  modeCc: number;
  totalTimeMs: number;
  previousBestMs: number | null;
  /** The revision that holds the previous best, for its laps. */
  previousBestRevisionInternalId?: number;
}>;

export type SubmissionFeedbackCompetitor = Readonly<{
  playerId: string;
  username: string;
  displayName: string;
  bestMs: number;
}>;

/**
 * Pure arithmetic over the submitter's times and everybody else's best.
 * Equal times share a rank, as on the leaderboard; a competitor is "passed"
 * only when the new time is strictly faster than their best and the old
 * best was not.
 */
export function computeSubmissionFeedback(
  subject: SubmissionFeedbackSubject,
  competitors: readonly SubmissionFeedbackCompetitor[],
  rivalPlayerIds: ReadonlySet<string>,
): SubmissionFeedback {
  const { totalTimeMs, previousBestMs } = subject;
  // An equal time is accepted as the current PB too: it is commonly the same
  // run resubmitted with laps, coins or a complete kart setup.
  const improved = previousBestMs === null || totalTimeMs <= previousBestMs;
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
  return {
    trackId: subject.trackId,
    modeCc: subject.modeCc,
    totalTimeMs,
    personalBest: {
      previousBestMs,
      deltaMs: previousBestMs === null ? null : totalTimeMs - previousBestMs,
      improved,
    },
    rank: {
      after: rankFor(currentBestMs),
      before: previousBestMs === null ? null : rankFor(previousBestMs),
      passed: passedAll.slice(0, SUBMISSION_FEEDBACK_PASSED_LIMIT).map((competitor) => ({
        playerId: competitor.playerId,
        username: competitor.username,
        displayName: competitor.displayName,
        bestMs: competitor.bestMs,
        rival: rivalPlayerIds.has(competitor.playerId),
      })),
      passedCount: passedAll.length,
      rivalsPassed,
    },
  };
}

export interface SubmissionFeedbackRepository {
  /** The published submission's combo, time and the Player's earlier best. */
  findSubject(submissionPublicId: string): Promise<
    (SubmissionFeedbackSubject & { playerInternalId: number }) | null
  >;
  /** Best published time per other public human Player on the combo. */
  listCompetitors(
    trackId: string,
    modeCc: number,
    excludingPlayerInternalId: number,
  ): Promise<readonly SubmissionFeedbackCompetitor[]>;
  listRivalPlayerIds(userAccountPublicId: string): Promise<readonly string[]>;
  listLaps(revisionInternalId: number): Promise<readonly SubmissionFeedbackLap[]>;
}

export class SubmissionFeedbackService {
  public constructor(private readonly repository: SubmissionFeedbackRepository) {}

  /** Null when the submission is not published or not readable. */
  public async forSubmission(
    submissionPublicId: string,
    userAccountPublicId: string | null,
    version: SubmissionFeedbackVersion = SUBMISSION_FEEDBACK_VERSION,
  ): Promise<SubmissionFeedback | null> {
    const subject = await this.repository.findSubject(submissionPublicId);
    if (subject === null) { return null; }
    const [competitors, rivals, previousLaps] = await Promise.all([
      this.repository.listCompetitors(
        subject.trackId, subject.modeCc, subject.playerInternalId,
      ),
      userAccountPublicId === null
        ? Promise.resolve<readonly string[]>([])
        : this.repository.listRivalPlayerIds(userAccountPublicId),
      version === SUBMISSION_FEEDBACK_VERSION_V2 &&
        subject.previousBestRevisionInternalId !== undefined
        ? this.repository.listLaps(subject.previousBestRevisionInternalId)
        : Promise.resolve<readonly SubmissionFeedbackLap[]>([]),
    ]);
    const feedback = computeSubmissionFeedback(subject, competitors, new Set(rivals));
    if (version !== SUBMISSION_FEEDBACK_VERSION_V2) { return feedback; }
    return {
      ...feedback,
      personalBest: { ...feedback.personalBest, previousLaps },
    };
  }
}

type PreparedQueryExecutor = Pick<Pool, "execute">;

interface SubjectRow extends RowDataPacket {
  trackId: unknown;
  modeCc: unknown;
  totalTimeMs: unknown;
  playerInternalId: unknown;
}

interface PreviousBestRow extends RowDataPacket {
  previousBestMs: unknown;
  revisionInternalId: unknown;
}

interface LapRow extends RowDataPacket {
  lapNumber: unknown;
  timeMs: unknown;
}

interface CompetitorRow extends RowDataPacket {
  playerId: unknown;
  username: unknown;
  displayName: unknown;
  bestMs: unknown;
}

interface RivalRow extends RowDataPacket {
  playerId: unknown;
}

const publishedResultJoin = `
  FROM time_trial_publications AS publication
  INNER JOIN time_trial_submissions AS submission
    ON submission.time_trial_submission_id =
       publication.time_trial_submission_id
  INNER JOIN time_trial_submission_revisions AS revision
    ON revision.time_trial_submission_revision_id =
       publication.current_revision_id`;

export class MysqlSubmissionFeedbackRepository
implements SubmissionFeedbackRepository {
  public constructor(private readonly executor: PreparedQueryExecutor) {}

  public async findSubject(
    submissionPublicId: string,
  ): Promise<(SubmissionFeedbackSubject & { playerInternalId: number }) | null> {
    const [rows] = await this.executor.execute<SubjectRow[]>(
      `SELECT revision.track_id AS trackId,
              revision.mode_cc AS modeCc,
              revision.total_time_ms AS totalTimeMs,
              revision.player_id AS playerInternalId
       ${publishedResultJoin}
       WHERE submission.public_id = ?
         AND publication.publication_status = 'published'
       LIMIT 1`,
      [submissionPublicId],
    );
    const row = rows[0];
    if (row === undefined || typeof row.trackId !== "string") { return null; }
    const modeCc = Number(row.modeCc);
    const totalTimeMs = Number(row.totalTimeMs);
    const playerInternalId = Number(row.playerInternalId);
    if (!Number.isSafeInteger(modeCc) || !Number.isSafeInteger(totalTimeMs) ||
        !Number.isSafeInteger(playerInternalId)) {
      return null;
    }
    // Same two sources as the overtake producer: the Player's other published
    // results on the combo, and earlier published revisions of this one.
    // The fastest earlier revision, with its id so its laps can be read.
    const [previousRows] = await this.executor.execute<PreviousBestRow[]>(
      `SELECT candidate.totalTimeMs AS previousBestMs,
              candidate.revisionInternalId AS revisionInternalId
       FROM (
         SELECT revision.total_time_ms AS totalTimeMs,
                revision.time_trial_submission_revision_id AS revisionInternalId
         ${publishedResultJoin}
         WHERE publication.publication_status = 'published'
           AND revision.player_id = ?
           AND revision.track_id = ? AND revision.mode_cc = ?
           AND submission.public_id <> ?
         UNION ALL
         SELECT prior_revision.total_time_ms AS totalTimeMs,
                prior_revision.time_trial_submission_revision_id AS revisionInternalId
         FROM time_trial_publications AS current_publication
         INNER JOIN time_trial_submissions AS current_submission
           ON current_submission.time_trial_submission_id =
              current_publication.time_trial_submission_id
         INNER JOIN time_trial_publication_lifecycle AS lifecycle
           ON lifecycle.time_trial_publication_id =
              current_publication.time_trial_publication_id
          AND lifecycle.sequence_number < current_publication.publication_revision
          AND lifecycle.publication_status_after = 'published'
         INNER JOIN time_trial_submission_revisions AS prior_revision
           ON prior_revision.time_trial_submission_revision_id =
              lifecycle.time_trial_submission_revision_id
         WHERE current_submission.public_id = ?
           AND prior_revision.player_id = ?
           AND prior_revision.track_id = ? AND prior_revision.mode_cc = ?
       ) AS candidate
       ORDER BY candidate.totalTimeMs ASC, candidate.revisionInternalId ASC
       LIMIT 1`,
      [
        playerInternalId, row.trackId, modeCc, submissionPublicId,
        submissionPublicId, playerInternalId, row.trackId, modeCc,
      ],
    );
    const previousBest = Number(previousRows[0]?.previousBestMs);
    const previousRevision = Number(previousRows[0]?.revisionInternalId);
    return {
      trackId: row.trackId,
      modeCc,
      totalTimeMs,
      previousBestMs: Number.isSafeInteger(previousBest) ? previousBest : null,
      ...(Number.isSafeInteger(previousBest) && Number.isSafeInteger(previousRevision)
        ? { previousBestRevisionInternalId: previousRevision }
        : {}),
      playerInternalId,
    };
  }

  public async listCompetitors(
    trackId: string,
    modeCc: number,
    excludingPlayerInternalId: number,
  ): Promise<readonly SubmissionFeedbackCompetitor[]> {
    const [rows] = await this.executor.execute<CompetitorRow[]>(
      `SELECT player.public_id AS playerId,
              username.username_value AS username,
              player.display_name AS displayName,
              best.total_time_ms AS bestMs
       FROM time_trial_player_bests AS best
       STRAIGHT_JOIN players AS player ON player.player_id = best.player_id
        AND player.player_kind = 'human'
        AND player.record_status = 'active' AND player.visibility = 'public'
       STRAIGHT_JOIN player_username_history AS username
         ON username.player_id = player.player_id
        AND username.released_at_ms IS NULL
       WHERE best.track_id = ? AND best.mode_cc = ?
         AND best.public_eligible = 1
         AND best.player_id <> ?
       ORDER BY bestMs ASC
       LIMIT 2000`,
      [trackId, modeCc, excludingPlayerInternalId],
    );
    return rows.flatMap((row) => {
      const bestMs = Number(row.bestMs);
      return typeof row.playerId === "string" &&
        typeof row.username === "string" &&
        typeof row.displayName === "string" &&
        Number.isSafeInteger(bestMs)
        ? [{
            playerId: row.playerId,
            username: row.username,
            displayName: row.displayName,
            bestMs,
          }]
        : [];
    });
  }

  public async listLaps(revisionInternalId: number): Promise<readonly SubmissionFeedbackLap[]> {
    const [rows] = await this.executor.execute<LapRow[]>(
      `SELECT lap_number AS lapNumber, time_ms AS timeMs
       FROM time_trial_laps
       WHERE time_trial_submission_revision_id = ?
       ORDER BY lap_number
       LIMIT ${SUBMISSION_FEEDBACK_LAP_LIMIT}`,
      [revisionInternalId],
    );
    return rows.flatMap((row) => {
      const lapNumber = Number(row.lapNumber);
      const timeMs = Number(row.timeMs);
      return Number.isSafeInteger(lapNumber) && lapNumber >= 1 &&
        Number.isSafeInteger(timeMs) && timeMs >= 0
        ? [{ lapNumber, timeMs }]
        : [];
    });
  }

  public async listRivalPlayerIds(
    userAccountPublicId: string,
  ): Promise<readonly string[]> {
    const [rows] = await this.executor.execute<RivalRow[]>(
      `SELECT player.public_id AS playerId
       FROM player_rivals AS rival
       INNER JOIN user_accounts AS account
         ON account.user_account_id = rival.user_account_id
       INNER JOIN players AS player
         ON player.player_id = rival.rival_player_id
       WHERE account.public_id = ?
       LIMIT 25`,
      [userAccountPublicId],
    );
    return rows.flatMap((row) =>
      typeof row.playerId === "string" ? [row.playerId] : []);
  }
}
