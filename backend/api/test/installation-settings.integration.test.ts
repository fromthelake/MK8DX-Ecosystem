// ADR-0221 against a disposable MySQL/MariaDB with the whole catalog applied (migration 0081):
// the installation settings with their audit, the Player-creation paths each setting closes, a night
// with "only verified Players" rated through the real finalize, the seeding source stored next to
// seed_order, the Director's own nights read for seeding, and "only claimed Players count" applied by
// the explicit, audited recalculation (the faithful history replay) - first leaving the unclaimed
// Players without a rating, then counting a newly verified Player's earlier races.

import { randomBytes } from "node:crypto";

import mysql, { type Pool, type PoolOptions, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { InstallationSettingsService } from "../src/administration/installation-settings-service.js";
import { MysqlInstallationSettingsRepository } from "../src/administration/mysql-installation-settings-repository.js";
import { MysqlPlayerOnboardingRepository } from "../src/identity/mysql-player-onboarding-repository.js";
import { PlayerCreationDisabled, PlayerOnboardingService } from "../src/identity/player-onboarding-service.js";
import { MysqlRatingLifecycleRepository } from "../src/rating/mysql-rating-lifecycle-repository.js";
import { createHistoryReplay } from "../src/rating/rating-history-replay.js";
import { RatingLifecycleService } from "../src/rating/rating-lifecycle-service.js";
import { MysqlTournamentOperationRepository } from "../src/tournaments/mysql-tournament-operation-repository.js";
import { MysqlTournamentPublicationRepository } from "../src/tournaments/mysql-tournament-publication-repository.js";
import { MysqlTournamentWriteRepository } from "../src/tournaments/mysql-tournament-write-repository.js";
import {
  TournamentRaceResultService,
  type TournamentAssetCatalog,
  type TournamentProtectedLookupValue,
  type TournamentProtectedValue,
  type TournamentSensitiveValueProtector,
} from "../src/tournaments/race-result-service.js";
import { TournamentOperationService } from "../src/tournaments/tournament-operation-service.js";
import { TournamentPublicationService } from "../src/tournaments/tournament-publication-service.js";

const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" &&
  (database.endsWith("_test") || database.endsWith("_contract"))
  ? describe
  : describe.skip;

class AcceptingCatalog implements TournamentAssetCatalog {
  async validateReferences(): Promise<readonly string[]> { return []; }
}
class DeterministicProtector implements TournamentSensitiveValueProtector {
  private lookup(byte: number): TournamentProtectedLookupValue {
    return {
      lookupHmac: new Uint8Array(32).fill(byte), lookupKeyVersion: "test-lookup-v1",
      ciphertext: new Uint8Array([byte, byte + 1]), encryptionKeyVersion: "test-encryption-v1",
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

integration("installation settings and per-night rating options (ADR-0221)", () => {
  let pool: Pool;
  const tag = randomBytes(3).toString("hex");
  const admin = { role: "administrator" as const, userAccountId: `user_account.settings_admin_${tag}` };
  const newcomer = { role: "account" as const, userAccountId: `user_account.settings_newcomer_${tag}` };
  // Racers 1 and 2 have a verified claim; 3 and 4 do not (yet).
  const racers = [1, 2, 3, 4].map((n) => `player.settings_${tag}_${n}`);
  const claimants = [1, 2, 3].map((n) => `user_account.settings_claimant_${tag}_${n}`);
  const tournamentNumber = 8000 + Number.parseInt(tag.slice(0, 3), 16) % 900;
  let sequence = 0;
  let settings: InstallationSettingsService;
  let rating: RatingLifecycleService;
  let operations: TournamentOperationService;
  let onboarding: PlayerOnboardingService;
  let nightId = "";
  let publicationId = "";

  const playerInternal = async (publicId: string): Promise<number> => {
    const [rows] = await pool.execute<RowDataPacket[]>("SELECT player_id AS id FROM players WHERE public_id = ?", [publicId]);
    return Number(rows[0]!["id"]);
  };
  const ratedRacers = async (): Promise<string[]> => {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT player.public_id AS playerId FROM player_ratings AS rating
       INNER JOIN players AS player ON player.player_id = rating.player_id
       WHERE player.public_id IN (?, ?, ?, ?) ORDER BY player.public_id`,
      racers,
    );
    return rows.map((row) => String(row["playerId"]));
  };
  const nightRaters = async (): Promise<string[]> => {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT DISTINCT player.public_id AS playerId FROM player_rating_events AS event
       INNER JOIN players AS player ON player.player_id = event.player_id
       WHERE event.source_reference = ? AND event.rating_epoch = (SELECT MAX(rating_epoch) FROM player_rating_events)
       ORDER BY player.public_id`,
      [publicationId],
    );
    return rows.map((row) => String(row["playerId"]));
  };
  const verifyClaim = async (account: string, playerId: string, atMs: number): Promise<void> => {
    await pool.execute(
      `INSERT INTO player_claims (public_id, revision, privacy_class, player_id, user_account_id, claim_status, dispute_status, created_at_ms, updated_at_ms)
       SELECT ?, 1, 'private', player.player_id, account.user_account_id, 'verified', 'none', ?, ?
       FROM players AS player INNER JOIN user_accounts AS account ON account.public_id = ?
       WHERE player.public_id = ?`,
      [`player_claim.settings_${tag}_${(sequence += 1)}`, atMs, atMs, account, playerId],
    );
    await pool.execute(
      `INSERT INTO player_claim_lifecycle (player_claim_id, sequence_number, event_type, actor_type, actor_user_account_id, occurred_at_ms, reason_code)
       SELECT claim.player_claim_id, 1, 'claim_verified', 'administrator', admin_account.user_account_id, ?, 'synthetic_test'
       FROM player_claims AS claim
       INNER JOIN players AS player ON player.player_id = claim.player_id
       INNER JOIN user_accounts AS admin_account ON admin_account.public_id = ?
       WHERE player.public_id = ? AND claim.claim_status = 'verified'`,
      [atMs, admin.userAccountId, playerId],
    );
  };

  beforeAll(async () => {
    const options: PoolOptions = {
      host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
      port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306"),
      user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "mk8dx_test",
      database,
      connectionLimit: 4,
    };
    const password = process.env["MK8DX_MYSQL_TEST_PASSWORD"];
    if (password !== undefined) { options.password = password; }
    pool = mysql.createPool(options);
    // A real clock: the recalculation stamps its own row with the time it ran,
    // and "out of date" compares the settings' change time with it.
    const clock = { nowMs: () => Date.now() };

    for (const account of [admin.userAccountId, newcomer.userAccountId, ...claimants]) {
      await pool.execute(
        `INSERT INTO user_accounts (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
         VALUES (?, 1, 'private', 'active', 1, 1)`,
        [account],
      );
    }
    await pool.execute(
      `INSERT INTO administrator_grants (public_id, revision, user_account_id, grant_status, grant_origin, granted_at_ms, updated_at_ms)
       SELECT ?, 1, user_account_id, 'active', 'administrator', 1, 1 FROM user_accounts WHERE public_id = ?`,
      [`administrator_grant.settings_${tag}`, admin.userAccountId],
    );
    for (const [index, playerId] of racers.entries()) {
      await pool.execute(
        `INSERT INTO players (public_id, revision, player_kind, display_name, record_status, created_at_ms, updated_at_ms)
         VALUES (?, 1, 'human', ?, 'active', 1, 1)`,
        [playerId, `Settings Racer ${tag} ${index + 1}`],
      );
      await pool.execute(
        `INSERT INTO player_username_history (player_id, sequence_number, username_value, comparison_key, allocated_at_ms)
         SELECT player_id, 1, ?, ?, 1 FROM players WHERE public_id = ?`,
        [`st${tag}r${index + 1}`, Buffer.from(`st${tag}r${index + 1}`), playerId],
      );
    }
    await verifyClaim(claimants[0]!, racers[0]!, 2);
    await verifyClaim(claimants[1]!, racers[1]!, 2);
    // One corrected-history race, long ago: 3 won, then 1, 4, 2.
    await pool.execute(
      "INSERT INTO legacy_tournament_events (tournament_number, event_date, held_at_ms) VALUES (?, '2024-01-05', 1704412800000)",
      [tournamentNumber],
    );
    await pool.execute(
      `INSERT INTO tournament_history_sections (tournament_number, stage, sequence_number, display_name, legacy_section_label, roster_size)
       VALUES (?, 'final', 1, 'Kampioen', ?, 4)`,
      [tournamentNumber, `TN${tournamentNumber}: settings history`],
    );
    await pool.execute(
      `INSERT INTO tournament_history_races (tournament_history_section_id, race_index, race_sequence, legacy_race_index, origin)
       SELECT tournament_history_section_id, 1, ?, 1, 'legacy' FROM tournament_history_sections WHERE tournament_number = ?`,
      [tournamentNumber * 1000 + 1, tournamentNumber],
    );
    for (const [position, racer] of [[1, racers[2]!], [2, racers[0]!], [3, racers[3]!], [4, racers[1]!]] as const) {
      await pool.execute(
        `INSERT INTO tournament_history_placements (tournament_history_race_id, player_id, finish_position, race_points)
         SELECT race.tournament_history_race_id, player.player_id, ?, ?
         FROM tournament_history_races AS race
         INNER JOIN tournament_history_sections AS section ON section.tournament_history_section_id = race.tournament_history_section_id
         CROSS JOIN players AS player
         WHERE section.tournament_number = ? AND player.public_id = ?`,
        [position, 16 - position, tournamentNumber, racer],
      );
    }

    rating = new RatingLifecycleService(new MysqlRatingLifecycleRepository(pool), clock);
    rating.useHistoryReplay(createHistoryReplay(pool, rating));
    settings = new InstallationSettingsService({
      repository: new MysqlInstallationSettingsRepository(pool),
      clock,
      recomputeRatings: (input) => rating.recalculate(input),
    });
    onboarding = new PlayerOnboardingService(
      new MysqlPlayerOnboardingRepository(pool),
      {
        newPlayerId: () => `player.settings_${tag}_made_${(sequence += 1)}`,
        newPlayerClaimId: () => `player_claim.settings_${tag}_made_${(sequence += 1)}`,
      },
      clock,
      settings,
    );
    operations = new TournamentOperationService({
      repository: new MysqlTournamentOperationRepository(pool),
      raceResults: new TournamentRaceResultService(
        new MysqlTournamentWriteRepository(pool), new AcceptingCatalog(), new DeterministicProtector(),
      ),
      publications: new TournamentPublicationService(
        new MysqlTournamentPublicationRepository(pool),
        { newPublicationId: () => `tournament_publication.settings_${tag}_${(sequence += 1)}` },
        clock,
      ),
      rating,
      ids: {
        newTournamentId: () => `tournament.settings_${tag}_${(sequence += 1)}`,
        newGroupId: () => `tournament_group.settings_${tag}_${(sequence += 1)}`,
      },
      clock,
      random: () => 0.5,
    });
  });

  afterAll(async () => {
    if (pool === undefined) { return; }
    // Leave the installation on its defaults for whatever runs next in this schema.
    await pool.execute("DELETE FROM installation_setting_changes");
    await pool.execute("DELETE FROM installation_settings");
    await pool.execute("DELETE FROM administrator_grants WHERE public_id = ?", [`administrator_grant.settings_${tag}`]);
    await pool.execute(
      `DELETE placement FROM tournament_history_placements AS placement
       INNER JOIN tournament_history_races AS race ON race.tournament_history_race_id = placement.tournament_history_race_id
       INNER JOIN tournament_history_sections AS section ON section.tournament_history_section_id = race.tournament_history_section_id
       WHERE section.tournament_number = ?`,
      [tournamentNumber],
    );
    await pool.execute(
      `DELETE race FROM tournament_history_races AS race
       INNER JOIN tournament_history_sections AS section ON section.tournament_history_section_id = race.tournament_history_section_id
       WHERE section.tournament_number = ?`,
      [tournamentNumber],
    );
    await pool.execute("DELETE FROM tournament_history_sections WHERE tournament_number = ?", [tournamentNumber]);
    await pool.execute("DELETE FROM legacy_tournament_events WHERE tournament_number = ?", [tournamentNumber]);
    // The night, its result set and races, so a later test that builds a roster
    // from every finished night does not meet these Players.
    const tournaments = `tournament.settings_${tag}_%`;
    const publications = `tournament_publication.settings_${tag}_%`;
    const inTournament = "INNER JOIN tournaments AS t ON t.tournament_id = g.tournament_id WHERE t.public_id LIKE ?";
    await pool.execute(`DELETE FROM tournament_rating_decisions WHERE tournament_publication_id IN (SELECT tournament_publication_id FROM tournament_publications WHERE public_id LIKE ?)`, [publications]);
    await pool.execute("DELETE lifecycle FROM tournament_lifecycle AS lifecycle INNER JOIN tournaments AS t ON t.tournament_id = lifecycle.tournament_id WHERE t.public_id LIKE ?", [tournaments]);
    await pool.execute(`DELETE score FROM tournament_manual_scores AS score INNER JOIN tournament_groups AS g ON g.tournament_group_id = score.tournament_group_id ${inTournament}`, [tournaments]);
    await pool.execute(`DELETE link FROM tournament_group_races AS link INNER JOIN tournament_groups AS g ON g.tournament_group_id = link.tournament_group_id ${inTournament}`, [tournaments]);
    await pool.execute(`DELETE member FROM tournament_group_members AS member INNER JOIN tournament_groups AS g ON g.tournament_group_id = member.tournament_group_id ${inTournament}`, [tournaments]);
    await pool.execute(`DELETE station FROM tournament_group_stations AS station INNER JOIN tournament_groups AS g ON g.tournament_group_id = station.tournament_group_id ${inTournament}`, [tournaments]);
    await pool.execute(`DELETE g FROM tournament_groups AS g ${inTournament}`, [tournaments]);
    await pool.execute("DELETE p FROM tournament_participants AS p INNER JOIN tournaments AS t ON t.tournament_id = p.tournament_id WHERE t.public_id LIKE ?", [tournaments]);
    await pool.execute("DELETE FROM tournaments WHERE public_id LIKE ?", [tournaments]);
    await pool.execute("DELETE FROM tournament_publication_current_members WHERE tournament_publication_id IN (SELECT tournament_publication_id FROM tournament_publications WHERE public_id LIKE ?)", [publications]);
    await pool.execute("DELETE member FROM tournament_publication_lifecycle_members AS member INNER JOIN tournament_publication_lifecycle AS lifecycle ON lifecycle.tournament_publication_lifecycle_id = member.tournament_publication_lifecycle_id INNER JOIN tournament_publications AS publication ON publication.tournament_publication_id = lifecycle.tournament_publication_id WHERE publication.public_id LIKE ?", [publications]);
    await pool.execute("DELETE lifecycle FROM tournament_publication_lifecycle AS lifecycle INNER JOIN tournament_publications AS publication ON publication.tournament_publication_id = lifecycle.tournament_publication_id WHERE publication.public_id LIKE ?", [publications]);
    const racersPlaceholders = racers.map(() => "?").join(", ");
    const racerIds = `SELECT player_id FROM players WHERE public_id IN (${racersPlaceholders})`;
    await pool.execute(`DELETE FROM player_rating_events WHERE player_id IN (${racerIds})`, racers);
    await pool.execute(`DELETE FROM player_ratings WHERE player_id IN (${racerIds})`, racers);
    await pool.execute("DELETE FROM tournament_publications WHERE public_id LIKE ?", [publications]);
    const results = `tournament_race_result.%`;
    const ofNight = `INNER JOIN tournament_race_result_revisions AS revision ON revision.tournament_race_result_revision_id = x.tournament_race_result_revision_id
      INNER JOIN tournament_race_placements AS mine ON mine.tournament_race_result_revision_id = revision.tournament_race_result_revision_id
      WHERE mine.player_id IN (${racerIds})`;
    await pool.execute(`DELETE x FROM restricted_tournament_race_data AS x ${ofNight}`, racers);
    const [revisions] = await pool.execute<RowDataPacket[]>(
      `SELECT DISTINCT placement.tournament_race_result_revision_id AS revisionId, revision.tournament_race_result_id AS resultId
       FROM tournament_race_placements AS placement
       INNER JOIN tournament_race_result_revisions AS revision ON revision.tournament_race_result_revision_id = placement.tournament_race_result_revision_id
       INNER JOIN tournament_race_results AS result ON result.tournament_race_result_id = revision.tournament_race_result_id
       WHERE result.public_id LIKE ? AND placement.player_id IN (${racerIds})`,
      [results, ...racers],
    );
    for (const row of revisions) {
      await pool.execute("DELETE FROM tournament_race_placements WHERE tournament_race_result_revision_id = ?", [row["revisionId"]]);
      await pool.execute("DELETE FROM tournament_race_result_revisions WHERE tournament_race_result_revision_id = ?", [row["revisionId"]]);
    }
    for (const resultId of new Set(revisions.map((row) => row["resultId"]))) {
      await pool.execute("DELETE FROM tournament_race_results WHERE tournament_race_result_id = ?", [resultId]);
    }
    await pool.execute(`DELETE FROM tournament_station_cables WHERE owner_player_id IN (${racerIds})`, racers);
    await pool.execute(`DELETE lifecycle FROM player_claim_lifecycle AS lifecycle INNER JOIN player_claims AS claim ON claim.player_claim_id = lifecycle.player_claim_id WHERE claim.player_id IN (${racerIds})`, racers);
    await pool.execute(`DELETE FROM player_claims WHERE player_id IN (${racerIds})`, racers);
    await pool.execute(`DELETE FROM player_username_history WHERE player_id IN (${racerIds})`, racers);
    await pool.execute(`DELETE FROM players WHERE public_id IN (${racersPlaceholders})`, racers);
    await pool.end();
  });

  it("reads the defaults, audits each change and closes the Player-creation path each setting names", async () => {
    expect(await settings.current()).toEqual({ playerCreation: "self_and_directors", ratingEligibility: "all_players", carriedTimes: "off" });
    let view = await settings.administration(admin);
    expect(view.revision).toBe(0);

    view = await settings.update(admin, { expectedRevision: 0, playerCreation: "self_only" });
    expect(view).toMatchObject({ playerCreation: "self_only", revision: 1 });
    await expect(onboarding.createRosterPlayers(admin, [{ row: 2, displayName: `Walk-in ${tag}` }]))
      .rejects.toBeInstanceOf(PlayerCreationDisabled);
    await expect(onboarding.createPlayerForAdministrator(admin, { username: `wi${tag}` }))
      .rejects.toMatchObject({ code: "player_creation_disabled", closedPath: "directors" });

    view = await settings.update(admin, { expectedRevision: 1, playerCreation: "directors_only" });
    await expect(onboarding.createOwnPlayer(newcomer, { username: `nc${tag}` }))
      .rejects.toMatchObject({ code: "player_creation_disabled", closedPath: "self" });
    const [players] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM players WHERE public_id LIKE ?", [`player.settings_${tag}_made_%`],
    );
    expect(Number(players[0]!["total"])).toBe(0);

    await expect(settings.update(admin, { expectedRevision: 1, playerCreation: "self_and_directors" }))
      .rejects.toMatchObject({ code: "conflict" });
    view = await settings.update(admin, { expectedRevision: 2, playerCreation: "self_and_directors" });
    expect(view.revision).toBe(3);
    const [changes] = await pool.execute<RowDataPacket[]>(
      `SELECT change_row.setting_key AS settingKey, change_row.previous_value AS previousValue, change_row.new_value AS newValue,
              account.public_id AS changedBy
       FROM installation_setting_changes AS change_row
       INNER JOIN user_accounts AS account ON account.user_account_id = change_row.changed_by_user_account_id
       ORDER BY change_row.installation_setting_change_id`,
    );
    expect(changes.map((row) => [row["settingKey"], row["previousValue"], row["newValue"], row["changedBy"]])).toEqual([
      ["player_creation", "self_and_directors", "self_only", admin.userAccountId],
      ["player_creation", "self_only", "directors_only", admin.userAccountId],
      ["player_creation", "directors_only", "self_and_directors", admin.userAccountId],
    ]);
    // The schema itself refuses a second settings row and an unknown value.
    await expect(pool.execute(
      `INSERT INTO installation_settings (installation_settings_id, revision, player_creation, rating_eligibility, updated_by_user_account_id, updated_at_ms)
       SELECT 2, 1, 'self_only', 'all_players', user_account_id, 1 FROM user_accounts WHERE public_id = ?`,
      [admin.userAccountId],
    )).rejects.toThrow();
    await expect(pool.execute("UPDATE installation_settings SET rating_eligibility = 'everybody'")).rejects.toThrow();
    // ADR-0225 (migration 0087): the carried-times column defaults to off and refuses an unknown value.
    const [carried] = await pool.execute<RowDataPacket[]>("SELECT carried_times AS carriedTimes FROM installation_settings");
    expect(carried[0]!["carriedTimes"]).toBe("off");
    await expect(pool.execute("UPDATE installation_settings SET carried_times = 'always'")).rejects.toThrow();
  });

  it("stores the seeding source next to seed_order and rates a verified-only night for verified Players only", async () => {
    const created = await operations.create(admin, {
      name: `Settings night ${tag}`, editionNumber: tournamentNumber, seedingSource: "manual", verifiedOnly: true,
    });
    nightId = created.tournamentId;
    expect(created).toMatchObject({ seedingSource: "manual", verifiedOnly: true });
    const stored = async () => {
      const [rows] = await pool.execute<RowDataPacket[]>(
        "SELECT seed_order AS seedOrder, seeding_source AS seedingSource, verified_only AS verifiedOnly FROM tournaments WHERE public_id = ?",
        [nightId],
      );
      return rows[0]!;
    };
    expect(await stored()).toMatchObject({ seedOrder: "ranked", seedingSource: "manual", verifiedOnly: 1 });
    let summary = await operations.update(admin, nightId, { expectedRevision: created.revision, seedingSource: "random" });
    expect(await stored()).toMatchObject({ seedOrder: "random", seedingSource: null });
    summary = await operations.update(admin, nightId, { expectedRevision: summary.revision, seedingSource: "director_nights" });
    expect(summary).toMatchObject({ seedingSource: "director_nights" });

    let revision = summary.revision;
    for (const playerId of racers) {
      const document = await operations.setParticipant(admin, nightId, {
        expectedRevision: revision, playerId, attendance: "present", hasSwitch1: true,
      });
      revision = document.summary.revision;
    }
    let document = await operations.generateGroups(admin, nightId, { expectedRevision: revision, stage: "final" });
    revision = document.summary.revision;
    const group = document.groups[0]!;
    // Racer 4 (unclaimed) wins every race; racer 1, 3, 2 follow.
    const order = [racers[3]!, racers[0]!, racers[2]!, racers[1]!];
    for (const track of ["track.mario_kart_stadium", "track.water_park"]) {
      document = await operations.enterRace(admin, nightId, {
        expectedRevision: revision, groupId: group.groupId, trackId: track, finishOrder: order,
      });
      revision = document.summary.revision;
    }
    document = await operations.advanceWorkflow(admin, nightId, { expectedRevision: revision });
    const finalized = await operations.finalize(admin, nightId, {
      expectedRevision: document.summary.revision, publicResults: true, affectsRating: true, reasonCode: "settings_night_done",
    });
    publicationId = finalized.publicationId!;
    expect(finalized.rating).toMatchObject({ appliedRaces: 2, skippedRaces: 0 });
    const [events] = await pool.execute<RowDataPacket[]>(
      `SELECT DISTINCT player.public_id AS playerId FROM player_rating_events AS event
       INNER JOIN players AS player ON player.player_id = event.player_id
       WHERE event.source_reference = ? ORDER BY player.public_id`,
      [publicationId],
    );
    expect(events.map((row) => row["playerId"])).toEqual([racers[0], racers[1]]);
  });

  it("reads the Director's own published nights for seeding", async () => {
    const repository = new MysqlTournamentOperationRepository(pool);
    const [directors] = await pool.execute<RowDataPacket[]>("SELECT user_account_id AS id FROM user_accounts WHERE public_id = ?", [admin.userAccountId]);
    const director = Number(directors[0]!["id"]);
    const races = await repository.transaction((transaction) => transaction.loadDirectorNightRaces!(director, 0));
    const own = races.filter((race) => race.placements.some((placement) => placement.playerInternalId !== null));
    expect(own).toHaveLength(2);
    const winner = await playerInternal(racers[3]!);
    expect(own.every((race) => race.placements.find((placement) => placement.finishPosition === 1)?.playerInternalId === winner)).toBe(true);
  });

  it("counts only claimed Players after the explicit recalculation, and a newly verified Player's earlier races too", async () => {
    let view = await settings.administration(admin);
    view = await settings.update(admin, { expectedRevision: view.revision, ratingEligibility: "claimed_only" });
    expect(view.ratingRecompute).toMatchObject({ needed: true, eligibilityChanged: true });

    const first = await settings.recomputeRatings(admin);
    expect(first.includedPublications).toBeGreaterThanOrEqual(1);
    const [audit] = await pool.execute<RowDataPacket[]>(
      `SELECT recalculation.reason_code AS reasonCode, account.public_id AS triggeredBy
       FROM rating_recalculations AS recalculation
       INNER JOIN user_accounts AS account ON account.user_account_id = recalculation.triggered_by_user_account_id
       ORDER BY recalculation.rating_recalculation_id DESC LIMIT 1`,
    );
    expect(audit[0]).toMatchObject({ reasonCode: "installation_rating_eligibility", triggeredBy: admin.userAccountId });
    expect(await ratedRacers()).toEqual([racers[0], racers[1]]);
    expect(await nightRaters()).toEqual([racers[0], racers[1]]);
    expect((await settings.administration(admin)).ratingRecompute.needed).toBe(false);

    // Racer 3's claim is approved: the ratings are out of date until recalculated, then racer 3
    // counts - for the old history race and for the verified-only night.
    await verifyClaim(claimants[2]!, racers[2]!, Date.now() + 5);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((await settings.administration(admin)).ratingRecompute).toMatchObject({ needed: true, claimChanges: 1 });
    await settings.recomputeRatings(admin);
    expect(await ratedRacers()).toEqual([racers[0], racers[1], racers[2]]);
    expect(await nightRaters()).toEqual([racers[0], racers[1], racers[2]]);
    const [historyEvents] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM player_rating_events
       WHERE player_id = ? AND source_reference = ? AND rating_epoch = (SELECT MAX(rating_epoch) FROM player_rating_events)`,
      [await playerInternal(racers[2]!), `history_race:${tournamentNumber * 1000 + 1}`],
    );
    expect(Number(historyEvents[0]!["total"])).toBe(1);

    // Back to everybody: racer 4 is rated again after the next recalculation.
    view = await settings.administration(admin);
    await settings.update(admin, { expectedRevision: view.revision, ratingEligibility: "all_players" });
    await settings.recomputeRatings(admin);
    expect(await ratedRacers()).toEqual(racers);
  });
});
