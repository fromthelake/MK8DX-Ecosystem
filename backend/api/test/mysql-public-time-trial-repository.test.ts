import { describe, expect, it } from "vitest";
import type { FieldPacket, QueryResult } from "mysql2";

import type { PreparedQueryExecutor } from
  "../src/identity/mysql-identity-read-repository.js";
import { MysqlPublicTimeTrialRepository } from
  "../src/timetrials/mysql-public-time-trial-repository.js";

class Executor implements PreparedQueryExecutor {
  readonly calls: Array<{ sql: string; values?: any[] }> = [];
  public constructor(private readonly results: readonly unknown[][]) {}
  async execute<T extends QueryResult>(sql: string, values?: any[]) {
    this.calls.push({ sql, ...(values === undefined ? {} : { values }) });
    return [this.results[this.calls.length - 1] ?? [], [] as FieldPacket[]] as [T, FieldPacket[]];
  }
}

const row = {
  revisionInternalId: "42",
  resultId: "user_submission.time.PUBLICMYSQL01",
  revision: "2",
  playerId: "player.synthetic_public_mysql_01",
  playerUsername: "PublicMysql",
  playerDisplayName: "Public MySQL Racer",
  trackId: "track.mario_kart_stadium",
  mode: 150,
  totalTimeMs: 91_234,
  characterId: "character.mario",
  characterVariantId: null,
  bodyId: null,
  bodyVariantId: null,
  tireId: "tire.standard",
  gliderId: null,
  gliderVariantId: null,
  sourceKind: "livetrial_capture",
  correctedFieldsJson: '["track","character"]',
  resultAtMs: "1900000000000",
  publishedAtMs: "1900000000100",
  rankValue: null,
  privateEvidence: "must-not-map",
};
const laps = [1, 2, 3].map((lapNumber) => ({
  revisionInternalId: 42,
  lapNumber,
  timeMs: lapNumber === 3 ? 30_234 : 30_500,
  coinsCollected: null,
  mushroomsUsed: null,
}));

describe("MySQL public Time Trial projections", () => {
  it("maps only published current Player history with laps", async () => {
    const executor = new Executor([[row], laps]);
    const repository = new MysqlPublicTimeTrialRepository(executor);
    const results = await repository.listPlayerResults(row.playerId);
    expect(results).toEqual([{
      resultId: row.resultId,
      revision: 2,
      playerId: row.playerId,
      playerUsername: row.playerUsername,
      playerDisplayName: row.playerDisplayName,
      trackId: row.trackId,
      mode: 150,
      totalTimeMs: row.totalTimeMs,
      laps: laps.map(({ revisionInternalId: _internal, ...lap }) => ({
        lapNumber: lap.lapNumber,
        timeMs: lap.timeMs,
      })),
      loadout: { characterId: "character.mario", tireId: "tire.standard" },
      sourceKind: "livetrial_capture",
      correctedFields: ["track", "character"],
      resultAtMs: 1_900_000_000_000,
      publishedAtMs: 1_900_000_000_100,
    }]);
    expect(executor.calls[0]?.sql).toContain("publication.publication_status = 'published'");
    // Publication status is the sole public visibility gate: the owner's
    // explicit administrator publication decides what is public, so no
    // verified-claim join may hide published records (owner decision
    // 2026-08-20, matching the established legacy product behavior).
    expect(executor.calls[0]?.sql).not.toContain("player_claims");
    expect(executor.calls[0]?.sql).toContain("player.record_status = 'active'");
    expect(executor.calls[0]?.sql).toContain(
      "revision.time_trial_submission_revision_id = publication.current_revision_id",
    );
    expect(JSON.stringify(results)).not.toContain("must-not-map");
  });

  it("ranks one best current result per Player", async () => {
    const executor = new Executor([[{ ...row, rankValue: "1" }], laps]);
    const results = await new MysqlPublicTimeTrialRepository(executor)
      .listLeaderboard(row.trackId, 150);
    expect(results[0]).toMatchObject({ rank: 1, playerId: row.playerId });
    expect(executor.calls[0]?.sql).toContain("FROM time_trial_player_bests AS best");
    expect(executor.calls[0]?.sql).toContain("RANK() OVER");
    expect(executor.calls[0]?.values).toEqual([row.trackId, 150]);
  });

  it("projects exact 96-track standings with medals and average", async () => {
    const executor = new Executor([[
      {
        rankValue: "1",
        playerId: row.playerId,
        playerDisplayName: row.playerDisplayName,
        mode: "150",
        totalTimeMs: "57691234",
        playedTracks: "1",
        goldMedals: "1",
        silverMedals: "0",
        bronzeMedals: "0",
      },
    ]]);
    const standings = await new MysqlPublicTimeTrialRepository(executor)
      .listStandings(150);
    expect(standings).toEqual([{
      rank: 1,
      playerId: row.playerId,
      playerDisplayName: row.playerDisplayName,
      mode: 150,
      totalTimeMs: 57_691_234,
      averageTimeMs: 600_950,
      playedTracks: 1,
      goldMedals: 1,
      silverMedals: 0,
      bronzeMedals: 0,
    }]);
    expect(executor.calls[0]?.sql).toContain("(96 - COUNT(*)) * 600000");
    expect(executor.calls[0]?.sql).toContain("SUM(trackRank = 1)");
    expect(executor.calls[0]?.values).toEqual([150]);
  });

  it("scopes standings to the canonical base 48 without changing rank semantics", async () => {
    const executor = new Executor([[
      {
        rankValue: "1", playerId: row.playerId,
        playerDisplayName: row.playerDisplayName, mode: "200",
        totalTimeMs: "28800000", playedTracks: "0",
        goldMedals: "0", silverMedals: "0", bronzeMedals: "0",
      },
    ]]);
    const standings = await new MysqlPublicTimeTrialRepository(executor)
      .listStandings(200, "base");
    expect(standings[0]?.averageTimeMs).toBe(600_000);
    const call = executor.calls[0];
    expect(call).toBeDefined();
    expect(call!.sql).toContain("(48 - COUNT(*)) * 600000");
    expect(call!.sql).toContain("best.track_id IN");
    const values = call!.values;
    expect(values).toHaveLength(49);
    expect(values!.slice(0, 2)).toEqual([200, "track.mario_kart_stadium"]);
    expect(values!.at(-1)).toBe("track.big_blue");
  });
});
