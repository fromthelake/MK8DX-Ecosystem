import { GAME_ASSET_BASE, trackAsset } from "./asset-manifest.js";
import { engineClassBadge } from "./competitive-presentation.js";
import { platformMark, sourcePlatform } from "./platform-mark.js";

/**
 * A track, the way this product has always shown one.
 *
 * The artwork with the cup badge and engine class in the top corners, plus the
 * track name and, where space permits, cup name underneath it. Activity
 * invented it and it turned out
 * to be the thing that makes a list of results readable at a glance: you
 * recognise Mount Wario before you have read the word. Anywhere else that lists
 * tracks should look the same rather than approximate it, so this is the single
 * implementation and Activity, the public result view and the inbox all call
 * it.
 *
 * `compact` is Activity's dense row: a span rather than a link, with the engine
 * class as a badge on the art. The roomy variant is an anchor to the track and
 * carries its own accessible name.
 */
export function trackThumb(
  document: Document,
  options: Readonly<{
    trackId: string;
    mode?: 150 | 200;
    compact?: boolean;
    href?: string | null;
    showCupName?: boolean;
    sourceKind?: string;
  }>,
): HTMLElement | null {
  const asset = trackAsset(options.trackId);
  if (asset === undefined) { return null; }
  const compact = options.compact === true;
  const href = options.href === undefined
    ? `/?leaderboard=${encodeURIComponent(options.trackId)}${
      options.mode === undefined ? "" : `&mode=${options.mode}`}`
    : options.href;

  const frame = document.createElement(href === null ? "span" : "a");
  frame.className = compact && options.mode !== undefined
    ? `activity-list__thumb activity-list__thumb--${options.mode}`
    : "activity-list__thumb";
  if (href !== null) {
    frame.setAttribute("href", href);
    frame.setAttribute("aria-label", `${asset.name}, ${asset.cup.name}`);
  }

  const preview = document.createElement("img");
  preview.className = "activity-list__art";
  preview.src = `${GAME_ASSET_BASE}${asset.previewPath}`;
  preview.alt = "";
  preview.loading = "lazy";
  preview.width = 160;
  preview.height = 90;

  const badge = document.createElement("img");
  badge.className = "activity-list__cup tt-standing__track-cup";
  badge.src = `${GAME_ASSET_BASE}${asset.cup.iconPath}`;
  badge.alt = "";
  badge.loading = "lazy";

  const label = document.createElement("span");
  label.className = "activity-list__track-label tt-standing__track-label";
  const copy = document.createElement("span");
  copy.className = "activity-list__track-copy tt-standing__track-copy";
  const name = document.createElement("strong");
  name.textContent = asset.name;
  const cupName = document.createElement("small");
  cupName.textContent = asset.cup.name;
  copy.append(name);
  if (options.showCupName !== false) { copy.append(cupName); }
  label.append(copy);
  frame.append(preview, badge, label);

  if (compact && options.mode !== undefined) {
    const modeBadge = engineClassBadge(document, options.mode);
    modeBadge.textContent = `${options.mode}cc`;
    frame.append(modeBadge);
  }
  const platform = options.sourceKind === undefined ? null : sourcePlatform(options.sourceKind);
  if (compact && platform !== null) {
    const source = platformMark(document, platform);
    source.classList.add("activity-list__source");
    source.setAttribute("title", platform);
    frame.append(source);
  }
  return frame;
}
