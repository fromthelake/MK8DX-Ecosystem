import type { FieldPacket, QueryResult, RowDataPacket } from "mysql2";

import type {
  IdentityReadRepository,
  PrivatePlayerClaimSummary,
  PrivateUserAccountSummary,
  PublicPlayerProfile,
} from "./types.js";

const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const userAccountIdPattern = /^user_account\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const playerClaimIdPattern = /^player_claim\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

const accountStatuses = new Set(["active", "suspended", "closed"]);
const claimStatuses = new Set([
  "requested",
  "under_review",
  "verified",
  "rejected",
  "released",
  "revoked",
]);
const disputeStatuses = new Set(["none", "open", "resolved"]);

interface PublicPlayerRow extends RowDataPacket {
  playerId: unknown;
  usernameValue: unknown;
  displayName: unknown;
  countryId: unknown;
  avatarId: unknown;
  favoriteBodyId: unknown;
  favoriteTireId: unknown;
  favoriteGliderId: unknown;
  timeTrialModePreference: unknown;
}

interface UserAccountRow extends RowDataPacket {
  userAccountId: unknown;
  accountStatus: unknown;
}

interface PlayerClaimRow extends RowDataPacket {
  playerClaimId: unknown;
  playerId: unknown;
  userAccountId: unknown;
  claimStatus: unknown;
  disputeStatus: unknown;
}

export interface PreparedQueryExecutor {
  execute<T extends QueryResult>(
    sql: string,
    values?: any[],
  ): Promise<[T, FieldPacket[]]>;
}

export class PersistenceContractError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PersistenceContractError";
  }
}

function singleRow<T extends RowDataPacket>(rows: T[], resource: string): T | null {
  if (rows.length === 0) {
    return null;
  }
  if (rows.length !== 1) {
    throw new PersistenceContractError(
      `${resource} lookup returned ${rows.length} rows; expected at most one`,
    );
  }
  const row = rows[0];
  if (row === undefined) {
    throw new PersistenceContractError(`${resource} lookup returned no usable row`);
  }
  return row;
}

function requiredString(
  value: unknown,
  field: string,
  pattern?: RegExp,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    throw new PersistenceContractError(`${field} has an invalid persisted value`);
  }
  return value;
}

function requiredEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: ReadonlySet<string>,
): T {
  const text = requiredString(value, field);
  if (!allowed.has(text)) {
    throw new PersistenceContractError(`${field} has an unsupported persisted value`);
  }
  return text as T;
}

export class MysqlIdentityReadRepository implements IdentityReadRepository {
  public constructor(private readonly executor: PreparedQueryExecutor) {}

  public async findPublicPlayerById(
    playerId: string,
  ): Promise<PublicPlayerProfile | null> {
    const [rows] = await this.executor.execute<PublicPlayerRow[]>(
      `SELECT
         p.public_id AS playerId,
         u.username_value AS usernameValue,
         p.display_name AS displayName,
         p.country_id AS countryId,
         p.avatar_id AS avatarId,
         p.favorite_body_id AS favoriteBodyId,
         p.favorite_tire_id AS favoriteTireId,
         p.favorite_glider_id AS favoriteGliderId,
         account.time_trial_mode_preference AS timeTrialModePreference
       FROM players AS p
       INNER JOIN player_username_history AS u
         ON u.player_id = p.player_id
        AND u.released_at_ms IS NULL
       LEFT JOIN player_claims AS claim
         ON claim.player_id = p.player_id AND claim.claim_status = 'verified'
       LEFT JOIN user_accounts AS account
         ON account.user_account_id = claim.user_account_id AND account.account_status = 'active'
       WHERE p.public_id = ?
         AND p.record_status = 'active'
         AND p.visibility = 'public'
       LIMIT 2`,
      [playerId],
    );
    const row = singleRow(rows, "Player");
    if (row === null) {
      return null;
    }
    return {
      playerId: requiredString(row.playerId, "playerId", playerIdPattern),
      username: {
        value: requiredString(row.usernameValue, "username.value"),
      },
      displayName: requiredString(row.displayName, "displayName"),
      ...(typeof row.countryId === "string" &&
        /^country\.[a-z0-9_]+$/.test(row.countryId)
        ? { countryId: row.countryId }
        : {}),
      ...(typeof row.avatarId === "string" &&
        /^character(_variant)?\.[a-z0-9_.]+$/.test(row.avatarId)
        ? { avatarId: row.avatarId }
        : {}),
      ...(typeof row.favoriteBodyId === "string" && /^body\.[a-z0-9_]+$/.test(row.favoriteBodyId)
        ? { favoriteBodyId: row.favoriteBodyId } : {}),
      ...(typeof row.favoriteTireId === "string" && /^tire\.[a-z0-9_]+$/.test(row.favoriteTireId)
        ? { favoriteTireId: row.favoriteTireId } : {}),
      ...(typeof row.favoriteGliderId === "string" && /^glider\.[a-z0-9_]+$/.test(row.favoriteGliderId)
        ? { favoriteGliderId: row.favoriteGliderId } : {}),
      ...(row.timeTrialModePreference === "all" || row.timeTrialModePreference === "150" || row.timeTrialModePreference === "200"
        ? { timeTrialModePreference: row.timeTrialModePreference } : {}),
    };
  }

  public async findUserAccountSummaryById(
    userAccountId: string,
  ): Promise<PrivateUserAccountSummary | null> {
    const [rows] = await this.executor.execute<UserAccountRow[]>(
      `SELECT
         a.public_id AS userAccountId,
         a.account_status AS accountStatus
       FROM user_accounts AS a
       WHERE a.public_id = ?
       LIMIT 2`,
      [userAccountId],
    );
    const row = singleRow(rows, "UserAccount");
    if (row === null) {
      return null;
    }
    return {
      userAccountId: requiredString(
        row.userAccountId,
        "userAccountId",
        userAccountIdPattern,
      ),
      accountStatus: requiredEnum<PrivateUserAccountSummary["accountStatus"]>(
        row.accountStatus,
        "accountStatus",
        accountStatuses,
      ),
    };
  }

  public async findPlayerClaimSummaryById(
    playerClaimId: string,
  ): Promise<PrivatePlayerClaimSummary | null> {
    const [rows] = await this.executor.execute<PlayerClaimRow[]>(
      `SELECT
         c.public_id AS playerClaimId,
         p.public_id AS playerId,
         a.public_id AS userAccountId,
         c.claim_status AS claimStatus,
         c.dispute_status AS disputeStatus
       FROM player_claims AS c
       INNER JOIN players AS p ON p.player_id = c.player_id
       INNER JOIN user_accounts AS a ON a.user_account_id = c.user_account_id
       WHERE c.public_id = ?
       LIMIT 2`,
      [playerClaimId],
    );
    const row = singleRow(rows, "PlayerClaim");
    if (row === null) {
      return null;
    }
    return {
      playerClaimId: requiredString(
        row.playerClaimId,
        "playerClaimId",
        playerClaimIdPattern,
      ),
      playerId: requiredString(row.playerId, "playerId", playerIdPattern),
      userAccountId: requiredString(
        row.userAccountId,
        "userAccountId",
        userAccountIdPattern,
      ),
      claimStatus: requiredEnum<PrivatePlayerClaimSummary["claimStatus"]>(
        row.claimStatus,
        "claimStatus",
        claimStatuses,
      ),
      disputeStatus: requiredEnum<PrivatePlayerClaimSummary["disputeStatus"]>(
        row.disputeStatus,
        "disputeStatus",
        disputeStatuses,
      ),
    };
  }
}
