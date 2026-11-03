import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import type { Rating } from "./trueskill-engine.js";
import type {
  RatingLifecycleRepository,
  RatingLifecycleTransaction,
  RatingPublicationRace,
} from "./rating-lifecycle-service.js";
import { RatingPersistenceError } from "./mysql-rating-repository.js";
import {
  EVERYONE_COUNTS,
  readClaimedPlayerIds,
  readInstallationRatingEligibility,
  type RatingEligibility,
} from "./rating-eligibility.js";

interface IdRow extends RowDataPacket { internalId: unknown; }
interface PublicationRow extends RowDataPacket {
  internalId: unknown;
  publicationStatus: unknown;
}
interface DecisionRow extends RowDataPacket { ratingIncluded: unknown; }
interface SequenceRow extends RowDataPacket {
  playerId: unknown;
  maxSequence: unknown;
}
interface EpochRow extends RowDataPacket { epoch: unknown; }
interface ExistsRow extends RowDataPacket { present: unknown; }
interface RaceRow extends RowDataPacket {
  revisionId: unknown;
  memberSequence: unknown;
  playerId: unknown;
  finishPosition: unknown;
}
interface RatingRow extends RowDataPacket {
  playerId: unknown;
  mu: unknown;
  sigma: unknown;
}
interface SeedRow extends RowDataPacket {
  playerId: unknown;
  mu: unknown;
  sigma: unknown;
  sourceReference: unknown;
}
interface IncludedPublicationRow extends RowDataPacket {
  internalId: unknown;
  publicId: unknown;
}

function integer(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RatingPersistenceError(`${label} is invalid`);
  }
  return parsed;
}

function decimal(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new RatingPersistenceError(`${label} is invalid`);
  }
  return parsed;
}

function assertAffected(
  result: ResultSetHeader,
  expected: number,
  operation: string,
): void {
  if (result.affectedRows !== expected) {
    throw new RatingPersistenceError(`${operation} did not persist`);
  }
}

class MysqlRatingLifecycleTransaction implements RatingLifecycleTransaction {
  public constructor(private readonly connection: PoolConnection) {}

  public async findActiveAdministratorAccount(
    userAccountPublicId: string,
  ): Promise<number | null> {
    const [rows] = await this.connection.execute<IdRow[]>(
      `SELECT account.user_account_id AS internalId
       FROM administrator_grants AS grant_record
       INNER JOIN user_accounts AS account
         ON account.user_account_id = grant_record.user_account_id
       WHERE account.public_id = ?
         AND grant_record.grant_status = 'active'
         AND account.account_status = 'active'
       LIMIT 1 FOR UPDATE`,
      [userAccountPublicId],
    );
    return rows[0] === undefined
      ? null
      : integer(rows[0].internalId, "administrator account id");
  }

  public async findPublication(publicationPublicId: string): Promise<Readonly<{
    internalId: number;
    publicationStatus: string;
  }> | null> {
    const [rows] = await this.connection.execute<PublicationRow[]>(
      `SELECT tournament_publication_id AS internalId,
              publication_status AS publicationStatus
       FROM tournament_publications
       WHERE public_id = ? LIMIT 1 FOR UPDATE`,
      [publicationPublicId],
    );
    const row = rows[0];
    if (row === undefined) { return null; }
    if (typeof row.publicationStatus !== "string") {
      throw new RatingPersistenceError("publication status is invalid");
    }
    return {
      internalId: integer(row.internalId, "publication id"),
      publicationStatus: row.publicationStatus,
    };
  }

  public async isPublicationIncluded(
    publicationInternalId: number,
  ): Promise<boolean> {
    const [rows] = await this.connection.execute<DecisionRow[]>(
      `SELECT rating_included AS ratingIncluded
       FROM tournament_rating_decisions
       WHERE tournament_publication_id = ?
       ORDER BY sequence_number DESC
       LIMIT 1 FOR UPDATE`,
      [publicationInternalId],
    );
    const row = rows[0];
    if (row === undefined) { return true; }
    return integer(row.ratingIncluded, "rating decision") === 1;
  }

  public async latestDecisionSequence(
    publicationInternalId: number,
  ): Promise<number> {
    const [rows] = await this.connection.execute<EpochRow[]>(
      `SELECT COALESCE(MAX(sequence_number), 0) AS epoch
       FROM tournament_rating_decisions
       WHERE tournament_publication_id = ? FOR UPDATE`,
      [publicationInternalId],
    );
    return integer(rows[0]?.epoch ?? 0, "decision sequence");
  }

  public async appendDecision(input: Readonly<{
    publicationInternalId: number;
    sequenceNumber: number;
    ratingIncluded: boolean;
    reasonCode: string;
    decidedByInternalId: number;
    nowMs: number;
  }>): Promise<void> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO tournament_rating_decisions (
         tournament_publication_id, sequence_number, rating_included,
         reason_code, decided_by_user_account_id, occurred_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.publicationInternalId, input.sequenceNumber,
        input.ratingIncluded ? 1 : 0, input.reasonCode,
        input.decidedByInternalId, input.nowMs,
      ],
    );
    assertAffected(result, 1, "rating decision");
  }

  public async currentEpoch(): Promise<number> {
    const [rows] = await this.connection.execute<EpochRow[]>(
      `SELECT COALESCE(MAX(rating_recalculation_id), 0) AS epoch
       FROM rating_recalculations FOR UPDATE`,
    );
    return integer(rows[0]?.epoch ?? 0, "rating epoch");
  }

  public async loadPublicationRaces(
    publicationInternalId: number,
  ): Promise<readonly RatingPublicationRace[]> {
    const [rows] = await this.connection.execute<RaceRow[]>(
      `SELECT member.tournament_race_result_revision_id AS revisionId,
              member.sequence_number AS memberSequence,
              placement.player_id AS playerId,
              placement.finish_position AS finishPosition
       FROM tournament_publication_current_members AS member
       INNER JOIN tournament_race_placements AS placement
         ON placement.tournament_race_result_revision_id =
            member.tournament_race_result_revision_id
       WHERE member.tournament_publication_id = ?
       ORDER BY member.sequence_number ASC, placement.finish_position ASC
       FOR UPDATE`,
      [publicationInternalId],
    );
    const races = new Map<number, {
      revisionInternalId: number;
      placements: { playerInternalId: number | null; finishPosition: number }[];
    }>();
    const order: number[] = [];
    for (const row of rows) {
      const memberSequence = integer(row.memberSequence, "member sequence");
      let race = races.get(memberSequence);
      if (race === undefined) {
        race = {
          revisionInternalId: integer(row.revisionId, "race revision id"),
          placements: [],
        };
        races.set(memberSequence, race);
        order.push(memberSequence);
      }
      race.placements.push({
        playerInternalId:
          row.playerId === null ? null : integer(row.playerId, "player id"),
        finishPosition: integer(row.finishPosition, "finish position"),
      });
    }
    return order.map((sequence) => races.get(sequence)!);
  }

  /**
   * ADR-0221: the installation's eligibility, narrowed for one result set by
   * its night's "only verified Players".
   */
  public async loadRatingEligibility(publicationInternalId: number | null): Promise<RatingEligibility> {
    let requireClaim = await readInstallationRatingEligibility(this.connection) === "claimed_only";
    if (!requireClaim && publicationInternalId !== null) {
      const [rows] = await this.connection.execute<RowDataPacket[]>(
        `SELECT 1 AS present FROM tournaments
         WHERE tournament_publication_id = ? AND verified_only = TRUE LIMIT 1`,
        [publicationInternalId],
      );
      requireClaim = rows.length > 0;
    }
    return requireClaim
      ? { requireClaim, claimedPlayerIds: await readClaimedPlayerIds(this.connection) }
      : EVERYONE_COUNTS;
  }

  public async hasRaceEventsForRevisions(
    revisionInternalIds: readonly number[],
    epoch: number,
  ): Promise<boolean> {
    if (revisionInternalIds.length === 0) { return false; }
    const placeholders = revisionInternalIds.map(() => "?").join(", ");
    const [rows] = await this.connection.execute<ExistsRow[]>(
      `SELECT 1 AS present FROM player_rating_events
       WHERE rating_epoch = ?
         AND tournament_race_result_revision_id IN (${placeholders})
       LIMIT 1 FOR UPDATE`,
      [epoch, ...revisionInternalIds],
    );
    return rows.length > 0;
  }

  /**
   * When each Player last had a race rated, which is what the inactivity rule
   * measures an absence from (ADR-0189).
   */
  public async loadLastRatedAtMs(
    epoch: number,
  ): Promise<ReadonlyMap<number, number>> {
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT player_id AS playerId, MAX(occurred_at_ms) AS lastRatedAtMs
       FROM player_rating_events
       WHERE rating_epoch = ?
       GROUP BY player_id`,
      [epoch],
    );
    const last = new Map<number, number>();
    for (const row of rows) {
      last.set(
        integer(row["playerId"], "player id"),
        integer(row["lastRatedAtMs"], "last rated at"),
      );
    }
    return last;
  }

  public async loadCurrentRatings(): Promise<ReadonlyMap<number, Rating>> {
    const [rows] = await this.connection.execute<RatingRow[]>(
      `SELECT player_id AS playerId, mu, sigma
       FROM player_ratings FOR UPDATE`,
    );
    const ratings = new Map<number, Rating>();
    for (const row of rows) {
      ratings.set(integer(row.playerId, "player id"), {
        mu: decimal(row.mu, "mu"),
        sigma: decimal(row.sigma, "sigma"),
      });
    }
    return ratings;
  }

  public async loadNextSequences(
    epoch: number,
  ): Promise<ReadonlyMap<number, number>> {
    const [rows] = await this.connection.execute<SequenceRow[]>(
      `SELECT player_id AS playerId,
              MAX(sequence_number) AS maxSequence
       FROM player_rating_events
       WHERE rating_epoch = ?
       GROUP BY player_id FOR UPDATE`,
      [epoch],
    );
    const sequences = new Map<number, number>();
    for (const row of rows) {
      sequences.set(
        integer(row.playerId, "player id"),
        integer(row.maxSequence, "sequence"),
      );
    }
    return sequences;
  }

  public async appendRatingEvent(input: Readonly<{
    playerInternalId: number;
    epoch: number;
    sequenceNumber: number;
    eventType: "seed_import" | "race_result";
    muBefore: number | null;
    sigmaBefore: number | null;
    muAfter: number;
    sigmaAfter: number;
    sourceReference: string;
    revisionInternalId: number | null;
    nowMs: number;
  }>): Promise<void> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO player_rating_events (
         player_id, sequence_number, event_type, mu_before, sigma_before,
         mu_after, sigma_after, source_reference,
         tournament_race_result_revision_id, occurred_at_ms, rating_epoch
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.playerInternalId, input.sequenceNumber, input.eventType,
        input.muBefore === null ? null : String(input.muBefore),
        input.sigmaBefore === null ? null : String(input.sigmaBefore),
        String(input.muAfter), String(input.sigmaAfter),
        input.sourceReference, input.revisionInternalId, input.nowMs,
        input.epoch,
      ],
    );
    assertAffected(result, 1, "rating event");
  }

  public async upsertCurrentRating(input: Readonly<{
    playerInternalId: number;
    mu: number;
    sigma: number;
    nowMs: number;
  }>): Promise<void> {
    await this.connection.execute<ResultSetHeader>(
      `INSERT INTO player_ratings (
         player_id, revision, mu, sigma, updated_at_ms, created_at_ms
       ) VALUES (?, 1, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         revision = revision + 1,
         mu = VALUES(mu),
         sigma = VALUES(sigma),
         updated_at_ms = VALUES(updated_at_ms)`,
      [
        input.playerInternalId, String(input.mu), String(input.sigma),
        input.nowMs, input.nowMs,
      ],
    );
  }

  public async deleteCurrentRatingsExcept(
    playerInternalIds: readonly number[],
  ): Promise<number> {
    if (playerInternalIds.length === 0) {
      const [result] = await this.connection.execute<ResultSetHeader>(
        "DELETE FROM player_ratings",
      );
      return result.affectedRows;
    }
    const placeholders = playerInternalIds.map(() => "?").join(", ");
    const [result] = await this.connection.execute<ResultSetHeader>(
      `DELETE FROM player_ratings WHERE player_id NOT IN (${placeholders})`,
      [...playerInternalIds],
    );
    return result.affectedRows;
  }

  public async insertRecalculation(input: Readonly<{
    reasonCode: string;
    triggeredByInternalId: number;
    nowMs: number;
  }>): Promise<number> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO rating_recalculations (
         reason_code, triggered_by_user_account_id, included_publications,
         applied_races, skipped_races, occurred_at_ms
       ) VALUES (?, ?, 0, 0, 0, ?)`,
      [input.reasonCode, input.triggeredByInternalId, input.nowMs],
    );
    assertAffected(result, 1, "rating recalculation");
    return result.insertId;
  }

  public async finishRecalculation(input: Readonly<{
    recalculationId: number;
    includedPublications: number;
    appliedRaces: number;
    skippedRaces: number;
  }>): Promise<void> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `UPDATE rating_recalculations
       SET included_publications = ?, applied_races = ?, skipped_races = ?
       WHERE rating_recalculation_id = ?`,
      [
        input.includedPublications, input.appliedRaces, input.skippedRaces,
        input.recalculationId,
      ],
    );
    assertAffected(result, 1, "rating recalculation summary");
  }

  public async loadSeedBaseline(): Promise<readonly Readonly<{
    playerInternalId: number;
    mu: number;
    sigma: number;
    sourceReference: string;
  }>[]> {
    const [rows] = await this.connection.execute<SeedRow[]>(
      `SELECT player_id AS playerId, mu_after AS mu, sigma_after AS sigma,
              source_reference AS sourceReference
       FROM player_rating_events
       WHERE rating_epoch = 0 AND event_type = 'seed_import'
       ORDER BY player_id ASC FOR UPDATE`,
    );
    return rows.map((row) => {
      if (typeof row.sourceReference !== "string") {
        throw new RatingPersistenceError("seed source reference is invalid");
      }
      return {
        playerInternalId: integer(row.playerId, "player id"),
        mu: decimal(row.mu, "mu"),
        sigma: decimal(row.sigma, "sigma"),
        sourceReference: row.sourceReference,
      };
    });
  }

  public async listIncludedPublicationsInOrder(): Promise<readonly Readonly<{
    internalId: number;
    publicationPublicId: string;
  }>[]> {
    const [rows] = await this.connection.execute<IncludedPublicationRow[]>(
      `SELECT publication.tournament_publication_id AS internalId,
              publication.public_id AS publicId
       FROM tournament_publications AS publication
       LEFT JOIN tournaments AS tournament
         ON tournament.tournament_publication_id = publication.tournament_publication_id
       WHERE publication.publication_status = 'published'
         AND COALESCE((
           SELECT decision.rating_included
           FROM tournament_rating_decisions AS decision
           WHERE decision.tournament_publication_id =
                 publication.tournament_publication_id
           ORDER BY decision.sequence_number DESC
           LIMIT 1
         ), 1) = 1
       ORDER BY COALESCE(tournament.start_at_ms, publication.published_at_ms) ASC,
                publication.tournament_publication_id ASC
       FOR UPDATE`,
    );
    return rows.map((row) => {
      if (typeof row.publicId !== "string") {
        throw new RatingPersistenceError("publication public id is invalid");
      }
      return {
        internalId: integer(row.internalId, "publication id"),
        publicationPublicId: row.publicId,
      };
    });
  }
}

export class MysqlRatingLifecycleRepository
implements RatingLifecycleRepository {
  public constructor(private readonly pool: Pool) {}

  public async transaction<T>(
    work: (transaction: RatingLifecycleTransaction) => Promise<T>,
  ): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(
        new MysqlRatingLifecycleTransaction(connection),
      );
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
