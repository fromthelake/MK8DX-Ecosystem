import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  Schema9AssetCatalog,
  Schema9AssetCatalogError,
  TimeTrialSchema9AssetCatalogAdapter,
  TournamentSchema9AssetCatalogAdapter,
} from "../src/assets/schema9-asset-catalog.js";
import {
  type TimeTrialSubmissionV1,
} from "../src/timetrials/submission-service.js";
import {
  tournamentAssetReferences,
  validateTournamentRaceResult,
  type TournamentRaceResultV1,
} from "../src/tournaments/race-result-validation.js";

const sourceDatabaseSha256 =
  "2375050f7a332c5bbe89a9109356e07759cc7432f5f804ba004d298c479950c0";
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(`${repoRoot}${relativePath}`, "utf8"));
}

function syntheticSnapshot(): unknown {
  return {
    snapshotVersion: "mk8dx.schema9-asset-catalog-snapshot.v1",
    schemaVersion: 9,
    sourceDatabaseSha256: "a".repeat(64),
    assets: [
      { id: "track.synthetic", assetType: "track" },
      { id: "character.synthetic", assetType: "character" },
      { id: "character.other", assetType: "character" },
      {
        id: "character_variant.synthetic.001_blue",
        assetType: "character_variant",
        parentId: "character.synthetic",
      },
      { id: "body.synthetic", assetType: "body" },
      {
        id: "body_variant.synthetic.001_blue",
        assetType: "body_variant",
        parentId: "body.synthetic",
      },
      { id: "tire.synthetic", assetType: "tire" },
      { id: "glider.synthetic", assetType: "glider" },
      {
        id: "glider_variant.synthetic.001_blue",
        assetType: "glider_variant",
        parentId: "glider.synthetic",
      },
      { id: "country.xy", assetType: "country" },
    ],
  };
}

describe("TypeScript schema-9 asset catalog", () => {
  it("loads the committed minimal snapshot pinned to the canonical database", () => {
    const snapshot = readJson("packages/assets/schema9-asset-catalog-v1.json");
    const catalog = new Schema9AssetCatalog(snapshot, sourceDatabaseSha256);
    expect(catalog.size).toBe(781);
  });

  it("names the base part of a colour variant, and nothing for another part type (ADR-0212)", () => {
    const catalog = new Schema9AssetCatalog(readJson("packages/assets/schema9-asset-catalog-v1.json"), sourceDatabaseSha256);
    expect(catalog.basePart("character_variant.birdo.009_black", "character")).toBe("character.birdo");
    expect(catalog.basePart("character.birdo", "character")).toBe("character.birdo");
    expect(catalog.basePart("character.birdo", "body")).toBeNull();
    expect(catalog.basePart("character.nobody", "character")).toBeNull();
  });

  it("resolves every canonical Time Trial and Tournament example", async () => {
    const catalog = new Schema9AssetCatalog(
      readJson("packages/assets/schema9-asset-catalog-v1.json"),
      sourceDatabaseSha256,
    );
    const timeTrialAdapter = new TimeTrialSchema9AssetCatalogAdapter(catalog);
    const tournamentAdapter = new TournamentSchema9AssetCatalogAdapter(catalog);
    for (const name of [
      "timetrial-manual.example.json",
      "timetrial-android-scan.example.json",
      "timetrial-livetrial.example.json",
    ]) {
      const result = readJson(`packages/domain/examples/${name}`) as TimeTrialSubmissionV1;
      await expect(timeTrialAdapter.validateReferences({
        trackId: result.trackId,
        ...(result.loadout === undefined ? {} : { loadout: result.loadout }),
        ...(result.countryId === undefined ? {} : { countryId: result.countryId }),
      })).resolves.toEqual([]);
    }
    for (const name of [
      "tournament-recorded-video.example.json",
      "tournament-live-capture.example.json",
      "tournament-workbook-import.example.json",
    ]) {
      const result = readJson(`packages/domain/examples/${name}`);
      validateTournamentRaceResult(result);
      await expect(tournamentAdapter.validateReferences(
        tournamentAssetReferences(result as TournamentRaceResultV1),
      )).resolves.toEqual([]);
    }
  });

  it("returns structured unknown, type, and parent issues without coercion", () => {
    const catalog = new Schema9AssetCatalog(syntheticSnapshot(), "a".repeat(64));
    expect(catalog.validateTimeTrial({
      trackId: "body.synthetic",
      countryId: "country.missing",
      loadout: {
        characterId: "character.other",
        characterVariantId: "character_variant.synthetic.001_blue",
      },
    })).toEqual([
      {
        code: "TYPE_MISMATCH",
        path: "/trackId",
        assetId: "body.synthetic",
        expectedType: "track",
        actualType: "body",
        expectedParentId: null,
        actualParentId: null,
      },
      {
        code: "UNKNOWN_ASSET_ID",
        path: "/countryId",
        assetId: "country.missing",
        expectedType: "country",
        actualType: null,
        expectedParentId: null,
        actualParentId: null,
      },
      {
        code: "VARIANT_PARENT_MISMATCH",
        path: "/loadout/characterVariantId",
        assetId: "character_variant.synthetic.001_blue",
        expectedType: "character_variant",
        actualType: "character_variant",
        expectedParentId: "character.other",
        actualParentId: "character.synthetic",
      },
    ]);
  });

  it("rejects hash mismatch, duplicate IDs, and missing variant parents", () => {
    expect(() => new Schema9AssetCatalog(syntheticSnapshot(), "b".repeat(64)))
      .toThrow("snapshot metadata is invalid");

    const duplicate: any = structuredClone(syntheticSnapshot());
    duplicate.assets.push({ id: "track.synthetic", assetType: "track" });
    expect(() => new Schema9AssetCatalog(duplicate, "a".repeat(64)))
      .toThrow("invalid or duplicate");

    const orphan: any = structuredClone(syntheticSnapshot());
    orphan.assets.find((item: any) => item.assetType === "character_variant").parentId =
      "character.missing";
    expect(() => new Schema9AssetCatalog(orphan, "a".repeat(64)))
      .toThrow("parent is missing or mistyped");
  });

  it("rejects malformed snapshots without exposing source filesystem paths", () => {
    expect(() => new Schema9AssetCatalog({}, "a".repeat(64))).toThrow(
      Schema9AssetCatalogError,
    );
    expect(() => new Schema9AssetCatalog(syntheticSnapshot(), "not-a-hash")).toThrow(
      "expected source database hash is invalid",
    );
  });
});
