/** MySQL persistence for ADR-0224 phase 2 (migration 0085_account_switching). */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import type {
  AccountSwitchPinStore,
  AccountSwitchStore,
  RememberedAccountRow,
  StoredSwitchPin,
} from "./account-switch.js";

interface RememberedRow extends RowDataPacket {
  entryId: unknown;
  authUserId: unknown;
  lastUsedAtMs: unknown;
}

export class MysqlAccountSwitchStore implements AccountSwitchStore {
  public constructor(private readonly pool: Pick<Pool, "execute">) {}

  public async remember(deviceDigest: Buffer, authUserId: string, newEntryId: string, nowMs: number,
                        maximum: number): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO account_switch_remembered_accounts
         (entry_id, device_digest, auth_user_id, remembered_at_ms, last_used_at_ms)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE last_used_at_ms = GREATEST(last_used_at_ms, VALUES(last_used_at_ms))`,
      [newEntryId, deviceDigest, authUserId, nowMs, nowMs],
    );
    // Beyond the maximum the least recently used accounts are forgotten on this device.
    const [rows] = await this.pool.execute<RememberedRow[]>(
      `SELECT entry_id AS entryId FROM account_switch_remembered_accounts
       WHERE device_digest = ? ORDER BY last_used_at_ms DESC, entry_id ASC`,
      [deviceDigest],
    );
    const surplus = rows.slice(maximum).map((row) => String(row.entryId));
    for (const entryId of surplus) {
      await this.pool.execute<ResultSetHeader>(
        "DELETE FROM account_switch_remembered_accounts WHERE entry_id = ? AND device_digest = ?",
        [entryId, deviceDigest],
      );
    }
  }

  public async list(deviceDigest: Buffer, notBeforeMs: number): Promise<readonly RememberedAccountRow[]> {
    await this.pool.execute<ResultSetHeader>(
      "DELETE FROM account_switch_remembered_accounts WHERE device_digest = ? AND last_used_at_ms < ?",
      [deviceDigest, Math.max(0, notBeforeMs)],
    );
    const [rows] = await this.pool.execute<RememberedRow[]>(
      `SELECT entry_id AS entryId, auth_user_id AS authUserId, last_used_at_ms AS lastUsedAtMs
       FROM account_switch_remembered_accounts
       WHERE device_digest = ? AND last_used_at_ms >= ?
       ORDER BY last_used_at_ms DESC, entry_id ASC
       LIMIT 16`,
      [deviceDigest, Math.max(0, notBeforeMs)],
    );
    return rows.flatMap((row) => typeof row.entryId === "string" && typeof row.authUserId === "string"
      ? [{ entryId: row.entryId, authUserId: row.authUserId, lastUsedAtMs: Number(row.lastUsedAtMs) }]
      : []);
  }

  public async touch(deviceDigest: Buffer, entryId: string, nowMs: number): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `UPDATE account_switch_remembered_accounts
       SET last_used_at_ms = GREATEST(last_used_at_ms, ?)
       WHERE entry_id = ? AND device_digest = ?`,
      [nowMs, entryId, deviceDigest],
    );
  }

  public async forget(deviceDigest: Buffer, authUserId: string): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      "DELETE FROM account_switch_remembered_accounts WHERE device_digest = ? AND auth_user_id = ?",
      [deviceDigest, authUserId],
    );
  }

  public async forgetEverywhere(authUserId: string): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      "DELETE FROM account_switch_remembered_accounts WHERE auth_user_id = ?",
      [authUserId],
    );
  }

  public async forgetElsewhere(authUserId: string, keepDeviceDigest: Buffer | null): Promise<void> {
    if (keepDeviceDigest === null) { await this.forgetEverywhere(authUserId); return; }
    await this.pool.execute<ResultSetHeader>(
      "DELETE FROM account_switch_remembered_accounts WHERE auth_user_id = ? AND device_digest <> ?",
      [authUserId, keepDeviceDigest],
    );
  }

  public async recordSwitchSession(sessionId: string, nowMs: number): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      "INSERT IGNORE INTO account_switch_sessions (session_id, created_at_ms) VALUES (?, ?)",
      [sessionId, nowMs],
    );
  }

  public async isSwitchSession(sessionId: string): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT 1 AS present FROM account_switch_sessions WHERE session_id = ? LIMIT 1",
      [sessionId],
    );
    return rows.length > 0;
  }
}

interface PinRow extends RowDataPacket { digest: unknown; salt: unknown; pepperVersion: unknown; }

/** PINs are keyed by UserAccount; only peppered scrypt digests are stored. */
export class MysqlAccountSwitchPinStore implements AccountSwitchPinStore {
  public constructor(private readonly pool: Pick<Pool, "execute">) {}

  public async get(userAccountId: string): Promise<StoredSwitchPin | null> {
    const [rows] = await this.pool.execute<PinRow[]>(
      `SELECT pin.pin_digest AS digest, pin.pin_salt AS salt, pin.pepper_version AS pepperVersion
       FROM account_switch_pins AS pin
       INNER JOIN user_accounts AS account ON account.user_account_id = pin.user_account_id
       WHERE account.public_id = ? AND account.account_status = 'active'
       LIMIT 1`,
      [userAccountId],
    );
    const row = rows[0];
    if (row === undefined || !Buffer.isBuffer(row.digest) || !Buffer.isBuffer(row.salt)) { return null; }
    return { digest: row.digest, salt: row.salt, pepperVersion: Number(row.pepperVersion) };
  }

  public async set(userAccountId: string, pin: StoredSwitchPin, nowMs: number): Promise<void> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO account_switch_pins
         (user_account_id, pin_digest, pin_salt, pepper_version, created_at_ms, updated_at_ms)
       SELECT account.user_account_id, ?, ?, ?, ?, ?
       FROM user_accounts AS account
       WHERE account.public_id = ? AND account.account_status = 'active'
       ON DUPLICATE KEY UPDATE pin_digest = VALUES(pin_digest), pin_salt = VALUES(pin_salt),
         pepper_version = VALUES(pepper_version),
         updated_at_ms = GREATEST(account_switch_pins.created_at_ms, VALUES(updated_at_ms))`,
      [pin.digest, pin.salt, pin.pepperVersion, nowMs, nowMs, userAccountId],
    );
    if (result.affectedRows < 1) { throw new Error("account unavailable for a PIN"); }
  }

  public async clear(userAccountId: string): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `DELETE pin FROM account_switch_pins AS pin
       INNER JOIN user_accounts AS account ON account.user_account_id = pin.user_account_id
       WHERE account.public_id = ?`,
      [userAccountId],
    );
  }
}

interface LabelRow extends RowDataPacket {
  playerName: unknown; playerPublicId: unknown; offlineLabel: unknown; offlineRole: unknown;
}

/**
 * The label a remembered account is shown under, and whether an offline account is an
 * administrator. Read-only; nothing is linked or inferred from a name.
 */
export class MysqlAccountSwitchLabels {
  public constructor(private readonly pool: Pick<Pool, "execute">) {}

  public async describe(userAccountId: string): Promise<Readonly<{
    label: string | null;
    playerId: string | null;
    offlineAdministrator: boolean;
  }>> {
    const [rows] = await this.pool.execute<LabelRow[]>(
      `SELECT
         (SELECT player.display_name
            FROM player_claims AS claim
            INNER JOIN players AS player
              ON player.player_id = claim.player_id AND player.record_status = 'active'
           WHERE claim.user_account_id = account.user_account_id AND claim.claim_status = 'verified'
           ORDER BY claim.player_claim_id LIMIT 1) AS playerName,
         (SELECT player.public_id
            FROM player_claims AS claim
            INNER JOIN players AS player
              ON player.player_id = claim.player_id AND player.record_status = 'active'
           WHERE claim.user_account_id = account.user_account_id AND claim.claim_status = 'verified'
           ORDER BY claim.player_claim_id LIMIT 1) AS playerPublicId,
         (SELECT offline.display_label FROM offline_auth_accounts AS offline
           WHERE offline.user_account_id = account.user_account_id AND offline.active = TRUE
           LIMIT 1) AS offlineLabel,
         (SELECT offline.account_role FROM offline_auth_accounts AS offline
           WHERE offline.user_account_id = account.user_account_id
           LIMIT 1) AS offlineRole
       FROM user_accounts AS account
       WHERE account.public_id = ?
       LIMIT 1`,
      [userAccountId],
    );
    const row = rows[0];
    const text = (value: unknown): string | null =>
      typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, 128) : null;
    return {
      label: row === undefined ? null : text(row.playerName) ?? text(row.offlineLabel),
      playerId: typeof row?.playerPublicId === "string" && /^player\.[a-z0-9._-]{1,128}$/.test(row.playerPublicId)
        ? row.playerPublicId : null,
      offlineAdministrator: row?.offlineRole === "administrator",
    };
  }
}
