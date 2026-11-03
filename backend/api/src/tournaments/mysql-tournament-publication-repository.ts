import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";

import {
  TournamentPublicationServiceError,
  type CreateTournamentPublicationInput,
  type RepublishTournamentPublicationInput,
  type RetractTournamentPublicationInput,
  type TournamentPublicationCandidate,
  type TournamentPublicationRepository,
  type TournamentPublicationReview,
  type TournamentPublicationSnapshot,
  type TournamentPublicationTarget,
} from "./tournament-publication-service.js";
import { isTournamentRaceMode } from "./race-result-validation.js";

interface PublicationRow extends RowDataPacket {
  publicationInternalId: unknown;
  publicationId: unknown;
  eventName: unknown;
  statusValue: unknown;
  revisionValue: unknown;
  resultCount: unknown;
  publishedAtMs: unknown;
  updatedAtMs: unknown;
}

interface CandidateRow extends RowDataPacket {
  raceResultId: unknown;
  currentRevision: unknown;
  raceNumber: unknown;
  scoringSegment: unknown;
  trackId: unknown;
  modeValue: unknown;
  mirrorValue: unknown;
  occurredAtMs: unknown;
  placementCount: unknown;
  centralPlayerCount: unknown;
  activePlayerCount: unknown;
  currentPublicationId: unknown;
}

interface InternalResultRow extends RowDataPacket {
  resultInternalId: unknown;
  raceResultId: unknown;
}

interface InternalRevisionRow extends RowDataPacket {
  resultInternalId: unknown;
  revisionInternalId: unknown;
  revisionValue: unknown;
}

interface PlacementRow extends RowDataPacket {
  revisionInternalId: unknown;
  participantKind: unknown;
  playerStatus: unknown;
  playerKind: unknown;
}

interface ConflictRow extends RowDataPacket { resultInternalId: unknown }
interface AuthorizationRow extends RowDataPacket { authorized: unknown }

type ResolvedTarget = Readonly<{
  raceResultId: string;
  resultInternalId: number;
  revision: number;
  revisionInternalId: number;
}>;

export class TournamentPublicationPersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TournamentPublicationPersistenceError";
  }
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TournamentPublicationPersistenceError(`${field} is invalid`);
  }
  return value;
}

function integer(value: unknown, field: string, minimum = 0): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new TournamentPublicationPersistenceError(`${field} is invalid`);
  }
  return parsed;
}

function optionalInteger(value: unknown, field: string): number | undefined {
  return value === null ? undefined : integer(value, field);
}

function duplicate(error: unknown): boolean {
  if (typeof error !== "object" || error === null) { return false; }
  const candidate = error as { code?: unknown; errno?: unknown };
  return candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062;
}

function placeholders(count: number): string {
  if (count < 1 || count > 200) {
    throw new TournamentPublicationPersistenceError("placeholder count is invalid");
  }
  return Array.from({ length: count }, () => "?").join(", ");
}

function snapshot(row: PublicationRow): TournamentPublicationSnapshot {
  const status = text(row.statusValue, "publication status");
  if (status !== "published" && status !== "retracted") {
    throw new TournamentPublicationPersistenceError("publication status is unsupported");
  }
  const publishedAtMs = optionalInteger(row.publishedAtMs, "published timestamp");
  if ((status === "published") !== (publishedAtMs !== undefined)) {
    throw new TournamentPublicationPersistenceError("publication timestamp is inconsistent");
  }
  return {
    publicationId: text(row.publicationId, "publication ID"),
    eventName: text(row.eventName, "event name"),
    status,
    revision: integer(row.revisionValue, "publication revision", 1),
    resultCount: integer(row.resultCount, "result count"),
    ...(publishedAtMs === undefined ? {} : { publishedAtMs }),
    updatedAtMs: integer(row.updatedAtMs, "updated timestamp"),
  };
}

/** A Mirror race (ADR-0217): the column holds 1 or NULL. */
function mirrorFlag(value: unknown): boolean {
  return value !== null && value !== undefined && Number(value) === 1;
}

function candidate(row: CandidateRow): TournamentPublicationCandidate {
  const modeValue = optionalInteger(row.modeValue, "mode");
  if (modeValue !== undefined && !isTournamentRaceMode(modeValue)) {
    throw new TournamentPublicationPersistenceError("mode is unsupported");
  }
  const placementCount = integer(row.placementCount, "placement count", 1);
  const centralPlayerCount = integer(row.centralPlayerCount, "central Player count");
  const activePlayerCount = integer(row.activePlayerCount, "active Player count");
  const currentPublicationId = row.currentPublicationId === null
    ? undefined
    : text(row.currentPublicationId, "current publication ID");
  const occurredAtMs = optionalInteger(row.occurredAtMs, "occurred timestamp");
  return {
    raceResultId: text(row.raceResultId, "race result ID"),
    currentRevision: integer(row.currentRevision, "current revision", 1),
    raceNumber: integer(row.raceNumber, "race number", 1),
    scoringSegment: integer(row.scoringSegment, "scoring segment", 1),
    trackId: text(row.trackId, "track ID"),
    ...(modeValue === undefined ? {} : { mode: modeValue }),
    ...(mirrorFlag(row.mirrorValue) ? { mirror: true as const } : {}),
    ...(occurredAtMs === undefined ? {} : { occurredAtMs }),
    placementCount,
    publishable: centralPlayerCount === placementCount &&
      activePlayerCount === placementCount,
    ...(currentPublicationId === undefined ? {} : { currentPublicationId }),
  };
}

const publicationProjection = `SELECT publication.tournament_publication_id AS publicationInternalId,
       publication.public_id AS publicationId,
       publication.event_name AS eventName,
       publication.publication_status AS statusValue,
       publication.publication_revision AS revisionValue,
       COUNT(current_member.tournament_publication_current_member_id) AS resultCount,
       publication.published_at_ms AS publishedAtMs,
       publication.updated_at_ms AS updatedAtMs
FROM tournament_publications AS publication
LEFT JOIN tournament_publication_current_members AS current_member
  ON current_member.tournament_publication_id = publication.tournament_publication_id`;

async function assertAdministrator(
  connection: PoolConnection,
  userAccountId: string,
): Promise<void> {
  const [rows] = await connection.execute<AuthorizationRow[]>(
    `SELECT 1 AS authorized
     FROM user_accounts AS account
     INNER JOIN administrator_grants AS administrator_grant
       ON administrator_grant.user_account_id = account.user_account_id
      AND administrator_grant.grant_status = 'active'
     WHERE account.public_id = ? AND account.account_status = 'active'
     LIMIT 1 FOR UPDATE`,
    [userAccountId],
  );
  if (rows.length !== 1 || integer(rows[0]?.authorized, "administrator authority", 1) !== 1) {
    throw new TournamentPublicationServiceError("forbidden");
  }
}

async function resolveTargets(
  connection: PoolConnection,
  targets: readonly TournamentPublicationTarget[],
  excludedPublicationInternalId?: number,
): Promise<readonly ResolvedTarget[]> {
  const requestedIds = targets.map((target) => target.raceResultId);
  const [resultRows] = await connection.execute<InternalResultRow[]>(
    `SELECT tournament_race_result_id AS resultInternalId, public_id AS raceResultId
     FROM tournament_race_results
     WHERE public_id IN (${placeholders(requestedIds.length)})
     ORDER BY tournament_race_result_id FOR UPDATE`,
    requestedIds,
  );
  if (resultRows.length !== targets.length) {
    throw new TournamentPublicationServiceError("not_found");
  }
  const internalByPublic = new Map<string, number>();
  for (const row of resultRows) {
    internalByPublic.set(
      text(row.raceResultId, "race result ID"),
      integer(row.resultInternalId, "race result internal ID", 1),
    );
  }
  const internalIds = targets.map((target) => internalByPublic.get(target.raceResultId));
  if (internalIds.some((value) => value === undefined)) {
    throw new TournamentPublicationPersistenceError("race result mapping is incomplete");
  }
  const ids = internalIds as number[];
  const [revisionRows] = await connection.execute<InternalRevisionRow[]>(
    `SELECT tournament_race_result_id AS resultInternalId,
            tournament_race_result_revision_id AS revisionInternalId,
            revision_number AS revisionValue
     FROM tournament_race_result_revisions
     WHERE tournament_race_result_id IN (${placeholders(ids.length)})
     ORDER BY tournament_race_result_id, revision_number FOR UPDATE`,
    ids,
  );
  const revisions = new Map<number, InternalRevisionRow[]>();
  for (const row of revisionRows) {
    const resultInternalId = integer(row.resultInternalId, "revision result ID", 1);
    const values = revisions.get(resultInternalId) ?? [];
    values.push(row);
    revisions.set(resultInternalId, values);
  }
  const resolved = targets.map((target): ResolvedTarget => {
    const resultInternalId = internalByPublic.get(target.raceResultId)!;
    const values = revisions.get(resultInternalId) ?? [];
    const latest = values.at(-1);
    const selected = values.find(
      (row) => integer(row.revisionValue, "revision", 1) === target.revision,
    );
    if (latest === undefined || selected === undefined) {
      throw new TournamentPublicationServiceError("not_found");
    }
    if (integer(latest.revisionValue, "latest revision", 1) !== target.revision) {
      throw new TournamentPublicationServiceError("conflict");
    }
    return {
      raceResultId: target.raceResultId,
      resultInternalId,
      revision: target.revision,
      revisionInternalId: integer(
        selected.revisionInternalId,
        "revision internal ID",
        1,
      ),
    };
  });
  const revisionIds = resolved.map((target) => target.revisionInternalId);
  const [placementRows] = await connection.execute<PlacementRow[]>(
    `SELECT placement.tournament_race_result_revision_id AS revisionInternalId,
            placement.participant_reference_kind AS participantKind,
            player.record_status AS playerStatus,
            player.player_kind AS playerKind
     FROM tournament_race_placements AS placement
     LEFT JOIN players AS player ON player.player_id = placement.player_id
     WHERE placement.tournament_race_result_revision_id IN (
       ${placeholders(revisionIds.length)}
     ) ORDER BY placement.tournament_race_result_revision_id,
                placement.finish_position FOR UPDATE`,
    revisionIds,
  );
  const placements = new Map<number, PlacementRow[]>();
  for (const row of placementRows) {
    const revisionInternalId = integer(row.revisionInternalId, "placement revision ID", 1);
    const values = placements.get(revisionInternalId) ?? [];
    values.push(row);
    placements.set(revisionInternalId, values);
  }
  for (const target of resolved) {
    const values = placements.get(target.revisionInternalId) ?? [];
    if (values.length < 1 || values.some((row) =>
      row.participantKind !== "player" || row.playerKind !== "human" ||
      row.playerStatus !== "active")) {
      throw new TournamentPublicationServiceError("conflict");
    }
  }
  const conflictParameters: Array<string | number> = [...ids];
  let exclusion = "";
  if (excludedPublicationInternalId !== undefined) {
    exclusion = " AND tournament_publication_id <> ?";
    conflictParameters.push(excludedPublicationInternalId);
  }
  const [conflicts] = await connection.execute<ConflictRow[]>(
    `SELECT tournament_race_result_id AS resultInternalId
     FROM tournament_publication_current_members
     WHERE tournament_race_result_id IN (${placeholders(ids.length)})${exclusion}
     LIMIT 1 FOR UPDATE`,
    conflictParameters,
  );
  if (conflicts.length > 0) {
    throw new TournamentPublicationServiceError("conflict");
  }
  return resolved;
}

async function insertLifecycle(
  connection: PoolConnection,
  input: Readonly<{
    publicationInternalId: number;
    revision: number;
    eventType: "published" | "retracted";
    eventName: string;
    actorUserAccountId: string;
    reasonCode: string;
    occurredAtMs: number;
  }>,
): Promise<number> {
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO tournament_publication_lifecycle (
       tournament_publication_id, publication_revision, event_type,
       publication_status_after, event_name_after, actor_user_account_id,
       reason_code, occurred_at_ms
     ) SELECT ?, ?, ?, ?, ?, account.user_account_id, ?, ?
       FROM user_accounts AS account WHERE account.public_id = ?`,
    [
      input.publicationInternalId,
      input.revision,
      input.eventType,
      input.eventType === "published" ? "published" : "retracted",
      input.eventName,
      input.reasonCode,
      input.occurredAtMs,
      input.actorUserAccountId,
    ],
  );
  if (result.affectedRows !== 1 || result.insertId < 1) {
    throw new TournamentPublicationPersistenceError("publication lifecycle was not appended");
  }
  return result.insertId;
}

async function insertMembers(
  connection: PoolConnection,
  publicationInternalId: number,
  lifecycleInternalId: number,
  targets: readonly ResolvedTarget[],
): Promise<void> {
  for (const [index, target] of targets.entries()) {
    const values = [index + 1, target.resultInternalId, target.revisionInternalId];
    const [history] = await connection.execute<ResultSetHeader>(
      `INSERT INTO tournament_publication_lifecycle_members (
         tournament_publication_lifecycle_id, sequence_number,
         tournament_race_result_id, tournament_race_result_revision_id
       ) VALUES (?, ?, ?, ?)`,
      [lifecycleInternalId, ...values],
    );
    const [current] = await connection.execute<ResultSetHeader>(
      `INSERT INTO tournament_publication_current_members (
         tournament_publication_id, sequence_number,
         tournament_race_result_id, tournament_race_result_revision_id
       ) VALUES (?, ?, ?, ?)`,
      [publicationInternalId, ...values],
    );
    if (history.affectedRows !== 1 || current.affectedRows !== 1) {
      throw new TournamentPublicationPersistenceError("publication member was not inserted");
    }
  }
}

async function lockedPublication(
  connection: PoolConnection,
  publicationId: string,
): Promise<PublicationRow | null> {
  const [rows] = await connection.execute<PublicationRow[]>(
    `${publicationProjection}
     WHERE publication.public_id = ?
     GROUP BY publication.tournament_publication_id
     LIMIT 1 FOR UPDATE`,
    [publicationId],
  );
  if (rows.length === 0) { return null; }
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new TournamentPublicationPersistenceError("publication lookup is ambiguous");
  }
  return rows[0];
}

export class MysqlTournamentPublicationRepository
implements TournamentPublicationRepository {
  public constructor(private readonly pool: Pool) {}

  public async listReview(): Promise<TournamentPublicationReview> {
    const [publicationRows] = await this.pool.execute<PublicationRow[]>(
      `${publicationProjection}
       GROUP BY publication.tournament_publication_id
       ORDER BY publication.updated_at_ms DESC, publication.public_id ASC
       LIMIT 100`,
    );
    const [candidateRows] = await this.pool.execute<CandidateRow[]>(
      `WITH latest AS (
         SELECT tournament_race_result_id, MAX(revision_number) AS currentRevision
         FROM tournament_race_result_revisions GROUP BY tournament_race_result_id
       )
       SELECT result.public_id AS raceResultId,
              revision.revision_number AS currentRevision,
              revision.race_number AS raceNumber,
              revision.scoring_segment AS scoringSegment,
              revision.track_id AS trackId, revision.mode_cc AS modeValue,
              revision.mirror AS mirrorValue,
              revision.occurred_at_ms AS occurredAtMs,
              COUNT(placement.tournament_race_placement_id) AS placementCount,
              SUM(placement.participant_reference_kind = 'player') AS centralPlayerCount,
              SUM(placement.participant_reference_kind = 'player'
                  AND player.player_kind = 'human'
                  AND player.record_status = 'active') AS activePlayerCount,
              publication.public_id AS currentPublicationId
       FROM tournament_race_results AS result
       INNER JOIN latest ON latest.tournament_race_result_id = result.tournament_race_result_id
       INNER JOIN tournament_race_result_revisions AS revision
         ON revision.tournament_race_result_id = result.tournament_race_result_id
        AND revision.revision_number = latest.currentRevision
       INNER JOIN tournament_race_placements AS placement
         ON placement.tournament_race_result_revision_id =
            revision.tournament_race_result_revision_id
       LEFT JOIN players AS player ON player.player_id = placement.player_id
       LEFT JOIN tournament_publication_current_members AS current_member
         ON current_member.tournament_race_result_id = result.tournament_race_result_id
       LEFT JOIN tournament_publications AS publication
         ON publication.tournament_publication_id = current_member.tournament_publication_id
       GROUP BY result.tournament_race_result_id,
                revision.tournament_race_result_revision_id,
                publication.tournament_publication_id
       ORDER BY COALESCE(revision.occurred_at_ms, revision.created_at_ms) DESC,
                result.public_id ASC LIMIT 200`,
    );
    return {
      publications: publicationRows.map(snapshot),
      candidates: candidateRows.map(candidate),
    };
  }

  public async create(
    input: CreateTournamentPublicationInput,
  ): Promise<TournamentPublicationSnapshot> {
    return this.transaction(async (connection) => {
      await assertAdministrator(connection, input.actorUserAccountId);
      const targets = await resolveTargets(connection, input.targets);
      const [created] = await connection.execute<ResultSetHeader>(
        `INSERT INTO tournament_publications (
           public_id, event_name, publication_revision, publication_status,
           published_at_ms, updated_at_ms
         ) VALUES (?, ?, 1, 'published', ?, ?)`,
        [input.publicationId, input.eventName, input.occurredAtMs, input.occurredAtMs],
      );
      if (created.affectedRows !== 1 || created.insertId < 1) {
        throw new TournamentPublicationPersistenceError("publication was not created");
      }
      const lifecycleId = await insertLifecycle(connection, {
        publicationInternalId: created.insertId,
        revision: 1,
        eventType: "published",
        eventName: input.eventName,
        actorUserAccountId: input.actorUserAccountId,
        reasonCode: input.reasonCode,
        occurredAtMs: input.occurredAtMs,
      });
      await insertMembers(connection, created.insertId, lifecycleId, targets);
      return {
        publicationId: input.publicationId,
        eventName: input.eventName,
        status: "published",
        revision: 1,
        resultCount: targets.length,
        publishedAtMs: input.occurredAtMs,
        updatedAtMs: input.occurredAtMs,
      };
    });
  }

  public async republish(
    input: RepublishTournamentPublicationInput,
  ): Promise<TournamentPublicationSnapshot> {
    return this.transaction(async (connection) => {
      await assertAdministrator(connection, input.actorUserAccountId);
      const currentRow = await lockedPublication(connection, input.publicationId);
      if (currentRow === null) { throw new TournamentPublicationServiceError("not_found"); }
      const current = snapshot(currentRow);
      if (current.revision !== input.expectedRevision) {
        throw new TournamentPublicationServiceError("conflict");
      }
      const publicationInternalId = integer(
        currentRow.publicationInternalId,
        "publication internal ID",
        1,
      );
      const targets = await resolveTargets(
        connection,
        input.targets,
        publicationInternalId,
      );
      const nextRevision = current.revision + 1;
      const [updated] = await connection.execute<ResultSetHeader>(
        `UPDATE tournament_publications
         SET event_name = ?, publication_revision = ?, publication_status = 'published',
             published_at_ms = ?, updated_at_ms = ?
         WHERE tournament_publication_id = ? AND publication_revision = ?`,
        [
          input.eventName,
          nextRevision,
          input.occurredAtMs,
          input.occurredAtMs,
          publicationInternalId,
          current.revision,
        ],
      );
      if (updated.affectedRows !== 1) {
        throw new TournamentPublicationServiceError("conflict");
      }
      await connection.execute<ResultSetHeader>(
        `DELETE FROM tournament_publication_current_members
         WHERE tournament_publication_id = ?`,
        [publicationInternalId],
      );
      const lifecycleId = await insertLifecycle(connection, {
        publicationInternalId,
        revision: nextRevision,
        eventType: "published",
        eventName: input.eventName,
        actorUserAccountId: input.actorUserAccountId,
        reasonCode: input.reasonCode,
        occurredAtMs: input.occurredAtMs,
      });
      await insertMembers(connection, publicationInternalId, lifecycleId, targets);
      return {
        publicationId: input.publicationId,
        eventName: input.eventName,
        status: "published",
        revision: nextRevision,
        resultCount: targets.length,
        publishedAtMs: input.occurredAtMs,
        updatedAtMs: input.occurredAtMs,
      };
    });
  }

  public async retract(
    input: RetractTournamentPublicationInput,
  ): Promise<TournamentPublicationSnapshot> {
    return this.transaction(async (connection) => {
      await assertAdministrator(connection, input.actorUserAccountId);
      const currentRow = await lockedPublication(connection, input.publicationId);
      if (currentRow === null) { throw new TournamentPublicationServiceError("not_found"); }
      const current = snapshot(currentRow);
      if (current.revision !== input.expectedRevision || current.status !== "published") {
        throw new TournamentPublicationServiceError("conflict");
      }
      const publicationInternalId = integer(
        currentRow.publicationInternalId,
        "publication internal ID",
        1,
      );
      const nextRevision = current.revision + 1;
      const [updated] = await connection.execute<ResultSetHeader>(
        `UPDATE tournament_publications
         SET publication_revision = ?, publication_status = 'retracted',
             published_at_ms = NULL, updated_at_ms = ?
         WHERE tournament_publication_id = ? AND publication_revision = ?
           AND publication_status = 'published'`,
        [nextRevision, input.occurredAtMs, publicationInternalId, current.revision],
      );
      if (updated.affectedRows !== 1) {
        throw new TournamentPublicationServiceError("conflict");
      }
      await connection.execute<ResultSetHeader>(
        `DELETE FROM tournament_publication_current_members
         WHERE tournament_publication_id = ?`,
        [publicationInternalId],
      );
      await insertLifecycle(connection, {
        publicationInternalId,
        revision: nextRevision,
        eventType: "retracted",
        eventName: current.eventName,
        actorUserAccountId: input.actorUserAccountId,
        reasonCode: input.reasonCode,
        occurredAtMs: input.occurredAtMs,
      });
      return {
        publicationId: input.publicationId,
        eventName: current.eventName,
        status: "retracted",
        revision: nextRevision,
        resultCount: 0,
        updatedAtMs: input.occurredAtMs,
      };
    });
  }

  private async transaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      if (duplicate(error)) {
        throw new TournamentPublicationServiceError("conflict");
      }
      throw error;
    } finally {
      connection.release();
    }
  }
}
