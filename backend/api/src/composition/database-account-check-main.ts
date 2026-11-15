// Reports what the configured database account may do, without printing a password or a grant line.
//
//   node dist/composition/database-account-check-main.js \
//     --private-environment-file /absolute/path/to/owner-only.json
//
// The installers run it against the running website's settings: the runtime account should only read and
// write rows (SELECT, INSERT, UPDATE, DELETE); creating, changing or removing tables, users or grants
// belongs to the separate migration account. Output: one JSON object
//   {"user":"...","database":"...","dataAccess":true,"canChangeSchema":false,"extraPrivileges":[]}
import { pathToFileURL } from "node:url";

import mysql from "mysql2/promise";

import { extractPrivateEnvironmentArgument, loadHostedOperatorEnvironment } from "./hosted-operator-environment.js";
import { loadHostedMysqlRuntimeConfig } from "./hosted-runtime-config.js";

/** Privileges a runtime account may hold without being able to change or remove the schema. */
export const RUNTIME_ACCOUNT_PRIVILEGES: ReadonlySet<string> = new Set([
  "SELECT", "INSERT", "UPDATE", "DELETE", "USAGE",
]);
const DATA_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const;

export type DatabaseAccountReport = Readonly<{
  dataAccess: boolean;
  canChangeSchema: boolean;
  extraPrivileges: readonly string[];
}>;

function unquote(identifier: string): string {
  const trimmed = identifier.trim();
  if (trimmed.startsWith("`") && trimmed.endsWith("`") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replaceAll("``", "`");
  }
  return trimmed;
}

/** A grant's database part as SQL LIKE pattern (MySQL and MariaDB accept `%`, `_` and `\_` there). */
function databaseMatches(pattern: string, database: string): boolean {
  if (pattern === "*") return true;
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "\\" && index + 1 < pattern.length) {
      expression += pattern[index + 1]!.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      index += 1;
    } else if (character === "%") {
      expression += ".*";
    } else if (character === "_") {
      expression += ".";
    } else {
      expression += character.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    }
  }
  return new RegExp(`${expression}$`, "u").test(database);
}

function splitPrivileges(list: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of list) {
    if (character === "(") depth += 1;
    if (character === ")") depth = Math.max(0, depth - 1);
    if (character === "," && depth === 0) {
      result.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  result.push(current);
  // A column list ("SELECT (a, b)") limits a privilege; it does not change its kind.
  return result.map((item) => item.replace(/\(.*\)/su, "").trim().toUpperCase().replace(/\s+/gu, " "))
    .filter((item) => item.length > 0);
}

/**
 * Classifies the lines of SHOW GRANTS for one database. Deny by default: anything other than plain row
 * access (an unknown privilege, a role, GRANT OPTION, a global grant) counts as possibly schema-changing.
 */
export function classifyGrants(lines: readonly string[], database: string): DatabaseAccountReport {
  const extra = new Set<string>();
  const data = new Set<string>();
  for (const raw of lines) {
    const line = raw.trim();
    const grant = /^GRANT\s+(.+?)\s+ON\s+(?:(?:TABLE|FUNCTION|PROCEDURE)\s+)?(\S+)\s+TO\s+/isu.exec(line);
    if (grant === null) {
      if (/^GRANT\s+/iu.test(line)) extra.add("ROLE");
      continue;
    }
    const target = grant[2]!;
    const dot = /^(`(?:[^`]|``)*`|[^.]+)\.(.+)$/u.exec(target);
    const databasePart = dot === null ? target : unquote(dot[1]!);
    const tablePart = dot === null ? "*" : unquote(dot[2]!);
    if (grant[1]!.toUpperCase() === "PROXY") { extra.add("PROXY"); continue; }
    if (!databaseMatches(databasePart, database)) continue;
    if (/\bWITH\s+(?:.*\s)?GRANT\s+OPTION\b/isu.test(line)) extra.add("GRANT OPTION");
    for (const privilege of splitPrivileges(grant[1]!)) {
      const normal = privilege === "ALL" ? "ALL PRIVILEGES" : privilege;
      if (!RUNTIME_ACCOUNT_PRIVILEGES.has(normal)) {
        extra.add(normal);
      } else if (tablePart === "*" && normal !== "USAGE") {
        data.add(normal);
      }
    }
  }
  const extraPrivileges = [...extra].sort();
  return {
    dataAccess: DATA_PRIVILEGES.every((name) => data.has(name)) || extra.has("ALL PRIVILEGES"),
    canChangeSchema: extraPrivileges.length > 0,
    extraPrivileges,
  };
}

export async function inspectDatabaseAccount(
  connection: Pick<mysql.Connection, "query">,
  database: string,
): Promise<DatabaseAccountReport> {
  const [rows] = await connection.query<mysql.RowDataPacket[]>("SHOW GRANTS");
  // Each row has one column whose name contains the account; take its single value.
  const lines = rows.map((row) => String(Object.values(row)[0] ?? ""));
  return classifyGrants(lines, database);
}

async function main(): Promise<void> {
  const { environmentPath, commandArguments } = extractPrivateEnvironmentArgument(process.argv.slice(2));
  if (commandArguments.length !== 0) throw new Error("Unexpected arguments");
  const environment = loadHostedOperatorEnvironment(environmentPath);
  const config = loadHostedMysqlRuntimeConfig(environment);
  const connection = await mysql.createConnection({ host: config.host, port: config.port,
    user: config.user, password: config.password, database: config.database });
  try {
    const report = await inspectDatabaseAccount(connection, config.database);
    process.stdout.write(JSON.stringify({ user: config.user, database: config.database, ...report }) + "\n");
  } finally { await connection.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    process.stderr.write(`Database account check failed${code ? ` (${code})` : ""}: ${
      error instanceof Error ? error.message.replace(/'[^']*'@/gu, "account@") : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
