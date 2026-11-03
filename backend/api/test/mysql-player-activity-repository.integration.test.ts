import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

import { MysqlPlayerActivityRepository } from
  "../src/profiles/mysql-player-activity-repository.js";
import { MysqlPlayerClaimProductRepository } from
  "../src/profiles/mysql-player-claim-product-repository.js";
import { MysqlPlayerInsightsRepository } from
  "../src/profiles/mysql-player-insights-repository.js";

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

const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1"
  ? describe
  : describe.skip;
const playerId = "player.synthetic_activity_integration_01";
const accountId = "user_account.synthetic_activity_integration_01";
const claimId = "player_claim.synthetic_activity_integration_01";
const submissionId = "user_submission.time.synthetic_activity_01";
const raceResultId = "tournament_race_result.synthetic_activity_01";

integration("MySQL Player activity projection", () => {
  let pool: Pool;
  let repository: MysqlPlayerActivityRepository;
  let claimProductRepository: MysqlPlayerClaimProductRepository;
  let insightsRepository: MysqlPlayerInsightsRepository;

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
      connectionLimit: 1,
      multipleStatements: false,
      namedPlaceholders: false,
    };
    const password = process.env["MK8DX_MYSQL_TEST_PASSWORD"];
    if (password !== undefined) { options.password = password; }
    pool = mysql.createPool(options);
    repository = new MysqlPlayerActivityRepository(pool);
    claimProductRepository = new MysqlPlayerClaimProductRepository(pool);
    insightsRepository = new MysqlPlayerInsightsRepository(pool);

    const [migrations] = await pool.execute(
      "SELECT migration_version FROM schema_migrations ORDER BY migration_version",
    );
    expect(migrations).toHaveLength(pinnedMigrationCatalogLength);
    await pool.execute(
      `INSERT INTO players
       (public_id, revision, player_kind, display_name, record_status,
        created_at_ms, updated_at_ms)
       VALUES (?, 1, 'human', 'Synthetic Activity Racer', 'active', 1, 1)`,
      [playerId],
    );
    await pool.execute(
      `INSERT INTO player_username_history
       (player_id, sequence_number, username_value, comparison_key,
        allocated_at_ms, released_at_ms)
       SELECT player_id, 1, 'SyntheticActivityRacer', ?, 1, NULL
       FROM players WHERE public_id = ?`,
      [Buffer.from("syntheticactivityracer"), playerId],
    );
    await pool.execute(
      `INSERT INTO user_accounts
       (public_id, revision, privacy_class, account_status,
        created_at_ms, updated_at_ms)
       VALUES (?, 1, 'private', 'active', 1, 1)`,
      [accountId],
    );
    await pool.execute(
      `INSERT INTO player_claims
       (public_id, revision, privacy_class, player_id, user_account_id,
        claim_status, dispute_status, created_at_ms, updated_at_ms)
       SELECT ?, 1, 'private', p.player_id, a.user_account_id,
              'verified', 'none', 1, 1
       FROM players AS p CROSS JOIN user_accounts AS a
       WHERE p.public_id = ? AND a.public_id = ?`,
      [claimId, playerId, accountId],
    );
    await pool.execute(
      `INSERT INTO time_trial_submissions (public_id, first_created_at_ms)
       VALUES (?, 1000)`,
      [submissionId],
    );
    await pool.execute(
      `INSERT INTO time_trial_submission_revisions
       (time_trial_submission_id, revision_number, schema_version, mode_cc,
        track_id, total_time_ms, participant_reference_kind, player_id,
        source_kind, created_at_ms)
       SELECT s.time_trial_submission_id, 1,
              'mk8dx.time-trial-submission.v1', 150,
              'track.mario_kart_stadium', 83456, 'player', p.player_id,
              'web_manual', 1000
       FROM time_trial_submissions AS s CROSS JOIN players AS p
       WHERE s.public_id = ? AND p.public_id = ?`,
      [submissionId, playerId],
    );
    await pool.execute(
      `INSERT INTO tournament_race_results (public_id, first_created_at_ms)
       VALUES (?, 2000)`,
      [raceResultId],
    );
    await pool.execute(
      `INSERT INTO tournament_race_result_revisions
       (tournament_race_result_id, revision_number, schema_version,
        race_number, scoring_segment, mode_cc, track_id,
        counts_toward_standings, source_kind, created_at_ms)
       SELECT tournament_race_result_id, 1,
              'mk8dx.tournament-race-result.v1', 1, 1, 150,
              'track.gcn_waluigi_stadium', 1,
              'tournament_live_capture', 2000
       FROM tournament_race_results WHERE public_id = ?`,
      [raceResultId],
    );
    await pool.execute(
      `INSERT INTO tournament_race_placements
       (tournament_race_result_revision_id, finish_position,
        participant_reference_kind, player_id, race_points,
        total_before_race, total_after_race, rank_after_race)
       SELECT r.tournament_race_result_revision_id, 2, 'player', p.player_id,
              12, 36, 48, 1
       FROM tournament_race_result_revisions AS r
       INNER JOIN tournament_race_results AS result
         ON result.tournament_race_result_id = r.tournament_race_result_id
       CROSS JOIN players AS p
       WHERE result.public_id = ? AND p.public_id = ?`,
      [raceResultId, playerId],
    );
  });

  afterAll(async () => {
    if (pool === undefined) { return; }
    await pool.execute(
      `DELETE placement FROM tournament_race_placements AS placement
       INNER JOIN tournament_race_result_revisions AS revision
         ON revision.tournament_race_result_revision_id =
            placement.tournament_race_result_revision_id
       INNER JOIN tournament_race_results AS result
         ON result.tournament_race_result_id = revision.tournament_race_result_id
       WHERE result.public_id = ?`,
      [raceResultId],
    );
    await pool.execute(
      `DELETE revision FROM tournament_race_result_revisions AS revision
       INNER JOIN tournament_race_results AS result
         ON result.tournament_race_result_id = revision.tournament_race_result_id
       WHERE result.public_id = ?`,
      [raceResultId],
    );
    await pool.execute("DELETE FROM tournament_race_results WHERE public_id = ?", [raceResultId]);
    await pool.execute(
      `DELETE revision FROM time_trial_submission_revisions AS revision
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = revision.time_trial_submission_id
       WHERE submission.public_id = ?`,
      [submissionId],
    );
    await pool.execute("DELETE FROM time_trial_submissions WHERE public_id = ?", [submissionId]);
    await pool.execute("DELETE FROM player_claims WHERE public_id = ?", [claimId]);
    await pool.execute(
      // The alias deliberately avoids "history": MariaDB parses
      // "DELETE HISTORY FROM" as system-versioned-table syntax.
      `DELETE username_row FROM player_username_history AS username_row
       INNER JOIN players AS player ON player.player_id = username_row.player_id
       WHERE player.public_id = ?`,
      [playerId],
    );
    await pool.execute("DELETE FROM user_accounts WHERE public_id = ?", [accountId]);
    await pool.execute("DELETE FROM players WHERE public_id = ?", [playerId]);
    await pool.end();
  });

  it("reads the verified Player and both canonical latest-revision histories", async () => {
    await expect(repository.findVerifiedPlayerForAccount(accountId)).resolves.toBe(playerId);
    await expect(repository.findPlayerProfile(playerId)).resolves.toEqual({
      playerId,
      username: "SyntheticActivityRacer",
      displayName: "Synthetic Activity Racer",
    });
    await expect(repository.listTimeTrials(playerId)).resolves.toEqual([
      expect.objectContaining({
        submissionId,
        totalTimeMs: 83456,
        trackId: "track.mario_kart_stadium",
      }),
    ]);
    await expect(repository.listTournamentRaces(playerId)).resolves.toEqual([
      expect.objectContaining({
        raceResultId,
        finishPosition: 2,
        racePoints: 12,
        totalAfterRace: 48,
      }),
    ]);
  });

  it("searches the public directory and returns the account's private claim state", async () => {
    await expect(claimProductRepository.searchActivePlayers("SyntheticActivity"))
      .resolves.toEqual([{
        playerId,
        username: "SyntheticActivityRacer",
        displayName: "Synthetic Activity Racer",
        aliases: [],
      }]);
    await expect(claimProductRepository.listClaimsForAccount(accountId))
      .resolves.toEqual([{
        playerClaimId: claimId,
        playerId,
        playerUsername: "SyntheticActivityRacer",
        playerDisplayName: "Synthetic Activity Racer",
        claimStatus: "verified",
        disputeStatus: "none",
        updatedAtMs: 1,
      }]);
  });

  it("derives personal best and counted Tournament totals from latest revisions", async () => {
    await expect(insightsRepository.listTimeTrialPersonalBests(playerId))
      .resolves.toEqual([{
        trackId: "track.mario_kart_stadium",
        modeCC: 150,
        bestTimeMs: 83456,
        attemptCount: 1,
      }]);
    await expect(insightsRepository.summarizeTournaments(playerId))
      .resolves.toEqual({
        raceCount: 1,
        countedRaceCount: 1,
        wins: 0,
        podiums: 1,
        countedPoints: 12,
        countedFinishPositionTotal: 2,
      });
  });
});
