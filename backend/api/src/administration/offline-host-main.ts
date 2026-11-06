import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import mysql from "mysql2/promise";

import { loadHostedMysqlRuntimeConfig } from "../composition/hosted-runtime-config.js";
import { createOfflineHostApp } from "./offline-host-app.js";
import { OfflineHostSessions } from "./offline-host-session.js";
import { OfflineHostUnlockStore } from "./offline-host-unlock.js";
import {
  activeOfflineAdministrator,
  hasAdministratorGrant,
  offlineHostUnlockPath,
} from "./offline-host-unlock-main.js";

export async function startOfflineHost(environment: NodeJS.ProcessEnv): Promise<() => Promise<void>> {
  const path = offlineHostUnlockPath(environment);
  const origin = environment["MK8DX_OFFLINE_HOST_ORIGIN"];
  if (origin === undefined) { throw new Error("offline host origin is unavailable"); }
  const pool = mysql.createPool({ ...loadHostedMysqlRuntimeConfig(environment),
    multipleStatements: false, namedPlaceholders: false });
  try {
    const sessions = new OfflineHostSessions(async (accountId) => accountId === null
      ? !await hasAdministratorGrant(pool)
      : await activeOfflineAdministrator(pool, accountId));
    const app = createOfflineHostApp({ origin,
      unlocks: new OfflineHostUnlockStore(path), sessions });
    await app.listen({ host: "0.0.0.0", port: 8081 });
    return async () => { await app.close(); await pool.end(); };
  } catch (error) {
    await pool.end();
    throw error;
  }
}

async function main(): Promise<void> {
  try {
    const close = await startOfflineHost(process.env);
    const shutdown = () => { void close().catch(() => { process.exitCode = 1; }); };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    process.stdout.write("MK8DX offline host listener ready on container port 8081\n");
  } catch {
    process.stderr.write("Offline host listener startup failed.\n");
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  void main();
}
