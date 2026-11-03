import { beforeEach, describe, expect, it } from "vitest";

import { mountHome } from "../src/ds-home.js";
import { tierChip, useDocument } from "../src/ds-components.js";
import { setProductLanguage } from "../src/product-language.js";
import type { ActivityStory } from "../src/activity-stories.js";
import type { HomeComeback } from "../src/home-hero.js";
import type { FocusDocument } from "../src/home-focus.js";
import type { TrackBest } from "../src/mastery-view.js";
import { allByClass, byClass, FakeDocument, FakeNode } from "./dom-double.js";

let document: FakeDocument;
let root: FakeNode;

const NOW = 1_800_000_000_000;
const settle = async (): Promise<void> => {
  for (let step = 0; step < 16; step += 1) { await Promise.resolve(); }
};

beforeEach(() => {
  document = new FakeDocument();
  useDocument(document as unknown as Document);
  setProductLanguage("en");
  root = document.createElement("div");
});

const comeback: HomeComeback = {
  player: { playerId: "player.ben", displayName: "Ben", avatarId: "character.inkling_boy" },
  timeTrials: { standing: 3, of: 8, totalMs: 8_000_000 },
  rivals: [{
    playerId: "player.evan", displayName: "Evan",
    tracksAhead: 0, tracksBehind: 1, sharedCombos: 1, totalDeltaMs: 1_000,
  }],
  sinceMs: NOW - 86_400_000,
};

const focus: FocusDocument = {
  modePreference: "all",
  trackAccess: "base_and_bcp",
  rows: [],
};

const benBest: TrackBest = {
  trackId: "track.twisted_mansion", mode: 200, totalTimeMs: 114_826, rank: 1,
};

function activity(overrides: Partial<ActivityStory>): ActivityStory {
  return {
    player: { playerId: "player.floyd", displayName: "Floyd" },
    trackId: "track.twisted_mansion",
    mode: 200,
    runs: 1,
    startMs: 115_000,
    bestMs: 115_000,
    personalBest: false,
    latestAtMs: NOW - 7 * 86_400_000,
    runDetails: [],
    ...overrides,
  } as ActivityStory;
}

describe("W02 · signed-in Home owner review", () => {
  it("places reaction controls immediately under another Player's Home run", async () => {
    const resultId = "user_submission.time.abcdef123456";
    const asked: string[][] = [];
    const view = mountHome(root as unknown as HTMLElement, {
      loadComeback: async () => comeback,
      loadFocus: async () => focus,
      loadBests: async () => new Map([["player.ben", [benBest]]]),
      loadStandings: async () => [],
      loadStories: async () => [activity({
        runDetails: [{ resultId, timeMs: 115_000, atMs: NOW - 86_400_000,
          sourceKind: "manual", laps: [] }],
      })],
      notifications: { inbox: async () => ({ unreadCount: 0, notifications: [] }) } as never,
      tournaments: { listPublic: async () => [] } as never,
      reactions: {
        async summary(ids) { asked.push([...ids]); return [{ resultId, counts: { fire: 2 } }]; },
        async react() {}, async remove() {},
      },
      currentTimeMs: () => NOW,
    });
    await view.ready;
    await settle();
    expect(asked).toContainEqual([resultId]);
    expect(byClass(root, "ds-home__reactable")).not.toBeNull();
    expect(byClass(root, "ds-reactions__toggle")?.getAttribute("aria-label"))
      .toContain("React to this Time Trial");
    // APK Home wording and age: "🙂+ React", "7d ago"; a community row has no #1 mark.
    expect(byClass(root, "ds-reactions__toggle")?.textContent).toContain("React");
    expect(byClass(root, "ds-story__identity-meta")?.textContent).toBe("7d ago");
    expect(byClass(root, "ds-home__story-rank-mark")).toBeUndefined();
    view.unmount();
  });

  it("marks an own session that reached #1 with the APK's success chip", async () => {
    const view = mountHome(root as unknown as HTMLElement, {
      loadComeback: async () => comeback,
      loadFocus: async () => focus,
      loadBests: async () => new Map([["player.ben", [benBest]]]),
      loadStandings: async () => [],
      loadStories: async () => [activity({
        player: { playerId: "player.ben", displayName: "Ben" },
        bestMs: 114_826, personalBest: true, rank: { after: 1, passed: [], passedCount: 0 },
        runDetails: [{ resultId: "user_submission.time.own000000001", timeMs: 114_826,
          atMs: NOW - 86_400_000, sourceKind: "manual", laps: [] }],
      })],
      notifications: { inbox: async () => ({ unreadCount: 0, notifications: [] }) } as never,
      tournaments: { listPublic: async () => [] } as never,
      currentTimeMs: () => NOW,
    });
    await view.ready;
    await settle();
    expect(byClass(root, "ds-home__story-rank-mark")?.textContent).toBe("#1");
    view.unmount();
  });
  it("uses Stadium as introductory art until a Player publishes a time", async () => {
    const view = mountHome(root as unknown as HTMLElement, {
      loadComeback: async () => ({ ...comeback, timeTrials: { standing: 0, of: 8, totalMs: 0 }, rivals: [] }),
      loadFocus: async () => focus,
      loadBests: async () => new Map([["player.ben", []]]),
      loadStandings: async () => [],
      loadStories: async () => [],
      notifications: { inbox: async () => ({ unreadCount: 0, notifications: [] }) } as never,
      tournaments: { listPublic: async () => [] } as never,
      currentTimeMs: () => NOW,
    });
    await view.ready;
    await settle();

    expect(byClass(root, "ds-hero__backdrop")?.getAttribute("src"))
      .toContain("mario_kart_stadium");
    expect(byClass(root, "ds-hero__aside")?.textContent).toContain("Post a time");
  });

  it("uses the APK's readable ink on solid product-data tier colours", () => {
    expect(tierChip("Champion", "#F59E0B").style.getPropertyValue("--ds-tier-ink"))
      .toBe("#0B0D12");
    expect(tierChip("Advanced B", "#388E3C").style.getPropertyValue("--ds-tier-ink"))
      .toBe("#FFFFFF");
  });

  it("keeps identity art square, fills honest focus slots and presents the feed chronologically", async () => {
    let compact = true;
    let onLayoutChange = (): void => undefined;
    document.defaultView = {
      matchMedia: () => ({
        get matches() { return compact; },
        addEventListener: (_type: string, listener: () => void) => { onLayoutChange = listener; },
        removeEventListener: () => undefined,
      }),
    };
    const stories = [
      activity({
        player: { playerId: "player.ben", displayName: "Ben" },
        trackId: "track.mario_kart_stadium", latestAtMs: NOW - 10 * 86_400_000,
        playerDeltaMs: 2_647,
      }),
      activity({ bestMs: 115_720, playerDeltaMs: -500 }),
    ];
    const view = mountHome(root as unknown as HTMLElement, {
      loadComeback: async () => comeback,
      loadFocus: async () => focus,
      loadBests: async () => new Map([
        ["player.ben", [benBest]],
        ["player.evan", []],
      ]),
      loadStandings: async (mode) => mode === 150 ? [
        { rank: 2, playerId: "player.other", playerDisplayName: "Other", mode, totalTimeMs: 7_900_000, averageTimeMs: 82_292, playedTracks: 96, goldMedals: 0, silverMedals: 0, bronzeMedals: 0 },
        { rank: 3, playerId: "player.ben", playerDisplayName: "Ben", mode, totalTimeMs: 8_000_000, averageTimeMs: 83_333, playedTracks: 96, goldMedals: 0, silverMedals: 0, bronzeMedals: 0 },
      ] : [
        { rank: 1, playerId: "player.other", playerDisplayName: "Other", mode, totalTimeMs: 57_000_000, averageTimeMs: 593_750, playedTracks: 2, goldMedals: 0, silverMedals: 0, bronzeMedals: 0 },
        { rank: 2, playerId: "player.ben", playerDisplayName: "Ben", mode, totalTimeMs: 57_114_826, averageTimeMs: 594_946, playedTracks: 1, goldMedals: 1, silverMedals: 0, bronzeMedals: 0 },
      ],
      loadStories: async () => stories,
      notifications: { inbox: async () => ({
        unreadCount: 2,
        notifications: [
          {
            notificationId: "2", kind: "poke", actorPlayerId: "player.evan",
            actorDisplayName: "Evan", count: 1, lastEventAtMs: NOW - 120_000, read: false,
          },
          {
            notificationId: "3", kind: "world_record", actorPlayerId: "player.evan",
            actorDisplayName: "Evan", trackId: "track.mount_wario", mode: 150,
            count: 1, lastEventAtMs: NOW - 180_000, read: false,
          },
        ],
      }) } as never,
      tournaments: { listPublic: async () => [] } as never,
      currentTimeMs: () => NOW,
    });
    await view.ready;
    await settle();

    allByClass(root, "ds-engine-option")
      .find((option) => option.getAttribute("data-engine") === "200")
      ?.click();

    expect(byClass(root, "ds-hero__thumb")?.getAttribute("data-shape")).toBe("square");
    expect(byClass(root, "ds-hero__backdrop")?.getAttribute("src"))
      .toContain("mario_kart_stadium");
    expect(allByClass(root, "ds-home__standing-value").map((value) => value.textContent))
      .toEqual(["#3 of 8"]);
    expect(allByClass(root, "ds-hero-rank")).toHaveLength(0);
    expect(byClass(root, "ds-home__columns")).not.toBeNull();
    expect(byClass(root, "ds-home__main-column")).not.toBeNull();
    expect(byClass(root, "ds-home__side-column")).not.toBeNull();
    // Focus and Journey carry the engine selector; there is no separate row above Focus.
    expect(byClass(root, "ds-home__engine-row")).toBeUndefined();
    expect(byClass(root, "ds-home__main-column")?.children.map((child) => child.className)).toEqual([
      "ds-home__journey",
      "ds-home__focus",
      "ds-home__away",
      "ds-home__inbox",
      "ds-home__feed",
      "ds-home__night",
      "ds-home__places",
    ]);
    expect(byClass(root, "ds-home__side-column")?.children.map((child) => child.className))
      .toEqual([]);
    expect(byClass(root, "ds-home__journey-grid")?.children).toHaveLength(4);
    expect(allByClass(root, "ds-journey__percentage")).toHaveLength(4);
    compact = false;
    onLayoutChange();
    expect(byClass(root, "ds-home__main-column")?.children.map((child) => child.className)).toEqual([
      "ds-home__focus",
      "ds-home__away",
      "ds-home__feed",
    ]);
    expect(byClass(root, "ds-home__side-column")?.children.map((child) => child.className)).toEqual([
      "ds-home__night",
      "ds-home__journey",
      "ds-home__inbox",
      "ds-home__places",
    ]);
    compact = true;
    onLayoutChange();
    expect(view.engine()).toBe(200);

    const cards = allByClass(root, "ds-focus");
    expect(cards).toHaveLength(3);
    expect(cards.map((card) => allByClass(card, "ds-focus__label")[0]?.getAttribute("data-tone")))
      .toEqual(["neutral", "info", "warning"]);
    expect(cards.map((card) => allByClass(card, "ds-focus__label")[0]?.classList.contains("ds-slant")))
      .toEqual([true, true, true]);
    expect(allByClass(root, "ds-focus__engine")).toHaveLength(3);
    expect(allByClass(root, "ds-focus__facts")).toHaveLength(1);
    expect(cards.filter((card) => card.getAttribute("data-placeholder") !== null)).toHaveLength(2);
    expect(cards.map((card) => card.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining("No selected rival time yet"),
      expect.stringContaining("Next trackMario Kart Stadium"),
      expect.stringContaining("Nintendo"),
      expect.stringContaining("WR"),
    ]));
    const mastery = allByClass(cards[0]!, "ds-tier-chip");
    expect(mastery.map((chip) => chip.textContent)).toEqual(["Beg B", "Beg A"]);
    expect(mastery[1]?.style.getPropertyValue("--ds-tier-colour")).toBe("#FF7043");
    expect(allByClass(cards[1]!, "ds-tier-chip").map((chip) => chip.textContent))
      .toEqual(["Target · Int B"]);
    expect(allByClass(cards[2]!, "ds-tier-chip").map((chip) => chip.textContent))
      .toEqual(["Noob"]);
    expect(root.textContent).toContain("−1:54.827 → #1");
    const targetLinks200 = allByClass(root, "ds-home__targets")
      .flatMap((target) => allByClass(target, "ds-journey"));
    expect(targetLinks200).toHaveLength(2);
    expect(targetLinks200.map((target) => target.getAttribute("href"))).toEqual([
      "/?ranking=timetrials&tab=total&mode=200&scope=all",
      "/?ranking=timetrials&tab=total&mode=200&scope=all",
    ]);

    const rows = allByClass(root, "ds-story");
    expect(rows).toHaveLength(2);
    // Native grouping deliberately puts the viewer's session before the community group.
    expect(byClass(rows[0]!, "ds-story__result-note")?.textContent).toBe("vs previous PB");
    expect(byClass(rows[1]!, "ds-story__result-note")?.textContent).toBe("vs you");
    expect(allByClass(root, "ds-home__feed-group").map((group) => group.textContent))
      .toEqual(["My sessions", "Rest of the community"]);
    expect(allByClass(root, "ds-activity-quick")).toHaveLength(2);
    expect(allByClass(root, "ds-home__feed-scope")).toHaveLength(1);
    expect(allByClass(root, "ds-home__feed-scope")
      .flatMap((scope) => allByClass(scope, "ds-filter-chip"))).toHaveLength(3);
    expect(allByClass(rows[0]!, "ds-story__identity-meta")).toHaveLength(1);
    expect(allByClass(rows[0]!, "ds-story__result")[0]?.textContent).toContain("PB");
    expect(allByClass(rows[0]!, "ds-you-chip")).toHaveLength(0);
    expect(allByClass(root, "activity-list__thumb")).toHaveLength(3);
    expect(root.textContent).toContain("Community activityView all activity");
    expect(root.textContent).toContain("Recent key events");
    expect(root.textContent).toContain("No key events in the last 7 days.");
    const notices = allByClass(root, "ds-home__notice-row");
    expect(notices).toHaveLength(2);
    expect(notices[0]?.className).toContain("ds-home__notice-row--text");
    expect(notices[1]?.className).not.toContain("ds-home__notice-row--text");
    expect(allByClass(notices[1]!, "ds-home__notice-art")).toHaveLength(1);
    expect(notices[1]?.textContent).not.toContain("Mushroom Cup");
    expect(byClass(root, "ds-home__inbox-compact")?.textContent)
      .toContain("2 unread notificationsOpen inbox");
    expect(byClass(root, "ds-home__inbox-detail")).not.toBeNull();

    const panelSelectors = allByClass(root, "ds-panel__actions")
      .flatMap((actions) => allByClass(actions, "ds-engine-selector"));
    expect(panelSelectors).toHaveLength(2);
    allByClass(panelSelectors[0]!, "ds-engine-option")
      .find((control) => control.getAttribute("data-engine") === "150")
      ?.click();
    expect(view.engine()).toBe(150);
    // The detached desktop selector is not left in the compact DOM; Journey and Focus keep the
    // shared state, while CSS exposes only Journey's native-aligned control on the phone.
    expect(allByClass(root, "ds-engine-selector")).toHaveLength(2);
    expect(root.textContent).toContain("−1:40.001 → #2");
    expect(allByClass(root, "ds-home__targets")
      .flatMap((target) => allByClass(target, "ds-journey"))
      .every((target) => target.getAttribute("href") ===
        "/?ranking=timetrials&tab=total&mode=150&scope=all")).toBe(true);
  });

  it("renders all achievements from one published run as one key-event card", async () => {
    const runAt = NOW - 60_000;
    const story = activity({
      player: comeback.player,
      bestMs: benBest.totalTimeMs,
      personalBest: true,
      personalBestDeltaMs: 2_000,
      latestAtMs: runAt,
      rank: { after: 1, before: 2, passed: [], passedCount: 0 },
      runDetails: [{
        resultId: "result.grouped", timeMs: benBest.totalTimeMs,
        atMs: runAt, sourceKind: "manual",
      }],
    });
    const view = mountHome(root as unknown as HTMLElement, {
      loadComeback: async () => comeback,
      loadFocus: async () => focus,
      loadBests: async () => new Map([
        ["player.ben", [benBest]],
        ["player.evan", [{ ...benBest, totalTimeMs: benBest.totalTimeMs + 500, rank: 2 }]],
      ]),
      loadStandings: async () => [],
      loadStories: async () => [story],
      notifications: { inbox: async () => ({ unreadCount: 0, notifications: [] }) } as never,
      tournaments: { listPublic: async () => [] } as never,
      currentTimeMs: () => NOW,
    });
    await view.ready;
    await settle();

    const cards = allByClass(root, "ds-home__key-event");
    expect(cards).toHaveLength(1);
    expect(allByClass(cards[0]!, "ds-home__key-event-link")[0]?.getAttribute("href"))
      .toBe("/?leaderboard=track.twisted_mansion&mode=200");
    expect(allByClass(cards[0]!, "ds-engine-mark")[0]?.getAttribute("data-size")).toBe("md");
    expect(cards[0]?.textContent).toContain("Passed Evan ✓ · lead 0.500s.");
    expect(cards[0]?.textContent).toContain("Track rank: #2 → 🏆 #1.");
    expect(cards[0]?.textContent).toContain("PB improvement: −2.000");
    expect(allByClass(cards[0]!, "ds-home__key-event-bullet").length).toBeGreaterThanOrEqual(3);
    expect(allByClass(cards[0]!, "ds-home__key-event-secondary")).toHaveLength(1);
  });
});
