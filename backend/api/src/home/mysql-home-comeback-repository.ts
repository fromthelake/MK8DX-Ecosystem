import type { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";

import {
  snapshotDecision,
  type HomeComeback,
  type HomeComebackRepository,
  type RivalComparison,
  type RivalPreference,
  type RivalPreferenceRepository,
} from "./home-comeback-service.js";

type PreparedQueryExecutor = Pick<Pool, "execute">;

// The canonical track count of the schema-9 catalog; the historical
// total-time model charges this many slots (undriven = fallback).
const TRACK_COUNT = 96;
const UNPLAYED_FALLBACK_MS = 600000;

interface PlayerRow extends RowDataPacket {
  playerInternalId: unknown;
  playerId: unknown;
  displayName: unknown;
  avatarId: unknown;
}

interface StandingRow extends RowDataPacket {
  playerInternalId: unknown;
  totalMs: unknown;
}

interface RatingRow extends RowDataPacket {
  score: unknown;
  playerRank: unknown;
}

interface ComparisonRow extends RowDataPacket {
  tracksAhead: unknown;
  tracksBehind: unknown;
  sharedCombos: unknown;
  totalDeltaMs: unknown;
}

interface SnapshotRow extends RowDataPacket {
  generation: unknown;
  ttStanding: unknown;
  snapshotAtMs: unknown;
}

interface SnapshotRivalRow extends RowDataPacket {
  generation: unknown;
  rivalPlayerId: unknown;
  tracksAhead: unknown;
  tracksBehind: unknown;
  sharedCombos: unknown;
  totalDeltaMs: unknown;
}

interface ReactionSummaryRow extends RowDataPacket {
  reactionCount: unknown;
  resultCount: unknown;
}

interface ReactionKindRow extends RowDataPacket {
  reactionKind: unknown;
}

interface RivalRow extends RowDataPacket {
  rivalInternalId: unknown;
  playerId: unknown;
  displayName: unknown;
  avatarId: unknown;
}

function integer(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export class MysqlHomeComebackRepository
implements HomeComebackRepository, RivalPreferenceRepository {
  public constructor(private readonly executor: PreparedQueryExecutor) {}

  private async ownPlayer(userAccountId: string): Promise<Readonly<{
    internalId: number;
    playerId: string;
    displayName: string;
    avatarId?: string;
  }> | null> {
    const [rows] = await this.executor.execute<PlayerRow[]>(
      `SELECT player.player_id AS playerInternalId,
              player.public_id AS playerId,
              player.display_name AS displayName,
              player.avatar_id AS avatarId
       FROM players AS player
       INNER JOIN player_claims AS claim
         ON claim.player_id = player.player_id
        AND claim.claim_status = 'verified'
       INNER JOIN user_accounts AS account
         ON account.user_account_id = claim.user_account_id
       WHERE account.public_id = ? AND player.record_status = 'active'
       LIMIT 1`,
      [userAccountId],
    );
    const row = rows[0];
    const internalId = integer(row?.playerInternalId);
    if (row === undefined || internalId === null ||
        typeof row.playerId !== "string" ||
        typeof row.displayName !== "string") {
      return null;
    }
    return {
      internalId,
      playerId: row.playerId,
      displayName: row.displayName,
      ...(typeof row.avatarId === "string" ? { avatarId: row.avatarId } : {}),
    };
  }

  private async accountInternalId(
    userAccountId: string,
  ): Promise<number | null> {
    const [rows] = await this.executor.execute<RowDataPacket[]>(
      `SELECT user_account_id AS id FROM user_accounts
       WHERE public_id = ? LIMIT 1`,
      [userAccountId],
    );
    return integer(rows[0]?.["id"]);
  }

  private async standing(playerInternalId: number): Promise<Readonly<{
    standing: number;
    of: number;
    totalMs: number;
  }> | null> {
    // The recovered historical 150cc total-time ordering: SUM of bests
    // plus the ten-minute fallback for every undriven track. Only
    // Players with at least one published 150cc result take part; ties
    // break on internal id for determinism.
    const [rows] = await this.executor.execute<StandingRow[]>(
      `SELECT bests.player_id AS playerInternalId,
              SUM(bests.total_time_ms) +
                (${TRACK_COUNT} - COUNT(*)) * ${UNPLAYED_FALLBACK_MS}
                AS totalMs
       FROM time_trial_player_bests AS bests
       INNER JOIN players AS player
         ON player.player_id = bests.player_id
        AND player.player_kind = 'human'
        AND player.record_status = 'active'
       WHERE bests.mode_cc = 150
         AND bests.public_eligible = 1
       GROUP BY bests.player_id
       ORDER BY totalMs ASC, bests.player_id ASC`,
    );
    let standing: number | null = null;
    let totalMs = 0;
    rows.forEach((row, index) => {
      if (integer(row.playerInternalId) === playerInternalId) {
        standing = index + 1;
        totalMs = integer(row.totalMs) ?? 0;
      }
    });
    return standing === null
      ? null
      : { standing, of: rows.length, totalMs };
  }

  private async compare(
    ownInternalId: number,
    rivalInternalId: number,
  ): Promise<Readonly<{
    tracksAhead: number;
    tracksBehind: number;
    sharedCombos: number;
    totalDeltaMs: number;
  }>> {
    const [rows] = await this.executor.execute<ComparisonRow[]>(
      `SELECT SUM(mine.total_time_ms < theirs.total_time_ms) AS tracksAhead,
              SUM(mine.total_time_ms > theirs.total_time_ms) AS tracksBehind,
              COUNT(*) AS sharedCombos,
              SUM(CAST(theirs.total_time_ms AS SIGNED) -
                  CAST(mine.total_time_ms AS SIGNED)) AS totalDeltaMs
       FROM time_trial_player_bests AS mine
       INNER JOIN time_trial_player_bests AS theirs
         ON theirs.track_id = mine.track_id
        AND theirs.mode_cc = mine.mode_cc
       WHERE mine.player_id = ? AND theirs.player_id = ?`,
      [ownInternalId, rivalInternalId],
    );
    const row = rows[0];
    return {
      tracksAhead: integer(row?.tracksAhead) ?? 0,
      tracksBehind: integer(row?.tracksBehind) ?? 0,
      sharedCombos: integer(row?.sharedCombos) ?? 0,
      totalDeltaMs: integer(row?.totalDeltaMs) ?? 0,
    };
  }

  public async loadComeback(
    userAccountId: string,
    nowMs: number,
  ): Promise<HomeComeback | null> {
    const own = await this.ownPlayer(userAccountId);
    if (own === null) { return null; }
    const accountId = await this.accountInternalId(userAccountId);
    if (accountId === null) { return null; }

    const [ratingRows] = await this.executor.execute<RatingRow[]>(
      `SELECT (mine.mu - 3 * mine.sigma) AS score,
              1 + (SELECT COUNT(*) FROM player_ratings AS other
                   WHERE (other.mu - 3 * other.sigma) >
                         (mine.mu - 3 * mine.sigma)) AS playerRank,
              (SELECT COUNT(*) FROM player_ratings) AS ratedPlayers
       FROM player_ratings AS mine WHERE mine.player_id = ?`,
      [own.internalId],
    );
    const ratingScore = Number(ratingRows[0]?.score);
    const ratingRank = integer(ratingRows[0]?.playerRank);
    const ratedPlayers = integer(ratingRows[0]?.["ratedPlayers"]);

    const standing = await this.standing(own.internalId);

    const rivalPreferences = await this.listRivalRows(accountId);
    const rivalStates: {
      preference: RivalRow;
      comparison: Awaited<ReturnType<MysqlHomeComebackRepository["compare"]>>;
    }[] = [];
    for (const preference of rivalPreferences) {
      const rivalInternalId = integer(preference.rivalInternalId);
      if (rivalInternalId === null) { continue; }
      rivalStates.push({
        preference,
        comparison: await this.compare(own.internalId, rivalInternalId),
      });
    }

    // Snapshot generations: 'prev' is the displayed baseline, 'curr'
    // the state recorded at the last meaningful visit.
    const [snapshotRows] = await this.executor.execute<SnapshotRow[]>(
      `SELECT snapshot.generation AS generation,
              snapshot.tt_standing AS ttStanding,
              snapshot.snapshot_at_ms AS snapshotAtMs
       FROM home_snapshots AS snapshot
       WHERE snapshot.user_account_id = ?`,
      [accountId],
    );
    const [snapshotRivalRows] = await this.executor
      .execute<SnapshotRivalRow[]>(
        `SELECT snapshot.generation AS generation,
                player.public_id AS rivalPlayerId,
                snapshot.tracks_ahead AS tracksAhead,
                snapshot.tracks_behind AS tracksBehind,
                snapshot.shared_combos AS sharedCombos,
                snapshot.total_delta_ms AS totalDeltaMs
         FROM home_snapshot_rivals AS snapshot
         INNER JOIN players AS player
           ON player.player_id = snapshot.rival_player_id
          AND player.visibility = 'public'
         WHERE snapshot.user_account_id = ?`,
        [accountId],
      );

    const currAt = integer(
      snapshotRows.find((row) => row.generation === "curr")?.snapshotAtMs,
    );
    const { rotate, writeInitial } = snapshotDecision(currAt, nowMs);

    if (rotate) {
      await this.executor.execute<ResultSetHeader>(
        `DELETE FROM home_snapshot_rivals
         WHERE user_account_id = ? AND generation = 'prev'`,
        [accountId],
      );
      await this.executor.execute<ResultSetHeader>(
        `DELETE FROM home_snapshots
         WHERE user_account_id = ? AND generation = 'prev'`,
        [accountId],
      );
      await this.executor.execute<ResultSetHeader>(
        `UPDATE home_snapshot_rivals SET generation = 'prev'
         WHERE user_account_id = ? AND generation = 'curr'`,
        [accountId],
      );
      await this.executor.execute<ResultSetHeader>(
        `UPDATE home_snapshots SET generation = 'prev'
         WHERE user_account_id = ? AND generation = 'curr'`,
        [accountId],
      );
    }
    if (rotate || writeInitial) {
      await this.executor.execute<ResultSetHeader>(
        `INSERT INTO home_snapshots
           (user_account_id, generation, tt_standing, snapshot_at_ms)
         VALUES (?, 'curr', ?, ?)`,
        [accountId, standing?.standing ?? null, nowMs],
      );
      for (const state of rivalStates) {
        await this.executor.execute<ResultSetHeader>(
          `INSERT INTO home_snapshot_rivals
             (user_account_id, generation, rival_player_id, tracks_ahead,
              tracks_behind, shared_combos, total_delta_ms)
           VALUES (?, 'curr', ?, ?, ?, ?, ?)`,
          [
            accountId,
            integer(state.preference.rivalInternalId),
            state.comparison.tracksAhead,
            state.comparison.tracksBehind,
            state.comparison.sharedCombos,
            state.comparison.totalDeltaMs,
          ],
        );
      }
    }

    // The displayed baseline after any rotation: the freshly demoted
    // rows if we rotated, the stored prev rows otherwise.
    const baselineStandingRow = rotate
      ? snapshotRows.find((row) => row.generation === "curr")
      : snapshotRows.find((row) => row.generation === "prev");
    const baselineAt = integer(baselineStandingRow?.snapshotAtMs);
    const baselineStanding = integer(baselineStandingRow?.ttStanding);
    const baselineRivals = snapshotRivalRows.filter((row) =>
      row.generation === (rotate ? "curr" : "prev"));

    const rivals: RivalComparison[] = rivalStates.map((state) => {
      const playerId = String(state.preference.playerId);
      const baseline = baselineRivals.find((row) =>
        row.rivalPlayerId === playerId);
      return {
        playerId,
        displayName: String(state.preference.displayName),
        ...(typeof state.preference.avatarId === "string"
          ? { avatarId: state.preference.avatarId }
          : {}),
        ...state.comparison,
        ...(baseline === undefined
          ? {}
          : {
              previous: {
                tracksAhead: integer(baseline.tracksAhead) ?? 0,
                tracksBehind: integer(baseline.tracksBehind) ?? 0,
                sharedCombos: integer(baseline.sharedCombos) ?? 0,
                totalDeltaMs: integer(baseline.totalDeltaMs) ?? 0,
              },
            }),
      };
    });

    let reactions: HomeComeback["reactions"];
    if (baselineAt !== null) {
      const [summaryRows] = await this.executor
        .execute<ReactionSummaryRow[]>(
          `SELECT COUNT(*) AS reactionCount,
                  COUNT(DISTINCT reaction.time_trial_submission_id)
                    AS resultCount
           FROM time_trial_reactions AS reaction
           INNER JOIN time_trial_publications AS publication
             ON publication.time_trial_submission_id =
                reaction.time_trial_submission_id
           INNER JOIN time_trial_submission_revisions AS revision
             ON revision.time_trial_submission_revision_id =
                publication.current_revision_id
           WHERE revision.player_id = ?
             AND reaction.created_at_ms > ?`,
          [own.internalId, baselineAt],
        );
      const count = integer(summaryRows[0]?.reactionCount) ?? 0;
      if (count > 0) {
        const [kindRows] = await this.executor.execute<ReactionKindRow[]>(
          `SELECT reaction.reaction_kind AS reactionKind
           FROM time_trial_reactions AS reaction
           INNER JOIN time_trial_publications AS publication
             ON publication.time_trial_submission_id =
                reaction.time_trial_submission_id
           INNER JOIN time_trial_submission_revisions AS revision
             ON revision.time_trial_submission_revision_id =
                publication.current_revision_id
           WHERE revision.player_id = ?
             AND reaction.created_at_ms > ?
           GROUP BY reaction.reaction_kind
           ORDER BY COUNT(*) DESC
           LIMIT 3`,
          [own.internalId, baselineAt],
        );
        reactions = {
          count,
          resultCount: integer(summaryRows[0]?.resultCount) ?? 0,
          kinds: kindRows
            .map((row) => String(row.reactionKind))
            .filter((kind) => /^[a-z_]+$/.test(kind)),
        };
      }
    }

    return {
      player: {
        playerId: own.playerId,
        displayName: own.displayName,
        ...(own.avatarId === undefined ? {} : { avatarId: own.avatarId }),
      },
      ...(Number.isFinite(ratingScore) && ratingRank !== null
        ? {
            tournament: {
              rank: ratingRank,
              of: ratedPlayers ?? 0,
              score: ratingScore,
            },
          }
        : {}),
      timeTrials: {
        standing: standing?.standing ?? 0,
        of: standing?.of ?? 0,
        totalMs: standing?.totalMs ?? 0,
        ...(baselineStanding !== null && standing !== null
          ? { previousStanding: baselineStanding }
          : {}),
      },
      rivals,
      ...(reactions === undefined ? {} : { reactions }),
      ...(baselineAt === null ? {} : { sinceMs: baselineAt }),
    };
  }

  private async listRivalRows(
    accountInternalId: number,
  ): Promise<readonly RivalRow[]> {
    const [rows] = await this.executor.execute<RivalRow[]>(
      `SELECT rival.rival_player_id AS rivalInternalId,
              player.public_id AS playerId,
              player.display_name AS displayName,
              player.avatar_id AS avatarId
       FROM player_rivals AS rival
       INNER JOIN players AS player
         ON player.player_id = rival.rival_player_id
        AND player.record_status = 'active'
        AND player.visibility = 'public'
       WHERE rival.user_account_id = ?
       ORDER BY rival.created_at_ms ASC
       LIMIT 10`,
      [accountInternalId],
    );
    return rows;
  }

  public async listRivals(
    userAccountId: string,
  ): Promise<readonly RivalPreference[]> {
    const accountId = await this.accountInternalId(userAccountId);
    if (accountId === null) { return []; }
    const rows = await this.listRivalRows(accountId);
    return rows.flatMap((row) =>
      typeof row.playerId === "string" &&
      typeof row.displayName === "string"
        ? [{
            playerId: row.playerId,
            displayName: row.displayName,
            ...(typeof row.avatarId === "string"
              ? { avatarId: row.avatarId }
              : {}),
          }]
        : []);
  }

  public async addRival(
    userAccountId: string,
    rivalPlayerId: string,
    nowMs: number,
  ): Promise<boolean> {
    // The own Player can never be a rival of themselves.
    const [result] = await this.executor.execute<ResultSetHeader>(
      `INSERT INTO player_rivals
         (user_account_id, rival_player_id, created_at_ms)
       SELECT account.user_account_id, player.player_id, ?
       FROM user_accounts AS account
       INNER JOIN players AS player
         ON player.public_id = ? AND player.record_status = 'active'
       WHERE account.public_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM player_claims AS claim
           WHERE claim.claim_status = 'verified'
             AND claim.user_account_id = account.user_account_id
             AND claim.player_id = player.player_id
         )
       ON DUPLICATE KEY UPDATE created_at_ms = player_rivals.created_at_ms`,
      [nowMs, rivalPlayerId, userAccountId],
    );
    return result.affectedRows > 0 ||
      await this.rivalExists(userAccountId, rivalPlayerId);
  }

  private async rivalExists(
    userAccountId: string,
    rivalPlayerId: string,
  ): Promise<boolean> {
    const [rows] = await this.executor.execute<RowDataPacket[]>(
      `SELECT rival.player_rival_id
       FROM player_rivals AS rival
       INNER JOIN user_accounts AS account
         ON account.user_account_id = rival.user_account_id
       INNER JOIN players AS player
         ON player.player_id = rival.rival_player_id
       WHERE account.public_id = ? AND player.public_id = ?
       LIMIT 1`,
      [userAccountId, rivalPlayerId],
    );
    return rows.length > 0;
  }

  public async removeRival(
    userAccountId: string,
    rivalPlayerId: string,
  ): Promise<void> {
    await this.executor.execute<ResultSetHeader>(
      `DELETE rival FROM player_rivals AS rival
       INNER JOIN user_accounts AS account
         ON account.user_account_id = rival.user_account_id
       INNER JOIN players AS player
         ON player.player_id = rival.rival_player_id
       WHERE account.public_id = ? AND player.public_id = ?`,
      [userAccountId, rivalPlayerId],
    );
  }
}
