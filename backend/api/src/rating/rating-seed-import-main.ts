// Phase 8 CLI: import the restricted authoritative rating seed for mapped
// canonical Players. Reads MK8DX_HOSTED_MYSQL_* from the environment.
// Usage: rating:seed-import -- --seed <restricted-seed-json>
//        --mapping <restricted-mapping-json> [--report <new-report-path>]
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import mysql from "mysql2/promise";

import { loadHostedMysqlRuntimeConfig } from
  "../composition/hosted-runtime-config.js";
import { MysqlRatingSeedImportRepository } from "./mysql-rating-repository.js";
import {
  RatingSeedImportService,
  type RatingSeedImportReport,
} from "./rating-seed-import-service.js";

export function parseRatingSeedArguments(argv: readonly string[]): Readonly<{
  seedPath: string;
  mappingPath: string;
  reportPath: string | null;
}> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if ((flag !== "--seed" && flag !== "--mapping" && flag !== "--report") ||
      value === undefined || value.length === 0 || values.has(flag)) {
      throw new Error(
        "expected --seed <path> --mapping <path> [--report <new-path>]",
      );
    }
    values.set(flag, value);
  }
  const seedPath = values.get("--seed");
  const mappingPath = values.get("--mapping");
  if (seedPath === undefined || mappingPath === undefined) {
    throw new Error("--seed and --mapping are required");
  }
  return { seedPath, mappingPath, reportPath: values.get("--report") ?? null };
}

export async function runRatingSeedImport(
  environment: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
): Promise<RatingSeedImportReport> {
  const cli = parseRatingSeedArguments(argv);
  const seed = JSON.parse(await readFile(cli.seedPath, "utf8"));
  const mapping = JSON.parse(await readFile(cli.mappingPath, "utf8"));
  if (!Array.isArray(mapping)) {
    throw new Error("the mapping file must contain one JSON array");
  }
  const pool = mysql.createPool({
    ...loadHostedMysqlRuntimeConfig(environment),
    multipleStatements: false,
    namedPlaceholders: false,
  });
  try {
    const service = new RatingSeedImportService(
      new MysqlRatingSeedImportRepository(pool),
      { nowMs: () => Date.now() },
    );
    const report = await service.importSeed(seed, mapping);
    if (cli.reportPath !== null) {
      await writeFile(
        cli.reportPath,
        `${JSON.stringify(report, null, 2)}\n`,
        { encoding: "utf8", flag: "wx" },
      );
    }
    return report;
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined &&
    import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  runRatingSeedImport(process.env, process.argv.slice(2)).then((report) => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`rating seed import failed: ${
      error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
