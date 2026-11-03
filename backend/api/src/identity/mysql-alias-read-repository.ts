import type { FieldPacket, QueryResult, RowDataPacket } from "mysql2";

import type {
  AliasReadRepository,
  AliasType,
  PublicAliasProfile,
} from "./alias-service.js";

interface PublicAliasRow extends RowDataPacket {
  aliasId: unknown;
  playerId: unknown;
  aliasText: unknown;
  aliasType: unknown;
}

export interface AliasPreparedQueryExecutor {
  execute<T extends QueryResult>(
    sql: string,
    values?: any[],
  ): Promise<[T, FieldPacket[]]>;
}

const aliasIdPattern = /^alias\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const aliasTypes = new Set<AliasType>([
  "declared",
  "legacy_handle",
  "tournament_name",
  "ocr_observation",
  "other_observation",
]);

export class AliasReadPersistenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AliasReadPersistenceError";
  }
}

function requiredString(value: unknown, field: string, pattern?: RegExp): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    throw new AliasReadPersistenceError(`${field} has an invalid persisted value`);
  }
  return value;
}

function publicAlias(row: PublicAliasRow): PublicAliasProfile {
  const aliasType = requiredString(row.aliasType, "Alias.aliasType");
  if (!aliasTypes.has(aliasType as AliasType)) {
    throw new AliasReadPersistenceError(
      "Alias.aliasType has an unsupported persisted value",
    );
  }
  return {
    aliasId: requiredString(row.aliasId, "Alias.aliasId", aliasIdPattern),
    playerId: requiredString(row.playerId, "Alias.playerId", playerIdPattern),
    aliasText: requiredString(row.aliasText, "Alias.aliasText"),
    aliasType: aliasType as AliasType,
  };
}

export class MysqlAliasReadRepository implements AliasReadRepository {
  public constructor(private readonly executor: AliasPreparedQueryExecutor) {}

  public async findPublicAliasById(
    aliasId: string,
  ): Promise<PublicAliasProfile | null> {
    const [rows] = await this.executor.execute<PublicAliasRow[]>(
      `SELECT
         alias_record.public_id AS aliasId,
         player.public_id AS playerId,
         alias_record.alias_text AS aliasText,
         alias_record.alias_type AS aliasType
       FROM aliases AS alias_record
       INNER JOIN players AS player ON player.player_id = alias_record.player_id
       WHERE alias_record.public_id = ?
         AND alias_record.visibility = 'public'
         AND alias_record.record_status = 'active'
         AND player.record_status = 'active'
         AND player.visibility = 'public'
       LIMIT 2`,
      [aliasId],
    );
    if (rows.length === 0) {
      return null;
    }
    if (rows.length !== 1 || rows[0] === undefined) {
      throw new AliasReadPersistenceError(
        "public Alias lookup returned an invalid row count",
      );
    }
    return publicAlias(rows[0]);
  }

  public async listPublicAliasesByPlayerId(
    playerId: string,
  ): Promise<readonly PublicAliasProfile[]> {
    const [rows] = await this.executor.execute<PublicAliasRow[]>(
      `SELECT
         alias_record.public_id AS aliasId,
         player.public_id AS playerId,
         alias_record.alias_text AS aliasText,
         alias_record.alias_type AS aliasType
       FROM aliases AS alias_record
       INNER JOIN players AS player ON player.player_id = alias_record.player_id
       WHERE player.public_id = ?
         AND alias_record.visibility = 'public'
         AND alias_record.record_status = 'active'
         AND player.record_status = 'active'
         AND player.visibility = 'public'
       ORDER BY alias_record.alias_text, alias_record.public_id
       LIMIT 100`,
      [playerId],
    );
    return rows.map(publicAlias);
  }
}
