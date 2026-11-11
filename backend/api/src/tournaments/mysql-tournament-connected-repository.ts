import { randomUUID } from "node:crypto";

import type {
  Pool, PoolConnection, ResultSetHeader, RowDataPacket,
} from "mysql2/promise";

import type { TournamentRaceResultV1 } from "./race-result-validation.js";

import { TournamentOperationError } from "./tournament-operation-service.js";
import type {
  ConnectedTournamentSummary,
  IncomingTournamentResult,
  StoredTournamentEvidenceRecord,
  TournamentEvidenceGroupSummary,
  TournamentEvidenceRecord,
  TournamentConnectedRepository,
} from "./tournament-connected-service.js";

interface TournamentRow extends RowDataPacket {
  internal_id: number;
  public_id: string;
  name: string;
  series_label: string | null;
  edition_number: number | null;
  start_at_ms: number | null;
  timezone_name: string | null;
  stage: string;
  workflow_step: number;
}

interface GroupRow extends RowDataPacket {
  tournament_id: number;
  public_id: string;
  name: string;
  phase: string;
}

interface IncomingRow extends RowDataPacket {
  public_id: string;
  tournament_public_id: string;
  source_kind: string;
  status: "pending" | "accepted" | "rejected" | "blocked";
  revision: number;
  result_payload_json: string | TournamentRaceResultV1;
  semantic_fingerprint: string;
  suggested_phase: string | null;
  suggested_group_public_id: string | null;
  suggested_race_number: number | null;
  occurred_at_ms: number | null;
  captured_at_ms: number | null;
  created_at_ms: number;
  duplicate_count: number;
  evidence_record_public_id: string | null;
  submitter_display_name: string | null;
}

interface EvidenceRow extends RowDataPacket {
  public_id: string;
  client_record_id: string;
  revision: number;
  record_status: "uploading" | "available" | "linked" | "blocked";
  source_kind: string;
  result_entries_json?: string | StoredTournamentEvidenceRecord["entries"];
  summary_payload_json: string | readonly TournamentEvidenceGroupSummary[];
  uploaded_by_user_account_public_id: string;
  uploader_display_name: string;
  started_at_ms: number | null;
  stopped_at_ms: number | null;
  analysis_completed_at_ms: number | null;
  completed_at_ms: number | null;
  suggested_tournament_public_id: string | null;
  suggested_tournament_name: string | null;
  linked_tournament_public_id: string | null;
  live_status: "none" | "requested" | "active" | "stopping" | "complete" | "invalidated";
  live_mappings_json: string | readonly import("./tournament-connected-service.js").TournamentLiveMapping[] | null;
  live_approved_at_ms: number | null;
  live_stopped_at_ms: number | null;
  live_completed_at_ms: number | null;
  created_at_ms: number;
  updated_at_ms: number;
}

function parseResult(value: string | TournamentRaceResultV1): TournamentRaceResultV1 {
  return typeof value === "string" ? JSON.parse(value) as TournamentRaceResultV1 : value;
}

function mapIncoming(row: IncomingRow): IncomingTournamentResult {
  return {
    incomingResultId: row.public_id,
    tournamentId: row.tournament_public_id,
    sourceKind: row.source_kind,
    status: row.status,
    revision: row.revision,
    result: parseResult(row.result_payload_json),
    semanticFingerprint: row.semantic_fingerprint,
    suggestedPhase: row.suggested_phase,
    suggestedGroupId: row.suggested_group_public_id,
    suggestedRaceNumber: row.suggested_race_number,
    occurredAtMs: row.occurred_at_ms,
    capturedAtMs: row.captured_at_ms,
    duplicateWarning: Number(row.duplicate_count) > 0,
    evidenceRecordId: row.evidence_record_public_id,
    submittedByDisplayName: row.submitter_display_name,
    createdAtMs: row.created_at_ms,
  };
}

function parseJson<T>(value: string | T): T {
  return typeof value === "string" ? JSON.parse(value) as T : value;
}

function mapEvidence(row: EvidenceRow): TournamentEvidenceRecord {
  const groups = parseJson<readonly TournamentEvidenceGroupSummary[]>(row.summary_payload_json);
  const live = row.live_status === "none" ? undefined : {
    status: row.live_status,
    mappings: row.live_mappings_json === null ? [] : parseJson(row.live_mappings_json),
    approvedAtMs: row.live_approved_at_ms,
    stoppedAtMs: row.live_stopped_at_ms,
    completedAtMs: row.live_completed_at_ms,
  };
  return {
    recordId: row.public_id,
    clientRecordId: row.client_record_id,
    revision: Number(row.revision),
    status: row.record_status,
    sourceKind: row.source_kind,
    uploadedBy: {
      userAccountId: row.uploaded_by_user_account_public_id,
      displayName: row.uploader_display_name,
    },
    startedAtMs: row.started_at_ms,
    stoppedAtMs: row.stopped_at_ms,
    analysisCompletedAtMs: row.analysis_completed_at_ms,
    complete: row.completed_at_ms !== null,
    suggestedTournamentId: row.suggested_tournament_public_id,
    suggestedTournamentName: row.suggested_tournament_name,
    linkedTournamentId: row.linked_tournament_public_id,
    groups,
    resultCount: groups.reduce((count, group) => count + group.races, 0),
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    ...(live === undefined ? {} : { live }),
  };
}

export function liveStatusAfterStop(
  status: "requested" | "active" | "stopping",
): "requested" | "stopping" {
  return status === "requested" ? "requested" : "stopping";
}

/**
 * A live request may be dismissed only while it never went public: still
 * `requested`, or `stopping` without a director/roster approval ever recorded.
 */
export function liveRequestIsDismissible(liveStatus: string, liveApprovedAtMs: number | null): boolean {
  return liveStatus === "requested" || (liveStatus === "stopping" && liveApprovedAtMs === null);
}

const evidenceProjection = `
  SELECT evidence.public_id, evidence.client_record_id, evidence.revision,
         evidence.record_status, evidence.source_kind,
         evidence.summary_payload_json,
         uploader.public_id AS uploaded_by_user_account_public_id,
         COALESCE(uploader_player.display_name, 'Signed-in Tournament Live user') AS uploader_display_name,
         evidence.started_at_ms, evidence.stopped_at_ms,
         evidence.analysis_completed_at_ms, evidence.completed_at_ms,
         suggested.public_id AS suggested_tournament_public_id,
         suggested.name AS suggested_tournament_name,
         linked.public_id AS linked_tournament_public_id,
         evidence.live_status, evidence.live_mappings_json,
         evidence.live_approved_at_ms, evidence.live_stopped_at_ms,
         evidence.live_completed_at_ms,
         evidence.created_at_ms, evidence.updated_at_ms
    FROM tournament_evidence_records evidence
    JOIN user_accounts uploader
      ON uploader.user_account_id = evidence.uploaded_by_user_account_id
    LEFT JOIN (
      SELECT claim.user_account_id, MIN(player.display_name) AS display_name
        FROM player_claims claim
        JOIN players player ON player.player_id = claim.player_id
       WHERE claim.claim_status = 'verified'
       GROUP BY claim.user_account_id
    ) uploader_player ON uploader_player.user_account_id = uploader.user_account_id
    LEFT JOIN tournaments suggested
      ON suggested.tournament_id = evidence.suggested_tournament_id
    LEFT JOIN tournaments linked
      ON linked.tournament_id = evidence.linked_tournament_id`;

const incomingProjection = `
  SELECT ir.public_id,
         t.public_id AS tournament_public_id,
         ir.source_kind,
         ir.status,
         ir.revision,
         ir.result_payload_json,
         ir.semantic_fingerprint,
         ir.suggested_phase,
         ir.suggested_group_public_id,
         ir.suggested_race_number,
         ir.occurred_at_ms,
         ir.captured_at_ms,
         ir.created_at_ms,
         evidence.public_id AS evidence_record_public_id,
         COALESCE(submitter_player.display_name, 'Signed-in Tournament Live user') AS submitter_display_name,
         (
           SELECT COUNT(*)
             FROM tournament_incoming_results duplicate_ir
            WHERE duplicate_ir.tournament_id = ir.tournament_id
              AND duplicate_ir.semantic_fingerprint = ir.semantic_fingerprint
              AND duplicate_ir.public_id <> ir.public_id
              AND duplicate_ir.status = 'accepted'
         ) + (
           SELECT COUNT(*)
             FROM tournament_group_races existing_race
             JOIN tournament_groups existing_group
               ON existing_group.tournament_group_id = existing_race.tournament_group_id
            WHERE existing_group.tournament_id = ir.tournament_id
              AND existing_group.public_id = ir.suggested_group_public_id
              AND existing_race.race_number = ir.suggested_race_number
         ) AS duplicate_count
    FROM tournament_incoming_results ir
    JOIN tournaments t ON t.tournament_id = ir.tournament_id
    LEFT JOIN tournament_evidence_records evidence
      ON evidence.tournament_evidence_record_id = ir.evidence_record_id
    JOIN user_accounts submitter
      ON submitter.user_account_id = ir.submitted_by_user_account_id
    LEFT JOIN (
      SELECT claim.user_account_id, MIN(player.display_name) AS display_name
        FROM player_claims claim
        JOIN players player ON player.player_id = claim.player_id
       WHERE claim.claim_status = 'verified'
       GROUP BY claim.user_account_id
    ) submitter_player ON submitter_player.user_account_id = submitter.user_account_id`;

export class MysqlTournamentConnectedRepository implements TournamentConnectedRepository {
  /**
   * When `bound` is given this repository joins a transaction somebody else
   * owns: reads see that transaction's own uncommitted writes, and writes
   * commit or roll back with it rather than on their own.
   */
  public constructor(
    private readonly pool: Pool,
    private readonly bound?: PoolConnection,
  ) {}

  /** Reads go to the enclosing transaction when there is one. */
  private get reader(): Pool | PoolConnection {
    return this.bound ?? this.pool;
  }

  /**
   * Leases a connection and owns the begin/commit, unless this repository is
   * bound to somebody else's transaction - then the work simply joins it and
   * the owner decides whether it commits.
   */
  private async unit<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
    if (this.bound !== undefined) { return work(this.bound); }
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      try { await connection.rollback(); } catch { /* the original error wins */ }
      throw error;
    } finally {
      connection.release();
    }
  }

  public async listEligibleTournaments(userAccountId: string): Promise<readonly ConnectedTournamentSummary[]> {
    const [accounts] = await this.reader.execute<RowDataPacket[]>(
      "SELECT 1 FROM user_accounts WHERE public_id = ? AND account_status = 'active' LIMIT 1",
      [userAccountId],
    );
    if (accounts.length === 0) return [];
    const [tournaments] = await this.reader.query<TournamentRow[]>(`
      SELECT tournament_id AS internal_id, public_id, name, series_label, edition_number,
             start_at_ms, timezone_name, stage, workflow_step
        FROM tournaments
       WHERE lifecycle_status = 'active'
         AND stage <> 'finalized'
         AND workflow_step BETWEEN 2 AND 9
       ORDER BY COALESCE(start_at_ms, created_at_ms) ASC, tournament_id ASC
    `);
    if (tournaments.length === 0) return [];
    const [groups] = await this.reader.query<GroupRow[]>(`
      SELECT tournament_id, public_id, name, stage AS phase
        FROM tournament_groups
       WHERE tournament_id IN (?)
       ORDER BY tournament_id, sequence_number, tournament_group_id
    `, [tournaments.map((row) => row.internal_id)]);
    return tournaments.map((row) => ({
      tournamentId: row.public_id,
      name: row.name,
      seriesLabel: row.series_label,
      editionNumber: row.edition_number,
      startAtMs: row.start_at_ms,
      timezone: row.timezone_name,
      stage: row.stage,
      workflowStep: row.workflow_step,
      groups: groups
        .filter((group) => group.tournament_id === row.internal_id &&
          group.phase === (row.workflow_step >= 7 ? "final" : "qualifier"))
        .map((group) => ({ groupId: group.public_id, name: group.name, phase: group.phase })),
    }));
  }

  public async findActiveTournamentInternalId(tournamentId: string): Promise<number | null> {
    const [rows] = await this.reader.execute<RowDataPacket[]>(
      "SELECT tournament_id AS id FROM tournaments WHERE public_id = ? AND lifecycle_status = 'active' AND workflow_step IN (5, 9) LIMIT 1",
      [tournamentId],
    );
    return rows.length === 0 ? null : Number(rows[0]?.id);
  }

  public async canReviewTournament(tournamentId: string, userAccountId: string, administrator: boolean): Promise<boolean> {
    const [rows] = await this.reader.execute<RowDataPacket[]>(`
      SELECT 1
        FROM tournaments tournament
        JOIN user_accounts account
          ON account.public_id = ? AND account.account_status = 'active'
       WHERE tournament.public_id = ?
         AND tournament.lifecycle_status = 'active'
         AND (
           ? = TRUE
           OR tournament.director_user_account_id = account.user_account_id
         )
       LIMIT 1
    `, [userAccountId, tournamentId, administrator]);
    return rows.length === 1;
  }

  public async upsertEvidenceRecord(input: Parameters<TournamentConnectedRepository["upsertEvidenceRecord"]>[0]): Promise<TournamentEvidenceRecord> {
    return this.unit(async (connection) => {
      const [accountRows] = await connection.execute<RowDataPacket[]>(
        "SELECT user_account_id AS id FROM user_accounts WHERE public_id = ? AND account_status = 'active' LIMIT 1 FOR UPDATE",
        [input.uploadedByUserAccountId],
      );
      if (accountRows.length !== 1) throw new TournamentOperationError("forbidden", "The uploading account is not active.");
      const uploaderInternalId = Number(accountRows[0]?.["id"]);
      let suggestedTournamentInternalId: number | null = null;
      if (input.suggestedTournamentId !== null) {
        const [tournamentRows] = await connection.execute<RowDataPacket[]>(
          `SELECT tournament_id AS id FROM tournaments
            WHERE public_id = ? AND lifecycle_status = 'active'
              AND stage <> 'finalized' AND workflow_step BETWEEN 2 AND 9
            LIMIT 1`,
          [input.suggestedTournamentId],
        );
        if (tournamentRows.length !== 1) {
          throw new TournamentOperationError("not_found", "The suggested active Tournament was not found.");
        }
        suggestedTournamentInternalId = Number(tournamentRows[0]?.["id"]);
      }
      const [existingRows] = await connection.execute<RowDataPacket[]>(`
        SELECT tournament_evidence_record_id AS id, public_id, revision, record_status,
               content_sha256, completed_at_ms, live_status
          FROM tournament_evidence_records
         WHERE uploaded_by_user_account_id = ? AND client_record_id = ?
         LIMIT 1 FOR UPDATE
      `, [uploaderInternalId, input.clientRecordId]);
      const existing = existingRows[0];
      if (existing === undefined) {
        await connection.execute<ResultSetHeader>(`
          INSERT INTO tournament_evidence_records (
            public_id, client_record_id, revision, record_status, source_kind,
            result_entries_json, summary_payload_json, content_sha256,
            suggested_tournament_id, linked_tournament_id,
            uploaded_by_user_account_id, linked_by_user_account_id,
            started_at_ms, stopped_at_ms, analysis_completed_at_ms,
            completed_at_ms, linked_at_ms, created_at_ms, updated_at_ms
            , live_status, live_mappings_json
          ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
        `, [
          input.recordId, input.clientRecordId, input.complete ? "available" : "uploading", input.sourceKind,
          JSON.stringify(input.entries), JSON.stringify(input.summary), input.contentSha256,
          suggestedTournamentInternalId, uploaderInternalId,
          input.startedAtMs, input.stoppedAtMs, input.analysisCompletedAtMs,
          input.complete ? input.nowMs : null, input.nowMs, input.nowMs,
          input.liveRegistration === null ? "none" : "requested",
          input.liveRegistration === null ? null : JSON.stringify(input.liveRegistration.mappings),
        ]);
      } else {
        if (existing["record_status"] === "linked" || existing["record_status"] === "blocked") {
          if (String(existing["content_sha256"]) !== input.contentSha256) {
            throw new TournamentOperationError("conflict", "A linked evidence record cannot be rewritten.");
          }
        } else if (!(existing["completed_at_ms"] !== null && !input.complete)) {
          await connection.execute(`
            UPDATE tournament_evidence_records
               SET revision = revision + 1, record_status = ?, source_kind = ?,
                   result_entries_json = ?, summary_payload_json = ?, content_sha256 = ?,
                   suggested_tournament_id = ?, started_at_ms = ?, stopped_at_ms = ?,
                   analysis_completed_at_ms = ?, completed_at_ms = ?, updated_at_ms = ?,
                   live_mappings_json = CASE
                     WHEN live_status = 'none' AND ? = TRUE THEN ? ELSE live_mappings_json END,
                   live_completed_at_ms = CASE
                     WHEN live_status IN ('active', 'stopping') AND ? = TRUE THEN ? ELSE live_completed_at_ms END,
                   live_status = CASE
                     WHEN live_status IN ('active', 'stopping') AND ? = TRUE THEN 'complete'
                     WHEN live_status = 'none' AND ? = TRUE THEN 'requested'
                     ELSE live_status END
             WHERE tournament_evidence_record_id = ?
          `, [
            input.complete ? "available" : "uploading", input.sourceKind,
            JSON.stringify(input.entries), JSON.stringify(input.summary), input.contentSha256,
            suggestedTournamentInternalId, input.startedAtMs, input.stoppedAtMs,
            input.analysisCompletedAtMs, input.complete ? input.nowMs : null, input.nowMs,
            input.liveRegistration !== null,
            input.liveRegistration === null ? null : JSON.stringify(input.liveRegistration.mappings),
            input.complete, input.nowMs,
            input.complete, input.liveRegistration !== null,
            Number(existing["id"]),
          ]);
        }
      }
      const recordId = existing === undefined ? input.recordId : String(existing["public_id"]);
      const record = await this.findEvidenceRecord(recordId, connection);
      if (record === null) throw new Error("Uploaded evidence record could not be loaded.");
      const { entries: _entries, ...summary } = record;
      return summary;
    });
  }

  public async listOwnEvidenceRecords(userAccountId: string): Promise<readonly TournamentEvidenceRecord[]> {
    const [rows] = await this.reader.execute<EvidenceRow[]>(`
      ${evidenceProjection}
       WHERE uploader.public_id = ?
       ORDER BY evidence.created_at_ms DESC, evidence.tournament_evidence_record_id DESC
    `, [userAccountId]);
    return rows.map(mapEvidence);
  }

  public async listEvidenceRecordsForTournament(tournamentId: string): Promise<readonly TournamentEvidenceRecord[]> {
    const [rows] = await this.reader.execute<EvidenceRow[]>(`
      ${evidenceProjection}
       WHERE (
         (evidence.live_status = 'none' AND evidence.completed_at_ms IS NOT NULL
           AND evidence.record_status IN ('available', 'linked'))
         OR (evidence.live_status IN ('requested', 'active', 'stopping', 'complete')
           AND suggested.public_id = ?)
       )
         AND (evidence.linked_tournament_id IS NULL OR linked.public_id = ?)
       ORDER BY (suggested.public_id = ?) DESC,
                evidence.started_at_ms DESC, evidence.created_at_ms DESC
    `, [tournamentId, tournamentId, tournamentId]);
    return rows.map(mapEvidence);
  }

  public async findEvidenceRecord(
    recordId: string,
    // A read taken while a transaction is still open must run on that same
    // connection, or it cannot see the rows the transaction has just written.
    executor: Pool | PoolConnection = this.reader,
  ): Promise<StoredTournamentEvidenceRecord | null> {
    const [rows] = await executor.execute<EvidenceRow[]>(`
      ${evidenceProjection.replace("evidence.summary_payload_json,", "evidence.summary_payload_json, evidence.result_entries_json,")}
       WHERE evidence.public_id = ? LIMIT 1
    `, [recordId]);
    const row = rows[0];
    if (row === undefined || row.result_entries_json === undefined) return null;
    return { ...mapEvidence(row), entries: parseJson(row.result_entries_json) };
  }

  public async approveLiveAssociation(input: Parameters<TournamentConnectedRepository["approveLiveAssociation"]>[0]): Promise<TournamentEvidenceRecord> {
    return this.unit(async (connection) => {
      const [reviewerRows] = await connection.execute<RowDataPacket[]>(`
        SELECT account.user_account_id AS id,
               EXISTS (SELECT 1 FROM administrator_grants grant_row
                         WHERE grant_row.user_account_id = account.user_account_id
                           AND grant_row.grant_status = 'active') AS is_administrator
          FROM user_accounts account
         WHERE account.public_id = ? AND account.account_status = 'active'
         LIMIT 1 FOR UPDATE
      `, [input.reviewedByUserAccountId]);
      const reviewer = reviewerRows[0];
      if (reviewer === undefined) throw new TournamentOperationError("forbidden", "The reviewing account is not active.");
      const [tournamentRows] = await connection.execute<RowDataPacket[]>(`
        SELECT tournament_id AS id, director_user_account_id AS director
          FROM tournaments
         WHERE public_id = ? AND lifecycle_status = 'active' AND stage <> 'finalized'
         LIMIT 1 FOR UPDATE
      `, [input.tournamentId]);
      const tournament = tournamentRows[0];
      if (tournament === undefined) throw new TournamentOperationError("not_found", "The active Tournament was not found.");
      const reviewerInternalId = Number(reviewer["id"]);
      const tournamentInternalId = Number(tournament["id"]);
      const [recordRows] = await connection.execute<RowDataPacket[]>(`
        SELECT tournament_evidence_record_id AS id, revision, live_status,
               live_mappings_json, suggested_tournament_id, completed_at_ms,
               uploaded_by_user_account_id
          FROM tournament_evidence_records WHERE public_id = ? LIMIT 1 FOR UPDATE
      `, [input.recordId]);
      const record = recordRows[0];
      if (record === undefined) throw new TournamentOperationError("not_found", "The live evidence record was not found.");
      if (input.authorization === "roster_match") {
        if (Number(record["uploaded_by_user_account_id"]) !== reviewerInternalId) {
          throw new TournamentOperationError("forbidden", "Only this live run's uploader may use its roster match.");
        }
      } else if (Number(reviewer["is_administrator"]) !== 1 && Number(tournament["director"]) !== reviewerInternalId) {
        throw new TournamentOperationError("forbidden", "Only this Tournament's director may confirm live feeds.");
      }
      if (Number(record["revision"]) !== input.expectedRevision) {
        throw new TournamentOperationError("conflict", "The live feed mapping changed; reload it before confirming again.");
      }
      if (record["live_status"] === "none" || record["live_status"] === "invalidated") {
        throw new TournamentOperationError("conflict", "This evidence record is not an active live-run request.");
      }
      if (Number(record["suggested_tournament_id"]) !== tournamentInternalId) {
        throw new TournamentOperationError("conflict", "This live run belongs to another Tournament.");
      }
      const [groupRows] = await connection.execute<RowDataPacket[]>(`
        SELECT public_id, stage FROM tournament_groups WHERE tournament_id = ?
      `, [tournamentInternalId]);
      const groups = new Map(groupRows.map((row) => [String(row["public_id"]), String(row["stage"])] as const));
      for (const mapping of input.mappings) {
        if (groups.get(mapping.groupId) !== mapping.phase) {
          throw new TournamentOperationError("conflict", `Group ${mapping.groupId} no longer matches the selected phase.`);
        }
      }
      const [otherRows] = await connection.execute<RowDataPacket[]>(`
        SELECT public_id, live_mappings_json
          FROM tournament_evidence_records
         WHERE suggested_tournament_id = ?
           AND live_status IN ('active', 'stopping', 'complete')
           AND tournament_evidence_record_id <> ?
         FOR UPDATE
      `, [tournamentInternalId, Number(record["id"])]);
      const usedGroups = new Set<string>();
      for (const other of otherRows) {
        const mappings = parseJson<readonly { groupId: string }[]>(other["live_mappings_json"] as string);
        for (const mapping of mappings) usedGroups.add(mapping.groupId);
      }
      const duplicate = input.mappings.find((mapping) => usedGroups.has(mapping.groupId));
      if (duplicate !== undefined) {
        throw new TournamentOperationError("conflict", `Group ${duplicate.groupId} already has another live feed.`);
      }
      const oldMappings = record["live_mappings_json"] === null ? [] : parseJson(record["live_mappings_json"] as string);
      const nextStatus = record["completed_at_ms"] !== null ? "complete"
        : record["live_status"] === "stopping" ? "stopping" : "active";
      await connection.execute(`
        UPDATE tournament_evidence_records
           SET revision = revision + 1, live_status = ?, live_mappings_json = ?,
               live_approved_by_user_account_id = ?, live_approved_at_ms = ?,
               live_completed_at_ms = CASE
                 WHEN completed_at_ms IS NOT NULL THEN COALESCE(live_completed_at_ms, completed_at_ms)
                 ELSE live_completed_at_ms END,
               updated_at_ms = ?
         WHERE tournament_evidence_record_id = ?
      `, [nextStatus, JSON.stringify(input.mappings), reviewerInternalId, input.nowMs, input.nowMs, Number(record["id"])]);
      await connection.execute(`
        INSERT INTO tournament_live_mapping_audit (
          tournament_evidence_record_id, tournament_id, changed_by_user_account_id,
          previous_mappings_json, next_mappings_json, reason, changed_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [Number(record["id"]), tournamentInternalId, reviewerInternalId, JSON.stringify(oldMappings),
        JSON.stringify(input.mappings), input.reason, input.nowMs]);
      const updated = await this.findEvidenceRecord(input.recordId, connection);
      if (updated === null) throw new Error("Confirmed live evidence record could not be loaded.");
      const { entries: _entries, ...summary } = updated;
      return summary;
    });
  }

  public async dismissLiveRequest(input: Parameters<TournamentConnectedRepository["dismissLiveRequest"]>[0]): Promise<TournamentEvidenceRecord> {
    return this.unit(async (connection) => {
      const [reviewerRows] = await connection.execute<RowDataPacket[]>(`
        SELECT account.user_account_id AS id,
               EXISTS (SELECT 1 FROM administrator_grants grant_row
                         WHERE grant_row.user_account_id = account.user_account_id
                           AND grant_row.grant_status = 'active') AS is_administrator
          FROM user_accounts account
         WHERE account.public_id = ? AND account.account_status = 'active'
         LIMIT 1 FOR UPDATE
      `, [input.reviewedByUserAccountId]);
      const reviewer = reviewerRows[0];
      if (reviewer === undefined) throw new TournamentOperationError("forbidden", "The reviewing account is not active.");
      const [tournamentRows] = await connection.execute<RowDataPacket[]>(`
        SELECT tournament_id AS id, director_user_account_id AS director
          FROM tournaments
         WHERE public_id = ? AND lifecycle_status = 'active' AND stage <> 'finalized'
         LIMIT 1 FOR UPDATE
      `, [input.tournamentId]);
      const tournament = tournamentRows[0];
      if (tournament === undefined) throw new TournamentOperationError("not_found", "The active Tournament was not found.");
      const reviewerInternalId = Number(reviewer["id"]);
      const tournamentInternalId = Number(tournament["id"]);
      if (Number(reviewer["is_administrator"]) !== 1 && Number(tournament["director"]) !== reviewerInternalId) {
        throw new TournamentOperationError("forbidden", "Only this Tournament's director may dismiss live requests.");
      }
      const [recordRows] = await connection.execute<RowDataPacket[]>(`
        SELECT tournament_evidence_record_id AS id, revision, live_status,
               live_mappings_json, live_approved_at_ms, suggested_tournament_id
          FROM tournament_evidence_records WHERE public_id = ? LIMIT 1 FOR UPDATE
      `, [input.recordId]);
      const record = recordRows[0];
      if (record === undefined) throw new TournamentOperationError("not_found", "The live evidence record was not found.");
      if (Number(record["revision"]) !== input.expectedRevision) {
        throw new TournamentOperationError("conflict", "The live request changed; reload it before dismissing it.");
      }
      if (record["suggested_tournament_id"] === null || Number(record["suggested_tournament_id"]) !== tournamentInternalId) {
        throw new TournamentOperationError("conflict", "This live run belongs to another Tournament.");
      }
      if (!liveRequestIsDismissible(
        String(record["live_status"]),
        record["live_approved_at_ms"] === null ? null : Number(record["live_approved_at_ms"]),
      )) {
        throw new TournamentOperationError("conflict", "Only a live request that never went public can be dismissed.");
      }
      const oldMappings = record["live_mappings_json"] === null ? [] : parseJson(record["live_mappings_json"] as string);
      await connection.execute(`
        UPDATE tournament_evidence_records
           SET revision = revision + 1, live_status = 'invalidated', live_mappings_json = ?,
               updated_at_ms = ?
         WHERE tournament_evidence_record_id = ?
      `, [JSON.stringify([]), input.nowMs, Number(record["id"])]);
      await connection.execute(`
        INSERT INTO tournament_live_mapping_audit (
          tournament_evidence_record_id, tournament_id, changed_by_user_account_id,
          previous_mappings_json, next_mappings_json, reason, changed_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [Number(record["id"]), tournamentInternalId, reviewerInternalId, JSON.stringify(oldMappings),
        JSON.stringify([]), input.reason, input.nowMs]);
      const updated = await this.findEvidenceRecord(input.recordId, connection);
      if (updated === null) throw new Error("Dismissed live evidence record could not be loaded.");
      const { entries: _entries, ...summary } = updated;
      return summary;
    });
  }

  public async markOwnEvidenceStopping(input: Parameters<TournamentConnectedRepository["markOwnEvidenceStopping"]>[0]): Promise<TournamentEvidenceRecord> {
    return this.unit(async (connection) => {
      const [rows] = await connection.execute<RowDataPacket[]>(`
        SELECT evidence.tournament_evidence_record_id AS id, evidence.live_status
          FROM tournament_evidence_records evidence
          JOIN user_accounts uploader ON uploader.user_account_id = evidence.uploaded_by_user_account_id
         WHERE evidence.public_id = ? AND uploader.public_id = ?
         LIMIT 1 FOR UPDATE
      `, [input.recordId, input.uploadedByUserAccountId]);
      const row = rows[0];
      if (row === undefined) throw new TournamentOperationError("not_found", "Your live evidence record was not found.");
      if (!["requested", "active", "stopping"].includes(String(row["live_status"]))) {
        throw new TournamentOperationError("conflict", "This live run can no longer be stopped.");
      }
      // A run below automatic roster confidence must remain available to the
      // Tournament director after Stop. It stays out of the anonymous live
      // projection until the director explicitly confirms its mappings.
      const nextStatus = liveStatusAfterStop(row["live_status"] as "requested" | "active" | "stopping");
      await connection.execute(`
        UPDATE tournament_evidence_records
           SET revision = revision + 1, live_status = ?, live_stopped_at_ms = ?,
               stopped_at_ms = COALESCE(stopped_at_ms, ?), updated_at_ms = ?
         WHERE tournament_evidence_record_id = ?
      `, [nextStatus, input.nowMs, input.nowMs, input.nowMs, Number(row["id"])]);
      const updated = await this.findEvidenceRecord(input.recordId, connection);
      if (updated === null) throw new Error("Stopped live evidence record could not be loaded.");
      const { entries: _entries, ...summary } = updated;
      return summary;
    });
  }

  public async listPublicLiveRecords(tournamentId: string): Promise<readonly StoredTournamentEvidenceRecord[]> {
    const [rows] = await this.reader.execute<EvidenceRow[]>(`
      ${evidenceProjection.replace("evidence.summary_payload_json,", "evidence.summary_payload_json, evidence.result_entries_json,")}
       WHERE suggested.public_id = ? AND suggested.lifecycle_status = 'active'
         AND evidence.live_status IN ('active', 'stopping', 'complete')
       ORDER BY evidence.created_at_ms, evidence.tournament_evidence_record_id
    `, [tournamentId]);
    return rows.flatMap((row) => row.result_entries_json === undefined ? [] : [{
      ...mapEvidence(row), entries: parseJson(row.result_entries_json),
    }]);
  }

  public async materializeEvidenceRecord(input: Parameters<TournamentConnectedRepository["materializeEvidenceRecord"]>[0]): Promise<readonly IncomingTournamentResult[]> {
    return this.unit(async (connection) => {
      const [reviewerRows] = await connection.execute<RowDataPacket[]>(`
        SELECT account.user_account_id AS id,
               EXISTS (
                 SELECT 1 FROM administrator_grants administrator
                  WHERE administrator.user_account_id = account.user_account_id
                    AND administrator.grant_status = 'active'
               ) AS is_administrator
          FROM user_accounts account
         WHERE account.public_id = ? AND account.account_status = 'active'
         LIMIT 1 FOR UPDATE
      `, [input.reviewedByUserAccountId]);
      const reviewer = reviewerRows[0];
      if (reviewer === undefined) throw new TournamentOperationError("forbidden", "The reviewing account is not active.");
      const reviewerInternalId = Number(reviewer["id"]);
      const [tournamentRows] = await connection.execute<RowDataPacket[]>(`
        SELECT tournament_id AS id, director_user_account_id AS director, workflow_step
          FROM tournaments
         WHERE public_id = ? AND lifecycle_status = 'active' AND stage <> 'finalized'
         LIMIT 1 FOR UPDATE
      `, [input.tournamentId]);
      const tournament = tournamentRows[0];
      if (tournament === undefined) throw new TournamentOperationError("not_found", "The active Tournament was not found.");
      if (Number(reviewer["is_administrator"]) !== 1 && Number(tournament["director"]) !== reviewerInternalId) {
        throw new TournamentOperationError("forbidden", "Only this Tournament's director may link evidence.");
      }
      const [recordRows] = await connection.execute<RowDataPacket[]>(`
        SELECT tournament_evidence_record_id AS id, revision, record_status,
               uploaded_by_user_account_id AS uploader, completed_at_ms, linked_tournament_id
          FROM tournament_evidence_records WHERE public_id = ? LIMIT 1 FOR UPDATE
      `, [input.recordId]);
      const record = recordRows[0];
      if (record === undefined) throw new TournamentOperationError("not_found", "The evidence record was not found.");
      if (Number(record["revision"]) !== input.expectedRevision) {
        throw new TournamentOperationError("conflict", "The evidence record changed; reload and review it again.");
      }
      if (record["completed_at_ms"] === null || record["record_status"] === "uploading") {
        throw new TournamentOperationError("conflict", "The evidence record is not complete.");
      }
      if (record["record_status"] === "blocked") throw new TournamentOperationError("conflict", "The evidence record is blocked.");
      const tournamentInternalId = Number(tournament["id"]);
      const existingLink = record["linked_tournament_id"] === null ? null : Number(record["linked_tournament_id"]);
      if (existingLink !== null && existingLink !== tournamentInternalId) {
        throw new TournamentOperationError("conflict", "The evidence record was already linked to another Tournament.");
      }
      const [groupRows] = await connection.execute<RowDataPacket[]>(`
        SELECT public_id, stage FROM tournament_groups WHERE tournament_id = ?
      `, [tournamentInternalId]);
      const groups = new Map(groupRows.map((row) => [String(row["public_id"]), String(row["stage"])] as const));
      for (const mapping of input.mappings) {
        if (groups.get(mapping.groupId) !== mapping.phase) {
          throw new TournamentOperationError("conflict", `Group ${mapping.groupId} no longer matches the selected phase.`);
        }
      }
      if (existingLink === null) {
        for (const entry of input.entries) {
          await connection.execute(`
            INSERT INTO tournament_incoming_results (
              public_id, tournament_id, evidence_record_id, evidence_entry_key,
              source_kind, status, revision, result_payload_json, semantic_fingerprint,
              suggested_phase, suggested_group_public_id, suggested_race_number,
              occurred_at_ms, captured_at_ms, submitted_by_user_account_id,
              created_at_ms, updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, 'pending', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            randomUUID(), tournamentInternalId, Number(record["id"]), entry.entryKey,
            entry.result.source.kind, JSON.stringify(entry.result), entry.semanticFingerprint,
            entry.suggestedPhase, entry.suggestedGroupId, entry.suggestedRaceNumber,
            entry.occurredAtMs,
            entry.result.timestamps.capturedAtMs ?? entry.result.timestamps.createdAtMs,
            Number(record["uploader"]), input.nowMs, input.nowMs,
          ]);
        }
        await connection.execute(`
          UPDATE tournament_evidence_records
             SET record_status = 'linked', revision = revision + 1,
                 linked_tournament_id = ?, linked_by_user_account_id = ?,
                 linked_at_ms = ?, updated_at_ms = ?
           WHERE tournament_evidence_record_id = ?
        `, [tournamentInternalId, reviewerInternalId, input.nowMs, input.nowMs, Number(record["id"])]);
      } else {
        for (const entry of input.entries) {
          await connection.execute(`
            UPDATE tournament_incoming_results
               SET suggested_phase = ?, suggested_group_public_id = ?,
                   suggested_race_number = ?, semantic_fingerprint = ?,
                   revision = revision + 1, updated_at_ms = ?
             WHERE evidence_record_id = ? AND evidence_entry_key = ? AND status = 'pending'
          `, [
            entry.suggestedPhase, entry.suggestedGroupId, entry.suggestedRaceNumber,
            entry.semanticFingerprint, input.nowMs, Number(record["id"]), entry.entryKey,
          ]);
        }
        await connection.execute(`
          UPDATE tournament_evidence_records
             SET revision = revision + 1, linked_by_user_account_id = ?,
                 linked_at_ms = ?, updated_at_ms = ?
           WHERE tournament_evidence_record_id = ?
        `, [reviewerInternalId, input.nowMs, input.nowMs, Number(record["id"])]);
      }
      const [sequenceRows] = await connection.execute<RowDataPacket[]>(
        "SELECT COALESCE(MAX(sequence_number), 0) AS latest FROM tournament_lifecycle WHERE tournament_id = ? FOR UPDATE",
        [tournamentInternalId],
      );
      await connection.execute(`
        INSERT INTO tournament_lifecycle (
          tournament_id, sequence_number, event_type, detail,
          actor_user_account_id, occurred_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?)
      `, [
        tournamentInternalId, Number(sequenceRows[0]?.["latest"] ?? 0) + 1,
        existingLink === null ? "evidence_record_linked" : "evidence_record_remapped",
        `${input.recordId}|${input.reason}`.slice(0, 255), reviewerInternalId, input.nowMs,
      ]);
      // Reads the rows this transaction has just written, so it must run on
      // the same connection rather than on a fresh one from the pool.
      const [rows] = await connection.execute<IncomingRow[]>(`
        ${incomingProjection}
         WHERE evidence.public_id = ?
         ORDER BY ir.created_at_ms, ir.tournament_incoming_result_id
      `, [input.recordId]);
      return rows.map(mapIncoming);
    });
  }

  public async insertIncomingResult(input: Parameters<TournamentConnectedRepository["insertIncomingResult"]>[0]): Promise<IncomingTournamentResult> {
    await this.reader.execute(`
      INSERT INTO tournament_incoming_results (
        public_id, tournament_id, source_kind, status, revision,
        result_payload_json, semantic_fingerprint, suggested_phase,
        suggested_group_public_id, suggested_race_number, occurred_at_ms,
        captured_at_ms, submitted_by_user_account_id, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, 'pending', 1, ?, ?, ?, ?, ?, ?, ?,
        (SELECT user_account_id FROM user_accounts WHERE public_id = ? AND account_status = 'active' LIMIT 1), ?, ?)
      ON DUPLICATE KEY UPDATE public_id = public_id
    `, [
      input.incomingResultId,
      input.tournamentInternalId,
      input.sourceKind,
      JSON.stringify(input.result),
      input.semanticFingerprint,
      input.suggestedPhase,
      input.suggestedGroupId,
      input.suggestedRaceNumber,
      input.occurredAtMs,
      input.capturedAtMs,
      input.submittedByUserAccountId,
      input.nowMs,
      input.nowMs,
    ]);
    const result = await this.findIncomingResult(input.incomingResultId);
    if (result === null) throw new Error("Inserted incoming Tournament result could not be loaded.");
    return result;
  }

  public async listIncomingResults(tournamentId: string): Promise<readonly IncomingTournamentResult[]> {
    const [rows] = await this.reader.execute<IncomingRow[]>(`
      ${incomingProjection}
       WHERE t.public_id = ?
       ORDER BY CASE ir.status WHEN 'pending' THEN 0 ELSE 1 END, ir.created_at_ms ASC, ir.tournament_incoming_result_id ASC
    `, [tournamentId]);
    return rows.map(mapIncoming);
  }

  public async findIncomingResult(incomingResultId: string): Promise<IncomingTournamentResult | null> {
    const [rows] = await this.reader.execute<IncomingRow[]>(`
      ${incomingProjection}
       WHERE ir.public_id = ?
       LIMIT 1
    `, [incomingResultId]);
    return rows.length === 0 ? null : mapIncoming(rows[0]!);
  }

  public async findIncomingByFingerprint(tournamentId: string, fingerprint: string): Promise<IncomingTournamentResult | null> {
    const [rows] = await this.reader.execute<IncomingRow[]>(`
      ${incomingProjection}
       WHERE t.public_id = ? AND ir.semantic_fingerprint = ?
       ORDER BY ir.created_at_ms, ir.tournament_incoming_result_id
       LIMIT 1
    `, [tournamentId, fingerprint]);
    return rows.length === 0 ? null : mapIncoming(rows[0]!);
  }

  public async hasAcceptedFingerprint(tournamentId: string, fingerprint: string, excludingId: string): Promise<boolean> {
    const [rows] = await this.reader.execute<RowDataPacket[]>(`
      SELECT 1
        FROM tournament_incoming_results ir
        JOIN tournaments t ON t.tournament_id = ir.tournament_id
       WHERE t.public_id = ?
         AND ir.semantic_fingerprint = ?
         AND ir.public_id <> ?
         AND ir.status = 'accepted'
       LIMIT 1
    `, [tournamentId, fingerprint, excludingId]);
    return rows.length > 0;
  }

  public async hasGroupRace(tournamentId: string, groupId: string, raceNumber: number): Promise<boolean> {
    const [rows] = await this.reader.execute<RowDataPacket[]>(`
      SELECT 1
        FROM tournament_group_races gr
        JOIN tournament_groups g ON g.tournament_group_id = gr.tournament_group_id
        JOIN tournaments t ON t.tournament_id = g.tournament_id
       WHERE t.public_id = ? AND g.public_id = ? AND gr.race_number = ?
       LIMIT 1
    `, [tournamentId, groupId, raceNumber]);
    return rows.length > 0;
  }

  public async groupMemberPlayerIds(
    tournamentId: string,
    groupId: string,
  ): Promise<readonly string[]> {
    const [rows] = await this.reader.execute<RowDataPacket[]>(`
      SELECT player.public_id AS player_public_id
        FROM tournament_group_members member
        JOIN tournament_groups grp
          ON grp.tournament_group_id = member.tournament_group_id
        JOIN tournaments tournament
          ON tournament.tournament_id = grp.tournament_id
        JOIN players player
          ON player.player_id = member.player_id
       WHERE tournament.public_id = ? AND grp.public_id = ?
    `, [tournamentId, groupId]);
    return rows.map((row) => String(row["player_public_id"]));
  }

  public async groupMemberMatchNames(
    tournamentId: string,
    groupId: string,
  ): Promise<readonly { playerId: string; names: readonly string[] }[]> {
    const [rows] = await this.reader.execute<RowDataPacket[]>(`
      SELECT player.public_id AS player_public_id,
             player.display_name,
             username.username_value,
             GROUP_CONCAT(DISTINCT alias.alias_text SEPARATOR '\n') AS alias_list
        FROM tournament_group_members member
        JOIN tournament_groups grp
          ON grp.tournament_group_id = member.tournament_group_id
        JOIN tournaments tournament
          ON tournament.tournament_id = grp.tournament_id
        JOIN players player
          ON player.player_id = member.player_id
        LEFT JOIN player_username_history username
          ON username.current_player_id = player.player_id
        LEFT JOIN aliases alias
          ON alias.player_id = player.player_id
         AND alias.record_status = 'active'
         AND alias.visibility = 'public'
       WHERE tournament.public_id = ? AND grp.public_id = ?
       GROUP BY player.player_id, player.public_id, player.display_name, username.username_value
       ORDER BY player.player_id
    `, [tournamentId, groupId]);
    return rows.map((row) => ({
      playerId: String(row["player_public_id"]),
      names: [
        String(row["display_name"]),
        ...(typeof row["username_value"] === "string" ? [row["username_value"]] : []),
        ...(typeof row["alias_list"] === "string" ? row["alias_list"].split("\n") : []),
      ].map((name) => name.trim()).filter((name) => name.length > 0),
    }));
  }

  public async markAccepted(input: Parameters<TournamentConnectedRepository["markAccepted"]>[0]): Promise<void> {
    return this.unit(async (connection) => {
      const [raceRows] = await connection.execute<RowDataPacket[]>(
        "SELECT tournament_race_result_id AS id FROM tournament_race_results WHERE public_id = ? LIMIT 1",
        [input.raceResultId],
      );
      const [reviewerRows] = await connection.execute<RowDataPacket[]>(
        "SELECT user_account_id AS id FROM user_accounts WHERE public_id = ? AND account_status = 'active' LIMIT 1",
        [input.reviewedByUserAccountId],
      );
      if (raceRows.length === 0 || reviewerRows.length === 0) throw new Error("Accepted Tournament result audit references were not found.");
      const raceInternalId = Number(raceRows[0]?.["id"]);
      const reviewerInternalId = Number(reviewerRows[0]?.["id"]);
      const [result] = await connection.execute<ResultSetHeader>(`
        UPDATE tournament_incoming_results
           SET status = 'accepted', revision = revision + 1,
               accepted_race_result_id = ?, accepted_at_ms = ?, review_reason = ?,
               reviewed_by_user_account_id = ?, updated_at_ms = ?
         WHERE public_id = ? AND revision = ? AND status = 'pending'
      `, [raceInternalId, input.nowMs, input.reviewReason, reviewerInternalId, input.nowMs, input.incomingResultId, input.expectedRevision]);
      if (result.affectedRows !== 1) {
        throw new TournamentOperationError("conflict", "The pending result changed before it was accepted.");
      }
      await connection.execute(`
        INSERT INTO tournament_incoming_result_reviews (
          tournament_incoming_result_id, action, actor_user_account_id,
          reason, race_result_id, occurred_at_ms
        ) SELECT tournament_incoming_result_id, 'accepted', ?, ?, ?, ?
            FROM tournament_incoming_results WHERE public_id = ?
      `, [reviewerInternalId, input.reviewReason, raceInternalId, input.nowMs, input.incomingResultId]);
    });
  }

  public async markRejected(input: Parameters<TournamentConnectedRepository["markRejected"]>[0]): Promise<void> {
    return this.unit(async (connection) => {
      const [reviewerRows] = await connection.execute<RowDataPacket[]>(
        "SELECT user_account_id AS id FROM user_accounts WHERE public_id = ? AND account_status = 'active' LIMIT 1",
        [input.reviewedByUserAccountId],
      );
      if (reviewerRows.length !== 1) throw new Error("Rejected Tournament result reviewer was not found.");
      const reviewerInternalId = Number(reviewerRows[0]?.["id"]);
      const [result] = await connection.execute<ResultSetHeader>(`
        UPDATE tournament_incoming_results
           SET status = 'rejected', revision = revision + 1,
               rejected_at_ms = ?, review_reason = ?, reviewed_by_user_account_id = ?, updated_at_ms = ?
         WHERE public_id = ? AND revision = ? AND status = 'pending'
      `, [input.nowMs, input.reviewReason, reviewerInternalId, input.nowMs, input.incomingResultId, input.expectedRevision]);
      if (result.affectedRows !== 1) {
        throw new TournamentOperationError("conflict", "The pending result changed before it was rejected.");
      }
      await connection.execute(`
        INSERT INTO tournament_incoming_result_reviews (
          tournament_incoming_result_id, action, actor_user_account_id,
          reason, race_result_id, occurred_at_ms
        ) SELECT tournament_incoming_result_id, 'rejected', ?, ?, NULL, ?
            FROM tournament_incoming_results WHERE public_id = ?
      `, [reviewerInternalId, input.reviewReason, input.nowMs, input.incomingResultId]);
    });
  }
}
