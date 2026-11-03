import type {
  TimeTrialAssetCatalog,
  TimeTrialAssetReferences,
} from "../timetrials/submission-service.js";
import type { TournamentAssetCatalog } from "../tournaments/race-result-service.js";
import type { TournamentAssetReferences } from
  "../tournaments/race-result-validation.js";
import type { WebManualTrackCatalog } from
  "../timetrials/web-manual-session-service.js";

export type Schema9AssetType =
  | "track"
  | "character"
  | "character_variant"
  | "body"
  | "body_variant"
  | "tire"
  | "glider"
  | "glider_variant"
  | "country";

export type Schema9AssetValidationIssue = Readonly<{
  code: "UNKNOWN_ASSET_ID" | "TYPE_MISMATCH" | "VARIANT_PARENT_MISMATCH";
  path: string;
  assetId: string;
  expectedType: Schema9AssetType;
  actualType: Schema9AssetType | null;
  expectedParentId: string | null;
  actualParentId: string | null;
}>;

type AssetRecord = Readonly<{
  id: string;
  assetType: Schema9AssetType;
  parentId: string | null;
}>;

const assetTypes = new Set<Schema9AssetType>([
  "track", "character", "character_variant", "body", "body_variant", "tire",
  "glider", "glider_variant", "country",
]);
const parentTypes = new Map<Schema9AssetType, Schema9AssetType>([
  ["character_variant", "character"],
  ["body_variant", "body"],
  ["glider_variant", "glider"],
]);
const idPatterns: Readonly<Record<Schema9AssetType, RegExp>> = {
  track: /^track\.[a-z0-9]+(?:_[a-z0-9]+)*$/,
  character: /^character\.[a-z0-9]+(?:_[a-z0-9]+)*$/,
  character_variant:
    /^character_variant\.[a-z0-9]+(?:_[a-z0-9]+)*\.[0-9]{3}_[a-z0-9]+(?:_[a-z0-9]+)*$/,
  body: /^body\.[a-z0-9]+(?:_[a-z0-9]+)*$/,
  body_variant:
    /^body_variant\.[a-z0-9]+(?:_[a-z0-9]+)*\.[0-9]{3}_[a-z0-9]+(?:_[a-z0-9]+)*$/,
  tire: /^tire\.[a-z0-9]+(?:_[a-z0-9]+)*$/,
  glider: /^glider\.[a-z0-9]+(?:_[a-z0-9]+)*$/,
  glider_variant:
    /^glider_variant\.[a-z0-9]+(?:_[a-z0-9]+)*\.[0-9]{3}_[a-z0-9]+(?:_[a-z0-9]+)*$/,
  country: /^country\.[a-z]{2}$/,
};
const sha256Pattern = /^[a-f0-9]{64}$/;

export class Schema9AssetCatalogError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "Schema9AssetCatalogError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

export class Schema9AssetCatalog {
  private readonly assets = new Map<string, AssetRecord>();

  public constructor(snapshot: unknown, expectedSourceDatabaseSha256: string) {
    if (!sha256Pattern.test(expectedSourceDatabaseSha256)) {
      throw new Schema9AssetCatalogError("expected source database hash is invalid");
    }
    if (!isObject(snapshot) || !exactKeys(snapshot, [
      "snapshotVersion", "schemaVersion", "sourceDatabaseSha256", "assets",
    ]) || snapshot.snapshotVersion !== "mk8dx.schema9-asset-catalog-snapshot.v1" ||
      snapshot.schemaVersion !== 9 ||
      snapshot.sourceDatabaseSha256 !== expectedSourceDatabaseSha256 ||
      !Array.isArray(snapshot.assets)) {
      throw new Schema9AssetCatalogError("schema-9 catalog snapshot metadata is invalid");
    }
    for (const candidate of snapshot.assets) {
      if (!isObject(candidate) || !exactKeys(
        candidate,
        ["id", "assetType"],
        ["parentId"],
      ) || typeof candidate.id !== "string" ||
        typeof candidate.assetType !== "string" ||
        !assetTypes.has(candidate.assetType as Schema9AssetType)) {
        throw new Schema9AssetCatalogError("schema-9 catalog asset record is invalid");
      }
      const assetType = candidate.assetType as Schema9AssetType;
      if (!idPatterns[assetType].test(candidate.id) || this.assets.has(candidate.id)) {
        throw new Schema9AssetCatalogError("schema-9 catalog asset ID is invalid or duplicate");
      }
      const expectedParentType = parentTypes.get(assetType);
      const parentId = candidate.parentId;
      if ((expectedParentType === undefined && parentId !== undefined) ||
        (expectedParentType !== undefined && typeof parentId !== "string")) {
        throw new Schema9AssetCatalogError("schema-9 variant parent shape is invalid");
      }
      this.assets.set(candidate.id, {
        id: candidate.id,
        assetType,
        parentId: typeof parentId === "string" ? parentId : null,
      });
    }
    for (const asset of this.assets.values()) {
      const expectedParentType = parentTypes.get(asset.assetType);
      if (expectedParentType === undefined) {
        continue;
      }
      const parent = asset.parentId === null ? undefined : this.assets.get(asset.parentId);
      if (parent === undefined || parent.assetType !== expectedParentType) {
        throw new Schema9AssetCatalogError("schema-9 variant parent is missing or mistyped");
      }
    }
  }

  public get size(): number { return this.assets.size; }

  public validate(
    path: string,
    assetId: string,
    expectedType: Schema9AssetType,
    expectedParentId: string | null = null,
  ): Schema9AssetValidationIssue | null {
    const asset = this.assets.get(assetId);
    if (asset === undefined) {
      return {
        code: "UNKNOWN_ASSET_ID",
        path,
        assetId,
        expectedType,
        actualType: null,
        expectedParentId,
        actualParentId: null,
      };
    }
    if (asset.assetType !== expectedType) {
      return {
        code: "TYPE_MISMATCH",
        path,
        assetId,
        expectedType,
        actualType: asset.assetType,
        expectedParentId,
        actualParentId: asset.parentId,
      };
    }
    if (expectedParentId !== null && asset.parentId !== expectedParentId) {
      return {
        code: "VARIANT_PARENT_MISMATCH",
        path,
        assetId,
        expectedType,
        actualType: asset.assetType,
        expectedParentId,
        actualParentId: asset.parentId,
      };
    }
    return null;
  }

  public hasCountry(countryId: string): boolean {
    const asset = this.assets.get(countryId);
    return asset !== undefined && asset.assetType === "country";
  }

  public hasCharacterAppearance(avatarId: string): boolean {
    const asset = this.assets.get(avatarId);
    return asset !== undefined &&
      (asset.assetType === "character" ||
       asset.assetType === "character_variant");
  }

  public hasBody(id: string): boolean {
    return this.assets.get(id)?.assetType === "body";
  }

  public hasTire(id: string): boolean {
    return this.assets.get(id)?.assetType === "tire";
  }

  public hasGlider(id: string): boolean {
    return this.assets.get(id)?.assetType === "glider";
  }

  /**
   * The base part an id names: the part itself, or the part a colour variant belongs to. Null when
   * the id is neither that part type nor one of its variants.
   */
  public basePart(id: string, type: "character" | "body" | "tire" | "glider"): string | null {
    const asset = this.assets.get(id);
    if (asset === undefined) { return null; }
    if (asset.assetType === type) { return asset.id; }
    return asset.assetType === `${type}_variant` && asset.parentId !== null &&
      this.assets.get(asset.parentId)?.assetType === type ? asset.parentId : null;
  }

  public validateTimeTrial(
    references: TimeTrialAssetReferences,
  ): readonly Schema9AssetValidationIssue[] {
    const issues: Schema9AssetValidationIssue[] = [];
    this.append(issues, this.validate("/trackId", references.trackId, "track"));
    if (references.countryId !== undefined) {
      this.append(issues, this.validate("/countryId", references.countryId, "country"));
    }
    const loadout = references.loadout;
    if (loadout === undefined) {
      return issues;
    }
    const fields = [
      ["characterId", "character"],
      ["bodyId", "body"],
      ["tireId", "tire"],
      ["gliderId", "glider"],
    ] as const;
    for (const [field, assetType] of fields) {
      const assetId = loadout[field];
      if (assetId !== undefined) {
        this.append(issues, this.validate(`/loadout/${field}`, assetId, assetType));
      }
    }
    const variants = [
      ["characterVariantId", "character_variant", loadout.characterId],
      ["bodyVariantId", "body_variant", loadout.bodyId],
      ["gliderVariantId", "glider_variant", loadout.gliderId],
    ] as const;
    for (const [field, assetType, parentId] of variants) {
      const assetId = loadout[field];
      if (assetId !== undefined) {
        this.append(
          issues,
          this.validate(`/loadout/${field}`, assetId, assetType, parentId ?? null),
        );
      }
    }
    return issues;
  }

  public validateTournament(
    references: TournamentAssetReferences,
  ): readonly Schema9AssetValidationIssue[] {
    const issues: Schema9AssetValidationIssue[] = [];
    this.append(issues, this.validate("/trackId", references.trackId, "track"));
    for (const [index, placement] of references.placements.entries()) {
      if (placement.characterId !== undefined) {
        this.append(issues, this.validate(
          `/placements/${index}/characterId`,
          placement.characterId,
          "character",
        ));
      }
      if (placement.characterVariantId !== undefined) {
        this.append(issues, this.validate(
          `/placements/${index}/characterVariantId`,
          placement.characterVariantId,
          "character_variant",
          placement.characterId ?? null,
        ));
      }
    }
    return issues;
  }

  private append(
    issues: Schema9AssetValidationIssue[],
    issue: Schema9AssetValidationIssue | null,
  ): void {
    if (issue !== null) {
      issues.push(issue);
    }
  }
}

export class TimeTrialSchema9AssetCatalogAdapter implements TimeTrialAssetCatalog {
  public constructor(private readonly catalog: Schema9AssetCatalog) {}
  public async validateReferences(
    references: TimeTrialAssetReferences,
  ): Promise<readonly Schema9AssetValidationIssue[]> {
    return this.catalog.validateTimeTrial(references);
  }
}

export class WebManualSchema9TrackCatalogAdapter
  implements WebManualTrackCatalog
{
  public constructor(private readonly catalog: Schema9AssetCatalog) {}
  public async containsTrack(trackId: string): Promise<boolean> {
    return this.catalog.validate("/trackId", trackId, "track") === null;
  }
}

export class TournamentSchema9AssetCatalogAdapter implements TournamentAssetCatalog {
  public constructor(private readonly catalog: Schema9AssetCatalog) {}
  public async validateReferences(
    references: TournamentAssetReferences,
  ): Promise<readonly Schema9AssetValidationIssue[]> {
    return this.catalog.validateTournament(references);
  }
}
