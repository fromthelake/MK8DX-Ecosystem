import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import { MysqlPlayerOnboardingRepository } from
  "../src/identity/mysql-player-onboarding-repository.js";

describe("MySQL Player onboarding username guard (ADR-0218)", () => {
  it("stops on a taken username before inserting another Player", async () => {
    const connection = {
      beginTransaction: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
      release: vi.fn(),
      execute: vi.fn(async (sql: string) => {
        if (sql.includes("current_comparison_key = ?")) { return [[{ present: 1 }], []]; }
        throw new Error("a taken username must stop before INSERT");
      }),
    };
    const repository = new MysqlPlayerOnboardingRepository({
      getConnection: vi.fn(async () => connection),
    } as unknown as Pool);

    await expect(repository.transaction((transaction) =>
      transaction.createPlayerWithUsername({
        playerId: "player.synthetic_ben_2",
        username: "Ben",
        displayName: " Ben ",
        nowMs: 1_000,
      }))).resolves.toBe("username_taken");
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("current_comparison_key = ?"),
      [Buffer.from("ben", "utf8")],
    );
    // A display name alone is no longer checked: names may repeat.
    expect(connection.execute).not.toHaveBeenCalledWith(
      expect.stringContaining("LOWER(TRIM(display_name)) = LOWER(TRIM(?))"),
      expect.anything(),
    );
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it("scopes the own-nights name check to the named Tournament's Director, else the acting account", async () => {
    const execute = vi.fn(async (_sql: string, _values: unknown[]) => [[{ nameKey: "mal" }], []]);
    const connection = {
      beginTransaction: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
      release: vi.fn(),
      execute,
    };
    const repository = new MysqlPlayerOnboardingRepository({
      getConnection: vi.fn(async () => connection),
    } as unknown as Pool);

    const found = await repository.transaction((transaction) =>
      transaction.displayNamesInDirectorNights!({
        actorUserAccountId: "user_account.evan",
        tournamentId: null,
        displayNames: [" Mal ", "mal", "Nova"],
      }));
    expect([...found]).toEqual(["mal"]);
    const [sql, values] = execute.mock.calls[0]!;
    expect(sql).toContain("t.director_user_account_id = COALESCE(");
    expect(values).toEqual(["", "user_account.evan", "mal", "nova"]);
  });
});
