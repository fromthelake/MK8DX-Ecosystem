import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

import {
  Schema9AssetCatalog,
  TimeTrialSchema9AssetCatalogAdapter,
} from "../src/assets/schema9-asset-catalog.js";
import { expectedSchema9DatabaseSha256 } from "../src/composition/local-runtime.js";
import type { FirebaseImportPlan } from "../src/migration/firebase-import-plan.js";
import { FirebaseTimeTrialImportService } from
  "../src/migration/firebase-import-service.js";
import { MysqlFirebaseImportRepository } from
  "../src/migration/mysql-firebase-import-repository.js";
import { FirebaseTimeTrialBackoutService } from
  "../src/migration/firebase-backout-service.js";
import { MysqlFirebaseBackoutRepository } from
  "../src/migration/mysql-firebase-backout-repository.js";
import { TimeTrialProtectedValueAdapter } from
  "../src/security/protected-value-adapters.js";

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

function loadFixturePlan(): FirebaseImportPlan {
  return JSON.parse(readFileSync(planFixturePath, "utf8")) as FirebaseImportPlan;
}

integration("MySQL Firebase Time Trial backout integration", () => {
  let pool: Pool;
  let importService: FirebaseTimeTrialImportService;
  let backoutService: FirebaseTimeTrialBackoutService;
  let importRunNumber = 0;
  let backoutRunNumber = 0;
  const importRunIds: string[] = [];

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
    const [migrationRows] = await pool.execute<any[]>(
      "SELECT migration_version FROM schema_migrations ORDER BY migration_version",
    );
    expect(migrationRows).toHaveLength(pinnedMigrationCatalogLength);
    importService = new FirebaseTimeTrialImportService(
      new MysqlFirebaseImportRepository(pool),
      new TimeTrialSchema9AssetCatalogAdapter(new Schema9AssetCatalog(
        JSON.parse(readFileSync(catalogPath, "utf8")),
        expectedSchema9DatabaseSha256,
      )),
      new TimeTrialProtectedValueAdapter({
        encryptionKey: new Uint8Array(32).fill(0x61),
        encryptionKeyVersion: "integration-backout-enc-v1",
        lookupHmacKey: new Uint8Array(32).fill(0x62),
        lookupKeyVersion: "integration-backout-lookup-v1",
      }),
      { nowMs: () => Date.now() },
      () => {
        importRunNumber += 1;
        const runId =
          `migration_import_run.backout_gate_import_${Date.now()}_${importRunNumber}`;
        importRunIds.push(runId);
        return runId;
      },
    );
    backoutService = new FirebaseTimeTrialBackoutService(
      new MysqlFirebaseBackoutRepository(pool),
      { nowMs: () => Date.now() },
      () => {
        backoutRunNumber += 1;
        return `migration_import_run.backout_gate_${Date.now()}_${backoutRunNumber}`;
      },
    );
    for (const [index, record] of loadFixturePlan().records.entries()) {
      if (record.recordKind !== "reviewed_player") {
        continue;
      }
      await pool.execute(
        `INSERT INTO players
         (public_id, revision, player_kind, display_name, record_status,
          created_at_ms, updated_at_ms)
         VALUES (?, 1, 'human', ?, 'active', 1, 1)`,
        [record.resolution.playerId, `Synthetic Backout Target ${index}`],
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
    await pool.end();
  });

  it("refuses to back out a published submission, then backs out after retraction", async () => {
    const importReport = await importService.importPlan(loadFixturePlan());
    expect(importReport.totals.imported).toBe(9);

    const publishedSubmissionId =
      loadFixturePlan().records[0]?.candidate.submissionId as string;
    const [publicationRows] = await pool.execute<any[]>(
      `SELECT publication.time_trial_publication_id AS publicationId,
              publication.current_revision_id AS revisionId,
              publication.publication_revision AS publicationRevision
       FROM time_trial_publications publication
       JOIN time_trial_submissions submission
         ON submission.time_trial_submission_id = publication.time_trial_submission_id
       WHERE submission.public_id = ?`,
      [publishedSubmissionId],
    );
    const publication = publicationRows[0];
    await pool.execute(
      `UPDATE time_trial_publications
       SET publication_status = 'published', publication_origin = 'runtime_automatic',
           reason_code = 'verified_claim_runtime_acceptance',
           publication_revision = publication_revision + 1,
           published_at_ms = 1, updated_at_ms = 2
       WHERE time_trial_publication_id = ?`,
      [publication.publicationId],
    );
    await pool.execute(
      `INSERT INTO time_trial_publication_lifecycle (
         time_trial_publication_id, sequence_number,
         time_trial_submission_revision_id, event_type,
         publication_status_after, publication_origin, reason_code,
         occurred_at_ms
       ) VALUES (?, ?, ?, 'revision_published', 'published',
                 'runtime_automatic', 'verified_claim_runtime_acceptance', 1)`,
      [
        publication.publicationId,
        Number(publication.publicationRevision) + 1,
        publication.revisionId,
      ],
    );

    const refused = await backoutService.backOut({
      importRunId: importRunIds[0] as string,
    });
    expect(refused.totals.failed).toBe(1);
    expect(refused.totals.backedOut).toBe(8);
    expect(refused.records.filter(
      (record) => record.outcome === "failed_backout_published",
    )).toHaveLength(1);
    const [remaining] = await pool.execute<any[]>(
      "SELECT COUNT(*) AS total FROM time_trial_submissions WHERE public_id = ?",
      [publishedSubmissionId],
    );
    expect(Number(remaining[0].total)).toBe(1);

    // Retract the synthetic publication, then the remaining record backs out.
    await pool.execute(
      `DELETE FROM time_trial_publication_lifecycle
       WHERE time_trial_publication_id = ? AND event_type = 'revision_published'`,
      [publication.publicationId],
    );
    await pool.execute(
      `UPDATE time_trial_publications
       SET publication_status = 'withheld', publication_origin = 'internal_withheld',
           reason_code = 'explicit_review_required',
           published_at_ms = NULL, updated_at_ms = 3
       WHERE time_trial_publication_id = ?`,
      [publication.publicationId],
    );
    const completed = await backoutService.backOut({
      importRunId: importRunIds[0] as string,
    });
    expect(completed.totals.failed).toBe(0);
    expect(completed.totals.backedOut).toBe(1);
    expect(completed.totals.skippedAlreadyBackedOut).toBe(8);

    const [submissions] = await pool.execute<any[]>(
      `SELECT COUNT(*) AS total FROM time_trial_submissions
       WHERE public_id LIKE 'user_submission.time.firebase\\_%'`,
    );
    expect(Number(submissions[0].total)).toBe(0);
    const [publications] = await pool.execute<any[]>(
      "SELECT COUNT(*) AS total FROM time_trial_publications",
    );
    expect(Number(publications[0].total)).toBe(0);
    const [records] = await pool.execute<any[]>(
      `SELECT import_status AS status, COUNT(*) AS total
       FROM firebase_timetrial_import_records
       GROUP BY import_status ORDER BY import_status`,
    );
    expect(records.map((row: any) => [row.status, Number(row.total)])).toEqual([
      ["backed_out", 9],
      ["failed", 1],
    ]);
    const [identifiers] = await pool.execute<any[]>(
      `SELECT COUNT(*) AS total FROM restricted_legacy_identity_identifiers
       WHERE source_system = 'timetrials_firebase'`,
    );
    expect(Number(identifiers[0].total)).toBe(7);
  });

  it("re-imports backed-out candidates and stays idempotent afterwards", async () => {
    const reimport = await importService.importPlan(loadFixturePlan());
    expect(reimport.totals).toEqual({
      planRecords: 10,
      imported: 9,
      skippedAlreadyImported: 0,
      failed: 1,
    });
    const repeat = await importService.importPlan(loadFixturePlan());
    expect(repeat.totals.skippedAlreadyImported).toBe(9);

    const [revisions] = await pool.execute<any[]>(
      `SELECT COUNT(*) AS total FROM time_trial_submission_revisions AS revision_record
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = revision_record.time_trial_submission_id
       WHERE submission.public_id LIKE 'user_submission.time.firebase\\_%'`,
    );
    expect(Number(revisions[0].total)).toBe(9);
    const [publications] = await pool.execute<any[]>(
      `SELECT COUNT(*) AS total FROM time_trial_publications
       WHERE publication_status = 'withheld'`,
    );
    expect(Number(publications[0].total)).toBe(9);
  });
});
