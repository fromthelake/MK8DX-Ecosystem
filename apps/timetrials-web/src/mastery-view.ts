// Track Mastery — the recovered signature "Rank" experience of the original
// product: every published best time classifies into the exact historical
// 23-tier ladder (Deity → Noob) per track and engine class, with the original
// total-time rating (unplayed tracks count as 10 minutes) and the delta to
// the next tier. Presented as the visual 96-track cup grid.

import {
  readViewerEnginePreference,
  resolveEngineMode,
  type EngineMode,
  type EnginePreferenceReader,
} from "./engine-context.js";
import {
  CUP_ASSET_MANIFEST,
  GAME_ASSET_BASE,
  trackAsset,
} from "./asset-manifest.js";
import {
  MASTERY_UNPLAYED_FALLBACK_MS,
  MASTERY_TIER_COLORS,
  masteryTierLabel,
  nextTotalTierDeltaMs,
  totalMasteryTier,
  trackMasteryTier,
  trackThresholdLadder,
  ensureMasteryWorldRecords,
} from "./mastery-thresholds.js";
import {
  artThumb,
  button,
  chip,
  dataTable,
  el,
  engineMark,
  engineSelector,
  panel,
  statBlock,
  statGrid,
  tierChip,
  useDocument,
  type DataRow,
} from "./ds-components.js";
import { localized } from "./product-language.js";

export type MountedTrackMastery = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

export type TrackBest = Readonly<{
  trackId: string;
  mode: 150 | 200;
  totalTimeMs: number;
  // Position among published human bests on this combo, served with the
  // time so nothing has to load a leaderboard to learn one number.
  rank: number;
}>;

const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const trackIdPattern = /^track\.[a-z0-9]+(?:_[a-z0-9]+)*$/;

export async function fetchTrackBests(
  playerId: string,
  signal: AbortSignal,
): Promise<readonly TrackBest[]> {
  const response = await fetch(
    `/v1/public/players/${encodeURIComponent(playerId)}/track-bests`,
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
    throw new Error("track bests unavailable");
  }
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null ||
    (body as Record<string, unknown>)["schemaVersion"] !==
      "mk8dx.public-player-track-bests.v1" ||
    !Array.isArray((body as Record<string, unknown>)["bests"])) {
    throw new Error("track bests invalid");
  }
  return parseBests((body as { bests: unknown[] }).bests);
}

function parseBests(values: readonly unknown[]): readonly TrackBest[] {
  const bests: TrackBest[] = [];
  for (const value of values) {
    const entry = value as Record<string, unknown>;
    const trackId = entry["trackId"];
    const mode = entry["mode"];
    const totalTimeMs = entry["totalTimeMs"];
    const rank = entry["rank"];
    if (typeof trackId !== "string" || !trackIdPattern.test(trackId) ||
      (mode !== 150 && mode !== 200) || typeof totalTimeMs !== "number" ||
      !Number.isSafeInteger(totalTimeMs) || totalTimeMs <= 0 ||
      typeof rank !== "number" || !Number.isSafeInteger(rank) || rank <= 0) {
      throw new Error("track bests invalid");
    }
    bests.push({ trackId, mode, totalTimeMs, rank });
  }
  return bests;
}

// Several players in one request. Six concurrent calls overflow what the
// hosting layer serves without delay, and the Home page wants the signed-in
// Player and every rival at the same moment.
export async function fetchTrackBestsFor(
  playerIds: readonly string[],
  signal: AbortSignal,
): Promise<ReadonlyMap<string, readonly TrackBest[]>> {
  const wanted = [...new Set(playerIds)].filter(
    (playerId) => playerIdPattern.test(playerId));
  const empty = new Map<string, readonly TrackBest[]>();
  if (wanted.length === 0 || wanted.length > 10) { return empty; }
  const response = await fetch(
    `/v1/public/track-bests?players=${
      wanted.map((id) => encodeURIComponent(id)).join(",")}`,
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
    throw new Error("track bests unavailable");
  }
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null ||
    (body as Record<string, unknown>)["schemaVersion"] !==
      "mk8dx.public-track-bests.v1" ||
    !Array.isArray((body as Record<string, unknown>)["players"])) {
    throw new Error("track bests invalid");
  }
  const grouped = new Map<string, readonly TrackBest[]>();
  for (const value of (body as { players: unknown[] }).players) {
    const entry = value as Record<string, unknown>;
    const playerId = entry["playerId"];
    if (typeof playerId !== "string" || !playerIdPattern.test(playerId) ||
      !Array.isArray(entry["bests"])) {
      throw new Error("track bests invalid");
    }
    grouped.set(playerId, parseBests(entry["bests"]));
  }
  return grouped;
}

function formatTime(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = milliseconds % 1_000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function formatTotal(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3_600_000);
  const rest = milliseconds % 3_600_000;
  return `${hours}:${String(Math.floor(rest / 60_000)).padStart(2, "0")}:` +
    `${String(Math.floor((rest % 60_000) / 1_000)).padStart(2, "0")}.` +
    `${String(rest % 1_000).padStart(3, "0")}`;
}

export function mountTrackMastery(
  root: HTMLElement,
  playerId: string,
  options: Readonly<{ initialMode?: EngineMode; readPreference?: EnginePreferenceReader; masteryBaseline?: () => Promise<unknown> }> = {},
): MountedTrackMastery {
  const document = root.ownerDocument;
  useDocument(document);
  const controller = new AbortController();
  let disposed = false;
  let mode: 150 | 200 = options.initialMode ?? 150;
  let modeChosenByViewer = false;
  let bests: readonly TrackBest[] = [];
  let activeChip: HTMLButtonElement | null = null;

  const container = el("div", "ds-mastery ds-stack", {});
  const status = el("p", "ds-mastery__status ds-micro", { role: "status" },
    localized("Loading Track Mastery…", "Circuitbeheersing laden…"));
  status.setAttribute("role", "status");
  const detail = el("div", "ds-mastery__detail", {});
  detail.id = "mastery-track-detail";
  detail.hidden = true;
  const content = el("div", "ds-mastery__content ds-stack", {});
  const selector = engineSelector({
    label: localized("Mastery engine class", "Motorklasse voor beheersing"),
    value: mode,
    onChange: (candidate) => {
      if (disposed || candidate === mode) { return; }
      mode = candidate;
      modeChosenByViewer = true;
      activeChip?.setAttribute("aria-expanded", "false");
      activeChip = null;
      detail.hidden = true;
      clear(detail);
      render();
    },
  });
  container.append(panel({
    title: localized("Track Mastery", "Circuitbeheersing"),
    titleLevel: 2,
    note: localized(
      "Each track has its own 23-step ladder. Engine classes never share a time or tier.",
      "Elk circuit heeft een eigen ladder met 23 treden. Motorklassen delen nooit een tijd of niveau.",
    ),
    actions: [selector.root],
    children: [status],
  }), detail, content);
  root.append(container);

  const clear = (element: HTMLElement): void => {
    while (element.firstChild !== null) {
      element.removeChild(element.firstChild);
    }
  };

  // Track drill-down: the full recovered 23-tier ladder for one track
  // with the Player's current position and the time the next tier needs.
  const showTrackDetail = (
    trackId: string,
    trackName: string,
    best: number | undefined,
    source: HTMLButtonElement,
  ): void => {
    activeChip?.setAttribute("aria-expanded", "false");
    activeChip = source;
    activeChip.setAttribute("aria-expanded", "true");
    clear(detail);
    detail.hidden = false;
    const ladder = trackThresholdLadder(trackId, mode);
    const identity = el("div", "ds-mastery__detail-identity", {});
    const asset = trackAsset(trackId);
    if (asset !== undefined) {
      identity.append(artThumb({
        src: `${GAME_ASSET_BASE}${asset.previewPath}`,
        badge: `${GAME_ASSET_BASE}${asset.cup.iconPath}`,
        size: "md",
      }), el("p", "ds-body-s", {}, asset.cup.name));
    } else {
      identity.append(el("p", "ds-body-s", {}, trackName));
    }
    const board = button({
      label: localized("View leaderboard", "Bekijk klassement"),
      variant: "quiet",
      href: `/?leaderboard=${encodeURIComponent(trackId)}&mode=${mode}`,
    });
    const close = button({ label: localized("Close", "Sluiten"), variant: "secondary", onPress: () => {
      activeChip?.setAttribute("aria-expanded", "false");
      activeChip = null;
      detail.hidden = true;
      clear(detail);
      source.focus();
    } });
    if (ladder === undefined) {
      detail.append(panel({
        title: `${trackName} · ${mode}cc`, titleLevel: 2,
        actions: [board.root, close.root],
        children: [identity, el("p", "ds-body-s", {}, localized(
          "No threshold ladder exists for this track.",
          "Voor dit circuit bestaat geen drempelladder.",
        ))],
      }));
      return;
    }
    const tierIndex = best === undefined
      ? null
      : trackMasteryTier(trackId, mode, best) ?? 22;
    const summaryLine = el("p", "ds-mastery__detail-summary", {});
    if (best === undefined) {
      summaryLine.textContent = localized(
        "Not driven yet — every tier is open.",
        "Nog niet gereden — elk niveau is nog bereikbaar.",
      );
    } else {
      const label = masteryTierLabel(tierIndex!);
      const nextThreshold = tierIndex! > 0 ? ladder[tierIndex! - 1] : null;
      summaryLine.textContent = nextThreshold == null
        ? `Your ${formatTime(best)} is ${label} — the top of the ladder.`
        : `Your ${formatTime(best)} is ${label} · ` +
          `${masteryTierLabel(tierIndex! - 1)} needs ${
            formatTime(nextThreshold)} (−${
            formatTime(best - nextThreshold)})`;
    }
    const rows: DataRow[] = ladder.map((thresholdMs, index) => {
      const label = masteryTierLabel(index);
      const current = tierIndex !== null && index === tierIndex;
      return {
        key: `${index}`,
        ...(current ? { kind: "you" as const } : {}),
        cells: [
          tierChip(label, MASTERY_TIER_COLORS[label]),
          el("span", "ds-table__num-inner", {}, `≤ ${formatTime(thresholdMs)}`),
          current ? localized("Current tier", "Huidig niveau") : "",
        ],
      };
    });
    detail.append(panel({
      title: `${trackName} · ${mode}cc`,
      titleLevel: 2,
      actions: [board.root, close.root],
      children: [identity, summaryLine, dataTable({
        caption: localized(`${trackName} mastery ladder`, `Beheersingsladder voor ${trackName}`),
        density: "dense",
        columns: [
          { key: "tier", label: localized("Tier", "Niveau"), align: "name" },
          { key: "target", label: localized("Target", "Doeltijd"), align: "num", phone: 2 },
          { key: "current", label: localized("Player", "Speler"), phone: 2 },
        ],
        rows,
      })],
    }));
    if (typeof detail.scrollIntoView === "function") {
      detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  };

  const render = (): void => {
    selector.set(mode);
    clear(content);
    const byTrack = new Map<string, number>();
    for (const best of bests) {
      if (best.mode === mode) { byTrack.set(best.trackId, best.totalTimeMs); }
    }

    // Recovered total rating: every unplayed track counts as ten minutes.
    let totalMs = 0;
    let played = 0;
    for (const cup of CUP_ASSET_MANIFEST) {
      for (const track of cup.tracks) {
        const best = byTrack.get(track.id);
        if (best === undefined) {
          totalMs += MASTERY_UNPLAYED_FALLBACK_MS;
        } else {
          totalMs += best;
          played += 1;
        }
      }
    }
    const totalTier = totalMasteryTier(totalMs, mode);
    const totalLabel = masteryTierLabel(totalTier);
    const nextDelta = nextTotalTierDeltaMs(totalMs, mode);

    content.append(panel({
      title: localized(`${mode}cc mastery`, `${mode}cc-beheersing`),
      titleLevel: 2,
      actions: [engineMark(mode)],
      children: [statGrid([
        statBlock({ label: localized("Tier", "Niveau"), value: tierChip(totalLabel, MASTERY_TIER_COLORS[totalLabel]) }),
        statBlock({ label: localized("Total time", "Totale tijd"), value: formatTotal(totalMs) }),
        statBlock({ label: localized("Tracks driven", "Gereden circuits"), value: `${played}/96` }),
        statBlock({
          label: localized("Next tier", "Volgend niveau"),
          value: el("span", "ds-mastery__next-tier", {}, nextDelta === null
            ? localized("Top of ladder", "Top van de ladder")
            : `−${formatTotal(nextDelta)} · ${masteryTierLabel(totalTier - 1)}`),
        }),
      ])],
    }));

    const grid = el("div", "ds-mastery__grid ds-stack", { "data-gap": "md" });
    for (const cup of CUP_ASSET_MANIFEST) {
      const headingId = `ds-mastery-cup-${cup.id.replaceAll(".", "-")}`;
      const row = el("section", "ds-mastery__cup", { "aria-labelledby": headingId },
        el("h3", "ds-mastery__cup-title", { id: headingId },
          el("img", "ds-mastery__cup-icon", { src: `${GAME_ASSET_BASE}${cup.iconPath}`, alt: "", loading: "lazy" }),
          cup.name),
        el("div", "ds-mastery__tracks", {}));
      const tracks = row.querySelector(".ds-mastery__tracks")!;
      for (const track of cup.tracks) {
        const best = byTrack.get(track.id);
        const trackButton = el("button", "ds-mastery__track", {
          type: "button", title: track.name, "aria-controls": detail.id, "aria-expanded": "false",
        });
        trackButton.addEventListener("click", () => {
          if (!disposed) { showTrackDetail(track.id, track.name, best, trackButton); }
        });
        trackButton.append(el("span", "ds-mastery__track-name", {}, track.name));
        if (best === undefined) {
          trackButton.setAttribute("data-unplayed", "");
          trackButton.append(chip(localized("Unplayed", "Niet gereden"), "neutral"));
        } else {
          const tierIndex = trackMasteryTier(track.id, mode, best) ?? 22;
          const label = masteryTierLabel(tierIndex);
          trackButton.append(tierChip(label, MASTERY_TIER_COLORS[label]),
            el("span", "ds-data-s", {}, formatTime(best)));
        }
        tracks.append(trackButton);
      }
      grid.append(row);
    }
    content.append(panel({
      title: localized("All 96 tracks", "Alle 96 circuits"),
      titleLevel: 2,
      note: localized(
        "Open a track for its full ladder and the exact time needed for the next tier.",
        "Open een circuit voor de volledige ladder en de exacte tijd voor het volgende niveau.",
      ),
      children: [grid],
    }));
  };

  // EngineContext: explicit option > the viewer's single-engine preference > 150 (R4). Resolved in
  // parallel with the bests, so the first paint is already the right engine.
  const engine: Promise<EngineMode> = options.initialMode !== undefined
    ? Promise.resolve(options.initialMode)
    : (options.readPreference ?? readViewerEnginePreference)()
      .then((preference) => resolveEngineMode({ preference }).mode)
      .catch(() => 150 as const);
  const ready = Promise.all([fetchTrackBests(playerId, controller.signal), engine, (options.masteryBaseline ?? ensureMasteryWorldRecords)().catch(() => false)]).then(([loaded, resolved]) => {
    if (disposed) { return; }
    if (!modeChosenByViewer) {
      mode = resolved;
      // The preference resolves after the selector's first paint. Keep the semantic radio state in
      // lockstep with the dataset; otherwise the 200cc grid was labelled by a selected 150cc tab.
      selector.set(resolved);
    }
    bests = loaded;
    status.textContent = bests.length === 0
      ? localized("No published Time Trials yet — every track is still open.",
        "Nog geen gepubliceerde tijdritten — elk circuit is nog open.")
      : localized("The 23-tier ladder from Deity to Noob, per track.",
        "De ladder met 23 niveaus van Deity tot Noob, per circuit.");
    render();
  }).catch(() => {
    if (!disposed) {
      status.textContent = localized("Track Mastery is temporarily unavailable.",
        "Circuitbeheersing is tijdelijk niet beschikbaar.");
    }
  });

  if (!playerIdPattern.test(playerId)) {
    status.textContent = localized("Track Mastery is unavailable for this Player.",
      "Circuitbeheersing is niet beschikbaar voor deze speler.");
  }

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
