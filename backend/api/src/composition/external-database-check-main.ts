import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";
import { extractPrivateEnvironmentArgument, loadHostedOperatorEnvironment } from "./hosted-operator-environment.js";
import { loadHostedMysqlRuntimeConfig } from "./hosted-runtime-config.js";

export function supportedDatabase(version: string): "MariaDB" | "MySQL" {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) throw new Error("Database version could not be determined");
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (version.toLowerCase().includes("mariadb")) {
    if (major > 11 || major === 11 && minor >= 4) return "MariaDB";
    throw new Error("MariaDB 11.4 or newer is required for this installation route");
  }
  if (major > 8 || major === 8 && minor >= 4) return "MySQL";
  throw new Error("MySQL 8.4 or newer is required for this installation route");
}

async function main(): Promise<void> {
  const { environmentPath, commandArguments } = extractPrivateEnvironmentArgument(process.argv.slice(2));
  if (commandArguments.length !== 0) throw new Error("Unexpected arguments");
  const environment = loadHostedOperatorEnvironment(environmentPath);
  const config = loadHostedMysqlRuntimeConfig(environment);
  if (config.user.toLowerCase() === "root") throw new Error("A limited application database user is required");
  const connection = await mysql.createConnection({ host: config.host, port: config.port,
    user: config.user, password: config.password, database: config.database });
  try {
    const [rows] = await connection.query<mysql.RowDataPacket[]>("SELECT VERSION() AS version, DATABASE() AS databaseName");
    const version = String(rows[0]?.["version"] ?? "");
    const engine = supportedDatabase(version);
    const [tables] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE()");
    process.stdout.write(JSON.stringify({ engine, version, database: rows[0]?.["databaseName"],
      tableCount: Number(tables[0]?.["count"] ?? 0) }) + "\n");
  } finally { await connection.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    process.stderr.write(`Database check failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
