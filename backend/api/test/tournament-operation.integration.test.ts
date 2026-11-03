// End-to-end tournament night against a disposable MySQL (ADR-0160):
// create -> participants/attendance -> qualifier groups + seating -> race
// entry (canonical V1 through the real submission service) -> correction ->
// finals -> finalize with Public Results OFF / Affects TrueSkill OFF, then
// results visibility ON, then a second tournament with rating ON applied
// exactly once (idempotent re-finalize), all through the real repositories.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  EDITION_NUMBER_MISSING,
  EDITION_NUMBER_REQUIRED,
  TournamentOperationService,
} from "../src/tournaments/tournament-operation-service.js";
import { MysqlTournamentOperationRepository } from
  "../src/tournaments/mysql-tournament-operation-repository.js";
import { TournamentRaceResultService } from "../src/tournaments/race-result-service.js";
import { MysqlTournamentWriteRepository } from
  "../src/tournaments/mysql-tournament-write-repository.js";
import { TournamentPublicationService } from
  "../src/tournaments/tournament-publication-service.js";
import { MysqlTournamentPublicationRepository } from
  "../src/tournaments/mysql-tournament-publication-repository.js";
import { MysqlPublicTournamentRepository } from
  "../src/tournaments/mysql-public-tournament-repository.js";
import { RatingLifecycleService } from "../src/rating/rating-lifecycle-service.js";
import { MysqlRatingLifecycleRepository } from
  "../src/rating/mysql-rating-lifecycle-repository.js";
import { MysqlLegacyHistoryRepository } from
  "../src/rating/mysql-legacy-history-repository.js";
import type { TournamentAssetCatalog } from "../src/tournaments/race-result-service.js";
import type {
  TournamentProtectedLookupValue,
  TournamentProtectedValue,
  TournamentSensitiveValueProtector,
} from "../src/tournaments/race-result-service.js";

const pinnedMigrationCatalogLength = (JSON.parse(readFileSync(
  fileURLToPath(new URL("../../../infrastructure/mysql/migration-catalog-v1.json", import.meta.url)),
  "utf8",
)) as { migrations: readonly unknown[] }).migrations.length;

const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" ? describe : describe.skip;
const administrator = {
  role: "administrator" as const,
  userAccountId: "user_account.synthetic_tournament_operation_admin",
};
const account = { role: "account" as const, userAccountId: "user_account.synthetic_tournament_operation_member" };
const anonymous = { role: "anonymous" as const };
const playerIds = Array.from({ length: 8 }, (_, index) =>
  `player.synthetic_operation_racer_${String(index + 1).padStart(2, "0")}`);

class AcceptingCatalog implements TournamentAssetCatalog {
  async validateReferences(): Promise<readonly string[]> { return []; }
}
class DeterministicProtector implements TournamentSensitiveValueProtector {
  private lookup(byte: number): TournamentProtectedLookupValue {
    return {
      lookupHmac: new Uint8Array(32).fill(byte),
      lookupKeyVersion: "test-lookup-v1",
      ciphertext: new Uint8Array([byte, byte + 1]),
      encryptionKeyVersion: "test-encryption-v1",
    };
  }
  async protectParticipantReference(): Promise<TournamentProtectedLookupValue> { return this.lookup(0x11); }
  async protectContextReference(): Promise<TournamentProtectedLookupValue> { return this.lookup(0x22); }
  async protectEvidenceReference(): Promise<TournamentProtectedValue> {
    return { ciphertext: new Uint8Array([0x33, 0x34]), encryptionKeyVersion: "test-encryption-v1" };
  }
  async protectVerificationIssueMessage(): Promise<TournamentProtectedValue> {
    return { ciphertext: new Uint8Array([0x44, 0x45]), encryptionKeyVersion: "test-encryption-v1" };
  }
}

integration("canonical tournament operation integration", () => {
  let pool: Pool;
  let service: TournamentOperationService;
  let rating: RatingLifecycleService;
  let publicRepository: MysqlPublicTournamentRepository;
  let history: MysqlLegacyHistoryRepository;
  let now = 1_900_000_000_000;
  let sequence = 0;
  let legacyHistorySeeded = false;
  const tournamentIds: string[] = [];
  const publicationIds: string[] = [];

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
      connectionLimit: 3,
    };
    const password = process.env["MK8DX_MYSQL_TEST_PASSWORD"];
    if (password !== undefined) { options.password = password; }
    pool = mysql.createPool(options);
    const clock = { nowMs: () => (now += 1000) };
    rating = new RatingLifecycleService(new MysqlRatingLifecycleRepository(pool), clock);
    service = new TournamentOperationService({
      repository: new MysqlTournamentOperationRepository(pool),
      raceResults: new TournamentRaceResultService(
        new MysqlTournamentWriteRepository(pool), new AcceptingCatalog(), new DeterministicProtector(),
      ),
      publications: new TournamentPublicationService(
        new MysqlTournamentPublicationRepository(pool),
        { newPublicationId: () => {
          const id = `tournament_publication.synthetic_operation_${String(++sequence).padStart(3, "0")}`;
          publicationIds.push(id);
          return id;
        } },
        clock,
      ),
      rating,
      ids: {
        newTournamentId: () => {
          const id = `tournament.synthetic_operation_${String(++sequence).padStart(3, "0")}`;
          tournamentIds.push(id);
          return id;
        },
        newGroupId: () => `tournament_group.synthetic_operation_${String(++sequence).padStart(3, "0")}`,
      },
      clock,
      random: () => 0.5,
    });
    publicRepository = new MysqlPublicTournamentRepository(pool);
    history = new MysqlLegacyHistoryRepository(pool);
    const [migrations] = await pool.execute<any[]>(
      "SELECT migration_version FROM schema_migrations ORDER BY migration_version",
    );
    expect(migrations).toHaveLength(pinnedMigrationCatalogLength);
    for (const [index, playerId] of playerIds.entries()) {
      await pool.execute(
        `INSERT INTO players (public_id, revision, player_kind, display_name, record_status, created_at_ms, updated_at_ms)
         VALUES (?, 1, 'human', ?, 'active', 1, 1)`,
        [playerId, `Operation Racer ${index + 1}`],
      );
      await pool.execute(
        `INSERT INTO player_username_history (player_id, sequence_number, username_value, comparison_key, allocated_at_ms)
         SELECT player_id, 1, ?, ?, 1 FROM players WHERE public_id = ?`,
        [`oprracer${index + 1}`, Buffer.from(`oprracer${index + 1}`), playerId],
      );
    }
    // The last Player is private: their placements must stay, their identity must not leak publicly.
    await pool.execute("UPDATE players SET visibility = 'private' WHERE public_id = ?", [playerIds[7]!]);
    for (const [publicId, grant] of [[administrator.userAccountId, true], [account.userAccountId, false]] as const) {
      await pool.execute(
        `INSERT INTO user_accounts (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
         VALUES (?, 1, 'private', 'active', 1, 1)`,
        [publicId],
      );
      if (grant) {
        await pool.execute(
          `INSERT INTO administrator_grants (public_id, revision, user_account_id, grant_status, grant_origin, granted_at_ms, updated_at_ms)
           SELECT 'administrator_grant.synthetic_tournament_operation_admin', 1, user_account_id, 'active', 'bootstrap_cli', 1, 1
           FROM user_accounts WHERE public_id = ?`,
          [publicId],
        );
      }
    }
    // Seed real finalized attendance history. The first seven participated in
    // canonical Tournaments; the eighth exists only in the already imported
    // TN4-TN12 corrected race history. New Step 2 rosters must contain all eight
    // as Absent and mark only the old history Player Inactive.
    const oldHistoryId = "tournament.synthetic_operation_history_old";
    const recentHistoryId = "tournament.synthetic_operation_history_recent";
    const latestHistoryId = "tournament.synthetic_operation_history_latest";
    tournamentIds.push(oldHistoryId, recentHistoryId, latestHistoryId);
    const insertHistory = async (publicId: string, name: string, startAtMs: number): Promise<void> => {
      await pool.execute(
        `INSERT INTO tournaments (
           public_id, name, series_label, edition_number, event_date, start_at_ms, timezone_name,
           director_user_account_id, stage, workflow_step, qualifier_rounds, max_participants,
           revision, seed_order, placement_strategy, public_results, affects_rating,
           finalized_at_ms, created_at_ms, updated_at_ms
         ) SELECT ?, ?, 'Synthetic history', NULL, NULL, ?, 'Europe/Amsterdam',
                  user_account_id, 'finalized', 10, TRUE, 60,
                  1, 'ranked', 'balanced', FALSE, FALSE, ?, ?, ?
           FROM user_accounts WHERE public_id = ?`,
        [publicId, name, startAtMs, startAtMs + 1_000, startAtMs, startAtMs + 1_000, administrator.userAccountId],
      );
    };
    const oldStart = now - 120 * 24 * 60 * 60 * 1_000;
    const recentStart = now - 30 * 24 * 60 * 60 * 1_000;
    const latestStart = now - 10 * 24 * 60 * 60 * 1_000;
    await pool.execute(
      `INSERT INTO legacy_tournament_events (tournament_number, event_date, held_at_ms)
       VALUES (999, '2025-01-01', ?)`, [oldStart - 100 * 24 * 60 * 60 * 1_000],
    );
    await insertHistory(oldHistoryId, "Synthetic old history", oldStart);
    await insertHistory(recentHistoryId, "Synthetic recent history", recentStart);
    await insertHistory(latestHistoryId, "Synthetic latest history", latestStart);
    await pool.execute(
      `INSERT INTO tournament_participants (
         tournament_id, player_id, attendance, has_switch_1, has_switch_2,
         seed_score, seed_rank, added_at_ms, updated_at_ms
       ) SELECT tournament.tournament_id, player.player_id, 'present', FALSE, FALSE,
                NULL, NULL, ?, ?
           FROM tournaments AS tournament
           CROSS JOIN players AS player
          WHERE tournament.public_id = ?
             AND player.public_id IN (${playerIds.slice(0, 7).map(() => "?").join(", ")})`,
      [oldStart, oldStart, oldHistoryId, ...playerIds.slice(0, 7)],
    );
    await pool.execute(
      `INSERT INTO tournament_participants (
         tournament_id, player_id, attendance, has_switch_1, has_switch_2,
         seed_score, seed_rank, added_at_ms, updated_at_ms
       ) SELECT tournament.tournament_id, player.player_id, 'present', FALSE, FALSE,
                NULL, NULL, ?, ?
           FROM tournaments AS tournament
           CROSS JOIN players AS player
          WHERE tournament.public_id = ?
            AND player.public_id IN (${playerIds.slice(0, 7).map(() => "?").join(", ")})`,
      [recentStart, recentStart, recentHistoryId, ...playerIds.slice(0, 7)],
    );
    await pool.execute(
      `INSERT INTO tournament_participants (
         tournament_id, player_id, attendance, has_switch_1, has_switch_2,
         seed_score, seed_rank, added_at_ms, updated_at_ms
       ) SELECT tournament.tournament_id, player.player_id, 'present', FALSE, FALSE,
                NULL, NULL, ?, ?
           FROM tournaments AS tournament
           CROSS JOIN players AS player
          WHERE tournament.public_id = ?
            AND player.public_id IN (${playerIds.slice(0, 7).map(() => "?").join(", ")})`,
      [latestStart, latestStart, latestHistoryId, ...playerIds.slice(0, 7)],
    );
    await pool.execute(
      `INSERT INTO tournament_history_sections
         (tournament_number, stage, sequence_number, display_name, legacy_section_label, roster_size)
       VALUES (999, 'final', 1, 'Kampioen', 'TN999: Synthetic operation history', 2)`,
    );
    await pool.execute(
      `INSERT INTO tournament_history_races
         (tournament_history_section_id, race_index, race_sequence, legacy_race_index, origin)
       SELECT tournament_history_section_id, 1, 999001, 1, 'legacy'
         FROM tournament_history_sections WHERE tournament_number = 999`,
    );
    await pool.execute(
      `INSERT INTO tournament_history_placements
         (tournament_history_race_id, player_id, finish_position, race_points)
       SELECT race.tournament_history_race_id, player.player_id, 1, 15
         FROM tournament_history_races AS race
         INNER JOIN tournament_history_sections AS section
           ON section.tournament_history_section_id = race.tournament_history_section_id
         CROSS JOIN players AS player
        WHERE section.tournament_number = 999 AND player.public_id = ?`,
      [playerIds[7]!],
    );
    legacyHistorySeeded = true;
  });

  afterAll(async () => {
    if (pool === undefined) { return; }
    const placeholders = (values: readonly string[]) => values.map(() => "?").join(", ");
    if (legacyHistorySeeded) {
      await pool.execute(
        `DELETE placement FROM tournament_history_placements AS placement
         INNER JOIN tournament_history_races AS race
           ON race.tournament_history_race_id = placement.tournament_history_race_id
         INNER JOIN tournament_history_sections AS section
           ON section.tournament_history_section_id = race.tournament_history_section_id
         WHERE section.tournament_number = 999`,
      );
      await pool.execute(
        `DELETE race FROM tournament_history_races AS race
         INNER JOIN tournament_history_sections AS section
           ON section.tournament_history_section_id = race.tournament_history_section_id
         WHERE section.tournament_number = 999`,
      );
      await pool.execute("DELETE FROM tournament_history_sections WHERE tournament_number = 999");
      await pool.execute("DELETE FROM legacy_tournament_events WHERE tournament_number = 999");
    }
    await pool.execute(`DELETE FROM player_rating_events WHERE player_id IN (SELECT player_id FROM players WHERE public_id IN (${placeholders(playerIds)}))`, [...playerIds]);
    await pool.execute(`DELETE FROM player_ratings WHERE player_id IN (SELECT player_id FROM players WHERE public_id IN (${placeholders(playerIds)}))`, [...playerIds]);
    if (publicationIds.length > 0) {
      await pool.execute(`DELETE FROM tournament_rating_decisions WHERE tournament_publication_id IN (SELECT tournament_publication_id FROM tournament_publications WHERE public_id IN (${placeholders(publicationIds)}))`, [...publicationIds]);
    }
    if (tournamentIds.length > 0) {
      await pool.execute(`DELETE lifecycle FROM tournament_lifecycle AS lifecycle INNER JOIN tournaments AS t ON t.tournament_id = lifecycle.tournament_id WHERE t.public_id IN (${placeholders(tournamentIds)})`, [...tournamentIds]);
      await pool.execute(`DELETE score FROM tournament_manual_scores AS score INNER JOIN tournament_groups AS g ON g.tournament_group_id = score.tournament_group_id INNER JOIN tournaments AS t ON t.tournament_id = g.tournament_id WHERE t.public_id IN (${placeholders(tournamentIds)})`, [...tournamentIds]);
      await pool.execute(`DELETE link FROM tournament_group_races AS link INNER JOIN tournament_groups AS g ON g.tournament_group_id = link.tournament_group_id INNER JOIN tournaments AS t ON t.tournament_id = g.tournament_id WHERE t.public_id IN (${placeholders(tournamentIds)})`, [...tournamentIds]);
      await pool.execute(`DELETE member FROM tournament_group_members AS member INNER JOIN tournament_groups AS g ON g.tournament_group_id = member.tournament_group_id INNER JOIN tournaments AS t ON t.tournament_id = g.tournament_id WHERE t.public_id IN (${placeholders(tournamentIds)})`, [...tournamentIds]);
      await pool.execute(`DELETE station FROM tournament_group_stations AS station INNER JOIN tournament_groups AS g ON g.tournament_group_id = station.tournament_group_id INNER JOIN tournaments AS t ON t.tournament_id = g.tournament_id WHERE t.public_id IN (${placeholders(tournamentIds)})`, [...tournamentIds]);
      await pool.execute(`DELETE g FROM tournament_groups AS g INNER JOIN tournaments AS t ON t.tournament_id = g.tournament_id WHERE t.public_id IN (${placeholders(tournamentIds)})`, [...tournamentIds]);
      await pool.execute(`DELETE p FROM tournament_participants AS p INNER JOIN tournaments AS t ON t.tournament_id = p.tournament_id WHERE t.public_id IN (${placeholders(tournamentIds)})`, [...tournamentIds]);
      await pool.execute(`DELETE FROM tournaments WHERE public_id IN (${placeholders(tournamentIds)})`, [...tournamentIds]);
    }
    if (publicationIds.length > 0) {
      await pool.execute(`DELETE FROM tournament_publication_current_members WHERE tournament_publication_id IN (SELECT tournament_publication_id FROM tournament_publications WHERE public_id IN (${placeholders(publicationIds)}))`, [...publicationIds]);
      await pool.execute(`DELETE member FROM tournament_publication_lifecycle_members AS member INNER JOIN tournament_publication_lifecycle AS lifecycle ON lifecycle.tournament_publication_lifecycle_id = member.tournament_publication_lifecycle_id INNER JOIN tournament_publications AS publication ON publication.tournament_publication_id = lifecycle.tournament_publication_id WHERE publication.public_id IN (${placeholders(publicationIds)})`, [...publicationIds]);
      await pool.execute(`DELETE lifecycle FROM tournament_publication_lifecycle AS lifecycle INNER JOIN tournament_publications AS publication ON publication.tournament_publication_id = lifecycle.tournament_publication_id WHERE publication.public_id IN (${placeholders(publicationIds)})`, [...publicationIds]);
      await pool.execute(`DELETE FROM tournament_publications WHERE public_id IN (${placeholders(publicationIds)})`, [...publicationIds]);
    }
    await pool.execute(`DELETE placement FROM tournament_race_placements AS placement INNER JOIN tournament_race_result_revisions AS revision ON revision.tournament_race_result_revision_id = placement.tournament_race_result_revision_id INNER JOIN tournament_race_results AS result ON result.tournament_race_result_id = revision.tournament_race_result_id WHERE result.public_id LIKE 'tournament_race_result.synthetic_operation_%'`);
    await pool.execute(`DELETE restricted FROM restricted_tournament_race_data AS restricted INNER JOIN tournament_race_result_revisions AS revision ON revision.tournament_race_result_revision_id = restricted.tournament_race_result_revision_id INNER JOIN tournament_race_results AS result ON result.tournament_race_result_id = revision.tournament_race_result_id WHERE result.public_id LIKE 'tournament_race_result.synthetic_operation_%'`);
    await pool.execute(`DELETE revision FROM tournament_race_result_revisions AS revision INNER JOIN tournament_race_results AS result ON result.tournament_race_result_id = revision.tournament_race_result_id WHERE result.public_id LIKE 'tournament_race_result.synthetic_operation_%'`);
    await pool.execute(`DELETE FROM tournament_race_results WHERE public_id LIKE 'tournament_race_result.synthetic_operation_%'`);
    await pool.execute("DELETE FROM administrator_grants WHERE public_id = 'administrator_grant.synthetic_tournament_operation_admin'");
    await pool.execute(`DELETE FROM tournament_station_cables WHERE owner_player_id IN (SELECT player_id FROM players WHERE public_id IN (${placeholders(playerIds)}))`, [...playerIds]);
    await pool.execute(`DELETE FROM player_username_history WHERE player_id IN (SELECT player_id FROM players WHERE public_id IN (${placeholders(playerIds)}))`, [...playerIds]);
    await pool.execute(`DELETE FROM players WHERE public_id IN (${placeholders(playerIds)})`, [...playerIds]);
    await pool.execute("DELETE FROM user_accounts WHERE public_id IN (?, ?)", [administrator.userAccountId, account.userAccountId]);
    await pool.end();
  });

  it("runs a whole tournament night and finalizes with both settings off, then shows results on demand", async () => {
    const created = await service.create(administrator, { name: "Synthetic Night 1", editionNumber: 901, eventDate: "2026-08-22" });
    expect(created.stage).toBe("setup");
    let revision = created.revision;
    let document = await service.loadForAdministrator(administrator, created.tournamentId);
    expect(document.participants).toHaveLength(playerIds.length);
    expect(document.participants.every((participant) => participant.attendance === "absent")).toBe(true);
    expect(document.participants.filter((participant) => participant.inactive).map((participant) => participant.playerId))
      .toEqual([playerIds[7]]);

    // Seven present (one of them private), one waiting; two Switch owners.
    for (const [index, playerId] of playerIds.entries()) {
      document = await service.setParticipant(administrator, created.tournamentId, {
        expectedRevision: revision,
        playerId,
        attendance: index === 6 ? "waiting" : "present",
        hasSwitch1: index < 2,
        hasSwitch2: index === 0,
      });
      revision = document.summary.revision;
    }
    expect(document.summary.presentCount).toBe(7);
    expect(document.stations).toHaveLength(3);
    // The waiting player joins late.
    document = await service.setParticipant(administrator, created.tournamentId, {
      expectedRevision: revision, playerId: playerIds[6]!, attendance: "present",
    });
    revision = document.summary.revision;
    expect(document.summary.presentCount).toBe(8);

    // A roster file in one request: rows that match cost nothing (the
    // revision stays), rows that differ are applied together.
    const unchanged = await service.importParticipants(administrator, created.tournamentId, {
      expectedRevision: revision,
      rows: playerIds.slice(0, 3).map((playerId, index) => ({
        playerId, attendance: "present" as const, hasSwitch1: index < 2, hasSwitch2: index === 0,
      })),
    });
    expect(unchanged.summary.revision).toBe(revision);
    document = await service.importParticipants(administrator, created.tournamentId, {
      expectedRevision: revision,
      rows: [
        { playerId: playerIds[6]!, attendance: "waiting" },
        { playerId: playerIds[2]!, hasSwitch1: true },
        { playerId: playerIds[3]!, attendance: "present", hasSwitch1: false, hasSwitch2: false },
      ],
    });
    expect(document.summary.revision).toBe(revision + 1);
    expect(document.summary.presentCount).toBe(7);
    expect(document.stations).toHaveLength(4);
    expect(document.lifecycle[0]).toMatchObject({ eventType: "participants_imported", detail: "rows=3;changed=2;added=0" });
    revision = document.summary.revision;
    document = await service.importParticipants(administrator, created.tournamentId, {
      expectedRevision: revision,
      rows: [{ playerId: playerIds[6]!, attendance: "present" }],
    });
    revision = document.summary.revision;
    expect(document.summary.presentCount).toBe(8);
    expect(document.stations).toHaveLength(4);

    document = await service.generateGroups(administrator, created.tournamentId, { expectedRevision: revision, stage: "qualifier" });
    revision = document.summary.revision;
    expect(document.summary.stage).toBe("qualifiers");
    expect(document.groups).toHaveLength(1);
    const group = document.groups[0]!;
    expect(group.members).toHaveLength(8);
    expect(group.members.filter((member) => member.station !== undefined).length).toBe(8);
    expect(group.members.find((member) => member.playerId === playerIds[0])?.station).toMatchObject({
      ownerPlayerId: playerIds[0], seatNumber: 1,
    });

    // A stale revision is refused.
    await expect(service.enterRace(administrator, created.tournamentId, {
      expectedRevision: revision - 1, groupId: group.groupId, trackId: "track.mario_kart_stadium",
      finishOrder: group.members.map((member) => member.playerId),
    })).rejects.toMatchObject({ code: "conflict" });

    const order = group.members.map((member) => member.playerId);
    document = await service.enterRace(administrator, created.tournamentId, {
      expectedRevision: revision, groupId: group.groupId, trackId: "track.mario_kart_stadium", mode: 150,
      finishOrder: order,
    });
    revision = document.summary.revision;
    document = await service.enterRace(administrator, created.tournamentId, {
      expectedRevision: revision, groupId: group.groupId, trackId: "track.water_park", mode: 150, mirror: true,
      finishOrder: [...order].reverse(),
    });
    revision = document.summary.revision;
    let standings = document.groups[0]!.standings;
    expect(standings.source).toBe("races");
    expect(document.groups[0]!.races).toHaveLength(2);
    // 8 players: 10,8,6,5,4,3,2,1; race 1 + the reversed race 2 mirror the table.
    expect(standings.rows.map((row) => row.points)).toEqual([11, 11, 10, 10, 9, 9, 9, 9]);

    // Correct race 1: winner and runner-up swapped -> race 2 totals re-derived (revision 2 each).
    const corrected = [order[1]!, order[0]!, ...order.slice(2)];
    document = await service.enterRace(administrator, created.tournamentId, {
      expectedRevision: revision, groupId: group.groupId, raceNumber: 1, trackId: "track.mario_kart_stadium",
      finishOrder: corrected,
    });
    revision = document.summary.revision;
    expect(document.groups[0]!.races.map((race) => race.revision)).toEqual([2, 2]);
    standings = document.groups[0]!.standings;
    expect(standings.rows[0]!.playerId).toBe(order[1]);
    // order[1]: 10 (race 1 winner) + 2 (race 2, second to last) = 12; order[0]: 8 + 1 = 9.
    expect(standings.rows[0]!.points).toBe(12);
    expect(standings.rows.find((row) => row.playerId === order[0])?.points).toBe(9);

    // Finals: one group -> one tier (Kampioen), everybody promoted in standing order.
    document = await service.generateGroups(administrator, created.tournamentId, { expectedRevision: revision, stage: "final" });
    revision = document.summary.revision;
    const finals = document.groups.filter((candidate) => candidate.stage === "final");
    expect(finals).toHaveLength(1);
    expect(finals[0]!.name).toBe("Kampioen");
    expect(finals[0]!.tierKey).toBe("champion");
    expect(finals[0]!.members[0]!.playerId).toBe(order[1]);
    document = await service.enterRace(administrator, created.tournamentId, {
      expectedRevision: revision, groupId: finals[0]!.groupId, trackId: "track.sweet_sweet_canyon",
      finishOrder: finals[0]!.members.map((member) => member.playerId),
    });
    revision = document.summary.revision;

    const preview = await service.finalizationPreview(administrator, created.tournamentId);
    expect(preview).toMatchObject({ presentCount: 8, qualifierGroups: 1, finalGroups: 1, raceCount: 3, rateableRaceCount: 3, incompleteGroups: 0 });
    expect(preview.overall[0]!.placement).toBe(1);
    document = await service.advanceWorkflow(administrator, created.tournamentId, { expectedRevision: revision });
    revision = document.summary.revision;

    // Finalize: PUBLIC RESULTS OFF, AFFECTS TRUESKILL OFF.
    const finalized = await service.finalize(administrator, created.tournamentId, {
      expectedRevision: revision, publicResults: false, affectsRating: false, reasonCode: "night_one_done",
    });
    expect(finalized.publicationId).toBeDefined();
    expect(finalized.rating).toBeUndefined();
    const [eventRows] = await pool.execute<any[]>("SELECT COUNT(*) AS total FROM player_rating_events WHERE source_reference = ?", [finalized.publicationId!]);
    expect(Number(eventRows[0].total)).toBe(0);
    // Publication exists but is hidden: nobody sees it publicly, operational data remains.
    expect(await publicRepository.loadPublication(finalized.publicationId!)).toBeNull();
    expect(await service.loadPublic(anonymous, created.tournamentId)).toBeNull();
    expect(await service.loadPublic(account, created.tournamentId)).toBeNull();
    const admin = await service.loadForAdministrator(administrator, created.tournamentId);
    expect(admin.summary.stage).toBe("finalized");
    expect(admin.groups.reduce((sum, candidate) => sum + candidate.races.length, 0)).toBe(3);
    // Re-finalizing is refused; an excluded publication cannot be rated later.
    await expect(service.finalize(administrator, created.tournamentId, {
      expectedRevision: admin.summary.revision, publicResults: true, affectsRating: true, reasonCode: "again",
    })).rejects.toMatchObject({ code: "conflict" });
    await expect(rating.applyPublication(finalized.publicationId!)).rejects.toMatchObject({ code: "conflict" });

    // Owner turns results ON later: everybody can read them, the private Player is redacted.
    const shown = await service.setResultsVisibility(administrator, created.tournamentId, {
      expectedRevision: admin.summary.revision, publicResults: true, reasonCode: "show_results",
    });
    expect(shown.publicResults).toBe(true);
    const publicEvent = await service.loadPublic(anonymous, created.tournamentId);
    expect(publicEvent).not.toBeNull();
    expect(publicEvent!.publicResults).toBe(true);
    expect(publicEvent!.groups).toHaveLength(2);
    expect(publicEvent!.overall).toHaveLength(8);
    // ADR-0217: the Mirror race (race 2, re-derived after the race 1 correction) keeps its class in the public event.
    expect(publicEvent!.groups.flatMap((group) => group.races).map((race) => [race.trackId, race.mode, race.mirror]))
      .toContainEqual(["track.water_park", 150, true]);
    const privateRow = publicEvent!.overall.find((row) => row.displayName === "Operation Racer 8");
    expect(privateRow).toBeDefined();
    expect(privateRow!.playerId).toBeUndefined();
    expect(publicEvent!.overall.some((row) => row.playerId === playerIds[0])).toBe(true);
    expect((await publicRepository.loadPublication(finalized.publicationId!))?.races).toHaveLength(3);
    const withIncident = await service.recordIncident(administrator, created.tournamentId, {
      expectedRevision: shown.revision,
      category: "equipment",
      playerId: playerIds[0]!,
      note: "Capture station reconnected",
    });
    expect(withIncident.lifecycle.find((event) => event.eventType === "incident_recorded")).toMatchObject({
      eventType: "incident_recorded",
      detail: `equipment|${playerIds[0]!}|Capture station reconnected`,
    });
    const listed = await service.listPublic(anonymous);
    expect(listed.some((entry) => entry.tournamentId === created.tournamentId)).toBe(true);
    // Derived standings feed carries the edition (TN901) with the final group.
    const sections = await history.listTournamentStandings();
    const section = sections.find((candidate) => candidate.tournamentNumber === 901);
    expect(section?.sectionLabel).toBe("Kampioen");
  });

  it("finalizes a second tournament with rating ON exactly once and reflects it in rating history", async () => {
    const created = await service.create(administrator, { name: "Synthetic Night 2", editionNumber: 902 });
    let revision = created.revision;
    for (const playerId of playerIds.slice(0, 6)) {
      const updated = await service.setParticipant(administrator, created.tournamentId, {
        expectedRevision: revision, playerId, attendance: "present", hasSwitch1: true,
      });
      revision = updated.summary.revision;
    }
    let document = await service.generateGroups(administrator, created.tournamentId, { expectedRevision: revision, stage: "final" });
    revision = document.summary.revision;
    const group = document.groups[0]!;
    const order = group.members.map((member) => member.playerId);
    for (const track of ["track.mario_kart_stadium", "track.water_park", "track.sweet_sweet_canyon"]) {
      document = await service.enterRace(administrator, created.tournamentId, {
        expectedRevision: revision, groupId: group.groupId, trackId: track, finishOrder: order,
      });
      revision = document.summary.revision;
    }
    document = await service.advanceWorkflow(administrator, created.tournamentId, { expectedRevision: revision });
    revision = document.summary.revision;
    const first = await service.finalize(administrator, created.tournamentId, {
      expectedRevision: revision, publicResults: true, affectsRating: true, reasonCode: "night_two_done",
    });
    expect(first.rating).toMatchObject({ appliedRaces: 3, skippedRaces: 0, alreadyApplied: false });
    const [ratingRows] = await pool.execute<any[]>(
      "SELECT COUNT(*) AS total FROM player_rating_events WHERE source_reference = ? AND event_type = 'race_result'",
      [first.publicationId!],
    );
    expect(Number(ratingRows[0].total)).toBe(18);
    // Applying again never double-rates.
    const again = await rating.applyPublication(first.publicationId!);
    expect(again.alreadyApplied).toBe(true);
    const [ratingRowsAfter] = await pool.execute<any[]>(
      "SELECT COUNT(*) AS total FROM player_rating_events WHERE source_reference = ?", [first.publicationId!],
    );
    expect(Number(ratingRowsAfter[0].total)).toBe(18);
    // The winner's public rating history now shows TN902 races after any legacy points.
    const points = await history.listRatingHistory(order[0]!);
    const canonical = points.filter((point) => point.tournamentNumber === 902);
    expect(canonical).toHaveLength(3);
    expect(canonical.map((point) => point.raceIndex)).toEqual([1, 2, 3]);
    expect(canonical[2]!.score).toBeGreaterThan(canonical[0]!.score - 100);
    // Player tournament history (publication-based) lists the races for a public Player.
    expect((await publicRepository.listPlayerResults(order[0]!)).filter((result) =>
      result.publicationId === first.publicationId)).toHaveLength(3);
    // A night that is coming or being raced is public reading: whoever finds
    // the site sees that there is a tournament on Friday without an account.
    const third = await service.create(administrator, { name: "Synthetic Night 3" });
    expect((await service.listPublic(account)).some((entry) => entry.tournamentId === third.tournamentId)).toBe(true);
    const seenOut = (await service.listPublic(anonymous))
      .find((entry) => entry.tournamentId === third.tournamentId);
    expect(seenOut).toBeDefined();
    expect(await service.loadPublic(anonymous, third.tournamentId)).not.toBeNull();
    // The Director is an account, and an account's name is still not told to a
    // visitor; a signed-in reader is told.
    expect(seenOut!.directorDisplayName).toBeUndefined();
    expect((await service.listPublic(account))
      .find((entry) => entry.tournamentId === third.tournamentId)!.directorDisplayName)
      .toBeDefined();
    // A finished night still has to have been published to be read at all.
    expect(await service.loadPublic(anonymous, created.tournamentId)).not.toBeNull();
  });

  it("supports the historical compact workflow by generating finals without qualifier groups", async () => {
    const created = await service.create(administrator, { name: "Synthetic Compact Night", editionNumber: 903 });
    let revision = created.revision;
    for (const playerId of playerIds.slice(0, 4)) {
      const updated = await service.setParticipant(administrator, created.tournamentId, {
        expectedRevision: revision,
        playerId,
        attendance: "present",
        hasSwitch1: true,
      });
      revision = updated.summary.revision;
    }

    const document = await service.generateGroups(administrator, created.tournamentId, {
      expectedRevision: revision,
      stage: "final",
    });

    expect(document.summary.stage).toBe("finals");
    expect(document.groups.filter((group) => group.stage === "qualifier")).toHaveLength(0);
    expect(document.groups.filter((group) => group.stage === "final")).toHaveLength(1);
    expect(document.groups.find((group) => group.stage === "final")?.members).toHaveLength(4);
  });

  // Owner, 2026-09-15: TN13 was finalized on production without an edition
  // number, so the rating graph and the statistics left it out, and the
  // settings were locked. The preview names the gap, a public finalization
  // refuses it, and the labels stay editable after finalization.
  it("names a missing edition number, refuses a public finalization without one, and keeps labels editable afterwards", async () => {
    const created = await service.create(administrator, { name: "Synthetic Unnumbered Night" });
    let revision = created.revision;
    for (const playerId of playerIds.slice(0, 4)) {
      const updated = await service.setParticipant(administrator, created.tournamentId, {
        expectedRevision: revision, playerId, attendance: "present", hasSwitch1: true,
      });
      revision = updated.summary.revision;
    }
    let document = await service.generateGroups(administrator, created.tournamentId, { expectedRevision: revision, stage: "final" });
    revision = document.summary.revision;
    const group = document.groups[0]!;
    const order = group.members.map((member) => member.playerId);
    for (const track of ["track.mario_kart_stadium", "track.water_park", "track.sweet_sweet_canyon"]) {
      document = await service.enterRace(administrator, created.tournamentId, {
        expectedRevision: revision, groupId: group.groupId, trackId: track, finishOrder: order,
      });
      revision = document.summary.revision;
    }
    const preview = await service.finalizationPreview(administrator, created.tournamentId);
    expect(preview.warnings).toContain(EDITION_NUMBER_MISSING);
    document = await service.advanceWorkflow(administrator, created.tournamentId, { expectedRevision: revision });
    revision = document.summary.revision;
    await expect(service.finalize(administrator, created.tournamentId, {
      expectedRevision: revision, publicResults: true, affectsRating: false, reasonCode: "tournament_finalized",
    })).rejects.toMatchObject({ message: EDITION_NUMBER_REQUIRED });

    const numbered = await service.update(administrator, created.tournamentId, { expectedRevision: revision, editionNumber: 904 });
    revision = numbered.revision;
    expect((await service.finalizationPreview(administrator, created.tournamentId)).warnings).not.toContain(EDITION_NUMBER_MISSING);
    const finalized = await service.finalize(administrator, created.tournamentId, {
      expectedRevision: revision, publicResults: true, affectsRating: false, reasonCode: "tournament_finalized",
    });
    expect(finalized.publicResults).toBe(true);
    revision = finalized.revision;

    // Labels after finalization: allowed. Workflow settings: still fixed.
    const relabelled = await service.update(administrator, created.tournamentId, {
      expectedRevision: revision, name: "Synthetic Numbered Night", editionNumber: 905, eventDate: "2026-09-15",
    });
    expect(relabelled).toMatchObject({ name: "Synthetic Numbered Night", editionNumber: 905, eventDate: "2026-09-15", stage: "finalized" });
    await expect(service.update(administrator, created.tournamentId, {
      expectedRevision: relabelled.revision, maxParticipants: 40,
    })).rejects.toMatchObject({ message: "the tournament is finalized" });
  });
});
