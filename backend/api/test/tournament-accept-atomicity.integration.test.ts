import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

import { MysqlTournamentConnectedRepository } from
  "../src/tournaments/mysql-tournament-connected-repository.js";
import { MysqlTournamentOperationRepository } from
  "../src/tournaments/mysql-tournament-operation-repository.js";
import { MysqlTournamentWriteRepository } from
  "../src/tournaments/mysql-tournament-write-repository.js";
import { MysqlTournamentAcceptUnitOfWork } from
  "../src/tournaments/tournament-accept-unit-of-work.js";
import { TournamentConnectedService } from
  "../src/tournaments/tournament-connected-service.js";
import { TournamentOperationService } from
  "../src/tournaments/tournament-operation-service.js";
import { TournamentRaceResultService } from
  "../src/tournaments/race-result-service.js";

/**
 * Accepting a pending Tournament contribution is several canonical writes
 * across three repositories. Before this suite existed they were three
 * independent transactions, so a refusal partway through - an imported race
 * listing a Player who is not a member of the group - left the race result
 * written with no group and a pending record that could never be accepted
 * again. These cases hold the invariant: Accept commits completely or leaves
 * nothing at all.
 */
const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" ? describe : describe.skip;

const directorId = "user_account.synthetic_atomicity_director";
const tournamentId = "tournament.synthetic_atomicity";
const groupId = "tournament_group.synthetic_atomicity_one";
const memberIds = ["player.synthetic_atomicity_one", "player.synthetic_atomicity_two"];
const outsiderId = "player.synthetic_atomicity_outsider";
const administrator = { role: "administrator" as const, userAccountId: directorId };

/** Incoming result identifiers are bare UUIDs in this schema, not prefixed. */
const pendingId = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

function race(raceResultId: string, playerIds: readonly string[]) {
  return {
    schemaVersion: "mk8dx.tournament-race-result.v1" as const,
    raceResultId,
    revision: 1,
    raceNumber: 1,
    scoringSegment: 1,
    trackId: "track.mario_kart_stadium",
    countsTowardStandings: true,
    placements: playerIds.map((playerId, index) => ({
      finishPosition: index + 1,
      observedPlayerName: `Player ${index + 1}`,
      participantReference: { namespace: "player" as const, value: playerId },
      scoring: {
        racePoints: 15 - index * 3,
        totalBeforeRace: 0,
        totalAfterRace: 15 - index * 3,
        rankAfterRace: index + 1,
      },
    })),
    source: { kind: "tournament_live_capture" as const, transport: "native_contract" as const },
    timestamps: { occurredAtMs: 1_900_000_200_000, createdAtMs: 1_900_000_200_000 },
  };
}

integration("Tournament acceptance is all-or-nothing", () => {
  let pool: Pool;
  let service: TournamentConnectedService;
  let failingOperationsService: TournamentConnectedService;

  /** Everything an Accept could possibly have touched, in one shape. */
  async function snapshot() {
    const [raceResults] = await pool.execute<any[]>(
      "SELECT public_id FROM tournament_race_results WHERE public_id LIKE 'tournament_race_result.synthetic_atomicity%' ORDER BY public_id");
    const [groupRaces] = await pool.execute<any[]>(
      `SELECT race.race_number, result.public_id
         FROM tournament_group_races race
         JOIN tournament_groups grp ON grp.tournament_group_id = race.tournament_group_id
         JOIN tournaments t ON t.tournament_id = grp.tournament_id
         JOIN tournament_race_results result
           ON result.tournament_race_result_id = race.tournament_race_result_id
        WHERE t.public_id = ? ORDER BY race.race_number`, [tournamentId]);
    const [placements] = await pool.execute<any[]>(
      `SELECT COUNT(*) AS total FROM tournament_race_placements placement
         JOIN tournament_race_result_revisions revision
           ON revision.tournament_race_result_revision_id = placement.tournament_race_result_revision_id
         JOIN tournament_race_results result
           ON result.tournament_race_result_id = revision.tournament_race_result_id
        WHERE result.public_id LIKE 'tournament_race_result.synthetic_atomicity%'`);
    const [incoming] = await pool.execute<any[]>(
      `SELECT incoming.public_id, incoming.status, incoming.revision
         FROM tournament_incoming_results incoming
         JOIN tournaments t ON t.tournament_id = incoming.tournament_id
        WHERE t.public_id = ? ORDER BY incoming.public_id`, [tournamentId]);
    const [reviews] = await pool.execute<any[]>(
      `SELECT COUNT(*) AS total FROM tournament_incoming_result_reviews review
         JOIN tournament_incoming_results incoming
           ON incoming.tournament_incoming_result_id = review.tournament_incoming_result_id
         JOIN tournaments t ON t.tournament_id = incoming.tournament_id
        WHERE t.public_id = ?`, [tournamentId]);
    const [tournament] = await pool.execute<any[]>(
      "SELECT revision, workflow_step FROM tournaments WHERE public_id = ?", [tournamentId]);
    const [lifecycle] = await pool.execute<any[]>(
      `SELECT COUNT(*) AS total FROM tournament_lifecycle lifecycle
         JOIN tournaments t ON t.tournament_id = lifecycle.tournament_id
        WHERE t.public_id = ?`, [tournamentId]);
    return {
      raceResults: raceResults.map((row) => row.public_id),
      groupRaces: groupRaces.map((row) => `${row.race_number}:${row.public_id}`),
      placements: Number(placements[0]?.total ?? 0),
      incoming: incoming.map((row) => `${row.public_id}:${row.status}:${row.revision}`),
      reviews: Number(reviews[0]?.total ?? 0),
      tournamentRevision: Number(tournament[0]?.revision ?? 0),
      workflowStep: Number(tournament[0]?.workflow_step ?? 0),
      lifecycle: Number(lifecycle[0]?.total ?? 0),
    };
  }

  /** A pending contribution with the placements a caller asks for. */
  async function seedPending(publicId: string, playerIds: readonly string[]) {
    await pool.execute(
      `INSERT INTO tournament_incoming_results (
         public_id, tournament_id, source_kind, status, revision,
         result_payload_json, semantic_fingerprint, suggested_phase,
         suggested_group_public_id, suggested_race_number, occurred_at_ms,
         captured_at_ms, submitted_by_user_account_id, created_at_ms, updated_at_ms
       ) SELECT ?, tournament_id, 'tournament_live_capture', 'pending', 1,
                ?, ?, 'qualifier', ?, 1, 1900000200000, 1900000200000,
                (SELECT user_account_id FROM user_accounts WHERE public_id = ?), 1, 1
           FROM tournaments WHERE public_id = ?`,
      [publicId,
        JSON.stringify(race(`tournament_race_result.synthetic_atomicity_${publicId.slice(-1)}`, playerIds)),
        `fingerprint-${publicId}`, groupId, directorId, tournamentId],
    );
  }

  async function currentTournamentRevision(): Promise<number> {
    const [rows] = await pool.execute<any[]>(
      "SELECT revision FROM tournaments WHERE public_id = ?", [tournamentId]);
    return Number(rows[0]?.revision ?? 0);
  }

  const acceptInput = (incomingResultId: string, correctedPlayers: readonly string[]) => ({
    incomingResultId,
    expectedRevision: 1,
    tournamentRevision: 0,
    groupId,
    raceNumber: 1,
    correctedResult: race(
      `tournament_race_result.synthetic_atomicity_${incomingResultId.slice(-1)}`,
      correctedPlayers,
    ),
    reason: "atomicity regression",
  });

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

    await pool.execute(
      `INSERT INTO user_accounts (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
       VALUES (?, 1, 'private', 'active', 1, 1)`, [directorId]);
    await pool.execute(
      `INSERT INTO administrator_grants (public_id, revision, user_account_id, grant_status, grant_origin, granted_at_ms, updated_at_ms)
       SELECT 'administrator_grant.synthetic_atomicity', 1, user_account_id, 'active', 'administrator', 1, 1
         FROM user_accounts WHERE public_id = ?`, [directorId]);
    for (const [index, playerId] of [...memberIds, outsiderId].entries()) {
      await pool.execute(
        // display_name_key is a generated column; the schema derives it.
        `INSERT INTO players (public_id, revision, player_kind, display_name, record_status, created_at_ms, updated_at_ms)
         VALUES (?, 1, 'human', ?, 'active', 1, 1)`,
        [playerId, `Atomicity ${index + 1}`]);
    }
    await pool.execute(
      `INSERT INTO tournaments (
         public_id, name, start_at_ms, timezone_name, director_user_account_id, stage,
         lifecycle_status, workflow_step, qualifier_rounds, revision, seed_order,
         placement_strategy, public_results, affects_rating, created_at_ms, updated_at_ms
       ) SELECT ?, 'Atomicity integration', 1900000000000, 'Europe/Amsterdam', user_account_id,
                'qualifiers', 'active', 5, TRUE, 1, 'ranked', 'balanced', FALSE, FALSE, 1, 1
           FROM user_accounts WHERE public_id = ?`, [tournamentId, directorId]);
    await pool.execute(
      `INSERT INTO tournament_groups (
         tournament_id, public_id, stage, sequence_number, name, locked,
         manual_score_segments, created_at_ms, updated_at_ms
       ) SELECT tournament_id, ?, 'qualifier', 1, 'Groep 1', FALSE, 1, 1, 1
           FROM tournaments WHERE public_id = ?`, [groupId, tournamentId]);
    for (const [index, playerId] of memberIds.entries()) {
      await pool.execute(
        `INSERT INTO tournament_participants (tournament_id, player_id, attendance, has_switch_1, has_switch_2, added_at_ms, updated_at_ms)
         SELECT t.tournament_id, p.player_id, 'present', ?, FALSE, 1, 1
           FROM tournaments t JOIN players p ON p.public_id = ?
          WHERE t.public_id = ?`, [index === 0, playerId, tournamentId]);
      await pool.execute(
        `INSERT INTO tournament_group_members (tournament_group_id, player_id, seat_order)
         SELECT g.tournament_group_id, p.player_id, ?
           FROM tournament_groups g JOIN players p ON p.public_id = ?
          WHERE g.public_id = ?`, [index + 1, playerId, groupId]);
    }

    const build = (connection: any) => ({
      repository: new MysqlTournamentConnectedRepository(pool, connection),
      raceResults: new TournamentRaceResultService(
        new MysqlTournamentWriteRepository(pool, connection),
        // Asset validation is not what this suite exercises.
        { async validateReferences() { return []; } },
        passthroughProtector(),
      ),
      operations: new TournamentOperationService({
        repository: new MysqlTournamentOperationRepository(pool, connection),
        raceResults: { async submit() { throw new Error("unused"); } } as never,
        publications: { async review() { throw new Error("unused"); } } as never,
        rating: { async include() { throw new Error("unused"); } } as never,
        ids: {
          newTournamentId: () => "tournament.unused",
          newGroupId: () => "tournament_group.unused",
        },
        clock: { nowMs: () => 1_900_000_300_000 },
      }),
    });

    service = new TournamentConnectedService(
      new MysqlTournamentConnectedRepository(pool),
      { async submit() { throw new Error("accept must go through the unit of work"); } },
      { async attachRaces() { throw new Error("accept must go through the unit of work"); } },
      () => 1_900_000_300_000,
      new MysqlTournamentAcceptUnitOfWork(pool, build),
    );

    // The same wiring, except that the attachment step fails for a reason the
    // service cannot foresee. It stands in for any downstream failure after a
    // canonical write has already happened.
    failingOperationsService = new TournamentConnectedService(
      new MysqlTournamentConnectedRepository(pool),
      { async submit() { throw new Error("unused"); } },
      { async attachRaces() { throw new Error("unused"); } },
      () => 1_900_000_300_000,
      new MysqlTournamentAcceptUnitOfWork(pool, (connection) => ({
        ...build(connection),
        operations: {
          async attachRaces() {
            throw new Error("synthetic downstream failure after a canonical write");
          },
        },
      })),
    );
  });

  beforeEach(async () => {
    await pool.execute(
      `DELETE review FROM tournament_incoming_result_reviews review
         JOIN tournament_incoming_results incoming
           ON incoming.tournament_incoming_result_id = review.tournament_incoming_result_id
         JOIN tournaments t ON t.tournament_id = incoming.tournament_id
        WHERE t.public_id = ?`, [tournamentId]);
    await pool.execute(
      `DELETE incoming FROM tournament_incoming_results incoming
         JOIN tournaments t ON t.tournament_id = incoming.tournament_id
        WHERE t.public_id = ?`, [tournamentId]);
    await pool.execute(
      `DELETE race FROM tournament_group_races race
         JOIN tournament_groups grp ON grp.tournament_group_id = race.tournament_group_id
         JOIN tournaments t ON t.tournament_id = grp.tournament_id
        WHERE t.public_id = ?`, [tournamentId]);
    await pool.execute(
      `DELETE placement FROM tournament_race_placements placement
         JOIN tournament_race_result_revisions revision
           ON revision.tournament_race_result_revision_id = placement.tournament_race_result_revision_id
         JOIN tournament_race_results result
           ON result.tournament_race_result_id = revision.tournament_race_result_id
        WHERE result.public_id LIKE 'tournament_race_result.synthetic_atomicity%'`);
    await pool.execute(
      `DELETE revision FROM tournament_race_result_revisions revision
         JOIN tournament_race_results result
           ON result.tournament_race_result_id = revision.tournament_race_result_id
        WHERE result.public_id LIKE 'tournament_race_result.synthetic_atomicity%'`);
    await pool.execute(
      "DELETE FROM tournament_race_results WHERE public_id LIKE 'tournament_race_result.synthetic_atomicity%'");
  });

  afterAll(async () => {
    await pool.execute(
      `DELETE review FROM tournament_incoming_result_reviews review
         JOIN tournament_incoming_results incoming
           ON incoming.tournament_incoming_result_id = review.tournament_incoming_result_id
         JOIN tournaments t ON t.tournament_id = incoming.tournament_id
        WHERE t.public_id = ?`, [tournamentId]);
    await pool.execute(
      `DELETE incoming FROM tournament_incoming_results incoming
         JOIN tournaments t ON t.tournament_id = incoming.tournament_id
        WHERE t.public_id = ?`, [tournamentId]);
    await pool.execute(
      `DELETE race FROM tournament_group_races race
         JOIN tournament_groups grp ON grp.tournament_group_id = race.tournament_group_id
         JOIN tournaments t ON t.tournament_id = grp.tournament_id
        WHERE t.public_id = ?`, [tournamentId]);
    await pool.execute(
      `DELETE placement FROM tournament_race_placements placement
         JOIN tournament_race_result_revisions revision
           ON revision.tournament_race_result_revision_id = placement.tournament_race_result_revision_id
         JOIN tournament_race_results result
           ON result.tournament_race_result_id = revision.tournament_race_result_id
        WHERE result.public_id LIKE 'tournament_race_result.synthetic_atomicity%'`);
    await pool.execute(
      `DELETE revision FROM tournament_race_result_revisions revision
         JOIN tournament_race_results result
           ON result.tournament_race_result_id = revision.tournament_race_result_id
        WHERE result.public_id LIKE 'tournament_race_result.synthetic_atomicity%'`);
    await pool.execute(
      "DELETE FROM tournament_race_results WHERE public_id LIKE 'tournament_race_result.synthetic_atomicity%'");
    await pool.execute(
      `DELETE member FROM tournament_group_members member
         JOIN tournament_groups grp ON grp.tournament_group_id = member.tournament_group_id
         JOIN tournaments t ON t.tournament_id = grp.tournament_id
        WHERE t.public_id = ?`, [tournamentId]);
    await pool.execute(
      `DELETE participant FROM tournament_participants participant
         JOIN tournaments t ON t.tournament_id = participant.tournament_id
        WHERE t.public_id = ?`, [tournamentId]);
    await pool.execute(
      `DELETE grp FROM tournament_groups grp
         JOIN tournaments t ON t.tournament_id = grp.tournament_id
        WHERE t.public_id = ?`, [tournamentId]);
    await pool.execute(
      `DELETE lifecycle FROM tournament_lifecycle lifecycle
         JOIN tournaments t ON t.tournament_id = lifecycle.tournament_id
        WHERE t.public_id = ?`, [tournamentId]);
    await pool.execute("DELETE FROM tournaments WHERE public_id = ?", [tournamentId]);
    await pool.execute(
      "DELETE FROM players WHERE public_id IN (?, ?, ?)", [...memberIds, outsiderId]);
    await pool.execute(
      "DELETE FROM administrator_grants WHERE public_id = 'administrator_grant.synthetic_atomicity'");
    await pool.execute("DELETE FROM user_accounts WHERE public_id = ?", [directorId]);
    await pool.end();
  });

  it("leaves nothing behind when Accept is refused, and accepts cleanly after the correction", async () => {
    await seedPending(pendingId(1), memberIds);
    const before = await snapshot();
    expect(before.raceResults).toEqual([]);

    // A race listing somebody who is not seated in this group: the refusal that
    // used to arrive only after the race result had been written.
    await expect(service.accept(administrator, {
      ...acceptInput(pendingId(1),
        [memberIds[0]!, outsiderId]),
      tournamentRevision: await currentTournamentRevision(),
    })).rejects.toMatchObject({ code: "conflict" });

    const afterFailure = await snapshot();
    expect(afterFailure).toEqual(before);
    expect(afterFailure.raceResults).toEqual([]);
    expect(afterFailure.groupRaces).toEqual([]);
    expect(afterFailure.placements).toBe(0);
    expect(afterFailure.reviews).toBe(0);
    expect(afterFailure.incoming[0]).toContain(":pending:1");

    // The same pending contribution, corrected through the ordinary path.
    const accepted = await service.accept(administrator, {
      ...acceptInput(pendingId(1), memberIds),
      tournamentRevision: await currentTournamentRevision(),
    });
    expect(accepted.raceResultId).toBe("tournament_race_result.synthetic_atomicity_1");

    const afterSuccess = await snapshot();
    expect(afterSuccess.raceResults).toEqual(["tournament_race_result.synthetic_atomicity_1"]);
    expect(afterSuccess.groupRaces).toEqual(["1:tournament_race_result.synthetic_atomicity_1"]);
    expect(afterSuccess.placements).toBe(2);
    expect(afterSuccess.incoming[0]).toContain(":accepted:");
    expect(afterSuccess.reviews).toBe(1);
    expect(afterSuccess.tournamentRevision).toBeGreaterThan(before.tournamentRevision);
  });

  it("refuses a duplicate acceptance and leaves exactly one race", async () => {
    await seedPending(pendingId(1), memberIds);
    await service.accept(administrator, {
      ...acceptInput(pendingId(1), memberIds),
      tournamentRevision: await currentTournamentRevision(),
    });
    const afterFirst = await snapshot();

    await expect(service.accept(administrator, {
      ...acceptInput(pendingId(1), memberIds),
      tournamentRevision: await currentTournamentRevision(),
    })).rejects.toMatchObject({ code: "conflict" });

    const afterDuplicate = await snapshot();
    expect(afterDuplicate.raceResults).toEqual(afterFirst.raceResults);
    expect(afterDuplicate.groupRaces).toEqual(afterFirst.groupRaces);
    expect(afterDuplicate.placements).toBe(afterFirst.placements);
    expect(afterDuplicate.reviews).toBe(afterFirst.reviews);
  });

  it("rolls back an unforeseen failure after the race result has been written", async () => {
    await seedPending(pendingId(2), memberIds);
    const before = await snapshot();

    await expect(failingOperationsService.accept(administrator, {
      ...acceptInput(pendingId(2), memberIds),
      tournamentRevision: await currentTournamentRevision(),
    })).rejects.toThrow(/synthetic downstream failure/u);

    // The race result was written inside the transaction and must be gone.
    const afterFailure = await snapshot();
    expect(afterFailure).toEqual(before);
    expect(afterFailure.raceResults).toEqual([]);
    expect(afterFailure.placements).toBe(0);
  });

  it("leaves no race behind when a group feed is refused on its second race", async () => {
    // acceptGroup promises the Tournament is revised once with the complete
    // ordered race set. A refusal on the last race must therefore leave the
    // first one unwritten too.
    await seedPending(pendingId(1), memberIds);
    await seedPending(pendingId(2), memberIds);
    const before = await snapshot();

    await expect(service.acceptGroup(administrator, {
      tournamentRevision: await currentTournamentRevision(),
      groupId,
      entries: [
        {
          incomingResultId: pendingId(1),
          expectedRevision: 1,
          raceNumber: 1,
          correctedResult: race(
            "tournament_race_result.synthetic_atomicity_1", memberIds),
        },
        {
          // The second race lists somebody who is not seated in this group.
          incomingResultId: pendingId(2),
          expectedRevision: 1,
          raceNumber: 2,
          correctedResult: race(
            "tournament_race_result.synthetic_atomicity_2",
            [memberIds[0]!, outsiderId]),
        },
      ],
      reason: "atomicity regression, partial group feed",
    })).rejects.toMatchObject({ code: "conflict" });

    const afterFailure = await snapshot();
    expect(afterFailure).toEqual(before);
    expect(afterFailure.raceResults).toEqual([]);
    expect(afterFailure.groupRaces).toEqual([]);
    expect(afterFailure.incoming.every((row) => row.includes(":pending:1"))).toBe(true);
  });

  it("never creates two races when two operators accept at the same moment", async () => {
    await seedPending(pendingId(1), memberIds);
    const revision = await currentTournamentRevision();
    const attempt = () => service.accept(administrator, {
      ...acceptInput(pendingId(1), memberIds),
      tournamentRevision: revision,
    });

    const outcomes = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    expect(fulfilled.length).toBeLessThanOrEqual(1);

    const after = await snapshot();
    expect(after.groupRaces.length).toBeLessThanOrEqual(1);
    expect(after.raceResults.length).toBeLessThanOrEqual(1);
  });
});

// The protector the race-result service needs, reduced to what an acceptance
// test exercises: every placement here carries a canonical Player id, so no
// restricted value is ever protected.
function passthroughProtector() {
  return {
    async protectParticipantReference() {
      return { protectedReference: "unused", lookupHash: "unused" };
    },
    async protectContextReference() {
      return { protectedReference: "unused", lookupHash: "unused" };
    },
    async protectEvidenceReference() { return "unused"; },
    async protectVerificationIssueMessage() { return "unused"; },
  } as never;
}
