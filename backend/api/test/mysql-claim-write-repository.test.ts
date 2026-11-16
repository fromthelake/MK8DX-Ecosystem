import { describe, expect, it } from "vitest";
import type { FieldPacket, QueryResult, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";

import { ClaimLifecycleError } from "../src/identity/claim-lifecycle-service.js";
import {
  claimTransactionRetryDelayMs,
  MysqlClaimWriteRepository,
} from "../src/identity/mysql-claim-write-repository.js";

type QueryCall = Readonly<{ sql: string; values: unknown[] }>;

class SyntheticConnection {
  public readonly calls: QueryCall[] = [];
  public began = 0;
  public committed = 0;
  public rolledBack = 0;
  public released = 0;

  public constructor(private readonly queuedRows: RowDataPacket[][] = []) {}

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
    const rows = this.queuedRows.shift();
    if (rows === undefined) {
      throw new Error("synthetic connection has no queued result");
    }
    return [rows as unknown as T, []];
  }
}

function repository(connection: SyntheticConnection): MysqlClaimWriteRepository {
  const pool = {
    getConnection: async () => connection as unknown as PoolConnection,
  } as unknown as Pool;
  return new MysqlClaimWriteRepository(pool);
}

describe("MySQL claim write repository transaction", () => {
  it("commits and releases a successful transaction", async () => {
    const connection = new SyntheticConnection();
    const result = await repository(connection).transaction(async () => "committed");

    expect(result).toBe("committed");
    expect(connection).toMatchObject({
      began: 1,
      committed: 1,
      rolledBack: 0,
      released: 1,
    });
  });

  it("retries a deadlocked transaction through a ten-request burst, then gives up", { timeout: 20_000 }, async () => {
    // Ten concurrent claim requests on one gap can deadlock again on every attempt; the attempts
    // must outlast such a burst instead of failing a valid request (seen on MySQL 8.4 and 9.7).
    const deadlock = Object.assign(new Error("Deadlock found"), { code: "ER_LOCK_DEADLOCK", errno: 1213 });
    const connection = new SyntheticConnection();
    let failures = 10;
    const result = await repository(connection).transaction(async () => {
      if (failures > 0) { failures -= 1; throw deadlock; }
      return "committed";
    });
    expect(result).toBe("committed");
    expect(connection).toMatchObject({ began: 11, committed: 1, rolledBack: 10, released: 11 });

    const exhausted = new SyntheticConnection();
    await expect(repository(exhausted).transaction(async () => { throw deadlock; })).rejects.toBe(deadlock);
    expect(exhausted).toMatchObject({ began: 12, committed: 0, rolledBack: 12, released: 12 });
  });

  it("spreads retries with a growing, bounded, fully jittered pause", () => {
    expect(claimTransactionRetryDelayMs(1, () => 0)).toBe(0);
    expect(claimTransactionRetryDelayMs(1, () => 0.999)).toBe(19);
    expect(claimTransactionRetryDelayMs(3, () => 0.999)).toBe(79);
    expect(claimTransactionRetryDelayMs(11, () => 0.999)).toBe(319);
  });

  it("rolls back and translates a generated-key race to an application conflict", async () => {
    const connection = new SyntheticConnection();
    const duplicate = Object.assign(new Error("private SQL detail"), {
      code: "ER_DUP_ENTRY",
      errno: 1062,
    });

    await expect(
      repository(connection).transaction(async () => {
        throw duplicate;
      }),
    ).rejects.toEqual(
      new ClaimLifecycleError(
        "conflict",
        "an identity claim uniqueness constraint was occupied concurrently",
      ),
    );
    expect(connection).toMatchObject({
      began: 1,
      committed: 0,
      rolledBack: 1,
      released: 1,
    });
  });

  it("locks and maps the durable claim snapshot", async () => {
    const connection = new SyntheticConnection([
      [
        {
          playerClaimId: "player_claim.synthetic_mysql_01",
          playerId: "player.synthetic_mysql_01",
          userAccountId: "user_account.synthetic_mysql_01",
          claimStatus: "under_review",
          disputeStatus: "none",
          revision: "2",
          lastSequence: 2,
        } as RowDataPacket,
      ],
    ]);

    await expect(
      repository(connection).transaction((transaction) =>
        transaction.findClaimForUpdate("player_claim.synthetic_mysql_01"),
      ),
    ).resolves.toMatchObject({ revision: 2, lastSequence: 2 });
    expect(connection.calls[0]?.sql).toContain("FOR UPDATE");
    expect(connection.calls[0]?.values).toEqual([
      "player_claim.synthetic_mysql_01",
    ]);
  });

  it("uses prepared, role-specific evidence authorization", async () => {
    const evidenceId = "restricted_evidence.synthetic_mysql_01";
    const ownerAccountId = "user_account.synthetic_owner_01";
    const adminAccountId = "user_account.synthetic_admin_01";
    const connection = new SyntheticConnection([
      [{ evidenceId } as RowDataPacket],
      [{ evidenceId } as RowDataPacket],
    ]);

    const results = await repository(connection).transaction(async (transaction) => [
      await transaction.canUseEvidenceReferences(
        { actorType: "requesting_account", userAccountId: ownerAccountId },
        [evidenceId],
      ),
      await transaction.canUseEvidenceReferences(
        { actorType: "administrator", userAccountId: adminAccountId },
        [evidenceId],
      ),
    ]);

    expect(results).toEqual([true, true]);
    expect(connection.calls[0]?.values).toEqual([evidenceId, ownerAccountId]);
    expect(connection.calls[0]?.sql).toContain("uploader.public_id = ?");
    expect(connection.calls[1]?.values).toEqual([adminAccountId, evidenceId]);
    expect(connection.calls[1]?.sql).toContain("administrator.public_id = ?");
    for (const call of connection.calls) {
      expect(call.sql).not.toContain(evidenceId);
      expect(call.sql).not.toContain(ownerAccountId);
      expect(call.sql).not.toContain(adminAccountId);
    }
  });

  it("does not query restricted storage for an empty evidence list", async () => {
    const connection = new SyntheticConnection();
    await expect(
      repository(connection).transaction((transaction) =>
        transaction.canUseEvidenceReferences(
          {
            actorType: "requesting_account",
            userAccountId: "user_account.synthetic_owner_01",
          },
          [],
        ),
      ),
    ).resolves.toBe(true);
    expect(connection.calls).toHaveLength(0);
  });
});
