// W12 Compare — Player vs Player — on the design system (Phase 12).
//
// LOW spectacle (DESIGN_SYSTEM §5): no art backdrop; the two characters and the two flags are the
// identities being compared, and that is all the picture this page gets. Every number goes through
// `ds-numeric`: one delta format with a true minus (`+0.412`, `−1:02.004`, `±0.000`), one time
// format, one total format.
//
// Engine context. Compare is engine-dependent through and through (matrix §4: "150 ✓ 200 ✓, data
// changes yes"): both totals, both ladder tiers, the score and every track row are per engine. One
// `EngineSelector` owns the page — the pair of unlabelled buttons that borrowed the track board's
// classes is gone — the address carries the resolved engine (R4/R6), and a switch replaces every
// dependent value at once.
//
// The Tournament head-to-head below it counts races, not laps, and pools engine classes by the
// product's own Tournament rule (OD-13); it is drawn as a Panel of stat blocks and its numbers are
// untouched.
import {
  dataTable,
  deltaValue,
  disclosure,
  el,
  emptyState,
  engineSelector,
  errorState,
  field,
  panel,
  skeleton,
  statBlock,
  statGrid,
  tierChip,
  type DataRow,
  type EngineSelectorHandle,
} from "./ds-components.js";
import {
  formatCount,
  formatRank,
  formatTime,
  type NumberLanguage,
} from "./ds-numeric.js";
import {
  readViewerEnginePreference,
  resolveEngineMode,
  leaderboardHref,
  type EngineMode,
  type EnginePreferenceReader,
} from "./engine-context.js";
import {
  CUP_ASSET_MANIFEST,
  GAME_ASSET_BASE,
  countryFlagPath,
} from "./asset-manifest.js";
import { avatarAppearance } from "./avatar-manifest.js";
import {
  MASTERY_TIER_COLORS,
  MASTERY_UNPLAYED_FALLBACK_MS,
  masteryTierLabel,
  totalMasteryTier,
  ensureMasteryWorldRecords,
} from "./mastery-thresholds.js";
import { fetchTrackBests, type TrackBest } from "./mastery-view.js";
import { fetchHeadToHead, type HeadToHead } from "./rating-graph.js";
import {
  createRatingClient,
  type PublicRatingEntry,
  type RatingClient,
} from "./rating-view.js";
import {
  createPublicPlayerClient,
  type PublicPlayerClient,
  type PublicPlayerProfile,
} from "./public-player-client.js";
import { dutchPresentation } from "./dutch-ui-copy.js";
import { localized, productLanguage } from "./product-language.js";

export type MountedPlayerComparison = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  /** The engine both sides are compared at. */
  engine(): EngineMode;
  unmount(): void;
}>;

export type TrackBestsLoader = (
  playerId: string,
  signal: AbortSignal,
) => Promise<readonly TrackBest[]>;

export type ComparisonSummary = Readonly<{ aheadA: number; aheadB: number; ties: number }>;

const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

function bestByTrack(bests: readonly TrackBest[], mode: EngineMode): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (const best of bests) {
    if (best.mode === mode) { map.set(best.trackId, best.totalTimeMs); }
  }
  return map;
}

/**
 * Tracks neither Player has driven are excluded; a driven track beats an undriven one, matching the
 * historical 10-minute fallback philosophy. Unchanged by the migration.
 */
export function comparisonSummary(
  bestsA: readonly TrackBest[],
  bestsB: readonly TrackBest[],
  mode: EngineMode,
): ComparisonSummary {
  const timesA = bestByTrack(bestsA, mode);
  const timesB = bestByTrack(bestsB, mode);
  let aheadA = 0;
  let aheadB = 0;
  let ties = 0;
  for (const cup of CUP_ASSET_MANIFEST) {
    for (const track of cup.tracks) {
      const a = timesA.get(track.id);
      const b = timesB.get(track.id);
      if (a === undefined && b === undefined) { continue; }
      const effectiveA = a ?? MASTERY_UNPLAYED_FALLBACK_MS;
      const effectiveB = b ?? MASTERY_UNPLAYED_FALLBACK_MS;
      if (effectiveA < effectiveB) { aheadA += 1; }
      else if (effectiveB < effectiveA) { aheadB += 1; }
      else { ties += 1; }
    }
  }
  return { aheadA, aheadB, ties };
}

function totalRatingMs(times: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const cup of CUP_ASSET_MANIFEST) {
    for (const track of cup.tracks) {
      total += times.get(track.id) ?? MASTERY_UNPLAYED_FALLBACK_MS;
    }
  }
  return total;
}

/** The 96-track total keeps its hour-first shape, as it has always read (same decision as Ranking). */
function formatStandingTotal(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3_600_000);
  const rest = milliseconds % 3_600_000;
  return `${hours}:${String(Math.floor(rest / 60_000)).padStart(2, "0")}:` +
    `${String(Math.floor((rest % 60_000) / 1_000)).padStart(2, "0")}.` +
    `${String(rest % 1_000).padStart(3, "0")}`;
}

export function mountPlayerComparison(
  root: HTMLElement,
  playerAId: string,
  playerBId: string | null,
  options: Readonly<{
    loadBests?: TrackBestsLoader;
    ratingClient?: RatingClient;
    playerClient?: PublicPlayerClient;
    initialMode?: EngineMode;
    readPreference?: EnginePreferenceReader;
    loadHeadToHead?: typeof fetchHeadToHead;
    /** The current World Records as the Mastery baseline (defaults to the shared one). */
    masteryBaseline?: () => Promise<unknown>;
    /**
     * Told which engine the page is on — once when it resolves one itself, and on every change the
     * reader makes — so the route can rewrite the address (R6).
     */
    onEngineChange?: (engine: EngineMode) => void;
  }> = {},
): MountedPlayerComparison {
  const controller = new AbortController();
  const language = (): NumberLanguage => productLanguage();
  const loadBests = options.loadBests ?? fetchTrackBests;
  const ratingClient = options.ratingClient ?? createRatingClient();
  const playerClient = options.playerClient ?? createPublicPlayerClient();
  const loadHeadToHead = options.loadHeadToHead ?? fetchHeadToHead;
  const engineReady: Promise<EngineMode> = options.initialMode !== undefined
    ? Promise.resolve(options.initialMode)
    : (options.readPreference ?? readViewerEnginePreference)()
      .then((preference) => resolveEngineMode({ preference }).mode)
      .catch(() => 150 as const);
  let disposed = false;
  let engine: EngineMode = options.initialMode ?? 150;
  let selector: EngineSelectorHandle | null = null;

  const container = el("div", "ds-root ds-compare ds-stack", { "data-spectacle": "low" });
  const heading = el("h1", "ds-title", {}, localized("Player vs Player", "Speler tegen speler"));
  const status = el("p", "ds-compare__status ds-micro", { role: "status" },
    localized("Loading comparison…", "Vergelijking wordt geladen…"));
  const summarySlot = el("div", "ds-stack", {});
  const headToHeadSlot = el("div", "ds-stack", {});
  const board = el("div", "ds-stack", {});
  container.append(heading, status, summarySlot, headToHeadSlot, board);
  root.append(container);

  const finish = (): MountedPlayerComparison => ({
    container,
    ready: Promise.resolve(),
    engine: () => engine,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      controller.abort();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  });

  if (!playerIdPattern.test(playerAId) ||
      (playerBId !== null && !playerIdPattern.test(playerBId))) {
    status.textContent = "";
    board.replaceChildren(errorState({
      title: localized("That comparison is not available.", "Die vergelijking is niet beschikbaar."),
    }));
    return finish();
  }

  board.append(skeleton(8, localized("Loading the comparison…", "De vergelijking wordt geladen…")));

  // ---------------------------------------------------------------- the two sides

  const sidePanel = (
    playerId: string, label: string, times: ReadonlyMap<string, number>,
    ratingEntry: PublicRatingEntry | undefined, profile: PublicPlayerProfile | undefined,
  ): HTMLElement => {
    const total = totalRatingMs(times);
    const tierLabel = masteryTierLabel(totalMasteryTier(total, engine));
    const identity = el("p", "ds-compare__identity", {});
    const appearance = avatarAppearance(profile?.avatarId);
    if (appearance !== undefined) {
      identity.append(el("img", "ds-compare__avatar", {
        src: `${GAME_ASSET_BASE}${appearance.iconPath}`, alt: "", loading: "lazy", "aria-hidden": "true",
      }));
    }
    identity.append(el("a", "ds-link ds-compare__name", {
      href: `/?player=${encodeURIComponent(playerId)}`, title: label,
    }, label));
    const flagPath = countryFlagPath(profile?.countryId);
    if (flagPath !== undefined) {
      identity.append(el("img", "ds-flag", {
        src: `${GAME_ASSET_BASE}${flagPath}`, alt: "", loading: "lazy", "aria-hidden": "true",
      }));
    }
    identity.append(tierChip(tierLabel, MASTERY_TIER_COLORS[tierLabel] ?? "#888888"));
    const blocks = [
      statBlock({
        label: localized("Total over 96 tracks", "Totaal over 96 circuits"),
        value: el("span", "ds-data-m ds-compare__value", {}, formatStandingTotal(total)),
        note: localized(`${formatCount(times.size, language())}/96 tracks driven`,
          `${formatCount(times.size, language())}/96 circuits gereden`),
      }),
    ];
    if (ratingEntry !== undefined) {
      blocks.push(statBlock({
        label: localized("Tournament rating", "Toernooiwaardering"),
        value: el("span", "ds-data-m ds-compare__value", {}, formatRank(ratingEntry.rank, language())),
        note: localized(`skill ${ratingEntry.score.toFixed(2)}`, `vaardigheid ${ratingEntry.score.toFixed(2)}`),
      }));
    }
    return panel({ label, children: [identity, statGrid(blocks)] });
  };

  // ---------------------------------------------------------------- the per-track board

  const trackBoard = (
    labelA: string, labelB: string,
    timesA: ReadonlyMap<string, number>, timesB: ReadonlyMap<string, number>,
  ): readonly HTMLElement[] => {
    const cups: HTMLElement[] = [];
    for (const cup of CUP_ASSET_MANIFEST) {
      const driven = cup.tracks.filter((track) => timesA.has(track.id) || timesB.has(track.id));
      if (driven.length === 0) { continue; }
      const rows: DataRow[] = driven.map((track) => {
        const a = timesA.get(track.id);
        const b = timesB.get(track.id);
        const aheadA = a !== undefined && (b === undefined || a < b);
        const aheadB = b !== undefined && (a === undefined || b < a);
        const name = dutchPresentation(track.name);
        return {
          key: track.id,
          cells: [
            el("span", "ds-table__name-inner", {},
              el("a", "ds-table__name-text ds-link", {
                href: leaderboardHref(track.id, engine), title: name,
              }, name)),
            a === undefined
              ? el("span", "ds-missing", {}, "—")
              : el("span", "ds-table__num-inner", { "data-strong": aheadA ? "" : null }, formatTime(a)),
            a === undefined || b === undefined || a === b ? null : deltaValue(a - b),
            b === undefined
              ? el("span", "ds-missing", {}, "—")
              : el("span", "ds-table__num-inner", { "data-strong": aheadB ? "" : null }, formatTime(b)),
          ],
        };
      });
      cups.push(panel({
        title: dutchPresentation(cup.name), titleLevel: 3,
        actions: [el("img", "ds-compare__cup-icon", {
          src: `${GAME_ASSET_BASE}${cup.iconPath}`, alt: "", loading: "lazy", "aria-hidden": "true",
        })],
        children: [dataTable({
          caption: localized(`${dutchPresentation(cup.name)}: ${labelA} against ${labelB}`,
            `${dutchPresentation(cup.name)}: ${labelA} tegen ${labelB}`),
          density: "timing",
          columns: [
            { key: "track", label: localized("Track", "Circuit"), align: "name" },
            { key: "a", label: labelA, align: "num", phone: 2 },
            { key: "delta", label: localized("Gap", "Verschil"),
              name: localized(`${labelA} against ${labelB}`, `${labelA} tegen ${labelB}`),
              align: "delta", phone: 2, compact: 3 },
            { key: "b", label: labelB, align: "num", phone: 2, compact: 3 },
          ],
          rows,
        })],
      }));
    }
    return cups;
  };

  const ready = (async (): Promise<void> => {
    const names = new Map<string, string>();
    const ratings = new Map<string, PublicRatingEntry>();
    let entries: readonly PublicRatingEntry[] = [];
    try {
      entries = await ratingClient.leaderboard(controller.signal);
      for (const entry of entries) {
        names.set(entry.playerId, entry.displayName);
        ratings.set(entry.playerId, entry);
      }
    } catch {
      // Names fall back to the Player id slug; the comparison still works.
    }
    if (disposed) { return; }
    const nameOf = (playerId: string): string =>
      names.get(playerId) ?? playerId.replace(/^player\./, "");

    // ---- no opponent yet: choose one
    if (playerBId === null) {
      status.textContent = localized(
        `Compare ${nameOf(playerAId)} with another Player.`,
        `Vergelijk ${nameOf(playerAId)} met een andere speler.`);
      const others = entries.filter((entry) => entry.playerId !== playerAId);
      if (others.length === 0) {
        board.replaceChildren(emptyState({
          title: localized("No other ranked Players to compare with yet.",
            "Nog geen andere geplaatste spelers om mee te vergelijken."),
        }));
        return;
      }
      const select = el("select", "ds-select ds-compare__select", {});
      for (const entry of others) {
        select.append(el("option", "", { value: entry.playerId }, entry.displayName));
      }
      const form = el("form", "ds-compare__picker", {});
      const submit = el("button", "ds-button ds-slant", {
        type: "submit", "data-variant": "primary", "data-size": "md",
      }, el("span", "ds-button__label", {}, localized("Compare", "Vergelijken")));
      form.append(
        field({ label: localized("Choose an opponent", "Kies een tegenstander"), control: select, labelFor: "ds-compare-opponent" }),
        submit);
      select.id = "ds-compare-opponent";
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const opponent = (select as HTMLSelectElement).value;
        if (playerIdPattern.test(opponent)) {
          globalThis.location.href =
            `/?compare=${encodeURIComponent(playerAId)},${encodeURIComponent(opponent)}`;
        }
      });
      board.replaceChildren(panel({
        title: localized("Choose an opponent", "Kies een tegenstander"), titleLevel: 2,
        children: [form],
      }));
      return;
    }

    // ---- both sides known
    let bestsA: readonly TrackBest[];
    let bestsB: readonly TrackBest[];
    const profiles = new Map<string, PublicPlayerProfile>();
    const profileLoad = Promise.all([playerAId, playerBId].map(async (id) => {
      try { return await playerClient.load(id, controller.signal); } catch { return null; }
    }));
    try {
      [bestsA, bestsB] = await Promise.all([
        loadBests(playerAId, controller.signal),
        loadBests(playerBId, controller.signal),
        (options.masteryBaseline ?? ensureMasteryWorldRecords)().catch(() => false),
      ]);
    } catch {
      if (!disposed) {
        status.textContent = "";
        board.replaceChildren(errorState({
          title: localized("The comparison is temporarily unavailable.",
            "De vergelijking is tijdelijk niet beschikbaar."),
        }));
      }
      return;
    }
    if (disposed) { return; }
    const labelA = nameOf(playerAId);
    const labelB = nameOf(playerBId);
    status.textContent = localized(`${labelA} vs ${labelB}`, `${labelA} tegen ${labelB}`);
    engine = await engineReady;
    if (disposed) { return; }
    // R6: a resolved engine is reported even when nobody pressed anything, so the address carries
    // it and the comparison can be shared at the engine class it was read at.
    if (options.initialMode === undefined) { options.onEngineChange?.(engine); }

    const paint = (): void => {
      const timesA = bestByTrack(bestsA, engine);
      const timesB = bestByTrack(bestsB, engine);
      const summary = comparisonSummary(bestsA, bestsB, engine);
      selector = engineSelector({
        label: localized("Engine class", "Motorklasse"),
        value: engine,
        onChange: (next) => {
          if (disposed || next === engine) { return; }
          engine = next;
          options.onEngineChange?.(next);
          paint();
        },
      });
      summarySlot.replaceChildren(panel({
        title: localized("Tracks ahead", "Circuits voor"), titleLevel: 2,
        actions: [selector.root],
        note: summary.ties > 0
          ? localized(`${formatCount(summary.ties, language())} tracks tied at ${engine}cc.`,
            `${formatCount(summary.ties, language())} circuits gelijk op ${engine}cc.`)
          : localized(`At ${engine}cc, over every track both have driven.`,
            `Op ${engine}cc, over elk circuit dat beiden reden.`),
        children: [
          el("div", "ds-compare__score", {},
            el("span", "ds-data-l ds-compare__value", {}, formatCount(summary.aheadA, language())),
            el("span", "ds-compare__versus", {}, localized("ahead", "voor")),
            el("span", "ds-data-l ds-compare__value", {}, formatCount(summary.aheadB, language()))),
          el("div", "ds-compare__sides", {},
            sidePanel(playerAId, labelA, timesA, ratings.get(playerAId), profiles.get(playerAId)),
            sidePanel(playerBId, labelB, timesB, ratings.get(playerBId), profiles.get(playerBId))),
        ],
      }));
      const cups = trackBoard(labelA, labelB, timesA, timesB);
      board.replaceChildren(...(cups.length === 0
        ? [emptyState({
          title: localized(`Neither Player has a ${engine}cc time yet.`,
            `Geen van beide spelers heeft al een ${engine}cc-tijd.`),
        })]
        : cups));
    };
    paint();

    void profileLoad.then((loaded) => {
      if (disposed) { return; }
      let changed = false;
      for (const profile of loaded) {
        if (profile !== null) { profiles.set(profile.playerId, profile); changed = true; }
      }
      if (changed) { paint(); }
    });

    // Tournament head-to-head over the imported legacy races: who finished ahead of whom.
    // Non-blocking, and never breaking the Time Trial comparison above.
    void loadHeadToHead(playerAId, playerBId, controller.signal)
      .then((h2h: HeadToHead) => {
        if (disposed || h2h.sharedRaces === 0) { return; }
        const perNight = h2h.byTournament.length > 1
          ? [disclosure({
            summary: localized("Night by night", "Avond voor avond"),
            children: [el("ul", "ds-compare__nights", {}, ...h2h.byTournament.map((entry) =>
              el("li", "ds-compare__night", {},
                el("span", "", {}, `TN${formatCount(entry.tournamentNumber, language())}`),
                el("span", "ds-data", {},
                  `${formatCount(entry.aAhead, language())}–${formatCount(entry.bAhead, language())}`))))],
          })]
          : [];
        headToHeadSlot.replaceChildren(panel({
          title: localized("Tournament head-to-head", "Onderling toernooiresultaat"), titleLevel: 2,
          // OD-13: Tournament races pool the engine classes by the product's own rule.
          note: localized("Across every finalized night, both engine classes together.",
            "Over elke afgeronde avond, beide motorklassen samen."),
          children: [
            statGrid([
              statBlock({ label: localized("Shared races", "Gedeelde races"), value: formatCount(h2h.sharedRaces, language()) }),
              statBlock({ label: localized(`${labelA} ahead`, `${labelA} voor`), value: formatCount(h2h.aAhead, language()) }),
              statBlock({ label: localized(`${labelB} ahead`, `${labelB} voor`), value: formatCount(h2h.bAhead, language()) }),
              statBlock({
                label: localized("Average finish", "Gemiddelde finish"),
                value: `${h2h.averageFinishA.toFixed(1)} · ${h2h.averageFinishB.toFixed(1)}`,
                note: `${labelA} · ${labelB}`,
              }),
            ]),
            ...perNight,
          ],
        }));
      })
      .catch(() => undefined);
  })().catch(() => {
    if (!disposed) {
      status.textContent = "";
      board.replaceChildren(errorState({
        title: localized("The comparison is temporarily unavailable.",
          "De vergelijking is tijdelijk niet beschikbaar."),
      }));
    }
  });

  return {
    container,
    ready,
    engine: () => engine,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      controller.abort();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}
