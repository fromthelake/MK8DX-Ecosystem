import type { Pool, RowDataPacket } from "mysql2/promise";

import type {
  TournamentReopenState,
  TournamentRepublishPlan,
  TournamentRestoreState,
  TournamentRetractionRepository,
  TournamentRetractionState,
} from "./tournament-retraction-service.js";

interface ReopenRow extends RowDataPacket {
  tournament_id: number;
  public_id: string;
  lifecycle_status: "active" | "retracted";
  stage: string;
  public_results: number;
  affects_rating: number;
  publication_public_id: string | null;
  publication_revision: number | string | null;
  publication_status: string | null;
}

interface RetractionRow extends RowDataPacket {
  public_id: string;
  lifecycle_status: "active" | "retracted";
  public_results: number;
  affects_rating: number;
  retraction_rating_epoch_id: number | null;
  publication_public_id: string | null;
  publication_revision: number | string | null;
  publication_status: string | null;
}

export class MysqlTournamentRetractionRepository implements TournamentRetractionRepository {
  public constructor(private readonly pool: Pool) {}

  public async prepareReopen(
    input: Parameters<TournamentRetractionRepository["prepareReopen"]>[0],
  ): Promise<TournamentReopenState | null> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<ReopenRow[]>(`
        SELECT t.tournament_id, t.public_id, t.lifecycle_status, t.stage, t.public_results, t.affects_rating,
               p.public_id AS publication_public_id,
               p.publication_revision AS publication_revision,
               p.publication_status AS publication_status
          FROM tournaments t
          LEFT JOIN tournament_publications p ON p.tournament_publication_id = t.tournament_publication_id
         WHERE t.public_id = ?
         FOR UPDATE
      `, [input.tournamentId]);
      if (rows.length === 0) {
        await connection.rollback();
        return null;
      }
      const row = rows[0]!;
      const wasFinalized = row.lifecycle_status === "active" && row.stage === "finalized";
      if (wasFinalized) {
        // The schema ties the three together: a stage other than finalized
        // carries no finalized time and no pinned result set.
        await connection.execute(`
          UPDATE tournaments
             SET stage = 'finals', workflow_step = 10, finalized_at_ms = NULL,
                 tournament_publication_id = NULL,
                 revision = revision + 1, updated_at_ms = ?
           WHERE tournament_id = ?
        `, [input.nowMs, row.tournament_id]);
        const [sequenceRows] = await connection.execute<RowDataPacket[]>(
          "SELECT COALESCE(MAX(sequence_number), 0) AS latest FROM tournament_lifecycle WHERE tournament_id = ? FOR UPDATE",
          [row.tournament_id],
        );
        const sequence = Number(sequenceRows[0]?.["latest"] ?? 0) + 1;
        await connection.execute(`
          INSERT INTO tournament_lifecycle (
            tournament_id, sequence_number, event_type, detail, actor_user_account_id, occurred_at_ms
          ) VALUES (?, ?, 'finalization_reverted', ?,
            (SELECT user_account_id FROM user_accounts WHERE public_id = ? AND account_status = 'active' LIMIT 1), ?)
        `, [row.tournament_id, sequence, input.reason.slice(0, 255), input.actorUserAccountId, input.nowMs]);
      }
      await connection.commit();
      return {
        tournamentId: row.public_id,
        wasFinalized,
        publicationId: row.publication_public_id,
        publicationRevision: row.publication_revision === null ? null : Number(row.publication_revision),
        publicationStatus: row.publication_status,
        publicationWasPublic: row.public_results !== 0,
        ratingWasIncluded: row.affects_rating !== 0,
        ratingEpochId: null,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Undoes a removal: the Tournament becomes active again and the act is
   * audited beside the removal it reverses. Publication and rating inclusion
   * are deliberately left where the removal put them - see the service.
   */
  public async restoreTournament(
    input: Parameters<TournamentRetractionRepository["restoreTournament"]>[0],
  ): Promise<TournamentRestoreState | null> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RetractionRow[]>(`
        SELECT t.public_id, t.lifecycle_status, t.public_results, t.affects_rating,
               t.retraction_rating_epoch_id,
               NULL AS publication_public_id, NULL AS publication_revision,
               NULL AS publication_status
          FROM tournaments t
         WHERE t.public_id = ?
         FOR UPDATE
      `, [input.tournamentId]);
      if (rows.length === 0) {
        await connection.rollback();
        return null;
      }
      const row = rows[0]!;
      const wasRetracted = row.lifecycle_status === "retracted";
      // What the removal recorded, so the operator can put it back on purpose.
      const [auditRows] = await connection.execute<RowDataPacket[]>(`
        SELECT a.publication_was_public, a.rating_was_included
          FROM tournament_retraction_audit a
          JOIN tournaments t ON t.tournament_id = a.tournament_id
         WHERE t.public_id = ? AND a.action = 'remove'
         ORDER BY a.tournament_retraction_audit_id DESC
         LIMIT 1
      `, [input.tournamentId]);
      const audit = auditRows[0];
      if (wasRetracted) {
        await connection.execute(`
          UPDATE tournaments
             SET lifecycle_status = 'active',
                 public_results = ?, affects_rating = ?,
                 retracted_at_ms = NULL, retracted_by_user_account_id = NULL,
                 retraction_reason = NULL,
                 revision = revision + 1, updated_at_ms = ?
           WHERE public_id = ? AND lifecycle_status = 'retracted'
        `, [input.publicResults, input.affectsRating, input.nowMs, input.tournamentId]);
        await connection.execute(`
          INSERT INTO tournament_retraction_audit (
            tournament_id, action, actor_user_account_id, reason,
            publication_was_public, rating_was_included, rating_epoch_id, occurred_at_ms
          )
          SELECT tournament_id, 'restore',
                 (SELECT user_account_id FROM user_accounts WHERE public_id = ? AND account_status = 'active' LIMIT 1),
                 ?, ?, ?, NULL, ?
            FROM tournaments WHERE public_id = ?
        `, [
          input.actorUserAccountId,
          input.reason,
          audit === undefined ? row.public_results !== 0 : Boolean(audit["publication_was_public"]),
          audit === undefined ? row.affects_rating !== 0 : Boolean(audit["rating_was_included"]),
          input.nowMs,
          input.tournamentId,
        ]);
      }
      await connection.commit();
      return {
        tournamentId: row.public_id,
        wasRetracted,
        publicationWasPublic: audit === undefined
          ? row.public_results !== 0
          : Boolean(audit["publication_was_public"]),
        ratingWasIncluded: audit === undefined
          ? row.affects_rating !== 0
          : Boolean(audit["rating_was_included"]),
        // Filled in by the service once it has replayed or republished.
        ratingEpochId: null,
        republished: false,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * The races the last publication actually carried, so a restore can put back
   * exactly that rather than inventing a new publication. Retraction clears the
   * current members, so the set is read from the lifecycle history.
   */
  public async loadRepublishPlan(tournamentId: string): Promise<TournamentRepublishPlan | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(`
      SELECT p.public_id AS publicationId,
             p.publication_revision AS publicationRevision,
             p.event_name AS eventName,
             l.tournament_publication_lifecycle_id AS lifecycleId
        FROM tournaments t
        JOIN tournament_publications p
          ON p.tournament_publication_id = t.tournament_publication_id
        JOIN tournament_publication_lifecycle l
          ON l.tournament_publication_id = p.tournament_publication_id
         AND l.event_type = 'published'
       WHERE t.public_id = ?
       ORDER BY l.tournament_publication_lifecycle_id DESC
       LIMIT 1
    `, [tournamentId]);
    const row = rows[0];
    if (row === undefined) { return null; }
    const [members] = await this.pool.execute<RowDataPacket[]>(`
      SELECT r.public_id AS raceResultId, m.tournament_race_result_revision_id AS revisionId,
             v.revision AS revision
        FROM tournament_publication_lifecycle_members m
        JOIN tournament_race_results r ON r.tournament_race_result_id = m.tournament_race_result_id
        JOIN tournament_race_result_revisions v
          ON v.tournament_race_result_revision_id = m.tournament_race_result_revision_id
       WHERE m.tournament_publication_lifecycle_id = ?
       ORDER BY m.sequence_number
    `, [row["lifecycleId"]]);
    return {
      publicationId: String(row["publicationId"]),
      expectedRevision: Number(row["publicationRevision"]),
      eventName: String(row["eventName"]),
      targets: members.map((member) => ({
        raceResultId: String(member["raceResultId"]),
        revision: Number(member["revision"]),
      })),
    };
  }

  public async isDirectorOf(tournamentId: string, userAccountId: string): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(`
      SELECT 1
        FROM tournaments t
        JOIN user_accounts a ON a.user_account_id = t.director_user_account_id
       WHERE t.public_id = ? AND a.public_id = ? AND a.account_status = 'active'
       LIMIT 1
    `, [tournamentId, userAccountId]);
    return rows.length > 0;
  }

  public async prepareRetraction(input: Parameters<TournamentRetractionRepository["prepareRetraction"]>[0]): Promise<TournamentRetractionState | null> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RetractionRow[]>(`
        SELECT t.public_id, t.lifecycle_status, t.public_results, t.affects_rating,
               t.retraction_rating_epoch_id,
               p.public_id AS publication_public_id,
               p.publication_revision AS publication_revision,
               p.publication_status AS publication_status
          FROM tournaments t
          LEFT JOIN tournament_publications p ON p.tournament_publication_id = t.tournament_publication_id
         WHERE t.public_id = ?
         FOR UPDATE
      `, [input.tournamentId]);
      if (rows.length === 0) {
        await connection.rollback();
        return null;
      }
      const row = rows[0]!;
      const alreadyRetracted = row.lifecycle_status === "retracted";
      if (!alreadyRetracted) {
        await connection.execute(`
          UPDATE tournaments
             SET lifecycle_status = 'retracted', public_results = FALSE,
                 retracted_at_ms = ?, retracted_by_user_account_id =
                   (SELECT user_account_id FROM user_accounts WHERE public_id = ? AND account_status = 'active' LIMIT 1),
                 retraction_reason = ?, revision = revision + 1, updated_at_ms = ?
           WHERE public_id = ? AND lifecycle_status = 'active'
        `, [input.nowMs, input.actorUserAccountId, input.reason, input.nowMs, input.tournamentId]);
        await connection.execute(`
          UPDATE tournament_incoming_results ir
          JOIN tournaments t ON t.tournament_id = ir.tournament_id
             SET ir.status = 'blocked', ir.revision = ir.revision + 1,
                 ir.review_reason = 'Tournament removed', ir.updated_at_ms = ?
           WHERE t.public_id = ? AND ir.status = 'pending'
        `, [input.nowMs, input.tournamentId]);
        await connection.execute(`
          INSERT INTO tournament_retraction_audit (
            tournament_id, action, actor_user_account_id, reason,
            publication_was_public, rating_was_included, rating_epoch_id, occurred_at_ms
          )
          SELECT tournament_id, 'remove',
                 (SELECT user_account_id FROM user_accounts WHERE public_id = ? AND account_status = 'active' LIMIT 1),
                 ?, ?, ?, NULL, ?
            FROM tournaments WHERE public_id = ?
        `, [
          input.actorUserAccountId,
          input.reason,
          row.public_results !== 0,
          row.affects_rating !== 0,
          input.nowMs,
          input.tournamentId,
        ]);
      }
      await connection.commit();
      return {
        tournamentId: row.public_id,
        alreadyRetracted,
        publicationId: row.publication_public_id,
        publicationRevision: row.publication_revision === null ? null : Number(row.publication_revision),
        publicationStatus: row.publication_status,
        publicationWasPublic: row.public_results !== 0,
        ratingWasIncluded: row.affects_rating !== 0,
        ratingEpochId: row.retraction_rating_epoch_id,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  public async markRatingReplayCompleted(input: Parameters<TournamentRetractionRepository["markRatingReplayCompleted"]>[0]): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(`
        UPDATE tournaments
           SET retraction_rating_epoch_id = COALESCE(retraction_rating_epoch_id, ?), updated_at_ms = ?
         WHERE public_id = ? AND lifecycle_status = 'retracted'
      `, [input.ratingEpochId, input.nowMs, input.tournamentId]);
      await connection.execute(`
        UPDATE tournament_retraction_audit audit_row
        JOIN tournaments t ON t.tournament_id = audit_row.tournament_id
           SET audit_row.rating_epoch_id = COALESCE(audit_row.rating_epoch_id, ?)
         WHERE t.public_id = ? AND audit_row.action = 'remove'
      `, [input.ratingEpochId, input.tournamentId]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
