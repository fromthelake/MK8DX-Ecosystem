// ADR-0220 against a disposable MySQL/MariaDB with the whole catalog applied (migration 0080):
// a non-Director asks once, the administrators' inbox hears it, a second open request is refused by
// the generated key, Decline records the reason and lets the person ask again, Approve writes the
// audited tournament.operation grant and links it, and the person hears both outcomes.

import { randomBytes } from "node:crypto";

import type { RowDataPacket } from "mysql2";
import mysql, { type Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MysqlNotificationRepository } from "../src/notifications/mysql-notification-repository.js";
import { NotificationService } from "../src/notifications/notification-service.js";
import { DirectorHostRequestService } from "../src/tournaments/director-host-request-service.js";
import { MysqlDirectorHostRequestRepository } from "../src/tournaments/mysql-director-host-request-repository.js";
import { MysqlTournamentOperatorCapabilityRepository } from "../src/tournaments/mysql-tournament-operator-capability-repository.js";

const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" &&
  (database.endsWith("_test") || database.endsWith("_contract"))
  ? describe
  : describe.skip;

integration("Request to host (ADR-0220)", () => {
  let pool: Pool;
  const tag = randomBytes(3).toString("hex");
  const asker = `user_account.host_asker_${tag}`;
  const administrator = `user_account.host_admin_${tag}`;
  const playerId = `player.host_asker_${tag}`;
  const now = 1_900_000_000_000;
  let clock = now;
  let sequence = 0;
  let service: DirectorHostRequestService;
  let capabilities: MysqlTournamentOperatorCapabilityRepository;

  const inbox = async (account: string): Promise<readonly RowDataPacket[]> => {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT notification.notification_kind AS kind, notification.detail, notification.aggregation_key AS aggregationKey,
              actor.public_id AS actorPlayerId
       FROM notifications AS notification
       INNER JOIN user_accounts AS account ON account.user_account_id = notification.user_account_id
       LEFT JOIN players AS actor ON actor.player_id = notification.actor_player_id
       WHERE account.public_id = ? ORDER BY notification.notification_id`,
      [account],
    );
    return rows;
  };

  beforeAll(async () => {
    pool = mysql.createPool({
      host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
      port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306"),
      user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "mk8dx_test",
      password: process.env["MK8DX_MYSQL_TEST_PASSWORD"] ?? "",
      database,
      connectionLimit: 3,
    });
    await pool.execute(
      `INSERT INTO user_accounts (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
       VALUES (?, 1, 'private', 'active', ?, ?), (?, 1, 'private', 'active', ?, ?)`,
      [asker, now, now, administrator, now, now],
    );
    await pool.execute(
      `INSERT INTO administrator_grants (public_id, revision, user_account_id, grant_status, grant_origin, granted_at_ms, updated_at_ms)
       SELECT ?, 1, user_account_id, 'active', 'administrator', ?, ? FROM user_accounts WHERE public_id = ?`,
      [`administrator_grant.host_${tag}`, now, now, administrator],
    );
    // The asker's verified Player, so the administrators' entry can name who asks.
    await pool.execute(
      `INSERT INTO players (public_id, revision, player_kind, display_name, record_status, created_at_ms, updated_at_ms)
       VALUES (?, 1, 'human', ?, 'active', ?, ?)`,
      [playerId, `Host Asker ${tag}`, now, now],
    );
    await pool.execute(
      `INSERT INTO player_username_history
       (player_id, sequence_number, username_value, comparison_key, allocated_at_ms, released_at_ms)
       SELECT player_id, 1, ?, ?, ?, NULL FROM players WHERE public_id = ?`,
      [`host_${tag}`, Buffer.from(`host_${tag}`), now, playerId],
    );
    await pool.execute(
      `INSERT INTO player_claims (public_id, revision, privacy_class, player_id, user_account_id, claim_status, dispute_status, created_at_ms, updated_at_ms)
       SELECT ?, 1, 'private', player.player_id, account.user_account_id, 'verified', 'none', ?, ?
       FROM players AS player INNER JOIN user_accounts AS account ON account.public_id = ?
       WHERE player.public_id = ?`,
      [`player_claim.host_${tag}`, now, now, asker, playerId],
    );
    capabilities = new MysqlTournamentOperatorCapabilityRepository(pool);
    const notifications = new NotificationService({
      repository: new MysqlNotificationRepository(pool),
      now: () => clock,
      onProducerError: (_context, error) => { throw error; },
    });
    service = new DirectorHostRequestService({
      repository: new MysqlDirectorHostRequestRepository(pool),
      hasTournamentOperation: (account) => capabilities.has(account),
      ids: {
        newRequestId: () => `director_host_request.host_${tag}_${(sequence += 1)}`,
        newGrantId: () => `account_capability_grant.host_${tag}_${(sequence += 1)}`,
      },
      clock: { nowMs: () => clock },
      notifier: {
        hostRequested: (requestId) => notifications.notifyHostRequested(requestId),
        hostRequestDecided: (requestId, account, decision) =>
          notifications.notifyHostRequestDecided(requestId, account, decision),
      },
    });
  });

  afterAll(async () => { await pool?.end(); });

  const person = () => ({ role: "account" as const, userAccountId: asker });
  const admin = () => ({ role: "administrator" as const, userAccountId: administrator });

  it("asks once, tells the administrators and refuses a second open request", async () => {
    const standing = await service.submit(person(), "I run the Friday nights in Utrecht");
    expect(standing).toMatchObject({
      administrator: false, director: false,
      request: { status: "open", note: "I run the Friday nights in Utrecht", requestedAtMs: now, decidedAtMs: null },
    });
    const requestId = standing.request!.requestId;
    expect(await inbox(administrator)).toEqual([
      { kind: "host_requested", detail: "requested", aggregationKey: `host_requested|${requestId}`, actorPlayerId: playerId },
    ]);
    await expect(service.submit(person(), undefined)).rejects.toMatchObject({ code: "already_open" });
    const queue = await service.queue(admin());
    const mine = queue.find((item) => item.requestId === requestId);
    expect(mine).toMatchObject({
      userAccountId: asker, accountCreatedAtMs: now, note: "I run the Friday nights in Utrecht",
      players: [{ playerId, displayName: `Host Asker ${tag}` }],
    });
  });

  it("declines with a reason; the person hears it and may ask again", async () => {
    const open = (await service.standing(person())).request!;
    clock = now + 60_000;
    await service.decline(admin(), open.requestId, "Run one night with us first");
    expect((await service.standing(person())).request).toMatchObject({
      requestId: open.requestId, status: "declined", declineReason: "Run one night with us first", decidedAtMs: now + 60_000,
    });
    expect((await inbox(asker)).map((row) => [row["kind"], row["detail"]])).toEqual([["host_request_decided", "declined"]]);
    await expect(service.decline(admin(), open.requestId, undefined)).rejects.toMatchObject({ code: "conflict" });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT decided_by.public_id AS decidedBy FROM director_host_requests AS request
       INNER JOIN user_accounts AS decided_by ON decided_by.user_account_id = request.decided_by_user_account_id
       WHERE request.public_id = ?`,
      [open.requestId],
    );
    expect(rows[0]!["decidedBy"]).toBe(administrator);
  });

  it("approves a new request through the audited grant and links the grant", async () => {
    clock = now + 120_000;
    const asked = await service.submit(person(), undefined);
    const requestId = asked.request!.requestId;
    expect(asked.request!.note).toBeNull();
    clock = now + 180_000;
    const decision = await service.approve(admin(), requestId);
    expect(decision).toEqual({ requestId, userAccountId: asker, status: "approved", decidedAtMs: now + 180_000 });
    expect(await capabilities.has(asker)).toBe(true);
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT grant_record.capability_code AS capability, lifecycle.reason_code AS reasonCode,
              actor.public_id AS grantedBy
       FROM director_host_requests AS request
       INNER JOIN account_capability_grants AS grant_record
         ON grant_record.account_capability_grant_id = request.account_capability_grant_id
       INNER JOIN account_capability_grant_lifecycle AS lifecycle
         ON lifecycle.account_capability_grant_id = grant_record.account_capability_grant_id
       INNER JOIN user_accounts AS actor ON actor.user_account_id = grant_record.granted_by_user_account_id
       WHERE request.public_id = ?`,
      [requestId],
    );
    expect(rows).toEqual([
      { capability: "tournament.operation", reasonCode: "director_host_request_approved", grantedBy: administrator },
    ]);
    expect((await service.standing(person()))).toMatchObject({ director: true, request: { status: "approved" } });
    expect((await inbox(asker)).map((row) => row["detail"])).toEqual(["declined", "approved"]);
    // A Director never asks again.
    await expect(service.submit(person(), undefined)).rejects.toMatchObject({ code: "already_director" });
  });

  it("enforces one open request per account in the schema itself", async () => {
    await capabilities.revoke({ userAccountId: asker, actorUserAccountId: administrator, reasonCode: "test_cleanup", occurredAtMs: now + 200_000 });
    const repository = new MysqlDirectorHostRequestRepository(pool);
    expect(await repository.insert({ requestId: `director_host_request.host_${tag}_raw1`, userAccountId: asker, note: null, nowMs: now + 210_000 })).toBe("created");
    expect(await repository.insert({ requestId: `director_host_request.host_${tag}_raw2`, userAccountId: asker, note: null, nowMs: now + 220_000 })).toBe("open_exists");
    expect(await repository.insert({ requestId: `director_host_request.host_${tag}_raw3`, userAccountId: `user_account.nobody_${tag}`, note: null, nowMs: now })).toBe("account_not_found");
    await expect(pool.execute(
      `UPDATE director_host_requests SET decline_reason = 'x' WHERE public_id = ?`, [`director_host_request.host_${tag}_raw1`],
    )).rejects.toThrow();
  });
});
