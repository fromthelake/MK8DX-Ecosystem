// Player career — the profile as a Mario Kart career destination:
// Time Trial career facts (published times, coverage, leaderboard
// firsts and podiums, most-driven track) and the public rating
// trajectory as a responsive SVG chart. Mu/Sigma are never shown.

import { trackAsset } from "./asset-manifest.js";
import {
  combinedValue,
  lineGeometry,
  panel,
  statBlock,
  statGrid,
  useDocument,
} from "./ds-components.js";
import { localized } from "./product-language.js";

export type MountedCareerSection = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

type CareerRatingEvent = Readonly<{
  sequence: number;
  eventType: "seed" | "race";
  occurredAtMs: number;
  score: number;
  delta?: number;
}>;

type CareerDocument = Readonly<{
  timeTrials: Readonly<{
    published: number;
    published150: number;
    published200: number;
    tracks150: number;
    tracks200: number;
    firsts: number;
    firsts150: number;
    firsts200: number;
    podiums: number;
    podiums150: number;
    podiums200: number;
    mostPlayed?: Readonly<{
      trackId: string; count: number; count150: number; count200: number;
    }>;
    latestResultAtMs?: number;
  }>;
  rating?: Readonly<{
    score: number;
    rank: number;
    peakScore: number;
    history: readonly CareerRatingEvent[];
  }>;
}>;

const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("career document invalid");
  }
  return value;
}

function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("career document invalid");
  }
  return value;
}

export async function fetchCareer(
  playerId: string,
  signal: AbortSignal,
): Promise<CareerDocument> {
  const response = await fetch(
    `/v1/public/players/${encodeURIComponent(playerId)}/career`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      referrerPolicy: "same-origin",
      cache: "no-store",
      signal,
    },
  );
  if (response.status !== 200) {
    throw new Error("career unavailable");
  }
  const body = await response.json() as Record<string, unknown>;
  if (body["schemaVersion"] !== "mk8dx.public-player-career.v1" ||
      typeof body["timeTrials"] !== "object" || body["timeTrials"] === null) {
    throw new Error("career document invalid");
  }
  const timeTrials = body["timeTrials"] as Record<string, unknown>;
  const mostPlayed = timeTrials["mostPlayed"] as
    Record<string, unknown> | undefined;
  const base: Omit<CareerDocument, "rating"> = {
    timeTrials: {
      published: nonNegativeInteger(timeTrials["published"]),
      published150: nonNegativeInteger(timeTrials["published150"]),
      published200: nonNegativeInteger(timeTrials["published200"]),
      tracks150: nonNegativeInteger(timeTrials["tracks150"]),
      tracks200: nonNegativeInteger(timeTrials["tracks200"]),
      firsts: nonNegativeInteger(timeTrials["firsts"]),
      firsts150: nonNegativeInteger(timeTrials["firsts150"]),
      firsts200: nonNegativeInteger(timeTrials["firsts200"]),
      podiums: nonNegativeInteger(timeTrials["podiums"]),
      podiums150: nonNegativeInteger(timeTrials["podiums150"]),
      podiums200: nonNegativeInteger(timeTrials["podiums200"]),
      ...(typeof mostPlayed === "object" && mostPlayed !== null &&
        typeof mostPlayed["trackId"] === "string"
        ? {
            mostPlayed: {
              trackId: mostPlayed["trackId"],
              count: nonNegativeInteger(mostPlayed["count"]),
              count150: nonNegativeInteger(mostPlayed["count150"]),
              count200: nonNegativeInteger(mostPlayed["count200"]),
            },
          }
        : {}),
    },
  };
  const trials = base.timeTrials;
  if (trials.published !== trials.published150 + trials.published200 ||
      trials.firsts !== trials.firsts150 + trials.firsts200 ||
      trials.podiums !== trials.podiums150 + trials.podiums200 ||
      (trials.mostPlayed !== undefined &&
        trials.mostPlayed.count !== trials.mostPlayed.count150 + trials.mostPlayed.count200)) {
    throw new Error("career engine breakdown invalid");
  }
  const rating = body["rating"] as Record<string, unknown> | undefined;
  if (typeof rating === "object" && rating !== null &&
      Array.isArray(rating["history"]) && rating["history"].length <= 500) {
    return { ...base, rating: {
      score: finite(rating["score"]),
      rank: nonNegativeInteger(rating["rank"]),
      peakScore: finite(rating["peakScore"]),
      history: rating["history"].map((entry) => {
        const row = entry as Record<string, unknown>;
        const delta = row["delta"];
        return {
          sequence: nonNegativeInteger(row["sequence"]),
          eventType: row["eventType"] === "seed" ? "seed" : "race",
          occurredAtMs: nonNegativeInteger(row["occurredAtMs"]),
          score: finite(row["score"]),
          ...(typeof delta === "number" && Number.isFinite(delta)
            ? { delta }
            : {}),
        };
      }),
    } };
  }
  return base;
}

// Chart geometry: maps the score history onto a fixed viewBox so the
// SVG scales responsively. Exported for tests.
export function chartPoints(
  history: readonly CareerRatingEvent[],
  width: number,
  height: number,
  padding: number,
): readonly Readonly<{ x: number; y: number }>[] {
  return lineGeometry(history.map((event) => event.score), width, height, padding, padding);
}

export function mountCareerSection(
  root: HTMLElement,
  playerId: string,
  loadCareer: typeof fetchCareer = fetchCareer,
): MountedCareerSection {
  const document = root.ownerDocument;
  useDocument(document);
  const controller = new AbortController();
  let disposed = false;
  const container = document.createElement("section");
  container.className = "ds-profile-career";
  // Distinguish this Time Trial region from the Tournament career content and the page landmark.
  container.setAttribute("aria-label", localized("Time Trial career", "Tijdritcarrière"));
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = localized("Loading career…", "Carrière laden…");
  container.append(status);
  root.append(container);

  const ready = (async (): Promise<void> => {
    if (!playerIdPattern.test(playerId)) {
      status.textContent = "";
      return;
    }
    const career = await loadCareer(playerId, controller.signal);
    if (disposed) { return; }
    status.textContent = "";

    const trials = career.timeTrials;
    const split = (at150: number, at200: number): string =>
      `150cc ${at150} · 200cc ${at200}`;
    const stats = [
      statBlock({
        label: localized("Published times", "Gepubliceerde tijden"),
        value: combinedValue({
          label: localized("Combined", "Samen"), total: String(trials.published),
          breakdown: split(trials.published150, trials.published200),
        }),
      }),
      statBlock({ label: localized("Tracks · 150cc", "Circuits · 150cc"), value: `${trials.tracks150}/96` }),
      statBlock({ label: localized("Tracks · 200cc", "Circuits · 200cc"), value: `${trials.tracks200}/96` }),
      statBlock({
        label: localized("Leaderboard #1s", "Eerste plaatsen"),
        value: combinedValue({
          label: localized("Combined", "Samen"), total: String(trials.firsts),
          breakdown: split(trials.firsts150, trials.firsts200),
        }),
      }),
      statBlock({
        label: localized("Podiums", "Podiumplaatsen"),
        value: combinedValue({
          label: localized("Combined", "Samen"), total: String(trials.podiums),
          breakdown: split(trials.podiums150, trials.podiums200),
        }),
      }),
    ];
    if (trials.mostPlayed !== undefined) {
      const name = trackAsset(trials.mostPlayed.trackId)?.name ??
        trials.mostPlayed.trackId;
      stats.push(statBlock({
        label: localized("Most driven", "Meest gereden"),
        value: combinedValue({
          label: localized("Combined", "Samen"), total: name,
          wrapTotal: true,
          breakdown: `${trials.mostPlayed.count}× · ${split(
            trials.mostPlayed.count150, trials.mostPlayed.count200)}`,
        }),
      }));
    }
    const children: HTMLElement[] = [statGrid(stats)];

    // Rating is intentionally presented once, in the Tournament rating panel above this section.
    container.append(panel({
      title: localized("Time Trial career", "Tijdritcarrière"),
      titleLevel: 2,
      children,
    }));
  })().catch(() => {
    if (!disposed) {
      status.textContent = localized(
        "Career statistics are temporarily unavailable.",
        "Carrièrestatistieken zijn tijdelijk niet beschikbaar.");
    }
  });

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
