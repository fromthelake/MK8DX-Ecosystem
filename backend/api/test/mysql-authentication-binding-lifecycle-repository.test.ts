import { describe, expect, it } from "vitest";
import type { FieldPacket, QueryResult, ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";

import {
  AuthenticationBindingLifecycleError,
} from "../src/authentication/authentication-binding-lifecycle-service.js";
import {
  AuthenticationBindingLifecyclePersistenceError,
  MysqlAuthenticationBindingLifecycleRepository,
} from "../src/authentication/mysql-authentication-binding-lifecycle-repository.js";

type QueryCall = Readonly<{ sql: string; values: unknown[] }>;

class SyntheticConnection {
  readonly calls: QueryCall[] = [];
  began = 0;
  committed = 0;
  rolledBack = 0;
  released = 0;
  public constructor(private readonly results: QueryResult[]) {}
  async beginTransaction() { this.began += 1; }
  async commit() { this.committed += 1; }
  async rollback() { this.rolledBack += 1; }
  release() { this.released += 1; }
  async execute<T extends QueryResult>(sql: string, values?: any[]): Promise<[T, FieldPacket[]]> {
    this.calls.push({ sql, values: values ?? [] });
    const result = this.results.shift();
    if (result === undefined) { throw new Error("synthetic result missing"); }
    return [result as T, []];
  }
}

function header(affectedRows: number): ResultSetHeader {
  return { affectedRows } as ResultSetHeader;
}

function repository(connection: SyntheticConnection) {
  return new MysqlAuthenticationBindingLifecycleRepository({
    getConnection: async () => connection as unknown as PoolConnection,
  } as unknown as Pool);
}

const current = {
  authenticationBindingId: "restricted_auth_binding.synthetic_lifecycle_01",
  userAccountId: "user_account.synthetic_owner_01",
  bindingStatus: "active",
  revision: 1,
  lastSequence: 1,
  updatedAtMs: 10,
} as const;

describe("MySQL authentication binding lifecycle repository", () => {
  it("strictly locks and maps binding lifecycle state", async () => {
    const connection = new SyntheticConnection([
      [{
        authenticationBindingId: current.authenticationBindingId,
        userAccountId: current.userAccountId,
        bindingStatus: "active",
        revision: "1",
        lastSequence: "1",
        updatedAtMs: "10",
      } as RowDataPacket],
    ]);
    await expect(
      repository(connection).transaction((transaction) =>
        transaction.findAuthenticationBindingForUpdate(current.authenticationBindingId),
      ),
    ).resolves.toEqual(current);
    expect(connection.calls[0]?.sql).toContain("FOR UPDATE");
    expect(connection.calls[0]?.values).toEqual([current.authenticationBindingId]);
  });

  it("atomically updates the expected active revision and appends administrator history", async () => {
    const connection = new SyntheticConnection([
      header(1),
      [{ bindingInternalId: 81 } as RowDataPacket],
      header(1),
    ]);
    await repository(connection).transaction((transaction) =>
      transaction.appendAuthenticationBindingLifecycle({
        authenticationBindingId: current.authenticationBindingId,
        expectedRevision: 1,
        nextSnapshot: {
          ...current,
          bindingStatus: "revoked",
          revision: 2,
          lastSequence: 2,
          updatedAtMs: 2_200_000_000_000,
        },
        event: {
          sequence: 2,
          eventType: "binding_revoked",
          actorUserAccountId: "user_account.synthetic_admin_01",
          reasonCode: "security_review",
          occurredAtMs: 2_200_000_000_000,
        },
      }),
    );
    expect(connection).toMatchObject({ began: 1, committed: 1, rolledBack: 0, released: 1 });
    expect(connection.calls[0]?.sql).toContain("binding_status = 'active'");
    expect(connection.calls[0]?.values).toEqual([
      2,
      "revoked",
      2_200_000_000_000,
      2_200_000_000_000,
      current.authenticationBindingId,
      1,
    ]);
    expect(connection.calls[2]?.sql).toContain("'administrator'");
    expect(connection.calls[2]?.sql).toContain("administrator.account_status = 'active'");
  });

  it("rejects malformed persisted lifecycle state and rolls back", async () => {
    const connection = new SyntheticConnection([
      [{ ...current, userAccountId: "player.wrong_namespace" } as RowDataPacket],
    ]);
    await expect(
      repository(connection).transaction((transaction) =>
        transaction.findAuthenticationBindingForUpdate(current.authenticationBindingId),
      ),
    ).rejects.toBeInstanceOf(AuthenticationBindingLifecyclePersistenceError);
    expect(connection).toMatchObject({ committed: 0, rolledBack: 1, released: 1 });
  });

  it("fails closed when the expected update is lost", async () => {
    const connection = new SyntheticConnection([header(0)]);
    await expect(
      repository(connection).transaction((transaction) =>
        transaction.appendAuthenticationBindingLifecycle({
          authenticationBindingId: current.authenticationBindingId,
          expectedRevision: 1,
          nextSnapshot: {
            ...current,
            bindingStatus: "released",
            revision: 2,
            lastSequence: 2,
            updatedAtMs: 2_200_000_000_000,
          },
          event: {
            sequence: 2,
            eventType: "binding_released",
            actorUserAccountId: "user_account.synthetic_admin_01",
            reasonCode: "assisted_rebind",
            occurredAtMs: 2_200_000_000_000,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(AuthenticationBindingLifecycleError);
    expect(connection).toMatchObject({ committed: 0, rolledBack: 1, released: 1 });
  });
});
