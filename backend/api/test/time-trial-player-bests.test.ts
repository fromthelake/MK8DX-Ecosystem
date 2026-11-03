import { describe, expect, it } from "vitest";
import type { FieldPacket, QueryResult } from "mysql2";

import {
  refreshTimeTrialPlayerBestsForPlayers,
  refreshTimeTrialPlayerBestsForRevisions,
} from "../src/timetrials/time-trial-player-bests.js";

class Executor {
  readonly calls: Array<{ sql: string; values: readonly unknown[] }> = [];
  constructor(private readonly rows: unknown[][] = []) {}
  async execute<T extends QueryResult>(sql: string, values?: any[]) {
    this.calls.push({ sql, values: values ?? [] });
    return [this.rows.shift() ?? [], [] as FieldPacket[]] as [T, FieldPacket[]];
  }
}

describe("Time Trial player-best projection refresh", () => {
  it("deduplicates affected Players and rebuilds with the canonical tie break", async () => {
    const executor = new Executor([[], []]);
    await refreshTimeTrialPlayerBestsForPlayers(executor as never, [7, 7, 9, 0]);
    expect(executor.calls).toHaveLength(2);
    expect(executor.calls[0]?.values).toEqual([7, 9]);
    expect(executor.calls[1]?.values).toEqual([7, 9]);
    expect(executor.calls[1]?.sql).toContain("ROW_NUMBER() OVER");
    expect(executor.calls[1]?.sql).toContain("publication.published_at_ms DESC");
    expect(executor.calls[1]?.sql).toContain("publication.publication_status = 'published'");
    expect(executor.calls[1]?.sql).toContain("player.visibility = 'public'");
  });

  it("resolves revision owners before rebuilding", async () => {
    const executor = new Executor([[{ playerId: 7 }, { playerId: "9" }], [], []]);
    await refreshTimeTrialPlayerBestsForRevisions(executor as never, [41, 42, 41]);
    expect(executor.calls[0]?.values).toEqual([41, 42]);
    expect(executor.calls[1]?.sql).toContain("DELETE FROM time_trial_player_bests");
    expect(executor.calls[2]?.sql).toContain("INSERT INTO time_trial_player_bests");
  });

  it("does no work for an empty affected set", async () => {
    const executor = new Executor();
    await refreshTimeTrialPlayerBestsForPlayers(executor as never, []);
    expect(executor.calls).toEqual([]);
  });
});
