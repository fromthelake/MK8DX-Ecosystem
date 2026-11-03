// Shared Activity run summary for Home and the complete Activity feed.
// A feed row is a preview, not a navigation shortcut: activating it opens this
// bounded summary first. The reader can then deliberately open the leaderboard
// or close the dialog and remain in the feed.

import {
  button,
  chip,
  dialog,
  el,
  engineMark,
  ownerDocument,
  type OverlayHandle,
} from "./ds-components.js";
import { trackThumb } from "./track-thumb.js";
import { formatCount, formatDelta, formatTime, type NumberLanguage } from "./ds-numeric.js";
import { GAME_ASSET_BASE, trackAsset } from "./asset-manifest.js";
import {
  activityLapCoinDeltas,
  activityLapMushroomValues,
  activitySourcePresentation,
  relativeDate,
  type ActivityStory,
} from "./activity-stories.js";
import { activityResultDelta, type ActivityFeedItem } from "./activity-feed-model.js";
import {
  BODY_PARTS,
  CHARACTER_PARTS,
  GLIDER_PARTS,
  TIRE_PARTS,
} from "./loadout-manifest.js";
import { loadoutVariantById, matchedLoadoutVariant } from "./loadout-variants.js";
import { localized } from "./product-language.js";
import { trackCurrency } from "./track-currency.js";

const loadoutParts = new Map(
  [...CHARACTER_PARTS, ...BODY_PARTS, ...TIRE_PARTS, ...GLIDER_PARTS]
    .map((part) => [part.id, part] as const),
);

export type PresentedPart = Readonly<{ name: string; iconPath: string }>;

/**
 * A loadout part's name and picture. A body or glider without an explicit colour takes the one the
 * game gives it for this character (Inkling Boy's Biddybuggy is blue), as the Home cards draw it.
 */
export function presentedPart(
  baseId: string | undefined,
  explicitVariantId: string | undefined,
  characterAppearanceId: string | undefined,
): PresentedPart | undefined {
  if (baseId === undefined) { return undefined; }
  const base = loadoutParts.get(baseId);
  if (base === undefined) { return undefined; }
  const variant = loadoutVariantById(explicitVariantId) ?? (
    characterAppearanceId === undefined || baseId.startsWith("character.")
      ? undefined
      : matchedLoadoutVariant(baseId, characterAppearanceId)
  );
  return {
    name: variant === undefined ? base.name : `${base.name} · ${variant.name}`,
    iconPath: variant?.iconPath ?? base.iconPath,
  };
}

/** A part's name as the APK's run panel prints it: "Base · Variant" for an explicit variant only. */
function setupName(baseId: string | undefined, variantId: string | undefined): string | undefined {
  if (baseId === undefined) { return undefined; }
  const base = loadoutParts.get(baseId)?.name ?? baseId.substring(baseId.indexOf(".") + 1)
    .replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
  const variant = loadoutVariantById(variantId);
  return variant === undefined ? base : `${base} · ${variant.name}`;
}

/** The APK run panel's setup lines ("Character · Mario"), or its one "not recorded" line. */
function runSetup(run: ActivityStory["runDetails"][number]): HTMLElement[] {
  const loadout = run.loadout;
  const appearance = loadout?.characterVariantId ?? loadout?.characterId;
  const lines = [
    [localized("Character", "Personage"), setupName(loadout?.characterId, loadout?.characterVariantId),
      presentedPart(loadout?.characterId, loadout?.characterVariantId, appearance)],
    [localized("Body", "Kart"), setupName(loadout?.bodyId, loadout?.bodyVariantId),
      presentedPart(loadout?.bodyId, loadout?.bodyVariantId, appearance)],
    [localized("Tires", "Banden"), setupName(loadout?.tireId, undefined),
      presentedPart(loadout?.tireId, undefined, appearance)],
    [localized("Glider", "Zweefvlieger"), setupName(loadout?.gliderId, loadout?.gliderVariantId),
      presentedPart(loadout?.gliderId, loadout?.gliderVariantId, appearance)],
  ].filter((line): line is [string, string, PresentedPart | undefined] => line[1] !== undefined);
  if (lines.length === 0) {
    return [el("p", "ds-activity-summary__note", {}, localized(
      "Character and kart setup not recorded.", "Personage en kartcombinatie niet vastgelegd."))];
  }
  // The name, then the part's picture (owner 2026-09-29: "Mario 🖼").
  return lines.map(([label, value, part]) => el("p", "ds-activity-summary__setup", {},
    el("span", "", {}, `${label} · ${value}`),
    part === undefined ? null : el("img", "ds-part__icon", {
      src: `${GAME_ASSET_BASE}${part.iconPath}`, alt: "", loading: "lazy", height: "24", "aria-hidden": "true",
    })));
}

/** The APK's short source badge: Android, Windows or Web. */
function sourceLabel(sourceKind: string): string {
  const platform = activitySourcePresentation(sourceKind).platform;
  return platform === "android" ? "Android"
    : platform === "windows" ? "Windows"
      : platform === "web" ? "Web"
        : localized("Unknown source", "Onbekende bron");
}

/** The compact visual metrics Android keeps under every Home activity card. */
export function activityQuickMetrics(story: ActivityStory): HTMLElement {
  const run = [...story.runDetails].sort((left, right) => left.timeMs - right.timeMs)[0];
  const loadout = run?.loadout;
  const appearance = loadout?.characterVariantId ?? loadout?.characterId;
  const parts = [
    presentedPart(loadout?.characterId, loadout?.characterVariantId, appearance),
    presentedPart(loadout?.bodyId, loadout?.bodyVariantId, appearance),
    presentedPart(loadout?.tireId, undefined, appearance),
    presentedPart(loadout?.gliderId, loadout?.gliderVariantId, appearance),
  ];
  const combo = el("span", "ds-activity-quick__combo", {
    "aria-label": localized("Kart setup", "Kartcombinatie"),
  });
  if (parts.every((part) => part === undefined)) {
    combo.append(el("span", "ds-missing", {}, "—"));
  } else {
    for (const part of parts) {
      combo.append(part === undefined
        ? el("span", "ds-missing", {}, "—")
        : el("img", "ds-activity-quick__part", {
          src: `${GAME_ASSET_BASE}${part.iconPath}`, alt: "", title: part.name, loading: "lazy",
        }));
    }
  }
  const laps = [...(run?.laps ?? [])].sort((left, right) => left.lapNumber - right.lapNumber);
  const mushrooms = activityLapMushroomValues(laps);
  const coins = activityLapCoinDeltas(laps);
  const currency = trackCurrency(story.trackId);
  const metric = (iconPath: string, label: string, values: readonly (number | undefined)[]): HTMLElement =>
    el("span", "ds-activity-quick__metric", { "aria-label": label },
      el("img", "ds-activity-quick__icon", {
        src: `${GAME_ASSET_BASE}${iconPath}`, alt: "", loading: "lazy", "aria-hidden": "true",
      }),
      el("span", "ds-data-s", {}, values.length === 0 ? "—" : values.map((value) => value ?? "—").join("·")));
  return el("span", "ds-activity-quick", {},
    combo,
    metric("images/items/icons/014_mushroom.png", localized("Mushrooms per lap", "Paddenstoelen per ronde"), mushrooms),
    metric(currency.iconPath, currency.label, coins));
}

/**
 * One run as the APK's panel: "Run 1 · Android · Fastest ··· 1:36.934", then the lap table or its
 * "not recorded" line, then the setup lines.
 */
function runDetail(
  run: ActivityStory["runDetails"][number],
  number: number,
  fastestMs: number,
  language: NumberLanguage,
): HTMLElement {
  const head = el("div", "ds-activity-summary__run-head", {},
    el("span", "ds-activity-summary__run-name", {}, localized(`Run ${number}`, `Run ${number}`)),
    chip(sourceLabel(run.sourceKind), "neutral"),
    (run.correctedFields?.length ?? 0) > 0 ? chip(localized("Corrected", "Gecorrigeerd"), "warning") : null,
    run.timeMs === fastestMs
      ? chip(localized("Fastest", "Snelste"), "success")
      : el("span", "ds-activity-summary__gap ds-data-s", {}, formatDelta(run.timeMs - fastestMs)),
    el("span", "ds-activity-summary__run-time ds-data", {}, formatTime(run.timeMs)));
  const children: HTMLElement[] = [head];
  const laps = [...(run.laps ?? [])].sort((left, right) => left.lapNumber - right.lapNumber);
  if (laps.length === 0) {
    children.push(el("p", "ds-activity-summary__note", {}, localized(
      "Lap times and coins not recorded.", "Rondetijden en munten niet vastgelegd.")));
  } else {
    // The APK's Mk8dxTableHeader + weighted rows (.14/.34/.22/.30): a compact header and plain
    // data lines, not the site's responsive data table.
    const coins = activityLapCoinDeltas(laps);
    const mushrooms = activityLapMushroomValues(laps);
    const cell = (tag: "th" | "td", value: string, className = ""): HTMLElement =>
      el(tag, className, tag === "th" ? { scope: "col" } : {}, value);
    children.push(el("table", "ds-activity-summary__laps", {},
      el("caption", "ds-visually-hidden", {}, localized(`Details for run ${number}`, `Details van run ${number}`)),
      el("thead", "", {}, el("tr", "", {},
        cell("th", localized("Lap", "Ronde")),
        cell("th", localized("Lap time", "Rondetijd")),
        cell("th", localized("Coins", "Munten")),
        cell("th", localized("Mushrooms", "Paddenstoelen")))),
      el("tbody", "", {}, ...laps.map((lap, index) => el("tr", "", {},
        cell("td", formatCount(lap.lapNumber, language), "ds-data"),
        cell("td", formatTime(lap.timeMs), "ds-data"),
        cell("td", coins[index] === undefined ? "—" : String(coins[index]), "ds-data"),
        cell("td", mushrooms[index] === undefined ? "—" : String(mushrooms[index]), "ds-data"))))));
  }
  children.push(...runSetup(run));
  return el("section", "ds-activity-summary__run", {}, ...children);
}

export function activityStorySummary(
  item: ActivityFeedItem,
  viewerPlayerId: string | null,
  language: NumberLanguage,
  nowMs: number,
): OverlayHandle {
  // The APK's ActivityStoryDetailDialog, line for line: title and a quiet Close in the header, the
  // feed's track art beside the time, one comparison line, a panel per run, one leaderboard action.
  const story = item.story;
  const track = trackAsset(story.trackId);
  const href = `/?leaderboard=${encodeURIComponent(story.trackId)}&mode=${story.mode}`;
  const resultDelta = activityResultDelta(item, viewerPlayerId);
  const comparison = resultDelta === undefined
    ? null
    : el("p", "ds-activity-summary__comparison", {},
      el("span", "ds-delta__value ds-data", { "data-direction": resultDelta.direction },
        formatDelta(resultDelta.milliseconds)),
      " ",
      el("span", "ds-activity-summary__comparison-label", {}, resultDelta.basis === "viewer"
        ? localized("compared with your PB", "vergeleken met jouw PR")
        : localized("compared with this Player's previous PB", "vergeleken met het vorige PR van deze speler")));
  const ordered = [...story.runDetails].sort((left, right) =>
    left.timeMs - right.timeMs || left.atMs - right.atMs || left.resultId.localeCompare(right.resultId));
  const art = trackThumb(ownerDocument(), {
    trackId: story.trackId, mode: story.mode, compact: true, href: null,
    ...(ordered[0] === undefined ? {} : { sourceKind: ordered[0].sourceKind }),
  });
  const identity = el("div", "ds-activity-summary__identity", {},
    art ?? engineMark(story.mode, "plain"),
    el("div", "ds-activity-summary__headline", {},
      el("p", "ds-activity-summary__time ds-data", {}, formatTime(story.bestMs)),
      el("p", "ds-activity-summary__byline", {}, localized(
        `${story.player.displayName} · ${formatCount(story.runs, language)} ${story.runs === 1 ? "run" : "runs"} · ${relativeDate(story.latestAtMs, nowMs)}`,
        `${story.player.displayName} · ${formatCount(story.runs, language)} ${story.runs === 1 ? "run" : "runs"} · ${relativeDate(story.latestAtMs, nowMs)}`,
      ))));
  const fastest = ordered[0]?.timeMs;
  const runs = ordered.length === 0
    ? [el("p", "ds-activity-summary__note", {}, localized(
      "No detailed run data was recorded.",
      "Er zijn geen uitgebreide rundetails vastgelegd.",
    ))]
    : ordered.map((run, index) => runDetail(run, index + 1, fastest!, language));
  let handle: OverlayHandle;
  const close = button({ label: localized("Close", "Sluiten"), variant: "quiet", size: "sm", onPress: () => handle.close() });
  const leaderboard = button({
    label: localized("Open leaderboard", "Open klassement"),
    variant: "primary",
    href,
  });
  handle = dialog({
    title: track?.name ?? story.trackId,
    body: [identity, ...(comparison === null ? [] : [comparison]), ...runs,
      el("div", "ds-activity-summary__cta", {}, leaderboard.root)],
    actions: [close.root],
    actionsFirst: true,
  });
  handle.root.classList.add("ds-activity-summary");
  handle.root.addEventListener("close", () => handle.root.remove(), { once: true });
  return handle;
}

/** Makes an existing StoryCard open the summary while preserving its real destination as the CTA. */
export function bindActivityStorySummary(
  card: HTMLElement,
  item: ActivityFeedItem,
  viewerPlayerId: string | null,
  language: NumberLanguage,
  nowMs: number,
): void {
  card.setAttribute("aria-haspopup", "dialog");
  card.addEventListener("click", (event) => {
    event.preventDefault();
    activityStorySummary(item, viewerPlayerId, language, nowMs).open();
  });
}
