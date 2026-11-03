// Operator CLI for the tournament rating lifecycle (ADR-0155).
// Usage (reads MK8DX_HOSTED_MYSQL_* from the environment):
//   rating:lifecycle -- apply --publication <tournament_publication.id>
//   rating:lifecycle -- decide --publication <id> (--include | --exclude)
//       --reason <code> --administrator-account <user_account.id>
//   rating:lifecycle -- recalculate --reason <code>
//       --administrator-account <user_account.id> --confirm-recalculation
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import mysql from "mysql2/promise";

import { loadHostedMysqlRuntimeConfig } from
  "../composition/hosted-runtime-config.js";
import { MysqlRatingLifecycleRepository } from
  "./mysql-rating-lifecycle-repository.js";
import { RatingLifecycleService } from "./rating-lifecycle-service.js";
import { createHistoryReplay } from "./rating-history-replay.js";

function parseFlags(argv: readonly string[]): Map<string, string | true> {
  const flags = new Map<string, string | true>();
  let index = 0;
  while (index < argv.length) {
    const flag = argv[index]!;
    if (!flag.startsWith("--") || flags.has(flag)) {
      throw new Error(`unexpected or duplicate argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      flags.set(flag, true);
      index += 1;
    } else {
      flags.set(flag, value);
      index += 2;
    }
  }
  return flags;
}

function requiredText(flags: Map<string, string | true>, flag: string): string {
  const value = flags.get(flag);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${flag} <value> is required`);
  }
  return value;
}

export async function runRatingLifecycleCli(
  environment: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
): Promise<unknown> {
  const command = argv[0];
  const flags = parseFlags(argv.slice(1));
  const pool = mysql.createPool({
    ...loadHostedMysqlRuntimeConfig(environment),
    multipleStatements: false,
    namedPlaceholders: false,
  });
  try {
    const service = new RatingLifecycleService(
      new MysqlRatingLifecycleRepository(pool),
      { nowMs: () => Date.now() },
    );
    // The CLI recalculates the way the product does (ADR-0155 addendum).
    service.useHistoryReplay(createHistoryReplay(pool, service));
    if (command === "apply") {
      return await service.applyPublication(
        requiredText(flags, "--publication"),
      );
    }
    if (command === "decide") {
      const include = flags.get("--include") === true;
      const exclude = flags.get("--exclude") === true;
      if (include === exclude) {
        throw new Error("exactly one of --include or --exclude is required");
      }
      return await service.recordDecision({
        administratorAccountId: requiredText(flags, "--administrator-account"),
        publicationPublicId: requiredText(flags, "--publication"),
        ratingIncluded: include,
        reasonCode: requiredText(flags, "--reason"),
      });
    }
    if (command === "recalculate") {
      if (flags.get("--confirm-recalculation") !== true) {
        throw new Error(
          "recalculation rebuilds the complete current rating epoch; " +
          "pass --confirm-recalculation to proceed",
        );
      }
      return await service.recalculate({
        administratorAccountId: requiredText(flags, "--administrator-account"),
        reasonCode: requiredText(flags, "--reason"),
      });
    }
    throw new Error("expected command: apply | decide | recalculate");
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined &&
    import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  runRatingLifecycleCli(process.env, process.argv.slice(2)).then((report) => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`rating lifecycle command failed: ${
      error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
