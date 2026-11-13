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
import { MysqlInstallationSettingsRepository } from
  "../src/administration/mysql-installation-settings-repository.js";
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
// ADR-0225: carried runs of the same Player, set to waiting for review the real way.
const extraSubmissionIds = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => `user_submission.time.SYNTHETICLIFECYCLE0${n}`);
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
    ]) {
      for (const id of [submissionId, ...extraSubmissionIds]) { await pool.execute(statement, [id]); }
    }
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

  // ADR-0225: carried runs reach "waiting for review" the real way, through the submission service
  // with the carriedTimes setting on "review".
  const carriedSubmission = (id: string, totalTimeMs: number): TimeTrialSubmissionV1 => ({
    ...submission(),
    submissionId: id,
    totalTimeMs,
    laps: [
      { lapNumber: 1, timeMs: totalTimeMs - 60_000 },
      { lapNumber: 2, timeMs: 30_000 },
      { lapNumber: 3, timeMs: 30_000 },
    ],
    timestamps: { createdAtMs: 1_900_000_500_000 },
    carriedFrom: { origin: "https://club.example.org", originalSubmittedAtMs: 1_890_000_000_000 },
  });
  const reviewWrites = () => new TimeTrialSubmissionService(
    new MysqlTimeTrialWriteRepository(pool, { nowMs: () => 1_900_000_600_000 }),
    new AcceptingCatalog(),
    new UnusedProtector(),
    undefined,
    { policy: async () => "review", ownOrigins: [] },
  );
  const waitingCount = () => new MysqlInstallationSettingsRepository(pool).carriedTimesAwaitingReview();

  it("publishes a run waiting for review through the ordinary publication path (ADR-0225)", async () => {
    const shownBefore = await leaderboardTimes();
    await reviewWrites().submit(carriedSubmission(extraSubmissionIds[0]!, 85_000), { publicationIntent: "trusted_runtime" });
    expect(await leaderboardTimes()).toEqual(shownBefore);
    expect(await waitingCount()).toBe(1);
    const before = await lifecycle.readOwnedOrAdministered(administrator, extraSubmissionIds[0]!);
    expect(before).toMatchObject({ publicationStatus: "withheld", publicationReason: "explicit_review_required" });
    await expect(lifecycle.publishReviewed(owner, extraSubmissionIds[0]!, 1))
      .rejects.toMatchObject({ code: "forbidden" });
    await expect(lifecycle.publishReviewed(administrator, extraSubmissionIds[0]!, 2))
      .rejects.toMatchObject({ code: "conflict" });
    const published = await lifecycle.publishReviewed(administrator, extraSubmissionIds[0]!, 1, "approved");
    expect(published).toMatchObject({
      publicationStatus: "published", publicationReason: "administrator_review_publication",
      current: { revision: 1, totalTimeMs: 85_000 },
    });
    expect(published.events.at(-1)).toMatchObject({
      eventType: "published", actorRole: "administrator", reasonCode: "review_approved", note: "approved",
    });
    expect(await leaderboardTimes()).toEqual([85_000]);
    expect((await publicRepository.listPlayerResults(playerId)).some((row) => row.resultId === extraSubmissionIds[0]))
      .toBe(true);
    const [rows] = await pool.execute<any[]>(
      `SELECT lifecycle.publication_origin AS origin, lifecycle.rank_at_publication AS rankAtPublication
       FROM time_trial_publication_lifecycle AS lifecycle
       INNER JOIN time_trial_publications AS publication
         ON publication.time_trial_publication_id = lifecycle.time_trial_publication_id
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = publication.time_trial_submission_id
       WHERE submission.public_id = ?
       ORDER BY lifecycle.sequence_number DESC LIMIT 1`,
      [extraSubmissionIds[0]!],
    );
    expect(rows[0]).toMatchObject({ origin: "administrator_review", rankAtPublication: 1 });
    expect(await waitingCount()).toBe(0);
    await expect(lifecycle.publishReviewed(administrator, extraSubmissionIds[0]!, 1))
      .rejects.toMatchObject({ code: "conflict" });
  });

  it("refuses or publishes exactly the carried runs waiting, each audited (ADR-0225)", async () => {
    const writes = reviewWrites();
    await writes.submit(carriedSubmission(extraSubmissionIds[1]!, 86_000), { publicationIntent: "trusted_runtime" });
    await writes.submit(carriedSubmission(extraSubmissionIds[2]!, 87_000), { publicationIntent: "trusted_runtime" });
    // A run waiting for review that was not carried is not part of this decision.
    const { carriedFrom: _carried, ...local } = carriedSubmission(extraSubmissionIds[3]!, 88_000);
    await writes.submit(local);
    expect(await waitingCount()).toBe(2);

    await expect(lifecycle.resolveCarriedWaiting(owner, "refuse", 2)).rejects.toMatchObject({ code: "forbidden" });
    await expect(lifecycle.resolveCarriedWaiting(administrator, "refuse", 3)).rejects.toMatchObject({ code: "conflict" });
    expect(await waitingCount()).toBe(2);

    expect(await lifecycle.resolveCarriedWaiting(administrator, "refuse", 2))
      .toEqual({ decision: "refuse", resolved: 2, left: 0 });
    for (const id of [extraSubmissionIds[1]!, extraSubmissionIds[2]!]) {
      const refused = await lifecycle.readOwnedOrAdministered(administrator, id);
      expect(refused).toMatchObject({ retirementState: "retired", publicationStatus: "withheld" });
      expect(refused.events.at(-1)).toMatchObject({
        eventType: "retired", actorRole: "administrator", reasonCode: "carried_times_turned_off",
      });
    }
    const untouched = await lifecycle.readOwnedOrAdministered(administrator, extraSubmissionIds[3]!);
    expect(untouched).toMatchObject({
      retirementState: "active", publicationStatus: "withheld", publicationReason: "explicit_review_required", events: [],
    });
    expect(await waitingCount()).toBe(0);
    // Refused like any retirement, so restorable like any retirement.
    const restored = await lifecycle.restore(administrator, extraSubmissionIds[1]!, "other");
    expect(restored).toMatchObject({ retirementState: "active", publicationStatus: "published" });

    await writes.submit(carriedSubmission(extraSubmissionIds[4]!, 84_000), { publicationIntent: "trusted_runtime" });
    expect(await waitingCount()).toBe(1);
    expect(await lifecycle.resolveCarriedWaiting(administrator, "publish", 1))
      .toEqual({ decision: "publish", resolved: 1, left: 0 });
    const published = await lifecycle.readOwnedOrAdministered(administrator, extraSubmissionIds[4]!);
    expect(published).toMatchObject({ publicationStatus: "published", publicationReason: "administrator_review_publication" });
    expect(published.events.at(-1)).toMatchObject({ eventType: "published", reasonCode: "review_approved" });
    expect(await leaderboardTimes()).toEqual([84_000]);
    expect((await lifecycle.readOwnedOrAdministered(administrator, extraSubmissionIds[3]!)).publicationStatus)
      .toBe("withheld");
  });

  // ADR-0225 amendment: the same carried time twice.
  it("fills only the empty fields of an equal run and refuses the same original twice", async () => {
    const local = new TimeTrialSubmissionService(
      new MysqlTimeTrialWriteRepository(pool, { nowMs: () => 1_900_000_700_000 }),
      new AcceptingCatalog(),
      new UnusedProtector(),
    );
    // A run typed without laps or a kart setup.
    await local.submit({
      ...submission(), submissionId: extraSubmissionIds[5]!, totalTimeMs: 83_000, laps: [],
      timestamps: { createdAtMs: 1_900_000_700_000 },
    }, { publicationIntent: "trusted_runtime" });
    const before = await lifecycle.readOwnedOrAdministered(owner, extraSubmissionIds[5]!);
    expect(before.publicationStatus).toBe("published");
    const shown = await leaderboardTimes();
    const withOriginal = (id: string, originalSubmissionId: string, totalTimeMs = 83_000): TimeTrialSubmissionV1 => ({
      ...carriedSubmission(id, totalTimeMs),
      loadout: { characterId: "character.yoshi", bodyId: "body.mr_scooty" },
      carriedFrom: { origin: "https://club.example.org", originalSubmissionId, originalSubmittedAtMs: 1_890_000_000_000 },
    });
    const filled = await reviewWrites().submit(
      withOriginal(extraSubmissionIds[6]!, "user_submission.time.SYNTHETICORIGINFILL1"),
      { publicationIntent: "trusted_runtime", actorUserAccountId: accountId },
    );
    expect(filled).toEqual({
      submissionId: extraSubmissionIds[5], revision: 2,
      carriedFill: { filledFields: ["characterId", "bodyId", "laps"] },
    });
    const after = await lifecycle.readOwnedOrAdministered(owner, extraSubmissionIds[5]!);
    expect(after).toMatchObject({
      publicationStatus: before.publicationStatus, publicationReason: before.publicationReason,
      current: {
        revision: 2, totalTimeMs: 83_000, laps: [23_000, 30_000, 30_000],
        loadout: { characterId: "character.yoshi", bodyId: "body.mr_scooty" },
      },
    });
    expect(after.carriedFrom).toBeUndefined();
    expect(after.events.at(-1)).toMatchObject({
      eventType: "enriched", actorRole: "owner", reasonCode: "carried_fill", revision: 2,
      carriedFrom: { origin: "https://club.example.org", originalSubmissionId: "user_submission.time.SYNTHETICORIGINFILL1" },
      filledFields: ["characterId", "bodyId", "laps"],
    });
    // No second run and the same rankings.
    await expect(lifecycle.readOwnedOrAdministered(owner, extraSubmissionIds[6]!)).rejects.toMatchObject({ code: "not_found" });
    expect(await leaderboardTimes()).toEqual(shown);

    // The same original again, and another original with nothing left to fill.
    await expect(reviewWrites().submit(
      withOriginal(extraSubmissionIds[7]!, "user_submission.time.SYNTHETICORIGINFILL1"),
      { publicationIntent: "trusted_runtime", actorUserAccountId: accountId },
    )).rejects.toMatchObject({ code: "carried_duplicate" });
    await expect(reviewWrites().submit(
      withOriginal(extraSubmissionIds[7]!, "user_submission.time.SYNTHETICORIGINFILL2"),
      { publicationIntent: "trusted_runtime", actorUserAccountId: accountId },
    )).rejects.toMatchObject({ code: "carried_nothing_to_fill" });

    // A carried time with no equal run becomes a run; its original is then taken too.
    await reviewWrites().submit(
      withOriginal(extraSubmissionIds[8]!, "user_submission.time.SYNTHETICORIGINRUN1", 82_500),
      { publicationIntent: "trusted_runtime", actorUserAccountId: accountId },
    );
    await expect(reviewWrites().submit(
      withOriginal(extraSubmissionIds[9]!, "user_submission.time.SYNTHETICORIGINRUN1", 82_600),
      { publicationIntent: "trusted_runtime", actorUserAccountId: accountId },
    )).rejects.toMatchObject({ code: "carried_duplicate" });
    const [records] = await pool.execute<any[]>(
      `SELECT carried.disposition AS disposition, carried.original_submission_id AS originalId
       FROM time_trial_carried_originals AS carried
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = carried.time_trial_submission_id
       WHERE submission.public_id IN (?, ?) ORDER BY carried.time_trial_carried_original_id`,
      [extraSubmissionIds[5]!, extraSubmissionIds[8]!],
    );
    expect(records).toEqual([
      { disposition: "fill", originalId: "user_submission.time.SYNTHETICORIGINFILL1" },
      { disposition: "run", originalId: "user_submission.time.SYNTHETICORIGINRUN1" },
    ]);
  });

  it("serves the offline copy: own runs in pages and rivals' public bests (ADR-0225 amendment)", async () => {
    const all = await lifecycle.listOwn(owner, 200, 0);
    expect(all.length).toBeGreaterThan(3);
    const page = await lifecycle.listOwn(owner, 2, 1);
    expect(page.map((item) => item.submissionId)).toEqual(all.slice(1, 3).map((item) => item.submissionId));
    expect(all.some((item) => item.current.occurredAtMs !== undefined || item.current.createdAtMs > 0)).toBe(true);

    const bests = await publicRepository.listBestResultsForPlayers([playerId]);
    expect(bests).toHaveLength(1);
    expect(bests[0]).toMatchObject({ playerId, trackId, mode: 150 });
    expect(bests[0]!.totalTimeMs).toBe(Math.min(...(await leaderboardTimes())));
    // A Private Player's times never leave the server this way.
    await visibility.setOwn(owner, "private");
    expect(await publicRepository.listBestResultsForPlayers([playerId])).toEqual([]);
    await visibility.setOwn(owner, "public");
    expect(await publicRepository.listBestResultsForPlayers([playerId])).toHaveLength(1);
  });
});
