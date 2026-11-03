import mysql, { type Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CORRECTIONS_ARTIFACT_KIND,
  buildHistory,
  type CorrectionsDocument,
} from "../src/tournament-history/history-corrections.js";
import {
  readLegacyRaces,
  writeHistory,
} from "../src/tournament-history/history-build-main.js";

const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
const integration = database.endsWith("_test") || database.endsWith("_contract")
  ? describe
  : describe.skip;

// Two players, one qualification group of two, three races. Small enough to
// read, large enough to exercise everything a rebuild has to get right: a
// renumbering, an inserted race, preserved manual links, and the guarantee
// that no legacy placement is lost on the way through.
const SECTION = "TN99: Poule A";

integration("history build against MySQL", () => {
  let pool: Pool;
  const players: number[] = [];

  beforeAll(async () => {
    pool = mysql.createPool({
      host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
      port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? 3306),
      user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "root",
      password: process.env["MK8DX_MYSQL_TEST_PASSWORD"] ?? "",
      database,
      multipleStatements: false,
    });
    for (const name of ["History Test One", "History Test Two"]) {
      const [result] = await pool.execute(
        `INSERT INTO players
           (public_id, revision, player_kind, display_name, record_status,
            created_at_ms, updated_at_ms, visibility)
         VALUES (?, 1, 'human', ?, 'active', 0, 0, 'public')`,
        [`player.hist-${name.replace(/\W+/gu, "-").toLowerCase()}-${Date.now()}`,
          name],
      );
      players.push((result as { insertId: number }).insertId);
    }
    for (let raceIndex = 1; raceIndex <= 3; raceIndex += 1) {
      const [race] = await pool.execute(
        `INSERT INTO legacy_tournament_races
           (race_sequence, tournament_number, section_label, race_index)
         VALUES (?, 99, ?, ?)`,
        [90000 + raceIndex, SECTION, raceIndex],
      );
      const raceId = (race as { insertId: number }).insertId;
      for (const [offset, playerId] of players.entries()) {
        await pool.execute(
          `INSERT INTO legacy_race_placements
             (legacy_tournament_race_id, player_id, finish_position,
              score_after, score_delta)
           VALUES (?, ?, ?, '25.00', NULL)`,
          [raceId, playerId, offset + 1],
        );
      }
    }
  });

  afterAll(async () => {
    await pool.execute(
      `DELETE placement FROM legacy_race_placements AS placement
       JOIN legacy_tournament_races AS race
         ON race.legacy_tournament_race_id
            = placement.legacy_tournament_race_id
       WHERE race.section_label = ?`, [SECTION]);
    await pool.execute(
      "DELETE FROM legacy_tournament_races WHERE section_label = ?", [SECTION]);
    await pool.end();
  });

  function corrections(): CorrectionsDocument {
    return {
      artifactKind: CORRECTIONS_ARTIFACT_KIND,
      producerVersion: "integration-test",
      raceOrderCorrections: [{
        tournamentNumber: 99, legacySectionLabel: SECTION,
        legacyRaceIndex: 3, raceIndex: 1, reason: "played first",
      }],
      races: [{
        tournamentNumber: 99, legacySectionLabel: SECTION, raceIndex: 4,
        legacyRaceIndex: null, origin: "video_recovered",
        countsTowardRating: false,
        exclusionReason: "field of 1 in a group of 2",
        trackId: "track.baby_park", evidence: null,
        placements: [{
          finishPosition: 1, playerId: players[0]!, observedName: "Bloomie",
          characterId: "character.waluigi", racePoints: 15,
          totalAfterRace: 15, rankAfterRace: 1,
        }],
      }],
      identityLinks: [{
        tournamentNumber: 99, legacySectionLabel: SECTION,
        observedName: "Bloomie", playerId: players[0]!,
        decisionSource: "derived", orderAgreement: 1, videoPoints: 15,
        historyPoints: 15,
      }],
    };
  }

  async function rebuild(): Promise<void> {
    const legacy = (await readLegacyRaces(pool))
      .filter((race) => race.sectionLabel === SECTION);
    const built = buildHistory(legacy, corrections());
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await writeHistory(connection, built, corrections().identityLinks, 1_000);
      await connection.commit();
    } finally {
      connection.release();
    }
  }

  it("writes the corrected order and loses no legacy placement", async () => {
    await rebuild();
    const [races] = await pool.execute<RowDataPacket[]>(
      `SELECT race.race_index AS raceIndex,
              race.legacy_race_index AS legacyRaceIndex,
              race.origin AS origin,
              race.counts_toward_rating AS counts
       FROM tournament_history_races AS race
       JOIN tournament_history_sections AS section
         ON section.tournament_history_section_id
            = race.tournament_history_section_id
       WHERE section.legacy_section_label = ?
       ORDER BY race.race_index`, [SECTION]);
    expect(races.map((row) => [row["raceIndex"], row["legacyRaceIndex"]]))
      .toEqual([[1, 3], [2, 1], [3, 2], [4, null]]);
    expect(races[3]!["origin"]).toBe("video_recovered");
    expect(Number(races[3]!["counts"])).toBe(0);

    const [counts] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM tournament_history_placements AS placement
       JOIN tournament_history_races AS race
         ON race.tournament_history_race_id
            = placement.tournament_history_race_id
       JOIN tournament_history_sections AS section
         ON section.tournament_history_section_id
            = race.tournament_history_section_id
       WHERE section.legacy_section_label = ?`, [SECTION]);
    // Six legacy placements plus the one seat of the recovered race.
    expect(Number(counts[0]!["total"])).toBe(7);
  });

  it("keeps a hand-made link when the history is rebuilt", async () => {
    await rebuild();
    const [sections] = await pool.execute<RowDataPacket[]>(
      `SELECT tournament_history_section_id AS id
       FROM tournament_history_sections WHERE legacy_section_label = ?`,
      [SECTION]);
    const sectionId = Number(sections[0]!["id"]);
    await pool.execute(
      `UPDATE tournament_observed_identity_links
       SET player_id = ?, decision_source = 'manual', note = 'owner corrected'
       WHERE tournament_history_section_id = ? AND observed_name = 'Bloomie'`,
      [players[1]!, sectionId]);

    await rebuild();

    const [links] = await pool.execute<RowDataPacket[]>(
      `SELECT link.player_id AS playerId, link.decision_source AS source,
              link.note AS note
       FROM tournament_observed_identity_links AS link
       JOIN tournament_history_sections AS section
         ON section.tournament_history_section_id
            = link.tournament_history_section_id
       WHERE section.legacy_section_label = ?`, [SECTION]);
    expect(links).toHaveLength(1);
    // A rebuild must not quietly put the binder's answer back.
    expect(Number(links[0]!["playerId"])).toBe(players[1]);
    expect(links[0]!["source"]).toBe("manual");
    expect(links[0]!["note"]).toBe("owner corrected");
  });
});
