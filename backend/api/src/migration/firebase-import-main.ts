import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import mysql from "mysql2/promise";

import {
  Schema9AssetCatalog,
  TimeTrialSchema9AssetCatalogAdapter,
} from "../assets/schema9-asset-catalog.js";
import {
  loadHostedMysqlRuntimeConfig,
  type HostedRuntimeEnvironment,
} from "../composition/hosted-runtime-config.js";
import { expectedSchema9DatabaseSha256 } from "../composition/local-runtime.js";
import { TimeTrialProtectedValueAdapter } from
  "../security/protected-value-adapters.js";
import {
  FirebaseTimeTrialImportService,
  type FirebaseImportReport,
} from "./firebase-import-service.js";
import { MysqlFirebaseImportRepository } from
  "./mysql-firebase-import-repository.js";

export class FirebaseImportCliError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "FirebaseImportCliError";
  }
}

export type FirebaseImportCliArguments = Readonly<{
  planPath: string;
  reportPath: string | null;
}>;

export function parseFirebaseImportArguments(
  arguments_: readonly string[],
): FirebaseImportCliArguments {
  if (arguments_.length !== 2 && arguments_.length !== 4) {
    throw new FirebaseImportCliError(
      "expected --plan <restricted-plan-path> [--report <new-report-path>]",
    );
  }
  if (arguments_[0] !== "--plan" || typeof arguments_[1] !== "string" ||
    arguments_[1].length === 0) {
    throw new FirebaseImportCliError("--plan requires a restricted plan path");
  }
  let reportPath: string | null = null;
  if (arguments_.length === 4) {
    if (arguments_[2] !== "--report" || typeof arguments_[3] !== "string" ||
      arguments_[3].length === 0) {
      throw new FirebaseImportCliError("--report requires a new report path");
    }
    reportPath = arguments_[3];
  }
  return { planPath: arguments_[1], reportPath };
}

function requiredKey(
  environment: HostedRuntimeEnvironment,
  name: string,
): Uint8Array {
  const encoded = environment[name];
  if (encoded === undefined || encoded.length === 0) {
    throw new FirebaseImportCliError(`${name} is required`);
  }
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.byteLength !== 32 || decoded.toString("base64") !== encoded) {
    throw new FirebaseImportCliError(
      `${name} must be canonical base64 for 32 bytes`,
    );
  }
  return Uint8Array.from(decoded);
}

function requiredValue(
  environment: HostedRuntimeEnvironment,
  name: string,
): string {
  const value = environment[name];
  if (value === undefined || value.length === 0) {
    throw new FirebaseImportCliError(`${name} is required`);
  }
  return value;
}

export async function runFirebaseTimeTrialImport(
  environment: HostedRuntimeEnvironment,
  arguments_: readonly string[],
): Promise<FirebaseImportReport> {
  const cliArguments = parseFirebaseImportArguments(arguments_);
  const mysqlConfig = loadHostedMysqlRuntimeConfig(environment);
  const timeTrialKeys = {
    encryptionKey: requiredKey(
      environment,
      "MK8DX_HOSTED_TIME_TRIAL_ENCRYPTION_KEY_BASE64",
    ),
    encryptionKeyVersion: requiredValue(
      environment,
      "MK8DX_HOSTED_TIME_TRIAL_ENCRYPTION_KEY_VERSION",
    ),
    lookupHmacKey: requiredKey(
      environment,
      "MK8DX_HOSTED_TIME_TRIAL_LOOKUP_HMAC_KEY_BASE64",
    ),
    lookupKeyVersion: requiredValue(
      environment,
      "MK8DX_HOSTED_TIME_TRIAL_LOOKUP_KEY_VERSION",
    ),
  };
  const catalogPath = requiredValue(
    environment,
    "MK8DX_HOSTED_SCHEMA9_CATALOG_PATH",
  );

  let snapshot: unknown;
  try {
    snapshot = JSON.parse(await readFile(catalogPath, "utf8"));
  } catch {
    throw new FirebaseImportCliError("schema-9 catalog could not be loaded");
  }
  const catalog = new Schema9AssetCatalog(snapshot, expectedSchema9DatabaseSha256);

  let planDocument: unknown;
  try {
    planDocument = JSON.parse(await readFile(cliArguments.planPath, "utf8"));
  } catch {
    throw new FirebaseImportCliError("restricted import plan could not be loaded");
  }

  const pool = mysql.createPool({
    ...mysqlConfig,
    multipleStatements: false,
    namedPlaceholders: false,
  });
  try {
    const service = new FirebaseTimeTrialImportService(
      new MysqlFirebaseImportRepository(pool),
      new TimeTrialSchema9AssetCatalogAdapter(catalog),
      new TimeTrialProtectedValueAdapter(timeTrialKeys),
      { nowMs: () => Date.now() },
      () => `migration_import_run.${randomUUID().replaceAll("-", "")}`,
    );
    const report = await service.importPlan(planDocument);
    if (cliArguments.reportPath !== null) {
      await writeFile(
        cliArguments.reportPath,
        `${JSON.stringify(report, null, 2)}\n`,
        { encoding: "utf8", flag: "wx" },
      );
    }
    return report;
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  try {
    const report = await runFirebaseTimeTrialImport(
      process.env,
      process.argv.slice(2),
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.totals.failed > 0) {
      process.exitCode = 1;
    }
  } catch {
    process.stderr.write(
      "Firebase Time Trial import failed; no import report was produced.\n",
    );
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined &&
    import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  void main();
}
