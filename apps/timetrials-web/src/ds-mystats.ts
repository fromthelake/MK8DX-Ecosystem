// W28 My records & stats, redesigned (owner 2026-09-26: "visually dull and not so interesting").
//
// It was a LOW data screen: three panels of bare counts and a 107-row table. It is now a MEDIUM
// page in the Journey/Track language, built only from documents the product already serves:
//   * `/v1/me/player-insights` — the record book (best time and attempts per track and engine);
//   * `/v1/home/focus` — your rank on each track, the field size and the leading time;
//   * `/v1/public/time-trial-standings` — your total rank for the engine class;
//   * `/v1/me/player-activity` — your last 100 runs, for momentum;
//   * `/v1/public/players/:id/time-trials` — when each record was set and the combo it was set with;
//   * the profile's own Tournament sections (rating, career, tracks), mounted as they are.
// Mastery labels come from the same thresholds as Ranking and Home. Only the record book is
// required: every other source degrades to leaving its part out, never to an error page.
//
// Engine context (ENGINE_CONTEXT_INVENTORY §6, R9): everything Time Trial follows the one engine
// selector in the header. The submission and personal-best totals stay labelled Combined with their
// real breakdown. Tournament figures pool engine classes by the product's own rule (OD-13) and say so.
import {
  artHero,
  artThumb,
  barChart,
  combinedValue,
  el,
  engineMark,
  engineSelector,
  errorState,
  heroRank,
  notAuthorisedState,
  panel,
  segmentBar,
  segmentedControl,
  skeleton,
  statBlock,
  statGrid,
  tierChip,
  type EngineSelectorHandle,
} from "./ds-components.js";
import { formatCount, formatDelta, formatTime, type NumberLanguage } from "./ds-numeric.js";
import {
  createPlayerInsightsClient,
  PlayerInsightsClientError,
  type PlayerInsightsClient,
  type PlayerInsightsDocument,
} from "./player-insights-client.js";
import { leaderboardHref, type EngineMode } from "./engine-context.js";
import { localized, productLanguage, productLocaleTag } from "./product-language.js";
import { dutchPresentation } from "./dutch-ui-copy.js";
import { schema9WebTrackCatalog } from "./schema9-track-catalog.js";
import { allTrackAssets, GAME_ASSET_BASE } from "./asset-manifest.js";
import {
  MASTERY_TIER_COLORS,
  MASTERY_TIER_LABELS,
  MASTERY_UNPLAYED_FALLBACK_MS,
  ensureMasteryWorldRecords,
  masteryTierLabel,
  nextTotalTierDeltaMs,
  totalMasteryTier,
  trackMasteryTier,
  trackThresholdLadder,
  type MasteryTierLabel,
} from "./mastery-thresholds.js";
import { fetchFocusRows, type FocusRow } from "./home-focus.js";
import { fetchTimeTrialStandings, type TimeTrialStanding } from "./time-trial-standing-view.js";
import { fetchMyActivity, type ActivityRun } from "./player-activity-client.js";
import { createPublicTimeTrialClient, type PublicTimeTrialResult } from "./public-time-trial-client.js";
import { presentedPart, type PresentedPart } from "./activity-story-summary.js";
import { mountRatingGraph } from "./rating-graph.js";
import { mountTournamentCareer } from "./tournament-career.js";
import { mountTournamentTracks } from "./tournament-track-section.js";

export type MountedPlayerInsightsSection = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

type PersonalBest = PlayerInsightsDocument["timeTrials"]["personalBests"][number];

/** The extra documents the page draws on. Each may fail; the page then leaves that part out. */
export type MyStatsSources = Readonly<{
  focus(signal: AbortSignal): Promise<readonly FocusRow[] | null>;
  standings(mode: EngineMode, signal: AbortSignal): Promise<readonly TimeTrialStanding[]>;
  activity(signal: AbortSignal): Promise<Readonly<{ displayName: string; runs: readonly ActivityRun[] }> | null>;
  results(playerId: string, signal: AbortSignal): Promise<readonly PublicTimeTrialResult[]>;
  /** The current World Records as the Mastery baseline; optional so a test can leave it out. */
  masteryBaseline?: () => Promise<unknown>;
  /** Mounts the Tournament rating, nights and tracks; returns how to take them down again. */
  mountTournaments(root: HTMLElement, playerId: string, displayName: string): () => void;
}>;

export const defaultMyStatsSources: MyStatsSources = {
  masteryBaseline: () => ensureMasteryWorldRecords(),
  focus: async (signal) => (await fetchFocusRows(signal))?.rows ?? null,
  standings: (mode, signal) => fetchTimeTrialStandings(mode, signal),
  activity: (signal) => fetchMyActivity(signal),
  results: async (playerId, signal) => (await createPublicTimeTrialClient().listPlayer(playerId, signal)).results,
  mountTournaments(root, playerId, displayName) {
    const rating = el("div", "ds-mystats__tournament-part", {});
    const career = el("div", "ds-mystats__tournament-part", {});
    const tracks = el("div", "ds-mystats__tournament-part", {});
    root.append(rating, career, tracks);
    const mounted = [
      mountRatingGraph(rating, playerId),
      mountTournamentCareer(career, playerId),
      mountTournamentTracks(tracks, playerId, displayName),
    ];
    return () => { for (const part of mounted) { part.unmount(); } };
  },
};

const TRACK_NAMES = new Map(schema9WebTrackCatalog.map((track) => [track.id, track.displayName]));

/** The catalogue's name where the id is known; otherwise the id read as words, as it always was. */
export function trackLabel(trackId: string): string {
  const known = TRACK_NAMES.get(trackId);
  if (known !== undefined) { return dutchPresentation(known); }
  return trackId.slice(6).split("_").map((part) =>
    part.length <= 3 ? part.toUpperCase() : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`,
  ).join(" ");
}

/** The per-engine split the document already carries: attempts and cells at each engine class. */
export function engineBreakdown(bests: readonly PersonalBest[]): Readonly<{
  attempts: Readonly<Record<150 | 200, number>>;
  cells: Readonly<Record<150 | 200, number>>;
}> {
  const attempts = { 150: 0, 200: 0 };
  const cells = { 150: 0, 200: 0 };
  for (const best of bests) {
    attempts[best.modeCC] += best.attemptCount;
    cells[best.modeCC] += 1;
  }
  return { attempts, cells };
}

// ---------------------------------------------------------------- the pure model

/** One track in the record book, raced or not. */
export type TrackCard = Readonly<{
  trackId: string;
  name: string;
  cupId: string;
  cupName: string;
  cupIcon: string;
  preview: string;
  best?: Readonly<{
    timeMs: number;
    attempts: number;
    tier: number;
    label: MasteryTierLabel;
    /** The next Mastery level up and how much faster it asks for; absent at the top. */
    next?: Readonly<{ label: MasteryTierLabel; gapMs: number }>;
    rank?: number;
    field?: number;
    leaderMs?: number;
    setAtMs?: number;
  }>;
}>;

export function buildTrackCards(
  bests: readonly PersonalBest[], mode: EngineMode,
  focus: readonly FocusRow[] | null, results: readonly PublicTimeTrialResult[] | null,
): readonly TrackCard[] {
  const mine = new Map(bests.filter((best) => best.modeCC === mode).map((best) => [best.trackId, best]));
  const ranks = new Map((focus ?? []).filter((row) => row.mode === mode).map((row) => [row.trackId, row]));
  return allTrackAssets().map((track): TrackCard => {
    const base = {
      trackId: track.id, name: dutchPresentation(track.name), cupId: track.cup.id,
      cupName: dutchPresentation(track.cup.name), cupIcon: `${GAME_ASSET_BASE}${track.cup.iconPath}`,
      preview: `${GAME_ASSET_BASE}${track.previewPath}`,
    };
    const best = mine.get(track.id);
    if (best === undefined) { return base; }
    const tier = trackMasteryTier(track.id, mode, best.bestTimeMs) ?? MASTERY_TIER_LABELS.length - 1;
    const ladder = trackThresholdLadder(track.id, mode);
    const nextTarget = tier > 0 ? ladder?.[tier - 1] : undefined;
    const row = ranks.get(track.id);
    const set = (results ?? []).filter((result) => result.trackId === track.id && result.mode === mode &&
      result.totalTimeMs === best.bestTimeMs).map((result) => result.resultAtMs).sort((a, b) => a - b)[0];
    return {
      ...base,
      best: {
        timeMs: best.bestTimeMs, attempts: best.attemptCount, tier, label: masteryTierLabel(tier),
        ...(nextTarget === undefined ? {} : { next: { label: masteryTierLabel(tier - 1), gapMs: Math.max(0, best.bestTimeMs - nextTarget) } }),
        ...(row === undefined ? {} : { rank: row.myRank, field: row.humanCount, leaderMs: row.leaderBestMs }),
        ...(set === undefined ? {} : { setAtMs: set }),
      },
    };
  });
}

/** How many of your tracks sit at each Mastery level, fastest level first; `open` is not yet raced. */
export function masteryDistribution(cards: readonly TrackCard[]): Readonly<{
  levels: readonly Readonly<{ label: MasteryTierLabel; count: number }>[];
  open: number;
}> {
  const counts = new Map<MasteryTierLabel, number>();
  let open = 0;
  for (const card of cards) {
    if (card.best === undefined) { open += 1; continue; }
    counts.set(card.best.label, (counts.get(card.best.label) ?? 0) + 1);
  }
  return {
    levels: MASTERY_TIER_LABELS.filter((label) => counts.has(label)).map((label) => ({ label, count: counts.get(label)! })),
    open,
  };
}

const WEEK_MS = 7 * 24 * 3_600_000;

/**
 * Runs per week for the last twelve weeks, and the personal bests among them: a run faster than
 * every earlier run on that track in the window. Only the last 100 runs are known, so a gain is
 * measured against the best of those, never invented.
 */
export function momentum(runs: readonly ActivityRun[], mode: EngineMode, nowMs: number): Readonly<{
  weeks: readonly Readonly<{ startMs: number; runs: number }>[];
  recentPbs: number;
  /** The most recent run that beat your earlier runs on its track, and by how much. */
  latestPb?: Readonly<{ trackId: string; gainMs: number; atMs: number }>;
}> {
  const own = runs.filter((run) => run.modeCC === mode).sort((a, b) => a.atMs - b.atMs);
  const start = new Date(nowMs);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const weeks = Array.from({ length: 12 }, (_, index) => ({ startMs: start.getTime() - (11 - index) * WEEK_MS, runs: 0 }));
  const since = nowMs - 30 * 24 * 3_600_000;
  const bestSoFar = new Map<string, number>();
  let recentPbs = 0;
  let latestPb: { trackId: string; gainMs: number; atMs: number } | undefined;
  for (const run of own) {
    const week = weeks.findLast((candidate) => run.atMs >= candidate.startMs);
    if (week !== undefined && run.atMs < week.startMs + WEEK_MS) { week.runs += 1; }
    const previous = bestSoFar.get(run.trackId);
    if (previous === undefined || run.totalTimeMs < previous) {
      if (previous !== undefined && run.atMs >= since) {
        recentPbs += 1;
        latestPb = { trackId: run.trackId, gainMs: previous - run.totalTimeMs, atMs: run.atMs };
      }
      bestSoFar.set(run.trackId, run.totalTimeMs);
    }
  }
  return { weeks, recentPbs, ...(latestPb === undefined ? {} : { latestPb }) };
}

/** The combo most of your published runs at this engine were driven with, and how many. */
export function favouriteCombo(results: readonly PublicTimeTrialResult[], mode: EngineMode): Readonly<{
  parts: readonly Readonly<{ role: "character" | "body" | "tires" | "glider"; part: PresentedPart }>[]; runs: number; of: number;
}> | null {
  const withLoadout = results.filter((result) => result.mode === mode && result.loadout !== undefined);
  const counts = new Map<string, { count: number; loadout: PublicTimeTrialResult["loadout"] }>();
  for (const result of withLoadout) {
    const loadout = result.loadout!;
    const key = [loadout["characterId"], loadout["bodyId"], loadout["tireId"], loadout["gliderId"]].join("|");
    const entry = counts.get(key) ?? { count: 0, loadout };
    entry.count += 1;
    counts.set(key, entry);
  }
  const top = [...counts.values()].sort((a, b) => b.count - a.count)[0];
  if (top === undefined) { return null; }
  const loadout = top.loadout ?? {};
  const appearance = loadout["characterVariantId"] ?? loadout["characterId"];
  const parts = ([
    ["character", presentedPart(loadout["characterId"], loadout["characterVariantId"], appearance)],
    ["body", presentedPart(loadout["bodyId"], loadout["bodyVariantId"], appearance)],
    ["tires", presentedPart(loadout["tireId"], undefined, appearance)],
    ["glider", presentedPart(loadout["gliderId"], loadout["gliderVariantId"], appearance)],
  ] as const).flatMap(([role, part]) => part === undefined ? [] : [{ role, part }]);
  return parts.length === 0 ? null : { parts, runs: top.count, of: withLoadout.length };
}

export type RecordSort = "cup" | "next" | "rank" | "recent";

export function sortCards(cards: readonly TrackCard[], sort: RecordSort): readonly TrackCard[] {
  if (sort === "cup") { return cards; }
  const raced = cards.filter((card) => card.best !== undefined);
  const key = (card: TrackCard): number => {
    const best = card.best!;
    if (sort === "next") { return best.next?.gapMs ?? Number.MAX_SAFE_INTEGER; }
    if (sort === "rank") { return best.rank ?? Number.MAX_SAFE_INTEGER; }
    return -(best.setAtMs ?? 0);
  };
  return [...raced].sort((a, b) => key(a) - key(b) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- the page

/** "14/9": a week's first day, short enough never to wrap under a column. */
export function weekLabel(atMs: number): string {
  const date = new Date(atMs);
  return `${date.getDate()}/${date.getMonth() + 1}`;
}

function shortDate(atMs: number): string {
  return new Date(atMs).toLocaleDateString(productLocaleTag(), { day: "numeric", month: "short" });
}

export function mountPlayerInsightsSection(
  root: HTMLElement,
  client: PlayerInsightsClient = createPlayerInsightsClient(),
  sources: MyStatsSources = defaultMyStatsSources,
  now: () => number = () => Date.now(),
): MountedPlayerInsightsSection {
  const controller = new AbortController();
  const language = (): NumberLanguage => productLanguage();
  let disposed = false;
  let engine: EngineMode = 150;
  let sort: RecordSort = "cup";
  let levelFilter: MasteryTierLabel | "open" | null = null;
  let selector: EngineSelectorHandle | null = null;
  let insights: PlayerInsightsDocument | null = null;
  let focus: readonly FocusRow[] | null = null;
  let results: readonly PublicTimeTrialResult[] | null = null;
  let activity: Awaited<ReturnType<MyStatsSources["activity"]>> = null;
  const standings = new Map<EngineMode, readonly TimeTrialStanding[] | null>();
  let unmountTournaments: (() => void) | null = null;

  const container = el("div", "ds-root ds-mystats ds-stack", { "data-spectacle": "medium" });
  const heroSlot = el("div", "ds-mystats__hero", {},
    el("h1", "ds-title", {}, localized("My records & stats", "Mijn records en cijfers")));
  const status = el("p", "ds-mystats__status ds-micro", { role: "status" },
    localized("Calculating your records…", "Je records worden berekend…"));
  const overviewSlot = el("div", "ds-mystats__overview", {});
  const highlightSlot = el("div", "ds-mystats__highlights", {});
  const recordsSlot = el("div", "ds-stack", {});
  const tournamentSlot = el("div", "ds-stack ds-mystats__tournaments", {});
  const footer = el("p", "ds-micro ds-mystats__footer", {});
  container.append(heroSlot, status, overviewSlot, highlightSlot, recordsSlot, tournamentSlot, footer);
  root.append(container);
  recordsSlot.append(panel({
    title: localized("Record book", "Recordboek"), titleLevel: 2,
    children: [skeleton(6, localized("Loading your records…", "Je records worden geladen…"))],
  }));

  const cards = (): readonly TrackCard[] => buildTrackCards(insights?.timeTrials.personalBests ?? [], engine, focus, results);

  const renderHero = (all: readonly TrackCard[]): void => {
    const raced = all.filter((card) => card.best !== undefined);
    const mineStanding = standings.get(engine)?.find((row) => row.playerId === insights?.playerId && row.reference !== true);
    const field = standings.get(engine)?.filter((row) => row.reference !== true).length ?? 0;
    const totalMs = all.reduce((sum, card) => sum + (card.best?.timeMs ?? MASTERY_UNPLAYED_FALLBACK_MS), 0);
    const overall = masteryTierLabel(totalMasteryTier(totalMs, engine));
    const toNext = nextTotalTierDeltaMs(totalMs, engine);
    const strongest = [...raced].sort((a, b) => a.best!.tier - b.best!.tier || (a.best!.rank ?? 99) - (b.best!.rank ?? 99))[0];
    const top3 = raced.filter((card) => (card.best?.rank ?? 99) <= 3).length;
    selector = engineSelector({
      label: localized("Engine class", "Motorklasse"), value: engine,
      onChange: (next) => { if (!disposed && next !== engine) { engine = next; levelFilter = null; void renderAll(); } },
    });
    const rankBlock = mineStanding === undefined ? null : el("div", "ds-mystats__rank", {},
      heroRank(mineStanding.rank, language(), localized("Time Trials rank", "Tijdritpositie")),
      el("span", "ds-body-s", {}, localized(`of ${formatCount(field, language())} · ${engine}cc total`,
        `van ${formatCount(field, language())} · ${engine}cc totaal`)));
    const mastery = el("span", "ds-mystats__mastery", {}, tierChip(overall, MASTERY_TIER_COLORS[overall]),
      toNext === null ? null : el("span", "ds-micro", {},
        localized(`${formatDelta(-toNext)} to ${masteryTierLabel(totalMasteryTier(totalMs, engine) - 1)}`,
          `${formatDelta(-toNext)} tot ${masteryTierLabel(totalMasteryTier(totalMs, engine) - 1)}`)));
    const hero = artHero({
      spectacle: "medium",
      title: localized("My records & stats", "Mijn records en cijfers"),
      titleLevel: 1, titleStep: "display-3",
      eyebrow: [engineMark(engine), " ", activity?.displayName ?? localized("Time Trials", "Tijdritten")],
      ...(strongest === undefined ? {} : { backdrop: strongest.preview }),
      children: [
        rankBlock,
        statGrid([
          statBlock({ label: localized("Overall Mastery", "Totale Mastery"), value: mastery }),
          statBlock({ label: localized("Tracks raced", "Gereden circuits"),
            value: `${formatCount(raced.length, language())}/${formatCount(all.length, language())}` }),
          statBlock({ label: localized("Top 3 on a track", "Top 3 op een circuit"), value: formatCount(top3, language()) }),
          statBlock({ label: localized("Strongest track", "Sterkste circuit"),
            value: strongest === undefined ? "—" : el("span", "ds-mystats__strongest", {}, strongest.name, " ",
              tierChip(strongest.best!.label, MASTERY_TIER_COLORS[strongest.best!.label])) }),
        ]),
      ],
      aside: [selector.root],
    });
    heroSlot.replaceChildren(hero);
  };

  const renderOverview = (all: readonly TrackCard[]): void => {
    const distribution = masteryDistribution(all);
    const legend = el("div", "ds-mystats__levels", { role: "group", "aria-label": localized("Filter the record book by Mastery", "Filter het recordboek op Mastery") });
    const bar = el("div", "ds-mystats__level-bar", { role: "img",
      "aria-label": distribution.levels.map((level) => `${level.label} ${level.count}`).join(", ") });
    const total = all.length || 1;
    const levelButton = (value: MasteryTierLabel | "open", label: Node | string, count: number): HTMLElement => {
      const node = el("button", "ds-mystats__level", { type: "button", "aria-pressed": levelFilter === value ? "true" : "false" },
        label, el("span", "ds-data-s", {}, formatCount(count, language())));
      node.addEventListener("click", () => { levelFilter = levelFilter === value ? null : value; if (sort !== "cup") { sort = "cup"; } renderRecords(); renderOverview(all); });
      return node;
    };
    for (const level of distribution.levels) {
      const segment = el("span", "ds-mystats__level-segment", { title: `${level.label}: ${level.count}` });
      segment.style.setProperty("--ds-tier-colour", MASTERY_TIER_COLORS[level.label]);
      segment.style.setProperty("--ds-share", `${(level.count / total) * 100}%`);
      bar.append(segment);
      legend.append(levelButton(level.label, tierChip(level.label, MASTERY_TIER_COLORS[level.label]), level.count));
    }
    if (distribution.open > 0) {
      const segment = el("span", "ds-mystats__level-segment", { "data-open": "", title: localized(`Not raced: ${distribution.open}`, `Niet gereden: ${distribution.open}`) });
      segment.style.setProperty("--ds-share", `${(distribution.open / total) * 100}%`);
      bar.append(segment);
      legend.append(levelButton("open", el("span", "ds-mystats__open-chip", {}, localized("Not raced", "Niet gereden")), distribution.open));
    }
    const parts: HTMLElement[] = [panel({
      title: localized("Mastery across your tracks", "Mastery over je circuits"), titleLevel: 2,
      note: localized("Tap a level to see those tracks in the record book.", "Tik op een niveau om die circuits in het recordboek te zien."),
      children: [bar, legend],
    })];
    if (activity !== null) {
      const flow = momentum(activity.runs, engine, now());
      const gain = flow.latestPb;
      const line = flow.recentPbs === 0
        ? localized("No new personal bests in the last 30 days — the record book below shows where the next one is closest.",
          "Geen nieuwe persoonlijke records in de laatste 30 dagen — het recordboek hieronder laat zien waar de volgende het dichtst bij is.")
        : localized(`${formatCount(flow.recentPbs, language())} personal ${flow.recentPbs === 1 ? "best" : "bests"} in the last 30 days`,
          `${formatCount(flow.recentPbs, language())} persoonlijke ${flow.recentPbs === 1 ? "record" : "records"} in de laatste 30 dagen`)
          + (gain === undefined ? "" : localized(` · latest: ${trackLabel(gain.trackId)} ${formatDelta(-gain.gainMs)} (${shortDate(gain.atMs)})`,
            ` · laatste: ${trackLabel(gain.trackId)} ${formatDelta(-gain.gainMs)} (${shortDate(gain.atMs)})`));
      parts.push(panel({
        title: localized("Momentum", "Vorm"), titleLevel: 2,
        note: localized(`Your ${engine}cc runs per week, last 12 weeks.`, `Je ${engine}cc-ritten per week, laatste 12 weken.`),
        children: [
          el("p", "ds-body ds-mystats__momentum-line", {}, line),
          barChart({
            label: localized("Runs per week", "Ritten per week"),
            categories: flow.weeks.map((week) => weekLabel(week.startMs)),
            series: [{ name: localized("Runs", "Ritten"), values: flow.weeks.map((week) => week.runs) }],
            describeBar: (_series, category, value) => localized(`Week of ${category}: ${value} runs`, `Week van ${category}: ${value} ritten`),
          }),
        ],
      }));
    }
    overviewSlot.replaceChildren(...parts);
  };

  const highlightCard = (label: string, card: TrackCard | undefined, headline: Node | string, detail: string): HTMLElement | null => {
    if (card === undefined) { return null; }
    return el("a", "ds-mystats__highlight", { href: leaderboardHref(card.trackId, engine) },
      artThumb({ src: card.preview, badge: card.cupIcon, size: "sm" }),
      el("span", "ds-mystats__highlight-copy", {},
        el("span", "ds-kicker", {}, label),
        el("span", "ds-mystats__highlight-track", {}, card.name),
        el("span", "ds-mystats__highlight-headline", {}, headline),
        el("span", "ds-micro", {}, detail)));
  };

  const renderHighlights = (all: readonly TrackCard[]): void => {
    const raced = all.filter((card) => card.best !== undefined);
    const closest = [...raced].filter((card) => card.best!.next !== undefined)
      .sort((a, b) => a.best!.next!.gapMs - b.best!.next!.gapMs)[0];
    const bestStanding = [...raced].filter((card) => card.best!.rank !== undefined)
      .sort((a, b) => a.best!.rank! - b.best!.rank! || a.best!.tier - b.best!.tier)[0];
    const firsts = raced.filter((card) => card.best!.rank === 1).length;
    const busiest = [...raced].sort((a, b) => b.best!.attempts - a.best!.attempts)[0];
    const combo = results === null ? null : favouriteCombo(results, engine);
    const tiles = [
      closest === undefined ? null : highlightCard(localized("Closest to the next level", "Dichtst bij het volgende niveau"), closest,
        el("span", "", {}, formatDelta(-closest.best!.next!.gapMs), " ", tierChip(closest.best!.next!.label, MASTERY_TIER_COLORS[closest.best!.next!.label])),
        localized(`Now ${formatTime(closest.best!.timeMs)} · ${closest.best!.label}`, `Nu ${formatTime(closest.best!.timeMs)} · ${closest.best!.label}`)),
      bestStanding === undefined ? null : highlightCard(localized("Best standing", "Beste positie"), bestStanding,
        localized(`#${bestStanding.best!.rank} of ${bestStanding.best!.field ?? "?"}`, `#${bestStanding.best!.rank} van ${bestStanding.best!.field ?? "?"}`),
        firsts > 1
          ? localized(`You are #1 on ${firsts} tracks at ${engine}cc`, `Je staat #1 op ${firsts} circuits in ${engine}cc`)
          : localized(`${formatTime(bestStanding.best!.timeMs)} · ${bestStanding.best!.label}`, `${formatTime(bestStanding.best!.timeMs)} · ${bestStanding.best!.label}`)),
      busiest === undefined ? null : highlightCard(localized("Most attempts", "Meeste pogingen"), busiest,
        localized(`${formatCount(busiest.best!.attempts, language())} runs`, `${formatCount(busiest.best!.attempts, language())} ritten`),
        localized(`Best ${formatTime(busiest.best!.timeMs)}`, `Beste ${formatTime(busiest.best!.timeMs)}`)),
      combo === null ? null : el("div", "ds-mystats__highlight", { "data-kind": "combo" },
        el("span", "ds-mystats__highlight-copy", {},
          el("span", "ds-kicker", {}, localized("Your go-to combo", "Je favoriete combinatie")),
          el("span", "ds-mystats__combo", {}, ...combo.parts.map(({ role, part }) =>
            el("span", "ds-mystats__combo-part", { "data-role": role },
              el("img", "ds-mystats__combo-art", { src: `${GAME_ASSET_BASE}${part.iconPath}`, alt: "", loading: "lazy" }),
              el("span", "ds-mystats__combo-copy", {},
                el("span", "ds-micro", {}, {
                  character: localized("Character", "Personage"), body: localized("Body", "Kart"),
                  tires: localized("Tires", "Banden"), glider: localized("Glider", "Zweefvlieger"),
                }[role]),
                el("span", "ds-mystats__combo-name", {}, part.name))))),
          el("span", "ds-micro", {}, localized(`${combo.runs} of your last ${combo.of} ${engine}cc runs`,
            `${combo.runs} van je laatste ${combo.of} ${engine}cc-ritten`)))),
    ].filter((tile): tile is HTMLElement => tile !== null);
    highlightSlot.replaceChildren(...(tiles.length === 0 ? [] : [el("h2", "ds-kicker ds-mystats__section-label", {}, localized("Highlights", "Uitgelicht")), el("div", "ds-mystats__highlight-grid", {}, ...tiles)]));
  };

  const trackCard = (card: TrackCard): HTMLElement => {
    const best = card.best;
    const node = el("a", "ds-mystats__track", {
      href: best === undefined ? `/?post=${encodeURIComponent(card.trackId)}&mode=${engine}` : leaderboardHref(card.trackId, engine),
      "data-raced": best === undefined ? "false" : "true",
    }, artThumb({ src: card.preview, badge: card.cupIcon, size: "sm" }));
    const copy = el("span", "ds-mystats__track-copy", {}, el("span", "ds-mystats__track-name", {}, card.name));
    if (best === undefined) {
      copy.append(el("span", "ds-micro", {}, localized("Not raced yet · post a time", "Nog niet gereden · plaats een tijd")));
    } else {
      copy.append(
        el("span", "ds-mystats__track-line", {},
          el("span", "ds-data-m", {}, formatTime(best.timeMs)), tierChip(best.label, MASTERY_TIER_COLORS[best.label])),
        el("span", "ds-micro ds-mystats__track-facts", {}, [
          best.rank === undefined ? null : localized(`#${best.rank} of ${best.field ?? "?"}`, `#${best.rank} van ${best.field ?? "?"}`),
          best.next === undefined ? localized("Top level", "Hoogste niveau")
            : localized(`${formatDelta(-best.next.gapMs)} to ${best.next.label}`, `${formatDelta(-best.next.gapMs)} tot ${best.next.label}`),
          localized(`${best.attempts} ${best.attempts === 1 ? "run" : "runs"}`, `${best.attempts} ${best.attempts === 1 ? "rit" : "ritten"}`),
          best.setAtMs === undefined ? null : shortDate(best.setAtMs),
        ].filter((part) => part !== null).join(" · ")));
    }
    node.append(copy);
    return node;
  };

  const renderRecords = (): void => {
    if (insights === null) { return; }
    const all = cards();
    const shown = all.filter((card) => levelFilter === null
      || (levelFilter === "open" ? card.best === undefined : card.best?.label === levelFilter));
    const sortControl = segmentedControl<RecordSort>({
      label: localized("Order", "Volgorde"),
      choices: [
        { value: "cup", label: localized("By cup", "Per cup") },
        { value: "next", label: localized("Closest to next level", "Dichtst bij volgend niveau") },
        { value: "rank", label: localized("Best rank", "Beste positie") },
        { value: "recent", label: localized("Recently set", "Recent gezet") },
      ],
      value: sort,
      onChange: (next) => { sort = next; renderRecords(); },
    });
    const body: HTMLElement[] = [];
    if (levelFilter !== null) {
      const clear = el("button", "ds-link ds-mystats__clear", { type: "button" },
        localized("Show every track", "Toon alle circuits"));
      clear.addEventListener("click", () => { levelFilter = null; renderRecords(); renderOverview(all); });
      body.push(el("p", "ds-body-s", {}, localized(`Showing ${levelFilter === "open" ? "tracks not raced yet" : levelFilter}. `,
        `Alleen ${levelFilter === "open" ? "nog niet gereden circuits" : levelFilter}. `), clear));
    }
    if (sort === "cup") {
      const cups = new Map<string, TrackCard[]>();
      for (const card of shown) { cups.set(card.cupId, [...(cups.get(card.cupId) ?? []), card]); }
      body.push(el("div", "ds-mystats__cups", {}, ...[...cups.values()].map((list) =>
        el("section", "ds-mystats__cup", { "aria-label": list[0]!.cupName },
          el("h3", "ds-mystats__cup-title", {}, el("img", "ds-mystats__cup-icon", { src: list[0]!.cupIcon, alt: "", loading: "lazy" }), list[0]!.cupName),
          el("div", "ds-mystats__cup-tracks", {}, ...list.map(trackCard))))));
    } else {
      body.push(el("div", "ds-mystats__track-list", {}, ...sortCards(shown, sort).map(trackCard)));
    }
    const racedCount = all.filter((card) => card.best !== undefined).length;
    recordsSlot.replaceChildren(panel({
      title: localized("Record book", "Recordboek"), titleLevel: 2,
      note: localized(`${formatCount(racedCount, language())} of ${formatCount(all.length, language())} tracks at ${engine}cc. Every card opens the track's leaderboard.`,
        `${formatCount(racedCount, language())} van ${formatCount(all.length, language())} circuits op ${engine}cc. Elke kaart opent de ranglijst van het circuit.`),
      actions: [sortControl.root],
      children: body,
    }));
  };

  const renderTournaments = (): void => {
    if (insights === null) { return; }
    const tournament = insights.tournaments;
    const average = tournament.countedRaceCount === 0 ? "—" : (tournament.countedFinishPositionTotal / tournament.countedRaceCount).toFixed(1);
    const summary = panel({
      title: localized("Tournaments", "Toernooien"), titleLevel: 2,
      // OD-13: the Tournament figures pool across engine classes by the product's own rule.
      note: localized("Tournament figures count every race, whatever the engine class it was raced in.",
        "Toernooicijfers tellen elke race, in welke motorklasse die ook is gereden."),
      children: [
        statGrid([
          statBlock({ label: localized("Counted races", "Getelde races"), value: formatCount(tournament.countedRaceCount, language()), size: "lg" }),
          statBlock({ label: localized("Wins", "Overwinningen"), value: formatCount(tournament.wins, language()), size: "lg" }),
          statBlock({ label: localized("Podiums", "Podiumplaatsen"), value: formatCount(tournament.podiums, language()), size: "lg" }),
          statBlock({ label: localized("Average finish", "Gemiddelde finish"), value: average, size: "lg" }),
        ]),
        tournament.countedRaceCount === 0 ? null : segmentBar({
          label: localized("How your counted races finished", "Hoe je getelde races eindigden"),
          total: tournament.countedRaceCount,
          parts: [
            { label: localized("Wins", "Overwinningen"), value: tournament.wins, tone: "win" },
            { label: localized("Other podiums", "Overige podiumplaatsen"), value: tournament.podiums - tournament.wins, tone: "podium" },
            { label: localized("Rest", "Rest"), value: tournament.countedRaceCount - tournament.podiums, tone: "rest" },
          ],
        }),
      ],
    });
    const parts = el("div", "ds-stack", {});
    tournamentSlot.replaceChildren(summary, parts);
    if (tournament.raceCount > 0 && unmountTournaments === null) {
      unmountTournaments = sources.mountTournaments(parts, insights.playerId, activity?.displayName ?? "");
    }
  };

  const renderFooter = (): void => {
    if (insights === null) { return; }
    const { attempts, cells } = engineBreakdown(insights.timeTrials.personalBests);
    const combined = localized("Combined", "Samen");
    const breakdown = (a: number, b: number): string => `150cc ${formatCount(a, language())} · 200cc ${formatCount(b, language())}`;
    footer.replaceChildren(
      el("span", "", {}, localized("Totals: ", "Totalen: ")),
      el("span", "ds-mystats__total", {}, localized("runs submitted ", "ingezonden ritten "),
        combinedValue({ label: combined, total: formatCount(insights.timeTrials.submissionCount, language()), breakdown: breakdown(attempts[150], attempts[200]) })),
      el("span", "ds-mystats__total", {}, localized("personal bests ", "persoonlijke records "),
        combinedValue({ label: combined, total: formatCount(insights.timeTrials.personalBests.length, language()), breakdown: breakdown(cells[150], cells[200]) })),
      el("span", "", {}, localized("Calculated from your latest synchronized canonical revisions.",
        "Berekend uit je laatst gesynchroniseerde canonieke revisies.")));
  };

  const ensureStandings = async (): Promise<void> => {
    if (standings.has(engine)) { return; }
    const mode = engine;
    standings.set(mode, await sources.standings(mode, controller.signal).catch(() => null));
  };

  async function renderAll(): Promise<void> {
    await ensureStandings();
    if (disposed || insights === null) { return; }
    const all = cards();
    renderHero(all);
    renderOverview(all);
    renderHighlights(all);
    renderRecords();
  }

  const ready = (async (): Promise<void> => {
    try {
      // The record book first (and the rank documents beside it); momentum, dates, combos and the
      // Tournament history after it, so the page never opens with a burst of requests.
      const [loaded, focusRows] = await Promise.all([
        client.loadMine(controller.signal),
        sources.focus(controller.signal).catch(() => null),
        (sources.masteryBaseline ?? (async () => false))().catch(() => false),
      ]);
      if (disposed) { return; }
      insights = loaded;
      focus = focusRows;
      status.textContent = "";
      status.hidden = true;
      await renderAll();
      renderFooter();
      const [ownActivity, ownResults] = await Promise.all([
        sources.activity(controller.signal).catch(() => null),
        sources.results(loaded.playerId, controller.signal).catch(() => null),
      ]);
      if (disposed) { return; }
      activity = ownActivity;
      results = ownResults;
      await renderAll();
      renderTournaments();
    } catch (error) {
      if (disposed) { return; }
      status.textContent = "";
      const claimRequired = error instanceof PlayerInsightsClientError && error.code === "claim_required";
      recordsSlot.replaceChildren(claimRequired
        ? notAuthorisedState({
          title: localized("Your records need a verified Player.", "Je records hebben een geverifieerde speler nodig."),
          body: localized("Verify a Player claim to calculate personal records.",
            "Verifieer een spelersclaim om persoonlijke records te berekenen."),
        })
        : errorState({
          title: localized("Personal records are temporarily unavailable.", "Persoonlijke records zijn tijdelijk niet beschikbaar."),
        }));
    }
  })();

  return {
    container,
    ready,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      controller.abort();
      unmountTournaments?.();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}
