import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";

import {
  ClaimLifecycleError,
  type AppendClaimEventInput,
  type ClaimLifecycleEventInput,
  type ClaimNoteInput,
  type ClaimSnapshot,
  type ClaimWriteRepository,
  type ClaimWriteTransaction,
  type CreateClaimInput,
  type EvidenceAccessActor,
} from "./claim-lifecycle-service.js";
import type { AccountStatus, ClaimStatus, DisputeStatus } from "./types.js";

interface StatusRow extends RowDataPacket {
  statusValue: unknown;
}

interface ClaimRow extends RowDataPacket {
  playerClaimId: unknown;
  playerId: unknown;
  userAccountId: unknown;
  claimStatus: unknown;
  disputeStatus: unknown;
  revision: unknown;
  lastSequence: unknown;
}

interface EvidenceRow extends RowDataPacket {
  evidenceId: unknown;
}

interface SharedTournamentRow extends RowDataPacket {
  label: string;
}

interface ExistsRow extends RowDataPacket {
  present: unknown;
}

const accountStatuses = new Set<AccountStatus>(["active", "suspended", "closed"]);
const claimStatuses = new Set<ClaimStatus>([
  "requested",
  "under_review",
  "verified",
  "rejected",
  "released",
  "revoked",
]);
const disputeStatuses = new Set<DisputeStatus>(["none", "open", "resolved"]);

export class ClaimPersistenceContractError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ClaimPersistenceContractError";
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ClaimPersistenceContractError(`${field} has an invalid persisted value`);
  }
  return value;
}

function requiredEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: ReadonlySet<T>,
): T {
  const text = requiredString(value, field);
  if (!allowed.has(text as T)) {
    throw new ClaimPersistenceContractError(`${field} has an unsupported persisted value`);
  }
  return text as T;
}

function requiredSafeInteger(value: unknown, field: string): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (
    typeof numeric !== "number" ||
    !Number.isSafeInteger(numeric) ||
    numeric < 0
  ) {
    throw new ClaimPersistenceContractError(`${field} has an invalid persisted value`);
  }
  return numeric;
}

function singleRow<T extends RowDataPacket>(rows: T[], resource: string): T | null {
  if (rows.length === 0) {
    return null;
  }
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new ClaimPersistenceContractError(
      `${resource} lookup returned an invalid row count`,
    );
  }
  return rows[0];
}

function placeholders(count: number): string {
  if (count < 1) {
    throw new ClaimPersistenceContractError("empty identifier list has no SQL form");
  }
  return Array.from({ length: count }, () => "?").join(", ");
}

function isDuplicateKeyError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; errno?: unknown };
  return candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062;
}

function assertAffected(result: ResultSetHeader, expected: number, operation: string): void {
  if (result.affectedRows !== expected) {
    throw new ClaimLifecycleError("conflict", `${operation} could not be completed`);
  }
}

function reviewDecision(
  eventType: ClaimLifecycleEventInput["eventType"],
): "started" | "verified" | "rejected" | "released" | "revoked" | "dispute_resolved" {
  const decisions = {
    review_started: "started",
    claim_verified: "verified",
    claim_rejected: "rejected",
    claim_released: "released",
    claim_revoked: "revoked",
    dispute_resolved: "dispute_resolved",
  } as const;
  const decision = decisions[eventType as keyof typeof decisions];
  if (decision === undefined) {
    throw new ClaimPersistenceContractError(
      "administrator review reference has an unsupported event type",
    );
  }
  return decision;
}

/**
 * A Tournament in which the target Player met a Player the account owns through a verified claim
 * (ADR-0178): current Tournaments, legacy races and history editions. Shared with the review card,
 * which states the conflict before the reviewer decides.
 */
const ownedPlayersSql = `SELECT c.player_id FROM player_claims AS c
  INNER JOIN user_accounts AS a ON a.user_account_id = c.user_account_id
  WHERE a.public_id = ? AND c.claim_status = 'verified'`;
const targetPlayerSql = "(SELECT p.player_id FROM players AS p WHERE p.public_id = ?)";
export const SHARED_TOURNAMENT_SQL = `SELECT shared.label FROM (
         SELECT t.name AS label
         FROM tournament_participants AS mine
         INNER JOIN tournament_participants AS other ON other.tournament_id = mine.tournament_id
         INNER JOIN tournaments AS t ON t.tournament_id = mine.tournament_id
         WHERE mine.player_id = ${targetPlayerSql} AND other.player_id IN (${ownedPlayersSql}) AND other.player_id <> mine.player_id
         UNION ALL
         SELECT CONCAT('TN', mine_race.tournament_number) AS label
         FROM legacy_race_placements AS mine
         INNER JOIN legacy_tournament_races AS mine_race
           ON mine_race.legacy_tournament_race_id = mine.legacy_tournament_race_id
         INNER JOIN legacy_tournament_races AS other_race ON other_race.tournament_number = mine_race.tournament_number
         INNER JOIN legacy_race_placements AS other
           ON other.legacy_tournament_race_id = other_race.legacy_tournament_race_id
         WHERE mine.player_id = ${targetPlayerSql} AND other.player_id IN (${ownedPlayersSql}) AND other.player_id <> mine.player_id
         UNION ALL
         SELECT CONCAT('TN', mine_section.tournament_number) AS label
         FROM tournament_history_placements AS mine
         INNER JOIN tournament_history_races AS mine_race
           ON mine_race.tournament_history_race_id = mine.tournament_history_race_id
         INNER JOIN tournament_history_sections AS mine_section
           ON mine_section.tournament_history_section_id = mine_race.tournament_history_section_id
         INNER JOIN tournament_history_sections AS other_section
           ON other_section.tournament_number = mine_section.tournament_number
         INNER JOIN tournament_history_races AS other_race
           ON other_race.tournament_history_section_id = other_section.tournament_history_section_id
         INNER JOIN tournament_history_placements AS other
           ON other.tournament_history_race_id = other_race.tournament_history_race_id
         WHERE mine.player_id = ${targetPlayerSql} AND other.player_id IN (${ownedPlayersSql}) AND other.player_id <> mine.player_id
       ) AS shared
       LIMIT 1`;

export function sharedTournamentValues(userAccountId: string, playerId: string): string[] {
  return [playerId, userAccountId, playerId, userAccountId, playerId, userAccountId];
}

class MysqlClaimWriteTransaction implements ClaimWriteTransaction {
  public constructor(private readonly connection: PoolConnection) {}

  public async findHumanPlayerStatus(
    playerId: string,
  ): Promise<"active" | "archived" | null> {
    const [rows] = await this.connection.execute<StatusRow[]>(
      `SELECT p.record_status AS statusValue
       FROM players AS p
       WHERE p.public_id = ?
         AND p.player_kind = 'human'
       LIMIT 1
       FOR UPDATE`,
      [playerId],
    );
    const row = singleRow(rows, "Player");
    if (row === null) {
      return null;
    }
    return requiredEnum(
      row.statusValue,
      "Player.recordStatus",
      new Set(["active", "archived"] as const),
    );
  }

  public async findUserAccountStatus(
    userAccountId: string,
  ): Promise<AccountStatus | null> {
    const [rows] = await this.connection.execute<StatusRow[]>(
      `SELECT a.account_status AS statusValue
       FROM user_accounts AS a
       WHERE a.public_id = ?
       LIMIT 1
       FOR UPDATE`,
      [userAccountId],
    );
    const row = singleRow(rows, "UserAccount");
    return row === null
      ? null
      : requiredEnum(row.statusValue, "UserAccount.accountStatus", accountStatuses);
  }

  public async findClaimForUpdate(
    playerClaimId: string,
  ): Promise<ClaimSnapshot | null> {
    const [rows] = await this.connection.execute<ClaimRow[]>(
      `SELECT
         c.public_id AS playerClaimId,
         p.public_id AS playerId,
         a.public_id AS userAccountId,
         c.claim_status AS claimStatus,
         c.dispute_status AS disputeStatus,
         c.revision AS revision,
         COALESCE((
           SELECT MAX(l.sequence_number)
           FROM player_claim_lifecycle AS l
           WHERE l.player_claim_id = c.player_claim_id
         ), 0) AS lastSequence
       FROM player_claims AS c
       INNER JOIN players AS p ON p.player_id = c.player_id
       INNER JOIN user_accounts AS a ON a.user_account_id = c.user_account_id
       WHERE c.public_id = ?
       LIMIT 1
       FOR UPDATE`,
      [playerClaimId],
    );
    const row = singleRow(rows, "PlayerClaim");
    if (row === null) {
      return null;
    }
    return {
      playerClaimId: requiredString(row.playerClaimId, "PlayerClaim.playerClaimId"),
      playerId: requiredString(row.playerId, "PlayerClaim.playerId"),
      userAccountId: requiredString(row.userAccountId, "PlayerClaim.userAccountId"),
      claimStatus: requiredEnum(row.claimStatus, "PlayerClaim.claimStatus", claimStatuses),
      disputeStatus: requiredEnum(
        row.disputeStatus,
        "PlayerClaim.disputeStatus",
        disputeStatuses,
      ),
      revision: requiredSafeInteger(row.revision, "PlayerClaim.revision"),
      lastSequence: requiredSafeInteger(
        row.lastSequence,
        "PlayerClaim.lastSequence",
      ),
    };
  }

  public async hasVerifiedClaimForPlayer(playerId: string): Promise<boolean> {
    const [rows] = await this.connection.execute<ExistsRow[]>(
      `SELECT 1 AS present
       FROM player_claims AS c
       INNER JOIN players AS p ON p.player_id = c.player_id
       WHERE p.public_id = ?
         AND c.claim_status = 'verified'
       LIMIT 1
       FOR UPDATE`,
      [playerId],
    );
    return rows.length > 0;
  }

  public async findTournamentSharedWithAccountPlayers(
    userAccountId: string,
    playerId: string,
  ): Promise<string | null> {
    // The account's verified claims are locked, so a concurrent approval waits for this one.
    await this.connection.execute(
      `SELECT c.player_claim_id FROM player_claims AS c
       INNER JOIN user_accounts AS a ON a.user_account_id = c.user_account_id
       WHERE a.public_id = ? AND c.claim_status = 'verified' FOR UPDATE`,
      [userAccountId],
    );
    const [rows] = await this.connection.execute<SharedTournamentRow[]>(
      SHARED_TOURNAMENT_SQL,
      sharedTournamentValues(userAccountId, playerId),
    );
    return rows[0]?.label ?? null;
  }

  public async isDirectorForPlayer(userAccountId: string, playerId: string): Promise<boolean> {
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT 1 FROM tournaments AS t
       INNER JOIN user_accounts AS director ON director.user_account_id = t.director_user_account_id
       INNER JOIN tournament_participants AS participant ON participant.tournament_id = t.tournament_id
       INNER JOIN players AS p ON p.player_id = participant.player_id
       WHERE director.public_id = ? AND director.account_status = 'active' AND p.public_id = ?
       LIMIT 1`,
      [userAccountId, playerId],
    );
    return rows.length > 0;
  }

  public async addClaimNote(input: ClaimNoteInput): Promise<void> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO player_claim_notes (
         player_claim_id, author_user_account_id, author_role, note_kind, body, created_at_ms
       )
       SELECT c.player_claim_id, a.user_account_id, ?, ?, ?, ?
       FROM player_claims AS c
       INNER JOIN user_accounts AS a ON a.public_id = ?
       WHERE c.public_id = ?`,
      [
        input.authorRole,
        input.noteKind,
        input.body,
        input.createdAtMs,
        input.authorUserAccountId,
        input.playerClaimId,
      ],
    );
    assertAffected(result, 1, "claim note");
  }

  public async canUseEvidenceReferences(
    actor: EvidenceAccessActor,
    evidenceIds: readonly string[],
  ): Promise<boolean> {
    if (evidenceIds.length === 0) {
      return true;
    }
    const actorRestriction =
      actor.actorType === "requesting_account"
        ? "AND uploader.public_id = ?"
        : "";
    const actorJoin =
      actor.actorType === "requesting_account"
        ? "INNER JOIN user_accounts AS uploader ON uploader.user_account_id = e.uploaded_by_user_account_id"
        : "INNER JOIN user_accounts AS administrator ON administrator.public_id = ?";
    const values =
      actor.actorType === "requesting_account"
        ? [...evidenceIds, actor.userAccountId]
        : [actor.userAccountId, ...evidenceIds];
    const [rows] = await this.connection.execute<EvidenceRow[]>(
      `SELECT e.public_id AS evidenceId
       FROM restricted_claim_evidence AS e
       ${actorJoin}
       WHERE e.public_id IN (${placeholders(evidenceIds.length)})
       ${actorRestriction}
       FOR UPDATE`,
      values,
    );
    return rows.length === evidenceIds.length;
  }

  public async createClaim(input: CreateClaimInput): Promise<void> {
    const [claimResult] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO player_claims (
         public_id, revision, privacy_class, player_id, user_account_id,
         claim_status, dispute_status, created_at_ms, updated_at_ms
       )
       SELECT ?, ?, 'private', p.player_id, a.user_account_id, ?, ?, ?, ?
       FROM players AS p
       INNER JOIN user_accounts AS a ON a.public_id = ?
       WHERE p.public_id = ?
         AND p.player_kind = 'human'`,
      [
        input.snapshot.playerClaimId,
        input.snapshot.revision,
        input.snapshot.claimStatus,
        input.snapshot.disputeStatus,
        input.createdAtMs,
        input.createdAtMs,
        input.snapshot.userAccountId,
        input.snapshot.playerId,
      ],
    );
    assertAffected(claimResult, 1, "claim creation");
    const claimInternalId = claimResult.insertId;
    await this.attachAndVerifyEvidence(
      claimInternalId,
      input.initialEvent.actorType,
      input.initialEvent.actorUserAccountId,
      input.evidenceIds,
    );
    const lifecycleId = await this.insertLifecycleEvent(
      claimInternalId,
      input.initialEvent,
    );
    await this.linkAndAuditEvidence(
      claimInternalId,
      lifecycleId,
      input.initialEvent,
    );
  }

  public async appendClaimEvent(input: AppendClaimEventInput): Promise<void> {
    if (
      input.nextSnapshot.playerClaimId !== input.playerClaimId ||
      input.nextSnapshot.revision !== input.expectedRevision + 1 ||
      input.nextSnapshot.lastSequence !== input.event.sequence
    ) {
      throw new ClaimPersistenceContractError("claim event revision invariant failed");
    }
    const [updateResult] = await this.connection.execute<ResultSetHeader>(
      `UPDATE player_claims
       SET revision = ?, claim_status = ?, dispute_status = ?, updated_at_ms = ?
       WHERE public_id = ?
         AND revision = ?`,
      [
        input.nextSnapshot.revision,
        input.nextSnapshot.claimStatus,
        input.nextSnapshot.disputeStatus,
        input.event.occurredAtMs,
        input.playerClaimId,
        input.expectedRevision,
      ],
    );
    assertAffected(updateResult, 1, "claim lifecycle update");

    const claimInternalId = await this.findInternalClaimId(input.playerClaimId);
    await this.attachAndVerifyEvidence(
      claimInternalId,
      input.event.actorType,
      input.event.actorUserAccountId,
      input.event.evidenceIds,
    );
    const reviewInternalId = await this.insertRestrictedReview(
      claimInternalId,
      input.event,
    );
    const lifecycleId = await this.insertLifecycleEvent(
      claimInternalId,
      input.event,
      reviewInternalId,
    );
    await this.linkAndAuditEvidence(claimInternalId, lifecycleId, input.event);
  }

  private async findInternalClaimId(playerClaimId: string): Promise<number> {
    const [rows] = await this.connection.execute<
      (RowDataPacket & { claimInternalId: unknown })[]
    >(
      `SELECT player_claim_id AS claimInternalId
       FROM player_claims
       WHERE public_id = ?
       LIMIT 1`,
      [playerClaimId],
    );
    const row = singleRow(rows, "PlayerClaim internal ID");
    if (row === null) {
      throw new ClaimLifecycleError("conflict", "claim lifecycle update was lost");
    }
    return requiredSafeInteger(row.claimInternalId, "PlayerClaim.internalId");
  }

  private async attachAndVerifyEvidence(
    claimInternalId: number,
    actorType: ClaimLifecycleEventInput["actorType"],
    actorUserAccountId: string,
    evidenceIds: readonly string[],
  ): Promise<void> {
    if (evidenceIds.length === 0) {
      return;
    }
    const accountCondition =
      actorType === "requesting_account"
        ? "AND uploader.public_id = ?"
        : "";
    const accountJoin =
      actorType === "requesting_account"
        ? "INNER JOIN user_accounts AS uploader ON uploader.user_account_id = e.uploaded_by_user_account_id"
        : "INNER JOIN user_accounts AS administrator ON administrator.public_id = ?";
    const updateValues =
      actorType === "requesting_account"
        ? [claimInternalId, ...evidenceIds, actorUserAccountId]
        : [actorUserAccountId, claimInternalId, ...evidenceIds];
    await this.connection.execute<ResultSetHeader>(
      `UPDATE restricted_claim_evidence AS e
       ${accountJoin}
       SET e.player_claim_id = ?
       WHERE e.player_claim_id IS NULL
         AND e.public_id IN (${placeholders(evidenceIds.length)})
         ${accountCondition}`,
      updateValues,
    );

    const ownerCondition =
      actorType === "requesting_account" ? "AND uploader.public_id = ?" : "";
    const verificationValues =
      actorType === "requesting_account"
        ? [claimInternalId, ...evidenceIds, actorUserAccountId]
        : [claimInternalId, ...evidenceIds];
    const [rows] = await this.connection.execute<EvidenceRow[]>(
      `SELECT e.public_id AS evidenceId
       FROM restricted_claim_evidence AS e
       INNER JOIN user_accounts AS uploader
         ON uploader.user_account_id = e.uploaded_by_user_account_id
       WHERE e.player_claim_id = ?
         AND e.public_id IN (${placeholders(evidenceIds.length)})
         ${ownerCondition}
       FOR UPDATE`,
      verificationValues,
    );
    if (rows.length !== evidenceIds.length) {
      throw new ClaimLifecycleError(
        "conflict",
        "restricted evidence could not be attached to this claim",
      );
    }
  }

  private async insertRestrictedReview(
    claimInternalId: number,
    event: ClaimLifecycleEventInput,
  ): Promise<number | null> {
    // Administrators and Directors are reviewers; both leave a review row (ADR-0216).
    if (event.actorType === "requesting_account") {
      if (event.privateReviewReference !== undefined) {
        throw new ClaimPersistenceContractError(
          "requesting-account event cannot create an administrator review",
        );
      }
      return null;
    }
    if (event.privateReviewReference === undefined) {
      throw new ClaimPersistenceContractError(
        "administrator event requires a private review reference",
      );
    }
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO restricted_claim_reviews (
         public_id, player_claim_id, reviewer_user_account_id, decision,
         reason_code, detail_ciphertext, encryption_key_version, reviewed_at_ms
       )
       SELECT ?, ?, a.user_account_id, ?, ?, NULL, NULL, ?
       FROM user_accounts AS a
       WHERE a.public_id = ?`,
      [
        event.privateReviewReference,
        claimInternalId,
        reviewDecision(event.eventType),
        event.reasonCode ?? null,
        event.occurredAtMs,
        event.actorUserAccountId,
      ],
    );
    assertAffected(result, 1, "administrator review audit");
    return result.insertId;
  }

  private async insertLifecycleEvent(
    claimInternalId: number,
    event: ClaimLifecycleEventInput,
    reviewInternalId: number | null = null,
  ): Promise<number> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO player_claim_lifecycle (
         player_claim_id, sequence_number, event_type, actor_type,
         actor_user_account_id, occurred_at_ms, reason_code, claim_review_id
       )
       SELECT ?, ?, ?, ?, a.user_account_id, ?, ?, ?
       FROM user_accounts AS a
       WHERE a.public_id = ?`,
      [
        claimInternalId,
        event.sequence,
        event.eventType,
        event.actorType,
        event.occurredAtMs,
        event.reasonCode ?? null,
        reviewInternalId,
        event.actorUserAccountId,
      ],
    );
    assertAffected(result, 1, "claim lifecycle audit");
    return result.insertId;
  }

  private async linkAndAuditEvidence(
    claimInternalId: number,
    lifecycleInternalId: number,
    event: ClaimLifecycleEventInput,
  ): Promise<void> {
    if (event.evidenceIds.length === 0) {
      return;
    }
    const [linkResult] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO player_claim_event_evidence (
         claim_lifecycle_id, claim_evidence_id
       )
       SELECT ?, e.claim_evidence_id
       FROM restricted_claim_evidence AS e
       WHERE e.player_claim_id = ?
         AND e.public_id IN (${placeholders(event.evidenceIds.length)})`,
      [lifecycleInternalId, claimInternalId, ...event.evidenceIds],
    );
    assertAffected(linkResult, event.evidenceIds.length, "claim evidence audit link");

    const [auditResult] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO restricted_identity_access_log (
         resource_type, claim_evidence_id, claim_review_id,
         legacy_identifier_id, accessor_type, accessor_reference,
         purpose_code, accessed_at_ms
       )
       SELECT 'claim_evidence', e.claim_evidence_id, NULL, NULL, ?, ?, ?, ?
       FROM restricted_claim_evidence AS e
       WHERE e.player_claim_id = ?
         AND e.public_id IN (${placeholders(event.evidenceIds.length)})`,
      [
        event.actorType === "requesting_account" ? "account" : "administrator",
        event.actorUserAccountId,
        event.eventType,
        event.occurredAtMs,
        claimInternalId,
        ...event.evidenceIds,
      ],
    );
    assertAffected(auditResult, event.evidenceIds.length, "restricted access audit");
  }
}

export class MysqlClaimWriteRepository implements ClaimWriteRepository {
  public constructor(private readonly pool: Pool) {}

  public async transaction<T>(
    work: (transaction: ClaimWriteTransaction) => Promise<T>,
  ): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(new MysqlClaimWriteTransaction(connection));
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      if (isDuplicateKeyError(error)) {
        throw new ClaimLifecycleError(
          "conflict",
          "an identity claim uniqueness constraint was occupied concurrently",
        );
      }
      throw error;
    } finally {
      connection.release();
    }
  }
}
