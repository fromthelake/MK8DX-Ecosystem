import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";

import type {
  AuditedStoredTimeTrialRevision,
  StoredTimeTrialEvidence,
  StoredTimeTrialParticipant,
  TimeTrialRevisionReadRepository,
  TimeTrialRevisionReadRequest,
} from "./revision-read-service.js";
import type {
  TimeTrialLap,
  TimeTrialLoadout,
  TimeTrialCorrectedField,
  TimeTrialSubmissionV1,
  TimeTrialVerification,
} from "./submission-service.js";
import { timeTrialCorrectedFields } from "./submission-service.js";

interface RevisionRow extends RowDataPacket {
  revisionInternalId: unknown; schemaVersion: unknown; submissionId: unknown;
  revision: unknown; mode: unknown; trackId: unknown; totalTimeMs: unknown;
  participantKind: unknown; playerId: unknown; observedPlayerName: unknown;
  characterId: unknown; characterVariantId: unknown; bodyId: unknown;
  bodyVariantId: unknown; tireId: unknown; gliderId: unknown;
  gliderVariantId: unknown; countryId: unknown; sourceKind: unknown;
  captureLayout: unknown;
  producerVersion: unknown; localRecordId: unknown; occurredAtMs: unknown;
  capturedAtMs: unknown; createdAtMs: unknown; submittedAtMs: unknown;
  verificationStatus: unknown; verificationMethod: unknown;
  correctedFieldsJson: unknown;
  lapSumMatches: unknown; verificationConfidence: unknown;
  confidenceTotalTime: unknown; confidenceTrack: unknown;
  confidenceCharacter: unknown; confidenceCharacterVariant: unknown;
  confidenceBody: unknown; confidenceTire: unknown; confidenceGlider: unknown;
  confidenceCountry: unknown; confidencePlayerName: unknown;
}

interface LapRow extends RowDataPacket {
  lapNumber: unknown; timeMs: unknown; coinsCollected: unknown;
  mushroomsUsed: unknown; confidence: unknown;
}

interface ParticipantRow extends RowDataPacket {
  resourceId: unknown; namespace: unknown; ciphertext: unknown;
  encryptionKeyVersion: unknown;
}

interface EvidenceRow extends RowDataPacket {
  resourceId: unknown; sequenceNumber: unknown; kind: unknown; ciphertext: unknown;
  encryptionKeyVersion: unknown; sha256: unknown; mediaType: unknown;
}

export class TimeTrialReadPersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TimeTrialReadPersistenceError";
  }
}

function integer(value: unknown, field: string, minimum = 0): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new TimeTrialReadPersistenceError(`${field} has an invalid persisted value`);
  }
  return parsed;
}

function decimal(value: unknown, field: string): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new TimeTrialReadPersistenceError(`${field} has an invalid persisted value`);
  }
  return parsed;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TimeTrialReadPersistenceError(`${field} has an invalid persisted value`);
  }
  return value;
}

function optionalText(value: unknown, field: string): string | undefined {
  return value === null ? undefined : text(value, field);
}

function correctedFields(value: unknown): TimeTrialVerification["correctedFields"] {
  if (value === null) { return undefined; }
  let parsed: unknown = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch {
      throw new TimeTrialReadPersistenceError(
        "verification.correctedFields has an invalid persisted value",
      );
    }
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 15 ||
      new Set(parsed).size !== parsed.length ||
      parsed.some((field) => typeof field !== "string" ||
        !timeTrialCorrectedFields.has(field as TimeTrialCorrectedField))) {
    throw new TimeTrialReadPersistenceError(
      "verification.correctedFields has an invalid persisted value",
    );
  }
  return parsed as TimeTrialVerification["correctedFields"];
}

function bytes(value: unknown, field: string): Uint8Array {
  if (!Buffer.isBuffer(value) || value.length === 0) {
    throw new TimeTrialReadPersistenceError(`${field} has an invalid persisted value`);
  }
  return Uint8Array.from(value);
}

function optionalBytes(value: unknown, field: string): Uint8Array | undefined {
  return value === null ? undefined : bytes(value, field);
}

function one<T>(rows: T[], resource: string): T | null {
  if (rows.length === 0) { return null; }
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new TimeTrialReadPersistenceError(`${resource} returned an invalid row count`);
  }
  return rows[0];
}

function optionalObject<T extends object>(value: T): T | undefined {
  return Object.keys(value).length === 0 ? undefined : value;
}

function mapLap(row: LapRow): TimeTrialLap {
  return {
    lapNumber: integer(row.lapNumber, "lapNumber", 1),
    timeMs: integer(row.timeMs, "lap.timeMs", 1),
    ...(row.coinsCollected === null ? {} : {
      coinsCollected: integer(row.coinsCollected, "lap.coinsCollected"),
    }),
    ...(row.mushroomsUsed === null ? {} : {
      mushroomsUsed: integer(row.mushroomsUsed, "lap.mushroomsUsed"),
    }),
    ...(row.confidence === null ? {} : {
      confidence: decimal(row.confidence, "lap.confidence"),
    }),
  };
}

function mapPublicFields(row: RevisionRow, laps: readonly TimeTrialLap[]):
Omit<TimeTrialSubmissionV1, "playerReference" | "evidence"> {
  const loadout = optionalObject<TimeTrialLoadout>({
    ...(row.characterId === null ? {} : { characterId: text(row.characterId, "characterId") }),
    ...(row.characterVariantId === null ? {} : {
      characterVariantId: text(row.characterVariantId, "characterVariantId"),
    }),
    ...(row.bodyId === null ? {} : { bodyId: text(row.bodyId, "bodyId") }),
    ...(row.bodyVariantId === null ? {} : {
      bodyVariantId: text(row.bodyVariantId, "bodyVariantId"),
    }),
    ...(row.tireId === null ? {} : { tireId: text(row.tireId, "tireId") }),
    ...(row.gliderId === null ? {} : { gliderId: text(row.gliderId, "gliderId") }),
    ...(row.gliderVariantId === null ? {} : {
      gliderVariantId: text(row.gliderVariantId, "gliderVariantId"),
    }),
  });
  const confidence = optionalObject<NonNullable<TimeTrialVerification["fieldConfidence"]>>({
    ...(row.confidenceTotalTime === null ? {} : {
      totalTime: decimal(row.confidenceTotalTime, "confidence.totalTime"),
    }),
    ...(row.confidenceTrack === null ? {} : {
      track: decimal(row.confidenceTrack, "confidence.track"),
    }),
    ...(row.confidenceCharacter === null ? {} : {
      character: decimal(row.confidenceCharacter, "confidence.character"),
    }),
    ...(row.confidenceCharacterVariant === null ? {} : {
      characterVariant: decimal(
        row.confidenceCharacterVariant,
        "confidence.characterVariant",
      ),
    }),
    ...(row.confidenceBody === null ? {} : {
      body: decimal(row.confidenceBody, "confidence.body"),
    }),
    ...(row.confidenceTire === null ? {} : {
      tire: decimal(row.confidenceTire, "confidence.tire"),
    }),
    ...(row.confidenceGlider === null ? {} : {
      glider: decimal(row.confidenceGlider, "confidence.glider"),
    }),
    ...(row.confidenceCountry === null ? {} : {
      country: decimal(row.confidenceCountry, "confidence.country"),
    }),
    ...(row.confidencePlayerName === null ? {} : {
      playerName: decimal(row.confidencePlayerName, "confidence.playerName"),
    }),
  });
  const verification: TimeTrialVerification | undefined = row.verificationStatus === null
    ? undefined
    : (() => {
        const corrections = correctedFields(row.correctedFieldsJson);
        return {
        status: text(row.verificationStatus, "verification.status") as
          TimeTrialVerification["status"],
        ...(row.verificationMethod === null ? {} : {
          method: text(row.verificationMethod, "verification.method"),
        }),
        ...(corrections === undefined ? {} : { correctedFields: corrections }),
        ...(row.lapSumMatches === null ? {} : {
          lapSumMatches: integer(row.lapSumMatches, "verification.lapSumMatches") === 1,
        }),
        ...(row.verificationConfidence === null ? {} : {
          confidence: decimal(row.verificationConfidence, "verification.confidence"),
        }),
        ...(confidence === undefined ? {} : { fieldConfidence: confidence }),
      };
    })();
  return {
    schemaVersion: text(row.schemaVersion, "schemaVersion") as
      TimeTrialSubmissionV1["schemaVersion"],
    submissionId: text(row.submissionId, "submissionId"),
    revision: integer(row.revision, "revision", 1),
    mode: integer(row.mode, "mode", 1) as 150 | 200,
    trackId: text(row.trackId, "trackId"),
    totalTimeMs: integer(row.totalTimeMs, "totalTimeMs", 1),
    laps,
    ...(loadout === undefined ? {} : { loadout }),
    ...(row.countryId === null ? {} : { countryId: text(row.countryId, "countryId") }),
    ...(row.observedPlayerName === null ? {} : {
      observedPlayerName: text(row.observedPlayerName, "observedPlayerName"),
    }),
    source: {
      kind: text(row.sourceKind, "source.kind") as TimeTrialSubmissionV1["source"]["kind"],
      ...(row.captureLayout === null || row.captureLayout === undefined ? {} : {
        captureLayout: text(row.captureLayout, "source.captureLayout") as
          NonNullable<TimeTrialSubmissionV1["source"]["captureLayout"]>,
      }),
      ...(row.producerVersion === null ? {} : {
        producerVersion: text(row.producerVersion, "source.producerVersion"),
      }),
      ...(row.localRecordId === null ? {} : {
        localRecordId: text(row.localRecordId, "source.localRecordId"),
      }),
    },
    timestamps: {
      ...(row.occurredAtMs === null ? {} : {
        occurredAtMs: integer(row.occurredAtMs, "timestamps.occurredAtMs"),
      }),
      ...(row.capturedAtMs === null ? {} : {
        capturedAtMs: integer(row.capturedAtMs, "timestamps.capturedAtMs"),
      }),
      createdAtMs: integer(row.createdAtMs, "timestamps.createdAtMs"),
      ...(row.submittedAtMs === null ? {} : {
        submittedAtMs: integer(row.submittedAtMs, "timestamps.submittedAtMs"),
      }),
    },
    ...(verification === undefined ? {} : { verification }),
  };
}

export class MysqlTimeTrialReadRepository implements TimeTrialRevisionReadRepository {
  public constructor(private readonly pool: Pool) {}

  public async findRevisionAndAudit(
    request: TimeTrialRevisionReadRequest,
  ): Promise<AuditedStoredTimeTrialRevision | null> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const revision = await this.findRevision(connection, request);
      if (revision === null) {
        await connection.commit();
        return null;
      }
      const revisionInternalId = integer(
        revision.revisionInternalId,
        "revisionInternalId",
        1,
      );
      const [lapRows] = await connection.execute<LapRow[]>(
        `SELECT lap_number AS lapNumber, time_ms AS timeMs,
                coins_collected AS coinsCollected, mushrooms_used AS mushroomsUsed,
                confidence
         FROM time_trial_laps
         WHERE time_trial_submission_revision_id = ?
         ORDER BY lap_number LOCK IN SHARE MODE`,
        [revisionInternalId],
      );
      const [participantRows] = await connection.execute<ParticipantRow[]>(
        `SELECT time_trial_participant_reference_id AS resourceId,
                reference_namespace AS namespace,
                reference_ciphertext AS ciphertext,
                encryption_key_version AS encryptionKeyVersion
         FROM restricted_time_trial_participant_references
         WHERE time_trial_submission_revision_id = ?
         LIMIT 2 LOCK IN SHARE MODE`,
        [revisionInternalId],
      );
      const [evidenceRows] = await connection.execute<EvidenceRow[]>(
        `SELECT time_trial_evidence_id AS resourceId, sequence_number AS sequenceNumber,
                evidence_kind AS kind, reference_ciphertext AS ciphertext,
                encryption_key_version AS encryptionKeyVersion, sha256, media_type AS mediaType
         FROM restricted_time_trial_evidence
         WHERE time_trial_submission_revision_id = ?
         ORDER BY sequence_number LOCK IN SHARE MODE`,
        [revisionInternalId],
      );
      const participantRow = one(participantRows, "restricted participant");
      const participant = participantRow === null ? null : this.mapParticipant(participantRow);
      const evidence = evidenceRows.map((row) => this.mapEvidence(row));
      if ((text(revision.participantKind, "participantKind") === "player") !==
        (participant === null)) {
        throw new TimeTrialReadPersistenceError("participant row shape is inconsistent");
      }
      if (participantRow !== null) {
        await this.audit(connection, "time_trial_participant_reference", {
          participantId: integer(participantRow.resourceId, "participant.resourceId", 1),
        }, request);
      }
      for (const row of evidenceRows) {
        await this.audit(connection, "time_trial_evidence", {
          evidenceId: integer(row.resourceId, "evidence.resourceId", 1),
        }, request);
      }
      await connection.commit();
      return {
        publicFields: mapPublicFields(revision, lapRows.map(mapLap)),
        playerId: revision.playerId === null ? null : text(revision.playerId, "playerId"),
        restrictedParticipant: participant,
        protectedEvidence: evidence,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async findRevision(
    connection: PoolConnection,
    request: TimeTrialRevisionReadRequest,
  ): Promise<RevisionRow | null> {
    const [rows] = await connection.execute<RevisionRow[]>(
      `SELECT r.time_trial_submission_revision_id AS revisionInternalId,
              r.schema_version AS schemaVersion, s.public_id AS submissionId,
              r.revision_number AS revision, r.mode_cc AS mode, r.track_id AS trackId,
              r.total_time_ms AS totalTimeMs,
              r.participant_reference_kind AS participantKind, p.public_id AS playerId,
              r.observed_player_name AS observedPlayerName,
              r.character_id AS characterId, r.character_variant_id AS characterVariantId,
              r.body_id AS bodyId, r.body_variant_id AS bodyVariantId,
              r.tire_id AS tireId, r.glider_id AS gliderId,
              r.glider_variant_id AS gliderVariantId, r.country_id AS countryId,
              r.source_kind AS sourceKind, r.producer_version AS producerVersion,
              cl.capture_layout AS captureLayout,
              r.local_record_id AS localRecordId, r.occurred_at_ms AS occurredAtMs,
              r.captured_at_ms AS capturedAtMs, r.created_at_ms AS createdAtMs,
              r.submitted_at_ms AS submittedAtMs,
              r.verification_status AS verificationStatus,
              r.verification_method AS verificationMethod,
              r.corrected_fields_json AS correctedFieldsJson,
              r.verification_lap_sum_matches AS lapSumMatches,
              r.verification_confidence AS verificationConfidence,
              r.confidence_total_time AS confidenceTotalTime,
              r.confidence_track AS confidenceTrack,
              r.confidence_character AS confidenceCharacter,
              r.confidence_character_variant AS confidenceCharacterVariant,
              r.confidence_body AS confidenceBody, r.confidence_tire AS confidenceTire,
              r.confidence_glider AS confidenceGlider,
              r.confidence_country AS confidenceCountry,
              r.confidence_player_name AS confidencePlayerName
       FROM time_trial_submission_revisions AS r
       INNER JOIN time_trial_submissions AS s
         ON s.time_trial_submission_id = r.time_trial_submission_id
       LEFT JOIN players AS p ON p.player_id = r.player_id
       LEFT JOIN time_trial_submission_capture_layouts AS cl
         ON cl.time_trial_submission_revision_id = r.time_trial_submission_revision_id
       WHERE s.public_id = ? AND r.revision_number = ?
       LIMIT 2 LOCK IN SHARE MODE`,
      [request.submissionId, request.revision],
    );
    return one(rows, "Time Trial revision");
  }

  private mapParticipant(row: ParticipantRow): StoredTimeTrialParticipant {
    return {
      namespace: text(row.namespace, "participant.namespace") as
        StoredTimeTrialParticipant["namespace"],
      protectedValue: {
        ciphertext: bytes(row.ciphertext, "participant.ciphertext"),
        encryptionKeyVersion: text(
          row.encryptionKeyVersion,
          "participant.encryptionKeyVersion",
        ),
      },
    };
  }

  private mapEvidence(row: EvidenceRow): StoredTimeTrialEvidence {
    return {
      sequenceNumber: integer(row.sequenceNumber, "evidence.sequenceNumber", 1),
      kind: text(row.kind, "evidence.kind") as StoredTimeTrialEvidence["kind"],
      protectedReference: {
        ciphertext: bytes(row.ciphertext, "evidence.ciphertext"),
        encryptionKeyVersion: text(
          row.encryptionKeyVersion,
          "evidence.encryptionKeyVersion",
        ),
      },
      ...(row.sha256 === null ? {} : { sha256: optionalBytes(row.sha256, "evidence.sha256")! }),
      ...(row.mediaType === null ? {} : { mediaType: optionalText(row.mediaType, "evidence.mediaType")! }),
    };
  }

  private async audit(
    connection: PoolConnection,
    resourceType: "time_trial_participant_reference" | "time_trial_evidence",
    resource: Readonly<{ participantId?: number; evidenceId?: number }>,
    request: TimeTrialRevisionReadRequest,
  ): Promise<void> {
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO restricted_identity_access_log (
         resource_type, claim_evidence_id, claim_review_id, legacy_identifier_id,
         authentication_binding_id, time_trial_participant_reference_id,
         time_trial_evidence_id, tournament_restricted_data_id,
         accessor_type, accessor_reference, purpose_code, accessed_at_ms
       ) VALUES (?, NULL, NULL, NULL, NULL, ?, ?, NULL,
                 'administrator', ?, ?, ?)`,
      [
        resourceType,
        resource.participantId ?? null,
        resource.evidenceId ?? null,
        request.accessorUserAccountId,
        request.purposeCode,
        request.accessedAtMs,
      ],
    );
    if (result.affectedRows !== 1) {
      throw new TimeTrialReadPersistenceError("restricted access audit was not appended");
    }
  }
}
