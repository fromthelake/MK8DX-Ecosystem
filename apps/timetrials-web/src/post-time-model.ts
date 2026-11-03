// The one submission model behind the canonical Post-a-Time task
// (docs/design-system/POST_A_TIME_ARCHITECTURE.md §3, §7, §8).
//
// Pure: no DOM, no fetch, no clock beyond what the caller passes in. Everything the task needs to
// decide - what the draft holds, whether it is valid, which value came from a scan, what survives a
// reload, what a mode switch discards - is decided here and tested without a browser.
//
// Validation is NOT re-implemented: it is the canonical module
// (packages/time-trial-rules, delivered as time-trial-rules.generated.ts). There is exactly one
// import path for it in this application, and the form-parity test fails if a second one appears.

import {
  checkTimeDigits,
  CORRECTED_FIELD_GROUPS,
  submissionProvenance,
  timeMsToDigits,
  validateDraft,
  type CorrectedFieldGroup,
  type RuleError,
  type SubmissionProvenance,
  type ValidatedPayload,
  type ValidationResult,
} from "./time-trial-rules.generated.js";
import { schema9WebTrackCatalog, type WebTrackCatalogEntry } from "./schema9-track-catalog.js";
import { loadoutVariantById } from "./loadout-variants.js";
import type {
  WebManualLapV1,
  WebManualLoadoutV1,
  WebManualTimeTrialSubmissionV1,
  WebTimeTrialVerificationV1,
} from "./manual-submission.js";

export type EngineMode = 150 | 200;

/** Where a value came from. A UI hint only: validation treats typed and scanned identically. */
export type FieldOrigin = "typed" | "scanned";

export const LOADOUT_PART_KEYS = ["characterId", "bodyId", "tireId", "gliderId"] as const;
export type LoadoutPartKey = typeof LOADOUT_PART_KEYS[number];

export type PostTimeLap = Readonly<{
  timeDigits: string;
  /** The signed coin change during the lap; null = not entered (POST_A_TIME §3, D2). */
  coinChange: number | null;
  mushroomsUsed: number | null;
}>;

export type PostTimeScan = Readonly<{
  source: "endscreen" | "ghost_detail";
  observedPlayerName?: string;
  /** The producer that read the screen, as it names itself (ADR-0204 §6). */
  producerVersion?: string;
  /** What the producer was sure of, per contract field group (0..1). */
  confidence?: Readonly<Record<string, number>>;
  /** Whether the producer's own lap-sum check held. */
  lapSumMatches?: boolean;
  /** The exact colour variants the scan recognized; shown while their base part stays. */
  variants?: ScanVariants;
}>;

/** Exact scanned colour variants per part field; published while their base part stays (ADR-0215). */
export type ScanVariants = Readonly<Partial<Record<"characterId" | "bodyId" | "gliderId", string>>>;

const SCAN_VARIANT_ID = /^(character|body|glider)_variant\.[a-z0-9_.]{1,96}$/;

/**
 * Which contract field group a draft field belongs to. It is the vocabulary
 * `verification.correctedFields` speaks, so a scanned value the Player changes can be recorded
 * without inventing a second one (ADR-0204 §3).
 */
export function correctedGroupOf(fieldPath: string): CorrectedFieldGroup | null {
  if (fieldPath === TOTAL_FIELD) { return "totalTime"; }
  if (/^laps\[\d+\]\.timeDigits$/.test(fieldPath)) { return "laps"; }
  if (/^laps\[\d+\]\.coinChange$/.test(fieldPath)) { return "coins"; }
  if (/^laps\[\d+\]\.mushroomsUsed$/.test(fieldPath)) { return "mushrooms"; }
  switch (fieldPath) {
    case COUNTRY_FIELD: return "country";
    case "loadout.characterId": return "character";
    case "loadout.bodyId": return "body";
    case "loadout.tireId": return "tire";
    case "loadout.gliderId": return "glider";
    default: return null;
  }
}

export type PostTimeDraft = Readonly<{
  trackId: string | null;
  mode: EngineMode;
  totalDigits: string;
  laps: readonly PostTimeLap[];
  loadout: Readonly<Record<LoadoutPartKey, string | null>>;
  /** field path → origin. A field disappears from the map the moment it is edited. */
  origin: Readonly<Record<string, FieldOrigin>>;
  /** Field paths the producer was unsure about; cleared on any user choice. */
  doubt: readonly string[];
  /**
   * Contract field groups a scan filled and the Player then changed (ADR-0204 §3). The origin map
   * cannot say this: a field loses its "scanned" origin the moment it is edited, which is exactly
   * the event worth recording.
   */
  corrected: readonly CorrectedFieldGroup[];
  scan: PostTimeScan | null;
  /**
   * The flag on the scanned card (ADR-0215). Only a scan or the Player's own choice sets it; it
   * silently follows the scan, also when it differs from the Player's profile country (someone
   * else's run, a card without the flag). Null = not published.
   */
  countryId: string | null;
}>;

export const TOTAL_FIELD = "totalDigits";
export const COUNTRY_FIELD = "countryId";
const COUNTRY_ID = /^country\.[a-z]{2}$/;
export const lapTimeField = (index: number): string => `laps[${index}].timeDigits`;
export const lapCoinField = (index: number): string => `laps[${index}].coinChange`;
export const lapMushroomField = (index: number): string => `laps[${index}].mushroomsUsed`;
export const loadoutField = (key: LoadoutPartKey): string => `loadout.${key}`;

const TRACKS_BY_ID: ReadonlyMap<string, WebTrackCatalogEntry> =
  new Map(schema9WebTrackCatalog.map((track) => [track.id, track]));

export function trackEntry(trackId: string | null): WebTrackCatalogEntry | null {
  return trackId === null ? null : TRACKS_BY_ID.get(trackId) ?? null;
}

/** 3, or 7 on the one 7-lap track. Never the web's old free 1-7 (SPEC §7 D1). */
export function trackLapCount(trackId: string | null): 3 | 7 {
  return trackEntry(trackId)?.lapCount === 7 ? 7 : 3;
}

function blankLaps(count: number): readonly PostTimeLap[] {
  return Array.from({ length: count }, () => ({
    timeDigits: "", coinChange: null, mushroomsUsed: null,
  }));
}

export function createPostTimeDraft(
  trackId: string | null,
  mode: EngineMode,
): PostTimeDraft {
  return {
    trackId,
    mode,
    totalDigits: "",
    laps: blankLaps(trackLapCount(trackId)),
    loadout: { characterId: null, bodyId: null, tireId: null, gliderId: null },
    origin: {},
    doubt: [],
    corrected: [],
    scan: null,
    countryId: null,
  };
}

/**
 * The digit mask the web form has always applied to typed input: a tens-of-seconds digit above 5 is
 * clamped as it is typed, so 178000 becomes 158000 rather than being refused (SPEC §7 D5).
 * Preserved deliberately - a Phase 7 form that refused what today's form accepts would be a
 * regression for every Player who mistypes. Scanned values are NOT masked: there the rule fires and
 * the misread is shown instead of silently changed.
 */
export function maskTypedDigits(rawValue: string): string {
  const clean = rawValue.replace(/\D/g, "").slice(0, 6);
  if (clean.length < 2 || clean[1]! <= "5") { return clean; }
  return `${clean[0]}5${clean.slice(2)}`;
}

/** "145912" → "1:45.912"; an incomplete value keeps its blanks. */
export function formatDraftDigits(digits: string): string {
  const padded = digits.padEnd(6, "_").slice(0, 6);
  return `${padded[0]}:${padded.slice(1, 3)}.${padded.slice(3, 6)}`;
}

function withoutOrigin(
  origin: Readonly<Record<string, FieldOrigin>>,
  field: string,
): Readonly<Record<string, FieldOrigin>> {
  if (!Object.hasOwn(origin, field)) { return origin; }
  const next: Record<string, FieldOrigin> = { ...origin };
  delete next[field];
  return next;
}

function edited(draft: PostTimeDraft, field: string): PostTimeDraft {
  // EDITED (POST_A_TIME §7): the value becomes typed, its dot disappears and its doubt clears.
  // If it was a scanned value, the change itself is provenance and is kept (ADR-0204).
  const group = draft.origin[field] === "scanned" ? correctedGroupOf(field) : null;
  return {
    ...draft,
    origin: withoutOrigin(draft.origin, field),
    doubt: draft.doubt.filter((path) => path !== field),
    corrected: group === null || draft.corrected.includes(group)
      ? draft.corrected
      : [...draft.corrected, group],
  };
}

export function setTotalDigits(draft: PostTimeDraft, rawValue: string): PostTimeDraft {
  return edited({ ...draft, totalDigits: maskTypedDigits(rawValue) }, TOTAL_FIELD);
}

function replaceLap(
  draft: PostTimeDraft,
  index: number,
  change: Partial<PostTimeLap>,
): PostTimeDraft {
  const laps = draft.laps.map((lap, at) => (at === index ? { ...lap, ...change } : lap));
  return { ...draft, laps };
}

export function setLapDigits(draft: PostTimeDraft, index: number, rawValue: string): PostTimeDraft {
  return edited(replaceLap(draft, index, { timeDigits: maskTypedDigits(rawValue) }), lapTimeField(index));
}

export function setLapCoinChange(
  draft: PostTimeDraft, index: number, change: number | null,
): PostTimeDraft {
  return edited(replaceLap(draft, index, { coinChange: change }), lapCoinField(index));
}

export function setLapMushrooms(
  draft: PostTimeDraft, index: number, used: number | null,
): PostTimeDraft {
  return edited(replaceLap(draft, index, { mushroomsUsed: used }), lapMushroomField(index));
}

/** The flag the submission carries; null removes it (ADR-0215). */
export function setCountry(draft: PostTimeDraft, countryId: string | null): PostTimeDraft {
  const value = countryId !== null && COUNTRY_ID.test(countryId) ? countryId : null;
  return edited({ ...draft, countryId: value }, COUNTRY_FIELD);
}

export function setLoadoutPart(
  draft: PostTimeDraft, key: LoadoutPartKey, value: string | null,
): PostTimeDraft {
  return edited({ ...draft, loadout: { ...draft.loadout, [key]: value } }, loadoutField(key));
}

/** Clears every lap row's time, coins and mushrooms - the "or clear all laps" half of the rule. */
export function clearLaps(draft: PostTimeDraft): PostTimeDraft {
  const cleared = draft.laps.map(() => ({
    timeDigits: "", coinChange: null, mushroomsUsed: null,
  }));
  const origin: Record<string, FieldOrigin> = { ...draft.origin };
  const corrected = new Set<CorrectedFieldGroup>(draft.corrected);
  draft.laps.forEach((_lap, index) => {
    for (const field of [lapTimeField(index), lapCoinField(index), lapMushroomField(index)]) {
      // Clearing a scanned lap is a correction of it, like typing over it.
      const group = origin[field] === "scanned" ? correctedGroupOf(field) : null;
      if (group !== null) { corrected.add(group); }
      delete origin[field];
    }
  });
  return {
    ...draft,
    laps: cleared,
    origin,
    doubt: draft.doubt.filter((path) => !path.startsWith("laps[")),
    corrected: [...corrected],
  };
}

/** Clears the optional values in one lap while preserving scan-correction provenance. */
export function clearLap(draft: PostTimeDraft, index: number): PostTimeDraft {
  return setLapMushrooms(
    setLapCoinChange(setLapDigits(draft, index, ""), index, null),
    index,
    null,
  );
}

/**
 * A mode switch discards and recomputes everything derived from the engine (ENGINE_CONTEXT §4): the
 * prediction and the armed state. The values the Player typed are theirs and stay.
 */
export function setMode(draft: PostTimeDraft, mode: EngineMode): PostTimeDraft {
  return draft.mode === mode ? draft : { ...draft, mode };
}

/** Choosing the track resizes the lap rows to the track's own count, keeping what fits. */
export function setTrack(draft: PostTimeDraft, trackId: string): PostTimeDraft {
  if (draft.trackId === trackId) { return draft; }
  const count = trackLapCount(trackId);
  const laps = Array.from({ length: count }, (_value, index) =>
    draft.laps[index] ?? { timeDigits: "", coinChange: null, mushroomsUsed: null });
  return { ...draft, trackId, laps };
}

export function hasMeaningfulData(draft: PostTimeDraft): boolean {
  return draft.totalDigits !== "" ||
    draft.laps.some((lap) =>
      lap.timeDigits !== "" || lap.coinChange !== null || lap.mushroomsUsed !== null) ||
    LOADOUT_PART_KEYS.some((key) => draft.loadout[key] !== null);
}

/** The running coin balance after each lap, for the "+4 · balance 4" reading (POST_A_TIME §3). */
export function coinBalances(draft: PostTimeDraft): readonly number[] {
  let balance = 0;
  return draft.laps.map((lap) => {
    balance += lap.coinChange ?? 0;
    return balance;
  });
}

// ---------------------------------------------------------------- validation (one module)

export function validatePostTime(draft: PostTimeDraft): ValidationResult {
  return validateDraft({
    trackId: draft.trackId,
    totalDigits: draft.totalDigits,
    laps: draft.laps.map((lap) => ({
      timeDigits: lap.timeDigits,
      coinChange: lap.coinChange,
      mushroomsUsed: lap.mushroomsUsed,
    })),
    loadout: {
      characterId: draft.loadout.characterId,
      bodyId: draft.loadout.bodyId,
      tireId: draft.loadout.tireId,
      gliderId: draft.loadout.gliderId,
    },
  }, { engine: draft.mode, trackLapCount: trackLapCount(draft.trackId) });
}

/** The first error on a field, so only the offending field is marked (DESIGN_SYSTEM §13). */
export function errorFor(
  errors: readonly RuleError[], field: string,
): RuleError | null {
  return errors.find((error) => error.field === field) ?? null;
}

// ---------------------------------------------------------------- scan autofill

export type ScanFill = Readonly<{
  totalDigits?: string;
  laps?: readonly string[];
  characterId?: string;
  bodyId?: string;
  tireId?: string;
  gliderId?: string;
  /** The flag on the scanned card (ADR-0215). */
  countryId?: string;
  observedPlayerName?: string;
  source?: "endscreen" | "ghost_detail";
  /** Field paths the producer was unsure about. */
  doubt?: readonly string[];
  /** The producer that read the screen (ADR-0204 §6). */
  producerVersion?: string;
  /** What the producer was sure of, per contract field group (0..1). */
  confidence?: Readonly<Record<string, number>>;
  /** Whether the producer's own lap-sum check held. */
  lapSumMatches?: boolean;
  variants?: ScanVariants;
}>;

export type ScanApplication = Readonly<{
  draft: PostTimeDraft;
  /** Fields the Player had typed that the scan would have overwritten, and did not. */
  conflicts: readonly string[];
  /** Fields this scan actually filled. */
  filled: readonly string[];
}>;

function typedAndFilled(draft: PostTimeDraft, field: string, current: string | null): boolean {
  return current !== null && current !== "" && draft.origin[field] !== "scanned";
}

/**
 * A scan fills empty fields and never silently replaces a value the Player typed
 * (POST_A_TIME §7). `replaceTyped` is the answer to the "Replace the values you typed?" question.
 * Scanned digits are NOT put through the typed mask: a misread 1:78.000 stays 1:78.000 and the rule
 * says so, rather than becoming 1:58.000 behind the Player's back (SPEC §7 D5).
 */
export function applyScan(
  draft: PostTimeDraft,
  fill: ScanFill,
  options: Readonly<{ replaceTyped?: boolean }> = {},
): ScanApplication {
  const replace = options.replaceTyped === true;
  const conflicts: string[] = [];
  const filled: string[] = [];
  const origin: Record<string, FieldOrigin> = { ...draft.origin };
  const digits = (value: string): string => value.replace(/\D/g, "").slice(0, 6);

  let totalDigits = draft.totalDigits;
  if (fill.totalDigits !== undefined && digits(fill.totalDigits) !== "") {
    if (typedAndFilled(draft, TOTAL_FIELD, draft.totalDigits) && !replace) {
      conflicts.push(TOTAL_FIELD);
    } else {
      totalDigits = digits(fill.totalDigits);
      origin[TOTAL_FIELD] = "scanned";
      filled.push(TOTAL_FIELD);
    }
  }

  const laps = draft.laps.map((lap, index) => {
    const scanned = fill.laps?.[index];
    if (scanned === undefined || digits(scanned) === "") { return lap; }
    const field = lapTimeField(index);
    if (typedAndFilled(draft, field, lap.timeDigits) && !replace) {
      conflicts.push(field);
      return lap;
    }
    origin[field] = "scanned";
    filled.push(field);
    return { ...lap, timeDigits: digits(scanned) };
  });

  const loadout: Record<LoadoutPartKey, string | null> = { ...draft.loadout };
  for (const key of LOADOUT_PART_KEYS) {
    const scanned = fill[key];
    if (scanned === undefined || scanned === "") { continue; }
    const field = loadoutField(key);
    if (typedAndFilled(draft, field, draft.loadout[key]) && !replace) {
      conflicts.push(field);
      continue;
    }
    loadout[key] = scanned;
    origin[field] = "scanned";
    filled.push(field);
  }

  let countryId = draft.countryId;
  if (fill.countryId !== undefined && COUNTRY_ID.test(fill.countryId)) {
    if (typedAndFilled(draft, COUNTRY_FIELD, draft.countryId) && !replace) {
      conflicts.push(COUNTRY_FIELD);
    } else {
      countryId = fill.countryId;
      origin[COUNTRY_FIELD] = "scanned";
      filled.push(COUNTRY_FIELD);
    }
  }

  const doubt = [...new Set([...draft.doubt, ...(fill.doubt ?? [])])]
    .filter((path) => filled.includes(path));
  // A group this scan has just filled is a recognised value again, not a corrected one.
  const refilled = new Set(filled.map(correctedGroupOf).filter((group) => group !== null));
  return {
    draft: {
      ...draft,
      totalDigits,
      laps,
      loadout,
      countryId,
      origin,
      doubt,
      corrected: draft.corrected.filter((group) => !refilled.has(group)),
      scan: {
        source: fill.source ?? "endscreen",
        ...(fill.observedPlayerName === undefined
          ? {} : { observedPlayerName: fill.observedPlayerName }),
        ...(fill.producerVersion === undefined
          ? {} : { producerVersion: fill.producerVersion }),
        ...(fill.confidence === undefined ? {} : { confidence: fill.confidence }),
        ...(fill.lapSumMatches === undefined ? {} : { lapSumMatches: fill.lapSumMatches }),
        ...(fill.variants === undefined || Object.keys(fill.variants).length === 0
          ? {} : { variants: fill.variants }),
      },
    },
    conflicts,
    filled,
  };
}

/**
 * What this draft records about how it was filled in (ADR-0204). It is the shared rules module's
 * answer, so the web, Android and the conformance cases agree by construction.
 *
 * Provenance never affects legitimacy, ranking, score or a trust indicator: a scanned submission is
 * published on exactly the terms a typed one is (ADR-0204 §5).
 */
export function postTimeProvenance(draft: PostTimeDraft): SubmissionProvenance {
  return submissionProvenance({
    origin: draft.origin,
    corrected: [...draft.corrected, ...variantCorrections(draft)],
    scan: draft.scan === null ? null : { source: draft.scan.source },
  }, "web");
}

/** The variant groups a changed base part also corrects: its scanned colour is no longer published. */
function variantCorrections(draft: PostTimeDraft): CorrectedFieldGroup[] {
  const out: CorrectedFieldGroup[] = [];
  for (const [key, group, base] of [["characterId", "characterVariant", "character"],
    ["bodyId", "bodyVariant", "body"], ["gliderId", "gliderVariant", "glider"]] as const) {
    if (draft.scan?.variants?.[key] !== undefined && draft.corrected.includes(base) &&
      !draft.corrected.includes(group)) { out.push(group); }
  }
  return out;
}

/** The scanned colour variants still valid for the parts being published (ADR-0215). */
export function publishedVariants(
  draft: PostTimeDraft,
  loadout: Readonly<Partial<Record<LoadoutPartKey, string>>>,
): Readonly<Partial<Record<"characterVariantId" | "bodyVariantId" | "gliderVariantId", string>>> {
  const out: Partial<Record<"characterVariantId" | "bodyVariantId" | "gliderVariantId", string>> = {};
  for (const [key, variantKey] of [["characterId", "characterVariantId"], ["bodyId", "bodyVariantId"],
    ["gliderId", "gliderVariantId"]] as const) {
    const id = draft.scan?.variants?.[key];
    const base = loadout[key];
    if (id !== undefined && base !== undefined && loadoutVariantById(id)?.baseId === base) {
      out[variantKey] = id;
    }
  }
  return out;
}

/** Any field still carrying a scanner value - the "web_scan" question of ADR-0204 (Phase 8). */
export function hasScannedValue(draft: PostTimeDraft): boolean {
  return Object.values(draft.origin).includes("scanned");
}

// ---------------------------------------------------------------- the publish payload

/** The confidence keys the contract knows, mapped from the producer's field groups. */
const CONFIDENCE_KEYS = [
  "totalTime", "track", "character", "characterVariant", "body", "tire", "glider",
  "country", "playerName",
] as const;

function verificationFor(
  draft: PostTimeDraft,
  provenance: SubmissionProvenance,
): WebTimeTrialVerificationV1 | null {
  if (provenance.verificationStatus === undefined) { return null; }
  const source = draft.scan?.confidence ?? {};
  const fieldConfidence: Record<string, number> = {};
  for (const key of CONFIDENCE_KEYS) {
    const value = source[key];
    if (typeof value === "number" && value >= 0 && value <= 1) {
      fieldConfidence[key] = Math.round(value * 10_000) / 10_000;
    }
  }
  return {
    status: provenance.verificationStatus,
    ...(provenance.verificationMethod === undefined
      ? {} : { method: provenance.verificationMethod }),
    ...(draft.scan?.lapSumMatches === undefined
      ? {} : { lapSumMatches: draft.scan.lapSumMatches }),
    ...(Object.keys(fieldConfidence).length === 0 ? {} : { fieldConfidence }),
    ...(provenance.correctedFields === undefined
      ? {} : { correctedFields: provenance.correctedFields }),
  };
}

/**
 * The validated payload, put into the preserved TimeTrialSubmissionV1 envelope the tested
 * publication boundary already speaks, with the provenance of ADR-0204 on it: a submission any of
 * whose fields a scan filled travels as `web_scan`, says which screen was read, and records what
 * the Player changed afterwards. It never carries `producer_check_failed` or `needs_review`, so
 * publication eligibility is exactly what it is for a typed submission (ADR-0147).
 */
export function applyPayload(
  submission: WebManualTimeTrialSubmissionV1,
  payload: ValidatedPayload,
  draft?: PostTimeDraft,
): WebManualTimeTrialSubmissionV1 {
  const laps: readonly WebManualLapV1[] = payload.laps.map((lap) => ({
    lapNumber: lap.lapNumber,
    timeMs: lap.timeMs,
    ...(lap.coinsCollected === undefined ? {} : { coinsCollected: lap.coinsCollected }),
    ...(lap.mushroomsUsed === undefined ? {} : { mushroomsUsed: lap.mushroomsUsed }),
  }));
  const source = payload.loadout ?? {};
  const loadout: WebManualLoadoutV1 = {
    ...(source.characterId === undefined ? {} : { characterId: source.characterId }),
    ...(source.bodyId === undefined ? {} : { bodyId: source.bodyId }),
    ...(source.tireId === undefined ? {} : { tireId: source.tireId }),
    ...(source.gliderId === undefined ? {} : { gliderId: source.gliderId }),
    ...(draft === undefined ? {} : publishedVariants(draft, source)),
  };
  const provenance = draft === undefined ? null : postTimeProvenance(draft);
  const verification = draft === undefined || provenance === null
    ? null
    : verificationFor(draft, provenance);
  return {
    ...submission,
    mode: payload.mode,
    trackId: payload.trackId,
    totalTimeMs: payload.totalTimeMs,
    laps,
    ...(Object.keys(loadout).length === 0 ? {} : { loadout }),
    ...(draft?.countryId ? { countryId: draft.countryId } : {}),
    ...(provenance === null ? {} : {
      source: {
        ...submission.source,
        kind: provenance.sourceKind === "web_scan" ? "web_scan" : "web_manual",
        ...(provenance.captureLayout === undefined
          ? {} : { captureLayout: provenance.captureLayout }),
        ...(draft?.scan?.producerVersion === undefined || provenance.sourceKind !== "web_scan"
          ? {} : { producerVersion: draft.scan.producerVersion }),
      },
    }),
    ...(verification === null ? {} : { verification }),
  };
}

// ---------------------------------------------------------------- drafts (POST_A_TIME §8)

export const POST_TIME_DRAFT_KEY = "mk8dx.post-time-draft.v1";

export type StoredDraft = Readonly<{ key: string; draft: PostTimeDraft; savedAtMs: number }>;

/** One draft per (player, track, mode), as the frozen architecture keys it. */
export function draftKey(
  playerId: string, trackId: string | null, mode: EngineMode,
): string {
  return `${playerId}|${trackId ?? "?"}|${mode}`;
}

function storage(): Storage | null {
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
}

export function saveDraft(
  playerId: string, draft: PostTimeDraft, nowMs: number, store: Storage | null = storage(),
): void {
  if (store === null) { return; }
  try {
    if (!hasMeaningfulData(draft)) { store.removeItem(POST_TIME_DRAFT_KEY); return; }
    store.setItem(POST_TIME_DRAFT_KEY, JSON.stringify({
      key: draftKey(playerId, draft.trackId, draft.mode), draft, savedAtMs: nowMs,
    }));
  } catch {
    // A blocked storage area loses the draft on reload, which is today's behaviour; it must never
    // stop the Player from publishing.
  }
}

export function clearDraft(store: Storage | null = storage()): void {
  try { store?.removeItem(POST_TIME_DRAFT_KEY); } catch { /* blocked storage */ }
}

function isLap(value: unknown): value is PostTimeLap {
  if (typeof value !== "object" || value === null) { return false; }
  const lap = value as Record<string, unknown>;
  return typeof lap["timeDigits"] === "string" &&
    (lap["coinChange"] === null || Number.isSafeInteger(lap["coinChange"])) &&
    (lap["mushroomsUsed"] === null || Number.isSafeInteger(lap["mushroomsUsed"]));
}

/** Reads back a draft for exactly this (player, track, mode); anything else is ignored. */
export function loadDraft(
  playerId: string,
  trackId: string | null,
  mode: EngineMode,
  store: Storage | null = storage(),
): PostTimeDraft | null {
  if (store === null) { return null; }
  let raw: string | null = null;
  try { raw = store.getItem(POST_TIME_DRAFT_KEY); } catch { return null; }
  if (raw === null) { return null; }
  let stored: unknown;
  try { stored = JSON.parse(raw); } catch { return null; }
  if (typeof stored !== "object" || stored === null) { return null; }
  const record = stored as Record<string, unknown>;
  if (record["key"] !== draftKey(playerId, trackId, mode)) { return null; }
  const candidate = record["draft"];
  if (typeof candidate !== "object" || candidate === null) { return null; }
  const draft = candidate as Record<string, unknown>;
  if (draft["mode"] !== mode || (draft["trackId"] ?? null) !== trackId) { return null; }
  if (typeof draft["totalDigits"] !== "string" || !Array.isArray(draft["laps"]) ||
    !draft["laps"].every(isLap)) {
    return null;
  }
  const base = createPostTimeDraft(trackId, mode);
  const laps = (draft["laps"] as readonly PostTimeLap[]).slice(0, base.laps.length);
  const loadoutSource = (draft["loadout"] ?? {}) as Record<string, unknown>;
  const loadout: Record<LoadoutPartKey, string | null> = { ...base.loadout };
  for (const key of LOADOUT_PART_KEYS) {
    const value = loadoutSource[key];
    if (typeof value === "string" && value !== "") { loadout[key] = value; }
  }
  const originSource = (draft["origin"] ?? {}) as Record<string, unknown>;
  const origin: Record<string, FieldOrigin> = {};
  for (const [field, value] of Object.entries(originSource)) {
    if (value === "typed" || value === "scanned") { origin[field] = value; }
  }
  const doubtSource = draft["doubt"];
  const correctedSource = draft["corrected"];
  // The scan's own facts survive the round trip too, or a restored draft would publish without the
  // screen it was read from (ADR-0204).
  const scanSource = draft["scan"];
  const scan = ((): PostTimeScan | null => {
    if (typeof scanSource !== "object" || scanSource === null) { return null; }
    const record = scanSource as Record<string, unknown>;
    const source = record["source"];
    if (source !== "endscreen" && source !== "ghost_detail") { return null; }
    const name = record["observedPlayerName"];
    const producerVersion = record["producerVersion"];
    const confidence = record["confidence"];
    const lapSumMatches = record["lapSumMatches"];
    const variantSource = record["variants"];
    const variants: Partial<Record<"characterId" | "bodyId" | "gliderId", string>> = {};
    if (typeof variantSource === "object" && variantSource !== null) {
      for (const key of ["characterId", "bodyId", "gliderId"] as const) {
        const value = (variantSource as Record<string, unknown>)[key];
        if (typeof value === "string" && SCAN_VARIANT_ID.test(value)) { variants[key] = value; }
      }
    }
    return {
      source,
      ...(typeof name === "string" && name !== "" ? { observedPlayerName: name.slice(0, 64) } : {}),
      ...(typeof producerVersion === "string" && producerVersion !== ""
        ? { producerVersion: producerVersion.slice(0, 64) } : {}),
      ...(typeof confidence === "object" && confidence !== null
        ? {
            confidence: Object.fromEntries(Object.entries(confidence as Record<string, unknown>)
              .filter(([, value]) => typeof value === "number" && value >= 0 && value <= 1)) as
              Readonly<Record<string, number>>,
          }
        : {}),
      ...(typeof lapSumMatches === "boolean" ? { lapSumMatches } : {}),
      ...(Object.keys(variants).length === 0 ? {} : { variants }),
    };
  })();
  const country = draft["countryId"];
  return {
    ...base,
    countryId: typeof country === "string" && COUNTRY_ID.test(country) ? country : null,
    totalDigits: draft["totalDigits"].replace(/\D/g, "").slice(0, 6),
    laps: base.laps.map((blank, index) => laps[index] ?? blank),
    loadout,
    origin,
    doubt: Array.isArray(doubtSource)
      ? doubtSource.filter((path): path is string => typeof path === "string")
      : [],
    corrected: Array.isArray(correctedSource)
      ? correctedSource.filter((group): group is CorrectedFieldGroup =>
        typeof group === "string" && (CORRECTED_FIELD_GROUPS as readonly string[]).includes(group))
      : [],
    scan,
  };
}

// ---------------------------------------------------------------- small helpers the task shares

export { checkTimeDigits, timeMsToDigits };
export type { RuleError, ValidatedPayload, ValidationResult };
