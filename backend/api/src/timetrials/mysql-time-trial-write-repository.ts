import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";

import {
  TimeTrialSubmissionError,
  type TimeTrialRevisionPersistenceInput,
  type TimeTrialSubmissionState,
  type TimeTrialWriteRepository,
  type TimeTrialWriteTransaction,
} from "./submission-service.js";
import { publicationRankSnapshots } from "./publication-rank-snapshot.js";
import { refreshTimeTrialPlayerBestsForPlayers } from
  "./time-trial-player-bests.js";
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
         confidence_player_name
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
