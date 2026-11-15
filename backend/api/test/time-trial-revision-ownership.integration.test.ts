// A native Time Trial revision belongs to the Player who owns the submission. These tests drive the
// real POST /v1/time-trial-submissions route, the real account-claim authorizer, the real submission
// service and the real MySQL write repository against a disposable database; only the signed-in
// account (the session) is synthetic. The administrator correction goes through the real lifecycle
// route, service and repository.
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions, type RowDataPacket } from "mysql2/promise";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ActorContext } from "../src/identity/types.js";
import { AccountClaimTimeTrialSubmissionAuthorizer } from
  "../src/timetrials/account-claim-submission-authorizer.js";
import { TimeTrialLifecycleService } from "../src/timetrials/lifecycle-service.js";
import { registerTimeTrialLifecycleRoutes } from "../src/timetrials/lifecycle-routes.js";
import { MysqlTimeTrialLifecycleRepository } from
  "../src/timetrials/mysql-lifecycle-repository.js";
import { MysqlPublicTimeTrialRepository } from
  "../src/timetrials/mysql-public-time-trial-repository.js";
import { MysqlTimeTrialWriteRepository } from
  "../src/timetrials/mysql-time-trial-write-repository.js";
import { MysqlWebManualSessionRepository } from
  "../src/timetrials/mysql-web-manual-session-repository.js";
import { registerTimeTrialSubmissionRoutes } from "../src/timetrials/submission-routes.js";
import {
  TimeTrialSubmissionService,
  type ProtectedLookupValue,
  type ProtectedValue,
  type TimeTrialAssetCatalog,
  type TimeTrialSensitiveValueProtector,
  type TimeTrialSubmissionV1,
} from "../src/timetrials/submission-service.js";

const pinnedMigrationCatalogLength = (JSON.parse(readFileSync(
  fileURLToPath(new URL("../../../infrastructure/mysql/migration-catalog-v1.json", import.meta.url)),
  "utf8",
)) as { migrations: readonly unknown[] }).migrations.length;

const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" ? describe : describe.skip;

const trackId = "track.synthetic_ownership_track";
const players = {
  a: "player.synthetic_owner_a",
  b: "player.synthetic_owner_b",
  c: "player.synthetic_owner_c",
} as const;
const accounts = {
  a: "user_account.synthetic_owner_a",
  b: "user_account.synthetic_owner_b",
  c: "user_account.synthetic_owner_c",
  admin: "user_account.synthetic_owner_admin",
} as const;
const ids = {
  a: "user_submission.time.SYNTHOWNA01",
  b: "user_submission.time.SYNTHOWNB01",
  b2: "user_submission.time.SYNTHOWNB02",
  c: "user_submission.time.SYNTHOWNC01",
  legacy: "user_submission.time.SYNTHOWNLEGACY01",
} as const;

class AcceptingCatalog implements TimeTrialAssetCatalog {
  async validateReferences(): Promise<readonly string[]> { return []; }
}

// Produces well-formed protected values so a legacy restricted participant can be stored.
class SyntheticProtector implements TimeTrialSensitiveValueProtector {
  async protectParticipantReference(): Promise<ProtectedLookupValue> {
    return {
      lookupHmac: Uint8Array.from(Buffer.alloc(32, 7)),
      lookupKeyVersion: "lookup-v1",
      ciphertext: Uint8Array.from([1, 2, 3]),
      encryptionKeyVersion: "encryption-v1",
    };
  }
  async protectEvidenceReference(): Promise<ProtectedValue> {
    return { ciphertext: Uint8Array.from([4, 5, 6]), encryptionKeyVersion: "encryption-v1" };
  }
}

function submission(
  submissionId: string,
  playerId: string,
  revision: number,
  totalTimeMs: number,
  kind: TimeTrialSubmissionV1["source"]["kind"] = "android_manual",
): TimeTrialSubmissionV1 {
  const lap = Math.floor(totalTimeMs / 3);
  return {
    schemaVersion: "mk8dx.time-trial-submission.v1",
    submissionId,
    revision,
    mode: 150,
    trackId,
    totalTimeMs,
    laps: [
      { lapNumber: 1, timeMs: lap },
      { lapNumber: 2, timeMs: lap },
      { lapNumber: 3, timeMs: totalTimeMs - 2 * lap },
    ],
    playerReference: { namespace: "player", value: playerId },
    source: { kind, producerVersion: "ownership-integration" },
    timestamps: { createdAtMs: 1_900_000_000_000 + revision },
    verification: { status: "producer_check_passed", lapSumMatches: true },
  };
}

integration("a native Time Trial revision cannot take over another Player's submission", () => {
  let pool: Pool;
  let app: FastifyInstance;
  let publicRepository: MysqlPublicTimeTrialRepository;
  let nowMs = 1_900_000_100_000;

  const actorFor = (header: unknown): ActorContext => {
    if (header === "admin") return { role: "administrator", userAccountId: accounts.admin };
    if (header === "a" || header === "b" || header === "c") {
      return { role: "account", userAccountId: accounts[header] };
    }
    return { role: "anonymous" };
  };

  const post = (actor: string, body: TimeTrialSubmissionV1) => app.inject({
    method: "POST",
    url: "/v1/time-trial-submissions",
    headers: { "x-synthetic-actor": actor },
    payload: body,
  });

  // Everything of a submission that a refused write must leave alone: its revisions and their
  // owner, its publication, the publication history, notification jobs and both Players' bests.
  const snapshot = async (submissionId: string) => {
    const [revisions] = await pool.execute<RowDataPacket[]>(
      `SELECT revision.revision_number AS revision, player.public_id AS playerId,
              revision.source_kind AS sourceKind, revision.total_time_ms AS totalTimeMs
       FROM time_trial_submission_revisions AS revision
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = revision.time_trial_submission_id
       LEFT JOIN players AS player ON player.player_id = revision.player_id
       WHERE submission.public_id = ? ORDER BY revision.revision_number`,
      [submissionId],
    );
    const [publication] = await pool.execute<RowDataPacket[]>(
      `SELECT publication.current_revision_id AS currentRevisionId,
              publication.publication_revision AS publicationRevision,
              publication.publication_status AS status, publication.reason_code AS reason,
              (SELECT COUNT(*) FROM time_trial_publication_lifecycle AS lifecycle
                WHERE lifecycle.time_trial_publication_id = publication.time_trial_publication_id)
                AS historyCount,
              (SELECT COUNT(*) FROM notification_producer_jobs AS job
                WHERE job.time_trial_publication_id = publication.time_trial_publication_id)
                AS notificationJobs
       FROM time_trial_publications AS publication
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = publication.time_trial_submission_id
       WHERE submission.public_id = ?`,
      [submissionId],
    );
    const [bests] = await pool.execute<RowDataPacket[]>(
      `SELECT player.public_id AS playerId, best.total_time_ms AS totalTimeMs,
              best.time_trial_submission_revision_id AS revisionId
       FROM time_trial_player_bests AS best
       INNER JOIN players AS player ON player.player_id = best.player_id
       WHERE best.track_id = ? ORDER BY player.public_id`,
      [trackId],
    );
    const leaderboard = (await publicRepository.listLeaderboard(trackId, 150))
      .map((row) => ({ ...row }));
    return { revisions, publication, bests, leaderboard };
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
      connectionLimit: 6,
    };
    const password = process.env["MK8DX_MYSQL_TEST_PASSWORD"];
    if (password !== undefined) options.password = password;
    pool = mysql.createPool(options);
    const [migrations] = await pool.execute<RowDataPacket[]>(
      "SELECT migration_version FROM schema_migrations ORDER BY migration_version",
    );
    expect(migrations).toHaveLength(pinnedMigrationCatalogLength);

    for (const [key, playerId] of Object.entries(players)) {
      await pool.execute(
        `INSERT INTO players (public_id, revision, player_kind, display_name, record_status,
           created_at_ms, updated_at_ms)
         VALUES (?, 1, 'human', ?, 'active', 1, 1)`,
        [playerId, `Synthetic Owner ${key.toUpperCase()}`],
      );
      await pool.execute(
        `INSERT INTO player_username_history (player_id, sequence_number, username_value,
           comparison_key, allocated_at_ms)
         SELECT player_id, 1, ?, ?, 1 FROM players WHERE public_id = ?`,
        [`synthowner${key}`, Buffer.from(`synthowner${key}`, "utf8"), playerId],
      );
    }
    for (const accountId of Object.values(accounts)) {
      await pool.execute(
        `INSERT INTO user_accounts (public_id, revision, privacy_class, account_status,
           created_at_ms, updated_at_ms)
         VALUES (?, 1, 'private', 'active', 1, 1)`,
        [accountId],
      );
    }
    for (const key of ["a", "b", "c"] as const) {
      await pool.execute(
        `INSERT INTO player_claims (public_id, revision, privacy_class, player_id, user_account_id,
           claim_status, dispute_status, created_at_ms, updated_at_ms)
         SELECT ?, 1, 'private', player.player_id, account.user_account_id, 'verified', 'none', 1, 1
         FROM players AS player CROSS JOIN user_accounts AS account
         WHERE player.public_id = ? AND account.public_id = ?`,
        [`player_claim.synthetic_owner_${key}`, players[key], accounts[key]],
      );
    }

    const clock = { nowMs: () => nowMs++ };
    const writes = new TimeTrialSubmissionService(
      new MysqlTimeTrialWriteRepository(pool, clock),
      new AcceptingCatalog(),
      new SyntheticProtector(),
    );
    // A legacy/import-style submission without a central Player owner.
    await writes.submit({
      ...submission(ids.legacy, players.a, 1, 95_000),
      playerReference: { namespace: "legacy_firebase_user", value: "legacy-synthetic-owner" },
    }, { publicationIntent: "trusted_runtime" });

    publicRepository = new MysqlPublicTimeTrialRepository(pool);
    app = Fastify();
    const resolveActor = async (request: { headers: Record<string, unknown> }) =>
      actorFor(request.headers["x-synthetic-actor"]);
    await registerTimeTrialSubmissionRoutes(app, {
      resolveActor,
      authorizer: new AccountClaimTimeTrialSubmissionAuthorizer(
        new MysqlWebManualSessionRepository(pool),
      ),
      service: writes,
    });
    await registerTimeTrialLifecycleRoutes(app, {
      resolveActor,
      service: new TimeTrialLifecycleService(new MysqlTimeTrialLifecycleRepository(pool, clock)),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it("lets A create a submission, resend it from an offline queue and revise it", async () => {
    const created = await post("a", submission(ids.a, players.a, 1, 100_000));
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({ submissionId: ids.a, revision: 1 });
    // A queue that lost the acknowledgement re-sends the same revision: the same conflict as before.
    const resent = await post("a", submission(ids.a, players.a, 1, 100_000));
    expect(resent.statusCode).toBe(409);
    expect(resent.json()).toMatchObject({ code: "time_trial_revision_conflict" });
    const revised = await post("a", submission(ids.a, players.a, 2, 99_000));
    expect(revised.statusCode).toBe(201);
    expect(revised.json()).toEqual({ submissionId: ids.a, revision: 2 });
    // android_manual -> android_scan stays inside the same (Android) source class.
    const scanned = await post("a", submission(ids.a, players.a, 3, 98_500, "android_scan"));
    expect(scanned.statusCode).toBe(201);
    const state = await snapshot(ids.a);
    expect(state.revisions.map((row) => row["playerId"])).toEqual([players.a, players.a, players.a]);
    expect(state.publication[0]).toMatchObject({ status: "published" });
  });

  it("refuses A's revision of B's submission even with A's own Player and the right revision", async () => {
    expect((await post("b", submission(ids.b, players.b, 1, 90_000))).statusCode).toBe(201);
    const before = await snapshot(ids.b);
    expect(before.leaderboard.map((row) => row.playerId)).toContain(players.b);

    const takeover = await post("a", submission(ids.b, players.a, 2, 80_000));
    expect(takeover.statusCode).toBe(403);
    expect(takeover.json()).toMatchObject({ code: "time_trial_submission_forbidden" });
    // Any guessed revision number gets the same answer, so it does not reveal the current one.
    for (const revision of [1, 3, 7]) {
      expect((await post("a", submission(ids.b, players.a, revision, 80_000))).statusCode).toBe(403);
    }
    // Naming B's Player directly is refused by the authorizer already.
    expect((await post("a", submission(ids.b, players.b, 2, 80_000))).statusCode).toBe(403);

    expect(await snapshot(ids.b)).toEqual(before);
    // B can still revise the own submission afterwards.
    expect((await post("b", submission(ids.b, players.b, 2, 89_000))).statusCode).toBe(201);
  });

  it("does not change the source class through a normal revision", async () => {
    const before = await snapshot(ids.a);
    const switched = await post("a", submission(ids.a, players.a, 4, 98_000, "livetrial_capture"));
    expect(switched.statusCode).toBe(403);
    expect(await snapshot(ids.a)).toEqual(before);
  });

  it("refuses a revision of a submission without a central Player owner", async () => {
    const before = await snapshot(ids.legacy);
    expect(before.revisions).toEqual([
      { revision: 1, playerId: null, sourceKind: "android_manual", totalTimeMs: 95_000 },
    ]);
    const adopted = await post("a", submission(ids.legacy, players.a, 2, 94_000));
    expect(adopted.statusCode).toBe(403);
    expect(await snapshot(ids.legacy)).toEqual(before);
  });

  it("serializes concurrent revisions: the owner's lands once, the takeover never", async () => {
    expect((await post("b", submission(ids.b2, players.b, 1, 91_000))).statusCode).toBe(201);
    const responses = await Promise.all([
      post("a", submission(ids.b2, players.a, 2, 70_000)),
      post("b", submission(ids.b2, players.b, 2, 90_500)),
      post("a", submission(ids.b2, players.a, 2, 70_000)),
      post("b", submission(ids.b2, players.b, 2, 90_400)),
    ]);
    const codes = responses.map((response) => response.statusCode);
    expect(codes[0]).toBe(403);
    expect(codes[2]).toBe(403);
    expect([codes[1], codes[3]].sort()).toEqual([201, 409]);
    const state = await snapshot(ids.b2);
    expect(state.revisions.map((row) => row["playerId"])).toEqual([players.b, players.b]);
  });

  it("refuses a revision once the owner's claim was revoked, and leaves the result alone", async () => {
    expect((await post("c", submission(ids.c, players.c, 1, 92_000))).statusCode).toBe(201);
    const before = await snapshot(ids.c);
    await pool.execute(
      `UPDATE player_claims SET claim_status = 'revoked', revision = revision + 1, updated_at_ms = 2
       WHERE public_id = 'player_claim.synthetic_owner_c'`,
    );
    const revision = await post("c", submission(ids.c, players.c, 2, 91_000));
    expect(revision.statusCode).toBe(403);
    expect(await snapshot(ids.c)).toEqual(before);
  });

  it("keeps the separate administrator correction, which keeps the owner and is logged", async () => {
    const before = await snapshot(ids.b);
    const corrected = await app.inject({
      method: "POST",
      url: `/v1/time-trials/${ids.b}/actions/correct`,
      headers: { "x-synthetic-actor": "admin" },
      payload: {
        totalTimeMs: 88_800, laps: [29_600, 29_600, 29_600],
        reasonCode: "incorrect_time", note: "synthetic administrator correction",
      },
    });
    expect(corrected.statusCode).toBe(200);
    const after = await snapshot(ids.b);
    expect(after.revisions).toHaveLength(before.revisions.length + 1);
    expect(after.revisions.at(-1)).toMatchObject({ playerId: players.b, totalTimeMs: 88_800 });
    const [events] = await pool.execute<RowDataPacket[]>(
      `SELECT event.event_type AS eventType, event.actor_role AS actorRole, account.public_id AS actor
       FROM time_trial_lifecycle_events AS event
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = event.time_trial_submission_id
       INNER JOIN user_accounts AS account ON account.user_account_id = event.actor_user_account_id
       WHERE submission.public_id = ?`,
      [ids.b],
    );
    expect(events).toEqual([
      { eventType: "corrected", actorRole: "administrator", actor: accounts.admin },
    ]);
    // An administrator's ordinary submission route is no way around the owner either.
    expect((await post("admin", submission(ids.b, players.a, after.revisions.length + 1, 70_000)))
      .statusCode).toBe(403);
    // The owner continues from the corrected revision.
    expect((await post("b", submission(ids.b, players.b, after.revisions.length + 1, 88_700)))
      .statusCode).toBe(201);
  });
});
