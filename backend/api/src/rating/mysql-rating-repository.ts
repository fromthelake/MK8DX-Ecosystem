import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import type {
  RatingSeedImportRepository,
  RatingSeedImportTransaction,
} from "./rating-seed-import-service.js";

interface InternalIdRow extends RowDataPacket { internalId: unknown; }
interface ExistsRow extends RowDataPacket { present: unknown; }
interface LeaderboardRow extends RowDataPacket {
  playerId: unknown;
  username: unknown;
  displayName: unknown;
  mu: unknown;
  sigma: unknown;
  updatedAtMs: unknown;
}

export class RatingPersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RatingPersistenceError";
  }
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

class MysqlRatingSeedImportTransaction implements RatingSeedImportTransaction {
  public constructor(private readonly connection: PoolConnection) {}

  public async findActiveHumanPlayerInternalId(
    playerId: string,
  ): Promise<number | null> {
    const [rows] = await this.connection.execute<InternalIdRow[]>(
      `SELECT player_id AS internalId FROM players
       WHERE public_id = ? AND player_kind = 'human'
         AND record_status = 'active'
       LIMIT 1 FOR UPDATE`,
      [playerId],
    );
    const row = rows[0];
    if (row === undefined) { return null; }
    if (typeof row.internalId !== "number") {
      throw new RatingPersistenceError("player internal id is invalid");
    }
    return row.internalId;
  }

  public async hasSeedIdentity(input: Readonly<{
    sourceSystem: string;
    sourcePlayerReference: string;
  }>): Promise<boolean> {
    const [rows] = await this.connection.execute<ExistsRow[]>(
      `SELECT 1 AS present FROM restricted_rating_seed_identities
       WHERE source_system = ? AND source_player_reference = ?
       LIMIT 1 FOR UPDATE`,
      [input.sourceSystem, input.sourcePlayerReference],
    );
    return rows.length > 0;
  }

  public async hasRating(playerInternalId: number): Promise<boolean> {
    const [rows] = await this.connection.execute<ExistsRow[]>(
      `SELECT 1 AS present FROM player_ratings
       WHERE player_id = ? LIMIT 1 FOR UPDATE`,
      [playerInternalId],
    );
    return rows.length > 0;
  }

  public async insertSeededRating(input: Readonly<{
    playerInternalId: number;
    mu: string;
    sigma: string;
    sourceReference: string;
    sourceSystem: string;
    sourcePlayerReference: string;
    sourceSnapshotSha256: string;
    nowMs: number;
  }>): Promise<void> {
    const [rating] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO player_ratings (
         player_id, revision, mu, sigma, updated_at_ms, created_at_ms
       ) VALUES (?, 1, ?, ?, ?, ?)`,
      [input.playerInternalId, input.mu, input.sigma, input.nowMs, input.nowMs],
    );
    assertAffected(rating, 1, "seeded rating");
    const [event] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO player_rating_events (
         player_id, sequence_number, event_type, mu_before, sigma_before,
         mu_after, sigma_after, source_reference,
         tournament_race_result_revision_id, occurred_at_ms
       ) VALUES (?, 1, 'seed_import', NULL, NULL, ?, ?, ?, NULL, ?)`,
      [
        input.playerInternalId, input.mu, input.sigma,
        input.sourceReference, input.nowMs,
      ],
    );
    assertAffected(event, 1, "seed rating event");
    const [identity] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO restricted_rating_seed_identities (
         player_id, source_system, source_player_reference,
         source_snapshot_sha256, imported_at_ms
       ) VALUES (?, ?, ?, ?, ?)`,
      [
        input.playerInternalId, input.sourceSystem,
        input.sourcePlayerReference, input.sourceSnapshotSha256, input.nowMs,
      ],
    );
    assertAffected(identity, 1, "restricted seed identity");
  }
}

export class MysqlRatingSeedImportRepository
implements RatingSeedImportRepository {
  public constructor(private readonly pool: Pool) {}

  public async transaction<T>(
    work: (transaction: RatingSeedImportTransaction) => Promise<T>,
  ): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(
        new MysqlRatingSeedImportTransaction(connection),
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

export type PublicRatingEntry = Readonly<{
  playerId: string;
  username: string;
  displayName: string;
  mu: number;
  sigma: number;
  updatedAtMs: number;
}>;

/** How a night moved a Player's SP, split by stage: the score before the first rated race, after the last qualifier race, after the last final race. */
export type StageSplitEntry = Readonly<{ before: number; afterQualifiers: number | null; afterFinals: number | null }>;

export class MysqlPublicRatingRepository {
  public constructor(private readonly pool: Pool) {}

  /**
   * The rating events of a Tournament's races in the current epoch, walked per
   * Player in the order they were applied (qualifiers first, then finals - the
   * order finalization pins them). Empty for a night that did not count.
   */
  public async stageSplit(tournamentId: string): Promise<ReadonlyMap<string, StageSplitEntry>> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT player.public_id AS playerId, grp.stage AS stage, event.sequence_number AS sequenceNumber,
              event.mu_before AS muBefore, event.sigma_before AS sigmaBefore,
              event.mu_after AS muAfter, event.sigma_after AS sigmaAfter
       FROM player_rating_events AS event
       INNER JOIN tournament_race_result_revisions AS revision
         ON revision.tournament_race_result_revision_id = event.tournament_race_result_revision_id
       INNER JOIN tournament_group_races AS race ON race.tournament_race_result_id = revision.tournament_race_result_id
       INNER JOIN tournament_groups AS grp ON grp.tournament_group_id = race.tournament_group_id
       INNER JOIN tournaments AS tournament ON tournament.tournament_id = grp.tournament_id
       INNER JOIN players AS player ON player.player_id = event.player_id
       WHERE tournament.public_id = ?
         AND event.rating_epoch = (SELECT COALESCE(MAX(rating_epoch), 0) FROM player_rating_events)
       ORDER BY event.player_id ASC, event.sequence_number ASC`,
      [tournamentId],
    );
    const score = (mu: unknown, sigma: unknown): number | null => {
      const m = Number(mu); const s = Number(sigma);
      return Number.isFinite(m) && Number.isFinite(s) ? m - 3 * s : null;
    };
    const split = new Map<string, { before: number; afterQualifiers: number | null; afterFinals: number | null }>();
    for (const row of rows) {
      const playerId = String(row["playerId"]);
      const after = score(row["muAfter"], row["sigmaAfter"]);
      if (after === null) { continue; }
      let entry = split.get(playerId);
      if (entry === undefined) {
        const before = score(row["muBefore"], row["sigmaBefore"]);
        if (before === null) { continue; }
        entry = { before, afterQualifiers: null, afterFinals: null };
        split.set(playerId, entry);
      }
      if (row["stage"] === "qualifier") { entry.afterQualifiers = after; } else { entry.afterFinals = after; }
    }
    return split;
  }

  public async listRatings(limit: number): Promise<PublicRatingEntry[]> {
    const [rows] = await this.pool.execute<LeaderboardRow[]>(
      `SELECT player.public_id AS playerId,
              username.username_value AS username,
              player.display_name AS displayName,
              rating.mu AS mu,
              rating.sigma AS sigma,
              rating.updated_at_ms AS updatedAtMs
       FROM player_ratings AS rating
       INNER JOIN players AS player
         ON player.player_id = rating.player_id
        AND player.record_status = 'active'
        AND player.visibility = 'public'
       INNER JOIN player_username_history AS username
         ON username.player_id = player.player_id
        AND username.released_at_ms IS NULL
       ORDER BY (rating.mu - 3 * rating.sigma) DESC, username.username_value ASC
       LIMIT ${Math.min(Math.max(1, Math.trunc(limit)), 200)}`,
    );
    return rows.map((row) => {
      const mu = Number(row.mu);
      const sigma = Number(row.sigma);
      const updatedAtMs = Number(row.updatedAtMs);
      if (typeof row.playerId !== "string" || typeof row.username !== "string" ||
        typeof row.displayName !== "string" || !Number.isFinite(mu) ||
        !Number.isFinite(sigma) || sigma <= 0 ||
        !Number.isSafeInteger(updatedAtMs)) {
        throw new RatingPersistenceError("public rating row is invalid");
      }
      return {
        playerId: row.playerId,
        username: row.username,
        displayName: row.displayName,
        mu,
        sigma,
        updatedAtMs,
      };
    });
  }
}
