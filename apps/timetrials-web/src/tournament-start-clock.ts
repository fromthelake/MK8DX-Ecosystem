// When the night starts, and how long that still is.
//
// The card called itself "You tonight" for a night three days away, because
// the only fact it had was a date it printed as `2026-Sep-11`. The tournament
// has always carried a start timestamp and the clock it starts by; this reads
// them, writes the day out in the reader's own language, and counts down.

import { localized, productLocaleTag } from "./product-language.js";

/** How often the countdown redraws. Seconds are what the owner asked for. */
export const START_CLOCK_TICK_MS = 1000;

function parts(timezone: string | undefined): Intl.DateTimeFormatOptions {
  return {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    ...(timezone === undefined ? {} : { timeZone: timezone }),
  };
}

/**
 * "Friday 11 September 2026 at 20:00", in the night's own time zone - the
 * clock the group chat agrees on, not the reader's laptop.
 */
export function formatTournamentStart(
  startAtMs: number, timezone?: string,
): string {
  const locale = productLocaleTag();
  let text: string;
  try {
    text = new Intl.DateTimeFormat(locale, parts(timezone))
      .format(new Date(startAtMs));
  } catch {
    // An unknown zone must not cost the reader the date.
    text = new Intl.DateTimeFormat(locale, parts(undefined))
      .format(new Date(startAtMs));
  }
  // Both locales render "<weekday> 11 September 2026 at 20:00" with a comma
  // after the weekday and a locale word before the clock; the owner asked for
  // "om", so the separator is written here rather than left to the locale.
  const cleaned = text.replace(/,/gu, "").replace(/\s+(?:at|om)\s+/u, " ");
  const [clock] = cleaned.match(/\d{2}:\d{2}$/u) ?? [];
  if (clock === undefined) { return cleaned.charAt(0).toUpperCase() + cleaned.slice(1); }
  const day = cleaned.slice(0, cleaned.length - clock.length).trim();
  const opened = `${day.charAt(0).toUpperCase()}${day.slice(1)}`;
  // A night stored with no time of its own lands on midnight. Printing
  // "at 00:00" would state an agreement the tournament never recorded.
  return clock === "00:00" ? opened : `${opened} ${localized("at", "om")} ${clock}`;
}

/**
 * Whether the night carries a time of day at all. A tournament saved with only
 * a date lands on midnight in its own zone, and counting down to that would
 * promise a start nobody agreed on.
 */
export function hasStartTime(startAtMs: number, timezone?: string): boolean {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      ...(timezone === undefined ? {} : { timeZone: timezone }),
    }).format(new Date(startAtMs)) !== "00:00";
  } catch {
    return true;
  }
}

/**
 * The gap as a clock: `1d 09:12:33`, or `09:12:33` inside a day. Compact on
 * purpose - it sits beside the tournament's name.
 */
export function formatTimeToStart(remainingMs: number): string {
  const total = Math.max(0, Math.floor(remainingMs / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600) % 24;
  const days = Math.floor(total / 86_400);
  const pad = (value: number): string => String(value).padStart(2, "0");
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return days === 0 ? clock : `${days}d ${clock}`;
}

/**
 * The ticking chip. It redraws every second while the start is still ahead,
 * and stops on its own the moment it is not; the returned function stops it
 * when the page is left before that.
 *
 * A tab in the background gets its timer throttled, which is harmless: every
 * redraw reads the clock again rather than counting its own ticks.
 */
export function bindStartCountdown(
  element: HTMLElement,
  startAtMs: number,
  now: () => number = Date.now,
): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = (): void => {
    if (timer !== undefined) { clearInterval(timer); timer = undefined; }
  };
  const draw = (): void => {
    const remaining = startAtMs - now();
    if (remaining <= 0) {
      element.textContent = localized("starting now", "start nu");
      element.title = localized("The tournament starts now", "Het toernooi start nu");
      stop();
      return;
    }
    element.textContent = `⏳ ${formatTimeToStart(remaining)}`;
    element.title = localized("Time until the start", "Tijd tot de start");
  };
  draw();
  // A start further off than a day only needs the seconds when it gets close,
  // but the owner asked to see them, and one timer costs nothing.
  timer = setInterval(draw, START_CLOCK_TICK_MS);
  return stop;
}
