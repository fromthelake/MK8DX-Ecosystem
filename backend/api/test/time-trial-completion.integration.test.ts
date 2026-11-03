// ADR-0210 rule 10 against a real schema: a completion fills the gaps and keeps everything else.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

import { MysqlPublicTimeTrialRepository } from "../src/timetrials/mysql-public-time-trial-repository.js";
import { MysqlTimeTrialWriteRepository } from "../src/timetrials/mysql-time-trial-write-repository.js";
import { MysqlTimeTrialCompletionRepository } from "../src/timetrials/mysql-completion-repository.js";
import {
  TimeTrialCompletionError,
  TimeTrialCompletionService,
  type TimeTrialCompletionV1,
} from "../src/timetrials/completion-service.js";
import {
  TimeTrialSubmissionService,
  type ProtectedLookupValue,
  type ProtectedValue,
  type TimeTrialAssetCatalog,
  type TimeTrialPlayerReference,
  type TimeTrialSensitiveValueProtector,
} from "../src/timetrials/submission-service.js";

const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" ? describe : describe.skip;

const playerId = "player.synthetic_completion_01";
const accountId = "user_account.synthetic_completion_01";
const strangerAccountId = "user_account.synthetic_completion_stranger";
const claimId = "player_claim.synthetic_completion_01";
const submissionId = "user_submission.time.SYNTHETICCOMPLETION01";
const trackId = "track.synthetic_completion_track";
const owner = { role: "account" as const, userAccountId: accountId };
const stranger = { role: "account" as const, userAccountId: strangerAccountId };

class AcceptingCatalog implements TimeTrialAssetCatalog {
  async validateReferences(): Promise<readonly string[]> { return []; }
}
class TestProtector implements TimeTrialSensitiveValueProtector {
  async protectParticipantReference(
    _namespace: Exclude<TimeTrialPlayerReference["namespace"], "player">, _value: string,
  ): Promise<ProtectedLookupValue> { throw new Error("unexpected"); }
  async protectEvidenceReference(reference: string): Promise<ProtectedValue> {
    return { ciphertext: Uint8Array.from(Buffer.from(`sealed:${reference}`)), encryptionKeyVersion: "test-v1" };
  }
}

function reading(overrides: Partial<TimeTrialCompletionV1> = {}): TimeTrialCompletionV1 {
  return {
    schemaVersion: "mk8dx.time-trial-completion.v1",
    expectedRevision: 1,
    trackId,
    mode: 200,
    totalTimeMs: 76_875,
    laps: [
      { lapNumber: 1, timeMs: 26_381, coinsCollected: 5, mushroomsUsed: 1 },
      { lapNumber: 2, timeMs: 25_209, coinsCollected: 3, mushroomsUsed: 1 },
      { lapNumber: 3, timeMs: 25_285, coinsCollected: 2, mushroomsUsed: 1 },
    ],
    loadout: {
      characterId: "character.inkling_boy", bodyId: "body.buggybud",
      bodyVariantId: "body_variant.buggybud.000_blue", tireId: "tire.azure_roller",
      gliderId: "glider.cloud_glider",
    },
    source: { kind: "livetrial_capture", producerVersion: "3.25.0" },
    evidence: [{ kind: "capture_session", reference: `livetrial/${"b".repeat(64)}` }],
    ...overrides,
  };
}

integration("completing a published Time Trial from a LiveTrial reading", () => {
  let pool: Pool;
  let service: TimeTrialCompletionService;
  let publicRepository: MysqlPublicTimeTrialRepository;

  const code = async (work: () => Promise<unknown>): Promise<string> => {
    try { await work(); } catch (error) {
      if (error instanceof TimeTrialCompletionError) { return error.code; }
      throw error;
    }
    return "none";
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

    await pool.execute(
      `INSERT INTO players (public_id, revision, player_kind, display_name, record_status, created_at_ms, updated_at_ms)
       VALUES (?, 1, 'human', 'Synthetic Completion Racer', 'active', 1, 1)`,
      [playerId],
    );
    await pool.execute(
      `INSERT INTO player_username_history (player_id, sequence_number, username_value, comparison_key, allocated_at_ms)
       SELECT player_id, 1, 'SyntheticCompletion', ?, 1 FROM players WHERE public_id = ?`,
      [Buffer.from("syntheticcompletion", "utf8"), playerId],
    );
    for (const account of [accountId, strangerAccountId]) {
      await pool.execute(
        `INSERT INTO user_accounts (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
         VALUES (?, 1, 'private', 'active', 1, 1)`,
        [account],
      );
    }
    await pool.execute(
      `INSERT INTO player_claims (public_id, revision, privacy_class, player_id, user_account_id,
         claim_status, dispute_status, created_at_ms, updated_at_ms)
       SELECT ?, 1, 'private', player.player_id, account.user_account_id, 'verified', 'none', 1, 1
       FROM players AS player CROSS JOIN user_accounts AS account
       WHERE player.public_id = ? AND account.public_id = ?`,
      [claimId, playerId, accountId],
    );
    // What a scan leaves: laps without counts, the base Buggybud, a scan evidence reference.
    await new TimeTrialSubmissionService(
      new MysqlTimeTrialWriteRepository(pool, { nowMs: () => 1_900_000_100_000 }),
      new AcceptingCatalog(),
      new TestProtector(),
    ).submit({
      schemaVersion: "mk8dx.time-trial-submission.v1",
      submissionId,
      revision: 1,
      mode: 200,
      trackId,
      totalTimeMs: 76_875,
      laps: [
        { lapNumber: 1, timeMs: 26_381 },
        { lapNumber: 2, timeMs: 25_209 },
        { lapNumber: 3, timeMs: 25_285 },
      ],
      loadout: {
        characterId: "character.inkling_boy", bodyId: "body.buggybud",
        tireId: "tire.azure_roller", gliderId: "glider.cloud_glider",
      },
      playerReference: { namespace: "player", value: playerId },
      source: { kind: "android_scan", producerVersion: "2.60.0", captureLayout: "time_trial_result" },
      timestamps: { createdAtMs: 1_900_000_000_000, capturedAtMs: 1_899_999_990_000 },
      evidence: [{ kind: "scan_result", reference: "android/scan-1" }],
      verification: { status: "producer_check_passed", lapSumMatches: true },
    }, { publicationIntent: "trusted_runtime" });

    service = new TimeTrialCompletionService(
      new MysqlTimeTrialCompletionRepository(pool, { nowMs: () => 1_900_000_500_000 }),
      new AcceptingCatalog(),
      new TestProtector(),
    );
    publicRepository = new MysqlPublicTimeTrialRepository(pool);
  });

  afterAll(async () => {
    if (pool === undefined) { return; }
    const byRevision = (table: string) =>
      `DELETE child FROM ${table} AS child
       INNER JOIN time_trial_submission_revisions AS revision
         ON revision.time_trial_submission_revision_id = child.time_trial_submission_revision_id
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = revision.time_trial_submission_id
       WHERE submission.public_id = ?`;
    for (const statement of [
      `DELETE event FROM time_trial_lifecycle_events AS event
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = event.time_trial_submission_id
       WHERE submission.public_id = ?`,
      `DELETE lifecycle FROM time_trial_publication_lifecycle AS lifecycle
       INNER JOIN time_trial_publications AS publication
         ON publication.time_trial_publication_id = lifecycle.time_trial_publication_id
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = publication.time_trial_submission_id
       WHERE submission.public_id = ?`,
      `DELETE publication FROM time_trial_publications AS publication
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = publication.time_trial_submission_id
       WHERE submission.public_id = ?`,
      byRevision("time_trial_laps"),
      byRevision("restricted_time_trial_evidence"),
      byRevision("time_trial_submission_capture_layouts"),
      `DELETE revision FROM time_trial_submission_revisions AS revision
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = revision.time_trial_submission_id
       WHERE submission.public_id = ?`,
      `DELETE FROM time_trial_submissions WHERE public_id = ?`,
    ]) { await pool.execute(statement, [submissionId]); }
    await pool.execute(`DELETE FROM player_claims WHERE public_id = ?`, [claimId]);
    await pool.execute(
      `DELETE username FROM player_username_history AS username
       INNER JOIN players AS player ON player.player_id = username.player_id WHERE player.public_id = ?`,
      [playerId],
    );
    await pool.execute(`DELETE FROM players WHERE public_id = ?`, [playerId]);
    for (const account of [accountId, strangerAccountId]) {
      await pool.execute(`DELETE FROM user_accounts WHERE public_id = ?`, [account]);
    }
    await pool.end();
  });

  it("refuses another account and a stale revision", async () => {
    expect(await code(() => service.complete(stranger, submissionId, reading()))).toBe("not_found");
    expect(await code(() => service.complete(owner, submissionId, reading({ expectedRevision: 2 }))))
      .toBe("revision_conflict");
    expect(await code(() => service.complete(owner, submissionId, reading({
      totalTimeMs: 76_874,
      laps: [
        { lapNumber: 1, timeMs: 26_380 }, { lapNumber: 2, timeMs: 25_209 }, { lapNumber: 3, timeMs: 25_285 },
      ],
    })))).toBe("different_result");
  });

  it("fills the counts and the colour, keeping source, dates, evidence and publication", async () => {
    const [before] = await pool.execute<any[]>(
      `SELECT publication.published_at_ms AS publishedAtMs, publication.rank_at_publication AS rankAt,
              publication.reason_code AS reason
       FROM time_trial_publications AS publication
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = publication.time_trial_submission_id
       WHERE submission.public_id = ?`,
      [submissionId],
    );
    const result = await service.complete(owner, submissionId, reading());
    expect(result).toEqual({
      submissionId, revision: 2, completedFields: ["coinsCollected", "mushroomsUsed", "bodyVariant"],
    });
    const [after] = await pool.execute<any[]>(
      `SELECT publication.published_at_ms AS publishedAtMs, publication.rank_at_publication AS rankAt,
              publication.reason_code AS reason, revision.revision_number AS revision,
              revision.source_kind AS sourceKind, revision.created_at_ms AS createdAtMs,
              revision.captured_at_ms AS capturedAtMs,
              (SELECT COUNT(*) FROM restricted_time_trial_evidence AS evidence
                WHERE evidence.time_trial_submission_revision_id = revision.time_trial_submission_revision_id) AS evidenceCount,
              (SELECT capture_layout FROM time_trial_submission_capture_layouts AS layout
                WHERE layout.time_trial_submission_revision_id = revision.time_trial_submission_revision_id) AS layout
       FROM time_trial_publications AS publication
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = publication.time_trial_submission_id
       INNER JOIN time_trial_submission_revisions AS revision
         ON revision.time_trial_submission_revision_id = publication.current_revision_id
       WHERE submission.public_id = ?`,
      [submissionId],
    );
    expect(after[0]).toMatchObject({
      publishedAtMs: before[0].publishedAtMs, rankAt: before[0].rankAt, reason: before[0].reason,
      revision: 2, sourceKind: "android_scan", layout: "time_trial_result",
    });
    expect(Number(after[0].createdAtMs)).toBe(1_900_000_000_000);
    expect(Number(after[0].capturedAtMs)).toBe(1_899_999_990_000);
    expect(Number(after[0].evidenceCount)).toBe(2);

    const board = await publicRepository.listLeaderboard(trackId, 200);
    const row = board.find((entry) => entry.resultId === submissionId)!;
    expect(row.sourceKind).toBe("android_scan");
    expect(row.laps.map((lap) => [lap.coinsCollected, lap.mushroomsUsed])).toEqual([[5, 1], [3, 1], [2, 1]]);
    expect(row.loadout).toMatchObject({ bodyVariantId: "body_variant.buggybud.000_blue" });

    const [events] = await pool.execute<any[]>(
      `SELECT event.event_type AS type, event.reason_code AS reason, event.note AS note
       FROM time_trial_lifecycle_events AS event
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = event.time_trial_submission_id
       WHERE submission.public_id = ?`,
      [submissionId],
    );
    expect(events).toEqual([{
      type: "corrected", reason: "other",
      note: "Completed from a LiveTrial ghost: coinsCollected, mushroomsUsed, bodyVariant",
    }]);
  });

  it("has nothing left to fill the second time", async () => {
    expect(await code(() => service.complete(owner, submissionId, reading({ expectedRevision: 2 }))))
      .toBe("nothing_missing");
  });
});
