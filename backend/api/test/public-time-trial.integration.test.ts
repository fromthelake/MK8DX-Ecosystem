import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

import { MysqlPublicTimeTrialRepository } from
  "../src/timetrials/mysql-public-time-trial-repository.js";
import { MysqlTimeTrialWriteRepository } from
  "../src/timetrials/mysql-time-trial-write-repository.js";
import { MysqlActivityStoryRepository } from
  "../src/home/mysql-activity-story-repository.js";
import { MysqlHomeFocusRepository } from
  "../src/home/mysql-home-focus-repository.js";
import {
  TimeTrialSubmissionService,
  type ProtectedLookupValue,
  type ProtectedValue,
  type TimeTrialAssetCatalog,
  type TimeTrialPlayerReference,
  type TimeTrialSensitiveValueProtector,
  type TimeTrialSubmissionV1,
} from "../src/timetrials/submission-service.js";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The applied ledger must be an exact prefix of the hash-pinned catalog, so
// the expected count follows that catalog instead of a frozen number.
const pinnedMigrationCatalogLength = (JSON.parse(readFileSync(
  fileURLToPath(new URL(
    "../../../infrastructure/mysql/migration-catalog-v1.json",
    import.meta.url,
  )),
  "utf8",
)) as { migrations: readonly unknown[] }).migrations.length;

const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" ? describe : describe.skip;
const playerId = "player.synthetic_public_tt_01";
const accountId = "user_account.synthetic_public_tt_01";
const claimId = "player_claim.synthetic_public_tt_01";
const submissionId = "user_submission.time.SYNTHETICPUBLICTT01";
const competitorPlayerId = "player.synthetic_public_tt_02";
const competitorAccountId = "user_account.synthetic_public_tt_02";
const competitorClaimId = "player_claim.synthetic_public_tt_02";
const competitorSubmissionId = "user_submission.time.SYNTHETICPUBLICTT02";

class AcceptingCatalog implements TimeTrialAssetCatalog {
  async validateReferences(): Promise<readonly string[]> { return []; }
}
class UnusedProtector implements TimeTrialSensitiveValueProtector {
  async protectParticipantReference(
    _namespace: Exclude<TimeTrialPlayerReference["namespace"], "player">,
    _value: string,
  ): Promise<ProtectedLookupValue> { throw new Error("unexpected restricted participant"); }
  async protectEvidenceReference(_reference: string): Promise<ProtectedValue> {
    throw new Error("unexpected evidence");
  }
}

function submission(
  revision: number,
  verification: "producer_check_passed" | "needs_review" = "producer_check_passed",
): TimeTrialSubmissionV1 {
  const totalTimeMs = 94_700 - revision;
  return {
    schemaVersion: "mk8dx.time-trial-submission.v1",
    submissionId,
    revision,
    mode: 150,
    trackId: "track.mario_kart_stadium",
    totalTimeMs,
    laps: [
      { lapNumber: 1, timeMs: 31_500, coinsCollected: 4 },
      { lapNumber: 2, timeMs: 31_500, coinsCollected: 3 },
      { lapNumber: 3, timeMs: totalTimeMs - 63_000, coinsCollected: 3 },
    ],
    loadout: {
      characterId: "character.mario",
      bodyId: "body.standard_kart",
      tireId: "tire.standard",
      gliderId: "glider.super_glider",
    },
    playerReference: { namespace: "player", value: playerId },
    source: { kind: "android_scan", producerVersion: "public-integration-test" },
    timestamps: { createdAtMs: 1_900_000_000_000, submittedAtMs: 1_900_000_001_000 + revision },
    verification: {
      status: verification,
      lapSumMatches: true,
      ...(revision === 3 ? { correctedFields: ["character", "coins"] as const } : {}),
    },
  };
}

function competitorSubmission(): TimeTrialSubmissionV1 {
  return {
    schemaVersion: "mk8dx.time-trial-submission.v1",
    submissionId: competitorSubmissionId,
    revision: 1,
    mode: 150,
    trackId: "track.mario_kart_stadium",
    totalTimeMs: 90_000,
    laps: [],
    playerReference: { namespace: "player", value: competitorPlayerId },
    source: { kind: "web_manual", producerVersion: "public-integration-test" },
    timestamps: { createdAtMs: 1_900_000_200_000 },
  };
}

integration("public Time Trial publication integration", () => {
  let pool: Pool;
  let service: TimeTrialSubmissionService;
  let publicRepository: MysqlPublicTimeTrialRepository;

  beforeAll(async () => {
    const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
    if (!/^[a-z][a-z0-9_]*(?:_test|_contract)$/.test(database)) {
      throw new Error("integration database must be an explicit _test/_contract schema");
    }
    const options: PoolOptions = {
      host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
      port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306"),
      user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "mk8dx_test",
      database,
      connectionLimit: 2,
    };
    const password = process.env["MK8DX_MYSQL_TEST_PASSWORD"];
    if (password !== undefined) { options.password = password; }
    pool = mysql.createPool(options);
    service = new TimeTrialSubmissionService(
      new MysqlTimeTrialWriteRepository(pool, { nowMs: () => 1_900_000_100_000 }),
      new AcceptingCatalog(),
      new UnusedProtector(),
    );
    publicRepository = new MysqlPublicTimeTrialRepository(pool);
    const [migrations] = await pool.execute<any[]>(
      "SELECT migration_version FROM schema_migrations ORDER BY migration_version",
    );
    expect(migrations).toHaveLength(pinnedMigrationCatalogLength);
    await pool.execute(
      `INSERT INTO players
       (public_id, revision, player_kind, display_name, record_status, created_at_ms, updated_at_ms)
       VALUES (?, 1, 'human', 'Synthetic Public Racer', 'active', 1, 1),
              (?, 1, 'human', 'Synthetic Public Rival', 'active', 1, 1)`,
      [playerId, competitorPlayerId],
    );
    await pool.execute(
      `INSERT INTO player_username_history
       (player_id, sequence_number, username_value, comparison_key, allocated_at_ms)
       SELECT player_id, 1,
              IF(public_id = ?, 'SyntheticPublicRacer', 'SyntheticPublicRival'),
              IF(public_id = ?, ?, ?), 1
       FROM players WHERE public_id IN (?, ?)`,
      [
        playerId,
        playerId,
        Buffer.from("syntheticpublicracer", "utf8"),
        Buffer.from("syntheticpublicrival", "utf8"),
        playerId,
        competitorPlayerId,
      ],
    );
    await pool.execute(
      `INSERT INTO user_accounts
       (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
       VALUES (?, 1, 'private', 'active', 1, 1),
              (?, 1, 'private', 'active', 1, 1)`,
      [accountId, competitorAccountId],
    );
    await pool.execute(
      `INSERT INTO player_claims
       (public_id, revision, privacy_class, player_id, user_account_id, claim_status,
        dispute_status, created_at_ms, updated_at_ms)
       SELECT IF(player.public_id = ?, ?, ?), 1, 'private',
              player.player_id, account.user_account_id,
              'verified', 'none', 1, 1
       FROM players AS player
       INNER JOIN user_accounts AS account
         ON account.public_id = IF(player.public_id = ?, ?, ?)
       WHERE player.public_id IN (?, ?)`,
      [
        playerId, claimId, competitorClaimId,
        playerId, accountId, competitorAccountId,
        playerId, competitorPlayerId,
      ],
    );
  });

  afterAll(async () => {
    if (pool === undefined) { return; }
    await pool.execute(
      `DELETE lifecycle FROM time_trial_publication_lifecycle AS lifecycle
       INNER JOIN time_trial_publications AS publication
         ON publication.time_trial_publication_id = lifecycle.time_trial_publication_id
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = publication.time_trial_submission_id
       WHERE submission.public_id IN (?, ?)`,
      [submissionId, competitorSubmissionId],
    );
    await pool.execute(
      `DELETE publication FROM time_trial_publications AS publication
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = publication.time_trial_submission_id
       WHERE submission.public_id IN (?, ?)`,
      [submissionId, competitorSubmissionId],
    );
    await pool.execute(
      `DELETE lap FROM time_trial_laps AS lap
       INNER JOIN time_trial_submission_revisions AS revision
         ON revision.time_trial_submission_revision_id = lap.time_trial_submission_revision_id
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = revision.time_trial_submission_id
       WHERE submission.public_id IN (?, ?)`,
      [submissionId, competitorSubmissionId],
    );
    await pool.execute(
      `DELETE revision FROM time_trial_submission_revisions AS revision
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = revision.time_trial_submission_id
       WHERE submission.public_id IN (?, ?)`,
      [submissionId, competitorSubmissionId],
    );
    await pool.execute("DELETE FROM time_trial_submissions WHERE public_id IN (?, ?)", [
      submissionId, competitorSubmissionId,
    ]);
    await pool.execute("DELETE FROM player_claims WHERE public_id IN (?, ?)", [
      claimId, competitorClaimId,
    ]);
    await pool.execute("DELETE FROM user_accounts WHERE public_id IN (?, ?)", [
      accountId, competitorAccountId,
    ]);
    await pool.execute(
      `DELETE username FROM player_username_history AS username
       INNER JOIN players AS player ON player.player_id = username.player_id
       WHERE player.public_id IN (?, ?)`,
      [playerId, competitorPlayerId],
    );
    await pool.execute("DELETE FROM players WHERE public_id IN (?, ?)", [
      playerId, competitorPlayerId,
    ]);
    await pool.end();
  });

  it("publishes only the current trusted revision for a verified claimed Player", async () => {
    await service.submit(submission(1), { publicationIntent: "trusted_runtime" });
    expect(await publicRepository.listPlayerResults(playerId)).toMatchObject([{
      resultId: submissionId,
      revision: 1,
      playerId,
      playerUsername: "SyntheticPublicRacer",
    }]);

    await service.submit(submission(2, "needs_review"), {
      publicationIntent: "trusted_runtime",
    });
    expect(await publicRepository.listPlayerResults(playerId)).toEqual([]);

    await service.submit(submission(3), { publicationIntent: "trusted_runtime" });
    const history = await publicRepository.listPlayerResults(playerId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      revision: 3,
      totalTimeMs: 94_697,
      sourceKind: "android_scan",
      correctedFields: ["character", "coins"],
    });
    const leaderboard = await publicRepository.listLeaderboard(
      "track.mario_kart_stadium",
      150,
    );
    expect(leaderboard).toHaveLength(1);
    expect(leaderboard[0]).toMatchObject({ revision: 3, rank: 1 });

    const activityResults = await new MysqlActivityStoryRepository(pool)
      .listRecentResults(0, 20);
    expect(activityResults).toContainEqual(expect.objectContaining({
      resultId: submissionId,
      playerId,
      totalTimeMs: 94_697,
      sourceKind: "android_scan",
      correctedFields: ["character", "coins"],
      rankAtPublication: 1,
      loadout: {
        characterId: "character.mario",
        bodyId: "body.standard_kart",
        tireId: "tire.standard",
        gliderId: "glider.super_glider",
      },
      laps: [
        { lapNumber: 1, timeMs: 31_500, coinsCollected: 4 },
        { lapNumber: 2, timeMs: 31_500, coinsCollected: 3 },
        { lapNumber: 3, timeMs: 31_697, coinsCollected: 3 },
      ],
    }));

    const [lifecycle] = await pool.execute<any[]>(
      `SELECT lifecycle.event_type AS eventType,
              lifecycle.reason_code AS reasonCode,
              lifecycle.rank_at_publication AS rankAtPublication
       FROM time_trial_publication_lifecycle AS lifecycle
       INNER JOIN time_trial_publications AS publication
         ON publication.time_trial_publication_id = lifecycle.time_trial_publication_id
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = publication.time_trial_submission_id
       WHERE submission.public_id = ? ORDER BY lifecycle.sequence_number`,
      [submissionId],
    );
    expect(lifecycle).toEqual([
      expect.objectContaining({
        eventType: "revision_published",
        reasonCode: "verified_claim_runtime_acceptance",
        rankAtPublication: 1,
      }),
      expect.objectContaining({
        eventType: "revision_withheld",
        reasonCode: "producer_verification_withheld",
        rankAtPublication: null,
      }),
      expect.objectContaining({
        eventType: "revision_published",
        reasonCode: "verified_claim_runtime_acceptance",
        rankAtPublication: 1,
      }),
    ]);

    // A later faster publication changes today's leaderboard, never the
    // position captured for the earlier run.
    await service.submit(competitorSubmission(), {
      publicationIntent: "trusted_runtime",
    });
    const currentLeaderboard = await publicRepository.listLeaderboard(
      "track.mario_kart_stadium",
      150,
    );
    expect(currentLeaderboard.find((entry) => entry.playerId === competitorPlayerId))
      .toMatchObject({ rank: 1 });
    expect(currentLeaderboard.find((entry) => entry.playerId === playerId))
      .toMatchObject({ rank: 2 });
    const focus = await new MysqlHomeFocusRepository(pool)
      .loadFocusInput(accountId);
    expect(focus?.rows).toEqual([expect.objectContaining({
      trackId: "track.mario_kart_stadium",
      mode: 150,
      myBestMs: 94_697,
      myRank: 2,
      humanCount: 2,
      leaderBestMs: 90_000,
      above: expect.objectContaining({
        playerId: competitorPlayerId,
        bestMs: 90_000,
        rank: 1,
      }),
    })]);
    const stableActivity = await new MysqlActivityStoryRepository(pool)
      .listRecentResults(0, 20);
    expect(stableActivity.find((entry) => entry.resultId === submissionId))
      .toMatchObject({ rankAtPublication: 1 });
    expect(stableActivity.find((entry) =>
      entry.resultId === competitorSubmissionId))
      .toMatchObject({ rankAtPublication: 1 });
  });
});
