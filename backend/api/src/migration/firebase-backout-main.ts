import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import mysql from "mysql2/promise";

import { loadHostedMysqlRuntimeConfig } from
  "../composition/hosted-runtime-config.js";
import {
  FirebaseTimeTrialBackoutService,
  type FirebaseBackoutReport,
  type FirebaseBackoutRequest,
} from "./firebase-backout-service.js";
import { MysqlFirebaseBackoutRepository } from
  "./mysql-firebase-backout-repository.js";

export class FirebaseBackoutCliError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "FirebaseBackoutCliError";
  }
}

export type FirebaseBackoutCliArguments = Readonly<{
  request: FirebaseBackoutRequest;
  reportPath: string | null;
}>;

export function parseFirebaseBackoutArguments(
  arguments_: readonly string[],
): FirebaseBackoutCliArguments {
  let importRunId: string | undefined;
  const recordKeys: string[] = [];
  let reportPath: string | null = null;
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (typeof value !== "string" || value.length === 0) {
      throw new FirebaseBackoutCliError(
        "expected --run <import-run-id> or --record-key <key> [--report <new-path>]",
      );
    }
    if (flag === "--run" && importRunId === undefined) {
      importRunId = value;
    } else if (flag === "--record-key") {
      recordKeys.push(value);
    } else if (flag === "--report" && reportPath === null) {
      reportPath = value;
    } else {
      throw new FirebaseBackoutCliError(
        "expected --run <import-run-id> or --record-key <key> [--report <new-path>]",
      );
    }
  }
  if ((importRunId === undefined) === (recordKeys.length === 0)) {
    throw new FirebaseBackoutCliError(
      "exactly one of --run or at least one --record-key is required",
    );
  }
  const request: FirebaseBackoutRequest = importRunId !== undefined
    ? { importRunId }
    : { recordKeys };
  return { request, reportPath };
}

export async function runFirebaseTimeTrialBackout(
  environment: Readonly<Record<string, string | undefined>>,
  arguments_: readonly string[],
): Promise<FirebaseBackoutReport> {
  const cliArguments = parseFirebaseBackoutArguments(arguments_);
  const mysqlConfig = loadHostedMysqlRuntimeConfig(environment);
  const pool = mysql.createPool({
    ...mysqlConfig,
    multipleStatements: false,
    namedPlaceholders: false,
  });
  try {
    const service = new FirebaseTimeTrialBackoutService(
      new MysqlFirebaseBackoutRepository(pool),
      { nowMs: () => Date.now() },
      () => `migration_import_run.backout_${randomUUID().replaceAll("-", "")}`,
    );
    const report = await service.backOut(cliArguments.request);
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
    const report = await runFirebaseTimeTrialBackout(
      process.env,
      process.argv.slice(2),
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.totals.failed > 0) {
      process.exitCode = 1;
    }
  } catch {
    process.stderr.write(
      "Firebase Time Trial backout failed; no backout report was produced.\n",
    );
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined &&
    import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  void main();
}
