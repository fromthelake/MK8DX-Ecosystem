import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from
  "mysql2/promise";

import {
  CARRIED_TIMES_TURNED_OFF_REASON,
  TimeTrialLifecycleError,
  requireAwaitingReview,
  type ManagedTimeTrial,
  type ManagedTimeTrialQuery,
  type TimeTrialCorrection,
  type TimeTrialLifecycleActorRole,
  type TimeTrialLifecycleEvent,
  type TimeTrialLifecycleRepository,
  type TimeTrialRetirementReason,
  type TimeTrialRevisionSummary,
} from "./lifecycle-service.js";
import { publicationRankSnapshots } from "./publication-rank-snapshot.js";
import { refreshTimeTrialPlayerBestsForRevisions } from
  "./time-trial-player-bests.js";
import { enqueueOvertakenNotificationJob } from
  "../notifications/notification-producer-jobs.js";
import { youTubeWatchUrl } from "./youtube-video.js";
import type { TimeTrialCarriedFrom } from "./submission-service.js";

// Every lifecycle action is one transaction that writes three things: the
// canonical fact (a new revision, or the retirement state), the publication
// state that public projections read, and an append-only audit row. They
// cannot drift apart because they commit together.

type ResultRow = RowDataPacket & Record<string, unknown>;

function integer(value: unknown, field: string, minimum = 0): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) ||
    parsed < minimum) {
    throw new TimeTrialLifecycleError("unavailable", `${field} is invalid`);
  }
  return parsed;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TimeTrialLifecycleError("unavailable", `${field} is invalid`);
  }
  return value;
}

function nullableCount(value: unknown): number | null {
  if (value === null || value === undefined) { return null; }
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isSafeInteger(parsed) ? parsed : null;
}

function mode(value: unknown): 150 | 200 {
  const parsed = integer(value, "mode");
  if (parsed !== 150 && parsed !== 200) {
    throw new TimeTrialLifecycleError("unavailable", "mode is unsupported");
  }
  return parsed;
}

/**
 * A carried run waiting for review (ADR-0225), over the publication, its submission and its current
 * revision aliased publication / submission / revision. The installation settings count uses the same.
 */
export const CARRIED_WAITING_CONDITION = `publication.publication_status = 'withheld'
           AND publication.reason_code = 'explicit_review_required'
           AND submission.retirement_state = 'active'
           AND revision.carried_from_origin IS NOT NULL`;

// Where the current revision was carried from (ADR-0225); undefined for a time set here.
function carriedFromOf(row: ResultRow): TimeTrialCarriedFrom | undefined {
  const origin = row["carriedFromOrigin"];
  if (origin === null || origin === undefined) { return undefined; }
  const name = row["carriedFromName"];
  const originalId = row["carriedOriginalSubmissionId"];
  return {
    origin: text(origin, "carried origin"),
    ...(typeof name === "string" && name.length > 0 ? { communityName: name } : {}),
    ...(typeof originalId === "string" && originalId.length > 0 ? { originalSubmissionId: originalId } : {}),
    originalSubmittedAtMs: integer(row["carriedOriginalSubmittedAtMs"], "carried original time"),
  };
}

const revisionSelect = `SELECT revision.time_trial_submission_revision_id AS revisionInternalId,
        revision.revision_number AS revisionNumber,
        revision.mode_cc AS modeCc,
        revision.track_id AS trackId,
        revision.total_time_ms AS totalTimeMs,
        revision.source_kind AS sourceKind,
        revision.created_at_ms AS createdAtMs,
        revision.character_id AS characterId,
        revision.character_variant_id AS characterVariantId,
        revision.body_id AS bodyId,
        revision.body_variant_id AS bodyVariantId,
        revision.tire_id AS tireId,
        revision.glider_id AS gliderId,
        revision.glider_variant_id AS gliderVariantId
 FROM time_trial_submission_revisions AS revision
 WHERE revision.time_trial_submission_id = ?
 ORDER BY revision.revision_number ASC`;

export class MysqlTimeTrialLifecycleRepository
implements TimeTrialLifecycleRepository {
  public constructor(
    private readonly pool: Pool,
    private readonly clock: Readonly<{ nowMs(): number }> =
    { nowMs: () => Date.now() },
  ) {}

  public async findClaimedPlayer(userAccountId: string): Promise<string | null> {
    const [rows] = await this.pool.execute<ResultRow[]>(
      `SELECT player.public_id AS playerId
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
    return row === undefined ? null : text(row["playerId"], "playerId");
  }

  public async read(submissionId: string): Promise<ManagedTimeTrial | null> {
    const connection = await this.pool.getConnection();
    try {
      return await this.readManaged(connection, submissionId, false);
    } finally {
      connection.release();
    }
  }

  public async list(
    query: ManagedTimeTrialQuery,
  ): Promise<readonly ManagedTimeTrial[]> {
    const filters: string[] = [];
    const values: (string | number)[] = [];
    if (query.playerId !== undefined) {
      filters.push("player.public_id = ?"); values.push(query.playerId);
    }
    if (query.trackId !== undefined) {
      filters.push("revision.track_id = ?"); values.push(query.trackId);
    }
    if (query.modeCc !== undefined) {
      filters.push("revision.mode_cc = ?"); values.push(query.modeCc);
    }
    if (query.retirementState !== undefined) {
      filters.push("submission.retirement_state = ?");
      values.push(query.retirementState);
    }
    if (query.publicationStatus !== undefined) {
      filters.push("publication.publication_status = ?");
      values.push(query.publicationStatus);
    }
    if (query.sourceKind !== undefined) {
      filters.push("revision.source_kind = ?"); values.push(query.sourceKind);
    }
    const limit = Math.min(Math.max(1, Math.trunc(query.limit)), 200);
    const [rows] = await this.pool.execute<ResultRow[]>(
      `SELECT submission.public_id AS submissionId
       FROM time_trial_publications AS publication
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id
            = publication.time_trial_submission_id
       INNER JOIN time_trial_submission_revisions AS revision
         ON revision.time_trial_submission_revision_id
            = publication.current_revision_id
       INNER JOIN players AS player
         ON player.player_id = revision.player_id
       ${filters.length === 0 ? "" : `WHERE ${filters.join(" AND ")}`}
       ORDER BY revision.created_at_ms DESC, submission.public_id DESC
       LIMIT ${limit}`,
      values,
    );
    const results: ManagedTimeTrial[] = [];
    const connection = await this.pool.getConnection();
    try {
      for (const row of rows) {
        const managed = await this.readManaged(
          connection,
          text(row["submissionId"], "submissionId"),
          false,
        );
        if (managed !== null) { results.push(managed); }
      }
    } finally {
      connection.release();
    }
    return results;
  }

  public async correct(input: Readonly<{
    submissionId: string;
    correction: TimeTrialCorrection;
    actorRole: TimeTrialLifecycleActorRole;
    actorUserAccountId: string;
  }>): Promise<ManagedTimeTrial> {
    return this.transaction(async (connection) => {
      const current = await this.readManaged(
        connection, input.submissionId, true,
      );
      if (current === null) { throw new TimeTrialLifecycleError("not_found"); }
      const nextRevision = current.current.revision + 1;
      const occurredAtMs = this.clock.nowMs();
      // A correction restates the same result, so everything that identifies
      // which competition it belongs to is copied forward verbatim.
      const [source] = await connection.execute<ResultRow[]>(
        `SELECT * FROM time_trial_submission_revisions
         WHERE time_trial_submission_id = (
           SELECT time_trial_submission_id FROM time_trial_submissions
           WHERE public_id = ?
         ) AND revision_number = ? LIMIT 1`,
        [input.submissionId, current.current.revision],
      );
      const previous = source[0];
      if (previous === undefined) {
        throw new TimeTrialLifecycleError("not_found");
      }
      const submissionInternalId = integer(
        previous["time_trial_submission_id"], "submission id", 1,
      );
      const [inserted] = await connection.execute<ResultSetHeader>(
        `INSERT INTO time_trial_submission_revisions (
           time_trial_submission_id, revision_number, schema_version, mode_cc,
           track_id, total_time_ms, participant_reference_kind, player_id,
           observed_player_name, character_id, character_variant_id, body_id,
           body_variant_id, tire_id, glider_id, glider_variant_id, country_id,
           source_kind, producer_version, local_record_id, occurred_at_ms,
           captured_at_ms, created_at_ms, submitted_at_ms, verification_status,
           verification_method, corrected_fields_json,
           verification_lap_sum_matches, verification_confidence,
           confidence_total_time, confidence_track, confidence_character,
           confidence_character_variant, confidence_body, confidence_tire,
           confidence_glider, confidence_country, confidence_player_name,
           carried_from_origin, carried_from_name,
           carried_original_submission_id, carried_original_submitted_at_ms
         ) SELECT time_trial_submission_id, ?, schema_version, mode_cc,
             track_id, ?, participant_reference_kind, player_id,
             observed_player_name, character_id, character_variant_id, body_id,
             body_variant_id, tire_id, glider_id, glider_variant_id, country_id,
             source_kind, producer_version, local_record_id, occurred_at_ms,
             captured_at_ms, ?, submitted_at_ms, verification_status,
             verification_method, corrected_fields_json,
             verification_lap_sum_matches, verification_confidence,
             confidence_total_time, confidence_track, confidence_character,
             confidence_character_variant, confidence_body, confidence_tire,
             confidence_glider, confidence_country, confidence_player_name,
             carried_from_origin, carried_from_name,
             carried_original_submission_id, carried_original_submitted_at_ms
           FROM time_trial_submission_revisions
           WHERE time_trial_submission_id = ? AND revision_number = ?`,
        [
          nextRevision, input.correction.totalTimeMs, occurredAtMs,
          submissionInternalId, current.current.revision,
        ],
      );
      const revisionInternalId = integer(inserted.insertId, "revision id", 1);
      // A correction keeps the provenance of the revision it corrects: the recognition confidences,
      // the correction marker and the screen the scan was read from all describe the same reading
      // (ADR-0167, ADR-0204). Before this they were silently dropped on every corrected revision.
      await connection.execute(
        `INSERT INTO time_trial_submission_capture_layouts (
           time_trial_submission_revision_id, capture_layout
         ) SELECT ?, capture_layout
             FROM time_trial_submission_capture_layouts
             WHERE time_trial_submission_revision_id = ?`,
        [revisionInternalId, integer(previous["time_trial_submission_revision_id"], "revision id", 1)],
      );
      await connection.execute(
        `DELETE FROM time_trial_laps
         WHERE time_trial_submission_revision_id = ?`,
        [revisionInternalId],
      );
      // A lap's coins and mushrooms: the correction's own when it restates them; otherwise the
      // previous revision's for the same lap, so correcting only a time no longer loses them.
      const [previousLapRows] = await connection.execute<ResultRow[]>(
        `SELECT lap_number AS lapNumber, coins_collected AS coinsCollected, mushrooms_used AS mushroomsUsed
         FROM time_trial_laps WHERE time_trial_submission_revision_id = ?`,
        [integer(previous["time_trial_submission_revision_id"], "revision id", 1)],
      );
      const previousCounts = new Map(previousLapRows.map((row) => [
        integer(row["lapNumber"], "lap", 1),
        { coinsCollected: nullableCount(row["coinsCollected"]), mushroomsUsed: nullableCount(row["mushroomsUsed"]) },
      ] as const));
      const keepCounts = input.correction.laps.length === previousLapRows.length;
      for (const [index, lapTimeMs] of input.correction.laps.entries()) {
        const restated = input.correction.lapDetails?.[index];
        const kept = keepCounts ? previousCounts.get(index + 1) : undefined;
        const coins = input.correction.lapDetails !== undefined
          ? restated?.coinsCollected ?? null : kept?.coinsCollected ?? null;
        const mushrooms = input.correction.lapDetails !== undefined
          ? restated?.mushroomsUsed ?? null : kept?.mushroomsUsed ?? null;
        await connection.execute(
          `INSERT INTO time_trial_laps (
             time_trial_submission_revision_id, lap_number, time_ms, coins_collected, mushrooms_used
           ) VALUES (?, ?, ?, ?, ?)`,
          [revisionInternalId, index + 1, lapTimeMs, coins, mushrooms],
        );
      }
      // A restated kart setup replaces the four parts. A colour variant stays only while its base
      // part is unchanged (MySQL/MariaDB assign left to right, so the IF()s still see the old parts).
      if (input.correction.loadout !== undefined) {
        const next = input.correction.loadout;
        await connection.execute(
          `UPDATE time_trial_submission_revisions
           SET character_variant_id = IF(character_id <=> ?, character_variant_id, NULL),
               body_variant_id = IF(body_id <=> ?, body_variant_id, NULL),
               glider_variant_id = IF(glider_id <=> ?, glider_variant_id, NULL),
               character_id = ?, body_id = ?, tire_id = ?, glider_id = ?
           WHERE time_trial_submission_revision_id = ?`,
          [
            next.characterId ?? null, next.bodyId ?? null, next.gliderId ?? null,
            next.characterId ?? null, next.bodyId ?? null, next.tireId ?? null, next.gliderId ?? null,
            revisionInternalId,
          ],
        );
      }
      await this.applyPublication(
        connection, submissionInternalId, revisionInternalId,
        current.retirementState === "retired" ? "withheld" : "published",
        input.actorRole, "result_corrected", occurredAtMs,
      );
      await this.appendEvent(connection, {
        submissionInternalId,
        revisionInternalId,
        eventType: "corrected",
        retirementStateAfter: "active",
        actorRole: input.actorRole,
        actorUserAccountId: input.actorUserAccountId,
        reasonCode: input.correction.reasonCode,
        ...(input.correction.note === undefined
          ? {}
          : { note: input.correction.note }),
        occurredAtMs,
      });
      const next = await this.readManaged(connection, input.submissionId, true);
      if (next === null) { throw new TimeTrialLifecycleError("unavailable"); }
      return next;
    });
  }

  public async publishReviewed(input: Readonly<{
    submissionId: string;
    expectedRevision: number;
    note?: string;
    actorUserAccountId: string;
  }>): Promise<ManagedTimeTrial> {
    return this.transaction((connection) => this.publishReviewedWith(connection, input));
  }

  /**
   * ADR-0225: the carried runs waiting for review at this moment, all published or all refused in one
   * transaction. Each run goes through the same step as its single action (publishReviewed, or a
   * retirement with reason carried_times_turned_off) and gets its own audit event. Refused with a
   * conflict when the number waiting is not the number the administrator saw.
   */
  public async resolveCarriedWaiting(input: Readonly<{
    decision: "publish" | "refuse";
    expectedCount: number;
    actorUserAccountId: string;
  }>): Promise<Readonly<{ resolved: number; left: number }>> {
    return this.transaction(async (connection) => {
      const [rows] = await connection.execute<ResultRow[]>(
        `SELECT submission.public_id AS submissionId,
                revision.revision_number AS revisionNumber,
                player.visibility AS playerVisibility
         FROM time_trial_publications AS publication
         INNER JOIN time_trial_submissions AS submission
           ON submission.time_trial_submission_id = publication.time_trial_submission_id
         INNER JOIN time_trial_submission_revisions AS revision
           ON revision.time_trial_submission_revision_id = publication.current_revision_id
         INNER JOIN players AS player ON player.player_id = revision.player_id
         WHERE ${CARRIED_WAITING_CONDITION}
         ORDER BY submission.time_trial_submission_id
         FOR UPDATE`,
      );
      if (rows.length !== input.expectedCount) {
        throw new TimeTrialLifecycleError(
          "conflict", "The number of carried times waiting changed meanwhile. Reload and try again.",
        );
      }
      let resolved = 0;
      let left = 0;
      for (const row of rows) {
        const submissionId = text(row["submissionId"], "submissionId");
        if (input.decision === "publish") {
          // A Private Player stays private: such a run keeps waiting.
          if (row["playerVisibility"] === "private") { left += 1; continue; }
          await this.publishReviewedWith(connection, {
            submissionId,
            expectedRevision: integer(row["revisionNumber"], "revision", 1),
            actorUserAccountId: input.actorUserAccountId,
          });
        } else {
          await this.setRetirementWith(connection, {
            submissionId,
            retire: true,
            reasonCode: CARRIED_TIMES_TURNED_OFF_REASON,
            actorRole: "administrator",
            actorUserAccountId: input.actorUserAccountId,
          });
        }
        resolved += 1;
      }
      return { resolved, left };
    });
  }

  private async publishReviewedWith(connection: PoolConnection, input: Readonly<{
    submissionId: string;
    expectedRevision: number;
    note?: string;
    actorUserAccountId: string;
  }>): Promise<ManagedTimeTrial> {
    {
      const current = await this.readManaged(connection, input.submissionId, true);
      if (current === null) { throw new TimeTrialLifecycleError("not_found"); }
      // Checked again under the row lock: the service's check saw the run before the transaction.
      requireAwaitingReview(current, input.expectedRevision);
      const [ids] = await connection.execute<ResultRow[]>(
        `SELECT submission.time_trial_submission_id AS submissionInternalId,
                publication.current_revision_id AS revisionInternalId,
                player.visibility AS playerVisibility
         FROM time_trial_submissions AS submission
         INNER JOIN time_trial_publications AS publication
           ON publication.time_trial_submission_id
              = submission.time_trial_submission_id
         INNER JOIN time_trial_submission_revisions AS revision
           ON revision.time_trial_submission_revision_id
              = publication.current_revision_id
         INNER JOIN players AS player ON player.player_id = revision.player_id
         WHERE submission.public_id = ? LIMIT 1 FOR UPDATE`,
        [input.submissionId],
      );
      const row = ids[0];
      if (row === undefined) { throw new TimeTrialLifecycleError("not_found"); }
      // A Private Player stays private: review approval never forces a result public.
      if (row["playerVisibility"] === "private") {
        throw new TimeTrialLifecycleError("conflict", "The Player is private; the result stays out of public views.");
      }
      const submissionInternalId = integer(row["submissionInternalId"], "submission id", 1);
      const revisionInternalId = integer(row["revisionInternalId"], "revision id", 1);
      const occurredAtMs = this.clock.nowMs();
      // The same publication path as every published run: rank snapshot, publication history,
      // overtaken notifications and the Player's bests.
      await this.applyPublication(
        connection, submissionInternalId, revisionInternalId, "published",
        "administrator", "administrator_review_publication", occurredAtMs, "administrator_review",
      );
      await this.appendEvent(connection, {
        submissionInternalId,
        revisionInternalId,
        eventType: "published",
        retirementStateAfter: "active",
        actorRole: "administrator",
        actorUserAccountId: input.actorUserAccountId,
        reasonCode: "review_approved",
        ...(input.note === undefined ? {} : { note: input.note }),
        occurredAtMs,
      });
      const next = await this.readManaged(connection, input.submissionId, true);
      if (next === null) { throw new TimeTrialLifecycleError("unavailable"); }
      return next;
    }
  }

  public async setRetirement(input: Readonly<{
    submissionId: string;
    retire: boolean;
    reasonCode: TimeTrialRetirementReason;
    note?: string;
    actorRole: TimeTrialLifecycleActorRole;
    actorUserAccountId: string;
  }>): Promise<ManagedTimeTrial> {
    return this.transaction((connection) => this.setRetirementWith(connection, input));
  }

  private async setRetirementWith(connection: PoolConnection, input: Readonly<{
    submissionId: string;
    retire: boolean;
    /** A retirement reason, or carried_times_turned_off for the bulk refusal (ADR-0225). */
    reasonCode: string;
    note?: string;
    actorRole: TimeTrialLifecycleActorRole;
    actorUserAccountId: string;
  }>): Promise<ManagedTimeTrial> {
    {
      const current = await this.readManaged(
        connection, input.submissionId, true,
      );
      if (current === null) { throw new TimeTrialLifecycleError("not_found"); }
      const occurredAtMs = this.clock.nowMs();
      const [ids] = await connection.execute<ResultRow[]>(
        `SELECT submission.time_trial_submission_id AS submissionInternalId,
                publication.current_revision_id AS revisionInternalId,
                player.visibility AS playerVisibility
         FROM time_trial_submissions AS submission
         INNER JOIN time_trial_publications AS publication
           ON publication.time_trial_submission_id
              = submission.time_trial_submission_id
         INNER JOIN time_trial_submission_revisions AS revision
           ON revision.time_trial_submission_revision_id
              = publication.current_revision_id
         INNER JOIN players AS player ON player.player_id = revision.player_id
         WHERE submission.public_id = ? LIMIT 1 FOR UPDATE`,
        [input.submissionId],
      );
      const row = ids[0];
      if (row === undefined) { throw new TimeTrialLifecycleError("not_found"); }
      const submissionInternalId = integer(
        row["submissionInternalId"], "submission id", 1,
      );
      const revisionInternalId = integer(
        row["revisionInternalId"], "revision id", 1,
      );
      await connection.execute(
        `UPDATE time_trial_submissions SET retirement_state = ?
         WHERE time_trial_submission_id = ?`,
        [input.retire ? "retired" : "active", submissionInternalId],
      );
      // Restoring never forces a result public: a Player who is private stays
      // private, and the result simply becomes eligible again.
      const publish = !input.retire && row["playerVisibility"] !== "private";
      await this.applyPublication(
        connection, submissionInternalId, revisionInternalId,
        publish ? "published" : "withheld",
        input.actorRole,
        input.retire
          ? "result_retired"
          : (publish ? "result_restored" : "player_private"),
        occurredAtMs,
      );
      await this.appendEvent(connection, {
        submissionInternalId,
        revisionInternalId,
        eventType: input.retire ? "retired" : "restored",
        retirementStateAfter: input.retire ? "retired" : "active",
        actorRole: input.actorRole,
        actorUserAccountId: input.actorUserAccountId,
        reasonCode: input.reasonCode,
        ...(input.note === undefined ? {} : { note: input.note }),
        occurredAtMs,
      });
      const next = await this.readManaged(connection, input.submissionId, true);
      if (next === null) { throw new TimeTrialLifecycleError("unavailable"); }
      return next;
    }
  }

  public async setVideo(input: Readonly<{
    submissionId: string;
    videoId: string | null;
    actorUserAccountId: string;
  }>): Promise<ManagedTimeTrial> {
    return this.transaction(async (connection) => {
      const current = await this.readManaged(connection, input.submissionId, true);
      if (current === null) { throw new TimeTrialLifecycleError("not_found"); }
      const [ids] = await connection.execute<ResultRow[]>(
        `SELECT submission.time_trial_submission_id AS submissionInternalId,
                (SELECT user_account_id FROM user_accounts WHERE public_id = ? LIMIT 1) AS accountInternalId
         FROM time_trial_submissions AS submission WHERE submission.public_id = ? LIMIT 1`,
        [input.actorUserAccountId, input.submissionId],
      );
      const row = ids[0];
      if (row === undefined) { throw new TimeTrialLifecycleError("not_found"); }
      const submissionInternalId = integer(row["submissionInternalId"], "submission id", 1);
      if (input.videoId === null) {
        await connection.execute(
          "DELETE FROM time_trial_videos WHERE time_trial_submission_id = ?", [submissionInternalId],
        );
      } else {
        if (row["accountInternalId"] === null || row["accountInternalId"] === undefined) {
          throw new TimeTrialLifecycleError("forbidden");
        }
        await connection.execute(
          `INSERT INTO time_trial_videos (time_trial_submission_id, youtube_video_id, set_by_user_account_id, set_at_ms)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE youtube_video_id = VALUES(youtube_video_id),
             set_by_user_account_id = VALUES(set_by_user_account_id), set_at_ms = VALUES(set_at_ms)`,
          [submissionInternalId, input.videoId, integer(row["accountInternalId"], "account id", 1), this.clock.nowMs()],
        );
      }
      const next = await this.readManaged(connection, input.submissionId, true);
      if (next === null) { throw new TimeTrialLifecycleError("unavailable"); }
      return next;
    });
  }

  private async transaction<T>(
    work: (connection: PoolConnection) => Promise<T>,
  ): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async applyPublication(
    connection: PoolConnection,
    submissionInternalId: number,
    revisionInternalId: number,
    status: "published" | "withheld",
    actorRole: TimeTrialLifecycleActorRole,
    reasonCode: string,
    occurredAtMs: number,
    originOverride?: "administrator_review",
  ): Promise<void> {
    const origin = originOverride ?? (actorRole === "owner"
      ? "owner_lifecycle"
      : "administrator_lifecycle");
    const rankAtPublication = status === "published"
      ? (await publicationRankSnapshots(connection, [revisionInternalId]))
        .get(revisionInternalId)
      : undefined;
    if (status === "published" && rankAtPublication === undefined) {
      throw new TimeTrialLifecycleError("unavailable", "publication rank missing");
    }
    await connection.execute(
      `UPDATE time_trial_publications
       SET current_revision_id = ?, publication_status = ?,
           publication_origin = ?, reason_code = ?,
           publication_revision = publication_revision + 1,
           published_at_ms = ?, rank_at_publication = ?, updated_at_ms = ?
       WHERE time_trial_submission_id = ?`,
      [
        revisionInternalId, status, origin, reasonCode,
        status === "published" ? occurredAtMs : null,
        rankAtPublication ?? null, occurredAtMs, submissionInternalId,
      ],
    );
    const [rows] = await connection.execute<ResultRow[]>(
      `SELECT time_trial_publication_id AS publicationId,
              publication_revision AS publicationRevision
       FROM time_trial_publications WHERE time_trial_submission_id = ?
       LIMIT 1`,
      [submissionInternalId],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new TimeTrialLifecycleError("unavailable", "publication missing");
    }
    await connection.execute(
      `INSERT INTO time_trial_publication_lifecycle (
         time_trial_publication_id, sequence_number,
         time_trial_submission_revision_id, event_type,
         publication_status_after, publication_origin, reason_code,
         rank_at_publication, occurred_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        integer(row["publicationId"], "publication id", 1),
        integer(row["publicationRevision"], "publication revision", 1),
        revisionInternalId,
        status === "published" ? "revision_published" : "revision_withheld",
        status, origin, reasonCode, rankAtPublication ?? null, occurredAtMs,
      ],
    );
    if (status === "published") {
      await enqueueOvertakenNotificationJob(
        connection,
        integer(row["publicationId"], "publication id", 1),
        integer(row["publicationRevision"], "publication revision", 1),
        occurredAtMs,
      );
    }
    await refreshTimeTrialPlayerBestsForRevisions(
      connection,
      [revisionInternalId],
    );
  }

  private async appendEvent(
    connection: PoolConnection,
    input: Readonly<{
      submissionInternalId: number;
      revisionInternalId: number;
      eventType: "corrected" | "retired" | "restored" | "published";
      retirementStateAfter: "active" | "retired";
      actorRole: TimeTrialLifecycleActorRole;
      actorUserAccountId: string;
      reasonCode: string;
      note?: string;
      occurredAtMs: number;
    }>,
  ): Promise<void> {
    const [accounts] = await connection.execute<ResultRow[]>(
      `SELECT user_account_id AS internalId FROM user_accounts
       WHERE public_id = ? LIMIT 1`,
      [input.actorUserAccountId],
    );
    const account = accounts[0];
    if (account === undefined) {
      throw new TimeTrialLifecycleError("forbidden");
    }
    await connection.execute(
      `INSERT INTO time_trial_lifecycle_events (
         time_trial_submission_id, sequence_number, event_type,
         retirement_state_after, time_trial_submission_revision_id,
         actor_role, actor_user_account_id, reason_code, note, occurred_at_ms
       ) SELECT ?, COALESCE(MAX(sequence_number), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?
         FROM time_trial_lifecycle_events WHERE time_trial_submission_id = ?`,
      [
        input.submissionInternalId, input.eventType,
        input.retirementStateAfter, input.revisionInternalId, input.actorRole,
        integer(account["internalId"], "account id", 1), input.reasonCode,
        input.note ?? null, input.occurredAtMs, input.submissionInternalId,
      ],
    );
  }

  private async readManaged(
    connection: PoolConnection,
    submissionId: string,
    forUpdate: boolean,
  ): Promise<ManagedTimeTrial | null> {
    const [rows] = await connection.execute<ResultRow[]>(
      `SELECT submission.time_trial_submission_id AS submissionInternalId,
              submission.public_id AS submissionId,
              submission.retirement_state AS retirementState,
              publication.publication_status AS publicationStatus,
              publication.reason_code AS publicationReason,
              revision.revision_number AS revisionNumber,
              revision.carried_from_origin AS carriedFromOrigin,
              revision.carried_from_name AS carriedFromName,
              revision.carried_original_submission_id AS carriedOriginalSubmissionId,
              revision.carried_original_submitted_at_ms AS carriedOriginalSubmittedAtMs,
              player.public_id AS playerId,
              player.display_name AS playerDisplayName,
              username.username_value AS playerUsername
       FROM time_trial_submissions AS submission
       INNER JOIN time_trial_publications AS publication
         ON publication.time_trial_submission_id
            = submission.time_trial_submission_id
       INNER JOIN time_trial_submission_revisions AS revision
         ON revision.time_trial_submission_revision_id
            = publication.current_revision_id
       INNER JOIN players AS player ON player.player_id = revision.player_id
       INNER JOIN player_username_history AS username
         ON username.current_player_id = player.player_id
       WHERE submission.public_id = ?
       LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
      [submissionId],
    );
    const row = rows[0];
    if (row === undefined) { return null; }
    const submissionInternalId = integer(
      row["submissionInternalId"], "submission id", 1,
    );
    const [revisionRows] = await connection.execute<ResultRow[]>(
      `${revisionSelect}`, [submissionInternalId],
    );
    const revisions: TimeTrialRevisionSummary[] = [];
    for (const revisionRow of revisionRows) {
      const revisionInternalId = integer(
        revisionRow["revisionInternalId"], "revision id", 1,
      );
      const [lapRows] = await connection.execute<ResultRow[]>(
        `SELECT time_ms AS lapTimeMs, coins_collected AS coinsCollected, mushrooms_used AS mushroomsUsed
         FROM time_trial_laps
         WHERE time_trial_submission_revision_id = ?
         ORDER BY lap_number ASC`,
        [revisionInternalId],
      );
      const loadout: Record<string, string> = {};
      for (const key of ["characterId", "characterVariantId", "bodyId", "bodyVariantId", "tireId", "gliderId", "gliderVariantId"]) {
        const value = revisionRow[key];
        if (typeof value === "string" && value.length > 0) { loadout[key] = value; }
      }
      revisions.push({
        revision: integer(revisionRow["revisionNumber"], "revision", 1),
        modeCc: mode(revisionRow["modeCc"]),
        trackId: text(revisionRow["trackId"], "trackId"),
        totalTimeMs: integer(revisionRow["totalTimeMs"], "totalTimeMs", 1),
        laps: lapRows.map((lap) => integer(lap["lapTimeMs"], "lapTimeMs", 1)),
        lapDetails: lapRows.map((lap) => {
          const coins = nullableCount(lap["coinsCollected"]);
          const mushrooms = nullableCount(lap["mushroomsUsed"]);
          return {
            ...(coins === null ? {} : { coinsCollected: coins }),
            ...(mushrooms === null ? {} : { mushroomsUsed: mushrooms }),
          };
        }),
        ...(Object.keys(loadout).length === 0 ? {} : { loadout }),
        sourceKind: text(revisionRow["sourceKind"], "sourceKind"),
        createdAtMs: integer(revisionRow["createdAtMs"], "createdAtMs"),
      });
    }
    const currentRevision = integer(row["revisionNumber"], "revision", 1);
    const current = revisions.find(
      (revision) => revision.revision === currentRevision,
    );
    if (current === undefined) {
      throw new TimeTrialLifecycleError("unavailable", "current revision lost");
    }
    const [eventRows] = await connection.execute<ResultRow[]>(
      `SELECT event.sequence_number AS sequenceNumber,
              event.event_type AS eventType,
              event.retirement_state_after AS retirementStateAfter,
              revision.revision_number AS revisionNumber,
              event.actor_role AS actorRole,
              event.reason_code AS reasonCode,
              event.note AS note,
              event.occurred_at_ms AS occurredAtMs
       FROM time_trial_lifecycle_events AS event
       INNER JOIN time_trial_submission_revisions AS revision
         ON revision.time_trial_submission_revision_id
            = event.time_trial_submission_revision_id
       WHERE event.time_trial_submission_id = ?
       ORDER BY event.sequence_number ASC`,
      [submissionInternalId],
    );
    const events: TimeTrialLifecycleEvent[] = eventRows.map((event) => ({
      sequenceNumber: integer(event["sequenceNumber"], "sequence", 1),
      eventType: text(event["eventType"], "eventType") as
        TimeTrialLifecycleEvent["eventType"],
      retirementStateAfter:
        text(event["retirementStateAfter"], "state") as "active" | "retired",
      revision: integer(event["revisionNumber"], "revision", 1),
      actorRole: text(event["actorRole"], "actorRole") as
        TimeTrialLifecycleActorRole,
      reasonCode: text(event["reasonCode"], "reasonCode"),
      ...(typeof event["note"] === "string" && event["note"].length > 0
        ? { note: event["note"] }
        : {}),
      occurredAtMs: integer(event["occurredAtMs"], "occurredAtMs"),
    }));
    const [videoRows] = await connection.execute<ResultRow[]>(
      `SELECT youtube_video_id AS videoId FROM time_trial_videos WHERE time_trial_submission_id = ? LIMIT 1`,
      [submissionInternalId],
    );
    const videoId = videoRows[0]?.["videoId"];
    const carriedFrom = carriedFromOf(row);
    return {
      ...(typeof videoId === "string" && videoId.length === 11 ? { videoUrl: youTubeWatchUrl(videoId) } : {}),
      ...(carriedFrom === undefined ? {} : { carriedFrom }),
      submissionId: text(row["submissionId"], "submissionId"),
      playerId: text(row["playerId"], "playerId"),
      playerUsername: text(row["playerUsername"], "playerUsername"),
      playerDisplayName: text(row["playerDisplayName"], "displayName"),
      retirementState:
        row["retirementState"] === "retired" ? "retired" : "active",
      publicationStatus:
        row["publicationStatus"] === "published" ? "published" : "withheld",
      publicationReason: text(row["publicationReason"], "reason"),
      current,
      revisions,
      events,
    };
  }
}
