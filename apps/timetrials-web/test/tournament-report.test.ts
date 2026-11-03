import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { PublicTournamentEvent } from "../src/tournament-operation-client.js";
import { spRankLine } from "../src/tournament-night-report-view.js";
import { deltaChartSvg, histogramSvg, lineChartSvg, reportPercent, tournamentReport, tournamentReportStages } from "../src/tournament-report.js";
import { readoutHtml, reportLineChart, type ChartPoint } from "../src/tournament-report-chart.js";
import { parseTournamentStories, tournamentStoryFor, tournamentStoryPlayer } from "../src/tournament-stories.js";
import { formatTournamentDate, isHistoryEditionId } from "../src/tournaments-view.js";

const race = (raceNumber: number, order: readonly string[], trackId?: string): PublicTournamentEvent["groups"][number]["races"][number] => ({
  raceNumber, ...(trackId === undefined ? {} : { trackId }), countsTowardStandings: true,
  placements: order.map((displayName, index) => ({ finishPosition: index + 1, displayName, racePoints: [15, 12, 10][index] ?? 0 })),
});

const event: PublicTournamentEvent = {
  tournamentId: "tournament.history-tn7", name: "Toernooi 7", editionNumber: 7, eventDate: "2024-05-31",
  stage: "finalized", publicResults: true, participantCount: 3,
  groups: [{
    groupId: "tournament_group.final", stage: "final", sequence: 1, name: "Kampioen", tierKey: "champion", seating: [],
    standings: [
      { rank: 1, displayName: "Bo", points: 42, races: 3, wins: 2, complete: true, seedRank: 12, seedScore: 24.345 },
      { rank: 2, displayName: "Ada", points: 37, races: 3, wins: 1, complete: true },
      { rank: 3, displayName: "Cy", points: 32, races: 3, wins: 0, complete: true },
    ],
    races: [
      race(1, ["Bo", "Ada", "Cy"], "track.baby_park"),
      race(2, ["Ada", "Bo", "Cy"], "track.baby_park"),
      race(3, ["Bo", "Cy", "Ada"], "track.mario_kart_stadium"),
    ],
  }],
  overall: [
    { placement: 1, displayName: "Bo", groupName: "Kampioen", groupRank: 1, points: 42 },
    { placement: 2, displayName: "Ada", groupName: "Kampioen", groupRank: 2, points: 37 },
    { placement: 3, displayName: "Cy", groupName: "Kampioen", groupRank: 3, points: 32 },
  ],
};

describe("a synthetic Tournament night's report", () => {
  const report = tournamentReport(event);
  const ada = report.groups[0]!.players.find((player) => player.displayName === "Ada")!;
  const bo = report.groups[0]!.players.find((player) => player.displayName === "Bo")!;

  it("follows every Player through the races: finish, total and the standing after each one", () => {
    expect(ada.rows.map((row) => [row.position, row.totalAfter, row.positionAfter, row.tiedAfter])).toEqual([
      [2, 12, 2, false], [1, 27, 1, true], [3, 37, 2, false],
    ]);
    expect(bo.rows.map((row) => row.positionAfter)).toEqual([1, 1, 1]);
    expect(bo.rows.map((row) => row.tiedAfter)).toEqual([false, true, false]);
  });

  it("carries the SP seed the night was drawn with, and prints before -> after once the night counted", () => {
    const [bo, ada] = report.groups[0]!.players;
    expect([bo!.seedRank, bo!.seedScore]).toEqual([12, 24.345]);
    expect([ada!.seedRank, ada!.seedScore]).toEqual([undefined, undefined]);
    const grown = spRankLine({ rank: 12, score: 24.345 }, { rank: 10, score: 25.1 });
    expect(grown?.text).toBe("SP Rank #12 (24.35) → #10 (25.10) +0.76");
    expect(grown?.delta).toBeCloseTo(0.755);
    const fallen = spRankLine({ rank: 3, score: 31.56 }, { rank: 5, score: 27.59 });
    expect(fallen?.text).toBe("SP Rank #3 (31.56) → #5 (27.59) −3.97");
    // The split says where the change came from; a stage without rated races is left out.
    const split = spRankLine({ rank: 2, score: 31.66 }, { rank: 1, score: 35.34, qualifierDelta: 1.2, finalDelta: 2.48 });
    expect(split?.text).toBe("SP Rank #2 (31.66) → #1 (35.34) +3.68 (qualifier +1.20 · final group +2.48)");
    expect(split?.split).toEqual({ qualifier: 1.2, final: 2.48 });
    expect(spRankLine({ rank: 2, score: 31.66 }, { rank: 1, score: 35.34, finalDelta: -0.5 })?.text).toBe("SP Rank #2 (31.66) → #1 (35.34) +3.68 (final group −0.50)");
    expect(fallen?.delta).toBeCloseTo(-3.97);
    expect(spRankLine({ rank: 12, score: 24.345 }, null)?.text).toBe("SP Rank #12 (24.35)");
    expect(spRankLine({}, { rank: 10, score: 25.1 })).toMatchObject({ text: "SP Rank ? → #10 (25.10)", before: null, delta: null });
    expect(spRankLine({}, null)).toBeNull();
  });

  it("counts the wins, the top-3 finishes, the best and the average finish", () => {
    expect([ada.winCount, ada.top3Count, ada.bestFinish, ada.avgFinish]).toEqual([1, 3, 1, 2]);
    expect([bo.winCount, bo.overallRank, ada.overallRank]).toEqual([2, 1, 2]);
    expect(reportPercent(ada.winCount, ada.raceCount)).toBe("33.3%");
  });

  it("measures the gap to the top three after every race and the duel with the place above", () => {
    expect(ada.benchmark.first.map((entry) => entry.delta)).toEqual([-3, 0, -5]);
    expect(ada.benchmark.third.map((entry) => entry.delta)).toEqual([2, 7, 5]);
    // The readout names who is being chased and prints both totals, so the
    // benchmark carries them beside the number.
    expect(ada.benchmark.first[0]).toMatchObject({ displayName: "Bo", playerTotal: 12, benchmarkTotal: 15 });
    // The leader duels #2; everyone else the Player one place up.
    expect(ada.opponent).toMatchObject({ displayName: "Bo", groupRank: 1, deltas: [-3, 0, -5] });
    expect(bo.opponent).toMatchObject({ displayName: "Ada", groupRank: 2, deltas: [3, 0, 5] });
  });

  it("spreads the finishes over the positions and ranks the tracks driven", () => {
    expect(ada.distribution.slice(0, 3)).toEqual([1, 1, 1]);
    expect(ada.distribution).toHaveLength(12);
    expect(report.topTracks).toEqual([{ trackId: "track.baby_park", count: 2 }, { trackId: "track.mario_kart_stadium", count: 1 }]);
    expect([report.raceCount, report.playerCount, report.maxPosition]).toEqual([3, 3, 12]);
  });

  it("draws the charts as SVG with a title on every point and the names escaped", () => {
    const line = lineChartSvg({
      series: [{ label: "<Ada>", color: "#fff", values: [2, 1, 1] }],
      yMin: 1, yMax: 12, invert: true, yStep: 1, xLabel: "Race",
      pointTitle: (label, index, value) => `${label} ${index + 1}: ${value}`,
    });
    expect(line.startsWith("<svg")).toBe(true);
    expect(line.match(/<circle/g)).toHaveLength(3);
    expect(line).toContain("<title>&lt;Ada&gt; 1: 2</title>");
    const delta = deltaChartSvg([-3, 3, 0], { positive: "#0f0", negative: "#f00" }, (index, value) => `${index}:${value}`);
    expect(delta.match(/<circle/g)).toHaveLength(3);
    expect(delta).toContain("tournament-report__baseline");
    const histogram = histogramSvg([1, 1, 1, 0], "#0ff", 2, (position, count) => `${position}=${count}`);
    expect(histogram.match(/<rect/g)).toHaveLength(4);
    expect(histogram).toContain("tournament-report__average");
  });
});

describe("the qualifiers beside the finals", () => {
  const night: PublicTournamentEvent = {
    ...event,
    groups: [
      {
        groupId: "tournament_group.q1", stage: "qualifier", sequence: 1, name: "Groep 1", seating: [],
        standings: [
          { rank: 1, displayName: "Ada", points: 27, races: 2, wins: 2, complete: true },
          { rank: 2, displayName: "Bo", points: 22, races: 2, wins: 0, complete: true },
          { rank: 3, displayName: "Dee", points: 20, races: 2, wins: 0, complete: true },
        ],
        races: [race(1, ["Ada", "Bo", "Dee"], "track.rainbow_road"), race(2, ["Ada", "Dee", "Bo"], "track.rainbow_road")],
      },
      ...event.groups,
    ],
  };
  it("shows the finals by default and the qualifiers on request, with the night's own Top 5", () => {
    expect(tournamentReportStages(night)).toEqual(["final", "qualifier"]);
    const finals = tournamentReport(night);
    expect(finals.stage).toBe("final");
    expect(finals.groups.map((group) => group.name)).toEqual(["Kampioen"]);
    const qualifiers = tournamentReport(night, "qualifier");
    expect(qualifiers.stage).toBe("qualifier");
    expect(qualifiers.groups.map((group) => group.name)).toEqual(["Groep 1"]);
    expect(qualifiers.groups[0]!.players.map((player) => [player.displayName, player.raceCount, player.winCount])).toEqual([["Ada", 2, 2], ["Bo", 2, 0], ["Dee", 2, 0]]);
    // The Top 5 counts every race of the night, whichever stage is read.
    expect(finals.topTracks).toEqual(qualifiers.topTracks);
    expect(finals.topTracks.slice(0, 2)).toEqual([{ trackId: "track.baby_park", count: 2 }, { trackId: "track.rainbow_road", count: 2 }]);
    expect(finals.raceCount).toBe(5);
    // A stage the night did not race falls back to what it did.
    expect(tournamentReport(event, "qualifier").stage).toBe("final");
    expect(tournamentReportStages(event)).toEqual(["final"]);
  });
});

describe("the community's stories", () => {
  const stories = parseTournamentStories({
    schemaVersion: "mk8dx.tournament-stories.v2",
    stories: [{
      edition: 7, sourceUrl: "https://example.test/tn7", title: "TN7", intro: ["Op 31 mei was het weer zover."], summary: [], topTracks: ["Baby Park weer."],
      groups: [{ name: "2e Divisie", paragraphs: ["Minder races."] }],
      players: [
        { rank: 12, name: "Clem", paragraphs: ["Heel Mookhoek."], analysis: [] },
        { rank: 6, name: "Moss HM", paragraphs: ["Fanatiek gamer."], analysis: ["Constant."] },
        { name: "Milo V", paragraphs: ["Rode lantaarn."], analysis: [] },
        { name: "Milo J", paragraphs: ["Zwager."], analysis: [] },
      ],
    }, { edition: "x" }],
  });

  it("keeps the editions with a number and matches names the way the group chat writes them", () => {
    expect(stories).toHaveLength(1);
    const story = tournamentStoryFor(stories, 7);
    expect(story?.intro).toEqual(["Op 31 mei was het weer zover."]);
    expect(tournamentStoryPlayer(story, "Clementine")?.paragraphs).toEqual(["Heel Mookhoek."]);
    expect(tournamentStoryPlayer(story, "Moss HM")?.analysis).toEqual(["Constant."]);
    expect(tournamentStoryPlayer(story, "moss")?.name).toBe("Moss HM");
    // Two Marks: a bare "Milo" is nobody in particular.
    expect(tournamentStoryPlayer(story, "Milo")).toBeNull();
    expect(tournamentStoryFor(stories, 8)).toBeNull();
    expect(tournamentStoryFor(stories, undefined)).toBeNull();
  });
});

describe("dates and history ids on the Tournaments page", () => {
  it("writes the month in letters and recognises a history edition", () => {
    expect(formatTournamentDate("2026-09-05")).toBe("2026-Sep-05");
    expect(formatTournamentDate(undefined, Date.UTC(2026, 11, 24))).toBe("2026-Dec-24");
    expect(formatTournamentDate(undefined)).toBe("");
    expect(isHistoryEditionId("tournament.history-tn7")).toBe(true);
    expect(isHistoryEditionId("tournament.synthetic_event_0001")).toBe(false);
  });
});

describe("the shipped stories file", () => {
  const shipped = parseTournamentStories(JSON.parse(
    readFileSync(new URL("../styles/tournament-stories.json", import.meta.url), "utf8")));

  it("starts without another community's reports", () => {
    expect(shipped).toEqual([]);
    expect(tournamentStoryFor(shipped, 4)).toBeNull();
  });

  it("still resolves an operator-created report by edition and participant", () => {
    const own = parseTournamentStories({ stories: [{
      edition: 1, title: "First night", sourceUrl: "", intro: [], summary: [], topTracks: [],
      groups: [], players: [{ name: "Ada", paragraphs: ["A close finish."], analysis: [] }],
    }] });
    expect(tournamentStoryPlayer(tournamentStoryFor(own, 1), "Ada")?.paragraphs).toEqual(["A close finish."]);
  });
});

describe("the readout, in the shape each chart asks for", () => {
  const head = { race: "Race 7", label: "Kampioen · race 7" };

  it("names the track beside the place, and every tie under it", () => {
    const point: ChartPoint = {
      raceNumber: 7, label: "7", head, mode: "place-track",
      values: [{
        label: "Ben", color: "#22965a", value: 3, display: "3e plek 🥉",
        lines: ["SNES Mario Circuit 3", "gelijk met Evan"],
      }],
    };
    const html = readoutHtml(point, "Geen datapunt");
    expect(html).toContain("<strong>Race 7</strong>");
    expect(html).toContain("<span>Kampioen · race 7</span>");
    expect(html).toContain('class="tournament-report__readout-place">3e plek 🥉<');
    // One line: the track, then the tie, in the same cell (owner, 2026-09-28).
    expect(html).toContain('class="tournament-report__readout-line">SNES Mario Circuit 3<');
    expect(html).toContain('class="tournament-report__readout-extra">gelijk met Evan<');
    expect(html).not.toContain("colspan");
    // A place readout has no key swatch: the place itself is the label.
    expect(html).not.toContain("readout-key");
  });

  it("names the Player being chased and prints both totals", () => {
    const point: ChartPoint = {
      raceNumber: 7, label: "7", head, mode: "benchmark",
      values: [{
        label: "Verschil met 1e", color: "#c8922f", value: -12, display: "-12",
        pack: { displayName: "Matteo", benchmarkTotal: 15, playerTotal: 3, delta: -12, unit: "punten" },
      }],
    };
    const html = readoutHtml(point, "Geen datapunt");
    expect(html).toContain("tournament-report__readout-table--benchmark");
    expect(html).toContain(">-12<");
    expect(html).toContain(">punten<");
    expect(html).toContain(">Matteo<");
    expect(html).toContain(">vs<");
    // The Player's own total first, then the one they are chasing.
    expect(html.indexOf(">3<")).toBeLessThan(html.indexOf(">15<"));
  });

  it("lists the tracks a finishing place was reached on", () => {
    const point: ChartPoint = {
      raceNumber: 2, label: "2", head: { race: "Positie 2", label: "2e plek 🥈" }, mode: "compact",
      values: [
        { label: "Aandeel", color: "#22965a", value: 6, display: "18,8% (6x)" },
        { label: "Banen", color: "#22965a", value: 6, display: "", lines: ["Hyrule-Circuit  1x", "Wervelwoud  2x"] },
      ],
    };
    const html = readoutHtml(point, "Geen datapunt");
    expect(html).toContain("tournament-report__readout-table--compact");
    expect(html).toContain("18,8% (6x)");
    // Side by side where there is room, each track with its own pictures.
    expect(html).toContain('<span class="tournament-report__readout-line">Hyrule-Circuit  1x</span><span class="tournament-report__readout-line">Wervelwoud  2x</span>');
  });

  it("says so when a bar has nothing behind it", () => {
    const point: ChartPoint = { raceNumber: 5, label: "5", head, mode: "compact", values: [] };
    expect(readoutHtml(point, "Geen datapunt")).toContain("Geen datapunt");
  });
});

describe("a place chart's podium", () => {
  const chart = (podium: boolean): string => reportLineChart({
    series: [{ label: "Ben", color: "#22965a", values: [1, 2, 3, 4] }],
    points: [], yMin: 1, yMax: 12, invert: true, yStep: 1, ...(podium ? { podium: true } : {}),
    xLabel: "Race", ariaLabel: "Positie na race",
  });

  // Stale presentation assertion, replaced rather than weakened (Phase 11): the first three places
  // were medal glyphs and are now numerals in their rank colours (DESIGN_SYSTEM §15, §17), the same
  // decision the boards, the meta line and the Android twin took. What the case defends is
  // unchanged: the podium is marked in place of the dot, and it answers to the pointer as a dot does.
  it("draws the place in its rank colour in place of the dot on the first three", () => {
    const drawn = chart(true);
    expect(drawn).not.toContain("\u{1F3C6}");
    expect(drawn).toContain("tournament-report__podium--gold");
    expect(drawn).toContain("tournament-report__podium--silver");
    expect(drawn).toContain("tournament-report__podium--bronze");
    // Never an inline style: the hosted pages are served under `style-src 'self'`.
    expect(drawn).not.toContain("style=");
    // Three marked places and one plain dot, for the fourth place.
    expect(drawn.match(/class="tournament-report__podium /gu)?.length).toBe(3);
    expect(drawn.match(/tournament-report__dot/gu)?.length).toBe(1);
    expect(drawn).toContain('data-index="0"');
  });

  it("leaves a chart of differences alone", () => {
    const drawn = chart(false);
    expect(drawn).not.toContain("\u{1F3C6}");
    expect(drawn.match(/tournament-report__dot/gu)?.length).toBe(4);
  });
});

describe("the duel with the place above", () => {
  const drawn = reportLineChart({
    series: [{ label: "Ben", color: "#22965a", values: [4, -6, 0, 9] }],
    points: [], yMin: -10, yMax: 10, yStep: 5, baseline: 0,
    duel: { ahead: "Ben", behind: "Moss HM" },
    xLabel: "Race", ariaLabel: "Ben vs Moss HM",
  });

  it("fills each side of the rule and names who owns it", () => {
    // One area path per side, the same shape seen through two clips, so a race
    // that crosses the rule needs no arithmetic to split it.
    expect(drawn).toContain("tournament-report__duel-area--ahead");
    expect(drawn).toContain("tournament-report__duel-area--behind");
    expect(drawn.match(/clip-path="url\(#duel-(above|below)-\d+\)"/gu)?.length).toBe(2);
    // The name of the Player whose half it is, at the top and at the bottom.
    const names = [...drawn.matchAll(/class="tournament-report__duel-name" x="\d+" y="(\d+)"[^>]*>([^<]+)</gu)]
      .map((match) => [Number(match[1]), match[2]]);
    expect(names).toHaveLength(2);
    expect(names[0]![1]).toBe("Ben");
    expect(names[1]![1]).toBe("Moss HM");
    // Ben is above: a smaller y is higher on the chart.
    expect(Number(names[0]![0])).toBeLessThan(Number(names[1]![0]));
  });

  it("colours every point by the side it is on", () => {
    expect(drawn.match(/tournament-report__dot--ahead/gu)?.length).toBe(3);
    expect(drawn.match(/tournament-report__dot--behind/gu)?.length).toBe(1);
    // One line, not one per side.
    expect(drawn.match(/tournament-report__duel-line/gu)?.length).toBe(1);
  });

  it("gives two charts on one page their own clips", () => {
    const second = reportLineChart({
      series: [{ label: "Evan", color: "#22965a", values: [1, -1] }],
      points: [], yMin: -5, yMax: 5, yStep: 5, baseline: 0,
      duel: { ahead: "Evan", behind: "Merle" }, xLabel: "Race", ariaLabel: "Evan vs Merle",
    });
    const idOf = (html: string): string => /id="(duel-above-\d+)"/u.exec(html)![1]!;
    expect(idOf(drawn)).not.toBe(idOf(second));
  });
});
