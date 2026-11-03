import { describe, expect, it } from "vitest";
import type { FieldPacket, QueryResult, RowDataPacket } from "mysql2";

import {
  AliasReadPersistenceError,
  MysqlAliasReadRepository,
  type AliasPreparedQueryExecutor,
} from "../src/identity/mysql-alias-read-repository.js";

class SyntheticExecutor implements AliasPreparedQueryExecutor {
  readonly calls: { sql: string; values: unknown[] }[] = [];

  constructor(private readonly rows: RowDataPacket[][]) {}

  async execute<T extends QueryResult>(
    sql: string,
    values?: any[],
  ): Promise<[T, FieldPacket[]]> {
    this.calls.push({ sql, values: values ?? [] });
    const result = this.rows.shift();
    if (result === undefined) {
      throw new Error("synthetic executor has no queued rows");
    }
    return [result as unknown as T, []];
  }
}

const aliasId = "alias.synthetic_public_01";

describe("MySQL public Alias read repository", () => {
  it("maps only the allow-listed active/public projection", async () => {
    const executor = new SyntheticExecutor([
      [
        {
          aliasId,
          playerId: "player.synthetic_public_01",
          aliasText: "Synthetic Public Alias",
          aliasType: "tournament_name",
          reviewerPrivate: "must-not-map",
        } as RowDataPacket,
      ],
    ]);
    const repository = new MysqlAliasReadRepository(executor);

    await expect(repository.findPublicAliasById(aliasId)).resolves.toEqual({
      aliasId,
      playerId: "player.synthetic_public_01",
      aliasText: "Synthetic Public Alias",
      aliasType: "tournament_name",
    });
    expect(executor.calls[0]?.values).toEqual([aliasId]);
    expect(executor.calls[0]?.sql).toContain("visibility = 'public'");
    expect(executor.calls[0]?.sql).toContain("record_status = 'active'");
    expect(executor.calls[0]?.sql).not.toMatch(/provenance|reviewed_by|reviewed_at/i);
  });

  it("returns null for restricted, retired, or missing rows filtered by SQL", async () => {
    const repository = new MysqlAliasReadRepository(new SyntheticExecutor([[]]));
    await expect(repository.findPublicAliasById(aliasId)).resolves.toBeNull();
  });

  it("lists a deterministic bounded public projection for one prepared Player", async () => {
    const playerId = "player.synthetic_public_01";
    const executor = new SyntheticExecutor([[
      {
        aliasId: "alias.synthetic_public_a",
        playerId,
        aliasText: "Alpha",
        aliasType: "declared",
      } as RowDataPacket,
      {
        aliasId: "alias.synthetic_public_b",
        playerId,
        aliasText: "Beta",
        aliasType: "legacy_handle",
      } as RowDataPacket,
    ]]);
    const repository = new MysqlAliasReadRepository(executor);
    await expect(repository.listPublicAliasesByPlayerId(playerId)).resolves.toEqual([
      { aliasId: "alias.synthetic_public_a", playerId, aliasText: "Alpha", aliasType: "declared" },
      { aliasId: "alias.synthetic_public_b", playerId, aliasText: "Beta", aliasType: "legacy_handle" },
    ]);
    expect(executor.calls[0]?.values).toEqual([playerId]);
    expect(executor.calls[0]?.sql).toContain("ORDER BY alias_record.alias_text");
    expect(executor.calls[0]?.sql).toContain("LIMIT 100");
    expect(executor.calls[0]?.sql).not.toContain(playerId);
  });

  it("rejects duplicate rows instead of selecting one", async () => {
    const row = {
      aliasId,
      playerId: "player.synthetic_public_01",
      aliasText: "Synthetic Public Alias",
      aliasType: "tournament_name",
    } as RowDataPacket;
    const repository = new MysqlAliasReadRepository(
      new SyntheticExecutor([[row, row]]),
    );
    await expect(repository.findPublicAliasById(aliasId)).rejects.toThrow(
      AliasReadPersistenceError,
    );
  });

  it("rejects unsupported stored types and keeps lookup text prepared", async () => {
    const executor = new SyntheticExecutor([
      [
        {
          aliasId,
          playerId: "player.synthetic_public_01",
          aliasText: "Synthetic Public Alias",
          aliasType: "identity_merge",
        } as RowDataPacket,
      ],
    ]);
    const repository = new MysqlAliasReadRepository(executor);
    await expect(repository.findPublicAliasById(aliasId)).rejects.toThrow(
      "Alias.aliasType has an unsupported persisted value",
    );
    expect(executor.calls[0]?.sql).not.toContain(aliasId);
  });
});
