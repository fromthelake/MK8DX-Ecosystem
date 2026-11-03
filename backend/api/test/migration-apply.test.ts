import { describe, expect, it } from "vitest";

import {
  MigrationApplyError,
  parseCatalog,
  parseMigrationApplyArguments,
  planPendingMigrations,
} from "../src/composition/migration-apply-main.js";

const catalogDocument = {
  migrations: [
    { version: "0000", name: "ledger", upPath: "migrations/0000.up.sql", upSha256: "a".repeat(64) },
    { version: "0001", name: "one", upPath: "migrations/0001.up.sql", upSha256: "b".repeat(64) },
    { version: "0002", name: "two", upPath: "migrations/0002.up.sql", upSha256: "c".repeat(64) },
  ],
};

describe("production migration apply", () => {
  it("requires exact catalog, database confirmation, and backup attestation", () => {
    expect(parseMigrationApplyArguments([
      "--migration-catalog", "mysql/migration-catalog-v1.json",
      "--confirm-database", "vfuser_mk8dx",
      "--backup-verified",
    ])).toEqual({
      catalogPath: "mysql/migration-catalog-v1.json",
      confirmDatabase: "vfuser_mk8dx",
    });
    for (const bad of [
      [],
      ["--migration-catalog", "x", "--confirm-database", "y"],
      ["--migration-catalog", "x", "--backup-verified"],
      ["--confirm-database", "y", "--backup-verified"],
      ["--migration-catalog", "x", "--confirm-database", "y", "--force"],
    ]) {
      expect(() => parseMigrationApplyArguments(bad as string[])).toThrow(
        MigrationApplyError,
      );
    }
  });

  it("parses only strictly ascending hash-pinned catalogs", () => {
    const catalog = parseCatalog(catalogDocument);
    expect(catalog.map((entry) => entry.version)).toEqual([
      "0000", "0001", "0002",
    ]);
    expect(() => parseCatalog({ migrations: [] })).toThrow(/empty/);
    expect(() => parseCatalog({
      migrations: [
        catalogDocument.migrations[1],
        catalogDocument.migrations[0],
      ],
    })).toThrow(/ascending/);
    expect(() => parseCatalog({
      migrations: [{ version: "0000", name: "x", upPath: "p", upSha256: "zz" }],
    })).toThrow(/entry is invalid/);
  });

  it("plans pending migrations only from an exact applied prefix", () => {
    const catalog = parseCatalog(catalogDocument);
    expect(planPendingMigrations(catalog, []).map((entry) => entry.version))
      .toEqual(["0000", "0001", "0002"]);
    expect(planPendingMigrations(catalog, [
      { migrationVersion: "0000", upSha256: "a".repeat(64) },
      { migrationVersion: "0001", upSha256: "b".repeat(64) },
    ]).map((entry) => entry.version)).toEqual(["0002"]);
    expect(planPendingMigrations(catalog, [
      { migrationVersion: "0000", upSha256: "a".repeat(64) },
      { migrationVersion: "0001", upSha256: "b".repeat(64) },
      { migrationVersion: "0002", upSha256: "c".repeat(64) },
    ])).toEqual([]);

    expect(() => planPendingMigrations(catalog, [
      { migrationVersion: "0001", upSha256: "b".repeat(64) },
    ])).toThrow(/not the catalog prefix/);
    expect(() => planPendingMigrations(catalog, [
      { migrationVersion: "0000", upSha256: "d".repeat(64) },
    ])).toThrow(/hash differs/);
    expect(() => planPendingMigrations(catalog, [
      { migrationVersion: "0000", upSha256: "a".repeat(64) },
      { migrationVersion: "0001", upSha256: "b".repeat(64) },
      { migrationVersion: "0002", upSha256: "c".repeat(64) },
      { migrationVersion: "0003", upSha256: "e".repeat(64) },
    ])).toThrow(/more migrations than the catalog/);
  });
});
