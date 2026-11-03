/** Narrow local operator recovery after a synthetic first-admin bootstrap.
 * Requires the private operator environment and Docker/server access. No HTTP route. */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";

import { AdministratorGrantService } from "./administrator-grant-service.js";
import { runAdministratorAccountLookup } from "./administrator-account-lookup-main.js";
import { MysqlAdministratorGrantWriteRepository } from "./mysql-administrator-grant-repository.js";
import { loadHostedMysqlRuntimeConfig, type HostedRuntimeEnvironment } from "../composition/hosted-runtime-config.js";
import { extractPrivateEnvironmentArgument, loadHostedOperatorEnvironment } from "../composition/hosted-operator-environment.js";

interface GrantState {
  userAccountId: string; origin: string; status: string; accountStatus: string;
}
interface GrantRow extends RowDataPacket, GrantState {}
interface LockRow extends RowDataPacket { acquired: number | null }

export class AdministratorRecoveryError extends Error {
  public constructor(message: string) { super(message); this.name = "AdministratorRecoveryError"; }
}

export function decideAdministratorRecovery(
  grants: readonly GrantState[], targetAccountId: string,
): Readonly<{ action: "grant" | "unchanged"; actorAccountId: string }> {
  const bootstrap = grants.filter((row) => row.origin === "bootstrap_cli");
  if (bootstrap.length !== 1 || bootstrap[0]?.status !== "active" ||
      bootstrap[0]?.accountStatus !== "active") {
    throw new AdministratorRecoveryError("one active bootstrap administrator is required");
  }
  const actorAccountId = bootstrap[0].userAccountId;
  if (grants.length === 1) {
    return { action: targetAccountId === actorAccountId ? "unchanged" : "grant", actorAccountId };
  }
  if (grants.length === 2 && grants.some((row) =>
    row.origin === "administrator" && row.userAccountId === targetAccountId &&
    row.status === "active" && row.accountStatus === "active")) {
    return { action: "unchanged", actorAccountId };
  }
  throw new AdministratorRecoveryError("recovery was already used or grant history needs authenticated review");
}

export async function runAdministratorRecovery(
  environment: HostedRuntimeEnvironment, email: string,
): Promise<"created" | "unchanged"> {
  if (!/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(email)) {
    throw new AdministratorRecoveryError("email is invalid");
  }
  const pool = mysql.createPool({ ...loadHostedMysqlRuntimeConfig(environment), connectionLimit: 2,
    multipleStatements: false, namedPlaceholders: false });
  try {
    const lock = await pool.getConnection();
    try {
      const [lockRows] = await lock.execute<LockRow[]>(
        "SELECT GET_LOCK('mk8dx_administrator_recovery_v1', 10) AS acquired",
      );
      if (lockRows[0]?.acquired !== 1) throw new AdministratorRecoveryError("recovery lock unavailable");
      try {
        // Resolve the exact verified binding while the recovery decision is serialized.
        const targetAccountId = await runAdministratorAccountLookup(environment, ["--email", email]);
        const [grants] = await lock.execute<GrantRow[]>(
          `SELECT account.public_id AS userAccountId,
                  grant_record.grant_origin AS origin,
                  grant_record.grant_status AS status,
                  account.account_status AS accountStatus
           FROM administrator_grants AS grant_record
           INNER JOIN user_accounts AS account ON account.user_account_id=grant_record.user_account_id
           ORDER BY grant_record.administrator_grant_id LIMIT 3`,
        );
        const decision = decideAdministratorRecovery(grants, targetAccountId);
        if (decision.action === "unchanged") return "unchanged";
        const service = new AdministratorGrantService(
          new MysqlAdministratorGrantWriteRepository(pool),
          { newAdministratorGrantId: () => `administrator_grant.${randomUUID()}` },
          { nowMs: () => Date.now() },
        );
        await service.grantAdministrator(
          { role: "administrator", userAccountId: decision.actorAccountId },
          targetAccountId, "operator_verified_recovery",
        );
        return "created";
      } finally {
        await lock.execute("SELECT RELEASE_LOCK('mk8dx_administrator_recovery_v1')");
      }
    } finally { lock.release(); }
  } finally { await pool.end(); }
}

async function main(): Promise<void> {
  try {
    const extracted = extractPrivateEnvironmentArgument(process.argv.slice(2));
    if (extracted.commandArguments.length !== 2 ||
        extracted.commandArguments[0] !== "--email-stdin" ||
        extracted.commandArguments[1] !== "--confirm-existing-bootstrap") {
      throw new AdministratorRecoveryError("explicit recovery confirmation is required");
    }
    let email = "";
    for await (const chunk of process.stdin) {
      email += String(chunk);
      if (email.length > 1024) throw new AdministratorRecoveryError("email input is too long");
    }
    const outcome = await runAdministratorRecovery(
      loadHostedOperatorEnvironment(extracted.environmentPath), email.trim(),
    );
    process.stdout.write(`${JSON.stringify({ administratorRecovery: outcome })}\n`);
  } catch {
    process.stderr.write("Administrator recovery refused; verify the target sign-in and installation state.\n");
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  void main();
}
