import { describe, expect, it } from "vitest";

import {
  activityLoadoutValues,
  activityLapCoinDeltas,
  activityLapMushroomValues,
  activityComparisonDeltaSemantics,
  activityComparison,
  activityComparisonForViewer,
  activitySourcePresentation,
  orderStories,
  type ActivityStory,
} from "../src/activity-stories.js";
import { trackCurrency } from "../src/track-currency.js";

const story = (
  playerId: string,
  trackId: string,
  latestAtMs: number,
): ActivityStory => ({
  player: { playerId, displayName: playerId.replace("player.", "") },
  trackId,
  mode: 150,
  runs: 1,
  startMs: 100_000,
  bestMs: 99_000,
  personalBest: false,
  runRank: 4,
  latestAtMs,
  runDetails: [{ resultId: `user_submission.time.${playerId.slice(-6)}A1`,
    timeMs: 99_000, atMs: latestAtMs, sourceKind: "android_scan" }],
});

describe("Home community activity list", () => {
  it("maps canonical producers to explicit Android, Web and Windows labels", () => {
    expect(activitySourcePresentation("android_scan").label).toBe("Posted with Android");
    expect(activitySourcePresentation("web_manual").label).toBe("Posted on Web");
    expect(activitySourcePresentation("livetrial_capture").label).toBe("Posted with Windows");
  });
  it("explains comparison direction from the viewer's perspective", () => {
    expect(activityComparison("Floyd", 99_000, 100_000)).toEqual({
      outcome: "lost", text: "Floyd is 1.000s faster than you",
    });
    expect(activityComparison("Floyd", 101_000, 100_000)).toEqual({
      outcome: "won", text: "You are 1.000s faster than Floyd",
    });
    expect(activityComparisonForViewer(
      "player.ben", "player.ben", "Ben", 99_000, 99_000,
    )).toBeNull();
  });
  it("keeps delta sign and semantic color direction in agreement", () => {
    expect(activityComparisonDeltaSemantics(400)).toEqual({
      direction: "behind", sign: "+",
    });
    expect(activityComparisonDeltaSemantics(-400)).toEqual({
      direction: "ahead", sign: "−",
    });
    expect(activityComparisonDeltaSemantics(0)).toEqual({
      direction: "equal", sign: "=",
    });
  });
  it("orders stories newest first with stable tie-breaks", () => {
    const stories = [
      story("player.leonora", "track.mute_city", 300),
      story("player.floyd", "track.mario_circuit", 900),
      story("player.ben", "track.big_blue", 500),
      // Same timestamp: player id, then track id break the tie.
      story("player.floyd", "track.big_blue", 500),
    ];
    const ordered = orderStories(stories);
    expect(ordered.map((entry) =>
      `${entry.player.playerId}:${entry.trackId}`)).toEqual([
      "player.floyd:track.mario_circuit",
      "player.ben:track.big_blue",
      "player.floyd:track.big_blue",
      "player.leonora:track.mute_city",
    ]);
    // Deterministic regardless of input order.
    expect(orderStories([...stories].reverse())).toEqual(ordered);
  });

  it("shows friendly color families when recognition variants are present", () => {
    expect(activityLoadoutValues({
      characterId: "character.yoshi",
      characterVariantId: "character_variant.yoshi.018_black",
      bodyId: "body.mr_scooty",
      bodyVariantId: "body_variant.mr_scooty.000_blue",
      tireId: "tire.roller",
      gliderId: "glider.cloud_glider",
      gliderVariantId: "glider_variant.cloud_glider.000_blue",
    })).toEqual([
      ["Character", "Yoshi · Black"],
      ["Body", "Mr. Scooty · Blue"],
      ["Tires", "Roller"],
      ["Glider", "Cloud Glider · Blue"],
    ]);
  });

  it("turns lap coin balances into compact per-lap gains and losses", () => {
    expect(activityLapCoinDeltas([
      { lapNumber: 1, timeMs: 30_000, coinsCollected: 4 },
      { lapNumber: 2, timeMs: 30_000, coinsCollected: 1 },
      { lapNumber: 3, timeMs: 30_000, coinsCollected: 6 },
    ])).toEqual([4, -3, 5]);
  });

  it("keeps mushroom use per lap and maps each special track currency", () => {
    expect(activityLapMushroomValues([
      { lapNumber: 1, timeMs: 30_000, mushroomsUsed: 2 },
      { lapNumber: 2, timeMs: 30_000 },
      { lapNumber: 3, timeMs: 30_000, mushroomsUsed: 1 },
    ])).toEqual([2, undefined, 1]);
    expect(trackCurrency("track.yoshis_island").iconPath).toContain("001_shine.png");
    expect(trackCurrency("track.hyrule_circuit").iconPath).toContain("002_rupee.png");
    expect(trackCurrency("track.animal_crossing").iconPath).toContain("003_bell.png");
    expect(trackCurrency("track.mario_circuit").iconPath).toContain("000_coin.png");
  });

});

// The session card and its runs moved to `ds-activity.ts` in Phase 12. The assertion that used to
// live here — the runs fastest first, the head marked, the rest with their gap — is made against the
// migrated feed in `ds-activity.test.ts`, which renders a real session rather than a list helper.
