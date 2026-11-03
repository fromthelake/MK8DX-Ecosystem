import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import mysql from "mysql2/promise";

import { Schema9AssetCatalog } from "../assets/schema9-asset-catalog.js";
import {
  loadPasswordlessHostedRuntimeConfig,
  type HostedRuntimeEnvironment,
} from "./hosted-runtime-config.js";
import { expectedSchema9DatabaseSha256 } from "./local-runtime.js";
import {
  extractPrivateEnvironmentArgument,
  loadHostedOperatorEnvironment,
} from "./hosted-operator-environment.js";

export class HostedPreflightCliError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "HostedPreflightCliError";
  }
}

export type HostedPreflightCheck = Readonly<{
  check: "configuration" | "schema9_catalog" | "mysql_connection" | "migration_ledger";
  status: "ok" | "failed";
  detail: string;
}>;

export type HostedPreflightReport = Readonly<{
  status: "ready" | "not_ready";
  checks: readonly HostedPreflightCheck[];
}>;

export function parseHostedPreflightArguments(
  arguments_: readonly string[],
): string {
  if (arguments_.length !== 2 || arguments_[0] !== "--migration-catalog" ||
    typeof arguments_[1] !== "string" || arguments_[1].length === 0) {
    throw new HostedPreflightCliError(
      "expected --migration-catalog <path-to-migration-catalog-v1.json>",
    );
  }
  return arguments_[1];
}

export type MigrationLedgerRow = Readonly<{
  migrationVersion: string;
  upSha256: string;
}>;

export function verifyMigrationLedger(
  catalogDocument: unknown,
  ledgerRows: readonly MigrationLedgerRow[],
): Readonly<{ ok: boolean; detail: string }> {
  if (typeof catalogDocument !== "object" || catalogDocument === null ||
    !Array.isArray((catalogDocument as Record<string, unknown>)["migrations"])) {
    return { ok: false, detail: "migration catalog document is invalid" };
  }
  const catalogEntries = (catalogDocument as {
    migrations: { version?: unknown; upSha256?: unknown }[];
  }).migrations;
  const expected = new Map<string, string>();
  for (const entry of catalogEntries) {
    if (typeof entry.version !== "string" || typeof entry.upSha256 !== "string") {
      return { ok: false, detail: "migration catalog entry is invalid" };
    }
    expected.set(entry.version, entry.upSha256);
  }
  const applied = new Map(
    ledgerRows.map((row) => [row.migrationVersion, row.upSha256]),
  );
  if (applied.size !== ledgerRows.length) {
    return { ok: false, detail: "migration ledger contains duplicate versions" };
  }
  const missing = [...expected.keys()].filter(
    (version) => !applied.has(version),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      detail: `migrations are not applied: ${missing.sort().join(", ")}`,
    };
  }
  const unknown = [...applied.keys()].filter(
    (version) => !expected.has(version),
  );
  if (unknown.length > 0) {
    return {
      ok: false,
      detail: `ledger contains uncataloged migrations: ${unknown.sort().join(", ")}`,
    };
  }
  const drifted = [...expected.entries()]
    .filter(([version, sha]) => applied.get(version) !== sha)
    .map(([version]) => version);
  if (drifted.length > 0) {
    return {
      ok: false,
      detail: `applied migration hashes differ from the catalog: ${drifted.sort().join(", ")}`,
    };
  }
  return {
    ok: true,
    detail: `all ${expected.size} cataloged migrations are applied with exact hashes`,
  };
}

export async function runHostedDeploymentPreflight(
  environment: HostedRuntimeEnvironment,
  arguments_: readonly string[],
): Promise<HostedPreflightReport> {
  const migrationCatalogPath = parseHostedPreflightArguments(arguments_);
  const checks: HostedPreflightCheck[] = [];
  const failed = (
    check: HostedPreflightCheck["check"],
    detail: string,
  ): HostedPreflightReport => {
    checks.push({ check, status: "failed", detail });
    return { status: "not_ready", checks };
  };

  let config;
  try {
    config = loadPasswordlessHostedRuntimeConfig(environment);
  } catch (error) {
    // Configuration errors name only the offending variable, never its value.
    return failed(
      "configuration",
      error instanceof Error ? error.message : "configuration is invalid",
    );
  }
  checks.push({
    check: "configuration",
    status: "ok",
    detail: "hosted environment configuration is complete and self-consistent",
  });

  try {
    const snapshot = JSON.parse(
      await readFile(config.core.schema9CatalogPath, "utf8"),
    );
    new Schema9AssetCatalog(snapshot, expectedSchema9DatabaseSha256);
    checks.push({
      check: "schema9_catalog",
      status: "ok",
      detail: "pinned schema-9 catalog loads and matches its database hash",
    });
  } catch {
    return failed(
      "schema9_catalog",
      "the pinned schema-9 catalog could not be loaded and verified",
    );
  }

  let migrationCatalog: unknown;
  try {
    migrationCatalog = JSON.parse(await readFile(migrationCatalogPath, "utf8"));
  } catch {
    return failed(
      "migration_ledger",
      "the migration catalog file could not be loaded",
    );
  }

  const pool = mysql.createPool({
    ...config.core.mysql,
    connectionLimit: 1,
    multipleStatements: false,
    namedPlaceholders: false,
  });
  try {
    let rows: MigrationLedgerRow[];
    try {
      const [ledger] = await pool.execute<import("mysql2").RowDataPacket[]>(
        `SELECT migration_version AS migrationVersion, up_sha256 AS upSha256
         FROM schema_migrations ORDER BY migration_version`,
      );
      rows = ledger.map((row) => ({
        migrationVersion: String(row["migrationVersion"]),
        upSha256: String(row["upSha256"]),
      }));
    } catch {
      return failed(
        "mysql_connection",
        "MySQL is unreachable or the migration ledger is absent",
      );
    }
    checks.push({
      check: "mysql_connection",
      status: "ok",
      detail: "MySQL connection and migration ledger read succeeded",
    });

    const ledger = verifyMigrationLedger(migrationCatalog, rows);
    if (!ledger.ok) {
      return failed("migration_ledger", ledger.detail);
    }
    checks.push({ check: "migration_ledger", status: "ok", detail: ledger.detail });
    return { status: "ready", checks };
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  try {
    const extracted = extractPrivateEnvironmentArgument(process.argv.slice(2));
    const report = await runHostedDeploymentPreflight(
      loadHostedOperatorEnvironment(extracted.environmentPath),
      extracted.commandArguments,
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status !== "ready") {
      process.exitCode = 1;
    }
  } catch {
    process.stderr.write("Hosted deployment preflight failed to run.\n");
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined &&
    import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  void main();
}
