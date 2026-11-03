// The Tournament Ranking, written down.
//
// A reader who has set the table the way they want it - three races or more,
// sorted by win percentage, next to two other Players - wants to send that,
// not describe it. So the page's state lives in the address: every filter,
// the sort, whether the table is open, whose record it is and who it is being
// compared against.
//
// The names are meant to be typed by hand as well as copied. A filter is
// `f_` and the column: `f_raced=>3`, `f_win=>=50`, `f_cup=Blad`. The sort is
// the column and a direction: `sort=win&dir=asc`. The rest reads as it says.

import type { FilterKey, SortKey } from "./tournament-track-section.js";

/** The columns a reader can filter, and the query name each one answers to. */
export const TRACK_FILTER_PARAMETERS: ReadonlyArray<readonly [FilterKey, string]> = [
  ["track", "f_track"],
  ["cup", "f_cup"],
  ["races", "f_raced"],
  ["wins", "f_won"],
  ["best", "f_best"],
  ["average", "f_average"],
  ["win", "f_win"],
];

const SORT_KEYS: ReadonlyArray<SortKey> = ["track", "races", "wins", "best", "average", "win"];

/** The sort column as it is written in a link: "raced", not "races". */
const SORT_NAMES: Readonly<Record<SortKey, string>> = {
  track: "track", races: "raced", wins: "won", best: "best", average: "average", win: "win",
};

export type TournamentStandingLink = Readonly<{
  /** Username or Player id of the Player whose record is being read. */
  player: string | null;
  /** Usernames or Player ids this record is being compared against. */
  compare: readonly string[];
  /** Whether the all-tracks table is open. */
  tracksOpen: boolean;
  sort: SortKey | null;
  descending: boolean | null;
  filters: Readonly<Partial<Record<FilterKey, string>>>;
}>;

export const EMPTY_TOURNAMENT_STANDING_LINK: TournamentStandingLink = {
  player: null, compare: [], tracksOpen: false, sort: null, descending: null, filters: {},
};

/** A name in a link: a username or a Player id, nothing else. */
function reference(value: string): string | null {
  const trimmed = value.trim();
  return /^[A-Za-z0-9._-]{1,140}$/.test(trimmed) ? trimmed : null;
}

export function readTournamentStandingLink(search: string): TournamentStandingLink {
  const query = new URLSearchParams(search);
  const filters: Partial<Record<FilterKey, string>> = {};
  for (const [key, name] of TRACK_FILTER_PARAMETERS) {
    const value = query.get(name);
    // A filter is free text the table itself parses; only its length is ours
    // to bound, so a pasted essay cannot become a filter.
    if (value !== null && value.trim() !== "") { filters[key] = value.slice(0, 40); }
  }
  const sortName = query.get("sort");
  const sort = SORT_KEYS.find((key) => SORT_NAMES[key] === sortName) ?? null;
  const direction = query.get("dir");
  return {
    player: query.get("player") === null ? null : reference(query.get("player")!),
    compare: (query.get("compare") ?? "")
      .split(",")
      .map((entry) => reference(entry))
      .filter((entry): entry is string => entry !== null)
      .slice(0, 4),
    // The table opens when the reader asked for it, and also when they sent a
    // link that only makes sense with it open.
    tracksOpen: query.get("tracks") === "open" || sort !== null || Object.keys(filters).length > 0,
    sort,
    descending: direction === "asc" ? false : direction === "desc" ? true : null,
    filters,
  };
}

/**
 * The link for the state the page is in. Everything at its default is left
 * out, so an untouched page keeps the short address it was opened with.
 */
export function writeTournamentStandingLink(
  search: string,
  state: TournamentStandingLink,
): string {
  const query = new URLSearchParams(search);
  query.set("ranking", "tournament");
  const set = (name: string, value: string | null): void => {
    if (value === null || value === "") { query.delete(name); } else { query.set(name, value); }
  };
  set("player", state.player);
  set("compare", state.compare.length === 0 ? null : state.compare.join(","));
  set("tracks", state.tracksOpen ? "open" : null);
  set("sort", state.sort === null ? null : SORT_NAMES[state.sort]);
  set("dir", state.descending === null ? null : state.descending ? "desc" : "asc");
  for (const [key, name] of TRACK_FILTER_PARAMETERS) {
    set(name, state.filters[key] ?? null);
  }
  return query.toString();
}
