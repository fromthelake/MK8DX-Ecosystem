import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHmac } from "node:crypto";

import mysql from "mysql2/promise";

import { loadPasswordlessHostedRuntimeConfig } from "../composition/hosted-runtime-config.js";
import { MysqlOfflineInvitationTicketRepository } from "../authentication/mysql-offline-invitation-tickets.js";
import { OfflineInvitationTicketService } from "../authentication/offline-invitation-ticket.js";
import { MysqlOfflineHostAccounts } from "./offline-host-accounts.js";
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
  const runtime = loadPasswordlessHostedRuntimeConfig(environment);
  if (runtime.offlineLan !== true) { throw new Error("offline host requires the A2 runtime"); }
  const pool = mysql.createPool({ ...runtime.core.mysql,
    multipleStatements: false, namedPlaceholders: false });
  try {
    const sessions = new OfflineHostSessions(async (accountId) => accountId === null
      ? !await hasAdministratorGrant(pool)
      : await activeOfflineAdministrator(pool, accountId));
    const app = await createOfflineHostApp({ origin,
      unlocks: new OfflineHostUnlockStore(path), sessions,
      accounts: new MysqlOfflineHostAccounts(pool),
      tickets: new OfflineInvitationTicketService(
        new MysqlOfflineInvitationTicketRepository(pool),
        createHmac("sha256", Buffer.from(runtime.authentication.secrets[0]!.value, "base64"))
          .update("mk8dx.offline-invitation-digest.v1", "ascii").digest()),
      publicOrigin: runtime.authentication.baseUrl,
      rootCertificateSha256: environment["MK8DX_OFFLINE_ROOT_CERT_SHA256"] ?? "",
      rootSpkiSha256: environment["MK8DX_OFFLINE_ROOT_SPKI_SHA256"] ?? "",
    });
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
