// Which tracks a Player is strong on, and which ones they should practise.
//
// The measure is not the raw average finish. Sixth place means one thing in a
// group of twelve and another in a group of ten, and something else again
// depending on the division somebody was in that season - so a track is shown
// against that player's own normal, as a share of the field. "12% better than
// your usual" survives a move between divisions; "average finish 3.1" does not.
//
// Two lists rather than one ranking, because the question is really two
// questions: what to lean on, and what to work on. A track needs a few races
// before it says anything, and the threshold is stated on the card rather than
// hidden, because a single lucky win would otherwise top the list.
//
// Underneath sits every track in the game, not only the ones somebody raced.
// A record that lists only what you have done cannot answer "which have I
// never touched", which is often the more useful half. There the measure is a
// plain win percentage - first is 100, last is 0, and a field of ten scores
// the same as a field of twelve, so tenth of ten, eleventh of eleven and
// twelfth of twelve are all zero.

import { allTrackAssets, GAME_ASSET_BASE, trackAsset } from "./asset-manifest.js";
import { localized } from "./product-language.js";
import { panel, useDocument } from "./ds-components.js";
import { trackThumb } from "./track-thumb.js";
import { tournamentTrackSkillHref } from "./tournament-statistics-view.js";
import {
  createTournamentTrackClient,
  type TournamentTrackClient,
  type TrackRecord,
  type TrackRecordEntry,
} from "./tournament-track-client.js";

export type MountedTournamentTracks = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

/**
 * Below this a track has not been raced often enough to mean anything: one
 * good night on Baby Park is a good night, not a strength.
 */
export const MINIMUM_RACES_FOR_A_VERDICT = 3;

const LIST_LENGTH = 4;

/**
 * The share of the field a player finished ahead of, as a percentage: first is
 * 100, last is 0, and a field of ten scores the same as a field of twelve.
 * Tenth of ten, eleventh of eleven and twelfth of twelve are all 0.
 */
export function winPercentage(averageFieldShare: number): number {
  return (1 - averageFieldShare) * 100;
}

export type TrackRow = Readonly<{
  trackId: string;
  /** Position in the game's own cup order, which is how players think. */
  trackIndex: number;
  name: string;
  cupName: string;
  races: number;
  wins: number;
  /** Null where the track has never been raced. */
  winPercentage: number | null;
  averageFinish: number | null;
  bestFinish: number | null;
}>;

export type SortKey =
  | "track" | "races" | "wins" | "best" | "average" | "win";

/**
 * Which way a column reads on its first click. Most columns want their best
 * value first, and for a finishing position "best" is the small number: a
 * first place is a 1. Sorting those largest-first would open on somebody's
 * worst track, which is never what the click meant.
 */
export const SORT_OPENS_DESCENDING: Readonly<Record<SortKey, boolean>> = {
  track: false, races: true, wins: true, best: false, average: false, win: true,
};

/** The value a column ranks on, for a track that has actually been raced. */
function sortValue(row: TrackRow, key: SortKey): number {
  switch (key) {
    case "races": return row.races;
    case "wins": return row.wins;
    // A raced track without a recorded finish sorts behind the ones that have
    // one, in either direction, rather than pretending to be a first place.
    case "best": return row.bestFinish ?? Number.MAX_SAFE_INTEGER;
    case "average": return row.averageFinish ?? Number.MAX_SAFE_INTEGER;
    default: return row.winPercentage ?? 0;
  }
}

/**
 * Every track in the game, whether it was raced or not. A record that only
 * lists what somebody has done cannot answer "which ones have I never
 * touched", which is usually what a player is actually looking for.
 */
export function buildTrackRows(
  tracks: readonly TrackRecordEntry[],
): readonly TrackRow[] {
  const raced = new Map(tracks.map((track) => [track.trackId, track]));
  const rows: TrackRow[] = [];
  for (const [trackIndex, asset] of allTrackAssets().entries()) {
    const track = raced.get(asset.id);
    rows.push({
      trackId: asset.id,
      trackIndex,
      name: asset.name,
      cupName: asset.cup.name,
      races: track?.races ?? 0,
      wins: track?.wins ?? 0,
      winPercentage: track === undefined
        ? null : winPercentage(track.averageFieldShare),
      averageFinish: track?.averageFinish ?? null,
      bestFinish: track?.bestFinish ?? null,
    });
  }
  return rows;
}

export type FilterKey = SortKey | "cup";

/**
 * One filter box per column. Track and Cup match on "contains"; the number
 * columns read an operator in front of a number - `> 3`, `<= 2`, `= 1`,
 * `<> 0` - and a bare number means "equals". A track that has no value in
 * that column (never raced, no recorded finish) never matches a number
 * filter, so filtering on Win % hides the unraced tracks by itself.
 */
export type TrackFilters = Readonly<Partial<Record<FilterKey, string>>>;

export type NumericFilter = Readonly<{
  operator: "=" | "<>" | ">" | ">=" | "<" | "<=";
  value: number;
}>;

/** `>= 3` → { ">=", 3 }; `3` → { "=", 3 }; an unreadable box means no filter. */
export function parseNumericFilter(text: string): NumericFilter | null {
  const match = /^\s*(>=|<=|<>|!=|=|>|<)?\s*(-?\d+(?:[.,]\d+)?)\s*%?\s*$/u.exec(text);
  if (match === null) { return null; }
  const value = Number(match[2]!.replace(",", "."));
  if (!Number.isFinite(value)) { return null; }
  const operator = match[1] === undefined ? "=" : match[1] === "!=" ? "<>" : match[1];
  return { operator: operator as NumericFilter["operator"], value };
}

function numericMatches(candidate: number | null, filter: NumericFilter): boolean {
  if (candidate === null) { return false; }
  const rounded = Math.round(candidate * 10) / 10;
  switch (filter.operator) {
    case "=": return rounded === filter.value;
    case "<>": return rounded !== filter.value;
    case ">": return rounded > filter.value;
    case ">=": return rounded >= filter.value;
    case "<": return rounded < filter.value;
    default: return rounded <= filter.value;
  }
}

function filterValue(row: TrackRow, key: SortKey): number | null {
  switch (key) {
    case "races": return row.races;
    case "wins": return row.wins;
    case "best": return row.bestFinish;
    case "average": return row.averageFinish;
    case "win": return row.winPercentage === null ? null : Math.round(row.winPercentage);
    default: return null;
  }
}

export function filterTrackRows(
  rows: readonly TrackRow[], filters: TrackFilters,
): readonly TrackRow[] {
  const contains = (haystack: string, needle: string | undefined): boolean =>
    needle === undefined || needle.trim() === "" ||
    haystack.toLocaleLowerCase().includes(needle.trim().toLocaleLowerCase());
  const numeric = (["races", "wins", "best", "average", "win"] as const)
    .map((key) => [key, parseNumericFilter(filters[key] ?? "")] as const)
    .filter((pair): pair is readonly [typeof pair[0], NumericFilter] => pair[1] !== null);
  return rows.filter((row) =>
    contains(row.name, filters.track) &&
    contains(row.cupName, filters.cup) &&
    numeric.every(([key, filter]) => numericMatches(filterValue(row, key), filter)));
}

/**
 * The colour a win percentage reads in: 100 light green, 50 yellow, 0 red -
 * one hue sweep, so 75 is yellow-green and 25 orange. Light enough that the
 * figure stays readable in dark text on top of it.
 */
export function winPercentageColor(percentage: number): string {
  const bounded = Math.max(0, Math.min(100, percentage));
  const hue = Math.round(bounded * 1.2);
  return `hsl(${hue} 78% 68%)`;
}

/**
 * The track column sorts on the game's own order - cup by cup, in the order
 * they appear on the console - not alphabetically. That is how somebody
 * actually looks for a track.
 *
 * The other columns always put a track that was never raced last, whichever
 * direction is chosen: an unraced track has no win percentage, and letting it
 * sort as zero would bury the tracks somebody is genuinely bad at underneath
 * the ones they have simply never seen.
 */
export function sortTrackRows(
  rows: readonly TrackRow[], key: SortKey, descending: boolean,
): readonly TrackRow[] {
  const sorted = [...rows];
  sorted.sort((left, right) => {
    if (key === "track") {
      return descending
        ? right.trackIndex - left.trackIndex
        : left.trackIndex - right.trackIndex;
    }
    const leftRaced = left.races > 0;
    const rightRaced = right.races > 0;
    if (leftRaced !== rightRaced) { return leftRaced ? -1 : 1; }
    const leftValue = sortValue(left, key);
    const rightValue = sortValue(right, key);
    if (leftValue !== rightValue) {
      return descending ? rightValue - leftValue : leftValue - rightValue;
    }
    return left.trackIndex - right.trackIndex;
  });
  return sorted;
}

function signedPercentage(share: number): string {
  const percent = Math.round(Math.abs(share) * 100);
  if (percent === 0) { return localized("on par", "gelijk"); }
  return share < 0
    ? localized(`${percent}% better`, `${percent}% beter`)
    : localized(`${percent}% worse`, `${percent}% slechter`);
}

/** What a link can say about this table, and what it says back when it moves. */
export type TrackTableState = Readonly<{
  open: boolean;
  sort: SortKey;
  descending: boolean;
  filters: Readonly<Partial<Record<FilterKey, string>>>;
}>;

export function mountTournamentTracks(
  root: HTMLElement,
  playerId: string,
  playerName: string,
  client: TournamentTrackClient = createTournamentTrackClient(),
  options: Readonly<{
    /** How the table was left, or how a shared link asked for it. */
    initial?: Readonly<{
      open?: boolean;
      sort?: SortKey | null;
      descending?: boolean | null;
      filters?: Readonly<Partial<Record<FilterKey, string>>>;
    }>;
    /** Called whenever the reader opens, sorts or filters it. */
    onStateChange?: (state: TrackTableState) => void;
    /** The address for the view as it stands, for the copy button. */
    shareLink?: () => string;
  }> = {},
): MountedTournamentTracks {
  const document = root.ownerDocument;
  const controller = new AbortController();
  let disposed = false;

  useDocument(document);
  const body = document.createElement("div");
  body.className = "track-record__body";
  const status = document.createElement("p");
  status.className = "ds-body-s";
  status.setAttribute("role", "status");
  status.textContent = localized("Loading track record…", "Baanrecord laden…");
  body.append(status);
  // A LOW route spends no colour on a panel: the section is the design system's one grouped
  // surface, and what used to be a coloured rule is now just its title.
  const container = panel({
    title: localized("Tracks", "Banen"), titleLevel: 2, children: [body],
  });
  container.classList.add("track-record");
  root.append(container);

  const clear = (element: HTMLElement): void => {
    while (element.firstChild !== null) {
      element.removeChild(element.firstChild);
    }
  };

  const renderRow = (
    parent: HTMLElement, track: TrackRecordEntry, strong: boolean,
  ): void => {
    const row = document.createElement("li");
    row.className = "track-record__row";
    // The same thumb the Home activity list uses: artwork with the cup mark
    // and the track name laid over it. This row is now in every selector list
    // that un-hides that artwork inside the timing-tower shell, which is what
    // it was missing the first time - the component was right, the row simply
    // was not one of the layouts allowed to show it.
    const thumb = trackThumb(document, {
      trackId: track.trackId, mode: 150, compact: true,
      // The cup mark already identifies the cup here. Keeping its name on a
      // second overlay line only steals room from the track name in this
      // deliberately compact comparison list.
      showCupName: false,
      // The tournament side first: this row is about tournament races, so it
      // opens the track's TrueSkill page, which links on to the time-trial
      // board (owner, 2026-09-16).
      href: tournamentTrackSkillHref(track.trackId),
    });
    if (thumb !== null) { row.append(thumb); }

    const text = document.createElement("div");
    text.className = "track-record__text";
    const name = document.createElement("a");
    name.className = "track-record__name";
    name.href = tournamentTrackSkillHref(track.trackId);
    name.textContent = trackAsset(track.trackId)?.name ?? track.trackId;
    const facts = document.createElement("span");
    facts.className = "track-record__facts";
    const average = track.averageFinish.toFixed(1);
    facts.textContent = localized(
      `${track.races} races · average ${average}` +
      (track.wins > 0 ? ` · ${track.wins} won` : ""),
      `${track.races} races · gemiddeld ${average}` +
      (track.wins > 0 ? ` · ${track.wins}x gewonnen` : ""),
    );
    text.append(name, facts);

    const verdict = document.createElement("span");
    verdict.className = strong
      ? "track-record__verdict track-record__verdict--strong"
      : "track-record__verdict track-record__verdict--weak";
    verdict.textContent = signedPercentage(track.relativeToOwnAverage);
    row.append(text, verdict);
    parent.append(row);
  };

  const renderList = (
    parent: HTMLElement, heading: string, hint: string,
    tracks: readonly TrackRecordEntry[], strong: boolean,
  ): void => {
    const column = document.createElement("div");
    column.className = "track-record__column";
    // The panel's own title is an h2, so the two lists are h3: no level is skipped.
    const label = document.createElement("h3");
    label.className = "track-record__heading";
    label.textContent = heading;
    const note = document.createElement("p");
    note.className = "track-record__hint";
    note.textContent = hint;
    const list = document.createElement("ul");
    list.className = "track-record__list";
    for (const track of tracks) { renderRow(list, track, strong); }
    column.append(label, note, list);
    parent.append(column);
  };

  // Opens on how often a track was raced, not on win percentage. Sorted by
  // percentage the table leads with whatever somebody won once, which is true
  // and useless; opening on races puts the tracks they actually know first.
  //
  // A shared link overrules all of that: whoever sent it had set the table.
  let sortKey: SortKey = options.initial?.sort ?? "races";
  let sortDescending = options.initial?.descending ?? SORT_OPENS_DESCENDING[sortKey];
  const filters: Partial<Record<FilterKey, string>> = { ...options.initial?.filters };
  let tableOpen = options.initial?.open === true;
  const announce = (): void => {
    options.onStateChange?.({
      open: tableOpen, sort: sortKey, descending: sortDescending, filters: { ...filters },
    });
  };

  const renderDeepDive = (
    parent: HTMLElement, tracks: readonly TrackRecordEntry[],
  ): void => {
    // A panel of its own, not a line of underlined text. It holds the whole
    // 96-track table with a filter under every column, and it read as a
    // footnote: the owner could not see that it opened.
    const details = document.createElement("details");
    details.className = "track-record__deep-dive";
    details.open = tableOpen;
    const summary = document.createElement("summary");
    summary.className = "track-record__deep-dive-summary";
    const rows = buildTrackRows(tracks);
    const raced = rows.filter((row) => row.races > 0).length;
    const heading = document.createElement("span");
    heading.className = "track-record__deep-dive-title";
    heading.textContent = localized(`All ${rows.length} tracks`, `Alle ${rows.length} banen`);
    const subtitle = document.createElement("span");
    subtitle.className = "track-record__deep-dive-subtitle";
    subtitle.textContent = localized(
      `${raced} raced · sort and filter every column`,
      `${raced} gereden · sorteer en filter elke kolom`,
    );
    const phoneTitle = document.createElement("span");
    phoneTitle.className = "track-record__deep-dive-phone-title";
    const updatePhoneTitle = (): void => {
      phoneTitle.textContent = localized(
        `${details.open ? "Hide" : "Show"} all ${rows.length} tracks — ${raced} raced`,
        `${details.open ? "Verberg" : "Toon"} alle ${rows.length} banen — ${raced} gereden`,
      );
    };
    updatePhoneTitle();
    const chevron = document.createElement("span");
    chevron.className = "track-record__deep-dive-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "▾";
    const headingBlock = document.createElement("span");
    headingBlock.className = "track-record__deep-dive-heading";
    headingBlock.append(heading, subtitle, phoneTitle);
    summary.append(headingBlock, chevron);
    details.addEventListener("toggle", () => {
      tableOpen = details.open;
      updatePhoneTitle();
      announce();
    });
    const scroller = document.createElement("div");
    scroller.className = "track-record__scroller";
    const count = document.createElement("p");
    count.className = "track-record__count";
    count.setAttribute("role", "status");
    const bar = document.createElement("div");
    bar.className = "track-record__deep-dive-bar";
    bar.append(count);
    // The address already carries the filters and the sort, but on a phone
    // nobody can see the address bar. So the table hands the link over.
    const share = options.shareLink;
    if (share !== undefined) {
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "track-record__share";
      const label = localized("🔗 Copy this view", "🔗 Kopieer deze weergave");
      copy.textContent = label;
      copy.addEventListener("click", () => {
        void document.defaultView?.navigator.clipboard?.writeText(share())
          .then(
            () => { copy.textContent = localized("Copied", "Gekopieerd"); },
            () => { copy.textContent = localized("Copying failed", "Kopiëren mislukt"); },
          )
          .then(() => {
            document.defaultView?.setTimeout(() => { copy.textContent = label; }, 2_000);
          });
      });
      bar.append(copy);
    }
    details.append(summary, bar, scroller);
    parent.append(details);

    const paintTable = (): void => {
      clear(scroller);
      const table = document.createElement("table");
      table.className = "track-record__table";
      const head = document.createElement("thead");
      const headRow = document.createElement("tr");
      const columns: ReadonlyArray<Readonly<{
        label: string; key: SortKey | null; filter: FilterKey; numeric: boolean;
      }>> = [
        { label: localized("Track", "Baan"), key: "track", filter: "track", numeric: false },
        { label: localized("Cup", "Cup"), key: null, filter: "cup", numeric: false },
        { label: localized("Raced", "Gereden"), key: "races", filter: "races", numeric: true },
        { label: localized("Won", "Gewonnen"), key: "wins", filter: "wins", numeric: true },
        { label: localized("Best", "Beste"), key: "best", filter: "best", numeric: true },
        { label: localized("Average", "Gemiddeld"), key: "average", filter: "average", numeric: true },
        { label: localized("Win %", "Winst %"), key: "win", filter: "win", numeric: true },
      ];
      for (const column of columns) {
        const cell = document.createElement("th");
        cell.scope = "col";
        if (column.key === null) {
          cell.textContent = column.label;
        } else {
          const active = sortKey === column.key;
          cell.setAttribute("aria-sort", active
            ? (sortDescending ? "descending" : "ascending")
            : "none");
          const button = document.createElement("button");
          button.type = "button";
          button.className = "ds-sort";
          button.setAttribute("data-direction", active
            ? (sortDescending ? "descending" : "ascending") : "none");
          button.textContent = `${column.label} ${active ? (sortDescending ? "▼" : "▲") : "↕"}`;
          const key = column.key;
          button.addEventListener("click", () => {
            if (sortKey === key) {
              sortDescending = !sortDescending;
            } else {
              sortKey = key;
              sortDescending = SORT_OPENS_DESCENDING[key];
            }
            announce();
            paintTable();
          });
          cell.append(button);
        }
        headRow.append(cell);
      }
      head.append(headRow);

      // One filter box under each heading. Typing repaints the rows only, so
      // the box keeps its focus and its caret.
      const filterRow = document.createElement("tr");
      filterRow.className = "track-record__filter-row";
      for (const column of columns) {
        const cell = document.createElement("th");
        cell.scope = "col";
        const input = document.createElement("input");
        input.type = "search";
        input.className = "track-record__filter";
        input.value = filters[column.filter] ?? "";
        input.placeholder = column.numeric ? "> 3" : localized("contains…", "bevat…");
        input.setAttribute("aria-label", column.numeric
          ? localized(`Filter ${column.label}: = > < and a number`, `Filter ${column.label}: = > < en een getal`)
          : localized(`Filter ${column.label}: contains`, `Filter ${column.label}: bevat`));
        input.addEventListener("input", () => {
          filters[column.filter] = input.value;
          announce();
          paintRows();
        });
        cell.append(input);
        filterRow.append(cell);
      }
      head.append(filterRow);

      const bodyElement = document.createElement("tbody");
      const paintRows = (): void => {
        clear(bodyElement);
        const shown = filterTrackRows(sortTrackRows(rows, sortKey, sortDescending), filters);
        count.textContent = shown.length === rows.length
          ? localized(`${rows.length} tracks`, `${rows.length} banen`)
          : localized(`${shown.length} of ${rows.length} tracks`, `${shown.length} van ${rows.length} banen`);
        for (const row of shown) {
          const line = document.createElement("tr");
          if (row.races === 0) { line.className = "track-record__table-unraced"; }
          const asset = trackAsset(row.trackId);
          const values: readonly string[] = [
            row.name,
            row.cupName,
            row.races === 0 ? "—" : String(row.races),
            row.wins === 0 ? "—" : String(row.wins),
            row.bestFinish === null ? "—" : String(row.bestFinish),
            row.averageFinish === null ? "—" : row.averageFinish.toFixed(1),
            row.winPercentage === null
              ? localized("never raced", "nooit gereden")
              : `${Math.round(row.winPercentage)}%`,
          ];
          for (const [index, value] of values.entries()) {
            const cell = document.createElement(index === 0 ? "th" : "td");
            if (index === 0) { cell.scope = "row"; }
            if (index <= 1 && asset !== undefined) {
              // The same pictures the game shows: the track's own picture and
              // the cup's mark, so a row can be found without reading it.
              const icon = document.createElement("img");
              icon.className = index === 0 ? "track-record__track-icon" : "track-record__cup-icon";
              icon.src = `${GAME_ASSET_BASE}${index === 0 ? asset.previewPath : asset.cup.iconPath}`;
              icon.alt = "";
              icon.loading = "lazy";
              icon.decoding = "async";
              const label = document.createElement("span");
              label.textContent = value;
              if (index === 0) {
                // The picture and the name are the link, the numbers beside
                // them are not (owner's choice, 2026-09-16).
                const open = document.createElement("a");
                open.className = "track-record__track-link";
                open.setAttribute("href", tournamentTrackSkillHref(row.trackId));
                const thumb = document.createElement("span");
                thumb.className = "track-record__thumb";
                thumb.append(icon);
                if (row.races > 0) {
                  const mode = document.createElement("span");
                  mode.className = "track-record__track-mode";
                  mode.setAttribute("aria-hidden", "true");
                  thumb.append(mode);
                }
                open.append(thumb, label);
                cell.append(open);
              } else {
                cell.append(icon, label);
              }
            } else {
              cell.textContent = value;
            }
            if (index === 6 && row.winPercentage !== null) {
              cell.className = "track-record__win";
              cell.style.setProperty("--win-color", winPercentageColor(row.winPercentage));
            }
            line.append(cell);
          }
          bodyElement.append(line);
        }
      };
      paintRows();
      table.append(head, bodyElement);
      scroller.append(table);
    };
    paintTable();
  };

  const render = (record: TrackRecord): void => {
    clear(body);
    const judged = record.tracks.filter(
      (track) => track.races >= MINIMUM_RACES_FOR_A_VERDICT);

    if (record.racesWithTrack === 0) {
      const empty = document.createElement("p");
      empty.className = "ds-body-s";
      empty.textContent = localized(
        `No tournament race of ${playerName} was recorded on video, so there ` +
        "is no track detail yet.",
        `Van ${playerName} is geen enkele toernooirace op video vastgelegd, ` +
        "dus er is nog geen baandetail.",
      );
      body.append(empty);
      return;
    }

    if (judged.length === 0) {
      const thin = document.createElement("p");
      thin.className = "ds-body-s";
      thin.textContent = localized(
        `${playerName} has not raced any track ${MINIMUM_RACES_FOR_A_VERDICT}` +
        " times yet, which is too thin to call a strength.",
        `${playerName} heeft nog geen baan ${MINIMUM_RACES_FOR_A_VERDICT} keer` +
        " gereden; dat is te weinig om er iets over te zeggen.",
      );
      body.append(thin);
      renderDeepDive(body, record.tracks);
      return;
    }

    const columns = document.createElement("div");
    columns.className = "track-record__columns";
    renderList(
      columns,
      localized("Strongest", "Sterkste banen"),
      localized(
        "Better than this player's own average finish.",
        "Beter dan het eigen gemiddelde van deze speler.",
      ),
      judged.slice(0, LIST_LENGTH), true,
    );
    renderList(
      columns,
      localized("Worth practising", "Hier valt te winnen"),
      localized(
        "Where the same player loses most ground.",
        "Waar dezelfde speler het meeste terrein verliest.",
      ),
      judged.slice(-LIST_LENGTH).reverse(), false,
    );
    body.append(columns);

    const note = document.createElement("p");
    note.className = "ds-body-s track-record__note--desktop";
    const missing = record.racesWithoutTrack;
    note.textContent = localized(
      `Measured over ${record.racesWithTrack} tournament races whose track is ` +
      `known, from ${MINIMUM_RACES_FOR_A_VERDICT} races per track. ` +
      (missing === 0
        ? "Every counted race carries a track."
        : `${missing} further races have no recording, so no track.`),
      `Gemeten over ${record.racesWithTrack} toernooiraces waarvan de baan ` +
      `bekend is, vanaf ${MINIMUM_RACES_FOR_A_VERDICT} races per baan. ` +
      (missing === 0
        ? "Van elke meegetelde race is de baan bekend."
        : `Van ${missing} races bestaat geen opname, dus geen baan.`),
    );
    body.append(note);
    renderDeepDive(body, record.tracks);
    const phoneNote = document.createElement("p");
    phoneNote.className = "ds-body-s track-record__note--phone";
    phoneNote.textContent = localized(
      `Over ${record.racesWithTrack} races whose track is known` +
      (missing === 0 ? "." : `; ${missing} more have no recording.`),
      `Over ${record.racesWithTrack} races waarvan de baan bekend is` +
      (missing === 0 ? "." : `; van ${missing} meer bestaat geen opname.`),
    );
    body.append(phoneNote);
  };

  const ready = client.record(playerId, controller.signal)
    .then((record) => {
      if (disposed) { return; }
      render(record);
    })
    .catch(() => {
      if (disposed) { return; }
      status.textContent = localized(
        "The track record is temporarily unavailable.",
        "Het baanrecord is tijdelijk niet beschikbaar.",
      );
    });

  return {
    container,
    ready,
    unmount() {
      disposed = true;
      controller.abort();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}
