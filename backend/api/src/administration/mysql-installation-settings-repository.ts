import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import {
  CARRIED_TIMES_POLICIES,
  PLAYER_CREATION_POLICIES,
  RATING_ELIGIBILITY_POLICIES,
  type CarriedTimesPolicy,
  type InstallationSettingsRepository,
  type InstallationSettingsTransaction,
  type PlayerCreationPolicy,
  type RatingEligibilityPolicy,
  type StoredInstallationSettings,
} from "./installation-settings-service.js";

class InstallationSettingsPersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InstallationSettingsPersistenceError";
  }
}

function integer(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) { throw new InstallationSettingsPersistenceError(`${label} is invalid`); }
  return parsed;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new InstallationSettingsPersistenceError(`${label} is invalid`);
  }
  return value as T;
}

const projection = `SELECT revision, player_creation AS playerCreation, rating_eligibility AS ratingEligibility,
       carried_times AS carriedTimes,
       rating_eligibility_changed_at_ms AS ratingEligibilityChangedAtMs, updated_at_ms AS updatedAtMs
FROM installation_settings WHERE installation_settings_id = 1`;

function stored(row: RowDataPacket | undefined): StoredInstallationSettings | null {
  if (row === undefined) { return null; }
  return {
    revision: integer(row["revision"], "settings revision"),
    playerCreation: oneOf<PlayerCreationPolicy>(row["playerCreation"], PLAYER_CREATION_POLICIES, "player creation"),
    ratingEligibility: oneOf<RatingEligibilityPolicy>(row["ratingEligibility"], RATING_ELIGIBILITY_POLICIES, "rating eligibility"),
    carriedTimes: oneOf<CarriedTimesPolicy>(row["carriedTimes"], CARRIED_TIMES_POLICIES, "carried times"),
    ratingEligibilityChangedAtMs: row["ratingEligibilityChangedAtMs"] === null
      ? null : integer(row["ratingEligibilityChangedAtMs"], "eligibility change time"),
    updatedAtMs: integer(row["updatedAtMs"], "settings update time"),
  };
}

class MysqlInstallationSettingsTransaction implements InstallationSettingsTransaction {
  public constructor(private readonly connection: PoolConnection) {}

  public async findActiveAdministratorAccount(userAccountPublicId: string): Promise<number | null> {
    const [rows] = await this.connection.execute<RowDataPacket[]>(
      `SELECT account.user_account_id AS internalId
       FROM administrator_grants AS grant_record
       INNER JOIN user_accounts AS account ON account.user_account_id = grant_record.user_account_id
       WHERE account.public_id = ? AND grant_record.grant_status = 'active' AND account.account_status = 'active'
       LIMIT 1`,
      [userAccountPublicId],
    );
    return rows[0] === undefined ? null : integer(rows[0]["internalId"], "administrator account id");
  }

  public async readForUpdate(): Promise<StoredInstallationSettings | null> {
    const [rows] = await this.connection.execute<RowDataPacket[]>(`${projection} FOR UPDATE`);
    return stored(rows[0]);
  }

  public async write(input: Parameters<InstallationSettingsTransaction["write"]>[0]): Promise<void> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO installation_settings (
         installation_settings_id, revision, player_creation, rating_eligibility, carried_times,
         rating_eligibility_changed_at_ms, updated_by_user_account_id, updated_at_ms
       ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         revision = VALUES(revision), player_creation = VALUES(player_creation),
         rating_eligibility = VALUES(rating_eligibility), carried_times = VALUES(carried_times),
         rating_eligibility_changed_at_ms = VALUES(rating_eligibility_changed_at_ms),
         updated_by_user_account_id = VALUES(updated_by_user_account_id),
         updated_at_ms = VALUES(updated_at_ms)`,
      [
        input.revision, input.playerCreation, input.ratingEligibility, input.carriedTimes, input.ratingEligibilityChangedAtMs,
        input.updatedByInternalId, input.nowMs,
      ],
    );
    if (result.affectedRows < 1) { throw new InstallationSettingsPersistenceError("installation settings did not persist"); }
  }

  public async appendChange(input: Parameters<InstallationSettingsTransaction["appendChange"]>[0]): Promise<void> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO installation_setting_changes (
         setting_key, previous_value, new_value, changed_by_user_account_id, occurred_at_ms
       ) VALUES (?, ?, ?, ?, ?)`,
      [input.settingKey, input.previousValue, input.newValue, input.changedByInternalId, input.nowMs],
    );
    if (result.affectedRows !== 1) { throw new InstallationSettingsPersistenceError("installation setting change did not persist"); }
  }
}

export class MysqlInstallationSettingsRepository implements InstallationSettingsRepository {
  public constructor(private readonly pool: Pool) {}

  public async read(): Promise<StoredInstallationSettings | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(projection);
    return stored(rows[0]);
  }

  public async recomputeFacts(input: Readonly<{ ratingEligibility: RatingEligibilityPolicy }>) {
    const [recalculations] = await this.pool.execute<RowDataPacket[]>(
      "SELECT MAX(occurred_at_ms) AS lastAt FROM rating_recalculations",
    );
    const lastRaw = recalculations[0]?.["lastAt"];
    const lastRecalculatedAtMs = lastRaw === null || lastRaw === undefined ? null : integer(lastRaw, "last recalculation");
    let claimsMatter = input.ratingEligibility === "claimed_only";
    if (!claimsMatter) {
      const [nights] = await this.pool.execute<RowDataPacket[]>(
        `SELECT 1 AS present FROM tournaments
         WHERE verified_only = TRUE AND affects_rating = TRUE AND stage = 'finalized' AND lifecycle_status = 'active'
         LIMIT 1`,
      );
      claimsMatter = nights.length > 0;
    }
    if (!claimsMatter) {
      return { lastRecalculatedAtMs, claimsMatter, claimChangesSinceLastRecalculation: 0 };
    }
    // Only claims of Players who raced: a new Player's own claim changes nobody's rating.
    const [changes] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS changes
       FROM player_claim_lifecycle AS event
       INNER JOIN player_claims AS claim ON claim.player_claim_id = event.player_claim_id
       WHERE event.event_type IN ('claim_verified', 'claim_released', 'claim_revoked')
         AND event.occurred_at_ms > ?
         AND (EXISTS (SELECT 1 FROM tournament_race_placements AS placement WHERE placement.player_id = claim.player_id)
           OR EXISTS (SELECT 1 FROM tournament_history_placements AS history WHERE history.player_id = claim.player_id))`,
      [lastRecalculatedAtMs ?? 0],
    );
    return {
      lastRecalculatedAtMs,
      claimsMatter,
      claimChangesSinceLastRecalculation: integer(changes[0]?.["changes"] ?? 0, "claim changes"),
    };
  }

  public async transaction<T>(work: (transaction: InstallationSettingsTransaction) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(new MysqlInstallationSettingsTransaction(connection));
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
