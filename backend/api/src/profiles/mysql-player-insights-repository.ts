import type { RowDataPacket } from "mysql2";

import type { PreparedQueryExecutor } from
  "../identity/mysql-identity-read-repository.js";
import type {
  PlayerInsightsRepository,
  TimeTrialPersonalBest,
  TournamentSummary,
} from "./player-insights-service.js";

const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const accountIdPattern = /^user_account\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const trackIdPattern = /^track\.[a-z0-9]+(?:_[a-z0-9]+)*$/;

interface VerifiedRow extends RowDataPacket { playerId: unknown; }
interface BestRow extends RowDataPacket {
  trackId: unknown;
  modeCC: unknown;
  bestTimeMs: unknown;
  attemptCount: unknown;
}
interface TournamentRow extends RowDataPacket {
  raceCount: unknown;
  countedRaceCount: unknown;
  wins: unknown;
  podiums: unknown;
  countedPoints: unknown;
  countedFinishPositionTotal: unknown;
}

export class PlayerInsightsPersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PlayerInsightsPersistenceError";
  }
}

function integer(value: unknown, field: string, minimum = 0): number {
  const parsed = typeof value === "string" && /^[0-9]+$/.test(value)
    ? Number(value)
    : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new PlayerInsightsPersistenceError(`${field} is invalid`);
  }
  return parsed;
}

function text(value: unknown, field: string, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new PlayerInsightsPersistenceError(`${field} is invalid`);
  }
  return value;
}

function requirePlayer(playerId: string): void {
  if (!playerIdPattern.test(playerId) || playerId.length > 135) {
    throw new PlayerInsightsPersistenceError("playerId is invalid");
  }
}

export class MysqlPlayerInsightsRepository implements PlayerInsightsRepository {
  public constructor(private readonly executor: PreparedQueryExecutor) {}

  public async findVerifiedPlayerForAccount(userAccountId: string): Promise<string | null> {
    if (!accountIdPattern.test(userAccountId) || userAccountId.length > 141) {
      throw new PlayerInsightsPersistenceError("userAccountId is invalid");
    }
    const [rows] = await this.executor.execute<VerifiedRow[]>(
      `SELECT player.public_id AS playerId
       FROM user_accounts AS account
       INNER JOIN player_claims AS claim
         ON claim.user_account_id = account.user_account_id
        AND claim.claim_status = 'verified'
       INNER JOIN players AS player
         ON player.player_id = claim.player_id
        AND player.player_kind = 'human'
        AND player.record_status = 'active'
       WHERE account.public_id = ?
         AND account.account_status = 'active'
       LIMIT 2`,
      [userAccountId],
    );
    if (rows.length === 0) { return null; }
    if (rows.length !== 1 || rows[0] === undefined) {
      throw new PlayerInsightsPersistenceError("verified Player row count is invalid");
    }
    return text(rows[0].playerId, "playerId", playerIdPattern);
  }

  public async listTimeTrialPersonalBests(
    playerId: string,
  ): Promise<readonly TimeTrialPersonalBest[]> {
    requirePlayer(playerId);
    const [rows] = await this.executor.execute<BestRow[]>(
      `SELECT revision.track_id AS trackId,
              revision.mode_cc AS modeCC,
              MIN(revision.total_time_ms) AS bestTimeMs,
              COUNT(*) AS attemptCount
       FROM time_trial_submission_revisions AS revision
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = revision.time_trial_submission_id
       INNER JOIN players AS player ON player.player_id = revision.player_id
       WHERE player.public_id = ?
         AND player.record_status = 'active'
         -- A retired result is not the Player's time (owner 2026-09-26: a 200cc scan first saved as
         -- 150cc and retired showed as a Deity 150cc record); it is neither a best nor an attempt.
         AND submission.retirement_state = 'active'
         AND revision.revision_number = (
           SELECT MAX(latest.revision_number)
           FROM time_trial_submission_revisions AS latest
           WHERE latest.time_trial_submission_id = revision.time_trial_submission_id
         )
       GROUP BY revision.track_id, revision.mode_cc
       ORDER BY revision.mode_cc ASC, bestTimeMs ASC, revision.track_id ASC
       LIMIT 192`,
      [playerId],
    );
    return rows.map((row) => {
      const modeCC = integer(row.modeCC, "modeCC", 1);
      if (modeCC !== 150 && modeCC !== 200) {
        throw new PlayerInsightsPersistenceError("modeCC is invalid");
      }
      return {
        trackId: text(row.trackId, "trackId", trackIdPattern),
        modeCC,
        bestTimeMs: integer(row.bestTimeMs, "bestTimeMs", 1),
        attemptCount: integer(row.attemptCount, "attemptCount", 1),
      };
    });
  }

  public async summarizeTournaments(playerId: string): Promise<TournamentSummary> {
    requirePlayer(playerId);
    const [rows] = await this.executor.execute<TournamentRow[]>(
      `SELECT COUNT(*) AS raceCount,
              COALESCE(SUM(revision.counts_toward_standings), 0) AS countedRaceCount,
              COALESCE(SUM(CASE WHEN revision.counts_toward_standings = 1
                                AND placement.finish_position = 1 THEN 1 ELSE 0 END), 0) AS wins,
              COALESCE(SUM(CASE WHEN revision.counts_toward_standings = 1
                                AND placement.finish_position <= 3 THEN 1 ELSE 0 END), 0) AS podiums,
              COALESCE(SUM(CASE WHEN revision.counts_toward_standings = 1
                                THEN placement.race_points ELSE 0 END), 0) AS countedPoints,
              COALESCE(SUM(CASE WHEN revision.counts_toward_standings = 1
                                THEN placement.finish_position ELSE 0 END), 0) AS countedFinishPositionTotal
       FROM tournament_race_placements AS placement
       INNER JOIN tournament_race_result_revisions AS revision
         ON revision.tournament_race_result_revision_id =
            placement.tournament_race_result_revision_id
       INNER JOIN players AS player ON player.player_id = placement.player_id
       WHERE player.public_id = ?
         AND player.record_status = 'active'
         AND revision.revision_number = (
           SELECT MAX(latest.revision_number)
           FROM tournament_race_result_revisions AS latest
           WHERE latest.tournament_race_result_id = revision.tournament_race_result_id
         )`,
      [playerId],
    );
    if (rows.length !== 1 || rows[0] === undefined) {
      throw new PlayerInsightsPersistenceError("Tournament summary row count is invalid");
    }
    const row = rows[0];
    return {
      raceCount: integer(row.raceCount, "raceCount"),
      countedRaceCount: integer(row.countedRaceCount, "countedRaceCount"),
      wins: integer(row.wins, "wins"),
      podiums: integer(row.podiums, "podiums"),
      countedPoints: integer(row.countedPoints, "countedPoints"),
      countedFinishPositionTotal: integer(
        row.countedFinishPositionTotal,
        "countedFinishPositionTotal",
      ),
    };
  }
}
