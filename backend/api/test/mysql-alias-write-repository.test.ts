import { describe, expect, it } from "vitest";
import type { FieldPacket, QueryResult, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";

import { AliasServiceError } from "../src/identity/alias-service.js";
import { MysqlAliasWriteRepository } from "../src/identity/mysql-alias-write-repository.js";

class SyntheticConnection {
  readonly calls: { sql: string; values: unknown[] }[] = [];
  began = 0;
  committed = 0;
  rolledBack = 0;
  released = 0;

  constructor(private readonly results: QueryResult[] = []) {}

  async beginTransaction(): Promise<void> {
    this.began += 1;
  }

  async commit(): Promise<void> {
    this.committed += 1;
  }

  async rollback(): Promise<void> {
    this.rolledBack += 1;
  }

  release(): void {
    this.released += 1;
  }

  async execute<T extends QueryResult>(
    sql: string,
    values?: any[],
  ): Promise<[T, FieldPacket[]]> {
    this.calls.push({ sql, values: values ?? [] });
    const result = this.results.shift();
    if (result === undefined) {
      throw new Error("synthetic connection has no queued result");
    }
    return [result as T, []];
  }
}

function repository(connection: SyntheticConnection): MysqlAliasWriteRepository {
  return new MysqlAliasWriteRepository({
    getConnection: async () => connection as unknown as PoolConnection,
  } as unknown as Pool);
}

describe("MySQL Alias write repository", () => {
  it("commits and releases a successful transaction", async () => {
    const connection = new SyntheticConnection();
    await expect(repository(connection).transaction(async () => "ok")).resolves.toBe(
      "ok",
    );
    expect(connection).toMatchObject({
      began: 1,
      committed: 1,
      rolledBack: 0,
      released: 1,
    });
  });

  it("translates duplicate public IDs without treating Alias text as unique", async () => {
    const connection = new SyntheticConnection();
    const duplicate = Object.assign(new Error("private index detail"), {
      code: "ER_DUP_ENTRY",
    });
    await expect(
      repository(connection).transaction(async () => {
        throw duplicate;
      }),
    ).rejects.toEqual(
      new AliasServiceError(
        "conflict",
        "an Alias uniqueness constraint was occupied concurrently",
      ),
    );
    expect(connection).toMatchObject({ rolledBack: 1, released: 1 });
  });

  it("locks and strictly maps an Alias snapshot with its last audit sequence", async () => {
    const aliasId = "alias.synthetic_mysql_01";
    const connection = new SyntheticConnection([
      [
        {
          aliasId,
          playerId: "player.synthetic_mysql_01",
          aliasText: "Synthetic Alias",
          aliasType: "ocr_observation",
          visibility: "restricted",
          recordStatus: "active",
          revision: "2",
          lastSequence: 2,
          reviewedByUserAccountId: "user_account.synthetic_admin_01",
          reviewedAtMs: "1900000000000",
        } as RowDataPacket,
      ],
    ]);

    await expect(
      repository(connection).transaction((transaction) =>
        transaction.findAliasForUpdate(aliasId),
      ),
    ).resolves.toMatchObject({
      aliasId,
      revision: 2,
      lastSequence: 2,
      visibility: "restricted",
    });
    expect(connection.calls[0]?.sql).toContain("FOR UPDATE");
    expect(connection.calls[0]?.values).toEqual([aliasId]);
    expect(connection.calls[0]?.sql).not.toContain(aliasId);
  });

  it("rolls back unsupported persisted Alias state", async () => {
    const connection = new SyntheticConnection([
      [
        {
          aliasId: "alias.synthetic_mysql_01",
          playerId: "player.synthetic_mysql_01",
          aliasText: "Synthetic Alias",
          aliasType: "identity_merge",
          visibility: "restricted",
          recordStatus: "active",
          revision: 1,
          lastSequence: 1,
          reviewedByUserAccountId: "user_account.synthetic_admin_01",
          reviewedAtMs: 1,
        } as RowDataPacket,
      ],
    ]);

    await expect(
      repository(connection).transaction((transaction) =>
        transaction.findAliasForUpdate("alias.synthetic_mysql_01"),
      ),
    ).rejects.toThrow("Alias.aliasType has an unsupported persisted value");
    expect(connection).toMatchObject({ rolledBack: 1, released: 1 });
  });
});
