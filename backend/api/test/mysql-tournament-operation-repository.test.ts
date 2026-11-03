import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import { MysqlTournamentOperationRepository } from
  "../src/tournaments/mysql-tournament-operation-repository.js";

function poolFor(execute: (sql: string, values?: unknown) => Promise<unknown>) {
  const connection = {
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    release: vi.fn(),
    execute: vi.fn(execute),
  };
  return {
    connection,
    pool: { getConnection: vi.fn(async () => connection) } as unknown as Pool,
  };
}

describe("MySQL Tournament operation history projection", () => {
  it("corrects equipment with UPDATE only, preserving member identity, order, characters and all accepted results", async () => {
    const { pool, connection } = poolFor(async () => [{ affectedRows: 1 }, []]);
    const repository = new MysqlTournamentOperationRepository(pool);
    await repository.transaction((transaction) => transaction.updateGroupMemberStations(11, [{
      playerInternalId: 7, stationOwnerInternalId: 9, stationSwitchType: "ns1", seatNumber: 2,
    }]));
    expect(connection.execute).toHaveBeenCalledTimes(1);
    const [sql, values] = connection.execute.mock.calls[0]!;
    expect(sql).toMatch(/UPDATE tournament_group_members/);
    expect(sql).not.toMatch(/DELETE|INSERT|character|seat_order|race_result|manual_score/i);
    expect(values).toEqual([9, "ns1", 2, 11, 7]);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });
  it("projects the last-present timestamp consumed by Tournament creation", async () => {
    const { pool, connection } = poolFor(async (sql) => {
      const projected = sql.includes("historyPlayer.lastPresentAtMs AS lastPresentAtMs");
      return [[{
        playerInternalId: 7,
        playerId: "player.synthetic_history",
        username: "history",
        displayName: "History",
        visibility: "public",
        recordStatus: "active",
        playerKind: "human",
        ...(projected ? { lastPresentAtMs: 0 } : {}),
      }], []];
    });
    const repository = new MysqlTournamentOperationRepository(pool);

    await expect(repository.transaction((transaction) =>
      transaction.loadHistoricalPresentPlayers(99))).resolves.toEqual([{
      player: {
        internalId: 7,
        playerId: "player.synthetic_history",
        username: "history",
        displayName: "History",
        visibility: "public",
        active: true,
      },
      lastPresentAtMs: 0,
    }]);
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("historyPlayer.lastPresentAtMs AS lastPresentAtMs"),
      [99],
    );
  });
});
