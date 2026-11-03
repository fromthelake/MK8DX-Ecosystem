import { describe, expect, it } from "vitest";
import type { FieldPacket, QueryResult, ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";

import {
  AuthenticationBindingPersistenceError,
  MysqlAuthenticationBindingRepository,
} from "../src/authentication/mysql-authentication-binding-repository.js";

type QueryCall = Readonly<{ sql: string; values: unknown[] }>;

class SyntheticConnection {
  readonly calls: QueryCall[] = [];
  began = 0;
  committed = 0;
  rolledBack = 0;
  released = 0;

  constructor(private readonly results: QueryResult[]) {}

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

function resultHeader(affectedRows: number): ResultSetHeader {
  return { affectedRows } as ResultSetHeader;
}

function testRepository(connection: SyntheticConnection) {
  let connectionRequests = 0;
  const pool = {
    getConnection: async () => {
      connectionRequests += 1;
      return connection as unknown as PoolConnection;
    },
  } as unknown as Pool;
  const repository = new MysqlAuthenticationBindingRepository(pool, {
    nowMs: () => 1_900_000_000_000,
  });
  return { repository, get connectionRequests() { return connectionRequests; } };
}

const hmac = new Uint8Array(32).fill(11);
const subject = {
  issuerKey: "synthetic_issuer",
  lookupKeyVersion: "lookup_key_v1",
  subjectLookupHmac: hmac,
} as const;

describe("MySQL authentication binding repository", () => {
  it("resolves through prepared lookup material and appends an opaque access audit", async () => {
    const connection = new SyntheticConnection([
      [
        {
          authenticationBindingInternalId: 41,
          authenticationBindingId: "restricted_auth_binding.synthetic_01",
          userAccountId: "user_account.synthetic_bound_01",
        } as RowDataPacket,
      ],
      resultHeader(1),
    ]);
    const { repository } = testRepository(connection);

    await expect(repository.resolveActiveAccount(subject)).resolves.toEqual({
      userAccountId: "user_account.synthetic_bound_01",
    });
    expect(connection).toMatchObject({
      began: 1,
      committed: 1,
      rolledBack: 0,
      released: 1,
    });
    expect(connection.calls[0]?.sql).toContain("LOCK IN SHARE MODE");
    expect(connection.calls[0]?.values.slice(0, 2)).toEqual([
      "synthetic_issuer",
      "lookup_key_v1",
    ]);
    expect(connection.calls[0]?.values[2]).toEqual(Buffer.from(hmac));
    expect(connection.calls[1]?.sql).toContain("'actor_resolution'");
    expect(connection.calls[1]?.values).toEqual([
      41,
      "restricted_auth_binding.synthetic_01",
      1_900_000_000_000,
    ]);
    for (const call of connection.calls) {
      expect(call.sql).not.toContain("synthetic_issuer");
      expect(call.sql).not.toContain("lookup_key_v1");
    }
  });

  it("returns no account and writes no audit for an unbound subject", async () => {
    const connection = new SyntheticConnection([[]]);
    const { repository } = testRepository(connection);

    await expect(repository.resolveActiveAccount(subject)).resolves.toBeNull();
    expect(connection.calls).toHaveLength(1);
    expect(connection).toMatchObject({ committed: 1, rolledBack: 0, released: 1 });
  });

  it("rejects malformed verified lookup material before acquiring a connection", async () => {
    const connection = new SyntheticConnection([]);
    const harness = testRepository(connection);

    await expect(
      harness.repository.resolveActiveAccount({
        issuerKey: "raw issuer URL",
        lookupKeyVersion: "lookup_key_v1",
        subjectLookupHmac: new Uint8Array(31),
      }),
    ).rejects.toThrow(AuthenticationBindingPersistenceError);
    expect(harness.connectionRequests).toBe(0);
  });

  it("rolls back malformed persisted identity without exposing a partial actor", async () => {
    const connection = new SyntheticConnection([
      [
        {
          authenticationBindingInternalId: 41,
          authenticationBindingId: "restricted_auth_binding.synthetic_01",
          userAccountId: "player.wrong_namespace",
        } as RowDataPacket,
      ],
    ]);
    const { repository } = testRepository(connection);

    await expect(repository.resolveActiveAccount(subject)).rejects.toThrow(
      AuthenticationBindingPersistenceError,
    );
    expect(connection).toMatchObject({ committed: 0, rolledBack: 1, released: 1 });
  });
});
