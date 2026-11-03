import { describe, expect, it } from "vitest";
import type { FieldPacket, QueryResult } from "mysql2";

import type { PreparedQueryExecutor } from
  "../src/identity/mysql-identity-read-repository.js";
import { MysqlPlayerClaimProductRepository } from
  "../src/profiles/mysql-player-claim-product-repository.js";

class Executor implements PreparedQueryExecutor {
  readonly calls: Array<{ sql: string; values?: any[] }> = [];
  constructor(private readonly results: readonly unknown[][]) {}
  async execute<T extends QueryResult>(sql: string, values?: any[]) {
    this.calls.push({ sql, ...(values === undefined ? {} : { values }) });
    return [this.results[this.calls.length - 1] ?? [], [] as FieldPacket[]] as [T, FieldPacket[]];
  }
}

describe("MySQL Player claim product projection", () => {
  it("escapes wildcard search and maps only public Player fields", async () => {
    const executor = new Executor([[
      {
        playerId: "player.synthetic_claim_product_01",
        username: "Synthetic_100%",
        displayName: "Synthetic Racer",
      },
    ]]);
    const repository = new MysqlPlayerClaimProductRepository(executor);
    await expect(repository.searchActivePlayers("Synthetic_100%"))
      .resolves.toHaveLength(1);
    expect(executor.calls[0]?.values).toEqual([
      "Synthetic_100%", "Synthetic!_100!%", "Synthetic!_100!%",
      "Synthetic_100%", "Synthetic_100%",
    ]);
    expect(executor.calls[0]?.sql).toContain("LIMIT 20");
  });

  it("lists every active human Player for Tournament roster selection", async () => {
    const executor = new Executor([[
      { playerId: "player.ace", username: "ace", displayName: "Ace" },
      { playerId: "player.ben", username: "ben", displayName: "Ben" },
    ]]);
    const repository = new MysqlPlayerClaimProductRepository(executor);
    await expect(repository.listActivePlayers()).resolves.toHaveLength(2);
    expect(executor.calls[0]?.sql).toContain("p.player_kind = 'human'");
    expect(executor.calls[0]?.sql).toContain("LIMIT 500");
  });

  it("maps the account's lifecycle summaries without evidence", async () => {
    const executor = new Executor([[
      {
        playerClaimId: "player_claim.synthetic_claim_product_01",
        playerId: "player.synthetic_claim_product_01",
        playerUsername: "SyntheticRacer",
        playerDisplayName: "Synthetic Racer",
        claimStatus: "under_review",
        disputeStatus: "none",
        updatedAtMs: "1787011200000",
        evidence: "must-not-map",
      },
    ]]);
    const repository = new MysqlPlayerClaimProductRepository(executor);
    await expect(repository.listClaimsForAccount(
      "user_account.synthetic_claim_product_01",
    )).resolves.toEqual([{
      playerClaimId: "player_claim.synthetic_claim_product_01",
      playerId: "player.synthetic_claim_product_01",
      playerUsername: "SyntheticRacer",
      playerDisplayName: "Synthetic Racer",
      claimStatus: "under_review",
      disputeStatus: "none",
      updatedAtMs: 1787011200000,
    }]);
  });

  it("lists the oldest pending review work without account or evidence data", async () => {
    const executor = new Executor([[
      {
        playerClaimId: "player_claim.synthetic_claim_product_01",
        playerId: "player.synthetic_claim_product_01",
        playerUsername: "SyntheticRacer",
        playerDisplayName: "Synthetic Racer",
        claimStatus: "requested",
        disputeStatus: "none",
        updatedAtMs: 1787011200000,
        userAccountId: "must-not-map",
        evidence: "must-not-map",
      },
    ]]);
    const repository = new MysqlPlayerClaimProductRepository(executor);
    await expect(repository.listClaimsForAdministrator()).resolves.toEqual([{
      playerClaimId: "player_claim.synthetic_claim_product_01",
      playerId: "player.synthetic_claim_product_01",
      playerUsername: "SyntheticRacer",
      playerDisplayName: "Synthetic Racer",
      claimStatus: "requested",
      disputeStatus: "none",
      updatedAtMs: 1787011200000,
    }]);
    expect(executor.calls[0]?.sql).toContain(
      "claim.claim_status IN ('requested', 'under_review')",
    );
    expect(executor.calls[0]?.sql).toContain("ORDER BY claim.updated_at_ms ASC");
    expect(executor.calls[0]?.sql).toContain("LIMIT 50");
  });
});
