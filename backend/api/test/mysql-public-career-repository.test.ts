import { describe, expect, it } from "vitest";
import type { FieldPacket, QueryResult } from "mysql2";

import { MysqlPublicCareerRepository } from
  "../src/profiles/mysql-public-career-repository.js";

class Executor {
  readonly calls: Array<{ sql: string; values?: any[] }> = [];
  constructor(private readonly results: readonly unknown[][]) {}
  async execute<T extends QueryResult>(sql: string, values?: any[]) {
    this.calls.push({ sql, ...(values === undefined ? {} : { values }) });
    return [this.results[this.calls.length - 1] ?? [], [] as FieldPacket[]] as [T, FieldPacket[]];
  }
}

describe("MySQL public Player career", () => {
  it("returns additive engine splits and ranks only active public Players with shared ties", async () => {
    const executor = new Executor([
      [{ playerInternalId: 7 }],
      [{
        published: "12", published150: "9", published200: "3",
        tracks150: "8", tracks200: "3", latestResultAtMs: "1900000000000",
      }],
      [{
        firsts: "4", firsts150: "3", firsts200: "1",
        podiums: "7", podiums150: "5", podiums200: "2",
      }],
      [{ trackId: "track.mario_kart_stadium", playedCount: "5", played150: "4", played200: "1" }],
      [],
    ]);

    const result = await new MysqlPublicCareerRepository(executor as never)
      .loadCareer("player.synthetic");

    expect(result?.timeTrials).toEqual({
      published: 12, published150: 9, published200: 3,
      tracks150: 8, tracks200: 3,
      firsts: 4, firsts150: 3, firsts200: 1,
      podiums: 7, podiums150: 5, podiums200: 2,
      mostPlayed: {
        trackId: "track.mario_kart_stadium", count: 5, count150: 4, count200: 1,
      },
      latestResultAtMs: 1_900_000_000_000,
    });
    const rankingSql = executor.calls[2]?.sql ?? "";
    expect(rankingSql).toContain("ranked_player.record_status = 'active'");
    expect(rankingSql).toContain("ranked_player.visibility = 'public'");
    expect(rankingSql).toContain("ORDER BY best_time ASC");
    expect(rankingSql).not.toContain("ORDER BY best_time ASC, player_id ASC");
  });
});
