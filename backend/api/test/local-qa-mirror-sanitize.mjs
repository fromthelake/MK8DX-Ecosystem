// Sanitizes the allow-listed production-derived domain snapshot after it has
// been restored into an explicitly local disposable MySQL schema.

import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import mysql from "mysql2/promise";

import { QA_DOMAIN_TABLES } from "../../../tooling/qa/qa_snapshot_scope.mjs";

// The reviewed baseline is the catalog's own length rather than a number
// repeated across the QA scripts, which silently blocked the mirror the moment
// a migration was cataloged for the next release.
const CATALOGED_MIGRATIONS = JSON.parse(readFileSync(
  new URL("../../../infrastructure/mysql/migration-catalog-v1.json", import.meta.url),
  "utf8",
)).migrations.length;

const EXPECTED_SCHEMA_TABLES = Object.freeze([
  "account_capability_grant_lifecycle", "account_capability_grants",
  // Shared-device switching (ADR-0224, migration 0085): which accounts used which device and their
  // PIN digests. Private by nature: the mirror knows their shape and copies none of it.
  "account_switch_pins", "account_switch_remembered_accounts", "account_switch_sessions",
  "administrator_grant_lifecycle", "administrator_grants",
  "alias_lifecycle", "alias_provenance", "aliases", "api_mutation_rate_limits",
  // Which build each device runs (ADR-0200). Not a domain table: it is
  // about people's phones, so the mirror knows its shape and copies none
  // of it.
  "client_installations",
  // Who asked to host Tournaments, with their note (ADR-0220, migration 0080). Private to the
  // account and the administrators: the mirror knows its shape and copies none of it.
  "director_host_requests",
  "ephemeral_time_trial_scan_tests",
  // The installation's own settings and their audit (ADR-0221, migration 0081). An administrator's
  // choices and who made them: the mirror knows their shape, copies none of it and runs on the defaults.
  "installation_setting_changes", "installation_settings", "firebase_timetrial_import_attempts",
  "firebase_timetrial_import_records", "firebase_timetrial_import_runs",
  "home_snapshot_rivals", "home_snapshots", "legacy_race_placements",
  "legacy_tournament_events", "legacy_tournament_races", "mk8dx_auth_account",
  "mk8dx_auth_audit_event", "mk8dx_auth_device_code", "mk8dx_auth_rate_limit",
  "mk8dx_auth_session", "mk8dx_auth_user", "mk8dx_auth_verification",
  "notification_deliveries", "notification_events", "notification_preferences",
  "notification_producer_jobs",
  "notifications",
  // Offline LAN accounts and one-use sign-in cards (ADR-0223, migration 0084). Only an A2 offline
  // installation fills them; the mirror knows their shape and copies none of it.
  "offline_auth_accounts", "offline_invitation_tickets",
  "player_claim_event_evidence", "player_claim_lifecycle", "player_claim_notes", "player_claims",
  "player_engagements", "player_follows", "player_rating_events", "player_ratings", "player_rivals",
  "player_username_history", "player_visibility_lifecycle", "players",
  "rank_scope_group_preferences", "rank_scope_preferences", "rating_recalculations",
  // What LiveTrial read from Nintendo staff and World Record ghosts (ADR-0212, migration 0072).
  // Starts empty in the mirror; the sending account makes it more than public reference data.
  "reference_ghost_readings",
  "restricted_authentication_binding_lifecycle", "restricted_authentication_bindings",
  "restricted_claim_evidence", "restricted_claim_reviews",
  "restricted_identity_access_log", "restricted_legacy_identity_identifiers",
  "restricted_rating_seed_identities", "restricted_time_trial_evidence",
  "restricted_time_trial_participant_references", "restricted_tournament_race_data",
  "schema_migrations", "social_group_memberships", "social_groups",
  // Which carried times were accepted and from where (ADR-0225 amendment, migration 0090). Starts empty in
  // the mirror like the carried columns it is filled from.
  "time_trial_carried_originals",
  "time_trial_laps", "time_trial_lifecycle_events", "time_trial_publication_lifecycle",
  "time_trial_player_bests", "time_trial_publications", "time_trial_reactions",
  // Which screen a scan was read from (ADR-0204). A separate table rather than
  // a column on the revisions, so the mirror can exercise it before production
  // has run the migration; it starts empty here and is filled by what QA scans.
  "time_trial_submission_capture_layouts",
  "time_trial_submission_revisions",
  "time_trial_submissions",
  // A Player's YouTube video of their run (migration 0071). Starts empty in the mirror until
  // production has it; then it is copied like the results it belongs to.
  "time_trial_videos",
  "tournament_evidence_records", "tournament_group_members",
  "tournament_group_races", "tournament_group_stations", "tournament_groups", "tournament_incoming_result_reviews",
  "tournament_incoming_results", "tournament_lifecycle", "tournament_manual_scores",
  "tournament_history_placements", "tournament_history_races",
  "tournament_history_sections", "tournament_observed_identity_links",
  // UX19 mapping changes contain operator audit data. The mirror validates
  // the table shape but copies none of those private audit rows.
  "tournament_live_mapping_audit",
  "tournament_participants", "tournament_publication_current_members",
  "tournament_publication_lifecycle", "tournament_publication_lifecycle_members",
  "tournament_publications", "tournament_race_placements",
  "tournament_race_result_revisions", "tournament_race_results",
  "tournament_rating_decisions", "tournament_report_drafts",
  "tournament_retraction_audit",
  // Open sign-up settings and who signed up with their outcome (ADR-0222, migration 0082). Tied to
  // accounts: the mirror knows their shape and copies none of it; QA sign-ups start empty.
  "tournament_signup_settings", "tournament_signups",
  "tournament_station_cables", "tournaments",
  // The synced appearance choice (ADR-0205). A per-account preference, not a
  // domain fact: the mirror knows its shape and copies none of it, so every
  // QA profile starts on System like a new device.
  "user_account_appearance_preferences",
  "reference_seed_rows", "reference_seed_versions",
  "user_accounts", "web_push_subscriptions", "world_record_import_runs", "world_records",
].sort());

const LOCAL_DERIVED_TABLES = Object.freeze(["time_trial_player_bests"]);
const OMITTED_TABLES = Object.freeze(EXPECTED_SCHEMA_TABLES.filter(
  (table) => table !== "schema_migrations" &&
    !QA_DOMAIN_TABLES.includes(table) && !LOCAL_DERIVED_TABLES.includes(table),
));

class QaSanitizeError extends Error {
  constructor(message) {
    super(message);
    this.name = "QaSanitizeError";
  }
}

function config() {
  const host = process.env.MK8DX_QA_MYSQL_HOST ?? "";
  const database = process.env.MK8DX_QA_MYSQL_DATABASE ?? "";
  const port = Number(process.env.MK8DX_QA_MYSQL_PORT ?? "");
  const user = process.env.MK8DX_QA_MYSQL_USER ?? "";
  const password = process.env.MK8DX_QA_MYSQL_PASSWORD ?? "";
  if (
    host !== "127.0.0.1" ||
    !Number.isSafeInteger(port) || port < 1 || port > 65535 ||
    !/^mk8dx_[a-z0-9_]*(?:qa|contract)$/u.test(database) ||
    user.length === 0 || password.length === 0
  ) {
    throw new QaSanitizeError("an explicitly local QA/contract database is required");
  }
  return { host, port, user, password, database, connectionLimit: 2 };
}

function reportPath() {
  const path = process.env.MK8DX_QA_SANITIZE_REPORT ?? "";
  if (!isAbsolute(path)) throw new QaSanitizeError("an absolute sanitize report path is required");
  return path;
}

async function exactSchema(pool, database) {
  const [rows] = await pool.execute(
    `SELECT table_name AS tableName
     FROM information_schema.tables
     WHERE table_schema = ? AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    [database],
  );
  const actual = rows.map((row) => String(row.tableName));
  if (actual.join("\n") !== EXPECTED_SCHEMA_TABLES.join("\n")) {
    throw new QaSanitizeError("local schema table inventory differs from the reviewed QA scope");
  }
  const [ledger] = await pool.query("SELECT COUNT(*) AS total FROM schema_migrations");
  if (Number(ledger[0]?.total) !== CATALOGED_MIGRATIONS) {
    throw new QaSanitizeError(
      `local migration ledger is not the expected ${CATALOGED_MIGRATIONS}-version baseline`,
    );
  }
}

async function requireOmittedTablesEmpty(pool) {
  for (const table of OMITTED_TABLES) {
    const [rows] = await pool.query(`SELECT COUNT(*) AS total FROM \`${table}\``);
    if (Number(rows[0]?.total) !== 0) {
      throw new QaSanitizeError(`omitted/private table is unexpectedly populated: ${table}`);
    }
  }
}

async function retainPublicTimeTrials(connection) {
  await connection.query(
    `CREATE TEMPORARY TABLE qa_allowed_publications (
       time_trial_publication_id BIGINT UNSIGNED PRIMARY KEY,
       time_trial_submission_id BIGINT UNSIGNED NOT NULL,
       current_revision_id BIGINT UNSIGNED NOT NULL
     ) ENGINE=MEMORY
     SELECT p.time_trial_publication_id, p.time_trial_submission_id, p.current_revision_id
     FROM time_trial_publications AS p
     INNER JOIN time_trial_submission_revisions AS revision
       ON revision.time_trial_submission_revision_id = p.current_revision_id
     WHERE p.publication_status = 'published'
       AND revision.participant_reference_kind = 'player'
       AND revision.player_id IS NOT NULL`,
  );
  await connection.query(
    `CREATE TEMPORARY TABLE qa_allowed_revisions (
       time_trial_submission_revision_id BIGINT UNSIGNED PRIMARY KEY
     ) ENGINE=MEMORY
     SELECT DISTINCT lifecycle.time_trial_submission_revision_id
     FROM time_trial_publication_lifecycle AS lifecycle
     INNER JOIN qa_allowed_publications AS publication
       ON publication.time_trial_publication_id = lifecycle.time_trial_publication_id
     INNER JOIN time_trial_submission_revisions AS revision
       ON revision.time_trial_submission_revision_id = lifecycle.time_trial_submission_revision_id
     WHERE lifecycle.event_type = 'revision_published'
       AND revision.participant_reference_kind = 'player'
       AND revision.player_id IS NOT NULL`,
  );
  await connection.query(
    `INSERT IGNORE INTO qa_allowed_revisions (time_trial_submission_revision_id)
     SELECT current_revision_id FROM qa_allowed_publications`,
  );
  await connection.query(
    `DELETE reaction FROM time_trial_reactions AS reaction
     LEFT JOIN qa_allowed_publications AS publication
       ON publication.time_trial_submission_id = reaction.time_trial_submission_id
     WHERE publication.time_trial_publication_id IS NULL`,
  );
  await connection.query(
    `DELETE lap FROM time_trial_laps AS lap
     LEFT JOIN qa_allowed_revisions AS allowed
       ON allowed.time_trial_submission_revision_id = lap.time_trial_submission_revision_id
     WHERE allowed.time_trial_submission_revision_id IS NULL`,
  );
  await connection.query(
    `DELETE lifecycle FROM time_trial_publication_lifecycle AS lifecycle
     LEFT JOIN qa_allowed_publications AS publication
       ON publication.time_trial_publication_id = lifecycle.time_trial_publication_id
     LEFT JOIN qa_allowed_revisions AS revision
       ON revision.time_trial_submission_revision_id = lifecycle.time_trial_submission_revision_id
     WHERE publication.time_trial_publication_id IS NULL
        OR revision.time_trial_submission_revision_id IS NULL
        OR lifecycle.event_type <> 'revision_published'`,
  );
  await connection.query(
    `DELETE publication FROM time_trial_publications AS publication
     LEFT JOIN qa_allowed_publications AS allowed
       ON allowed.time_trial_publication_id = publication.time_trial_publication_id
     WHERE allowed.time_trial_publication_id IS NULL`,
  );
  await connection.query(
    `DELETE revision FROM time_trial_submission_revisions AS revision
     LEFT JOIN qa_allowed_revisions AS allowed
       ON allowed.time_trial_submission_revision_id = revision.time_trial_submission_revision_id
     WHERE allowed.time_trial_submission_revision_id IS NULL`,
  );
  await connection.query(
    `DELETE submission FROM time_trial_submissions AS submission
     LEFT JOIN qa_allowed_publications AS publication
       ON publication.time_trial_submission_id = submission.time_trial_submission_id
     WHERE publication.time_trial_submission_id IS NULL`,
  );
}

async function rebuildTimeTrialPlayerBests(connection) {
  await connection.query("DELETE FROM time_trial_player_bests");
  await connection.query(
    `INSERT INTO time_trial_player_bests (
       player_id, track_id, mode_cc, time_trial_publication_id,
       time_trial_submission_revision_id, total_time_ms, published_at_ms,
       public_eligible
     )
     SELECT ranked.player_id, ranked.track_id, ranked.mode_cc,
            ranked.time_trial_publication_id,
            ranked.time_trial_submission_revision_id,
            ranked.total_time_ms, ranked.published_at_ms,
            ranked.public_eligible
     FROM (
       SELECT revision.player_id, revision.track_id, revision.mode_cc,
              publication.time_trial_publication_id,
              revision.time_trial_submission_revision_id,
              revision.total_time_ms, publication.published_at_ms,
              (player.record_status = 'active' AND player.visibility = 'public')
                AS public_eligible,
              ROW_NUMBER() OVER (
                PARTITION BY revision.player_id, revision.track_id,
                             revision.mode_cc
                ORDER BY revision.total_time_ms ASC,
                         publication.published_at_ms DESC,
                         submission.public_id DESC
              ) AS player_best
       FROM time_trial_publications AS publication
       INNER JOIN time_trial_submission_revisions AS revision
         ON revision.time_trial_submission_revision_id =
            publication.current_revision_id
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id =
            publication.time_trial_submission_id
       INNER JOIN players AS player ON player.player_id = revision.player_id
       WHERE publication.publication_status = 'published'
         AND revision.player_id IS NOT NULL
     ) AS ranked
     WHERE ranked.player_best = 1`,
  );
}

async function sanitize() {
  const mysqlConfig = config();
  const pool = mysql.createPool(mysqlConfig);
  try {
    await exactSchema(pool, mysqlConfig.database);
    await requireOmittedTablesEmpty(pool);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await retainPublicTimeTrials(connection);
      await rebuildTimeTrialPlayerBests(connection);
      await connection.query(
        `UPDATE user_accounts
         SET public_id = CONCAT('user_account.qa_shadow_', LPAD(user_account_id, 12, '0')),
             time_trial_mode_preference = 'all',
             screen_name = NULL,
             time_trial_track_access = 'unknown'`,
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    await requireOmittedTablesEmpty(pool);
    const [[summary]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM players) AS players,
         (SELECT COUNT(*) FROM players WHERE visibility = 'public') AS publicPlayers,
         (SELECT COUNT(*) FROM time_trial_publications) AS timeTrialPublications,
         (SELECT COUNT(*) FROM time_trial_publication_lifecycle) AS activityEvents,
         (SELECT COUNT(*) FROM tournament_publications WHERE publication_status = 'published')
           AS tournamentPublications,
         (SELECT COUNT(*) FROM tournaments) AS operationalTournaments,
         (SELECT COUNT(*) FROM world_records) AS worldRecords,
         (SELECT COUNT(*) FROM user_accounts) AS shadowAccounts`,
    );
    const report = {
      kind: "mk8dx.local-qa-mirror-sanitize.v1",
      database: mysqlConfig.database,
      migrationCount: CATALOGED_MIGRATIONS,
      importedTables: [...QA_DOMAIN_TABLES],
      omittedTables: [...OMITTED_TABLES],
      summary: Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, Number(value)])),
      sanitizedAt: new Date().toISOString(),
    };
    writeFileSync(reportPath(), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void sanitize().catch((error) => {
    const message = error instanceof Error ? error.message : "local QA sanitization failed";
    process.stderr.write(`Local QA mirror sanitization refused/failed: ${message}\n`);
    process.exitCode = 1;
  });
}

export { EXPECTED_SCHEMA_TABLES, OMITTED_TABLES, QaSanitizeError };
