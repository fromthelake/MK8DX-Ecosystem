// R3 (ENGINE_CONTEXT_INVENTORY §3): ONE activity-feed data contract for Home and `/?activity`.
//
// The defect. Home reads its stories from `/v1/home/bootstrap`, and the server silently drops every
// story of the other engine class when the account's Time Trial preference names one
// (`home-bootstrap-routes.ts`: `filteredStories`). `/?activity` reads `/v1/public/activity-stories`,
// which is not filtered. Both surfaces then built their feed with `mode: "all"` and neither said
// anything, so the same "All cc" chip meant "everything" on one page and "only your engine class"
// on the other — and because the prefetch cache answers the *public* path once from the bootstrap
// section, arriving on `/?activity` straight from Home could even hand the complete feed the
// preference-filtered copy.
//
// The contract.
//   * Every surface states which engine classes its feed actually contains, and why.
//   * The complete feed asks for the complete feed: `loadCompleteActivityStories` drops any queued
//     Home copy first, so `/?activity` can never be answered with the preference-filtered one.
//   * A feed the account preference narrowed says so in the §7 words ("hidden by your preference")
//     and offers the same local, unsaved override the rest of the product offers.
//
// No API changed: both halves are what today's endpoints already return, said out loud.
import type { ActivityModeFilter, ActivityScopeFilter } from "./activity-feed-model.js";
import { discardPreloaded } from "./preloaded-responses.js";
import { fetchStories, type ActivityStory } from "./activity-stories.js";
import { localized } from "./product-language.js";
import type { EngineMode } from "./engine-context.js";

export type EnginePreference = "all" | "150" | "200";

/** Which engine classes a feed on screen actually contains, and what narrowed it. */
export type AppliedEngineFilter = Readonly<{
  engines: "all" | EngineMode;
  /**
   * `none`   — both engine classes are in the feed;
   * `chip`   — the reader chose one on this page;
   * `preference` — the account's saved Time Trial preference narrowed it before it was sent.
   */
  source: "none" | "chip" | "preference";
}>;

/**
 * What the feed on screen is showing, from the reader's chip and the account preference. A chip is
 * the reader's own decision and wins; a preference that names one engine narrows a feed nobody
 * narrowed by hand, and that is the case the reader has to be told about (§7: hidden ≠ zero).
 */
export function appliedEngineFilter(
  chip: ActivityModeFilter,
  preference: EnginePreference,
  overridden = false,
): AppliedEngineFilter {
  if (chip === "150" || chip === "200") {
    return { engines: chip === "150" ? 150 : 200, source: "chip" };
  }
  if (!overridden && (preference === "150" || preference === "200")) {
    return { engines: preference === "150" ? 150 : 200, source: "preference" };
  }
  return { engines: "all", source: "none" };
}

/** The one sentence both surfaces print above their feed. */
export function describeEngineFilter(applied: AppliedEngineFilter): string {
  if (applied.engines === "all") {
    return localized("Showing both engine classes.", "Beide motorklassen worden getoond.");
  }
  if (applied.source === "chip") {
    return localized(`Showing ${applied.engines}cc only.`, `Alleen ${applied.engines}cc wordt getoond.`);
  }
  const hidden = applied.engines === 150 ? 200 : 150;
  return localized(
    `Showing ${applied.engines}cc only — ${hidden}cc is hidden by your Time Trial preference.`,
    `Alleen ${applied.engines}cc wordt getoond — ${hidden}cc is verborgen door je tijdritvoorkeur.`);
}

/** The label of the local, unsaved override that reveals the engine the preference hides. */
export function showHiddenEngineLabel(applied: AppliedEngineFilter): string {
  const hidden = applied.engines === 150 ? 200 : 150;
  return localized(`Show ${hidden}cc anyway`, `Toon ${hidden}cc toch`);
}

/**
 * The complete feed, never the Home preview's copy of it. The prefetch cache answers the first
 * request for `/v1/public/activity-stories` from the bootstrap's `stories` section, which the
 * server may already have narrowed to the account's preferred engine class; dropping the queued
 * sections first is what makes "the complete feed" mean the complete feed (R3).
 */
export async function loadCompleteActivityStories(
  signal?: AbortSignal,
  load: typeof fetchStories = fetchStories,
  discard: typeof discardPreloaded = discardPreloaded,
): Promise<readonly ActivityStory[]> {
  discard();
  return load(signal);
}

/** The scope chips both surfaces offer, in one place so they cannot drift apart. */
export const ACTIVITY_SCOPES: readonly Readonly<{
  value: ActivityScopeFilter; en: string; nl: string; needsViewer: boolean; needsRivals: boolean;
}>[] = [
  { value: "all", en: "All", nl: "Alles", needsViewer: false, needsRivals: false },
  { value: "rivals", en: "Rivals", nl: "Rivalen", needsViewer: true, needsRivals: true },
  { value: "my_tracks", en: "My tracks", nl: "Mijn circuits", needsViewer: true, needsRivals: false },
];

export const ACTIVITY_ENGINES: readonly Readonly<{
  value: ActivityModeFilter; en: string; nl: string;
}>[] = [
  { value: "all", en: "All cc", nl: "Alle cc" },
  { value: "150", en: "150cc", nl: "150cc" },
  { value: "200", en: "200cc", nl: "200cc" },
];
