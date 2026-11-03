// What a grouped notification counted, against a real MySQL 8.4 schema.
//
// The inbox collapses on purpose. Before `notification_events` existed the
// collapse was lossy: the entry knew it had counted forty-nine World Records
// and could name exactly one of them. These cases prove the members survive the
// fold, that they belong to the entry that counted them, and that one account
// can never read another account's.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

import { MysqlNotificationRepository } from
  "../src/notifications/mysql-notification-repository.js";

const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" ? describe : describe.skip;
const accountId = (name: string): string => `user_account.groupmembers_${name}`;
const playerId = (name: string): string => `player.groupmembers_${name}`;

integration("grouped notification members", () => {
  let pool: Pool;
  let repository: MysqlNotificationRepository;

  const internalAccountId = async (name: string): Promise<number> => {
    const [rows] = await pool.execute(
      "SELECT user_account_id AS id FROM user_accounts WHERE public_id = ?",
      [accountId(name)],
    );
    return Number((rows as { id: number }[])[0]?.id);
  };

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
    if (password !== undefined) { options.password = password; }
    pool = mysql.createPool(options);
    repository = new MysqlNotificationRepository(pool);
    for (const name of ["reader", "stranger", "actor"]) {
      await pool.execute(
        `INSERT INTO user_accounts
           (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
         VALUES (?, 1, 'private', 'active', 1, 1)`,
        [accountId(name)],
      );
      await pool.execute(
        `INSERT INTO players
           (public_id, revision, player_kind, display_name, record_status,
            created_at_ms, updated_at_ms)
         VALUES (?, 1, 'human', ?, 'active', 1, 1)`,
        [playerId(name), `Group ${name}`],
      );
    }
  });

  afterAll(async () => {
    if (pool === undefined) { return; }
    // The members go with the entry: the foreign key cascades, which is itself
    // part of what this file asserts below.
    await pool.execute(
      `DELETE FROM notifications WHERE user_account_id IN
         (SELECT user_account_id FROM user_accounts
          WHERE public_id LIKE 'user_account.groupmembers_%')`,
    );
    await pool.execute("DELETE FROM players WHERE public_id LIKE 'player.groupmembers_%'");
    await pool.execute(
      "DELETE FROM user_accounts WHERE public_id LIKE 'user_account.groupmembers_%'",
    );
    await pool.end();
  });

  it("keeps every event an entry folded away, newest first", async () => {
    const account = await internalAccountId("reader");
    const tracks = [
      ["track.mario_circuit", 150],
      ["track.mount_wario", 200],
      ["track.rainbow_road", 200],
    ] as const;
    for (const [index, [trackId, modeCc]] of tracks.entries()) {
      // Exactly what the World Record import does: upsert one aggregate per
      // account under a single unread key, then append the member.
      await pool.execute(
        `INSERT INTO notifications
           (user_account_id, notification_kind, aggregation_key, track_id,
            mode_cc, event_count, first_event_at_ms, last_event_at_ms)
         VALUES (?, 'world_record', 'world_record', ?, ?, 1, ?, ?)
         ON DUPLICATE KEY UPDATE event_count = event_count + 1,
           last_event_at_ms = VALUES(last_event_at_ms),
           track_id = VALUES(track_id), mode_cc = VALUES(mode_cc)`,
        [account, trackId, modeCc, 1_900_000_000_000 + index, 1_900_000_000_000 + index],
      );
      await pool.execute(
        `INSERT INTO notification_events(notification_id, occurred_at_ms, track_id, mode_cc)
         SELECT notification_id, ?, ?, ? FROM notifications
         WHERE user_account_id = ? AND notification_kind = 'world_record'
           AND aggregation_key = 'world_record' AND read_at_ms IS NULL`,
        [1_900_000_000_000 + index, trackId, modeCc, account],
      );
    }

    const inbox = await repository.listForAccount(accountId("reader"));
    const entry = inbox.notifications.find((view) => view.kind === "world_record");
    expect(entry).toBeDefined();
    // Three breaks, one line: the collapse still happens.
    expect(entry?.count).toBe(3);
    expect(entry?.trackId).toBe("track.rainbow_road");

    const members = await repository.listEventsForAccount(
      accountId("reader"), entry!.notificationId, 200,
    );
    expect(members).toHaveLength(3);
    // The two the aggregate could not name are exactly what was missing.
    expect(members.map((member) => member.trackId)).toEqual([
      "track.rainbow_road", "track.mount_wario", "track.mario_circuit",
    ]);
    expect(members.map((member) => member.mode)).toEqual([200, 200, 150]);
  });

  it("never returns another account's members", async () => {
    const owner = await internalAccountId("reader");
    const [rows] = await pool.execute(
      `SELECT notification_id AS id FROM notifications
       WHERE user_account_id = ? AND notification_kind = 'world_record'`,
      [owner],
    );
    const notificationId = String((rows as { id: number }[])[0]?.id);
    // The stranger names the right row and still reads nothing: the query is
    // scoped by the account that owns the entry, not only by its id.
    const leaked = await repository.listEventsForAccount(
      accountId("stranger"), notificationId, 200,
    );
    expect(leaked).toEqual([]);
  });

  it("resolves the actor and drops the members with the entry", async () => {
    const account = await internalAccountId("actor");
    const [actorRows] = await pool.execute(
      "SELECT player_id AS id FROM players WHERE public_id = ?", [playerId("actor")],
    );
    const actorInternalId = Number((actorRows as { id: number }[])[0]?.id);
    // Two pokes from the same Player collapse into one entry counting two;
    // both survive as members, with the actor resolved back to a name.
    for (const at of [1_900_000_100_000, 1_900_000_200_000]) {
      await pool.execute(
        `INSERT INTO notifications
           (user_account_id, notification_kind, aggregation_key, actor_player_id,
            event_count, first_event_at_ms, last_event_at_ms)
         VALUES (?, 'poke', 'poke|group-members', ?, 1, ?, ?)
         ON DUPLICATE KEY UPDATE
           notification_id = LAST_INSERT_ID(notification_id),
           event_count = event_count + 1, last_event_at_ms = VALUES(last_event_at_ms)`,
        [account, actorInternalId, at, at],
      );
      await pool.execute(
        `INSERT INTO notification_events(notification_id, occurred_at_ms, actor_player_id)
         VALUES (LAST_INSERT_ID(), ?, ?)`,
        [at, actorInternalId],
      );
    }
    const inbox = await repository.listForAccount(accountId("actor"));
    const entry = inbox.notifications.find((view) => view.kind === "poke");
    expect(entry?.count).toBe(2);
    const members = await repository.listEventsForAccount(
      accountId("actor"), entry!.notificationId, 200,
    );
    expect(members).toHaveLength(2);
    expect(members[0]?.actorDisplayName).toBe("Group actor");
    expect(members[0]?.actorPlayerId).toBe(playerId("actor"));
    expect(members[0]?.occurredAtMs).toBe(1_900_000_200_000);

    // Deleting the entry takes its members with it; nothing is orphaned.
    await pool.execute(
      "DELETE FROM notifications WHERE notification_id = ?", [entry!.notificationId],
    );
    const [left] = await pool.execute(
      "SELECT COUNT(*) AS remaining FROM notification_events WHERE notification_id = ?",
      [entry!.notificationId],
    );
    expect(Number((left as { remaining: number }[])[0]?.remaining)).toBe(0);
  });
});
