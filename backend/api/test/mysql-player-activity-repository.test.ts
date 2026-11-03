import { describe, expect, it } from "vitest";
import type { FieldPacket, QueryResult } from "mysql2";

import type { PreparedQueryExecutor } from
  "../src/identity/mysql-identity-read-repository.js";
import { MysqlPlayerActivityRepository } from
  "../src/profiles/mysql-player-activity-repository.js";

class Executor implements PreparedQueryExecutor {
  public readonly calls: Array<{ sql: string; values?: any[] }> = [];
  public constructor(private readonly rows: readonly unknown[][]) {}
  public async execute<T extends QueryResult>(sql: string, values?: any[]) {
    this.calls.push({ sql, ...(values === undefined ? {} : { values }) });
    return [this.rows[this.calls.length - 1] ?? [], [] as FieldPacket[]] as [T, FieldPacket[]];
  }
}

describe("MySQL Player activity projection", () => {
  it("maps only latest canonical public/self fields in deterministic order", async () => {
    const executor = new Executor([
      [{ playerId: "player.synthetic_profile_01" }],
      [{
        playerId: "player.synthetic_profile_01",
        username: "SyntheticRacer",
        displayName: "Synthetic Racer",
      }],
      [{
        submissionId: "user_submission.time.synthetic_profile_01",
        revision: "2",
        trackId: "track.mario_kart_stadium",
        modeCC: 150,
        totalTimeMs: 83456,
        sourceKind: "web_manual",
        occurredAtMs: null,
        createdAtMs: "1787011200000",
      }],
      [{
        raceResultId: "tournament_race_result.synthetic_profile_01",
        revision: 1,
        raceNumber: 4,
        trackId: "track.gcn_waluigi_stadium",
        modeCC: null,
        countsTowardStandings: 1,
        finishPosition: 2,
        racePoints: "12",
        totalAfterRace: "48",
        rankAfterRace: 1,
        sourceKind: "tournament_live_capture",
        occurredAtMs: 1787011300000,
        createdAtMs: 1787011300100,
      }],
    ]);
    const repository = new MysqlPlayerActivityRepository(executor);
    const playerId = await repository.findVerifiedPlayerForAccount(
      "user_account.synthetic_profile_01",
    );
    expect(playerId).toBe("player.synthetic_profile_01");
    expect(await repository.findPlayerProfile(playerId!)).toEqual({
      playerId,
      username: "SyntheticRacer",
      displayName: "Synthetic Racer",
    });
    expect(await repository.listTimeTrials(playerId!)).toHaveLength(1);
    expect(await repository.listTournamentRaces(playerId!)).toEqual([
      expect.objectContaining({
        modeCC: null,
        countsTowardStandings: true,
        racePoints: 12,
      }),
    ]);
    expect(executor.calls[2]?.sql).toContain("SELECT MAX(latest.revision_number)");
    expect(executor.calls[2]?.sql).toContain("LIMIT 100");
    expect(executor.calls[2]?.sql).toContain("submission.retirement_state = 'active'");
    expect(executor.calls[3]?.sql).toContain("placement.player_id");
    expect(executor.calls.every((call) => call.values?.[0] !== undefined)).toBe(true);
  });

  it("reads a Tournament race's class: 50/100/150/200cc and a Mirror race as 150cc + mirror (ADR-0217)", async () => {
    const race = (modeCC: number, raceNumber: number) => ({
      raceResultId: `tournament_race_result.synthetic_profile_0${raceNumber}`,
      revision: 1,
      raceNumber,
      trackId: "track.mario_circuit",
      modeCC,
      countsTowardStandings: 1,
      finishPosition: 1,
      racePoints: 15,
      totalAfterRace: 15,
      rankAfterRace: 1,
      sourceKind: "tournament_live_capture",
      occurredAtMs: 1787011300000,
      createdAtMs: 1787011300100,
    });
    const repository = new MysqlPlayerActivityRepository(new Executor([[
      race(50, 1), race(100, 2), { ...race(150, 3), mirror: 1 }, { ...race(200, 4), mirror: null },
    ]]));
    expect((await repository.listTournamentRaces("player.synthetic_profile_01"))
      .map((row) => [row.modeCC, row.mirror])).toEqual([[50, undefined], [100, undefined], [150, true], [200, undefined]]);
    const mirrorOn200 = new MysqlPlayerActivityRepository(new Executor([[{ ...race(200, 1), mirror: 1 }]]));
    await expect(mirrorOn200.listTournamentRaces("player.synthetic_profile_01")).rejects.toThrow("mirror is invalid");
    const invalid = new MysqlPlayerActivityRepository(new Executor([[race(999, 1)]]));
    await expect(invalid.listTournamentRaces("player.synthetic_profile_01")).rejects.toThrow("modeCC is invalid");
  });

  it("fails closed on invalid persisted values", async () => {
    const repository = new MysqlPlayerActivityRepository(new Executor([]));
    await expect(repository.findPlayerProfile("not-a-player"))
      .rejects.toThrow("playerId is invalid");

    const invalid = new MysqlPlayerActivityRepository(new Executor([[
      {
        submissionId: "user_submission.time.synthetic_profile_01",
        revision: 1,
        trackId: "track.mario_kart_stadium",
        modeCC: 999,
        totalTimeMs: 83456,
        sourceKind: "web_manual",
        occurredAtMs: null,
        createdAtMs: 1787011200000,
      },
    ]]));
    await expect(invalid.listTimeTrials("player.synthetic_profile_01"))
      .rejects.toThrow("modeCC is invalid");
  });
});
