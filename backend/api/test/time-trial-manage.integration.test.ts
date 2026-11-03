// Manage against a real schema (owner 2026-09-28): corrections in the form of Post a Time, and the
// Player's YouTube video (migration 0071).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

import { MysqlPublicTimeTrialRepository } from "../src/timetrials/mysql-public-time-trial-repository.js";
import { MysqlTimeTrialWriteRepository } from "../src/timetrials/mysql-time-trial-write-repository.js";
import { MysqlTimeTrialLifecycleRepository } from "../src/timetrials/mysql-lifecycle-repository.js";
import { TimeTrialLifecycleService } from "../src/timetrials/lifecycle-service.js";
import {
  TimeTrialSubmissionService,
  type TimeTrialAssetCatalog,
  type TimeTrialSensitiveValueProtector,
} from "../src/timetrials/submission-service.js";

const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" ? describe : describe.skip;

const playerId = "player.synthetic_manage_01";
const accountId = "user_account.synthetic_manage_01";
const claimId = "player_claim.synthetic_manage_01";
const submissionId = "user_submission.time.SYNTHETICMANAGE01";
const trackId = "track.synthetic_manage_track";
const owner = { role: "account" as const, userAccountId: accountId };

class AcceptingCatalog implements TimeTrialAssetCatalog {
  async validateReferences(): Promise<readonly string[]> { return []; }
}
const unusedProtector: TimeTrialSensitiveValueProtector = {
  async protectParticipantReference() { throw new Error("unexpected"); },
  async protectEvidenceReference() { throw new Error("unexpected"); },
};

integration("managing a Time Trial like Post a Time", () => {
  let pool: Pool;
  let lifecycle: TimeTrialLifecycleService;
  let publicRepository: MysqlPublicTimeTrialRepository;

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
    await pool.execute(
      `INSERT INTO players (public_id, revision, player_kind, display_name, record_status, created_at_ms, updated_at_ms)
       VALUES (?, 1, 'human', 'Synthetic Manage Racer', 'active', 1, 1)`, [playerId]);
    await pool.execute(
      `INSERT INTO player_username_history (player_id, sequence_number, username_value, comparison_key, allocated_at_ms)
       SELECT player_id, 1, 'SyntheticManage', ?, 1 FROM players WHERE public_id = ?`,
      [Buffer.from("syntheticmanage", "utf8"), playerId]);
    await pool.execute(
      `INSERT INTO user_accounts (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
       VALUES (?, 1, 'private', 'active', 1, 1)`, [accountId]);
    await pool.execute(
      `INSERT INTO player_claims (public_id, revision, privacy_class, player_id, user_account_id,
         claim_status, dispute_status, created_at_ms, updated_at_ms)
       SELECT ?, 1, 'private', player.player_id, account.user_account_id, 'verified', 'none', 1, 1
       FROM players AS player CROSS JOIN user_accounts AS account
       WHERE player.public_id = ? AND account.public_id = ?`, [claimId, playerId, accountId]);
    // A scanned run: coins and mushrooms per lap and a colour variant on the body.
    await new TimeTrialSubmissionService(
      new MysqlTimeTrialWriteRepository(pool, { nowMs: () => 1_900_000_100_000 }),
      new AcceptingCatalog(), unusedProtector,
    ).submit({
      schemaVersion: "mk8dx.time-trial-submission.v1", submissionId, revision: 1, mode: 150, trackId,
      totalTimeMs: 104_689,
      laps: [
        { lapNumber: 1, timeMs: 35_000, coinsCollected: 4, mushroomsUsed: 1 },
        { lapNumber: 2, timeMs: 34_800, coinsCollected: 8, mushroomsUsed: 1 },
        { lapNumber: 3, timeMs: 34_889, coinsCollected: 10, mushroomsUsed: 1 },
      ],
      loadout: {
        characterId: "character.inkling_boy", bodyId: "body.buggybud",
        bodyVariantId: "body_variant.buggybud.000_blue", tireId: "tire.azure_roller", gliderId: "glider.cloud_glider",
      },
      playerReference: { namespace: "player", value: playerId },
      source: { kind: "web_manual" },
      timestamps: { createdAtMs: 1_900_000_000_000 },
    }, { publicationIntent: "trusted_runtime" });
    lifecycle = new TimeTrialLifecycleService(
      new MysqlTimeTrialLifecycleRepository(pool, { nowMs: () => 1_900_000_200_000 }),
      undefined, new AcceptingCatalog(),
    );
    publicRepository = new MysqlPublicTimeTrialRepository(pool);
  });

  afterAll(async () => {
    if (pool === undefined) { return; }
    const where = "WHERE submission.public_id = ?";
    for (const statement of [
      `DELETE video FROM time_trial_videos AS video INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = video.time_trial_submission_id ${where}`,
      `DELETE event FROM time_trial_lifecycle_events AS event INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = event.time_trial_submission_id ${where}`,
      `DELETE lifecycle FROM time_trial_publication_lifecycle AS lifecycle
         INNER JOIN time_trial_publications AS publication
           ON publication.time_trial_publication_id = lifecycle.time_trial_publication_id
         INNER JOIN time_trial_submissions AS submission
           ON submission.time_trial_submission_id = publication.time_trial_submission_id ${where}`,
      `DELETE publication FROM time_trial_publications AS publication INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = publication.time_trial_submission_id ${where}`,
      `DELETE lap FROM time_trial_laps AS lap INNER JOIN time_trial_submission_revisions AS revision
         ON revision.time_trial_submission_revision_id = lap.time_trial_submission_revision_id
         INNER JOIN time_trial_submissions AS submission
           ON submission.time_trial_submission_id = revision.time_trial_submission_id ${where}`,
      `DELETE revision FROM time_trial_submission_revisions AS revision INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = revision.time_trial_submission_id ${where}`,
      `DELETE FROM time_trial_submissions WHERE public_id = ?`,
    ]) { await pool.execute(statement, [submissionId]); }
    await pool.execute(`DELETE FROM player_claims WHERE public_id = ?`, [claimId]);
    await pool.execute(
      `DELETE username FROM player_username_history AS username
       INNER JOIN players AS player ON player.player_id = username.player_id WHERE player.public_id = ?`, [playerId]);
    await pool.execute(`DELETE FROM players WHERE public_id = ?`, [playerId]);
    await pool.execute(`DELETE FROM user_accounts WHERE public_id = ?`, [accountId]);
    await pool.end();
  });

  const board = async () => (await publicRepository.listLeaderboard(trackId, 150))
    .find((row) => row.resultId === submissionId)!;

  it("shows what the result recorded, so an editor can start from it", async () => {
    const managed = await lifecycle.readOwnedOrAdministered(owner, submissionId);
    expect(managed.current.lapDetails).toEqual([
      { coinsCollected: 4, mushroomsUsed: 1 }, { coinsCollected: 8, mushroomsUsed: 1 }, { coinsCollected: 10, mushroomsUsed: 1 },
    ]);
    expect(managed.current.loadout).toMatchObject({ bodyId: "body.buggybud", bodyVariantId: "body_variant.buggybud.000_blue" });
    expect(managed.videoUrl).toBeUndefined();
  });

  it("keeps the coins and mushrooms when only the times are corrected", async () => {
    await lifecycle.correct(owner, submissionId, {
      totalTimeMs: 104_589, laps: [34_900, 34_800, 34_889], reasonCode: "incorrect_time",
    });
    const row = await board();
    expect(row.totalTimeMs).toBe(104_589);
    expect(row.laps.map((lap) => [lap.coinsCollected, lap.mushroomsUsed])).toEqual([[4, 1], [8, 1], [10, 1]]);
  });

  it("restates the counts and the kart setup; a colour stays only with its own part", async () => {
    await lifecycle.correct(owner, submissionId, {
      totalTimeMs: 104_589, laps: [34_900, 34_800, 34_889], reasonCode: "other",
      lapDetails: [{ coinsCollected: 3, mushroomsUsed: 2 }, { coinsCollected: 7 }, { coinsCollected: 10, mushroomsUsed: 1 }],
      loadout: { characterId: "character.inkling_boy", bodyId: "body.buggybud", tireId: "tire.roller", gliderId: "glider.paper_glider" },
    });
    let row = await board();
    expect(row.laps.map((lap) => [lap.coinsCollected ?? null, lap.mushroomsUsed ?? null])).toEqual([[3, 2], [7, null], [10, 1]]);
    expect(row.loadout).toEqual({
      characterId: "character.inkling_boy", bodyId: "body.buggybud", bodyVariantId: "body_variant.buggybud.000_blue",
      tireId: "tire.roller", gliderId: "glider.paper_glider",
    });
    await lifecycle.correct(owner, submissionId, {
      totalTimeMs: 104_589, laps: [34_900, 34_800, 34_889], reasonCode: "other",
      loadout: { characterId: "character.mario", bodyId: "body.pipe_frame" },
    });
    row = await board();
    expect(row.loadout).toEqual({ characterId: "character.mario", bodyId: "body.pipe_frame" });
  });

  it("attaches, shows and removes the Player's YouTube video", async () => {
    const managed = await lifecycle.setVideo(owner, submissionId, "https://youtu.be/dQw4w9WgXcQ?si=tracking");
    expect(managed.videoUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect((await board()).videoUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    // a later correction does not lose it: it belongs to the result, not a revision
    await lifecycle.correct(owner, submissionId, { totalTimeMs: 104_589, laps: [], reasonCode: "other" });
    expect((await board()).videoUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await lifecycle.setVideo(owner, submissionId, null);
    expect((await board()).videoUrl).toBeUndefined();
  });
});
