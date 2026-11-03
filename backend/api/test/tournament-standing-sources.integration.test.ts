import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

import { MysqlTournamentStandingRepository } from
  "../src/tournaments/mysql-tournament-standing-repository.js";

/**
 * Which completed Tournaments the ranking counts.
 *
 * The community's own history - TN4 to TN12 - is read from the corrected
 * history tables, and events run since the migration land in the canonical ones.
 * Counting only the canonical side made the public ranking describe whatever
 * happened to be finalized there, which for months was two QA Tournaments and
 * nothing else. These cases pin all three rules at once: legacy history counts,
 * canonical finalized Tournaments count, and a removed Tournament stops
 * counting.
 */
const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" ? describe : describe.skip;

const directorId = "user_account.synthetic_standing_director";
const tournamentId = "tournament.synthetic_standing";
const groupId = "tournament_group.synthetic_standing_one";
const players = ["player.synthetic_standing_one", "player.synthetic_standing_two"];
const raceResultId = "tournament_race_result.synthetic_standing_1";
const historyTournamentNumber = 999;

integration("the Tournament ranking counts both eras", () => {
  let pool: Pool;
  let repository: MysqlTournamentStandingRepository;

  const find = async (playerId: string) =>
    (await repository.listStanding(200)).find((row) => row.playerId === playerId) ?? null;

  const setLifecycle = async (status: "active" | "retracted") => {
    await pool.execute(
      "UPDATE tournaments SET lifecycle_status = ? WHERE public_id = ?", [status, tournamentId]);
  };

  beforeAll(async () => {
    const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
    if (!database.endsWith("_test") && !database.endsWith("_contract")) {
      throw new Error("explicit test schema required");
    }
    const options: PoolOptions = {
      host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
      port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306"),
      user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "mk8dx_test",
      database,
    };
    if (process.env["MK8DX_MYSQL_TEST_PASSWORD"] !== undefined) {
      options.password = process.env["MK8DX_MYSQL_TEST_PASSWORD"];
    }
    pool = mysql.createPool(options);
    repository = new MysqlTournamentStandingRepository(pool);

    await pool.execute(
      `INSERT INTO user_accounts (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
       VALUES (?, 1, 'private', 'active', 1, 1)`, [directorId]);
    for (const [index, playerId] of players.entries()) {
      await pool.execute(
        `INSERT INTO players (public_id, revision, player_kind, display_name, record_status, visibility, created_at_ms, updated_at_ms)
         VALUES (?, 1, 'human', ?, 'active', 'public', 1, 1)`,
        [playerId, `Standing ${index + 1}`]);
      await pool.execute(
        `INSERT INTO player_username_history (player_id, sequence_number, username_value, comparison_key, allocated_at_ms)
         SELECT player_id, 1, ?, ?, 1 FROM players WHERE public_id = ?`,
        [`standing${index + 1}`, `standing${index + 1}`, playerId]);
    }

    // One corrected history race, as the production standing reads TN4-TN12.
    await pool.execute(
      `INSERT INTO tournament_history_sections
       (tournament_number, stage, sequence_number, display_name, legacy_section_label, roster_size)
       VALUES (?, 'final', 1, 'Kampioen', 'TN999: Synthetic standing', 2)`,
      [historyTournamentNumber]);
    await pool.execute(
      `INSERT INTO tournament_history_races
       (tournament_history_section_id, race_index, race_sequence, legacy_race_index, origin)
       SELECT tournament_history_section_id, 1, 99001, 1, 'legacy'
         FROM tournament_history_sections WHERE tournament_number = ?`,
      [historyTournamentNumber]);
    for (const [index, playerId] of players.entries()) {
      await pool.execute(
        `INSERT INTO tournament_history_placements
         (tournament_history_race_id, player_id, finish_position, race_points)
         SELECT race.tournament_history_race_id, player.player_id, ?, ?
           FROM tournament_history_races AS race
           INNER JOIN tournament_history_sections AS section
             ON section.tournament_history_section_id = race.tournament_history_section_id
           CROSS JOIN players AS player
          WHERE section.tournament_number = ? AND player.public_id = ?`,
        [index + 1, 15 - index * 3, historyTournamentNumber, playerId]);
    }

    // One canonical finalized Tournament with one attached race.
    await pool.execute(
      `INSERT INTO tournaments (
         public_id, name, start_at_ms, timezone_name, director_user_account_id, stage,
         lifecycle_status, workflow_step, qualifier_rounds, revision, seed_order,
         placement_strategy, public_results, affects_rating, finalized_at_ms,
         created_at_ms, updated_at_ms
       ) SELECT ?, 'Standing integration', 1900000000000, 'Europe/Amsterdam', user_account_id,
                'finalized', 'active', 10, TRUE, 1, 'ranked', 'balanced', FALSE, FALSE,
                1900000000000, 1, 1
           FROM user_accounts WHERE public_id = ?`, [tournamentId, directorId]);
    await pool.execute(
      `INSERT INTO tournament_groups (tournament_id, public_id, stage, sequence_number, name, locked, manual_score_segments, created_at_ms, updated_at_ms)
       SELECT tournament_id, ?, 'qualifier', 1, 'Groep 1', TRUE, 1, 1, 1
         FROM tournaments WHERE public_id = ?`, [groupId, tournamentId]);
    await pool.execute(
      "INSERT INTO tournament_race_results (public_id, first_created_at_ms) VALUES (?, 1900000000000)",
      [raceResultId]);
    await pool.execute(
      `INSERT INTO tournament_race_result_revisions (
         tournament_race_result_id, revision_number, schema_version, race_number,
         scoring_segment, track_id, counts_toward_standings, source_kind,
         source_transport, occurred_at_ms, created_at_ms, submitted_at_ms
       ) SELECT tournament_race_result_id, 1, 'mk8dx.tournament-race-result.v1', 1, 1,
                'track.mario_kart_stadium', 1, 'tournament_live_capture', 'native_contract',
                1900000000000, 1900000000000, 1900000000000
           FROM tournament_race_results WHERE public_id = ?`, [raceResultId]);
    for (const [index, playerId] of players.entries()) {
      await pool.execute(
        `INSERT INTO tournament_race_placements (
           tournament_race_result_revision_id, finish_position, participant_reference_kind,
           player_id, race_points, total_before_race, total_after_race, rank_after_race
         ) SELECT revision.tournament_race_result_revision_id, ?, 'player', player.player_id, ?, 0, ?, ?
             FROM tournament_race_result_revisions revision
             JOIN tournament_race_results result
               ON result.tournament_race_result_id = revision.tournament_race_result_id
             JOIN players player ON player.public_id = ?
            WHERE result.public_id = ?`,
        [index + 1, 15 - index * 3, 15 - index * 3, index + 1, playerId, raceResultId]);
    }
    await pool.execute(
      `INSERT INTO tournament_group_races (tournament_group_id, race_number, tournament_race_result_id, created_at_ms)
       SELECT g.tournament_group_id, 1, r.tournament_race_result_id, 1
         FROM tournament_groups g JOIN tournament_race_results r ON r.public_id = ?
        WHERE g.public_id = ?`, [raceResultId, groupId]);
  });

  afterAll(async () => {
    await pool.execute(
      `DELETE placement FROM tournament_race_placements placement
         JOIN tournament_race_result_revisions revision
           ON revision.tournament_race_result_revision_id = placement.tournament_race_result_revision_id
         JOIN tournament_race_results result
           ON result.tournament_race_result_id = revision.tournament_race_result_id
        WHERE result.public_id = ?`, [raceResultId]);
    await pool.execute(
      `DELETE race FROM tournament_group_races race
         JOIN tournament_race_results result
           ON result.tournament_race_result_id = race.tournament_race_result_id
        WHERE result.public_id = ?`, [raceResultId]);
    await pool.execute(
      `DELETE revision FROM tournament_race_result_revisions revision
         JOIN tournament_race_results result
           ON result.tournament_race_result_id = revision.tournament_race_result_id
        WHERE result.public_id = ?`, [raceResultId]);
    await pool.execute("DELETE FROM tournament_race_results WHERE public_id = ?", [raceResultId]);
    await pool.execute(
      `DELETE g FROM tournament_groups g JOIN tournaments t ON t.tournament_id = g.tournament_id
        WHERE t.public_id = ?`, [tournamentId]);
    await pool.execute("DELETE FROM tournaments WHERE public_id = ?", [tournamentId]);
    await pool.execute(
      `DELETE placement FROM tournament_history_placements AS placement
       INNER JOIN tournament_history_races AS race
         ON race.tournament_history_race_id = placement.tournament_history_race_id
       INNER JOIN tournament_history_sections AS section
         ON section.tournament_history_section_id = race.tournament_history_section_id
       WHERE section.tournament_number = ?`, [historyTournamentNumber]);
    await pool.execute(
      `DELETE race FROM tournament_history_races AS race
       INNER JOIN tournament_history_sections AS section
         ON section.tournament_history_section_id = race.tournament_history_section_id
       WHERE section.tournament_number = ?`, [historyTournamentNumber]);
    await pool.execute(
      "DELETE FROM tournament_history_sections WHERE tournament_number = ?", [historyTournamentNumber]);
    await pool.execute(
      `DELETE h FROM player_username_history h JOIN players p ON p.player_id = h.player_id
        WHERE p.public_id IN (?, ?)`, players);
    await pool.execute("DELETE FROM players WHERE public_id IN (?, ?)", players);
    await pool.execute("DELETE FROM user_accounts WHERE public_id = ?", [directorId]);
    await pool.end();
  });

  it("counts the imported TN history, not only canonical Tournaments", async () => {
    await setLifecycle("active");
    const winner = await find(players[0]!);
    expect(winner).not.toBeNull();
    // One corrected history race (15 points) plus one canonical race (15), and
    // the two eras are two distinct Tournaments.
    expect(winner!.races).toBe(2);
    expect(winner!.tournaments).toBe(2);
    expect(winner!.points).toBe(30);
    expect(winner!.wins).toBe(2);
  });

  it("stops counting a Tournament that has been removed, and counts it again when restored", async () => {
    await setLifecycle("retracted");
    const removed = await find(players[0]!);
    // Only the corrected history race survives: removal hides the canonical Tournament.
    expect(removed!.races).toBe(1);
    expect(removed!.tournaments).toBe(1);
    expect(removed!.points).toBe(15);

    await setLifecycle("active");
    const restored = await find(players[0]!);
    expect(restored!.races).toBe(2);
    expect(restored!.tournaments).toBe(2);
  });

  it("keeps the head-to-head record consistent with the standing", async () => {
    await setLifecycle("active");
    const rivalries = await repository.listRivalries(players[0]!, 10);
    const opponent = rivalries.find((row) => row.playerId === players[1]);
    expect(opponent).toBeDefined();
    // Two shared races across the two eras, both won by the first Player.
    expect(opponent!.sharedRaces).toBe(2);
    expect(opponent!.ahead).toBe(2);
    expect(opponent!.behind).toBe(0);
    expect(opponent!.averagePointsDelta).toBe(3);
  });
});
