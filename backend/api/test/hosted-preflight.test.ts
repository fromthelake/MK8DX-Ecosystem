import { describe, expect, it } from "vitest";

import {
  HostedPreflightCliError,
  parseHostedPreflightArguments,
  runHostedDeploymentPreflight,
  verifyMigrationLedger,
} from "../src/composition/hosted-preflight-main.js";

const catalogDocument = {
  migrations: [
    { version: "0000", upSha256: "a".repeat(64) },
    { version: "0001", upSha256: "b".repeat(64) },
    { version: "0002", upSha256: "c".repeat(64) },
  ],
};

function ledger(
  overrides: Partial<Record<string, string>> = {},
  extra: readonly { migrationVersion: string; upSha256: string }[] = [],
) {
  return [
    ...catalogDocument.migrations.map((entry) => ({
      migrationVersion: entry.version,
      upSha256: overrides[entry.version] ?? entry.upSha256,
    })),
    ...extra,
  ];
}

describe("hosted deployment preflight", () => {
  it("requires the explicit migration catalog path", () => {
    expect(parseHostedPreflightArguments([
      "--migration-catalog", "infrastructure/mysql/migration-catalog-v1.json",
    ])).toBe("infrastructure/mysql/migration-catalog-v1.json");
    expect(() => parseHostedPreflightArguments([])).toThrow(
      HostedPreflightCliError,
    );
    expect(() => parseHostedPreflightArguments(["--catalog", "x"])).toThrow(
      HostedPreflightCliError,
    );
  });

  it("accepts only an exactly applied hash-pinned ledger", () => {
    expect(verifyMigrationLedger(catalogDocument, ledger())).toEqual({
      ok: true,
      detail: "all 3 cataloged migrations are applied with exact hashes",
    });

    const missing = verifyMigrationLedger(
      catalogDocument,
      ledger().slice(0, 2),
    );
    expect(missing.ok).toBe(false);
    expect(missing.detail).toContain("not applied: 0002");

    const unknown = verifyMigrationLedger(catalogDocument, ledger({}, [
      { migrationVersion: "0099", upSha256: "d".repeat(64) },
    ]));
    expect(unknown.ok).toBe(false);
    expect(unknown.detail).toContain("uncataloged migrations: 0099");

    const drift = verifyMigrationLedger(
      catalogDocument,
      ledger({ "0001": "e".repeat(64) }),
    );
    expect(drift.ok).toBe(false);
    expect(drift.detail).toContain("differ from the catalog: 0001");

    const duplicate = verifyMigrationLedger(catalogDocument, [
      ...ledger(),
      { migrationVersion: "0000", upSha256: "a".repeat(64) },
    ]);
    expect(duplicate.ok).toBe(false);
    expect(duplicate.detail).toContain("duplicate");

    expect(verifyMigrationLedger({ wrong: true }, ledger()).ok).toBe(false);
  });

  it("fails closed on incomplete configuration without echoing values", async () => {
    const report = await runHostedDeploymentPreflight(
      { MK8DX_HOSTED_MYSQL_PASSWORD: "super-secret-value" },
      ["--migration-catalog", "does-not-matter.json"],
    );
    expect(report.status).toBe("not_ready");
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]?.check).toBe("configuration");
    expect(report.checks[0]?.status).toBe("failed");
    expect(JSON.stringify(report)).not.toContain("super-secret-value");
  });
});
