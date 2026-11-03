import { describe, expect, it } from "vitest";
import type { FieldPacket, QueryResult } from "mysql2";

import { MysqlActivityStoryRepository } from
  "../src/home/mysql-activity-story-repository.js";

class Executor {
  readonly calls: Array<{ sql: string; values: readonly unknown[] }> = [];
  public constructor(private readonly results: readonly unknown[][]) {}

  async execute<T extends QueryResult>(sql: string, values?: any[]) {
    this.calls.push({ sql, values: values ?? [] });
    return [
      this.results[this.calls.length - 1] ?? [],
      [] as FieldPacket[],
    ] as [T, FieldPacket[]];
  }
}

describe("MySQL activity-story result details", () => {
  it("projects public current loadout and lap coins without private evidence", async () => {
    const executor = new Executor([[
      {
        revisionInternalId: "42",
        resultId: "user_submission.time.ACTIVITYDETAIL01",
        playerId: "player.ben",
        displayName: "Ben",
        countryId: "country.nl",
        avatarId: "character.yoshi",
        trackId: "track.mario_kart_stadium",
        mode: "150",
        totalTimeMs: "106784",
        resultAtMs: "1900000000000",
        characterId: "character.yoshi",
        characterVariantId: null,
        bodyId: "body.mr_scooty",
        bodyVariantId: null,
        tireId: "tire.roller",
        gliderId: "glider.cloud_glider",
        gliderVariantId: null,
        sourceKind: "android_scan",
        correctedFieldsJson: '["body"]',
        rankAtPublication: "7",
        protectedEvidence: "must-not-map",
      },
    ], [
      { revisionInternalId: 42, lapNumber: 1, timeMs: 37_121, coinsCollected: 10, mushroomsUsed: 1 },
      { revisionInternalId: 42, lapNumber: 2, timeMs: 35_399, coinsCollected: 8, mushroomsUsed: 0 },
      { revisionInternalId: 42, lapNumber: 3, timeMs: 34_264, coinsCollected: null, mushroomsUsed: 2 },
    ]]);
    const results = await new MysqlActivityStoryRepository(executor as never)
      .listRecentResults(0, 500);
    expect(results).toEqual([expect.objectContaining({
      resultId: "user_submission.time.ACTIVITYDETAIL01",
      loadout: {
        characterId: "character.yoshi",
        bodyId: "body.mr_scooty",
        tireId: "tire.roller",
        gliderId: "glider.cloud_glider",
      },
      sourceKind: "android_scan",
      correctedFields: ["body"],
      rankAtPublication: 7,
      laps: [
        { lapNumber: 1, timeMs: 37_121, coinsCollected: 10, mushroomsUsed: 1 },
        { lapNumber: 2, timeMs: 35_399, coinsCollected: 8, mushroomsUsed: 0 },
        { lapNumber: 3, timeMs: 34_264, mushroomsUsed: 2 },
      ],
    })]);
    expect(JSON.stringify(results)).not.toContain("must-not-map");
    expect(executor.calls[0]?.sql).toContain("publication_status = 'published'");
    expect(executor.calls[1]?.sql).toContain("coins_collected");
    expect(executor.calls[1]?.values).toEqual([42]);
  });

  it("loads standings and pre-story references in one query per batch", async () => {
    const executor = new Executor([[
      { targetKey: "stadium#150", playerId: "player.ben", displayName: "Ben", bestMs: "92000" },
      { targetKey: "stadium#150", playerId: "player.floyd", displayName: "Floyd", bestMs: "91331" },
      { targetKey: "big-blue#200", playerId: "player.ben", displayName: "Ben", bestMs: "87022" },
    ], [
      { targetKey: "story-0", bestMs: "93000" },
      { targetKey: "story-1", bestMs: "88000" },
    ]]);
    const repository = new MysqlActivityStoryRepository(executor as never);

    const standings = await repository.listHumanBestsForCombos([
      { key: "stadium#150", trackId: "track.mario_kart_stadium", mode: 150 },
      { key: "big-blue#200", trackId: "track.big_blue", mode: 200 },
    ]);
    const previous = await repository.preStoryBests([
      { key: "story-0", playerId: "player.floyd", trackId: "track.mario_kart_stadium", mode: 150, beforeAtMs: 1000 },
      { key: "story-1", playerId: "player.ben", trackId: "track.big_blue", mode: 200, beforeAtMs: 2000 },
    ]);

    expect(executor.calls).toHaveLength(2);
    expect(executor.calls[0]?.sql.match(/UNION ALL/g)).toHaveLength(1);
    expect(executor.calls[0]?.values).toEqual([
      "stadium#150", "track.mario_kart_stadium", 150,
      "big-blue#200", "track.big_blue", 200,
    ]);
    expect(standings.get("stadium#150")).toHaveLength(2);
    expect(standings.get("big-blue#200")?.[0]?.bestMs).toBe(87_022);
    expect(previous).toEqual(new Map([["story-0", 93_000], ["story-1", 88_000]]));
  });
});
