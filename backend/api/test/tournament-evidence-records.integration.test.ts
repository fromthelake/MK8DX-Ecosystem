import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

import { MysqlTournamentConnectedRepository } from
  "../src/tournaments/mysql-tournament-connected-repository.js";
import { TournamentConnectedService } from
  "../src/tournaments/tournament-connected-service.js";

const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" ? describe : describe.skip;
const directorId = "user_account.synthetic_evidence_director";
const uploaderId = "user_account.synthetic_evidence_uploader";
const tournamentId = "tournament.synthetic_evidence_records";
const groupId = "tournament_group.synthetic_evidence_one";
const secondGroupId = "tournament_group.synthetic_evidence_two";

function race(raceNumber: number) {
  return {
    schemaVersion: "mk8dx.tournament-race-result.v1" as const,
    raceResultId: `tournament_race_result.synthetic_evidence_${raceNumber}`,
    revision: 1,
    raceNumber,
    scoringSegment: 1,
    trackId: "track.mario_kart_stadium",
    countsTowardStandings: true,
    placements: [
      { finishPosition: 1, observedPlayerName: "Moss", participantReference: { namespace: "producer_local_player" as const, value: "local.moss" }, scoring: { racePoints: 15, totalBeforeRace: 0, totalAfterRace: 15, rankAfterRace: 1 } },
      { finishPosition: 2, observedPlayerName: "Evan", participantReference: { namespace: "producer_local_player" as const, value: "local.evan" }, scoring: { racePoints: 12, totalBeforeRace: 0, totalAfterRace: 12, rankAfterRace: 2 } },
    ],
    source: { kind: "tournament_live_capture" as const, transport: "native_contract" as const },
    timestamps: { occurredAtMs: 1_900_000_000_000 + raceNumber, createdAtMs: 1_900_000_001_000 + raceNumber },
  };
}

integration("independent Tournament evidence records", () => {
  let pool: Pool;
  let service: TournamentConnectedService;

  beforeAll(async () => {
    const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
    if (!database.endsWith("_test") && !database.endsWith("_contract")) throw new Error("explicit test schema required");
    const options: PoolOptions = {
      host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
      port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306"),
      user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "mk8dx_test",
      database,
    };
    if (process.env["MK8DX_MYSQL_TEST_PASSWORD"] !== undefined) options.password = process.env["MK8DX_MYSQL_TEST_PASSWORD"];
    pool = mysql.createPool(options);
    await pool.execute(
      `INSERT INTO user_accounts (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
       VALUES (?, 1, 'private', 'active', 1, 1), (?, 1, 'private', 'active', 1, 1)`,
      [directorId, uploaderId],
    );
    await pool.execute(
      `INSERT INTO administrator_grants (public_id, revision, user_account_id, grant_status, grant_origin, granted_at_ms, updated_at_ms)
       SELECT 'administrator_grant.synthetic_evidence_director', 1, user_account_id, 'active', 'administrator', 1, 1
         FROM user_accounts WHERE public_id = ?`,
      [directorId],
    );
    await pool.execute(
      `INSERT INTO tournaments (
         public_id, name, start_at_ms, timezone_name, director_user_account_id, stage,
         lifecycle_status, workflow_step, qualifier_rounds, revision, seed_order,
         placement_strategy, public_results, affects_rating, created_at_ms, updated_at_ms
       ) SELECT ?, 'Evidence integration', 1900000000000, 'Europe/Amsterdam', user_account_id,
                'qualifiers', 'active', 5, TRUE, 1, 'ranked', 'balanced', FALSE, FALSE, 1, 1
           FROM user_accounts WHERE public_id = ?`,
      [tournamentId, directorId],
    );
    await pool.execute(
      `INSERT INTO tournament_groups (
         tournament_id, public_id, stage, sequence_number, name, locked,
         manual_score_segments, created_at_ms, updated_at_ms
       ) SELECT tournament_id, ?, 'qualifier', 1, 'Groep 1', TRUE, 1, 1, 1
           FROM tournaments WHERE public_id = ?`,
      [groupId, tournamentId],
    );
    await pool.execute(
      `INSERT INTO tournament_groups (
         tournament_id, public_id, stage, sequence_number, name, locked,
         manual_score_segments, created_at_ms, updated_at_ms
       ) SELECT tournament_id, ?, 'qualifier', 2, 'Groep 2', TRUE, 1, 1, 1
           FROM tournaments WHERE public_id = ?`,
      [secondGroupId, tournamentId],
    );
    service = new TournamentConnectedService(
      new MysqlTournamentConnectedRepository(pool),
      { async submit() { throw new Error("linking evidence must not score"); } },
      { async attachRaces() { throw new Error("linking evidence must not attach races"); } },
      () => 1_900_000_100_000,
    );
  });

  afterAll(async () => {
    await pool.execute("DELETE review FROM tournament_incoming_result_reviews review JOIN tournament_incoming_results incoming ON incoming.tournament_incoming_result_id = review.tournament_incoming_result_id JOIN tournaments tournament ON tournament.tournament_id = incoming.tournament_id WHERE tournament.public_id = ?", [tournamentId]);
    await pool.execute("DELETE incoming FROM tournament_incoming_results incoming JOIN tournaments tournament ON tournament.tournament_id = incoming.tournament_id WHERE tournament.public_id = ?", [tournamentId]);
    await pool.execute("DELETE audit FROM tournament_live_mapping_audit audit JOIN tournament_evidence_records evidence ON evidence.tournament_evidence_record_id = audit.tournament_evidence_record_id WHERE evidence.client_record_id LIKE 'run-evidence-integration%'");
    await pool.execute("DELETE FROM tournament_evidence_records WHERE client_record_id LIKE 'run-evidence-integration%'");
    await pool.execute("DELETE group_row FROM tournament_groups group_row JOIN tournaments tournament ON tournament.tournament_id = group_row.tournament_id WHERE tournament.public_id = ?", [tournamentId]);
    await pool.execute("DELETE lifecycle FROM tournament_lifecycle lifecycle JOIN tournaments tournament ON tournament.tournament_id = lifecycle.tournament_id WHERE tournament.public_id = ?", [tournamentId]);
    await pool.execute("DELETE FROM tournaments WHERE public_id = ?", [tournamentId]);
    await pool.execute("DELETE FROM administrator_grants WHERE public_id = 'administrator_grant.synthetic_evidence_director'");
    await pool.execute("DELETE FROM user_accounts WHERE public_id IN (?, ?)", [directorId, uploaderId]);
    await pool.end();
  });

  it("uploads unscored evidence, exposes it to the director and materializes reviewed pending races", async () => {
    const evidence = {
      clientRecordId: "run-evidence-integration",
      startedAtMs: 1_900_000_000_000,
      stoppedAtMs: 1_900_000_090_000,
      analysisCompletedAtMs: 1_900_000_099_000,
      complete: true as const,
      entries: [1, 2].map((number) => ({
        entryKey: `feed-one:${number}`,
        observedGroupLabel: "Groep 1",
        result: race(number),
      })),
    };
    const unassigned = await service.uploadEvidenceRecord(
      { role: "account", userAccountId: uploaderId }, evidence,
    );
    expect(unassigned.suggestedTournamentId).toBeNull();

    const uploaded = await service.uploadEvidenceRecord(
      { role: "account", userAccountId: uploaderId },
      { ...evidence, suggestedTournamentId: tournamentId },
    );
    expect(uploaded.status).toBe("available");
    expect(uploaded.revision).toBe(unassigned.revision + 1);
    expect(uploaded.suggestedTournamentId).toBe(tournamentId);
    expect(uploaded.groups[0]).toMatchObject({ observedGroupLabel: "Groep 1", races: 2 });

    const visible = await service.listEvidenceRecords({ role: "administrator", userAccountId: directorId }, tournamentId);
    expect(visible.map((record) => record.recordId)).toContain(uploaded.recordId);
    const pending = await service.linkEvidenceRecord({ role: "administrator", userAccountId: directorId }, {
      tournamentId,
      recordId: uploaded.recordId,
      expectedRevision: uploaded.revision,
      mappings: [{ observedGroupLabel: "Groep 1", groupId, phase: "qualifier" }],
      reason: "Integration director checked uploader, time, groups and top three",
    });
    expect(pending).toHaveLength(2);
    expect(pending.every((entry) => entry.status === "pending" && entry.suggestedGroupId === groupId)).toBe(true);
    expect((await service.listIncoming({ role: "administrator", userAccountId: directorId }, tournamentId)).length).toBe(2);
    const linked = (await service.listEvidenceRecords(
      { role: "administrator", userAccountId: directorId }, tournamentId,
    )).find((record) => record.recordId === uploaded.recordId)!;
    const remapped = await service.linkEvidenceRecord({ role: "administrator", userAccountId: directorId }, {
      tournamentId,
      recordId: uploaded.recordId,
      expectedRevision: linked.revision,
      mappings: [{ observedGroupLabel: "Groep 1", groupId, phase: "qualifier" }],
      reason: "Integration director rechecked links after layout rollback",
    });
    expect(remapped.every((entry) => entry.revision === 2 && entry.suggestedGroupId === groupId)).toBe(true);
  });

  it("publishes only a director-approved live mapping and completes it after Stop upload", async () => {
    const uploader = { role: "account" as const, userAccountId: uploaderId };
    const director = { role: "administrator" as const, userAccountId: directorId };
    const requested = await service.uploadEvidenceRecord(uploader, {
      clientRecordId: "run-evidence-integration-live",
      sourceKind: "tournament_live_capture",
      suggestedTournamentId: tournamentId,
      startedAtMs: 1_900_000_000_000,
      complete: false,
      entries: [],
      liveMappings: [{ observedGroupLabel: "Capture Card A", groupId, phase: "qualifier" }],
    });
    expect(requested.live?.status).toBe("requested");
    expect(await service.publicLiveGroups(tournamentId)).toEqual([]);

    const active = await service.approveLiveAssociation(director, {
      tournamentId, recordId: requested.recordId, expectedRevision: requested.revision,
      mappings: [{ observedGroupLabel: "Capture Card A", groupId, phase: "qualifier" }],
      reason: "Physical sticker and group checked",
    });
    expect(active.live?.status).toBe("active");

    const remapped = await service.approveLiveAssociation(director, {
      tournamentId, recordId: requested.recordId, expectedRevision: active.revision,
      mappings: [{ observedGroupLabel: "Capture Card A", groupId: secondGroupId, phase: "qualifier" }],
      reason: "Wrong group corrected before scores arrived",
    });
    expect(remapped.live?.mappings[0]?.groupId).toBe(secondGroupId);
    const restored = await service.approveLiveAssociation(director, {
      tournamentId, recordId: requested.recordId, expectedRevision: remapped.revision,
      mappings: [{ observedGroupLabel: "Capture Card A", groupId, phase: "qualifier" }],
      reason: "Physical sticker rechecked",
    });
    expect(restored.live?.mappings[0]?.groupId).toBe(groupId);

    const duplicate = await service.uploadEvidenceRecord(uploader, {
      clientRecordId: "run-evidence-integration-live-duplicate",
      sourceKind: "tournament_live_capture", suggestedTournamentId: tournamentId,
      complete: false, entries: [],
      liveMappings: [{ observedGroupLabel: "Capture Card B", groupId, phase: "qualifier" }],
    });
    await expect(service.approveLiveAssociation(director, {
      tournamentId, recordId: duplicate.recordId, expectedRevision: duplicate.revision,
      mappings: [{ observedGroupLabel: "Capture Card B", groupId, phase: "qualifier" }],
      reason: "Should conflict",
    })).rejects.toThrow(/already has another live feed/);

    const incremental = await service.uploadEvidenceRecord(uploader, {
      clientRecordId: "run-evidence-integration-live",
      suggestedTournamentId: tournamentId,
      startedAtMs: 1_900_000_000_000,
      complete: false,
      entries: [{ entryKey: "capture-a:1", observedGroupLabel: "Capture Card A", result: race(1) }],
    });
    expect(incremental.live?.status).toBe("active");
    expect((await service.publicLiveGroups(tournamentId))[0]).toMatchObject({
      groupId, status: "live", countedRaces: 1, receivedRaces: 1,
      standings: [
        { rank: 1, observedPlayerName: "Moss", total: 15 },
        { rank: 2, observedPlayerName: "Evan", total: 12 },
      ],
    });

    const stopping = await service.markLiveStopping(uploader, requested.recordId);
    expect(stopping.live?.status).toBe("stopping");
    const completed = await service.uploadEvidenceRecord(uploader, {
      clientRecordId: "run-evidence-integration-live",
      suggestedTournamentId: tournamentId,
      startedAtMs: 1_900_000_000_000,
      stoppedAtMs: 1_900_000_090_000,
      analysisCompletedAtMs: 1_900_000_099_000,
      complete: true,
      entries: [{ entryKey: "capture-a:1", observedGroupLabel: "Capture Card A", result: race(1) }],
    });
    expect(completed.live?.status).toBe("complete");
    expect((await service.publicLiveGroups(tournamentId))[0]?.status).toBe("ready_for_final_review");
  });
});
