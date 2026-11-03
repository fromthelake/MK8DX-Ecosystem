import { describe, expect, it } from "vitest";

import {
  MINIMUM_RACES_FOR_A_VERDICT,
  buildTrackRows,
  filterTrackRows,
  mountTournamentTracks,
  parseNumericFilter,
  SORT_OPENS_DESCENDING,
  sortTrackRows,
  winPercentage,
  winPercentageColor,
} from "../src/tournament-track-section.js";
import type {
  TournamentTrackClient, TrackRecord, TrackRecordEntry,
} from "../src/tournament-track-client.js";
import { descendants, FakeDocument, FakeNode } from "./dom-double.js";

function textOf(node: FakeNode): string {
  return [node, ...descendants(node)]
    .map((child) => child.textContent ?? "").join(" ");
}

function track(
  trackId: string,
  relativeToOwnAverage: number,
  races = 5,
): TrackRecordEntry {
  return {
    trackId, races, wins: 1, podiums: 2, bestFinish: 1, worstFinish: 9,
    averageFinish: 4.2, averagePoints: 8, averageFieldShare: 0.3,
    relativeToOwnAverage, lastRacedAtMs: 1_774_569_600_000,
  };
}

function client(record: Partial<TrackRecord>): TournamentTrackClient {
  return {
    async record() {
      return {
        playerId: "player.test", racesWithTrack: 100, racesWithoutTrack: 0,
        overallFieldShare: 0.4, tracks: [], ...record,
      };
    },
  };
}

function mount(
  trackClient: TournamentTrackClient, name = "Matteo",
): Readonly<{ root: FakeNode; mounted: ReturnType<typeof mountTournamentTracks> }> {
  const document = new FakeDocument();
  const root = document.createElement("div");
  const mounted = mountTournamentTracks(
    root as unknown as HTMLElement, "player.test", name, trackClient);
  return { root, mounted };
}

describe("winPercentage", () => {
  it("puts first at 100 and last at nothing, whatever the field", () => {
    // fieldShare is 0 for first and 1 for last, so a group of ten and a group
    // of twelve land on the same number: tenth of ten, eleventh of eleven and
    // twelfth of twelve are all a 0% win.
    expect(winPercentage(0)).toBe(100);
    expect(winPercentage(1)).toBe(0);
    expect(winPercentage(0.5)).toBe(50);
  });
});

describe("buildTrackRows", () => {
  it("lists every track in the game, not only the ones raced", () => {
    const rows = buildTrackRows([track("track.gcn_baby_park", -0.2)]);
    // The point of the table: which have I never touched?
    expect(rows.length).toBe(96);
    const raced = rows.filter((row) => row.races > 0);
    expect(raced).toHaveLength(1);
    expect(raced[0]!.name).toBe("GCN Baby Park");
    expect(raced[0]!.winPercentage).toBeCloseTo(70, 6);
    const untouched = rows.find((row) => row.trackId !== "track.gcn_baby_park")!;
    expect(untouched.winPercentage).toBeNull();
    expect(untouched.races).toBe(0);
  });

  it("carries the cup, so a reader can find the track in the game", () => {
    const rows = buildTrackRows([]);
    expect(rows[0]!.cupName.length).toBeGreaterThan(0);
  });
});

describe("sortTrackRows", () => {
  const rows = buildTrackRows([
    track("track.gcn_baby_park", -0.2, 6),
    track("track.rainbow_road", 0.3, 2),
  ]).filter((row) => ["GCN Baby Park", "Rainbow Road", "Water Park"]
    .includes(row.name));

  it("sorts by how often a track was raced", () => {
    expect(sortTrackRows(rows, "races", true).map((row) => row.name))
      .toEqual(["GCN Baby Park", "Rainbow Road", "Water Park"]);
  });

  it("sorts the track column on the game's own cup order", () => {
    const all = buildTrackRows([]);
    expect(sortTrackRows(all, "track", false)[0]!.name).toBe("Mario Kart Stadium");
    expect(sortTrackRows(all, "track", true)[0]!.name).toBe("Wii Rainbow Road");
    // Alphabetical would have put 3DS DK Jungle first, which is not where
    // anybody looks for it.
    expect(sortTrackRows(all, "track", false)[0]!.name).not.toBe("3DS DK Jungle");
  });

  const varied = (): ReturnType<typeof buildTrackRows> => buildTrackRows([
    { ...track("track.gcn_baby_park", -0.2, 6), wins: 4, bestFinish: 2, averageFinish: 5.5 },
    { ...track("track.rainbow_road", 0.3, 2), wins: 1, bestFinish: 1, averageFinish: 8.0 },
    { ...track("track.dolphin_shoals", 0.1, 9), wins: 0, bestFinish: 3, averageFinish: 3.1 },
  ]).filter((row) => row.races > 0 || row.name === "Water Park");

  it("sorts on races won", () => {
    expect(sortTrackRows(varied(), "wins", true).map((row) => row.name).slice(0, 3))
      .toEqual(["GCN Baby Park", "Rainbow Road", "Dolphin Shoals"]);
  });

  it("sorts on the best finish, where a first place is the small number", () => {
    // Ascending is the direction that means "my best tracks first".
    expect(sortTrackRows(varied(), "best", false).map((row) => row.name).slice(0, 3))
      .toEqual(["Rainbow Road", "GCN Baby Park", "Dolphin Shoals"]);
    expect(sortTrackRows(varied(), "best", true).map((row) => row.name)[0])
      .toBe("Dolphin Shoals");
  });

  it("sorts on the average finish, lowest first", () => {
    expect(sortTrackRows(varied(), "average", false).map((row) => row.name).slice(0, 3))
      .toEqual(["Dolphin Shoals", "GCN Baby Park", "Rainbow Road"]);
  });

  it("opens a finishing-position column on the best value, not the worst", () => {
    // Clicking "Best" to be shown your worst track would be the wrong answer
    // to the click, so these two columns open ascending.
    expect(SORT_OPENS_DESCENDING.best).toBe(false);
    expect(SORT_OPENS_DESCENDING.average).toBe(false);
    expect(SORT_OPENS_DESCENDING.wins).toBe(true);
    expect(SORT_OPENS_DESCENDING.races).toBe(true);
  });

  it("keeps unraced tracks last on every new column too", () => {
    for (const key of ["wins", "best", "average"] as const) {
      for (const descending of [true, false]) {
        expect(sortTrackRows(varied(), key, descending).at(-1)!.name)
          .toBe("Water Park");
      }
    }
  });

  it("never lets an unraced track outrank one somebody is bad at", () => {
    // Water Park has no percentage. Sorting ascending on win% must still put
    // it last, or the tracks worth practising get buried under the ones
    // nobody has ever seen.
    expect(sortTrackRows(rows, "win", false).at(-1)!.name).toBe("Water Park");
    expect(sortTrackRows(rows, "win", true).at(-1)!.name).toBe("Water Park");
  });
});

describe("tournament track section", () => {
  it("shows the APK's four strongest and four practice tracks", async () => {
    const { root, mounted } = mount(client({ tracks: [
      track("track.gcn_baby_park", -0.4),
      track("track.bowsers_castle", -0.3),
      track("track.snes_rainbow_road", -0.2),
      track("track.dolphin_shoals", -0.1),
      track("track.water_park", 0.1),
      track("track.mario_kart_stadium", 0.2),
    ] }));
    await mounted.ready;
    const columns = descendants(root)
      .filter((node) => node.className === "track-record__column");
    expect(columns).toHaveLength(2);
    for (const column of columns) {
      expect(descendants(column).filter((node) => node.className === "track-record__row"))
        .toHaveLength(4);
    }
    expect(textOf(columns[0]!)).not.toContain("Water Park");
    expect(textOf(columns[1]!)).not.toContain("Bowser's Castle");
  });

  it("separates what to lean on from what to work on", async () => {
    const { root, mounted } = mount(client({
      tracks: [
        track("track.gcn_baby_park", -0.2),
        track("track.bowsers_castle", -0.11),
        track("track.snes_rainbow_road", 0.22),
      ],
    }));
    await mounted.ready;
    const columns = descendants(root)
      .filter((node) => node.className === "track-record__column");
    expect(columns).toHaveLength(2);
    // The strongest track leads the first column and the weakest the second.
    expect(textOf(columns[0]!)).toContain("Baby Park");
    expect(textOf(columns[1]!)).toContain("Rainbow Road");
    expect(textOf(columns[0]!)).toContain("20%");
    expect(descendants(columns[0]!).some((node) =>
      node.className.split(" ").includes("activity-list__cup"))).toBe(true);
    expect(descendants(columns[0]!).some((node) => node.tagName === "small"))
      .toBe(false);
  });

  it("leaves a thin track out of the verdict but keeps it in the deep dive", async () => {
    const { root, mounted } = mount(client({
      tracks: [
        track("track.gcn_baby_park", -0.2, MINIMUM_RACES_FOR_A_VERDICT),
        track("track.dolphin_shoals", -0.9, 1),
      ],
    }));
    await mounted.ready;
    const columns = descendants(root)
      .find((node) => node.className === "track-record__columns")!;
    // One lucky race is a good night, not a strength.
    expect(textOf(columns)).not.toContain("Dolphin Shoals");
    const table = descendants(root)
      .find((node) => node.className === "track-record__table")!;
    expect(textOf(table)).toContain("Dolphin Shoals");
    // And every other track in the game, raced or not.
    const bodyRows = descendants(table).filter((node) => node.tagName === "tr");
    // 96 tracks, the heading row and the filter row.
    expect(bodyRows.length).toBe(98);
  });

  it("re-sorts the table when a header is clicked", async () => {
    const { root, mounted } = mount(client({
      tracks: [
        track("track.gcn_baby_park", -0.2, 6),
        track("track.rainbow_road", 0.3, 2),
      ],
    }));
    await mounted.ready;
    // The first cell of the first body row: whichever track sorts to the top.
    const topTrack = (): string => {
      const table = descendants(root)
        .find((node) => node.className === "track-record__table")!;
      const body = table.children.find((node) => node.tagName === "tbody")!;
      const cell = body.children[0]!.children[0]!;
      // The track cell carries its picture and its name inside the link to
      // that track's own TrueSkill page, so the name sits one level deeper.
      const name = [cell, ...descendants(cell)]
        .find((node) => node.tagName === "span" && (node.textContent ?? "") !== "");
      return cell.textContent ?? name?.textContent ?? "";
    };
    // Opens on how often each track was raced, most first.
    expect(topTrack()).toBe("GCN Baby Park");
    const sortByName = descendants(root).find((node) =>
      node.tagName === "button" && (node.textContent ?? "").startsWith("Track"))!;
    sortByName.click();
    // Cup order, not alphabetical: the game opens on Mario Kart Stadium and a
    // player looking for a track looks for it where the console puts it.
    expect(topTrack()).toBe("Mario Kart Stadium");
    sortByName.click();
    // And the second click reverses it, ending on the last cup.
    expect(topTrack()).toBe("Wii Rainbow Road");
  });

  it("offers every column a reader would rank on", async () => {
    const { root, mounted } = mount(client({
      tracks: [
        { ...track("track.gcn_baby_park", -0.2, 6), wins: 4, bestFinish: 2, averageFinish: 5.5 },
        { ...track("track.rainbow_road", 0.3, 2), wins: 1, bestFinish: 1, averageFinish: 8.0 },
      ],
    }));
    await mounted.ready;
    const heads = descendants(root)
      .filter((node) => node.className === "ds-sort")
      .map((node) => (node.textContent ?? "").replace(/ [▼▲↕]$/u, ""));
    expect(heads).toEqual(["Track", "Raced", "Won", "Best", "Average", "Win %"]);

    const topTrack = (): string => {
      const table = descendants(root)
        .find((node) => node.className === "track-record__table")!;
      const body = table.children.find((node) => node.tagName === "tbody")!;
      const cell = body.children[0]!.children[0]!;
      // The track cell carries its picture and its name inside the link to
      // that track's own TrueSkill page, so the name sits one level deeper.
      const name = [cell, ...descendants(cell)]
        .find((node) => node.tagName === "span" && (node.textContent ?? "") !== "");
      return cell.textContent ?? name?.textContent ?? "";
    };
    const head = (label: string) => descendants(root).find((node) =>
      node.tagName === "button" && (node.textContent ?? "").startsWith(label))!;

    // A first place is a 1, so "Best" has to open on the smallest number.
    head("Best").click();
    expect(topTrack()).toBe("Rainbow Road");
    head("Average").click();
    expect(topTrack()).toBe("GCN Baby Park");
    head("Won").click();
    expect(topTrack()).toBe("GCN Baby Park");
  });

  it("says how many races carry no track rather than averaging over it", async () => {
    const { root, mounted } = mount(client({
      racesWithTrack: 215, racesWithoutTrack: 68,
      tracks: [track("track.gcn_baby_park", -0.2)],
    }));
    await mounted.ready;
    const notes = descendants(root)
      .filter((node) => node.className.split(" ").includes("ds-body-s"))
      .map((node) => node.textContent ?? "").join(" ");
    expect(notes).toContain("215");
    expect(notes).toContain("68");
    const phoneSummary = descendants(root).find((node) =>
      node.className === "track-record__deep-dive-phone-title");
    expect(phoneSummary?.textContent).toBe("Show all 96 tracks — 1 raced");
    const phoneNote = descendants(root).find((node) =>
      node.className === "ds-body-s track-record__note--phone");
    expect(phoneNote?.textContent).toBe(
      "Over 215 races whose track is known; 68 more have no recording.");
  });

  it("explains an empty record instead of showing an empty card", async () => {
    const { root, mounted } = mount(
      client({ racesWithTrack: 0, racesWithoutTrack: 44, tracks: [] }), "Puck");
    await mounted.ready;
    expect(textOf(root)).toContain("Puck");
    expect(descendants(root)
      .some((node) => node.className === "track-record__columns")).toBe(false);
  });

  it("reports an unavailable read without breaking the page", async () => {
    const { root, mounted } = mount({
      async record() { throw new Error("unavailable"); },
    });
    await mounted.ready;
    expect(textOf(root).toLowerCase()).toContain("unavailable");
  });

  it("removes itself and abandons its request when unmounted", async () => {
    let seen: AbortSignal | undefined;
    const { root, mounted } = mount({
      async record(_playerId, signal) {
        seen = signal;
        return {
          playerId: "player.test", racesWithTrack: 1, racesWithoutTrack: 0,
          overallFieldShare: 0.4, tracks: [track("track.gcn_baby_park", -0.2)],
        };
      },
    });
    await mounted.ready;
    mounted.unmount();
    expect(root.children).toHaveLength(0);
    expect(seen?.aborted).toBe(true);
  });

  describe("the filter boxes over the table", () => {
    const rows = buildTrackRows([
      { trackId: "track.mario_kart_stadium", races: 6, wins: 2, averageFinish: 2.5, bestFinish: 1, averageFieldShare: 0.2, relativeToOwnAverage: -0.1 },
      { trackId: "track.water_park", races: 3, wins: 0, averageFinish: 7, bestFinish: 5, averageFieldShare: 0.6, relativeToOwnAverage: 0.2 },
    ] as unknown as TrackRecordEntry[]);

    it("reads an operator and a number, a bare number as equals, and nothing else", () => {
      expect(parseNumericFilter("> 3")).toEqual({ operator: ">", value: 3 });
      expect(parseNumericFilter("<=2")).toEqual({ operator: "<=", value: 2 });
      expect(parseNumericFilter("3")).toEqual({ operator: "=", value: 3 });
      expect(parseNumericFilter("<> 0")).toEqual({ operator: "<>", value: 0 });
      expect(parseNumericFilter("2,5")).toEqual({ operator: "=", value: 2.5 });
      expect(parseNumericFilter("80%")).toEqual({ operator: "=", value: 80 });
      expect(parseNumericFilter("")).toBeNull();
      expect(parseNumericFilter("hoi")).toBeNull();
    });

    it("matches text on contains and numbers on the operator, hiding tracks without a value", () => {
      expect(filterTrackRows(rows, { track: "kart stad" }).map((row) => row.trackId)).toEqual(["track.mario_kart_stadium"]);
      expect(filterTrackRows(rows, { cup: "mushroom" })).toHaveLength(4);
      expect(filterTrackRows(rows, { races: "> 3" }).map((row) => row.trackId)).toEqual(["track.mario_kart_stadium"]);
      expect(filterTrackRows(rows, { races: "0" })).toHaveLength(rows.length - 2);
      expect(filterTrackRows(rows, { best: "< 3" }).map((row) => row.trackId)).toEqual(["track.mario_kart_stadium"]);
      expect(filterTrackRows(rows, { win: ">= 40" }).map((row) => row.trackId)).toEqual(["track.mario_kart_stadium", "track.water_park"]);
      expect(filterTrackRows(rows, { win: "< 50" }).map((row) => row.trackId)).toEqual(["track.water_park"]);
      expect(filterTrackRows(rows, { average: "hoi" })).toHaveLength(rows.length);
    });

    it("colours a win percentage from red through yellow to light green", () => {
      expect(winPercentageColor(0)).toBe("hsl(0 78% 68%)");
      expect(winPercentageColor(50)).toBe("hsl(60 78% 68%)");
      expect(winPercentageColor(100)).toBe("hsl(120 78% 68%)");
      expect(winPercentageColor(140)).toBe("hsl(120 78% 68%)");
    });
  });
});
