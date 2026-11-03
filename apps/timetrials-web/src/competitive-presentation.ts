import { MASTERY_TIER_COLORS, type MasteryTierLabel } from "./mastery-thresholds.js";

export type DeltaPresentation = Readonly<{ text: string; color: string }>;

const channel = (from: number, to: number, amount: number): number =>
  Math.round(from + (to - from) * amount);

export function signedDuration(milliseconds: number): string {
  const value = Math.abs(Math.round(milliseconds));
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor(value / 60_000) % 60;
  const seconds = Math.floor(value / 1_000) % 60;
  const millis = String(value % 1_000).padStart(3, "0");
  const sign = milliseconds < 0 ? "−" : milliseconds > 0 ? "+" : "=";
  return `${sign}${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${millis}`;
}

export function signedTrackDuration(milliseconds: number): string {
  const value = Math.min(599_999, Math.abs(Math.round(milliseconds)));
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.floor(value / 1_000) % 60;
  const millis = String(value % 1_000).padStart(3, "0");
  const sign = milliseconds < 0 ? "−" : milliseconds > 0 ? "+" : "=";
  return `${sign}${minutes}:${String(seconds).padStart(2, "0")}.${millis}`;
}

/**
 * One product-wide delta scale: three seconds ahead is green, equal is
 * yellow and three seconds behind is red. Values outside the range retain
 * the end colour. A negative delta is always better/faster.
 */
export function deltaPresentation(milliseconds: number, fullScaleMilliseconds = 3_000): DeltaPresentation {
  if (!Number.isFinite(fullScaleMilliseconds) || fullScaleMilliseconds <= 0) throw new RangeError("delta scale must be positive");
  const clamped = Math.max(-fullScaleMilliseconds, Math.min(fullScaleMilliseconds, milliseconds));
  const amount = Math.abs(clamped) / fullScaleMilliseconds;
  const yellow = [255, 213, 79] as const;
  const end = clamped < 0 ? [46, 204, 113] as const : [239, 83, 80] as const;
  const color = `rgb(${channel(yellow[0], end[0], amount)} ${channel(yellow[1], end[1], amount)} ${channel(yellow[2], end[2], amount)})`;
  const text = signedDuration(milliseconds);
  return { text, color };
}

export function masteryBadge(document: Document, label: MasteryTierLabel): HTMLSpanElement {
  const badge = document.createElement("span");
  badge.className = "mastery-badge";
  badge.textContent = label;
  badge.style.setProperty("--mastery-color", MASTERY_TIER_COLORS[label]);
  return badge;
}

/** The engine class, in the colours it carries everywhere in both products. */
export function engineClassBadge(document: Document, mode: 150 | 200): HTMLSpanElement {
  const badge = document.createElement("span");
  badge.className = mode === 150
    ? "activity__mode activity__mode--150"
    : "activity__mode activity__mode--200";
  badge.textContent = String(mode);
  return badge;
}

export function deltaBadge(document: Document, milliseconds: number, fullScaleMilliseconds = 3_000): HTMLSpanElement {
  const presentation = deltaPresentation(milliseconds, fullScaleMilliseconds);
  const badge = document.createElement("span");
  badge.className = "delta-badge";
  badge.textContent = presentation.text;
  badge.style.setProperty("--delta-color", presentation.color);
  badge.title = "Delta: negative is faster, positive is slower";
  return badge;
}

export function trackDeltaBadge(document: Document, milliseconds: number): HTMLSpanElement {
  const presentation = deltaPresentation(milliseconds);
  const badge = document.createElement("span");
  badge.className = "delta-badge";
  badge.textContent = signedTrackDuration(milliseconds);
  badge.style.setProperty("--delta-color", presentation.color);
  badge.title = "Track delta: negative is faster, positive is slower";
  return badge;
}
