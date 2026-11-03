// W17 Tournaments list and W19/W20/W21 the night, on the design system (Phase 11).
//
// The list is MEDIUM spectacle (DESIGN_SYSTEM §5): an art strip, a section label per shelf, and one
// card per night carrying the shelf's meaning in its own words as well as in a chip. A night being
// raced is the page's one A4 — its LiveTag — because on a list of nights the reader's one thing is
// reading, not creating; the operator's "Create new tournament" therefore moves into the shell's
// context bar (SCREEN_MIGRATION_MATRIX W17), where running-the-night lives.
//
// A night is HIGH: the name in display type over the art of the track it drove most, and every
// standing — qualifier, final, live and the published report's index — drawn by one GroupBoard, so
// the four cannot drift. The Android twins (`AndroidTournamentOverview`, `AndroidTournamentNightScreen`,
// Phase 11) draw exactly these, and ADR-0199's link grammar is unchanged on both.
//
// Class C, untouched: scoring, standings, the group/stage structure, the 3-second live poll, the
// shelf rules and their clock, publication semantics and the paced request queue. This file changed
// how the night is drawn and nothing about what it says.

import {
  artHero,
  button,
  chip,
  disclosure,
  el,
  emptyState,
  errorState,
  groupBoard,
  liveTag,
  panel,
  sectionLabel,
  shareButton,
  statusMessage,
  tierChip,
  useDocument,
  winnerCard,
  type BoardRow,
} from "./ds-components.js";
import { type NumberLanguage } from "./ds-numeric.js";
import {
  publicTournamentCheckpoints,
  publicTournamentCurrentCheckpoint,
  formatTournamentDate,
  isHistoryEditionId,
  tournamentListShelf,
  tournamentOverdueDays,
  tournamentRowStatus,
  tournamentSeedTierKey,
  tournamentStageLabel,
  type MountedTournamentsView,
  type TournamentShelf,
} from "./tournaments-view.js";
import {
  publicTournamentWhatsAppText,
  stageExport,
} from "./public-tournament-whatsapp.js";
import {
  orderViewerNights,
  viewerStandingIn,
  viewerTournamentStanding,
  type ViewerTournamentStanding,
} from "./tournament-viewer-standing.js";
import { findSchema9WebTrack } from "./schema9-track-catalog.js";
import {
  mountTournamentStatistics,
  type StatisticsFilterKey,
  type StatisticsSortKey,
  type StatisticsViewState,
} from "./tournament-statistics-view.js";
import {
  createTournamentOperationClient,
  TournamentOperationClientError,
  type PublicTournamentEvent,
  type PublicTournamentSummary,
  type TournamentOperationClient,
} from "./tournament-operation-client.js";
import { tournamentGroupColour } from "./tournament-tiers.js";
import {
  loadTournamentExportIcons,
  renderTournamentExportImage,
  tournamentExportFileName,
  tournamentExportShareCaption,
  tournamentExportImageBlob,
  tournamentExportImageModel,
  tournamentExportMetric,
  tournamentExportSourceFromPublicEvent,
} from "./tournament-export-image.js";
import { localized, productLanguage } from "./product-language.js";
import { tournamentRaceClassLabel } from "./tournament-race-class.js";
import { tournamentCharacterIcon } from "./tournament-character.js";
import { readReportStage, renderTournamentReport, writeReportStage } from "./tournament-night-report-view.js";
import type { ReportStage } from "./tournament-report.js";
import { loadTournamentStories, tournamentStoryFor, tournamentStoryFromReport, type TournamentStory } from "./tournament-stories.js";
import { displayTournamentGroupLabel } from "./tournaments-view-labels.js";
import { renderTournamentStepProgress } from "./tournament-step-progress.js";
import { trackAsset, GAME_ASSET_BASE } from "./asset-manifest.js";
import {
  bindStartCountdown, formatTournamentStart, hasStartTime,
} from "./tournament-start-clock.js";
import { TournamentIncomingClient, type PublicTournamentLiveGroup } from "./tournament-incoming-client.js";
import { mountTournamentSignup, type MountedTournamentSignup } from "./tournament-signup-section.js";

export type { MountedTournamentsView } from "./tournaments-view.js";

const language = (): NumberLanguage => productLanguage();

/** The site's one group-colour definition; the group is always named in words beside it. */
function groupAccent(tierKey: string | undefined): string | undefined {
  return tournamentGroupColour(tierKey) ?? undefined;
}

function trackName(trackId: string | undefined): string {
  if (trackId === undefined) { return localized("track not recorded", "baan niet vastgelegd"); }
  return findSchema9WebTrack(trackId)?.displayName ?? trackId.replace(/^track\./, "").replace(/_/g, " ");
}

/** A Player's own page, by the one link grammar both clients use (ADR-0199). */
function playerLink(playerId: string | undefined, label: string): HTMLElement {
  return playerId === undefined
    ? el("span", "", {}, label)
    : el("a", "ds-tournaments__player", { href: `/?player=${encodeURIComponent(playerId)}` }, label);
}

/** " · 50cc" … " · Mirror" beside a race's track (ADR-0217); nothing when the class is not known. */
function raceClassSuffix(mode: number | undefined, mirror?: boolean): string {
  const label = tournamentRaceClassLabel(mode, mirror);
  return label === null ? "" : ` · ${label}`;
}

/** The SP-rank chip the WhatsApp picture colours a Player by — a tier chip, with its label on it. */
function seedChip(seedRank: number | undefined): HTMLElement {
  const key = tournamentSeedTierKey(seedRank);
  const colour = groupAccent(key);
  const label = seedRank === undefined ? "#?" : `#${seedRank}`;
  const node = colour === undefined ? chip(label) : tierChip(label, colour);
  node.setAttribute("title", "SP Rank");
  return node;
}

/** The character a Player drove, where a score workbook recorded one. */
function characterMark(character: Parameters<typeof tournamentCharacterIcon>[0]): HTMLElement | null {
  const icon = tournamentCharacterIcon(character);
  if (icon === null) { return null; }
  return el("img", "ds-board__face", {
    src: icon, alt: "", title: character?.label ?? "", loading: "lazy", decoding: "async", "aria-hidden": "true",
  });
}

/** The track a night drove most, as the backdrop its hero wears (§16: the canonical catalogue only). */
function nightBackdrop(event: PublicTournamentEvent): string | undefined {
  const counted = new Map<string, number>();
  for (const group of event.groups) {
    for (const race of group.races) {
      if (race.trackId === undefined) { continue; }
      counted.set(race.trackId, (counted.get(race.trackId) ?? 0) + 1);
    }
  }
  let best: string | undefined;
  let most = 0;
  for (const [trackId, count] of counted) { if (count > most) { most = count; best = trackId; } }
  if (best === undefined) { return undefined; }
  const asset = trackAsset(best);
  return asset === undefined ? undefined : `${GAME_ASSET_BASE}${asset.previewPath}`;
}

/** "Kwalificaties bezig · 36 spelers · 2026-09-08 · 8 races", the same line the phone prints. */
function nightOverview(event: PublicTournamentEvent): string {
  const races = event.groups.reduce((sum, group) => sum + group.races.length, 0);
  return [
    tournamentStageLabel(event.stage),
    localized(
      `${event.participantCount} player${event.participantCount === 1 ? "" : "s"}`,
      `${event.participantCount} speler${event.participantCount === 1 ? "" : "s"}`,
    ),
    event.eventDate ?? (event.finalizedAtMs === undefined
      ? ""
      : new Date(event.finalizedAtMs).toISOString().slice(0, 10)),
    races === 0 ? "" : `${races} races`,
  ].filter((part) => part.length > 0).join(" · ");
}

/**
 * The picture the night is at, shared from the page: the same checkpoint the Director exports at
 * Steps 4, 6, 8 and 10 (W35's night half). The renderer itself is untouched — OD-12 owns the
 * export's own look — and where a browser cannot share a file the text goes to the clipboard, which
 * is what the group chat got before this existed.
 */
function shareCheckpoint(document: Document, event: PublicTournamentEvent): HTMLElement | null {
  const current = publicTournamentCurrentCheckpoint(event);
  if (current === undefined) { return null; }
  const chosen = stageExport(event);
  const picture = async (): Promise<Blob | null> => {
    if (typeof document.createElement("canvas").getContext !== "function") { return null; }
    const icons = await loadTournamentExportIcons(document);
    const canvas = renderTournamentExportImage(
      document,
      tournamentExportImageModel(tournamentExportSourceFromPublicEvent(event), current.stage, current.mode),
      icons,
    );
    return canvas === null ? null : tournamentExportImageBlob(canvas);
  };
  return shareButton({
    label: localized(`Share: ${current.label}`, `Deel: ${current.label}`),
    onShare: (say) => { void (async () => {
      const blob = await picture().catch(() => null);
      const body = current === undefined
        ? publicTournamentWhatsAppText(event, chosen.stage, chosen.mode)
        : publicTournamentWhatsAppText(event, current.stage, current.mode);
      const file = blob === null
        ? null
        : new File([blob], tournamentExportFileName(event.name, current.stage, current.mode), { type: "image/png" });
      try {
        if (file !== null && globalThis.navigator.share !== undefined &&
          (globalThis.navigator.canShare === undefined || globalThis.navigator.canShare({ files: [file] }))) {
          await globalThis.navigator.share({
            title: event.name,
            text: tournamentExportShareCaption(
              tournamentExportSourceFromPublicEvent(event), current.stage, current.mode),
            files: [file],
          });
          return;
        }
        await globalThis.navigator.clipboard.writeText(body);
        say(file === null
          ? localized("Copied.", "Gekopieerd.")
          : localized("Sharing a picture is unsupported here; the text was copied.",
            "Een afbeelding delen kan hier niet; de tekst is gekopieerd."));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          say(localized("Could not share.", "Delen is niet gelukt."));
        }
      }
    })(); },
  });
}

/** Where the reader sits, as the group chat asks it: which group, whose Switch, which seat, who beside. */
function seatLine(
  standing: Extract<ViewerTournamentStanding, { kind: "participating" }>,
): HTMLElement {
  const line = el("p", "ds-tournaments__seat", {});
  if (standing.groupName === undefined && standing.station === undefined) {
    line.append(localized(
      "You are on the list · the Director has not made the groups yet",
      "Je staat op de lijst · de Directeur heeft de groepen nog niet gemaakt",
    ));
    return line;
  }
  let written = false;
  const separator = (): void => {
    if (!written) { written = true; return; }
    line.append(el("span", "ds-tournaments__dot", { "aria-hidden": "true" }, "·"));
  };
  if (standing.groupName !== undefined) {
    separator();
    line.append(el("span", "", {}, standing.groupName));
  }
  if (standing.station !== undefined) {
    separator();
    const marker = standing.station.switchType === "ns2" ? "[NS2]" : "[NS1]";
    const owner = playerLink(standing.station.ownerPlayerId, standing.station.ownerDisplayName);
    // One phrase in its own box: the line is a flex row, and its gap would otherwise open between
    // the name and the "'s Switch" that belongs to it. Two orders for one fact: English puts the
    // owner first, Dutch last.
    const console_ = el("span", "ds-tournaments__console", {});
    if (productLanguage() === "nl") {
      console_.append(`${marker} Switch van `, owner);
    } else {
      console_.append(`${marker} `, owner, "’s Switch");
    }
    line.append(console_);
    separator();
    line.append(el("span", "", {}, localized(
      `seat #${standing.station.seatNumber}`, `plek #${standing.station.seatNumber}`)));
  }
  separator();
  line.append(el("span", "", {}, localized("you", "jij")), " ", seedChip(standing.seedRank));
  if (standing.seatMates.length > 0) {
    line.append(localized(" next to ", " naast "));
    standing.seatMates.forEach((mate, index) => {
      if (index > 0) { line.append(", "); }
      line.append(playerLink(mate.playerId, mate.displayName), " ", seedChip(mate.seedRank));
    });
  }
  return line;
}

/** How the night is going, once it has started scoring. */
function resultLine(
  standing: Extract<ViewerTournamentStanding, { kind: "participating" }>,
): string | null {
  const result = standing.result;
  if (result === undefined) { return null; }
  if (result.placement !== undefined && result.of !== undefined) {
    return localized(
      `You finished ${result.placement} of ${result.of}`,
      `Jij werd ${result.placement}e van ${result.of}`,
    );
  }
  const sofar = localized(
    `${result.points} points from ${result.races} race${result.races === 1 ? "" : "s"}${result.wins > 0 ? `, ${result.wins} win${result.wins === 1 ? "" : "s"}` : ""}`,
    `${result.points} punten uit ${result.races} race${result.races === 1 ? "" : "s"}${result.wins > 0 ? `, ${result.wins} overwinning${result.wins === 1 ? "" : "en"}` : ""}`,
  );
  const inGroup = localized(
    `${result.groupRank} of ${result.groupSize} in ${standing.groupName ?? "your group"}`,
    `${result.groupRank}e van ${result.groupSize} in ${standing.groupName ?? "je groep"}`,
  );
  return [inGroup, sofar].join(" · ");
}

const ARCHIVE_PLACEMENT_LIMIT = 8;

/** The shelves, in the order the page stacks them, with the words each one owns. */
const SHELVES: readonly Readonly<{ key: TournamentShelf; title: () => string; note?: () => string }>[] = [
  { key: "running", title: () => localized("In progress", "Bezig") },
  { key: "soon", title: () => localized("Coming up", "Binnenkort") },
  { key: "draft", title: () => localized("Being prepared", "In aanmaak") },
  { key: "stalled", title: () => localized("Not finished", "Niet afgerond") },
  { key: "finished", title: () => localized("Finished", "Afgerond") },
  {
    key: "unpublished",
    title: () => localized("Not published", "Niet gepubliceerd"),
    note: () => localized(
      "Finished, and only you can see them. Open one to publish it - or to take it back.",
      "Afgerond, en alleen jij ziet ze. Open er een om hem te publiceren - of weer terug te halen."),
  },
];

export function mountTournamentsList(
  root: HTMLElement,
  client: TournamentOperationClient = createTournamentOperationClient(),
  // `operator` is a delegated Tournament operator: not an administrator, but exactly the person who
  // runs a race night.
  options: Readonly<{
    administrator?: boolean;
    /**
     * How long to leave between this page's own follow-up requests. The host allows about five a
     * second from one address; a test that drives this with a fake client sets it to zero.
     */
    requestGapMs?: number;
    operator?: boolean;
    /** Who is looking, so the page can answer "am I in this?" at all. */
    viewerPlayerId?: string | null;
    /** The shell's context bar: where running the night lives (W17). */
    onContextBar?: (node: HTMLElement | null) => void;
    /** "Request to host" for a signed-in non-Director (ADR-0220), below the nights. */
    hostRequestRoot?: HTMLElement;
  }> = {},
): MountedTournamentsView {
  const document = root.ownerDocument;
  useDocument(document);
  const controller = new AbortController();
  let disposed = false;
  /** The ticking countdowns on the cards, stopped when the view is unmounted. */
  const rowCountdowns: (() => void)[] = [];
  const container = el("div", "ds-root ds-tournaments ds-stack", { "data-spectacle": "medium" });
  const heading = el("h1", "ds-visually-hidden", { id: "tournaments-heading" },
    localized("Tournaments", "Toernooien"));
  const overview = el("p", "ds-tournaments__overview ds-micro", { role: "status" },
    localized("Loading tournaments…", "Toernooien laden…"));
  const hero = artHero({
    spectacle: "medium",
    titleStep: "display-3",
    titleLevel: 2,
    title: localized("Tournaments", "Toernooien"),
    children: [
      el("p", "ds-tournaments__lede", {}, localized(
        "Tournament nights, groups, races and results.",
        "Toernooiavonden, groepen, races en uitslagen.")),
      overview,
    ],
  });
  // Where a Player's own answer goes: above the list of everyone's nights, because "am I racing
  // tonight?" is the question they came with.
  const standingRoot = el("div", "ds-tournaments__you", {});
  standingRoot.hidden = true;
  const shelves = new Map<TournamentShelf, Readonly<{ section: HTMLElement; list: HTMLElement }>>();
  const shelfRoot = el("div", "ds-stack", {});
  for (const shelf of SHELVES) {
    const list = el("ol", "ds-tournaments__list", {});
    const section = el("section", "ds-tournaments__shelf ds-stack", { "data-shelf": shelf.key, "data-gap": "md" },
      sectionLabel({ text: shelf.title(), ...(shelf.note === undefined ? {} : { note: shelf.note() }) }), list);
    section.hidden = true;
    shelves.set(shelf.key, { section, list });
    shelfRoot.append(section);
  }
  // A night that was removed is below everything and folded shut: years of tries and typos live
  // here — a drawer you open when you are looking for one of them, not a list to scroll past.
  const removedList = el("ol", "ds-tournaments__list", {});
  const removedSection = el("section", "ds-tournaments__shelf", { "data-shelf": "removed" });
  removedSection.hidden = true;
  const statisticsRoot = el("div", "ds-tournaments__statistics", {});
  const mobileCreate = options.administrator === true || options.operator === true
    ? button({
      label: localized("Create new tournament", "Nieuw toernooi maken"),
      variant: "secondary", href: "/?tournaments=1&operate=1",
    }).root
    : null;
  mobileCreate?.classList.add("ds-tournaments__mobile-create");
  container.append(heading, hero);
  if (mobileCreate !== null) { container.append(mobileCreate); }
  container.append(standingRoot, shelfRoot, removedSection);
  if (options.hostRequestRoot !== undefined) { container.append(options.hostRequestRoot); }
  container.append(statisticsRoot);
  root.append(container);

  /**
   * One queue for everything this page asks for after its list. The host allows about five dynamic
   * requests a second from one address; a tripped request is a section that never renders.
   */
  const PAGE_REQUEST_GAP_MS = options.requestGapMs ?? 220;
  let queued: Promise<unknown> = Promise.resolve();
  const paced = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queued.then(async () => {
      if (disposed) { return undefined as T; }
      const answer = await task();
      await new Promise((resolve) => { setTimeout(resolve, PAGE_REQUEST_GAP_MS); });
      return answer;
    });
    queued = next.catch(() => undefined);
    return next;
  };

  // The statistics panel's own view, read from the address and written back to it (W18's link
  // grammar, unchanged): `stats_` keeps them apart from the Ranking's `f_` filters.
  const STATISTICS_FILTER_PARAMETERS: ReadonlyArray<readonly [StatisticsFilterKey, string]> = [
    ["track", "stats_track"],
    ["cup", "stats_cup"],
    ["races", "stats_races"],
    ["players", "stats_players"],
    ["nights", "stats_nights"],
  ];
  const STATISTICS_SORT_NAMES: Readonly<Record<StatisticsSortKey, string>> = {
    track: "track", cup: "cup", races: "races", players: "players",
    nights: "nights", ghost: "ghost", time: "time", best: "best",
  };
  const statisticsView = document.defaultView ?? null;
  const readStatisticsLink = (): StatisticsViewState => {
    const query = new URLSearchParams(statisticsView?.location?.search ?? "");
    const filters: Partial<Record<StatisticsFilterKey, string>> = {};
    for (const [key, name] of STATISTICS_FILTER_PARAMETERS) {
      const value = query.get(name);
      if (value !== null && value.trim() !== "") { filters[key] = value.slice(0, 40); }
    }
    const sortName = query.get("stats_sort");
    const sort = (Object.keys(STATISTICS_SORT_NAMES) as StatisticsSortKey[])
      .find((key) => STATISTICS_SORT_NAMES[key] === sortName) ?? null;
    const direction = query.get("stats_dir");
    const focused = query.get("stats_focus");
    const focus = focused !== null && /^track\.[a-z0-9_]{2,150}$/.test(focused) ? focused : null;
    return { sort: sort ?? "races", descending: direction === "asc" ? false : true, filters, focus };
  };
  const writeStatisticsLink = (state: StatisticsViewState): void => {
    if (statisticsView?.location === undefined || statisticsView.history === undefined) { return; }
    const query = new URLSearchParams(statisticsView.location.search);
    query.set("tournaments", query.get("tournaments") ?? "1");
    const set = (name: string, value: string | null): void => {
      if (value === null || value === "") { query.delete(name); } else { query.set(name, value); }
    };
    query.delete("stats");
    set("stats_sort", state.sort === "races" ? null : STATISTICS_SORT_NAMES[state.sort]);
    set("stats_dir", state.descending ? null : "asc");
    set("stats_focus", state.focus);
    for (const [key, name] of STATISTICS_FILTER_PARAMETERS) { set(name, state.filters[key] ?? null); }
    try {
      statisticsView.history.replaceState(statisticsView.history.state, "", `/?${query.toString()}`);
    } catch { /* a view without history simply has no shareable address */ }
  };
  let statisticsState = readStatisticsLink();
  const statisticsAsked = (() => {
    const query = new URLSearchParams(statisticsView?.location?.search ?? "");
    return query.get("stats") === "open" || query.get("stats_sort") !== null ||
      query.get("stats_focus") !== null ||
      STATISTICS_FILTER_PARAMETERS.some(([, name]) => query.get(name) !== null);
  })();
  const mountedStatistics = mountTournamentStatistics(statisticsRoot, undefined, {
    initial: statisticsState,
    viewerPlayerId: options.viewerPlayerId ?? null,
    scrollIntoView: statisticsAsked,
    pace: (task) => paced(task),
    onStateChange: (state) => { statisticsState = state; writeStatisticsLink(state); },
    shareLink: () => { writeStatisticsLink(statisticsState); return statisticsView?.location?.href ?? ""; },
  });

  const itemsById = new Map<string, HTMLElement>();
  const events = new Map<string, PublicTournamentEvent>();
  const readEvent = async (tournamentId: string): Promise<PublicTournamentEvent | null> => {
    const known = events.get(tournamentId);
    if (known !== undefined) { return known; }
    try {
      const event = await paced(() => client.loadPublic(tournamentId, controller.signal));
      if (event === undefined) { return null; }
      events.set(tournamentId, event);
      return event;
    } catch {
      return null;   // a night whose document cannot be read simply does not answer
    }
  };

  /** What the reader took away from finished nights, painted together after one compact request. */
  const paintViewerPlacements = async (summaries: readonly PublicTournamentSummary[]): Promise<void> => {
    const viewer = options.viewerPlayerId ?? null;
    if (viewer === null) { return; }
    const wanted = summaries
      .filter((summary) => summary.stage === "finalized" && summary.viewerParticipated === true)
      .slice(0, ARCHIVE_PLACEMENT_LIMIT);
    const snapshots = new Map<string, Readonly<{
      fieldSize: number; placements: readonly Readonly<{ playerId: string; placement: number }>[];
    }>>();
    for (const summary of wanted) {
      const event = events.get(summary.tournamentId);
      if (event !== undefined) {
        snapshots.set(summary.tournamentId, { fieldSize: event.overall.length, placements: event.overall.flatMap(
          (entry) => entry.playerId === undefined ? [] : [{ playerId: entry.playerId, placement: entry.placement }],
        ) });
      }
    }
    const missing = wanted.filter((summary) => !snapshots.has(summary.tournamentId));
    if (missing.length > 0) {
      try {
        if (client.loadPublicPlacements !== undefined) {
          const loaded = await paced(() => client.loadPublicPlacements!(
            missing.map((summary) => summary.tournamentId), controller.signal));
          for (const snapshot of loaded) { snapshots.set(snapshot.tournamentId, snapshot); }
        } else {
          const loaded = await Promise.all(missing.map(async (summary) => ({
            tournamentId: summary.tournamentId, event: await readEvent(summary.tournamentId),
          })));
          for (const value of loaded) {
            if (value.event !== null) {
              snapshots.set(value.tournamentId, {
                fieldSize: value.event.overall.length,
                placements: value.event.overall.flatMap((entry) => entry.playerId === undefined
                  ? [] : [{ playerId: entry.playerId, placement: entry.placement }]),
              });
            }
          }
        }
      } catch { return; }
    }
    if (disposed) { return; }
    for (const summary of wanted) {
      const snapshot = snapshots.get(summary.tournamentId);
      const placement = snapshot?.placements.find((entry) => entry.playerId === viewer);
      if (snapshot === undefined || placement === undefined) { continue; }
      const marker = itemsById.get(summary.tournamentId)?.querySelector(".ds-tournaments__mine");
      if (marker === null || marker === undefined) { continue; }
      marker.textContent = localized(
        `You finished ${placement.placement} of ${snapshot.fieldSize}`,
        `Jij werd ${placement.placement}e van ${snapshot.fieldSize}`,
      );
    }
  };

  /**
   * One night, drawn full: its name, when it is, how far it is and what can be done with it. A
   * night being raced wears this card, and so does the reader's own night, each on its own shelf.
   */
  const nightCard = (
    summary: PublicTournamentSummary,
    standing: Extract<ViewerTournamentStanding, { kind: "participating" }> | null,
  ): HTMLElement => {
    const start = summary.startAtMs;
    const ahead = start !== undefined && start > Date.now();
    const late = tournamentOverdueDays(summary);
    const name = summary.editionNumber === undefined
      ? summary.name
      : `TN${summary.editionNumber} · ${summary.name}`;
    const marks: HTMLElement[] = [];
    // The one filled thing on the page: a night that is being raced (§4, the list's A4).
    if (tournamentListShelf(summary) === "running") {
      marks.push(liveTag(localized("Live", "Bezig")));
    }
    if (standing !== null) {
      marks.push(chip(localized("Your tournament", "Jouw toernooi"), ahead ? "warning" : "info"));
    }
    if (late !== null) {
      marks.push(chip(localized(
        `Overdue · ${late} day${late === 1 ? "" : "s"}`,
        `Over tijd · ${late} ${late === 1 ? "dag" : "dagen"}`), "error"));
    }
    const body: (Node | string | null)[] = [];
    const when = start === undefined
      ? summary.eventDate === undefined ? null : formatTournamentDate(summary.eventDate)
      : formatTournamentStart(start, summary.timezone);
    if (when !== null && when.length > 0) {
      const whenLine = el("p", "ds-tournaments__when", {}, when);
      if (start !== undefined && ahead && hasStartTime(start, summary.timezone)) {
        const clock = el("span", "ds-tournaments__clock ds-data", { role: "timer" });
        rowCountdowns.push(bindStartCountdown(clock, start));
        whenLine.append(" ", clock);
      }
      body.push(whenLine);
    }
    body.push(el("p", "ds-tournaments__meta ds-micro", {}, [
      localized(
        `${summary.participantCount} player${summary.participantCount === 1 ? "" : "s"}`,
        `${summary.participantCount} speler${summary.participantCount === 1 ? "" : "s"}`),
      summary.directorDisplayName === undefined
        ? ""
        : localized(`Director: ${summary.directorDisplayName}`, `Directeur: ${summary.directorDisplayName}`),
    ].filter((part) => part.length > 0).join(" · ")));
    // Where the reader sits, and how their night is going. Only theirs has this.
    if (standing !== null) {
      body.push(seatLine(standing));
      const result = resultLine(standing);
      if (result !== null) { body.push(el("p", "ds-tournaments__result", {}, result)); }
    }
    const event = events.get(summary.tournamentId);
    if (summary.workflowStep !== undefined) {
      body.push(renderTournamentStepProgress(document, summary.workflowStep, event));
    }
    const actions = el("div", "ds-tournaments__actions", {},
      button({
        label: localized("View this tournament", "Toernooi bekijken"),
        variant: "secondary",
        href: `/?tournaments=${encodeURIComponent(summary.tournamentId)}`,
      }).root);
    // The layout and the results are the two things that get pasted into the group chat all night;
    // a participant no longer waits for the Director to do it.
    if (event !== undefined) {
      const share = shareCheckpoint(document, event);
      if (share !== null) { actions.append(share); }
    }
    if (options.administrator === true || options.operator === true) {
      actions.append(button({
        label: localized("Edit this tournament", "Toernooi bewerken"),
        variant: "quiet",
        href: `/?tournaments=${encodeURIComponent(summary.tournamentId)}&operate=1`,
      }).root);
    }
    body.push(actions);
    return panel({
      title: name,
      titleLevel: 3,
      actions: marks,
      children: body,
    });
  };

  /** Which nights get a card: every night being raced, and the one that is the reader's own. */
  const paintNightCards = async (summaries: readonly PublicTournamentSummary[]): Promise<void> => {
    const now = Date.now();
    const carded = summaries.filter((summary) => tournamentListShelf(summary, now) === "running");
    const viewer = options.viewerPlayerId ?? null;
    let standing: ViewerTournamentStanding | null = null;
    if (viewer !== null) {
      const played = summaries.filter((summary) => summary.viewerParticipated === true);
      const live = orderViewerNights(played.filter((summary) => summary.stage !== "finalized"));
      // Android falls back to the latest finished night when the reader has nothing active. That
      // is why the archive opens with one useful "Your tournament" card instead of a wall of rows.
      const candidates = live.length > 0 ? live.slice(0, 2) : orderViewerNights(played).slice(0, 1);
      for (const summary of candidates) {
        await readEvent(summary.tournamentId);
        if (disposed) { return; }
      }
      if (live.length > 0) {
        standing = viewerTournamentStanding(candidates, events, viewer);
      } else {
        const candidate = candidates[0];
        const event = candidate === undefined ? undefined : events.get(candidate.tournamentId);
        standing = event === undefined ? null : viewerStandingIn(event, viewer);
      }
      if (standing !== null && standing.kind !== "participating") { standing = null; }
    }
    const mine = standing !== null && standing.kind === "participating" ? standing : null;
    const ids = new Set(carded.map((summary) => summary.tournamentId));
    if (mine !== null) { ids.add(mine.tournamentId); }
    for (const id of ids) {
      await readEvent(id);
      if (disposed) { return; }
    }
    if (viewer !== null && mine === null &&
        summaries.every((summary) => summary.viewerParticipated !== true)) {
      // Not a card and not a shelf: one quiet line, because a Player who has never been asked
      // should be told so rather than left to count rows.
      standingRoot.replaceChildren(el("p", "ds-tournaments__none ds-micro", {}, localized(
        "You have not been invited to a tournament yet.",
        "Je bent nog niet uitgenodigd voor een toernooi.")));
      standingRoot.hidden = false;
    }
    for (const summary of summaries) {
      if (!ids.has(summary.tournamentId)) { continue; }
      const item = itemsById.get(summary.tournamentId);
      if (item === undefined) { continue; }
      item.replaceChildren(nightCard(
        summary, mine !== null && mine.tournamentId === summary.tournamentId ? mine : null));
      item.setAttribute("data-card", "");
    }
  };

  const ready = client.listPublic(controller.signal).then((tournaments) => {
    if (disposed) { return; }
    if (tournaments.length === 0) {
      overview.textContent = "";
      container.append(emptyState({
        title: localized("No tournaments yet", "Nog geen toernooien"),
        body: localized(
          "The first tournament night will appear here with its groups, races and results.",
          "De eerste toernooiavond verschijnt hier met groepen, races en uitslagen."),
      }));
      return;
    }
    const shelved = tournaments.map((entry) => tournamentListShelf(entry));
    const count = (shelf: TournamentShelf): number => shelved.filter((entry) => entry === shelf).length;
    const removed = count("removed");
    const countLine = (shelf: TournamentShelf): string => {
      const total = count(shelf);
      if (total === 0 && shelf !== "finished") { return ""; }
      switch (shelf) {
        case "running": return localized(
          `${total} tournament${total === 1 ? "" : "s"} in progress`,
          `${total} toernooi${total === 1 ? "" : "en"} bezig`);
        case "soon": return localized(`${total} coming up`, `${total} binnenkort`);
        case "draft": return localized(`${total} being prepared`, `${total} in aanmaak`);
        case "stalled": return localized(`${total} not finished`, `${total} niet afgerond`);
        case "unpublished": return localized(`${total} not published`, `${total} niet gepubliceerd`);
        case "removed": return localized(`${total} removed`, `${total} verwijderd`);
        default: return localized(`${total} finished`, `${total} afgerond`);
      }
    };
    // The installed app puts removed before the public archive total. Keep that scanning order on
    // the Web too even though the removed records themselves stay folded below the shelves.
    overview.textContent = ["running", "soon", "draft", "stalled", "unpublished", "removed", "finished"]
      .map((shelf) => countLine(shelf as TournamentShelf))
      .filter((part) => part.length > 0).join(" · ");
    for (const shelf of SHELVES) {
      const node = shelves.get(shelf.key);
      if (node !== undefined) { node.section.hidden = count(shelf.key) === 0; }
    }
    // A reader looks for the night that is closest to them: the next one to be raced, or the last
    // one that was. The list arrives oldest first, which put a night from 2023 at the top.
    const when = (entry: PublicTournamentSummary): number =>
      entry.eventDate === undefined
        ? entry.finalizedAtMs ?? entry.updatedAtMs
        : Date.parse(`${entry.eventDate}T12:00:00Z`);
    const ordered = [...tournaments].sort((left, right) => {
      const leftDone = left.stage === "finalized";
      if (leftDone !== (right.stage === "finalized")) { return leftDone ? 1 : -1; }
      return leftDone ? when(right) - when(left) : when(left) - when(right);
    });
    for (const entry of ordered) {
      const shelf = tournamentListShelf(entry);
      const item = el("li", "ds-tournaments__item", { "data-shelf": shelf });
      itemsById.set(entry.tournamentId, item);
      const title = entry.editionNumber === undefined
        ? entry.name
        : `TN${entry.editionNumber} · ${entry.name}`;
      const link = el("a", "ds-tournaments__row", { href: `/?tournaments=${encodeURIComponent(entry.tournamentId)}` });
      const head = el("span", "ds-tournaments__row-head", {}, el("span", "ds-tournaments__row-title", { title }, title));
      if (shelf === "running") { head.append(liveTag(localized("Live", "Bezig"))); }
      // The server answers "did I race in this one?" for every night in the list, so an older
      // edition is marked as surely as a recent one.
      if (entry.viewerParticipated === true) {
        head.append(el("span", "ds-tournaments__mine", {}, entry.stage === "finalized"
          ? localized("You raced in this one", "Jij reed mee")
          : localized("You are in this one", "Jij doet mee")));
        item.setAttribute("data-kind", "you");
      }
      const status = tournamentRowStatus(entry, shelf);
      // A night still to come says when it starts; the day is already in that.
      const date = shelf === "soon" && entry.startAtMs !== undefined
        ? ""
        : formatTournamentDate(entry.eventDate, entry.finalizedAtMs);
      const meta = el("span", "ds-tournaments__row-meta ds-tournaments__row-meta--desktop ds-micro", {}, [
        status,
        localized(
          `${entry.participantCount} player${entry.participantCount === 1 ? "" : "s"}`,
          `${entry.participantCount} speler${entry.participantCount === 1 ? "" : "s"}`),
        date,
        entry.directorDisplayName === undefined
          ? ""
          : localized(`Director: ${entry.directorDisplayName}`, `Directeur: ${entry.directorDisplayName}`),
      ].filter((part) => part.length > 0).join(" · "));
      // Android deliberately keeps list rows terse: numeric event date, no Director. The richer
      // desktop line remains available above the phone breakpoint.
      const mobileMeta = el("span", "ds-tournaments__row-meta ds-tournaments__row-meta--phone ds-micro", {}, [
        status,
        localized(
          `${entry.participantCount} player${entry.participantCount === 1 ? "" : "s"}`,
          `${entry.participantCount} speler${entry.participantCount === 1 ? "" : "s"}`),
        shelf === "soon" && entry.startAtMs !== undefined ? "" : entry.eventDate ?? "",
      ].filter((part) => part.length > 0).join(" · "));
      // The clock belongs on the row too: a signed-out visitor has no card to read it from.
      if (shelf === "soon" && entry.startAtMs !== undefined && hasStartTime(entry.startAtMs, entry.timezone)) {
        const clock = el("span", "ds-tournaments__clock ds-data", { role: "timer" });
        rowCountdowns.push(bindStartCountdown(clock, entry.startAtMs));
        meta.append(" ", clock);
      }
      const late = tournamentOverdueDays(entry);
      const chips = el("span", "ds-tournaments__row-chips", {});
      if (late !== null) {
        chips.append(chip(localized(
          `Overdue · ${late} day${late === 1 ? "" : "s"}`,
          `Over tijd · ${late} ${late === 1 ? "dag" : "dagen"}`), "error"));
      }
      if (shelf === "removed") {
        chips.append(chip(localized("Removed", "Verwijderd"), "error"),
          el("code", "ds-tournaments__id", {}, entry.tournamentId));
      }
      if (shelf === "unpublished") {
        chips.append(chip(localized("Not public", "Niet openbaar")));
        chips.append(chip(entry.affectsRating === false
          ? localized("Not in the ranking", "Telt niet voor de ranglijst")
          : localized("Counted in the ranking", "Telt voor de ranglijst"),
        entry.affectsRating === false ? "neutral" : "info"));
      }
      link.append(head, meta, mobileMeta);
      if (chips.childElementCount > 0) { link.append(chips); }
      item.append(link);
      if (shelf === "removed") {
        // Restoring one is done by id in the Administration section, and nothing else prints it.
        item.append(button({
          label: localized("Restore in Administration", "Herstellen in Beheer"),
          variant: "quiet", href: "/?admin=1#tournament-removal-heading",
        }).root);
      } else if (shelf === "unpublished" ||
        ((options.administrator === true || options.operator === true) && !isHistoryEditionId(entry.tournamentId))) {
        const mobileEdit = button({
          label: localized("Edit", "Bewerken"),
          variant: "secondary", href: `/?tournaments=${encodeURIComponent(entry.tournamentId)}&operate=1`,
        }).root;
        mobileEdit.classList.add("ds-tournaments__edit-mobile");
        const desktopEdit = button({
          label: localized("Edit this tournament", "Toernooi bewerken"),
          variant: "quiet", href: `/?tournaments=${encodeURIComponent(entry.tournamentId)}&operate=1`,
        }).root;
        desktopEdit.classList.add("ds-tournaments__edit-desktop");
        item.append(mobileEdit, desktopEdit);
      }
      (shelf === "removed" ? removedList : shelves.get(shelf)!.list).append(item);
    }
    if (removed > 0) {
      removedSection.hidden = false;
      removedSection.replaceChildren(disclosure({
        summary: localized(
          `Removed · ${removed} night${removed === 1 ? "" : "s"}`,
          `Verwijderd · ${removed} ${removed === 1 ? "avond" : "avonden"}`),
        children: [
          el("p", "ds-tournaments__note ds-micro", {}, localized(
            "Out of the lists, the results and the ranking - the record survives. Only you see these.",
            "Uit de lijsten, de uitslagen en de ranglijst - het dossier blijft bestaan. Alleen jij ziet deze.")),
          removedList,
        ],
      }));
    }
    // The list is on the page; the reader's own answers follow it, one night at a time.
    void paintNightCards(tournaments).then(() => paintViewerPlacements(ordered));
  }).catch((error: unknown) => {
    if (disposed) { return; }
    overview.textContent = "";
    container.append(error instanceof TournamentOperationClientError && error.code === "not_authorized"
      ? errorState({
        title: localized("Sign in to see tournaments.", "Meld je aan om toernooien te bekijken."),
      })
      : errorState({
        title: localized("Tournaments are temporarily unavailable.", "Toernooien zijn tijdelijk niet beschikbaar."),
      }));
  });

  // Running the night is the operator's own door, and on a list of nights the reader's one thing is
  // reading. It goes in the shell's context bar, which is where a role, not a page, is answered.
  if (options.administrator === true || options.operator === true) {
    const bar = el("div", "ds-root ds-context-bar__line ds-tournaments__context", { "data-mode": "race-direction" },
      el("span", "ds-micro", {}, localized("Race direction", "Wedstrijdleiding")),
      button({
        label: localized("Create new tournament", "Nieuw toernooi maken"),
        variant: "secondary", size: "sm", href: "/?tournaments=1&operate=1",
      }).root);
    options.onContextBar?.(bar);
  }

  return {
    container,
    ready,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      mountedStatistics.unmount();
      for (const stop of rowCountdowns.splice(0)) { stop(); }
      controller.abort();
      options.onContextBar?.(null);
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}

// ------------------------------------------------------------------ the night (W19, W20, W21)

/** One group's board, drawn the way all four standings are drawn. */
function standingBoard(options: Readonly<{
  title: string; meta?: string; accent?: string; rows: readonly BoardRow[];
  nameColumn?: string;
  header?: readonly (Node | string | null)[]; children?: readonly (Node | string | null)[];
}>): HTMLElement {
  return groupBoard({
    title: options.title,
    language: language(),
    ...(options.meta === undefined ? {} : { meta: options.meta }),
    ...(options.accent === undefined ? {} : { accent: options.accent }),
    ...(options.header === undefined ? {} : { header: options.header }),
    ...(options.children === undefined ? {} : { children: options.children }),
    columns: {
      rank: "#",
      name: options.nameColumn ?? localized("Player", "Speler"),
      value: localized("Pts", "Pnt"),
    },
    rows: options.rows,
  });
}

export function renderTournamentEvent(
  document: Document,
  event: PublicTournamentEvent,
  target: HTMLElement,
  story: TournamentStory | null = null,
): void {
  useDocument(document);
  // A published night is the community's own document and nothing else: the report carries its own
  // heading, its standings per group, the Top 5 and a section per Player. The operator's furniture
  // belongs to a night that is still being run and stays there, behind `&operate=1`.
  const published = event.report === undefined ? null : tournamentStoryFromReport(event.report);
  const history = isHistoryEditionId(event.tournamentId);
  const finished = history || published !== null;
  if (finished) {
    const draw = (stage: ReportStage | undefined): void => {
      target.replaceChildren(...renderTournamentReport(document, event, published ?? story, {
        standalone: true,
        ...(published === null && !history ? { standingsOnly: true } : {}),
        ...(stage === undefined ? {} : { stage }),
        onStage: (next) => { writeReportStage(document, next); draw(next); },
      }));
    };
    draw(readReportStage(document));
    return;
  }

  const unpublishedFinished = event.stage === "finalized" && published === null && !history;

  // W19: a night being raced. Its step is the page's own progress, and the groups are boards.
  if (event.workflowStep !== undefined) {
    target.append(renderTournamentStepProgress(document, event.workflowStep, event));
  }

  if (!unpublishedFinished && event.overall.length > 0 && event.stage === "finalized") {
    const winner = event.overall[0];
    if (winner !== undefined) {
      target.append(winnerCard({
        label: localized("Winner of the night", "Winnaar van de avond"),
        rank: winner.placement, language: language(),
        name: playerLink(winner.playerId, winner.displayName),
        value: localized(`${winner.points} pts`, `${winner.points} pnt`),
        meta: displayTournamentGroupLabel(winner.groupName),
      }));
    }
    target.append(standingBoard({
      title: localized("Overall result", "Eindklassement"),
      rows: event.overall.map((row) => ({
        rank: row.placement,
        name: playerLink(row.playerId, row.displayName),
        value: localized(`${row.points} pts`, `${row.points} pnt`),
        title: displayTournamentGroupLabel(row.groupName),
      })),
    }));
  }

  if (!unpublishedFinished) {
    const exportSection = renderTournamentExportSection(document, event);
    if (exportSection !== null) { target.append(exportSection); }
  }

  const qualifiers = event.groups.filter((group) => group.stage === "qualifier");
  const finals = event.groups.filter((group) => group.stage !== "qualifier");
  const destinations = new Map<string, string>();
  for (const group of finals) {
    const colour = groupAccent(group.tierKey);
    if (colour === undefined) { continue; }
    for (const row of group.standings) {
      destinations.set(row.playerId ?? row.displayName, colour);
    }
  }
  const stages: [string, PublicTournamentEvent["groups"], boolean][] = unpublishedFinished
    ? [
      [localized("Qualifier", "Kwalificatie"), qualifiers, true],
      [qualifiers.length > 0
        ? localized("Final groups", "Eindklassen")
        : localized("Groups", "Groepen"), finals, false],
    ]
    : [
      [localized("Finals", "Finales"), finals, false],
      [localized("Qualifiers", "Kwalificaties"), qualifiers, true],
    ];
  for (const [label, groups, qualifier] of stages) {
    if (groups.length === 0) { continue; }
    const grid = el("div", "ds-tournaments__boards", {});
    for (const group of groups) {
      const groupLabel = displayTournamentGroupLabel(group.name, group.tierKey);
      const memberCount = Math.max(group.seating.length, group.standings.length);
      // The APK's group card: how many are in it, and the SP average with its spread.
      const seeds = (group.seating.length > 0 ? group.seating : group.standings)
        .map((entry) => entry.seedScore).filter((score): score is number => score !== undefined);
      const average = seeds.length === 0
        ? null
        : seeds.reduce((sum, value) => sum + value, 0) / seeds.length;
      const meta = unpublishedFinished
        ? qualifier
          ? localized(
            `${group.standings.length} players · colour: the final group they went on to`,
            `${group.standings.length} spelers · kleur: de eindgroep waar ze naartoe gingen`)
          : localized(`${group.standings.length} players`, `${group.standings.length} spelers`)
        : [
          localized(`${memberCount} players`, `${memberCount} deelnemers`),
          average === null ? "" : `${localized("Avg. SP", "Gem. SP")}: ${tournamentExportMetric(average)}`,
          average === null ? "" : `${localized("Spread", "Spreiding")}: +${tournamentExportMetric(Math.max(...seeds) - average)} / -${tournamentExportMetric(average - Math.min(...seeds))}`,
        ].filter((part) => part.length > 0).join(" · ");
      const accent = unpublishedFinished && qualifier ? undefined : groupAccent(group.tierKey);
      const board = standingBoard({
        title: groupLabel,
        meta,
        ...(unpublishedFinished ? { nameColumn: localized("Name", "Naam") } : {}),
        ...(accent === undefined ? {} : { accent }),
        rows: [...group.standings].sort((left, right) => left.rank - right.rank).map((row) => {
          const wash = qualifier ? destinations.get(row.playerId ?? row.displayName) : undefined;
          return {
            rank: row.rank,
            name: playerLink(row.playerId, row.displayName),
            mark: characterMark(row.character),
            value: unpublishedFinished
              ? String(row.points)
              : row.races > 0
                ? localized(
                  `${row.points} pts · ${row.races} race${row.races === 1 ? "" : "s"}${row.wins > 0 ? ` · ${row.wins} win${row.wins === 1 ? "" : "s"}` : ""}`,
                  `${row.points} pnt · ${row.races} race${row.races === 1 ? "" : "s"}${row.wins > 0 ? ` · ${row.wins} overwinning${row.wins === 1 ? "" : "en"}` : ""}`)
                : row.complete ? localized(`${row.points} pt`, `${row.points} pt`) : "—",
            ...(wash === undefined ? {} : { wash }),
          };
        }),
        header: unpublishedFinished ? [] : [seedChipHeader(group.standings)],
        children: unpublishedFinished || group.races.length === 0 ? [] : [disclosure({
          summary: `${group.races.length} race${group.races.length === 1 ? "" : "s"}`,
          children: [el("ol", "ds-tournaments__races", {}, ...group.races.map((race) =>
            el("li", "ds-tournaments__race", { "data-counted": race.countsTowardStandings ? null : "no" },
              el("span", "ds-tournaments__race-title", {}, localized(
                `Race ${race.raceNumber} · ${trackName(race.trackId)}${raceClassSuffix(race.mode, race.mirror)}${race.countsTowardStandings ? "" : " · not counted"}`,
                `Race ${race.raceNumber} · ${trackName(race.trackId)}${raceClassSuffix(race.mode, race.mirror)}${race.countsTowardStandings ? "" : " · telt niet mee"}`)),
              el("span", "ds-tournaments__race-order ds-micro", {}, race.placements
                .map((placement) => `${placement.finishPosition}. ${placement.displayName} (${placement.racePoints})`)
                .join("  ")))))],
        })],
      });
      board.setAttribute("data-tournament-stage", qualifier ? "qualifier" : "final");
      grid.append(board);
    }
    target.append(sectionLabel({ text: label, level: 2 }), grid);
  }
  if (unpublishedFinished) {
    target.append(statusMessage("info", localized(
      "The report of this night has not been published yet. Once it is, the story, the Top 5 tracks and a section per Player with their charts appear here.",
      "Het verslag van deze avond is nog niet gepubliceerd. Zodra dat gebeurt staan hier het verhaal, de Top 5 banen en per speler een eigen stuk met grafieken.",
    )));
  }
}

/** The SP band of the seeds in a board, as one chip beside its name. */
function seedChipHeader(standings: PublicTournamentEvent["groups"][number]["standings"]): HTMLElement | null {
  const seeds = standings.map((row) => row.seedRank).filter((rank): rank is number => rank !== undefined);
  if (seeds.length === 0) { return null; }
  return seedChip(Math.min(...seeds));
}

export function renderPublicTournamentLiveGroups(
  document: Document,
  event: PublicTournamentEvent,
  groups: readonly PublicTournamentLiveGroup[],
  target: HTMLElement,
): void {
  useDocument(document);
  target.replaceChildren();
  if (groups.length === 0) { return; }
  target.className = "ds-tournaments__live ds-stack";
  target.append(sectionLabel({
    text: localized("Live standings", "Live-tussenstanden"),
    level: 2,
    trailing: [liveTag(localized("Live", "Bezig"))],
    note: localized(
      "Live uses the names shown in-game. Player profiles are linked after Stop and the final check.",
      "Live gebruikt de namen die in de game staan. Player-profielen worden na Stop en de eindcontrole gekoppeld."),
  }));
  const grid = el("div", "ds-tournaments__boards", {});
  for (const group of groups) {
    const groupName = event.groups.find((candidate) => candidate.groupId === group.groupId)?.name ?? group.groupId;
    const state = group.status === "live"
      ? localized("Live", "Bezig")
      : group.status === "stopping"
        ? localized("Stopping · final upload pending", "Stoppen · laatste upload volgt")
        : localized("Stopped · final review", "Gestopt · eindcontrole");
    grid.append(groupBoard({
      title: displayTournamentGroupLabel(groupName),
      accessibleTitle: localized(
        `Live standings · ${displayTournamentGroupLabel(groupName)}`,
        `Live-tussenstand · ${displayTournamentGroupLabel(groupName)}`,
      ),
      language: language(),
      meta: `${state} · ${group.countedRaces}/${group.receivedRaces} ${localized("races counted", "races tellen mee")}`,
      columns: { rank: "#", name: localized("Player", "Speler"), value: "Total" },
      rows: group.standings.map((row) => ({
        rank: row.rank, name: row.observedPlayerName, value: String(row.total),
      })),
      ...(group.status === "live" ? { header: [liveTag(localized("Live", "Bezig"))] } : {}),
      children: group.controlPoints.length === 0
        ? []
        : [el("p", "ds-tournaments__control ds-micro", {}, group.controlPoints.join(" · "))],
    }));
  }
  target.append(grid);
}

export function mountTournamentEvent(
  root: HTMLElement,
  tournamentId: string,
  client: TournamentOperationClient = createTournamentOperationClient(),
  options: Readonly<{
    administrator?: boolean;
    operator?: boolean;
    /** ADR-0222: the status line and sign-up; replaced in tests. */
    mountSignup?: (root: HTMLElement, tournamentId: string) => MountedTournamentSignup;
  }> = {},
): MountedTournamentsView {
  const document = root.ownerDocument;
  useDocument(document);
  const controller = new AbortController();
  let disposed = false;
  let signup: MountedTournamentSignup | undefined;
  const container = el("div", "ds-root ds-night ds-stack", { "data-spectacle": "high" });
  const back = el("a", "ds-tournaments__back", { href: "/?tournaments=1" },
    localized("← All tournaments", "← Alle toernooien"));
  const heroRoot = el("div", "", {});
  const status = el("p", "ds-tournaments__status ds-micro", { role: "status", id: "tournament-event-heading" },
    localized("Loading tournament…", "Toernooi laden…"));
  const content = el("div", "ds-stack", {});
  const liveContent = el("section", "", {});
  let liveTimer: ReturnType<typeof setTimeout> | undefined;
  container.append(back, heroRoot, status, content);
  root.append(container);

  const stories = loadTournamentStories();
  const ready = client.loadPublic(tournamentId, controller.signal).then(async (event) => {
    if (disposed) { return; }
    const name = event.editionNumber === undefined ? event.name : `TN${event.editionNumber} · ${event.name}`;
    const backdrop = nightBackdrop(event);
    const marks: HTMLElement[] = [];
    if (event.stage !== "finalized" && event.groups.some((group) => group.races.length > 0)) {
      marks.push(liveTag(localized("Live", "Bezig")));
    }
    // HIGH (§5): the night's name in display-2 over the art of the track it drove most, matching
    // Android's NightHero without forcing a short phone title onto two lines.
    heroRoot.replaceChildren(artHero({
      spectacle: "high",
      titleStep: "display-2",
      title: name,
      ...(backdrop === undefined ? {} : { backdrop }),
      eyebrow: [nightOverview(event), ...marks],
    }));
    status.textContent = "";
    // ADR-0222: a night still to come says where the viewer stands and lets them sign up.
    if (event.stage !== "finalized" && !isHistoryEditionId(event.tournamentId)) {
      const signupRoot = el("div", "", {});
      content.append(signupRoot);
      signup = (options.mountSignup ?? ((target, id) => mountTournamentSignup(target, id)))(signupRoot, event.tournamentId);
    }
    const story = tournamentStoryFor(await stories, event.editionNumber);
    if (disposed) { return; }
    // A history edition is read-only: there is nothing to operate.
    if ((options.administrator === true || options.operator === true) && !isHistoryEditionId(event.tournamentId)) {
      const edit = button({
        label: localized("Edit this tournament", "Toernooi bewerken"),
        variant: "quiet",
        href: `/?tournaments=${encodeURIComponent(event.tournamentId)}&operate=1`,
      }).root;
      edit.classList.add("ds-night__edit");
      content.append(edit);
    }
    renderTournamentEvent(document, event, content, story);
    content.append(liveContent);
    const liveClient = new TournamentIncomingClient();
    const refreshLive = async (): Promise<void> => {
      if (disposed) { return; }
      try {
        const groups = await liveClient.listPublicLive(tournamentId, controller.signal);
        if (!disposed) { renderPublicTournamentLiveGroups(document, event, groups, liveContent); }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") { return; }
      }
      if (!disposed) { liveTimer = setTimeout(() => { void refreshLive(); }, 3_000); }
    };
    await refreshLive();
  }).catch((error: unknown) => {
    if (disposed) { return; }
    status.textContent = "";
    content.replaceChildren(error instanceof TournamentOperationClientError && error.code === "not_found"
      ? errorState({
        title: localized("This tournament is not published, or does not exist.",
          "Dit toernooi is niet gepubliceerd of bestaat niet."),
      })
      : error instanceof TournamentOperationClientError && error.code === "not_authorized"
        ? errorState({ title: localized("Sign in to see this tournament.", "Meld je aan om dit toernooi te bekijken.") })
        : errorState({
          title: localized("The tournament is temporarily unavailable.",
            "Het toernooi is tijdelijk niet beschikbaar."),
        }));
  });

  return {
    container,
    ready,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      signup?.unmount();
      if (liveTimer !== undefined) { clearTimeout(liveTimer); }
      controller.abort();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}

/**
 * The WhatsApp picture on the public page (W35's night half): the same one the APK and the operator
 * workspace produce, so anybody in the night can post it. The renderer is untouched — OD-12 owns
 * the export's own look; this is the control around it.
 */
export function renderTournamentExportSection(
  document: Document,
  event: PublicTournamentEvent,
): HTMLElement | null {
  useDocument(document);
  const checkpoints = publicTournamentCheckpoints(event);
  const probe = document.createElement("canvas");
  if (checkpoints.length === 0 || typeof probe.getContext !== "function") { return null; }
  const picture = el("div", "ds-tournaments__picture", {});
  const tabs = el("div", "ds-tournaments__picture-tabs", { role: "group",
    "aria-label": localized("Which picture", "Welke afbeelding") });
  let selected = publicTournamentCurrentCheckpoint(event) ?? checkpoints[checkpoints.length - 1]!;
  const source = tournamentExportSourceFromPublicEvent(event);
  const canvasFor = (icons: Parameters<typeof renderTournamentExportImage>[2] = {}): HTMLCanvasElement | null =>
    renderTournamentExportImage(document, tournamentExportImageModel(source, selected.stage, selected.mode), icons);
  const draw = (): void => {
    const drawn = canvasFor();
    picture.replaceChildren(...(drawn === null ? [] : [drawn]));
    void loadTournamentExportIcons(document).then((icons) => {
      const withIcons = canvasFor(icons);
      if (withIcons !== null && picture.isConnected) { picture.replaceChildren(withIcons); }
    });
    for (const tab of Array.from(tabs.querySelectorAll("button"))) {
      tab.setAttribute("aria-pressed", tab.dataset["checkpoint"] === selected.key ? "true" : "false");
    }
  };
  for (const checkpoint of checkpoints) {
    const handle = button({
      label: checkpoint.label, variant: "secondary", size: "sm",
      onPress: () => { selected = checkpoint; draw(); },
    });
    handle.control.dataset["checkpoint"] = checkpoint.key;
    handle.control.setAttribute("aria-pressed", "false");
    tabs.append(handle.root);
  }
  const image = async (): Promise<Blob | null> => {
    const icons = await loadTournamentExportIcons(document);
    const canvas = canvasFor(icons);
    return canvas === null ? null : tournamentExportImageBlob(canvas);
  };
  const fileName = (): string => tournamentExportFileName(event.name, selected.stage, selected.mode);
  const share = shareButton({
    label: localized("Share the picture", "Deel de afbeelding"),
    onShare: (say) => { void (async () => {
      const blob = await image();
      if (blob === null) {
        say(localized("Image export is unavailable in this browser.",
          "Afbeelding exporteren is niet beschikbaar in deze browser."));
        return;
      }
      const file = new File([blob], fileName(), { type: "image/png" });
      const text = publicTournamentWhatsAppText(event, selected.stage, selected.mode);
      try {
        if (globalThis.navigator.share !== undefined &&
          (globalThis.navigator.canShare === undefined || globalThis.navigator.canShare({ files: [file] }))) {
          await globalThis.navigator.share({
            title: event.name,
            text: tournamentExportShareCaption(source, selected.stage, selected.mode),
            files: [file],
          });
        } else {
          await globalThis.navigator.clipboard.writeText(text);
          say(localized("Image sharing is unsupported; the text was copied.",
            "Afbeelding delen wordt niet ondersteund; de tekst is gekopieerd."));
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          say(localized("Sharing is unavailable.", "Delen is niet beschikbaar."));
        }
      }
    })(); },
  });
  const download = button({
    label: "Download PNG", variant: "quiet",
    onPress: () => { void image().then((blob) => {
      if (blob === null) { return; }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName();
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    }); },
  });
  const asText = button({
    label: localized("Share as text", "Deel als tekst"), variant: "quiet",
    onPress: () => {
      void globalThis.navigator.clipboard.writeText(
        publicTournamentWhatsAppText(event, selected.stage, selected.mode));
    },
  });
  draw();
  return panel({
    title: localized("Share the picture", "Deel de afbeelding"),
    // This is a top-level night section beside Finals/Qualifiers, not content nested under one.
    titleLevel: 2,
    children: [tabs, picture, el("div", "ds-tournaments__actions", {}, share, download.root, asText.root)],
  });
}
