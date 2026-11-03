import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import mysql from "mysql2/promise";

import { AdministratorGrantService } from "./administrator-grant-service.js";
import { MysqlAdministratorGrantWriteRepository } from
  "./mysql-administrator-grant-repository.js";
import {
  loadHostedMysqlRuntimeConfig,
  type HostedRuntimeEnvironment,
} from "../composition/hosted-runtime-config.js";

export class AdministratorBootstrapCliError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AdministratorBootstrapCliError";
  }
}

export function parseAdministratorBootstrapArguments(
  arguments_: readonly string[],
): string {
  if (arguments_.length !== 4 ||
      arguments_[0] !== "--user-account-id" ||
      arguments_[2] !== "--confirm-user-account-id") {
    throw new AdministratorBootstrapCliError(
      "expected --user-account-id <id> --confirm-user-account-id <same-id>",
    );
  }
  const userAccountId = arguments_[1];
  const confirmation = arguments_[3];
  if (userAccountId === undefined || confirmation === undefined ||
      userAccountId !== confirmation) {
    throw new AdministratorBootstrapCliError(
      "UserAccount confirmation must exactly match",
    );
  }
  return userAccountId;
}

export async function runAdministratorBootstrap(
  environment: HostedRuntimeEnvironment,
  arguments_: readonly string[],
): Promise<string> {
  const userAccountId = parseAdministratorBootstrapArguments(arguments_);
  const config = loadHostedMysqlRuntimeConfig(environment);
  const pool = mysql.createPool({ ...config, multipleStatements: false, namedPlaceholders: false });
  try {
    const service = new AdministratorGrantService(
      new MysqlAdministratorGrantWriteRepository(pool),
      { newAdministratorGrantId: () => `administrator_grant.${randomUUID()}` },
      { nowMs: () => Date.now() },
    );
    const grant = await service.bootstrapFirstAdministrator(userAccountId);
    return grant.administratorGrantId;
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  try {
    const grantId = await runAdministratorBootstrap(process.env, process.argv.slice(2));
    process.stdout.write(`Initial administrator grant created: ${grantId}\n`);
  } catch {
    process.stderr.write(
      "Administrator bootstrap failed; no administrator grant was reported.\n",
    );
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined &&
    import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  void main();
}
