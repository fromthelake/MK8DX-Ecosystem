// The night's report, in the shape the community's own exported report has:
// a light document with serif headings, the story on top, the Top 5 tracks
// driven with their own pictures, and then, per group, a section per Player
// with the five charts and a readout that follows the pointer.
//
// The export is a 7 MB file with every chart drawn up front. This page draws a
// Player's charts when their section comes into view, so the same document
// opens at once.

import {
  groupBoard, sectionIndex, tierChip, useDocument,
  type BoardRow, type SectionIndexHandle,
} from "./ds-components.js";
import { sanitizeReportMarkup } from "./tournament-report-markup.js";
import { trackAsset, GAME_ASSET_BASE } from "./asset-manifest.js";
import { tournamentCharacterIcon } from "./tournament-character.js";
import { localized, productLocaleTag } from "./product-language.js";
import { findSchema9WebTrack } from "./schema9-track-catalog.js";
import type { PublicReportRatings, PublicTournamentEvent } from "./tournament-operation-client.js";
import {
  bindReportChart,
  reportBarChart,
  reportLineChart,
  type ChartPoint,
} from "./tournament-report-chart.js";
import {
  type ReportStage,
  reportAccent,
  reportAccentIndex,
  reportNumber,
  reportPercent,
  tournamentReport,
  type ReportGroup,
  type ReportPlayer,
  type TournamentReport,
} from "./tournament-report.js";
import { tournamentStoryPlayer, type TournamentStory } from "./tournament-stories.js";
import { tournamentGroupColour, tournamentTierByRank } from "./tournament-tiers.js";
import { displayTournamentGroupLabel } from "./tournaments-view-labels.js";

const slug = (value: string): string => value.normalize("NFD").replace(/\p{M}/gu, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function paragraphs(document: Document, texts: readonly string[], className: string): HTMLElement[] {
  return texts.map((text) => {
    const paragraph = document.createElement("p");
    paragraph.className = className;
    paragraph.textContent = text;
    return paragraph;
  });
}

/** The Director's formatted blocks when the report has them, else the plain
 * paragraphs. The markup is sanitised again here: nothing reaches the page
 * that the allow-list does not know, whatever the server sent. */
function copy(document: Document, texts: readonly string[], html: readonly string[] | undefined, className: string): HTMLElement[] {
  if (html === undefined || html.length === 0) { return paragraphs(document, texts, className); }
  return html.flatMap((block) => {
    const holder = document.createElement("div");
    holder.className = `${className} tournament-report__rich`;
    const safe = sanitizeReportMarkup(block);
    if (safe.length === 0) { return []; }
    holder.innerHTML = safe;
    return [holder];
  });
}

export type ReportBlockKey = "intro" | "summary" | "topTracks" | `group:${string}` | `player:${string}`;

/** A text block the editor can open in place: its key names the field it
 * writes. Empty blocks are only drawn when the page is being edited. */
function block(document: Document, key: ReportBlockKey, children: readonly HTMLElement[], editable: boolean): HTMLElement | null {
  if (children.length === 0 && !editable) { return null; }
  const wrapper = document.createElement("div");
  wrapper.className = "tournament-report__block";
  wrapper.setAttribute("data-report-block", key);
  wrapper.append(...children);
  return wrapper;
}

function trackLabel(trackId: string): string {
  return findSchema9WebTrack(trackId)?.displayName ?? trackId.replace(/^track\./, "").replace(/_/g, " ");
}

/**
 * The block the export opens with: the night's own heading and the note under
 * it. The export prints the tournament's name; this prints the community's own
 * title for the night ("TN12 'WaLuigi Forever'") because that is the heading
 * they gave it themselves.
 */
export function renderTournamentStory(
  document: Document, story: TournamentStory | null, editable = false,
  shows: Readonly<{ intro: boolean; summary: boolean }> = { intro: true, summary: true },
): HTMLElement | null {
  // A block the Director unticked is left out, in the editor's page too.
  const introShown = shows.intro && story !== null && (editable || story.intro.length > 0);
  const summaryShown = shows.summary && story !== null && (editable || story.summary.length > 0);
  if (story === null || (!introShown && !summaryShown)) { return null; }
  const section = document.createElement("section");
  section.className = "tournament-report__story";
  const title = document.createElement("h2");
  title.className = "tournament-report__title";
  const strong = document.createElement("strong");
  strong.textContent = story.title;
  title.append(strong);
  section.append(title);
  const intro = copy(document, story.intro, story.introHtml, "tournament-report__copy");
  const [first, ...rest] = intro;
  const introBlock = document.createElement("div");
  introBlock.className = "tournament-report__block";
  introBlock.setAttribute("data-report-block", "intro");
  if (first !== undefined) { introBlock.append(first); }
  if (rest.length > 0 && !editable) {
    const more = document.createElement("details");
    more.className = "tournament-report__more";
    const summary = document.createElement("summary");
    summary.textContent = localized("Read on", "Lees verder");
    more.append(summary, ...rest);
    introBlock.append(more);
  } else if (rest.length > 0) {
    introBlock.append(...rest);
  }
  if (introShown && (first !== undefined || editable)) { section.append(introBlock); }
  if (summaryShown) {
    const heading = document.createElement("h3");
    heading.className = "tournament-report__summary-title";
    heading.textContent = localized("Summary", "Samenvatting");
    const summaryBlock = block(document, "summary", copy(document, story.summary, story.summaryHtml, "tournament-report__copy"), editable);
    if (summaryBlock !== null) { section.append(heading, summaryBlock); }
  }
  if (story.sourceUrl.length > 0) {
    const source = document.createElement("a");
    source.className = "tournament-report__source";
    source.setAttribute("href", story.sourceUrl);
    source.setAttribute("rel", "noopener");
    source.setAttribute("target", "_blank");
    source.textContent = localized("Read the original report", "Lees het originele verslag");
    section.append(source);
  }
  return section;
}

function infoBubble(document: Document, text: string): HTMLElement {
  const bubble = document.createElement("span");
  bubble.className = "tournament-report__info";
  bubble.setAttribute("title", text);
  bubble.setAttribute("aria-label", text);
  bubble.textContent = "i";
  return bubble;
}

/** One chart: its title, its info bubble, the drawing and the readout. */
function figure(
  document: Document,
  heading: string,
  info: string,
  svg: string,
  points: readonly ChartPoint[],
  layout: "line" | "bar",
): HTMLElement {
  const block = document.createElement("figure");
  block.className = "tournament-report__figure";
  const caption = document.createElement("figcaption");
  caption.className = "tournament-report__figure-title";
  caption.textContent = heading;
  caption.append(infoBubble(document, info));
  const shell = document.createElement("div");
  // The shape is known before the drawing is: with it the box never changes
  // size, and the browser may skip an off-screen chart entirely. A published
  // night carries 175 of them, and rastering them all was the last of the
  // reader's stutter (owner, 2026-09-16).
  shell.className = `tournament-report__chart-shell tournament-report__chart-shell--${layout}`;
  shell.innerHTML = svg;
  const readout = document.createElement("div");
  readout.className = "tournament-report__readout";
  readout.setAttribute("role", "status");
  // The slider under the chart borrows this for its own label.
  readout.setAttribute("data-scrubber-label", localized(`${heading}: pick a race`, `${heading}: kies een race`));
  block.append(caption, shell, readout);
  bindReportChart(shell, readout, points, layout, localized("No data point", "Geen datapunt"));
  return block;
}

function ordinal(value: number): string {
  return localized(
    `${value}${value % 10 === 1 && value % 100 !== 11 ? "st" : value % 10 === 2 && value % 100 !== 12 ? "nd" : value % 10 === 3 && value % 100 !== 13 ? "rd" : "th"}`,
    `${value}e`,
  );
}

/**
 * The five charts of one Player, drawn when their section comes into view.
 * Headings, tooltips and readouts follow the community's own export: the place
 * charts name the track, the benchmark names who is being chased, and the
 * distribution names the tracks behind each bar. A Player who leads their group
 * gets four: there is nobody above them to duel.
 */
function renderPlayerCharts(
  document: Document,
  player: ReportPlayer,
  maxPosition: number,
  shows: ReportVisibility,
): HTMLElement[] {
  if (player.rows.length === 0) { return []; }
  const accent = reportAccent(player.groupRank);
  const raceLabel = localized("Race", "Race");
  const pointsWord = localized("points", "punten");
  const groupLabel = displayTournamentGroupLabel(player.groupName, player.groupTierKey);
  /** The readout's head: "Race 7" and, beside it, "Kampioen · race 7". */
  const head = (index: number): Readonly<{ race: string; label: string }> => {
    const row = player.rows[index];
    const number = row?.raceNumber ?? index + 1;
    return { race: `${raceLabel} ${number}`, label: `${groupLabel} · ${localized("race", "race")} ${number}` };
  };
  /**
   * "3e plek". The export printed a medal glyph on the first three; the charts draw the podium in
   * the rank colours instead (§15, §17), and the place is always written out in words.
   */
  const place = (position: number, _medal: boolean): string =>
    localized(`${ordinal(position)} place`, `${position}e plek`);
  const trackOf = (index: number): readonly string[] => {
    const trackId = player.rows[index]?.trackId;
    return trackId === undefined ? [localized("Track not recorded", "Baan niet vastgelegd")] : [trackLabel(trackId)];
  };
  const iconsFor = (trackId: string | undefined): readonly Readonly<{ src: string; alt: string }>[] => {
    const asset = trackId === undefined ? undefined : trackAsset(trackId);
    return asset === undefined ? [] : [
      { src: `${GAME_ASSET_BASE}${asset.cup.iconPath}`, alt: asset.cup.name },
      { src: `${GAME_ASSET_BASE}${asset.previewPath}`, alt: asset.name },
    ];
  };
  const iconsOf = (index: number): readonly Readonly<{ src: string; alt: string }>[] => iconsFor(player.rows[index]?.trackId);
  const figures: HTMLElement[] = [];

  const standingMax = Math.max(maxPosition, ...player.rows.map((row) => row.positionAfter));
  const standingPoints: readonly ChartPoint[] = player.rows.map((row, index) => ({
    raceNumber: row.raceNumber, label: `${row.raceNumber}`, head: head(index), mode: "place-track",
    values: [{
      label: player.displayName, color: accent, value: row.positionAfter,
      display: `${row.tiedAfter ? localized("T", "G") : ""}${place(row.positionAfter, true)}`,
      lines: [...trackOf(index), localized(`${row.totalAfter} points`, `${row.totalAfter} punten`)], icons: iconsOf(index),
    }],
  }));
  figures.push(figure(document,
    localized("Position after race", "Positie na race"),
    localized(
      "Shows the interim standing position after each race. Lower is better: 1 is at the top and the line tracks ranking through the tournament.",
      "Toont na elke race de tussenstandpositie. Lager is beter: 1 staat bovenaan en de lijn volgt de ranking door het toernooi.",
    ),
    reportLineChart({
      series: [{ label: player.displayName, color: accent, values: player.rows.map((row) => row.positionAfter) }],
      points: standingPoints,
      yMin: 1, yMax: standingMax, invert: true, yStep: standingMax > 12 ? 2 : 1, podium: true,
      xLabel: raceLabel, ariaLabel: localized("Position after race", "Positie na race"),
    }),
    standingPoints,
    "line",
  ));

  const finishPoints: readonly ChartPoint[] = player.rows.map((row, index) => ({
    raceNumber: row.raceNumber, label: `${row.raceNumber}`, head: head(index), mode: "place-track",
    values: [{
      label: player.displayName, color: accent, value: row.position,
      display: place(row.position, true),
      lines: [...trackOf(index), localized(`${row.racePoints} points`, `${row.racePoints} punten`)], icons: iconsOf(index),
    }],
  }));
  figures.push(figure(document,
    localized("Finish position", "Finishpositie"),
    localized(
      "Shows the actual finishing position per race, so you can read rhythm, peaks and dips separately from total points.",
      "Toont de daadwerkelijke finishpositie per race. Hiermee zie je ritme, pieken en dips los van puntentotaal.",
    ),
    reportLineChart({
      series: [{ label: player.displayName, color: accent, values: player.rows.map((row) => row.position) }],
      points: finishPoints,
      yMin: 1, yMax: maxPosition, invert: true, yStep: maxPosition > 12 ? 2 : 1, podium: true,
      xLabel: raceLabel, ariaLabel: localized("Finish position", "Finishpositie"),
    }),
    finishPoints, "line",
  ));

  const benchmarkColors = ["#c8922f", "#7d8794", "#a8663a"] as const;
  const benchmarkLabels = [
    localized("Delta vs 1st", "Verschil met 1e"),
    localized("Delta vs 2nd", "Verschil met 2e"),
    localized("Delta vs 3rd", "Verschil met 3e"),
  ] as const;
  const series = [player.benchmark.first, player.benchmark.second, player.benchmark.third];
  const benchmarkValues = series.flat().map((entry) => entry.delta);
  const magnitude = Math.max(10, ...benchmarkValues.map((value) => Math.abs(value)));
  const step = magnitude > 80 ? 20 : magnitude > 40 ? 10 : 5;
  const limit = Math.ceil(magnitude / step) * step;
  const benchmarkPoints: readonly ChartPoint[] = player.rows.map((row, index) => ({
    raceNumber: row.raceNumber, label: `${row.raceNumber}`, head: head(index), mode: "benchmark",
    values: series.map((entries, rank) => {
      const entry = entries[index];
      return {
        label: benchmarkLabels[rank]!, color: benchmarkColors[rank]!, value: entry?.delta ?? 0,
        display: `${(entry?.delta ?? 0) > 0 ? "+" : ""}${entry?.delta ?? 0}`,
        pack: {
          displayName: entry?.displayName ?? "",
          benchmarkTotal: entry?.benchmarkTotal ?? 0,
          playerTotal: entry?.playerTotal ?? 0,
          delta: entry?.delta ?? 0,
          unit: pointsWord,
        },
      };
    }),
  }));
  if (shows.benchmark) { figures.push(figure(document,
    localized("Top 3 total benchmark", "Top 3 totaalbenchmark"),
    localized(
      "Shows the points delta versus the current 1st, 2nd and 3rd after each race. 0 is tied; positive means this player is ahead.",
      "Toont het puntenverschil met de actuele nummer 1, 2 en 3 per race. 0 is gelijk; positief betekent dat deze speler voorligt.",
    ),
    reportLineChart({
      series: series.map((entries, rank) => ({
        label: benchmarkLabels[rank]!, color: benchmarkColors[rank]!,
        values: entries.map((entry) => entry.delta), area: true,
      })),
      points: benchmarkPoints, yMin: -limit, yMax: limit, yStep: step, baseline: 0,
      xLabel: raceLabel, ariaLabel: localized("Top 3 total benchmark", "Top 3 totaalbenchmark"),
    }),
    benchmarkPoints, "line",
  )); }

  if (shows.duel && player.opponent !== undefined) {
    const opponent = player.opponent;
    const opponentAccent = reportAccent(opponent.groupRank);
    // The readout still reads the gap from both sides, so a reader sees the
    // number in whichever direction they were thinking.
    const duelPoints: readonly ChartPoint[] = opponent.deltas.map((delta, index) => ({
      raceNumber: player.rows[index]?.raceNumber ?? index + 1,
      label: `${player.rows[index]?.raceNumber ?? index + 1}`,
      head: head(index), mode: "delta",
      values: [
        {
          label: localized(`${player.displayName} ahead`, `${player.displayName} voor`),
          color: accent, value: delta, display: `${delta > 0 ? "+" : ""}${delta} ${pointsWord}`,
        },
        {
          label: localized(`${opponent.displayName} ahead`, `${opponent.displayName} voor`),
          color: opponentAccent, value: -delta, display: `${-delta > 0 ? "+" : ""}${-delta} ${pointsWord}`,
        },
      ],
    }));
    const duelMagnitude = Math.max(5, ...opponent.deltas.map((value) => Math.abs(value)));
    const duelStep = duelMagnitude > 60 ? 20 : duelMagnitude > 30 ? 10 : 5;
    const duelLimit = Math.ceil(duelMagnitude / duelStep) * duelStep;
    figures.push(figure(document,
      `#${player.groupRank} ${player.displayName} VS #${opponent.groupRank} ${opponent.displayName}`,
      localized(
        "Shows the points gap between two players per shared race. Above the zero line player A leads, below it player B.",
        "Toont per gedeelde race het puntverschil tussen twee spelers. Boven de nullijn ligt speler A voor, onder de nullijn speler B.",
      ),
      reportLineChart({
        series: [{ label: player.displayName, color: accent, values: [...opponent.deltas] }],
        points: duelPoints, yMin: -duelLimit, yMax: duelLimit, yStep: duelStep, baseline: 0,
        // Above the rule this Player leads, below it the other one does, and
        // both names stand on their own side.
        duel: { ahead: player.displayName, behind: opponent.displayName },
        xLabel: raceLabel, ariaLabel: `${player.displayName} vs ${opponent.displayName}`,
      }),
      duelPoints, "line",
    ));
  }

  // Which tracks a finishing place was reached on, listed under the bar in
  // the game's own track order, each with its cup and its picture; a race
  // without a recorded track comes last.
  const tracksByPosition = new Map<number, Map<string, number>>();
  for (const row of player.rows) {
    const key = row.trackId ?? "";
    const bucket = tracksByPosition.get(row.position) ?? new Map<string, number>();
    bucket.set(key, (bucket.get(key) ?? 0) + 1);
    tracksByPosition.set(row.position, bucket);
  }
  const trackOrder = (trackId: string): number => trackId === "" ? Number.MAX_SAFE_INTEGER : findSchema9WebTrack(trackId)?.index ?? Number.MAX_SAFE_INTEGER - 1;
  const tracksBehind = (position: number): readonly Readonly<{ trackId: string; times: number }>[] =>
    [...(tracksByPosition.get(position) ?? new Map<string, number>())]
      .sort((left, right) => trackOrder(left[0]) - trackOrder(right[0]) || left[0].localeCompare(right[0]))
      .map(([trackId, times]) => ({ trackId, times }));
  const distributionPoints: readonly ChartPoint[] = player.distribution.map((count, index) => ({
    raceNumber: index + 1, label: `${index + 1}`, mode: "compact",
    head: {
      race: localized(`Position ${index + 1}`, `Positie ${index + 1}`),
      label: place(index + 1, true),
    },
    values: count === 0 ? [] : [
      {
        label: localized("Share", "Aandeel"), color: accent, value: count,
        display: `${reportPercent(count, player.raceCount)} (${count}x)`,
      },
      {
        label: localized("Tracks", "Banen"), color: accent, value: count, display: "",
        lines: tracksBehind(index + 1).map((entry) => `${entry.trackId === "" ? localized("Track not recorded", "Baan niet vastgelegd") : trackLabel(entry.trackId)}  ${entry.times}x`),
        pictures: tracksBehind(index + 1).map((entry) => iconsFor(entry.trackId === "" ? undefined : entry.trackId)),
      },
    ],
  }));
  if (shows.distribution) { figures.push(figure(document,
    localized("Position distribution", "Positieverdeling"),
    localized(
      "Shows how often each finishing position occurred. Hover a bar for share and the tracks where that result happened.",
      "Toont hoe vaak elke finishpositie voorkwam. Hover op een balk voor aandeel en de banen waarop die positie is behaald.",
    ),
    reportBarChart({
      counts: player.distribution, color: accent,
      ...(player.avgFinish === undefined ? {} : { average: player.avgFinish }),
      points: distributionPoints,
      xLabel: localized("Finish position", "Finishpositie"),
      ariaLabel: localized("Position distribution", "Positieverdeling"),
    }),
    distributionPoints, "bar",
  )); }
  return figures;
}

/**
 * "Rank #1 van #35 | Kampioen #1", under the name and in the section index.
 *
 * §15/§17: a podium place is a numeral in its rank colour, not 🏆/🥈/🥉. The same decision the
 * ranking tables took in Phase 6 and the Android twin took in Phase 11.
 */
function playerMetaLine(player: ReportPlayer, playerCount: number): string {
  const medal = "";
  return [
    player.overallRank === undefined
      ? null
      : localized(`Rank #${player.overallRank} of #${playerCount}`, `Rank #${player.overallRank} van #${playerCount}`),
    `${displayTournamentGroupLabel(player.groupName, player.groupTierKey)} #${player.groupRank}${medal}`,
  ].filter((part): part is string => part !== null).join(" | ");
}

const spScore = (score: number): string =>
  score.toLocaleString(productLocaleTag(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The Player's place on the SP ranking: what they came in with, and where the
 * night left them once it counted. "SP Rank #12 (24,34) → #10 (25,10) +0,76";
 * only the half that is known when the other is not; nothing when neither is.
 * The rank wears the tier badge of the standing page, and the score change is
 * green when the SP grew and red when it fell.
 */
export type SpRankLine = Readonly<{
  text: string;
  before: Readonly<{ rank: number; score?: number }> | null;
  after: Readonly<{ rank: number; score: number }> | null;
  /** after minus before, when both scores are known. */
  delta: number | null;
  /** The night's change split by stage, when the races were rated per stage. */
  split: Readonly<{ qualifier: number | null; final: number | null }> | null;
}>;

const spDelta = (value: number): string => `${value > 0 ? "+" : value < 0 ? "−" : "±"}${spScore(Math.abs(value))}`;

export function spRankLine(
  before: Readonly<{ rank?: number; score?: number }>,
  after: Readonly<{ rank: number; score: number; qualifierDelta?: number; finalDelta?: number }> | null,
): SpRankLine | null {
  const half = (rank: number | undefined, score: number | undefined): string | null =>
    rank === undefined ? null : `#${rank}${score === undefined ? "" : ` (${spScore(score)})`}`;
  const start = half(before.rank, before.score);
  const end = after === null ? null : half(after.rank, after.score);
  if (start === null && end === null) { return null; }
  const delta = after !== null && before.score !== undefined ? after.score - before.score : null;
  const split = after !== null && (after.qualifierDelta !== undefined || after.finalDelta !== undefined)
    ? { qualifier: after.qualifierDelta ?? null, final: after.finalDelta ?? null }
    : null;
  const splitText = split === null ? "" : ` (${[
    split.qualifier === null ? null : `${localized("qualifier", "kwalificatie")} ${spDelta(split.qualifier)}`,
    split.final === null ? null : `${localized("final group", "eindgroep")} ${spDelta(split.final)}`,
  ].filter((part): part is string => part !== null).join(" · ")})`;
  const text = end === null ? `SP Rank ${start}` : `SP Rank ${start ?? "?"} → ${end}${delta === null ? "" : ` ${spDelta(delta)}`}${splitText}`;
  return {
    text,
    before: before.rank === undefined ? null : { rank: before.rank, ...(before.score === undefined ? {} : { score: before.score }) },
    after: after === null ? null : { rank: after.rank, score: after.score },
    delta,
    split,
  };
}

/** The line as the page draws it: badge, score, arrow, badge, score, change. */
function renderSpRank(document: Document, line: SpRankLine): HTMLElement {
  const paragraph = document.createElement("p");
  paragraph.className = "tournament-report__meta tournament-report__sp";
  paragraph.setAttribute("aria-label", line.text);
  const badge = (rank: number): HTMLElement => {
    useDocument(document);
    const tier = tournamentTierByRank(rank);
    // The SP rank wears the standing page's own tier colour, through the system's chip, which is
    // what guarantees the label on it stays readable in every appearance (§6, product data).
    const node = tierChip(`#${rank}`, tier?.color ?? "var(--ds-border-strong)");
    node.classList.add("tournament-report__sp-rank");
    return node;
  };
  const score = (value: number | undefined): Node => document.createTextNode(value === undefined ? " " : ` (${spScore(value)}) `);
  paragraph.append("SP Rank ");
  if (line.before !== null) { paragraph.append(badge(line.before.rank), score(line.before.score)); } else { paragraph.append("? "); }
  if (line.after !== null) {
    paragraph.append("→ ", badge(line.after.rank), score(line.after.score));
    if (line.delta !== null) {
      const change = document.createElement("span");
      change.className = `tournament-report__sp-delta tournament-report__sp-delta--${line.delta > 0 ? "up" : line.delta < 0 ? "down" : "same"}`;
      change.textContent = spDelta(line.delta);
      paragraph.append(change);
    }
    if (line.split !== null) {
      // The split: how much the qualifiers gave and how much the finals gave.
      const split = document.createElement("span");
      split.className = "tournament-report__sp-split";
      const part = (label: string, value: number | null): void => {
        if (value === null) { return; }
        if (split.childNodes.length > 0) { split.append(" · "); }
        split.append(`${label} `);
        const amount = document.createElement("span");
        amount.className = `tournament-report__sp-delta tournament-report__sp-delta--${value > 0 ? "up" : value < 0 ? "down" : "same"}`;
        amount.textContent = spDelta(value);
        split.append(amount);
      };
      part(localized("qualifier", "kwalificatie"), line.split.qualifier);
      part(localized("final group", "eindgroep"), line.split.final);
      paragraph.append(" (", split, ")");
    }
  }
  return paragraph;
}

/** What a Player's section needs beyond the Player: where "back" goes, which stage it shows, and the other side of the night. */
type PlayerSectionExtra = Readonly<{
  backHref: string;
  stage: ReportStage;
  /** The same Player in the other stage; `show` replaces the section with that side. */
  alternate: Readonly<{ show(section: HTMLElement): void }> | null;
}>;

function renderPlayer(
  document: Document,
  player: ReportPlayer,
  story: TournamentStory | null,
  playerCount: number,
  maxPosition: number,
  observe: (section: HTMLElement, draw: () => void) => void,
  editionNumber: number | undefined,
  shows: ReportVisibility,
  editable = false,
  ratings: PublicReportRatings | null = null,
  extra: PlayerSectionExtra = { backHref: "#tournament-event-heading", stage: "final", alternate: null },
): HTMLElement {
  const section = document.createElement("section");
  section.className = `tournament-report__player tournament-report__player--accent-${reportAccentIndex(player.groupRank)}`;
  section.setAttribute("id", `speler-${slug(player.displayName)}`);

  const head = document.createElement("div");
  head.className = "tournament-report__player-head";
  const name = document.createElement("h4");
  name.className = "tournament-report__player-name";
  name.textContent = player.displayName;
  // The character they drove, exactly as the export prints it beside the name.
  const icon = reportCharacterPicture(editionNumber, player.displayName, player.character);
  if (icon !== null) {
    const picture = document.createElement("img");
    picture.className = "tournament-report__player-character";
    picture.src = icon.src;
    picture.alt = icon.label;
    picture.title = icon.label;
    picture.loading = "lazy";
    picture.decoding = "async";
    name.append(picture);
  }
  const meta = document.createElement("p");
  meta.className = "tournament-report__meta";
  meta.textContent = playerMetaLine(player, playerCount);
  const sp = spRankLine(
    { ...(player.seedRank === undefined ? {} : { rank: player.seedRank }), ...(player.seedScore === undefined ? {} : { score: player.seedScore }) },
    ratings?.players.find((entry) => entry.name === player.displayName) ?? null,
  );
  const kpi = document.createElement("p");
  kpi.className = "tournament-report__kpi";
  kpi.textContent = player.raceCount === 0
    ? localized("No races recorded", "Geen races vastgelegd")
    : localized(
      `Wins: ${player.winCount} (${reportPercent(player.winCount, player.raceCount)}) | Top 3: ${player.top3Count} (${reportPercent(player.top3Count, player.raceCount)}) | Avg. pos: ${reportNumber(player.avgFinish ?? 0, 2)}`,
      `Overwinningen: ${player.winCount} (${reportPercent(player.winCount, player.raceCount)}) | Top 3: ${player.top3Count} (${reportPercent(player.top3Count, player.raceCount)}) | Gem. pos: ${reportNumber(player.avgFinish ?? 0, 2)}`,
    );
  head.append(name, meta, ...(sp === null ? [] : [renderSpRank(document, sp)]), kpi);
  // The same Player on the other side of the night: the switch sits with the
  // Player, so the reader need not travel to the top to see their qualifiers.
  if (extra.alternate !== null) {
    const swap = extra.alternate;
    const stages = document.createElement("div");
    stages.className = "tournament-report__player-stages";
    for (const stage of ["final", "qualifier"] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tournament-report__stage tournament-report__stage--player";
      button.dataset["stage"] = stage;
      button.setAttribute("aria-pressed", stage === extra.stage ? "true" : "false");
      button.textContent = stage === "final" ? localized("Final group", "Eindgroep") : localized("Qualifier", "Kwalificatie");
      if (stage !== extra.stage) { button.addEventListener("click", () => swap.show(section)); }
      stages.append(button);
    }
    head.append(stages);
  }
  section.append(head);

  const summaryTitle = document.createElement("h5");
  summaryTitle.className = "tournament-report__summary-title";
  summaryTitle.textContent = localized("Summary:", "Samenvatting:");
  section.append(summaryTitle);
  const note = tournamentStoryPlayer(story, player.displayName);
  if (editable) {
    const written = note === null ? [] : copy(document, note.paragraphs, note.html, "tournament-report__copy");
    section.append(block(document, `player:${player.displayName}`, written, true)!);
  } else if (note !== null && (note.paragraphs.length > 0 || note.analysis.length > 0)) {
    section.append(block(document, `player:${player.displayName}`, copy(document, note.paragraphs, note.html, "tournament-report__copy"), false) ?? document.createDocumentFragment() as unknown as HTMLElement);
    if (note.analysis.length > 0) {
      const analysisTitle = document.createElement("h5");
      analysisTitle.className = "tournament-report__analysis-title";
      analysisTitle.textContent = localized("Analysis & statistics", "Analyse & Statistieken");
      section.append(analysisTitle, ...paragraphs(document, note.analysis, "tournament-report__copy"));
    }
  } else {
    const group = displayTournamentGroupLabel(player.groupName, player.groupTierKey);
    section.append(...paragraphs(document, [localized(
      `${player.displayName} finished ${ordinal(player.groupRank)} in ${group} with ${player.points} points${player.raceCount === 0 ? "." : `: ${player.raceCount} races, ${player.winCount} win${player.winCount === 1 ? "" : "s"} and ${player.top3Count} top-3 finish${player.top3Count === 1 ? "" : "es"}.`}`,
      `${player.displayName} eindigde als ${ordinal(player.groupRank)} in ${group} met ${player.points} punten${player.raceCount === 0 ? "." : `: ${player.raceCount} races, ${player.winCount} overwinning${player.winCount === 1 ? "" : "en"} en ${player.top3Count} keer top 3.`}`,
    )], "tournament-report__copy tournament-report__copy--generated"));
  }

  // The charts are the weight of this page; they arrive when the section does.
  const charts = document.createElement("div");
  charts.className = "tournament-report__charts";
  section.append(charts);
  observe(section, () => {
    if (charts.childElementCount > 0) { return; }
    charts.append(...renderPlayerCharts(document, player, maxPosition, shows));
  });

  const back = document.createElement("a");
  back.className = "tournament-report__back";
  back.setAttribute("href", extra.backHref);
  back.textContent = localized("Back to the standing", "Terug naar eindstand");
  section.append(back);
  return section;
}

/** The Top 5 tracks driven, each row on its own picture, as the export has it. */
function renderTopTracks(
  document: Document,
  tracks: readonly Readonly<{ trackId: string; count: number }>[],
  story: TournamentStory | null,
  editable = false,
): HTMLElement | null {
  if (!editable && tracks.length === 0 && (story?.topTracks.length ?? 0) === 0) { return null; }
  const section = document.createElement("section");
  section.className = "tournament-report__tracks";
  const title = document.createElement("h3");
  title.textContent = localized("Top 5 tracks driven during this Tournament", "Top 5 gereden banen dit toernooi");
  section.append(title);
  const topTracksBlock = block(document, "topTracks", story === null ? [] : copy(document, story.topTracks, story.topTracksHtml, "tournament-report__copy"), editable);
  if (topTracksBlock !== null) { section.append(topTracksBlock); }
  if (tracks.length === 0) { return section; }
  const list = document.createElement("ol");
  list.className = "tournament-report__top";
  const headRow = document.createElement("li");
  headRow.className = "tournament-report__top-head";
  for (const [className, text] of [
    ["tournament-report__top-index", "#"],
    ["tournament-report__top-name", localized("Track", "Baan")],
    ["tournament-report__top-count", localized("Times played", "Keer gespeeld")],
  ] as const) {
    const cell = document.createElement("span");
    cell.className = className;
    cell.textContent = text;
    headRow.append(cell);
  }
  list.append(headRow);
  tracks.forEach((entry, index) => {
    const item = document.createElement("li");
    item.className = "tournament-report__top-row";
    const asset = trackAsset(entry.trackId);
    if (asset !== undefined) {
      // The track's own picture behind its row, the way the export prints it.
      const picture = document.createElement("img");
      picture.className = "tournament-report__top-picture";
      picture.src = `${GAME_ASSET_BASE}${asset.previewPath}`;
      picture.alt = "";
      picture.loading = "lazy";
      picture.decoding = "async";
      item.append(picture);
    }
    const rank = document.createElement("span");
    rank.className = "tournament-report__top-index";
    rank.textContent = `${index + 1}`;
    const name = document.createElement("span");
    name.className = "tournament-report__top-name";
    name.textContent = trackLabel(entry.trackId);
    const count = document.createElement("strong");
    count.className = "tournament-report__top-count";
    count.textContent = `${entry.count}`;
    item.append(rank, name, count);
    list.append(item);
  });
  section.append(list);
  return section;
}

/** The picture beside a name follows the night's own recorded character. */
function reportCharacterPicture(
  _editionNumber: number | undefined,
  _displayName: string,
  character: ReportPlayer["character"],
): Readonly<{ src: string; label: string }> | null {
  const icon = tournamentCharacterIcon(character);
  return icon === null ? null : { src: icon, label: character?.label ?? "" };
}

/**
 * Which blocks a published night shows. A past edition shows everything; a
 * night of our own shows what its Director left ticked.
 */
type ReportVisibility = Readonly<{
  topTracks: boolean; benchmark: boolean; duel: boolean; distribution: boolean;
  intro: boolean; summary: boolean; groupNotes: boolean;
}>;
const EVERYTHING: ReportVisibility = {
  topTracks: true, benchmark: true, duel: true, distribution: true, intro: true, summary: true, groupNotes: true,
};

/** One entry the sticky bar can name while the reader scrolls past it. */
/**
 * The bar of a drawn report and a way to make it name one of its sections. The WordPress export
 * (tournament-report-wordpress.ts) asks it for each section's line, so the pasted page's bar says
 * exactly what this one says.
 */
export type ReportContextBar = Readonly<{
  bar: HTMLElement;
  sections: readonly HTMLElement[];
  show(index: number): void;
}>;

export const REPORT_CONTEXT_BARS = new WeakMap<HTMLElement, ReportContextBar>();

type ContextItem = Readonly<{
  element: HTMLElement; title: string; subtitle: string; icon?: string;
  /** Under a Player: their SP line without the split, the change coloured. */
  sp?: SpRankLine;
}>;

/**
 * The standing of every group, as the export prints it: rank, name, character
 * and points, the first three on their podium mark, and every name a link to
 * that Player's own section. This is the report's index; there are no chips.
 */
function renderStandingsGrid(
  document: Document,
  report: TournamentReport,
  items: ContextItem[],
  editionNumber: number | undefined,
  // The qualifiers above the finals, each row in the colour of the final group
  // the Player went on to (owner request 2026-09-15). Absent on the qualifier
  // side and on a night without finals: there the groups are the standing.
  qualifiers: TournamentReport | null = null,
  // Without the sections per Player there is nothing on this page to jump to,
  // so the name leads to the Player's own profile instead. A Player without a
  // public profile is named and not linked.
  profileLinks = false,
): HTMLElement | null {
  if (report.groups.length === 0) { return null; }
  // Two rows of cards: the qualifiers above, the finals below, so the finals
  // never share a row with the last qualifier group.
  const section = document.createElement("section");
  section.className = "tournament-report__standings";
  section.setAttribute("id", "eindstand");
  const qualifierGrid = document.createElement("div");
  qualifierGrid.className = "tournament-report__standings-grid tournament-report__standings-grid--qualifiers";
  const finalGrid = document.createElement("div");
  finalGrid.className = "tournament-report__standings-grid";
  const advancedTo = new Map<string, ReportGroup>();
  for (const group of report.groups) { for (const player of group.players) { advancedTo.set(player.displayName, group); } }
  const cards: readonly Readonly<{ group: ReportGroup; qualifier: boolean }>[] = [
    ...(qualifiers?.groups ?? []).map((group) => ({ group, qualifier: true })),
    ...report.groups.map((group) => ({ group, qualifier: false })),
  ];
  for (const { group, qualifier } of cards) {
    // Equal points share a place: the best place of the tie, for everybody in
    // it, and the next place counts on past them. The night's own order (who
    // the tie-break put first) stays the row order.
    const sharedRank = new Map<string, number>();
    const tied = new Set<string>();
    for (const player of group.players) {
      const peers = group.players.filter((other) => other.points === player.points);
      sharedRank.set(player.displayName, Math.min(...peers.map((other) => other.groupRank)));
      if (peers.length > 1) { tied.add(player.displayName); }
    }
    const decided = group.tieBreakMode === "manual"
      ? localized("decided by hand", "handmatig beslist")
      : group.tieBreakMode === "lottery" ? localized("decided by lot", "loting besliste") : localized("SP decided", "SP besliste");
    const accent = tournamentGroupColour(group.tierKey);
    const rows: BoardRow[] = group.players.map((player) => {
      let boundaryTie = false;
      // A final group's rows in its own colour, the same wash the qualifier
      // rows carry for the group they went on to (owner, 2026-09-28).
      let wash: string | null = qualifier ? null : accent;
      let reachedTitle: string | undefined;
      if (qualifier) {
        // The final group this Player reached, as the row's own wash and its title.
        const reached = advancedTo.get(player.displayName);
        if (reached !== undefined) {
          wash = tournamentGroupColour(reached.tierKey);
          reachedTitle = localized(
            `Went on to ${displayTournamentGroupLabel(reached.name, reached.tierKey)}`,
            `Ging door naar ${displayTournamentGroupLabel(reached.name, reached.tierKey)}`);
        }
        // A tie that sent its members to different final groups: say what decided it.
        boundaryTie = tied.has(player.displayName) && group.players
          .filter((other) => other.points === player.points)
          .some((other) => advancedTo.get(other.displayName)?.name !== reached?.name);
      }
      const place = sharedRank.get(player.displayName) ?? player.groupRank;
      const name = document.createElement("span");
      name.className = "tournament-report__standings-name";
      if (profileLinks && player.playerId === undefined) {
        const plain = document.createElement("span");
        plain.textContent = player.displayName;
        name.append(plain);
      } else {
        const link = document.createElement("a");
        link.setAttribute("href", profileLinks
          ? `/?player=${encodeURIComponent(player.playerId!)}`
          : `#speler-${slug(player.displayName)}`);
        link.textContent = player.displayName;
        name.append(link);
      }
      if (boundaryTie) {
        const note = document.createElement("span");
        note.className = "ds-micro";
        note.textContent = ` ${decided}`;
        name.append(note);
      }
      const icon = reportCharacterPicture(editionNumber, player.displayName, player.character);
      let mark: HTMLElement | null = null;
      if (icon !== null) {
        mark = document.createElement("img");
        mark.className = "ds-board__face";
        (mark as HTMLImageElement).src = icon.src;
        (mark as HTMLImageElement).alt = icon.label;
        mark.title = icon.label;
        (mark as HTMLImageElement).loading = "lazy";
        (mark as HTMLImageElement).decoding = "async";
      }
      return {
        rank: place,
        // §15/§17: the podium is a numeral in its rank colour, never a medal glyph. A shared place
        // says so in the cell's own title rather than only with a mark.
        ...(tied.has(player.displayName)
          ? { rankText: `${place}=`, title: localized("Shared place: equal points", "Gedeelde plek: gelijke punten") }
          : reachedTitle === undefined ? {} : { title: reachedTitle }),
        name,
        mark,
        value: `${player.points}`,
        ...(wash === null ? {} : { wash }),
      } satisfies BoardRow;
    });
    const board = groupBoard({
      language: localized("en", "nl") === "nl" ? "nl" : "en",
      title: displayTournamentGroupLabel(group.name, group.tierKey),
      titleLevel: 3,
      ...(accent === null ? {} : { accent }),
      meta: qualifier
        ? localized(`${group.players.length} players · colour: the final group they went on to`, `${group.players.length} spelers · kleur: de eindgroep waar ze naartoe gingen`)
        : localized(`${group.players.length} players`, `${group.players.length} spelers`),
      // The export keeps these abbreviations in English in both languages; the name column follows
      // the reader.
      columns: { rank: "#", name: localized("Name", "Speler"), value: "Pts" },
      rows,
    });
    (qualifier ? qualifierGrid : finalGrid).append(board);
  }
  // The bar names the row of tables, not every table: "Kwalificatietabellen"
  // over the qualifiers, "Eindgroeptabellen" over the finals.
  const names = (groups: readonly ReportGroup[]): string => groups.map((group) => displayTournamentGroupLabel(group.name, group.tierKey)).join(" · ");
  // Each row of tables also carries its own head on the page. The sticky bar
  // is not the only place the reader may learn which half they are looking at,
  // and on a night without a published report there is no bar at all
  // (owner, 2026-09-16).
  const rowHead = (text: string): HTMLElement => {
    const head = document.createElement("h2");
    head.className = "tournament-report__standings-heading";
    head.textContent = text;
    return head;
  };
  if (qualifierGrid.childElementCount > 0) {
    section.append(rowHead(localized("Qualifier", "Kwalificatie")), qualifierGrid);
    items.push({ element: qualifierGrid, title: localized("Qualifier tables", "Kwalificatietabellen"), subtitle: names(qualifiers?.groups ?? []) });
  }
  section.append(
    rowHead(report.stage === "final"
      ? localized("Final groups", "Eindklassen")
      : localized("Groups", "Groepen")),
    finalGrid,
  );
  items.push({
    element: finalGrid,
    title: report.stage === "final" ? localized("Final group tables", "Eindgroeptabellen") : localized("Group tables", "Groepstabellen"),
    subtitle: names(report.groups),
  });
  return section;
}

/**
 * The bar that stays in view and says where the reader is: the group, the Top 5
 * or the Player whose section they are inside. The export computes the same
 * thing on every frame; so does this, on a probe line just under the bar.
 */
function bindContextBar(
  document: Document,
  index: SectionIndexHandle,
  paper: HTMLElement,
  items: readonly ContextItem[],
): void {
  // A document without layout or a window - the unit tests' own - simply has
  // no bar; every section it would name is on the page regardless.
  const view = document.defaultView;
  const bar = index.root;
  if (items.length === 0 || view === null || view === undefined) { return; }
  if (typeof bar.getBoundingClientRect !== "function" || typeof view.addEventListener !== "function") { return; }
  let shown = "";
  let waiting = false;
  /**
   * The next frame, or a timer when there is no next frame. A tab in the
   * background gets no animation frame at all, and a scroll that is never
   * answered would leave the bar empty for the life of the page.
   */
  const soon = (run: () => void): void => {
    const timer = view.setTimeout(run, 120);
    view.requestAnimationFrame?.(() => { view.clearTimeout(timer); run(); });
  };
  const show = (item: ContextItem): void => {
    const key = `${item.title}__${item.subtitle}`;
    if (key === shown) { return; }
    shown = key;
    const subtitle = document.createElement("span");
    subtitle.textContent = item.subtitle;
    if (item.sp !== undefined && item.sp.before !== null) {
      // "SP Rank #2 (31,66) → #1 (35,34) +3,68": the split stays on the page itself.
      const half = (rank: number, score: number | undefined): string => `#${rank}${score === undefined ? "" : ` (${spScore(score)})`}`;
      subtitle.append(` | SP Rank ${half(item.sp.before.rank, item.sp.before.score)}`);
      if (item.sp.after !== null) {
        subtitle.append(` → ${half(item.sp.after.rank, item.sp.after.score)} `);
        if (item.sp.delta !== null) {
          const change = document.createElement("span");
          change.className = `tournament-report__sp-delta tournament-report__sp-delta--${item.sp.delta > 0 ? "up" : item.sp.delta < 0 ? "down" : "same"}`;
          change.textContent = spDelta(item.sp.delta);
          subtitle.append(change);
        }
      }
    }
    index.setCurrent(
      item.title,
      item.subtitle.length === 0 && item.sp === undefined ? null : subtitle,
      item.icon ?? null,
    );
    // The bar's own height only changes when its text does, so the paper's
    // offset is written here and never on a scroll frame: a write between two
    // reads forces the whole 95,000px page to lay out again, which on a phone
    // profile cost seven long tasks in one pass (owner, 2026-09-16).
    applyOffsets();
  };
  /** Where the bar sits under the site's own navigation, and how much room it takes. */
  let probeOffset = 78;
  let written = "";
  const applyOffsets = (): void => {
    const nav = document.querySelector(".site-nav");
    const navHeight = nav === null || typeof nav.getBoundingClientRect !== "function"
      ? 0
      : Math.ceil(nav.getBoundingClientRect().height || 0);
    const height = Math.ceil(bar.getBoundingClientRect().height || 0);
    // Deeper than where a jump from the standing lands, so the section the
    // reader was sent to is the one the bar names, not the one just above it.
    probeOffset = navHeight + height + 26;
    // These are inherited custom properties on the paper, so writing them
    // invalidates the style of every section under it - eighty of them on a
    // published night. Written only when they actually change, which is on a
    // resize and when the bar's own text wraps to another line.
    const wanted = `${navHeight}:${height}`;
    if (wanted === written) { return; }
    written = wanted;
    if (typeof paper.style?.setProperty === "function") {
      paper.style.setProperty("--report-context-top", `${navHeight}px`);
      paper.style.setProperty("--report-context-offset", `${height + 12}px`);
    }
  };
  /**
   * Where every section starts, measured once. A published night has eighty of
   * them on a page 95,000px tall, and asking each one for its box on every
   * frame of a scroll is a layout of the whole document per frame - four long
   * tasks in one pass on a phone profile, and the only thing left that made
   * the reader's scroll stutter (owner, 2026-09-16). The page no longer
   * changes shape while it is read, so one measurement holds.
   */
  let tops: number[] | null = null;
  let measured: readonly unknown[] = [];
  const scrollTop = (): number => view.scrollY ?? view.pageYOffset ?? 0;
  const measure = (): void => {
    const offset = scrollTop();
    tops = items.map((item) => item.element.getBoundingClientRect().top + offset);
    measured = items.map((item) => item.element);
  };
  /** The measurement still describes this page: same sections, in the same order. */
  const fresh = (): boolean => tops !== null && measured.length === items.length &&
    items.every((item, index) => measured[index] === item.element);
  const update = (): void => {
    waiting = false;
    if (!fresh()) { measure(); }
    const probe = scrollTop() + probeOffset;
    // The last section that has started above the probe is the one the reader
    // is in. A walk from the back finds it without touching layout at all.
    let current = items[0]!;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (tops![index]! <= probe) { current = items[index]!; break; }
    }
    show(current);
  };
  // The paper is bound before the caller puts it in the document, so "gone"
  // means: was in the document once, and is not any more.
  let armed = false;
  const onScroll = (): void => {
    if (paper.isConnected) { armed = true; } else if (armed) {
      view.removeEventListener("scroll", onScroll);
      view.removeEventListener("resize", onResize);
      return;
    }
    if (waiting) { return; }
    waiting = true;
    soon(update);
  };
  const onResize = (): void => { tops = null; applyOffsets(); onScroll(); };
  applyOffsets();
  view.addEventListener("scroll", onScroll, { passive: true });
  view.addEventListener("resize", onResize);
  // Not now: the paper is still being assembled and every box measures zero,
  // which would read as "the reader is past the end" and name the last Player.
  onScroll();
  REPORT_CONTEXT_BARS.set(paper, {
    bar,
    sections: items.map((item) => item.element),
    show: (position) => { const item = items[position]; if (item !== undefined) { show(item); } },
  });
}

/**
 * A link in the standing points at a Player's own section. Two things stop the
 * browser from getting there on its own: the page is built after the address
 * was read, so the section does not exist yet when the browser first looks for
 * it; and the charts of the sections around it are drawn as they come into
 * view, which changes the height above the reader after they have arrived.
 *
 * So the report takes the fragment itself: it draws that section's charts
 * first, puts it under the bar, and once the sections around it have settled,
 * puts it there again.
 */
function bindFragmentJumps(document: Document, paper: HTMLElement, followNow: boolean): void {
  const view = document.defaultView;
  if (view === null || view === undefined || typeof view.addEventListener !== "function") { return; }
  let armed = false;
  const align = (): void => {
    if (paper.isConnected) { armed = true; } else if (armed) { view.removeEventListener("hashchange", align); return; }
    const hash = view.location?.hash ?? "";
    if (!hash.startsWith("#speler-")) { return; }
    const target = paper.querySelector<HTMLElement>(`[id="${CSS.escape(hash.slice(1))}"]`);
    if (target === null) { return; }
    (target as HTMLElement & { drawCharts?: () => void }).drawCharts?.();
    // Put its top just under the bar, measured now. A CSS scroll-margin would
    // have to be told the bar's height in advance, and the bar grows by a line
    // the moment it names a Player.
    const under = (): void => {
      if (typeof target.getBoundingClientRect !== "function") { return; }
      const bar = paper.querySelector(".tournament-report__context");
      const clearance = bar === null ? 68 : Math.ceil(bar.getBoundingClientRect().bottom) + 14;
      const top = target.getBoundingClientRect().top + (view.scrollY ?? 0) - clearance;
      if (typeof view.scrollTo === "function") { view.scrollTo(0, Math.max(0, Math.round(top))); }
      else if (typeof target.scrollIntoView === "function") { target.scrollIntoView(); }
    };
    under();
    // The sections around it draw as they come into view and change the height
    // above; put the reader back once that has settled. Timers, not frames: a
    // tab in the background gets no frames, and a link opened there must still
    // be at the right place when the reader looks at it.
    view.setTimeout(under, 60);
    view.setTimeout(under, 320);
  };
  view.addEventListener("hashchange", align);
  // The address may already name a Player: this page was linked to. It waits
  // for the paper to be in the document, which the caller does after this.
  // A redraw of the same page (the editor after every Apply) must not send the
  // reader back to the section the address still names.
  if (!followNow) { return; }
  view.setTimeout(align, 0);
  view.setTimeout(align, 400);
}

/** The reader's stage in the address (`stage=qualifier`), so a link opens where it was made. Web-only; other clients ignore it. */
export function readReportStage(document: Document): ReportStage | undefined {
  const search = document.defaultView?.location?.search ?? "";
  const value = new URLSearchParams(search).get("stage");
  return value === "qualifier" || value === "final" ? value : undefined;
}

export function writeReportStage(document: Document, stage: ReportStage): void {
  const view = document.defaultView;
  if (view === null || view === undefined || typeof view.history?.replaceState !== "function") { return; }
  const url = new URL(view.location.href);
  if (stage === "final") { url.searchParams.delete("stage"); } else { url.searchParams.set("stage", stage); }
  view.history.replaceState(view.history.state, "", url.toString());
}

/** "Eindgroepen | Voorronden": the reader's choice of which groups to read; the writing stays on the finals. */
function renderStageSwitch(document: Document, current: ReportStage, stages: readonly ReportStage[], onStage: (stage: ReportStage) => void): HTMLElement {
  const nav = document.createElement("nav");
  nav.className = "tournament-report__stages";
  nav.setAttribute("aria-label", localized("Groups shown", "Getoonde groepen"));
  for (const stage of stages) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tournament-report__stage";
    button.dataset["stage"] = stage;
    button.setAttribute("aria-pressed", stage === current ? "true" : "false");
    button.textContent = stage === "final" ? localized("Final groups", "Eindgroepen") : localized("Qualifiers", "Voorronden");
    if (stage !== current) { button.addEventListener("click", () => onStage(stage)); }
    nav.append(button);
  }
  const hint = document.createElement("span");
  hint.className = "tournament-report__stage-hint";
  hint.textContent = current === "final"
    ? localized("The night's report. The qualifiers carry the same statistics.", "Het verslag van de avond. De voorronden hebben dezelfde statistieken.")
    : localized("Statistics of the qualifiers; the report itself is written about the finals.", "Statistieken van de voorronden; het verslag zelf gaat over de eindgroepen.");
  nav.append(hint);
  return nav;
}

/**
 * The report as one light document: the story, the tracks and a section per
 * Player, grouped the way the night was.
 */
export function renderTournamentReport(
  document: Document,
  event: PublicTournamentEvent,
  story: TournamentStory | null,
  // The published page is the document itself and carries its own standing and
  // its own bar. On a night that is still being run the report follows the
  // operator's sections, which already print the standing above it.
  options: Readonly<{
    standalone?: boolean;
    /**
     * The night's result without the writing built on it: the standings of
     * both stages and nothing else. A finalized night is public the moment it
     * is finalized, but the Top 5, the group notes and the section per Player
     * are the report, and the report is the community's only once the
     * Director publishes it (owner, 2026-09-16).
     */
    standingsOnly?: boolean;
    editable?: boolean;
    /** Which stage's groups to show; the finals by default. */
    stage?: ReportStage;
    /** Called when the reader switches stage; the caller redraws. Without it the switch is not offered. */
    onStage?(stage: ReportStage): void;
    /** Jump to the `#speler-…` fragment on this draw (default true); false for a redraw of the same page. */
    followFragment?: boolean;
  }> = {},
): HTMLElement[] {
  const editable = options.editable === true;
  const report = tournamentReport(event, options.stage);
  if (report.groups.length === 0 && report.topTracks.length === 0) { return []; }
  // The report writer writes about the finals. On the qualifier side the page is statistics,
  // and a Player's note appears there only when they have no final to carry it.
  const finalists = new Set(event.groups.filter((group) => group.stage === "final" && group.races.length > 0)
    .flatMap((group) => group.standings.map((row) => row.displayName)));
  const writingStage = report.stage === "final" || !report.stages.includes("final");
  // The same Players on the other side of the night, for the switch in each section.
  const otherStage: ReportStage | null = report.stages.length > 1 ? (report.stage === "final" ? "qualifier" : "final") : null;
  const otherReport = otherStage === null ? null : tournamentReport(event, otherStage);
  const otherPlayers = new Map((otherReport?.groups ?? []).flatMap((group) => group.players.map((player) => [player.displayName, player] as const)));
  const backHref = options.standalone === true ? "#eindstand" : "#tournament-event-heading";
  // What the bar says under a Player's name: their place, and their SP line without the split.
  const contextSp = (player: ReportPlayer): SpRankLine | null => spRankLine(
    { ...(player.seedRank === undefined ? {} : { rank: player.seedRank }), ...(player.seedScore === undefined ? {} : { score: player.seedScore }) },
    event.report?.ratings?.players.find((entry) => entry.name === player.displayName) ?? null,
  );
  const contextSubtitle = (player: ReportPlayer): string => playerMetaLine(player, report.playerCount);
  const paper = document.createElement("section");
  // The "paper" island is gone (Phase 11, both clients): the report keeps its order, its words, its
  // reading measure and every link, and loses the light paper, the serif and the second set of ink
  // it carried inside a dark app. The appearance the Player chose is the appearance the whole
  // product answers to. `--document` keeps the administrator's report editor, which shares the
  // class, on its own grid layout.
  paper.className = "ds-root tournament-report tournament-report--document";

  // Charts used to be drawn only when their Player scrolled into view, 400px
  // ahead. On a night with 36 Players that is 35 sections growing under the
  // reader's finger: measured on the owner's phone profile, 130 images
  // appeared during one pass and the page shifted 0.139 (owner: "slow,
  // stuttering scrolls", 2026-09-15). So the observer stays for whoever jumps
  // straight to a section, but every section is also queued to be drawn in
  // idle time right after the paper is on screen. By the time the reader
  // arrives the layout is already final and nothing moves.
  const pending: Array<() => void> = [];
  const idleQueue: Array<() => void> = [];
  const observer = typeof IntersectionObserver === "function"
    ? new IntersectionObserver((entries, self) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) { continue; }
        self.unobserve(entry.target);
        (entry.target as HTMLElement & { drawCharts?: () => void }).drawCharts?.();
      }
    }, { rootMargin: "400px 0px" })
    : null;
  const observe = (section: HTMLElement, draw: () => void): void => {
    if (observer === null) { pending.push(draw); return; }
    (section as HTMLElement & { drawCharts?: () => void }).drawCharts = draw;
    observer.observe(section);
    idleQueue.push(draw);
  };
  /**
   * Draw what is left over in the gaps between frames. A draw is idempotent,
   * so a section the observer already handled costs nothing here.
   */
  const drawWhenIdle = (): void => {
    if (idleQueue.length === 0) { return; }
    const view = paper.ownerDocument.defaultView;
    const schedule = (run: () => void): void => {
      const idle = (view as unknown as { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => void } | null)?.requestIdleCallback;
      if (typeof idle === "function") { idle.call(view, run, { timeout: 500 }); return; }
      view?.setTimeout(run, 32);
    };
    const pump = (): void => {
      // A handful per slice: enough to be done in a second or two on a night
      // with 36 Players, small enough never to hold a frame.
      for (let drawn = 0; drawn < 3; drawn += 1) {
        const draw = idleQueue.shift();
        if (draw === undefined) { return; }
        if (!paper.isConnected) { idleQueue.length = 0; return; }
        draw();
      }
      if (idleQueue.length > 0) { schedule(pump); }
    };
    schedule(pump);
  };

  // The bar that names where the reader is, first in the paper and sticky.
  // Without the sections per Player there is nothing to be lost inside: the
  // page is two rows of tables, each with its own head, and the bar would only
  // repeat them (owner, 2026-09-16).
  const standalone = options.standalone === true;
  const standingsOnly = options.standingsOnly === true;
  // A flag a report does not carry was drawn before it existed: shown.
  const shows: ReportVisibility = { ...EVERYTHING, ...event.report?.visibility };
  useDocument(document);
  // SectionIndex (§12, §24): which chapter the reader is inside, and — on a night with a section
  // per Player — one control that takes them straight to a Player without scrolling a 95,000 px
  // page looking for a name (W21 "find-a-Player").
  const finder = document.createElement("select");
  finder.className = "ds-select tournament-report__finder";
  finder.setAttribute("aria-label", localized("Find a Player", "Zoek een speler"));
  const firstOption = document.createElement("option");
  firstOption.value = "";
  firstOption.textContent = localized("Find a Player…", "Zoek een speler…");
  finder.append(firstOption);
  finder.addEventListener("change", () => {
    const wanted = finder.value;
    if (wanted === "") { return; }
    const view = document.defaultView;
    if (view?.location !== undefined) { view.location.hash = wanted; }
    finder.value = "";
  });
  const index = sectionIndex({
    label: localized("Where you are in this report", "Waar je bent in dit verslag"),
    jumps: standingsOnly ? [] : [finder],
  });
  index.root.classList.add("tournament-report__context");
  const contextItems: ContextItem[] = [];
  if (standalone && !standingsOnly) { paper.append(index.root); }
  // Everything but the bar sits in its own layer. A sticky grid item is
  // confined to its own row and would unstick after the first section; the bar
  // stays a child of the paper and travels the whole document.
  const body = document.createElement("div");
  body.className = "tournament-report__body";
  paper.append(body);

  const storySection = renderTournamentStory(document, story, editable, shows);
  if (storySection !== null) {
    body.append(storySection);
    // The report's own head in the bar, then the summary's.
    const intro = storySection.querySelector<HTMLElement>('[data-report-block="intro"]');
    const summary = storySection.querySelector<HTMLElement>('[data-report-block="summary"]');
    if (intro !== null) { contextItems.push({ element: intro, title: story?.title ?? event.name, subtitle: localized("Report", "Verslag") }); }
    if (summary !== null) { contextItems.push({ element: summary, title: localized("Summary", "Samenvatting"), subtitle: story?.title ?? event.name }); }
  }
  const standings = standalone
    ? renderStandingsGrid(document, report, contextItems, event.editionNumber,
      report.stage === "final" && otherStage === "qualifier" ? otherReport : null,
      options.standingsOnly === true)
    : null;
  if (standings !== null) { body.append(standings); }
  if (standingsOnly) {
    const waiting = document.createElement("p");
    waiting.className = "tournament-report__waiting";
    waiting.textContent = localized(
      "The report of this night has not been published yet. Once it is, the story, the Top 5 tracks and a section per Player with their charts appear here.",
      "Het verslag van deze avond is nog niet gepubliceerd. Zodra dat gebeurt staan hier het verhaal, de Top 5 banen en per speler een eigen stuk met grafieken.",
    );
    body.append(waiting);
    if (standalone) { bindFragmentJumps(document, paper, options.followFragment !== false); }
    return [paper];
  }
  const tracks = shows.topTracks ? renderTopTracks(document, report.topTracks, story, editable) : null;
  if (tracks !== null) {
    body.append(tracks);
    contextItems.push({ element: tracks, title: localized("Top 5 tracks driven during this Tournament", "Top 5 gereden banen dit toernooi"), subtitle: "" });
  }

  if (report.stages.length > 1 && options.onStage !== undefined) {
    body.append(renderStageSwitch(document, report.stage, report.stages, options.onStage));
  }

  for (const group of report.groups) {
    const groupSection = document.createElement("section");
    groupSection.className = "tournament-report__group";
    // The five ranking tiers plus the two an early edition used: TN4 and TN5
    // split the night into a winners' and a losers' poule, which are group
    // names, not places in the all-time ranking. One definition (Phase 11).
    const accent = tournamentGroupColour(group.tierKey);
    if (accent !== null) { groupSection.style.setProperty("--report-group-accent", accent); }
    const groupLabel = displayTournamentGroupLabel(group.name, group.tierKey);
    const groupTitle = document.createElement("h3");
    groupTitle.textContent = groupLabel;
    const groupMeta = document.createElement("p");
    groupMeta.className = "tournament-report__group-meta";
    // The export's own head: the group's tag, then how many raced in it.
    useDocument(document);
    const tag = accent === null
      ? document.createElement("span")
      : tierChip(groupLabel, accent);
    tag.classList.add("tournament-report__group-tag");
    if (accent === null) { tag.textContent = groupLabel; }
    const count = document.createElement("span");
    count.className = "tournament-report__group-count";
    count.textContent = localized(
      ` · ${group.players.length} players · ${group.raceCount} races`,
      ` · ${group.players.length} spelers · ${group.raceCount} races`,
    );
    groupMeta.append(tag, count);
    groupSection.append(groupTitle, groupMeta);
    const groupStory = story?.groups.find((entry) => entry.name.toLowerCase().includes(group.name.toLowerCase()));
    const groupBlock = !shows.groupNotes ? null : block(document, `group:${group.name}`, groupStory === undefined ? [] : copy(document, groupStory.paragraphs, groupStory.html, "tournament-report__copy"), editable && writingStage);
    if (groupBlock !== null) { groupSection.append(groupBlock); }
    for (const player of group.players) {
      // A section, on either side of the night; switching replaces it in place
      // and draws its charts at once, since it is already in view.
      const draw = (shownPlayer: ReportPlayer, stage: ReportStage, alternatePlayer: ReportPlayer | null, alternateStage: ReportStage | null): HTMLElement => {
        // The finals side carries the notes; the qualifier side only for a Player who reached no final.
        const notes = stage === "final" || !finalists.has(shownPlayer.displayName);
        const alternate = alternatePlayer === null || alternateStage === null ? null : {
          show: (current: HTMLElement): void => {
            const next = draw(alternatePlayer, alternateStage, shownPlayer, stage);
            current.replaceWith(next);
            const item = contextItems.find((entry) => entry.element === current);
            if (item !== undefined) {
              const line = contextSp(alternatePlayer);
              contextItems[contextItems.indexOf(item)] = { ...item, element: next, subtitle: contextSubtitle(alternatePlayer), ...(line === null ? {} : { sp: line }) };
            }
            (next as HTMLElement & { drawCharts?: () => void }).drawCharts?.();
          },
        };
        return renderPlayer(document, shownPlayer, notes ? story : null, report.playerCount, report.maxPosition, observe, event.editionNumber, shows, editable && notes, event.report?.ratings ?? null,
          { backHref, stage, alternate });
      };
      const other = otherPlayers.get(player.displayName) ?? null;
      const section = draw(player, report.stage, other, other === null ? null : otherStage);
      const icon = reportCharacterPicture(event.editionNumber, player.displayName, player.character);
      // Every Player in the report is findable by name from the index.
      const option = document.createElement("option");
      option.value = `speler-${slug(player.displayName)}`;
      option.textContent = player.displayName;
      finder.append(option);
      contextItems.push({
        element: section,
        title: player.displayName,
        subtitle: contextSubtitle(player),
        ...((): { sp?: SpRankLine } => { const line = contextSp(player); return line === null ? {} : { sp: line }; })(),
        ...(icon === null ? {} : { icon: icon.src }),
      });
      groupSection.append(section);
    }
    body.append(groupSection);
  }
  if (standalone) {
    bindContextBar(document, index, paper, contextItems);
    bindFragmentJumps(document, paper, options.followFragment !== false);
  }
  for (const draw of pending) { draw(); }
  drawWhenIdle();
  return [paper];
}
