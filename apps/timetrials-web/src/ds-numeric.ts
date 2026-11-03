// Design-system numeric typography (docs/design-system/DESIGN_SYSTEM.md §10): exact, tabular values
// that never abbreviate, a rank column sized from the largest rank in the dataset, and hero ranks at
// four fixed display steps (never fluid per value). Pure functions; the components use them.

import { PRODUCT_LANGUAGES, type ProductLanguage } from "./product-language.js";

export type NumberLanguage = ProductLanguage;

const grouping = new Map<string, Intl.NumberFormat>();

function groupingFor(language: NumberLanguage): Intl.NumberFormat {
  let format = grouping.get(language);
  if (format === undefined) {
    const locale = PRODUCT_LANGUAGES.find((entry) => entry.code === language)?.locale ?? "en-GB";
    // English groups from four digits as before; every other language always groups ("1.000").
    format = new Intl.NumberFormat(locale, {
      useGrouping: language === "en" || language === "en-US" ? true : "always",
      maximumFractionDigits: 0,
    } as Intl.NumberFormatOptions);
    grouping.set(language, format);
  }
  return format;
}

/** A whole number with the language's thousands separator: EN "1,000", NL "1.000". */
export function formatCount(value: number, language: NumberLanguage): string {
  if (!Number.isFinite(value)) { throw new RangeError("not a finite number"); }
  return groupingFor(language).format(Math.trunc(value));
}

/** "#1", "#1,000" / "#1.000". */
export function formatRank(rank: number, language: NumberLanguage): string {
  if (!Number.isInteger(rank) || rank < 1) { throw new RangeError("a rank is a positive integer"); }
  return `#${formatCount(rank, language)}`;
}

/** Width of the rank column in `ch`: the formatted largest rank of the dataset, separators included. */
export function rankColumnCh(largestRank: number, language: NumberLanguage): number {
  return formatRank(Math.max(1, largestRank), language).length;
}

export type HeroRankStep = "display-2" | "display-3" | "display-4" | "display-5";

/** The fixed display step for a hero rank: 1–2 digits, 3, 4, 5+ (DESIGN_SYSTEM §3). */
export function heroRankStep(rank: number): HeroRankStep {
  const digits = String(Math.max(1, Math.trunc(rank))).length;
  return digits <= 2 ? "display-2" : digits === 3 ? "display-3" : digits === 4 ? "display-4" : "display-5";
}

/** M:SS.mmm below an hour, H:MM:SS.mmm from an hour (totals up to 16 h stay exact). */
export function formatTime(milliseconds: number): string {
  if (!Number.isInteger(milliseconds) || milliseconds < 0) { throw new RangeError("a time is a non-negative integer of ms"); }
  const ms = milliseconds % 1000;
  const totalSeconds = Math.floor(milliseconds / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const tail = `${String(seconds).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${tail}` : `${minutes}:${tail}`;
}

export const TRUE_MINUS = "−";

/**
 * A signed gap: "+0.412", "−1:02.004". Always a sign (a true minus), never colour alone. Below a
 * minute the minutes are dropped ("+0.412"); zero is "±0.000".
 */
export function formatDelta(milliseconds: number): string {
  if (!Number.isInteger(milliseconds)) { throw new RangeError("a delta is an integer of ms"); }
  if (milliseconds === 0) { return "±0.000"; }
  const sign = milliseconds < 0 ? TRUE_MINUS : "+";
  const size = Math.abs(milliseconds);
  const body = size < 60_000 ? `${Math.floor(size / 1000)}.${String(size % 1000).padStart(3, "0")}` : formatTime(size);
  return `${sign}${body}`;
}

/** Which way a delta points, for colour: faster (negative), slower (positive) or even. */
export function deltaDirection(milliseconds: number): "faster" | "slower" | "even" {
  return milliseconds < 0 ? "faster" : milliseconds > 0 ? "slower" : "even";
}
