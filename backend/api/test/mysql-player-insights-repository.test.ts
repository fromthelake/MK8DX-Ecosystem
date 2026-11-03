import { describe, expect, it } from "vitest";
import type { FieldPacket, QueryResult } from "mysql2";

import type { PreparedQueryExecutor } from
  "../src/identity/mysql-identity-read-repository.js";
import { MysqlPlayerInsightsRepository } from
  "../src/profiles/mysql-player-insights-repository.js";

class Executor implements PreparedQueryExecutor {
  readonly calls: Array<{ sql: string; values?: any[] }> = [];
  constructor(private readonly results: readonly unknown[][]) {}
  async execute<T extends QueryResult>(sql: string, values?: any[]) {
    this.calls.push({ sql, ...(values === undefined ? {} : { values }) });
    return [this.results[this.calls.length - 1] ?? [], [] as FieldPacket[]] as [T, FieldPacket[]];
  }
}

describe("MySQL Player insights", () => {
  it("maps grouped personal bests and exact Tournament integer totals", async () => {
    const executor = new Executor([
      [{ playerId: "player.synthetic_insights_01" }],
      [{
        trackId: "track.mario_kart_stadium",
        modeCC: 150,
        bestTimeMs: 83456,
        attemptCount: "2",
      }],
      [{
        raceCount: "3",
        countedRaceCount: "2",
        wins: "1",
        podiums: "2",
        countedPoints: "27",
        countedFinishPositionTotal: "3",
      }],
    ]);
    const repository = new MysqlPlayerInsightsRepository(executor);
    const playerId = await repository.findVerifiedPlayerForAccount(
      "user_account.synthetic_insights_01",
    );
    await expect(repository.listTimeTrialPersonalBests(playerId!)).resolves.toEqual([{
      trackId: "track.mario_kart_stadium",
      modeCC: 150,
      bestTimeMs: 83456,
      attemptCount: 2,
    }]);
    await expect(repository.summarizeTournaments(playerId!)).resolves.toEqual({
      raceCount: 3,
      countedRaceCount: 2,
      wins: 1,
      podiums: 2,
      countedPoints: 27,
      countedFinishPositionTotal: 3,
    });
    expect(executor.calls[1]?.sql).toContain("MIN(revision.total_time_ms)");
    // A retired result is neither a personal best nor an attempt.
    expect(executor.calls[1]?.sql).toContain("submission.retirement_state = 'active'");
    expect(executor.calls[2]?.sql).toContain("revision.counts_toward_standings = 1");
  });
});
