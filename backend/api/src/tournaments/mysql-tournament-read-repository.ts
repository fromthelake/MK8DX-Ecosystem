import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";

import type {
  AuditedStoredTournamentRevision,
  StoredTournamentContext,
  StoredTournamentEvidence,
  StoredTournamentIssue,
  StoredTournamentPlacement,
  TournamentRevisionReadRepository,
  TournamentRevisionReadRequest,
} from "./race-result-read-service.js";
import type { TournamentProtectedValue, TournamentPublicRevision } from
  "./race-result-service.js";
import type {
  TournamentPlacement,
  TournamentRaceResultV1,
  TournamentVerification,
} from "./race-result-validation.js";
import { isTournamentRaceMode } from "./race-result-validation.js";

interface RevisionRow extends RowDataPacket {
  revisionInternalId: unknown; schemaVersion: unknown; raceResultId: unknown;
  revision: unknown; raceNumber: unknown; scoringSegment: unknown; mode: unknown; mirror: unknown;
  trackId: unknown; countsTowardStandings: unknown; scoringNote: unknown;
  observedStageLabel: unknown; observedGroupLabel: unknown; sourceKind: unknown;
  sourceTransport: unknown; producerVersion: unknown; localRecordId: unknown;
  sessionId: unknown; streamId: unknown; sourceMediaId: unknown;
  raceOffsetMs: unknown; frameIndex: unknown; occurredAtMs: unknown;
  capturedAtMs: unknown; createdAtMs: unknown; submittedAtMs: unknown;
  verificationStatus: unknown; verificationMethod: unknown;
  verificationConfidence: unknown; confidenceTrack: unknown;
  confidencePlayerCount: unknown; confidenceFinishPositions: unknown;
  confidencePlayerNames: unknown; confidenceCharacters: unknown;
  confidenceRacePoints: unknown; confidenceTotalScores: unknown;
}

interface PlacementRow extends RowDataPacket {
  placementInternalId: unknown; finishPosition: unknown; participantKind: unknown;
  playerId: unknown; observedPlayerName: unknown; characterId: unknown;
  characterVariantId: unknown; racePoints: unknown; totalBeforeRace: unknown;
  totalAfterRace: unknown; rankAfterRace: unknown;
  confidenceFinishPosition: unknown; confidencePlayerName: unknown;
  confidenceCharacter: unknown; confidenceRacePoints: unknown;
  confidenceTotalAfterRace: unknown;
}

interface RestrictedRow extends RowDataPacket {
  resourceId: unknown; placementInternalId: unknown; dataKind: unknown;
  sequenceNumber: unknown; subtype: unknown; referenceNamespace: unknown;
  ciphertext: unknown; encryptionKeyVersion: unknown; sha256: unknown;
  mediaType: unknown;
}

type MappedRestricted =
  | Readonly<{ resourceId: number; kind: "participant"; placementInternalId: number;
      namespace: NonNullable<StoredTournamentPlacement["restrictedParticipant"]>["namespace"];
      protectedValue: TournamentProtectedValue }>
  | Readonly<{ resourceId: number; kind: "context"; value: StoredTournamentContext }>
  | Readonly<{ resourceId: number; kind: "evidence"; value: StoredTournamentEvidence }>
  | Readonly<{ resourceId: number; kind: "issue"; value: StoredTournamentIssue }>;

export class TournamentReadPersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TournamentReadPersistenceError";
  }
}

function integer(value: unknown, field: string, minimum = 0): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new TournamentReadPersistenceError(`${field} has an invalid persisted value`);
  }
  return parsed;
}

function decimal(value: unknown, field: string): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new TournamentReadPersistenceError(`${field} has an invalid persisted value`);
  }
  return parsed;
}

function booleanValue(value: unknown, field: string): boolean {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (parsed !== 0 && parsed !== 1 && parsed !== false && parsed !== true) {
    throw new TournamentReadPersistenceError(`${field} has an invalid persisted value`);
  }
  return parsed === 1 || parsed === true;
}

function raceMode(value: unknown): NonNullable<TournamentRaceResultV1["mode"]> {
  const parsed = integer(value, "mode", 1);
  if (!isTournamentRaceMode(parsed)) {
    throw new TournamentReadPersistenceError("mode has an invalid persisted value");
  }
  return parsed;
}

function mirrorFlag(value: unknown): true {
  if (!booleanValue(value, "mirror")) {
    throw new TournamentReadPersistenceError("mirror has an invalid persisted value");
  }
  return true;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TournamentReadPersistenceError(`${field} has an invalid persisted value`);
  }
  return value;
}

function optionalText(value: unknown, field: string): string | undefined {
  return value === null ? undefined : text(value, field);
}

function bytes(value: unknown, field: string): Uint8Array {
  if (!Buffer.isBuffer(value) || value.length === 0) {
    throw new TournamentReadPersistenceError(`${field} has an invalid persisted value`);
  }
  return Uint8Array.from(value);
}

function optionalBytes(value: unknown, field: string): Uint8Array | undefined {
  return value === null ? undefined : bytes(value, field);
}

function one<T>(rows: T[], resource: string): T | null {
  if (rows.length === 0) { return null; }
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new TournamentReadPersistenceError(`${resource} returned an invalid row count`);
  }
  return rows[0];
}

function optionalObject<T extends object>(value: T): T | undefined {
  return Object.keys(value).length === 0 ? undefined : value;
}

function mapPublicRevision(row: RevisionRow): TournamentPublicRevision {
  const fieldConfidence = optionalObject<
    NonNullable<TournamentVerification["fieldConfidence"]>
  >({
    ...(row.confidenceTrack === null ? {} : {
      track: decimal(row.confidenceTrack, "verification.fieldConfidence.track"),
    }),
    ...(row.confidencePlayerCount === null ? {} : {
      playerCount: decimal(
        row.confidencePlayerCount,
        "verification.fieldConfidence.playerCount",
      ),
    }),
    ...(row.confidenceFinishPositions === null ? {} : {
      finishPositions: decimal(
        row.confidenceFinishPositions,
        "verification.fieldConfidence.finishPositions",
      ),
    }),
    ...(row.confidencePlayerNames === null ? {} : {
      playerNames: decimal(
        row.confidencePlayerNames,
        "verification.fieldConfidence.playerNames",
      ),
    }),
    ...(row.confidenceCharacters === null ? {} : {
      characters: decimal(
        row.confidenceCharacters,
        "verification.fieldConfidence.characters",
      ),
    }),
    ...(row.confidenceRacePoints === null ? {} : {
      racePoints: decimal(
        row.confidenceRacePoints,
        "verification.fieldConfidence.racePoints",
      ),
    }),
    ...(row.confidenceTotalScores === null ? {} : {
      totalScores: decimal(
        row.confidenceTotalScores,
        "verification.fieldConfidence.totalScores",
      ),
    }),
  });
  const verification: Omit<TournamentVerification, "issues"> | undefined =
    row.verificationStatus === null ? undefined : {
      status: text(row.verificationStatus, "verification.status") as
        TournamentVerification["status"],
      ...(row.verificationMethod === null ? {} : {
        method: text(row.verificationMethod, "verification.method"),
      }),
      ...(row.verificationConfidence === null ? {} : {
        confidence: decimal(row.verificationConfidence, "verification.confidence"),
      }),
      ...(fieldConfidence === undefined ? {} : { fieldConfidence }),
    };
  return {
    schemaVersion: text(row.schemaVersion, "schemaVersion") as
      TournamentRaceResultV1["schemaVersion"],
    raceResultId: text(row.raceResultId, "raceResultId"),
    revision: integer(row.revision, "revision", 1),
    raceNumber: integer(row.raceNumber, "raceNumber", 1),
    scoringSegment: integer(row.scoringSegment, "scoringSegment", 1),
    ...(row.mode === null ? {} : { mode: raceMode(row.mode) }),
    ...(row.mirror === null || row.mirror === undefined ? {} : { mirror: mirrorFlag(row.mirror) }),
    trackId: text(row.trackId, "trackId"),
    countsTowardStandings: booleanValue(
      row.countsTowardStandings,
      "countsTowardStandings",
    ),
    ...(row.scoringNote === null ? {} : { scoringNote: text(row.scoringNote, "scoringNote") }),
    ...(row.observedStageLabel === null ? {} : {
      observedStageLabel: text(row.observedStageLabel, "observedStageLabel"),
    }),
    ...(row.observedGroupLabel === null ? {} : {
      observedGroupLabel: text(row.observedGroupLabel, "observedGroupLabel"),
    }),
    source: {
      kind: text(row.sourceKind, "source.kind") as TournamentRaceResultV1["source"]["kind"],
      ...(row.sourceTransport === null ? {} : {
        transport: text(row.sourceTransport, "source.transport") as
          NonNullable<TournamentRaceResultV1["source"]["transport"]>,
      }),
      ...(row.producerVersion === null ? {} : {
        producerVersion: text(row.producerVersion, "source.producerVersion"),
      }),
      ...(row.localRecordId === null ? {} : {
        localRecordId: text(row.localRecordId, "source.localRecordId"),
      }),
      ...(row.sessionId === null ? {} : { sessionId: text(row.sessionId, "source.sessionId") }),
      ...(row.streamId === null ? {} : { streamId: text(row.streamId, "source.streamId") }),
      ...(row.sourceMediaId === null ? {} : {
        sourceMediaId: text(row.sourceMediaId, "source.sourceMediaId"),
      }),
      ...(row.raceOffsetMs === null ? {} : {
        raceOffsetMs: integer(row.raceOffsetMs, "source.raceOffsetMs"),
      }),
      ...(row.frameIndex === null ? {} : {
        frameIndex: integer(row.frameIndex, "source.frameIndex"),
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

function placementPublicFields(row: PlacementRow): Omit<
  TournamentPlacement,
  "participantReference"
> {
  const confidence = optionalObject<NonNullable<TournamentPlacement["confidence"]>>({
    ...(row.confidenceFinishPosition === null ? {} : {
      finishPosition: decimal(row.confidenceFinishPosition, "placement.confidence.finishPosition"),
    }),
    ...(row.confidencePlayerName === null ? {} : {
      playerName: decimal(row.confidencePlayerName, "placement.confidence.playerName"),
    }),
    ...(row.confidenceCharacter === null ? {} : {
      character: decimal(row.confidenceCharacter, "placement.confidence.character"),
    }),
    ...(row.confidenceRacePoints === null ? {} : {
      racePoints: decimal(row.confidenceRacePoints, "placement.confidence.racePoints"),
    }),
    ...(row.confidenceTotalAfterRace === null ? {} : {
      totalAfterRace: decimal(
        row.confidenceTotalAfterRace,
        "placement.confidence.totalAfterRace",
      ),
    }),
  });
  return {
    finishPosition: integer(row.finishPosition, "placement.finishPosition", 1),
    ...(row.observedPlayerName === null ? {} : {
      observedPlayerName: text(row.observedPlayerName, "placement.observedPlayerName"),
    }),
    ...(row.characterId === null ? {} : {
      characterId: text(row.characterId, "placement.characterId"),
    }),
    ...(row.characterVariantId === null ? {} : {
      characterVariantId: text(row.characterVariantId, "placement.characterVariantId"),
    }),
    scoring: {
      racePoints: integer(row.racePoints, "placement.scoring.racePoints"),
      totalBeforeRace: integer(row.totalBeforeRace, "placement.scoring.totalBeforeRace"),
      totalAfterRace: integer(row.totalAfterRace, "placement.scoring.totalAfterRace"),
      rankAfterRace: integer(row.rankAfterRace, "placement.scoring.rankAfterRace", 1),
    },
    ...(confidence === undefined ? {} : { confidence }),
  };
}

export class MysqlTournamentReadRepository implements TournamentRevisionReadRepository {
  public constructor(private readonly pool: Pool) {}

  public async findRevisionAndAudit(
    request: TournamentRevisionReadRequest,
  ): Promise<AuditedStoredTournamentRevision | null> {
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
      const [placementRows] = await connection.execute<PlacementRow[]>(
        `SELECT placement.tournament_race_placement_id AS placementInternalId,
                placement.finish_position AS finishPosition,
                placement.participant_reference_kind AS participantKind,
                player.public_id AS playerId,
                placement.observed_player_name AS observedPlayerName,
                placement.character_id AS characterId,
                placement.character_variant_id AS characterVariantId,
                placement.race_points AS racePoints,
                placement.total_before_race AS totalBeforeRace,
                placement.total_after_race AS totalAfterRace,
                placement.rank_after_race AS rankAfterRace,
                placement.confidence_finish_position AS confidenceFinishPosition,
                placement.confidence_player_name AS confidencePlayerName,
                placement.confidence_character AS confidenceCharacter,
                placement.confidence_race_points AS confidenceRacePoints,
                placement.confidence_total_after_race AS confidenceTotalAfterRace
         FROM tournament_race_placements AS placement
         LEFT JOIN players AS player ON player.player_id = placement.player_id
         WHERE placement.tournament_race_result_revision_id = ?
         ORDER BY placement.finish_position LOCK IN SHARE MODE`,
        [revisionInternalId],
      );
      const [restrictedRows] = await connection.execute<RestrictedRow[]>(
        `SELECT tournament_restricted_data_id AS resourceId,
                tournament_race_placement_id AS placementInternalId,
                data_kind AS dataKind, sequence_number AS sequenceNumber,
                subtype, reference_namespace AS referenceNamespace,
                value_ciphertext AS ciphertext,
                encryption_key_version AS encryptionKeyVersion,
                sha256, media_type AS mediaType
         FROM restricted_tournament_race_data
         WHERE tournament_race_result_revision_id = ?
         ORDER BY data_kind, sequence_number, tournament_restricted_data_id
         LOCK IN SHARE MODE`,
        [revisionInternalId],
      );
      const restricted = restrictedRows.map((row) => this.mapRestricted(row));
      const participants = new Map<number, Extract<MappedRestricted, { kind: "participant" }>>();
      const protectedContext: StoredTournamentContext[] = [];
      const protectedEvidence: StoredTournamentEvidence[] = [];
      const protectedIssues: StoredTournamentIssue[] = [];
      for (const item of restricted) {
        if (item.kind === "participant") {
          if (participants.has(item.placementInternalId)) {
            throw new TournamentReadPersistenceError("participant row shape is inconsistent");
          }
          participants.set(item.placementInternalId, item);
        } else if (item.kind === "context") {
          protectedContext.push(item.value);
        } else if (item.kind === "evidence") {
          protectedEvidence.push(item.value);
        } else {
          protectedIssues.push(item.value);
        }
      }
      protectedEvidence.sort((left, right) => left.sequenceNumber - right.sequenceNumber);
      protectedIssues.sort((left, right) => left.sequenceNumber - right.sequenceNumber);

      const seenPlacements = new Set<number>();
      const placements = placementRows.map((row): StoredTournamentPlacement => {
        const placementInternalId = integer(
          row.placementInternalId,
          "placement.internalId",
          1,
        );
        if (seenPlacements.has(placementInternalId)) {
          throw new TournamentReadPersistenceError("placement row shape is inconsistent");
        }
        seenPlacements.add(placementInternalId);
        const participantKind = text(row.participantKind, "placement.participantKind");
        const participant = participants.get(placementInternalId) ?? null;
        const playerId = row.playerId === null ? null : text(row.playerId, "placement.playerId");
        if ((participantKind === "player" && (playerId === null || participant !== null)) ||
          (participantKind === "restricted_reference" &&
            (playerId !== null || participant === null)) ||
          (participantKind !== "player" && participantKind !== "restricted_reference")) {
          throw new TournamentReadPersistenceError("participant row shape is inconsistent");
        }
        if (participant !== null) { participants.delete(placementInternalId); }
        return {
          ...placementPublicFields(row),
          playerId,
          restrictedParticipant: participant === null ? null : {
            namespace: participant.namespace,
            protectedValue: participant.protectedValue,
          },
        };
      });
      if (participants.size !== 0) {
        throw new TournamentReadPersistenceError("participant row has no placement");
      }
      for (const item of restricted) {
        await this.audit(connection, item.resourceId, request);
      }
      await connection.commit();
      return {
        publicRevision: mapPublicRevision(revision),
        placements,
        protectedContext,
        protectedEvidence,
        protectedIssues,
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
    request: TournamentRevisionReadRequest,
  ): Promise<RevisionRow | null> {
    const [rows] = await connection.execute<RevisionRow[]>(
      `SELECT revision_record.tournament_race_result_revision_id AS revisionInternalId,
              revision_record.schema_version AS schemaVersion,
              result_record.public_id AS raceResultId,
              revision_record.revision_number AS revision,
              revision_record.race_number AS raceNumber,
              revision_record.scoring_segment AS scoringSegment,
              revision_record.mode_cc AS mode, revision_record.mirror AS mirror,
              revision_record.track_id AS trackId,
              revision_record.counts_toward_standings AS countsTowardStandings,
              revision_record.scoring_note AS scoringNote,
              revision_record.observed_stage_label AS observedStageLabel,
              revision_record.observed_group_label AS observedGroupLabel,
              revision_record.source_kind AS sourceKind,
              revision_record.source_transport AS sourceTransport,
              revision_record.producer_version AS producerVersion,
              revision_record.local_record_id AS localRecordId,
              revision_record.session_id AS sessionId,
              revision_record.stream_id AS streamId,
              revision_record.source_media_id AS sourceMediaId,
              revision_record.race_offset_ms AS raceOffsetMs,
              revision_record.frame_index AS frameIndex,
              revision_record.occurred_at_ms AS occurredAtMs,
              revision_record.captured_at_ms AS capturedAtMs,
              revision_record.created_at_ms AS createdAtMs,
              revision_record.submitted_at_ms AS submittedAtMs,
              revision_record.verification_status AS verificationStatus,
              revision_record.verification_method AS verificationMethod,
              revision_record.verification_confidence AS verificationConfidence,
              revision_record.confidence_track AS confidenceTrack,
              revision_record.confidence_player_count AS confidencePlayerCount,
              revision_record.confidence_finish_positions AS confidenceFinishPositions,
              revision_record.confidence_player_names AS confidencePlayerNames,
              revision_record.confidence_characters AS confidenceCharacters,
              revision_record.confidence_race_points AS confidenceRacePoints,
              revision_record.confidence_total_scores AS confidenceTotalScores
       FROM tournament_race_result_revisions AS revision_record
       INNER JOIN tournament_race_results AS result_record
         ON result_record.tournament_race_result_id =
            revision_record.tournament_race_result_id
       WHERE result_record.public_id = ? AND revision_record.revision_number = ?
       LIMIT 2 LOCK IN SHARE MODE`,
      [request.raceResultId, request.revision],
    );
    return one(rows, "Tournament revision");
  }

  private mapRestricted(row: RestrictedRow): MappedRestricted {
    const resourceId = integer(row.resourceId, "restricted.resourceId", 1);
    const dataKind = text(row.dataKind, "restricted.dataKind");
    const protectedValue: TournamentProtectedValue = {
      ciphertext: bytes(row.ciphertext, "restricted.ciphertext"),
      encryptionKeyVersion: text(
        row.encryptionKeyVersion,
        "restricted.encryptionKeyVersion",
      ),
    };
    if (dataKind === "participant_reference") {
      if (row.sequenceNumber !== null || row.referenceNamespace !== null ||
        row.sha256 !== null || row.mediaType !== null) {
        throw new TournamentReadPersistenceError("participant restricted shape is invalid");
      }
      return {
        resourceId,
        kind: "participant",
        placementInternalId: integer(
          row.placementInternalId,
          "restricted.placementInternalId",
          1,
        ),
        namespace: text(row.subtype, "restricted.participantNamespace") as
          Extract<MappedRestricted, { kind: "participant" }>["namespace"],
        protectedValue,
      };
    }
    if (row.placementInternalId !== null) {
      throw new TournamentReadPersistenceError("revision restricted shape is invalid");
    }
    if (dataKind === "context_reference") {
      if (row.sequenceNumber !== null || row.sha256 !== null || row.mediaType !== null) {
        throw new TournamentReadPersistenceError("context restricted shape is invalid");
      }
      return {
        resourceId,
        kind: "context",
        value: {
          contextKind: text(row.subtype, "restricted.contextKind") as
            StoredTournamentContext["contextKind"],
          namespace: text(row.referenceNamespace, "restricted.contextNamespace"),
          protectedValue,
        },
      };
    }
    if (row.referenceNamespace !== null) {
      throw new TournamentReadPersistenceError("ordered restricted shape is invalid");
    }
    if (dataKind === "evidence_reference") {
      return {
        resourceId,
        kind: "evidence",
        value: {
          sequenceNumber: integer(row.sequenceNumber, "restricted.evidenceSequence", 1),
          kind: text(row.subtype, "restricted.evidenceKind") as
            StoredTournamentEvidence["kind"],
          protectedReference: protectedValue,
          ...(row.sha256 === null ? {} : {
            sha256: optionalBytes(row.sha256, "restricted.evidenceSha256")!,
          }),
          ...(row.mediaType === null ? {} : {
            mediaType: optionalText(row.mediaType, "restricted.evidenceMediaType")!,
          }),
        },
      };
    }
    if (dataKind === "verification_issue") {
      if (row.sha256 !== null || row.mediaType !== null) {
        throw new TournamentReadPersistenceError("issue restricted shape is invalid");
      }
      return {
        resourceId,
        kind: "issue",
        value: {
          sequenceNumber: integer(row.sequenceNumber, "restricted.issueSequence", 1),
          code: text(row.subtype, "restricted.issueCode"),
          protectedMessage: protectedValue,
        },
      };
    }
    throw new TournamentReadPersistenceError("restricted data kind is invalid");
  }

  private async audit(
    connection: PoolConnection,
    resourceId: number,
    request: TournamentRevisionReadRequest,
  ): Promise<void> {
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO restricted_identity_access_log (
         resource_type, claim_evidence_id, claim_review_id, legacy_identifier_id,
         authentication_binding_id, time_trial_participant_reference_id,
         time_trial_evidence_id, tournament_restricted_data_id,
         accessor_type, accessor_reference, purpose_code, accessed_at_ms
       ) VALUES ('tournament_restricted_data', NULL, NULL, NULL, NULL, NULL,
                 NULL, ?, 'administrator', ?, ?, ?)`,
      [
        resourceId,
        request.accessorUserAccountId,
        request.purposeCode,
        request.accessedAtMs,
      ],
    );
    if (result.affectedRows !== 1) {
      throw new TournamentReadPersistenceError("restricted access audit was not appended");
    }
  }
}
