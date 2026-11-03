// The night's report, the way the community's own report page told it: per
// group, per Player, the position after every race, the finish positions,
// the gap to the top three, the duel with the Player one place up and the
// spread of finishes. Everything here is derived from the published races;
// nothing is stored. The charts are hand-built SVG at the source's fixed
// viewBoxes, so the picture a reader knows from the old reports is the one
// they get here.

import { localized } from "./product-language.js";
import type { PublicTournamentEvent } from "./tournament-operation-client.js";

export type ReportRaceRow = Readonly<{
  raceNumber: number;
  trackId?: string;
  position: number;
  racePoints: number;
  totalAfter: number;
  /** The standing in the group after this race; equal totals share a rank. */
  positionAfter: number;
  tiedAfter: boolean;
}>;

export type ReportOpponent = Readonly<{
  displayName: string;
  groupRank: number;
  /** This Player's total minus the opponent's, per shared race. */
  deltas: readonly number[];
}>;

export type ReportBenchmarkPoint = Readonly<{
  /** This Player's total minus the one holding that place: positive is ahead. */
  delta: number;
  /** Who held the place after this race; empty when the group was that small. */
  displayName: string;
  playerTotal: number;
  benchmarkTotal: number;
}>;

export type ReportPlayer = Readonly<{
  displayName: string;
  playerId?: string;
  /** The character they drove, when a score workbook recorded one. */
  character?: Readonly<{ key?: string; label: string; roster?: string }>;
  groupName: string;
  groupTierKey?: string;
  groupRank: number;
  /** The overall placement of the night, when the night has one. */
  overallRank?: number;
  /** The SP rank and score the night was drawn with (ADR-0154), when known. */
  seedRank?: number;
  seedScore?: number;
  points: number;
  raceCount: number;
  winCount: number;
  top3Count: number;
  bestFinish?: number;
  avgFinish?: number;
  rows: readonly ReportRaceRow[];
  /**
   * The gap to the first, second and third total after every race, and who
   * held that place. The export's readout names them - "+12 punten · P1 ·
   * Matteo (15 vs 3)" - so the number alone is not enough.
   */
  benchmark: Readonly<{
    first: readonly ReportBenchmarkPoint[];
    second: readonly ReportBenchmarkPoint[];
    third: readonly ReportBenchmarkPoint[];
  }>;
  opponent?: ReportOpponent;
  /** Finishes per position, index 0 is first place. */
  distribution: readonly number[];
}>;

export type ReportGroup = Readonly<{
  groupId: string;
  name: string;
  tierKey?: string;
  /** How an equal score in this group was ordered, when the night said so. */
  tieBreakMode?: "sp" | "lottery" | "manual";
  stage: "qualifier" | "final";
  players: readonly ReportPlayer[];
  raceCount: number;
}>;

export type TournamentReport = Readonly<{
  /** The stage the groups below belong to, and every stage the night raced. */
  stage: ReportStage;
  stages: readonly ReportStage[];
  groups: readonly ReportGroup[];
  /** The tracks driven most, when the races recorded their track. */
  topTracks: readonly Readonly<{ trackId: string; count: number }>[];
  raceCount: number;
  playerCount: number;
  maxPosition: number;
}>;

export type ReportStage = "final" | "qualifier";

/** The stages the night raced, finals first: what the report can show. */
export function tournamentReportStages(event: PublicTournamentEvent): readonly ReportStage[] {
  const raced = (stage: ReportStage): boolean => event.groups.some((group) => group.stage === stage && group.races.length > 0);
  return (["final", "qualifier"] as const).filter(raced);
}

/**
 * The report of a night. The groups follow the stage asked for - the finals
 * by default, the qualifiers when the reader switches - while the Top 5
 * tracks count every race of the night: that is the night's Top 5, not a
 * stage's. Owner decision 2026-09-15.
 */
export function tournamentReport(event: PublicTournamentEvent, stage?: ReportStage): TournamentReport {
  const stages = tournamentReportStages(event);
  const shown: ReportStage | null = stage !== undefined && stages.includes(stage) ? stage : stages[0] ?? null;
  const source = shown === null
    ? event.groups.filter((group) => group.races.length > 0)
    : event.groups.filter((group) => group.stage === shown && group.races.length > 0);
  const playerCount = event.overall.length > 0
    ? event.overall.length
    : new Set(event.groups.flatMap((group) => group.standings.map((row) => row.displayName))).size;
  const observedMax = Math.max(0, ...event.groups.flatMap((group) => group.races.flatMap((race) => race.placements.map((placement) => placement.finishPosition))));
  const maxPosition = Math.max(12, observedMax, ...source.map((group) => group.standings.length));
  const overallRank = new Map(event.overall.map((row) => [row.displayName, row.placement]));
  const groups = source.map((group) => reportGroup(group, overallRank, maxPosition));
  const trackCounts = new Map<string, number>();
  for (const group of event.groups) {
    for (const race of group.races) {
      if (race.trackId === undefined) { continue; }
      trackCounts.set(race.trackId, (trackCounts.get(race.trackId) ?? 0) + 1);
    }
  }
  const topTracks = [...trackCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([trackId, count]) => ({ trackId, count }));
  return {
    stage: shown ?? "final",
    stages,
    groups,
    topTracks,
    raceCount: event.groups.reduce((sum, group) => sum + group.races.length, 0),
    playerCount,
    maxPosition,
  };
}

function reportGroup(
  group: PublicTournamentEvent["groups"][number],
  overallRank: ReadonlyMap<string, number>,
  maxPosition: number,
): ReportGroup {
  const races = [...group.races]
    .filter((race) => race.countsTowardStandings)
    .sort((left, right) => left.raceNumber - right.raceNumber);
  const names = group.standings.map((row) => row.displayName);
  // Running totals per race, for the standing after each one and the gaps.
  const totals = new Map<string, number>(names.map((name) => [name, 0]));
  const perRace: Array<{ race: typeof races[number]; totals: ReadonlyMap<string, number>; ranking: ReadonlyMap<string, { rank: number; tied: boolean }> }> = [];
  for (const race of races) {
    for (const placement of race.placements) {
      if (!totals.has(placement.displayName)) { totals.set(placement.displayName, 0); }
      totals.set(placement.displayName, (totals.get(placement.displayName) ?? 0) + placement.racePoints);
    }
    const snapshot = new Map(totals);
    const ordered = [...snapshot.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    const ranking = new Map<string, { rank: number; tied: boolean }>();
    ordered.forEach(([name, total], index) => {
      const sameAbove = index > 0 && ordered[index - 1]![1] === total;
      const sameBelow = index < ordered.length - 1 && ordered[index + 1]![1] === total;
      const rank = sameAbove ? ranking.get(ordered[index - 1]![0])!.rank : index + 1;
      ranking.set(name, { rank, tied: sameAbove || sameBelow });
    });
    perRace.push({ race, totals: snapshot, ranking });
  }
  const rowsFor = (name: string): ReportRaceRow[] => perRace.flatMap((entry) => {
    const placement = entry.race.placements.find((candidate) => candidate.displayName === name);
    if (placement === undefined) { return []; }
    const standing = entry.ranking.get(name) ?? { rank: 0, tied: false };
    return [{
      raceNumber: entry.race.raceNumber,
      ...(entry.race.trackId === undefined ? {} : { trackId: entry.race.trackId }),
      position: placement.finishPosition,
      racePoints: placement.racePoints,
      totalAfter: entry.totals.get(name) ?? 0,
      positionAfter: standing.rank,
      tiedAfter: standing.tied,
    }];
  });
  // The Player holding a place in the standing after a race, and their total.
  // Sorted the way the standing itself is: total first, then the name, so two
  // equal totals always resolve the same way.
  const topAfter = (entry: typeof perRace[number], index: number): Readonly<{ displayName: string; total: number }> => {
    const ordered = [...entry.totals.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    const found = ordered[index];
    return found === undefined ? { displayName: "", total: 0 } : { displayName: found[0], total: found[1] };
  };
  const benchmarkFor = (name: string, index: number): (entry: typeof perRace[number]) => ReportBenchmarkPoint =>
    (entry) => {
      const held = topAfter(entry, index);
      const own = entry.totals.get(name) ?? 0;
      return { delta: own - held.total, displayName: held.displayName, playerTotal: own, benchmarkTotal: held.total };
    };
  const players = group.standings.map((row): ReportPlayer => {
    const rows = rowsFor(row.displayName);
    const raced = perRace.filter((entry) => entry.race.placements.some((placement) => placement.displayName === row.displayName));
    const positions = rows.map((entry) => entry.position);
    const distribution = Array.from({ length: maxPosition }, (_, index) => positions.filter((position) => position === index + 1).length);
    const opponentRow = row.rank === 1
      ? group.standings.find((candidate) => candidate.rank === 2)
      : group.standings.find((candidate) => candidate.rank === row.rank - 1);
    const opponent = opponentRow === undefined ? undefined : {
      displayName: opponentRow.displayName,
      groupRank: opponentRow.rank,
      deltas: raced
        .filter((entry) => entry.race.placements.some((placement) => placement.displayName === opponentRow.displayName))
        .map((entry) => (entry.totals.get(row.displayName) ?? 0) - (entry.totals.get(opponentRow.displayName) ?? 0)),
    };
    const overall = overallRank.get(row.displayName);
    return {
      displayName: row.displayName,
      ...(row.playerId === undefined ? {} : { playerId: row.playerId }),
      ...(row.character === undefined ? {} : { character: row.character }),
      groupName: group.name,
      ...(group.tierKey === undefined ? {} : { groupTierKey: group.tierKey }),
      groupRank: row.rank,
      ...(overall === undefined ? {} : { overallRank: overall }),
      ...(row.seedRank === undefined ? {} : { seedRank: row.seedRank }),
      ...(row.seedScore === undefined ? {} : { seedScore: row.seedScore }),
      points: row.points,
      raceCount: rows.length,
      winCount: positions.filter((position) => position === 1).length,
      top3Count: positions.filter((position) => position <= 3).length,
      ...(positions.length === 0 ? {} : { bestFinish: Math.min(...positions) }),
      ...(positions.length === 0 ? {} : { avgFinish: positions.reduce((sum, value) => sum + value, 0) / positions.length }),
      rows,
      benchmark: {
        first: raced.map(benchmarkFor(row.displayName, 0)),
        second: raced.map(benchmarkFor(row.displayName, 1)),
        third: raced.map(benchmarkFor(row.displayName, 2)),
      },
      ...(opponent === undefined || opponent.deltas.length === 0 ? {} : { opponent }),
      distribution,
    };
  });
  return {
    groupId: group.groupId,
    name: group.name,
    ...(group.tierKey === undefined ? {} : { tierKey: group.tierKey }),
    ...(group.tieBreakMode === undefined ? {} : { tieBreakMode: group.tieBreakMode }),
    stage: group.stage,
    players,
    raceCount: races.length,
  };
}

/**
 * The source's per-Player accent: a golden-angle hue per group rank. The
 * SVG uses the colour itself (a presentation attribute, which the page's
 * Content-Security-Policy allows); the cards use the class of the same
 * name, because an inline `style` is refused by that policy.
 */
export const REPORT_ACCENT_COUNT = 12;

export function reportAccentIndex(groupRank: number): number {
  return (Math.max(1, groupRank) - 1) % REPORT_ACCENT_COUNT;
}

export function reportAccent(groupRank: number): string {
  const hue = Math.round(reportAccentIndex(groupRank) * 137.508) % 360;
  // Ink on paper, matching the report's own light document.
  return `hsl(${hue} 46% 38%)`;
}

/** A number the way this visitor reads one: 4,38 in Dutch, 4.38 in English. */
export function reportNumber(value: number, digits = 1): string {
  const text = value.toFixed(digits).replace(/\.0+$/u, "");
  return localized("en", "nl") === "nl" ? text.replace(".", ",") : text;
}

export function reportPercent(part: number, whole: number): string {
  if (whole === 0) { return `0%`; }
  return `${reportNumber((part / whole) * 100, 1)}%`;
}

// ---------------------------------------------------------------------------
// Charts. Strings, so a chart is one innerHTML assignment and nothing here
// touches the DOM. Every point carries a <title>, which is the hover text.

const escape = (value: string): string => value
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const round = (value: number): string => `${Math.round(value * 10) / 10}`;

type ChartSeries = Readonly<{ label: string; color: string; values: readonly number[]; area?: boolean }>;

type LineChartOptions = Readonly<{
  width?: number;
  height?: number;
  series: readonly ChartSeries[];
  yMin: number;
  yMax: number;
  /** 1 at the top: a position axis. */
  invert?: boolean;
  yStep: number;
  xLabel: string;
  /** Draw a horizontal rule at this value (the 0 line of a gap chart). */
  baseline?: number;
  pointTitle: (seriesLabel: string, index: number, value: number) => string;
}>;

/** The source's 860x308 line chart: races along the x axis, one series or a few. */
export function lineChartSvg(options: LineChartOptions): string {
  const width = options.width ?? 860;
  const height = options.height ?? 308;
  const pad = { left: 44, right: 16, top: 14, bottom: 34 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const count = Math.max(1, ...options.series.map((series) => series.values.length));
  const x = (index: number): number => count === 1 ? pad.left + innerWidth / 2 : pad.left + (index / (count - 1)) * innerWidth;
  const span = Math.max(1, options.yMax - options.yMin);
  const y = (value: number): number => {
    const ratio = (value - options.yMin) / span;
    return options.invert === true ? pad.top + ratio * innerHeight : pad.top + (1 - ratio) * innerHeight;
  };
  const parts: string[] = [];
  parts.push(`<svg class="tournament-report__chart" viewBox="0 0 ${width} ${height}" role="img" preserveAspectRatio="xMidYMid meet">`);
  for (let tick = options.yMin; tick <= options.yMax + 1e-9; tick += options.yStep) {
    const line = y(tick);
    parts.push(`<line x1="${pad.left}" x2="${width - pad.right}" y1="${round(line)}" y2="${round(line)}" class="tournament-report__grid"/>`);
    parts.push(`<text x="${pad.left - 8}" y="${round(line + 4)}" text-anchor="end" class="tournament-report__tick">${round(tick)}</text>`);
  }
  if (options.baseline !== undefined) {
    const line = y(options.baseline);
    parts.push(`<line x1="${pad.left}" x2="${width - pad.right}" y1="${round(line)}" y2="${round(line)}" class="tournament-report__baseline"/>`);
  }
  const xTickEvery = count > 24 ? 4 : count > 12 ? 2 : 1;
  for (let index = 0; index < count; index += 1) {
    if (index % xTickEvery !== 0 && index !== count - 1) { continue; }
    parts.push(`<text x="${round(x(index))}" y="${height - 12}" text-anchor="middle" class="tournament-report__tick">${index + 1}</text>`);
  }
  parts.push(`<text x="${round(pad.left + innerWidth / 2)}" y="${height - 1}" text-anchor="middle" class="tournament-report__axis">${escape(options.xLabel)}</text>`);
  for (const series of options.series) {
    if (series.values.length === 0) { continue; }
    const points = series.values.map((value, index) => `${round(x(index))},${round(y(value))}`);
    if (series.area === true) {
      const base = round(y(options.baseline ?? options.yMin));
      parts.push(`<path d="M${round(x(0))},${base} L${points.join(" L")} L${round(x(series.values.length - 1))},${base} Z" fill="${series.color}" fill-opacity="0.12" stroke="none"/>`);
    }
    parts.push(`<polyline points="${points.join(" ")}" fill="none" stroke="${series.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`);
    series.values.forEach((value, index) => {
      parts.push(`<circle cx="${round(x(index))}" cy="${round(y(value))}" r="4" fill="${series.color}" stroke="#0a111b" stroke-width="1.2"><title>${escape(options.pointTitle(series.label, index, value))}</title></circle>`);
    });
  }
  parts.push("</svg>");
  return parts.join("");
}

/** The source's gap chart: above zero this Player leads, below the opponent does. */
export function deltaChartSvg(
  deltas: readonly number[],
  colors: Readonly<{ positive: string; negative: string }>,
  pointTitle: (index: number, value: number) => string,
): string {
  const width = 860;
  const height = 292;
  const pad = { left: 44, right: 16, top: 14, bottom: 34 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const magnitude = Math.max(5, ...deltas.map((value) => Math.abs(value)));
  const step = magnitude > 60 ? 20 : magnitude > 30 ? 10 : 5;
  const limit = Math.ceil(magnitude / step) * step;
  const count = Math.max(1, deltas.length);
  const x = (index: number): number => count === 1 ? pad.left + innerWidth / 2 : pad.left + (index / (count - 1)) * innerWidth;
  const y = (value: number): number => pad.top + (1 - (value + limit) / (2 * limit)) * innerHeight;
  const parts: string[] = [`<svg class="tournament-report__chart" viewBox="0 0 ${width} ${height}" role="img" preserveAspectRatio="xMidYMid meet">`];
  for (let tick = -limit; tick <= limit; tick += step) {
    const line = y(tick);
    parts.push(`<line x1="${pad.left}" x2="${width - pad.right}" y1="${round(line)}" y2="${round(line)}" class="${tick === 0 ? "tournament-report__baseline" : "tournament-report__grid"}"/>`);
    parts.push(`<text x="${pad.left - 8}" y="${round(line + 4)}" text-anchor="end" class="tournament-report__tick">${tick > 0 ? "+" : ""}${tick}</text>`);
  }
  const zero = round(y(0));
  const segment = (values: readonly number[], color: string): void => {
    if (values.length === 0) { return; }
    const points = values.map((value, index) => `${round(x(index))},${round(y(value))}`);
    parts.push(`<path d="M${round(x(0))},${zero} L${points.join(" L")} L${round(x(values.length - 1))},${zero} Z" fill="${color}" fill-opacity="0.18" stroke="none"/>`);
  };
  segment(deltas.map((value) => Math.max(0, value)), colors.positive);
  segment(deltas.map((value) => Math.min(0, value)), colors.negative);
  const points = deltas.map((value, index) => `${round(x(index))},${round(y(value))}`);
  parts.push(`<polyline points="${points.join(" ")}" fill="none" stroke="#e2e8f0" stroke-width="2" stroke-linejoin="round"/>`);
  deltas.forEach((value, index) => {
    parts.push(`<circle cx="${round(x(index))}" cy="${round(y(value))}" r="4" fill="${value >= 0 ? colors.positive : colors.negative}" stroke="#0a111b" stroke-width="1.2"><title>${escape(pointTitle(index, value))}</title></circle>`);
    if (index % (count > 24 ? 4 : count > 12 ? 2 : 1) === 0 || index === count - 1) {
      parts.push(`<text x="${round(x(index))}" y="${height - 12}" text-anchor="middle" class="tournament-report__tick">${index + 1}</text>`);
    }
  });
  parts.push("</svg>");
  return parts.join("");
}

/** The source's 720x280 histogram: finishes per position, the average as a dashed line. */
export function histogramSvg(
  counts: readonly number[],
  accent: string,
  average: number | undefined,
  barTitle: (position: number, count: number) => string,
): string {
  const width = 720;
  const height = 280;
  const pad = { left: 36, right: 12, top: 14, bottom: 30 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const slot = innerWidth / Math.max(1, counts.length);
  const top = Math.max(1, ...counts);
  const parts: string[] = [`<svg class="tournament-report__chart" viewBox="0 0 ${width} ${height}" role="img" preserveAspectRatio="xMidYMid meet">`];
  for (let tick = 0; tick <= top; tick += Math.max(1, Math.ceil(top / 4))) {
    const line = pad.top + (1 - tick / top) * innerHeight;
    parts.push(`<line x1="${pad.left}" x2="${width - pad.right}" y1="${round(line)}" y2="${round(line)}" class="tournament-report__grid"/>`);
    parts.push(`<text x="${pad.left - 8}" y="${round(line + 4)}" text-anchor="end" class="tournament-report__tick">${tick}</text>`);
  }
  counts.forEach((count, index) => {
    const barHeight = (count / top) * innerHeight;
    const x = pad.left + index * slot + slot * 0.15;
    parts.push(`<rect x="${round(x)}" y="${round(pad.top + innerHeight - barHeight)}" width="${round(slot * 0.7)}" height="${round(barHeight)}" rx="3" fill="${accent}" fill-opacity="${count === 0 ? 0.15 : 0.85}"><title>${escape(barTitle(index + 1, count))}</title></rect>`);
    parts.push(`<text x="${round(pad.left + index * slot + slot / 2)}" y="${height - 10}" text-anchor="middle" class="tournament-report__tick">${index + 1}</text>`);
  });
  if (average !== undefined && counts.length > 0) {
    const x = pad.left + (average - 0.5) * slot;
    parts.push(`<line x1="${round(x)}" x2="${round(x)}" y1="${pad.top}" y2="${pad.top + innerHeight}" class="tournament-report__average"/>`);
    parts.push(`<text x="${round(x + 4)}" y="${pad.top + 12}" class="tournament-report__tick">Ø ${reportNumber(average, 1)}</text>`);
  }
  parts.push("</svg>");
  return parts.join("");
}
