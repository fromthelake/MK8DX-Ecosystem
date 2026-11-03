import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

import { MysqlTournamentPublicationRepository } from
  "../src/tournaments/mysql-tournament-publication-repository.js";
import { MysqlPublicTournamentRepository } from
  "../src/tournaments/mysql-public-tournament-repository.js";
import { TournamentPublicationService } from
  "../src/tournaments/tournament-publication-service.js";

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

const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" ? describe : describe.skip;
const administrator = {
  role: "administrator" as const,
  userAccountId: "user_account.synthetic_tournament_publication_admin",
};
const publicationId = "tournament_publication.synthetic_publication_001";
const resultIds = [
  "tournament_race_result.synthetic_publication_race_001",
  "tournament_race_result.synthetic_publication_race_002",
] as const;
const playerIds = [
  "player.synthetic_publication_racer_001",
  "player.synthetic_publication_racer_002",
] as const;

integration("audited Tournament publication integration", () => {
  let pool: Pool;
  let service: TournamentPublicationService;
  let publicRepository: MysqlPublicTournamentRepository;
  let now = 1_900_000_000_000;

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
    service = new TournamentPublicationService(
      new MysqlTournamentPublicationRepository(pool),
      { newPublicationId: () => publicationId },
      { nowMs: () => now },
    );
    publicRepository = new MysqlPublicTournamentRepository(pool);
    const [migrations] = await pool.execute<any[]>(
      "SELECT migration_version FROM schema_migrations ORDER BY migration_version",
    );
    expect(migrations).toHaveLength(pinnedMigrationCatalogLength);
    for (const [index, playerId] of playerIds.entries()) {
      await pool.execute(
        `INSERT INTO players
         (public_id, revision, player_kind, display_name, record_status,
          created_at_ms, updated_at_ms)
         VALUES (?, 1, 'human', ?, 'active', 1, 1)`,
        [playerId, `Publication Racer ${index + 1}`],
      );
      await pool.execute(
        `INSERT INTO player_username_history
         (player_id, sequence_number, username_value, comparison_key, allocated_at_ms)
         SELECT player_id, 1, ?, ?, 1 FROM players WHERE public_id = ?`,
        [`PublicationRacer${index + 1}`, Buffer.from(`publicationracer${index + 1}`), playerId],
      );
    }
    await pool.execute(
      `INSERT INTO user_accounts
       (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
       VALUES (?, 1, 'private', 'active', 1, 1)`,
      [administrator.userAccountId],
    );
    await pool.execute(
      `INSERT INTO administrator_grants
       (public_id, revision, user_account_id, grant_status, grant_origin,
        granted_at_ms, updated_at_ms)
       SELECT 'administrator_grant.synthetic_tournament_publication_admin', 1,
              user_account_id, 'active', 'bootstrap_cli', 1, 1
       FROM user_accounts WHERE public_id = ?`,
      [administrator.userAccountId],
    );
    await insertRace(0, 1, [[15, 15, 1], [12, 12, 2]]);
    await insertRace(1, 1, [[12, 27, 1], [15, 27, 1]]);
  });

  afterAll(async () => {
    if (pool === undefined) { return; }
    await pool.execute("DELETE FROM tournament_publication_current_members WHERE tournament_publication_id IN (SELECT tournament_publication_id FROM tournament_publications WHERE public_id = ?)", [publicationId]);
    await pool.execute("DELETE member FROM tournament_publication_lifecycle_members AS member INNER JOIN tournament_publication_lifecycle AS lifecycle ON lifecycle.tournament_publication_lifecycle_id = member.tournament_publication_lifecycle_id INNER JOIN tournament_publications AS publication ON publication.tournament_publication_id = lifecycle.tournament_publication_id WHERE publication.public_id = ?", [publicationId]);
    await pool.execute("DELETE lifecycle FROM tournament_publication_lifecycle AS lifecycle INNER JOIN tournament_publications AS publication ON publication.tournament_publication_id = lifecycle.tournament_publication_id WHERE publication.public_id = ?", [publicationId]);
    await pool.execute("DELETE FROM tournament_publications WHERE public_id = ?", [publicationId]);
    await pool.execute("DELETE placement FROM tournament_race_placements AS placement INNER JOIN tournament_race_result_revisions AS revision ON revision.tournament_race_result_revision_id = placement.tournament_race_result_revision_id INNER JOIN tournament_race_results AS result ON result.tournament_race_result_id = revision.tournament_race_result_id WHERE result.public_id IN (?, ?)", [...resultIds]);
    await pool.execute("DELETE revision FROM tournament_race_result_revisions AS revision INNER JOIN tournament_race_results AS result ON result.tournament_race_result_id = revision.tournament_race_result_id WHERE result.public_id IN (?, ?)", [...resultIds]);
    await pool.execute("DELETE FROM tournament_race_results WHERE public_id IN (?, ?)", [...resultIds]);
    await pool.execute("DELETE FROM administrator_grants WHERE public_id = 'administrator_grant.synthetic_tournament_publication_admin'");
    await pool.execute("DELETE FROM user_accounts WHERE public_id = ?", [administrator.userAccountId]);
    await pool.execute("DELETE username FROM player_username_history AS username INNER JOIN players AS player ON player.player_id = username.player_id WHERE player.public_id IN (?, ?)", [...playerIds]);
    await pool.execute("DELETE FROM players WHERE public_id IN (?, ?)", [...playerIds]);
    await pool.end();
  });

  async function insertRace(
    resultIndex: 0 | 1,
    revision: number,
    scoring: readonly [number, number, number][],
  ): Promise<void> {
    if (revision === 1) {
      await pool.execute(
        `INSERT INTO tournament_race_results (public_id, first_created_at_ms)
         VALUES (?, ?)`,
        [resultIds[resultIndex], 1_899_999_000_000 + resultIndex],
      );
    }
    await pool.execute(
      `INSERT INTO tournament_race_result_revisions
       (tournament_race_result_id, revision_number, schema_version, race_number,
        scoring_segment, mode_cc, track_id, counts_toward_standings,
        source_kind, source_transport, created_at_ms, occurred_at_ms)
       SELECT tournament_race_result_id, ?, 'mk8dx.tournament-race-result.v1',
              ?, 1, 150, ?, 1, 'tournament_recorded_video',
              'native_contract', ?, ?
       FROM tournament_race_results WHERE public_id = ?`,
      [
        revision,
        resultIndex + 1,
        resultIndex === 0 ? "track.mario_kart_stadium" : "track.water_park",
        1_899_999_000_000 + resultIndex * 1_000 + revision,
        1_899_999_000_000 + resultIndex * 1_000,
        resultIds[resultIndex],
      ],
    );
    for (const [index, [racePoints, totalAfterRace, rankAfterRace]] of scoring.entries()) {
      const totalBeforeRace = totalAfterRace - racePoints;
      await pool.execute(
        `INSERT INTO tournament_race_placements
         (tournament_race_result_revision_id, finish_position,
          participant_reference_kind, player_id, observed_player_name,
          race_points, total_before_race, total_after_race, rank_after_race)
         SELECT revision.tournament_race_result_revision_id, ?, 'player',
                player.player_id, ?, ?, ?, ?, ?
         FROM tournament_race_result_revisions AS revision
         INNER JOIN tournament_race_results AS result
           ON result.tournament_race_result_id = revision.tournament_race_result_id
         CROSS JOIN players AS player
         WHERE result.public_id = ? AND revision.revision_number = ?
           AND player.public_id = ?`,
        [
          index + 1,
          `Private observed racer ${index + 1}`,
          racePoints,
          totalBeforeRace,
          totalAfterRace,
          rankAfterRace,
          resultIds[resultIndex],
          revision,
          playerIds[index]!,
        ],
      );
    }
  }

  it("publishes, retracts, republishes, and corrects an exact current result set", async () => {
    const targets = resultIds.map((raceResultId) => ({ raceResultId, revision: 1 }));
    const review = await service.listReview(administrator);
    expect(review.candidates).toHaveLength(2);
    expect(review.candidates.every((candidate) => candidate.publishable)).toBe(true);

    const created = await service.createPublication(administrator, {
      eventName: "Synthetic Publication Cup",
      targets,
      reasonCode: "event_completed",
    });
    expect(created).toMatchObject({ status: "published", revision: 1, resultCount: 2 });
    expect(await publicRepository.loadPublication(publicationId)).toMatchObject({
      eventName: "Synthetic Publication Cup",
      standings: [
        { playerId: playerIds[0], totalPoints: 27, rank: 1 },
        { playerId: playerIds[1], totalPoints: 27, rank: 1 },
      ],
    });
    expect(await publicRepository.listPlayerResults(playerIds[0])).toHaveLength(2);

    now += 1;
    const retracted = await service.retract(administrator, publicationId, {
      expectedRevision: 1,
      reasonCode: "operator_retraction",
    });
    expect(retracted).toMatchObject({ status: "retracted", revision: 2, resultCount: 0 });
    expect(await publicRepository.loadPublication(publicationId)).toBeNull();
    expect(await publicRepository.listPlayerResults(playerIds[0])).toEqual([]);

    now += 1;
    await service.republish(administrator, publicationId, {
      expectedRevision: 2,
      eventName: "Synthetic Publication Cup",
      targets,
      reasonCode: "review_completed",
    });
    await insertRace(1, 2, [[15, 30, 1], [12, 24, 2]]);
    await expect(service.republish(administrator, publicationId, {
      expectedRevision: 3,
      eventName: "Synthetic Publication Cup",
      targets,
      reasonCode: "score_correction",
    })).rejects.toMatchObject({ code: "conflict" });
    now += 1;
    await service.republish(administrator, publicationId, {
      expectedRevision: 3,
      eventName: "Synthetic Publication Cup Final",
      targets: [targets[0]!, { raceResultId: resultIds[1], revision: 2 }],
      reasonCode: "score_correction",
    });
    const corrected = await publicRepository.loadPublication(publicationId);
    expect(corrected).toMatchObject({
      eventName: "Synthetic Publication Cup Final",
      standings: [
        { playerId: playerIds[0], totalPoints: 30, rank: 1 },
        { playerId: playerIds[1], totalPoints: 24, rank: 2 },
      ],
    });
    expect(JSON.stringify(corrected)).not.toMatch(
      /Private observed|evidence|verification|confidence|source|user_account|administrator/i,
    );
    const [lifecycle] = await pool.execute<any[]>(
      `SELECT lifecycle.publication_revision AS revisionValue,
              lifecycle.event_type AS eventType, lifecycle.reason_code AS reasonCode,
              COUNT(member.tournament_publication_lifecycle_member_id) AS memberCount
       FROM tournament_publication_lifecycle AS lifecycle
       INNER JOIN tournament_publications AS publication
         ON publication.tournament_publication_id = lifecycle.tournament_publication_id
       LEFT JOIN tournament_publication_lifecycle_members AS member
         ON member.tournament_publication_lifecycle_id =
            lifecycle.tournament_publication_lifecycle_id
       WHERE publication.public_id = ?
       GROUP BY lifecycle.tournament_publication_lifecycle_id
       ORDER BY lifecycle.publication_revision`,
      [publicationId],
    );
    expect(lifecycle).toEqual([
      { revisionValue: 1, eventType: "published", reasonCode: "event_completed", memberCount: 2 },
      { revisionValue: 2, eventType: "retracted", reasonCode: "operator_retraction", memberCount: 0 },
      { revisionValue: 3, eventType: "published", reasonCode: "review_completed", memberCount: 2 },
      { revisionValue: 4, eventType: "published", reasonCode: "score_correction", memberCount: 2 },
    ]);
  });
});
