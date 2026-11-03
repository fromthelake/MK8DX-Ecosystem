// W12 Compare, W13 Records, W15 Community and W28 My records & stats (Phase 12): behaviour and the
// design-system contract, not class names.
//
// This replaces `compare-view.test.ts`, `records-view.test.ts` and `player-insights-section.test.ts`,
// which pinned the deleted `compare__*`, `records__*` and `player-insights__*` layers and the
// borrowed `track-board__mode` buttons. Every capability they asserted is asserted here, plus what
// the migration added: one EngineSelector per engine-dependent route, the switch replacing every
// dependent value, the Combined label with its real breakdown where the data carries one, and the
// shared Empty/Error/NotAuthorised states.
import { beforeEach, describe, expect, it } from "vitest";

import { allByClass, byClass, descendants, FakeDocument, FakeNode, texts } from "./dom-double.js";
import { useDocument } from "../src/ds-components.js";
import { comparisonSummary, mountPlayerComparison } from "../src/ds-compare.js";
import { mountRecordsView } from "../src/ds-records.js";
import { mountCommunityView } from "../src/ds-community.js";
import { engineBreakdown, favouriteCombo, mountPlayerInsightsSection, weekLabel, type MyStatsSources } from "../src/ds-mystats.js";
import type { TrackBest } from "../src/mastery-view.js";
import type { PlayerInsightsClient } from "../src/player-insights-client.js";
import { PlayerInsightsClientError } from "../src/player-insights-client.js";

let document: FakeDocument;
let root: FakeNode;

beforeEach(() => {
  document = new FakeDocument();
  useDocument(document as unknown as Document);
  root = document.createElement("div");
});

const settle = async (): Promise<void> => {
  for (let step = 0; step < 12; step += 1) { await Promise.resolve(); }
};
const all = (): string => texts(root).join(" ");
const press = (node: FakeNode | undefined): void => { node!.dispatch("click"); };
const engineOption = (engine: 150 | 200): FakeNode | undefined =>
  allByClass(root, "ds-engine-option").find((node) => node.attributes.get("data-engine") === String(engine));

// ---------------------------------------------------------------- W12 Compare

const bestsA: readonly TrackBest[] = [
  { trackId: "track.mario_kart_stadium", mode: 150, totalTimeMs: 94_000, rank: 1 },
  { trackId: "track.water_park", mode: 150, totalTimeMs: 120_000, rank: 1 },
  { trackId: "track.sweet_sweet_canyon", mode: 150, totalTimeMs: 130_000, rank: 1 },
  { trackId: "track.mario_kart_stadium", mode: 200, totalTimeMs: 80_000, rank: 1 },
];
const bestsB: readonly TrackBest[] = [
  { trackId: "track.mario_kart_stadium", mode: 150, totalTimeMs: 95_500, rank: 1 },
  { trackId: "track.water_park", mode: 150, totalTimeMs: 118_000, rank: 1 },
  { trackId: "track.mario_kart_stadium", mode: 200, totalTimeMs: 79_000, rank: 1 },
];

const ratingClient = {
  async leaderboard() {
    return [
      { rank: 1, playerId: "player.a", username: "a", displayName: "Alpha", score: 30 },
      { rank: 2, playerId: "player.b", username: "b", displayName: "Beta", score: 20 },
    ];
  },
};

function mountCompare(overrides: Record<string, unknown> = {}, playerB: string | null = "player.b") {
  return mountPlayerComparison(root as unknown as HTMLElement, "player.a", playerB, {
    loadBests: async (playerId: string) => playerId === "player.a" ? bestsA : bestsB,
    ratingClient,
    playerClient: {
      async load(playerId: string) {
        const profile = {
          playerId, username: playerId.replace("player.", ""),
          displayName: playerId === "player.a" ? "Alpha" : "Beta",
          countryId: "country.nl",
        };
        return playerId === "player.a" ? { ...profile, avatarId: "character.yoshi" } : profile;
      },
    },
    loadHeadToHead: async () => ({
      sharedRaces: 12, aAhead: 7, bAhead: 5, averageFinishA: 3.5, averageFinishB: 4.2,
      byTournament: [
        { tournamentNumber: 12, sharedRaces: 6, aAhead: 4, bAhead: 2 },
        { tournamentNumber: 13, sharedRaces: 6, aAhead: 3, bAhead: 3 },
      ],
    }),
    initialMode: 150,
    ...overrides,
  } as never);
}

describe("W12 · Compare", () => {
  it("counts tracks ahead with the historical unplayed fallback (unchanged)", () => {
    expect(comparisonSummary(bestsA, bestsB, 150)).toEqual({ aheadA: 2, aheadB: 1, ties: 0 });
    expect(comparisonSummary(bestsA, bestsB, 200)).toEqual({ aheadA: 0, aheadB: 1, ties: 0 });
  });

  it("shows both identities, the score, per-track times and the one delta format", async () => {
    const view = mountCompare();
    await view.ready;
    await settle();
    expect(all()).toContain("Alpha vs Beta");
    // The score is two exact numbers, not "2 – 1" baked into one string.
    expect(allByClass(root, "ds-compare__value").map((node) => node.textContent)).toContain("2");
    expect(all()).toContain("1:34.000");
    expect(all()).toContain("1:35.500");
    expect(all()).toContain("−1.500");
    // Only the cups both Players have driven in appear.
    expect(all()).not.toContain("Shell Cup");
    // Identity: a character, a flag and the ladder tier for each side.
    expect(allByClass(root, "ds-compare__avatar").length).toBeGreaterThanOrEqual(1);
    expect(allByClass(root, "ds-flag")).toHaveLength(2);
    expect(allByClass(root, "ds-tier-chip")).toHaveLength(2);
    view.unmount();
    expect(root.children).toHaveLength(0);
  });

  it("has exactly one EngineSelector, and a switch replaces every dependent value", async () => {
    const changes: number[] = [];
    const view = mountCompare({ onEngineChange: (next: number) => changes.push(next) });
    await view.ready;
    await settle();
    expect(allByClass(root, "ds-engine-selector")).toHaveLength(1);
    const before = all();
    expect(before).toContain("1:34.000");
    press(engineOption(200));
    await settle();
    const after = all();
    expect(changes).toEqual([200]);
    expect(view.engine()).toBe(200);
    // 200cc has one shared track and B is faster there: the score, the times and the gap all move.
    expect(after).toContain("1:20.000");
    expect(after).not.toContain("1:35.500");
    expect(after).toContain("+1.000");
    // Every track link carries the engine that is being read (R4).
    const links = allByClass(root, "ds-table__name-text").map((node) => node.attributes.get("href"));
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) { expect(href).toContain("mode=200"); }
  });

  it("offers an opponent picker when only one Player is given", async () => {
    const view = mountCompare({ loadBests: async () => { throw new Error("must not load bests"); } }, null);
    await view.ready;
    await settle();
    expect(descendants(root).some((node) => node.tagName === "select")).toBe(true);
    expect(all()).toContain("Beta");
    expect(byClass(root, "ds-compare__select")).toBeDefined();
  });

  it("rejects a malformed Player id without fetching, as an ErrorState", async () => {
    const view = mountPlayerComparison(root as unknown as HTMLElement, "not a player id", null, {
      loadBests: async () => { throw new Error("must not load"); },
      ratingClient: { async leaderboard() { throw new Error("must not load"); } },
    });
    await view.ready;
    expect(all()).toContain("That comparison is not available.");
    expect(byClass(root, "ds-state")?.attributes.get("data-state")).toBe("error");
  });

  it("draws the Tournament head-to-head and says it pools the engine classes", async () => {
    const view = mountCompare();
    await view.ready;
    await settle();
    expect(all()).toContain("Tournament head-to-head");
    expect(all()).toContain("12");
    expect(all()).toContain("both engine classes together");
    // Per-night detail stays reachable behind a Disclosure rather than a run-on line.
    expect(byClass(root, "ds-disclosure")).toBeDefined();
    expect(all()).toContain("TN12");
  });
});

// ---------------------------------------------------------------- W13 Records

describe("W13 · Record book", () => {
  it("keeps rank, identity, value and route, and says which categories pool the engines", async () => {
    const view = mountRecordsView(root as unknown as HTMLElement,
      async () => ({ categories: [
        { key: "firsts", holders: [{ playerId: "player.ben", displayName: "Ben", avatarId: "character.yoshi", value: 72 }] },
        { key: "published", holders: [{ playerId: "player.evan", displayName: "Evan", value: 184 }] },
      ] }),
      async () => []);
    await view.ready;
    await settle();
    // The place is a rank numeral in the rank colour, never a medal emoji (§15, §17).
    expect(all()).toContain("#1");
    expect(all()).not.toContain("🏆");
    expect(all()).toContain("72");
    expect(all()).toContain("Tracks led.");
    expect(byClass(root, "ds-podium__name")?.attributes.get("href")).toBe("/?player=player.ben");
    expect(allByClass(root, "ds-podium__art").length).toBeGreaterThanOrEqual(1);
    expect(byClass(root, "ds-podium__art")?.attributes.get("data-shape"))
      .toBe("square");
    // R9: the engine-independent count is Combined; the page says every value pools both engines.
    expect(all()).toContain("Combined");
    expect(all()).toContain("all values combine 150cc and 200cc.");
    view.unmount();
    expect(root.children).toHaveLength(0);
  });

  it("makes coverage explicit as track-engine combinations out of the 192 possible", async () => {
    const view = mountRecordsView(root as unknown as HTMLElement,
      async () => ({ categories: [{
        key: "coverage",
        holders: [{ playerId: "player.ben", displayName: "Ben", value: 106 }],
      }] }),
      async () => []);
    await view.ready;
    await settle();
    expect(all()).toContain("106 / 192");
    expect(all()).toContain("Track–engine combinations out of 192.");
    view.unmount();
  });

  it("preserves the empty and unavailable states as the shared states", async () => {
    const empty = mountRecordsView(root as unknown as HTMLElement,
      async () => ({ categories: [] }), async () => []);
    await empty.ready;
    await settle();
    expect(all()).toContain("No records yet — the first published Time Trials will write them.");
    expect(byClass(root, "ds-state")?.attributes.get("data-state")).toBe("empty");
    empty.unmount();

    const failedRoot = document.createElement("div");
    const failed = mountRecordsView(failedRoot as unknown as HTMLElement,
      async () => { throw new Error("offline"); }, async () => []);
    await failed.ready;
    await settle();
    expect(texts(failedRoot).join(" ")).toContain("The record book is temporarily unavailable.");
    expect(byClass(failedRoot, "ds-state")?.attributes.get("data-state")).toBe("error");
  });

  it("adds the Tournament champions when the history has them, and stays silent when it does not", async () => {
    const view = mountRecordsView(root as unknown as HTMLElement,
      async () => ({ categories: [{ key: "podiums", holders: [{ playerId: "player.ben", displayName: "Ben", value: 9 }] }] }),
      async () => [{
        tournamentNumber: 12, sectionLabel: "TN12: Kampioen", standings: [
          {
            playerId: "player.nova", displayName: "Nova", points: 84, races: 12,
            characterId: "character.yoshi",
            characterVariantId: "character_variant.yoshi.023_pink",
          },
        ],
      }] as never);
    await view.ready;
    await settle();
    expect(all()).toContain("Tournament champions");
    expect(all()).toContain("TN12");
    expect(all()).toContain("Character");
    expect(all()).toContain("Player");
    expect(allByClass(root, "ds-records__champion-character-icon")).toHaveLength(1);
    expect(byClass(root, "ds-records__champion-character")?.textContent)
      .toContain("Yoshi · Pink");
  });
});

// ---------------------------------------------------------------- W15 Community

describe("W15 · Community", () => {
  it("shows the four figures, the routes out and a bar that prints its own count", async () => {
    const view = mountCommunityView(root as unknown as HTMLElement, async () => ({
      players: 42, publishedTimeTrials: 1840, tournaments: 13,
      countries: [
        { countryId: "country.nl", players: 30 },
        { countryId: "country.be", players: 4 },
      ],
    }));
    await view.ready;
    await settle();
    expect(all()).toContain("1,840");
    expect(all()).toContain("42");
    // R9: published Time Trials is engine-independent, so it says Combined — and says honestly that
    // the split is not published rather than inventing one.
    expect(all()).toContain("Combined");
    expect(all()).toContain("the split is not published");
    expect(allByClass(root, "ds-bar-row")).toHaveLength(2);
    expect(allByClass(root, "ds-bar-row")[0]?.attributes.get("aria-label")).toContain("30 Players");
    expect(allByClass(root, "ds-card").map((node) => node.attributes.get("href")))
      .toEqual(["/?activity=1", "/?ranking=timetrials"]);
    expect(all()).toContain("34 of 42 Players share a country");
    view.unmount();
    expect(root.children).toHaveLength(0);
  });

  it("keeps the honest empty state and the unavailable state", async () => {
    const view = mountCommunityView(root as unknown as HTMLElement, async () => ({
      players: 3, publishedTimeTrials: 0, tournaments: 0, countries: [],
    }));
    await view.ready;
    await settle();
    expect(all()).toContain("No Players have set a country yet");
    expect(all()).toContain("never inferred");
    view.unmount();

    const failedRoot = document.createElement("div");
    const failed = mountCommunityView(failedRoot as unknown as HTMLElement,
      async () => { throw new Error("offline"); });
    await failed.ready;
    await settle();
    expect(texts(failedRoot).join(" ")).toContain("The community overview is temporarily unavailable.");
  });
});

// ---------------------------------------------------------------- W28 My records & stats

const insights = (personalBests: readonly unknown[], submissionCount: number): PlayerInsightsClient => ({
  async loadMine() {
    return {
      schemaVersion: "mk8dx.player-insights.v1",
      playerId: "player.synthetic_insights_01",
      timeTrials: { submissionCount, personalBests },
      tournaments: {
        raceCount: 3, countedRaceCount: 2, wins: 1, podiums: 2,
        countedPoints: 27, countedFinishPositionTotal: 3,
      },
    } as never;
  },
});

// Only the record book: every other document is unavailable, as on a first visit offline.
const noSources: MyStatsSources = {
  focus: async () => null,
  standings: async () => [],
  activity: async () => null,
  results: async () => [],
  mountTournaments: () => () => undefined,
};

describe("W28 · My records & stats", () => {
  it("splits the engine-independent counts (R9) from the data the document already carries", () => {
    const { attempts, cells } = engineBreakdown([
      { trackId: "track.a", modeCC: 150, bestTimeMs: 1, attemptCount: 5 },
      { trackId: "track.a", modeCC: 200, bestTimeMs: 1, attemptCount: 2 },
      { trackId: "track.b", modeCC: 150, bestTimeMs: 1, attemptCount: 1 },
    ] as never);
    expect(attempts).toEqual({ 150: 6, 200: 2 });
    expect(cells).toEqual({ 150: 2, 200: 1 });
  });

  it("labels both counts Combined with their real breakdown, and lists the records per engine", async () => {
    const view = mountPlayerInsightsSection(root as unknown as HTMLElement, insights([
      { trackId: "track.mario_kart_stadium", modeCC: 150, bestTimeMs: 83_456, attemptCount: 2 },
      { trackId: "track.water_park", modeCC: 200, bestTimeMs: 71_000, attemptCount: 3 },
    ], 5), noSources);
    await view.ready;
    await settle();
    expect(all()).toContain("Combined");
    expect(all()).toContain("150cc 2 · 200cc 3");   // attempts
    expect(all()).toContain("150cc 1 · 200cc 1");   // personal-best cells
    // The list opens on 150cc: one row, the track's own name, the exact time and its attempts.
    expect(all()).toContain("Mario Kart Stadium");
    expect(all()).toContain("1:23.456");
    expect(all()).not.toContain("1:11.000");
    expect(allByClass(root, "ds-engine-selector")).toHaveLength(1);
    press(engineOption(200));
    await settle();
    expect(all()).toContain("Water Park");
    expect(all()).toContain("1:11.000");
    expect(all()).not.toContain("1:23.456");
    // Tournament figures are untouched, and say they count every race.
    expect(all()).toContain("1.5");
    expect(all()).toContain("whatever the engine class");
    view.unmount();
    expect(root.children).toHaveLength(0);
  });

  it("draws the go-to combo with pictures, the body in the character's own colour", () => {
    const run = (mode: 150 | 200) => ({
      resultId: "user_submission.time.synthetic_01", revision: 1, playerId: "player.a", playerUsername: "a",
      playerDisplayName: "A", trackId: "track.mario_kart_stadium", mode, totalTimeMs: 90_000, laps: [],
      loadout: { characterId: "character.inkling_boy", bodyId: "body.buggybud", tireId: "tire.azure_roller", gliderId: "glider.cloud_glider" },
      sourceKind: "web", resultAtMs: 1, publishedAtMs: 1,
    });
    const combo = favouriteCombo([run(150), run(150), run(200)] as never, 150)!;
    expect(combo.runs).toBe(2);
    expect(combo.of).toBe(2);
    expect(combo.parts.map((part) => part.role)).toEqual(["character", "body", "tires", "glider"]);
    const body = combo.parts.find((part) => part.role === "body")!.part;
    expect(body.name).toContain("Blue");
    expect(body.iconPath).toContain("000_blue");
  });

  it("labels momentum weeks as day/month, which cannot wrap", () => {
    expect(weekLabel(new Date(2026, 8, 14).getTime())).toBe("14/9");
  });

  it("an engine with no records still lists every track, as not raced yet", async () => {
    const view = mountPlayerInsightsSection(root as unknown as HTMLElement, insights([
      { trackId: "track.mario_kart_stadium", modeCC: 150, bestTimeMs: 83_456, attemptCount: 2 },
    ], 2), noSources);
    await view.ready;
    await settle();
    press(engineOption(200));
    await settle();
    expect(all()).toContain("0 of 96 tracks at 200cc");
    expect(all()).toContain("Not raced yet · post a time");
  });

  it("builds a richer page from the documents beside the record book", async () => {
    const now = Date.UTC(2026, 8, 26, 12);
    let tournamentsMounted = 0;
    const view = mountPlayerInsightsSection(root as unknown as HTMLElement, insights([
      { trackId: "track.mario_kart_stadium", modeCC: 150, bestTimeMs: 100_000, attemptCount: 2 },
      { trackId: "track.water_park", modeCC: 150, bestTimeMs: 200_000, attemptCount: 3 },
    ], 5), {
      focus: async () => [{ trackId: "track.mario_kart_stadium", mode: 150, myBestMs: 100_000, myRank: 2, humanCount: 9, leaderBestMs: 95_000 }],
      standings: async () => [
        { rank: 3, playerId: "player.synthetic_insights_01", playerDisplayName: "Me", mode: 150, totalTimeMs: 1, averageTimeMs: 1, playedTracks: 2, goldMedals: 0, silverMedals: 0, bronzeMedals: 0 },
        { rank: 1, playerId: "player.other", playerDisplayName: "Other", mode: 150, totalTimeMs: 1, averageTimeMs: 1, playedTracks: 2, goldMedals: 0, silverMedals: 0, bronzeMedals: 0 },
      ],
      activity: async () => ({ displayName: "Me", runs: [
        { trackId: "track.mario_kart_stadium", modeCC: 150, totalTimeMs: 101_500, atMs: now - 20 * 86_400_000 },
        { trackId: "track.mario_kart_stadium", modeCC: 150, totalTimeMs: 100_000, atMs: now - 2 * 86_400_000 },
      ] }),
      results: async () => [],
      mountTournaments: () => { tournamentsMounted += 1; return () => undefined; },
    }, () => now);
    await view.ready;
    await settle();
    expect(all()).toContain("of 2 · 150cc total");
    expect(all()).toContain("#2 of 9");
    expect(all()).toContain("1 personal best in the last 30 days · latest: Mario Kart Stadium −1.500");
    expect(all()).toContain("Best standing");
    expect(all()).toContain("Mastery across your tracks");
    expect(all()).toContain("Closest to the next level");
    expect(tournamentsMounted).toBe(1);
    view.unmount();
    expect(root.children).toHaveLength(0);
  });

  it("a Player claim that is missing is a NotAuthorised state, not an error", async () => {
    const view = mountPlayerInsightsSection(root as unknown as HTMLElement, {
      async loadMine() { throw new PlayerInsightsClientError("claim_required"); },
    }, noSources);
    await view.ready;
    await settle();
    expect(byClass(root, "ds-state")?.attributes.get("data-state")).toBe("not-authorised");
    expect(all()).toContain("Verify a Player claim to calculate personal records.");

    const failedRoot = document.createElement("div");
    const failed = mountPlayerInsightsSection(failedRoot as unknown as HTMLElement, {
      async loadMine() { throw new Error("offline"); },
    }, noSources);
    await failed.ready;
    await settle();
    expect(byClass(failedRoot, "ds-state")?.attributes.get("data-state")).toBe("error");
  });
});
