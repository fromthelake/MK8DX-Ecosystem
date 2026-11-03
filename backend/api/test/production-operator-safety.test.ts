import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  extractPrivateEnvironmentArgument,
  loadHostedOperatorEnvironment,
  type HostedOperatorEnvironmentIo,
} from "../src/composition/hosted-operator-environment.js";
import {
  runProductionDatabaseBackup,
  type DatabaseDumpInvocation,
} from "../src/composition/production-database-backup-main.js";

const privateEnvironment = {
  MK8DX_HOSTED_MYSQL_HOST: "localhost",
  MK8DX_HOSTED_MYSQL_PORT: "3306",
  MK8DX_HOSTED_MYSQL_USER: "synthetic_user",
  MK8DX_HOSTED_MYSQL_PASSWORD: "private-password-never-print",
  MK8DX_HOSTED_MYSQL_DATABASE: "synthetic_production",
};

describe("production operator safety", () => {
  it("loads only an absolute owner-only hosted JSON file", () => {
    const io: HostedOperatorEnvironmentIo = {
      inspect: () => ({ isFile: true, mode: 0o100600 }),
      readFile: () => JSON.stringify(privateEnvironment),
      platform: "linux",
    };
    expect(loadHostedOperatorEnvironment("/private/config.json", io))
      .toEqual(privateEnvironment);
    expect(() => loadHostedOperatorEnvironment("relative.json", io))
      .toThrow(/absolute/);
    expect(() => loadHostedOperatorEnvironment("/private/config.json", {
      ...io,
      inspect: () => ({ isFile: true, mode: 0o100640 }),
    })).toThrow(/owner-only/);
    expect(() => loadHostedOperatorEnvironment("/private/config.json", {
      ...io,
      readFile: () => JSON.stringify({ PATH: "private-password-never-print" }),
    })).toThrow(/hosted string settings/);
  });

  it("requires the protected file as a structural CLI argument", () => {
    expect(extractPrivateEnvironmentArgument([
      "--private-environment-file", "/private/config.json", "--output", "/backup.sql",
    ])).toEqual({
      environmentPath: "/private/config.json",
      commandArguments: ["--output", "/backup.sql"],
    });
    expect(() => extractPrivateEnvironmentArgument(["--output", "/backup.sql"]))
      .toThrow(/private-environment-file/);
  });

  it("keeps the password out of the dump argument vector and error text", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mk8dx-backup-safety-"));
    const outputPath = resolve(directory, "backup.sql");
    let invocation: DatabaseDumpInvocation | undefined;
    const runner = vi.fn(async (candidate: DatabaseDumpInvocation) => {
      invocation = candidate;
      writeFileSync(outputPath, "CREATE TABLE synthetic (id BIGINT);\n", { mode: 0o600 });
      return 0;
    });
    const result = await runProductionDatabaseBackup(
      privateEnvironment,
      ["--output", outputPath, "--dump-executable", resolve(directory, "mysqldump")],
      runner,
    );
    expect(invocation?.arguments.join(" ")).not.toContain(privateEnvironment.MK8DX_HOSTED_MYSQL_PASSWORD);
    expect(invocation?.password).toBe(privateEnvironment.MK8DX_HOSTED_MYSQL_PASSWORD);
    expect(result).toMatchObject({ bytes: 36, createTableCount: 1 });
    expect(readFileSync(`${outputPath}.sha256`, "utf8")).not.toContain(
      privateEnvironment.MK8DX_HOSTED_MYSQL_PASSWORD,
    );

    await expect(runProductionDatabaseBackup(
      privateEnvironment,
      ["--output", resolve(directory, "failed.sql"), "--dump-executable", resolve(directory, "dump")],
      async () => -1,
    )).rejects.not.toThrow(privateEnvironment.MK8DX_HOSTED_MYSQL_PASSWORD);
  });

  it("contains no shell environment-dump mechanism in production operator entry points", () => {
    const sourceRoot = resolve(import.meta.dirname, "../src/composition");
    for (const file of [
      "production-database-backup-main.ts",
      "migration-apply-main.ts",
      "hosted-preflight-main.ts",
      "protected-value-rotation-main.ts",
      "authentication-lookup-rotation-status-main.ts",
    ]) {
      const source = readFileSync(join(sourceRoot, file), "utf8");
      expect(source).not.toMatch(/\b(?:printenv|set -x|env\s|eval\s|bash -c)\b/u);
      expect(source).not.toContain("run-with-env");
    }
  });
});
