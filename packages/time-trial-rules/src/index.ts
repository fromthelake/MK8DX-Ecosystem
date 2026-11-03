/**
 * Canonical Time Trial validation (SPEC.md, rules version 1.0.0, submission
 * contract mk8dx.time-trial-submission.v1).
 *
 * Pure: no DOM, no I/O, no clock. The Kotlin mirror is
 * apps/timetrials-android/.../rules/TimeTrialRules.kt; both are held to
 * conformance/cases.json. The evaluation order below is normative: the
 * errors list is compared in order by the conformance runners.
 *
 * Not wired into any form yet (design-system Phase 7).
 */

export const RULES_VERSION = "1.0.0";
export const SUBMISSION_CONTRACT = "mk8dx.time-trial-submission.v1";

export const RULE_IDS = [
  "track_required",
  "engine_required",
  "total_required",
  "total_format",
  "total_seconds_range",
  "total_range",
  "lap_details_require_lap_times",
  "lap_count_matches_track",
  "lap_missing",
  "lap_time_format",
  "lap_seconds_range",
  "lap_time_range",
  "lap_sum_equals_total",
  "coin_change_range",
  "coin_balance_range",
  "mushrooms_per_lap_range",
  "mushrooms_race_total",
  "loadout_id_format",
  "loadout_variant_requires_base",
] as const;

export type RuleId = typeof RULE_IDS[number];

export type LapDraft = Readonly<{
  timeDigits?: string | null;
  coinChange?: number | null;
  mushroomsUsed?: number | null;
}>;

export type LoadoutDraft = Readonly<{
  characterId?: string | null;
  characterVariantId?: string | null;
  bodyId?: string | null;
  bodyVariantId?: string | null;
  tireId?: string | null;
  gliderId?: string | null;
  gliderVariantId?: string | null;
}>;

/** Which screen a producer read, in the draft's own words (POST_A_TIME §3). */
export type ScanDraft = Readonly<{
  source?: string | null;
  observedPlayerName?: string | null;
}>;

/** The validation-relevant part of SubmissionDraft (POST_A_TIME §3). */
export type SubmissionDraft = Readonly<{
  trackId?: string | null;
  totalDigits?: string | null;
  laps?: readonly LapDraft[] | null;
  loadout?: LoadoutDraft | null;
  /** UI hints; validation ignores them (same rules for typed and scanned). */
  origin?: Readonly<Record<string, string>> | null;
  corrected?: readonly string[] | null;
  /** Present once a scan filled anything in this draft; provenance only (ADR-0204). */
  scan?: ScanDraft | null;
}>;

export type ValidationContext = Readonly<{
  engine?: number | null;
  trackLapCount: number;
  connectivity?: string | null;
}>;

export type RuleParams = Readonly<Record<string, number | string>>;

export type RuleError = Readonly<{
  field: string;
  rule: RuleId;
  messageKey: string;
  params: RuleParams;
}>;

export type PayloadLap = Readonly<{
  lapNumber: number;
  timeMs: number;
  coinsCollected?: number;
  mushroomsUsed?: number;
}>;

export type PayloadLoadout = Readonly<Partial<Record<LoadoutKey, string>>>;

/** The validation subset of TimeTrialSubmissionV1; the envelope is added by the publisher. */
export type ValidatedPayload = Readonly<{
  mode: 150 | 200;
  trackId: string;
  totalTimeMs: number;
  laps: readonly PayloadLap[];
  loadout?: PayloadLoadout;
}>;

export type ValidationResult = Readonly<{
  valid: boolean;
  errors: readonly RuleError[];
  payload: ValidatedPayload | null;
}>;

export const MAX_TIME_MS = 599_999;

export const LOADOUT_KEYS = [
  "characterId",
  "characterVariantId",
  "bodyId",
  "bodyVariantId",
  "tireId",
  "gliderId",
  "gliderVariantId",
] as const;

export type LoadoutKey = typeof LOADOUT_KEYS[number];

const ID_PART = "[a-z0-9]+(?:_[a-z0-9]+)*";
const TRACK_PATTERN = new RegExp(`^track\\.${ID_PART}$`);
const LOADOUT_PATTERNS: Readonly<Record<LoadoutKey, RegExp>> = {
  characterId: new RegExp(`^character\\.${ID_PART}$`),
  characterVariantId: new RegExp(`^character_variant\\.${ID_PART}\\.[0-9]{3}_${ID_PART}$`),
  bodyId: new RegExp(`^body\\.${ID_PART}$`),
  bodyVariantId: new RegExp(`^body_variant\\.${ID_PART}\\.[0-9]{3}_${ID_PART}$`),
  tireId: new RegExp(`^tire\\.${ID_PART}$`),
  gliderId: new RegExp(`^glider\\.${ID_PART}$`),
  gliderVariantId: new RegExp(`^glider_variant\\.${ID_PART}\\.[0-9]{3}_${ID_PART}$`),
};
const VARIANT_BASES: readonly (readonly [LoadoutKey, LoadoutKey])[] = [
  ["characterVariantId", "characterId"],
  ["bodyVariantId", "bodyId"],
  ["gliderVariantId", "gliderId"],
];

const MESSAGE_KEY_PREFIX = "tt.rules.";

type TimeCheck =
  | Readonly<{ ok: true; ms: number }>
  | Readonly<{ ok: false; rule: "format" | "seconds" | "range"; seconds?: number }>;

/** "145912" → 105912 ms. Exactly six ASCII digits M SS mmm. */
export function checkTimeDigits(digits: string): TimeCheck {
  if (!/^[0-9]{6}$/.test(digits)) { return { ok: false, rule: "format" }; }
  const minutes = Number(digits.slice(0, 1));
  const seconds = Number(digits.slice(1, 3));
  const milliseconds = Number(digits.slice(3, 6));
  if (seconds > 59) { return { ok: false, rule: "seconds", seconds }; }
  const ms = minutes * 60_000 + seconds * 1_000 + milliseconds;
  if (ms < 1 || ms > MAX_TIME_MS) { return { ok: false, rule: "range" }; }
  return { ok: true, ms };
}

/** 35392 → "035392" (the six-digit entry form). */
export function timeMsToDigits(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1_000);
  const milliseconds = ms % 1_000;
  return `${minutes}${String(seconds).padStart(2, "0")}${String(milliseconds).padStart(3, "0")}`;
}

/** 35392 → "0:35.392". */
export function formatTimeMs(ms: number): string {
  const digits = timeMsToDigits(ms);
  return `${digits.slice(0, 1)}:${digits.slice(1, 3)}.${digits.slice(3, 6)}`;
}

function text(value: string | null | undefined): string {
  return value ?? "";
}

function present(value: number | null | undefined): value is number {
  return value !== null && value !== undefined;
}

export type MissingLapSuggestion = Readonly<{
  lap: number;
  timeMs: number;
  digits: string;
}>;

/**
 * The value the one missing lap would have, from the total. Only when exactly
 * one lap row is blank, every other lap and the total are valid times, and the
 * remainder is itself a valid time. Never auto-filled (POST_A_TIME §4).
 */
export function suggestMissingLap(
  totalDigits: string | null | undefined,
  lapDigits: readonly (string | null | undefined)[],
): MissingLapSuggestion | null {
  const total = checkTimeDigits(text(totalDigits));
  if (!total.ok) { return null; }
  const blanks = lapDigits
    .map((value, index) => (text(value) === "" ? index : -1))
    .filter((index) => index >= 0);
  if (blanks.length !== 1 || lapDigits.length < 2) { return null; }
  let sum = 0;
  for (const value of lapDigits) {
    if (text(value) === "") { continue; }
    const lap = checkTimeDigits(text(value));
    if (!lap.ok) { return null; }
    sum += lap.ms;
  }
  const remainder = total.ms - sum;
  if (remainder < 1 || remainder > MAX_TIME_MS) { return null; }
  return { lap: blanks[0]! + 1, timeMs: remainder, digits: timeMsToDigits(remainder) };
}

function error(
  field: string,
  rule: RuleId,
  params: RuleParams = {},
  messageKey: string = MESSAGE_KEY_PREFIX + rule,
): RuleError {
  return { field, rule, messageKey, params };
}

export function validateDraft(
  draft: SubmissionDraft,
  context: ValidationContext,
): ValidationResult {
  const errors: RuleError[] = [];

  // 1. Track (context or TrackSelector; never the scanner).
  const trackId = text(draft.trackId);
  const trackOk = trackId.length > 0 && trackId.length <= 255 && TRACK_PATTERN.test(trackId);
  if (!trackOk) { errors.push(error("trackId", "track_required")); }

  // 2. Engine (EngineContext; never the scanner).
  const engine = context.engine;
  const engineOk = engine === 150 || engine === 200;
  if (!engineOk) { errors.push(error("mode", "engine_required")); }

  // 3. Total.
  const totalDigits = text(draft.totalDigits);
  let totalMs: number | null = null;
  if (totalDigits === "") {
    errors.push(error("totalDigits", "total_required"));
  } else {
    const total = checkTimeDigits(totalDigits);
    if (total.ok) {
      totalMs = total.ms;
    } else if (total.rule === "format") {
      errors.push(error("totalDigits", "total_format"));
    } else if (total.rule === "seconds") {
      errors.push(error("totalDigits", "total_seconds_range", { seconds: total.seconds! }));
    } else {
      errors.push(error("totalDigits", "total_range"));
    }
  }

  // 4. Laps, coins, mushrooms.
  const rows = draft.laps ?? [];
  const anyTimes = rows.some((row) => text(row.timeDigits) !== "");
  const anyCoins = rows.some((row) => present(row.coinChange));
  const anyDetails = anyCoins || rows.some((row) => present(row.mushroomsUsed));
  const lapTimes: number[] = [];
  const balances: number[] = [];
  if (!anyTimes) {
    if (anyDetails) { errors.push(error("laps", "lap_details_require_lap_times")); }
  } else if (rows.length !== context.trackLapCount) {
    errors.push(error("laps", "lap_count_matches_track", {
      expected: context.trackLapCount,
      actual: rows.length,
    }));
  } else {
    // 4a. Lap times, in lap order.
    let lapTimesOk = true;
    const suggestion = suggestMissingLap(totalDigits, rows.map((row) => row.timeDigits));
    rows.forEach((row, index) => {
      const lap = index + 1;
      const field = `laps[${index}].timeDigits`;
      const digits = text(row.timeDigits);
      if (digits === "") {
        lapTimesOk = false;
        errors.push(suggestion !== null && suggestion.lap === lap
          ? error(field, "lap_missing", {
            lap,
            suggestionMs: suggestion.timeMs,
            suggestionDigits: suggestion.digits,
          }, `${MESSAGE_KEY_PREFIX}lap_missing_suggested`)
          : error(field, "lap_missing", { lap }));
        return;
      }
      const check = checkTimeDigits(digits);
      if (check.ok) {
        lapTimes.push(check.ms);
        return;
      }
      lapTimesOk = false;
      if (check.rule === "format") {
        errors.push(error(field, "lap_time_format", { lap }));
      } else if (check.rule === "seconds") {
        errors.push(error(field, "lap_seconds_range", { lap, seconds: check.seconds! }));
      } else {
        errors.push(error(field, "lap_time_range", { lap }));
      }
    });
    // 4b. Lap sum (only when the total and every lap are valid times).
    if (lapTimesOk && totalMs !== null) {
      const lapSumMs = lapTimes.reduce((sum, value) => sum + value, 0);
      if (lapSumMs !== totalMs) {
        errors.push(error("laps", "lap_sum_equals_total", { lapSumMs, totalMs }));
      }
    }
    // 4c. Coins: signed change per lap; balance after every lap.
    if (anyCoins) {
      let changesOk = true;
      rows.forEach((row, index) => {
        const change = row.coinChange;
        if (present(change) && (!Number.isSafeInteger(change) || change < -10 || change > 10)) {
          changesOk = false;
          errors.push(error(`laps[${index}].coinChange`, "coin_change_range", {
            lap: index + 1,
            change,
          }));
        }
      });
      if (changesOk) {
        let balance = 0;
        for (let index = 0; index < rows.length; index += 1) {
          balance += rows[index]!.coinChange ?? 0;
          if (balance < 0 || balance > 10) {
            errors.push(error(`laps[${index}].coinChange`, "coin_balance_range", {
              lap: index + 1,
              balance,
            }, `${MESSAGE_KEY_PREFIX}${balance < 0 ? "coin_balance_below_zero" : "coin_balance_above_ten"}`));
            break;
          }
          balances.push(balance);
        }
      }
    }
    // 4d. Mushrooms: 0–3 per lap, at most 3 per race.
    let mushroomsOk = true;
    let mushroomTotal = 0;
    rows.forEach((row, index) => {
      const used = row.mushroomsUsed;
      if (!present(used)) { return; }
      if (!Number.isSafeInteger(used) || used < 0 || used > 3) {
        mushroomsOk = false;
        errors.push(error(`laps[${index}].mushroomsUsed`, "mushrooms_per_lap_range", {
          lap: index + 1,
        }));
        return;
      }
      mushroomTotal += used;
    });
    if (mushroomsOk && mushroomTotal > 3) {
      errors.push(error("laps", "mushrooms_race_total", { total: mushroomTotal }));
    }
  }

  // 5. Loadout (catalogue ids; a variant needs its base part).
  const loadoutDraft = draft.loadout ?? {};
  const loadout: Partial<Record<LoadoutKey, string>> = {};
  for (const key of LOADOUT_KEYS) {
    const value = text(loadoutDraft[key]);
    if (value === "") { continue; }
    if (value.length > 255 || !LOADOUT_PATTERNS[key].test(value)) {
      errors.push(error(`loadout.${key}`, "loadout_id_format", { part: key }));
      continue;
    }
    loadout[key] = value;
  }
  for (const [variant, base] of VARIANT_BASES) {
    if (text(loadoutDraft[variant]) !== "" && text(loadoutDraft[base]) === "") {
      errors.push(error(`loadout.${variant}`, "loadout_variant_requires_base", { part: variant }));
    }
  }

  if (errors.length > 0) { return { valid: false, errors, payload: null }; }

  // Normalised payload (SPEC.md "Normalisation").
  const laps: PayloadLap[] = anyTimes
    ? rows.map((row, index) => ({
      lapNumber: index + 1,
      timeMs: lapTimes[index]!,
      ...(anyCoins ? { coinsCollected: balances[index]! } : {}),
      ...(present(row.mushroomsUsed) ? { mushroomsUsed: row.mushroomsUsed } : {}),
    }))
    : [];
  const orderedLoadout: Partial<Record<LoadoutKey, string>> = {};
  for (const key of LOADOUT_KEYS) {
    if (loadout[key] !== undefined) { orderedLoadout[key] = loadout[key]; }
  }
  return {
    valid: true,
    errors: [],
    payload: {
      mode: engine as 150 | 200,
      trackId,
      totalTimeMs: totalMs!,
      laps,
      ...(Object.keys(orderedLoadout).length === 0 ? {} : { loadout: orderedLoadout }),
    },
  };
}

/**
 * Fills a message template from rules.json. Parameters whose name ends in
 * "Ms" are rendered as M:SS.mmm; "change" is rendered with its sign.
 */
export function formatMessage(template: string, params: RuleParams): string {
  return template.replace(/\{([A-Za-z]+)\}/g, (whole, name: string) => {
    const value = params[name];
    if (value === undefined) { return whole; }
    if (typeof value === "number" && name.endsWith("Ms")) { return formatTimeMs(value); }
    if (typeof value === "number" && name === "change") {
      return value > 0 ? `+${value}` : value < 0 ? `−${-value}` : "0";
    }
    return String(value);
  });
}

// --------------------------------------------------------------- provenance (ADR-0204)

/** The platform the draft is being published from. It decides only the name of the source kind. */
export type ProducerPlatform = "web" | "android";

export const CORRECTED_FIELD_GROUPS = [
  "track", "mode", "totalTime", "laps", "coins", "mushrooms",
  "character", "characterVariant", "body", "bodyVariant", "tire",
  "glider", "gliderVariant", "country", "playerName",
] as const;

export type CorrectedFieldGroup = typeof CORRECTED_FIELD_GROUPS[number];

/**
 * What the submission records about how it was filled in (ADR-0204).
 *
 * It says nothing about whether the result counts. Provenance never affects legitimacy, ranking,
 * score, competitiveness or any public trust indicator; the only existing rule that reads it is the
 * auto-publication withhold for a *failed* or *needs-review* producer check (ADR-0147), and this
 * function never produces either of those states. A form that considers a draft valid publishes
 * exactly as a typed one does.
 */
export type SubmissionProvenance = Readonly<{
  sourceKind: "web_manual" | "web_scan" | "android_manual" | "android_scan";
  captureLayout?: "time_trial_result" | "ghost_details";
  verificationStatus?: "producer_check_passed" | "not_checked";
  verificationMethod?: string;
  correctedFields?: readonly CorrectedFieldGroup[];
}>;

/** The draft's own word for a screen, mapped to the contract's (POST_A_TIME §3 vs ADR-0204 §2). */
function captureLayoutOf(source: string | null | undefined): SubmissionProvenance["captureLayout"] {
  if (source === "ghost_detail" || source === "ghost_details") { return "ghost_details"; }
  if (source === "endscreen" || source === "time_trial_result") { return "time_trial_result"; }
  return undefined;
}

/**
 * Whether anything in this draft still carries a scanner value. A field that the Player has since
 * typed over loses its "scanned" origin, but the submission stays a scan: the recognition happened,
 * and the change is recorded in `correctedFields` instead (ADR-0204 §1).
 */
export function draftWasScanned(draft: SubmissionDraft): boolean {
  if (Object.values(draft.origin ?? {}).includes("scanned")) { return true; }
  return (draft.corrected ?? []).length > 0 && draft.scan !== null && draft.scan !== undefined;
}

/** The values a scan proposes for the draft it returns into. */
export type ScanFillDraft = Readonly<{
  totalDigits?: string | null;
  /** One entry per lap, in order; empty or absent where the scan read nothing. */
  laps?: readonly (string | null | undefined)[] | null;
  loadout?: LoadoutDraft | null;
}>;

function typedAndFilled(
  draft: SubmissionDraft, field: string, current: string | null | undefined,
): boolean {
  return current !== null && current !== undefined && current !== "" &&
    (draft.origin ?? {})[field] !== "scanned";
}

/**
 * The fields a scan would overwrite and must therefore ask about first (POST_A_TIME §7): a value
 * the Player typed is theirs, so a new scan fills what is empty and proposes the rest. Field paths,
 * in draft order.
 */
export function scanConflicts(
  draft: SubmissionDraft,
  fill: ScanFillDraft,
): readonly string[] {
  const conflicts: string[] = [];
  const has = (value: string | null | undefined): boolean =>
    typeof value === "string" && value.replace(/\D/g, "") !== "";
  if (has(fill.totalDigits) && typedAndFilled(draft, "totalDigits", draft.totalDigits)) {
    conflicts.push("totalDigits");
  }
  (draft.laps ?? []).forEach((lap, index) => {
    const field = `laps[${index}].timeDigits`;
    if (has(fill.laps?.[index]) && typedAndFilled(draft, field, lap.timeDigits)) {
      conflicts.push(field);
    }
  });
  for (const key of LOADOUT_KEYS) {
    const proposed = fill.loadout?.[key];
    const field = `loadout.${key}`;
    if (typeof proposed === "string" && proposed !== "" &&
      typedAndFilled(draft, field, (draft.loadout ?? {})[key])) {
      conflicts.push(field);
    }
  }
  return conflicts;
}

export function submissionProvenance(
  draft: SubmissionDraft,
  platform: ProducerPlatform,
): SubmissionProvenance {
  const scanned = draftWasScanned(draft);
  if (!scanned) {
    return { sourceKind: platform === "android" ? "android_manual" : "web_manual" };
  }
  const corrected = [...new Set((draft.corrected ?? [])
    .filter((group): group is CorrectedFieldGroup =>
      (CORRECTED_FIELD_GROUPS as readonly string[]).includes(group)))]
    .sort((a, b) => CORRECTED_FIELD_GROUPS.indexOf(a) - CORRECTED_FIELD_GROUPS.indexOf(b));
  const layout = captureLayoutOf(draft.scan?.source);
  return {
    sourceKind: platform === "android" ? "android_scan" : "web_scan",
    ...(layout === undefined ? {} : { captureLayout: layout }),
    ...(corrected.length === 0
      ? {
          verificationStatus: "producer_check_passed" as const,
          verificationMethod: platform === "android" ? "tt_scan_lap_sum_v1" : "tt_scan_web_v1",
        }
      : {
          verificationStatus: "not_checked" as const,
          verificationMethod: "player_corrected_after_tt_scan",
          correctedFields: corrected,
        }),
  };
}
