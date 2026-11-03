import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { MysqlPublicTimeTrialRepository } from
  "../src/timetrials/mysql-public-time-trial-repository.js";
import { MysqlTimeTrialWriteRepository } from
  "../src/timetrials/mysql-time-trial-write-repository.js";
import { MysqlTimeTrialLifecycleRepository } from
  "../src/timetrials/mysql-lifecycle-repository.js";
import {
  TimeTrialLifecycleError,
  TimeTrialLifecycleService,
} from "../src/timetrials/lifecycle-service.js";
import {
  MysqlPlayerVisibilityRepository,
  PlayerVisibilityService,
} from "../src/profiles/player-visibility-service.js";
import { MysqlIdentityReadRepository } from
  "../src/identity/mysql-identity-read-repository.js";
import {
  TimeTrialSubmissionService,
  type ProtectedLookupValue,
  type ProtectedValue,
  type TimeTrialAssetCatalog,
  type TimeTrialPlayerReference,
  type TimeTrialSensitiveValueProtector,
  type TimeTrialSubmissionV1,
} from "../src/timetrials/submission-service.js";

const pinnedMigrationCatalogLength = (JSON.parse(readFileSync(
  fileURLToPath(new URL(
    "../../../infrastructure/mysql/migration-catalog-v1.json",
    import.meta.url,
  )),
  "utf8",
)) as { migrations: readonly unknown[] }).migrations.length;

const integration =
  process.env["MK8DX_MYSQL_INTEGRATION"] === "1" ? describe : describe.skip;

const playerId = "player.synthetic_lifecycle_01";
const accountId = "user_account.synthetic_lifecycle_01";
const strangerAccountId = "user_account.synthetic_lifecycle_stranger";
const claimId = "player_claim.synthetic_lifecycle_01";
const submissionId = "user_submission.time.SYNTHETICLIFECYCLE01";
const trackId = "track.synthetic_lifecycle_track";

const owner = { role: "account" as const, userAccountId: accountId };
const stranger = { role: "account" as const, userAccountId: strangerAccountId };
const administrator = {
  role: "administrator" as const, userAccountId: strangerAccountId,
};

class AcceptingCatalog implements TimeTrialAssetCatalog {
  async validateReferences(): Promise<readonly string[]> { return []; }
}
class UnusedProtector implements TimeTrialSensitiveValueProtector {
  async protectParticipantReference(
    _namespace: Exclude<TimeTrialPlayerReference["namespace"], "player">,
    _value: string,
  ): Promise<ProtectedLookupValue> { throw new Error("unexpected"); }
  async protectEvidenceReference(_reference: string): Promise<ProtectedValue> {
    throw new Error("unexpected");
  }
}

function submission(): TimeTrialSubmissionV1 {
  return {
    schemaVersion: "mk8dx.time-trial-submission.v1",
    submissionId,
    revision: 1,
    mode: 150,
    trackId,
    totalTimeMs: 90_000,
    laps: [
      { lapNumber: 1, timeMs: 30_000 },
      { lapNumber: 2, timeMs: 30_000 },
      { lapNumber: 3, timeMs: 30_000 },
    ],
    playerReference: { namespace: "player", value: playerId },
    source: { kind: "web_manual", producerVersion: "lifecycle-integration" },
    timestamps: { createdAtMs: 1_900_000_000_000 },
    verification: { status: "producer_check_passed", lapSumMatches: true },
  };
}

integration("owner and administrator Time Trial lifecycle", () => {
  let pool: Pool;
  let lifecycle: TimeTrialLifecycleService;
  let visibility: PlayerVisibilityService;
  let publicRepository: MysqlPublicTimeTrialRepository;
  let identity: MysqlIdentityReadRepository;

  const leaderboardTimes = async (): Promise<readonly number[]> => {
    const rows = await publicRepository.listLeaderboard(trackId, 150);
    return rows.map((row) => row.totalTimeMs);
  };

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
    const [migrations] = await pool.execute<any[]>(
      "SELECT migration_version FROM schema_migrations ORDER BY migration_version",
    );
    expect(migrations).toHaveLength(pinnedMigrationCatalogLength);

    await pool.execute(
      `INSERT INTO players
       (public_id, revision, player_kind, display_name, record_status,
        created_at_ms, updated_at_ms)
       VALUES (?, 1, 'human', 'Synthetic Lifecycle Racer', 'active', 1, 1)`,
      [playerId],
    );
    await pool.execute(
      `INSERT INTO player_username_history
       (player_id, sequence_number, username_value, comparison_key,
        allocated_at_ms)
       SELECT player_id, 1, 'SyntheticLifecycle', ?, 1
       FROM players WHERE public_id = ?`,
      [Buffer.from("syntheticlifecycle", "utf8"), playerId],
    );
    for (const account of [accountId, strangerAccountId]) {
      await pool.execute(
        `INSERT INTO user_accounts
         (public_id, revision, privacy_class, account_status, created_at_ms,
          updated_at_ms)
         VALUES (?, 1, 'private', 'active', 1, 1)`,
        [account],
      );
    }
    await pool.execute(
      `INSERT INTO player_claims
       (public_id, revision, privacy_class, player_id, user_account_id,
        claim_status, dispute_status, created_at_ms, updated_at_ms)
       SELECT ?, 1, 'private', player.player_id, account.user_account_id,
              'verified', 'none', 1, 1
       FROM players AS player CROSS JOIN user_accounts AS account
       WHERE player.public_id = ? AND account.public_id = ?`,
      [claimId, playerId, accountId],
    );

    const writes = new TimeTrialSubmissionService(
      new MysqlTimeTrialWriteRepository(pool, { nowMs: () => 1_900_000_100_000 }),
      new AcceptingCatalog(),
      new UnusedProtector(),
    );
    await writes.submit(submission(), { publicationIntent: "trusted_runtime" });

    lifecycle = new TimeTrialLifecycleService(
      new MysqlTimeTrialLifecycleRepository(pool, { nowMs: () => 1_900_000_200_000 }),
    );
    visibility = new PlayerVisibilityService(
      new MysqlPlayerVisibilityRepository(pool, { nowMs: () => 1_900_000_300_000 }),
    );
    publicRepository = new MysqlPublicTimeTrialRepository(pool);
    identity = new MysqlIdentityReadRepository(pool);
  });

  afterAll(async () => {
    if (pool === undefined) { return; }
    for (const statement of [
      `DELETE event FROM time_trial_lifecycle_events AS event
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = event.time_trial_submission_id
       WHERE submission.public_id = ?`,
      `DELETE lifecycle FROM time_trial_publication_lifecycle AS lifecycle
       INNER JOIN time_trial_publications AS publication
         ON publication.time_trial_publication_id
            = lifecycle.time_trial_publication_id
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id
            = publication.time_trial_submission_id
       WHERE submission.public_id = ?`,
      `DELETE publication FROM time_trial_publications AS publication
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id
            = publication.time_trial_submission_id
       WHERE submission.public_id = ?`,
      `DELETE lap FROM time_trial_laps AS lap
       INNER JOIN time_trial_submission_revisions AS revision
         ON revision.time_trial_submission_revision_id
            = lap.time_trial_submission_revision_id
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id
            = revision.time_trial_submission_id
       WHERE submission.public_id = ?`,
      `DELETE revision FROM time_trial_submission_revisions AS revision
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id
            = revision.time_trial_submission_id
       WHERE submission.public_id = ?`,
      `DELETE FROM time_trial_submissions WHERE public_id = ?`,
    ]) { await pool.execute(statement, [submissionId]); }
    await pool.execute(
      `DELETE visibility FROM player_visibility_lifecycle AS visibility
       INNER JOIN players AS player ON player.player_id = visibility.player_id
       WHERE player.public_id = ?`,
      [playerId],
    );
    await pool.execute(`DELETE FROM player_claims WHERE public_id = ?`, [claimId]);
    await pool.execute(
      `DELETE username FROM player_username_history AS username
       INNER JOIN players AS player ON player.player_id = username.player_id
       WHERE player.public_id = ?`,
      [playerId],
    );
    await pool.execute(`DELETE FROM players WHERE public_id = ?`, [playerId]);
    for (const account of [accountId, strangerAccountId]) {
      await pool.execute(
        `DELETE FROM user_accounts WHERE public_id = ?`, [account],
      );
    }
    await pool.end();
  });

  it("retires a result out of public competition and restores it", async () => {
    expect(await leaderboardTimes()).toEqual([90_000]);

    const retired = await lifecycle.retire(
      owner, submissionId, "incorrect_time", "mis-timed run",
    );
    expect(retired.retirementState).toBe("retired");
    expect(retired.publicationStatus).toBe("withheld");
    expect(retired.publicationReason).toBe("result_retired");
    // Retire is not delete: every revision and the audit trail remain.
    expect(retired.revisions).toHaveLength(1);
    expect(retired.events.at(-1)).toMatchObject({
      eventType: "retired",
      actorRole: "owner",
      reasonCode: "incorrect_time",
      note: "mis-timed run",
    });
    expect(await leaderboardTimes()).toEqual([]);
    expect(await publicRepository.listPlayerResults(playerId)).toHaveLength(0);
    expect(await publicRepository.listPlayerTrackBests(playerId))
      .toHaveLength(0);

    const restored = await lifecycle.restore(
      owner, submissionId, "other", "restored after review",
    );
    expect(restored.retirementState).toBe("active");
    expect(restored.publicationStatus).toBe("published");
    expect(await leaderboardTimes()).toEqual([90_000]);
  });

  it("corrects a result as a new revision that drives public state", async () => {
    const corrected = await lifecycle.correct(owner, submissionId, {
      totalTimeMs: 89_100,
      laps: [29_700, 29_700, 29_700],
      reasonCode: "incorrect_time",
    });
    expect(corrected.current.revision).toBe(2);
    expect(corrected.current.totalTimeMs).toBe(89_100);
    // The earlier revision is retained and explainable.
    expect(corrected.revisions.map((row) => row.revision)).toEqual([1, 2]);
    expect(corrected.revisions[0]?.totalTimeMs).toBe(90_000);
    expect(corrected.events.at(-1)).toMatchObject({
      eventType: "corrected", revision: 2, actorRole: "owner",
    });
    expect(await leaderboardTimes()).toEqual([89_100]);
    const laps = (await publicRepository.listLeaderboard(trackId, 150))[0]?.laps;
    expect(laps?.map((lap) => lap.timeMs)).toEqual([29_700, 29_700, 29_700]);
  });

  it("refuses lifecycle actions from an account that does not own the result",
    async () => {
      await expect(lifecycle.retire(stranger, submissionId, "duplicate"))
        .rejects.toBeInstanceOf(TimeTrialLifecycleError);
      await expect(lifecycle.correct(stranger, submissionId, {
        totalTimeMs: 1_000, laps: [], reasonCode: "other",
      })).rejects.toBeInstanceOf(TimeTrialLifecycleError);
      // The result is untouched by the refused attempts.
      const current = await lifecycle.readOwnedOrAdministered(
        owner, submissionId,
      );
      expect(current.retirementState).toBe("active");
      expect(current.current.revision).toBe(2);
    });

  it("lets an administrator manage a result they do not own", async () => {
    const retired = await lifecycle.retire(
      administrator, submissionId, "invalid_result",
    );
    expect(retired.events.at(-1)).toMatchObject({
      actorRole: "administrator", eventType: "retired",
    });
    expect(await leaderboardTimes()).toEqual([]);
    await lifecycle.restore(administrator, submissionId, "other");
    expect(await leaderboardTimes()).toEqual([89_100]);
  });

  it("withdraws and returns public presence when the Player goes private",
    async () => {
      const priv = await visibility.setOwn(owner, "private");
      expect(priv.visibility).toBe("private");
      // Every ordinary public projection loses the Player at once.
      expect(await leaderboardTimes()).toEqual([]);
      expect(await publicRepository.listPlayerResults(playerId)).toHaveLength(0);
      expect(await publicRepository.listPlayerTrackBests(playerId))
        .toHaveLength(0);
      expect(await identity.findPublicPlayerById(playerId)).toBeNull();

      // The canonical record is untouched, and the owner still sees it.
      const owned = await lifecycle.readOwnedOrAdministered(owner, submissionId);
      expect(owned.current.totalTimeMs).toBe(89_100);
      expect(owned.retirementState).toBe("active");

      const back = await visibility.setOwn(owner, "public");
      expect(back.visibility).toBe("public");
      expect(await leaderboardTimes()).toEqual([89_100]);
      expect(await identity.findPublicPlayerById(playerId)).not.toBeNull();
      // Returning to public must not duplicate anything.
      expect(await publicRepository.listPlayerResults(playerId)).toHaveLength(1);
    });

  it("keeps a retired result withheld across a visibility round trip",
    async () => {
      await lifecycle.retire(owner, submissionId, "test_result");
      await visibility.setOwn(owner, "private");
      await visibility.setOwn(owner, "public");
      // Going public again must not resurrect a deliberately retired result.
      expect(await leaderboardTimes()).toEqual([]);
      const state = await lifecycle.readOwnedOrAdministered(owner, submissionId);
      expect(state.retirementState).toBe("retired");
      await lifecycle.restore(owner, submissionId, "other");
      expect(await leaderboardTimes()).toEqual([89_100]);
    });

  it("records an audited visibility trail with the acting role", async () => {
    await visibility.setForPlayer(
      administrator, playerId, "private", "moderation_review",
    );
    const [rows] = await pool.execute<any[]>(
      `SELECT lifecycle.visibility_before AS visibilityBefore,
              lifecycle.visibility_after AS visibilityAfter,
              lifecycle.actor_role AS actorRole,
              lifecycle.reason_code AS reasonCode
       FROM player_visibility_lifecycle AS lifecycle
       INNER JOIN players AS player ON player.player_id = lifecycle.player_id
       WHERE player.public_id = ?
       ORDER BY lifecycle.sequence_number DESC LIMIT 1`,
      [playerId],
    );
    expect(rows[0]).toMatchObject({
      visibilityBefore: "public",
      visibilityAfter: "private",
      actorRole: "administrator",
      reasonCode: "moderation_review",
    });
    await visibility.setForPlayer(
      administrator, playerId, "public", "review_cleared",
    );
  });
});
