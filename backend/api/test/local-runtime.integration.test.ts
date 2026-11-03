import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

import {
  createLocalApiRuntime,
  loadLocalApiRuntimeConfig,
  type LocalApiRuntime,
} from "../src/composition/local-runtime.js";
import { AuthenticationSubjectHmacProtector } from
  "../src/authentication/authentication-subject-hmac-protector.js";

const integrationEnabled = process.env["MK8DX_MYSQL_INTEGRATION"] === "1";
const integration = integrationEnabled ? describe : describe.skip;
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const playerId = "player.synthetic_local_runtime_01";
const accountId = "user_account.synthetic_local_runtime_01";
const claimId = "player_claim.synthetic_local_runtime_01";
const bindingId = "restricted_auth_binding.synthetic_local_runtime_01";
const submissionId = "user_submission.time.SYNTHETICRUNTIMEHTTP01";
const raceResultId = "tournament_race_result.SYNTHETICRUNTIMEHTTP01";
const key = (byte: number) => Buffer.alloc(32, byte).toString("base64");

integration("local API runtime integration", () => {
  let administrationPool: Pool;
  let runtime: LocalApiRuntime;
  let providerSubjectEnabled = false;
  let webSubmissionId = "";

  beforeAll(async () => {
    const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
    if (!/^[a-z][a-z0-9_]*(?:_test|_contract)$/.test(database)) {
      throw new Error("integration database must be an explicit _test/_contract schema");
    }
    const host = process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1";
    const port = process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306";
    const user = process.env["MK8DX_MYSQL_TEST_USER"] ?? "mk8dx_test";
    const password = process.env["MK8DX_MYSQL_TEST_PASSWORD"] ?? "";
    const poolOptions: PoolOptions = {
      host,
      port: Number(port),
      user,
      password,
      database,
      connectionLimit: 1,
      multipleStatements: false,
      namedPlaceholders: false,
    };
    administrationPool = mysql.createPool(poolOptions);
    await administrationPool.execute(
      `INSERT INTO players
       (public_id, revision, player_kind, display_name, record_status,
        created_at_ms, updated_at_ms)
       VALUES (?, 1, 'human', 'Synthetic Local Runtime Racer', 'active', 1, 1)`,
      [playerId],
    );
    await administrationPool.execute(
      `INSERT INTO player_username_history
       (player_id, sequence_number, username_value, comparison_key,
        allocated_at_ms, released_at_ms)
       SELECT player_id, 1, 'syntheticruntime', ?, 1, NULL
       FROM players WHERE public_id = ?`,
      [Buffer.from("syntheticruntime"), playerId],
    );
    const authenticationKeys = {
      lookupHmacKey: Buffer.alloc(32, 5),
      lookupKeyVersion: "auth-lookup-v1",
    } as const;
    const protectedSubject = new AuthenticationSubjectHmacProtector(
      authenticationKeys,
    ).protectVerifiedSubject("synthetic_runtime", "synthetic-runtime-subject");
    await administrationPool.execute(
      `INSERT INTO user_accounts (
         public_id, revision, privacy_class, account_status,
         created_at_ms, updated_at_ms
       ) VALUES (?, 1, 'private', 'active', 1, 1)`,
      [accountId],
    );
    await administrationPool.execute(
      `INSERT INTO player_claims (
         public_id, revision, privacy_class, player_id, user_account_id,
         claim_status, dispute_status, created_at_ms, updated_at_ms
       )
       SELECT ?, 1, 'private', player.player_id, account.user_account_id,
              'verified', 'none', 1, 1
       FROM players AS player
       CROSS JOIN user_accounts AS account
       WHERE player.public_id = ? AND account.public_id = ?`,
      [claimId, playerId, accountId],
    );
    await administrationPool.execute(
      `INSERT INTO restricted_authentication_bindings (
         public_id, revision, privacy_class, user_account_id, issuer_key,
         subject_lookup_hmac, lookup_key_version, binding_status,
         bound_at_ms, ended_at_ms, updated_at_ms
       )
       SELECT ?, 1, 'private', account.user_account_id, ?, ?, ?,
              'active', 1, NULL, 1
       FROM user_accounts AS account WHERE account.public_id = ?`,
      [
        bindingId,
        protectedSubject.issuerKey,
        protectedSubject.subjectLookupHmac,
        protectedSubject.lookupKeyVersion,
        accountId,
      ],
    );
    await administrationPool.execute(
      `INSERT INTO restricted_authentication_binding_lifecycle (
         authentication_binding_id, sequence_number, event_type, actor_type,
         actor_user_account_id, actor_reference, reason_code, occurred_at_ms
       )
       SELECT authentication_binding_id, 1, 'binding_created',
              'authentication', NULL, 'authentication_provisioner.synthetic_integration',
              NULL, 1
       FROM restricted_authentication_bindings WHERE public_id = ?`,
      [bindingId],
    );
    runtime = await createLocalApiRuntime(loadLocalApiRuntimeConfig({
      MK8DX_LOCAL_MYSQL_HOST: host,
      MK8DX_LOCAL_MYSQL_PORT: port,
      MK8DX_LOCAL_MYSQL_USER: user,
      MK8DX_LOCAL_MYSQL_PASSWORD: password,
      MK8DX_LOCAL_MYSQL_DATABASE: database,
      MK8DX_LOCAL_MYSQL_CONNECTION_LIMIT: "2",
      MK8DX_LOCAL_AUTHENTICATION_LOOKUP_HMAC_KEY_BASE64: key(5),
      MK8DX_LOCAL_AUTHENTICATION_LOOKUP_KEY_VERSION: "auth-lookup-v1",
      MK8DX_LOCAL_SCHEMA9_CATALOG_PATH:
        `${repoRoot}packages/assets/schema9-asset-catalog-v1.json`,
      MK8DX_LOCAL_TIME_TRIAL_ENCRYPTION_KEY_BASE64: key(1),
      MK8DX_LOCAL_TIME_TRIAL_ENCRYPTION_KEY_VERSION: "tt-enc-v1",
      MK8DX_LOCAL_TIME_TRIAL_LOOKUP_HMAC_KEY_BASE64: key(2),
      MK8DX_LOCAL_TIME_TRIAL_LOOKUP_KEY_VERSION: "tt-lookup-v1",
      MK8DX_LOCAL_TOURNAMENT_ENCRYPTION_KEY_BASE64: key(3),
      MK8DX_LOCAL_TOURNAMENT_ENCRYPTION_KEY_VERSION: "tournament-enc-v1",
      MK8DX_LOCAL_TOURNAMENT_LOOKUP_HMAC_KEY_BASE64: key(4),
      MK8DX_LOCAL_TOURNAMENT_LOOKUP_KEY_VERSION: "tournament-lookup-v1",
    }), async () => providerSubjectEnabled
      ? {
          issuerKey: "synthetic_runtime",
          subject: "synthetic-runtime-subject",
        }
      : null, {
      timeTrialSubmissionAuthorizer: {
        authorize: async (context) =>
          context.actor.role === "account" && context.sourceKind === "android_manual",
      },
      tournamentSubmissionAuthorizer: {
        authorize: async (context) =>
          context.actor.role === "anonymous" &&
          context.producerKind === "tournament_recorded_video",
      },
      webManual: {
        producerVersion: "timetrials-web-local-integration",
        csrfKeys: {
          activeKeyVersion: "csrf-v1",
          keys: { "csrf-v1": Uint8Array.from(Buffer.alloc(32, 6)) },
        },
      },
    });
  });

  afterAll(async () => {
    if (runtime !== undefined) { await runtime.close(); }
    if (administrationPool === undefined) { return; }
    await administrationPool.execute(
      `DELETE lifecycle FROM time_trial_publication_lifecycle AS lifecycle
       INNER JOIN time_trial_publications AS publication
         ON publication.time_trial_publication_id = lifecycle.time_trial_publication_id
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = publication.time_trial_submission_id
       WHERE submission.public_id IN (?, ?)`,
      [submissionId, webSubmissionId],
    );
    await administrationPool.execute(
      `DELETE publication FROM time_trial_publications AS publication
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = publication.time_trial_submission_id
       WHERE submission.public_id IN (?, ?)`,
      [submissionId, webSubmissionId],
    );
    await administrationPool.execute(
      `DELETE lap
       FROM time_trial_laps AS lap
       INNER JOIN time_trial_submission_revisions AS revision
         ON revision.time_trial_submission_revision_id = lap.time_trial_submission_revision_id
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = revision.time_trial_submission_id
       WHERE submission.public_id IN (?, ?)`,
      [submissionId, webSubmissionId],
    );
    await administrationPool.execute(
      `DELETE revision
       FROM time_trial_submission_revisions AS revision
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = revision.time_trial_submission_id
       WHERE submission.public_id IN (?, ?)`,
      [submissionId, webSubmissionId],
    );
    await administrationPool.execute(
      "DELETE FROM time_trial_submissions WHERE public_id IN (?, ?)",
      [submissionId, webSubmissionId],
    );
    await administrationPool.execute(
      `DELETE placement
       FROM tournament_race_placements AS placement
       INNER JOIN tournament_race_result_revisions AS revision
         ON revision.tournament_race_result_revision_id =
            placement.tournament_race_result_revision_id
       INNER JOIN tournament_race_results AS result_record
         ON result_record.tournament_race_result_id = revision.tournament_race_result_id
       WHERE result_record.public_id = ?`,
      [raceResultId],
    );
    await administrationPool.execute(
      `DELETE revision
       FROM tournament_race_result_revisions AS revision
       INNER JOIN tournament_race_results AS result_record
         ON result_record.tournament_race_result_id = revision.tournament_race_result_id
       WHERE result_record.public_id = ?`,
      [raceResultId],
    );
    await administrationPool.execute(
      "DELETE FROM tournament_race_results WHERE public_id = ?",
      [raceResultId],
    );
    await administrationPool.execute(
      `DELETE log
       FROM restricted_identity_access_log AS log
       INNER JOIN restricted_authentication_bindings AS binding
         ON binding.authentication_binding_id = log.authentication_binding_id
       WHERE binding.public_id = ?`,
      [bindingId],
    );
    await administrationPool.execute(
      `DELETE lifecycle
       FROM restricted_authentication_binding_lifecycle AS lifecycle
       INNER JOIN restricted_authentication_bindings AS binding
         ON binding.authentication_binding_id = lifecycle.authentication_binding_id
       WHERE binding.public_id = ?`,
      [bindingId],
    );
    await administrationPool.execute(
      "DELETE FROM restricted_authentication_bindings WHERE public_id = ?",
      [bindingId],
    );
    await administrationPool.execute(
      "DELETE FROM player_claims WHERE public_id = ?",
      [claimId],
    );
    await administrationPool.execute(
      "DELETE FROM user_accounts WHERE public_id = ?",
      [accountId],
    );
    await administrationPool.execute(
      `DELETE username_record FROM player_username_history AS username_record
       INNER JOIN players AS player ON player.player_id = username_record.player_id
       WHERE player.public_id = ?`,
      [playerId],
    );
    await administrationPool.execute("DELETE FROM players WHERE public_id = ?", [playerId]);
    await administrationPool.end();
  });

  it("serves the allow-listed public Player projection through composed MySQL", async () => {
    const response = await runtime.app.inject({
      method: "GET",
      url: `/v1/players/${playerId}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      playerId,
      username: { value: "syntheticruntime" },
      displayName: "Synthetic Local Runtime Racer",
      timeTrialModePreference: "all",
    });
  });

  it("reports ready only through the composed MySQL probe", async () => {
    const response = await runtime.app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ready" });
  });

  it("protects a verified provider subject and resolves only its bound account", async () => {
    let response = await runtime.app.inject({
      method: "GET",
      url: `/v1/user-accounts/${accountId}`,
    });
    expect(response.statusCode).toBe(404);

    providerSubjectEnabled = true;
    response = await runtime.app.inject({
      method: "GET",
      url: `/v1/user-accounts/${accountId}`,
    });
    providerSubjectEnabled = false;
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ userAccountId: accountId, accountStatus: "active" });
    const [auditRows] = await administrationPool.execute<any[]>(
      `SELECT log.accessor_type AS accessorType, log.purpose_code AS purposeCode,
              binding.public_id AS bindingId
       FROM restricted_identity_access_log AS log
       INNER JOIN restricted_authentication_bindings AS binding
         ON binding.authentication_binding_id = log.authentication_binding_id
       WHERE binding.public_id = ?`,
      [bindingId],
    );
    expect(auditRows).toEqual([{
      accessorType: "authentication",
      purposeCode: "actor_resolution",
      bindingId,
    }]);
  });

  it("persists a policy-authorized canonical Time Trial through HTTP", async () => {
    providerSubjectEnabled = true;
    try {
    const response = await runtime.app.inject({
      method: "POST",
      url: "/v1/time-trial-submissions",
      payload: {
        schemaVersion: "mk8dx.time-trial-submission.v1",
        submissionId,
        revision: 1,
        mode: 200,
        trackId: "track.water_park",
        totalTimeMs: 143_000,
        laps: [],
        playerReference: { namespace: "player", value: playerId },
        source: { kind: "android_manual", producerVersion: "synthetic-integration" },
        timestamps: { createdAtMs: 1_786_901_020_000 },
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ submissionId, revision: 1 });
    const [rows] = await administrationPool.execute<any[]>(
      `SELECT submission.public_id AS submissionId,
              revision.revision_number AS revisionNumber,
              player.public_id AS playerId
       FROM time_trial_submissions AS submission
       INNER JOIN time_trial_submission_revisions AS revision
         ON revision.time_trial_submission_id = submission.time_trial_submission_id
       INNER JOIN players AS player ON player.player_id = revision.player_id
       WHERE submission.public_id = ?`,
      [submissionId],
    );
    expect(rows).toEqual([{ submissionId, revisionNumber: 1, playerId }]);
    } finally {
      providerSubjectEnabled = false;
    }
  });

  it("bootstraps and publishes web manual V1 through verified provider, claim, and CSRF", async () => {
    providerSubjectEnabled = true;
    try {
      const bootstrapResponse = await runtime.app.inject({
        method: "GET",
        url: "/v1/time-trial-submissions/manual-bootstrap" +
          "?trackId=track.mario_kart_stadium",
      });
      expect(bootstrapResponse.statusCode).toBe(200);
      const bootstrap = bootstrapResponse.json();
      expect(bootstrap.context).toMatchObject({
        schemaVersion: "mk8dx.web-manual-context.v1",
        revision: 1,
        trackId: "track.mario_kart_stadium",
        playerReference: { namespace: "player", value: playerId },
        producer: { version: "timetrials-web-local-integration" },
      });
      webSubmissionId = bootstrap.context.submissionId;

      const csrfResponse = await runtime.app.inject({
        method: "GET",
        url: "/v1/session/csrf",
      });
      expect(csrfResponse.statusCode).toBe(200);
      const csrf = csrfResponse.json();
      expect(csrf.headerName).toBe("X-MK8DX-CSRF");

      const response = await runtime.app.inject({
        method: "POST",
        url: "/v1/time-trial-submissions",
        headers: { [csrf.headerName]: csrf.value },
        payload: {
          schemaVersion: "mk8dx.time-trial-submission.v1",
          submissionId: bootstrap.context.submissionId,
          revision: bootstrap.context.revision,
          mode: 150,
          trackId: bootstrap.context.trackId,
          totalTimeMs: 83_456,
          laps: [],
          playerReference: bootstrap.context.playerReference,
          source: {
            kind: "web_manual",
            producerVersion: bootstrap.context.producer.version,
            localRecordId: bootstrap.context.producer.localRecordId,
          },
          timestamps: bootstrap.context.timestamps,
        },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({
        submissionId: webSubmissionId,
        revision: 1,
      });
      const [rows] = await administrationPool.execute<any[]>(
        `SELECT submission.public_id AS submissionId,
                player.public_id AS playerId,
                revision.source_kind AS sourceKind
         FROM time_trial_submissions AS submission
         INNER JOIN time_trial_submission_revisions AS revision
           ON revision.time_trial_submission_id = submission.time_trial_submission_id
         INNER JOIN players AS player ON player.player_id = revision.player_id
         WHERE submission.public_id = ?`,
        [webSubmissionId],
      );
      expect(rows).toEqual([{
        submissionId: webSubmissionId,
        playerId,
        sourceKind: "web_manual",
      }]);
    } finally {
      providerSubjectEnabled = false;
    }
  });

  it("persists a policy-authorized canonical Tournament result through HTTP", async () => {
    const response = await runtime.app.inject({
      method: "POST",
      url: "/v1/tournament-race-results",
      payload: {
        schemaVersion: "mk8dx.tournament-race-result.v1",
        raceResultId,
        revision: 1,
        raceNumber: 1,
        scoringSegment: 1,
        mode: 150,
        trackId: "track.mario_kart_stadium",
        countsTowardStandings: true,
        placements: [{
          finishPosition: 1,
          participantReference: { namespace: "player", value: playerId },
          scoring: {
            racePoints: 15,
            totalBeforeRace: 0,
            totalAfterRace: 15,
            rankAfterRace: 1,
          },
        }],
        source: {
          kind: "tournament_recorded_video",
          transport: "native_contract",
          producerVersion: "synthetic-integration",
        },
        timestamps: { createdAtMs: 1_786_901_020_000 },
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ raceResultId, revision: 1 });
    const [rows] = await administrationPool.execute<any[]>(
      `SELECT result_record.public_id AS raceResultId,
              revision.revision_number AS revisionNumber,
              placement.finish_position AS finishPosition,
              player.public_id AS playerId
       FROM tournament_race_results AS result_record
       INNER JOIN tournament_race_result_revisions AS revision
         ON revision.tournament_race_result_id = result_record.tournament_race_result_id
       INNER JOIN tournament_race_placements AS placement
         ON placement.tournament_race_result_revision_id =
            revision.tournament_race_result_revision_id
       INNER JOIN players AS player ON player.player_id = placement.player_id
       WHERE result_record.public_id = ?`,
      [raceResultId],
    );
    expect(rows).toEqual([{ raceResultId, revisionNumber: 1, finishPosition: 1, playerId }]);
  });
});
