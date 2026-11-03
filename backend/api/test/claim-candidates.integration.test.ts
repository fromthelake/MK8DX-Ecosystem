// ADR-0219 against a disposable MySQL/MariaDB with the whole catalog applied:
// the sign-up search reads only public context - published Time Trials (count,
// last date, classes), nights of published public Tournaments (count,
// Directors, last night) - and a private Player shows none of it.

import { randomBytes } from "node:crypto";

import type { RowDataPacket } from "mysql2";
import mysql, { type Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClaimCandidateService } from "../src/profiles/claim-candidate-service.js";
import { MysqlClaimCandidateRepository } from "../src/profiles/mysql-claim-candidate-repository.js";
import { MysqlTournamentOperationRepository } from "../src/tournaments/mysql-tournament-operation-repository.js";

const database = process.env["MK8DX_MYSQL_TEST_DATABASE"] ?? "";
const integration = process.env["MK8DX_MYSQL_INTEGRATION"] === "1" &&
  (database.endsWith("_test") || database.endsWith("_contract"))
  ? describe
  : describe.skip;

integration("claim candidates with public context (ADR-0219)", () => {
  let pool: Pool;
  const tag = randomBytes(3).toString("hex");
  const name = `Mal ${tag}`;
  const now = 1_900_000_000_000;
  const director = `user_account.claimcand_director_${tag}`;
  const asker = `user_account.claimcand_asker_${tag}`;
  const ids = {
    directorPlayer: `player.claimcand_ben_${tag}`,
    timeTrials: `player.claimcand_tt_${tag}`,
    nights: `player.claimcand_nights_${tag}`,
    secret: `player.claimcand_private_${tag}`,
    aliasOnly: `player.claimcand_alias_${tag}`,
  };
  const internal = new Map<string, number>();

  const insertPlayer = async (playerId: string, username: string, displayName: string, visibility = "public") => {
    await pool.execute(
      `INSERT INTO players (public_id, revision, player_kind, display_name, visibility, record_status, created_at_ms, updated_at_ms)
       VALUES (?, 1, 'human', ?, ?, 'active', ?, ?)`,
      [playerId, displayName, visibility, now, now],
    );
    await pool.execute(
      `INSERT INTO player_username_history (player_id, sequence_number, username_value, comparison_key, allocated_at_ms, released_at_ms)
       SELECT player_id, 1, ?, ?, ?, NULL FROM players WHERE public_id = ?`,
      [username, Buffer.from(username.toLowerCase()), now, playerId],
    );
    const [rows] = await pool.execute<RowDataPacket[]>("SELECT player_id AS id FROM players WHERE public_id = ?", [playerId]);
    internal.set(playerId, Number(rows[0]!["id"]));
  };

  const insertTimeTrial = async (playerId: string, sequence: number, modeCc: 150 | 200, status: "published" | "withheld", occurredAtMs: number) => {
    const submissionId = `user_submission.time.claimcand_${tag}_${sequence}`;
    await pool.execute("INSERT INTO time_trial_submissions (public_id, first_created_at_ms) VALUES (?, ?)", [submissionId, now]);
    await pool.execute(
      `INSERT INTO time_trial_submission_revisions
         (time_trial_submission_id, revision_number, schema_version, mode_cc, track_id, total_time_ms,
          participant_reference_kind, player_id, source_kind, occurred_at_ms, created_at_ms)
       SELECT s.time_trial_submission_id, 1, 'mk8dx.time-trial-submission.v1', ?, 'track.mario_kart_stadium', 83456,
              'player', ?, 'web_manual', ?, ?
       FROM time_trial_submissions AS s WHERE s.public_id = ?`,
      [modeCc, internal.get(playerId)!, occurredAtMs, now, submissionId],
    );
    await pool.execute(
      `INSERT INTO time_trial_publications
         (time_trial_submission_id, current_revision_id, publication_revision, publication_status,
          publication_origin, reason_code, published_at_ms, updated_at_ms)
       SELECT r.time_trial_submission_id, r.time_trial_submission_revision_id, 1, ?,
              ?, ?, ?, ?
       FROM time_trial_submission_revisions AS r
       INNER JOIN time_trial_submissions AS s ON s.time_trial_submission_id = r.time_trial_submission_id
       WHERE s.public_id = ?`,
      status === "published"
        ? [status, "runtime_automatic", "verified_claim_runtime_acceptance", now, now, submissionId]
        : [status, "internal_withheld", "explicit_review_required", null, now, submissionId],
    );
  };

  beforeAll(async () => {
    pool = mysql.createPool({
      host: process.env["MK8DX_MYSQL_TEST_HOST"] ?? "127.0.0.1",
      port: Number(process.env["MK8DX_MYSQL_TEST_PORT"] ?? "3306"),
      user: process.env["MK8DX_MYSQL_TEST_USER"] ?? "mk8dx_test",
      password: process.env["MK8DX_MYSQL_TEST_PASSWORD"] ?? "",
      database,
      connectionLimit: 2,
    });
    await pool.execute(
      `INSERT INTO user_accounts (public_id, revision, privacy_class, account_status, created_at_ms, updated_at_ms)
       VALUES (?, 1, 'private', 'active', ?, ?), (?, 1, 'private', 'active', ?, ?)`,
      [director, now, now, asker, now, now],
    );
    await insertPlayer(ids.directorPlayer, `ben_${tag}`, `Ben ${tag}`);
    await insertPlayer(ids.timeTrials, `mal_tt_${tag}`, name);
    await insertPlayer(ids.nights, `mal_${tag}`, name);
    await insertPlayer(ids.secret, `mal_p_${tag}`, name, "private");
    await insertPlayer(ids.aliasOnly, `nova_${tag}`, `Nova ${tag}`);
    // The Director's name is the Player their account owns.
    await pool.execute(
      `INSERT INTO player_claims (public_id, revision, privacy_class, player_id, user_account_id, claim_status, dispute_status, created_at_ms, updated_at_ms)
       SELECT ?, 1, 'private', p.player_id, a.user_account_id, 'verified', 'none', ?, ?
       FROM players AS p CROSS JOIN user_accounts AS a WHERE p.public_id = ? AND a.public_id = ?`,
      [`player_claim.claimcand_ben_${tag}`, now, now, ids.directorPlayer, director],
    );
    // A public alias finds Nova; a Director's own alias never does (ADR-0218).
    const [accounts] = await pool.execute<RowDataPacket[]>("SELECT user_account_id AS id FROM user_accounts WHERE public_id = ?", [director]);
    const directorInternal = Number(accounts[0]!["id"]);
    await pool.execute(
      `INSERT INTO aliases (public_id, revision, player_id, alias_text, alias_type, visibility, record_status,
         reviewed_by_user_account_id, reviewed_at_ms, created_at_ms, updated_at_ms)
       SELECT ?, 1, player_id, ?, 'declared', 'public', 'active', ?, ?, ?, ? FROM players WHERE public_id = ?`,
      [`alias.claimcand_public_${tag}`, `${name} the second`, directorInternal, now, now, now, ids.aliasOnly],
    );
    await pool.execute(
      `INSERT INTO aliases (public_id, revision, player_id, director_user_account_id, alias_text, alias_type, visibility,
         record_status, reviewed_by_user_account_id, reviewed_at_ms, created_at_ms, updated_at_ms)
       SELECT ?, 1, player_id, ?, ?, 'tournament_name', 'restricted', 'active', ?, ?, ?, ? FROM players WHERE public_id = ?`,
      [`alias.claimcand_director_${tag}`, directorInternal, name, directorInternal, now, now, now, ids.directorPlayer],
    );

    await insertTimeTrial(ids.timeTrials, 1, 150, "published", Date.UTC(2026, 8, 1));
    await insertTimeTrial(ids.timeTrials, 2, 200, "published", Date.UTC(2026, 9, 30, 21));
    await insertTimeTrial(ids.timeTrials, 3, 150, "withheld", Date.UTC(2026, 10, 1));

    const operations = new MysqlTournamentOperationRepository(pool);
    await operations.transaction(async (transaction) => {
      const night = (tournamentId: string, label: string, eventDate: string, startAtMs: number) => transaction.insertTournament({
        tournamentId, name: label, seriesLabel: null, editionNumber: null, eventDate,
        startAtMs, timezone: "Europe/Amsterdam", directorInternalId: directorInternal, seedOrder: "ranked",
        placementStrategy: "balanced", ownerSeatingMode: "owner_strict", qualifierTieBreakMode: "sp",
        finalTieBreakMode: "sp", qualifierRounds: true, maxParticipants: null, nowMs: now,
      });
      const published = await night(`tournament.claimcand_pub_${tag}`, `Night A ${tag}`, "2026-10-04", now);
      const draft = await night(`tournament.claimcand_draft_${tag}`, `Night B ${tag}`, "2026-11-01", now + 1000);
      for (const [tournament, player, attendance] of [
        [published, ids.nights, "present"],
        [draft, ids.nights, "present"],
        [published, ids.secret, "present"],
        [published, ids.timeTrials, "absent"],
      ] as const) {
        await transaction.upsertParticipant({
          tournamentInternalId: tournament, playerInternalId: internal.get(player)!, attendance,
          hasSwitch1: false, hasSwitch2: false, seedScore: null, seedRank: null, nowMs: now,
        });
      }
    });
    await pool.execute(
      `INSERT INTO tournament_publications (public_id, event_name, publication_revision, publication_status, published_at_ms, updated_at_ms, public_visibility)
       VALUES (?, ?, 1, 'published', ?, ?, 'public')`,
      [`tournament_publication.claimcand_${tag}`, `Night A ${tag}`, now, now],
    );
    await pool.execute(
      `UPDATE tournaments SET stage = 'finalized', finalized_at_ms = ?, tournament_publication_id =
         (SELECT tournament_publication_id FROM tournament_publications WHERE public_id = ?)
       WHERE public_id = ?`,
      [now, `tournament_publication.claimcand_${tag}`,`tournament.claimcand_pub_${tag}`],
    );
  });

  afterAll(async () => { await pool?.end(); });

  it("tells the namesakes apart with public context only", async () => {
    const service = new ClaimCandidateService(new MysqlClaimCandidateRepository(pool));
    const candidates = await service.search(
      { role: "account", userAccountId: asker },
      { query: name, timeTrials: true, tournaments: false },
    );
    const byId = new Map(candidates.map((candidate) => [candidate.playerId, candidate]));
    expect([...byId.keys()].sort()).toEqual([ids.aliasOnly, ids.nights, ids.secret, ids.timeTrials].sort());
    expect(candidates[0]?.playerId).toBe(ids.timeTrials);
    expect(byId.get(ids.timeTrials)).toMatchObject({
      matchesAnswers: true,
      claimed: false,
      // The withheld time is not public; the absent night is not a night.
      timeTrials: { times: 2, lastAt: "2026-10-30", classes: [150, 200] },
      tournaments: { nights: 0, directorNames: [], lastNight: null },
    });
    expect(byId.get(ids.nights)).toMatchObject({
      matchesAnswers: false,
      // The unpublished night does not count.
      tournaments: { nights: 1, directorNames: [`Ben ${tag}`], lastNight: { name: `Night A ${tag}`, date: "2026-10-04" } },
      timeTrials: { times: 0, lastAt: null, classes: [] },
    });
    expect(byId.get(ids.secret)).toMatchObject({
      matchesAnswers: false,
      timeTrials: { times: 0, lastAt: null, classes: [] },
      tournaments: { nights: 0, directorNames: [], lastNight: null },
    });
    expect(byId.get(ids.aliasOnly)?.aliases).toEqual([`${name} the second`]);
    // The Director's own alias "Mal ..." on Ben never surfaces Ben.
    expect(byId.has(ids.directorPlayer)).toBe(false);

    const tournaments = await service.search(
      { role: "account", userAccountId: asker },
      { query: name, timeTrials: false, tournaments: true },
    );
    expect(tournaments[0]?.playerId).toBe(ids.nights);
    expect(tournaments[0]?.matchesAnswers).toBe(true);
  });
});
