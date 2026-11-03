// Tournament TrueSkill progression: the per-race trajectory recovered
// from the legacy TN4..TN12 history, drawn as an interactive inline
// SVG line with tournament markers. Hovering inspects each race,
// including mu/sigma (owner decision 2026-08-21); leaderboards keep
// exposing the conservative score only. Head-to-head statistics come
// from the same imported races.

import { lineChart, panel, useDocument } from "./ds-components.js";
import { localized } from "./product-language.js";

export type RatingHistoryPoint = Readonly<{
  sequence: number;
  tournamentNumber: number;
  sectionLabel: string;
  raceIndex: number;
  finishPosition: number;
  score: number;
  // Owner decision 2026-08-21: per-race mu/sigma shown on hover.
  mu?: number;
  sigma?: number;
}>;

const baseInit = {
  method: "GET",
  headers: { Accept: "application/json" },
  credentials: "same-origin",
  mode: "same-origin",
  redirect: "error",
  referrerPolicy: "same-origin",
} as const;

export async function fetchRatingHistory(
  playerId: string,
  signal?: AbortSignal,
): Promise<readonly RatingHistoryPoint[]> {
  const response = await fetch(
    `/v1/public/players/${encodeURIComponent(playerId)}/rating-history`,
    { ...baseInit, ...(signal === undefined ? {} : { signal }) },
  );
  if (response.status !== 200) { throw new Error("history unavailable"); }
  const body = await response.json() as Record<string, unknown>;
  if (body["schemaVersion"] !== "mk8dx.public-rating-history.v1" ||
      !Array.isArray(body["points"])) {
    throw new Error("history invalid");
  }
  return body["points"] as readonly RatingHistoryPoint[];
}

export type HeadToHead = Readonly<{
  sharedRaces: number;
  aAhead: number;
  bAhead: number;
  averageFinishA: number;
  averageFinishB: number;
  byTournament: readonly Readonly<{
    tournamentNumber: number;
    sharedRaces: number;
    aAhead: number;
    bAhead: number;
  }>[];
}>;

export async function fetchHeadToHead(
  playerAId: string,
  playerBId: string,
  signal?: AbortSignal,
): Promise<HeadToHead> {
  const query = new URLSearchParams({
    playerA: playerAId,
    playerB: playerBId,
  });
  const response = await fetch(
    `/v1/public/head-to-head?${query.toString()}`,
    { ...baseInit, ...(signal === undefined ? {} : { signal }) },
  );
  if (response.status !== 200) {
    throw new Error("head-to-head unavailable");
  }
  const body = await response.json() as Record<string, unknown>;
  if (body["schemaVersion"] !== "mk8dx.public-head-to-head.v1") {
    throw new Error("head-to-head invalid");
  }
  return body as unknown as HeadToHead;
}

// ---------------------------------------------------------------------
// Pure graph geometry - deterministic and unit-testable.

export type RatingGraphGeometry = Readonly<{
  width: number;
  height: number;
  linePoints: string;
  ticks: readonly Readonly<{ x: number; label: string }>[];
  minScore: number;
  maxScore: number;
  lastScore: number;
}>;

const PAD_X = 8;
const PAD_Y = 12;

export function ratingGraphGeometry(
  points: readonly RatingHistoryPoint[],
  width = 560,
  height = 170,
): RatingGraphGeometry | null {
  if (points.length < 2) { return null; }
  const scores = points.map((point) => point.score);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const span = Math.max(maxScore - minScore, 1);
  const xOf = (index: number): number =>
    PAD_X + (index * (width - 2 * PAD_X)) / (points.length - 1);
  const yOf = (score: number): number =>
    height - PAD_Y - ((score - minScore) / span) * (height - 2 * PAD_Y);
  const linePoints = points.map((point, index) =>
    `${xOf(index).toFixed(1)},${yOf(point.score).toFixed(1)}`).join(" ");
  const ticks: { x: number; label: string }[] = [];
  let previousTournament: number | null = null;
  for (const [index, point] of points.entries()) {
    if (point.tournamentNumber !== previousTournament) {
      previousTournament = point.tournamentNumber;
      ticks.push({
        x: Number(xOf(index).toFixed(1)),
        label: `TN${point.tournamentNumber}`,
      });
    }
  }
  return {
    width,
    height,
    linePoints,
    ticks,
    minScore,
    maxScore,
    lastScore: points[points.length - 1]!.score,
  };
}

// The nearest trajectory point for a pointer at viewBox x-coordinate.
export function nearestPointIndex(
  viewBoxX: number,
  width: number,
  pointCount: number,
): number {
  if (pointCount <= 1) { return 0; }
  const ratio = (viewBoxX - PAD_X) / (width - 2 * PAD_X);
  const index = Math.round(ratio * (pointCount - 1));
  return Math.min(Math.max(index, 0), pointCount - 1);
}

// ---------------------------------------------------------------------

export type MountedRatingGraph = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

export function mountRatingGraph(
  root: HTMLElement,
  playerId: string,
): MountedRatingGraph {
  const document = root.ownerDocument;
  useDocument(document);
  const controller = new AbortController();
  let disposed = false;
  const container = document.createElement("div");
  container.className = "ds-profile-rating";
  root.append(container);

  const ready = fetchRatingHistory(playerId, controller.signal)
    .then((points) => {
      if (disposed) { return; }
      const geometry = ratingGraphGeometry(points);
      if (geometry === null) { return; }
      const tournaments = new Set(
        points.map((point) => point.tournamentNumber));
      const caption = localized(
        `TrueSkill progression · ${points.length} races across ${tournaments.size} tournaments · now ${geometry.lastScore.toFixed(2)}`,
        `TrueSkill-ontwikkeling · ${points.length} races in ${tournaments.size} toernooien · nu ${geometry.lastScore.toFixed(2)}`,
      );
      const ticks: { index: number; label: string }[] = [];
      let previousTournament: number | null = null;
      points.forEach((point, index) => {
        if (point.tournamentNumber === previousTournament) { return; }
        previousTournament = point.tournamentNumber;
        ticks.push({ index, label: `TN${point.tournamentNumber}` });
      });
      const describe = (index: number): string => {
        const point = points[index]!;
        const detail = [
          `${point.sectionLabel} · race ${point.raceIndex}`,
          localized(
            `P${point.finishPosition} · score ${point.score.toFixed(2)}`,
            `P${point.finishPosition} · rating ${point.score.toFixed(2)}`),
        ];
        if (point.mu !== undefined && point.sigma !== undefined) {
          detail.push(`μ ${point.mu.toFixed(2)} · σ ${point.sigma.toFixed(2)}`);
        }
        return detail.join(" · ");
      };
      const chart = lineChart({
        label: localized(
          `Rating from ${geometry.minScore.toFixed(2)} to ${geometry.maxScore.toFixed(2)}`,
          `Rating van ${geometry.minScore.toFixed(2)} tot ${geometry.maxScore.toFixed(2)}`),
        values: points.map((point) => point.score),
        describe: (index) => describe(index),
        ticks,
        summary: localized(
          `Now ${geometry.lastScore.toFixed(2)} · ${points.length} races`,
          `Nu ${geometry.lastScore.toFixed(2)} · ${points.length} races`),
        inspectLabel: localized(
          "Use Left and Right arrows to inspect every race.",
          "Gebruik de pijltoetsen links en rechts om elke race te bekijken."),
      });
      container.append(panel({
        title: localized("Tournament rating", "Toernooirating"),
        titleLevel: 2,
        note: caption,
        children: [chart],
      }));
    })
    .catch(() => undefined);

  return {
    container,
    ready,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      controller.abort();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}
