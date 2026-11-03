import { describe, expect, it } from "vitest";

import {
  ACTIVITY_RELEVANCE_WINDOW_MS,
  activityFeedItemsNewestFirst,
  activityOutcome,
  activityResultDelta,
  activityStoryKey,
  bestsKey,
  buildActivityFeed,
  limitActivityFeed,
} from "../src/activity-feed-model.js";
import type {
  ActivityFeedContext,
  ActivityFilter,
} from "../src/activity-feed-model.js";
import type { ActivityStory } from "../src/activity-stories.js";

// The Android product is the current design for Home, and this port has to
// agree with `AndroidActivityFeedModel.kt` exactly: same relevance rules,
// same ordering, same cap of three on the action section.

const viewer = "player.viewer";
const NOW_MS = 10_000;
const ALL: ActivityFilter = { scope: "all", mode: "all" };

function feed(
  stories: readonly ActivityStory[],
  bests: ReadonlyMap<string, number>,
  playerId: string | null,
  filter: ActivityFilter = ALL,
  context: ActivityFeedContext = {},
) {
  return buildActivityFeed(stories, bests, playerId, filter, {
    nowMs: NOW_MS,
    ...context,
  });
}

function story(
  overrides: Partial<ActivityStory> & Pick<ActivityStory, "trackId">,
): ActivityStory {
  return {
    player: { playerId: "player.other", displayName: "Other" },
    mode: 150,
    runs: 1,
    startMs: 100_000,
    bestMs: 100_000,
    personalBest: false,
    latestAtMs: 1_000,
    runDetails: [],
    ...overrides,
  } as ActivityStory;
}

function overtaken(
  trackId: string,
  deltaMs: number,
  latestAtMs: number,
): ActivityStory {
  return story({
    trackId,
    latestAtMs,
    viewerOvertake: {
      notificationId: `notification.${trackId}`,
      actorTimeMs: 90_000,
      recipientTimeMs: 90_000 + deltaMs,
      deltaMs,
      recipientRank: 4,
    },
  });
}

describe("community activity grouping", () => {
  it("puts a signed-out visitor's feed in one plain list", () => {
    const stories = [
      story({ trackId: "track.a", latestAtMs: 1 }),
      story({ trackId: "track.b", latestAtMs: 9 }),
    ];
    const sections = feed(stories, new Map(), null);
    expect(sections.action).toEqual([]);
    expect(sections.attention).toEqual([]);
    expect(sections.ownSessions).toEqual([]);
    // Newest first, and nothing is claimed to be relevant to nobody.
    expect(sections.community.map((item) => item.story.trackId))
      .toEqual(["track.b", "track.a"]);
    expect(sections.community.every((item) => item.relevance === "other"))
      .toBe(true);
  });

  it("leads with being overtaken, closest gap first, and caps it at three", () => {
    const stories = [
      overtaken("track.far", 5_000, 10),
      overtaken("track.near", 200, 20),
      overtaken("track.mid", 900, 30),
      overtaken("track.extra", 8_000, 40),
    ];
    const sections = feed(stories, new Map(), viewer);
    expect(sections.action.map((item) => item.story.trackId))
      .toEqual(["track.near", "track.mid", "track.far"]);
    // The fourth is not dropped; it falls through to the watch list.
    expect(sections.attention.map((item) => item.story.trackId))
      .toEqual(["track.extra"]);
    expect(sections.community).toEqual([]);
  });

  it("watches somebody who is within a second of the viewer", () => {
    const bests = new Map([[bestsKey("track.close", 150), 100_000]]);
    const sections = feed([
      // 400ms behind the viewer: close enough to be worth watching.
      story({
        trackId: "track.close", bestMs: 100_400,
        personalBest: true, latestAtMs: 5,
      }),
      // Four seconds away: ordinary community activity.
      story({ trackId: "track.far", bestMs: 104_000, latestAtMs: 6 }),
    ], bests, viewer);
    expect(sections.attention.map((item) => item.story.trackId))
      .toEqual(["track.close"]);
    expect(sections.attention[0]?.relevance).toBe("threatened");
    expect(sections.community.map((item) => item.story.trackId))
      .toEqual(["track.far"]);
  });

  it("does not treat somebody already ahead of the viewer as a threat", () => {
    const bests = new Map([[bestsKey("track.a", 150), 100_000]]);
    const sections = feed([
      story({ trackId: "track.a", bestMs: 99_500, latestAtMs: 5 }),
    ], bests, viewer);
    expect(sections.attention).toEqual([]);
    expect(sections.community).toHaveLength(1);
    // The gap is still reported, and it is negative: the viewer is ahead.
    expect(sections.community[0]?.deltaMs).toBe(-500);
  });

  it("uses the shared green, red, record, and absent Activity keyline meanings", () => {
    const bests = new Map([
      [bestsKey("track.slower", 150), 99_000],
      [bestsKey("track.faster", 150), 99_000],
      [bestsKey("track.tie", 150), 99_000],
    ]);
    const sections = feed([
      story({ trackId: "track.slower", bestMs: 100_000 }),
      story({ trackId: "track.faster", bestMs: 98_000, personalBest: true }),
      story({ trackId: "track.tie", bestMs: 99_000 }),
      story({ trackId: "track.record", bestMs: 101_000, personalBest: true }),
      story({ trackId: "track.unknown", bestMs: 97_000 }),
    ], bests, viewer);
    const items = [
      ...sections.action, ...sections.rivals, ...sections.attention,
      ...sections.ownSessions, ...sections.community,
    ];
    const outcomes = new Map(items.map((item) => [item.story.trackId, activityOutcome(item)]));
    expect(outcomes).toEqual(new Map([
      ["track.slower", "won"],
      ["track.faster", "lost"],
      ["track.tie", "none"],
      ["track.record", "record"],
      ["track.unknown", "none"],
    ]));
  });

  it("keeps the viewer's sessions in diary order: newest first, PB or not", () => {
    // Owner report 2026-08-30: a days-old personal best stayed pinned above
    // newer sessions with no visible reason. The badge marks the record; the
    // order stays chronological.
    const mine = { playerId: viewer, displayName: "You" };
    const sections = feed([
      story({ trackId: "track.run", player: mine, latestAtMs: 90 }),
      story({ trackId: "track.pr", player: mine, personalBest: true, latestAtMs: 10 }),
    ], new Map(), viewer);
    expect(sections.ownSessions.map((item) => item.story.trackId))
      .toEqual(["track.run", "track.pr"]);
    expect(sections.ownSessions.map((item) => item.relevance))
      .toEqual(["own_run", "own_pr"]);
  });

  it("marks the viewer's own reference time rather than a gap to it", () => {
    const mine = { playerId: viewer, displayName: "You" };
    const bests = new Map([[bestsKey("track.a", 150), 100_000]]);
    const sections = feed([
      story({ trackId: "track.a", player: mine, bestMs: 100_000, latestAtMs: 5 }),
    ], bests, viewer);
    expect(sections.ownSessions[0]?.isReferenceRun).toBe(true);
  });

  it("uses the publication-time PB delta for own and signed-out rows", () => {
    const mine = { playerId: viewer, displayName: "You" };
    const ownItem = feed([story({
      trackId: "track.a", player: mine, personalBest: true,
      personalBestDeltaMs: 882, playerDeltaMs: -882,
    })], new Map(), viewer).ownSessions[0]!;
    expect(activityResultDelta(ownItem, viewer)).toEqual({
      milliseconds: -882,
      basis: "previous_personal_best",
      direction: "faster",
    });

    const visitorItem = feed([story({
      trackId: "track.b", personalBest: true, personalBestDeltaMs: 912,
      playerDeltaMs: -912,
    })], new Map(), null).community[0]!;
    expect(activityResultDelta(visitorItem, null)).toEqual({
      milliseconds: -912,
      basis: "previous_personal_best",
      direction: "faster",
    });
  });

  it("keeps a slower self comparison positive", () => {
    const mine = { playerId: viewer, displayName: "You" };
    const ownItem = feed([story({
      trackId: "track.a", player: mine, playerDeltaMs: 1_111,
    })], new Map(), viewer).ownSessions[0]!;
    expect(activityResultDelta(ownItem, viewer)).toEqual({
      milliseconds: 1_111,
      basis: "previous_personal_best",
      direction: "slower",
    });
  });

  it("prefers the viewer comparison on another Player and never invents a first-PB delta", () => {
    const bests = new Map([[bestsKey("track.a", 150), 99_000]]);
    const other = feed([story({
      trackId: "track.a", bestMs: 100_000, personalBest: true,
      personalBestDeltaMs: 400,
    })], bests, viewer).attention[0]!;
    expect(activityResultDelta(other, viewer)).toEqual({
      milliseconds: 1_000,
      basis: "viewer",
      // The sign rule: a slower story is red even though it favours the viewer.
      direction: "slower",
    });
    const first = feed([story({
      trackId: "track.first", personalBest: true,
    })], new Map(), null).community[0]!;
    expect(activityResultDelta(first, null)).toBeUndefined();
  });

  it("shows every session exactly once", () => {
    const mine = { playerId: viewer, displayName: "You" };
    const bests = new Map([[bestsKey("track.close", 150), 100_000]]);
    const stories = [
      overtaken("track.passed", 300, 50),
      story({ trackId: "track.close", bestMs: 100_400, latestAtMs: 40 }),
      story({ trackId: "track.mine", player: mine, personalBest: true, latestAtMs: 30 }),
      story({ trackId: "track.other", latestAtMs: 20 }),
    ];
    const sections = feed(stories, bests, viewer);
    const keys = [
      ...sections.action, ...sections.attention,
      ...sections.rivals, ...sections.ownSessions, ...sections.community,
    ].map((item) => activityStoryKey(item.story));
    expect(keys).toHaveLength(stories.length);
    expect(new Set(keys).size).toBe(stories.length);
  });

  it("filters by engine class and by the viewer's own tracks", () => {
    const bests = new Map([[bestsKey("track.mine", 150), 100_000]]);
    const stories = [
      story({ trackId: "track.mine", mode: 150, latestAtMs: 3 }),
      story({ trackId: "track.other", mode: 200, latestAtMs: 2 }),
    ];
    const only150 = feed(stories, bests, viewer, { scope: "all", mode: "150" });
    expect(only150.community.concat(only150.attention)
      .map((item) => item.story.trackId)).toEqual(["track.mine"]);
    const only200 = feed(stories, bests, viewer, { scope: "all", mode: "200" });
    expect(only200.community.map((item) => item.story.trackId))
      .toEqual(["track.other"]);
    const mine = feed(stories, bests, viewer, { scope: "my_tracks", mode: "all" });
    expect(mine.community.concat(mine.attention)
      .map((item) => item.story.trackId)).toEqual(["track.mine"]);
    // A filter that matches nothing is empty rather than falling back.
    expect(feed(stories, new Map(), viewer, { scope: "my_tracks", mode: "all" }))
      .toEqual({ action: [], rivals: [], attention: [], ownSessions: [], community: [] });
  });

  it("expires a stalled close PB after seven days", () => {
    const bests = new Map([[bestsKey("track.close", 150), 100_000]]);
    const expiryNow = ACTIVITY_RELEVANCE_WINDOW_MS * 2;
    const fresh = story({
      trackId: "track.close",
      bestMs: 100_200,
      personalBest: true,
      latestAtMs: expiryNow - ACTIVITY_RELEVANCE_WINDOW_MS,
    });
    const stale = story({
      trackId: "track.close",
      bestMs: 100_100,
      personalBest: true,
      latestAtMs: expiryNow - ACTIVITY_RELEVANCE_WINDOW_MS - 1,
    });
    const sections = feed([fresh, stale], bests, viewer, ALL, { nowMs: expiryNow });
    expect(sections.attention.map((item) => item.story.latestAtMs))
      .toEqual([fresh.latestAtMs]);
    expect(sections.community.map((item) => item.story.latestAtMs))
      .toEqual([stale.latestAtMs]);
  });

  it("prioritizes recent rivals over ordinary close PBs and filters both axes", () => {
    const bests = new Map([[bestsKey("track.close", 150), 100_000]]);
    const rival = story({
      trackId: "track.close", player: { playerId: "player.rival", displayName: "Rival" },
      bestMs: 110_000, latestAtMs: NOW_MS - 2,
    });
    const close = story({
      trackId: "track.close", player: { playerId: "player.close", displayName: "Close" },
      bestMs: 100_050, personalBest: true, latestAtMs: NOW_MS - 1,
    });
    const context = { rivalPlayerIds: new Set(["player.rival"]) };
    const sections = feed([close, rival], bests, viewer, ALL, context);
    expect(sections.rivals.map((item) => item.story.player.playerId))
      .toEqual(["player.rival"]);
    expect(sections.attention.map((item) => item.story.player.playerId))
      .toEqual(["player.close"]);
    const rival150 = feed(
      [close, rival], bests, viewer,
      { scope: "rivals", mode: "150" }, context,
    );
    expect(rival150.rivals).toHaveLength(1);
    expect(rival150.community).toEqual([]);
  });

  it("caps Home at ten with at most one first slot per rival", () => {
    const rivalStories = [
      story({ trackId: "track.a", player: { playerId: "player.a", displayName: "A" }, latestAtMs: 9_999 }),
      story({ trackId: "track.b", player: { playerId: "player.a", displayName: "A" }, latestAtMs: 9_998 }),
      story({ trackId: "track.c", player: { playerId: "player.b", displayName: "B" }, latestAtMs: 9_997 }),
      story({ trackId: "track.d", player: { playerId: "player.c", displayName: "C" }, latestAtMs: 9_996 }),
    ];
    const sections = feed(
      rivalStories, new Map(), viewer, ALL,
      { rivalPlayerIds: new Set(["player.a", "player.b", "player.c"]) },
    );
    const preview = limitActivityFeed(sections, 3);
    expect(preview.rivals.map((item) => item.story.player.playerId))
      .toEqual(["player.a", "player.b", "player.c"]);
    expect(Object.values(preview).flat()).toHaveLength(3);
  });

  it("presents the selected Home preview newest-first across relevance groups", () => {
    const own = story({
      trackId: "track.own",
      player: { playerId: viewer, displayName: "Viewer" },
      latestAtMs: 1_000,
    });
    const community = story({ trackId: "track.community", latestAtMs: 2_000 });
    const sections = feed([own, community], new Map(), viewer);
    const preview = activityFeedItemsNewestFirst(limitActivityFeed(sections, 10));
    expect(preview.map((item) => item.story.trackId))
      .toEqual(["track.community", "track.own"]);
  });
});
