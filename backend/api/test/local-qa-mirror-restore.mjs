// Restores the reviewed JSON QA snapshot into a new loopback-only database.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import mysql from "mysql2/promise";

import { QA_DOMAIN_TABLES } from "../../../tooling/qa/qa_snapshot_scope.mjs";
import { OMITTED_TABLES } from "./local-qa-mirror-sanitize.mjs";

// The reviewed migration count is the catalog's own length rather than a
// number repeated in three files. A production snapshot may omit only this
// exact reviewed suffix of additive, locally-applied migrations. Naming the
// versions keeps this a contract instead of a generic "two behind" escape:
// older drift and any future migration still refuse until explicitly reviewed.
const MIGRATION_CATALOG = JSON.parse(readFileSync(
  new URL("../../../infrastructure/mysql/migration-catalog-v1.json", import.meta.url),
  "utf8",
));
const CATALOGED_MIGRATION_VERSIONS = MIGRATION_CATALOG.migrations.map(({ version }) => String(version));
const CATALOGED_MIGRATIONS = CATALOGED_MIGRATION_VERSIONS.length;
// 0071 only adds the empty time_trial_videos table and 0072 the empty reference_ghost_readings
// table (ADR-0212); 0073 adds empty reference seed audit tables; 0074 renames the night
// report's capability code in place; 0075 relaxes two World Record checks; 0076 drops the one-claim-per-account key; 0077 adds the empty claim notes table and the Director reviewer role; 0078 widens the Tournament race class check and adds an empty mirror column; 0079 drops the unique display-name key and adds the
// empty Director column on aliases (ADR-0218); 0080 adds the empty Director host-request table and
// two notification kinds (ADR-0220); 0081 adds the empty installation-settings tables (no row = the
// defaults) and two per-night rating columns on tournaments (ADR-0221); 0082 adds the empty open sign-up tables, an empty
// notification column and three notification kinds (ADR-0222); 0083 makes the Better Auth account issuer optional
// (auth tables are never restored from a snapshot). A snapshot taken
// before these migrations reached production is completed locally. 0084 adds only
// empty offline-LAN account and invitation tables; no snapshot row maps into them. 0085 adds only the
// empty account-switching tables (ADR-0224 phase 2); auth rows are never restored from a snapshot. 0086
// adds a defaulted failure count to that still-empty table. 0087 adds the defaulted carried-times setting
// and four nullable carried columns on Time Trial revisions (ADR-0225); a snapshot row carries none of them.
// 0088 only widens three checks on the lifecycle audit table; every snapshot row already satisfies them.
// 0089 widens the same table's reason check once more.
const REVIEWED_LOCALLY_APPLIED_SUFFIX = new Set(["0066", "0067", "0071", "0072", "0073", "0074", "0075", "0076", "0077", "0078", "0079", "0080", "0081", "0082", "0083", "0084", "0085", "0086", "0087", "0088", "0089"]);
// Nullable columns those migrations add to tables the snapshot carries. A snapshot taken before the migration lacks
// them; its rows restore into the remaining columns and the new column stays NULL, as it would in production.
const REVIEWED_LOCALLY_ADDED_COLUMNS = new Map([
  ["0078", [["tournament_race_result_revisions", "mirror"]]],
  ["0079", [["aliases", "director_user_account_id"]]],
  // verified_only is NOT NULL DEFAULT FALSE: a restored row omits it and gets the default, the
  // behaviour every night had before the option existed. seeding_source NULL = the community rating.
  ["0081", [["tournaments", "verified_only"], ["tournaments", "seeding_source"]]],
  // carried_times is NOT NULL DEFAULT 'off' (the behaviour before the setting existed); the carried
  // columns stay NULL for every restored revision, which is a time set on this installation.
  ["0087", [
    ["installation_settings", "carried_times"],
    ["time_trial_submission_revisions", "carried_from_origin"],
    ["time_trial_submission_revisions", "carried_from_name"],
    ["time_trial_submission_revisions", "carried_original_submission_id"],
    ["time_trial_submission_revisions", "carried_original_submitted_at_ms"],
  ]],
]);

function locallyAddedColumns(snapshotMigrationCount, table) {
  return new Set(CATALOGED_MIGRATION_VERSIONS
    .slice(snapshotMigrationCount)
    .flatMap((version) => REVIEWED_LOCALLY_ADDED_COLUMNS.get(version) ?? [])
    .filter(([name]) => name === table)
    .map(([, column]) => column));
}

function isReviewedSnapshotMigrationCount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > CATALOGED_MIGRATIONS) return false;
  return CATALOGED_MIGRATION_VERSIONS
    .slice(value)
    .every((version) => REVIEWED_LOCALLY_APPLIED_SUFFIX.has(version));
}

class QaRestoreError extends Error {
  constructor(message) { super(message); this.name = "QaRestoreError"; }
}

function config() {
  const host = process.env.MK8DX_QA_MYSQL_HOST ?? "";
  const database = process.env.MK8DX_QA_MYSQL_DATABASE ?? "";
  const port = Number(process.env.MK8DX_QA_MYSQL_PORT ?? "");
  const user = process.env.MK8DX_QA_MYSQL_USER ?? "";
  const password = process.env.MK8DX_QA_MYSQL_PASSWORD ?? "";
  if (host !== "127.0.0.1" || !/^mk8dx_[a-z0-9_]*(?:qa|contract)$/u.test(database) ||
      !Number.isSafeInteger(port) || port < 1 || port > 65535 || !user || !password) {
    throw new QaRestoreError("an explicit loopback QA/contract database is required");
  }
  const snapshotPath = process.env.MK8DX_QA_SNAPSHOT_PATH ?? "";
  if (!isAbsolute(snapshotPath)) throw new QaRestoreError("snapshot path must be absolute");
  return { mysql: { host, database, port, user, password, connectionLimit: 2 }, snapshotPath };
}

function decode(value) {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (typeof value === "object" && value !== null && Object.keys(value).length === 1) {
    if (typeof value.$binary === "string") return Buffer.from(value.$binary, "base64");
    if (typeof value.$date === "string") return new Date(value.$date);
    if (typeof value.$json === "string") return value.$json;
  }
  throw new QaRestoreError("snapshot contains an unsupported encoded value");
}

function loadSnapshot(path) {
  const body = readFileSync(path);
  const expectedChecksum = readFileSync(`${path}.sha256`, "utf8").trim().split(/\s+/u)[0];
  const actualChecksum = createHash("sha256").update(body).digest("hex");
  if (expectedChecksum !== actualChecksum) throw new QaRestoreError("snapshot checksum differs");
  const document = JSON.parse(body.toString("utf8"));
  if (document.kind !== "mk8dx.production-qa-snapshot.v1" ||
      !isReviewedSnapshotMigrationCount(document.schemaMigrationCount) ||
      !Array.isArray(document.domainTables) || !Array.isArray(document.profiles) ||
      document.domainTables.map((table) => table.name).join("\n") !== QA_DOMAIN_TABLES.join("\n")) {
    throw new QaRestoreError("snapshot contract differs from the reviewed v1 scope");
  }
  return document;
}

async function expectedColumns(connection, database, table) {
  const [rows] = await connection.execute(
    `SELECT column_name AS columnName FROM information_schema.columns
     WHERE table_schema = ? AND table_name = ? AND extra NOT LIKE '%GENERATED%'
     ORDER BY ordinal_position`, [database, table]);
  return rows.map((row) => String(row.columnName));
}

async function restore() {
  const { mysql: mysqlConfig, snapshotPath } = config();
  const snapshot = loadSnapshot(snapshotPath);
  const pool = mysql.createPool(mysqlConfig);
  const connection = await pool.getConnection();
  try {
    const [[ledger]] = await connection.query("SELECT COUNT(*) AS total FROM schema_migrations");
    if (Number(ledger.total) !== CATALOGED_MIGRATIONS) {
      throw new QaRestoreError(`local migration ledger is not ${CATALOGED_MIGRATIONS}`);
    }
    for (const table of OMITTED_TABLES) {
      const [[count]] = await connection.query(`SELECT COUNT(*) AS total FROM \`${table}\``);
      if (Number(count.total) !== 0) throw new QaRestoreError(`private target table is not empty: ${table}`);
    }
    // Some historical domain rows are cataloged migration seeds. The snapshot
    // is authoritative for this disposable mirror, so replace only the closed
    // domain scope after proving every private/omitted table is empty.
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    try {
      for (const table of [...QA_DOMAIN_TABLES].reverse()) {
        await connection.query(`TRUNCATE TABLE \`${table}\``);
      }
    } finally {
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    }
    await connection.beginTransaction();
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    try {
      for (const table of snapshot.domainTables) {
        const added = locallyAddedColumns(snapshot.schemaMigrationCount, table.name);
        const targetColumns = (await expectedColumns(connection, mysqlConfig.database, table.name))
          .filter((column) => !added.has(column));
        const snapshotColumns = table.columns;
        if (!Array.isArray(snapshotColumns) ||
            targetColumns.join("\n") !== snapshotColumns.join("\n") ||
            !Array.isArray(table.rows)) throw new QaRestoreError(`column contract differs: ${table.name}`);
        const columnSql = snapshotColumns.map((column) => `\`${column}\``).join(",");
        const rowSql = `(${snapshotColumns.map(() => "?").join(",")})`;
        for (let offset = 0; offset < table.rows.length; offset += 100) {
          const batch = table.rows.slice(offset, offset + 100);
          if (batch.some((row) => !Array.isArray(row) || row.length !== snapshotColumns.length)) {
            throw new QaRestoreError(`row contract differs: ${table.name}`);
          }
          const values = batch.flatMap((row) => row.map(decode));
          await connection.query(
            `INSERT INTO \`${table.name}\` (${columnSql}) VALUES ${batch.map(() => rowSql).join(",")}`,
            values,
          );
        }
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    }
    process.stdout.write(`${JSON.stringify({
      kind: "mk8dx.local-qa-mirror-restore.v1",
      capturedAt: snapshot.capturedAt,
      tables: snapshot.domainTables.length,
      profiles: snapshot.profiles.map((profile) => profile.playerId),
    }, null, 2)}\n`);
  } finally {
    connection.release();
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void restore().catch((error) => {
    process.stderr.write(`Local QA restore refused/failed: ${error instanceof QaRestoreError ? error.message : String(error?.message ?? error)}\n`);
    process.exitCode = 1;
  });
}

export { QaRestoreError, decode, isReviewedSnapshotMigrationCount, loadSnapshot };
