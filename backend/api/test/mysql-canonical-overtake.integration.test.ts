import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions, type RowDataPacket } from "mysql2/promise";

import { MysqlNotificationRepository } from
  "../src/notifications/mysql-notification-repository.js";
import { MysqlTimeTrialWriteRepository } from
  "../src/timetrials/mysql-time-trial-write-repository.js";
import {
  TimeTrialSubmissionService,
  type ProtectedLookupValue,
  type ProtectedValue,
  type TimeTrialAssetCatalog,
  type TimeTrialPlayerReference,
  type TimeTrialSensitiveValueProtector,
  type TimeTrialSubmissionV1,
} from "../src/timetrials/submission-service.js";

const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" ? describe : describe.skip;
const players = ["ace", "nova", "ben", "floyd"] as const;
const playerId = (name: string) => `player.notification_${name}`;
const accountId = (name: string) => `user_account.notification_${name}`;
const submissionPrefix = "user_submission.time.NOTIFY";

class Catalog implements TimeTrialAssetCatalog {
  async validateReferences(): Promise<readonly string[]> { return []; }
}
class Protector implements TimeTrialSensitiveValueProtector {
  async protectParticipantReference(
    _namespace: Exclude<TimeTrialPlayerReference["namespace"], "player">,
    _value: string,
  ): Promise<ProtectedLookupValue> { throw new Error("not used"); }
  async protectEvidenceReference(): Promise<ProtectedValue> { throw new Error("not used"); }
}

function submission(
  suffix: string, player: string, totalTimeMs: number, mode: 150 | 200 = 150,
): TimeTrialSubmissionV1 {
  return {
    schemaVersion: "mk8dx.time-trial-submission.v1",
    submissionId: `${submissionPrefix}${suffix}`,
    revision: 1,
    mode,
    trackId: "track.mario_circuit",
    totalTimeMs,
    laps: [],
    playerReference: { namespace: "player", value: playerId(player) },
    source: { kind: "web_manual", producerVersion: "canonical-notification-test" },
    timestamps: { createdAtMs: 1_900_100_000_000 + Number(suffix.replaceAll(/\D/g, "") || 0) },
  };
}

integration("canonical overtake MySQL acceptance", () => {
  let pool: Pool;
  let submissions: TimeTrialSubmissionService;
  let notifications: MysqlNotificationRepository;

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
      connectionLimit: 2,
    };
    const password = process.env["MK8DX_MYSQL_TEST_PASSWORD"];
    if (password !== undefined) options.password = password;
    pool = mysql.createPool(options);
    submissions = new TimeTrialSubmissionService(
      new MysqlTimeTrialWriteRepository(pool), new Catalog(), new Protector(),
    );
    notifications = new MysqlNotificationRepository(pool);
    for (const [index, name] of players.entries()) {
      await pool.execute(
        `INSERT INTO players
           (public_id, revision, player_kind, display_name, record_status,
            created_at_ms, updated_at_ms)
         VALUES (?, 1, 'human', ?, 'active', 1, 1)`,
        [playerId(name), name[0]!.toUpperCase() + name.slice(1)],
      );
      await pool.execute(
        `INSERT INTO user_accounts
           (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
         VALUES (?, 1, 'private', 'active', 1, 1)`,
        [accountId(name)],
      );
      await pool.execute(
        `INSERT INTO player_claims
           (public_id, revision, privacy_class, player_id, user_account_id,
            claim_status, dispute_status, created_at_ms, updated_at_ms)
         SELECT ?, 1, 'private', player.player_id, account.user_account_id,
                'verified', 'none', 1, 1
         FROM players AS player, user_accounts AS account
         WHERE player.public_id = ? AND account.public_id = ?`,
        [`player_claim.notification_${index}`, playerId(name), accountId(name)],
      );
    }
  });

  afterAll(async () => {
    if (pool === undefined) return;
    await pool.execute(
      `DELETE FROM notifications WHERE user_account_id IN
         (SELECT user_account_id FROM user_accounts WHERE public_id LIKE 'user_account.notification\\_%')`,
    );
    await pool.execute(
      `DELETE lifecycle FROM time_trial_publication_lifecycle AS lifecycle
       INNER JOIN time_trial_publications AS publication
         ON publication.time_trial_publication_id = lifecycle.time_trial_publication_id
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = publication.time_trial_submission_id
       WHERE submission.public_id LIKE 'user_submission.time.NOTIFY%'`,
    );
    await pool.execute(
      `DELETE publication FROM time_trial_publications AS publication
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = publication.time_trial_submission_id
       WHERE submission.public_id LIKE 'user_submission.time.NOTIFY%'`,
    );
    await pool.execute(
      `DELETE revision FROM time_trial_submission_revisions AS revision
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = revision.time_trial_submission_id
       WHERE submission.public_id LIKE 'user_submission.time.NOTIFY%'`,
    );
    await pool.execute("DELETE FROM time_trial_submissions WHERE public_id LIKE 'user_submission.time.NOTIFY%'");
    await pool.execute("DELETE FROM player_claims WHERE public_id LIKE 'player_claim.notification\\_%'");
    await pool.execute("DELETE FROM user_accounts WHERE public_id LIKE 'user_account.notification\\_%'");
    await pool.execute("DELETE FROM players WHERE public_id LIKE 'player.notification\\_%'");
    await pool.end();
  });

  it("notifies only Ben with the proven -611ms and #4 consequence", async () => {
    const publish = (value: TimeTrialSubmissionV1) => submissions.submit(
      value, { publicationIntent: "trusted_runtime" },
    );
    await publish(submission("ACE01", "ace", 115_000));
    await publish(submission("NOVA01", "nova", 116_000));
    await publish(submission("BEN01", "ben", 116_942));
    await publish(submission("FLOYD01", "floyd", 117_200));
    await publish(submission("FLOYD02", "floyd", 116_331));
    const [publicationRows] = await pool.execute<RowDataPacket[]>(
      `SELECT submission.public_id AS submissionId, publication.publication_status AS statusValue,
              publication.reason_code AS reasonCode
       FROM time_trial_publications AS publication
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id = publication.time_trial_submission_id
       WHERE submission.public_id LIKE 'user_submission.time.NOTIFY%'`,
    );
    expect(publicationRows).toHaveLength(5);
    expect(publicationRows.map((row) => [row["statusValue"], row["reasonCode"]]))
      .toEqual(Array.from({ length: 5 }, () => ["published", "verified_claim_runtime_acceptance"]));
    await notifications.produceOvertaken(`${submissionPrefix}FLOYD02`, 1_900_200_000_000);

    const ben = await notifications.listForAccount(accountId("ben"));
    expect(ben.unreadCount).toBe(1);
    expect(ben.notifications).toEqual([expect.objectContaining({
      kind: "overtaken", actorPlayerId: playerId("floyd"),
      trackId: "track.mario_circuit", mode: 150,
      actorTimeMs: 116_331, recipientTimeMs: 116_942,
      deltaMs: -611, recipientRank: 4, count: 1,
    })]);
    for (const unrelated of ["ace", "nova", "floyd"]) {
      expect((await notifications.listForAccount(accountId(unrelated))).unreadCount).toBe(0);
    }

    // Same actor/recipient/Track/cc in the same two-hour delivery window:
    // one canonical inbox event, updated to the latest proven state.
    await publish(submission("FLOYD03", "floyd", 116_200));
    await notifications.produceOvertaken(`${submissionPrefix}FLOYD03`, 1_900_200_060_000);
    const updated = await notifications.listForAccount(accountId("ben"));
    expect(updated.unreadCount).toBe(1);
    expect(updated.notifications[0]).toMatchObject({ count: 2, actorTimeMs: 116_200, deltaMs: -742 });

    // A 200cc result cannot use the 150cc PB as a recipient comparison.
    await publish(submission("FLOYD04", "floyd", 110_000, 200));
    await notifications.produceOvertaken(`${submissionPrefix}FLOYD04`, 1_900_200_120_000);
    expect((await notifications.listForAccount(accountId("ben"))).notifications).toHaveLength(1);
  });
});
