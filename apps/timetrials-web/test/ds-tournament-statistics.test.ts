// W18 the statistics on the design system (Phase 12), read the way a reader uses them: the totals,
// the sort, the filter, the track door and the track's own standing.
//
// These are behaviour cases against the rendered page. The pure derivations - the rows, the cup
// totals, the racing time from Nintendo's own ghost, the filter grammar - stay in
// `tournament-statistics-view.test.ts`, which this does not duplicate.

import { describe, expect, it } from "vitest";

import { FakeDocument, FakeNode, allByClass, byClass, descendants, texts } from "./dom-double.js";
import {
  mountTournamentStatistics,
  type StatisticsViewState,
} from "../src/tournament-statistics-view.js";
import type {
  TournamentStatistics,
  TournamentStatisticsClient,
  TrackSkill,
} from "../src/tournament-statistics-client.js";
import { useDocument } from "../src/ds-components.js";

const statistics: TournamentStatistics = {
  editions: [
    { editionNumber: 4, eventDate: "2023-05-19", heldAtMs: 1_684_000_000_000, participantCount: 16, races: 46, cumulativePlayers: 16 },
    { editionNumber: 12, eventDate: "2026-03-27", heldAtMs: 1_774_000_000_000, participantCount: 35, races: 132, cumulativePlayers: 61 },
  ],
  tracks: [
    { trackId: "track.mario_kart_stadium", races: 12, placements: 140, nights: 7, firstEdition: 4, lastEdition: 12, bestPlayerId: "player.ben", bestPlayerName: "Ben", bestScore: 21.5 },
    { trackId: "track.baby_park", races: 4, placements: 48, nights: 2, firstEdition: 6, lastEdition: 7, bestPlayerId: null, bestPlayerName: null, bestScore: null },
  ],
  totals: { editions: 2, races: 178, racesWithTrack: 16, placements: 188, players: 61, tracksRaced: 2 },
};

const skill: TrackSkill = {
  trackId: "track.baby_park", races: 4, racesSkipped: 1,
  players: [
    { rank: 1, playerId: "player.evan", displayName: "Evan", score: 24.5, mu: 27, sigma: 2.5, races: 4, wins: 3, top3: 4, bestFinish: 1, averageFinish: 1.75 },
    { rank: 2, playerId: "player.ben", displayName: "Ben", score: 19.25, mu: 22, sigma: 2.75, races: 4, wins: 1, top3: 3, bestFinish: 1, averageFinish: 2.5 },
  ],
};

function fakeClient(overrides: Partial<TournamentStatisticsClient> = {}): TournamentStatisticsClient {
  return {
    load: async () => statistics,
    loadTrack: async () => skill,
    ...overrides,
  };
}

function mount(options: Parameters<typeof mountTournamentStatistics>[2] = {}): Readonly<{
  root: FakeNode; mounted: ReturnType<typeof mountTournamentStatistics>;
}> {
  const document = new FakeDocument();
  const root = document.createElement("div");
  useDocument(document as unknown as Document);
  const mounted = mountTournamentStatistics(
    root as unknown as HTMLElement, fakeClient(), options);
  return { root, mounted };
}

const nameCells = (root: FakeNode): string[] =>
  allByClass(root, "ds-tstats__cell-name").map((node) => node.textContent ?? "");

describe("W18 the tournament statistics", () => {
  it("adds up what the community has raced, and says what its time is made of", async () => {
    const { root, mounted } = mount();
    await mounted.ready;
    const page = texts(root);
    expect(page.some((text) => text.includes("178 races over 2 nights"))).toBe(true);
    const stats = allByClass(root, "ds-stat").map((node) => node.textContent ?? "");
    expect(stats.some((text) => text.includes("Nights") && text.includes("2"))).toBe(true);
    expect(stats.some((text) => text.includes("Races") && text.includes("178"))).toBe(true);
    expect(stats.some((text) => text.includes("Tracks raced") && text.includes("2 / 96"))).toBe(true);
    // The 96 tracks nobody has raced are part of the answer too.
    expect(page.some((text) => text.includes("94 of the 96 tracks have never been raced"))).toBe(true);
    mounted.unmount();
    expect(root.children).toHaveLength(0);
  });

  it("sorts a column from its head, and says so in the address", async () => {
    const announced: StatisticsViewState[] = [];
    const { root, mounted } = mount({ onStateChange: (state) => { announced.push(state); } });
    await mounted.ready;
    // Opens on the most raced.
    expect(nameCells(root)[0]).toContain("Mario Kart Stadium");
    const head = allByClass(root, "ds-table__head-cell")
      .find((node) => node.getAttribute("data-key") === "nights");
    expect(head?.getAttribute("aria-sort")).toBe("none");
    const sort = descendants(head!).find((node) => node.className.includes("ds-sort"));
    sort!.click();
    expect(announced.at(-1)).toMatchObject({ sort: "nights", descending: true });
    const sorted = allByClass(root, "ds-table__head-cell")
      .find((node) => node.getAttribute("data-key") === "nights");
    expect(sorted?.getAttribute("aria-sort")).toBe("descending");
    expect(nameCells(root)[0]).toContain("Mario Kart Stadium");
    // A second press reverses it, which is what the reader asked for.
    descendants(sorted!).find((node) => node.className.includes("ds-sort"))!.click();
    expect(announced.at(-1)).toMatchObject({ sort: "nights", descending: false });
    // The second fixture track is not in the asset catalogue, so it is named by its id - which is
    // exactly what the view does when a night recorded a track the catalogue does not know.
    expect(nameCells(root)[0]).toContain("baby_park");
    mounted.unmount();
  });

  it("filters a column where its head is, and says what is being shown", async () => {
    const announced: StatisticsViewState[] = [];
    const { root, mounted } = mount({ onStateChange: (state) => { announced.push(state); } });
    await mounted.ready;
    expect(byClass(root, "ds-tstats__count")?.textContent).toBe("2 tracks");
    const filter = allByClass(root, "ds-tstats__filter")
      .find((node) => node.parentNode?.getAttribute("data-key") === "races");
    expect(filter).toBeDefined();
    filter!.value = "> 5";
    filter!.dispatch("input");
    expect(announced.at(-1)?.filters).toMatchObject({ races: "> 5" });
    // One line says how many are shown and what produced it (§12).
    expect(byClass(root, "ds-tstats__count")?.textContent).toBe("1 of 2 tracks · filtered by Races > 5");
    expect(nameCells(root)).toHaveLength(1);
    expect(nameCells(root)[0]).toContain("Mario Kart Stadium");
    mounted.unmount();
  });

  it("opens a track from its name and gives it its own page, its standing and the way back", async () => {
    const announced: StatisticsViewState[] = [];
    const { root, mounted } = mount({
      onStateChange: (state) => { announced.push(state); },
      viewerPlayerId: "player.ben",
    });
    await mounted.ready;
    // The door is the name, so it can be reached from the keyboard.
    const door = descendants(byClass(root, "ds-tstats__cell-name")!)
      .find((node) => node.tagName === "button");
    expect(door).toBeDefined();
    door!.click();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(announced.at(-1)?.focus).toBe("track.mario_kart_stadium");
    const page = texts(root);
    expect(page.some((text) => text.includes("Time-trial leaderboard for"))).toBe(true);
    expect(page.some((text) => text.includes("← All races"))).toBe(true);
    // The track's own TrueSkill standing, with the reader's own line marked.
    const rows = allByClass(root, "ds-table__row").filter((node) => node.getAttribute("data-head") === null);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.some((node) => node.getAttribute("data-kind") === "you")).toBe(true);
    expect(texts(root).some((text) => text.includes("4 races counted; 1 left out"))).toBe(true);
    mounted.unmount();
  });
});
