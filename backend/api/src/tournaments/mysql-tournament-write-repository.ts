import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";

import {
  TournamentResultServiceError,
  type TournamentRevisionPersistenceInput,
  type TournamentWriteRepository,
  type TournamentWriteTransaction,
} from "./race-result-service.js";

interface ResultRow extends RowDataPacket {
  resultInternalId: unknown;
  firstCreatedAtMs: unknown;
}

interface RevisionRow extends RowDataPacket {
  latestRevision: unknown;
}

interface PlayerRow extends RowDataPacket {
  internalId: unknown;
  publicId: unknown;
}

export class TournamentPersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TournamentPersistenceError";
  }
}

function safeInteger(value: unknown, field: string, minimum: number): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isSafeInteger(numeric) || numeric < minimum) {
    throw new TournamentPersistenceError(`${field} has an invalid persisted value`);
  }
  return numeric;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TournamentPersistenceError(`${field} has an invalid persisted value`);
  }
  return value;
}

function singleRow<T extends RowDataPacket>(rows: T[], resource: string): T | null {
  if (rows.length === 0) {
    return null;
  }
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new TournamentPersistenceError(`${resource} lookup returned an invalid row count`);
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

class MysqlTournamentWriteTransaction implements TournamentWriteTransaction {
  public constructor(private readonly connection: PoolConnection) {}

  public async findRaceResultForUpdate(raceResultId: string) {
    const [rows] = await this.connection.execute<ResultRow[]>(
      `SELECT tournament_race_result_id AS resultInternalId,
              first_created_at_ms AS firstCreatedAtMs
       FROM tournament_race_results
       WHERE public_id = ?
       LIMIT 1 FOR UPDATE`,
      [raceResultId],
    );
    const row = singleRow(rows, "Tournament race result");
    if (row === null) {
      return null;
    }
    const internalId = safeInteger(
      row.resultInternalId,
      "TournamentRaceResult.internalId",
      1,
    );
    const [revisionRows] = await this.connection.execute<RevisionRow[]>(
      `SELECT COALESCE(MAX(revision_number), 0) AS latestRevision
       FROM tournament_race_result_revisions
       WHERE tournament_race_result_id = ?`,
      [internalId],
    );
    const revision = singleRow(revisionRows, "Tournament revision aggregate");
    if (revision === null) {
      throw new TournamentPersistenceError("Tournament revision aggregate was absent");
    }
    return {
      firstCreatedAtMs: safeInteger(
        row.firstCreatedAtMs,
        "TournamentRaceResult.firstCreatedAtMs",
        0,
      ),
      latestRevision: safeInteger(
        revision.latestRevision,
        "TournamentRaceResult.latestRevision",
        0,
      ),
    };
  }

  public async findActiveHumanPlayersForUpdate(
    playerIds: readonly string[],
  ): Promise<ReadonlySet<string>> {
    if (playerIds.length > 12) {
      throw new TournamentPersistenceError("active Player lookup exceeds race bounds");
    }
    if (playerIds.length === 0) {
      return new Set<string>();
    }
    const uniqueIds = [...new Set(playerIds)];
    const placeholders = uniqueIds.map(() => "?").join(", ");
    const [rows] = await this.connection.execute<PlayerRow[]>(
      `SELECT player_id AS internalId, public_id AS publicId
       FROM players
       WHERE player_kind = 'human' AND record_status = 'active'
         AND public_id IN (${placeholders})
       ORDER BY public_id
       FOR UPDATE`,
      uniqueIds,
    );
    const found = new Set<string>();
    for (const row of rows) {
      safeInteger(row.internalId, "Player.internalId", 1);
      const publicId = requiredString(row.publicId, "Player.publicId");
      if (!uniqueIds.includes(publicId) || found.has(publicId)) {
        throw new TournamentPersistenceError("active Player lookup returned invalid rows");
      }
      found.add(publicId);
    }
    return found;
  }

  public async insertRaceResult(
    raceResultId: string,
    firstCreatedAtMs: number,
  ): Promise<void> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO tournament_race_results (public_id, first_created_at_ms)
       VALUES (?, ?)`,
      [raceResultId, firstCreatedAtMs],
    );
    this.requireSingleInsert(result, "Tournament race result");
  }

  public async insertRevision(input: TournamentRevisionPersistenceInput): Promise<void> {
    this.validatePersistenceInput(input);
    const resultInternalId = await this.findInternalResultId(input.revision.raceResultId);
    const verification = input.revision.verification;
    const fieldConfidence = verification?.fieldConfidence;
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO tournament_race_result_revisions (
         tournament_race_result_id, revision_number, schema_version, race_number,
         scoring_segment, mode_cc, mirror, track_id, counts_toward_standings,
         scoring_note, observed_stage_label, observed_group_label, source_kind,
         source_transport, producer_version, local_record_id, session_id,
         stream_id, source_media_id, race_offset_ms, frame_index, occurred_at_ms,
         captured_at_ms, created_at_ms, submitted_at_ms, verification_status,
         verification_method, verification_confidence, confidence_track,
         confidence_player_count, confidence_finish_positions,
         confidence_player_names, confidence_characters, confidence_race_points,
         confidence_total_scores
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       )`,
      [
        resultInternalId,
        input.revision.revision,
        input.revision.schemaVersion,
        input.revision.raceNumber,
        input.revision.scoringSegment,
        input.revision.mode ?? null,
        input.revision.mirror === true ? 1 : null,
        input.revision.trackId,
        input.revision.countsTowardStandings,
        input.revision.scoringNote ?? null,
        input.revision.observedStageLabel ?? null,
        input.revision.observedGroupLabel ?? null,
        input.revision.source.kind,
        input.revision.source.transport ?? null,
        input.revision.source.producerVersion ?? null,
        input.revision.source.localRecordId ?? null,
        input.revision.source.sessionId ?? null,
        input.revision.source.streamId ?? null,
        input.revision.source.sourceMediaId ?? null,
        input.revision.source.raceOffsetMs ?? null,
        input.revision.source.frameIndex ?? null,
        input.revision.timestamps.occurredAtMs ?? null,
        input.revision.timestamps.capturedAtMs ?? null,
        input.revision.timestamps.createdAtMs,
        input.revision.timestamps.submittedAtMs ?? null,
        verification?.status ?? null,
        verification?.method ?? null,
        verification?.confidence ?? null,
        fieldConfidence?.track ?? null,
        fieldConfidence?.playerCount ?? null,
        fieldConfidence?.finishPositions ?? null,
        fieldConfidence?.playerNames ?? null,
        fieldConfidence?.characters ?? null,
        fieldConfidence?.racePoints ?? null,
        fieldConfidence?.totalScores ?? null,
      ],
    );
    if (result.affectedRows !== 1 || result.insertId < 1) {
      throw new TournamentPersistenceError("Tournament revision was not inserted");
    }
    const revisionInternalId = result.insertId;

    for (const placement of input.placements) {
      const playerInternalId = placement.playerId === null
        ? null
        : await this.findInternalPlayerId(placement.playerId);
      const placementConfidence = placement.confidence;
      const [placementResult] = await this.connection.execute<ResultSetHeader>(
        `INSERT INTO tournament_race_placements (
           tournament_race_result_revision_id, finish_position,
           participant_reference_kind, player_id, observed_player_name,
           character_id, character_variant_id, race_points, total_before_race,
           total_after_race, rank_after_race, confidence_finish_position,
           confidence_player_name, confidence_character, confidence_race_points,
           confidence_total_after_race
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          revisionInternalId,
          placement.finishPosition,
          placement.playerId === null ? "restricted_reference" : "player",
          playerInternalId,
          placement.observedPlayerName ?? null,
          placement.characterId ?? null,
          placement.characterVariantId ?? null,
          placement.scoring.racePoints,
          placement.scoring.totalBeforeRace,
          placement.scoring.totalAfterRace,
          placement.scoring.rankAfterRace,
          placementConfidence?.finishPosition ?? null,
          placementConfidence?.playerName ?? null,
          placementConfidence?.character ?? null,
          placementConfidence?.racePoints ?? null,
          placementConfidence?.totalAfterRace ?? null,
        ],
      );
      if (placementResult.affectedRows !== 1 || placementResult.insertId < 1) {
        throw new TournamentPersistenceError("Tournament placement was not inserted");
      }
      if (placement.restrictedParticipant !== null) {
        const participant = placement.restrictedParticipant;
        await this.insertRestrictedData([
          revisionInternalId,
          placementResult.insertId,
          "participant_reference",
          null,
          participant.namespace,
          null,
          participant.lookupHmac,
          participant.lookupKeyVersion,
          participant.ciphertext,
          participant.encryptionKeyVersion,
          null,
          null,
        ]);
      }
    }

    for (const context of input.protectedContext) {
      await this.insertRestrictedData([
        revisionInternalId,
        null,
        "context_reference",
        null,
        context.contextKind,
        context.namespace,
        context.lookupHmac,
        context.lookupKeyVersion,
        context.ciphertext,
        context.encryptionKeyVersion,
        null,
        null,
      ]);
    }
    for (const evidence of input.protectedEvidence) {
      await this.insertRestrictedData([
        revisionInternalId,
        null,
        "evidence_reference",
        evidence.sequenceNumber,
        evidence.kind,
        null,
        null,
        null,
        evidence.protectedReference.ciphertext,
        evidence.protectedReference.encryptionKeyVersion,
        evidence.sha256 ?? null,
        evidence.mediaType ?? null,
      ]);
    }
    for (const issue of input.protectedIssues) {
      await this.insertRestrictedData([
        revisionInternalId,
        null,
        "verification_issue",
        issue.sequenceNumber,
        issue.code,
        null,
        null,
        null,
        issue.protectedMessage.ciphertext,
        issue.protectedMessage.encryptionKeyVersion,
        null,
        null,
      ]);
    }
  }

  private validatePersistenceInput(input: TournamentRevisionPersistenceInput): void {
    const revision = input.revision as unknown as Record<string, unknown>;
    if (["placements", "context", "evidence"].some((key) => Object.hasOwn(revision, key)) ||
      (typeof revision["verification"] === "object" && revision["verification"] !== null &&
        Object.hasOwn(revision["verification"] as object, "issues"))) {
      throw new TournamentPersistenceError("raw restricted fields reached persistence");
    }
    if (input.placements.length < 1 || input.placements.length > 12 ||
      input.placements.some((placement) =>
      Object.hasOwn(placement as object, "participantReference") ||
      ((placement.playerId === null) === (placement.restrictedParticipant === null)))) {
      throw new TournamentPersistenceError("Tournament participant invariant failed");
    }
    if (input.protectedContext.length > 3 || input.protectedEvidence.length > 16 ||
      input.protectedIssues.length > 32 || input.protectedEvidence.some(
      (item, index) => item.sequenceNumber !== index + 1,
    ) || input.protectedIssues.some(
      (item, index) => item.sequenceNumber !== index + 1,
    ) || new Set(input.protectedContext.map((item) => item.contextKind)).size !==
      input.protectedContext.length) {
      throw new TournamentPersistenceError("Tournament restricted sequence invariant failed");
    }
    if ((input.revision.verification?.status === "producer_check_failed" ||
      input.revision.verification?.status === "needs_review") &&
      input.protectedIssues.length === 0) {
      throw new TournamentPersistenceError("Tournament review issue invariant failed");
    }
  }

  private async findInternalResultId(raceResultId: string): Promise<number> {
    const [rows] = await this.connection.execute<ResultRow[]>(
      `SELECT tournament_race_result_id AS resultInternalId,
              first_created_at_ms AS firstCreatedAtMs
       FROM tournament_race_results WHERE public_id = ? LIMIT 1 FOR UPDATE`,
      [raceResultId],
    );
    const row = singleRow(rows, "Tournament race result internal ID");
    if (row === null) {
      throw new TournamentPersistenceError("Tournament race result was lost");
    }
    return safeInteger(row.resultInternalId, "TournamentRaceResult.internalId", 1);
  }

  private async findInternalPlayerId(playerId: string): Promise<number> {
    const [rows] = await this.connection.execute<PlayerRow[]>(
      `SELECT player_id AS internalId, public_id AS publicId
       FROM players
       WHERE public_id = ? AND player_kind = 'human' AND record_status = 'active'
       LIMIT 1 FOR UPDATE`,
      [playerId],
    );
    const row = singleRow(rows, "active human Player internal ID");
    if (row === null || requiredString(row.publicId, "Player.publicId") !== playerId) {
      throw new TournamentResultServiceError(
        "player_not_found",
        "one or more active Players were not found",
      );
    }
    return safeInteger(row.internalId, "Player.internalId", 1);
  }

  private async insertRestrictedData(values: readonly unknown[]): Promise<void> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO restricted_tournament_race_data (
         tournament_race_result_revision_id, tournament_race_placement_id,
         data_kind, sequence_number, subtype, reference_namespace, lookup_hmac,
         lookup_key_version, value_ciphertext, encryption_key_version, sha256,
         media_type
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...values] as any[],
    );
    this.requireSingleInsert(result, "restricted Tournament data");
  }

  private requireSingleInsert(result: ResultSetHeader, resource: string): void {
    if (result.affectedRows !== 1) {
      throw new TournamentPersistenceError(`${resource} was not inserted`);
    }
  }
}

export class MysqlTournamentWriteRepository implements TournamentWriteRepository {
  /**
   * When `bound` is given this repository joins a transaction somebody else
   * owns instead of opening one of its own, so several repositories can commit
   * or roll back together. The owner begins, commits and rolls back; this
   * repository only maps its own errors.
   */
  public constructor(
    private readonly pool: Pool,
    private readonly bound?: PoolConnection,
  ) {}

  public async transaction<T>(
    work: (transaction: TournamentWriteTransaction) => Promise<T>,
  ): Promise<T> {
    if (this.bound !== undefined) {
      try {
        return await work(new MysqlTournamentWriteTransaction(this.bound));
      } catch (error) {
        throw this.mapped(error);
      }
    }
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(new MysqlTournamentWriteTransaction(connection));
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw this.mapped(error);
    } finally {
      connection.release();
    }
  }

  private mapped(error: unknown): unknown {
    return isDuplicateKeyError(error)
      ? new TournamentResultServiceError(
        "revision_conflict",
        "Tournament result identity or revision was occupied concurrently",
      )
      : error;
  }
}
