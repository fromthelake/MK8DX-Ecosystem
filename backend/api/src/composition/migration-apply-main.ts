// On-host production migration applier.
//
// The production database is reachable only from the webspace itself
// (checklist C6 = no), where Node is guaranteed, so this CLI applies the
// hash-pinned migration catalog with the same discipline as the development
// runner: every up file must match its cataloged SHA-256 exactly, no
// uncataloged SQL may sit in the migrations directory, the applied ledger
// must be an exact catalog prefix with exact hashes, and pending migrations
// apply strictly in catalog order with a ledger row recorded only after each
// file succeeds. It fails closed on any drift or ambiguity and requires the
// operator to (a) retype the exact configured database name and (b) attest
// that a verified backup exists.
//
// Usage (from the release package's api/ directory):
//   node dist/composition/migration-apply-main.js \
//     --private-environment-file /absolute/path/to/owner-only.json \
//     --migration-catalog ../mysql/migration-catalog-v1.json \
//     --confirm-database <exact-database-name> \
//     --backup-verified

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";

import {
  loadHostedMysqlRuntimeConfig,
  type HostedRuntimeEnvironment,
} from "./hosted-runtime-config.js";
import {
  extractPrivateEnvironmentArgument,
  loadHostedOperatorEnvironment,
} from "./hosted-operator-environment.js";

const versionPattern = /^[0-9]{4}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

export class MigrationApplyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MigrationApplyError";
  }
}

export type CatalogMigration = Readonly<{
  version: string;
  name: string;
  upPath: string;
  upSha256: string;
}>;

export function parseMigrationApplyArguments(
  arguments_: readonly string[],
): Readonly<{ catalogPath: string; confirmDatabase: string }> {
  if (arguments_.length !== 5 ||
    arguments_[0] !== "--migration-catalog" || !arguments_[1] ||
    arguments_[2] !== "--confirm-database" || !arguments_[3] ||
    (arguments_[4] !== "--backup-verified" && arguments_[4] !== "--fresh-empty-database")) {
    throw new MigrationApplyError(
      "expected --migration-catalog <path> --confirm-database <exact-name> " +
      "--backup-verified or --fresh-empty-database",
    );
  }
  return { catalogPath: arguments_[1], confirmDatabase: arguments_[3] };
}

export function parseCatalog(document: unknown): readonly CatalogMigration[] {
  if (typeof document !== "object" || document === null ||
    !Array.isArray((document as Record<string, unknown>)["migrations"])) {
    throw new MigrationApplyError("migration catalog document is invalid");
  }
  const entries = (document as { migrations: Record<string, unknown>[] })
    .migrations;
  const migrations: CatalogMigration[] = [];
  for (const entry of entries) {
    const { version, name, upPath, upSha256 } = entry;
    if (typeof version !== "string" || !versionPattern.test(version) ||
      typeof name !== "string" || name.length === 0 ||
      typeof upPath !== "string" || upPath.length === 0 ||
      typeof upSha256 !== "string" || !sha256Pattern.test(upSha256)) {
      throw new MigrationApplyError("migration catalog entry is invalid");
    }
    migrations.push({ version, name, upPath, upSha256 });
  }
  if (migrations.length === 0) {
    throw new MigrationApplyError("migration catalog is empty");
  }
  const sorted = [...migrations].sort((left, right) =>
    left.version.localeCompare(right.version));
  if (migrations.some((entry, index) => entry !== sorted[index]) ||
    new Set(migrations.map((entry) => entry.version)).size !== migrations.length) {
    throw new MigrationApplyError(
      "migration catalog order is not strictly ascending",
    );
  }
  return migrations;
}

export type AppliedRow = Readonly<{
  migrationVersion: string;
  upSha256: string;
}>;

export function planPendingMigrations(
  catalog: readonly CatalogMigration[],
  applied: readonly AppliedRow[],
): readonly CatalogMigration[] {
  const orderedApplied = [...applied].sort((left, right) =>
    left.migrationVersion.localeCompare(right.migrationVersion));
  if (orderedApplied.length > catalog.length) {
    throw new MigrationApplyError(
      "the ledger contains more migrations than the catalog",
    );
  }
  for (const [index, row] of orderedApplied.entries()) {
    const entry = catalog[index];
    if (entry === undefined || entry.version !== row.migrationVersion) {
      throw new MigrationApplyError(
        `applied migration ${row.migrationVersion} is not the catalog prefix`,
      );
    }
    if (entry.upSha256 !== row.upSha256) {
      throw new MigrationApplyError(
        `applied migration ${row.migrationVersion} hash differs from the catalog`,
      );
    }
  }
  return catalog.slice(orderedApplied.length);
}

async function verifyCatalogFiles(
  catalogDir: string,
  catalog: readonly CatalogMigration[],
  catalogDocument: Record<string, unknown>,
): Promise<Map<string, string>> {
  const contents = new Map<string, string>();
  const catalogedPaths = new Set<string>();
  const rawEntries = catalogDocument["migrations"] as Record<string, unknown>[];
  for (const entry of rawEntries) {
    for (const key of ["upPath", "downPath"]) {
      if (typeof entry[key] === "string") {
        catalogedPaths.add(resolve(catalogDir, entry[key] as string));
      }
    }
  }
  for (const migration of catalog) {
    const path = resolve(catalogDir, migration.upPath);
    const content = await readFile(path, "utf8");
    const digest = createHash("sha256").update(content, "utf8").digest("hex");
    if (digest !== migration.upSha256) {
      throw new MigrationApplyError(
        `migration file drift detected for ${migration.version}`,
      );
    }
    contents.set(migration.version, content);
  }
  const migrationsDir = resolve(catalogDir, dirname(catalog[0]?.upPath ?? "migrations/x"));
  for (const fileName of await readdir(migrationsDir)) {
    if (!fileName.endsWith(".sql")) {
      continue;
    }
    if (!catalogedPaths.has(resolve(migrationsDir, fileName))) {
      throw new MigrationApplyError(
        `uncataloged SQL file present in migrations directory: ${fileName}`,
      );
    }
  }
  return contents;
}

export async function runProductionMigrationApply(
  environment: HostedRuntimeEnvironment,
  arguments_: readonly string[],
): Promise<Readonly<{
  database: string;
  alreadyApplied: number;
  applied: readonly string[];
}>> {
  const { catalogPath, confirmDatabase } =
    parseMigrationApplyArguments(arguments_);
  const config = loadHostedMysqlRuntimeConfig(environment);
  if (confirmDatabase !== config.database) {
    throw new MigrationApplyError(
      "the confirmation does not match the configured database name",
    );
  }
  const absoluteCatalogPath = resolve(catalogPath);
  const catalogDocument = JSON.parse(
    await readFile(absoluteCatalogPath, "utf8"),
  ) as Record<string, unknown>;
  const catalog = parseCatalog(catalogDocument);
  const contents = await verifyCatalogFiles(
    dirname(absoluteCatalogPath),
    catalog,
    catalogDocument,
  );

  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    // Trusted hash-pinned migration files are multi-statement by nature;
    // this option exists only in this operator CLI, never in the runtime.
    multipleStatements: true,
  });
  const lockName = `mk8dx.migration.${createHash("sha256").update(config.database).digest("hex").slice(0, 32)}`;
  try {
    const [lockRows] = await connection.query<RowDataPacket[]>(`SELECT GET_LOCK(?,30) AS acquired`, [lockName]);
    if (Number(lockRows[0]?.["acquired"]) !== 1) {
      throw new MigrationApplyError("migration lock is unavailable");
    }
    const [ledgerExists] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'schema_migrations'`,
    );
    let applied: AppliedRow[] = [];
    if (Number(ledgerExists[0]?.["total"]) === 1) {
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT migration_version AS migrationVersion, up_sha256 AS upSha256
         FROM schema_migrations ORDER BY migration_version`,
      );
      applied = rows.map((row) => ({
        migrationVersion: String(row["migrationVersion"]),
        upSha256: String(row["upSha256"]),
      }));
    }
    const pending = planPendingMigrations(catalog, applied);
    if (arguments_[4] === "--fresh-empty-database") {
      if (applied.length === 0) {
        const [tables] = await connection.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE()`,
        );
        if (Number(tables[0]?.["total"]) !== 0) {
          throw new MigrationApplyError("fresh install requires an empty database");
        }
      } else if (pending.length !== 0) {
        throw new MigrationApplyError("pending upgrade requires a verified backup");
      }
    }
    const appliedNow: string[] = [];
    for (const migration of pending) {
      const content = contents.get(migration.version);
      if (content === undefined) {
        throw new MigrationApplyError(
          `migration content missing for ${migration.version}`,
        );
      }
      try {
        await connection.query(content);
      } catch (error) {
        throw new MigrationApplyError(
          `migration ${migration.version} failed mid-file; MySQL DDL is not ` +
          "transactional — inspect the schema state and repair forward or " +
          `restore the pre-migration backup (${error instanceof Error ? error.name : "error"})`,
        );
      }
      await connection.execute(
        `INSERT INTO schema_migrations
         (migration_version, migration_name, up_sha256, applied_at_ms)
         VALUES (?, ?, ?, ?)`,
        [migration.version, migration.name, migration.upSha256, Date.now()],
      );
      appliedNow.push(migration.version);
    }
    return {
      database: config.database,
      alreadyApplied: applied.length,
      applied: appliedNow,
    };
  } finally {
    await connection.query(`SELECT RELEASE_LOCK(?)`, [lockName]).catch(() => undefined);
    await connection.end();
  }
}

async function main(): Promise<void> {
  try {
    const extracted = extractPrivateEnvironmentArgument(process.argv.slice(2));
    const result = await runProductionMigrationApply(
      loadHostedOperatorEnvironment(extracted.environmentPath),
      extracted.commandArguments,
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof MigrationApplyError
      ? error.message
      // An unexpected failure (a database refusing a statement, say) is
      // useless without its own words.
      : `production migration apply failed: ${error instanceof Error ? error.message : String(error)}`;
    process.stderr.write(`Migration apply refused/failed: ${message}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined &&
    import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  void main();
}
