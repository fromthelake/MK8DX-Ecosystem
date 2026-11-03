import { describe, expect, it, vi } from "vitest";

import {
  formatStandingTotal,
  mountTimeTrialStanding,
  parseWorldRecordsDocument,
  referenceTotalCoverage,
  sortComparisonIdsByTotal,
  sortMedalStandings,
  type TimeTrialStanding,
  type TimeTrialStandingContext,
} from "../src/time-trial-standing-view.js";
import { timeTrialTrackIds } from "../src/track-scope.js";
import {
  allByClass, byClass, descendants, FakeDocument, FakeNode, texts,
} from "./dom-double.js";

async function settle(): Promise<void> {
  for (let turn = 0; turn < 6; turn += 1) { await Promise.resolve(); }
}

function standing(
  name: string, rank: number, extra: Partial<TimeTrialStanding> = {},
): TimeTrialStanding {
  return {
    rank,
    playerId: `player.${name.toLowerCase()}`,
    playerDisplayName: name,
    mode: 150,
    totalTimeMs: 9_000_000 + rank * 60_000,
    averageTimeMs: 93_750 + rank * 625,
    playedTracks: 96,
    goldMedals: 0,
    silverMedals: 0,
    bronzeMedals: 0,
    ...extra,
  };
}

async function mount(
  rows: readonly TimeTrialStanding[],
  context: Partial<TimeTrialStandingContext> = {},
  initialView: Parameters<typeof mountTimeTrialStanding>[3] = {},
): Promise<Readonly<{ root: FakeNode; mounted: ReturnType<typeof mountTimeTrialStanding> }>> {
  const document = new FakeDocument();
  const root = document.createElement("div");
  const mounted = mountTimeTrialStanding(
    root as unknown as HTMLElement,
    Promise.resolve({ viewerPlayerId: null, rivalPlayerIds: new Set<string>(), ...context }),
    async () => rows,
    initialView,
  );
  await mounted.ready;
  await settle();
  return { root, mounted };
}

/** Click the first control whose visible text is exactly this. */
function press(root: FakeNode, label: string): void {
  const node = descendants(root).find((candidate) =>
    (candidate.tagName === "button" || candidate.tagName === "a") && candidate.textContent === label);
  if (node === undefined) { throw new Error(`no control reads "${label}"`); }
  node.click();
}

describe("Time Trial Ranking — the numbers it states (T-NUM)", () => {
  it("formats combined totals with hours and milliseconds", () => {
    expect(formatStandingTotal(7_445_678)).toBe("2:04:05.678");
  });

  it("sorts Medals by gold, then silver, then bronze", () => {
    const row = (name: string, gold: number, silver: number, bronze: number) => ({
      rank: 1, playerId: `player.${name.toLowerCase()}`, playerDisplayName: name,
      mode: 150 as const, totalTimeMs: 1, averageTimeMs: 1, playedTracks: 1,
      goldMedals: gold, silverMedals: silver, bronzeMedals: bronze,
    });
    expect(sortMedalStandings([
      row("Silver", 2, 9, 0), row("Bronze", 2, 9, 4), row("Gold", 3, 0, 0),
    ]).map((entry) => entry.playerDisplayName)).toEqual(["Gold", "Bronze", "Silver"]);
  });

  it("orders Mastery columns by lowest 96-track total", () => {
    const totals = new Map([["player.slow", 300], ["player.fast", 100], ["player.middle", 200]]);
    expect(sortComparisonIdsByTotal(
      ["player.slow", "player.fast", "player.middle"],
      (id) => totals.get(id) ?? Number.POSITIVE_INFINITY,
      (id) => id,
    )).toEqual(["player.fast", "player.middle", "player.slow"]);
  });

  it("requires one valid integer-millisecond reference time for each scoped track", () => {
    const tracks = timeTrialTrackIds("base");
    const bests = tracks.map((trackId) => ({ trackId, mode: 200 as const, totalTimeMs: 60_001 }));
    expect(referenceTotalCoverage(bests, 200, tracks)).toEqual({
      coveredTracks: 48, totalTracks: 48, totalTimeMs: 2_880_048,
    });
    expect(referenceTotalCoverage(bests.slice(1), 200, tracks)).toEqual({
      coveredTracks: 47, totalTracks: 48, totalTimeMs: null,
    });
    expect(referenceTotalCoverage([...bests, bests[0]!], 200, tracks)).toEqual({
      coveredTracks: 47, totalTracks: 48, totalTimeMs: null,
    });
  });

  it("preserves each equal-time World Record holder and video", () => {
    const records = parseWorldRecordsDocument({
      schemaVersion: "mk8dx.world-records.v1",
      records: [{ mode: 200, trackId: "track.gba_boo_lake", totalTimeMs: 58_982, playerName: "Pii / Technical",
        lapTimesMs: [20_000, 20_000, 18_982], coinsPerLap: [3, 3, 4], mushroomsPerLap: [1, 1, 1],
        holders: [
          { playerName: "Pii", videoUrl: "https://youtu.be/first", lapTimesMs: [20_000, 20_000, 18_982], coinsPerLap: [3, 3, 4], mushroomsPerLap: [1, 1, 1] },
          { playerName: "Technical", videoUrl: "https://youtu.be/second", lapTimesMs: [20_000, 20_000, 18_982], coinsPerLap: [3, 3, 4], mushroomsPerLap: [1, 1, 1] },
        ] }],
    });
    expect(records[0]?.holders.map((holder) => holder.playerName)).toEqual(["Pii", "Technical"]);
    expect(records[0]?.holders[1]?.videoUrl).toBe("https://youtu.be/second");
  });

  it("sizes the rank column from the largest rank in the dataset, and never abbreviates", async () => {
    const { root, mounted } = await mount([
      standing("First", 1), standing("Deep", 99_999),
    ]);
    const table = allByClass(root, "ds-table")
      .find((node) => node.getAttribute("aria-label")?.includes("Time Trial standing"));
    expect(table).toBeDefined();
    // "#99,999" is seven characters, so every rank cell in this table is seven characters wide.
    expect(table?.style.getPropertyValue("--ds-col-0")).toBe("7");
    expect(texts(root)).toContain("#99,999");
    // The total is printed in full, never rounded or shortened.
    expect(texts(root)).toContain(formatStandingTotal(9_000_000 + 60_000));
    mounted.unmount();
  });
});

describe("Time Trial Ranking — the design system (W10)", () => {
  it("marks its tabs for the APK-style 320 px wrap", async () => {
    const { root, mounted } = await mount([standing("Ben", 1)]);
    expect(byClass(root, "ds-rank__tabs")).toBeDefined();
    mounted.unmount();
  });

  it("marks the podium with rank colours on the row, not with emoji", async () => {
    const { root, mounted } = await mount([
      standing("Gold", 1), standing("Silver", 2), standing("Bronze", 3), standing("Fourth", 4),
    ]);
    const podiums = allByClass(root, "ds-table__row")
      .map((row) => row.getAttribute("data-podium"))
      .filter((value): value is string => value !== null);
    expect(podiums).toEqual(expect.arrayContaining(["1", "2", "3"]));
    expect(texts(root).some((text) => text.includes(String.fromCodePoint(0x1f3c6)) && text !== String.fromCodePoint(0x1f3c6)))
      .toBe(false);
    mounted.unmount();
  });

  it("keeps the medal columns' glyph heads, with the word as their accessible name", async () => {
    const { root, mounted } = await mount([standing("Gold", 1, { goldMedals: 40, silverMedals: 20, bronzeMedals: 10 })]);
    press(root, "Medals");
    await settle();
    const heads = allByClass(root, "ds-table__head-cell");
    const gold = heads.find((head) => head.getAttribute("data-key") === "gold");
    expect(gold?.textContent).toBe(String.fromCodePoint(0x1f3c6));
    expect(gold?.getAttribute("aria-label")).toBe("Gold");
    expect(texts(root)).toContain("40");
    mounted.unmount();
  });

  it("opens with your standing as a hero rank, and says which way you moved", async () => {
    const { root, mounted } = await mount([standing("Ben", 4)], {
      viewerPlayerId: "player.ben",
      standing: { standing: 4, of: 66, previousStanding: 7 },
    });
    expect(byClass(root, "ds-hero-rank")?.textContent).toBe("#4");
    expect(texts(root)).toContain("of 66 Players · total across 96 tracks");
    const movement = allByClass(root, "ds-delta__value")
      .find((node) => node.getAttribute("data-direction") === "faster");
    expect(movement?.textContent).toBe("+3");
    // The engine the figure belongs to is stated beside it (R5).
    expect(allByClass(root, "ds-engine-mark").some((mark) => mark.getAttribute("data-engine") === "150"))
      .toBe(true);
    mounted.unmount();
  });

  it("tells a signed-out visitor that Rank works without an account", async () => {
    const { root, mounted } = await mount([]);
    expect(texts(root)).toContain("Public Rank");
    const signIn = descendants(root).find((node) => node.textContent === "Sign in for rivals & Groups");
    expect(signIn?.href).toBe("/?signin=1&return=%2F%3Franking%3Dtimetrials");
    // Nothing is invented for somebody without an account.
    expect(byClass(root, "ds-hero-rank")).toBeUndefined();
    mounted.unmount();
  });

  it("keeps every Total field, the player link and the Mastery tier", async () => {
    const { root, mounted } = await mount([standing("Ben", 1)], { viewerPlayerId: "player.ben" });
    const keys = allByClass(root, "ds-table__head-cell")
      .map((head) => head.getAttribute("data-key"));
    expect(keys).toEqual(expect.arrayContaining([
      "rank", "player", "total", "average", "tracks", "delta", "compare",
    ]));
    expect(texts(root)).toContain(formatStandingTotal(9_060_000));
    expect(texts(root)).toContain("96/96");
    expect(descendants(root).find((node) => node.tagName === "a" && node.textContent === "Ben")?.href)
      .toBe("/?player=player.ben");
    expect(byClass(root, "ds-tier-chip")).toBeDefined();
    // Your own row is the volt row, and it says "You" as well as being washed.
    const own = allByClass(root, "ds-table__row").find((row) => row.getAttribute("data-kind") === "you");
    expect(own).toBeDefined();
    expect(byClass(root, "ds-you-chip")?.textContent).toBe("You");
    mounted.unmount();
  });

  it("matches the APK phone standing by keeping only identity and total in its two-line row", async () => {
    const { root, mounted } = await mount([standing("Ben", 1)]);
    const cells = allByClass(root, "ds-table__head-cell");
    const phoneOf = (key: string): string | null =>
      cells.find((cell) => cell.getAttribute("data-key") === key)?.getAttribute("data-phone") ?? null;
    expect(phoneOf("rank")).toBe("rank");
    expect(phoneOf("player")).toBe("name");
    expect(phoneOf("total")).toBe("2");
    expect(phoneOf("delta")).toBe("drop");
    expect(phoneOf("average")).toBe("drop");
    expect(phoneOf("tracks")).toBe("drop");
    // The APK selects comparison targets in Filters / Comparison rather than repeating a third
    // action line for every Player. The wider Web table still retains both columns.
    const delta = cells.find((cell) => cell.getAttribute("data-key") === "delta");
    expect(delta?.getAttribute("data-phone")).toBe("drop");
    const compare = cells.find((cell) => cell.getAttribute("data-key") === "compare");
    expect(compare?.getAttribute("data-phone")).toBe("drop");
    const table = allByClass(root, "ds-rank-standing")[0];
    expect(table?.getAttribute("data-standing-kind")).toBe("total");
    mounted.unmount();
  });

  it("keeps the APK medal columns together on one labelled phone row", async () => {
    const { root, mounted } = await mount([standing("Ben", 1)]);
    press(root, "Medals");
    await settle();
    const cells = allByClass(root, "ds-table__head-cell");
    const phoneOf = (key: string): string | null =>
      cells.find((cell) => cell.getAttribute("data-key") === key)?.getAttribute("data-phone") ?? null;
    expect(phoneOf("gold")).toBe("1");
    expect(phoneOf("silver")).toBe("1");
    expect(phoneOf("bronze")).toBe("1");
    expect(phoneOf("compare")).toBe("drop");
    const table = allByClass(root, "ds-rank-standing")[0];
    expect(table?.getAttribute("data-standing-kind")).toBe("medals");
    mounted.unmount();
  });

  it("filters the standing to rivals from the filter sheet, and says so in the summary", async () => {
    const { root, mounted } = await mount([
      standing("Ben", 1), standing("Friend", 2), standing("Other", 3),
    ], { viewerPlayerId: "player.ben", rivalPlayerIds: new Set(["player.friend"]) });
    expect(texts(root)).toContain("Other");
    press(root, "Filters");
    await settle();
    const sheet = byClass(root.ownerDocument.body, "ds-dialog");
    expect(sheet?.open).toBe(true);
    press(root.ownerDocument.body, "Among rivals");
    await settle();
    expect(texts(root)).toContain("Friend");
    expect(texts(root)).not.toContain("Other");
    expect(byClass(root, "ds-filter-summary")?.textContent).toContain("Among rivals");
    mounted.unmount();
  });

  it("states the gap to you with a true minus and the design system's one delta format", async () => {
    const { root, mounted } = await mount([
      standing("Ben", 1), standing("Friend", 2),
    ], { viewerPlayerId: "player.ben" });
    const gaps = allByClass(root, "ds-delta__value").map((node) => node.textContent);
    expect(gaps).toContain("±0.000");
    expect(gaps).toContain("+1:00.000");
    mounted.unmount();
  });

  it("keeps track identity, a sortable player column and the Mastery tier in Delta rows", async () => {
    const { root, mounted } = await mount([standing("Ben", 1)]);
    press(root, "Delta per track");
    await settle();
    expect(texts(root)).toContain("Mario Kart Stadium");
    expect(descendants(root).find((node) =>
      node.tagName === "a" && node.textContent === "Mario Kart Stadium")?.href)
      .toBe("/?leaderboard=track.mario_kart_stadium&mode=150");
    expect(allByClass(root, "ds-thumb__art")).toHaveLength(96);
    expect(allByClass(root, "ds-thumb__badge")).toHaveLength(96);
    expect(allByClass(root, "ds-rank-track__engine")).toHaveLength(96);
    expect(allByClass(root, "ds-rank-track__engine")[0]?.getAttribute("data-engine")).toBe("150");
    expect(allByClass(root, "ds-rank-track__engine")[0]?.textContent).toContain("150cc");
    expect(allByClass(root, "ds-thumb__art")[0]?.getAttribute("src"))
      .toContain("images/tracks/previews/000_mario_kart_stadium.png");
    const trackTable = allByClass(root, "ds-table")
      .find((candidate) => candidate.getAttribute("aria-label") === "Gap per track · 150cc");
    expect(trackTable?.getAttribute("data-comparison-columns")).toBe("1");
    const sortable = allByClass(root, "ds-sort");
    expect(sortable.length).toBeGreaterThan(1);
    const head = allByClass(root, "ds-table__head-cell")
      .find((cell) => cell.getAttribute("data-key") === "reference.nintendo_staff");
    expect(head?.getAttribute("aria-sort")).toBe("none");
    expect(allByClass(head!, "ds-sort__phone-label")[0]?.textContent)
      .toBe("Nintendo Ghost gap");
    head?.querySelector(".ds-sort")?.click();
    await settle();
    expect(allByClass(root, "ds-table__head-cell")
      .find((cell) => cell.getAttribute("data-key") === "reference.nintendo_staff")
      ?.getAttribute("aria-sort")).toBe("descending");
    mounted.unmount();
  });

  it("uses the APK's green +0.000 for a fastest per-track comparison", async () => {
    const document = new FakeDocument();
    document.defaultView = { addEventListener: () => undefined, removeEventListener: () => undefined, localStorage: {
      getItem: () => JSON.stringify({ selectedPlayers: ["reference.nintendo_staff", "reference.world_record"] }),
      setItem: () => undefined,
    } };
    const root = document.createElement("div");
    const mounted = mountTimeTrialStanding(
      root as unknown as HTMLElement,
      Promise.resolve({ viewerPlayerId: null, rivalPlayerIds: new Set<string>() }),
      async () => [],
      { tab: "tracks" },
    );
    await mounted.ready;
    const zero = allByClass(root, "ds-rank-tracks")[0]?.querySelector(".ds-delta__value");
    expect(zero?.textContent).toBe("+0.000");
    expect(zero?.getAttribute("data-direction")).toBe("faster");
    mounted.unmount();
  });

  it("marks both journey destinations with the compact APK mobile structures", async () => {
    const { root, mounted } = await mount([standing("Ben", 1)], { viewerPlayerId: "player.ben" });
    expect(byClass(root, "ds-rank__headline-panel")).toBeDefined();
    press(root, "Delta per track");
    await settle();
    expect(byClass(root, "ds-rank__track-panel")).toBeDefined();
    expect(byClass(root, "ds-rank__track-mobile-heading")?.textContent)
      .toBe("Per-track comparison · 150cc");
    expect(byClass(root, "ds-rank__track-panel")?.textContent)
      .toContain("Search track");
    expect(byClass(root, "ds-rank__track-sort-hint")?.textContent)
      .toBe("Tap a Player column to sort by that Player's delta.");
    mounted.unmount();
  });

  it("gives the scoped Total hero an engine mark after the standing note and APK explanation", async () => {
    const { root, mounted } = await mount([standing("Ben", 3)],
      { viewerPlayerId: "player.ben" }, { scope: "bcp" });
    expect(byClass(root, "ds-rank")?.getAttribute("data-scope")).toBe("bcp");
    expect(byClass(root, "ds-rank")?.getAttribute("data-total-hero")).toBe("");
    expect(byClass(root, "ds-rank__headline-panel")?.querySelector(".ds-stat")?.querySelector(".ds-engine-mark")?.textContent)
      .toContain("150cc");
    expect(byClass(root, "ds-rank__hero-explainer")?.textContent)
      .toBe("The global standing uses your total across 48 tracks (BCP).");
    mounted.unmount();
  });

  it("does not join an anonymous Public Rank card to the Total standing panel", async () => {
    const { root, mounted } = await mount([standing("Ben", 3)], {}, { scope: "bcp" });
    expect(byClass(root, "ds-rank")?.getAttribute("data-total-hero")).toBeNull();
    mounted.unmount();
  });

  it("keeps the WR-relative Mastery formula behind an info button and scales the bars", async () => {
    const { root, mounted } = await mount([standing("Ben", 1)]);
    press(root, "Mastery");
    await settle();
    expect(byClass(root, "ds-rank__mastery-distribution")?.getAttribute("aria-labelledby"))
      .toBeTruthy();
    expect(texts(root)).toContain("How does Mastery work?");
    expect(texts(root)).not.toContain("Tier limit = current WR × (1 + tier offset)");
    press(root, "How does Mastery work?");
    const help = byClass(root.ownerDocument.body, "ds-dialog");
    expect(help?.open).toBe(true);
    expect(byClass(help!, "ds-title")?.getAttribute("tabindex")).toBe("-1");
    expect(root.ownerDocument.activeElement).toBe(byClass(help!, "ds-title"));
    expect(byClass(help!, "ds-rank-mastery__formula")?.textContent)
      .toBe("Tier limit = current WR × (1 + tier offset)");
    expect(texts(help!)).toContain("A +2.55% · B +2.97% · C +3.40%");
    expect(texts(help!)).toContain("Deity: 1:30.000 × 1.021225… = 1:31.910…, rounded to 1:31.900. So 1:31.900 or faster is Deity.");
    expect(texts(help!)).toContain("Int B: Int A (+19.00%) ends at 1:47.100; Int B (+21.34%) ends at 1:49.200. Int B is slower than 1:47.100 and at or below 1:49.200.");
    expect(texts(help!)).toContain("Offsets are shown to two decimals; limits use the full fixed ratios and are then rounded to 0.100 s. When a new WR is processed, every limit for that track and engine moves with it, so Mastery can change without a new personal best.");
    expect(texts(help!)).not.toContain("+4.24%");
    expect(allByClass(root, "ds-bar-row")).toHaveLength(23);
    expect(allByClass(root, "ds-bar__fill").some((fill) =>
      fill.style.getPropertyValue("--ds-bar-share") === "100%"))
      .toBe(true);
    press(root.ownerDocument.body, "Close");
    expect(help?.open).toBe(false);
    mounted.unmount();
  });

  it("addresses each view with a link that carries the engine and the track set (R6, ADR-0199)", async () => {
    const { root, mounted } = await mount([standing("Ben", 1)]);
    const links = allByClass(root, "ds-tab").map((tab) => tab.href);
    expect(links).toEqual([
      "/?ranking=timetrials&tab=total&mode=150&scope=all",
      "/?ranking=timetrials&tab=medals&mode=150&scope=all",
      "/?ranking=timetrials&tab=mastery&mode=150&scope=all",
      "/?ranking=timetrials&tab=tracks&mode=150&scope=all",
    ]);
    expect(allByClass(root, "ds-tab")[0]?.getAttribute("aria-current")).toBe("page");
    mounted.unmount();
  });

  it("replaces every dependent value when the engine changes", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const asked: number[] = [];
    const mounted = mountTimeTrialStanding(
      root as unknown as HTMLElement,
      Promise.resolve({ viewerPlayerId: null, rivalPlayerIds: new Set<string>() }),
      async (mode) => {
        asked.push(mode);
        return [standing("Ben", 1, { mode, totalTimeMs: mode === 150 ? 9_000_000 : 8_000_000 })];
      },
    );
    await mounted.ready;
    await settle();
    expect(texts(root)).toContain(formatStandingTotal(9_000_000));
    const option200 = allByClass(root, "ds-engine-option")
      .find((node) => node.getAttribute("data-engine") === "200");
    option200?.click();
    await settle();
    expect(asked).toEqual([150, 200]);
    expect(texts(root)).toContain(formatStandingTotal(8_000_000));
    expect(texts(root)).not.toContain(formatStandingTotal(9_000_000));
    expect(byClass(root, "ds-rank__engine")?.textContent).toContain("200cc");
    expect(byClass(root, "ds-filter-summary")?.textContent).toContain("Chosen: 1 of 3");
    mounted.unmount();
  });

  it("hides the other engine for a single-engine preference, and offers a local override", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const asked: number[] = [];
    const mounted = mountTimeTrialStanding(
      root as unknown as HTMLElement,
      Promise.resolve({
        viewerPlayerId: "player.ben", rivalPlayerIds: new Set<string>(), modePreference: "200",
      }),
      async (mode) => { asked.push(mode); return []; },
    );
    await mounted.ready;
    await settle();
    expect(asked).toEqual([200]);
    // Hidden, not zero: the engine is named and the override is offered.
    expect(allByClass(root, "ds-engine-option")).toHaveLength(0);
    expect(byClass(root, "ds-hidden-pref")?.textContent)
      .toContain("150cc is hidden by your Time Trial preference.");
    press(root, "Show 150cc anyway");
    await settle();
    expect(allByClass(root, "ds-engine-option")).toHaveLength(2);
    // The override is a view state only; nothing about the preference was written.
    expect(byClass(root, "ds-rank__engine")?.textContent).toContain("200cc");
    mounted.unmount();
  });

  it("names a reference row as a reference, and takes no rank for it", async () => {
    const { root, mounted } = await mount([standing("Ben", 1)]);
    const reference = allByClass(root, "ds-table__row")
      .find((row) => row.getAttribute("data-kind") === "reference");
    // Nintendo Ghost is the signed-out default comparison; its 96 bests make one reference row.
    expect(reference?.textContent).toContain("reference · no rank");
    expect(reference?.getAttribute("data-podium")).toBeNull();
    mounted.unmount();
  });

  it.each([150, 200] as const)("shows the complete Nintendo reference without community players at %icc", async (mode) => {
    const { root, mounted } = await mount([], {}, { mode, scope: "all", tab: "total" });
    const references = allByClass(root, "ds-table__row")
      .filter((row) => row.getAttribute("data-kind") === "reference");
    expect(references).toHaveLength(1);
    expect(references[0]?.textContent).toContain("Nintendo Ghost");
    expect(references[0]?.textContent).toContain("96/96");
    expect(byClass(root, "ds-rank__standing-panel")?.textContent)
      .toContain("No community Players in this selection yet");
    mounted.unmount();
  });

  it("explains incomplete World Record coverage instead of silently omitting Total", async () => {
    const document = new FakeDocument();
    document.defaultView = { addEventListener: () => undefined, removeEventListener: () => undefined, localStorage: {
      getItem: () => JSON.stringify({ selectedPlayers: ["reference.world_record"] }),
      setItem: () => undefined,
    } };
    const records = timeTrialTrackIds("all").slice(0, 95).map((trackId) => ({
      trackId, mode: 200, totalTimeMs: 60_001, playerName: "Synthetic holder",
      lapTimesMs: [20_000, 20_000, 20_001], coinsPerLap: [0, 0, 0], mushroomsPerLap: [0, 0, 0],
    }));
    vi.stubGlobal("fetch", async () => ({ status: 200, json: async () => ({
      schemaVersion: "mk8dx.world-records.v1", records,
    }) }));
    const root = document.createElement("div");
    try {
      const mounted = mountTimeTrialStanding(
        root as unknown as HTMLElement,
        Promise.resolve({ viewerPlayerId: null, rivalPlayerIds: new Set<string>() }),
        async () => [], { mode: 200, scope: "all", tab: "total" },
      );
      await mounted.ready;
      expect(byClass(root, "ds-rank__standing-panel")?.textContent)
        .toContain("World Record: 95/96 valid 200cc track times for All 96");
      expect(allByClass(root, "ds-table__row")).toHaveLength(0);
      mounted.unmount();
    } finally { vi.unstubAllGlobals(); }
  });

  it("takes the whole view away again when it unmounts", async () => {
    const { root, mounted } = await mount([standing("Ben", 1)]);
    mounted.unmount();
    expect(root.children).toHaveLength(0);
  });
});
