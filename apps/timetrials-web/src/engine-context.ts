// EngineContext (docs/design-system/ENGINE_CONTEXT_INVENTORY.md §4): one way to decide which engine
// class (150cc / 200cc) a surface shows, and one way to put it into a link.
//
// Precedence, identical on web and Android: an explicit task or URL `mode` wins; then the surface's
// own last choice (where a surface keeps one); then the account's Time Trial preference when it names
// a single engine; otherwise 150. The resolved value carries its source so a surface can say why.

export type EngineMode = 150 | 200;
export type EnginePreference = "all" | "150" | "200";
export type EngineSource = "explicit" | "surface" | "preference" | "default";

export type ResolvedEngine = Readonly<{ mode: EngineMode; source: EngineSource }>;

/** Strict parse: only 150 / 200 (number or string). Anything else is not an engine. */
export function parseEngineMode(value: unknown): EngineMode | null {
  if (value === 150 || value === "150") { return 150; }
  if (value === 200 || value === "200") { return 200; }
  return null;
}

export function preferredEngine(preference: EnginePreference | null | undefined): EngineMode | null {
  return preference === "150" ? 150 : preference === "200" ? 200 : null;
}

export function resolveEngineMode(input: Readonly<{
  explicit?: EngineMode | null;
  surface?: EngineMode | null;
  preference?: EnginePreference | null;
}>): ResolvedEngine {
  if (input.explicit != null) { return { mode: input.explicit, source: "explicit" }; }
  if (input.surface != null) { return { mode: input.surface, source: "surface" }; }
  const preferred = preferredEngine(input.preference);
  if (preferred !== null) { return { mode: preferred, source: "preference" }; }
  return { mode: 150, source: "default" };
}

/**
 * Link to a track leaderboard. With a known engine the link carries it; without one the link leaves
 * the engine to the track page, which resolves it (never an invented 150).
 */
export function leaderboardHref(
  trackId: string,
  mode: EngineMode | null | undefined,
  extra: Readonly<Record<string, string>> = {},
): string {
  const parts = [`leaderboard=${encodeURIComponent(trackId)}`];
  if (mode === 150 || mode === 200) { parts.push(`mode=${mode}`); }
  for (const [key, value] of Object.entries(extra)) {
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return `/?${parts.join("&")}`;
}

/** The viewer's saved single-engine preference, or null (signed out, "all", or unavailable). */
export type EnginePreferenceReader = () => Promise<EnginePreference | null>;

export const readViewerEnginePreference: EnginePreferenceReader = async () => {
  try {
    const response = await fetch("/v1/account/time-trial-preferences", {
      method: "GET",
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      referrerPolicy: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (response.status !== 200) { return null; }
    const body = await response.json() as Readonly<Record<string, unknown>>;
    const value = body["modePreference"];
    return value === "all" || value === "150" || value === "200" ? value : null;
  } catch {
    return null;
  }
};
