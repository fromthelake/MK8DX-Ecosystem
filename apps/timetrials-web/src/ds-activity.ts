// W16 Activity `/?activity` on the design system (Phase 12).
//
// LOW spectacle (DESIGN_SYSTEM §5): no art backdrop. The track thumbnails and the Players' own
// characters are the feed's data, and every number goes through `ds-numeric`.
//
// The page is the shared StoryCard feed: the same five groups, in the same order, with the same
// headings the APK and Home use, because they are built from the one `buildActivityFeed` model.
// Scope and engine are FilterChips over a FilterSummary that says what is applied; a session's runs,
// lap table, coins, mushrooms and combo open behind an A0 row action rather than a click anywhere on
// a `tabindex` list item; reactions stay exactly where they were.
//
// R3 (ENGINE_CONTEXT_INVENTORY §3) lands here and on Home: `activity-feed-contract.ts` is the one
// data contract. This route asks for the COMPLETE feed — dropping any queued Home copy first, so it
// can never be handed the preference-filtered one — and both surfaces print the same sentence about
// which engine classes are on screen and why.
import {
  button,
  chip,
  dataTable,
  disclosure,
  el,
  emptyState,
  engineMark,
  errorState,
  nextId,
  ownerDocument,
  panel,
  segmentedControl,
  skeleton,
  storyCard,
  youChip,
  type DataRow,
} from "./ds-components.js";
import { formatCount, formatDelta, formatRank, formatTime, type NumberLanguage } from "./ds-numeric.js";
import {
  ACTIVITY_ENGINES,
  ACTIVITY_SCOPES,
  appliedEngineFilter,
  describeEngineFilter,
  loadCompleteActivityStories,
  showHiddenEngineLabel,
  type EnginePreference,
} from "./activity-feed-contract.js";
import {
  activityLapCoinDeltas,
  activityLapMushroomValues,
  activityLoadoutValues,
  activityComparisonForViewer,
  activitySourcePresentation,
  orderStories,
  relativeDate,
  type ActivityStory,
} from "./activity-stories.js";
import {
  activityOutcome,
  activityResultDelta,
  bestsKey,
  buildActivityFeed,
  type ActivityFeedItem,
  type ActivityFilter,
  type ActivityModeFilter,
  type ActivityScopeFilter,
} from "./activity-feed-model.js";
import { GAME_ASSET_BASE, trackAsset } from "./asset-manifest.js";
import { createPlayerClaimClient } from "./player-claim-client.js";
import { createRivalClient } from "./rival-settings.js";
import { fetchTrackBests } from "./mastery-view.js";
import { mountReactionBar, type MountedReactionBar } from "./reaction-bar.js";
import { createReactionClient, type ReactionClient } from "./reaction-client.js";
import { readViewerEnginePreference } from "./engine-context.js";
import { localized, productLanguage } from "./product-language.js";
import { trackCurrency } from "./track-currency.js";
import { bindActivityStorySummary } from "./activity-story-summary.js";

export type MountedActivityStories = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

export type ActivityViewOptions = Readonly<{
  reactions?: ReactionClient;
  nowMs?: () => number;
  stories?: (signal?: AbortSignal) => Promise<readonly ActivityStory[]>;
  viewerBests?: Promise<ReadonlyMap<string, number>>;
  viewerPlayerId?: Promise<string | null>;
  rivalIds?: ReadonlySet<string> | Promise<ReadonlySet<string>>;
  followedIds?: ReadonlySet<string> | Promise<ReadonlySet<string>>;
  enginePreference?: Promise<EnginePreference>;
}>;

/** The five groups, their order and their headings — the same on both clients. */
const GROUPS: readonly (readonly [
  "action" | "rivals" | "attention" | "ownSessions" | "community", string, string,
])[] = [
  ["action", "Needs action", "Vraagt om actie"],
  ["rivals", "Rivals", "Rivalen"],
  ["attention", "Close behind", "Vlak achter je"],
  ["ownSessions", "My sessions", "Mijn sessies"],
  ["community", "Rest of the community", "Rest van de community"],
];

const trackName = (story: ActivityStory): string =>
  trackAsset(story.trackId)?.name ?? story.trackId;

export function mountActivityStories(
  root: HTMLElement,
  options: ActivityViewOptions = {},
): MountedActivityStories {
  const controller = new AbortController();
  const language = (): NumberLanguage => productLanguage();
  const now = options.nowMs ?? ((): number => new Date().getTime());
  const reactions = options.reactions ?? createReactionClient();
  const load = options.stories ?? ((signal?: AbortSignal) => loadCompleteActivityStories(signal));
  let disposed = false;

  const viewerPlayerId = options.viewerPlayerId ?? createPlayerClaimClient()
    .listMine(controller.signal)
    .then((claims) => claims.find((claim) => claim.claimStatus === "verified")?.playerId ?? null)
    .catch(() => null);
  const rivalIds = Promise.resolve(options.rivalIds ?? viewerPlayerId.then((playerId) =>
    playerId === null
      ? new Set<string>()
      : createRivalClient().list(controller.signal)
        .then((rivals) => new Set(rivals.map((rival) => rival.playerId))),
  )).catch(() => new Set<string>());
  const followedIds = Promise.resolve(options.followedIds ?? new Set<string>())
    .catch(() => new Set<string>());
  const viewerBests = options.viewerBests ?? viewerPlayerId
    .then((playerId) => playerId === null
      ? new Map<string, number>()
      : fetchTrackBests(playerId, controller.signal).then((bests) =>
        new Map(bests.map((best) => [bestsKey(best.trackId, best.mode), best.totalTimeMs]))))
    .catch(() => new Map<string, number>());
  // Only a signed-in reader has a saved preference. Asking for one before the viewer is known
  // spends a guaranteed 401 on every signed-out visit, which is exactly what the feed's own
  // viewer lookup was written to avoid.
  const enginePreference: Promise<EnginePreference> = (options.enginePreference
    ?? viewerPlayerId.then((playerId) => playerId === null
      ? "all" as EnginePreference
      : readViewerEnginePreference().then((value) => value ?? "all"))
  ).catch(() => "all" as EnginePreference);

  const container = el("div", "ds-root ds-activity ds-stack", { "data-spectacle": "low" });
  const heading = el("h1", "ds-title", {}, localized("Community activity", "Communityactiviteit"));
  const status = el("p", "ds-activity__status ds-micro", { role: "status", "aria-live": "polite" },
    localized("Loading community activity…", "Communityactiviteit wordt geladen…"));
  const controls = el("div", "ds-stack", { "data-gap": "sm" });
  const sections = el("div", "ds-stack", {});
  sections.append(skeleton(8, localized("Loading the feed…", "Het overzicht wordt geladen…")));
  container.append(heading, status, controls, sections);
  root.append(container);

  let filter: ActivityFilter = { scope: "all", mode: "all" };
  /** The reader asked to see the engine class the account preference hides. Never persisted (§7). */
  let engineOverride = false;

  const ready = Promise.all([
    load(controller.signal), followedIds, rivalIds, viewerBests, viewerPlayerId, enginePreference,
  ]).then(([stories, followed, rivals, bests, playerId, preference]) => {
    if (disposed) { return; }
    const ordered = orderStories(stories);
    const bars = new Map<string, MountedReactionBar>();

    // ---------------------------------------------------------------- one session
    const sessionCard = (item: ActivityFeedItem, nowValue: number): HTMLElement => {
      const story = item.story;
      const outcome = activityOutcome(item);
      const lang = language();
      const asset = trackAsset(story.trackId);
      const you = playerId !== null && story.player.playerId === playerId;
      const resultDelta = activityResultDelta(item, playerId);
      const marks: (Node | string)[] = [];
      if (story.personalBest) { marks.push(chip(localized("PB", "PR"), "success")); }
      if (story.rank?.after !== undefined) {
        marks.push(chip(formatRank(story.rank.after, lang), "neutral"));
      }
      if (followed.has(story.player.playerId)) {
        marks.push(chip(localized("Followed", "Gevolgd"), "info"));
      }
      if (story.runs > 1) {
        marks.push(chip(localized(`${formatCount(story.runs, lang)} runs`,
          `${formatCount(story.runs, lang)} runs`), "neutral"));
      }
      const card = storyCard({
        href: `/?leaderboard=${encodeURIComponent(story.trackId)}&mode=${story.mode}`,
        ...(asset === undefined ? {} : {
          art: { src: `${GAME_ASSET_BASE}${asset.previewPath}`, badge: `${GAME_ASSET_BASE}${asset.cup.iconPath}` },
        }),
        actor: story.player.displayName,
        where: trackName(story),
        context: [engineMark(story.mode, "plain")],
        marks,
        value: formatTime(story.bestMs),
        meta: relativeDate(story.latestAtMs, nowValue),
        ...(resultDelta === undefined ? {} : { delta: {
          value: formatDelta(resultDelta.milliseconds),
          direction: resultDelta.direction,
          title: resultDelta.basis === "viewer"
            ? resultDelta.milliseconds > 0
              ? localized("Your best is faster", "Jouw beste tijd is sneller")
              : resultDelta.milliseconds < 0
                ? localized("This run beat your best", "Deze tijd versloeg jouw beste tijd")
                : localized("Exactly equal to your best", "Precies gelijk aan jouw beste tijd")
            : resultDelta.milliseconds < 0
              ? localized("Faster than the previous personal best",
                "Sneller dan het vorige persoonlijk record")
              : resultDelta.milliseconds > 0
                ? localized("Slower than the previous personal best",
                  "Langzamer dan het vorige persoonlijk record")
                : localized("Equal to the previous personal best",
                  "Gelijk aan het vorige persoonlijk record"),
        } }),
        ...(resultDelta !== undefined ? { resultNote: {
          value: resultDelta.basis === "viewer"
            ? localized("vs you", "t.o.v. jou")
            : localized("vs previous PB", "t.o.v. vorig PR"),
          title: resultDelta.basis === "viewer"
            ? localized("Compared with your best time", "Vergeleken met jouw beste tijd")
            : localized("Compared with this player's previous personal best",
              "Vergeleken met het vorige persoonlijke record van deze speler"),
        } } : resultDelta === undefined && story.personalBest ? { resultNote: {
          value: localized("First time", "Eerste tijd"),
          title: localized("No previous personal best to compare",
            "Geen vorig persoonlijk record om mee te vergelijken"),
        } } : {}),
        you,
        outcome,
        ...(you ? { youLabel: localized("You", "Jij") } : {}),
      });
      bindActivityStorySummary(card, item, playerId, lang, nowValue);

      const under = el("div", "ds-activity__under", {});
      // Being overtaken is the one thing on this page that asks the reader to do something.
      if (story.viewerOvertake !== undefined) {
        under.append(el("p", "ds-activity__action", {},
          chip(localized("Overtaken", "Ingehaald"), "warning"),
          el("span", "ds-delta__value", { "data-direction": "slower" },
            formatDelta(Math.abs(story.viewerOvertake.deltaMs))),
          el("span", "", {}, localized(
            `You are #${formatCount(story.viewerOvertake.recipientRank, lang)} here now.`,
            `Je staat hier nu op #${formatCount(story.viewerOvertake.recipientRank, lang)}.`))));
      } else if (item.deltaMs !== undefined && item.relevance !== "own_pr" && item.relevance !== "own_run") {
        const own = bests.get(bestsKey(story.trackId, story.mode));
        const sentence = activityComparisonForViewer(
          story.player.playerId, playerId ?? undefined, story.player.displayName, story.bestMs, own);
        under.append(el("p", "ds-activity__gap", {},
          el("span", "ds-delta__value", {
            "data-direction": item.deltaMs < 0 ? "faster" : item.deltaMs > 0 ? "slower" : "even",
          }, formatDelta(item.deltaMs)),
          ...(sentence === null ? [] : [el("span", "", {}, sentence.text)])));
      }
      if (item.isReferenceRun) {
        under.append(el("p", "ds-activity__gap", {}, youChip(localized("Your reference time", "Jouw referentietijd"))));
      }

      // The session's own runs, lap table, coins, mushrooms and combo: an A0 row action, not a
      // click anywhere on the card (§15).
      // The runs of one session read as they always have: the fastest first as the cluster's head,
      // then the rest by time, each saying how far behind it was.
      const runs = [...story.runDetails].sort((left, right) => left.timeMs - right.timeMs);
      const fastest = runs[0]?.timeMs;
      const details = el("div", "ds-stack", { "data-gap": "md" });
      runs.forEach((run, index) => {
        details.append(runDetail(story, run, lang,
          index === 0 || fastest === undefined ? null : run.timeMs - fastest));
      });
      if (story.runDetails.length > 0) {
        under.append(disclosure({
          summary: localized(
            `Runs and laps (${formatCount(story.runDetails.length, lang)})`,
            `Runs en ronden (${formatCount(story.runDetails.length, lang)})`),
          children: [details],
        }));
      }

      const first = story.runDetails[0];
      if (first !== undefined) {
        const bar = mountReactionBar(ownerDocument(), first.resultId, reactions, controller.signal);
        bars.set(first.resultId, bar);
        under.append(bar.element);
      }

      const wrapper = el("div", "ds-activity__item", {}, card);
      if (under.children.length > 0) { wrapper.append(under); }
      return wrapper;
    };

    const runDetail = (
      story: ActivityStory, run: ActivityStory["runDetails"][number], lang: NumberLanguage,
      behindMs: number | null,
    ): HTMLElement => {
      const source = activitySourcePresentation(run.sourceKind);
      const head = el("p", "ds-activity__run-head", {},
        el("span", "ds-data", {}, formatTime(run.timeMs)),
        behindMs === null
          ? chip(localized("fastest", "snelste"), "success")
          : el("span", "ds-delta__value", { "data-direction": "slower" }, formatDelta(behindMs)),
        el("span", "ds-micro", {}, relativeDate(run.atMs, now())),
        chip(source.label, "neutral"));
      if (run.correctedFields !== undefined && run.correctedFields.length > 0) {
        head.append(chip(localized("Corrected", "Gecorrigeerd"), "info"));
      }
      const children: (Node | string)[] = [head];
      const laps = run.laps ?? [];
      if (laps.length > 0) {
        const coins = activityLapCoinDeltas(run.laps);
        const mushrooms = activityLapMushroomValues(run.laps);
        const currency = trackCurrency(story.trackId);
        children.push(dataTable({
          caption: localized(`Laps of a ${formatTime(run.timeMs)} run`,
            `Ronden van een run van ${formatTime(run.timeMs)}`),
          density: "dense",
          columns: [
            { key: "lap", label: localized("Lap", "Ronde"), align: "text" },
            { key: "time", label: localized("Time", "Tijd"), align: "num", phone: 1 },
            { key: "coins", label: currency.label, align: "num", phone: 2 },
            { key: "mushrooms", label: localized("Mushrooms", "Paddenstoelen"), align: "num", phone: 2 },
          ],
          rows: laps.map((lap, index): DataRow => ({
            key: `lap-${lap.lapNumber}`,
            cells: [
              formatCount(lap.lapNumber, lang),
              el("span", "ds-table__num-inner", {}, formatTime(lap.timeMs)),
              coins[index] === undefined
                ? el("span", "ds-missing", {}, "–")
                : formatDelta(coins[index]! * 1000).replace(/\.000$/, ""),
              mushrooms[index] === undefined
                ? el("span", "ds-missing", {}, "–")
                : formatCount(mushrooms[index]!, lang),
            ],
          })),
        }));
      } else {
        children.push(el("p", "ds-micro", {}, localized("No lap times recorded.", "Geen rondetijden vastgelegd.")));
      }
      const parts = activityLoadoutValues(run.loadout);
      const named = parts.filter(([, value]) => value !== undefined);
      children.push(named.length === 0
        ? el("p", "ds-micro", {}, localized("No combo recorded.", "Geen combo vastgelegd."))
        : el("p", "ds-activity__loadout", {}, ...named.map(([label, value]) =>
          el("span", "ds-activity__loadout-part", {},
            el("span", "ds-micro", {}, `${label} `), el("span", "", {}, value!)))));
      return el("div", "ds-activity__run", {}, ...children);
    };

    // ---------------------------------------------------------------- filters and painting
    const applied = (): ReturnType<typeof appliedEngineFilter> =>
      appliedEngineFilter(filter.mode, preference, engineOverride);

    const paint = (): void => {
      const lang = language();
      const feed = buildActivityFeed(ordered, bests, playerId, filter, {
        rivalPlayerIds: rivals, nowMs: now(),
      });
      const total = GROUPS.reduce((count, [key]) => count + feed[key].length, 0);
      if (stories.length === 0) {
        status.textContent = localized(
          "No recent community activity yet — be the first.",
          "Nog geen recente communityactiviteit — wees de eerste.");
      } else if (total === 0) {
        status.textContent = localized("Nothing matches this filter yet.", "Nog niets dat bij dit filter past.");
      } else {
        status.textContent = localized(
          `${formatCount(total, lang)} sessions · what matters to you, your sessions and the community`,
          `${formatCount(total, lang)} sessies · wat voor jou telt, jouw sessies en de community`);
      }
      const nowValue = now();
      const painted: HTMLElement[] = [];
      for (const [key, english, dutch] of GROUPS) {
        const items = feed[key];
        if (items.length === 0) { continue; }
        const list = el("div", "ds-activity__list", {});
        for (const item of items) { list.append(sessionCard(item, nowValue)); }
        // A signed-out visitor has no stake in any of it, so the groups carry no headings — the
        // same rule the model itself follows by putting everything in `community`.
        painted.push(playerId === null
          ? el("div", "ds-activity__group", {}, list)
          : panel({ title: localized(english, dutch), titleLevel: 2, children: [list] }));
      }
      sections.replaceChildren(...(painted.length === 0
        ? [emptyState({
          title: stories.length === 0
            ? localized("No recent community activity yet — be the first.",
              "Nog geen recente communityactiviteit — wees de eerste.")
            : localized("Nothing matches this filter yet.", "Nog niets dat bij dit filter past."),
        })]
        : painted));

      if (bars.size > 0) {
        reactions.summary([...bars.keys()].slice(0, 20), controller.signal).then((summaries) => {
          if (disposed) { return; }
          for (const summary of summaries) { bars.get(summary.resultId)?.apply(summary); }
        }).catch(() => undefined);
      }
    };

    const paintControls = (): void => {
      const scopes = ACTIVITY_SCOPES.filter((scope) =>
        (!scope.needsViewer || playerId !== null) && (!scope.needsRivals || rivals.size > 0));
      const scopeControl = segmentedControl<ActivityScopeFilter>({
        label: localized("Activity scope", "Activiteitsbereik"),
        choices: scopes.map((scope) => ({ value: scope.value, label: localized(scope.en, scope.nl) })),
        value: filter.scope,
        onChange: (value) => { filter = { ...filter, scope: value }; paint(); paintControls(); },
      });
      const engineControl = segmentedControl<ActivityModeFilter>({
        label: localized("Engine class", "Motorklasse"),
        choices: ACTIVITY_ENGINES.map((engine) => ({ value: engine.value, label: localized(engine.en, engine.nl) })),
        value: filter.mode,
        onChange: (value) => { filter = { ...filter, mode: value }; paint(); paintControls(); },
      });
      const state = applied();
      const summaryId = nextId("ds-activity-filter");
      const line = el("p", "ds-activity__applied ds-micro", { id: summaryId }, describeEngineFilter(state));
      const trailing: HTMLElement[] = [];
      // R3 + §7: a feed the account preference narrowed says so, and offers the same local,
      // unsaved override the rest of the product offers. The complete feed is already loaded here,
      // so nothing is re-fetched — the override only stops hiding it.
      if (state.source === "preference") {
        trailing.push(button({
          label: showHiddenEngineLabel(state), variant: "quiet", size: "sm",
          onPress: () => { engineOverride = true; paintControls(); paint(); },
        }).root);
      }
      controls.replaceChildren(
        el("div", "ds-cluster", { "data-gap": "sm" },
          el("span", "ds-micro", {}, localized("Scope", "Bereik")), scopeControl.root,
          el("span", "ds-micro", {}, localized("Engine class", "Motorklasse")), engineControl.root,
          ...trailing),
        line,
        el("p", "ds-activity__rank-note ds-micro", {}, localized(
          "# is the position when the run was published; a session without one is older activity with no saved position.",
          "# is de positie bij publicatie; een sessie zonder positie is oudere activiteit zonder opgeslagen positie.")),
      );
    };

    paintControls();
    paint();
  }).catch(() => {
    if (disposed) { return; }
    status.textContent = "";
    controls.replaceChildren();
    sections.replaceChildren(errorState({
      title: localized("Community activity is temporarily unavailable.",
        "Communityactiviteit is tijdelijk niet beschikbaar."),
    }));
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
