import type { RowDataPacket } from "mysql2";

import type { PreparedQueryExecutor } from
  "../identity/mysql-identity-read-repository.js";
import type {
  PlayerActivityProfile,
  PlayerActivityRepository,
  PlayerTimeTrialActivity,
  PlayerTournamentActivity,
} from "./player-activity-service.js";

const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const accountIdPattern = /^user_account\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const submissionIdPattern = /^user_submission\.time\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const raceResultIdPattern = /^tournament_race_result\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const trackIdPattern = /^track\.[a-z0-9]+(?:_[a-z0-9]+)*$/;

interface VerifiedPlayerRow extends RowDataPacket { playerId: unknown; }
interface ProfileRow extends RowDataPacket {
  playerId: unknown;
  username: unknown;
  displayName: unknown;
}
interface TimeTrialRow extends RowDataPacket {
  submissionId: unknown;
  revision: unknown;
  trackId: unknown;
  modeCC: unknown;
  totalTimeMs: unknown;
  sourceKind: unknown;
  occurredAtMs: unknown;
  createdAtMs: unknown;
}
interface TournamentRow extends RowDataPacket {
  raceResultId: unknown;
  revision: unknown;
  raceNumber: unknown;
  trackId: unknown;
  modeCC: unknown;
  mirror?: unknown;
  countsTowardStandings: unknown;
  finishPosition: unknown;
  racePoints: unknown;
  totalAfterRace: unknown;
  rankAfterRace: unknown;
  sourceKind: unknown;
  occurredAtMs: unknown;
  createdAtMs: unknown;
}

export class PlayerActivityPersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PlayerActivityPersistenceError";
  }
}

function text(value: unknown, field: string, pattern?: RegExp): string {
  if (typeof value !== "string" || value.length === 0 ||
    (pattern !== undefined && !pattern.test(value))) {
    throw new PlayerActivityPersistenceError(`${field} is invalid`);
  }
  return value;
}

function integer(value: unknown, field: string, minimum = 0): number {
  const parsed = typeof value === "string" && /^[0-9]+$/.test(value)
    ? Number(value)
    : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) ||
    parsed < minimum) {
    throw new PlayerActivityPersistenceError(`${field} is invalid`);
  }
  return parsed;
}

function optionalInteger(value: unknown, field: string): number | null {
  return value === null ? null : integer(value, field);
}

function one<T extends RowDataPacket>(rows: readonly T[], resource: string): T | null {
  if (rows.length === 0) { return null; }
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new PlayerActivityPersistenceError(`${resource} row count is invalid`);
  }
  return rows[0];
}

function requirePlayerId(playerId: string): void {
  if (!playerIdPattern.test(playerId) || playerId.length > 135) {
    throw new PlayerActivityPersistenceError("playerId is invalid");
  }
}

export class MysqlPlayerActivityRepository implements PlayerActivityRepository {
  public constructor(private readonly executor: PreparedQueryExecutor) {}

  public async findVerifiedPlayerForAccount(
    userAccountId: string,
  ): Promise<string | null> {
    if (!accountIdPattern.test(userAccountId) || userAccountId.length > 141) {
      throw new PlayerActivityPersistenceError("userAccountId is invalid");
    }
    const [rows] = await this.executor.execute<VerifiedPlayerRow[]>(
      `SELECT p.public_id AS playerId
       FROM user_accounts AS a
       INNER JOIN player_claims AS c
         ON c.user_account_id = a.user_account_id
        AND c.claim_status = 'verified'
       INNER JOIN players AS p
         ON p.player_id = c.player_id
        AND p.player_kind = 'human'
        AND p.record_status = 'active'
       WHERE a.public_id = ?
         AND a.account_status = 'active'
       LIMIT 2`,
      [userAccountId],
    );
    const row = one(rows, "verified Player");
    return row === null ? null : text(row.playerId, "playerId", playerIdPattern);
  }

  public async findPlayerProfile(playerId: string): Promise<PlayerActivityProfile | null> {
    requirePlayerId(playerId);
    const [rows] = await this.executor.execute<ProfileRow[]>(
      `SELECT p.public_id AS playerId,
              u.username_value AS username,
              p.display_name AS displayName
       FROM players AS p
       INNER JOIN player_username_history AS u
         ON u.player_id = p.player_id
        AND u.released_at_ms IS NULL
       WHERE p.public_id = ?
         AND p.player_kind = 'human'
         AND p.record_status = 'active'
       LIMIT 2`,
      [playerId],
    );
    const row = one(rows, "Player profile");
    return row === null ? null : {
      playerId: text(row.playerId, "playerId", playerIdPattern),
      username: text(row.username, "username"),
      displayName: text(row.displayName, "displayName"),
    };
  }

  public async listTimeTrials(
    playerId: string,
  ): Promise<readonly PlayerTimeTrialActivity[]> {
    requirePlayerId(playerId);
    const [rows] = await this.executor.execute<TimeTrialRow[]>(
      `SELECT submission.public_id AS submissionId,
              revision.revision_number AS revision,
              revision.track_id AS trackId,
              revision.mode_cc AS modeCC,
              revision.total_time_ms AS totalTimeMs,
              revision.source_kind AS sourceKind,
              revision.occurred_at_ms AS occurredAtMs,
              revision.created_at_ms AS createdAtMs
       FROM time_trial_submission_revisions AS revision
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = revision.time_trial_submission_id
       INNER JOIN players AS player ON player.player_id = revision.player_id
       WHERE player.public_id = ?
         AND player.record_status = 'active'
         -- Retired results are not runs the Player drove as recorded; momentum must not count them.
         AND submission.retirement_state = 'active'
         AND revision.revision_number = (
           SELECT MAX(latest.revision_number)
           FROM time_trial_submission_revisions AS latest
           WHERE latest.time_trial_submission_id = revision.time_trial_submission_id
         )
       ORDER BY COALESCE(revision.occurred_at_ms, revision.created_at_ms) DESC,
                submission.public_id ASC
       LIMIT 100`,
      [playerId],
    );
    return rows.map((row) => {
      const modeCC = integer(row.modeCC, "modeCC", 1);
      if (modeCC !== 150 && modeCC !== 200) {
        throw new PlayerActivityPersistenceError("modeCC is invalid");
      }
      return {
        submissionId: text(row.submissionId, "submissionId", submissionIdPattern),
        revision: integer(row.revision, "revision", 1),
        trackId: text(row.trackId, "trackId", trackIdPattern),
        modeCC,
        totalTimeMs: integer(row.totalTimeMs, "totalTimeMs", 1),
        sourceKind: text(row.sourceKind, "sourceKind"),
        occurredAtMs: optionalInteger(row.occurredAtMs, "occurredAtMs"),
        createdAtMs: integer(row.createdAtMs, "createdAtMs"),
      };
    });
  }

  public async listTournamentRaces(
    playerId: string,
  ): Promise<readonly PlayerTournamentActivity[]> {
    requirePlayerId(playerId);
    const [rows] = await this.executor.execute<TournamentRow[]>(
      `SELECT result.public_id AS raceResultId,
              revision.revision_number AS revision,
              revision.race_number AS raceNumber,
              revision.track_id AS trackId,
              revision.mode_cc AS modeCC,
              revision.mirror AS mirror,
              revision.counts_toward_standings AS countsTowardStandings,
              placement.finish_position AS finishPosition,
              placement.race_points AS racePoints,
              placement.total_after_race AS totalAfterRace,
              placement.rank_after_race AS rankAfterRace,
              revision.source_kind AS sourceKind,
              revision.occurred_at_ms AS occurredAtMs,
              revision.created_at_ms AS createdAtMs
       FROM tournament_race_placements AS placement
       INNER JOIN tournament_race_result_revisions AS revision
         ON revision.tournament_race_result_revision_id =
            placement.tournament_race_result_revision_id
       INNER JOIN tournament_race_results AS result
         ON result.tournament_race_result_id = revision.tournament_race_result_id
       INNER JOIN players AS player ON player.player_id = placement.player_id
       WHERE player.public_id = ?
         AND player.record_status = 'active'
         AND revision.revision_number = (
           SELECT MAX(latest.revision_number)
           FROM tournament_race_result_revisions AS latest
           WHERE latest.tournament_race_result_id = revision.tournament_race_result_id
         )
       ORDER BY COALESCE(revision.occurred_at_ms, revision.created_at_ms) DESC,
                result.public_id ASC
       LIMIT 100`,
      [playerId],
    );
    return rows.map((row) => {
      // ADR-0217: a Tournament race carries its class, 50/100/150/200cc, and a Mirror race is 150cc + mirror.
      // Only the Web reads these rows, and only as a list; the native clients read the Time Trial runs.
      const storedMode = optionalInteger(row.modeCC, "modeCC");
      if (storedMode !== null && storedMode !== 50 && storedMode !== 100 && storedMode !== 150 && storedMode !== 200) {
        throw new PlayerActivityPersistenceError("modeCC is invalid");
      }
      const rawMode: 50 | 100 | 150 | 200 | null = storedMode;
      const mirror = row.mirror !== null && row.mirror !== undefined && Number(row.mirror) === 1;
      if (mirror && rawMode !== 150) {
        throw new PlayerActivityPersistenceError("mirror is invalid");
      }
      const counts = integer(row.countsTowardStandings, "countsTowardStandings");
      if (counts !== 0 && counts !== 1) {
        throw new PlayerActivityPersistenceError("countsTowardStandings is invalid");
      }
      return {
        raceResultId: text(row.raceResultId, "raceResultId", raceResultIdPattern),
        revision: integer(row.revision, "revision", 1),
        raceNumber: integer(row.raceNumber, "raceNumber", 1),
        trackId: text(row.trackId, "trackId", trackIdPattern),
        modeCC: rawMode,
        ...(mirror ? { mirror: true as const } : {}),
        countsTowardStandings: counts === 1,
        finishPosition: integer(row.finishPosition, "finishPosition", 1),
        racePoints: integer(row.racePoints, "racePoints"),
        totalAfterRace: integer(row.totalAfterRace, "totalAfterRace"),
        rankAfterRace: integer(row.rankAfterRace, "rankAfterRace", 1),
        sourceKind: text(row.sourceKind, "sourceKind"),
        occurredAtMs: optionalInteger(row.occurredAtMs, "occurredAtMs"),
        createdAtMs: integer(row.createdAtMs, "createdAtMs"),
      };
    });
  }
}
