// The appearance profile: System / Light / Dark (+ high contrast from the OS), with the choice
// synced to the account (ADR-0205, DESIGN_SYSTEM.md §19).
//
// Only the *choice* travels. A device set to System follows its own operating system, so two
// devices of the same person can legitimately render differently. High contrast and forced colours
// always come from the OS and are never stored.
//
// The first paint is handled by styles/ds-appearance-boot.js, a blocking same-origin head script
// (the CSP forbids inline script and the document is static). This module owns everything after
// that: explicit changes, the account round trip and the conflict rule.
//
// Text size and reduced motion are device-local by decision; they are written into the same record
// so the boot script can apply all three before the first paint.

export type AppearanceChoice = "system" | "light" | "dark";
export type TextScale = 100 | 115 | 130;
export type MotionChoice = "system" | "on";
export type ResolvedAppearance = "dark" | "light" | "hc";

export type AppearanceState = Readonly<{
  choice: AppearanceChoice;
  textScale: TextScale;
  reducedMotion: MotionChoice;
  /** When the *choice* was last changed explicitly on this device; 0 = never chosen here. */
  updatedAt: number;
  /** false = an explicit local change the account has not accepted yet. */
  synced: boolean;
}>;

export const APPEARANCE_STORAGE_KEY = "mk8dx.appearance.v1";
export const APPEARANCE_CHOICES: readonly AppearanceChoice[] = ["system", "light", "dark"];
export const TEXT_SCALES: readonly TextScale[] = [100, 115, 130];

export const DEFAULT_APPEARANCE: AppearanceState = {
  choice: "system", textScale: 100, reducedMotion: "system", updatedAt: 0, synced: true,
};

function isChoice(value: unknown): value is AppearanceChoice {
  return value === "system" || value === "light" || value === "dark";
}

/** Reads the device record. A blocked or cleared storage area is not an error: it means System. */
export function readAppearance(): AppearanceState {
  try {
    const raw = globalThis.localStorage?.getItem(APPEARANCE_STORAGE_KEY);
    if (raw === null || raw === undefined) { return DEFAULT_APPEARANCE; }
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) { return DEFAULT_APPEARANCE; }
    const row = value as Record<string, unknown>;
    const scale = row["textScale"];
    const updatedAt = row["updatedAt"];
    return {
      choice: isChoice(row["choice"]) ? row["choice"] : "system",
      textScale: scale === 115 || scale === 130 ? scale : 100,
      reducedMotion: row["reducedMotion"] === "on" ? "on" : "system",
      updatedAt: typeof updatedAt === "number" && Number.isFinite(updatedAt) && updatedAt > 0
        ? updatedAt : 0,
      synced: row["synced"] !== false,
    };
  } catch { return DEFAULT_APPEARANCE; }
}

export function writeAppearance(state: AppearanceState): void {
  try { globalThis.localStorage?.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(state)); }
  catch { /* the choice still applies to this page; it just is not remembered */ }
}

/**
 * What the device actually renders. High contrast wins over Light/Dark because it comes from the
 * operating system, and the token source carries one high-contrast profile (DESIGN_SYSTEM §6).
 */
export function resolveAppearance(
  choice: AppearanceChoice,
  environment: Readonly<{ prefersLight: boolean; prefersMoreContrast: boolean }>,
): ResolvedAppearance {
  if (environment.prefersMoreContrast) { return "hc"; }
  if (choice === "light") { return "light"; }
  if (choice === "dark") { return "dark"; }
  return environment.prefersLight ? "light" : "dark";
}

function matches(query: string): boolean {
  try { return globalThis.matchMedia?.(query).matches === true; } catch { return false; }
}

export function currentEnvironment(): Readonly<{ prefersLight: boolean; prefersMoreContrast: boolean }> {
  return {
    prefersLight: matches("(prefers-color-scheme: light)"),
    prefersMoreContrast: matches("(prefers-contrast: more)"),
  };
}

/**
 * Puts the record on the document: the same attributes the boot script writes, so a change after
 * load and a cold start end in exactly the same DOM state. `theme-color` is read back from the
 * resolved token rather than written as a literal.
 */
export function applyAppearance(documentRef: Document, state: AppearanceState): void {
  const root = documentRef.documentElement;
  root.setAttribute("data-appearance-choice", state.choice);
  if (state.textScale === 100) { root.style.removeProperty("font-size"); }
  else { root.style.setProperty("font-size", `${state.textScale}%`); }
  if (state.reducedMotion === "on") { root.setAttribute("data-reduced-motion", "on"); }
  else { root.removeAttribute("data-reduced-motion"); }
  const meta = documentRef.querySelector('meta[name="theme-color"]');
  if (meta !== null) {
    const surface = globalThis.getComputedStyle?.(root).getPropertyValue("--ds-surface-app").trim();
    if (surface !== "" && surface !== undefined) { meta.setAttribute("content", surface); }
  }
}

export type AppearanceHydration = Readonly<{
  /** The record to keep on the device. */
  next: AppearanceState;
  /** The choice to send to the account, or null when nothing has to be sent. */
  upload: AppearanceChoice | null;
  /** True when the rendered profile changes because of the account value. */
  changed: boolean;
}>;

/**
 * The conflict rule of ADR-0205 §4, as a pure function.
 *
 * - An explicit local change the account has not accepted yet wins and is uploaded
 *   (last explicit change wins), because it is newer than this hydration.
 * - Otherwise the account value is canonical and replaces the cache without a transition.
 * - An account that never chose keeps the local choice local: nothing is uploaded on its own.
 */
export function hydrateAppearance(
  local: AppearanceState,
  accountChoice: AppearanceChoice | null,
): AppearanceHydration {
  if (!local.synced && local.updatedAt > 0) {
    return { next: local, upload: local.choice, changed: false };
  }
  if (accountChoice === null) {
    return { next: local, upload: null, changed: false };
  }
  if (accountChoice === local.choice) {
    return { next: { ...local, synced: true }, upload: null, changed: false };
  }
  return {
    next: { ...local, choice: accountChoice, synced: true },
    upload: null,
    changed: true,
  };
}
