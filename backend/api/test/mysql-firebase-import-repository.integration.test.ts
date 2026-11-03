import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

import {
  Schema9AssetCatalog,
  TimeTrialSchema9AssetCatalogAdapter,
} from "../src/assets/schema9-asset-catalog.js";
import { expectedSchema9DatabaseSha256 } from "../src/composition/local-runtime.js";
import {
  candidateCanonicalSha256,
  type FirebaseImportPlan,
  type FirebaseImportPlanRecord,
} from "../src/migration/firebase-import-plan.js";
import {
  FirebaseTimeTrialImportService,
  type FirebaseImportRepository,
  type FirebaseImportTransaction,
} from "../src/migration/firebase-import-service.js";
import { MysqlFirebaseImportRepository } from
  "../src/migration/mysql-firebase-import-repository.js";
import { TimeTrialProtectedValueAdapter } from
  "../src/security/protected-value-adapters.js";
import type { TimeTrialSubmissionV1 } from
  "../src/timetrials/submission-service.js";

import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

// The applied ledger must be an exact prefix of the hash-pinned catalog, so
// the expected count follows that catalog instead of a frozen number.
const pinnedMigrationCatalogLength = (JSON.parse(readFileSync(
  fileURLToPath(new URL(
    "../../../infrastructure/mysql/migration-catalog-v1.json",
    import.meta.url,
  )),
  "utf8",
)) as { migrations: readonly unknown[] }).migrations.length;

const integrationEnabled = process.env["MK8DX_MYSQL_INTEGRATION"] === "1";
const integration = integrationEnabled ? describe : describe.skip;

const planFixturePath = resolve(
  import.meta.dirname,
  "../../../tooling/migration/timetrials/fixtures/synthetic-firebase-import-plan-v1.json",
);
const catalogPath = resolve(
  import.meta.dirname,
  "../../../packages/assets/schema9-asset-catalog-v1.json",
);

const stalePlayerId = "player.synthetic_import_stale_target";
const staleSubmissionId = "user_submission.time.firebase_integrationstale01";
const staleRecordKey = `firebase_record.${"c".repeat(32)}`;

function loadFixturePlan(): FirebaseImportPlan {
  return JSON.parse(readFileSync(planFixturePath, "utf8")) as FirebaseImportPlan;
}

function fixturePlayerIds(): string[] {
  return loadFixturePlan().records.flatMap(
    (record) => record.recordKind === "reviewed_player"
      ? [record.resolution.playerId]
      : [],
  );
}

function stalePlanRecord(expectedPlayerRevision: number): FirebaseImportPlanRecord {
  const candidate: TimeTrialSubmissionV1 = {
    schemaVersion: "mk8dx.time-trial-submission.v1",
    submissionId: staleSubmissionId,
    revision: 1,
    mode: 150,
    trackId: "track.mario_kart_stadium",
    totalTimeMs: 96_500,
    laps: [],
    playerReference: { namespace: "player", value: stalePlayerId },
    source: { kind: "web_manual" },
    timestamps: { createdAtMs: 1_760_003_000_000 },
  };
  return {
    recordKind: "reviewed_player",
    recordKey: staleRecordKey,
    candidateSha256: candidateCanonicalSha256(candidate),
    candidate,
    legacyVisible: true,
    legacyOwner: {
      namespace: "legacy_firebase_user",
      value: "synthetic_firebase_uid_integration_stale",
    },
    resolution: {
      resolutionId: "migration_identity_resolution.synthetic_integration_stale",
      playerId: stalePlayerId,
      expectedPlayerRevision,
      administratorGrantId: "administrator_grant.synthetic_migration_review",
      reasonCode: "synthetic_exact_match",
      reviewedAtMs: 1_900_000_000_000,
    },
  };
}

function stalePlan(expectedPlayerRevision: number): FirebaseImportPlan {
  return {
    schemaVersion: "mk8dx.firebase-timetrial-import-plan.v1",
    runnerVersion: "firebase-timetrial-batch-dry-run.v1",
    inputSha256: "cd".repeat(32),
    records: [stalePlanRecord(expectedPlayerRevision)],
  };
}

class LateFaultRepository implements FirebaseImportRepository {
  public constructor(private readonly base: MysqlFirebaseImportRepository) {}

  public createRun(
    input: Parameters<MysqlFirebaseImportRepository["createRun"]>[0],
  ): Promise<void> {
    return this.base.createRun(input);
  }

  public transaction<T>(
    runPublicId: string,
    work: (transaction: FirebaseImportTransaction) => Promise<T>,
  ): Promise<T> {
    return this.base.transaction(runPublicId, async (transaction) => {
      await work(transaction);
      throw new Error("injected fault after canonical writes");
    });
  }

  public recordFailure(
    input: Parameters<MysqlFirebaseImportRepository["recordFailure"]>[0],
  ): Promise<void> {
    return this.base.recordFailure(input);
  }
}

integration("MySQL Firebase Time Trial import integration", () => {
  let pool: Pool;
  let repository: MysqlFirebaseImportRepository;
  let runNumber = 0;

  function buildService(
    importRepository: FirebaseImportRepository,
  ): FirebaseTimeTrialImportService {
    return new FirebaseTimeTrialImportService(
      importRepository,
      new TimeTrialSchema9AssetCatalogAdapter(new Schema9AssetCatalog(
        JSON.parse(readFileSync(catalogPath, "utf8")),
        expectedSchema9DatabaseSha256,
      )),
      new TimeTrialProtectedValueAdapter({
        encryptionKey: new Uint8Array(32).fill(0x51),
        encryptionKeyVersion: "integration-import-enc-v1",
        lookupHmacKey: new Uint8Array(32).fill(0x52),
        lookupKeyVersion: "integration-import-lookup-v1",
      }),
      { nowMs: () => Date.now() },
      () => {
        runNumber += 1;
        return `migration_import_run.integration_${Date.now()}_${runNumber}`;
      },
    );
  }

  beforeAll(async () => {
    const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
    if (!/^[a-z][a-z0-9_]*(?:_test|_contract)$/.test(database)) {
      throw new Error("integration database must be an explicit _test/_contract schema");
    }
    const poolOptions: PoolOptions = {
      host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
      port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306"),
      user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "mk8dx_test",
      database,
      connectionLimit: 2,
      multipleStatements: false,
      namedPlaceholders: false,
    };
    const password = process.env["MK8DX_MYSQL_TEST_PASSWORD"];
    if (password !== undefined) { poolOptions.password = password; }
    pool = mysql.createPool(poolOptions);
    repository = new MysqlFirebaseImportRepository(pool);
    const [migrationRows] = await pool.execute<any[]>(
      "SELECT migration_version FROM schema_migrations ORDER BY migration_version",
    );
    expect(migrationRows).toHaveLength(pinnedMigrationCatalogLength);
    for (const [index, playerId] of [...fixturePlayerIds(), stalePlayerId].entries()) {
      await pool.execute(
        `INSERT INTO players
         (public_id, revision, player_kind, display_name, record_status,
          created_at_ms, updated_at_ms)
         VALUES (?, 1, 'human', ?, 'active', 1, 1)`,
        [playerId, `Synthetic Import Target ${index}`],
      );
    }
  });

  afterAll(async () => {
    if (pool === undefined) { return; }
    await pool.execute("DELETE FROM firebase_timetrial_import_attempts");
    await pool.execute("DELETE FROM firebase_timetrial_import_records");
    await pool.execute("DELETE FROM firebase_timetrial_import_runs");
    await pool.execute(
      `DELETE FROM restricted_identity_access_log
       WHERE purpose_code = 'firebase_timetrial_import'`,
    );
    await pool.execute(
      `DELETE FROM restricted_legacy_identity_identifiers
       WHERE source_system = 'timetrials_firebase'`,
    );
    await pool.execute(
      `DELETE lifecycle FROM time_trial_publication_lifecycle AS lifecycle
       INNER JOIN time_trial_publications AS publication
         ON publication.time_trial_publication_id = lifecycle.time_trial_publication_id
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = publication.time_trial_submission_id
       WHERE submission.public_id LIKE 'user_submission.time.firebase\\_%'`,
    );
    await pool.execute(
      `DELETE publication FROM time_trial_publications AS publication
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = publication.time_trial_submission_id
       WHERE submission.public_id LIKE 'user_submission.time.firebase\\_%'`,
    );
    for (const restrictedTable of [
      "restricted_time_trial_evidence",
      "restricted_time_trial_participant_references",
    ]) {
      await pool.execute(
        `DELETE child FROM ${restrictedTable} AS child
         INNER JOIN time_trial_submission_revisions AS revision_record
           ON revision_record.time_trial_submission_revision_id =
              child.time_trial_submission_revision_id
         INNER JOIN time_trial_submissions AS submission
           ON submission.time_trial_submission_id = revision_record.time_trial_submission_id
         WHERE submission.public_id LIKE 'user_submission.time.firebase\\_%'`,
      );
    }
    await pool.execute(
      `DELETE lap FROM time_trial_laps AS lap
       INNER JOIN time_trial_submission_revisions AS revision_record
         ON revision_record.time_trial_submission_revision_id =
            lap.time_trial_submission_revision_id
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = revision_record.time_trial_submission_id
       WHERE submission.public_id LIKE 'user_submission.time.firebase\\_%'`,
    );
    await pool.execute(
      `DELETE revision_record FROM time_trial_submission_revisions AS revision_record
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = revision_record.time_trial_submission_id
       WHERE submission.public_id LIKE 'user_submission.time.firebase\\_%'`,
    );
    await pool.execute(
      `DELETE FROM time_trial_submissions
       WHERE public_id LIKE 'user_submission.time.firebase\\_%'`,
    );
    await pool.execute(
      "DELETE FROM players WHERE public_id LIKE 'player.synthetic\\_migrated\\_%'",
    );
    await pool.execute("DELETE FROM players WHERE public_id = ?", [stalePlayerId]);
    await pool.end();
  });

  it("imports the synthetic plan atomically without publishing anything", async () => {
    const report = await buildService(repository).importPlan(loadFixturePlan());

    // The lone hidden revision-2 record has no revision 1 in the synthetic
    // corpus, so its incomplete chain fails closed; everything else imports.
    expect(report.totals).toEqual({
      planRecords: 10,
      imported: 9,
      skippedAlreadyImported: 0,
      failed: 1,
    });
    expect(report.records.filter(
      (item) => item.outcome === "failed_revision_conflict",
    )).toHaveLength(1);

    const [submissions] = await pool.execute<any[]>(
      `SELECT COUNT(*) AS total FROM time_trial_submissions
       WHERE public_id LIKE 'user_submission.time.firebase\\_%'`,
    );
    expect(Number(submissions[0].total)).toBe(9);
    const [publications] = await pool.execute<any[]>(
      `SELECT publication_status AS status, publication_origin AS origin,
              reason_code AS reason, COUNT(*) AS total
       FROM time_trial_publications AS publication
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = publication.time_trial_submission_id
       WHERE submission.public_id LIKE 'user_submission.time.firebase\\_%'
       GROUP BY 1, 2, 3 ORDER BY reason`,
    );
    expect(publications.map(
      (row: any) => [row.status, row.origin, row.reason, Number(row.total)],
    )).toEqual([
      ["withheld", "internal_withheld", "explicit_review_required", 7],
      ["withheld", "internal_withheld", "non_player_participant", 2],
    ]);

    const [records] = await pool.execute<any[]>(
      `SELECT import_status AS status, record_kind AS recordKind,
              attempt_count AS attempts, legacy_visible AS legacyVisible,
              time_trial_submission_revision_id AS revisionId,
              legacy_identifier_id AS legacyId,
              resolution_id AS resolutionId
       FROM firebase_timetrial_import_records`,
    );
    expect(records).toHaveLength(10);
    let systemRecords = 0;
    let hiddenRecords = 0;
    for (const record of records) {
      expect(Number(record.attempts)).toBe(1);
      if (record.legacyVisible !== null && Number(record.legacyVisible) === 0) {
        hiddenRecords += 1;
      }
      if (record.recordKind === "system_reference") {
        systemRecords += 1;
        expect(record.status).toBe("imported");
        expect(record.legacyId).toBeNull();
        expect(record.resolutionId).toBeNull();
        expect(record.revisionId).not.toBeNull();
        continue;
      }
      expect(record.recordKind).toBe("reviewed_player");
      expect(String(record.resolutionId)).toMatch(
        /^migration_identity_resolution\./,
      );
      if (record.status === "imported") {
        expect(record.revisionId).not.toBeNull();
        expect(record.legacyId).not.toBeNull();
      }
    }
    expect(systemRecords).toBe(2);
    expect(hiddenRecords).toBe(1);
    const [restrictedParticipants] = await pool.execute<any[]>(
      `SELECT participant.reference_namespace AS namespace, COUNT(*) AS total
       FROM restricted_time_trial_participant_references AS participant
       INNER JOIN time_trial_submission_revisions AS revision_record
         ON revision_record.time_trial_submission_revision_id =
            participant.time_trial_submission_revision_id
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = revision_record.time_trial_submission_id
       WHERE submission.public_id LIKE 'user_submission.time.firebase\\_%'
       GROUP BY participant.reference_namespace`,
    );
    expect(restrictedParticipants.map(
      (row: any) => [row.namespace, Number(row.total)],
    )).toEqual([["unresolved_observation", 2]]);
    const [restrictedEvidence] = await pool.execute<any[]>(
      `SELECT COUNT(*) AS total FROM restricted_time_trial_evidence AS evidence
       INNER JOIN time_trial_submission_revisions AS revision_record
         ON revision_record.time_trial_submission_revision_id =
            evidence.time_trial_submission_revision_id
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = revision_record.time_trial_submission_id
       WHERE submission.public_id LIKE 'user_submission.time.firebase\\_%'`,
    );
    expect(Number(restrictedEvidence[0].total)).toBe(3);
    const [identifiers] = await pool.execute<any[]>(
      `SELECT lookup_key_version AS lookupKeyVersion,
              linked_player_id AS linkedPlayerId,
              linked_user_account_id AS linkedAccountId
       FROM restricted_legacy_identity_identifiers
       WHERE source_system = 'timetrials_firebase'`,
    );
    expect(identifiers).toHaveLength(7);
    for (const identifier of identifiers) {
      expect(identifier.lookupKeyVersion).toBe("integration-import-lookup-v1");
      expect(identifier.linkedPlayerId).not.toBeNull();
      expect(identifier.linkedAccountId).toBeNull();
    }
  });

  it("repeats idempotently and audits reuse of restricted legacy identifiers", async () => {
    const rerun = await buildService(repository).importPlan(loadFixturePlan());

    expect(rerun.totals).toEqual({
      planRecords: 10,
      imported: 0,
      skippedAlreadyImported: 9,
      failed: 1,
    });
    const [revisions] = await pool.execute<any[]>(
      `SELECT COUNT(*) AS total FROM time_trial_submission_revisions AS revision_record
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = revision_record.time_trial_submission_id
       WHERE submission.public_id LIKE 'user_submission.time.firebase\\_%'`,
    );
    expect(Number(revisions[0].total)).toBe(9);
    const [attempts] = await pool.execute<any[]>(
      `SELECT outcome, COUNT(*) AS total FROM firebase_timetrial_import_attempts
       GROUP BY outcome ORDER BY outcome`,
    );
    expect(attempts.map((row: any) => [row.outcome, Number(row.total)])).toEqual([
      ["failed_revision_conflict", 2],
      ["imported", 9],
      ["skipped_already_imported", 9],
    ]);
  });

  it("fails closed on a stale Player revision and imports after re-review", async () => {
    const stale = await buildService(repository).importPlan(stalePlan(7));
    expect(stale.records[0]?.outcome).toBe("failed_stale_player_revision");

    const [missing] = await pool.execute<any[]>(
      "SELECT COUNT(*) AS total FROM time_trial_submissions WHERE public_id = ?",
      [staleSubmissionId],
    );
    expect(Number(missing[0].total)).toBe(0);
    const [failedRecord] = await pool.execute<any[]>(
      `SELECT import_status AS status, attempt_count AS attempts,
              time_trial_submission_revision_id AS revisionId
       FROM firebase_timetrial_import_records WHERE record_key = ?`,
      [staleRecordKey],
    );
    expect(failedRecord).toHaveLength(1);
    expect(failedRecord[0].status).toBe("failed");
    expect(Number(failedRecord[0].attempts)).toBe(1);
    expect(failedRecord[0].revisionId).toBeNull();

    const retried = await buildService(repository).importPlan(stalePlan(1));
    expect(retried.records[0]?.outcome).toBe("imported");
    const [retriedRecord] = await pool.execute<any[]>(
      `SELECT import_status AS status, attempt_count AS attempts
       FROM firebase_timetrial_import_records WHERE record_key = ?`,
      [staleRecordKey],
    );
    expect(retriedRecord[0].status).toBe("imported");
    expect(Number(retriedRecord[0].attempts)).toBe(2);
  });

  it("rolls back every canonical write when a fault hits before commit", async () => {
    const faultSubmissionId = "user_submission.time.firebase_integrationfault01";
    const candidate: TimeTrialSubmissionV1 = {
      schemaVersion: "mk8dx.time-trial-submission.v1",
      submissionId: faultSubmissionId,
      revision: 1,
      mode: 200,
      trackId: "track.water_park",
      totalTimeMs: 133_000,
      laps: [],
      playerReference: { namespace: "player", value: stalePlayerId },
      source: { kind: "android_manual" },
      timestamps: { createdAtMs: 1_760_003_100_000 },
    };
    const faultPlan: FirebaseImportPlan = {
      schemaVersion: "mk8dx.firebase-timetrial-import-plan.v1",
      runnerVersion: "firebase-timetrial-batch-dry-run.v1",
      inputSha256: "ef".repeat(32),
      records: [{
        recordKind: "reviewed_player",
        recordKey: `firebase_record.${"d".repeat(32)}`,
        candidateSha256: candidateCanonicalSha256(candidate),
        candidate,
        legacyVisible: true,
        legacyOwner: {
          namespace: "legacy_firebase_user",
          value: "synthetic_firebase_uid_integration_fault",
        },
        resolution: {
          resolutionId:
            "migration_identity_resolution.synthetic_integration_fault",
          playerId: stalePlayerId,
          expectedPlayerRevision: 1,
          administratorGrantId: "administrator_grant.synthetic_migration_review",
          reasonCode: "synthetic_exact_match",
          reviewedAtMs: 1_900_000_000_000,
        },
      }],
    };

    const report = await buildService(new LateFaultRepository(repository))
      .importPlan(faultPlan);
    expect(report.records[0]?.outcome).toBe("failed_persistence");

    const [submissionRows] = await pool.execute<any[]>(
      "SELECT COUNT(*) AS total FROM time_trial_submissions WHERE public_id = ?",
      [faultSubmissionId],
    );
    expect(Number(submissionRows[0].total)).toBe(0);
    const [identifierRows] = await pool.execute<any[]>(
      `SELECT COUNT(*) AS total FROM restricted_legacy_identity_identifiers
       WHERE source_system = 'timetrials_firebase'`,
    );
    expect(Number(identifierRows[0].total)).toBe(8);
    const [faultRecord] = await pool.execute<any[]>(
      `SELECT import_status AS status FROM firebase_timetrial_import_records
       WHERE record_key = ?`,
      [`firebase_record.${"d".repeat(32)}`],
    );
    expect(faultRecord).toHaveLength(1);
    expect(faultRecord[0].status).toBe("failed");
  });
});
