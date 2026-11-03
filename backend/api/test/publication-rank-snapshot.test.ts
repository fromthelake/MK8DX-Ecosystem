import { describe, expect, it } from "vitest";
import type { FieldPacket, QueryResult } from "mysql2";

import { publicationRankSnapshots } from
  "../src/timetrials/publication-rank-snapshot.js";

class Executor {
  readonly calls: Array<{ sql: string; values: readonly unknown[] }> = [];

  public constructor(private readonly rows: readonly unknown[]) {}

  async execute<T extends QueryResult>(sql: string, values?: any[]) {
    this.calls.push({ sql, values: values ?? [] });
    return [this.rows, [] as FieldPacket[]] as [T, FieldPacket[]];
  }
}

describe("Time Trial publication rank snapshots", () => {
  it("calculates a bulk human placement in one database call", async () => {
    const executor = new Executor([
      { revisionInternalId: "41", rankAtPublication: "1" },
      { revisionInternalId: "42", rankAtPublication: "7" },
    ]);

    await expect(publicationRankSnapshots(executor as never, [41, 42, 41]))
      .resolves.toEqual(new Map([[41, 1], [42, 7]]));

    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0]?.values).toEqual([41, 42]);
    expect(executor.calls[0]?.sql).toContain(
      "COUNT(DISTINCT CASE",
    );
    expect(executor.calls[0]?.sql).toContain(
      "competitor.total_time_ms < candidate.total_time_ms",
    );
    expect(executor.calls[0]?.sql).toContain(
      "competitor.player_id <> candidate.player_id",
    );
    expect(executor.calls[0]?.sql).toContain(
      "LEFT JOIN time_trial_player_bests AS competitor",
    );
  });

  it("does not call MySQL for an empty publication batch", async () => {
    const executor = new Executor([]);
    await expect(publicationRankSnapshots(executor as never, []))
      .resolves.toEqual(new Map());
    expect(executor.calls).toHaveLength(0);
  });

  it("fails closed when any requested revision cannot be ranked", async () => {
    const executor = new Executor([
      { revisionInternalId: 41, rankAtPublication: 2 },
    ]);
    await expect(publicationRankSnapshots(executor as never, [41, 42]))
      .rejects.toThrow("could not be calculated");
  });
});
