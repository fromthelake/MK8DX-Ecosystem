import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import mysql from "mysql2/promise";
import type { Pool, RowDataPacket } from "mysql2/promise";

import { loadHostedMysqlRuntimeConfig } from "../composition/hosted-runtime-config.js";
import { OfflineHostUnlockStore } from "./offline-host-unlock.js";

type CountRow = RowDataPacket & { countValue: number | string };
type ActiveRow = RowDataPacket & { accountId: string };

export function offlineHostUnlockPath(environment: NodeJS.ProcessEnv): string {
  const directory = environment["MK8DX_OFFLINE_HOST_STATE_DIR"];
  if (environment["MK8DX_OFFLINE_LAN"] !== "true" ||
      directory !== "/run/mk8dx/host-state") {
    throw new Error("offline host state is unavailable");
  }
  return `${directory}/unlock.json`;
}

export async function hasAdministratorGrant(pool: Pool): Promise<boolean> {
  const [rows] = await pool.execute<CountRow[]>(
    "SELECT COUNT(*) countValue FROM administrator_grants");
  if (rows.length !== 1) { throw new Error("administrator history is ambiguous"); }
  const count = Number(rows[0]!.countValue);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("administrator history is invalid");
  }
  return count > 0;
}

export async function activeOfflineAdministrator(pool: Pool, accountId: string): Promise<boolean> {
  const [rows] = await pool.execute<ActiveRow[]>(
    `SELECT user.public_id accountId FROM user_accounts user
     INNER JOIN administrator_grants grant_record
       ON grant_record.user_account_id=user.user_account_id
       AND grant_record.grant_status='active'
     INNER JOIN offline_auth_accounts offline
       ON offline.user_account_id=user.user_account_id
       AND offline.account_role='administrator' AND offline.active=TRUE
     WHERE user.public_id=? AND user.account_status='active' LIMIT 2`, [accountId]);
  return rows.length === 1 && rows[0]!.accountId === accountId;
}

export function parseOfflineHostUnlockArguments(arguments_: readonly string[]): string | null {
  if (arguments_.length === 1 && arguments_[0] === "--bootstrap") { return null; }
  if (arguments_.length === 2 && arguments_[0] === "--user-account-id" &&
      /^user_account\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(arguments_[1]!)) {
    return arguments_[1]!;
  }
  throw new Error("expected --bootstrap or --user-account-id <id>");
}

export async function issueOfflineHostUnlock(environment: NodeJS.ProcessEnv,
                                             arguments_: readonly string[]): Promise<Readonly<{
  code: string; expiresAtMs: number;
}>> {
  const accountId = parseOfflineHostUnlockArguments(arguments_);
  const path = offlineHostUnlockPath(environment);
  const pool = mysql.createPool({ ...loadHostedMysqlRuntimeConfig(environment),
    multipleStatements: false, namedPlaceholders: false });
  try {
    const bootstrapped = await hasAdministratorGrant(pool);
    if (accountId === null ? bootstrapped :
        !bootstrapped || !await activeOfflineAdministrator(pool, accountId)) {
      throw new Error("offline host unlock is not authorized");
    }
    return await new OfflineHostUnlockStore(path).issue(accountId);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  try {
    const result = await issueOfflineHostUnlock(process.env, process.argv.slice(2));
    process.stdout.write(`One-use host unlock code (expires at ${new Date(result.expiresAtMs).toISOString()}): ${result.code}\n`);
  } catch {
    process.stderr.write("Host unlock refused; check offline installation and administrator state.\n");
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  void main();
}
