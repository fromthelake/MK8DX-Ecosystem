// W01 Home signed out and W02 Home signed in on the design system (Phase 10).
//
// HIGH spectacle (DESIGN_SYSTEM §5): an art backdrop behind the Player's own identity and standing,
// then the two engine-scoped blocks (Journey, Your focus), the story feed, the next night, the inbox
// and the places a phone cannot otherwise reach.
//
// Engine context is data (ENGINE_CONTEXT_INVENTORY §4). The page-level selector and the compact
// copies in Journey and Your focus share one state, so changing any of them updates every
// engine-scoped block. Two rules are new here:
//   R1  hidden ≠ zero. When the account's Time Trial preference filters an engine out, the blocks
//       say so and offer a quiet "Show 200cc anyway". That override is local and per visit: it
//       re-reads the bests from the network (the Home prefetch answers each path once, so the second
//       read is the unfiltered one) and never writes the account.
//   §7  no silent combining. Every number on this page is per engine and carries its engine.
import {
  artHero,
  button,
  cardLink,
  chip,
  deltaValue,
  emptyState,
  el,
  engineMark,
  engineSelector,
  errorState,
  focusTile,
  hiddenByPreference,
  journeyCard,
  notificationItem,
  panel,
  segmentedControl,
  skeleton,
  statusMessage,
  storyCard,
  tierChip,
  toggleChip,
} from "./ds-components.js";
import { formatCount, formatDelta, formatRank, formatTime, type NumberLanguage } from "./ds-numeric.js";
import { countryFlagPath, GAME_ASSET_BASE, trackAsset } from "./asset-manifest.js";
import { avatarAppearance } from "./avatar-manifest.js";
import {
  buildHomeLadder,
  fetchComeback,
  homeCompetitiveCells,
  homeLadderCells,
  homeProgressState,
  masteryLongLabel,
  recentKeyEvents,
  type HomeComeback,
} from "./home-hero.js";
import {
  buildGlobalFocus,
  buildRivalFocus,
  fetchFocusRows,
  formatGap,
  type FocusCard,
  type FocusDocument,
  type FocusSet,
  type RivalBests,
} from "./home-focus.js";
import { fetchTrackBestsFor, type TrackBest } from "./mastery-view.js";
import {
  MASTERY_TIER_COLORS,
  MASTERY_UNPLAYED_FALLBACK_MS,
  masteryTierLabel,
  nextTotalTierDeltaMs,
  trackMasteryTier,
  totalMasteryTier,
} from "./mastery-thresholds.js";
import { trackBenchmarks, type BenchmarkEntry } from "./benchmark-manifest.js";
import { tournamentTierByRank, tournamentTierLabel } from "./tournament-tiers.js";
import { rankTrackFocusHref } from "./rank-track-focus.js";
import {
  BASE_TIME_TRIAL_TRACK_IDS,
  BCP_TIME_TRIAL_TRACK_IDS,
  defaultTimeTrialTrackScope,
} from "./track-scope.js";
import { localized, productLanguage } from "./product-language.js";
import type { EngineMode } from "./engine-context.js";
import { POST_A_TIME_HREF } from "./ds-shell.js";
import { fetchStories, relativeDate, type ActivityStory } from "./activity-stories.js";
import {
  activityOutcome,
  activityFeedItemsNewestFirst,
  activityResultDelta,
  bestsKey,
  buildActivityFeed,
  limitActivityFeed,
  type ActivityFilter,
  type ActivityModeFilter,
  type ActivityScopeFilter,
} from "./activity-feed-model.js";
import {
  appliedEngineFilter,
  describeEngineFilter,
  loadCompleteActivityStories,
  showHiddenEngineLabel,
} from "./activity-feed-contract.js";
import {
  createNotificationClient,
  type NotificationClient,
  type NotificationView,
} from "./notification-client.js";
// The inbox line is the product's own sentence, written once in the notifications section; Home
// shows the same words rather than a second wording of the same event.
import { notificationLink, notificationMessage } from "./notification-section.js";
import {
  createTournamentOperationClient,
  type PublicTournamentSummary,
  type TournamentOperationClient,
} from "./tournament-operation-client.js";
import { formatTournamentStart } from "./tournament-start-clock.js";
import {
  fetchTimeTrialStandings,
  type TimeTrialStanding,
} from "./time-trial-standing-view.js";
import { activityQuickMetrics, bindActivityStorySummary } from "./activity-story-summary.js";
import { trackThumb } from "./track-thumb.js";
import { createReactionClient, type ReactionClient } from "./reaction-client.js";
import { mountReactionBar, type MountedReactionBar } from "./reaction-bar.js";

export type MountedHome = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  /** The engine the engine-scoped blocks are showing. */
  engine(): EngineMode;
  unmount(): void;
}>;

export type HomeOptions = Readonly<{
  loadComeback?: (signal: AbortSignal) => Promise<HomeComeback | null>;
  loadFocus?: (signal: AbortSignal) => Promise<FocusDocument | null>;
  loadBests?: (playerIds: readonly string[], signal: AbortSignal) => Promise<ReadonlyMap<string, readonly TrackBest[]>>;
  loadStandings?: (mode: EngineMode, signal: AbortSignal) => Promise<readonly TimeTrialStanding[]>;
  loadStories?: (signal: AbortSignal) => Promise<readonly ActivityStory[]>;
  notifications?: Pick<NotificationClient, "inbox">;
  tournaments?: Pick<TournamentOperationClient, "listPublic">;
  reactions?: ReactionClient;
  currentTimeMs?: () => number;
  /** The route's own A4, handed to the shell so the docked action becomes scroll-aware (T-DOCK). */
  onPrimaryAction?: (node: HTMLElement, href: string, label: string) => void;
}>;

const FOCUS_LABELS: Readonly<Record<FocusCard["kind"], Readonly<{ en: string; nl: string }>>> = {
  best: { en: "Lowest mastery", nl: "Laagste beheersing" },
  closest: { en: "Closest rival", nl: "Dichtstbijzijnde rivaal" },
  biggest: { en: "Biggest gap", nl: "Grootste achterstand" },
};

function isMasteryLabel(value: string): value is keyof typeof MASTERY_TIER_COLORS {
  return Object.prototype.hasOwnProperty.call(MASTERY_TIER_COLORS, value);
}

function trackIdentity(name: string): Readonly<{ origin?: string; name: string }> {
  const match = /^(SNES|N64|GBA|GCN|DS|Wii|3DS|Wii U|Tour)\s+(.+)$/i.exec(name);
  if (match === null) { return { name }; }
  return { origin: match[1]!.replace(" ", "").toUpperCase(), name: match[2]! };
}

function relativeWhen(atMs: number, nowMs: number, language: NumberLanguage): string {
  const minutes = Math.max(0, Math.round((nowMs - atMs) / 60_000));
  if (minutes < 60) { return language === "nl" ? `${minutes} min` : `${minutes} min`; }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) { return language === "nl" ? `${hours} u` : `${hours} h`; }
  const days = Math.floor(hours / 24);
  return language === "nl" ? `${days} d` : `${days} d`;
}

export function mountHome(root: HTMLElement, options: HomeOptions = {}): MountedHome {
  const document = root.ownerDocument;
  const controller = new AbortController();
  const language = (): NumberLanguage => productLanguage();
  const now = options.currentTimeMs ?? ((): number => new Date().getTime());
  const loadComeback = options.loadComeback ?? fetchComeback;
  const loadFocus = options.loadFocus ?? fetchFocusRows;
  const loadBests = options.loadBests ?? fetchTrackBestsFor;
  const loadStandings = options.loadStandings ?? fetchTimeTrialStandings;
  const loadStories = options.loadStories ?? ((signal: AbortSignal) => fetchStories(signal));
  const notifications = options.notifications ?? createNotificationClient();
  const tournaments = options.tournaments ?? createTournamentOperationClient();
  const reactions = options.reactions ?? createReactionClient();
  let disposed = false;

  const container = el("div", "ds-root ds-home ds-stack", { "data-spectacle": "high" });
  const heroSlot = el("div", "ds-home__hero", {});
  const columns = el("div", "ds-columns ds-home__columns", {});
  const mainColumn = el("div", "ds-stack ds-home__main-column", {});
  const sideColumn = el("div", "ds-stack ds-home__side-column", {});
  columns.append(mainColumn, sideColumn);
  container.append(heroSlot, columns);
  root.append(container);
  const compactHome = document.defaultView?.matchMedia("(max-width: 1099px)") ?? null;

  // ------------------------------------------------------------------ state
  let comeback: HomeComeback | null = null;
  let focusDocument: FocusDocument | null = null;
  let myBests: readonly TrackBest[] = [];
  let rivalBests: readonly RivalBests[] = [];
  let rankTargets = new Map<EngineMode, Readonly<{
    standing: number;
    totalMs: number;
    nextRankTotalMs?: number;
  }>>();
  let context: "rivals" | "global" = "rivals";
  let engine: EngineMode = 150;
  /** Engines the reader asked to see although the saved preference hides them. Never persisted. */
  const overrides = new Set<EngineMode>();
  /** The same, for the story feed, which the server narrowed before it was sent (R3). */
  let feedOverride = false;
  let feedFilter: ActivityFilter = { scope: "all", mode: "all" };
  let framePainted = false;
  let activityStories: readonly ActivityStory[] = [];
  let storiesLoaded = false;

  const preference = (): "all" | "150" | "200" => focusDocument?.modePreference ?? "all";
  const hiddenByPreferenceNow = (): boolean => {
    const saved = preference();
    return saved !== "all" && String(engine) !== saved && !overrides.has(engine);
  };
  /** The global focus rows the server sends are filtered by the same preference (R1's remainder). */
  const globalRowsUnavailable = (): boolean => {
    const saved = preference();
    return saved !== "all" && String(engine) !== saved;
  };

  const journeySlot = el("div", "ds-home__journey", {});
  const focusSlot = el("div", "ds-home__focus", {});
  const feedSlot = el("div", "ds-home__feed", {});
  const nightSlot = el("div", "ds-home__night", {});
  const inboxSlot = el("div", "ds-home__inbox", {});
  const awaySlot = el("div", "ds-home__away", {});
  const placesSlot = el("div", "ds-home__places", {});

  // ------------------------------------------------------------------ hero
  const paintHero = (): void => {
    if (comeback === null) { return; }
    const lang = language();
    const appearance = avatarAppearance(comeback.player.avatarId);
    const standing: (Node | string)[] = [];
    if (comeback.tournament !== undefined) {
      const tier = tournamentTierByRank(comeback.tournament.rank);
      const block = el("a", "ds-home__standing", { href: "/?ranking=tournament" },
        el("span", "ds-home__standing-label ds-label", {}, localized("Tournament", "Toernooi")),
        el("span", "ds-home__standing-value", {
          "aria-label": `${localized("Tournament position", "Toernooipositie")} ${formatRank(comeback.tournament.rank, lang)}`,
        }, localized(
          `${formatRank(comeback.tournament.rank, lang)} of ${formatCount(comeback.tournament.of, lang)}`,
          `${formatRank(comeback.tournament.rank, lang)} van ${formatCount(comeback.tournament.of, lang)}`,
        )),
        el("span", "ds-home__standing-hint ds-body-s", {},
          `${localized("Rating", "Rating")} ${comeback.tournament.score.toFixed(2)}`));
      if (tier !== null) {
        block.append(el("span", "ds-home__standing-badge ds-body-s", {},
          `${localized("Tier:", "Klasse:")} `, tierChip(tournamentTierLabel(tier.key) ?? tier.name, tier.color)));
      }
      standing.push(block);
    }
    if (comeback.timeTrials.standing > 0 && preference() !== "200") {
      const label = masteryTierLabel(totalMasteryTier(comeback.timeTrials.totalMs, 150));
      const previous = comeback.timeTrials.previousStanding;
      const moved = previous !== undefined && previous !== comeback.timeTrials.standing;
      // The headline standing is the 150cc standing and says so (R5): there is no 200cc standing yet.
      const block = el("a", "ds-home__standing", { href: "/?ranking=timetrials&tab=mastery" },
        el("span", "ds-home__standing-label ds-label", {},
          localized("Time Trials", "Time Trials"), engineMark(150, "plain")),
        el("span", "ds-home__standing-value", {
          "aria-label": `${localized("Time Trial standing", "Time Trial-positie")} ${formatRank(comeback.timeTrials.standing, lang)}`,
        }, localized(
          `${formatRank(comeback.timeTrials.standing, lang)} of ${formatCount(comeback.timeTrials.of, lang)}`,
          `${formatRank(comeback.timeTrials.standing, lang)} van ${formatCount(comeback.timeTrials.of, lang)}`,
        )),
        el("span", "ds-home__standing-hint ds-body-s", {},
          `${localized("Total", "Totaal")} ${formatTime(comeback.timeTrials.totalMs)}`),
        el("span", "ds-home__standing-badge ds-body-s", {},
          `${localized("Mastery:", "Mastery:")} `,
          tierChip(masteryLongLabel(label), MASTERY_TIER_COLORS[label])));
      if (moved) {
        block.append(el("span", "ds-body-s ds-home__moved", {}, comeback.timeTrials.standing < previous
          ? localized(`▲ ${previous - comeback.timeTrials.standing} since your last visit`,
            `▲ ${previous - comeback.timeTrials.standing} sinds je vorige bezoek`)
          : localized(`▼ ${comeback.timeTrials.standing - previous} since your last visit`,
            `▼ ${comeback.timeTrials.standing - previous} sinds je vorige bezoek`)));
      }
      standing.push(block);
    }

    const postLabel = localized("Post a time", "Plaats een tijd");
    const post = button({ label: postLabel, variant: "primary", size: "lg", icon: "stopwatch", href: POST_A_TIME_HREF });
    // Keep the Web and Android Home identity aligned: the backdrop is the
    // track this Player submitted most recently, regardless of which engine
    // the focus controls currently show. Focus is only the fallback for an
    // account whose public activity has not loaded or has no own run yet.
    const backdropTrack = activityStories
      .filter((story) => story.player.playerId === comeback?.player.playerId)
      .reduce<ActivityStory | undefined>((latest, story) =>
        latest === undefined || story.latestAtMs > latest.latestAtMs ? story : latest, undefined)
      ?.trackId
      ?? focusDocument?.rows.find((row) => row.mode === engine)?.trackId
      ?? myBests.find((best) => best.mode === engine)?.trackId
      // A new Player has no own run or focus yet. Stadium is introductory art,
      // not a claim that they raced it; Post a time still opens the full chooser.
      ?? "track.mario_kart_stadium";
    const backdrop = backdropTrack === undefined ? undefined : trackAsset(backdropTrack)?.previewPath;
    heroSlot.replaceChildren(artHero({
      spectacle: "high",
      titleStep: "display-2",
      title: comeback.player.displayName,
      eyebrow: [localized("Welcome back", "Welkom terug")],
      ...(backdrop === undefined ? {} : { backdrop: `${GAME_ASSET_BASE}${backdrop}` }),
      ...(appearance === undefined ? {} : { thumb: {
        src: `${GAME_ASSET_BASE}${appearance.iconPath}`,
        shape: "square" as const,
      } }),
      children: [el("div", "ds-cluster", { "data-gap": "sm" }, ...standing)],
      aside: [el("div", "ds-stack", { "data-gap": "sm" },
        post.root,
        el("a", "ds-link ds-home__hero-records", { href: "/?mystats=1" },
          localized("My records & stats", "Mijn records & statistieken")))],
    }));
    options.onPrimaryAction?.(post.control, POST_A_TIME_HREF, postLabel);
  };

  // ------------------------------------------------------------------ journey (engine-scoped)
  const paintJourney = (): void => {
    const lang = language();
    const title = localized("Your Time Trial journey", "Je Time Trial-reis");
    if (hiddenByPreferenceNow()) {
      journeySlot.replaceChildren(panel({
        title, titleLevel: 2, actions: [enginePanelAction()],
        children: [hiddenByPreference({
          text: localized(
            `${engine}cc is hidden by your Time Trial preference. Your ${engine}cc journey isn't empty — Home only loads ${preference()}cc for you.`,
            `${engine}cc is verborgen door je Time Trial-voorkeur. Je ${engine}cc-reis is niet leeg — Start laadt alleen ${preference()}cc voor je.`,
          ),
          showLabel: localized(`Show ${engine}cc anyway`, `Toon ${engine}cc toch`),
          onShow: () => {
            overrides.add(engine);
            void reloadBests();
          },
        }), el("p", "ds-body-s", {}, localized(
          "This only changes what you see now. Your saved preference lives in Settings.",
          "Dit verandert alleen wat je nu ziet. Je opgeslagen voorkeur staat in Instellingen.",
        )), el("p", "ds-body-s", {},
          el("a", "ds-link", { href: "/?settings=1" },
            localized("Change preference in Settings", "Wijzig je voorkeur in Instellingen")))],
      }));
      return;
    }
    const cards: HTMLElement[] = [];
    for (const [scope, scopeLabel, trackIds] of [
      ["base", localized("Base tracks", "Basiscircuits"), BASE_TIME_TRIAL_TRACK_IDS],
      ["bcp", localized("DLC tracks", "DLC-circuits"), BCP_TIME_TRIAL_TRACK_IDS],
    ] as const) {
      const metrics = buildHomeLadder(myBests, focusDocument?.rows ?? [], engine, trackIds);
      for (const metric of homeLadderCells(metrics)) {
        const progress = homeProgressState(metric.progress);
        const label = `${scopeLabel} · ${metric.label === "Times set"
          ? localized("times set", "tijden gezet")
          : localized("staff ghosts beaten", "spookritten verslagen")}`;
        cards.push(journeyCard({
          label,
          value: metric.value,
          share: progress.percentage,
          complete: progress.complete,
          completeLabel: localized("Complete", "Voltooid"),
          href: `${rankTrackFocusHref(metric.focus, engine)}&scope=${scope}`,
          description: localized(
            `${label}: ${metric.value}, ${progress.percentage}%. View matching tracks in Ranking.`,
            `${label}: ${metric.value}, ${progress.percentage}%. Bekijk de bijbehorende circuits in het klassement.`,
          ),
        }));
      }
    }
    const access = focusDocument?.trackAccess ?? "unknown";
    const defaultScope = defaultTimeTrialTrackScope(access);
    const competitiveTrackIds = defaultScope === "base"
      ? BASE_TIME_TRIAL_TRACK_IDS
      : [...BASE_TIME_TRIAL_TRACK_IDS, ...BCP_TIME_TRIAL_TRACK_IDS];
    const competitive = buildHomeLadder(myBests, focusDocument?.rows ?? [], engine, competitiveTrackIds);
    const competitiveRow = el("div", "ds-home__counts", {});
    for (const metric of homeCompetitiveCells(competitive)) {
      const label = metric.label === "Within 1s of #1" ? localized("Within 1s of #1", "Binnen 1s van #1")
        : metric.label === "Top 3 positions" ? localized("Top 3 positions", "Top 3-posities")
          : metric.label === "Current #1s" ? localized("Current #1s", "Huidige #1's")
            : localized("Outside top 10", "Buiten de top 10");
      competitiveRow.append(el("a", "ds-home__count", {
        href: `${rankTrackFocusHref(metric.focus, engine)}&scope=${defaultScope}`,
      }, el("span", "ds-data-m", {}, formatCount(metric.value, lang)), el("span", "ds-body-s", {}, label)));
    }
    const allTrackIds = [...BASE_TIME_TRIAL_TRACK_IDS, ...BCP_TIME_TRIAL_TRACK_IDS];
    const selectedByTrack = new Map(myBests
      .filter((best) => best.mode === engine)
      .map((best) => [best.trackId, best.totalTimeMs]));
    const rankTarget = rankTargets.get(engine);
    const totalMs = rankTarget?.totalMs ?? allTrackIds.reduce((sum, trackId) =>
      sum + (selectedByTrack.get(trackId) ?? MASTERY_UNPLAYED_FALLBACK_MS), 0);
    const currentTier = totalMasteryTier(totalMs, engine);
    const masteryReduction = nextTotalTierDeltaMs(totalMs, engine);
    const totalRankingHref = `/?ranking=timetrials&tab=total&mode=${engine}&scope=all`;
    const targets = [journeyCard({
      label: localized("Overall Mastery target", "Doel totale Mastery"),
      value: masteryReduction === null
        ? localized("Highest tier reached", "Hoogste niveau bereikt")
        : el("span", "ds-cluster", { "data-gap": "xs" },
          `−${formatTime(masteryReduction)} →`,
          tierChip(
            masteryTierLabel(currentTier - 1),
            MASTERY_TIER_COLORS[masteryTierLabel(currentTier - 1)],
          )),
      note: localized("Across all 96 tracks", "Over alle 96 circuits"),
      href: totalRankingHref,
      description: localized(
        `Overall Mastery target for ${engine}cc across all 96 tracks. Open the Total ranking.`,
        `Doel totale Mastery voor ${engine}cc over alle 96 circuits. Open het totaalklassement.`,
      ),
    })];
    if (rankTarget !== undefined) {
      const nextRankTotalMs = rankTarget.nextRankTotalMs;
      targets.push(journeyCard({
        label: localized("Next rank", "Volgende positie"),
        value: rankTarget.standing === 1
          ? localized("You are #1", "Je staat #1")
          : nextRankTotalMs === undefined
            ? localized("Not available", "Niet beschikbaar")
            : `−${formatTime(Math.max(1, totalMs - nextRankTotalMs + 1))} → #${rankTarget.standing - 1}`,
        note: localized(`${engine}cc total ranking`, `${engine}cc-totaalklassement`),
        href: totalRankingHref,
        description: localized(
          `Next rank target in the ${engine}cc Total ranking.`,
          `Doel voor de volgende positie in het ${engine}cc-totaalklassement.`,
        ),
      }));
    }
    const children: (Node | string | null)[] = [
      el("div", "ds-home__journey-grid", {}, ...cards),
      competitiveRow,
      el("div", "ds-home__targets", {}, ...targets),
    ];
    if (competitive.tracksDriven === 0) {
      children.push(el("p", "ds-body-s", {}, localized(
        `Start your ${engine}cc journey with one time on any ${defaultScope === "base" ? "base" : "available"} track.`,
        `Begin je ${engine}cc-reis met één tijd op een ${defaultScope === "base" ? "basiscircuit" : "beschikbaar circuit"}.`,
      )));
    }
    if (overrides.has(engine)) {
      children.push(statusMessage("info", localized(
        `Showing ${engine}cc for this visit only; your saved preference is unchanged.`,
        `${engine}cc wordt alleen tijdens dit bezoek getoond; je opgeslagen voorkeur blijft ongewijzigd.`,
      )));
    }
    journeySlot.replaceChildren(panel({
      title, titleLevel: 2, actions: [enginePanelAction()], children,
    }));
  };

  // ------------------------------------------------------------------ focus (engine-scoped)
  const focusText = (value: string): string => {
    if (language() === "en") { return value; }
    const exact: Readonly<Record<string, string>> = {
      "Nearest faster time.": "Dichtstbijzijnde snellere tijd.",
      "Largest time deficit.": "Grootste tijdsachterstand.",
      "Nearest faster time · near the World Record.": "Dichtstbijzijnde snellere tijd · bij het wereldrecord.",
      "Largest time deficit · near the World Record.": "Grootste tijdsachterstand · bij het wereldrecord.",
      "The next position ahead of you.": "De volgende positie voor je.",
      "This is already your strongest possible Mastery tier.": "Dit is al je hoogst mogelijke Mastery-niveau.",
      "Every rivalry starts with a first lap.": "Elke rivaliteit begint met een eerste ronde.",
      "Set your first time": "Zet je eerste tijd",
    };
    return exact[value] ?? value.replace(/ · you #(\d+)$/u, " · jij #$1");
  };

  const focusTileFor = (card: FocusCard, labelOverride?: string): HTMLElement => {
    const asset = trackAsset(card.trackId);
    const presented = trackIdentity(asset?.name ?? card.trackId);
    const bullets: (Node | string)[] = [];
    if (card.masteryLabel !== undefined) {
      bullets.push(tierChip(
        card.masteryLabel,
        MASTERY_TIER_COLORS[card.masteryLabel],
      ));
    }
    if (card.targetMasteryLabel !== undefined) {
      const target = tierChip(
        localized(`Target · ${card.targetMasteryLabel}`, `Doel · ${card.targetMasteryLabel}`),
        MASTERY_TIER_COLORS[card.targetMasteryLabel],
      );
      target.classList.add("ds-focus__native-extra");
      bullets.push(target);
    }
    for (const bullet of card.bullets) {
      const mastery = /^Mastery → (.+)$/u.exec(bullet)?.[1];
      if (mastery !== undefined && isMasteryLabel(mastery)) {
        bullets.push(el("span", "ds-cluster", { "data-gap": "xs" },
          localized("Mastery →", "Beheersing →"),
          tierChip(mastery, MASTERY_TIER_COLORS[mastery])));
      } else {
        const extra = chip(focusText(bullet), "neutral");
        if (/^#\d+/u.test(bullet)) { extra.classList.add("ds-focus__native-extra"); }
        bullets.push(extra);
      }
    }
    if (card.nextMasteryLabel !== undefined && card.improveByMs !== undefined) {
      bullets.push(el("span", "ds-cluster", { "data-gap": "xs" },
        localized(
          `Improve by ${formatGap(card.improveByMs)} to reach`,
          `Verbeter met ${formatGap(card.improveByMs)} om te bereiken`,
        ),
        tierChip(card.nextMasteryLabel, MASTERY_TIER_COLORS[card.nextMasteryLabel])));
    }
    const ownRank = myBests.find((best) =>
      best.trackId === card.trackId && best.mode === card.mode)?.rank;
    const rankBullet = card.bullets.map((bullet) =>
      /^#\d+(?: of (\d+) · you #\d+)?$/u.exec(bullet)).find((match) => match !== null);
    const humanCount = rankBullet?.[1] === undefined
      ? Math.max(ownRank ?? 0, card.targetRank ?? 0)
      : Number.parseInt(rankBullet[1], 10);
    const nativeContext = card.kind !== "best" && card.targetRank !== undefined && ownRank !== undefined
      ? localized(
        `${card.targetLabel ?? card.headline} is #${card.targetRank} here — you are #${ownRank} of ${humanCount}.`,
        `${card.targetLabel ?? card.headline} staat hier #${card.targetRank} — jij staat #${ownRank} van ${humanCount}.`,
      )
      : card.context;
    const headline = nativeContext === undefined || card.nextMasteryLabel !== undefined
        ? focusText(card.headline)
        : el("span", "ds-stack", { "data-gap": "xxs" },
          el("strong", "", {}, focusText(card.headline)),
          el("span", "", {}, focusText(nativeContext)));
    return focusTile({
      kind: card.kind,
      label: labelOverride ?? localized(FOCUS_LABELS[card.kind].en, FOCUS_LABELS[card.kind].nl),
      track: presented.name,
      ...(presented.origin === undefined ? {} : { origin: presented.origin }),
      href: `/?leaderboard=${encodeURIComponent(card.trackId)}&mode=${card.mode}`,
      ...(asset === undefined ? {} : {
        art: {
          src: `${GAME_ASSET_BASE}${asset.previewPath}`,
          badge: `${GAME_ASSET_BASE}${asset.cup.iconPath}`,
          mode: card.mode,
        },
      }),
      headline,
      ...(card.myBestMs === null || card.targetMs === undefined ? {} : {
        facts: [
          { label: localized("You", "Jij"), value: formatTime(card.myBestMs) },
          { label: card.targetLabel ?? card.headline, value: formatTime(card.targetMs) },
        ],
      }),
      ...(card.gapMs === undefined ? {} : { delta: deltaValue(card.gapMs) }),
      bullets,
    });
  };

  const benchmarkShortName = (entry: BenchmarkEntry): string => entry.kind === "nintendo_staff"
    ? "Nintendo"
    : "WR";

  const masteryForBenchmark = (entry: BenchmarkEntry): keyof typeof MASTERY_TIER_COLORS | undefined => {
    const tier = trackMasteryTier(entry.trackId, entry.mode, entry.timeMs);
    return tier == null ? undefined : masteryTierLabel(tier);
  };

  const nextBenchmarkTile = (anchor: FocusCard, message: string): HTMLElement | null => {
    if (anchor.myBestMs === null) { return null; }
    const reference = [...trackBenchmarks(anchor.trackId, anchor.mode)]
      .filter((entry) => entry.timeMs < anchor.myBestMs!)
      .sort((left, right) => right.timeMs - left.timeMs)[0];
    if (reference === undefined) { return null; }
    const targetMasteryLabel = masteryForBenchmark(reference);
    const card: FocusCard = {
      kind: "closest",
      trackId: anchor.trackId,
      mode: anchor.mode,
      headline: `${benchmarkShortName(reference)} · ${formatTime(reference.timeMs)}`,
      context: message,
      gapMs: anchor.myBestMs - reference.timeMs,
      bullets: [],
      myBestMs: anchor.myBestMs,
      targetMs: reference.timeMs,
      targetLabel: reference.name,
      ...(targetMasteryLabel === undefined ? {} : { targetMasteryLabel }),
      difficulty: "solid",
    };
    const tile = focusTileFor(card, localized("Next benchmark", "Volgende referentie"));
    tile.setAttribute("data-placeholder", "");
    return tile;
  };

  const nextTrackTile = (
    selectedBests: readonly TrackBest[],
    availableTrackIds: readonly string[],
  ): HTMLElement | null => {
    const driven = new Set(selectedBests.map((best) => best.trackId));
    const trackId = availableTrackIds.find((candidate) => !driven.has(candidate));
    if (trackId === undefined) { return null; }
    const references = trackBenchmarks(trackId, engine);
    const card: FocusCard = {
      kind: "biggest",
      trackId,
      mode: engine,
      headline: localized("No time yet", "Nog geen tijd"),
      bullets: references.map((entry) =>
        `${benchmarkShortName(entry)} · ${formatTime(entry.timeMs)}`),
      myBestMs: null,
      difficulty: "open",
      masteryLabel: "Noob",
    };
    const tile = focusTileFor(card, localized("Next track", "Volgende circuit"));
    tile.setAttribute("data-placeholder", "");
    return tile;
  };

  const focusFallback = (kind: string, label: string, title: string, body: string,
    href: string, action: string): HTMLElement => {
    const tile = focusTile({ kind, label, track: title, headline: body, href, bullets: [action] });
    tile.setAttribute("data-placeholder", "");
    return tile;
  };

  const paintFocus = (): void => {
    const title = localized("Your focus", "Je focus");
    const contextControl = segmentedControl<"rivals" | "global">({
      label: localized("Challenge context", "Uitdagingscontext"),
      choices: [
        { value: "rivals", label: localized("Rivals", "Rivalen") },
        { value: "global", label: localized("Global", "Wereldwijd") },
      ],
      value: context,
      onChange: (next) => { context = next; paintFocus(); },
    });
    if (hiddenByPreferenceNow()) {
      focusSlot.replaceChildren(panel({
        title, titleLevel: 2, actions: [enginePanelAction()],
        children: [hiddenByPreference({
          text: localized(
            `${engine}cc is hidden by your Time Trial preference.`,
            `${engine}cc is verborgen door je Time Trial-voorkeur.`,
          ),
          showLabel: localized(`Show ${engine}cc anyway`, `Toon ${engine}cc toch`),
          onShow: () => { overrides.add(engine); void reloadBests(); },
        })],
      }));
      return;
    }
    const selectedBests = myBests.filter((best) => best.mode === engine);
    const selectedRivals = rivalBests.map((rival) => ({
      ...rival, bests: rival.bests.filter((best) => best.mode === engine),
    }));
    const selectedRows = (focusDocument?.rows ?? []).filter((row) => row.mode === engine);
    const set: FocusSet = context === "rivals"
      ? buildRivalFocus(selectedBests, selectedRivals, engine)
      : buildGlobalFocus(selectedRows, selectedBests, engine);
    const cards = [set.best, set.closest, set.biggest].filter((card): card is FocusCard => card !== null);
    const access = focusDocument?.trackAccess ?? "unknown";
    const defaultScope = defaultTimeTrialTrackScope(access);
    const totalTracks = defaultScope === "base"
      ? BASE_TIME_TRIAL_TRACK_IDS.length
      : BASE_TIME_TRIAL_TRACK_IDS.length + BCP_TIME_TRIAL_TRACK_IDS.length;
    const availableTrackIds = defaultScope === "base"
      ? BASE_TIME_TRIAL_TRACK_IDS
      : [...BASE_TIME_TRIAL_TRACK_IDS, ...BCP_TIME_TRIAL_TRACK_IDS];
    const drivenTracks = new Set(selectedBests.map((best) => best.trackId)).size;
    const rendered: HTMLElement[] = [];
    if (set.best !== null) { rendered.push(focusTileFor(set.best)); }
    if (set.closest !== null) {
      rendered.push(focusTileFor(set.closest));
    } else if (set.best !== null) {
      const comparableRivalTime = selectedRivals.some((rival) => rival.bests.some((rivalBest) =>
        selectedBests.some((mine) => mine.trackId === rivalBest.trackId)));
      const message = context === "rivals"
        ? comparableRivalTime
          ? localized(
            "No faster selected rival.",
            "Geen snellere gekozen rivaal.",
          )
          : localized(
            "No selected rival time yet.",
            "Nog geen tijd van een gekozen rivaal.",
          )
        : localized(
          "No faster community time.",
          "Geen snellere communitytijd.",
        );
      rendered.push(nextBenchmarkTile(set.best, message) ?? (context === "rivals"
        ? focusFallback(
          "closest", localized("Rival check", "Rivaalcheck"),
          localized("No rival target yet", "Nog geen rivaaldoel"),
          message, "/?community=1", localized("Review rivals →", "Bekijk rivalen →"),
        )
        : focusFallback(
          "closest", localized("Standing check", "Positiecheck"),
          localized("No one ahead here", "Niemand staat hier voor je"),
          message, `${rankTrackFocusHref("current-records", engine)}&scope=${defaultScope}`,
          localized("View standings →", "Bekijk standen →"),
        )));
    }
    if (set.biggest !== null) {
      rendered.push(focusTileFor(set.biggest));
    } else if (set.best !== null) {
      rendered.push(nextTrackTile(selectedBests, availableTrackIds) ?? focusFallback(
        "biggest", localized("Coverage complete", "Dekking compleet"),
        localized("Every available track has a time", "Elk beschikbaar circuit heeft een tijd"),
        localized(
          `${drivenTracks}/${totalTracks} tracks have a ${engine}cc time. Review your remaining gaps in Ranking.`,
          `${drivenTracks}/${totalTracks} circuits hebben een ${engine}cc-tijd. Bekijk je resterende achterstanden in het klassement.`,
        ),
        `${rankTrackFocusHref("outside-top-ten", engine)}&scope=${defaultScope}`,
        localized("Review standings →", "Bekijk standen →"),
      ));
    }
    const tiles = el("div", "ds-tiles", {}, ...rendered);
    const children: (Node | string | null)[] = [contextControl.root];
    if (context === "global" && globalRowsUnavailable()) {
      // Honest rather than empty: the server filters the global rows by the saved preference, so
      // this engine's global context cannot be loaded without changing the account setting.
      children.push(emptyState({
        title: localized(
          `Your ${engine}cc global context isn't loaded.`,
          `Je ${engine}cc-context wereldwijd is niet geladen.`,
        ),
        body: localized(
          `Home asks the server for ${preference()}cc only, because that is your saved Time Trial preference. Rivals still work for ${engine}cc; change the preference in Settings to see the community context.`,
          `Start vraagt de server alleen om ${preference()}cc, want dat is je opgeslagen Time Trial-voorkeur. Rivalen werken nog wel voor ${engine}cc; wijzig de voorkeur in Instellingen voor de communitycontext.`,
        ),
        action: button({
          label: localized("Open Settings", "Open Instellingen"),
          variant: "secondary", href: "/?settings=1",
        }).root,
      }));
    } else if (cards.length === 0) {
      children.push(emptyState({
        title: localized("Nothing to chase yet.", "Nog niets om te jagen."),
        body: context === "rivals"
          ? localized("Choose rivals to personalise your challenges.", "Kies rivalen om je uitdagingen persoonlijk te maken.")
          : localized("Post a time and the community context appears here.", "Plaats een tijd en de communitycontext verschijnt hier."),
        action: button({
          label: context === "rivals"
            ? localized("Choose rivals", "Kies rivalen")
            : localized("Post a time", "Plaats een tijd"),
          variant: "secondary",
          href: context === "rivals" ? "/?settings=1" : POST_A_TIME_HREF,
        }).root,
      }));
    } else {
      children.push(tiles);
    }
    focusSlot.replaceChildren(panel({
      title, titleLevel: 2, actions: [enginePanelAction()], children,
    }));
  };

  // ------------------------------------------------------------------ the story feed
  const paintFeed = (stories: readonly ActivityStory[], viewerPlayerId: string | null,
    rivals: ReadonlySet<string>): void => {
    const lang = language();
    const ownBests = new Map<string, number>();
    for (const best of myBests) { ownBests.set(bestsKey(best.trackId, best.mode), best.totalTimeMs); }
    const sections = limitActivityFeed(
      buildActivityFeed(stories, ownBests, viewerPlayerId, feedFilter,
        { rivalPlayerIds: rivals, nowMs: now() }),
      10,
    );
    const items = activityFeedItemsNewestFirst(sections);
    // The signed-in feed renders the APK Activity row (track art, identity row, metrics); the
    // signed-out feed below keeps its own lighter row with the track name.
    const list = el("div", "ds-home__stories ds-home__stories--apk", {});
    const reactionBars = new Map<string, MountedReactionBar>();
    const renderItem = (item: (typeof items)[number]): HTMLElement => {
      const asset = trackAsset(item.story.trackId);
      const you = viewerPlayerId !== null && item.story.player.playerId === viewerPlayerId;
      const outcome = activityOutcome(item);
      const delta = activityResultDelta(item, viewerPlayerId);
      const resultMarks: (Node | string)[] = [];
      if (item.story.personalBest) { resultMarks.push(chip(localized("PB", "PR"), "success")); }
      const publicationRank = item.story.runRank ?? item.story.rank?.after;
      const flag = countryFlagPath(item.story.player.countryId);
      const actor = el("span", "ds-home__activity-actor", {},
        el("span", "ds-data", {}, publicationRank === undefined ? "—" : formatRank(publicationRank, lang)),
        el("strong", "", {}, item.story.player.displayName),
        flag === undefined ? null : el("img", "ds-flag", {
          src: `${GAME_ASSET_BASE}${flag}`, alt: "", loading: "lazy", "aria-hidden": "true",
        }));
      const card = storyCard({
        href: `/?leaderboard=${encodeURIComponent(item.story.trackId)}&mode=${item.story.mode}`,
        actor,
        where: asset?.name ?? item.story.trackId,
        // The APK's Activity age ("11d ago"), shared with the Activity route.
        identityMeta: relativeDate(item.story.latestAtMs, now()),
        resultMarks,
        ...(sections.community.includes(item) ? {} : { summary: localized(
          `${formatCount(item.story.runs, lang)} ${item.story.runs === 1 ? "run" : "runs"}${item.story.personalBest ? " · personal best" : ""}`,
          `${formatCount(item.story.runs, lang)} ${item.story.runs === 1 ? "rit" : "ritten"}${item.story.personalBest ? " · persoonlijk record" : ""}`,
        ) }),
        value: formatTime(item.story.bestMs),
        ...(delta === undefined ? {} : { delta: {
          value: formatDelta(delta.milliseconds),
          direction: delta.direction,
          title: delta.basis === "viewer"
            ? delta.milliseconds > 0
              ? localized("Your best is faster", "Jouw beste tijd is sneller")
              : delta.milliseconds < 0
                ? localized("This run beat your best", "Deze tijd versloeg jouw beste tijd")
                : localized("Exactly equal to your best", "Precies gelijk aan jouw beste tijd")
            : delta.milliseconds < 0
              ? localized("Faster than the previous personal best",
                "Sneller dan het vorige persoonlijk record")
              : delta.milliseconds > 0
                ? localized("Slower than the previous personal best",
                  "Langzamer dan het vorige persoonlijk record")
                : localized("Equal to the previous personal best",
                  "Gelijk aan het vorige persoonlijk record"),
        } }),
        ...(delta !== undefined ? { resultNote: {
          value: delta.basis === "viewer"
            ? localized("vs you", "t.o.v. jou")
            : localized("vs previous PB", "t.o.v. vorig PR"),
          title: delta.basis === "viewer"
            ? localized("Compared with your best time", "Vergeleken met jouw beste tijd")
            : localized("Compared with this player's previous personal best",
              "Vergeleken met het vorige persoonlijke record van deze speler"),
        } } : delta === undefined && item.story.personalBest ? { resultNote: {
          value: localized("First time", "Eerste tijd"),
          title: localized("No previous personal best to compare",
            "Geen vorig persoonlijk record om mee te vergelijken"),
        } } : {}),
        you,
        outcome,
      });
      card.dataset.activityLayout = sections.community.includes(item) ? "community" : "compact";
      const bestRun = [...item.story.runDetails]
        .sort((left, right) => left.timeMs - right.timeMs)[0];
      const thumb = trackThumb(document, {
        trackId: item.story.trackId, mode: item.story.mode, compact: true, href: null,
        ...(bestRun === undefined ? {} : { sourceKind: bestRun.sourceKind }),
      });
      const metrics = activityQuickMetrics(item.story);
      // The APK marks a non-community story that reached #1 with its own success chip (phone only).
      const tail: HTMLElement[] = !sections.community.includes(item) && item.story.rank?.after === 1
        ? [el("span", "ds-home__story-rank-mark", {}, chip(formatRank(1, lang), "success")), metrics]
        : [metrics];
      if (thumb === null) {
        card.append(...tail);
      } else {
        card.replaceChildren(thumb, ...Array.from(card.children), ...tail);
      }
      bindActivityStorySummary(card, item, viewerPlayerId, lang, now());
      const resultId = bestRun?.resultId;
      if (you || resultId === undefined) { return card; }
      const bar = mountReactionBar(document, resultId, reactions, controller.signal,
        { labelledToggle: true });
      reactionBars.set(resultId, bar);
      return el("div", "ds-home__reactable", {}, card, bar.element);
    };
    const groups = [
      [sections.action, localized("Needs action", "Vraagt om actie")],
      [sections.rivals, localized("Rivals", "Rivalen")],
      [sections.attention, localized("Close behind", "Vlak achter je")],
      [sections.ownSessions, localized("My sessions", "Mijn sessies")],
      [sections.community, localized("Rest of the community", "Rest van de community")],
    ] as const;
    for (const [groupItems, label] of groups) {
      if (groupItems.length === 0) { continue; }
      list.append(el("h3", "ds-kicker ds-home__feed-group", {}, label));
      for (const item of [...groupItems].sort((left, right) => right.story.latestAtMs - left.story.latestAtMs)) {
        list.append(renderItem(item));
      }
    }
    if (reactionBars.size > 0) {
      void reactions.summary([...reactionBars.keys()], controller.signal).then((loaded) => {
        if (disposed) { return; }
        for (const summary of loaded) { reactionBars.get(summary.resultId)?.apply(summary); }
      }).catch(() => undefined);
    }
    // R3: the Home bootstrap silently drops the other engine class when the account preference
    // names one. The feed says which engine classes are on screen and why, in the same words the
    // Activity route uses, and offers the same local, unsaved override — which re-reads the
    // complete public feed rather than pretending the stories were there all along.
    const filterState = appliedEngineFilter(feedFilter.mode, preference(), feedOverride);
    const scopeChoices = [
      { value: "all" as ActivityScopeFilter, label: localized("All", "Alles") },
      ...(rivals.size === 0 ? [] : [{ value: "rivals" as ActivityScopeFilter, label: localized("Rivals", "Rivalen") }]),
      { value: "my_tracks" as ActivityScopeFilter, label: localized("My tracks", "Mijn circuits") },
    ];
    const scopeControl = el("div", "ds-home__feed-scope", {
      role: "group", "aria-label": localized("Activity scope", "Activiteitsbereik"),
    }, ...scopeChoices.map((choice) => toggleChip({
      label: choice.label,
      pressed: choice.value === feedFilter.scope,
      onToggle: () => {
        feedFilter = { ...feedFilter, scope: choice.value };
        paintFeed(stories, viewerPlayerId, rivals);
      },
    })));
    const modeControl = segmentedControl<ActivityModeFilter>({
      label: localized("Engine class filter", "Filter op motorklasse"),
      choices: [
        { value: "all", label: localized("All cc", "Alle cc") },
        { value: "150", label: "150cc" },
        { value: "200", label: "200cc" },
      ],
      value: feedFilter.mode,
      onChange: (mode) => {
        feedFilter = { ...feedFilter, mode };
        paintFeed(stories, viewerPlayerId, rivals);
        if (!feedOverride && preference() !== "all") {
          feedOverride = true;
          void loadCompleteActivityStories(controller.signal)
            .then((complete) => { if (!disposed) { paintFeed(complete, viewerPlayerId, rivals); } })
            .catch(() => undefined);
        }
      },
    });
    const note: HTMLElement[] = [
      el("p", "ds-body-s ds-home__feed-intro", {}, localized(
        "What matters to you, your sessions and the community",
        "Wat voor jou telt, jouw sessies en de community",
      )),
      el("div", "ds-home__feed-controls ds-stack", { "data-gap": "sm" }, scopeControl, modeControl.root),
    ];
    if (filterState.source !== "none") {
      note.push(el("p", "ds-home__feed-filter ds-micro", { role: "status", "aria-live": "polite" },
        `${describeEngineFilter(filterState)} · ${localized(
          `${formatCount(items.length, lang)} shown`, `${formatCount(items.length, lang)} getoond`)}`));
    }
    if (filterState.source === "preference") {
      note.push(button({
        label: showHiddenEngineLabel(filterState), variant: "quiet", size: "sm",
        onPress: () => {
          if (feedOverride) { return; }
          feedOverride = true;
          void loadCompleteActivityStories(controller.signal)
            .then((complete) => { if (!disposed) { paintFeed(complete, viewerPlayerId, rivals); } })
            .catch(() => { if (!disposed) { paintFeed(stories, viewerPlayerId, rivals); } });
        },
      }).root);
    }
    feedSlot.replaceChildren(panel({
      title: localized("Community activity", "Community-activiteit"),
      titleLevel: 2,
      actions: [button({
        label: localized("View all activity", "Alle activiteit"),
        variant: "quiet", size: "sm", href: "/?activity=1",
      }).root],
      children: [
        ...note,
        items.length === 0
          ? emptyState({ title: localized("No community sessions yet.", "Nog geen sessies in de community.") })
          : list,
      ],
    }));
  };

  // ------------------------------------------------------------------ next night, inbox, places
  const paintNight = (events: readonly PublicTournamentSummary[]): void => {
    const nowMs = now();
    const upcoming = events
      .filter((event) => event.finalizedAtMs === undefined && event.removed !== true)
      .filter((event) => event.startAtMs !== undefined && event.startAtMs >= nowMs - 6 * 60 * 60 * 1_000)
      .sort((left, right) => (left.startAtMs ?? 0) - (right.startAtMs ?? 0));
    const next = upcoming[0];
    if (next === undefined) { nightSlot.replaceChildren(); return; }
    const when = next.startAtMs === undefined
      ? null
      : formatTournamentStart(next.startAtMs, next.timezone);
    nightSlot.replaceChildren(panel({
      title: localized("Next night", "Volgende avond"),
      titleLevel: 2,
      children: [
        el("p", "ds-title", {},
          el("a", "ds-home__night-name", { href: `/?tournaments=${encodeURIComponent(next.tournamentId)}` }, next.name)),
        when === null ? null : el("p", "ds-body-s", {}, when),
        el("p", "ds-body-s", {}, localized(
          `${formatCount(next.participantCount, language())} registered`,
          `${formatCount(next.participantCount, language())} ingeschreven`,
        )),
        next.viewerParticipated === true
          ? el("p", "ds-cluster", { "data-gap": "sm" },
            chip(localized("You are registered", "Je bent ingeschreven"), "success"))
          : null,
      ],
    }));
  };

  const paintInbox = (unreadCount: number, views: readonly NotificationView[],
    viewerPlayerId: string | null): void => {
    const lang = language();
    const list = el("div", "ds-home__notices", {});
    for (const view of views.slice(0, 4)) {
      const href = notificationLink(view, viewerPlayerId) ?? "/?notifications=1";
      const thumb = view.trackId === undefined ? null : trackThumb(document, {
        trackId: view.trackId,
        ...(view.mode === undefined ? {} : { mode: view.mode }),
        compact: true,
        href,
        showCupName: false,
      });
      thumb?.classList.add("ds-home__notice-art");
      list.append(el("div", `ds-home__notice-row${thumb === null ? " ds-home__notice-row--text" : ""}`, {},
        thumb,
        notificationItem({
        href,
        text: notificationMessage(view, thumb !== null),
        when: relativeWhen(view.lastEventAtMs, now(), lang),
        unread: !view.read,
          unreadLabel: localized("unread", "ongelezen"),
      })));
    }
    const compact = el("div", "ds-home__inbox-compact ds-stack", { "data-gap": "sm" },
      el("p", "ds-body", {}, unreadCount === 0
        ? localized("You're all caught up.", "Je bent helemaal bij.")
        : localized(
          `${formatCount(unreadCount, lang)} unread notification${unreadCount === 1 ? "" : "s"}`,
          `${formatCount(unreadCount, lang)} ongelezen melding${unreadCount === 1 ? "" : "en"}`,
        )),
      button({
        label: localized("Open inbox", "Inbox openen"),
        variant: "secondary", href: "/?notifications=1",
      }).root);
    const detail = el("div", "ds-home__inbox-detail ds-stack", { "data-gap": "sm" },
      views.length === 0
        ? emptyState({ title: localized("No notifications yet.", "Nog geen meldingen.") })
        : list,
      el("p", "ds-body-s", {}, el("a", "ds-link", { href: "/?notifications=1" },
        localized("Open notifications →", "Open meldingen →"))));
    inboxSlot.replaceChildren(panel({
      title: localized("Inbox", "Postvak"),
      titleLevel: 2,
      note: unreadCount === 0
        ? localized("Nothing unread", "Niets ongelezen")
        : localized(`${formatCount(unreadCount, lang)} unread`, `${formatCount(unreadCount, lang)} ongelezen`),
      children: [compact, detail],
    }));
  };

  const paintPlaces = (): void => {
    placesSlot.replaceChildren(panel({
      title: localized("More places", "Meer onderdelen"),
      titleLevel: 2,
      children: [el("div", "ds-tiles", {},
        cardLink({
          href: "/?records=1", title: localized("Record book", "Recordboek"),
          body: localized("Every track record and who holds it.", "Elk circuitrecord en wie het houdt."),
        }),
        cardLink({
          href: "/?community=1", title: localized("Community", "Community"),
          body: localized("Players, rivals and groups.", "Spelers, rivalen en groepen."),
        }),
        cardLink({
          href: "/?mystats=1", title: localized("My records & stats", "Mijn records & statistieken"),
          body: localized("Your own history, in full.", "Je eigen geschiedenis, compleet."),
        }),
        cardLink({
          href: "/?apps=1", title: localized("Apps", "Apps"),
          body: localized("The Android app and LiveTrial.", "De Android-app en LiveTrial."),
        }))],
    }));
  };

  const paintAway = (): void => {
    if (comeback === null || !storiesLoaded) { awaySlot.replaceChildren(); return; }
    const bests = new Map<string, readonly TrackBest[]>([
      [comeback.player.playerId, myBests],
      ...rivalBests.map((rival) => [rival.playerId, rival.bests] as const),
    ]);
    const events = recentKeyEvents(comeback, activityStories, bests, now());
    const eventRow = (event: (typeof events)[number]): HTMLElement => {
      const asset = trackAsset(event.trackId);
      const outcomeDetail = (outcome: (typeof event)["primaryOutcome"]): HTMLElement => {
        const detail = el("span", "ds-home__key-event-detail", {});
        const signed = outcome.deltaMs === undefined ? null : deltaValue(outcome.deltaMs);
        const achievementGap = (milliseconds: number, direction: "faster" | "slower"): HTMLElement => {
          const absolute = Math.abs(milliseconds);
          const value = absolute < 60_000 ? `${(absolute / 1000).toFixed(3)}s` : formatTime(absolute);
          return el("span", "ds-delta__value", { "data-direction": direction }, value);
        };
        switch (outcome.kind) {
        case "passed":
          if (outcome.deltaMs === 0) {
            detail.append(localized(
              `Passed ${outcome.targetName ?? "a rival"} ✓ · currently tied.`,
              `${outcome.targetName ?? "Rivaal"} gepasseerd ✓ · momenteel gelijk.`,
            ));
          } else if (outcome.deltaMs !== undefined && outcome.deltaMs < 0) {
            detail.append(localized(
              `Passed ${outcome.targetName ?? "your rival"} ✓ · lead `,
              `${outcome.targetName ?? "Rivaal"} gepasseerd ✓ · voorsprong `,
            ));
            detail.append(achievementGap(outcome.deltaMs, "faster"));
            detail.append(".");
          } else {
            detail.append(localized(
              `Passed ${outcome.targetName ?? "a rival"} in this run ✓ · currently `,
              `${outcome.targetName ?? "Rivaal"} met deze run gepasseerd ✓ · momenteel `,
            ));
            if (outcome.deltaMs !== undefined) {
              detail.append(achievementGap(outcome.deltaMs, "slower"));
            }
            detail.append(localized(" behind.", " achter."));
          }
          break;
        case "ghost":
          detail.append(localized("Nintendo Ghost defeated ✓", "Nintendo Ghost verslagen ✓"));
          break;
        case "rank":
          const podium = outcome.afterRank === 1 ? "🏆 "
            : outcome.afterRank === 2 ? "🥈 " : outcome.afterRank === 3 ? "🥉 " : "";
          detail.append(localized(
            `Track rank: #${outcome.beforeRank ?? "?"} → ${podium}#${outcome.afterRank ?? "?"}.`,
            `Circuitrang: #${outcome.beforeRank ?? "?"} → ${podium}#${outcome.afterRank ?? "?"}.`,
          ));
          break;
        case "pb":
          detail.append(localized("PB improvement: ", "PR-verbetering: "));
          if (signed !== null) { detail.append(signed); }
          if (outcome.timeMs !== undefined) { detail.append(` → ${formatTime(outcome.timeMs)}`); }
          detail.append(".");
          break;
        case "first":
          detail.append(localized(
            `First published time${outcome.timeMs === undefined ? "" : `: ${formatTime(outcome.timeMs)}`}.`,
            `Eerste gepubliceerde tijd${outcome.timeMs === undefined ? "" : `: ${formatTime(outcome.timeMs)}`}.`,
          ));
          break;
        }
        return detail;
      };
      return el("li", "ds-home__key-event", {},
        el("a", "ds-home__key-event-link ds-body-s", {
          href: `/?leaderboard=${encodeURIComponent(event.trackId)}&mode=${event.mode}`,
          "aria-label": asset?.cup.name === undefined
            ? asset?.name ?? event.trackId
            : `${asset.name}, ${asset.cup.name}`,
        },
          el("span", "ds-home__key-event-head", {},
            el("span", "ds-home__key-event-track", {},
          asset === undefined ? null : el("img", "ds-home__key-event-cup", {
            src: `${GAME_ASSET_BASE}${asset.cup.iconPath}`, alt: "", loading: "lazy",
          }),
            el("strong", "", {}, asset?.name ?? event.trackId)),
            chip(localized("PB", "PR"), "success")),
          el("div", "ds-home__key-event-primary", {},
            el("span", "ds-home__key-event-bullet", { "aria-hidden": "true" }, "•"),
            outcomeDetail(event.primaryOutcome)),
          event.secondaryOutcomes.length === 0 ? null : el("ul", "ds-home__key-event-secondary", {},
            ...event.secondaryOutcomes.map((outcome) => el("li", "", {},
              el("span", "ds-home__key-event-bullet", { "aria-hidden": "true" }, "•"),
              outcomeDetail(outcome)))),
          el("span", "ds-home__key-event-meta", {},
            engineMark(event.mode),
            el("span", "ds-micro", {}, relativeWhen(event.atMs, now(), language())))));
    };
    const preview = events.slice(0, 5);
    const list = el("ul", "ds-home__away-list", {}, ...preview.map(eventRow));
    if (events.length === 0) {
      list.append(el("li", "ds-body-s", {}, localized(
        "No key events in the last 7 days.",
        "Geen belangrijke gebeurtenissen in de afgelopen 7 dagen.",
      )));
    }
    const children: HTMLElement[] = [list];
    if (events.length > preview.length) {
      children.push(el("details", "ds-home__key-history", {},
        el("summary", "ds-link", {}, localized(
          `See all ${events.length}`, `Bekijk alle ${events.length}`,
        )),
        el("ul", "ds-home__away-list", {}, ...events.slice(preview.length).map(eventRow))));
    }
    if (comeback.reactions !== undefined) {
      list.append(el("li", "ds-body-s", {}, localized(
        `${formatCount(comeback.reactions.count, language())} reactions on ${formatCount(comeback.reactions.resultCount, language())} of your Time Trials`,
        `${formatCount(comeback.reactions.count, language())} reacties op ${formatCount(comeback.reactions.resultCount, language())} van je Time Trials`,
      )));
    }
    awaySlot.replaceChildren(panel({
      title: localized("Recent key events", "Recente belangrijke gebeurtenissen"), titleLevel: 2,
      children,
    }));
  };

  // ------------------------------------------------------------------ loading
  const reloadBests = async (): Promise<void> => {
    if (comeback === null) { return; }
    const ids = [comeback.player.playerId, ...comeback.rivals.map((rival) => rival.playerId)];
    const [all, standingsByMode] = await Promise.all([
      loadBests(ids, controller.signal).catch(() => new Map<string, readonly TrackBest[]>()),
      Promise.all(([150, 200] as const).map(async (mode) => ({
        mode,
        rows: await loadStandings(mode, controller.signal).catch(() => []),
      }))),
    ]);
    if (disposed) { return; }
    rankTargets = new Map(standingsByMode.flatMap(({ mode, rows }) => {
      const ownIndex = rows.findIndex((row) => row.playerId === comeback!.player.playerId);
      if (ownIndex < 0) { return []; }
      const own = rows[ownIndex]!;
      const nextRankTotalMs = ownIndex > 0 ? rows[ownIndex - 1]?.totalTimeMs : undefined;
      return [[mode, {
        standing: own.rank,
        totalMs: own.totalTimeMs,
        ...(nextRankTotalMs === undefined ? {} : { nextRankTotalMs }),
      }] as const];
    }));
    myBests = all.get(comeback.player.playerId) ?? myBests;
    rivalBests = comeback.rivals.map((rival) => ({
      playerId: rival.playerId,
      displayName: rival.displayName,
      bests: all.get(rival.playerId) ?? [],
    }));
    paintJourney();
    paintFocus();
    paintHero();
    paintAway();
  };

  const selectEngine = (next: EngineMode): void => {
    if (next === engine) { return; }
    engine = next;
    paintJourney();
    paintFocus();
    paintHero();
  };

  const enginePanelAction = (): HTMLElement => engineSelector({
    label: localized("Engine class", "Motorklasse"),
    value: engine,
    onChange: selectEngine,
  }).root;

  const arrangeFrame = (): void => {
    if (!framePainted) { return; }
    if (compactHome?.matches === true) {
      // Android's phone Home has one engine selector, owned by Journey, then follows the same
      // section order all the way into Inbox and Community Activity. Keep the Web-only Night and
      // destination shortcuts reachable after that shared native sequence.
      mainColumn.replaceChildren(journeySlot, focusSlot, awaySlot, inboxSlot, feedSlot,
        nightSlot, placesSlot);
      sideColumn.replaceChildren();
      return;
    }
    // Desktop keeps the two-column composition (SCREEN_MIGRATION_MATRIX §3). Focus and Journey each
    // carry the shared engine selector, so the separate "Your Time Trials" row above Focus is gone
    // (owner 2026-09-26) and Focus lines up with Journey.
    mainColumn.replaceChildren(focusSlot, awaySlot, feedSlot);
    sideColumn.replaceChildren(nightSlot, journeySlot, inboxSlot, placesSlot);
  };

  const paintFrame = (): void => {
    framePainted = true;
    arrangeFrame();
  };

  const onHomeLayoutChange = (): void => { arrangeFrame(); };
  compactHome?.addEventListener("change", onHomeLayoutChange);

  const ready = (async (): Promise<void> => {
    heroSlot.replaceChildren(skeleton(3, localized("Loading your standing…", "Je positie wordt geladen…")));
    mainColumn.replaceChildren(skeleton(6, localized("Loading your Time Trials…", "Je Time Trials worden geladen…")));
    let loaded: HomeComeback | null = null;
    try {
      [loaded, focusDocument] = await Promise.all([
        loadComeback(controller.signal),
        loadFocus(controller.signal).catch(() => null),
      ]);
    } catch {
      if (disposed) { return; }
      heroSlot.replaceChildren(errorState({
        title: localized("Your Home could not be loaded.", "Je startpagina kon niet worden geladen."),
        body: localized("The connection failed. Reload to try again.", "De verbinding mislukte. Herlaad om het opnieuw te proberen."),
      }));
      mainColumn.replaceChildren();
      return;
    }
    if (disposed) { return; }
    comeback = loaded;
    if (comeback === null) {
      // An account without a Player: the one thing to do is set one up.
      heroSlot.replaceChildren(artHero({
        spectacle: "high",
        titleStep: "display-3",
        title: localized("Welcome!", "Welkom!"),
        eyebrow: [localized("MK8DX Time Trials", "MK8DX Time Trials")],
        children: [el("p", "ds-body", {}, localized(
          "Set up your Player to start racing.", "Stel je speler in om te gaan racen."))],
        aside: [button({
          label: localized("Set up your Player", "Stel je speler in"),
          variant: "primary", size: "lg", href: "/?welcome=1",
        }).root],
      }));
      mainColumn.replaceChildren();
      sideColumn.replaceChildren();
      return;
    }
    const saved = preference();
    engine = saved === "200" ? 200 : 150;
    context = comeback.rivals.length > 0 ? "rivals" : "global";
    paintFrame();
    paintHero();
    paintPlaces();
    await reloadBests();
    if (disposed) { return; }
    paintFeed([], comeback.player.playerId, new Set(comeback.rivals.map((rival) => rival.playerId)));
    const [stories, inbox, events] = await Promise.all([
      loadStories(controller.signal).catch(() => [] as readonly ActivityStory[]),
      notifications.inbox(controller.signal).catch(() => null),
      tournaments.listPublic(controller.signal).catch(() => [] as readonly PublicTournamentSummary[]),
    ]);
    if (disposed) { return; }
    activityStories = stories;
    storiesLoaded = true;
    // The first paint happens while the public activity request is still in
    // flight. Repaint now so the newest own submission replaces the fallback
    // focus artwork, exactly as it does in the Android client.
    paintHero();
    paintAway();
    paintFeed(stories, comeback.player.playerId, new Set(comeback.rivals.map((rival) => rival.playerId)));
    if (inbox !== null) { paintInbox(inbox.unreadCount, inbox.notifications, comeback.player.playerId); }
    paintNight(events);
  })().catch(() => undefined);

  return {
    container,
    ready,
    engine: () => engine,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      controller.abort();
      compactHome?.removeEventListener("change", onHomeLayoutChange);
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}

// ---------------------------------------------------------------------- W01: the signed-out landing

export type SignedOutHomeOptions = Readonly<{
  loadStories?: (signal: AbortSignal) => Promise<readonly ActivityStory[]>;
  currentTimeMs?: () => number;
  /** The sign-in panel the route builds (the magic-link form and its copy). */
  signInPanel: HTMLElement;
  /** True when the visitor asked to sign in: the form leads, the landing follows. */
  signInFirst: boolean;
  brandSrc: string;
}>;

export function mountSignedOutHome(root: HTMLElement, options: SignedOutHomeOptions): MountedHome {
  const controller = new AbortController();
  const now = options.currentTimeMs ?? ((): number => new Date().getTime());
  const loadStories = options.loadStories ?? ((signal: AbortSignal) => fetchStories(signal));
  let disposed = false;

  const container = el("div", "ds-root ds-home ds-stack", { "data-spectacle": "high" });
  const hero = artHero({
    spectacle: "high",
    titleStep: "display-2",
    title: localized("Race. Record. Improve.", "Rijd. Registreer. Verbeter."),
    eyebrow: [localized("MK8DX Time Trials · Web", "MK8DX Time Trials · Web")],
    // The canonical app icon is square. ArtHero defaults to 16:9 track artwork, so name this
    // identity use explicitly rather than cropping the lower half of the mark away.
    thumb: { src: options.brandSrc, shape: "square" },
    children: [el("p", "ds-body", {}, localized(
      "Explore all 96 tracks, compare times with the community and record your Mario Kart 8 Deluxe results: manually, with your phone camera or fully automatically through a capture card.",
      "Verken alle 96 circuits, vergelijk tijden met de community en leg je Mario Kart 8 Deluxe-tijden vast: handmatig, met de camera van je telefoon of volledig automatisch via een capturekaart.",
    ))],
    aside: [el("div", "ds-home__facts", {},
      ...([
        ["96", localized("tracks", "circuits")],
        ["192", localized("leaderboards", "ranglijsten")],
        ["24", localized("cups", "bekers")],
        ["2", localized("engine classes", "motorklassen")],
      ] as const).map(([value, label]) => el("span", "ds-home__fact", {},
        el("span", "ds-data-l", {}, value), el("span", "ds-body-s", {}, label))))],
  });
  const cards = el("div", "ds-tiles", {},
    cardLink({
      href: POST_A_TIME_HREF, accent: true,
      title: localized("Post a Time Trial", "Plaats een Time Trial"),
      body: localized("Choose a track, then enter your result.", "Kies een circuit en voer je resultaat in."),
    }),
    cardLink({
      href: "/?cups=1",
      title: localized("Explore 96 tracks", "Verken 96 circuits"),
      body: localized("Leaderboards, WR and Nintendo ghosts.", "Klassementen, WR en Nintendo-spookritten."),
    }),
    cardLink({
      href: "/?build=1",
      title: localized("Build your kart", "Bouw je kart"),
      body: localized("Compare character, body, tyres and glider.", "Vergelijk personage, body, banden en zweefvleugel."),
    }),
    // Records and Community exist only on the web, so the phone's five-slot tab bar has nowhere to
    // put them. They were unreachable on a phone before the landing carried them.
    cardLink({
      href: "/?records=1",
      title: localized("Record book", "Recordboek"),
      body: localized("Every track record and who holds it.", "Elk circuitrecord en wie het houdt."),
    }),
    cardLink({
      href: "/?community=1",
      title: localized("Community", "Community"),
      body: localized("Players, rivals and groups.", "Spelers, rivalen en groepen."),
    }));
  const signIn = panel({
    title: localized("Sign in, or start racing with us", "Meld je aan, of begin met racen"),
    titleLevel: 2,
    children: [options.signInPanel],
  });
  const activity = el("div", "ds-home__feed", {});
  let signedOutModeFilter: ActivityModeFilter = "all";
  container.append(...(options.signInFirst
    ? [signIn, hero, cards, activity]
    : [hero, cards, signIn, activity]));
  root.append(container);

  const ready = (async (): Promise<void> => {
    activity.replaceChildren(panel({
      title: localized("Community activity", "Community-activiteit"),
      titleLevel: 2,
      children: [skeleton(4, localized("Loading community activity…", "Community-activiteit wordt geladen…"))],
    }));
    const stories = await loadStories(controller.signal).catch(() => [] as readonly ActivityStory[]);
    if (disposed) { return; }
    const paint = (): void => {
      const lang = productLanguage();
      const list = el("div", "ds-home__stories", {});
      const sections = limitActivityFeed(
        buildActivityFeed(stories, new Map<string, number>(), null,
          { scope: "all", mode: signedOutModeFilter }, { nowMs: now() }),
        5,
      );
      const items = [...sections.community, ...sections.action].slice(0, 5);
      for (const item of items) {
        const asset = trackAsset(item.story.trackId);
        const delta = activityResultDelta(item, null);
        const marks: (Node | string)[] = [];
        if (item.story.personalBest) { marks.push(chip(localized("PB", "PR"), "success")); }
        if (item.story.rank?.after !== undefined) {
          marks.push(chip(formatRank(item.story.rank.after, lang), "neutral"));
        }
        const card = storyCard({
          href: `/?leaderboard=${encodeURIComponent(item.story.trackId)}&mode=${item.story.mode}`,
          ...(asset === undefined ? {} : {
            art: { src: `${GAME_ASSET_BASE}${asset.previewPath}`, badge: `${GAME_ASSET_BASE}${asset.cup.iconPath}` },
          }),
          actor: item.story.player.displayName,
          where: asset?.name ?? item.story.trackId,
          context: [engineMark(item.story.mode, "plain")],
          marks,
          value: formatTime(item.story.bestMs),
          meta: relativeDate(item.story.latestAtMs, now()),
          ...(delta === undefined ? {} : { delta: {
            value: formatDelta(delta.milliseconds), direction: delta.direction,
            title: delta.milliseconds < 0
              ? localized("Faster than the previous personal best", "Sneller dan het vorige persoonlijk record")
              : delta.milliseconds > 0
                ? localized("Slower than the previous personal best", "Langzamer dan het vorige persoonlijk record")
                : localized("Equal to the previous personal best", "Gelijk aan het vorige persoonlijk record"),
          } }),
          ...(delta === undefined && item.story.personalBest ? { resultNote: {
            value: localized("First time", "Eerste tijd"),
            title: localized("No previous personal best to compare", "Geen vorig persoonlijk record om mee te vergelijken"),
          } } : {}),
        });
        bindActivityStorySummary(card, item, null, lang, now());
        list.append(card);
      }
      const modeControl = segmentedControl<ActivityModeFilter>({
        label: localized("Engine class filter", "Filter op motorklasse"),
        choices: [
          { value: "all", label: localized("All cc", "Alle cc") },
          { value: "150", label: "150cc" },
          { value: "200", label: "200cc" },
        ],
        value: signedOutModeFilter,
        onChange: (mode) => { signedOutModeFilter = mode; paint(); },
      });
      activity.replaceChildren(panel({
        title: localized("Community activity", "Community-activiteit"),
        titleLevel: 2,
        children: [
          modeControl.root,
          items.length === 0
            ? emptyState({ title: localized("No community sessions match this filter yet.", "Nog geen communitysessies voor dit filter.") })
            : list,
          el("p", "ds-body-s", {}, el("a", "ds-link", { href: "/?activity=1" },
            localized("All community activity →", "Alle community-activiteit →"))),
        ],
      }));
    };
    paint();
  })().catch(() => undefined);

  return {
    container,
    ready,
    engine: () => 150,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      controller.abort();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}

/** Unused import guard: formatDelta belongs to the delta cells the tiles build. */
void formatDelta;
