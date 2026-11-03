import type { RowDataPacket } from "mysql2";

import type { PreparedQueryExecutor } from
  "../identity/mysql-identity-read-repository.js";
import type { ClaimStatus, DisputeStatus } from "../identity/types.js";
import type {
  AccountPlayerClaimSummary,
  ClaimablePlayerSummary,
  LinkedPlayerAccountSummary,
  PlayerClaimProductRepository,
} from "./player-claim-product-service.js";

const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const accountIdPattern = /^user_account\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const claimIdPattern = /^player_claim\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const claimStatuses = new Set<ClaimStatus>([
  "requested", "under_review", "verified", "rejected", "released", "revoked",
]);
const disputeStatuses = new Set<DisputeStatus>(["none", "open", "resolved"]);

interface PlayerRow extends RowDataPacket {
  playerId: unknown;
  username: unknown;
  displayName: unknown;
  aliasList: unknown;
}

interface LinkedAccountRow extends RowDataPacket {
  playerId: unknown;
  username: unknown;
  displayName: unknown;
  userAccountId: unknown;
}

/**
 * Public active aliases, aggregated per Player. A newline separates them
 * because an alias may legitimately contain a comma ("Marc met C") but never a
 * line break - `aliases.alias_text` is a single-line VARCHAR.
 */
const ALIAS_SELECT = `(SELECT GROUP_CONCAT(a.alias_text SEPARATOR '\n')
                 FROM aliases AS a
                WHERE a.player_id = p.player_id
                  AND a.record_status = 'active'
                  AND a.visibility = 'public') AS aliasList`;

function aliasList(value: unknown): readonly string[] {
  if (typeof value !== "string" || value.length === 0) { return []; }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value.split("\n")) {
    const trimmed = entry.trim();
    if (trimmed.length === 0 || trimmed.length > 128) { continue; }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) { continue; }
    seen.add(key);
    result.push(trimmed);
    if (result.length >= 32) { break; }
  }
  return result;
}
interface ClaimRow extends RowDataPacket {
  playerClaimId: unknown;
  playerId: unknown;
  playerUsername: unknown;
  playerDisplayName: unknown;
  claimStatus: unknown;
  disputeStatus: unknown;
  updatedAtMs: unknown;
}

export class PlayerClaimProductPersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PlayerClaimProductPersistenceError";
  }
}

function text(value: unknown, field: string, pattern?: RegExp): string {
  if (typeof value !== "string" || value.length === 0 ||
    (pattern !== undefined && !pattern.test(value))) {
    throw new PlayerClaimProductPersistenceError(`${field} is invalid`);
  }
  return value;
}

function status<T extends string>(
  value: unknown,
  field: string,
  allowed: ReadonlySet<T>,
): T {
  const parsed = text(value, field) as T;
  if (!allowed.has(parsed)) {
    throw new PlayerClaimProductPersistenceError(`${field} is invalid`);
  }
  return parsed;
}

function epoch(value: unknown): number {
  const parsed = typeof value === "string" && /^[0-9]+$/.test(value)
    ? Number(value)
    : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new PlayerClaimProductPersistenceError("updatedAtMs is invalid");
  }
  return parsed;
}

export class MysqlPlayerClaimProductRepository
  implements PlayerClaimProductRepository
{
  public constructor(private readonly executor: PreparedQueryExecutor) {}

  public async searchActivePlayers(
    query: string,
  ): Promise<readonly ClaimablePlayerSummary[]> {
    const escaped = query.replace(/[!%_]/g, "!$&");
    const [rows] = await this.executor.execute<PlayerRow[]>(
      `SELECT p.public_id AS playerId,
              u.username_value AS username,
              p.display_name AS displayName,
              ${ALIAS_SELECT}
       FROM players AS p
       INNER JOIN player_username_history AS u
         ON u.player_id = p.player_id
        AND u.released_at_ms IS NULL
       WHERE p.player_kind = 'human'
         AND p.record_status = 'active'
         AND (
           p.public_id = ?
           OR u.username_value LIKE CONCAT(?, '%') ESCAPE '!'
           OR p.display_name LIKE CONCAT(?, '%') ESCAPE '!'
         )
       ORDER BY (p.public_id = ?) DESC,
                (u.username_value = ?) DESC,
                u.username_value ASC,
                p.public_id ASC
       LIMIT 20`,
      [query, escaped, escaped, query, query],
    );
    return rows.map((row) => ({
      playerId: text(row.playerId, "playerId", playerIdPattern),
      username: text(row.username, "username"),
      displayName: text(row.displayName, "displayName"),
      aliases: aliasList(row.aliasList),
    }));
  }

  public async listActivePlayers(): Promise<readonly ClaimablePlayerSummary[]> {
    const [rows] = await this.executor.execute<PlayerRow[]>(
      `SELECT p.public_id AS playerId,
              u.username_value AS username,
              p.display_name AS displayName,
              ${ALIAS_SELECT}
       FROM players AS p
       INNER JOIN player_username_history AS u
         ON u.player_id = p.player_id
        AND u.released_at_ms IS NULL
       WHERE p.player_kind = 'human'
         AND p.record_status = 'active'
       ORDER BY p.display_name ASC, u.username_value ASC, p.public_id ASC
       LIMIT 500`,
    );
    return rows.map((row) => ({
      playerId: text(row.playerId, "playerId", playerIdPattern),
      username: text(row.username, "username"),
      displayName: text(row.displayName, "displayName"),
      aliases: aliasList(row.aliasList),
    }));
  }

  public async listClaimsForAccount(
    userAccountId: string,
  ): Promise<readonly AccountPlayerClaimSummary[]> {
    if (!accountIdPattern.test(userAccountId) || userAccountId.length > 141) {
      throw new PlayerClaimProductPersistenceError("userAccountId is invalid");
    }
    const [rows] = await this.executor.execute<ClaimRow[]>(
      `SELECT claim.public_id AS playerClaimId,
              player.public_id AS playerId,
              username.username_value AS playerUsername,
              player.display_name AS playerDisplayName,
              claim.claim_status AS claimStatus,
              claim.dispute_status AS disputeStatus,
              claim.updated_at_ms AS updatedAtMs
       FROM player_claims AS claim
       INNER JOIN user_accounts AS account
         ON account.user_account_id = claim.user_account_id
       INNER JOIN players AS player ON player.player_id = claim.player_id
       INNER JOIN player_username_history AS username
         ON username.player_id = player.player_id
        AND username.released_at_ms IS NULL
       WHERE account.public_id = ?
         AND account.account_status = 'active'
       ORDER BY claim.updated_at_ms DESC, claim.public_id ASC
       LIMIT 20`,
      [userAccountId],
    );
    return rows.map((row) => ({
      playerClaimId: text(row.playerClaimId, "playerClaimId", claimIdPattern),
      playerId: text(row.playerId, "playerId", playerIdPattern),
      playerUsername: text(row.playerUsername, "playerUsername"),
      playerDisplayName: text(row.playerDisplayName, "playerDisplayName"),
      claimStatus: status(row.claimStatus, "claimStatus", claimStatuses),
      disputeStatus: status(row.disputeStatus, "disputeStatus", disputeStatuses),
      updatedAtMs: epoch(row.updatedAtMs),
    }));
  }

  public async listLinkedPlayerAccounts(): Promise<
    readonly LinkedPlayerAccountSummary[]
  > {
    const [rows] = await this.executor.execute<LinkedAccountRow[]>(
      `SELECT player.public_id AS playerId,
              username.username_value AS username,
              player.display_name AS displayName,
              account.public_id AS userAccountId
         FROM player_claims AS claim
         INNER JOIN players AS player ON player.player_id = claim.player_id
         INNER JOIN user_accounts AS account
           ON account.user_account_id = claim.user_account_id
         INNER JOIN player_username_history AS username
           ON username.player_id = player.player_id
          AND username.released_at_ms IS NULL
        WHERE claim.claim_status = 'verified'
          AND player.record_status = 'active'
        ORDER BY player.display_name ASC
        LIMIT 500`,
    );
    return rows.map((row) => ({
      playerId: text(row.playerId, "playerId", playerIdPattern),
      username: text(row.username, "username"),
      displayName: text(row.displayName, "displayName"),
      userAccountId: text(row.userAccountId, "userAccountId", accountIdPattern),
    }));
  }

  public async listClaimsForAdministrator(): Promise<
    readonly AccountPlayerClaimSummary[]
  > {
    const [rows] = await this.executor.execute<ClaimRow[]>(
      `SELECT claim.public_id AS playerClaimId,
              player.public_id AS playerId,
              username.username_value AS playerUsername,
              player.display_name AS playerDisplayName,
              claim.claim_status AS claimStatus,
              claim.dispute_status AS disputeStatus,
              claim.updated_at_ms AS updatedAtMs
       FROM player_claims AS claim
       INNER JOIN players AS player ON player.player_id = claim.player_id
       INNER JOIN player_username_history AS username
         ON username.player_id = player.player_id
        AND username.released_at_ms IS NULL
       WHERE (
         claim.claim_status IN ('requested', 'under_review')
         OR claim.dispute_status = 'open'
       )
       ORDER BY claim.updated_at_ms ASC, claim.public_id ASC
       LIMIT 50`,
    );
    return rows.map((row) => ({
      playerClaimId: text(row.playerClaimId, "playerClaimId", claimIdPattern),
      playerId: text(row.playerId, "playerId", playerIdPattern),
      playerUsername: text(row.playerUsername, "playerUsername"),
      playerDisplayName: text(row.playerDisplayName, "playerDisplayName"),
      claimStatus: status(row.claimStatus, "claimStatus", claimStatuses),
      disputeStatus: status(row.disputeStatus, "disputeStatus", disputeStatuses),
      updatedAtMs: epoch(row.updatedAtMs),
    }));
  }
}
