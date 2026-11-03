import type { RowDataPacket } from "mysql2";

import type { PreparedQueryExecutor } from
  "../identity/mysql-identity-read-repository.js";
import type {
  VerifiedPlayerForAccount,
  WebManualSessionRepository,
} from "./web-manual-session-service.js";


const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const userAccountIdPattern = /^user_account\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const usernamePattern = /^[a-z0-9_-]{3,16}$/;
const controlCharacters = /[\u0000-\u001f\u007f]/;

interface VerifiedPlayerRow extends RowDataPacket {
  playerId: unknown;
  username: unknown;
  displayName: unknown;
}

export class WebManualSessionPersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WebManualSessionPersistenceError";
  }
}

export class MysqlWebManualSessionRepository
  implements WebManualSessionRepository
{
  public constructor(private readonly executor: PreparedQueryExecutor) {}

  public async findVerifiedPlayerForAccount(
    userAccountId: string,
  ): Promise<VerifiedPlayerForAccount | null> {
    if (!userAccountIdPattern.test(userAccountId) || userAccountId.length > 141) {
      throw new WebManualSessionPersistenceError("userAccountId is invalid");
    }
    const [rows] = await this.executor.execute<VerifiedPlayerRow[]>(
      `SELECT p.public_id AS playerId,
              u.username_value AS username,
              p.display_name AS displayName
       FROM user_accounts AS a
       INNER JOIN player_claims AS c
         ON c.user_account_id = a.user_account_id
        AND c.claim_status = 'verified'
       INNER JOIN players AS p
         ON p.player_id = c.player_id
        AND p.record_status = 'active'
        AND p.player_kind = 'human'
       INNER JOIN player_username_history AS u
         ON u.player_id = p.player_id
        AND u.released_at_ms IS NULL
       WHERE a.public_id = ?
         AND a.account_status = 'active'
       LIMIT 2`,
      [userAccountId],
    );
    if (rows.length === 0) { return null; }
    if (rows.length !== 1 || rows[0] === undefined) {
      throw new WebManualSessionPersistenceError(
        "verified Player lookup returned an invalid row count",
      );
    }
    const playerId = rows[0].playerId;
    if (typeof playerId !== "string" || playerId.length > 135 ||
      !playerIdPattern.test(playerId)) {
      throw new WebManualSessionPersistenceError(
        "verified Player lookup returned an invalid Player ID",
      );
    }
    const username = rows[0].username;
    if (typeof username !== "string" || !usernamePattern.test(username)) {
      throw new WebManualSessionPersistenceError(
        "verified Player lookup returned an invalid username",
      );
    }
    const displayName = rows[0].displayName;
    if (typeof displayName !== "string" || displayName.length === 0 ||
      displayName.length > 64 || controlCharacters.test(displayName)) {
      throw new WebManualSessionPersistenceError(
        "verified Player lookup returned an invalid display name",
      );
    }
    return { playerId, username, displayName };
  }
}
