import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

import {
  TimeTrialProtectedValueAdapter,
  TournamentProtectedValueAdapter,
  type ProtectedValueKeyMaterial,
} from "../src/security/protected-value-adapters.js";
import { rotateProtectedValues } from "../src/security/protected-value-rotation.js";
import { MysqlTimeTrialWriteRepository } from
  "../src/timetrials/mysql-time-trial-write-repository.js";
import {
  TimeTrialSubmissionService,
  type TimeTrialAssetCatalog,
  type TimeTrialSubmissionV1,
} from "../src/timetrials/submission-service.js";
import { MysqlTournamentWriteRepository } from
  "../src/tournaments/mysql-tournament-write-repository.js";
import {
  TournamentRaceResultService,
  type TournamentAssetCatalog,
} from "../src/tournaments/race-result-service.js";
import type { TournamentRaceResultV1 } from
  "../src/tournaments/race-result-validation.js";

const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" ? describe : describe.skip;
const playerId = "player.synthetic_protected_rotation";

class AcceptingCatalog implements TimeTrialAssetCatalog, TournamentAssetCatalog {
  async validateReferences(): Promise<readonly string[]> { return []; }
}

function keys(byte: number, version: string): ProtectedValueKeyMaterial {
  return {
    encryptionKey: new Uint8Array(32).fill(byte),
    encryptionKeyVersion: `${version}_encryption`,
    lookupHmacKey: new Uint8Array(32).fill(byte + 32),
    lookupKeyVersion: `${version}_lookup`,
  };
}

const oldTimeTrial = keys(1, "tt_old");
const newTimeTrial = keys(2, "tt_new");
const oldTournament = keys(3, "tournament_old");
const newTournament = keys(4, "tournament_new");

function timeTrial(): TimeTrialSubmissionV1 {
  return {
    schemaVersion: "mk8dx.time-trial-submission.v1",
    submissionId: "user_submission.time.SYNTHETICROTATION01",
    revision: 1,
    mode: 150,
    trackId: "track.mario_kart_stadium",
    totalTimeMs: 100_000,
    laps: [],
    playerReference: { namespace: "producer_local_profile", value: "private-profile" },
    source: { kind: "android_scan", localRecordId: "rotation-tt" },
    timestamps: { createdAtMs: 1_900_000_000_000 },
    evidence: [{ kind: "screenshot", reference: "private/tt.png" }],
  };
}

function tournament(): TournamentRaceResultV1 {
  return {
    schemaVersion: "mk8dx.tournament-race-result.v1",
    raceResultId: "tournament_race_result.synthetic_rotation",
    revision: 1,
    raceNumber: 1,
    scoringSegment: 1,
    mode: 150,
    trackId: "track.mario_kart_stadium",
    countsTowardStandings: true,
    context: {
      groupReference: { namespace: "producer_local_group", value: "private-group" },
    },
    placements: [
      {
        finishPosition: 1,
        participantReference: { namespace: "player", value: playerId },
        scoring: { racePoints: 15, totalBeforeRace: 0, totalAfterRace: 15, rankAfterRace: 1 },
      },
      {
        finishPosition: 2,
        participantReference: { namespace: "unresolved_observation", value: "private-racer" },
        scoring: { racePoints: 12, totalBeforeRace: 0, totalAfterRace: 12, rankAfterRace: 2 },
      },
    ],
    source: { kind: "tournament_recorded_video", transport: "native_contract" },
    timestamps: { createdAtMs: 1_900_000_001_000 },
    evidence: [{ kind: "video", reference: "private/race.mp4" }],
    verification: {
      status: "needs_review",
      issues: [{ code: "rotation.review", message: "private review" }],
    },
  };
}

integration("protected-value staged rotation", () => {
  let pool: Pool;

  beforeAll(async () => {
    const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
    if (!/^[a-z][a-z0-9_]*_rotation_contract$/.test(database)) {
      throw new Error("rotation integration requires an explicit _rotation_contract schema");
    }
    const options: PoolOptions = {
      host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
      port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306"),
      user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "root",
      database,
      connectionLimit: 2,
    };
    const password = process.env["MK8DX_MYSQL_TEST_PASSWORD"];
    if (password !== undefined) { options.password = password; }
    pool = mysql.createPool(options);
    await pool.execute(
      `INSERT INTO players
       (public_id, revision, player_kind, display_name, record_status,
        created_at_ms, updated_at_ms)
       VALUES (?, 1, 'human', 'Rotation Racer', 'active', 1, 1)`,
      [playerId],
    );
    const legacyProtector = new TimeTrialProtectedValueAdapter(oldTimeTrial);
    const legacy = await legacyProtector.protectParticipantReference(
      "legacy_firebase_user",
      "private-firebase-owner",
    );
    await pool.execute(
      `INSERT INTO restricted_legacy_identity_identifiers
       (source_system, identifier_kind, lookup_hash, lookup_key_version,
        identifier_ciphertext, encryption_key_version, linked_player_id,
        linked_user_account_id, created_at_ms, last_accessed_at_ms)
       SELECT 'timetrials_firebase', 'firebase_auth_uid', ?, ?, ?, ?,
              player_id, NULL, 1, NULL
       FROM players WHERE public_id = ?`,
      [Buffer.from(legacy.lookupHmac), legacy.lookupKeyVersion,
        Buffer.from(legacy.ciphertext), legacy.encryptionKeyVersion, playerId],
    );
    const catalog = new AcceptingCatalog();
    await new TimeTrialSubmissionService(
      new MysqlTimeTrialWriteRepository(pool),
      catalog,
      new TimeTrialProtectedValueAdapter(oldTimeTrial),
    ).submit(timeTrial());
    await new TournamentRaceResultService(
      new MysqlTournamentWriteRepository(pool),
      catalog,
      new TournamentProtectedValueAdapter(oldTournament),
    ).submit(tournament());
  });

  afterAll(async () => { await pool?.end(); });

  it("dry-runs, applies, verifies new-only decryption, and becomes idempotent", async () => {
    const rotationKeys = {
      timeTrial: {
        active: newTimeTrial,
        decrypt: {
          [oldTimeTrial.encryptionKeyVersion]: oldTimeTrial.encryptionKey,
          [newTimeTrial.encryptionKeyVersion]: newTimeTrial.encryptionKey,
        },
      },
      tournament: {
        active: newTournament,
        decrypt: {
          [oldTournament.encryptionKeyVersion]: oldTournament.encryptionKey,
          [newTournament.encryptionKeyVersion]: newTournament.encryptionKey,
        },
      },
    };
    const dryRun = await rotateProtectedValues(pool, rotationKeys, false);
    expect(dryRun).toMatchObject({
      mode: "dry_run",
      rotated: { timeTrialParticipants: 1, timeTrialEvidence: 1, tournamentValues: 4 },
    });
    const applied = await rotateProtectedValues(pool, rotationKeys, true);
    expect(applied).toMatchObject({ mode: "apply", rotated: dryRun.rotated });

    const [versions] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT encryption_key_version AS version
       FROM restricted_legacy_identity_identifiers
       UNION ALL SELECT encryption_key_version FROM restricted_time_trial_participant_references
       UNION ALL SELECT encryption_key_version FROM restricted_time_trial_evidence
       UNION ALL SELECT encryption_key_version FROM restricted_tournament_race_data`,
    );
    expect(new Set(versions.map((row) => String(row["version"])))).toEqual(new Set([
      newTimeTrial.encryptionKeyVersion,
      newTournament.encryptionKeyVersion,
    ]));
    const repeated = await rotateProtectedValues(pool, rotationKeys, true);
    expect(repeated.rotated).toEqual({
      legacyTimeTrialIdentifiers: 0,
      timeTrialParticipants: 0,
      timeTrialEvidence: 0,
      tournamentValues: 0,
    });
  });
});
