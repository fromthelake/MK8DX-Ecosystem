// Four years of tournament nights, added up.
//
// Under the finished nights, because that is what it is about: which tracks
// keep coming back, which have been driven once, how much racing that adds up
// to, and how the field grew from sixteen people to thirty-odd.
//
// Time is the one number nobody recorded, so it is *derived and said to be*:
// a race takes about as long as Nintendo's own ghost on that track, so the
// racing time is the sum of those ghosts over every race, and the Player-hours
// are the same sum taken per Player - the owner's own "track × deelnemers ×
// ghost". It is an estimate with a stated basis, not a measurement, and the
// page says so where it prints it.

import {
  artThumb,
  button,
  dataTable,
  disclosure,
  el,
  emptyState,
  panel,
  shareButton,
  statBlock,
  statGrid,
  useDocument,
  youChip,
  type DataColumn,
  type DataRow,
} from "./ds-components.js";
import { formatCount, formatRank, rankColumnCh, type NumberLanguage } from "./ds-numeric.js";
import { GAME_ASSET_BASE, trackAsset } from "./asset-manifest.js";
import { trackBenchmarks } from "./benchmark-manifest.js";
import { localized, productLanguage } from "./product-language.js";
import { disambiguatedName, repeatedDisplayNames } from "./name-disambiguation.js";
import {
  createTournamentStatisticsClient,
  type TournamentStatistics,
  type TournamentStatisticsClient,
  type TrackSkill,
} from "./tournament-statistics-client.js";

/**
 * A track's own page inside the statistics panel: the same TrueSkill the
 * Ranking publishes, over that track's races alone. It has had its own address
 * since the panel learned to open a track; this is that address, so every
 * other list can point a track at it instead of at the time-trial board.
 */
export function tournamentTrackSkillHref(trackId: string): string {
  return `/?tournaments=1&stats_focus=${encodeURIComponent(trackId)}`;
}

/** The time-trial board for the same track, which the track page links on to. */
export function trackLeaderboardHref(trackId: string, mode: 150 | 200 = 150): string {
  return `/?leaderboard=${encodeURIComponent(trackId)}&mode=${mode}`;
}

export type StatisticsSortKey =
  | "track" | "cup" | "races" | "players" | "time" | "nights" | "ghost" | "best";

export type StatisticsFilterKey = "track" | "cup" | "races" | "players" | "nights";

/** Which way a column reads on its first click. */
export const STATISTICS_SORT_OPENS_DESCENDING:
Readonly<Record<StatisticsSortKey, boolean>> = {
  track: false, cup: false, races: true, players: true, time: true, nights: true,
  ghost: true, best: true,
};

export type StatisticsRow = Readonly<{
  trackId: string;
  name: string;
  cupName: string;
  races: number;
  players: number;
  nights: number;
  /** Whoever tops this track's own TrueSkill, as the server counted it. */
  bestPlayerId: string | null;
  bestPlayerName: string | null;
  bestScore: number | null;
  /** Nintendo's 150cc ghost for this track, in milliseconds; null if unknown. */
  ghostMs: number | null;
  /** The racing this track accounts for, in milliseconds. */
  timeMs: number | null;
}>;

/** Nintendo's own 150cc ghost, which is how long a race on this track takes. */
export function nintendoGhostMs(trackId: string): number | null {
  const ghost = trackBenchmarks(trackId, 150)
    .find((entry) => entry.kind === "nintendo_staff");
  return ghost?.timeMs ?? null;
}

export function buildStatisticsRows(
  statistics: TournamentStatistics,
): readonly StatisticsRow[] {
  // ADR-0218: two leaders may share a display name; the table then adds
  // their usernames so it is clear which Marc owns which track.
  const repeated = repeatedDisplayNames(statistics.tracks.flatMap((track) =>
    track.bestPlayerId === null || track.bestPlayerName === null
      ? [] : [{ playerId: track.bestPlayerId, displayName: track.bestPlayerName }]));
  return statistics.tracks.map((track) => {
    const asset = trackAsset(track.trackId);
    const ghostMs = nintendoGhostMs(track.trackId);
    return {
      trackId: track.trackId,
      name: asset?.name ?? track.trackId,
      cupName: asset?.cup.name ?? "—",
      races: track.races,
      players: track.placements,
      nights: track.nights,
      bestPlayerId: track.bestPlayerId,
      bestPlayerName: track.bestPlayerName === null ? null
        : disambiguatedName({ displayName: track.bestPlayerName, username: track.bestPlayerUsername ?? null }, repeated),
      bestScore: track.bestScore,
      ghostMs,
      // The owner's own reading, and the right one: a race is not one run of
      // the ghost, it is one run per driver. Twelve people racing SNES
      // Rainbow Road spend twelve laps of it, not one.
      timeMs: ghostMs === null ? null : ghostMs * track.placements,
    };
  });
}

function sortValue(row: StatisticsRow, key: StatisticsSortKey): number {
  switch (key) {
    case "races": return row.races;
    case "players": return row.players;
    case "nights": return row.nights;
    case "ghost": return row.ghostMs ?? -1;
    case "best": return row.bestScore ?? Number.NEGATIVE_INFINITY;
    case "time": return row.timeMs ?? -1;
    default: return 0;
  }
}

export function sortStatisticsRows(
  rows: readonly StatisticsRow[], key: StatisticsSortKey, descending: boolean,
): readonly StatisticsRow[] {
  const order = descending ? -1 : 1;
  return [...rows].sort((left, right) => {
    // The owner sorts tracks by their id, not by the name they are shown
    // under: the id groups a track with its console - every `gba_` together,
    // every `tour_` together - which a display name scatters.
    if (key === "track") { return order * left.trackId.localeCompare(right.trackId); }
    if (key === "cup") {
      return order * (left.cupName.localeCompare(right.cupName) || left.name.localeCompare(right.name));
    }
    const difference = sortValue(left, key) - sortValue(right, key);
    return difference === 0 ? left.name.localeCompare(right.name) : order * difference;
  });
}

/** `> 3`, `>=3`, `<2`, `=4`, `3` - and plain text for a name. */
export function statisticsRowMatches(
  row: StatisticsRow, filters: Readonly<Partial<Record<StatisticsFilterKey, string>>>,
): boolean {
  for (const [key, raw] of Object.entries(filters)) {
    const filter = (raw ?? "").trim();
    if (filter === "") { continue; }
    if (key === "track" || key === "cup") {
      const text = key === "track" ? row.name : row.cupName;
      if (!text.toLowerCase().includes(filter.toLowerCase())) { return false; }
      continue;
    }
    const value = key === "races" ? row.races : key === "players" ? row.players : row.nights;
    const match = /^(>=|<=|>|<|=)?\s*(\d+(?:[.,]\d+)?)$/.exec(filter);
    if (match === null) { return false; }
    const wanted = Number(match[2]!.replace(",", "."));
    switch (match[1]) {
      case ">": if (!(value > wanted)) { return false; } break;
      case ">=": if (!(value >= wanted)) { return false; } break;
      case "<": if (!(value < wanted)) { return false; } break;
      case "<=": if (!(value <= wanted)) { return false; } break;
      default: if (value !== wanted) { return false; } break;
    }
  }
  return true;
}

/** "12 u 34 m", or "34 m" under an hour: a duration, not a stopwatch. */
export function formatHours(totalMs: number): string {
  const minutes = Math.round(totalMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) { return localized(`${rest} min`, `${rest} min`); }
  return localized(`${hours}h ${rest}m`, `${hours} u ${rest} m`);
}

/** "24,52" in Dutch, "24.52" in English. */
export function decimalText(value: number): string {
  return value.toFixed(2).replace(".", productLanguage() === "nl" ? "," : ".");
}

/** "14 d 1 u 52 m": a total that has run past a day says so in days. */
export function formatSpan(totalMs: number): string {
  const minutes = Math.round(totalMs / 60_000);
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  const rest = minutes % 60;
  if (days === 0) { return formatHours(totalMs); }
  return localized(`${days}d ${hours}h ${rest}m`, `${days} d ${hours} u ${rest} m`);
}

/** "1:52.318", the way every other time on the site is written. */
export function formatLap(totalMs: number): string {
  const minutes = Math.floor(totalMs / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export type CupTotal = Readonly<{
  cupName: string;
  iconPath: string | null;
  races: number;
  tracks: number;
  drivers: number;
  timeMs: number;
}>;

export function cupTotals(rows: readonly StatisticsRow[]): readonly CupTotal[] {
  const byCup = new Map<string, {
    races: number; tracks: number; drivers: number; timeMs: number; iconPath: string | null;
  }>();
  for (const row of rows) {
    const asset = trackAsset(row.trackId);
    const bucket = byCup.get(row.cupName)
      ?? { races: 0, tracks: 0, drivers: 0, timeMs: 0, iconPath: asset?.cup.iconPath ?? null };
    bucket.races += row.races;
    bucket.tracks += 1;
    bucket.drivers += row.players;
    bucket.timeMs += row.timeMs ?? 0;
    byCup.set(row.cupName, bucket);
  }
  return [...byCup.entries()]
    .map(([cupName, bucket]) => ({ cupName, ...bucket }))
    .sort((left, right) => right.races - left.races || left.cupName.localeCompare(right.cupName));
}

export type MountedTournamentStatistics = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

/** What `#alle-races` points at. */
export const STATISTICS_ANCHOR = "alle-races";

export type StatisticsViewState = Readonly<{
  sort: StatisticsSortKey;
  descending: boolean;
  filters: Readonly<Partial<Record<StatisticsFilterKey, string>>>;
  /** The track whose own rating is open, if any. */
  focus: string | null;
}>;

// Drivers and the ghost time are what Racing time is made of, not columns of
// their own: the owner asked for the answer, not its two factors. They are
// still sortable and filterable through the address - `stats_sort=players`,
// `stats_players=>100` - because the numbers did not go anywhere. The six
// columns the table draws are declared where it is built, with their own
// SortHeader and filter (Phase 12).

function columnLabel(key: StatisticsSortKey): string {
  switch (key) {
    case "track": return localized("Track", "Baan");
    case "cup": return localized("Cup", "Cup");
    case "races": return localized("Races", "Races");
    case "players": return localized("Drivers", "Deelnames");
    case "nights": return localized("Nights", "Avonden");
    case "ghost": return localized("Ghost", "Ghost");
    case "best": return localized("Best player", "Beste speler");
    default: return localized("Racing time", "Racetijd");
  }
}

export function mountTournamentStatistics(
  root: HTMLElement,
  client: TournamentStatisticsClient = createTournamentStatisticsClient(),
  options: Readonly<{
    initial?: Readonly<{
      open?: boolean;
      sort?: StatisticsSortKey | null;
      descending?: boolean | null;
      filters?: Readonly<Partial<Record<StatisticsFilterKey, string>>>;
    }>;
    onStateChange?: (state: StatisticsViewState) => void;
    shareLink?: () => string;
  }> & Readonly<{
    initial?: Readonly<{ focus?: string | null }>;
  }> & Readonly<{
    /**
     * Who is reading, when anybody is signed in: their own row in a track's
     * standing is marked and, when the track page is opened from a link, it is
     * what the page opens on (owner, 2026-09-16).
     */
    viewerPlayerId?: string | null;
    /** Whether the address asked for these numbers, and so for this section. */
    scrollIntoView?: boolean;
    /**
     * The page's own request queue, where it has one. The host allows about
     * five dynamic requests a second from one address, and a section that
     * asks at the same moment as everything else is the one that gets
     * refused.
     */
    pace?: <T>(task: () => Promise<T>) => Promise<T>;
  }> = {},
): MountedTournamentStatistics {
  const document = root.ownerDocument;
  useDocument(document);
  const language = (): NumberLanguage => productLanguage();
  const controller = new AbortController();
  let disposed = false;

  let sortKey: StatisticsSortKey = options.initial?.sort ?? "races";
  let descending = options.initial?.descending ?? STATISTICS_SORT_OPENS_DESCENDING[sortKey];
  const filters: Partial<Record<StatisticsFilterKey, string>> = { ...options.initial?.filters };
  let focus: string | null = options.initial?.focus ?? null;
  /** Whether the all-tracks table inside the panel is unfolded. */
  let tableOpen = false;
  /** Where the reader was standing when they opened a track. */
  let restoreScrollY: number | null = null;
  /**
   * The head of this section, wherever the page has put it.
   *
   * `scrollIntoView` rather than a computed offset, because the shelves above
   * this section are still painting when a shared link arrives - their cards
   * and their pictures land late - and an offset measured before that is a
   * position that no longer exists. It is asked again a moment later for the
   * same reason. A timeout, not `requestAnimationFrame`: a background tab
   * never gets a frame, and a link opened in one must still land right.
   */
  const showSection = (): void => {
    const view = document.defaultView;
    if (view === undefined || view === null) { return; }
    section.scrollIntoView({ block: "start" });
    view.setTimeout(() => {
      if (!disposed) { section.scrollIntoView({ block: "start" }); }
    }, 250);
  };
  const openTrack = (trackId: string): void => {
    restoreScrollY = document.defaultView?.scrollY ?? 0;
    focus = trackId;
    announce();
    render();
    // A track's page belongs where the reader was reading: the section stays
    // where it is and shows the track, rather than throwing them to the top
    // of the page.
    showSection();
  };
  const closeTrack = (): void => {
    focus = null;
    announce();
    render();
    // Back to the row they came from, not to the top of a page they have
    // already read.
    const view = document.defaultView;
    if (restoreScrollY === null) { showSection(); } else { view?.scrollTo({ top: restoreScrollY }); }
    restoreScrollY = null;
  };
  const announce = (): void => {
    options.onStateChange?.({
      sort: sortKey, descending, filters: { ...filters }, focus,
    });
  };

  // Not a box. It was a `<details>` that had to be unfolded, which meant a
  // shared link needed `stats=open` to show anything and the section could be
  // closed under the reader's own address. It is a section of the page now,
  // with an id, so `#alle-races` is a way to point at it and a click on a
  // track can put it back in view.
  const section = el("section", "ds-root ds-tstats ds-stack", {
    id: STATISTICS_ANCHOR, "data-spectacle": "low",
  });
  const subtitle = el("p", "ds-tstats__subtitle ds-micro", { role: "status" },
    localized("Loading…", "Laden…"));
  const body = el("div", "ds-stack", {});
  section.append(panel({
    title: localized("Every race so far", "Alle races tot nu toe"),
    titleLevel: 2,
    children: [subtitle, body],
  }));
  root.append(section);

  let loaded: TournamentStatistics | null = null;

  /**
   * Two things live in this panel, and only ever one at a time: the numbers
   * over every night, and one track's own page. A track opens as a page with
   * its own address and a way back to the row it was opened from, which is
   * what the owner asked for - scrolling somebody to a table halfway down a
   * page they were already reading is not opening anything.
   */
  const render = (): void => {
    body.replaceChildren();
    const statistics = loaded;
    if (statistics === null) { return; }
    if (focus !== null) { renderTrackPage(statistics, focus); return; }
    renderPanel(statistics);
  };

  const renderTrackPage = (statistics: TournamentStatistics, trackId: string): void => {
    const asset = trackAsset(trackId);
    const back = button({
      label: localized("← All races", "← Alle races"), variant: "quiet",
      onPress: () => { closeTrack(); },
    });
    const row = buildStatisticsRows(statistics).find((entry) => entry.trackId === trackId);
    const head = el("div", "ds-tstats__track-head", {});
    if (asset !== undefined) {
      head.append(artThumb({ src: `${GAME_ASSET_BASE}${asset.previewPath}` }));
    }
    const heads = el("div", "ds-tstats__track-copy", {},
      el("h3", "ds-tstats__track-title", {}, asset?.name ?? trackId));
    if (row === undefined) {
      heads.append(el("p", "ds-tstats__note ds-micro", {},
        localized("Never raced in a tournament.", "Nooit in een toernooi gereden.")));
    } else {
      heads.append(statGrid([
        statBlock({ label: localized("Cup", "Cup"), value: asset?.cup.name ?? "—" }),
        statBlock({ label: localized("Races", "Races"), value: formatCount(row.races, language()) }),
        statBlock({ label: localized("Nights", "Avonden"), value: formatCount(row.nights, language()) }),
        statBlock({ label: localized("Drivers", "Deelnames"), value: formatCount(row.players, language()) }),
        statBlock({
          label: localized("Racing time", "Racetijd"),
          value: row.timeMs === null ? "?" : formatHours(row.timeMs),
        }),
      ]));
    }
    head.append(heads);
    const status = el("p", "ds-tstats__note ds-micro", { role: "status" },
      localized("Counting…", "Rekenen…"));
    // This is the tournament side of the track; the time trials on it are one
    // link away, which is the order the owner asked for (2026-09-16).
    const board = button({
      label: localized(
        `Time-trial leaderboard for ${asset?.name ?? trackId}`,
        `Leaderboard (time trials) van ${asset?.name ?? trackId}`),
      variant: "secondary",
      href: trackLeaderboardHref(trackId),
    });
    body.append(
      back.root, head,
      el("p", "ds-tstats__note ds-micro", {}, localized(
        "The same TrueSkill the Ranking publishes, over this track's races alone: everybody starts at 0.",
        "Dezelfde TrueSkill als op de ranglijst, alleen over de races op deze baan: iedereen begint op 0.")),
      board.root, status,
    );
    void pace(() => client.loadTrack(trackId, controller.signal)).then((skill) => {
      if (skill === undefined) { return; }
      if (disposed || focus !== trackId) { return; }
      status.remove();
      const rendered = trackSkillTable(skill, options.viewerPlayerId ?? null, language());
      body.append(rendered);
      // Opened from a link - from the Ranking, or a shared address - the page
      // shows the reader their own line rather than the top of a table of
      // forty names.
      const mine = rendered.querySelector<HTMLElement>('[data-kind="you"]');
      if (mine !== null) {
        const view = document.defaultView;
        const scroll = (): void => {
          try {
            mine.scrollIntoView({ block: "center", behavior: "smooth" });
          } catch { mine.scrollIntoView(); }
        };
        if (view?.requestAnimationFrame === undefined) { scroll(); } else {
          view.requestAnimationFrame(() => { view.requestAnimationFrame(scroll); });
        }
      }
    }).catch(() => {
      if (disposed || focus !== trackId) { return; }
      status.textContent = localized(
        "This track's rating is temporarily unavailable.",
        "De vaardigheid op deze baan is tijdelijk niet beschikbaar.",
      );
    });
  };

  const renderPanel = (statistics: TournamentStatistics): void => {
    const rows = buildStatisticsRows(statistics);
    const driverMs = rows.reduce((sum, row) => sum + (row.timeMs ?? 0), 0);

    // ---- what it adds up to
    body.append(statGrid([
      statBlock({ label: localized("Nights", "Avonden"), value: formatCount(statistics.totals.editions, language()) }),
      // No footnote about races whose track is lost. There is exactly one left -
      // TN11's first qualification race, where the camera was not yet running -
      // and it is written down where such things belong
      // (`docs/provenance/TOURNAMENT_HISTORY_CORRECTIONS_2026-09-06.md`), not
      // printed on a page as if somebody could still go and find it.
      statBlock({ label: localized("Races", "Races"), value: formatCount(statistics.totals.races, language()) }),
      statBlock({ label: localized("Players", "Spelers"), value: formatCount(statistics.totals.players, language()) }),
      statBlock({
        label: localized("Tracks raced", "Banen gereden"),
        value: `${formatCount(statistics.totals.tracksRaced, language())} / 96`,
      }),
      // One time, and it is the one the owner defined: every driver's own lap of
      // that track, so the ghost time taken per driver rather than per race. How
      // it is derived is in the docs and in this file; the tile says the number.
      statBlock({ label: localized("Total racing time", "Totale racetijd"), value: formatSpan(driverMs) }),
    ]));

    // ---- how the field grew
    body.append(growthChart(document, statistics));

    // ---- which cups keep coming back: five on their own tiles, the rest
    // behind a box, because a top five is a thing you look at and a full list
    // is a thing you go into.
    const cups = cupTotals(rows);
    if (cups.length > 0) {
      body.append(cupTiles(cups.slice(0, 5), language()));
      body.append(cupBox(cups, language()));
    }

    // ---- and the tracks themselves, the same way
    const mostRaced = sortStatisticsRows(rows, "races", true);
    body.append(trackTiles(mostRaced.slice(0, 5), openTrack, language()));

    // ---- every track, sortable and filterable
    const count = el("p", "ds-tstats__count ds-micro", { role: "status" });
    const tableRoot = el("div", "ds-tstats__table", {});
    const bar = el("div", "ds-tstats__bar", {}, count);
    const share = options.shareLink;
    if (share !== undefined) {
      bar.append(shareButton({
        label: localized("Copy this view", "Kopieer deze weergave"),
        onShare: (say) => {
          void document.defaultView?.navigator.clipboard?.writeText(share())
            .then(
              () => { say(localized("Copied", "Gekopieerd")); },
              () => { say(localized("Copying failed", "Kopiëren mislukt")); },
            );
        },
      }));
    }

    const paintTable = (): void => {
      const shown = sortStatisticsRows(rows, sortKey, descending)
        .filter((row) => statisticsRowMatches(row, filters));
      // What is being shown, in one line (§12 FilterSummary): the count, and the filters that
      // produced it in the words the reader typed. The filters themselves stay in the column heads,
      // where this route has always kept them - a sheet would hide six controls behind a dialog.
      const active = ([["track", "Track", "Baan"], ["cup", "Cup", "Cup"], ["races", "Races", "Races"],
        ["players", "Drivers", "Deelnames"], ["nights", "Nights", "Avonden"]] as const)
        .map(([key, en, nl]) => {
          const value = (filters[key] ?? "").trim();
          return value === "" ? null : `${localized(en, nl)} ${value}`;
        })
        .filter((part): part is string => part !== null);
      count.textContent = [
        shown.length === rows.length
          ? localized(`${rows.length} tracks`, `${rows.length} banen`)
          : localized(`${shown.length} of ${rows.length} tracks`, `${shown.length} van ${rows.length} banen`),
        active.length === 0 ? "" : `${localized("filtered by", "gefilterd op")} ${active.join(" · ")}`,
      ].filter((part) => part.length > 0).join(" · ");
      const sortFor = (key: StatisticsSortKey): NonNullable<DataColumn["sort"]> => ({
        direction: sortKey === key ? (descending ? "descending" : "ascending") : "none",
        label: columnLabel(key),
        onSort: () => {
          if (sortKey === key) { descending = !descending; } else {
            sortKey = key;
            descending = STATISTICS_SORT_OPENS_DESCENDING[key];
          }
          announce();
          paintTable();
        },
      });
      const filterCell = (key: StatisticsFilterKey, numeric: boolean): HTMLElement => {
        const input = el("input", "ds-text-input ds-tstats__filter", {
          type: "search", value: filters[key] ?? "",
          placeholder: numeric ? "> 3" : localized("contains…", "bevat…"),
          "aria-label": `${localized("Filter", "Filter")} ${columnLabel(key as StatisticsSortKey)}`,
        });
        (input as HTMLInputElement).value = filters[key] ?? "";
        input.addEventListener("input", () => {
          filters[key] = (input as HTMLInputElement).value;
          announce();
          paintTable();
        });
        return input;
      };
      const columns: DataColumn[] = [
        { key: "track", label: columnLabel("track"), align: "name", sort: sortFor("track") },
        { key: "cup", label: columnLabel("cup"), align: "text", phone: 2, sort: sortFor("cup") },
        { key: "races", label: columnLabel("races"), align: "num", phone: 2, sort: sortFor("races") },
        { key: "nights", label: columnLabel("nights"), align: "num", phone: 2, compact: 3, sort: sortFor("nights") },
        { key: "time", label: columnLabel("time"), align: "num", phone: 3, sort: sortFor("time") },
        { key: "best", label: columnLabel("best"), align: "text", phone: 3, compact: "drop", tablet: "drop", sort: sortFor("best") },
      ];
      const table = dataTable({
        caption: localized("Every track raced", "Elke gereden baan"),
        density: "dense",
        columns,
        headExtra: [
          filterCell("track", false), filterCell("cup", false),
          filterCell("races", true), filterCell("nights", true), null, null,
        ],
        rows: shown.map((row) => {
          const asset = trackAsset(row.trackId);
          // A track is a door: its own page is behind it. The door is the name,
          // not the row, so it can be reached from the keyboard.
          const open = button({
            label: row.name, variant: "quiet", size: "sm",
            onPress: () => { openTrack(row.trackId); },
          });
          const name = el("span", "ds-tstats__cell-name", {});
          if (asset !== undefined) {
            name.append(el("img", "ds-tstats__icon", {
              src: `${GAME_ASSET_BASE}${asset.previewPath}`, alt: "", loading: "lazy",
              decoding: "async", "aria-hidden": "true",
            }));
          }
          name.append(open.root);
          const cup = el("span", "ds-tstats__cell-cup", {});
          if (asset !== undefined) {
            cup.append(el("img", "ds-tstats__icon ds-tstats__icon--cup", {
              src: `${GAME_ASSET_BASE}${asset.cup.iconPath}`, alt: "", loading: "lazy",
              decoding: "async", "aria-hidden": "true",
            }));
          }
          cup.append(el("span", "", {}, row.cupName));
          return {
            key: row.trackId,
            cells: [
              name, cup,
              formatCount(row.races, language()),
              formatCount(row.nights, language()),
              row.timeMs === null ? "—" : formatHours(row.timeMs),
              row.bestPlayerName === null
                ? "—"
                : `${row.bestPlayerName} · ${decimalText(row.bestScore ?? 0)}`,
            ],
          } satisfies DataRow;
        }),
      });
      tableRoot.replaceChildren(table);
    };
    paintTable();
    const tableBlock = disclosure({
      summary: localized(
        `All ${rows.length} tracks raced · sort and filter every column`,
        `Alle ${rows.length} gereden banen · sorteer en filter elke kolom`),
      open: tableOpen,
      children: [bar, tableRoot],
    });
    tableBlock.addEventListener("toggle", () => { tableOpen = (tableBlock as HTMLDetailsElement).open; });
    body.append(tableBlock);

    // The 96 tracks nobody has raced are part of the answer too.
    const unraced = 96 - statistics.totals.tracksRaced;
    if (unraced > 0) {
      body.append(el("p", "ds-tstats__note ds-micro", {}, localized(
        `${unraced} of the 96 tracks have never been raced in a tournament.`,
        `${unraced} van de 96 banen zijn nog nooit in een toernooi gereden.`,
      )));
    }
  };

  const pace = options.pace ?? (<T>(task: () => Promise<T>): Promise<T> => task());
  const ready = pace(() => client.load(controller.signal)).then((statistics) => {
    if (statistics === undefined) { return; }
    if (disposed) { return; }
    loaded = statistics;
    const rows = buildStatisticsRows(statistics);
    const driverMs = rows.reduce((sum, row) => sum + (row.timeMs ?? 0), 0);
    subtitle.textContent = localized(
      `${statistics.totals.races} races over ${statistics.totals.editions} nights · ${statistics.totals.tracksRaced} of 96 tracks · ${formatSpan(driverMs)} of racing`,
      `${statistics.totals.races} races over ${statistics.totals.editions} avonden · ${statistics.totals.tracksRaced} van 96 banen · ${formatSpan(driverMs)} racen`,
    );
    render();
    // A shared link that names a track, asks for these numbers, or simply
    // points at `#alle-races`, opens on them instead of at the top of a list
    // the sender was not talking about. The hash cannot do it by itself: the
    // browser looks for that id while the page is still empty.
    const asked = options.initial?.focus != null || options.scrollIntoView === true ||
      (document.defaultView?.location?.hash ?? "").replace("#", "") === STATISTICS_ANCHOR;
    if (asked) { showSection(); }
  }).catch(() => {
    if (disposed) { return; }
    subtitle.textContent = localized(
      "These numbers are temporarily unavailable.",
      "Deze cijfers zijn tijdelijk niet beschikbaar.",
    );
  });

  return {
    container: section,
    ready,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      controller.abort();
      if (section.parentNode === root) { root.removeChild(section); }
    },
  };
}

/**
 * The field, night by night. Sixteen people raced TN4; the last nights draw
 * thirty-odd, and that curve is the community's own story - so it is drawn as
 * one, with every night labelled and its number readable.
 *
 * The legend is a swatch and a word, never the colour's name: the moment the
 * appearance changes, "yellow" stops being true (the same decision the Android
 * twin took in Phase 11).
 */
function growthChart(document: Document, statistics: TournamentStatistics): HTMLElement {
  const block = el("div", "ds-tstats__growth", {});
  // The swatch carries the line's own colour, and the line the reader is looking at is solid while
  // the running total is dashed - so the two are told apart by shape as well as by hue.
  const legend = el("ul", "ds-legend", {},
    el("li", "ds-legend__item", {},
      el("span", "ds-legend__swatch", { "data-series": "2", "aria-hidden": "true" }),
      el("span", "", {}, localized("that night", "die avond"))),
    el("li", "ds-legend__item", {},
      el("span", "ds-legend__swatch ds-legend__swatch--dashed", { "data-series": "1", "aria-hidden": "true" }),
      el("span", "", {}, localized("everybody so far", "iedereen tot dan toe"))));
  block.append(
    el("h3", "ds-tstats__heading ds-micro", {}, localized("Players per night", "Spelers per avond")),
    legend,
  );
  const editions = statistics.editions;
  if (editions.length === 0) { return block; }
  const width = 640;
  const height = 220;
  const left = 34;
  const bottom = 28;
  // Two lines, two questions. How many people were *there* that night, and
  // how many have ever been - the second only ever climbs, and it is the one
  // that says the community grew rather than that one night was busy.
  const most = Math.max(
    ...editions.map((edition) => Math.max(edition.participantCount, edition.cumulativePlayers)),
    1,
  );
  const step = editions.length === 1 ? 0 : (width - left - 12) / (editions.length - 1);
  const x = (index: number): number => left + index * step;
  // The number of the tallest night is printed above its dot, so the top of
  // the frame is not the top of the scale - it read "36" with its head cut off.
  const top = 26;
  const y = (value: number): number => top + (height - bottom - top) * (1 - value / most);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "ds-tstats__svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", localized(
    `Players per night, from ${editions[0]?.participantCount ?? 0} to ${editions[editions.length - 1]?.participantCount ?? 0}`,
    `Spelers per avond, van ${editions[0]?.participantCount ?? 0} naar ${editions[editions.length - 1]?.participantCount ?? 0}`,
  ));
  const line = (x1: number, y1: number, x2: number, y2: number, className: string): void => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", "line");
    element.setAttribute("x1", String(x1));
    element.setAttribute("y1", String(y1));
    element.setAttribute("x2", String(x2));
    element.setAttribute("y2", String(y2));
    element.setAttribute("class", className);
    svg.append(element);
  };
  const text = (value: string, atX: number, atY: number, className: string): void => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", "text");
    element.setAttribute("x", String(atX));
    element.setAttribute("y", String(atY));
    element.setAttribute("class", className);
    element.textContent = value;
    svg.append(element);
  };
  // A rule every ten, hairline, and only those carry a number: a reader
  // counting people wants the tens, and a grid that shouts is a grid you read
  // instead of the lines on it.
  for (let value = 0; value <= most; value += 10) {
    line(left, y(value), width - 8, y(value), "ds-tstats__rule");
    text(String(value), 6, y(value) + 4, "ds-tstats__axis");
  }
  const seenPoints = editions.map((edition, index) => `${x(index)},${y(edition.cumulativePlayers)}`);
  const seenPath = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  seenPath.setAttribute("points", seenPoints.join(" "));
  seenPath.setAttribute("class", "ds-tstats__line ds-tstats__line--seen");
  svg.append(seenPath);
  const points = editions.map((edition, index) => `${x(index)},${y(edition.participantCount)}`);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  path.setAttribute("points", points.join(" "));
  path.setAttribute("class", "ds-tstats__line");
  svg.append(path);
  for (const [index, edition] of editions.entries()) {
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", String(x(index)));
    dot.setAttribute("cy", String(y(edition.cumulativePlayers)));
    dot.setAttribute("r", "3");
    dot.setAttribute("class", "ds-tstats__dot ds-tstats__dot--seen");
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = localized(
      `${edition.cumulativePlayers} Players had raced a tournament by TN${edition.editionNumber}`,
      `${edition.cumulativePlayers} spelers hadden na TN${edition.editionNumber} ooit meegedaan`,
    );
    dot.append(title);
    svg.append(dot);
  }
  // Every night's running total, not only the last: the point of the second
  // line is how it climbed, and that is the numbers along it.
  for (const [index, edition] of editions.entries()) {
    text(String(edition.cumulativePlayers), x(index) - 6,
      y(edition.cumulativePlayers) - 10,
      "ds-tstats__value ds-tstats__value--seen");
  }
  for (const [index, edition] of editions.entries()) {
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", String(x(index)));
    dot.setAttribute("cy", String(y(edition.participantCount)));
    dot.setAttribute("r", "4");
    dot.setAttribute("class", "ds-tstats__dot");
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = localized(
      `TN${edition.editionNumber}: ${edition.participantCount} players, ${edition.races} races`,
      `TN${edition.editionNumber}: ${edition.participantCount} spelers, ${edition.races} races`,
    );
    dot.append(title);
    svg.append(dot);
    // At the first night the two lines are the same fact - sixteen people
    // raced, sixteen people had ever raced - so it is printed once.
    if (edition.participantCount !== edition.cumulativePlayers) {
      // Where the two nearly touch - TN6 and TN7, twenty-nine ever against
      // twenty-three that night - the labels would sit on top of each other.
      // The night's own number goes under its dot there.
      const crowded = Math.abs(y(edition.cumulativePlayers) - y(edition.participantCount)) < 16;
      text(String(edition.participantCount), x(index) - 6,
        crowded ? y(edition.participantCount) + 16 : y(edition.participantCount) - 10,
        "ds-tstats__value");
    }
    // The last night's label is anchored at the frame's edge: `x - 12` ran "TN13" past the
    // viewBox and the browser clipped it to "TN1".
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", String(index === editions.length - 1 ? x(index) : x(index) - 12));
    label.setAttribute("y", String(height - 8));
    label.setAttribute("class", "ds-tstats__axis");
    if (index === editions.length - 1) { label.setAttribute("text-anchor", "end"); }
    label.textContent = `TN${edition.editionNumber}`;
    svg.append(label);
  }
  block.append(svg);
  const first = editions[0];
  const last = editions[editions.length - 1];
  if (first !== undefined && last !== undefined && first !== last) {
    const growth = last.participantCount - first.participantCount;
    block.append(el("p", "ds-tstats__note ds-micro", {}, productLanguage() === "nl"
      ? `Van ${first.participantCount} spelers op TN${first.editionNumber} naar ${last.participantCount} op TN${last.editionNumber}: ${growth >= 0 ? "+" : ""}${growth}. In totaal hebben ${last.cumulativePlayers} mensen ooit meegedaan.`
      : `From ${first.participantCount} players at TN${first.editionNumber} to ${last.participantCount} at TN${last.editionNumber}: ${growth >= 0 ? "+" : ""}${growth}. ${last.cumulativePlayers} people have raced one at some point.`));
  }
  return block;
}

/**
 * One track's standing: the Score TrueSkill gives each Player over that
 * track's races alone, from zero. Sorted the way it is earned.
 */
function trackSkillTable(
  skill: TrackSkill,
  viewerPlayerId: string | null,
  language: NumberLanguage,
): HTMLElement {
  const wrapper = el("div", "ds-tstats__skill", {});
  if (skill.players.length === 0) {
    wrapper.append(emptyState({
      title: localized(
        "Nobody has raced this track in a tournament yet.",
        "Deze baan is nog nooit in een toernooi gereden."),
    }));
    return wrapper;
  }
  const decimal = (value: number): string => value.toFixed(2).replace(".", language === "nl" ? "," : ".");
  const repeatedOnTrack = repeatedDisplayNames(skill.players);
  wrapper.append(dataTable({
    caption: localized("Track standing", "Baanklassement"),
    density: "dense",
    columns: [
      { key: "rank", label: "#", align: "rank", ch: rankColumnCh(skill.players.length, language) },
      { key: "player", label: localized("Player", "Speler"), align: "name" },
      { key: "score", label: localized("Track SP", "Baan-SP"), align: "num", phone: 1 },
      { key: "races", label: localized("Races", "Races"), align: "num", phone: 2 },
      { key: "wins", label: localized("Wins", "Winst"), align: "num", phone: 2 },
      { key: "top3", label: localized("Top 3", "Top 3"), align: "num", phone: 2 },
      { key: "average", label: localized("Average", "Gemiddeld"), align: "num", phone: 3, tablet: "drop" },
      { key: "best", label: localized("Best", "Beste"), align: "num", phone: 3, tablet: "drop" },
      { key: "sigma", label: localized("Certainty", "Zekerheid"), align: "num", phone: 3, tablet: "drop" },
    ],
    rows: skill.players.map((entry) => {
      const yours = viewerPlayerId !== null && entry.playerId === viewerPlayerId;
      const name = el("span", "ds-table__name-inner", {},
        el("a", "ds-tstats__player", { href: `/?player=${encodeURIComponent(entry.playerId)}`, title: entry.displayName },
          disambiguatedName(entry, repeatedOnTrack)));
      if (yours) { name.append(youChip(localized("You", "Jij"))); }
      return {
        key: entry.playerId,
        ...(yours ? { kind: "you" as const } : {}),
        podium: entry.rank,
        cells: [
          formatRank(entry.rank, language),
          name,
          decimal(entry.score),
          formatCount(entry.races, language),
          formatCount(entry.wins, language),
          formatCount(entry.top3, language),
          decimal(entry.averageFinish),
          formatCount(entry.bestFinish, language),
          // What the model still does not know: sigma, as the site writes it.
          `± ${decimal(entry.sigma)}`,
        ],
      } satisfies DataRow;
    }),
  }));
  wrapper.append(el("p", "ds-tstats__note ds-micro", {}, skill.racesSkipped === 0
    ? localized(
      `${skill.races} races counted on this track.`,
      `${skill.races} races geteld op deze baan.`)
    : localized(
      `${skill.races} races counted; ${skill.racesSkipped} left out because their finishing order was incomplete.`,
      `${skill.races} races geteld; ${skill.racesSkipped} overgeslagen omdat de finishorde niet compleet was.`)));
  return wrapper;
}

/** Five cups on their own tiles: the mark, the name and what it has taken. */
function cupTiles(cups: readonly CupTotal[], language: NumberLanguage): HTMLElement {
  const grid = el("ol", "ds-tstats__tiles", {});
  for (const [index, cup] of cups.entries()) {
    const tile = el("li", "ds-tstats__tile", { "data-kind": "cup" },
      el("span", "ds-tstats__tile-rank ds-data", {}, formatRank(index + 1, language)));
    if (cup.iconPath !== null) {
      tile.append(el("img", "ds-tstats__tile-icon", {
        src: `${GAME_ASSET_BASE}${cup.iconPath}`, alt: "", loading: "lazy", decoding: "async",
        "aria-hidden": "true",
      }));
    }
    tile.append(
      el("span", "ds-tstats__tile-name", {}, cup.cupName),
      el("span", "ds-tstats__tile-amount ds-data-m", {}, `${formatCount(cup.races, language)} races`),
      el("span", "ds-tstats__tile-note ds-micro", {}, localized(
        `${cup.tracks} tracks · ${cup.drivers} drivers`,
        `${cup.tracks} banen · ${cup.drivers} deelnames`)),
    );
    grid.append(tile);
  }
  return el("div", "ds-tstats__tiles-block", {},
    el("h3", "ds-tstats__heading ds-micro", {}, localized("Most raced cups", "Meest gereden cups")),
    grid);
}

/** Every cup, with its numbers, behind a box. */
function cupBox(cups: readonly CupTotal[], language: NumberLanguage): HTMLElement {
  return disclosure({
    summary: localized(
      `All ${cups.length} cups · races, tracks and drivers per cup`,
      `Alle ${cups.length} cups · races, banen en deelnames per cup`),
    children: [dataTable({
      caption: localized("Every cup", "Elke cup"),
      density: "dense",
      columns: [
        { key: "cup", label: localized("Cup", "Cup"), align: "name" },
        { key: "races", label: localized("Races", "Races"), align: "num", phone: 1 },
        { key: "tracks", label: localized("Tracks", "Banen"), align: "num", phone: 2 },
        { key: "drivers", label: localized("Drivers", "Deelnames"), align: "num", phone: 2 },
        { key: "time", label: localized("Racing time", "Racetijd"), align: "num", phone: 3 },
      ],
      rows: cups.map((cup) => {
        const name = el("span", "ds-tstats__cell-cup", {});
        if (cup.iconPath !== null) {
          name.append(el("img", "ds-tstats__icon ds-tstats__icon--cup", {
            src: `${GAME_ASSET_BASE}${cup.iconPath}`, alt: "", loading: "lazy", decoding: "async",
            "aria-hidden": "true",
          }));
        }
        name.append(el("span", "", {}, cup.cupName));
        return {
          key: cup.cupName,
          cells: [
            name,
            formatCount(cup.races, language),
            formatCount(cup.tracks, language),
            formatCount(cup.drivers, language),
            cup.timeMs === 0 ? "—" : formatHours(cup.timeMs),
          ],
        } satisfies DataRow;
      }),
    })],
  });
}

/** Five tracks on their own pictures, each one a door to its own page. */
function trackTiles(
  rows: readonly StatisticsRow[],
  open: (trackId: string) => void,
  language: NumberLanguage,
): HTMLElement {
  const grid = el("ol", "ds-tstats__tiles", {});
  for (const [index, row] of rows.entries()) {
    const asset = trackAsset(row.trackId);
    const door = el("button", "ds-tstats__tile-button", { type: "button" });
    door.addEventListener("click", () => { open(row.trackId); });
    if (asset !== undefined) {
      door.append(el("img", "ds-tstats__tile-picture", {
        src: `${GAME_ASSET_BASE}${asset.previewPath}`, alt: "", loading: "lazy", decoding: "async",
        "aria-hidden": "true",
      }));
    }
    door.append(
      el("span", "ds-tstats__tile-rank ds-data", {}, formatRank(index + 1, language)),
      el("span", "ds-tstats__tile-name", {}, row.name),
      el("span", "ds-tstats__tile-amount ds-data-m", {}, `${formatCount(row.races, language)} races`),
      el("span", "ds-tstats__tile-note ds-micro", {}, row.bestPlayerName === null
        ? localized(`${row.nights} nights`, `${row.nights} avonden`)
        : localized(`Best: ${row.bestPlayerName}`, `Beste: ${row.bestPlayerName}`)),
    );
    grid.append(el("li", "ds-tstats__tile", { "data-kind": "track" }, door));
  }
  return el("div", "ds-tstats__tiles-block", {},
    el("h3", "ds-tstats__heading ds-micro", {}, localized("Most raced tracks", "Meest gereden banen")),
    grid);
}
