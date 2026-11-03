// W16 Activity (Phase 12) and R3, the one activity-feed data contract.
//
// Behaviour, not class names: the five groups in their order, a session's runs fastest-first with
// the head marked and the rest carrying their gap (the assertion `activity-stories.test.ts` used to
// make about `compactRunsList`, which this phase deleted), the lap table, the scope and engine
// filters, the sentence that says which engine classes are on screen and why, and the local,
// unsaved override for a feed the account preference narrowed.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { allByClass, byClass, descendants, FakeDocument, FakeNode, texts } from "./dom-double.js";
import { useDocument } from "../src/ds-components.js";
import { mountActivityStories } from "../src/ds-activity.js";
import {
  appliedEngineFilter,
  describeEngineFilter,
  loadCompleteActivityStories,
  showHiddenEngineLabel,
} from "../src/activity-feed-contract.js";
import type { ActivityStory } from "../src/activity-stories.js";

let document: FakeDocument;
let root: FakeNode;

beforeEach(() => {
  document = new FakeDocument();
  useDocument(document as unknown as Document);
  root = document.createElement("div");
});

const NOW = 1_800_000_000_000;
const settle = async (): Promise<void> => {
  for (let step = 0; step < 16; step += 1) { await Promise.resolve(); }
};
const all = (): string => texts(root).join(" ");

function story(overrides: Partial<ActivityStory> = {}): ActivityStory {
  return {
    player: { playerId: "player.evan", displayName: "Evan" },
    trackId: "track.water_park",
    mode: 150,
    runs: 1,
    startMs: 112_000,
    bestMs: 106_784,
    personalBest: false,
    latestAtMs: NOW - 60_000,
    runDetails: [{
      resultId: "user_submission.time.A", timeMs: 106_784, atMs: NOW - 60_000, sourceKind: "android_scan",
    }],
    ...overrides,
  } as ActivityStory;
}

const reactions = { summary: vi.fn(async () => []), react: vi.fn(), remove: vi.fn() };

function mount(stories: readonly ActivityStory[], options: Record<string, unknown> = {}) {
  return mountActivityStories(root as unknown as HTMLElement, {
    stories: async () => stories,
    viewerPlayerId: Promise.resolve("player.ben"),
    viewerBests: Promise.resolve(new Map<string, number>()),
    rivalIds: new Set<string>(),
    followedIds: new Set<string>(),
    enginePreference: Promise.resolve("all"),
    reactions: reactions as never,
    nowMs: () => NOW,
    ...options,
  } as never);
}

describe("R3 · the one activity-feed contract", () => {
  it("says which engine classes a feed holds, and why", () => {
    expect(describeEngineFilter(appliedEngineFilter("all", "all")))
      .toBe("Showing both engine classes.");
    expect(describeEngineFilter(appliedEngineFilter("200", "all")))
      .toBe("Showing 200cc only.");
    // The account preference narrowed a feed nobody narrowed by hand: that is the case a reader
    // has to be told about (§7, hidden is not zero).
    expect(describeEngineFilter(appliedEngineFilter("all", "150")))
      .toBe("Showing 150cc only — 200cc is hidden by your Time Trial preference.");
    expect(showHiddenEngineLabel(appliedEngineFilter("all", "150"))).toBe("Show 200cc anyway");
    // A chip the reader chose wins over the preference, and an override lifts the preference.
    expect(appliedEngineFilter("200", "150").source).toBe("chip");
    expect(appliedEngineFilter("all", "150", true)).toEqual({ engines: "all", source: "none" });
  });

  it("the complete feed drops the Home copy before it asks, so it cannot be the filtered one", async () => {
    const order: string[] = [];
    const discard = (): void => { order.push("discard"); };
    const load = async (): Promise<readonly ActivityStory[]> => { order.push("load"); return []; };
    await loadCompleteActivityStories(undefined, load as never, discard as never);
    expect(order).toEqual(["discard", "load"]);
  });
});

describe("W16 · the activity feed", () => {
  it("groups the feed and names each group for a signed-in reader", async () => {
    const view = mount([
      story({ player: { playerId: "player.ben", displayName: "Ben" }, personalBest: true }),
      story({ latestAtMs: NOW - 120_000, trackId: "track.mario_kart_stadium" }),
    ]);
    await view.ready;
    await settle();
    expect(all()).toContain("My sessions");
    expect(all()).toContain("Rest of the community");
    expect(allByClass(root, "ds-story").length).toBe(2);
    // The engine class is on every item, never only a colour.
    expect(allByClass(root, "ds-engine-mark").length).toBeGreaterThanOrEqual(2);
    expect(all()).toContain("150cc");
    view.unmount();
    expect(root.children).toHaveLength(0);
  });

  it("opens a run summary before navigation and keeps the reader on the feed when closed", async () => {
    const view = mount([story({
      bestMs: 106_784,
      runRank: 3,
      runDetails: [{
        resultId: "user_submission.time.A", timeMs: 106_784, atMs: NOW - 60_000,
        sourceKind: "android_scan",
        laps: [{ lapNumber: 1, timeMs: 35_000, coinsCollected: 3, mushroomsUsed: 1 }],
        loadout: {
          characterId: "character.bowser", bodyId: "body.biddybuggy",
          bodyVariantId: "body_variant.buggybud.003_yellow",
          tireId: "tire.azure_roller", gliderId: "glider.cloud_glider",
        },
      }],
    } as Partial<ActivityStory>)], {
      viewerBests: Promise.resolve(new Map([["track.water_park#150", 107_500]])),
    });
    await view.ready;
    await settle();
    const card = allByClass(root, "ds-story")[0]!;
    expect(card.getAttribute("aria-haspopup")).toBe("dialog");
    card.click();
    const summary = byClass(document.body, "ds-activity-summary")!;
    expect(summary.open).toBe(true);
    expect(summary.textContent).toContain("−0.716 compared with your PB");
    expect(summary.textContent).toContain("Run 1");
    // The APK's run panel: short source badge and one "Part · name" line per recorded part.
    expect(summary.textContent).toContain("Android");
    expect(summary.textContent).not.toContain("Posted with");
    expect(summary.textContent).toContain("Character · Bowser");
    expect(summary.textContent).toContain("Body · Biddybuggy · Yellow");
    expect(summary.textContent).toContain("Evan · 1 run · just now");
    const leaderboard = allByClass(summary, "ds-button").find((node) =>
      node.textContent === "Open leaderboard");
    expect(leaderboard?.href).toBe("/?leaderboard=track.water_park&mode=150");
    allByClass(summary, "ds-button").find((node) => node.textContent === "Close")?.click();
    expect(byClass(document.body, "ds-activity-summary")).toBeUndefined();
  });

  it("restores the viewer-relative outcome keyline on each comparable story", async () => {
    const view = mount([
      story({ trackId: "track.water_park", bestMs: 107_000 }),
      story({ trackId: "track.mario_kart_stadium", bestMs: 105_000, latestAtMs: NOW - 120_000 }),
      story({ trackId: "track.big_blue", bestMs: 104_000, personalBest: true, latestAtMs: NOW - 180_000 }),
    ], {
      viewerBests: Promise.resolve(new Map([
        ["track.water_park#150", 106_000],
        ["track.mario_kart_stadium#150", 106_000],
      ])),
    });
    await view.ready;
    await settle();
    expect(allByClass(root, "ds-story").map((card) => card.attributes.get("data-outcome")))
      .toEqual(["won", "lost", "record"]);
  });

  it("keeps an own non-PB row personal in words without assigning a competitive keyline", async () => {
    const view = mount([story({
      player: { playerId: "player.ben", displayName: "Ben" },
      bestMs: 107_000,
      personalBest: false,
    })]);
    await view.ready;
    await settle();
    const card = allByClass(root, "ds-story")[0]!;
    expect(card.attributes.get("data-kind")).toBe("you");
    expect(card.attributes.get("data-outcome")).toBe("none");
    expect(card.textContent).toContain("You");
  });

  it("puts the historical self delta below the result on the viewer's own row", async () => {
    const view = mount([story({
      player: { playerId: "player.ben", displayName: "Ben" },
      personalBest: true,
      personalBestDeltaMs: 882,
      playerDeltaMs: -882,
    })]);
    await view.ready;
    await settle();
    const result = byClass(root, "ds-story__result")!;
    expect(result.textContent).toContain("1:46.784");
    expect(result.textContent).toContain("−0.882");
    expect(byClass(result, "ds-story__delta")?.attributes.get("data-direction"))
      .toBe("faster");
    expect(byClass(result, "ds-story__result-note")?.textContent).toBe("vs previous PB");
  });

  it("a signed-out visitor gets one plain list with no group headings", async () => {
    const view = mount([story({
      personalBest: true, personalBestDeltaMs: 912, playerDeltaMs: -912,
    })],
      { viewerPlayerId: Promise.resolve(null) });
    await view.ready;
    await settle();
    expect(all()).not.toContain("Rest of the community");
    expect(allByClass(root, "ds-story")).toHaveLength(1);
    expect(byClass(root, "ds-story__delta")?.textContent).toBe("−0.912");
    expect(byClass(root, "ds-story__result-note")?.textContent).toBe("vs previous PB");
  });

  it("names a first time instead of leaving a signed-out result unexplained", async () => {
    const view = mount([story({ personalBest: true })],
      { viewerPlayerId: Promise.resolve(null) });
    await view.ready;
    await settle();
    expect(byClass(root, "ds-story__delta")).toBeUndefined();
    expect(byClass(root, "ds-story__result-note")?.textContent).toBe("First time");
  });

  it("lists a session's runs fastest first, the head marked, the rest with their gap", async () => {
    const view = mount([story({
      runs: 3,
      startMs: 112_000,
      bestMs: 106_784,
      runDetails: [
        { resultId: "user_submission.time.A", timeMs: 112_000, atMs: NOW - 1_000_000, sourceKind: "android_manual" },
        { resultId: "user_submission.time.B", timeMs: 106_784, atMs: NOW - 500_000, sourceKind: "android_scan" },
        { resultId: "user_submission.time.C", timeMs: 108_100, atMs: NOW, sourceKind: "web_manual" },
      ],
    } as Partial<ActivityStory>)]);
    await view.ready;
    await settle();
    const heads = allByClass(root, "ds-activity__run-head")
      .map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim());
    expect(heads).toHaveLength(3);
    expect(heads[0]).toContain("1:46.784");
    expect(heads[0]).toContain("fastest");
    expect(heads[1]).toContain("1:48.100");
    expect(heads[1]).toContain("+1.316");
    expect(heads[2]).toContain("1:52.000");
    expect(heads[2]).toContain("+5.216");
    // Each run says where it was submitted, as it always did.
    expect(all()).toContain("Posted with Android");
    expect(all()).toContain("Posted on Web");
  });

  it("draws a run's laps as the shared table, with the track's own currency", async () => {
    const view = mount([story({
      trackId: "track.hyrule_circuit",
      runDetails: [{
        resultId: "user_submission.time.A", timeMs: 106_784, atMs: NOW, sourceKind: "web_manual",
        laps: [
          { lapNumber: 1, timeMs: 35_000, coinsCollected: 3, mushroomsUsed: 1 },
          { lapNumber: 2, timeMs: 35_784, coinsCollected: 7, mushroomsUsed: 0 },
          { lapNumber: 3, timeMs: 36_000, coinsCollected: 10 },
        ],
      }],
    } as Partial<ActivityStory>)]);
    await view.ready;
    await settle();
    expect(byClass(root, "ds-table")).toBeDefined();
    expect(all()).toContain("0:35.000");
    // Hyrule Circuit counts rupees, not coins.
    expect(all()).toContain("Rupees");
    // A lap without a recorded value shows the missing marker, never a zero.
    expect(allByClass(root, "ds-missing").length).toBeGreaterThanOrEqual(1);
  });

  it("the scope and engine filters narrow the feed and say what is applied", async () => {
    const view = mount([
      story({ mode: 150 }),
      story({ mode: 200, trackId: "track.mario_kart_stadium", latestAtMs: NOW - 5_000 }),
    ]);
    await view.ready;
    await settle();
    expect(allByClass(root, "ds-story")).toHaveLength(2);
    expect(all()).toContain("Showing both engine classes.");
    const two = descendants(root).find((node) =>
      node.className.includes("ds-segment") && node.textContent === "200cc")!;
    two.dispatch("click");
    await settle();
    expect(allByClass(root, "ds-story")).toHaveLength(1);
    expect(all()).toContain("Showing 200cc only.");
  });

  it("a preference-narrowed feed says so and offers a local override that is never saved", async () => {
    const view = mount([story()], { enginePreference: Promise.resolve("150") });
    await view.ready;
    await settle();
    expect(all()).toContain("hidden by your Time Trial preference");
    const override = allByClass(root, "ds-button").find((node) => node.textContent === "Show 200cc anyway")!;
    override.dispatch("click");
    await settle();
    expect(all()).toContain("Showing both engine classes.");
    expect(all()).not.toContain("hidden by your Time Trial preference");
  });

  it("keeps the honest empty and unavailable states", async () => {
    const empty = mount([]);
    await empty.ready;
    await settle();
    expect(all()).toContain("No recent community activity yet");
    expect(byClass(root, "ds-state")?.attributes.get("data-state")).toBe("empty");
    empty.unmount();

    const failedRoot = document.createElement("div");
    const failed = mountActivityStories(failedRoot as unknown as HTMLElement, {
      stories: async () => { throw new Error("offline"); },
      viewerPlayerId: Promise.resolve(null),
      viewerBests: Promise.resolve(new Map<string, number>()),
      rivalIds: new Set<string>(),
      followedIds: new Set<string>(),
      enginePreference: Promise.resolve("all"),
      reactions: reactions as never,
      nowMs: () => NOW,
    } as never);
    await failed.ready;
    await settle();
    expect(texts(failedRoot).join(" ")).toContain("Community activity is temporarily unavailable.");
    expect(byClass(failedRoot, "ds-state")?.attributes.get("data-state")).toBe("error");
  });
});
