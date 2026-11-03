// ADR-0222 against a disposable MySQL/MariaDB with the whole catalog applied (migration 0082): the
// Director opens sign-up with a draw, three verified Players sign up (an account without a verified
// Player is refused), the first read after closing draws once from a stored seed that reproduces the
// result, everyone hears their outcome, a withdrawal moves the waiting list up and tells that
// Player, and the Director moves people by hand. Sign-ups write the existing roster rows.

import { randomBytes } from "node:crypto";

import type { RowDataPacket } from "mysql2";
import mysql, { type Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MysqlNotificationRepository } from "../src/notifications/mysql-notification-repository.js";
import { NotificationService } from "../src/notifications/notification-service.js";
import { insertTournamentOperationGrant } from "../src/tournaments/mysql-tournament-operator-capability-repository.js";
import { MysqlTournamentSignupRepository } from "../src/tournaments/mysql-tournament-signup-repository.js";
import { SIGNUP_DRAW_ALGORITHM, signupDrawOrder } from "../src/tournaments/tournament-signup-draw.js";
import { TournamentSignupService } from "../src/tournaments/tournament-signup-service.js";

const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" &&
  (database.endsWith("_test") || database.endsWith("_contract"))
  ? describe
  : describe.skip;

integration("Open sign-up (ADR-0222)", () => {
  let pool: Pool;
  const tag = randomBytes(3).toString("hex");
  const administrator = `user_account.signup_admin_${tag}`;
  const director = `user_account.signup_director_${tag}`;
  const nobody = `user_account.signup_nobody_${tag}`;
  const tournamentId = `tournament.signup_${tag}_friday`;
  const names = ["ada", "bo", "cy"] as const;
  const account = (name: string) => `user_account.signup_${name}_${tag}`;
  const player = (name: string) => `player.signup-${name}-${tag}`;
  const now = 1_900_000_000_000;
  let clock = now;
  let service: TournamentSignupService;
  let notifications: MysqlNotificationRepository;

  const roster = async (): Promise<Record<string, string>> => {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT player.public_id AS playerId, participant.attendance AS attendance,
              participant.has_switch_1 AS ns1, participant.has_switch_2 AS ns2
       FROM tournament_participants AS participant
       INNER JOIN players AS player ON player.player_id = participant.player_id
       INNER JOIN tournaments AS t ON t.tournament_id = participant.tournament_id
       WHERE t.public_id = ?`,
      [tournamentId],
    );
    return Object.fromEntries(rows.map((row) => [
      String(row["playerId"]), `${String(row["attendance"])}${Number(row["ns1"]) === 1 ? "+ns1" : ""}${Number(row["ns2"]) === 1 ? "+ns2" : ""}`,
    ]));
  };
  const inbox = async (who: string) => (await notifications.listForAccount(who)).notifications
    .map((entry) => ({ kind: entry.kind, detail: entry.detail, tournamentId: entry.tournamentId }));
  const as = (who: string) => ({ role: "account" as const, userAccountId: who });

  beforeAll(async () => {
    pool = mysql.createPool({
      host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
      port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306"),
      user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "mk8dx_test",
      password: process.env["MK8DX_MYSQL_TEST_PASSWORD"] ?? "",
      database,
      connectionLimit: 3,
    });
    for (const publicId of [administrator, director, nobody, ...names.map(account)]) {
      await pool.execute(
        `INSERT INTO user_accounts (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
         VALUES (?, 1, 'private', 'active', ?, ?)`,
        [publicId, now, now],
      );
    }
    await pool.execute(
      `INSERT INTO administrator_grants (public_id, revision, user_account_id, grant_status, grant_origin, granted_at_ms, updated_at_ms)
       SELECT ?, 1, user_account_id, 'active', 'administrator', ?, ? FROM user_accounts WHERE public_id = ?`,
      [`administrator_grant.signup_${tag}`, now, now, administrator],
    );
    const connection = await pool.getConnection();
    try {
      await insertTournamentOperationGrant(connection, {
        grantId: `account_capability_grant.signup_${tag}`, userAccountId: director,
        actorUserAccountId: administrator, reasonCode: "integration_test", occurredAtMs: now,
      });
    } finally {
      connection.release();
    }
    for (const name of names) {
      await pool.execute(
        `INSERT INTO players (public_id, revision, player_kind, display_name, record_status, created_at_ms, updated_at_ms)
         VALUES (?, 1, 'human', ?, 'active', ?, ?)`,
        [player(name), `Signup ${name} ${tag}`, now, now],
      );
      await pool.execute(
        `INSERT INTO player_claims (public_id, revision, privacy_class, player_id, user_account_id, claim_status, dispute_status, created_at_ms, updated_at_ms)
         SELECT ?, 1, 'private', player.player_id, account.user_account_id, 'verified', 'none', ?, ?
         FROM players AS player INNER JOIN user_accounts AS account ON account.public_id = ?
         WHERE player.public_id = ?`,
        [`player_claim.signup_${name}_${tag}`, now, now, account(name), player(name)],
      );
    }
    await pool.execute(
      `INSERT INTO tournaments (
         public_id, name, series_label, edition_number, event_date, start_at_ms, timezone_name,
         director_user_account_id, stage, workflow_step, qualifier_rounds, max_participants, revision,
         seed_order, placement_strategy, owner_seating_mode, public_results, affects_rating, created_at_ms, updated_at_ms
       ) SELECT ?, 'Sign-up Friday', NULL, NULL, NULL, ?, 'Europe/Amsterdam', user_account_id, 'setup', 2, TRUE, NULL, 1,
                'ranked', 'balanced', 'owner_strict', TRUE, TRUE, ?, ?
         FROM user_accounts WHERE public_id = ?`,
      [tournamentId, now + 7 * 86_400_000, now, now, director],
    );
    // The Director's default roster: Cy raced an earlier night and is prefilled Absent.
    await pool.execute(
      `INSERT INTO tournament_participants (tournament_id, player_id, attendance, has_switch_1, has_switch_2, added_at_ms, updated_at_ms)
       SELECT t.tournament_id, player.player_id, 'absent', FALSE, FALSE, ?, ?
       FROM tournaments AS t INNER JOIN players AS player ON player.public_id = ? WHERE t.public_id = ?`,
      [now, now, player("cy"), tournamentId],
    );
    notifications = new MysqlNotificationRepository(pool);
    const notifier = new NotificationService({
      repository: notifications,
      now: () => clock,
      onProducerError: (_context, error) => { throw error; },
    });
    service = new TournamentSignupService({
      repository: new MysqlTournamentSignupRepository(pool),
      clock: { nowMs: () => clock },
      notifier: { signupChanged: (notice) => notifier.notifyTournamentSignup(notice) },
    });
  });

  afterAll(async () => { await pool?.end(); });

  it("opens sign-up, refuses an account without a verified Player and writes the roster", async () => {
    const board = await service.configure(as(director), tournamentId, {
      mode: "open", selection: "draw", closesAtMs: now + 3_600_000, capacity: 2,
    });
    expect(board.settings).toMatchObject({ mode: "open", selection: "draw", status: "open", capacity: 2 });
    await expect(service.signUp(as(nobody), tournamentId, { hasSwitch1: true, hasSwitch2: false }))
      .rejects.toMatchObject({ code: "no_verified_player" });
    await expect(service.configure(as(account("ada")), tournamentId, { mode: "director" }))
      .rejects.toMatchObject({ code: "forbidden" });
    for (const [name, ns1, ns2] of [["ada", true, false], ["bo", false, true], ["cy", false, false]] as const) {
      clock += 1_000;
      const signed = await service.signUp(as(account(name)), tournamentId, { hasSwitch1: ns1, hasSwitch2: ns2 });
      expect(signed.viewer).toMatchObject({ state: "pending", playerId: player(name) });
    }
    expect(await roster()).toEqual({
      [player("ada")]: "absent+ns1", [player("bo")]: "absent+ns2", [player("cy")]: "absent",
    });
    const [cables] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cables FROM tournament_station_cables AS cable
       INNER JOIN players AS player ON player.player_id = cable.owner_player_id WHERE player.public_id IN (?, ?)`,
      [player("ada"), player("bo")],
    );
    expect(Number(cables[0]!["cables"])).toBe(2);
    const read = await service.board(as(director), tournamentId);
    expect(read.consoles).toEqual({ players: 2, coming: 2, needed: 1, warning: false });
    expect(read.entries.map((entry) => entry.status)).toEqual(["pending", "pending", "pending"]);
  });

  it("draws once at the first read after closing, reproducibly from the published seed", async () => {
    clock = now + 3_600_000;
    const closed = await service.status({ role: "anonymous" }, tournamentId);
    expect(closed).toMatchObject({ status: "closed", drawAlgorithm: SIGNUP_DRAW_ALGORITHM, taken: 2 });
    expect(closed.drawSeed).toMatch(/^[0-9a-f]{64}$/);
    const order = signupDrawOrder(closed.drawSeed!, names.map(player));
    expect(await roster()).toEqual({
      [order[0]!]: expect.stringMatching(/^present/),
      [order[1]!]: expect.stringMatching(/^present/),
      [order[2]!]: expect.stringMatching(/^waiting/),
    });
    expect(closed.waiting.map((entry) => entry.playerId)).toEqual([order[2]]);
    // Read again: still the same seed, one closing in the lifecycle.
    expect((await service.status({ role: "anonymous" }, tournamentId)).drawSeed).toBe(closed.drawSeed);
    const [lifecycle] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS closings FROM tournament_lifecycle AS event
       INNER JOIN tournaments AS t ON t.tournament_id = event.tournament_id
       WHERE t.public_id = ? AND event.event_type = 'signup_closed'`,
      [tournamentId],
    );
    expect(Number(lifecycle[0]!["closings"])).toBe(1);
    const nameOf = (playerId: string) => names.find((name) => player(name) === playerId)!;
    for (const [index, detail] of [[0, "selected"], [1, "selected"], [2, "waiting"]] as const) {
      expect(await inbox(account(nameOf(order[index]!)))).toEqual([
        { kind: "tournament_signup_selected", detail, tournamentId },
      ]);
    }
    expect((await service.status(as(account(nameOf(order[2]!))), tournamentId)).viewer)
      .toMatchObject({ state: "waiting", waitingPosition: 1, canWithdraw: true, canChangeConsoles: false });
  });

  it("moves the waiting list up after a withdrawal and tells that Player", async () => {
    const before = await service.status({ role: "anonymous" }, tournamentId);
    const order = signupDrawOrder(before.drawSeed!, names.map(player));
    const nameOf = (playerId: string) => names.find((name) => player(name) === playerId)!;
    clock += 60_000;
    const withdrawn = await service.withdraw(as(account(nameOf(order[0]!))), tournamentId);
    expect(withdrawn.viewer.state).toBe("withdrawn");
    expect((await roster())[order[0]!]).toMatch(/^absent/);
    expect((await roster())[order[2]!]).toMatch(/^present/);
    expect((await inbox(account(nameOf(order[2]!)))).map((entry) => entry.kind))
      .toEqual(expect.arrayContaining(["tournament_signup_moved_up", "tournament_signup_selected"]));
  });

  it("lets the Director move people by hand, within the schema's own rules", async () => {
    const before = await service.status({ role: "anonymous" }, tournamentId);
    const order = signupDrawOrder(before.drawSeed!, names.map(player));
    const nameOf = (playerId: string) => names.find((name) => player(name) === playerId)!;
    clock += 60_000;
    let board = await service.move(as(director), tournamentId, { playerId: order[1]!, to: "waiting", position: 1 });
    expect(board.entries.find((entry) => entry.playerId === order[1])).toMatchObject({ status: "waiting", position: 1, attendance: "waiting" });
    board = await service.move(as(director), tournamentId, { playerId: order[1]!, to: "removed" });
    expect(board.entries.find((entry) => entry.playerId === order[1])).toMatchObject({ status: "removed", position: null, attendance: "absent" });
    expect((await inbox(account(nameOf(order[1]!)))).map((entry) => [entry.kind, entry.detail]))
      .toEqual(expect.arrayContaining([["tournament_signup_removed", "removed"]]));
    await expect(service.signUp(as(account(nameOf(order[1]!))), tournamentId, { hasSwitch1: false, hasSwitch2: false }))
      .rejects.toMatchObject({ code: "closed" });
    await expect(pool.execute(
      `UPDATE tournament_signups SET signup_status = 'waiting', queue_position = NULL
       WHERE player_id = (SELECT player_id FROM players WHERE public_id = ?)`,
      [order[1]!],
    )).rejects.toThrow();
    await expect(pool.execute(
      `UPDATE tournament_signup_settings SET draw_seed = 'NOT-HEX'
       WHERE tournament_id = (SELECT tournament_id FROM tournaments WHERE public_id = ?)`,
      [tournamentId],
    )).rejects.toThrow();
  });
});
