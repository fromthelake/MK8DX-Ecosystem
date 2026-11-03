import type { Pool, RowDataPacket } from "mysql2/promise";

import {
  isClientName,
  type ClientCheckin,
  type ClientInstallationRepository,
  type ClientInstallationRow,
} from "./client-installations.js";

type PreparedQueryExecutor = Pick<Pool, "execute">;

type InstallationRow = RowDataPacket & {
  userAccountId: string;
  playerId: string | null;
  displayName: string | null;
  installationId: string;
  clientName: string;
  clientVersion: string;
  clientBuild: number | null;
  deviceModel: string | null;
  firstSeenAtMs: number | string;
  lastSeenAtMs: number | string;
  checkinCount: number | string;
};

function count(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("client installation row is invalid");
  }
  return parsed;
}

export class MysqlClientInstallationRepository implements ClientInstallationRepository {
  public constructor(private readonly executor: PreparedQueryExecutor) {}

  public async record(
    userAccountId: string,
    checkin: ClientCheckin,
    nowMs: number,
    forgetBeforeMs: number,
  ): Promise<void> {
    // The same version on the same installation is one row: only its last-seen
    // moves and its count goes up. A new version is a new row beside the old
    // one, which is the history.
    await this.executor.execute(
      `INSERT INTO client_installations
         (user_account_id, installation_id, client_name, client_version,
          client_build, device_model, first_seen_at_ms, last_seen_at_ms, checkin_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         last_seen_at_ms = VALUES(last_seen_at_ms),
         checkin_count = checkin_count + 1,
         client_build = COALESCE(VALUES(client_build), client_build),
         device_model = COALESCE(VALUES(device_model), device_model)`,
      [
        userAccountId,
        checkin.installationId,
        checkin.client,
        checkin.version,
        checkin.build ?? null,
        checkin.deviceModel ?? null,
        nowMs,
        nowMs,
      ],
    );
    // The retention rule, applied by the write itself so that nothing has to
    // remember to run it: this account's own rows, untouched since the bound.
    await this.executor.execute(
      `DELETE FROM client_installations
        WHERE user_account_id = ? AND last_seen_at_ms < ?`,
      [userAccountId, forgetBeforeMs],
    );
  }

  public async list(limit: number): Promise<readonly ClientInstallationRow[]> {
    const [rows] = await this.executor.execute<InstallationRow[]>(
      `SELECT account.public_id AS userAccountId,
              player.public_id AS playerId,
              player.display_name AS displayName,
              installation.installation_id AS installationId,
              installation.client_name AS clientName,
              installation.client_version AS clientVersion,
              installation.client_build AS clientBuild,
              installation.device_model AS deviceModel,
              installation.first_seen_at_ms AS firstSeenAtMs,
              installation.last_seen_at_ms AS lastSeenAtMs,
              installation.checkin_count AS checkinCount
         FROM client_installations installation
         INNER JOIN user_accounts account
                 ON account.user_account_id = installation.user_account_id
         LEFT JOIN player_claims claim
                ON claim.user_account_id = installation.user_account_id
               AND claim.claim_status = 'verified'
         LEFT JOIN players player ON player.player_id = claim.player_id
        ORDER BY installation.last_seen_at_ms DESC
        LIMIT ?`,
      [String(Math.max(1, Math.min(limit, 1000)))],
    );
    return rows.map((row) => {
      if (!isClientName(row.clientName)) {
        throw new Error("client installation row is invalid");
      }
      return {
        userAccountId: row.userAccountId,
        ...(row.playerId === null ? {} : { playerId: row.playerId }),
        ...(row.displayName === null ? {} : { displayName: row.displayName }),
        installationId: row.installationId,
        client: row.clientName,
        version: row.clientVersion,
        ...(row.clientBuild === null ? {} : { build: count(row.clientBuild) }),
        ...(row.deviceModel === null ? {} : { deviceModel: row.deviceModel }),
        firstSeenAtMs: count(row.firstSeenAtMs),
        lastSeenAtMs: count(row.lastSeenAtMs),
        checkinCount: count(row.checkinCount),
      };
    });
  }
}
