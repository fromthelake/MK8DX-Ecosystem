import { describe, expect, it } from "vitest";

import {
  mountTournamentStanding,
  standingPlayerMatches,
  ratingIsReverting,
} from "../src/tournament-standing-view.js";
import type {
  TournamentRivalry,
  TournamentSharedRaces,
  TournamentStandingClient,
  TournamentStandingEntry,
} from "../src/tournament-standing-client.js";
import { allByClass, descendants, FakeDocument, FakeNode } from "./dom-double.js";

function withClass(node: FakeNode, className: string): FakeNode[] {
  return allByClass(node, className);
}

/** Everything this node would read out. */
function readable(node: FakeNode): string { return node.textContent ?? ""; }

/** The panel whose title reads exactly this. */
function panelTitled(root: FakeNode, title: string): FakeNode {
  const found = withClass(root, "ds-panel").find((node) =>
    withClass(node, "ds-panel__title")[0]?.textContent === title);
  if (found === undefined) {
    throw new Error(`no panel titled "${title}" (have: ${
      withClass(root, "ds-panel__title").map((node) => node.textContent).join(", ")})`);
  }
  return found;
}

/** The compare control on a standing row, named by the Player it compares. */
function pick(root: FakeNode, displayName: string): FakeNode {
  const found = withClass(root, "ds-filter-chip").find((node) =>
    node.getAttribute("title") === `Compare ${displayName}`);
  if (found === undefined) { throw new Error(`no compare control for ${displayName}`); }
  return found;
}

/** The body rows of the table with this accessible name. */
function tableRows(root: FakeNode, caption: string): FakeNode[] {
  const table = withClass(root, "ds-table")
    .find((node) => node.getAttribute("aria-label") === caption);
  return (table?.children ?? []).filter((row) => row.getAttribute("data-head") === null);
}

/** The sheet the "Whose record" summary opens; it lives on the document, not in the route. */
function openWhoseRecord(root: FakeNode): FakeNode {
  const open = descendants(root).find((node) =>
    node.tagName === "button" && node.textContent === "Choose a Player");
  if (open === undefined) { throw new Error("the picker has no opener"); }
  open.click();
  const sheet = withClass(root.ownerDocument.body, "ds-dialog")[0];
  if (sheet === undefined) { throw new Error("the picker sheet did not open"); }
  return sheet;
}

function mount(
  client: TournamentStandingClient,
  viewer?: string | null,
  rivals?: ReadonlySet<string>,
  focusReference?: string,
): Readonly<{ root: FakeNode; ready: Promise<void> }> {
  const root = new FakeDocument().createElement("div");
  const mounted = mountTournamentStanding(
    root as unknown as HTMLElement,
    client,
    Promise.resolve(viewer ?? null),
    Promise.resolve(rivals ?? new Set<string>()),
    { async record() { return { playerId: "player.test", racesWithTrack: 0, racesWithoutTrack: 0, overallFieldShare: null, tracks: [] }; } },
    focusReference ?? null,
  );
  return { root, ready: mounted.ready };
}

function entry(
  overrides: Partial<TournamentStandingEntry> = {},
): TournamentStandingEntry {
  return {
    rank: 1,
    playerId: "player.ben",
    username: "ben",
    displayName: "Ben",
    score: 31.25,
    tournaments: 6,
    races: 48,
    wins: 12,
    podiums: 30,
    points: 480,
    finishPositionTotal: 144,
    finishes: [12, 10, 8, 6, 4, 3, 2, 1, 1, 1, 0, 0],
    ...overrides,
  };
}

/** Lets the comparison's shared-race count arrive and repaint. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 0); });
  }
}

/**
 * Shared races as the API answers them: by default every compared Player's
 * record is their own, over a count of 5; a test can answer differently.
 */
function sharedFrom(
  entries: readonly TournamentStandingEntry[],
): (ids: readonly string[]) => Promise<TournamentSharedRaces> {
  return async (ids) => ({
    sharedRaces: 5,
    entries: ids.map((id) => {
      const row = entries.find((candidate) => candidate.playerId === id)!;
      return {
        playerId: id, races: row.races, wins: row.wins, podiums: row.podiums,
        points: row.points, finishPositionTotal: row.finishPositionTotal,
        finishes: row.finishes,
      };
    }),
  });
}

function client(
  entries: readonly TournamentStandingEntry[],
  opponents: readonly TournamentRivalry[] = [],
  sharedRaces = sharedFrom(entries),
): TournamentStandingClient & { asked: string[][] } {
  const asked: string[][] = [];
  return {
    asked,
    async standing() { return entries; },
    async rivalries() { return opponents; },
    async sharedRaces(ids) { asked.push([...ids]); return sharedRaces(ids); },
  };
}

describe("the Tournament half of Ranking", () => {
  it("states what the standing is counted over", async () => {
    const { root, ready } = mount(client([entry()]));
    await ready;
    expect(readable(root)).toContain("finalized tournament");
  });

  it("says so plainly when no tournament has been finalized yet", async () => {
    const { root, ready } = mount(client([]));
    await ready;
    expect(readable(root)).toContain("No finalized tournament");
    expect(withClass(root, "ds-state")[0]?.getAttribute("data-state")).toBe("empty");
  });

  it("puts the viewer's own skill, tier and race record under the summary", async () => {
    const { root, ready } = mount(
      client([
        entry(),
        entry({ rank: 2, playerId: "player.evan", username: "evan", displayName: "Evan" }),
      ]),
      "player.ben",
    );
    await ready;
    // The summary says whose record this is; the panel under it is that record.
    expect(readable(withClass(root, "ds-filter-summary")[0]!)).toContain("Ben");
    const own = panelTitled(root, "Your tournament skill");
    const text = readable(own);
    expect(withClass(own, "ds-hero-rank")[0]?.textContent).toBe("#1");
    expect(text).toContain("31.25");
    // 144 finishing positions over 48 races, and 12 wins of those 48.
    expect(text).toContain("3.00");
    expect(text).toContain("25%");
    // The tier is a chip with the recovered colour, and its label is readable on it.
    expect(withClass(own, "ds-tier-chip")).toHaveLength(1);
  });

  it("offers a name to read somebody else's record, the way the phone does", async () => {
    const { root, ready } = mount(
      client([
        entry(),
        entry({ rank: 2, playerId: "player.evan", username: "evan", displayName: "Evan" }),
      ]),
      "player.ben",
    );
    await ready;
    const inlineSearch = withClass(root, "ds-tournament-picker__search")[0]!;
    inlineSearch.value = "ev";
    inlineSearch.dispatch("input");
    expect(withClass(root, "ds-tournament-picker__match")).toHaveLength(1);
    expect(readable(withClass(root, "ds-tournament-picker__match")[0]!)).toContain("Evan");
    const sheet = openWhoseRecord(root);
    const search = withClass(sheet, "ds-text-input")[0]!;
    // One letter is not a search; two are.
    search.value = "e";
    search.dispatch("input");
    expect(withClass(sheet, "ds-filter-chip")).toHaveLength(0);
    search.value = "ev";
    search.dispatch("input");
    const matches = withClass(sheet, "ds-filter-chip");
    expect(matches).toHaveLength(1);
    expect(readable(matches[0]!)).toContain("Evan");
    withClass(root, "ds-tournament-picker__match")[0]!.click();
    await settle();
    expect(panelTitled(root, "Evan — tournament skill")).toBeDefined();
  });

  it("ranks a name that starts with the query above one that merely contains it", () => {
    const rows = [
      entry({ rank: 1, playerId: "player.sadler", username: "sadler", displayName: "Sadler" }),
      entry({ rank: 2, playerId: "player.ad", username: "ad", displayName: "Ad" }),
    ];
    expect(standingPlayerMatches(rows, "ad").map((row) => row.displayName))
      .toEqual(["Ad", "Sadler"]);
    expect(standingPlayerMatches(rows, "a")).toEqual([]);
  });

  it("opens for a signed-out visitor on the leader, compared with #2 and #3", async () => {
    const { root, ready } = mount(client([
      entry({ playerId: "player.gideon", username: "gideon", displayName: "Gideon" }),
      entry({ rank: 2, playerId: "player.matteo", username: "matteo", displayName: "Matteo" }),
      entry({ rank: 3, playerId: "player.evan", username: "evan", displayName: "Evan" }),
      entry({ rank: 4, playerId: "player.nova", username: "nova", displayName: "Nova" }),
    ], [{
      playerId: "player.nova", username: "nova", displayName: "Nova",
      sharedRaces: 9, ahead: 5, behind: 4, tied: 0, averagePointsDelta: 0.5,
    }]));
    await ready;
    await settle();
    // Nothing reads as "yours": the panel is the leader's, by name.
    expect(readable(root)).not.toContain("Your tournament skill");
    expect(panelTitled(root, "Gideon — tournament skill")).toBeDefined();
    expect(withClass(root, "ds-legend__item").map(readable))
      .toEqual(["Gideon", "Matteo", "Evan"]);
    // The leader's competitors are shown, and they do not replace #2 and #3.
    expect(tableRows(root, "Competitors")).toHaveLength(1);
    expect(tableRows(root, "Tournament standing")).toHaveLength(4);
  });

  it("opens on the viewer and the rivals they follow", async () => {
    const { root, ready } = mount(
      client([
        entry(),
        entry({ rank: 2, playerId: "player.evan", username: "evan", displayName: "Evan" }),
        entry({ rank: 3, playerId: "player.nova", username: "nova", displayName: "Nova" }),
      ]),
      "player.ben",
      new Set(["player.nova"]),
    );
    await ready;
    await settle();
    expect(withClass(root, "ds-legend__item").map(readable)).toEqual(["Ben", "Nova"]);
    expect(withClass(root, "ds-tournament-picker")).toHaveLength(1);
    expect(withClass(root, "ds-tournament-picker__search")[0]?.tagName).toBe("input");
    expect(withClass(root, "ds-tournament-picker__search")[0]?.placeholder)
      .toBe("Search a Player");
    expect(withClass(root, "ds-tournament-skill__profile")[0]?.textContent).toBe("Your full profile →");
  });

  it("compares at most three Players, the same as the Time Trial half", async () => {
    const entries = ["ben", "evan", "nova", "matteo"].map((name, index) =>
      entry({
        rank: index + 1, playerId: `player.${name}`, username: name,
        displayName: name.replace(/^./u, (first) => first.toUpperCase()),
      }));
    const { root, ready } = mount(client(entries), "player.ben");
    await ready;
    pick(root, "Evan").click();
    pick(root, "Nova").click();
    pick(root, "Matteo").click();
    await settle();
    // The main Player stays; the third pick replaces the oldest other.
    expect(withClass(root, "ds-legend__item").map(readable))
      .toEqual(["Ben", "Nova", "Matteo"]);
  });

  it("charts the same three Players three ways", async () => {
    const { root, ready } = mount(
      client([
        entry(),
        entry({ rank: 2, playerId: "player.evan", username: "evan", displayName: "Evan" }),
      ]),
      "player.ben",
      new Set(["player.evan"]),
    );
    await ready;
    await settle();
    // Where the finishes land, how the races end, and the scoring rate.
    expect(withClass(root, "ds-chart")).toHaveLength(1);
    expect(withClass(root, "ds-chart")[0]?.getAttribute("data-group-spacing")).toBe("wide");
    expect(withClass(root, "ds-tournament-finishes__phone-intro").map(readable))
      .toEqual(["How often each finishing position happened."]);
    expect(withClass(root, "ds-split")).toHaveLength(4);
    expect(withClass(root, "ds-tournament-outcomes__row")).toHaveLength(2);
    expect(withClass(root, "ds-tournament-outcomes__legend-item").map(readable))
      .toEqual(["wins", "2nd/3rd", "rest"]);
    expect(withClass(root, "ds-tournament-points__row")).toHaveLength(2);
    expect(tableRows(root, "Points per race")).toHaveLength(2);
  });

  it("measures the scoring rate against the whole community, not the comparison", async () => {
    const { root, ready } = mount(client([
      entry({ races: 10, points: 100 }),
      entry({ rank: 2, playerId: "player.evan", username: "evan", displayName: "Evan", races: 10, points: 40 }),
    ]));
    await ready;
    // 140 points over 20 races.
    expect(readable(root)).toContain("7.0 per race");
    expect(withClass(root, "ds-tournament-points__average")).toHaveLength(2);
  });

  it("compares whoever is picked, and lets them be dropped again", async () => {
    const { root, ready } = mount(client([
      entry(),
      entry({ rank: 2, playerId: "player.evan", username: "evan", displayName: "Evan" }),
    ]), "player.ben");
    await ready;
    pick(root, "Evan").click();
    await settle();
    expect(withClass(root, "ds-legend__item").map(readable)).toEqual(["Ben", "Evan"]);
    // The main Player cannot be taken out of their own comparison: their row
    // says so instead of offering a control that would do nothing.
    expect(() => pick(root, "Ben")).toThrow();
    expect(readable(tableRows(root, "Tournament standing")[0]!)).toContain("Main Player");
    expect(pick(root, "Evan").getAttribute("data-phone-symbol")).toBe("−");
    const main = descendants(tableRows(root, "Tournament standing")[0]!)
      .find((node) => node.getAttribute("data-phone-symbol") === "●");
    expect(main).toBeDefined();
    pick(root, "Evan").click();
    await settle();
    expect(withClass(root, "ds-legend__item").map(readable)).toEqual(["Ben"]);
  });

  it("compares only the races everyone compared finished", async () => {
    const entries = [
      entry({ races: 300, wins: 40, podiums: 134, points: 2634 }),
      entry({ rank: 2, playerId: "player.matteo", username: "matteo", displayName: "Matteo",
        races: 327, wins: 124, podiums: 196, points: 3505 }),
      entry({ rank: 3, playerId: "player.valerio", username: "valerio", displayName: "Valerio",
        races: 207, wins: 36, podiums: 95, points: 1938 }),
    ];
    const record = (playerId: string, wins: number, points: number) => ({
      playerId, races: 105, wins, podiums: wins, points, finishPositionTotal: 420,
      finishes: [wins, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 105 - wins],
    });
    const api = client(entries, [], async (ids) => ({
      sharedRaces: ids.length === 3 ? 105 : 237,
      entries: ids.map((id) => id === "player.ben"
        ? record(id, 8, 838)
        : id === "player.matteo" ? record(id, 37, 1101) : record(id, 18, 978)),
    }));
    const { root, ready } = mount(api, "player.ben");
    await ready;
    // Ben with Matteo alone: two Players, the races they both finished.
    pick(root, "Matteo").click();
    await settle();
    expect(api.asked.at(-1)).toEqual(["player.ben", "player.matteo"]);
    expect(readable(root)).toContain("the 237 races Ben and Matteo both finished");
    // And Valerio beside them: only the races all three finished.
    pick(root, "Valerio").click();
    await settle();
    expect(api.asked.at(-1)).toEqual(["player.ben", "player.matteo", "player.valerio"]);
    expect(readable(root)).toContain("the 105 races Ben, Matteo and Valerio all finished");
    // 838 points over the 105 shared races, not 2634 over a career of 300.
    const rates = readable(panelTitled(root, "Points per race"));
    expect(rates).toContain("8.0");
    expect(rates).not.toContain("8.8");
    // The own panel above still tells the whole record.
    expect(readable(panelTitled(root, "Your tournament skill"))).toContain("300");
  });

  it("draws nothing rather than careers when the compared never raced together", async () => {
    const entries = [
      entry(),
      entry({ rank: 2, playerId: "player.evan", username: "evan", displayName: "Evan" }),
    ];
    const api = client(entries, [], async (ids) => ({
      sharedRaces: 0,
      entries: ids.map((playerId) => ({
        playerId, races: 0, wins: 0, podiums: 0, points: 0, finishPositionTotal: 0,
        finishes: Array.from({ length: 12 }, () => 0),
      })),
    }));
    const { root, ready } = mount(api, "player.ben");
    await ready;
    pick(root, "Evan").click();
    await settle();
    expect(readable(root)).toContain("never finished a race together");
    expect(withClass(root, "ds-chart")).toHaveLength(0);
    expect(withClass(root, "ds-split")).toHaveLength(0);
    expect(tableRows(root, "Points per race")).toHaveLength(0);
  });

  it("names the top five competitors and how those races went", async () => {
    const opponents: TournamentRivalry[] = Array.from(
      { length: 7 },
      (_unused, index) => ({
        playerId: `player.opponent${index}`,
        username: `opponent${index}`,
        displayName: `Opponent ${index}`,
        sharedRaces: 40 - index,
        ahead: 20 - index,
        behind: 18,
        tied: Math.max(0, 2 - index),
        averagePointsDelta: index === 0 ? 1.5 : -0.5,
      }),
    );
    const { root, ready } = mount(client([entry()], opponents), "player.ben");
    await ready;
    const rows = tableRows(root, "Competitors");
    expect(rows).toHaveLength(5);
    expect(readable(rows[0]!)).toContain("Opponent 0");
    expect(readable(rows[0]!)).toContain("20–18");
    expect(readable(rows[0]!)).toContain("+1.5");
  });

  it("opens a focused page on that Player and the people they race", async () => {
    // Landing on somebody else's Ranking and being shown the reader's own
    // comparison put one person's charts under another person's name.
    const standing = [
      entry({ playerId: "player.ben", username: "ben", displayName: "Ben", rank: 1 }),
      entry({ playerId: "player.clementine", username: "clementine", displayName: "Clementine", rank: 2 }),
      entry({ playerId: "player.moss", username: "moss", displayName: "Moss", rank: 3 }),
      entry({ playerId: "player.evan", username: "evan", displayName: "Evan", rank: 4 }),
    ];
    const rivalry = (playerId: string, displayName: string): TournamentRivalry => ({
      playerId, username: displayName.toLowerCase(), displayName,
      sharedRaces: 40, ahead: 20, behind: 18, tied: 2, averagePointsDelta: -1,
    });
    const { root, ready } = mount(
      {
        async standing() { return standing; },
        async sharedRaces(ids) { return sharedFrom(standing)(ids); },
        async rivalries(playerId: string) {
          return playerId === "player.clementine"
            ? [rivalry("player.moss", "Moss"), rivalry("player.evan", "Evan")]
            : [];
        },
      },
      "player.ben",
      new Set(["player.evan"]),
      "clementine",
    );
    await ready;
    const chosen = tableRows(root, "Tournament standing")
      .filter((row) => row.getAttribute("data-selected") === "true")
      .map(readable);
    expect(chosen).toHaveLength(3);
    expect(chosen.join(" ")).toContain("Clementine");
    expect(chosen.join(" ")).toContain("Moss");
    // Ben is the reader; his own row must not be in somebody else's charts.
    expect(chosen.join(" ")).not.toContain("Ben");
  });

  it("says out loud what the three numbers on a competitor row mean", async () => {
    // They used to carry a hover title only, and a phone has no hover:
    // "20-18 / 40 races / +1.5" is not readable on its own.
    const opponents: TournamentRivalry[] = [{
      playerId: "player.opponent0", username: "opponent0",
      displayName: "Opponent 0", sharedRaces: 40, ahead: 20, behind: 18,
      tied: 2, averagePointsDelta: -1.7,
    }];
    const { root, ready } = mount(client([entry()], opponents), "player.ben");
    await ready;
    const text = readable(panelTitled(root, "Your top 5 competitors"));
    expect(text).toContain("ahead-behind");
    expect(text).toContain("race points per shared race");
    // And it says which way the sign points, which is the part nobody guesses.
    expect(text).toContain("you score");
    expect(text).toContain("fewer");
    // The value itself carries a true minus, not a hyphen (DESIGN_SYSTEM §10).
    expect(text).toContain("−1.7");
    const competitor = tableRows(root, "Competitors")[0]!;
    const competitorCell = (key: string): FakeNode | undefined => competitor.children.find((cell) =>
      cell.getAttribute("data-key") === key);
    expect(competitorCell("record")?.getAttribute("data-phone")).toBe("2");
    expect(competitorCell("share")?.getAttribute("data-phone")).toBe("2");
    expect(competitorCell("shared")?.getAttribute("data-phone")).toBe("3");
    expect(competitorCell("delta")?.getAttribute("data-phone")).toBe("3");
  });

  it("presents the APK's scrollable phone standing without dropping numeric columns", async () => {
    const { root, ready } = mount(client([
      entry(),
      entry({ rank: 2, playerId: "player.evan", username: "evan", displayName: "Evan" }),
    ]), "player.ben", new Set(["player.evan"]));
    await ready;
    expect(withClass(root, "ds-tournament-standing__phone-intro").map(readable))
      .toEqual(["Tap + to compare up to two Players with the main Player (●)."]);
    const scroll = withClass(root, "ds-tournament-standing__scroll")[0]!;
    expect(scroll.getAttribute("role")).toBe("region");
    expect(scroll.getAttribute("aria-label")).toBe("Scrollable Tournament standing");
    expect(withClass(root, "ds-tournament-standing__phone-rivals").map(readable))
      .toEqual(["Your rivals open the comparison by default."]);
    const row = tableRows(root, "Tournament standing")[0]!;
    const cell = (key: string): FakeNode | undefined => row.children.find((candidate) =>
      candidate.getAttribute("data-key") === key);
    expect(["rank", "player", "score", "tournaments", "races", "wins", "podiums", "average", "pick"]
      .every((key) => cell(key) !== undefined)).toBe(true);
    expect(withClass(cell("rank")!, "ds-tournament-standing__phone-rank").map(readable)).toEqual(["1"]);
    expect(tableRows(root, "Tournament standing").map((candidate) => candidate.getAttribute("data-compare-series")))
      .toEqual(["1", "2"]);
  });

  it("asks for the leader's rivalries when nobody is signed in, so both pages carry the same cards", async () => {
    let asked: string | null = null;
    const { ready } = mount({
      async standing() { return [entry()]; },
      async rivalries(playerId: string) { asked = playerId; return []; },
      async sharedRaces() { return { sharedRaces: 0, entries: [] }; },
    });
    await ready;
    expect(asked).toBe("player.ben");
  });

  it("keeps an unrated Player readable rather than blank", async () => {
    const { score: _unrated, ...unrated } = entry();
    const { root, ready } = mount(
      client([unrated as TournamentStandingEntry]), "player.ben",
    );
    await ready;
    expect(readable(root)).toContain("Not rated yet");
    expect(readable(tableRows(root, "Tournament standing")[0]!)).toContain("—");
  });

  it("says the standing is unavailable rather than showing an empty page", async () => {
    const { root, ready } = mount({
      async standing() { throw new Error("gone"); },
      async rivalries() { return []; },
      async sharedRaces() { return { sharedRaces: 0, entries: [] }; },
    });
    await ready;
    expect(readable(root)).toContain("could not be loaded");
    expect(withClass(root, "ds-state")[0]?.getAttribute("data-state")).toBe("error");
  });

  it("marks your own row, the podium and the rank column the way every table does", async () => {
    const { root, ready } = mount(client([
      entry({ rank: 1, playerId: "player.gideon", username: "gideon", displayName: "Gideon" }),
      entry({ rank: 2, playerId: "player.ben", username: "ben", displayName: "Ben" }),
      entry({ rank: 3, playerId: "player.evan", username: "evan", displayName: "Evan" }),
    ]), "player.ben");
    await ready;
    const rows = tableRows(root, "Tournament standing");
    expect(rows.map((row) => row.getAttribute("data-podium"))).toEqual(["1", "2", "3"]);
    expect(rows[1]?.getAttribute("data-kind")).toBe("you");
    expect(readable(rows[1]!)).toContain("You");
    expect(readable(rows[0]!)).toContain("#1");
  });
});

describe("a rating that has started reverting", () => {
  const day = 86_400_000;
  const now = 1_000 * day;

  it("leaves the first year alone", () => {
    // Missing one Tournament is 217 to 315 days, and costs nothing.
    expect(ratingIsReverting(now - 300 * day, now)).toBe(false);
    expect(ratingIsReverting(now - 365 * day, now)).toBe(false);
  });

  it("marks a Player who has been away longer than that", () => {
    expect(ratingIsReverting(now - 400 * day, now)).toBe(true);
  });

  it("shows the APK's asterisk and explanation on the phone while retaining the desktop away chip", async () => {
    const { root, ready } = mount(client([
      entry({ lastRaceAtMs: Date.now() - 400 * day }),
    ]), "player.ben");
    await ready;
    expect(withClass(root, "ds-tournament-standing__phone-away-mark").map(readable)).toEqual(["*"]);
    expect(withClass(root, "ds-tournament-standing__phone-away").map(readable)[0])
      .toContain("has not raced in over a year");
    expect(withClass(root, "ds-tournament-standing__desktop-away")).toHaveLength(1);
  });

  it("says nothing about a Player whose last race is unknown", () => {
    expect(ratingIsReverting(undefined, now)).toBe(false);
  });
});
