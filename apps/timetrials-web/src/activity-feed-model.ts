// How Community activity is grouped, ported from the Android product.
//
// Relevance decides which stories earn a place in the finite Home preview and
// how the complete Activity route groups them. Home presents that selected set
// newest-first, because it has no section headings to explain grouped ordering.
//
// This is a faithful port of `AndroidActivityFeedModel.kt` - same relevance
// rules, same ordering, same cap of three on the action section - so the two
// products cannot drift into disagreeing about what matters.

import type { ActivityStory } from "./activity-stories.js";

export type ActivityRelevance =
  | "overtaken"
  | "rival"
  | "threatened"
  | "own_pr"
  | "own_run"
  | "other";

export type ActivityScopeFilter = "all" | "rivals" | "my_tracks";
export type ActivityModeFilter = "all" | "150" | "200";
export type ActivityFilter = Readonly<{
  scope: ActivityScopeFilter;
  mode: ActivityModeFilter;
}>;

export type ActivityFeedContext = Readonly<{
  rivalPlayerIds?: ReadonlySet<string>;
  nowMs?: number;
}>;

export type ActivityFeedItem = Readonly<{
  story: ActivityStory;
  relevance: ActivityRelevance;
  /**
   * How this session compares with the viewer's own best on the same track and
   * engine class: negative when the session is faster. Undefined when the
   * viewer has no time there.
   */
  deltaMs?: number;
  /** This session *is* the viewer's own reference time, not a gap to it. */
  isReferenceRun: boolean;
  /**
   * This run measured against the viewer's best: positive when the viewer is
   * faster. Undefined on the viewer's own rows and where there is no best to
   * compare with. Unlike `deltaMs`, this never substitutes notification data.
   */
  comparisonMs?: number;
}>;

/** The competitive keyline carried by an Activity row on both clients. */
export type ActivityOutcome = "won" | "lost" | "record" | "none";

export type ActivityResultDelta = Readonly<{
  /** The signed number printed below the story time. */
  milliseconds: number;
  /** What the number is measured against, so the view can explain it honestly. */
  basis: "viewer" | "previous_personal_best";
  /**
   * Colour meaning, always following the printed sign (design-system delta
   * rule, as on Android): a plus is slower/red even when it favours the viewer.
   */
  direction: "faster" | "slower" | "even";
}>;

/**
 * Pick the one compact delta that belongs next to a story result.
 *
 * Another Player is compared with the signed-in viewer when that comparison
 * exists. The viewer's own row, a visitor's feed, and an otherwise
 * incomparable story use the immutable comparison with that Player's previous
 * PB captured when the story was published. A first-ever time has no previous
 * time, so it has no invented zero delta.
 */
export function activityResultDelta(
  item: ActivityFeedItem,
  viewerPlayerId: string | null,
): ActivityResultDelta | undefined {
  const own = viewerPlayerId !== null &&
    item.story.player.playerId === viewerPlayerId;
  if (!own && viewerPlayerId !== null && item.comparisonMs !== undefined) {
    return {
      milliseconds: item.comparisonMs,
      basis: "viewer",
      direction: item.comparisonMs < 0
        ? "faster"
        : item.comparisonMs > 0 ? "slower" : "even",
    };
  }
  const selfDelta = item.story.playerDeltaMs ??
    (item.story.personalBestDeltaMs === undefined
      ? undefined
      : -item.story.personalBestDeltaMs);
  if (selfDelta !== undefined) {
    return {
      milliseconds: selfDelta,
      basis: "previous_personal_best",
      direction: selfDelta < 0
        ? "faster"
        : selfDelta > 0 ? "slower" : "even",
    };
  }
  return undefined;
}

export function activityOutcome(item: ActivityFeedItem): ActivityOutcome {
  const comparison = item.comparisonMs;
  if (comparison !== undefined && comparison > 0) { return "won"; }
  if (comparison !== undefined && comparison < 0) { return "lost"; }
  return item.story.personalBest ? "record" : "none";
}

export type ActivityFeedSections = Readonly<{
  action: readonly ActivityFeedItem[];
  rivals: readonly ActivityFeedItem[];
  attention: readonly ActivityFeedItem[];
  ownSessions: readonly ActivityFeedItem[];
  community: readonly ActivityFeedItem[];
}>;

/** A session is one Player on one track and class at one moment. */
export function activityStoryKey(story: ActivityStory): string {
  return `${story.player.playerId}#${story.trackId}#${story.mode}#${story.latestAtMs}`;
}

export function bestsKey(trackId: string, mode: 150 | 200): string {
  return `${trackId}#${mode}`;
}

const ACTION_LIMIT = 3;
export const ACTIVITY_HOME_LIMIT = 10;
export const RIVAL_HOME_LIMIT = 3;
export const ATTENTION_HOME_LIMIT = 2;
export const OWN_SESSION_HOME_LIMIT = 2;
/** A close time is only active pressure while the PB event is still recent. */
const THREATENED_WINDOW_MS = 1_000;
export const ACTIVITY_RELEVANCE_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

function byLatestDescending(a: ActivityFeedItem, b: ActivityFeedItem): number {
  return b.story.latestAtMs - a.story.latestAtMs
    || activityStoryKey(a.story).localeCompare(activityStoryKey(b.story));
}

function magnitude(item: ActivityFeedItem): number {
  return item.deltaMs === undefined
    ? Number.MAX_SAFE_INTEGER
    : Math.abs(item.deltaMs);
}

export function buildActivityFeed(
  stories: readonly ActivityStory[],
  ownBests: ReadonlyMap<string, number>,
  viewerPlayerId: string | null,
  filter: ActivityFilter = { scope: "all", mode: "all" },
  context: ActivityFeedContext = {},
): ActivityFeedSections {
  const nowMs = context.nowMs ?? new Date().getTime();
  const rivals = context.rivalPlayerIds ?? new Set<string>();
  const visible: ActivityFeedItem[] = [];
  for (const story of stories) {
    const key = bestsKey(story.trackId, story.mode);
    const matchesMode = filter.mode === "all" ||
      (filter.mode === "150" && story.mode === 150) ||
      (filter.mode === "200" && story.mode === 200);
    const matchesScope = filter.scope === "all" ||
      (filter.scope === "rivals" && rivals.has(story.player.playerId)) ||
      (filter.scope === "my_tracks" && ownBests.has(key));
    const matches = matchesMode && matchesScope;
    if (!matches) { continue; }
    const own = viewerPlayerId !== null &&
      story.player.playerId === viewerPlayerId;
    const ownBest = ownBests.get(key);
    const delta = story.viewerOvertake?.deltaMs ??
      (ownBest === undefined ? undefined : story.bestMs - ownBest);
    const comparison = own || ownBest === undefined
      ? undefined
      : story.bestMs - ownBest;
    const recent = story.latestAtMs <= nowMs &&
      nowMs - story.latestAtMs <= ACTIVITY_RELEVANCE_WINDOW_MS;
    const relevance: ActivityRelevance = viewerPlayerId === null
      ? "other"
      : story.viewerOvertake !== undefined
        ? "overtaken"
        : own && story.personalBest
          ? "own_pr"
          : own
            ? "own_run"
            : rivals.has(story.player.playerId) && recent
              ? "rival"
              : story.personalBest && recent && delta !== undefined &&
                  delta > 0 && delta <= THREATENED_WINDOW_MS
                ? "threatened"
                : "other";
    visible.push({
      story,
      relevance,
      ...(delta === undefined ? {} : { deltaMs: delta }),
      isReferenceRun: own && ownBest !== undefined && story.bestMs === ownBest,
      ...(comparison === undefined ? {} : { comparisonMs: comparison }),
    });
  }

  // A signed-out visitor has no stake in any of it, so nothing is grouped.
  if (viewerPlayerId === null) {
    return {
      action: [],
      rivals: [],
      attention: [],
      ownSessions: [],
      community: [...visible].sort(byLatestDescending),
    };
  }

  const action = visible
    .filter((item) => item.relevance === "overtaken")
    .sort((a, b) => magnitude(a) - magnitude(b) || byLatestDescending(a, b))
    .slice(0, ACTION_LIMIT);
  const actionKeys = new Set(action.map((item) => activityStoryKey(item.story)));

  const rivalActivity = visible
    .filter((item) => item.relevance === "rival")
    .sort(byLatestDescending);

  const attention = visible
    .filter((item) =>
      (item.relevance === "overtaken" || item.relevance === "threatened") &&
      !actionKeys.has(activityStoryKey(item.story)))
    .sort((a, b) =>
      (a.relevance === "overtaken" ? 0 : 1) - (b.relevance === "overtaken" ? 0 : 1) ||
      magnitude(a) - magnitude(b) ||
      byLatestDescending(a, b));

  // Sessions read as a diary: newest first, always. A personal best keeps
  // its badge but no longer pins an old story above newer sessions (owner
  // report 2026-08-30, mirrored in AndroidActivityFeedModel.kt).
  const ownSessions = visible
    .filter((item) => item.relevance === "own_pr" || item.relevance === "own_run")
    .sort(byLatestDescending);

  const reserved = new Set(
    [...action, ...rivalActivity, ...attention, ...ownSessions]
      .map((item) => activityStoryKey(item.story)),
  );
  const community = visible
    .filter((item) => !reserved.has(activityStoryKey(item.story)))
    .sort(byLatestDescending);

  return { action, rivals: rivalActivity, attention, ownSessions, community };
}

function fairRivalPreview(
  items: readonly ActivityFeedItem[],
  limit: number,
): readonly ActivityFeedItem[] {
  const firstPerRival: ActivityFeedItem[] = [];
  const remaining: ActivityFeedItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.story.player.playerId)) {
      remaining.push(item);
    } else {
      seen.add(item.story.player.playerId);
      firstPerRival.push(item);
    }
  }
  return [...firstPerRival, ...remaining].slice(0, limit);
}

/** Keep Home finite while the complete Activity route retains every story. */
export function limitActivityFeed(
  sections: ActivityFeedSections,
  totalLimit: number,
): ActivityFeedSections {
  let remaining = Math.max(0, totalLimit);
  const take = <T>(items: readonly T[], maximum: number): readonly T[] => {
    const selected = items.slice(0, Math.min(maximum, remaining));
    remaining -= selected.length;
    return selected;
  };
  const action = take(sections.action, ACTION_LIMIT);
  const rivals = fairRivalPreview(
    sections.rivals,
    Math.min(RIVAL_HOME_LIMIT, remaining),
  );
  remaining -= rivals.length;
  const attention = take(sections.attention, ATTENTION_HOME_LIMIT);
  const ownSessions = take(sections.ownSessions, OWN_SESSION_HOME_LIMIT);
  const community = sections.community.slice(0, remaining);
  return { action, rivals, attention, ownSessions, community };
}

/** Flatten a relevance-selected Home preview into the chronological order readers expect. */
export function activityFeedItemsNewestFirst(
  sections: ActivityFeedSections,
): readonly ActivityFeedItem[] {
  return [
    ...sections.action,
    ...sections.rivals,
    ...sections.attention,
    ...sections.ownSessions,
    ...sections.community,
  ].sort(byLatestDescending);
}
