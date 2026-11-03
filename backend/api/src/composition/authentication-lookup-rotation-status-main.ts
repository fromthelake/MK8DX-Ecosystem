import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { RowDataPacket } from "mysql2";
import mysql from "mysql2/promise";

import { loadHostedMysqlRuntimeConfig } from "./hosted-runtime-config.js";
import {
  extractPrivateEnvironmentArgument,
  loadHostedOperatorEnvironment,
} from "./hosted-operator-environment.js";

interface VersionRow extends RowDataPacket {
  version: unknown;
  total: unknown;
}

async function main(): Promise<void> {
  let pool: mysql.Pool | undefined;
  try {
    const extracted = extractPrivateEnvironmentArgument(process.argv.slice(2));
    if (extracted.commandArguments.length !== 0) {
      throw new Error("unexpected arguments");
    }
    const environment = loadHostedOperatorEnvironment(extracted.environmentPath);
    const config = loadHostedMysqlRuntimeConfig(environment);
    const activeVersion = environment["MK8DX_HOSTED_AUTHENTICATION_LOOKUP_KEY_VERSION"];
    if (activeVersion === undefined || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(activeVersion)) {
      throw new Error("active authentication lookup version is invalid");
    }
    pool = mysql.createPool({ ...config, connectionLimit: 1 });
    const [rows] = await pool.execute<VersionRow[]>(
      `SELECT lookup_key_version AS version, COUNT(*) AS total
       FROM restricted_authentication_bindings
       WHERE binding_status = 'active'
       GROUP BY lookup_key_version ORDER BY lookup_key_version`,
    );
    const versions = rows.map((row) => ({
      version: String(row.version),
      total: Number(row.total),
    }));
    const retainedActiveBindings = versions
      .filter((entry) => entry.version !== activeVersion)
      .reduce((total, entry) => total + entry.total, 0);
    process.stdout.write(`${JSON.stringify({
      activeVersion,
      versions,
      retainedActiveBindings,
      status: retainedActiveBindings === 0 ? "ready_to_retire" : "rotation_in_progress",
    }, null, 2)}\n`);
  } catch {
    process.stderr.write("Authentication lookup rotation status failed.\n");
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
