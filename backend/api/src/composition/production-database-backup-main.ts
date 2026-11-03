import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadHostedMysqlRuntimeConfig, type HostedRuntimeEnvironment } from
  "./hosted-runtime-config.js";
import {
  extractPrivateEnvironmentArgument,
  loadHostedOperatorEnvironment,
} from "./hosted-operator-environment.js";

export class ProductionDatabaseBackupError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ProductionDatabaseBackupError";
  }
}

export type DatabaseDumpInvocation = Readonly<{
  executable: string;
  arguments: readonly string[];
  password: string;
  outputPath: string;
}>;

export type DatabaseDumpRunner = (
  invocation: DatabaseDumpInvocation,
) => Promise<number>;

const defaultRunner: DatabaseDumpRunner = async (invocation) => {
  const descriptor = openSync(invocation.outputPath, "wx", 0o600);
  try {
    return await new Promise<number>((resolveExit) => {
      const child = spawn(invocation.executable, invocation.arguments, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", descriptor, "ignore"],
        env: {
          PATH: process.env["PATH"],
          LANG: process.env["LANG"],
          MYSQL_PWD: invocation.password,
        },
      });
      child.once("error", () => resolveExit(-1));
      child.once("close", (code) => resolveExit(code ?? -1));
    });
  } finally {
    closeSync(descriptor);
  }
};

export function parseProductionBackupArguments(
  arguments_: readonly string[],
): Readonly<{ outputPath: string; dumpExecutable: string }> {
  if (arguments_.length !== 2 && arguments_.length !== 4) {
    throw new ProductionDatabaseBackupError(
      "expected --output <absolute-new-file> [--dump-executable <absolute-path>]",
    );
  }
  if (arguments_[0] !== "--output" || !arguments_[1] ||
    (arguments_.length === 4 &&
      (arguments_[2] !== "--dump-executable" || !arguments_[3]))) {
    throw new ProductionDatabaseBackupError(
      "expected --output <absolute-new-file> [--dump-executable <absolute-path>]",
    );
  }
  const outputPath = arguments_[1];
  const dumpExecutable = arguments_[3] ?? "/usr/bin/mysqldump";
  if (!isAbsolute(outputPath) || !isAbsolute(dumpExecutable)) {
    throw new ProductionDatabaseBackupError(
      "backup output and dump executable paths must be absolute",
    );
  }
  return { outputPath, dumpExecutable };
}

export async function runProductionDatabaseBackup(
  environment: HostedRuntimeEnvironment,
  arguments_: readonly string[],
  runner: DatabaseDumpRunner = defaultRunner,
): Promise<Readonly<{
  outputPath: string;
  sha256: string;
  bytes: number;
  createTableCount: number;
}>> {
  const { outputPath, dumpExecutable } = parseProductionBackupArguments(arguments_);
  const checksumPath = `${outputPath}.sha256`;
  const config = loadHostedMysqlRuntimeConfig(environment);
  const invocation: DatabaseDumpInvocation = {
    executable: dumpExecutable,
    arguments: [
      "--single-transaction",
      "--no-tablespaces",
      "--host", config.host,
      "--port", String(config.port),
      "--user", config.user,
      "--databases", config.database,
    ],
    password: config.password,
    outputPath,
  };
  const exitCode = await runner(invocation);
  if (exitCode !== 0) {
    try { unlinkSync(outputPath); } catch { /* no completed backup to retain */ }
    throw new ProductionDatabaseBackupError(
      "database backup failed without producing trusted output",
    );
  }
  let content: Buffer;
  try {
    content = readFileSync(outputPath);
  } catch {
    throw new ProductionDatabaseBackupError("database backup output could not be verified");
  }
  const createTableCount = (content.toString("utf8").match(/^CREATE TABLE/gmu) ?? []).length;
  if (content.byteLength === 0 || createTableCount === 0) {
    throw new ProductionDatabaseBackupError("database backup output failed structural verification");
  }
  const sha256 = createHash("sha256").update(content).digest("hex");
  writeFileSync(checksumPath, `${sha256}  ${outputPath}\n`, { flag: "wx", mode: 0o600 });
  return {
    outputPath,
    sha256,
    bytes: statSync(outputPath).size,
    createTableCount,
  };
}

async function main(): Promise<void> {
  try {
    const extracted = extractPrivateEnvironmentArgument(process.argv.slice(2));
    const environment = loadHostedOperatorEnvironment(extracted.environmentPath);
    const result = await runProductionDatabaseBackup(environment, extracted.commandArguments);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof ProductionDatabaseBackupError
      ? error.message
      : "production database backup refused/failed";
    process.stderr.write(`Production database backup refused/failed: ${message}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined &&
    import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  void main();
}
