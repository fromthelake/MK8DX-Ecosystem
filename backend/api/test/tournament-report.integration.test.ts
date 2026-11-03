import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

import { MysqlTournamentReportRepository } from
  "../src/tournaments/mysql-tournament-report-repository.js";
import { TournamentReportService } from
  "../src/tournaments/tournament-report-service.js";

const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" ? describe : describe.skip;
const admin = { role: "administrator" as const, userAccountId: "user_account.synthetic_report_admin" };
const author = { role: "account" as const, userAccountId: "user_account.synthetic_report_author" };
const tournamentId = "tournament.synthetic_report_integration";

integration("Tournament report capability persistence", () => {
  let pool: Pool;
  let service: TournamentReportService;
  let repository: MysqlTournamentReportRepository;
  let now = 1_900_000_000_000;
  // The night the fake document reports; publishing refuses until it is over.
  let stage: "finals" | "finalized" = "finals";

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
    for (const publicId of [admin.userAccountId, author.userAccountId] as const) {
      await pool.execute(
        `INSERT INTO user_accounts
         (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
         VALUES (?, 1, ?, 'active', 1, 1)`,
        [publicId, "private"],
      );
    }
    await pool.execute(
      `INSERT INTO tournaments
       (public_id, name, director_user_account_id, stage, revision, seed_order,
        placement_strategy, public_results, affects_rating, created_at_ms, updated_at_ms)
       SELECT ?, 'Synthetic report', user_account_id, 'setup', 1, 'ranked',
              'balanced', TRUE, FALSE, 1, 1
       FROM user_accounts WHERE public_id = ?`,
      [tournamentId, admin.userAccountId],
    );
    repository = new MysqlTournamentReportRepository(pool);
    service = new TournamentReportService(
      repository,
      { loadForReport: vi.fn(async () => ({
        schemaVersion: "mk8dx.tournament-operation.v1",
        summary: { tournamentId, name: "Synthetic report", stage },
        participants: [{ playerId: "player.synthetic_reported", displayName: "Reported" }],
        stations: [],
        groups: [{
          groupId: "tournament_group.synthetic_report_final",
          name: "Kampioen",
          members: [{ playerId: "player.synthetic_reported", displayName: "Reported" }],
        }],
        overall: [], lifecycle: [],
      })) } as never,
      { newGrantId: () => "account_capability_grant.synthetic_report_001" },
      { nowMs: () => (now += 1_000) },
    );
  });

  afterAll(async () => {
    await pool.execute("DELETE FROM tournament_report_drafts WHERE tournament_id = (SELECT tournament_id FROM tournaments WHERE public_id = ?)", [tournamentId]);
    await pool.execute("DELETE lifecycle FROM account_capability_grant_lifecycle AS lifecycle INNER JOIN account_capability_grants AS grant_record ON grant_record.account_capability_grant_id = lifecycle.account_capability_grant_id WHERE grant_record.public_id = 'account_capability_grant.synthetic_report_001'");
    await pool.execute("DELETE FROM account_capability_grants WHERE public_id = 'account_capability_grant.synthetic_report_001'");
    await pool.execute("DELETE FROM tournaments WHERE public_id = ?", [tournamentId]);
    await pool.execute("DELETE FROM user_accounts WHERE public_id IN (?, ?)", [admin.userAccountId, author.userAccountId]);
    await pool.end();
  });

  it("grants, authorizes, revisions drafts, revokes, and denies after revocation", async () => {
    await expect(service.load(author, tournamentId)).rejects.toMatchObject({ code: "forbidden" });
    await service.grant(admin, author.userAccountId, "report_author_access");
    await expect(service.load(author, tournamentId)).resolves.toMatchObject({ schemaVersion: "mk8dx.tournament-night-report.v1" });
    const draft = await service.saveDraft(author, tournamentId, {
      expectedRevision: null,
      introText: "Tournament introduction",
      tracksIntroText: "Track observations",
      playerNotes: {},
    });
    expect(draft.revision).toBe(1);
    await expect(service.saveDraft(author, tournamentId, {
      expectedRevision: null,
      introText: "Stale write",
      tracksIntroText: "",
      playerNotes: {},
    })).rejects.toMatchObject({ code: "conflict" });
    await service.revoke(admin, author.userAccountId, "report_author_access_revoked");
    await expect(service.load(author, tournamentId)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("publishes a copy the community keeps reading while the Director writes on", async () => {
    const first = await service.saveDraft(admin, tournamentId, {
      expectedRevision: 1,
      titleText: "TN-integration 'Full Send'",
      introText: "Wat een avond.\n\nEn daarna ging het hard.",
      summaryText: "Kort samengevat.",
      tracksIntroText: "Baby Park weer.",
      playerNotes: { "player.synthetic_reported": "Reed sterk." },
      groupNotes: { "tournament_group.synthetic_report_final": "De kampioenengroep." },
      visibility: { topTracks: true, benchmark: false, duel: true, distribution: true },
    });
    expect(first.revision).toBe(2);
    // Everything the Director wrote survives the round trip through MySQL.
    expect(await service.load(admin, tournamentId)).toMatchObject({
      draft: {
        // Stored as the editor's sanitised markup.
        revision: 2, titleText: "TN-integration 'Full Send'", summaryText: "<p>Kort samengevat.</p>",
        groupNotes: { "tournament_group.synthetic_report_final": "<p>De kampioenengroep.</p>" },
        // The switches it did not send start as a new report does.
        visibility: {
          topTracks: true, benchmark: false, duel: true, distribution: true,
          intro: false, summary: true, groupNotes: false,
        },
      },
    });
    // Nothing is public before it is published, and not before the night is over.
    expect(await repository.loadPublished(tournamentId)).toBeNull();
    await expect(service.publish(admin, tournamentId, 2)).rejects.toMatchObject({ code: "invalid_input" });

    stage = "finalized";
    const published = await service.publish(admin, tournamentId, 2);
    expect(published.publishedRevision).toBe(2);
    expect(await repository.loadPublished(tournamentId)).toMatchObject({
      title: "TN-integration 'Full Send'",
      intro: ["Wat een avond.", "En daarna ging het hard."],
      groups: [{ name: "Kampioen", paragraphs: ["De kampioenengroep."] }],
      players: [{ name: "Reported", paragraphs: ["Reed sterk."] }],
      visibility: { topTracks: true, benchmark: false, duel: true, distribution: true },
      revision: 2,
    });

    // The Director writes on. The community goes on reading revision 2.
    const second = await service.saveDraft(admin, tournamentId, {
      expectedRevision: 2, titleText: "Nog niet af", introText: "Herschreven.",
      summaryText: "", tracksIntroText: "", playerNotes: {}, groupNotes: {},
    });
    expect(second.revision).toBe(3);
    expect(second.publishedRevision).toBe(2);
    expect(await repository.loadPublished(tournamentId)).toMatchObject({
      title: "TN-integration 'Full Send'", revision: 2,
    });

    // And publishing again hands over the newer one.
    await service.publish(admin, tournamentId, 3);
    expect(await repository.loadPublished(tournamentId)).toMatchObject({ title: "Nog niet af", revision: 3 });
  });
});
