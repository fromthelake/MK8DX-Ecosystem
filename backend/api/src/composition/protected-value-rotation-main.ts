import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import mysql from "mysql2/promise";

import { rotateProtectedValues } from "../security/protected-value-rotation.js";
import { loadPasswordlessHostedRuntimeConfig } from "./hosted-runtime-config.js";
import {
  extractPrivateEnvironmentArgument,
  loadHostedOperatorEnvironment,
} from "./hosted-operator-environment.js";

class ProtectedValueRotationCliError extends Error {}

function parseArguments(
  arguments_: readonly string[],
  database: string,
): boolean {
  if (arguments_.length === 1 && arguments_[0] === "--dry-run") { return false; }
  if (arguments_.length === 4 && arguments_[0] === "--apply" &&
    arguments_[1] === "--confirm-database" && arguments_[2] === database &&
    arguments_[3] === "--backup-verified") {
    return true;
  }
  throw new ProtectedValueRotationCliError(
    "expected --dry-run or --apply --confirm-database <exact-name> --backup-verified",
  );
}

async function main(): Promise<void> {
  let pool: mysql.Pool | undefined;
  try {
    const extracted = extractPrivateEnvironmentArgument(process.argv.slice(2));
    const config = loadPasswordlessHostedRuntimeConfig(
      loadHostedOperatorEnvironment(extracted.environmentPath),
    );
    const apply = parseArguments(extracted.commandArguments, config.core.mysql.database);
    pool = mysql.createPool({ ...config.core.mysql, connectionLimit: 1 });
    const report = await rotateProtectedValues(pool, {
      timeTrial: {
        active: config.core.timeTrialKeys,
        decrypt: config.core.timeTrialDecryptionKeys,
      },
      tournament: {
        active: config.core.tournamentKeys,
        decrypt: config.core.tournamentDecryptionKeys,
      },
    }, apply);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof ProtectedValueRotationCliError
      ? error.message : "protected-value rotation refused/failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined &&
    import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  void main();
}
