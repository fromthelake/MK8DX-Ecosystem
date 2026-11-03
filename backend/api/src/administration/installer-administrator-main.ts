import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";

import { loadHostedMysqlRuntimeConfig, type HostedRuntimeEnvironment } from "../composition/hosted-runtime-config.js";
import { extractPrivateEnvironmentArgument, loadHostedOperatorEnvironment } from "../composition/hosted-operator-environment.js";
import { runAdministratorAccountLookup } from "./administrator-account-lookup-main.js";
import { runAdministratorBootstrap } from "./administrator-bootstrap-main.js";

export class InstallerAdministratorError extends Error {
  public constructor(message: string) { super(message); this.name = "InstallerAdministratorError"; }
}

interface BootstrapRow extends RowDataPacket { userAccountId: unknown; status: unknown; accountStatus: unknown }

export async function establishInstallerAdministrator(
  environment: HostedRuntimeEnvironment,
  email: string,
): Promise<"created" | "unchanged"> {
  if (!/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(email)) {
    throw new InstallerAdministratorError("administrator email is invalid");
  }
  const accountId = await runAdministratorAccountLookup(environment, ["--email", email]);
  const config = loadHostedMysqlRuntimeConfig(environment);
  const pool = mysql.createPool({ ...config, connectionLimit: 1, multipleStatements: false });
  const findBootstrap = async (): Promise<BootstrapRow | undefined> => {
    const [rows] = await pool.execute<BootstrapRow[]>(
      `SELECT account.public_id AS userAccountId,grant_record.grant_status AS status,
              account.account_status AS accountStatus
       FROM administrator_grants AS grant_record
       INNER JOIN user_accounts AS account ON account.user_account_id=grant_record.user_account_id
       WHERE grant_record.grant_origin='bootstrap_cli' LIMIT 2`,
    );
    if (rows.length > 1) throw new InstallerAdministratorError("administrator bootstrap history is ambiguous");
    return rows[0];
  };
  const assess = (row: BootstrapRow): "unchanged" => {
    if (row.userAccountId !== accountId || row.status !== "active" || row.accountStatus !== "active") {
      throw new InstallerAdministratorError("administrator bootstrap is already consumed; use authenticated recovery");
    }
    return "unchanged";
  };
  try {
    const existing = await findBootstrap();
    if (existing !== undefined) return assess(existing);
    try {
      await runAdministratorBootstrap(environment, ["--user-account-id", accountId, "--confirm-user-account-id", accountId]);
      return "created";
    } catch (error) {
      // A competing installer may have completed the same account. Re-read
      // the durable grant, never infer success from a generic duplicate error.
      const afterRace = await findBootstrap();
      if (afterRace !== undefined) return assess(afterRace);
      throw error;
    }
  } finally {
    await pool.end();
  }
}

async function emailFromArguments(args: readonly string[]): Promise<string> {
  if (args.length === 1 && args[0] === "--email-stdin") {
    let value = "";
    for await (const chunk of process.stdin) {
      value += String(chunk);
      if (value.length > 1024) throw new InstallerAdministratorError("administrator input is too long");
    }
    return value.trim();
  }
  if (args.length === 2 && args[0] === "--email-file" && args[1]) {
    const value = await readFile(resolve(args[1]), "utf8");
    if (value.length > 1024) throw new InstallerAdministratorError("administrator input is too long");
    return value.trim();
  }
  throw new InstallerAdministratorError("expected --email-stdin or --email-file <private path>");
}

async function main(): Promise<void> {
  try {
    const extracted = extractPrivateEnvironmentArgument(process.argv.slice(2));
    const email = await emailFromArguments(extracted.commandArguments);
    const result = await establishInstallerAdministrator(
      loadHostedOperatorEnvironment(extracted.environmentPath), email,
    );
    process.stdout.write(`${JSON.stringify({ administrator: result })}\n`);
  } catch {
    process.stderr.write("Administrator setup refused; check verified sign-in and private installation state.\n");
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  void main();
}
