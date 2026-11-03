import { describe, expect, it } from "vitest";
import type { FieldPacket, QueryResult, ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";

import {
  AuthenticationProvisioningError,
  type AuthenticationProvisioningTransaction,
} from "../src/authentication/authentication-provisioning-service.js";
import {
  AuthenticationProvisioningPersistenceError,
  MysqlAuthenticationProvisioningRepository,
} from "../src/authentication/mysql-authentication-provisioning-repository.js";

type QueryCall = Readonly<{ sql: string; values: unknown[] }>;

class SyntheticConnection {
  readonly calls: QueryCall[] = [];
  began = 0;
  committed = 0;
  rolledBack = 0;
  released = 0;

  public constructor(private readonly results: QueryResult[]) {}

  async beginTransaction(): Promise<void> { this.began += 1; }
  async commit(): Promise<void> { this.committed += 1; }
  async rollback(): Promise<void> { this.rolledBack += 1; }
  release(): void { this.released += 1; }

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

function header(affectedRows: number, insertId = 0): ResultSetHeader {
  return { affectedRows, insertId } as ResultSetHeader;
}

function repository(connection: SyntheticConnection) {
  return new MysqlAuthenticationProvisioningRepository({
    getConnection: async () => connection as unknown as PoolConnection,
  } as unknown as Pool);
}

const subject = {
  issuerKey: "synthetic_issuer",
  lookupKeyVersion: "lookup_key_v1",
  subjectLookupHmac: new Uint8Array(32).fill(23),
} as const;

describe("MySQL authentication provisioning repository", () => {
  it("locks lookup/account and inserts binding plus authentication lifecycle with parameters", async () => {
    const connection = new SyntheticConnection([
      [],
      [{ accountStatus: "active" } as RowDataPacket],
      header(1, 71),
      header(1, 72),
    ]);
    const result = await repository(connection).transaction(async (transaction) => {
      expect(await transaction.findActiveBindingForUpdate(subject)).toBeNull();
      expect(
        await transaction.findUserAccountStatusForUpdate(
          "user_account.synthetic_existing_01",
        ),
      ).toBe("active");
      await transaction.createAuthenticationBinding({
        authenticationBindingId: "restricted_auth_binding.synthetic_new_01",
        userAccountId: "user_account.synthetic_existing_01",
        subject,
        provisionerReference: "authentication_provisioner.synthetic_test",
        createdAtMs: 2_100_000_000_000,
      });
      return "committed";
    });

    expect(result).toBe("committed");
    expect(connection).toMatchObject({
      began: 1,
      committed: 1,
      rolledBack: 0,
      released: 1,
    });
    expect(connection.calls[0]?.sql).toContain("FOR UPDATE");
    expect(connection.calls[0]?.values[2]).toEqual(Buffer.from(subject.subjectLookupHmac));
    expect(connection.calls[2]?.sql).toContain("a.account_status = 'active'");
    expect(connection.calls[3]?.sql).toContain("'authentication'");
    expect(connection.calls[3]?.values).toEqual([
      71,
      "authentication_provisioner.synthetic_test",
      2_100_000_000_000,
    ]);
    for (const call of connection.calls) {
      expect(call.sql).not.toContain("synthetic_issuer");
      expect(call.sql).not.toContain("synthetic_existing_01");
    }
  });

  it("creates an active private UserAccount with no Player or provider columns", async () => {
    const connection = new SyntheticConnection([header(1, 70)]);
    await repository(connection).transaction(async (transaction) => {
      await transaction.createUserAccount({
        userAccountId: "user_account.synthetic_new_01",
        createdAtMs: 2_100_000_000_000,
      });
    });
    expect(connection.calls[0]?.sql).toContain("'private', 'active'");
    expect(connection.calls[0]?.sql).not.toMatch(/player|email|subject|token|credential/i);
  });

  it("maps persisted rows strictly and rolls malformed state back", async () => {
    const connection = new SyntheticConnection([
      [
        {
          authenticationBindingId: "restricted_auth_binding.synthetic_existing_01",
          userAccountId: "player.wrong_namespace",
          accountStatus: "active",
        } as RowDataPacket,
      ],
    ]);
    await expect(
      repository(connection).transaction((transaction) =>
        transaction.findActiveBindingForUpdate(subject),
      ),
    ).rejects.toBeInstanceOf(AuthenticationProvisioningPersistenceError);
    expect(connection).toMatchObject({ committed: 0, rolledBack: 1, released: 1 });
  });

  it("translates concurrent uniqueness occupancy without leaking database detail", async () => {
    const connection = new SyntheticConnection([]);
    await expect(
      repository(connection).transaction(async (_transaction: AuthenticationProvisioningTransaction) => {
        throw { code: "ER_DUP_ENTRY", message: "private value" };
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AuthenticationProvisioningError>>({
        code: "conflict",
        message: expect.not.stringContaining("private value"),
      }),
    );
    expect(connection).toMatchObject({ committed: 0, rolledBack: 1, released: 1 });
  });
});
