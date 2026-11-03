import { parseEngineMode } from "./engine-context.js";
import type { ScanVariants } from "./post-time-model.js";
import {
  BODY_PARTS,
  CHARACTER_PARTS,
  GLIDER_PARTS,
  TIRE_PARTS,
} from "./loadout-manifest.js";
import { COUNTRY_ASSET_MANIFEST } from "./asset-manifest.js";
import {
  BODY_COLOR_VARIANTS,
  CHARACTER_COLOR_VARIANTS,
  GLIDER_COLOR_VARIANTS,
} from "./loadout-variants.js";

/**
 * How the browser scanner hands a recognized result back to this application.
 *
 * The scanner is a separate static application on this same origin. It knows
 * how to read a Switch screen and nothing about Players, tracks or publication;
 * this application knows all of that and nothing about reading a screen. So the
 * scanner writes what it read into session storage and returns here, where the
 * Player reviews it in the ordinary entry form and publishes it through the
 * ordinary tested boundary. Nothing is ever saved on the strength of a scan
 * alone, exactly as in the APK.
 */
export const SCAN_HANDOFF_STORAGE_KEY = "mk8dx.scan-handoff.v1";

export type WebScanHandoff = Readonly<{
  trackId: string;
  mode: 150 | 200;
  /** Six digits, as the entry form counts them: M SS mmm. */
  totalDigits: string;
  /** One six-digit string per lap, in order; empty when a lap was not read. */
  laps: readonly string[];
  characterId?: string;
  bodyId?: string;
  tireId?: string;
  gliderId?: string;
  /** The flag on the scanned card (ADR-0215). */
  countryId?: string;
  /** The rider name the scanner read, shown so the Player can check it is theirs. */
  observedPlayerName?: string;
  /** Which screen was read (ADR-0204). The task publishes it as the capture layout. */
  layout?: "endscreen" | "ghost_detail";
  /** The producer that read it, as it names itself. */
  producerVersion?: string;
  /** What it was sure of, per contract field group (0..1). */
  confidence?: Readonly<Record<string, number>>;
  /** Its own lap-sum check. */
  lapSumMatches?: boolean;
  /** Field paths it was unsure about; the task asks the Player to confirm those. */
  doubt?: readonly string[];
  /**
   * The exact colour variants the scanner recognized, keyed by the part field they
   * are a colour of. The form offers base parts only; it shows these while the
   * Player keeps that base part, and publishes them with it (ADR-0215).
   */
  variants?: ScanVariants;
}>;

/** The countries this build knows; a flag it does not is dropped rather than guessed. */
const COUNTRY_IDS: ReadonlySet<string> = new Set(COUNTRY_ASSET_MANIFEST.map((country) => country.id));

/** The confidence groups the contract knows; anything else the producer says is dropped. */
const CONFIDENCE_GROUPS: ReadonlySet<string> = new Set([
  "totalTime", "track", "character", "characterVariant", "body", "tire", "glider",
  "country", "playerName",
]);

/** The draft field paths a producer may flag; a path it invents is not shown. */
const DOUBT_FIELDS = /^(totalDigits|laps\[[0-6]\]\.timeDigits|loadout\.(character|body|tire|glider)Id|countryId)$/;

const PART_IDS: Readonly<Record<"character" | "body" | "tire" | "glider", ReadonlySet<string>>> = {
  character: new Set(CHARACTER_PARTS.map((part) => part.id)),
  body: new Set(BODY_PARTS.map((part) => part.id)),
  tire: new Set(TIRE_PARTS.map((part) => part.id)),
  glider: new Set(GLIDER_PARTS.map((part) => part.id)),
};

const VARIANT_BASES: ReadonlyMap<string, string> = new Map(
  [...CHARACTER_COLOR_VARIANTS, ...BODY_COLOR_VARIANTS, ...GLIDER_COLOR_VARIANTS]
    .map((variant) => [variant.id, variant.baseId] as const),
);

/**
 * The scanner recognizes the exact artwork, so it can name a colour variant the
 * entry form does not offer as its own choice. A variant resolves to the part it
 * is a colour of; anything this build does not know is dropped rather than
 * guessed, and the Player picks it themselves.
 */
export function normalizeScanPartId(
  rawId: unknown,
  kind: "character" | "body" | "tire" | "glider",
): string | undefined {
  if (typeof rawId !== "string" || rawId === "") { return undefined; }
  const resolved = rawId.includes("_variant.")
    ? VARIANT_BASES.get(rawId)
    : rawId;
  if (resolved === undefined) { return undefined; }
  return PART_IDS[kind].has(resolved) ? resolved : undefined;
}

/**
 * The scanner reads a tire by its position in the shipped tire set, not by a
 * stable id, exactly as the APK's own translator does. The position is bound to
 * the icon each part carries so the two orders cannot drift apart unnoticed.
 */
export function normalizeScanTireIndex(rawIndex: unknown): string | undefined {
  if (typeof rawIndex !== "number" || !Number.isSafeInteger(rawIndex) || rawIndex < 0) {
    return undefined;
  }
  const marker = String(rawIndex).padStart(3, "0");
  return TIRE_PARTS.find(
    (part) => part.iconPath.includes(`/${marker}_`),
  )?.id;
}

/** The variant ids among the raw part ids that resolve to a part this build knows. */
export function scanVariantsOf(record: Readonly<Record<string, unknown>>): ScanVariants {
  const variants: Partial<Record<"characterId" | "bodyId" | "gliderId", string>> = {};
  for (const kind of ["character", "body", "glider"] as const) {
    const raw = record[`${kind}Id`];
    if (typeof raw === "string" && raw.includes("_variant.") &&
      normalizeScanPartId(raw, kind) !== undefined) {
      variants[`${kind}Id`] = raw;
    }
  }
  return variants;
}

function sixDigits(value: unknown): string {
  return typeof value === "string" && /^[0-9]{6}$/.test(value) ? value : "";
}

function parseHandoff(raw: string): WebScanHandoff | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) { return null; }
  const record = value as Record<string, unknown>;
  const trackId = record["trackId"];
  const totalDigits = sixDigits(record["totalDigits"]);
  const mode = parseEngineMode(record["mode"]);
  if (typeof trackId !== "string" || trackId === "" || totalDigits === "" || mode === null) {
    return null;
  }
  const laps = Array.isArray(record["laps"])
    ? (record["laps"] as unknown[]).slice(0, 7).map(sixDigits)
    : [];
  const name = record["observedPlayerName"];
  const layout = record["layout"];
  const producerVersion = record["producerVersion"];
  const lapSumMatches = record["lapSumMatches"];
  const rawConfidence = record["confidence"];
  const confidence = typeof rawConfidence === "object" && rawConfidence !== null
    ? Object.fromEntries(Object.entries(rawConfidence as Record<string, unknown>)
      .filter(([group, value]) => CONFIDENCE_GROUPS.has(group) &&
        typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1))
    : {};
  const rawDoubt = record["doubt"];
  const doubt = Array.isArray(rawDoubt)
    ? rawDoubt.filter((path): path is string =>
      typeof path === "string" && DOUBT_FIELDS.test(path)).slice(0, 16)
    : [];
  return {
    trackId,
    mode,
    totalDigits,
    laps,
    ...(normalizeScanPartId(record["characterId"], "character") === undefined
      ? {}
      : { characterId: normalizeScanPartId(record["characterId"], "character")! }),
    ...(normalizeScanPartId(record["bodyId"], "body") === undefined
      ? {}
      : { bodyId: normalizeScanPartId(record["bodyId"], "body")! }),
    ...(() => {
      const tireId = normalizeScanPartId(record["tireId"], "tire")
        ?? normalizeScanTireIndex(record["tireIndex"]);
      return tireId === undefined ? {} : { tireId };
    })(),
    ...(normalizeScanPartId(record["gliderId"], "glider") === undefined
      ? {}
      : { gliderId: normalizeScanPartId(record["gliderId"], "glider")! }),
    ...(typeof record["countryId"] === "string" && COUNTRY_IDS.has(record["countryId"])
      ? { countryId: record["countryId"] }
      : {}),
    ...(typeof name === "string" && name !== ""
      ? { observedPlayerName: name.slice(0, 64) }
      : {}),
    ...(layout === "endscreen" || layout === "ghost_detail" ? { layout } : {}),
    ...(typeof producerVersion === "string" && producerVersion !== ""
      ? { producerVersion: producerVersion.slice(0, 64) }
      : {}),
    ...(Object.keys(confidence).length === 0
      ? {}
      : { confidence: confidence as Readonly<Record<string, number>> }),
    ...(typeof lapSumMatches === "boolean" ? { lapSumMatches } : {}),
    ...(doubt.length === 0 ? {} : { doubt }),
    ...((variants) => Object.keys(variants).length === 0 ? {} : { variants })(scanVariantsOf(record)),
  };
}

/**
 * Reads a handed-back scan for this track and clears it in the same breath, so
 * a reload or a second track never re-applies a result the Player already saw.
 */
export function takeScanHandoff(
  storage: Storage | null | undefined,
  trackId: string,
): WebScanHandoff | null {
  if (storage === null || storage === undefined) { return null; }
  let raw: string | null;
  try {
    raw = storage.getItem(SCAN_HANDOFF_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) { return null; }
  const handoff = parseHandoff(raw);
  if (handoff === null || handoff.trackId !== trackId) { return null; }
  try {
    storage.removeItem(SCAN_HANDOFF_STORAGE_KEY);
  } catch {
    // A storage that refuses to forget still gave us the result; the track
    // check above keeps it from leaking into another track's entry.
  }
  return handoff;
}

/**
 * The same read against this browser's own session storage. It lives here rather than in the
 * router, so the product page stays free of storage access (the host boundary test asserts that).
 */
export function takeSessionScanHandoff(trackId: string): WebScanHandoff | null {
  let store: Storage | null = null;
  try { store = globalThis.sessionStorage ?? null; } catch { return null; }
  return takeScanHandoff(store, trackId);
}

/**
 * Where the scanner lives, if this deployment has one. The page states it, so a
 * self-hosted installation without the scanner simply does not offer the button
 * instead of linking somewhere that does not exist.
 */
export function scannerBase(document_: Document): string | null {
  // Read defensively: the entry form is also mounted against deliberately
  // minimal documents, and a missing scanner must read as "no scanner here"
  // rather than break the form the Player came for.
  let value = "";
  try {
    const meta = document_.querySelector?.('meta[name="mk8dx-scanner-base"]');
    value = meta?.getAttribute("content")?.trim() ?? "";
  } catch {
    return null;
  }
  if (value === "" || value === "off") { return null; }
  return value.endsWith("/") ? value : `${value}/`;
}

export function scannerHref(
  base: string,
  trackId: string,
  mode: 150 | 200,
  returnHref: string,
  layout?: "endscreen" | "ghost_detail",
  lapCount: 3 | 7 = 3,
): string {
  const parameters = new URLSearchParams({
    track: trackId,
    mode: String(mode),
    handoff: SCAN_HANDOFF_STORAGE_KEY,
    return: returnHref,
    laps: String(lapCount),
    // The source is the Player's choice in the task; the camera does not ask again (ADR-0206).
    ...(layout === undefined ? {} : { layout }),
  });
  return `${base}?${parameters.toString()}`;
}
