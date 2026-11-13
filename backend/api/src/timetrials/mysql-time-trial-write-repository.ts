import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";

import {
  TimeTrialSubmissionError,
  type TimeTrialCarriedFillPlan,
  type TimeTrialCarriedOriginal,
  type TimeTrialEqualRun,
  type TimeTrialLap,
  type TimeTrialLoadout,
  type TimeTrialRevisionPersistenceInput,
  type TimeTrialSubmissionState,
  type TimeTrialWriteRepository,
  type TimeTrialWriteTransaction,
} from "./submission-service.js";
import { publicationRankSnapshots } from "./publication-rank-snapshot.js";
import {
  refreshTimeTrialPlayerBestsForPlayers,
  refreshTimeTrialPlayerBestsForRevisions,
} from "./time-trial-player-bests.js";
import { enqueueOvertakenNotificationJob } from
  "../notifications/notification-producer-jobs.js";

interface SubmissionRow extends RowDataPacket {
  submissionInternalId: unknown;
  firstCreatedAtMs: unknown;
}

interface RevisionRow extends RowDataPacket {
  latestRevision: unknown;
}

interface InternalIdRow extends RowDataPacket {
  internalId: unknown;
}

interface PublicationRevisionRow extends RowDataPacket {
  publicationRevision: unknown;
}

export class TimeTrialPersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TimeTrialPersistenceError";
  }
}

function safeInteger(value: unknown, field: string, minimum: number): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isSafeInteger(numeric) || numeric < minimum) {
    throw new TimeTrialPersistenceError(`${field} has an invalid persisted value`);
  }
  return numeric;
}

function singleRow<T extends RowDataPacket>(rows: T[], resource: string): T | null {
  if (rows.length === 0) {
    return null;
  }
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new TimeTrialPersistenceError(`${resource} lookup returned an invalid row count`);
  }
  return rows[0];
}

function isDuplicateKeyError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; errno?: unknown };
  return candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062;
}

export class MysqlTimeTrialWriteTransaction implements TimeTrialWriteTransaction {
  public constructor(
    private readonly connection: PoolConnection,
    private readonly clock: Readonly<{ nowMs(): number }>,
  ) {}

  public async findSubmissionForUpdate(
    submissionId: string,
  ): Promise<TimeTrialSubmissionState | null> {
    const [rows] = await this.connection.execute<SubmissionRow[]>(
      `SELECT time_trial_submission_id AS submissionInternalId,
              first_created_at_ms AS firstCreatedAtMs
       FROM time_trial_submissions
       WHERE public_id = ?
       LIMIT 1 FOR UPDATE`,
      [submissionId],
    );
    const row = singleRow(rows, "Time Trial submission");
    if (row === null) {
      return null;
    }
    const submissionInternalId = safeInteger(
      row.submissionInternalId,
      "TimeTrialSubmission.internalId",
      1,
    );
    const [revisionRows] = await this.connection.execute<RevisionRow[]>(
      `SELECT COALESCE(MAX(revision_number), 0) AS latestRevision
       FROM time_trial_submission_revisions
       WHERE time_trial_submission_id = ?`,
      [submissionInternalId],
    );
    const revisionRow = singleRow(revisionRows, "Time Trial revision aggregate");
    if (revisionRow === null) {
      throw new TimeTrialPersistenceError("Time Trial revision aggregate was absent");
    }
    return {
      firstCreatedAtMs: safeInteger(
        row.firstCreatedAtMs,
        "TimeTrialSubmission.firstCreatedAtMs",
        0,
      ),
      latestRevision: safeInteger(
        revisionRow.latestRevision,
        "TimeTrialSubmission.latestRevision",
        0,
      ),
    };
  }

  public async findActiveHumanPlayerForUpdate(playerId: string): Promise<boolean> {
    const [rows] = await this.connection.execute<InternalIdRow[]>(
      `SELECT player_id AS internalId
       FROM players
       WHERE public_id = ? AND player_kind = 'human' AND record_status = 'active'
       LIMIT 1 FOR UPDATE`,
      [playerId],
    );
    const row = singleRow(rows, "active human Player");
    if (row === null) {
      return false;
    }
    safeInteger(row.internalId, "Player.internalId", 1);
    return true;
  }

  public async insertSubmission(
    submissionId: string,
    firstCreatedAtMs: number,
  ): Promise<void> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO time_trial_submissions (public_id, first_created_at_ms)
       VALUES (?, ?)`,
      [submissionId, firstCreatedAtMs],
    );
    if (result.affectedRows !== 1) {
      throw new TimeTrialPersistenceError("Time Trial submission was not inserted");
    }
  }

  public async insertRevision(input: TimeTrialRevisionPersistenceInput): Promise<void> {
    const publicFields = input.submission as unknown as Record<string, unknown>;
    if (Object.hasOwn(publicFields, "playerReference") || Object.hasOwn(publicFields, "evidence")) {
      throw new TimeTrialPersistenceError("raw restricted fields reached persistence");
    }
    if ((input.playerId === null) === (input.restrictedParticipant === null)) {
      throw new TimeTrialPersistenceError("participant persistence invariant failed");
    }
    if (input.protectedEvidence.some(
      (evidence, index) => evidence.sequenceNumber !== index + 1,
    )) {
      throw new TimeTrialPersistenceError("evidence sequence invariant failed");
    }

    const submissionInternalId = await this.findInternalSubmissionId(
      input.submission.submissionId,
    );
    const playerInternalId = input.playerId === null
      ? null
      : await this.findInternalPlayerId(input.playerId);
    const loadout = input.submission.loadout;
    const verification = input.submission.verification;
    const confidence = verification?.fieldConfidence;
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO time_trial_submission_revisions (
         time_trial_submission_id, revision_number, schema_version, mode_cc,
         track_id, total_time_ms, participant_reference_kind, player_id,
         observed_player_name, character_id, character_variant_id, body_id,
         body_variant_id, tire_id, glider_id, glider_variant_id, country_id,
         source_kind, producer_version, local_record_id, occurred_at_ms,
         captured_at_ms, created_at_ms, submitted_at_ms, verification_status,
         verification_method, corrected_fields_json, verification_lap_sum_matches,
         verification_confidence, confidence_total_time, confidence_track,
         confidence_character, confidence_character_variant, confidence_body,
         confidence_tire, confidence_glider, confidence_country,
         confidence_player_name, carried_from_origin, carried_from_name,
         carried_original_submission_id, carried_original_submitted_at_ms
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       )`,
      [
        submissionInternalId,
        input.submission.revision,
        input.submission.schemaVersion,
        input.submission.mode,
        input.submission.trackId,
        input.submission.totalTimeMs,
        input.playerId === null ? "restricted_reference" : "player",
        playerInternalId,
        input.submission.observedPlayerName ?? null,
        loadout?.characterId ?? null,
        loadout?.characterVariantId ?? null,
        loadout?.bodyId ?? null,
        loadout?.bodyVariantId ?? null,
        loadout?.tireId ?? null,
        loadout?.gliderId ?? null,
        loadout?.gliderVariantId ?? null,
        input.submission.countryId ?? null,
        input.submission.source.kind,
        input.submission.source.producerVersion ?? null,
        input.submission.source.localRecordId ?? null,
        input.submission.timestamps.occurredAtMs ?? null,
        input.submission.timestamps.capturedAtMs ?? null,
        input.submission.timestamps.createdAtMs,
        input.submission.timestamps.submittedAtMs ?? null,
        verification?.status ?? null,
        verification?.method ?? null,
        verification?.correctedFields === undefined
          ? null
          : JSON.stringify(verification.correctedFields),
        verification?.lapSumMatches ?? null,
        verification?.confidence ?? null,
        confidence?.totalTime ?? null,
        confidence?.track ?? null,
        confidence?.character ?? null,
        confidence?.characterVariant ?? null,
        confidence?.body ?? null,
        confidence?.tire ?? null,
        confidence?.glider ?? null,
        confidence?.country ?? null,
        confidence?.playerName ?? null,
        // ADR-0225: where a carried time comes from; NULL for a time set here.
        input.submission.carriedFrom?.origin ?? null,
        input.submission.carriedFrom?.communityName ?? null,
        input.submission.carriedFrom?.originalSubmissionId ?? null,
        input.submission.carriedFrom?.originalSubmittedAtMs ?? null,
      ],
    );
    if (result.affectedRows !== 1 || result.insertId < 1) {
      throw new TimeTrialPersistenceError("Time Trial revision was not inserted");
    }
    const revisionInternalId = result.insertId;

    // Which screen the producer read (ADR-0204). Its own row rather than a column on the revision,
    // for the reason migration 0067 states; absent means the producer did not say, which is every
    // typed submission and everything stored before that migration.
    const captureLayout = input.submission.source.captureLayout;
    if (captureLayout !== undefined) {
      const [layoutResult] = await this.connection.execute<ResultSetHeader>(
        `INSERT INTO time_trial_submission_capture_layouts (
           time_trial_submission_revision_id, capture_layout
         ) VALUES (?, ?)`,
        [revisionInternalId, captureLayout],
      );
      this.requireSingleInsert(layoutResult, "Time Trial capture layout");
    }

    for (const lap of input.submission.laps) {
      const [lapResult] = await this.connection.execute<ResultSetHeader>(
        `INSERT INTO time_trial_laps (
           time_trial_submission_revision_id, lap_number, time_ms,
           coins_collected, mushrooms_used, confidence
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          revisionInternalId,
          lap.lapNumber,
          lap.timeMs,
          lap.coinsCollected ?? null,
          lap.mushroomsUsed ?? null,
          lap.confidence ?? null,
        ],
      );
      this.requireSingleInsert(lapResult, "Time Trial lap");
    }

    if (input.restrictedParticipant !== null) {
      const participant = input.restrictedParticipant;
      const [participantResult] = await this.connection.execute<ResultSetHeader>(
        `INSERT INTO restricted_time_trial_participant_references (
           time_trial_submission_revision_id, reference_namespace, lookup_hmac,
           lookup_key_version, reference_ciphertext, encryption_key_version
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          revisionInternalId,
          participant.namespace,
          participant.lookupHmac,
          participant.lookupKeyVersion,
          participant.ciphertext,
          participant.encryptionKeyVersion,
        ],
      );
      this.requireSingleInsert(participantResult, "restricted participant reference");
    }

    for (const evidence of input.protectedEvidence) {
      const [evidenceResult] = await this.connection.execute<ResultSetHeader>(
        `INSERT INTO restricted_time_trial_evidence (
           time_trial_submission_revision_id, sequence_number, evidence_kind,
           reference_ciphertext, encryption_key_version, sha256, media_type
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          revisionInternalId,
          evidence.sequenceNumber,
          evidence.kind,
          evidence.protectedReference.ciphertext,
          evidence.protectedReference.encryptionKeyVersion,
          evidence.sha256 ?? null,
          evidence.mediaType ?? null,
        ],
      );
      this.requireSingleInsert(evidenceResult, "restricted Time Trial evidence");
    }
    await this.updatePublication(
      input,
      submissionInternalId,
      revisionInternalId,
      playerInternalId,
    );
  }

  private async updatePublication(
    input: TimeTrialRevisionPersistenceInput,
    submissionInternalId: number,
    revisionInternalId: number,
    playerInternalId: number | null,
  ): Promise<void> {
    const eligibility = input.publicationEligibility ?? "explicit_review_required";
    let published = false;
    let reasonCode:
      | "verified_claim_runtime_acceptance"
      | "explicit_review_required"
      | "non_player_participant"
      | "producer_verification_withheld"
      | "unverified_player_claim";
    if (playerInternalId === null) {
      reasonCode = "non_player_participant";
    } else if (eligibility !== "runtime_eligible") {
      reasonCode = eligibility;
    } else {
      const [claims] = await this.connection.execute<RowDataPacket[]>(
        `SELECT player_claim_id
         FROM player_claims
         WHERE player_id = ? AND claim_status = 'verified'
         LIMIT 1 FOR UPDATE`,
        [playerInternalId],
      );
      published = claims.length === 1;
      reasonCode = published
        ? "verified_claim_runtime_acceptance"
        : "unverified_player_claim";
    }
    const publicationStatus = published ? "published" : "withheld";
    const publicationOrigin = eligibility === "explicit_review_required"
      ? "internal_withheld"
      : "runtime_automatic";
    const occurredAtMs = this.clock.nowMs();
    if (!Number.isSafeInteger(occurredAtMs) || occurredAtMs < 0) {
      throw new TimeTrialPersistenceError("publication clock is invalid");
    }
    const rankAtPublication = published
      ? (await publicationRankSnapshots(this.connection, [revisionInternalId]))
        .get(revisionInternalId)
      : undefined;
    if (published && rankAtPublication === undefined) {
      throw new TimeTrialPersistenceError("Time Trial publication rank was not calculated");
    }
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO time_trial_publications (
         time_trial_submission_id, current_revision_id, publication_revision,
         publication_status, publication_origin, reason_code,
         published_at_ms, rank_at_publication, updated_at_ms
       ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         time_trial_publication_id = LAST_INSERT_ID(time_trial_publication_id),
         current_revision_id = VALUES(current_revision_id),
         publication_revision = publication_revision + 1,
         publication_status = VALUES(publication_status),
         publication_origin = VALUES(publication_origin),
         reason_code = VALUES(reason_code),
         published_at_ms = VALUES(published_at_ms),
         rank_at_publication = VALUES(rank_at_publication),
         updated_at_ms = VALUES(updated_at_ms)`,
      [
        submissionInternalId,
        revisionInternalId,
        publicationStatus,
        publicationOrigin,
        reasonCode,
        published ? occurredAtMs : null,
        rankAtPublication ?? null,
        occurredAtMs,
      ],
    );
    if (result.affectedRows < 1 || result.insertId < 1) {
      throw new TimeTrialPersistenceError("Time Trial publication state was not updated");
    }
    const [rows] = await this.connection.execute<PublicationRevisionRow[]>(
      `SELECT publication_revision AS publicationRevision
       FROM time_trial_publications
       WHERE time_trial_publication_id = ? LIMIT 1 FOR UPDATE`,
      [result.insertId],
    );
    const row = singleRow(rows, "Time Trial publication");
    if (row === null) {
      throw new TimeTrialPersistenceError("Time Trial publication state was lost");
    }
    const sequence = safeInteger(
      row.publicationRevision,
      "TimeTrialPublication.publicationRevision",
      1,
    );
    const [lifecycle] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO time_trial_publication_lifecycle (
         time_trial_publication_id, sequence_number,
         time_trial_submission_revision_id, event_type,
         publication_status_after, publication_origin, reason_code,
         rank_at_publication, occurred_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        result.insertId,
        sequence,
        revisionInternalId,
        published ? "revision_published" : "revision_withheld",
        publicationStatus,
        publicationOrigin,
        reasonCode,
        rankAtPublication ?? null,
        occurredAtMs,
      ],
    );
    this.requireSingleInsert(lifecycle, "Time Trial publication lifecycle");
    if (published) {
      await enqueueOvertakenNotificationJob(
        this.connection,
        result.insertId,
        sequence,
        occurredAtMs,
      );
    }
    if (playerInternalId !== null) {
      await refreshTimeTrialPlayerBestsForPlayers(
        this.connection,
        [playerInternalId],
      );
    }
  }

  // ---------------------------------------------------------------- ADR-0225 amendment

  public async findCarriedOriginal(original: TimeTrialCarriedOriginal): Promise<string | null> {
    if (original.originalSubmissionId === null) { return null; }
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT submission.public_id AS submissionId
       FROM time_trial_carried_originals AS carried
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = carried.time_trial_submission_id
       WHERE carried.carried_from_origin = ? AND carried.original_submission_id = ?
       LIMIT 1 FOR UPDATE`,
      [original.origin, original.originalSubmissionId],
    );
    const value = rows[0]?.["submissionId"];
    return typeof value === "string" ? value : null;
  }

  public async recordCarriedRun(
    original: TimeTrialCarriedOriginal,
    submissionId: string,
    nowMs: number,
  ): Promise<void> {
    const submissionInternalId = await this.findInternalSubmissionId(submissionId);
    // A later revision of the same carried submission keeps the record of its first one.
    const [existing] = await this.connection.execute<RowDataPacket[]>(
      `SELECT 1 AS present FROM time_trial_carried_originals
       WHERE time_trial_submission_id = ? AND disposition = 'run' LIMIT 1`,
      [submissionInternalId],
    );
    if (existing.length > 0) { return; }
    const [revisions] = await this.connection.execute<RowDataPacket[]>(
      `SELECT MAX(time_trial_submission_revision_id) AS revisionInternalId
       FROM time_trial_submission_revisions WHERE time_trial_submission_id = ?`,
      [submissionInternalId],
    );
    await this.insertCarriedOriginal(
      original, submissionInternalId,
      safeInteger(revisions[0]?.["revisionInternalId"], "carried revision id", 1),
      null, nowMs,
    );
  }

  public async findEqualActiveRunForUpdate(input: Readonly<{
    playerId: string; trackId: string; mode: 150 | 200; totalTimeMs: number; excludingSubmissionId: string;
  }>): Promise<TimeTrialEqualRun | null> {
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT submission.public_id AS submissionId,
              revision.time_trial_submission_revision_id AS revisionInternalId,
              revision.revision_number AS revisionNumber,
              revision.character_id AS characterId, revision.character_variant_id AS characterVariantId,
              revision.body_id AS bodyId, revision.body_variant_id AS bodyVariantId,
              revision.tire_id AS tireId, revision.glider_id AS gliderId,
              revision.glider_variant_id AS gliderVariantId
       FROM time_trial_publications AS publication
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = publication.time_trial_submission_id
       INNER JOIN time_trial_submission_revisions AS revision
         ON revision.time_trial_submission_revision_id = publication.current_revision_id
       INNER JOIN players AS player ON player.player_id = revision.player_id
       WHERE player.public_id = ? AND revision.track_id = ? AND revision.mode_cc = ?
         AND revision.total_time_ms = ? AND submission.retirement_state = 'active'
         AND submission.public_id <> ?
       ORDER BY submission.time_trial_submission_id ASC
       LIMIT 1 FOR UPDATE`,
      [input.playerId, input.trackId, input.mode, input.totalTimeMs, input.excludingSubmissionId],
    );
    const row = rows[0];
    if (row === undefined) { return null; }
    const loadout: Record<string, string> = {};
    for (const key of ["characterId", "characterVariantId", "bodyId", "bodyVariantId", "tireId", "gliderId", "gliderVariantId"]) {
      const value = row[key];
      if (typeof value === "string" && value.length > 0) { loadout[key] = value; }
    }
    const [lapRows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT lap_number AS lapNumber, time_ms AS timeMs, coins_collected AS coinsCollected,
              mushrooms_used AS mushroomsUsed, confidence
       FROM time_trial_laps WHERE time_trial_submission_revision_id = ? ORDER BY lap_number ASC`,
      [safeInteger(row["revisionInternalId"], "revision id", 1)],
    );
    const laps: TimeTrialLap[] = lapRows.map((lap) => ({
      lapNumber: safeInteger(lap["lapNumber"], "lap number", 1),
      timeMs: safeInteger(lap["timeMs"], "lap time", 1),
      ...(lap["coinsCollected"] === null ? {} : { coinsCollected: safeInteger(lap["coinsCollected"], "coins", 0) }),
      ...(lap["mushroomsUsed"] === null ? {} : { mushroomsUsed: safeInteger(lap["mushroomsUsed"], "mushrooms", 0) }),
      ...(lap["confidence"] === null || lap["confidence"] === undefined ? {} : { confidence: Number(lap["confidence"]) }),
    }));
    return {
      submissionId: String(row["submissionId"]),
      revision: safeInteger(row["revisionNumber"], "revision", 1),
      loadout: loadout as TimeTrialLoadout,
      laps,
    };
  }

  /**
   * The filled revision (N -> N+1) of the equal run: the current revision copied with its empty
   * fields filled, the publication moved to it with its status, origin, reason and rank unchanged
   * (the time is the same), the Player's bests refreshed, an "enriched" lifecycle event under the
   * sending account and the carried original recorded against the new revision.
   */
  public async fillEqualRun(input: Readonly<{
    run: TimeTrialEqualRun;
    plan: TimeTrialCarriedFillPlan;
    original: TimeTrialCarriedOriginal;
    actorUserAccountId: string;
  }>): Promise<number> {
    const nowMs = this.clock.nowMs();
    const [current] = await this.connection.execute<RowDataPacket[]>(
      `SELECT submission.time_trial_submission_id AS submissionInternalId,
              publication.time_trial_publication_id AS publicationInternalId,
              publication.current_revision_id AS revisionInternalId,
              publication.publication_status AS publicationStatus,
              publication.publication_origin AS publicationOrigin,
              publication.reason_code AS reasonCode,
              publication.rank_at_publication AS rankAtPublication,
              revision.revision_number AS revisionNumber,
              (SELECT MAX(latest.revision_number) FROM time_trial_submission_revisions AS latest
                WHERE latest.time_trial_submission_id = submission.time_trial_submission_id) AS latestRevision
       FROM time_trial_submissions AS submission
       INNER JOIN time_trial_publications AS publication
         ON publication.time_trial_submission_id = submission.time_trial_submission_id
       INNER JOIN time_trial_submission_revisions AS revision
         ON revision.time_trial_submission_revision_id = publication.current_revision_id
       WHERE submission.public_id = ? AND submission.retirement_state = 'active'
       LIMIT 1 FOR UPDATE`,
      [input.run.submissionId],
    );
    const row = current[0];
    if (row === undefined || safeInteger(row["revisionNumber"], "revision", 1) !== input.run.revision) {
      throw new TimeTrialSubmissionError("revision_conflict", "the equal run changed meanwhile");
    }
    const submissionInternalId = safeInteger(row["submissionInternalId"], "submission id", 1);
    const previousRevisionId = safeInteger(row["revisionInternalId"], "revision id", 1);
    const nextRevision = safeInteger(row["latestRevision"], "latest revision", 1) + 1;
    const loadout = input.plan.loadout;
    const [inserted] = await this.connection.execute<ResultSetHeader>(
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
           track_id, total_time_ms, participant_reference_kind, player_id,
           observed_player_name, ?, ?, ?, ?, ?, ?, ?, country_id,
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
         WHERE time_trial_submission_revision_id = ?`,
      [
        nextRevision,
        loadout.characterId ?? null, loadout.characterVariantId ?? null, loadout.bodyId ?? null,
        loadout.bodyVariantId ?? null, loadout.tireId ?? null, loadout.gliderId ?? null,
        loadout.gliderVariantId ?? null,
        nowMs, previousRevisionId,
      ],
    );
    this.requireSingleInsert(inserted, "filled Time Trial revision");
    const revisionInternalId = inserted.insertId;
    await this.connection.execute(
      `INSERT INTO time_trial_submission_capture_layouts (time_trial_submission_revision_id, capture_layout)
       SELECT ?, capture_layout FROM time_trial_submission_capture_layouts
       WHERE time_trial_submission_revision_id = ?`,
      [revisionInternalId, previousRevisionId],
    );
    for (const lap of input.plan.laps) {
      const [lapResult] = await this.connection.execute<ResultSetHeader>(
        `INSERT INTO time_trial_laps (
           time_trial_submission_revision_id, lap_number, time_ms,
           coins_collected, mushrooms_used, confidence
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          revisionInternalId, lap.lapNumber, lap.timeMs,
          lap.coinsCollected ?? null, lap.mushroomsUsed ?? null, lap.confidence ?? null,
        ],
      );
      this.requireSingleInsert(lapResult, "filled Time Trial lap");
    }
    // The publication follows the new revision; its status, origin, reason and rank stay: the time
    // and every ranking are the same.
    const publicationInternalId = safeInteger(row["publicationInternalId"], "publication id", 1);
    await this.connection.execute(
      `UPDATE time_trial_publications
       SET current_revision_id = ?, publication_revision = publication_revision + 1, updated_at_ms = ?
       WHERE time_trial_publication_id = ?`,
      [revisionInternalId, nowMs, publicationInternalId],
    );
    const [publication] = await this.connection.execute<PublicationRevisionRow[]>(
      `SELECT publication_revision AS publicationRevision FROM time_trial_publications
       WHERE time_trial_publication_id = ? LIMIT 1 FOR UPDATE`,
      [publicationInternalId],
    );
    const published = row["publicationStatus"] === "published";
    await this.connection.execute(
      `INSERT INTO time_trial_publication_lifecycle (
         time_trial_publication_id, sequence_number, time_trial_submission_revision_id, event_type,
         publication_status_after, publication_origin, reason_code, rank_at_publication, occurred_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        publicationInternalId,
        safeInteger(publication[0]?.publicationRevision, "publication revision", 1),
        revisionInternalId,
        published ? "revision_published" : "revision_withheld",
        published ? "published" : "withheld",
        row["publicationOrigin"], row["reasonCode"],
        published ? row["rankAtPublication"] ?? null : null,
        nowMs,
      ],
    );
    await refreshTimeTrialPlayerBestsForRevisions(this.connection, [revisionInternalId]);
    const [accounts] = await this.connection.execute<InternalIdRow[]>(
      "SELECT user_account_id AS internalId FROM user_accounts WHERE public_id = ? LIMIT 1",
      [input.actorUserAccountId],
    );
    const account = singleRow(accounts, "carrying account");
    if (account === null) {
      throw new TimeTrialSubmissionError("invalid_submission", "the carrying account was not found");
    }
    await this.connection.execute(
      `INSERT INTO time_trial_lifecycle_events (
         time_trial_submission_id, sequence_number, event_type,
         retirement_state_after, time_trial_submission_revision_id,
         actor_role, actor_user_account_id, reason_code, note, occurred_at_ms
       ) SELECT ?, COALESCE(MAX(sequence_number), 0) + 1, 'enriched', 'active', ?, 'owner', ?,
                'carried_fill', NULL, ?
         FROM time_trial_lifecycle_events WHERE time_trial_submission_id = ?`,
      [
        submissionInternalId, revisionInternalId,
        safeInteger(account.internalId, "account id", 1), nowMs, submissionInternalId,
      ],
    );
    await this.insertCarriedOriginal(
      input.original, submissionInternalId, revisionInternalId,
      JSON.stringify(input.plan.filledFields), nowMs,
    );
    return nextRevision;
  }

  private async insertCarriedOriginal(
    original: TimeTrialCarriedOriginal,
    submissionInternalId: number,
    revisionInternalId: number,
    filledFieldsJson: string | null,
    nowMs: number,
  ): Promise<void> {
    try {
      await this.connection.execute(
        `INSERT INTO time_trial_carried_originals (
           carried_from_origin, original_submission_id, time_trial_submission_id,
           time_trial_submission_revision_id, disposition, filled_fields_json, created_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          original.origin, original.originalSubmissionId, submissionInternalId, revisionInternalId,
          filledFieldsJson === null ? "run" : "fill", filledFieldsJson, nowMs,
        ],
      );
    } catch (error) {
      // The unique key on (origin, original id): another request carried the same original meanwhile.
      if (isDuplicateKeyError(error)) {
        throw new TimeTrialSubmissionError("carried_duplicate", "This time was already carried here.");
      }
      throw error;
    }
  }

  private async findInternalSubmissionId(submissionId: string): Promise<number> {
    const [rows] = await this.connection.execute<InternalIdRow[]>(
      `SELECT time_trial_submission_id AS internalId
       FROM time_trial_submissions WHERE public_id = ? LIMIT 1 FOR UPDATE`,
      [submissionId],
    );
    const row = singleRow(rows, "Time Trial submission internal ID");
    if (row === null) {
      throw new TimeTrialPersistenceError("Time Trial submission was lost");
    }
    return safeInteger(row.internalId, "TimeTrialSubmission.internalId", 1);
  }

  private async findInternalPlayerId(playerId: string): Promise<number> {
    const [rows] = await this.connection.execute<InternalIdRow[]>(
      `SELECT player_id AS internalId
       FROM players
       WHERE public_id = ? AND player_kind = 'human' AND record_status = 'active'
       LIMIT 1 FOR UPDATE`,
      [playerId],
    );
    const row = singleRow(rows, "active human Player internal ID");
    if (row === null) {
      throw new TimeTrialSubmissionError("player_not_found", "active Player was not found");
    }
    return safeInteger(row.internalId, "Player.internalId", 1);
  }

  private requireSingleInsert(result: ResultSetHeader, resource: string): void {
    if (result.affectedRows !== 1) {
      throw new TimeTrialPersistenceError(`${resource} was not inserted`);
    }
  }
}

export class MysqlTimeTrialWriteRepository implements TimeTrialWriteRepository {
  public constructor(
    private readonly pool: Pool,
    private readonly clock: Readonly<{ nowMs(): number }> = { nowMs: () => Date.now() },
  ) {}

  public async transaction<T>(
    work: (transaction: TimeTrialWriteTransaction) => Promise<T>,
  ): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(new MysqlTimeTrialWriteTransaction(
        connection,
        this.clock,
      ));
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      if (isDuplicateKeyError(error)) {
        throw new TimeTrialSubmissionError(
          "revision_conflict",
          "submission or revision was occupied concurrently",
        );
      }
      throw error;
    } finally {
      connection.release();
    }
  }
}
