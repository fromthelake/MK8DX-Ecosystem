// Staff and World Record ghost readings against a real schema (ADR-0212, migration 0072).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

import { MysqlReferenceGhostReadingRepository } from "../src/reference-ghosts/mysql-reference-ghost-repository.js";
import { parseReferenceGhostReading } from "../src/reference-ghosts/reference-ghost-readings.js";

const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" ? describe : describe.skip;

const accountId = "user_account.synthetic_ghost_reading_01";
const trackId = "track.synthetic_ghost_reading";

const reading = (overrides: Record<string, unknown> = {}) => parseReferenceGhostReading({
  schemaVersion: "mk8dx.reference-ghost-reading.v1",
  kind: "nintendo_staff", trackId, mode: 200, totalTimeMs: 90_000, observedName: "Nin★Sho",
  countryId: "country.jp",
  loadout: { characterId: "character.mario", bodyId: "body.standard_kart", tireId: "tire.standard", gliderId: "glider.super_glider" },
  lapTimesMs: [30_500, 29_800, 29_700],
  ...overrides,
});

integration("reference ghost readings in MySQL", () => {
  let pool: Pool;
  let repository: MysqlReferenceGhostReadingRepository;

  beforeAll(async () => {
    const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
    if (!/^[a-z][a-z0-9_]*(?:_test|_contract)$/.test(database)) {
      throw new Error("integration database must be a _test/_contract schema");
    }
    const options: PoolOptions = {
      host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
      port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306"),
      user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "mk8dx_test",
      database,
      connectionLimit: 3,
    };
    const password = process.env["MK8DX_MYSQL_TEST_PASSWORD"];
    if (password !== undefined) { options.password = password; }
    pool = mysql.createPool(options);
    await pool.execute("DELETE FROM reference_ghost_readings WHERE track_id = ?", [trackId]);
    await pool.execute("DELETE FROM user_accounts WHERE public_id = ?", [accountId]);
    await pool.execute(
      `INSERT INTO user_accounts (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
       VALUES (?, 1, 'private', 'active', 1, 1)`, [accountId]);
    repository = new MysqlReferenceGhostReadingRepository(pool);
  });

  afterAll(async () => {
    if (pool === undefined) { return; }
    await pool.execute("DELETE FROM reference_ghost_readings WHERE track_id = ?", [trackId]);
    await pool.execute("DELETE FROM user_accounts WHERE public_id = ?", [accountId]);
    await pool.end();
  });

  it("records the panel, completes it from a replay, confirms and keeps a conflict aside", async () => {
    expect(await repository.record(reading(), accountId, 10)).toBe("recorded");
    const replay = {
      coinsPerLap: [4, 3, 3], mushroomsPerLap: [1, 1, 1],
      events: {
        status: "available", timeBase: "race_elapsed_ms",
        coinEvents: [{ raceMs: 2_500, lap: 1, from: 0, to: 1 }],
        mushroomEvents: [{ raceMs: 1_000, lap: 1 }, { raceMs: 31_000, lap: 2 }, { raceMs: 61_000, lap: 3 }],
      },
    };
    expect(await repository.record(reading(replay), accountId, 20)).toBe("completed");
    expect(await repository.record(reading(replay), accountId, 30)).toBe("confirmed");
    expect(await repository.record(reading({ ...replay, coinsPerLap: [5, 3, 2] }), accountId, 40)).toBe("conflict");

    const [shown] = await repository.list({ trackId, mode: 200 });
    expect(shown).toMatchObject({
      kind: "nintendo_staff", trackId, mode: 200, totalTimeMs: 90_000, observedName: "Nin★Sho",
      lapTimesMs: [30_500, 29_800, 29_700], coinsPerLap: [4, 3, 3], mushroomsPerLap: [1, 1, 1],
      source: "ghost_replay", confirmations: 2, conflicts: 1, updatedAtMs: 30,
      loadout: { characterId: "character.mario" },
    });
    expect(shown?.events?.mushroomEvents).toHaveLength(3);
    // The sender is never part of what is published.
    expect(JSON.stringify(shown)).not.toContain(accountId);
  });

  it("keeps a newer World Record as its own reading", async () => {
    const record = { kind: "world_record", observedName: "Someone", loadout: null };
    expect(await repository.record(reading(record), accountId, 50)).toBe("recorded");
    expect(await repository.record(reading({ ...record, totalTimeMs: 89_000, lapTimesMs: [29_500, 29_800, 29_700] }), accountId, 60))
      .toBe("recorded");
    const records = (await repository.list({ trackId })).filter((row) => row.kind === "world_record");
    expect(records.map((row) => row.totalTimeMs)).toEqual([89_000, 90_000]);
  });
});
