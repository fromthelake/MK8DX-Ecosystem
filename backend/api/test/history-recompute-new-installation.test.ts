// A new community (A2) has no imported rating history. Removing or reopening a rated night must still
// recalculate there - starting from nothing - while an installation that once rated history and now
// reads none keeps refusing (found 2026-11-12: removing a finalized night on A2 answered 500 and left
// TrueSkill counting it).
import assert from "node:assert/strict";
import { it } from "vitest";

import { recomputeHistory } from "../src/rating/history-recompute-main.js";

function fakePool(historyRacesRatedBefore: number) {
  const writes: string[] = [];
  const answer = (sql: string): unknown[] => {
    if (sql.includes("FROM tournament_history_races")) { return []; }
    if (sql.includes("event_type = 'history_race'")) { return [{ n: historyRacesRatedBefore }]; }
    if (sql.includes("MAX(rating_epoch)")) { return [{ epoch: 4 }]; }
    if (sql.includes("FROM user_accounts")) { return [{ id: 1 }]; }
    return [];
  };
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql: string) { if (!/^\s*SELECT/i.test(sql)) { writes.push(sql.trim().split(/\s+/).slice(0, 3).join(" ")); } return [answer(sql), []]; },
  };
  const pool = { async execute(sql: string) { return [answer(sql), []]; }, async getConnection() { return connection; } };
  return { pool: pool as never, writes };
}

const run = { parameters: "measured", decay: true, dryRun: false, operator: "user_account.synthetic_admin", reasonCode: "tournament_removed" } as const;

it("starts a new installation's rating from nothing instead of refusing", async () => {
  const { pool, writes } = fakePool(0);
  const report = await recomputeHistory(pool, { ...run, allowEmptyHistory: true });
  assert.equal(report.epoch, 5);
  assert.equal(report.racesRead, 0);
  assert.ok(writes.includes("DELETE FROM player_ratings"), writes.join(" | "));
  assert.ok(writes.includes("INSERT INTO rating_recalculations"), writes.join(" | "));
});

it("still refuses when this installation once rated history and now reads none", async () => {
  const { pool, writes } = fakePool(812);
  await assert.rejects(recomputeHistory(pool, { ...run, allowEmptyHistory: true }), /history is empty/);
  assert.deepEqual(writes, []);
});

it("still refuses an empty history for the command line", async () => {
  const { pool } = fakePool(0);
  await assert.rejects(recomputeHistory(pool, run), /history is empty/);
});
