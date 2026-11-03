import Fastify, { type FastifyInstance } from "fastify";
import { getMigrations } from "better-auth/db/migration";
import mysql, { type Pool, type PoolOptions, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  MK8DX_ANDROID_CLIENT_ID,
  MK8DX_DESKTOP_CLIENT_ID,
  createEmbeddedPasswordlessAuth,
  createEmbeddedVerifiedSubjectResolver,
  registerEmbeddedAuthRoutes,
  type PasswordlessMagicLink,
} from "../src/authentication/embedded-passwordless-auth.js";
import { MysqlEmbeddedAuthAuditSink } from
  "../src/authentication/mysql-embedded-auth-audit-sink.js";
import { createPasswordlessHostedRuntime } from
  "../src/composition/hosted-runtime.js";

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
const baseUrl = "https://mk8dx-auth.integration.test";
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

integration("embedded passwordless auth MySQL integration", () => {
  let pool: Pool;
  let app: FastifyInstance;
  const links: PasswordlessMagicLink[] = [];

  async function clean(): Promise<void> {
    for (const table of [
      "mk8dx_auth_audit_event",
      "mk8dx_auth_rate_limit",
      "mk8dx_auth_device_code",
      "mk8dx_auth_verification",
      "mk8dx_auth_account",
      "mk8dx_auth_session",
      "mk8dx_auth_user",
    ]) {
      await pool.execute(`DELETE FROM ${table}`);
    }
  }

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
      timezone: "Z",
      connectionLimit: 2,
      multipleStatements: false,
      namedPlaceholders: false,
    };
    const password = process.env["MK8DX_MYSQL_TEST_PASSWORD"];
    if (password !== undefined) { options.password = password; }
    pool = mysql.createPool(options);
    const [migrations] = await pool.execute<RowDataPacket[]>(
      "SELECT migration_version FROM schema_migrations ORDER BY migration_version",
    );
    expect(migrations).toHaveLength(pinnedMigrationCatalogLength);
    await clean();

    const auth = createEmbeddedPasswordlessAuth(
      pool,
      {
        baseUrl,
        production: true,
        trustedOrigins: [baseUrl],
        secrets: [{
          version: 1,
          value: "n1DLRIGl7jpbMj99RFVrBcMeOrBAvccvREek3FWYjzk=",
        }],
        nativeClientIds: [MK8DX_ANDROID_CLIENT_ID, MK8DX_DESKTOP_CLIENT_ID],
        clientIpHeaders: ["x-real-ip"],
        trustedProxyAddresses: ["127.0.0.1"],
      },
      { async sendMagicLink(message) { links.push(message); } },
      new MysqlEmbeddedAuthAuditSink(pool, { nowMs: () => 2_000_000_000_000 }),
    );
    const schemaDiff = await getMigrations(auth.options);
    expect(schemaDiff.toBeCreated).toEqual([]);
    expect(schemaDiff.toBeAdded).toEqual([]);
    expect(schemaDiff.toBeAddedIndexes).toEqual([]);
    app = Fastify({ logger: false });
    await registerEmbeddedAuthRoutes(app, auth, baseUrl);
    const resolve = createEmbeddedVerifiedSubjectResolver(auth);
    app.get("/integration/subject", async (request, reply) => {
      const subject = await resolve(request);
      return subject === null ? reply.code(401).send() : reply.send(subject);
    });
    await app.ready();
  });

  afterAll(async () => {
    if (app !== undefined) { await app.close(); }
    if (pool !== undefined) {
      await clean();
      await pool.end();
    }
  });

  it("persists hashed one-use login, secure session, device bearer, and audit", async () => {
    const headers = {
      origin: baseUrl,
      "content-type": "application/json",
      "x-real-ip": "203.0.113.27",
    };
    const requested = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/magic-link",
      headers,
      payload: { email: "mysql-player@example.test", callbackURL: "/" },
    });
    expect(requested.statusCode).toBe(200);
    const link = links.at(-1);
    if (link === undefined) { throw new Error("magic link missing"); }
    const parsed = new URL(link.url);
    const rawToken = parsed.searchParams.get("token");
    if (rawToken === null) { throw new Error("token missing"); }
    const [verification] = await pool.execute<RowDataPacket[]>(
      "SELECT identifier, value FROM mk8dx_auth_verification",
    );
    expect(verification).toHaveLength(1);
    expect(verification[0]!["identifier"]).not.toBe(rawToken);
    expect(JSON.stringify(verification)).not.toContain(rawToken);

    const redeemed = await app.inject({
      method: "GET",
      url: `${parsed.pathname}${parsed.search}`,
      headers: { "x-real-ip": "203.0.113.27" },
    });
    expect(redeemed.statusCode).toBe(302);
    const setCookie = redeemed.headers["set-cookie"];
    const cookieLine = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (typeof cookieLine !== "string") { throw new Error("cookie missing"); }
    const cookie = cookieLine.split(";", 1)[0]!;

    const device = await app.inject({
      method: "POST",
      url: "/api/auth/device/code",
      headers,
      payload: { client_id: MK8DX_ANDROID_CLIENT_ID },
    });
    const codes = device.json<{ device_code: string; user_code: string }>();
    expect(device.statusCode).toBe(200);
    const verify = await app.inject({
      method: "GET",
      url: `/api/auth/device?user_code=${codes.user_code}`,
      headers: { cookie, "x-real-ip": "203.0.113.27" },
    });
    expect(verify.statusCode).toBe(200);
    const approve = await app.inject({
      method: "POST",
      url: "/api/auth/device/approve",
      headers: { ...headers, cookie },
      payload: { userCode: codes.user_code },
    });
    expect(approve.statusCode).toBe(200);
    const token = await app.inject({
      method: "POST",
      url: "/api/auth/device/token",
      headers,
      payload: {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: codes.device_code,
        client_id: MK8DX_ANDROID_CLIENT_ID,
      },
    });
    expect(token.statusCode).toBe(200);
    const bearer = token.json<{ access_token: string }>().access_token;
    const subject = await app.inject({
      method: "GET",
      url: "/integration/subject",
      headers: {
        authorization: `Bearer ${bearer}`,
        "x-real-ip": "203.0.113.27",
      },
    });
    expect(subject.statusCode).toBe(200);
    expect(subject.body).not.toContain("mysql-player@example.test");
    expect(subject.body).not.toContain(bearer);

    const [audit] = await pool.execute<RowDataPacket[]>(
      `SELECT event_kind, subject_id, session_id, client_id
       FROM mk8dx_auth_audit_event ORDER BY auth_audit_event_id`,
    );
    expect(audit.map((row) => row["event_kind"])).toEqual([
      "auth_user_created",
      "auth_session_created",
      "device_authorization_requested",
      "auth_session_created",
    ]);
    expect(JSON.stringify(audit)).not.toContain("mysql-player@example.test");
    expect(JSON.stringify(audit)).not.toContain(rawToken);
    expect(JSON.stringify(audit)).not.toContain(bearer);
  });

  it("mounts auth and provisions a separate UserAccount in the hosted composition", async () => {
    await clean();
    const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
    const delivered: PasswordlessMagicLink[] = [];
    const hosted = await createPasswordlessHostedRuntime({
      core: {
        mysql: {
          host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
          port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306"),
          user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "mk8dx_test",
          password: process.env["MK8DX_MYSQL_TEST_PASSWORD"] ?? "",
          database,
          connectionLimit: 2,
        },
        schema9CatalogPath:
          `${repoRoot}packages/assets/schema9-asset-catalog-v1.json`,
        authenticationKeys: {
          lookupHmacKey: Buffer.alloc(32, 11),
          lookupKeyVersion: "hosted-auth-v1",
        },
        timeTrialKeys: {
          encryptionKey: Buffer.alloc(32, 12),
          encryptionKeyVersion: "hosted-tt-enc-v1",
          lookupHmacKey: Buffer.alloc(32, 13),
          lookupKeyVersion: "hosted-tt-lookup-v1",
        },
        timeTrialDecryptionKeys: { "hosted-tt-enc-v1": Buffer.alloc(32, 12) },
        tournamentKeys: {
          encryptionKey: Buffer.alloc(32, 14),
          encryptionKeyVersion: "hosted-tournament-enc-v1",
          lookupHmacKey: Buffer.alloc(32, 15),
          lookupKeyVersion: "hosted-tournament-lookup-v1",
        },
        tournamentDecryptionKeys: {
          "hosted-tournament-enc-v1": Buffer.alloc(32, 14),
        },
      },
      authentication: {
        baseUrl,
        production: true,
        trustedOrigins: [baseUrl],
        secrets: [{
          version: 1,
          value: "n1DLRIGl7jpbMj99RFVrBcMeOrBAvccvREek3FWYjzk=",
        }],
        nativeClientIds: [MK8DX_ANDROID_CLIENT_ID, MK8DX_DESKTOP_CLIENT_ID],
        clientIpHeaders: ["x-real-ip"],
        trustedProxyAddresses: ["127.0.0.1"],
      },
      smtp: {
        host: "smtp.example.test",
        port: 465,
        secure: true,
        username: "synthetic-user",
        password: "synthetic-password",
        fromAddress: "auth@example.test",
        allowedLinkOrigin: baseUrl,
      },
      webManual: {
        producerVersion: "timetrials-web-hosted-integration",
        csrfKeys: {
          activeKeyVersion: "hosted-csrf-v1",
          keys: { "hosted-csrf-v1": Buffer.alloc(32, 16) },
        },
      },
    }, () => ({
      async verify() {},
      async sendMagicLink(message) { delivered.push(message); },
      close() {},
    }));
    let accountId = "";
    let bindingId = "";
    const playerId = "player.synthetic_hosted_native_01";
    const claimId = "player_claim.synthetic_hosted_native_01";
    const submissionId = "user_submission.time.HOSTEDNATIVEDEVICE01";
    const desktopSubmissionId = "user_submission.time.HOSTEDDESKTOPDEVICE01";
    let nativeRowsCreated = false;
    try {
      const request = await hosted.app.inject({
        method: "POST",
        url: "/api/auth/sign-in/magic-link",
        headers: {
          origin: baseUrl,
          "content-type": "application/json",
          "x-real-ip": "203.0.113.41",
        },
        payload: { email: "hosted-player@example.test", callbackURL: "/" },
      });
      expect(request.statusCode).toBe(200);
      const magic = new URL(delivered.at(-1)?.url ?? "");
      const redeem = await hosted.app.inject({
        method: "GET",
        url: `${magic.pathname}${magic.search}`,
        headers: { "x-real-ip": "203.0.113.41" },
      });
      const setCookie = redeem.headers["set-cookie"];
      const cookieLine = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      if (typeof cookieLine !== "string") { throw new Error("cookie missing"); }
      const csrf = await hosted.app.inject({
        method: "GET",
        url: "/v1/session/csrf",
        headers: {
          cookie: cookieLine.split(";", 1)[0]!,
          "x-real-ip": "203.0.113.41",
        },
      });
      expect(csrf.statusCode).toBe(200);
      const nativeBootstrap = await hosted.app.inject({
        method: "GET",
        url: "/v1/time-trial-submissions/native-bootstrap",
        headers: {
          cookie: cookieLine.split(";", 1)[0]!,
          "x-real-ip": "203.0.113.41",
        },
      });
      expect(nativeBootstrap.statusCode).toBe(403);
      expect(nativeBootstrap.json()).toMatchObject({
        code: "native_time_trial_player_required",
      });
      const [bindings] = await pool.execute<RowDataPacket[]>(
        `SELECT account.public_id AS accountId, binding.public_id AS bindingId
         FROM restricted_authentication_bindings AS binding
         INNER JOIN user_accounts AS account
           ON account.user_account_id = binding.user_account_id
         WHERE binding.issuer_key = 'mk8dx_passwordless_v1'`,
      );
      expect(bindings).toHaveLength(1);
      accountId = String(bindings[0]!["accountId"]);
      bindingId = String(bindings[0]!["bindingId"]);
      expect(accountId).toMatch(/^user_account\./);
      expect(bindingId).toMatch(/^restricted_auth_binding\./);
      expect(JSON.stringify(bindings)).not.toContain("hosted-player@example.test");
      await pool.execute(
        `INSERT INTO players
         (public_id, revision, player_kind, display_name, record_status,
          created_at_ms, updated_at_ms)
         VALUES (?, 1, 'human', 'Synthetic Hosted Native Racer', 'active', 1, 1)`,
        [playerId],
      );
      await pool.execute(
        `INSERT INTO player_username_history
         (player_id, sequence_number, username_value, comparison_key, allocated_at_ms)
         SELECT player_id, 1, 'hostednative', ?, 1
           FROM players WHERE public_id = ?`,
        [Buffer.from("hostednative"), playerId],
      );
      await pool.execute(
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
      nativeRowsCreated = true;

      const nativeClientHeaders = {
        "content-type": "application/json",
        "x-real-ip": "203.0.113.41",
      };
      const authorizeDevice = async (clientId: string): Promise<string> => {
        const device = await hosted.app.inject({
          method: "POST",
          url: "/api/auth/device/code",
          headers: nativeClientHeaders,
          payload: { client_id: clientId },
        });
        expect(device.statusCode).toBe(200);
        const deviceDocument = device.json<{
          device_code: string;
          user_code: string;
          verification_uri: string;
          verification_uri_complete: string;
          expires_in: number;
          interval: number;
        }>();
        expect(Object.keys(deviceDocument).sort()).toEqual([
          "device_code",
          "expires_in",
          "interval",
          "user_code",
          "verification_uri",
          "verification_uri_complete",
        ]);
        expect(deviceDocument.verification_uri).toBe(`${baseUrl}/device`);
        expect(deviceDocument.verification_uri_complete).toBe(
          `${baseUrl}/device?user_code=${deviceDocument.user_code}`,
        );
        const verifyDevice = await hosted.app.inject({
          method: "GET",
          url: `/api/auth/device?user_code=${deviceDocument.user_code}`,
          headers: {
            cookie: cookieLine.split(";", 1)[0]!,
            "x-real-ip": "203.0.113.41",
          },
        });
        expect(verifyDevice.statusCode).toBe(200);
        const approve = await hosted.app.inject({
          method: "POST",
          url: "/api/auth/device/approve",
          headers: {
            ...nativeClientHeaders,
            origin: baseUrl,
            cookie: cookieLine.split(";", 1)[0]!,
          },
          payload: { userCode: deviceDocument.user_code },
        });
        expect(approve.statusCode).toBe(200);
        const tokenResponse = await hosted.app.inject({
          method: "POST",
          url: "/api/auth/device/token",
          headers: nativeClientHeaders,
          payload: {
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: deviceDocument.device_code,
            client_id: clientId,
          },
        });
        expect(tokenResponse.statusCode).toBe(200);
        const tokenDocument = tokenResponse.json<{
          access_token: string;
          token_type: string;
          expires_in: number;
          scope: string;
        }>();
        expect(Object.keys(tokenDocument).sort()).toEqual([
          "access_token",
          "expires_in",
          "scope",
          "token_type",
        ]);
        expect(tokenDocument.token_type).toBe("Bearer");
        expect(tokenDocument.access_token).toMatch(/^[A-Za-z0-9_-]{20,255}$/);
        expect(tokenDocument.expires_in).toBeGreaterThanOrEqual(60);
        expect(tokenDocument.expires_in).toBeLessThanOrEqual(604_800);
        return tokenDocument.access_token;
      };
      const bearer = await authorizeDevice(MK8DX_ANDROID_CLIENT_ID);
      const bearerHeaders = {
        authorization: `Bearer ${bearer}`,
        "x-real-ip": "203.0.113.41",
      };
      const claimedBootstrap = await hosted.app.inject({
        method: "GET",
        url: "/v1/time-trial-submissions/native-bootstrap",
        headers: bearerHeaders,
      });
      expect(claimedBootstrap.statusCode).toBe(200);
      expect(claimedBootstrap.json()).toEqual({
        schemaVersion: "mk8dx.native-time-trial-bootstrap.v1",
        playerId,
      });
      const submission = await hosted.app.inject({
        method: "POST",
        url: "/v1/time-trial-submissions",
        headers: bearerHeaders,
        payload: {
          schemaVersion: "mk8dx.time-trial-submission.v1",
          submissionId,
          revision: 1,
          mode: 150,
          trackId: "track.mario_kart_stadium",
          totalTimeMs: 83_456,
          laps: [],
          playerReference: { namespace: "player", value: playerId },
          source: {
            kind: "android_manual",
            producerVersion: "timetrials-android-hosted-integration",
          },
          timestamps: { createdAtMs: 1_786_901_020_000 },
        },
      });
      expect(submission.statusCode).toBe(201);
      expect(submission.json()).toEqual({ submissionId, revision: 1 });
      const [nativeRows] = await pool.execute<RowDataPacket[]>(
        `SELECT submission.public_id AS submissionId,
                player.public_id AS playerId,
                revision.source_kind AS sourceKind
         FROM time_trial_submissions AS submission
         INNER JOIN time_trial_submission_revisions AS revision
           ON revision.time_trial_submission_id = submission.time_trial_submission_id
         INNER JOIN players AS player ON player.player_id = revision.player_id
         WHERE submission.public_id = ?`,
        [submissionId],
      );
      expect(nativeRows).toEqual([{
        submissionId,
        playerId,
        sourceKind: "android_manual",
      }]);
      expect(JSON.stringify(nativeRows)).not.toContain(bearer);
      const signOut = await hosted.app.inject({
        method: "POST",
        url: "/api/auth/sign-out",
        headers: {
          ...nativeClientHeaders,
          authorization: `Bearer ${bearer}`,
        },
        payload: {},
      });
      expect(signOut.statusCode).toBe(200);
      expect(signOut.json()).toEqual({ success: true });
      const revokedBootstrap = await hosted.app.inject({
        method: "GET",
        url: "/v1/time-trial-submissions/native-bootstrap",
        headers: bearerHeaders,
      });
      expect(revokedBootstrap.statusCode).toBe(401);

      const desktopBearer = await authorizeDevice(MK8DX_DESKTOP_CLIENT_ID);
      const desktopBearerHeaders = {
        authorization: `Bearer ${desktopBearer}`,
        "x-real-ip": "203.0.113.41",
      };
      const desktopBootstrap = await hosted.app.inject({
        method: "GET",
        url: "/v1/time-trial-submissions/native-bootstrap",
        headers: desktopBearerHeaders,
      });
      expect(desktopBootstrap.statusCode).toBe(200);
      expect(desktopBootstrap.json()).toEqual({
        schemaVersion: "mk8dx.native-time-trial-bootstrap.v1",
        playerId,
      });
      const desktopSubmission = await hosted.app.inject({
        method: "POST",
        url: "/v1/time-trial-submissions",
        headers: desktopBearerHeaders,
        payload: {
          schemaVersion: "mk8dx.time-trial-submission.v1",
          submissionId: desktopSubmissionId,
          revision: 1,
          mode: 150,
          trackId: "track.mario_kart_stadium",
          totalTimeMs: 83_456,
          laps: [
            { lapNumber: 1, timeMs: 27_000 },
            { lapNumber: 2, timeMs: 28_000 },
            { lapNumber: 3, timeMs: 28_456 },
          ],
          playerReference: { namespace: "player", value: playerId },
          source: {
            kind: "livetrial_capture",
            producerVersion: "timetrials-desktop-hosted-integration",
            localRecordId: "livetrial.synthetic-hosted",
          },
          timestamps: {
            createdAtMs: 1_786_901_020_000,
            capturedAtMs: 1_786_901_020_000,
            occurredAtMs: 1_786_901_020_000,
          },
          evidence: [{
            kind: "capture_session",
            reference: `livetrial/${"a".repeat(64)}`,
          }],
        },
      });
      expect(desktopSubmission.statusCode).toBe(201);
      expect(desktopSubmission.json()).toEqual({
        submissionId: desktopSubmissionId,
        revision: 1,
      });
      const [desktopRows] = await pool.execute<RowDataPacket[]>(
        `SELECT submission.public_id AS submissionId,
                player.public_id AS playerId,
                revision.source_kind AS sourceKind
         FROM time_trial_submissions AS submission
         INNER JOIN time_trial_submission_revisions AS revision
           ON revision.time_trial_submission_id = submission.time_trial_submission_id
         INNER JOIN players AS player ON player.player_id = revision.player_id
         WHERE submission.public_id = ?`,
        [desktopSubmissionId],
      );
      expect(desktopRows).toEqual([{
        submissionId: desktopSubmissionId,
        playerId,
        sourceKind: "livetrial_capture",
      }]);
      const [desktopEvidence] = await pool.execute<RowDataPacket[]>(
        `SELECT evidence.evidence_kind AS evidenceKind,
                evidence.reference_ciphertext AS referenceCiphertext
         FROM restricted_time_trial_evidence AS evidence
         INNER JOIN time_trial_submission_revisions AS revision
           ON revision.time_trial_submission_revision_id =
              evidence.time_trial_submission_revision_id
         INNER JOIN time_trial_submissions AS submission
           ON submission.time_trial_submission_id = revision.time_trial_submission_id
         WHERE submission.public_id = ?`,
        [desktopSubmissionId],
      );
      expect(desktopEvidence).toHaveLength(1);
      expect(desktopEvidence[0]!["evidenceKind"]).toBe("capture_session");
      expect(Buffer.isBuffer(desktopEvidence[0]!["referenceCiphertext"])).toBe(true);
      expect(
        (desktopEvidence[0]!["referenceCiphertext"] as Buffer).toString("utf8"),
      ).not.toContain("livetrial/");
      expect(JSON.stringify(desktopRows)).not.toContain(desktopBearer);
      const desktopSignOut = await hosted.app.inject({
        method: "POST",
        url: "/api/auth/sign-out",
        headers: {
          ...nativeClientHeaders,
          authorization: `Bearer ${desktopBearer}`,
        },
        payload: {},
      });
      expect(desktopSignOut.statusCode).toBe(200);
      expect(desktopSignOut.json()).toEqual({ success: true });
      const revokedDesktopBootstrap = await hosted.app.inject({
        method: "GET",
        url: "/v1/time-trial-submissions/native-bootstrap",
        headers: desktopBearerHeaders,
      });
      expect(revokedDesktopBootstrap.statusCode).toBe(401);
    } finally {
      await hosted.close();
      if (nativeRowsCreated) {
        await pool.execute(
          `DELETE lifecycle FROM time_trial_publication_lifecycle AS lifecycle
           INNER JOIN time_trial_publications AS publication
             ON publication.time_trial_publication_id = lifecycle.time_trial_publication_id
           INNER JOIN time_trial_submissions AS submission
             ON submission.time_trial_submission_id = publication.time_trial_submission_id
           WHERE submission.public_id IN (?, ?)`,
          [submissionId, desktopSubmissionId],
        );
        await pool.execute(
          `DELETE publication FROM time_trial_publications AS publication
           INNER JOIN time_trial_submissions AS submission
             ON submission.time_trial_submission_id = publication.time_trial_submission_id
           WHERE submission.public_id IN (?, ?)`,
          [submissionId, desktopSubmissionId],
        );
        await pool.execute(
          `DELETE access_log
           FROM restricted_identity_access_log AS access_log
           INNER JOIN restricted_time_trial_evidence AS evidence
             ON evidence.time_trial_evidence_id = access_log.time_trial_evidence_id
           INNER JOIN time_trial_submission_revisions AS revision
             ON revision.time_trial_submission_revision_id =
                evidence.time_trial_submission_revision_id
           INNER JOIN time_trial_submissions AS submission
             ON submission.time_trial_submission_id = revision.time_trial_submission_id
           WHERE submission.public_id IN (?, ?)`,
          [submissionId, desktopSubmissionId],
        );
        await pool.execute(
          `DELETE evidence
           FROM restricted_time_trial_evidence AS evidence
           INNER JOIN time_trial_submission_revisions AS revision
             ON revision.time_trial_submission_revision_id =
                evidence.time_trial_submission_revision_id
           INNER JOIN time_trial_submissions AS submission
             ON submission.time_trial_submission_id = revision.time_trial_submission_id
           WHERE submission.public_id IN (?, ?)`,
          [submissionId, desktopSubmissionId],
        );
        await pool.execute(
          `DELETE lap
           FROM time_trial_laps AS lap
           INNER JOIN time_trial_submission_revisions AS revision
             ON revision.time_trial_submission_revision_id =
                lap.time_trial_submission_revision_id
           INNER JOIN time_trial_submissions AS submission
             ON submission.time_trial_submission_id = revision.time_trial_submission_id
           WHERE submission.public_id IN (?, ?)`,
          [submissionId, desktopSubmissionId],
        );
        await pool.execute(
          `DELETE revision
           FROM time_trial_submission_revisions AS revision
           INNER JOIN time_trial_submissions AS submission
             ON submission.time_trial_submission_id = revision.time_trial_submission_id
           WHERE submission.public_id IN (?, ?)`,
          [submissionId, desktopSubmissionId],
        );
        await pool.execute(
          "DELETE FROM time_trial_submissions WHERE public_id IN (?, ?)",
          [submissionId, desktopSubmissionId],
        );
        await pool.execute("DELETE FROM player_claims WHERE public_id = ?", [claimId]);
        await pool.execute(
          `DELETE FROM player_username_history
           WHERE player_id IN (SELECT player_id FROM players WHERE public_id = ?)`,
          [playerId],
        );
        await pool.execute("DELETE FROM players WHERE public_id = ?", [playerId]);
      }
      if (bindingId.length > 0) {
        await pool.execute(
          `DELETE access_log
           FROM restricted_identity_access_log AS access_log
           INNER JOIN restricted_authentication_bindings AS binding
             ON binding.authentication_binding_id = access_log.authentication_binding_id
           WHERE binding.public_id = ?`,
          [bindingId],
        );
        await pool.execute(
          `DELETE lifecycle
           FROM restricted_authentication_binding_lifecycle AS lifecycle
           INNER JOIN restricted_authentication_bindings AS binding
             ON binding.authentication_binding_id = lifecycle.authentication_binding_id
           WHERE binding.public_id = ?`,
          [bindingId],
        );
        await pool.execute(
          "DELETE FROM restricted_authentication_bindings WHERE public_id = ?",
          [bindingId],
        );
      }
      if (accountId.length > 0) {
        await pool.execute("DELETE FROM user_accounts WHERE public_id = ?", [accountId]);
      }
    }
  });
});
