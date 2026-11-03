import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

import { MysqlTimeTrialWriteRepository } from
  "../src/timetrials/mysql-time-trial-write-repository.js";
import { MysqlTimeTrialReadRepository } from
  "../src/timetrials/mysql-time-trial-read-repository.js";
import {
  TimeTrialRevisionReadService,
  type TimeTrialRestrictedValueReader,
} from "../src/timetrials/revision-read-service.js";
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

const integrationEnabled = process.env["MK8DX_MYSQL_INTEGRATION"] === "1";
const integration = integrationEnabled ? describe : describe.skip;
const playerId = "player.synthetic_tt_mysql_01";
const centralSubmissionId = "user_submission.time.SYNTHETICMYSQLPLAYER01";
const restrictedSubmissionId = "user_submission.time.SYNTHETICMYSQLSOURCE01";

class AcceptingCatalog implements TimeTrialAssetCatalog {
  async validateReferences(): Promise<readonly string[]> { return []; }
}

class DeterministicProtector implements TimeTrialSensitiveValueProtector {
  async protectParticipantReference(
    _namespace: Exclude<TimeTrialPlayerReference["namespace"], "player">,
    _value: string,
  ): Promise<ProtectedLookupValue> {
    return {
      lookupHmac: new Uint8Array(32).fill(0x11),
      lookupKeyVersion: "test-lookup-v1",
      ciphertext: new Uint8Array([0xa1, 0xa2, 0xa3]),
      encryptionKeyVersion: "test-encryption-v1",
    };
  }

  async protectEvidenceReference(_reference: string): Promise<ProtectedValue> {
    return {
      ciphertext: new Uint8Array([0xb1, 0xb2, 0xb3]),
      encryptionKeyVersion: "test-encryption-v1",
    };
  }
}

function manualSubmission(): TimeTrialSubmissionV1 {
  return {
    schemaVersion: "mk8dx.time-trial-submission.v1",
    submissionId: centralSubmissionId,
    revision: 1,
    mode: 150,
    trackId: "track.mario_kart_stadium",
    totalTimeMs: 94_612,
    laps: [],
    countryId: "country.nl",
    playerReference: { namespace: "player", value: playerId },
    source: { kind: "web_manual", producerVersion: "integration-test" },
    timestamps: { createdAtMs: 1_900_000_000_000 },
  };
}

function restrictedSubmission(revision = 1): TimeTrialSubmissionV1 {
  return {
    schemaVersion: "mk8dx.time-trial-submission.v1",
    submissionId: restrictedSubmissionId,
    revision,
    mode: 200,
    trackId: "track.water_park",
    totalTimeMs: 143_000,
    laps: [
      { lapNumber: 1, timeMs: 49_234 },
      { lapNumber: 2, timeMs: 47_567 },
      { lapNumber: 3, timeMs: 46_199 },
    ],
    playerReference: {
      namespace: "producer_local_profile",
      value: "android.private-synthetic-profile",
    },
    observedPlayerName: "Synthetic Integration Racer",
    source: { kind: "android_scan", localRecordId: "scan.integration-01" },
    timestamps: { createdAtMs: 1_900_000_001_000 + revision },
    evidence: [{
      kind: "screenshot",
      reference: "private/synthetic-integration.png",
      sha256: "22".repeat(32),
      mediaType: "image/png",
    }],
    verification: {
      status: "producer_check_passed",
      lapSumMatches: true,
      ...(revision === 2 ? { correctedFields: ["track", "character"] as const } : {}),
    },
  };
}

integration("MySQL Time Trial write repository integration", () => {
  let pool: Pool;
  let repository: MysqlTimeTrialWriteRepository;
  let service: TimeTrialSubmissionService;

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
    repository = new MysqlTimeTrialWriteRepository(pool);
    service = new TimeTrialSubmissionService(
      repository,
      new AcceptingCatalog(),
      new DeterministicProtector(),
    );
    const [migrationRows] = await pool.execute<any[]>(
      "SELECT migration_version FROM schema_migrations ORDER BY migration_version",
    );
    expect(migrationRows).toHaveLength(pinnedMigrationCatalogLength);
    await pool.execute(
      `INSERT INTO players
       (public_id, revision, player_kind, display_name, record_status,
        created_at_ms, updated_at_ms)
       VALUES (?, 1, 'human', 'Synthetic TT MySQL Racer', 'active', 1, 1)`,
      [playerId],
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
      [centralSubmissionId, restrictedSubmissionId],
    );
    await pool.execute(
      `DELETE publication FROM time_trial_publications AS publication
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = publication.time_trial_submission_id
       WHERE submission.public_id IN (?, ?)`,
      [centralSubmissionId, restrictedSubmissionId],
    );
    await pool.execute(
      `DELETE access_log FROM restricted_identity_access_log AS access_log
       INNER JOIN restricted_time_trial_participant_references AS participant
         ON participant.time_trial_participant_reference_id =
            access_log.time_trial_participant_reference_id
       INNER JOIN time_trial_submission_revisions AS revision_record
         ON revision_record.time_trial_submission_revision_id =
            participant.time_trial_submission_revision_id
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = revision_record.time_trial_submission_id
       WHERE submission.public_id IN (?, ?)`,
      [centralSubmissionId, restrictedSubmissionId],
    );
    await pool.execute(
      `DELETE access_log FROM restricted_identity_access_log AS access_log
       INNER JOIN restricted_time_trial_evidence AS evidence
         ON evidence.time_trial_evidence_id = access_log.time_trial_evidence_id
       INNER JOIN time_trial_submission_revisions AS revision_record
         ON revision_record.time_trial_submission_revision_id =
            evidence.time_trial_submission_revision_id
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = revision_record.time_trial_submission_id
       WHERE submission.public_id IN (?, ?)`,
      [centralSubmissionId, restrictedSubmissionId],
    );
    for (const table of [
      "restricted_time_trial_evidence",
      "restricted_time_trial_participant_references",
      "time_trial_laps",
    ]) {
      await pool.execute(
        `DELETE child FROM ${table} AS child
         INNER JOIN time_trial_submission_revisions AS revision_record
           ON revision_record.time_trial_submission_revision_id =
              child.time_trial_submission_revision_id
         INNER JOIN time_trial_submissions AS submission
           ON submission.time_trial_submission_id = revision_record.time_trial_submission_id
         WHERE submission.public_id IN (?, ?)`,
        [centralSubmissionId, restrictedSubmissionId],
      );
    }
    await pool.execute(
      `DELETE revision_record FROM time_trial_submission_revisions AS revision_record
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = revision_record.time_trial_submission_id
       WHERE submission.public_id IN (?, ?)`,
      [centralSubmissionId, restrictedSubmissionId],
    );
    await pool.execute("DELETE FROM time_trial_submissions WHERE public_id IN (?, ?)", [
      centralSubmissionId,
      restrictedSubmissionId,
    ]);
    await pool.execute("DELETE FROM players WHERE public_id = ?", [playerId]);
    await pool.end();
  });

  it("atomically persists central and protected source revisions", async () => {
    await service.submit(manualSubmission());
    await service.submit(restrictedSubmission());
    await service.submit(restrictedSubmission(2));

    const [rows] = await pool.execute<any[]>(
      `SELECT submission.public_id AS submissionId,
              COUNT(DISTINCT revision_record.time_trial_submission_revision_id) AS revisionCount,
              COUNT(DISTINCT lap.time_trial_lap_id) AS lapCount,
              COUNT(DISTINCT participant.time_trial_participant_reference_id) AS participantCount,
              COUNT(DISTINCT evidence.time_trial_evidence_id) AS evidenceCount
       FROM time_trial_submissions AS submission
       INNER JOIN time_trial_submission_revisions AS revision_record
         ON revision_record.time_trial_submission_id = submission.time_trial_submission_id
       LEFT JOIN time_trial_laps AS lap
         ON lap.time_trial_submission_revision_id = revision_record.time_trial_submission_revision_id
       LEFT JOIN restricted_time_trial_participant_references AS participant
         ON participant.time_trial_submission_revision_id = revision_record.time_trial_submission_revision_id
       LEFT JOIN restricted_time_trial_evidence AS evidence
         ON evidence.time_trial_submission_revision_id = revision_record.time_trial_submission_revision_id
       WHERE submission.public_id IN (?, ?)
       GROUP BY submission.time_trial_submission_id, submission.public_id
       ORDER BY submission.public_id`,
      [centralSubmissionId, restrictedSubmissionId],
    );
    expect(rows).toEqual([
      {
        submissionId: centralSubmissionId,
        revisionCount: 1,
        lapCount: 0,
        participantCount: 0,
        evidenceCount: 0,
      },
      {
        submissionId: restrictedSubmissionId,
        revisionCount: 2,
        lapCount: 6,
        participantCount: 2,
        evidenceCount: 2,
      },
    ]);
    const [protectedRows] = await pool.execute<any[]>(
      `SELECT HEX(participant.lookup_hmac) AS lookupHmac,
              HEX(participant.reference_ciphertext) AS participantCiphertext,
              HEX(evidence.reference_ciphertext) AS evidenceCiphertext
       FROM restricted_time_trial_participant_references AS participant
       INNER JOIN restricted_time_trial_evidence AS evidence
         ON evidence.time_trial_submission_revision_id =
            participant.time_trial_submission_revision_id
       ORDER BY participant.time_trial_participant_reference_id`,
    );
    expect(protectedRows).toHaveLength(2);
    expect(protectedRows[0]).toEqual({
      lookupHmac: "11".repeat(32).toUpperCase(),
      participantCiphertext: "A1A2A3",
      evidenceCiphertext: "B1B2B3",
    });
  });

  it("rejects duplicate revision retries without adding rows", async () => {
    await expect(service.submit(restrictedSubmission(2))).rejects.toMatchObject({
      code: "revision_conflict",
    });
    const [rows] = await pool.execute<any[]>(
      `SELECT COUNT(*) AS revisionCount
       FROM time_trial_submission_revisions AS revision_record
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = revision_record.time_trial_submission_id
       WHERE submission.public_id = ?`,
      [restrictedSubmissionId],
    );
    expect(rows).toEqual([{ revisionCount: 2 }]);
  });

  it("reads a canonical restricted revision only after access audits commit", async () => {
    const protectedReader: TimeTrialRestrictedValueReader = {
      decryptParticipantReference(value) {
        expect(Buffer.from(value.ciphertext).toString("hex")).toBe("a1a2a3");
        return "android.private-synthetic-profile";
      },
      decryptEvidenceReference(value) {
        expect(Buffer.from(value.ciphertext).toString("hex")).toBe("b1b2b3");
        return "private/synthetic-integration.png";
      },
    };
    const readService = new TimeTrialRevisionReadService(
      new MysqlTimeTrialReadRepository(pool),
      protectedReader,
      { nowMs: () => 1_900_000_010_000 },
    );

    await expect(readService.readRevision(
      { role: "administrator", userAccountId: "user_account.synthetic_admin" },
      restrictedSubmissionId,
      2,
      "administrative_review",
    )).resolves.toEqual(restrictedSubmission(2));

    const [auditRows] = await pool.execute<any[]>(
      `SELECT resource_type AS resourceType, accessor_type AS accessorType,
              accessor_reference AS accessorReference, purpose_code AS purposeCode,
              accessed_at_ms AS accessedAtMs
       FROM restricted_identity_access_log
       WHERE accessor_reference = ? AND accessed_at_ms = ?
       ORDER BY resource_type`,
      ["user_account.synthetic_admin", 1_900_000_010_000],
    );
    expect(auditRows).toEqual([
      {
        resourceType: "time_trial_evidence",
        accessorType: "administrator",
        accessorReference: "user_account.synthetic_admin",
        purposeCode: "administrative_review",
        accessedAtMs: 1_900_000_010_000,
      },
      {
        resourceType: "time_trial_participant_reference",
        accessorType: "administrator",
        accessorReference: "user_account.synthetic_admin",
        purposeCode: "administrative_review",
        accessedAtMs: 1_900_000_010_000,
      },
    ]);
  });

  it("rolls back a newly inserted stable submission when work fails", async () => {
    const rollbackId = "user_submission.time.SYNTHETICMYSQLROLLBACK";
    await expect(repository.transaction(async (transaction) => {
      await transaction.insertSubmission(rollbackId, 1_900_000_009_000);
      throw new Error("synthetic child failure");
    })).rejects.toThrow("synthetic child failure");
    const [rows] = await pool.execute<any[]>(
      "SELECT COUNT(*) AS rowCount FROM time_trial_submissions WHERE public_id = ?",
      [rollbackId],
    );
    expect(rows).toEqual([{ rowCount: 0 }]);
  });
});
