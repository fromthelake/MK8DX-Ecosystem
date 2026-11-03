import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import {
  PlayerOnboardingError,
  type PlayerOnboardingRepository,
  type PlayerOnboardingTransaction,
} from "./player-onboarding-service.js";

/**
 * The TrueSkill prior every newly created canonical Player starts from:
 * `RATING_INITIAL_MU` and `RATING_INITIAL_SIGMA` of the canonical engine,
 * written as exact DECIMAL(24,18) literals so the stored value is the decimal
 * truncation of 25/3 rather than a float64 artefact.
 */
export const DEFAULT_RATING_MU_DECIMAL = "25.000000000000000000";
export const DEFAULT_RATING_SIGMA_DECIMAL = "8.333333333333333333";
export const DEFAULT_PLAYER_RATING_SOURCE_REFERENCE =
  "default_trueskill_prior_v1";

interface StatusRow extends RowDataPacket { statusValue: unknown; }
interface ExistsRow extends RowDataPacket { present: unknown; }
interface InternalIdRow extends RowDataPacket { internalId: unknown; }

export class PlayerOnboardingPersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PlayerOnboardingPersistenceError";
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    (error as { code?: unknown }).code === "ER_DUP_ENTRY";
}

function assertAffected(
  result: ResultSetHeader,
  expected: number,
  operation: string,
): void {
  if (result.affectedRows !== expected) {
    throw new PlayerOnboardingPersistenceError(`${operation} did not persist`);
  }
}

class MysqlPlayerOnboardingTransaction implements PlayerOnboardingTransaction {
  public constructor(private readonly connection: PoolConnection) {}

  public async findUserAccountStatus(
    userAccountId: string,
  ): Promise<string | null> {
    const [rows] = await this.connection.execute<StatusRow[]>(
      `SELECT a.account_status AS statusValue
       FROM user_accounts AS a
       WHERE a.public_id = ?
       LIMIT 1
       FOR UPDATE`,
      [userAccountId],
    );
    const row = rows[0];
    if (row === undefined) { return null; }
    if (typeof row.statusValue !== "string") {
      throw new PlayerOnboardingPersistenceError(
        "UserAccount.accountStatus is invalid",
      );
    }
    return row.statusValue;
  }

  public async hasVerifiedClaimForUserAccount(
    userAccountId: string,
  ): Promise<boolean> {
    const [rows] = await this.connection.execute<ExistsRow[]>(
      `SELECT 1 AS present
       FROM player_claims AS c
       INNER JOIN user_accounts AS a ON a.user_account_id = c.user_account_id
       WHERE a.public_id = ?
         AND c.claim_status = 'verified'
       LIMIT 1
       FOR UPDATE`,
      [userAccountId],
    );
    return rows.length > 0;
  }

  public async usernameTaken(username: string): Promise<boolean> {
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT 1 AS present
       FROM player_username_history
       WHERE current_comparison_key = ?
       LIMIT 1
       FOR UPDATE`,
      [Buffer.from(username.toLowerCase(), "utf8")],
    );
    return rows.length > 0;
  }

  public async displayNamesInDirectorNights(input: Readonly<{
    actorUserAccountId: string;
    tournamentId: string | null;
    displayNames: readonly string[];
  }>): Promise<ReadonlySet<string>> {
    const wanted = [...new Set(input.displayNames.map((name) => name.trim().toLowerCase()))]
      .filter((name) => name.length > 0);
    if (wanted.length === 0) { return new Set(); }
    // The Director of the named Tournament (an administrator may act for
    // another Director), otherwise the acting account itself. Any roster row
    // counts: a name on the Director's list is a name they already know.
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT DISTINCT LOWER(TRIM(player.display_name)) AS nameKey
       FROM tournament_participants AS participant
       INNER JOIN tournaments AS t
         ON t.tournament_id = participant.tournament_id AND t.lifecycle_status = 'active'
       INNER JOIN players AS player
         ON player.player_id = participant.player_id AND player.player_kind = 'human'
       WHERE t.director_user_account_id = COALESCE(
               (SELECT owned.director_user_account_id FROM tournaments AS owned WHERE owned.public_id = ? LIMIT 1),
               (SELECT account.user_account_id FROM user_accounts AS account WHERE account.public_id = ? LIMIT 1))
         AND LOWER(TRIM(player.display_name)) IN (${wanted.map(() => "?").join(", ")})`,
      [input.tournamentId ?? "", input.actorUserAccountId, ...wanted],
    );
    return new Set(rows
      .map((row) => (typeof row["nameKey"] === "string" ? row["nameKey"].toLowerCase() : ""))
      .filter((name) => name.length > 0));
  }

  public async createPlayerWithUsername(input: Readonly<{
    playerId: string;
    username: string;
    displayName: string;
    nowMs: number;
    seedRating?: boolean;
  }>): Promise<"created" | "username_taken"> {
    // ADR-0218: a name is never an identity, so a display name may repeat
    // (migration 0079 dropped the unique key). The username stays unique; it
    // is checked first so a taken one leaves no Player row behind.
    if (await this.usernameTaken(input.username)) { return "username_taken"; }
    const [playerResult] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO players (
         public_id, revision, player_kind, display_name, record_status,
         created_at_ms, updated_at_ms
       ) VALUES (?, 1, 'human', ?, 'active', ?, ?)`,
      [input.playerId, input.displayName, input.nowMs, input.nowMs],
    );
    assertAffected(playerResult, 1, "player creation");
    try {
      const [usernameResult] = await this.connection.execute<ResultSetHeader>(
        `INSERT INTO player_username_history (
           player_id, sequence_number, username_value, comparison_key,
           allocated_at_ms, released_at_ms
         ) VALUES (?, 1, ?, ?, ?, NULL)`,
        [
          playerResult.insertId,
          input.username,
          Buffer.from(input.username.toLowerCase(), "utf8"),
          input.nowMs,
        ],
      );
      assertAffected(usernameResult, 1, "username allocation");
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return "username_taken";
      }
      throw error;
    }
    // ADR-0221: with "only claimed Players count" an unclaimed Player gets no rating at all.
    if (input.seedRating !== false) { await this.seedDefaultRating(playerResult.insertId, input.nowMs); }
    return "created";
  }

  /**
   * ADR-0154 rating semantics with ADR-0177 decision 20: a brand-new canonical
   * Player starts at the TrueSkill prior. Its public score is the conservative
   * `mu - 3 * sigma`, which for the prior is 0 - below every rated Player - so
   * the newcomer seeds last in "Maak kwalificatiegroepen" by the ordinary
   * ranking rule instead of a special case. The source Manager's
   * `MANUAL_DEFAULT_SP = 25.0` is deliberately not reproduced: on this scale
   * (rated Players run 13.03 to 28.67) it would seed a stranger near the top.
   */
  private async seedDefaultRating(
    playerInternalId: number,
    nowMs: number,
  ): Promise<void> {
    const [rating] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO player_ratings (
         player_id, revision, mu, sigma, updated_at_ms, created_at_ms
       ) VALUES (?, 1, ?, ?, ?, ?)`,
      [
        playerInternalId,
        DEFAULT_RATING_MU_DECIMAL,
        DEFAULT_RATING_SIGMA_DECIMAL,
        nowMs,
        nowMs,
      ],
    );
    assertAffected(rating, 1, "default rating");
    const [event] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO player_rating_events (
         player_id, sequence_number, event_type, mu_before, sigma_before,
         mu_after, sigma_after, source_reference,
         tournament_race_result_revision_id, occurred_at_ms
       ) VALUES (?, 1, 'seed_import', NULL, NULL, ?, ?, ?, NULL, ?)`,
      [
        playerInternalId,
        DEFAULT_RATING_MU_DECIMAL,
        DEFAULT_RATING_SIGMA_DECIMAL,
        DEFAULT_PLAYER_RATING_SOURCE_REFERENCE,
        nowMs,
      ],
    );
    assertAffected(event, 1, "default rating event");
  }

  public async createVerifiedClaim(input: Readonly<{
    playerClaimId: string;
    playerId: string;
    userAccountId: string;
    reasonCode: string;
    nowMs: number;
  }>): Promise<void> {
    const [claimResult] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO player_claims (
         public_id, revision, privacy_class, player_id, user_account_id,
         claim_status, dispute_status, created_at_ms, updated_at_ms
       )
       SELECT ?, 2, 'private', p.player_id, a.user_account_id,
              'verified', 'none', ?, ?
       FROM players AS p
       INNER JOIN user_accounts AS a ON a.public_id = ?
       WHERE p.public_id = ?
         AND p.player_kind = 'human'`,
      [
        input.playerClaimId,
        input.nowMs,
        input.nowMs,
        input.userAccountId,
        input.playerId,
      ],
    );
    assertAffected(claimResult, 1, "verified claim creation");
    const claimInternalId = claimResult.insertId;

    const [accountRows] = await this.connection.execute<InternalIdRow[]>(
      `SELECT user_account_id AS internalId
       FROM user_accounts WHERE public_id = ? LIMIT 1`,
      [input.userAccountId],
    );
    const accountRow = accountRows[0];
    if (accountRow === undefined ||
      typeof accountRow.internalId !== "number") {
      throw new PlayerOnboardingPersistenceError(
        "UserAccount internal id could not be resolved",
      );
    }

    // A self-created Player carries the complete requested->verified audit
    // trail: the account both requested and (by creation semantics) verified
    // its own brand-new Player, recorded under the self-service reason.
    const events: readonly ["claim_requested" | "claim_verified", number][] = [
      ["claim_requested", 1],
      ["claim_verified", 2],
    ];
    for (const [eventType, sequence] of events) {
      const [lifecycleResult] = await this.connection.execute<ResultSetHeader>(
        `INSERT INTO player_claim_lifecycle (
           player_claim_id, sequence_number, event_type, actor_type,
           actor_user_account_id, occurred_at_ms, reason_code, claim_review_id
         ) VALUES (?, ?, ?, 'requesting_account', ?, ?, ?, NULL)`,
        [
          claimInternalId,
          sequence,
          eventType,
          accountRow.internalId,
          input.nowMs,
          input.reasonCode,
        ],
      );
      assertAffected(lifecycleResult, 1, "claim lifecycle audit");
    }
  }
}

export class MysqlPlayerOnboardingRepository
implements PlayerOnboardingRepository {
  public constructor(private readonly pool: Pool) {}

  public async transaction<T>(
    work: (transaction: PlayerOnboardingTransaction) => Promise<T>,
  ): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(
        new MysqlPlayerOnboardingTransaction(connection),
      );
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      if (isDuplicateKeyError(error)) {
        throw new PlayerOnboardingError(
          "conflict",
          "a Player onboarding uniqueness constraint was occupied concurrently",
        );
      }
      throw error;
    } finally {
      connection.release();
    }
  }
}
