import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

import { MysqlTournamentReadRepository } from
  "../src/tournaments/mysql-tournament-read-repository.js";
import { MysqlTournamentWriteRepository } from
  "../src/tournaments/mysql-tournament-write-repository.js";
import {
  TournamentRevisionReadService,
  type TournamentRestrictedValueReader,
} from "../src/tournaments/race-result-read-service.js";
import {
  TournamentRaceResultService,
  type TournamentAssetCatalog,
  type TournamentProtectedLookupValue,
  type TournamentProtectedValue,
  type TournamentSensitiveValueProtector,
} from "../src/tournaments/race-result-service.js";
import type {
  TournamentParticipantReference,
  TournamentRaceResultV1,
} from "../src/tournaments/race-result-validation.js";

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
const playerId = "player.synthetic_tournament_live_mysql_01";
const raceResultId = "tournament_race_result.synthetic_live_mysql_001";

class AcceptingCatalog implements TournamentAssetCatalog {
  async validateReferences(): Promise<readonly string[]> { return []; }
}

class DeterministicProtector implements TournamentSensitiveValueProtector {
  private lookup(byte: number): TournamentProtectedLookupValue {
    return {
      lookupHmac: new Uint8Array(32).fill(byte),
      lookupKeyVersion: "test-lookup-v1",
      ciphertext: new Uint8Array([byte, byte + 1]),
      encryptionKeyVersion: "test-encryption-v1",
    };
  }

  async protectParticipantReference(
    _namespace: Exclude<TournamentParticipantReference["namespace"], "player">,
    _value: string,
  ): Promise<TournamentProtectedLookupValue> { return this.lookup(0x11); }
  async protectContextReference(
    _namespace: string,
    _value: string,
  ): Promise<TournamentProtectedLookupValue> { return this.lookup(0x22); }
  async protectEvidenceReference(_reference: string): Promise<TournamentProtectedValue> {
    return {
      ciphertext: new Uint8Array([0x33, 0x34]),
      encryptionKeyVersion: "test-encryption-v1",
    };
  }
  async protectVerificationIssueMessage(_message: string): Promise<TournamentProtectedValue> {
    return {
      ciphertext: new Uint8Array([0x44, 0x45]),
      encryptionKeyVersion: "test-encryption-v1",
    };
  }
}

class DeterministicReader implements TournamentRestrictedValueReader {
  decryptParticipantReference(value: TournamentProtectedValue): string {
    expect(value.ciphertext).toEqual(Uint8Array.from([0x11, 0x12]));
    return "private-live-participant";
  }
  decryptContextReference(value: TournamentProtectedValue): string {
    expect(value.ciphertext).toEqual(Uint8Array.from([0x22, 0x23]));
    return "private-live-group";
  }
  decryptEvidenceReference(value: TournamentProtectedValue): string {
    expect(value.ciphertext).toEqual(Uint8Array.from([0x33, 0x34]));
    return "private-live-evidence";
  }
  decryptVerificationIssueMessage(value: TournamentProtectedValue): string {
    expect(value.ciphertext).toEqual(Uint8Array.from([0x44, 0x45]));
    return "Private review message";
  }
}

function raceResult(revision = 1): TournamentRaceResultV1 {
  return {
    schemaVersion: "mk8dx.tournament-race-result.v1",
    raceResultId,
    revision,
    raceNumber: 1,
    scoringSegment: 1,
    mode: 150,
    trackId: "track.mario_kart_stadium",
    countsTowardStandings: true,
    context: {
      groupReference: {
        namespace: "producer_local_group",
        value: "private-live-group",
      },
      observedGroupLabel: "Synthetic Group",
    },
    placements: [
      {
        finishPosition: 1,
        participantReference: { namespace: "player", value: playerId },
        observedPlayerName: "Central Racer",
        characterId: "character.mario",
        scoring: { racePoints: 15, totalBeforeRace: 0, totalAfterRace: 15, rankAfterRace: 1 },
      },
      {
        finishPosition: 2,
        participantReference: {
          namespace: "unresolved_observation",
          value: "private-live-participant",
        },
        observedPlayerName: "Observed Racer",
        characterId: "character.luigi",
        scoring: { racePoints: 12, totalBeforeRace: 0, totalAfterRace: 12, rankAfterRace: 2 },
      },
    ],
    source: {
      kind: "tournament_live_capture",
      transport: "native_contract",
      localRecordId: `live-race-${revision}`,
    },
    timestamps: { createdAtMs: 1_900_000_000_000 + revision },
    evidence: [{
      kind: "race_score_screen",
      reference: "private-live-evidence",
      sha256: "55".repeat(32),
      mediaType: "image/png",
    }],
    verification: {
      status: "needs_review",
      issues: [{ code: "capture.synthetic_review", message: "Private review message" }],
    },
  };
}

integration("MySQL Tournament write repository integration", () => {
  let pool: Pool;
  let repository: MysqlTournamentWriteRepository;
  let service: TournamentRaceResultService;

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
    repository = new MysqlTournamentWriteRepository(pool);
    service = new TournamentRaceResultService(
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
       VALUES (?, 1, 'human', 'Synthetic Tournament MySQL Racer', 'active', 1, 1)`,
      [playerId],
    );
  });

  afterAll(async () => {
    if (pool === undefined) { return; }
    await pool.execute(
      `DELETE access_log FROM restricted_identity_access_log AS access_log
       INNER JOIN restricted_tournament_race_data AS restricted_data
         ON restricted_data.tournament_restricted_data_id =
            access_log.tournament_restricted_data_id
       INNER JOIN tournament_race_result_revisions AS revision_record
         ON revision_record.tournament_race_result_revision_id =
            restricted_data.tournament_race_result_revision_id
       INNER JOIN tournament_race_results AS result_record
         ON result_record.tournament_race_result_id = revision_record.tournament_race_result_id
       WHERE result_record.public_id = ?`,
      [raceResultId],
    );
    await pool.execute(
      `DELETE restricted_data FROM restricted_tournament_race_data AS restricted_data
       INNER JOIN tournament_race_result_revisions AS revision_record
         ON revision_record.tournament_race_result_revision_id =
            restricted_data.tournament_race_result_revision_id
       INNER JOIN tournament_race_results AS result_record
         ON result_record.tournament_race_result_id = revision_record.tournament_race_result_id
       WHERE result_record.public_id = ?`,
      [raceResultId],
    );
    await pool.execute(
      `DELETE placement FROM tournament_race_placements AS placement
       INNER JOIN tournament_race_result_revisions AS revision_record
         ON revision_record.tournament_race_result_revision_id =
            placement.tournament_race_result_revision_id
       INNER JOIN tournament_race_results AS result_record
         ON result_record.tournament_race_result_id = revision_record.tournament_race_result_id
       WHERE result_record.public_id = ?`,
      [raceResultId],
    );
    await pool.execute(
      `DELETE revision_record FROM tournament_race_result_revisions AS revision_record
       INNER JOIN tournament_race_results AS result_record
         ON result_record.tournament_race_result_id = revision_record.tournament_race_result_id
       WHERE result_record.public_id = ?`,
      [raceResultId],
    );
    await pool.execute("DELETE FROM tournament_race_results WHERE public_id = ?", [raceResultId]);
    await pool.execute("DELETE FROM players WHERE public_id = ?", [playerId]);
    await pool.end();
  });

  it("atomically persists ordered revisions, placements, and protected union rows", async () => {
    await service.submit(raceResult());
    await service.submit(raceResult(2));
    const [rows] = await pool.execute<any[]>(
      `SELECT COUNT(DISTINCT revision_record.tournament_race_result_revision_id) AS revisionCount,
              COUNT(DISTINCT placement.tournament_race_placement_id) AS placementCount,
              COUNT(DISTINCT restricted_data.tournament_restricted_data_id) AS restrictedCount
       FROM tournament_race_results AS result_record
       INNER JOIN tournament_race_result_revisions AS revision_record
         ON revision_record.tournament_race_result_id = result_record.tournament_race_result_id
       LEFT JOIN tournament_race_placements AS placement
         ON placement.tournament_race_result_revision_id =
            revision_record.tournament_race_result_revision_id
       LEFT JOIN restricted_tournament_race_data AS restricted_data
         ON restricted_data.tournament_race_result_revision_id =
            revision_record.tournament_race_result_revision_id
       WHERE result_record.public_id = ?`,
      [raceResultId],
    );
    expect(rows).toEqual([{ revisionCount: 2, placementCount: 4, restrictedCount: 8 }]);
    const [kinds] = await pool.execute<any[]>(
      `SELECT data_kind AS dataKind, COUNT(*) AS rowCount
       FROM restricted_tournament_race_data AS data
       INNER JOIN tournament_race_result_revisions AS revision
         ON revision.tournament_race_result_revision_id = data.tournament_race_result_revision_id
       INNER JOIN tournament_race_results AS result_record
         ON result_record.tournament_race_result_id = revision.tournament_race_result_id
       WHERE result_record.public_id = ?
       GROUP BY data_kind ORDER BY data_kind`, [raceResultId],
    );
    expect(kinds).toEqual([
      { dataKind: "context_reference", rowCount: 2 },
      { dataKind: "evidence_reference", rowCount: 2 },
      { dataKind: "participant_reference", rowCount: 2 },
      { dataKind: "verification_issue", rowCount: 2 },
    ]);
    const [protectedRows] = await pool.execute<any[]>(
      `SELECT data_kind AS dataKind, HEX(value_ciphertext) AS ciphertext
       FROM restricted_tournament_race_data
       WHERE tournament_race_result_revision_id = (
         SELECT MAX(tournament_race_result_revision_id)
         FROM tournament_race_result_revisions
       ) ORDER BY data_kind`,
    );
    expect(protectedRows).toEqual([
      { dataKind: "context_reference", ciphertext: "2223" },
      { dataKind: "evidence_reference", ciphertext: "3334" },
      { dataKind: "participant_reference", ciphertext: "1112" },
      { dataKind: "verification_issue", ciphertext: "4445" },
    ]);
  });

  it("reads an exact canonical revision only after all protected access audits commit", async () => {
    const accessedAtMs = 1_900_000_100_000;
    const readService = new TournamentRevisionReadService(
      new MysqlTournamentReadRepository(pool),
      new DeterministicReader(),
      { nowMs: () => accessedAtMs },
    );
    const result = await readService.readRevision(
      { role: "administrator", userAccountId: "user_account.synthetic_admin" },
      raceResultId,
      2,
      "administrative_review",
    );
    expect(result).toEqual(raceResult(2));

    const [auditRows] = await pool.execute<any[]>(
      `SELECT access_log.resource_type AS resourceType,
              access_log.accessor_type AS accessorType,
              access_log.accessor_reference AS accessorReference,
              access_log.purpose_code AS purposeCode,
              access_log.accessed_at_ms AS accessedAtMs,
              restricted_data.data_kind AS dataKind
       FROM restricted_identity_access_log AS access_log
       INNER JOIN restricted_tournament_race_data AS restricted_data
         ON restricted_data.tournament_restricted_data_id =
            access_log.tournament_restricted_data_id
       INNER JOIN tournament_race_result_revisions AS revision_record
         ON revision_record.tournament_race_result_revision_id =
            restricted_data.tournament_race_result_revision_id
       INNER JOIN tournament_race_results AS result_record
         ON result_record.tournament_race_result_id =
            revision_record.tournament_race_result_id
       WHERE result_record.public_id = ? AND revision_record.revision_number = 2
       ORDER BY restricted_data.data_kind`,
      [raceResultId],
    );
    expect(auditRows).toEqual([
      "context_reference",
      "evidence_reference",
      "participant_reference",
      "verification_issue",
    ].map((dataKind) => ({
      resourceType: "tournament_restricted_data",
      accessorType: "administrator",
      accessorReference: "user_account.synthetic_admin",
      purposeCode: "administrative_review",
      accessedAtMs,
      dataKind,
    })));
  });

  it("rejects duplicate revision retry without adding rows", async () => {
    await expect(service.submit(raceResult(2))).rejects.toMatchObject({
      code: "revision_conflict",
    });
    const [rows] = await pool.execute<any[]>(
      `SELECT COUNT(*) AS revisionCount
       FROM tournament_race_result_revisions AS revision_record
       INNER JOIN tournament_race_results AS result_record
         ON result_record.tournament_race_result_id = revision_record.tournament_race_result_id
       WHERE result_record.public_id = ?`,
      [raceResultId],
    );
    expect(rows).toEqual([{ revisionCount: 2 }]);
  });

  it("rolls back a stable result when later work fails", async () => {
    const rollbackId = "tournament_race_result.synthetic_mysql_rollback";
    await expect(repository.transaction(async (transaction) => {
      await transaction.insertRaceResult(rollbackId, 1_900_000_010_000);
      throw new Error("synthetic placement failure");
    })).rejects.toThrow("synthetic placement failure");
    const [rows] = await pool.execute<any[]>(
      "SELECT COUNT(*) AS rowCount FROM tournament_race_results WHERE public_id = ?",
      [rollbackId],
    );
    expect(rows).toEqual([{ rowCount: 0 }]);
  });
});
