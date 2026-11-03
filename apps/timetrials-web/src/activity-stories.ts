// Community ACTIVITY STORIES — clustered sessions instead of raw event rows. The server clusters
// Player+Track+mode within a 24h window and derives honest session facts (runs, started -> best, PB,
// rank movement over current published human standings).
//
// Since Phase 12 this module is the DATA and the pure presentation rules only: the document, its
// ordering and the derivations a surface needs (lap coin deltas, mushrooms per lap, the loadout's
// readable names, the submission source, the comparison sentence). The feed itself is drawn by
// `ds-activity.ts` (W16) and `ds-home.ts` (W02) from the shared `activity-feed-model.ts`, and which
// engine classes a feed holds is stated through `activity-feed-contract.ts` (R3).

import {
  BODY_PARTS,
  CHARACTER_PARTS,
  GLIDER_PARTS,
  TIRE_PARTS,
} from "./loadout-manifest.js";
import { loadoutVariantById } from "./loadout-variants.js";
import { sourcePlatform, type ProductPlatform } from "./platform-mark.js";
import { localized } from "./product-language.js";

export type ActivityStory = Readonly<{
  player: Readonly<{
    playerId: string;
    displayName: string;
    countryId?: string;
    avatarId?: string;
  }>;
  trackId: string;
  mode: 150 | 200;
  runs: number;
  startMs: number;
  bestMs: number;
  improvedMs?: number;
  personalBest: boolean;
  personalBestDeltaMs?: number;
  /** Story best minus this Player's personal best immediately before the story. */
  playerDeltaMs?: number;
  /** Human-leaderboard position captured when this run became public. */
  runRank?: number;
  rank?: Readonly<{
    after: number;
    before?: number;
    passed: readonly Readonly<{
      playerId: string;
      displayName: string;
    }>[];
    passedCount: number;
  }>;
  latestAtMs: number;
  reactions?: Readonly<{ count: number; kinds: readonly string[] }>;
  viewerOvertake?: Readonly<{
    notificationId: string;
    actorTimeMs: number;
    recipientTimeMs: number;
    deltaMs: number;
    recipientRank: number;
  }>;
  runDetails: readonly Readonly<{
    resultId: string;
    timeMs: number;
    atMs: number;
    laps?: readonly Readonly<{
      lapNumber: number;
      timeMs: number;
      coinsCollected?: number;
      mushroomsUsed?: number;
    }>[];
    loadout?: Readonly<{
      characterId?: string;
      characterVariantId?: string;
      bodyId?: string;
      bodyVariantId?: string;
      tireId?: string;
      gliderId?: string;
      gliderVariantId?: string;
    }>;
    sourceKind: string;
    correctedFields?: readonly string[];
  }>[];
}>;

export async function fetchStories(
  signal?: AbortSignal,
): Promise<readonly ActivityStory[]> {
  const response = await fetch("/v1/public/activity-stories", {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    mode: "same-origin",
    redirect: "error",
    referrerPolicy: "same-origin",
    cache: "no-store",
    ...(signal === undefined ? {} : { signal }),
  });
  if (response.status !== 200) { throw new Error("stories unavailable"); }
  const body = await response.json() as Record<string, unknown>;
  if (body["schemaVersion"] !== "mk8dx.activity-stories.v1" ||
      !Array.isArray(body["stories"])) {
    throw new Error("stories invalid");
  }
  return body["stories"] as readonly ActivityStory[];
}

// ---------------------------------------------------------------------
// Home preview ordering (owner direction): a visual list, newest story
// on top. Clustering already prevents one Player's session from
// flooding the feed, and the ten Home slots show essentially all
// recent community life; followed Players keep a subtle marker instead
// of a reordering. Deterministic tie-breaks keep the list stable.

export function orderStories(
  stories: readonly ActivityStory[],
): readonly ActivityStory[] {
  return [...stories].sort((a, b) =>
    b.latestAtMs - a.latestAtMs ||
    a.player.playerId.localeCompare(b.player.playerId) ||
    a.trackId.localeCompare(b.trackId) ||
    a.mode - b.mode);
}

// ---------------------------------------------------------------------

function formatTime(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = milliseconds % 1_000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${
    String(millis).padStart(3, "0")}`;
}

function formatDelta(milliseconds: number): string {
  if (milliseconds < 60_000) {
    return `${(milliseconds / 1000).toFixed(3)}s`;
  }
  return formatTime(milliseconds);
}

export function activityComparisonDeltaSemantics(milliseconds: number): Readonly<{
  direction: "behind" | "ahead" | "equal";
  sign: "+" | "−" | "=";
}> {
  return milliseconds > 0
    ? { direction: "behind", sign: "+" }
    : milliseconds < 0
      ? { direction: "ahead", sign: "−" }
      : { direction: "equal", sign: "=" };
}

export function relativeDate(timestampMs: number, nowMs: number): string {
  const difference = Math.max(0, nowMs - timestampMs);
  const minutes = Math.floor(difference / 60_000);
  if (minutes < 60) {
    return minutes <= 1 ? localized("just now", "zojuist") : localized(`${minutes}m ago`, `${minutes} min geleden`);
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) { return localized(`${hours}h ago`, `${hours} u geleden`); }
  const days = Math.floor(hours / 24);
  if (days < 60) { return localized(`${days}d ago`, `${days} d geleden`); }
  const months = Math.floor(days / 30);
  return localized(`${months}mo ago`, `${months} mnd geleden`);
}

const loadoutParts = new Map(
  [...CHARACTER_PARTS, ...BODY_PARTS, ...TIRE_PARTS, ...GLIDER_PARTS]
    .map((part) => [part.id, part]),
);

function readableAsset(id: string | undefined): string | undefined {
  if (id === undefined) { return undefined; }
  return loadoutParts.get(id)?.name ?? id.substring(id.indexOf(".") + 1)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function activityLapCoinDeltas(
  laps: ActivityStory["runDetails"][number]["laps"],
): readonly (number | undefined)[] {
  let previous = 0;
  return (laps ?? []).map((lap) => {
    if (lap.coinsCollected === undefined) { return undefined; }
    const delta = lap.coinsCollected - previous;
    previous = lap.coinsCollected;
    return delta;
  });
}

export function activityLapMushroomValues(
  laps: ActivityStory["runDetails"][number]["laps"],
): readonly (number | undefined)[] {
  return (laps ?? []).map((lap) => lap.mushroomsUsed);
}

export function activityLoadoutValues(
  loadout: ActivityStory["runDetails"][number]["loadout"],
): readonly (readonly [string, string | undefined])[] {
  return [
    ["Character", friendlyVariant(loadout?.characterId, loadout?.characterVariantId)],
    ["Body", friendlyVariant(loadout?.bodyId, loadout?.bodyVariantId)],
    ["Tires", readableAsset(loadout?.tireId)],
    ["Glider", friendlyVariant(loadout?.gliderId, loadout?.gliderVariantId)],
  ];
}

function friendlyVariant(baseId: string | undefined, variantId: string | undefined): string | undefined {
  const base = readableAsset(baseId), variant = loadoutVariantById(variantId);
  if (base === undefined) return undefined;
  if (variant !== undefined) return `${base} · ${variant.name}`;
  const suffix = variantId?.match(/\.\d{3}_(.+)$/)?.[1];
  return suffix === undefined ? base : `${base} · ${suffix.replaceAll("_", " ").replace(/\b\w/g, (value) => value.toUpperCase())}`;
}

export function activitySourcePresentation(sourceKind: string): Readonly<{
  platform: ProductPlatform | null;
  label: string;
}> {
  const platform = sourcePlatform(sourceKind);
  if (platform === "android") {
    return { platform, label: localized("Posted with Android", "Geplaatst via Android") };
  }
  if (platform === "windows") {
    return { platform, label: localized("Posted with Windows", "Geplaatst via Windows") };
  }
  if (platform === "web") {
    return { platform, label: localized("Posted on Web", "Geplaatst via Web") };
  }
  return { platform: null, label: localized("Submission source unavailable", "Bron niet beschikbaar") };
}

export function activityComparison(
  playerName: string,
  storyBestMs: number,
  viewerBestMs: number,
): Readonly<{ outcome: "won" | "lost" | "tie"; text: string }> {
  const difference = storyBestMs - viewerBestMs;
  if (difference < 0) {
    return {
      outcome: "lost",
      text: localized(
        `${playerName} is ${formatDelta(-difference)} faster than you`,
        `${playerName} is ${formatDelta(-difference)} sneller dan jij`,
      ),
    };
  }
  if (difference > 0) {
    return {
      outcome: "won",
      text: localized(
        `You are ${formatDelta(difference)} faster than ${playerName}`,
        `Jij bent ${formatDelta(difference)} sneller dan ${playerName}`,
      ),
    };
  }
  return { outcome: "tie", text: localized("Exactly tied with your best", "Precies gelijk aan jouw beste tijd") };
}

export function activityComparisonForViewer(
  storyPlayerId: string,
  viewerPlayerId: string | undefined,
  playerName: string,
  storyBestMs: number,
  viewerBestMs: number | undefined,
): ReturnType<typeof activityComparison> | null {
  return viewerBestMs === undefined || storyPlayerId === viewerPlayerId
    ? null
    : activityComparison(playerName, storyBestMs, viewerBestMs);
}
