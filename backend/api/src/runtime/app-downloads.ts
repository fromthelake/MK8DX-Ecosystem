import { createReadStream } from "node:fs";
import type { Readable } from "node:stream";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

// Owner-private application downloads.
//
// The Android APK and the LiveTrial Windows package are not public
// artifacts: the scanner payload and the game-derived assets inside them
// have unresolved public redistribution rights (ADR-0131), and the owner
// distributes them to a known community rather than through a store. They
// therefore live outside the document root and are served only to a signed
// in account, from a closed manifest — never by a path taken from a
// request.

// The product languages a guide may be written in. English is the manifest's
// reference text; the others are optional translations beside it.
export type AppDownloadLanguage = "en" | "nl";
export const APP_DOWNLOAD_LANGUAGES: readonly AppDownloadLanguage[] = ["en", "nl"];
type TranslatedLanguage = Exclude<AppDownloadLanguage, "en">;

// The three owner-written lists a visitor reads under a download.
export type AppDownloadGuide = Readonly<{
  requirements: readonly string[];
  installSteps: readonly string[];
  updateSteps: readonly string[];
}>;

export type AppDownloadEntry = Readonly<{
  id: string;
  platform: "android" | "windows";
  title: string;
  version: string;
  releasedOn: string;
  fileName: string;
  bytes: number;
  sha256: string;
  requirements: readonly string[];
  installSteps: readonly string[];
  updateSteps: readonly string[];
  // The same guides in another product language, written by the owner in
  // the manifest as `"translations": { "nl": { "installSteps": [...] } }`.
  // Every list is optional and falls back to the English one, so a partly
  // translated entry still reads whole. The catalog is served in one
  // language at a time (see `catalog`), never with every translation at
  // once: LiveTrial reads it under a 16 KiB bound and the native clients
  // only look at the version.
  translations?: Readonly<Partial<Record<TranslatedLanguage, Partial<AppDownloadGuide>>>>;
  // Which builds of this artifact may still be used. Absent means "every
  // build"; that is the state every entry is in until an owner deliberately
  // turns a build off. See `client-support-routes.ts` for what the clients do
  // with it.
  minimumSupportedBuild?: number;
  retiredBuilds?: readonly number[];
  supportMessage?: string;
  // LiveTrial's floor (owner 2026-09-28): Windows releases carry a plain
  // dotted version and no build number. An older LiveTrial that reads it shows
  // a prominent "update to send again" and keeps every run on the PC; the
  // server itself never refuses a submission because of it.
  minimumSupportedVersion?: string;
}>;

export type AppDownloadCatalog = Readonly<{
  schemaVersion: "mk8dx.app-downloads.v1";
  entries: readonly AppDownloadEntry[];
}>;

export function isAppDownloadLanguage(value: unknown): value is AppDownloadLanguage {
  return typeof value === "string" &&
    (APP_DOWNLOAD_LANGUAGES as readonly string[]).includes(value);
}

function isTranslatedLanguage(value: unknown): value is TranslatedLanguage {
  return isAppDownloadLanguage(value) && value !== "en";
}

export class AppDownloadConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AppDownloadConfigurationError";
  }
}

const idPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const releaseBuildPattern = /-build([1-9][0-9]*)$/;

/** The build number inside a release version such as `2.44.0-build73`. */
export function releaseBuildNumber(version: string): number | null {
  const matched = releaseBuildPattern.exec(version);
  if (matched === null) { return null; }
  const build = Number(matched[1]);
  return Number.isSafeInteger(build) && build >= 1 ? build : null;
}
const versionPattern = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/;
const fileNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const releasedOnPattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const MAXIMUM_MANIFEST_BYTES = 64 * 1024;
const MAXIMUM_ENTRIES = 20;

function stringList(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 20) {
    throw new AppDownloadConfigurationError(`${field} is invalid`);
  }
  return value.map((item) => {
    if (typeof item !== "string" || item.length === 0 || item.length > 300) {
      throw new AppDownloadConfigurationError(`${field} is invalid`);
    }
    return item;
  });
}

const GUIDE_KEYS = ["requirements", "installSteps", "updateSteps"] as const;

function translations(value: unknown): AppDownloadEntry["translations"] {
  if (value === undefined || value === null) { return undefined; }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new AppDownloadConfigurationError("translations is invalid");
  }
  const result: Partial<Record<TranslatedLanguage, Partial<AppDownloadGuide>>> = {};
  for (const [language, guide] of Object.entries(value)) {
    if (!isTranslatedLanguage(language)) {
      throw new AppDownloadConfigurationError(
        `translations.${language} is not a translated product language`,
      );
    }
    if (typeof guide !== "object" || guide === null || Array.isArray(guide)) {
      throw new AppDownloadConfigurationError(`translations.${language} is invalid`);
    }
    const row = guide as Record<string, unknown>;
    for (const key of Object.keys(row)) {
      if (!(GUIDE_KEYS as readonly string[]).includes(key)) {
        throw new AppDownloadConfigurationError(
          `translations.${language}.${key} is not a guide`,
        );
      }
    }
    const translated: { -readonly [K in keyof AppDownloadGuide]?: readonly string[] } = {};
    for (const key of GUIDE_KEYS) {
      if (row[key] !== undefined && row[key] !== null) {
        translated[key] = stringList(row[key], `translations.${language}.${key}`);
      }
    }
    result[language] = translated;
  }
  return result;
}

// The entry as one product language reads it: the translated lists where
// the owner wrote them, the English ones elsewhere, and no `translations`.
function localizedEntry(
  row: AppDownloadEntry,
  language: AppDownloadLanguage,
): AppDownloadEntry {
  const { translations: guides, ...base } = row;
  if (language === "en" || guides === undefined) { return base; }
  const guide = guides[language];
  if (guide === undefined) { return base; }
  return {
    ...base,
    requirements: guide.requirements ?? base.requirements,
    installSteps: guide.installSteps ?? base.installSteps,
    updateSteps: guide.updateSteps ?? base.updateSteps,
  };
}

const dottedVersionPattern = /^[0-9]{1,4}(?:\.[0-9]{1,4}){1,3}$/;

/** Compare two dotted versions ("3.24.1" < "3.25"), missing parts as 0. */
export function compareDottedVersions(left: string, right: string): number {
  const a = left.split(".").map(Number), b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) { return difference; }
  }
  return 0;
}

/** An optional whole build number the owner may write in the manifest. */
function optionalBuild(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) { return undefined; }
  if (typeof value !== "number" || !Number.isSafeInteger(value) ||
    value < 1 || value > 1_000_000) {
    throw new AppDownloadConfigurationError(`${field} is invalid`);
  }
  return value;
}

function optionalBuildList(value: unknown, field: string): readonly number[] | undefined {
  if (value === undefined || value === null) { return undefined; }
  if (!Array.isArray(value) || value.length > 200) {
    throw new AppDownloadConfigurationError(`${field} is invalid`);
  }
  const builds = value.map((item) => {
    const build = optionalBuild(item, field);
    if (build === undefined) {
      throw new AppDownloadConfigurationError(`${field} is invalid`);
    }
    return build;
  });
  if (new Set(builds).size !== builds.length) {
    throw new AppDownloadConfigurationError(`${field} is invalid`);
  }
  return builds;
}

function entry(value: unknown): AppDownloadEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AppDownloadConfigurationError("download entry is invalid");
  }
  const row = value as Record<string, unknown>;
  const id = row["id"];
  const platform = row["platform"];
  const title = row["title"];
  const version = row["version"];
  const releasedOn = row["releasedOn"];
  const fileName = row["fileName"];
  const bytes = row["bytes"];
  const sha256 = row["sha256"];
  if (typeof id !== "string" || !idPattern.test(id) ||
    (platform !== "android" && platform !== "windows") ||
    typeof title !== "string" || title.length === 0 || title.length > 96 ||
    typeof version !== "string" || !versionPattern.test(version) ||
    typeof releasedOn !== "string" || !releasedOnPattern.test(releasedOn) ||
    typeof fileName !== "string" || !fileNamePattern.test(fileName) ||
    typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 1 ||
    typeof sha256 !== "string" || !sha256Pattern.test(sha256)) {
    throw new AppDownloadConfigurationError("download entry is invalid");
  }
  const minimumSupportedBuild = optionalBuild(
    row["minimumSupportedBuild"], "minimumSupportedBuild",
  );
  const retiredBuilds = optionalBuildList(row["retiredBuilds"], "retiredBuilds");
  const messageValue = row["supportMessage"];
  if (messageValue !== undefined && messageValue !== null &&
    (typeof messageValue !== "string" || messageValue.length === 0 ||
      messageValue.length > 300)) {
    throw new AppDownloadConfigurationError("supportMessage is invalid");
  }
  const supportMessage = typeof messageValue === "string" ? messageValue : undefined;
  const floorValue = row["minimumSupportedVersion"];
  if (floorValue !== undefined && floorValue !== null && (
    platform !== "windows" || typeof floorValue !== "string" ||
    !dottedVersionPattern.test(floorValue) || !dottedVersionPattern.test(version))) {
    throw new AppDownloadConfigurationError("minimumSupportedVersion is invalid");
  }
  const minimumSupportedVersion = typeof floorValue === "string" ? floorValue : undefined;
  if (minimumSupportedVersion !== undefined &&
    compareDottedVersions(minimumSupportedVersion, version) > 0) {
    // Like the Android floor: never turn off the very version the page offers.
    throw new AppDownloadConfigurationError(`download ${id} retires the version it publishes`);
  }
  const translated = translations(row["translations"]);
  return {
    id,
    platform,
    title,
    version,
    releasedOn,
    fileName,
    bytes,
    sha256,
    requirements: stringList(row["requirements"], "requirements"),
    installSteps: stringList(row["installSteps"], "installSteps"),
    updateSteps: stringList(row["updateSteps"], "updateSteps"),
    ...(minimumSupportedBuild === undefined ? {} : { minimumSupportedBuild }),
    ...(retiredBuilds === undefined ? {} : { retiredBuilds }),
    ...(supportMessage === undefined ? {} : { supportMessage }),
    ...(minimumSupportedVersion === undefined ? {} : { minimumSupportedVersion }),
    ...(translated === undefined ? {} : { translations: translated }),
  };
}

export type AppDownloadStore = Readonly<{
  // The catalog in one product language; English when none is asked for.
  catalog(language?: AppDownloadLanguage): AppDownloadCatalog;
  // Returns null when the id is not in the closed manifest.
  open(id: string): Promise<Readonly<{
    entry: AppDownloadEntry;
    bytes: number;
    stream: Readable;
  }> | null>;
}>;

// The manifest is read once at startup: the set of downloadable artifacts is
// deployment configuration, not request input.
export async function loadAppDownloads(
  rootDirectory: string,
): Promise<AppDownloadStore> {
  const root = resolve(rootDirectory);
  if (!isAbsolute(root)) {
    throw new AppDownloadConfigurationError("download root must be absolute");
  }
  const manifestPath = join(root, "downloads.json");
  const manifestBytes = await readFile(manifestPath);
  if (manifestBytes.byteLength > MAXIMUM_MANIFEST_BYTES) {
    throw new AppDownloadConfigurationError("download manifest is too large");
  }
  const parsed: unknown = JSON.parse(manifestBytes.toString("utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AppDownloadConfigurationError("download manifest is invalid");
  }
  const document = parsed as Record<string, unknown>;
  if (document["schemaVersion"] !== "mk8dx.app-downloads.v1" ||
    !Array.isArray(document["entries"]) ||
    document["entries"].length > MAXIMUM_ENTRIES) {
    throw new AppDownloadConfigurationError("download manifest is invalid");
  }
  const entries = document["entries"].map(entry);
  if (new Set(entries.map((row) => row.id)).size !== entries.length) {
    throw new AppDownloadConfigurationError("download ids must be unique");
  }
  // A manifest that turns off the very build it publishes would leave the whole
  // community looking at "Update Required" with nowhere to go. Refuse at
  // startup rather than discover it one phone at a time.
  for (const row of entries) {
    const build = releaseBuildNumber(row.version);
    if (build === null) { continue; }
    if (build < (row.minimumSupportedBuild ?? 1) ||
      (row.retiredBuilds ?? []).includes(build)) {
      throw new AppDownloadConfigurationError(
        `download ${row.id} retires the build it publishes`,
      );
    }
  }
  // Every advertised file must exist and match its recorded size at startup,
  // so the page can never offer a download that is not really there.
  for (const row of entries) {
    let matches = false;
    try {
      const stats = await stat(join(root, row.fileName));
      matches = stats.isFile() && stats.size === row.bytes;
    } catch {
      matches = false;
    }
    if (!matches) {
      throw new AppDownloadConfigurationError(
        `download ${row.id} does not match its manifest`,
      );
    }
  }
  const catalogs = new Map<AppDownloadLanguage, AppDownloadCatalog>(
    APP_DOWNLOAD_LANGUAGES.map((language) => [language, {
      schemaVersion: "mk8dx.app-downloads.v1",
      entries: entries.map((row) => localizedEntry(row, language)),
    }]),
  );
  return {
    catalog(language: AppDownloadLanguage = "en"): AppDownloadCatalog {
      return catalogs.get(language) ?? catalogs.get("en")!;
    },
    async open(id: string) {
      const found = entries.find((row) => row.id === id);
      if (found === undefined) { return null; }
      // The path comes from the manifest, never from the request.
      const filePath = join(root, found.fileName);
      const stats = await stat(filePath);
      return {
        entry: found,
        bytes: stats.size,
        stream: createReadStream(filePath),
      };
    },
  };
}
