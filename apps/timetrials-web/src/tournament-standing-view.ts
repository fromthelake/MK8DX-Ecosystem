// The Tournament half of Ranking.
//
// Time Trials answers "how fast are you" against a clock. This answers "how do
// you do against people", which needs different facts: the skill the rating
// gives you, how often you actually win a race, where your finishes land, and
// who you keep running into on a race night.
//
// The shape follows the APK's Rank console: titled cards with a coloured rule,
// one question per card, and a table that scrolls inside itself rather than
// pushing the page sideways.

import {
  createTournamentStandingClient,
  FINISH_POSITIONS,
  type TournamentRivalry,
  type TournamentSharedRaces,
  type TournamentStandingClient,
  type TournamentStandingEntry,
} from "./tournament-standing-client.js";
import { localized, productLanguage } from "./product-language.js";
import {
  barChart, button, chip, dataTable, emptyState, errorState, field, filterSheet, filterSummary,
  heroRank, panel, segmentBar, statBlock, statGrid, tierChip, toggleChip, useDocument, valueBar,
  youChip, type DataRow, type OverlayHandle,
} from "./ds-components.js";
import {
  formatCount, formatRank, TRUE_MINUS, type NumberLanguage,
} from "./ds-numeric.js";
import {
  createTournamentTrackClient,
  type TournamentTrackClient,
  type TrackRecord,
} from "./tournament-track-client.js";
import { mountTournamentTracks } from "./tournament-track-section.js";
import type { TrackTableState } from "./tournament-track-section.js";
import {
  EMPTY_TOURNAMENT_STANDING_LINK,
  readTournamentStandingLink,
  writeTournamentStandingLink,
} from "./tournament-standing-link.js";
import { tournamentTierByRank, tournamentTierLabel } from "./tournament-tiers.js";
import { disambiguatedName, repeatedDisplayNames } from "./name-disambiguation.js";

export type MountedTournamentStanding = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

/**
 * Three at once, the same as the Time Trial half of Rank. Past three the bars
 * stop being readable on a phone, and the two halves should not disagree about
 * how many Players a comparison holds.
 */
const COMPARE_LIMIT = 3;
const COMPETITOR_LIMIT = 5;

function averageFinish(entry: TournamentStandingEntry): number | null {
  return entry.races === 0 ? null : entry.finishPositionTotal / entry.races;
}

function averagePoints(entry: TournamentStandingEntry): number | null {
  return entry.races === 0 ? null : entry.points / entry.races;
}

function percentage(part: number, whole: number): string {
  return whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`;
}

/** How many names a search offers before it asks for a longer query. */
export const STANDING_PICKER_LIMIT = 6;

/**
 * The names a typed query offers. A name that starts with what was typed comes
 * before one that merely contains it, and the standing's own order breaks the
 * tie. The phone has had this rule since its Ranking was built
 * (`androidTournamentPlayerMatches`); this is its twin, so the same two letters
 * offer the same people on both clients.
 */
export function standingPlayerMatches(
  entries: readonly TournamentStandingEntry[],
  query: string,
  limit: number = STANDING_PICKER_LIMIT,
): readonly TournamentStandingEntry[] {
  const wanted = query.trim().toLowerCase();
  if (wanted.length < 2) { return []; }
  const hits = entries.filter((entry) =>
    entry.displayName.toLowerCase().includes(wanted) ||
    entry.username.toLowerCase().includes(wanted));
  const startsWith = (entry: TournamentStandingEntry): boolean =>
    entry.displayName.toLowerCase().startsWith(wanted) ||
    entry.username.toLowerCase().startsWith(wanted);
  return [...hits].sort((left, right) => {
    if (startsWith(left) !== startsWith(right)) { return startsWith(left) ? -1 : 1; }
    return left.rank - right.rank;
  }).slice(0, limit);
}

/**
 * A Player whose rating has started reverting toward the start.
 *
 * The inactivity rule (ADR-0189) leaves the first year alone, so this is
 * exactly the point at which a score stops being a claim about how somebody
 * races now. Marking it matters: without it a reverted rating reads as a
 * Player who simply got worse.
 */
export const RATING_GRACE_DAYS = 365;

export function ratingIsReverting(
  lastRaceAtMs: number | undefined, nowMs: number,
): boolean {
  if (lastRaceAtMs === undefined) { return false; }
  return (nowMs - lastRaceAtMs) / 86_400_000 > RATING_GRACE_DAYS;
}

export function mountTournamentStanding(
  root: HTMLElement,
  client: TournamentStandingClient = createTournamentStandingClient(),
  viewerPlayerId: Promise<string | null> = Promise.resolve(null),
  rivalPlayerIds: Promise<ReadonlySet<string>> = Promise.resolve(new Set()),
  trackClient: TournamentTrackClient = createTournamentTrackClient(),
  /**
   * Whose standing to open on, when it is not the viewer's own. Accepts the
   * username or the Player id, because both appear in shareable links, and is
   * resolved against the standing once it loads rather than by an extra
   * request.
   */
  focusReference: string | null = null,
): MountedTournamentStanding {
  const document = root.ownerDocument;
  useDocument(document);
  const controller = new AbortController();
  const lang = (): NumberLanguage => productLanguage();
  const num = (value: number): string => formatCount(value, lang());
  let disposed = false;
  let entries: readonly TournamentStandingEntry[] = [];
  let selected: string[] = [];
  let viewer: string | null = null;
  let rivals: ReadonlySet<string> = new Set();
  /** Set once a reader picks their own comparison; the default stops moving. */
  let selectionChosen = false;
  /**
   * Whose record is being read, when the reader has searched for somebody.
   * The address still decides where the page opens; this is the reader
   * changing their mind afterwards, without a round trip.
   */
  let focusOverride: string | null = null;
  /** What is typed in the search box, kept so a repaint does not erase it. */
  let pickerQuery = "";
  /**
   * The comparison's records over the races every compared Player finished,
   * keyed by who was compared. Comparing careers put nights next to each other
   * that the main Player never raced (owner, 2026-09-17).
   */
  const sharedCache = new Map<string, Promise<TournamentSharedRaces>>();
  let shared: Readonly<{
    key: string;
    state: "loading" | "ready" | "failed";
    value: TournamentSharedRaces | null;
  }> | null = null;

  // The view a reader set is the view they send. Everything they can change -
  // whose record it is, who it is next to, and how the 96-track table is
  // sorted and filtered - is read from the address on the way in and written
  // back to it on the way out, so the link in the chat opens the same page.
  const view = document.defaultView ?? null;
  const link = view?.location === undefined
    ? EMPTY_TOURNAMENT_STANDING_LINK
    : readTournamentStandingLink(view.location.search);
  let trackTable: TrackTableState = {
    open: link.tracksOpen,
    sort: link.sort ?? "races",
    descending: link.descending ?? true,
    filters: link.filters,
  };
  /** The name a link uses for a Player: their username, never their id. */
  const nameOf = (playerId: string): string =>
    entries.find((entry) => entry.playerId === playerId)?.username ?? playerId;
  const syncLink = (): void => {
    if (view?.location === undefined || view.history === undefined) { return; }
    if (entries.length === 0) { return; }
    const subject = focusPlayerId();
    const query = writeTournamentStandingLink(view.location.search, {
      player: subject === null ? null : nameOf(subject),
      compare: selected.filter((playerId) => playerId !== subject).map(nameOf),
      tracksOpen: trackTable.open,
      sort: trackTable.sort,
      descending: trackTable.descending,
      filters: trackTable.filters,
    });
    try {
      view.history.replaceState(view.history.state, "", `/?${query}`);
    } catch {
      // A view without history (a test document, a sandboxed frame) simply
      // does not get a shareable address; nothing else depends on this.
    }
  };

  const container = document.createElement("section");
  container.className = "ds-root ds-rank ds-rank--tournament";
  container.setAttribute("aria-label", localized("Tournament Ranking", "Toernooiklassement"));
  const status = document.createElement("p");
  status.className = "ds-body-s ds-rank__status";
  status.setAttribute("role", "status");
  status.textContent = localized(
    "Loading the Tournament standing…", "Toernooistand laden…",
  );
  const body = document.createElement("div");
  body.className = "ds-rank__content";
  container.append(status, body);
  root.append(container);

  let sheet: OverlayHandle | null = null;
  const closeSheet = (): void => { try { sheet?.close(); } catch { /* not open */ } };

  const tierFor = (rank: number): HTMLElement | null => {
    const tier = tournamentTierByRank(rank);
    return tier === null ? null : tierChip(tournamentTierLabel(tier.key) ?? tier.name, tier.color);
  };

  /**
   * A name on the Ranking page opens that Player's Ranking, not their profile:
   * you clicked a row in a tournament standing, so the answer is their
   * tournament record. Their profile is one link away on the card that opens.
   */
  const rankingHref = (entry: Readonly<{ username: string; playerId: string }>): string =>
    `/?ranking=tournament&player=${encodeURIComponent(entry.username || entry.playerId)}`;

  let repeated: ReadonlySet<string> = new Set();
  let repeatedFor: readonly TournamentStandingEntry[] | null = null;
  const playerLink = (entry: TournamentStandingEntry | TournamentRivalry): HTMLElement => {
    const anchor = document.createElement("a");
    anchor.className = "ds-table__name-text";
    anchor.setAttribute("href", rankingHref(entry));
    // ADR-0218: an equal name on this page carries its username.
    if (repeatedFor !== entries) { repeated = repeatedDisplayNames(entries); repeatedFor = entries; }
    anchor.textContent = disambiguatedName(entry, repeated);
    anchor.title = `@${entry.username}`;
    return anchor;
  };

  /** ADR-0189: a rating that has begun reverting is said so, never left to read as decline. */
  const awayMark = (entry: TournamentStandingEntry): HTMLElement | null => {
    if (!ratingIsReverting(entry.lastRaceAtMs, Date.now())) { return null; }
    const mark = chip(localized("away", "afwezig"), "warning");
    mark.title = localized(
      "Has not raced in over a year; the rating reverts toward the start.",
      "Heeft ruim een jaar niet gereden; de rating keert terug naar de start.",
    );
    return mark;
  };

  // ---------------------------------------------------------------- sections

  /**
   * Whose record this page is showing, and a way to read somebody else's.
   * One summary line and a sheet, the same shape the Time Trial half uses.
   */
  const renderPicker = (parent: HTMLElement): void => {
    const subjectId = focusPlayerId();
    const subject = entries.find((row) => row.playerId === subjectId);
    const own = subjectId === viewer;
    const others = selected
      .filter((id) => id !== subjectId)
      .map((id) => entries.find((row) => row.playerId === id)?.displayName)
      .filter((name): name is string => name !== undefined);
    const openPicker = (): void => {
      const search = document.createElement("input");
      search.type = "search";
      search.className = "ds-text-input";
      search.value = pickerQuery;
      search.placeholder = localized("Search a Player", "Zoek een speler");
      const results = document.createElement("div");
      results.className = "ds-filter-chips";
      const paintMatches = (): void => {
        results.replaceChildren();
        const matches = standingPlayerMatches(entries, pickerQuery);
        if (pickerQuery.trim().length >= 2 && matches.length === 0) {
          results.append(emptyState({
            title: localized(
              "Nobody by that name has raced a finalized tournament.",
              "Niemand met die naam heeft een afgerond toernooi gereden.",
            ),
          }));
          return;
        }
        for (const match of matches) {
          results.append(toggleChip({
            label: `${match.displayName} · ${formatRank(match.rank, lang())} · ${num(match.races)}`,
            pressed: match.playerId === subjectId,
            onToggle: () => { pickerQuery = ""; closeSheet(); void refocus(match.playerId); },
          }));
        }
      };
      search.addEventListener("input", () => { pickerQuery = search.value; paintMatches(); });
      const sheetBody: (Node | string)[] = [
        field({
          label: localized("Search a Player", "Zoek een speler"),
          control: search,
          hint: localized(
            "The skill, competitors and tracks below follow this choice.",
            "Het niveau, de concurrenten en de banen hieronder volgen deze keuze.",
          ),
        }),
        results,
      ];
      if (!own && viewer !== null) {
        sheetBody.push(button({
          label: localized("Back to me", "Terug naar mij"),
          variant: "secondary",
          onPress: () => { closeSheet(); void refocus(viewer); },
        }).root);
      }
      paintMatches();
      sheet = filterSheet({
        title: localized("Whose record", "Wiens record"),
        body: sheetBody,
        doneLabel: localized("Done", "Klaar"),
      });
      sheet.open();
    };
    const compact = filterSummary({
      label: localized("Whose record", "Wiens record"),
      parts: [
        {
          label: localized("Record", "Record"),
          value: subject?.displayName ?? localized("the leader", "de koploper"),
        },
        ...(others.length === 0 ? [] : [{
          label: localized("Compared with", "Vergeleken met"), value: others.join(", "),
        }]),
      ],
      openLabel: localized("Choose a Player", "Kies een speler"),
      onOpen: openPicker,
    });
    compact.classList.add("ds-tournament-picker__summary");
    const mobile = document.createElement("section");
    mobile.className = "ds-tournament-picker";
    const title = document.createElement("h2");
    title.className = "ds-panel__title";
    title.textContent = localized("Whose record", "Wiens record");
    const explanation = document.createElement("p");
    explanation.className = "ds-body-s";
    explanation.textContent = own
      ? localized(
        "You are looking at your own tournament record. Search a name to look at somebody else's.",
        "Je bekijkt je eigen toernooirecord. Zoek een naam om het record van iemand anders te bekijken.",
      )
      : localized(
        `You are looking at ${subject?.displayName ?? "this Player"}. The skill, competitors and tracks below are theirs.`,
        `Je kijkt naar ${subject?.displayName ?? "deze speler"}. Het niveau, de concurrenten en de banen hieronder zijn van hen.`,
      );
    const search = document.createElement("input");
    search.type = "search";
    search.className = "ds-text-input ds-tournament-picker__search";
    search.placeholder = localized("Search a Player", "Zoek een speler");
    search.setAttribute("aria-label", search.placeholder);
    search.value = pickerQuery;
    const matches = document.createElement("div");
    matches.className = "ds-tournament-picker__matches";
    const paintMobileMatches = (): void => {
      matches.replaceChildren();
      if (pickerQuery.trim().length < 2) return;
      const found = standingPlayerMatches(entries, pickerQuery);
      if (found.length === 0) {
        matches.append(emptyState({ title: localized(
          "Nobody by that name has raced a finalized tournament.",
          "Niemand met die naam heeft een afgerond toernooi gereden.",
        ) }));
      }
      for (const match of found) {
        const choice = document.createElement("button");
        choice.type = "button";
        choice.className = "ds-tournament-picker__match";
        const name = document.createElement("strong");
        name.textContent = match.displayName;
        const detail = document.createElement("span");
        detail.textContent = `${formatRank(match.rank, lang())} · ${num(match.races)} races`;
        choice.append(name, detail);
        choice.addEventListener("click", () => { pickerQuery = ""; void refocus(match.playerId); });
        matches.append(choice);
      }
    };
    search.addEventListener("input", () => { pickerQuery = search.value; paintMobileMatches(); });
    paintMobileMatches();
    mobile.append(title, explanation, search, matches);
    if (!own && viewer !== null) {
      mobile.append(button({
        label: localized("Back to me", "Terug naar mij"), variant: "quiet", size: "sm",
        onPress: () => { pickerQuery = ""; void refocus(viewer); },
      }).root);
    }
    parent.append(compact, mobile);
  };

  const renderOwnCard = (parent: HTMLElement): void => {
    const focus = focusPlayerId();
    const own = entries.find((row) => row.playerId === focus);
    if (own === undefined) { return; }
    const finish = averageFinish(own);
    const points = averagePoints(own);
    const toProfile = document.createElement("a");
    toProfile.className = "ds-tournament-skill__profile";
    toProfile.setAttribute("href", `/?player=${encodeURIComponent(own.username || own.playerId)}`);
    toProfile.textContent = own.playerId === viewer
      ? localized("Your full profile →", "Je volledige profiel →")
      : localized(`${own.displayName}'s full profile →`, `Volledig profiel van ${own.displayName} →`);
    const heading = document.createElement("div");
    heading.className = "ds-rank__hero";
    heading.append(heroRank(own.rank, lang(), localized("Position", "Positie")));
    const of = document.createElement("span");
    of.className = "ds-body-s";
    of.textContent = localized(`of ${num(entries.length)}`, `van ${num(entries.length)}`);
    heading.append(of);
    const tier = tierFor(own.rank);
    if (tier !== null) { heading.append(tier); }
    const skillPanel = panel({
      title: own.playerId === viewer
        ? localized("Your tournament skill", "Jouw toernooiniveau")
        : localized(`${own.displayName} — tournament skill`, `${own.displayName} — toernooiniveau`),
      titleLevel: 2,
      children: [
        heading,
        statGrid([
          statBlock({
            label: localized("Rating", "Rating"),
            value: own.score === undefined ? "—" : own.score.toFixed(2),
            note: own.score === undefined
              ? localized("Not rated yet", "Nog geen rating")
              : localized("TrueSkill, conservative", "TrueSkill, conservatief"),
            size: "lg",
          }),
          statBlock({ label: localized("Tournaments", "Toernooien"), value: num(own.tournaments) }),
          statBlock({ label: localized("Races", "Races"), value: num(own.races) }),
          statBlock({ label: localized("Wins", "Overwinningen"), value: num(own.wins), note: percentage(own.wins, own.races) }),
          statBlock({ label: localized("Top 3", "Top 3"), value: num(own.podiums), note: percentage(own.podiums, own.races) }),
          statBlock({ label: localized("Average finish", "Gem. finish"), value: finish === null ? "—" : finish.toFixed(2) }),
          statBlock({ label: localized("Points per race", "Punten per race"), value: points === null ? "—" : points.toFixed(1) }),
        ]),
        toProfile,
      ],
    });
    skillPanel.classList.add("ds-tournament-skill");
    parent.append(skillPanel);
  };

  /**
   * The rows the three comparison cards draw. The main Player alone is their
   * own record; with others next to them, every row is that Player's record
   * over only the races all of them finished, so the bars describe the same
   * races. Until those arrive - or if they cannot - nothing is drawn rather
   * than the unfair career figures.
   */
  const comparedEntries = (): readonly TournamentStandingEntry[] => {
    const known = selected
      .map((id) => entries.find((row) => row.playerId === id))
      .filter((row): row is TournamentStandingEntry => row !== undefined);
    if (known.length <= 1) { return known; }
    if (shared === null || shared.key !== comparisonKey() || shared.value === null) {
      return [];
    }
    const records = shared.value.entries;
    return known.map((row) => {
      const record = records.find((candidate) => candidate.playerId === row.playerId);
      return record === undefined
        ? { ...row, races: 0, wins: 0, podiums: 0, points: 0, finishPositionTotal: 0,
          finishes: row.finishes.map(() => 0) }
        : { ...row, ...record };
    });
  };

  /** Who is compared, in order, as one string; empty for the main Player alone. */
  const comparisonKey = (): string => {
    const known = selected.filter((id) => entries.some((row) => row.playerId === id));
    return known.length <= 1 ? "" : known.join(",");
  };

  /**
   * The line every comparison card opens with: what its figures were counted
   * over. A card without a comparison describes one Player's whole record.
   */
  const scopeNote = (into: (Node | string | null)[], alone: [string, string]): boolean => {
    const note = document.createElement("p");
    note.className = "ds-body-s";
    into.push(note);
    const key = comparisonKey();
    if (key === "") {
      note.textContent = localized(alone[0], alone[1]);
      return true;
    }
    const names = selected
      .map((id) => entries.find((row) => row.playerId === id)?.displayName)
      .filter((name): name is string => name !== undefined);
    const both = names.length === 2;
    const joined = both
      ? { en: `${names[0]} and ${names[1]}`, nl: `${names[0]} en ${names[1]}` }
      : {
        en: `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`,
        nl: `${names.slice(0, -1).join(", ")} en ${names[names.length - 1]}`,
      };
    if (shared === null || shared.key !== key || shared.state === "loading") {
      note.textContent = localized(
        "Counting the races these Players share…",
        "De gezamenlijke races tellen…",
      );
      return false;
    }
    if (shared.state === "failed" || shared.value === null) {
      note.textContent = localized(
        "The shared races could not be counted. Retry later.",
        "De gezamenlijke races konden niet worden geteld. Probeer het later opnieuw.",
      );
      return false;
    }
    const count = shared.value.sharedRaces;
    if (count === 0) {
      note.textContent = localized(
        `${joined.en} have never finished a race together, so there is nothing fair to compare.`,
        `${joined.nl} hebben nooit samen een race gereden, dus er valt niets eerlijk te vergelijken.`,
      );
      return false;
    }
    const race = { en: count === 1 ? "race" : "races", nl: "race" + (count === 1 ? "" : "s") };
    note.textContent = both
      ? localized(
        `Counted over only the ${count} ${race.en} ${joined.en} both finished.`,
        `Alleen geteld over de ${count} ${race.nl} die ${joined.nl} allebei reden.`,
      )
      : localized(
        `Counted over only the ${count} ${race.en} ${joined.en} all finished.`,
        `Alleen geteld over de ${count} ${race.nl} die ${joined.nl} alle drie reden.`,
      );
    return true;
  };

  /** Fetch the shared races for the comparison on screen, once per comparison. */
  const loadShared = (): void => {
    const key = comparisonKey();
    if (key === "") { shared = null; return; }
    if (shared !== null && shared.key === key) { return; }
    let pending = sharedCache.get(key);
    if (pending === undefined) {
      pending = client.sharedRaces(key.split(","), controller.signal);
      sharedCache.set(key, pending);
      // A failed count must not be remembered as the answer.
      pending.catch(() => { sharedCache.delete(key); });
    }
    shared = { key, state: "loading", value: null };
    pending.then(
      (value) => {
        if (disposed || shared?.key !== key) { return; }
        shared = { key, state: "ready", value };
        paint();
      },
      () => {
        if (disposed || shared?.key !== key) { return; }
        shared = { key, state: "failed", value: null };
        paint();
      },
    );
  };

  const renderDistribution = (parent: HTMLElement): void => {
    if (selected.length === 0) { return; }
    const children: (Node | string | null)[] = [];
    const phoneIntro = document.createElement("p");
    phoneIntro.className = "ds-body-s ds-tournament-finishes__phone-intro";
    phoneIntro.textContent = localized(
      "How often each finishing position happened.",
      "Hoe vaak elke finishpositie voorkwam.",
    );
    children.push(phoneIntro);
    const drawable = scopeNote(children, [
      "How often each finishing position happened, counted over every race in a finalized tournament.",
      "Hoe vaak elke finishpositie voorkwam, geteld over elke race in een afgerond toernooi.",
    ]);
    const shown = comparedEntries();
    if (drawable && shown.length > 0) {
      children.push(barChart({
        label: localized("Finishing positions", "Finishposities"),
        groupSpacing: "wide",
        categories: Array.from({ length: FINISH_POSITIONS }, (_, index) => String(index + 1)),
        series: shown.map((row) => ({
          name: row.displayName,
          values: Array.from({ length: FINISH_POSITIONS }, (_, index) => row.finishes[index] ?? 0),
        })),
        describeBar: (name, category, value) => localized(
          `${name}: ${value}× P${category}`, `${name}: ${value}× P${category}`,
        ),
      }));
    }
    const distributionPanel = panel({
      title: focusPlayerId() === viewer
        ? localized("Where your finishes land", "Waar je finishes landen")
        : localized("Where the finishes land", "Waar de finishes landen"),
      titleLevel: 2,
      children,
    });
    distributionPanel.classList.add("ds-tournament-finishes");
    parent.append(distributionPanel);
  };

  /** Every race a Player has run, split into how it ended. */
  const renderOutcomes = (parent: HTMLElement): void => {
    if (selected.length === 0) { return; }
    const children: (Node | string | null)[] = [];
    const note = document.createElement("p");
    note.className = "ds-body-s";
    note.textContent = localized(
      "Every race split into a win, the rest of the podium, and everything else.",
      "Elke race verdeeld over winst, de rest van het podium, en al het andere.",
    );
    children.push(note);
    const drawable = scopeNote(children, [
      "Counted over every race in a finalized tournament.",
      "Geteld over elke race in een afgerond toernooi.",
    ]);
    const shown = comparedEntries();
    if (drawable && shown.length > 0) {
      children.push(dataTable({
        caption: localized("How the races end", "Hoe de races eindigen"),
        columns: [
          { key: "player", label: localized("Player", "Speler"), align: "name" },
          { key: "split", label: localized("Outcome", "Uitslag"), align: "text", phone: 2 },
          { key: "wins", label: localized("Won", "Gewonnen"), align: "num", phone: 2 },
          { key: "podiums", label: localized("Top 3", "Top 3"), align: "num", phone: 2, compact: 3 },
        ],
        rows: shown.map((row) => ({
          cells: [
            row.displayName,
            segmentBar({
              label: row.displayName,
              total: row.races,
              parts: [
                { label: localized("wins", "winst"), value: row.wins, tone: "win" },
                { label: localized("2nd/3rd", "2e/3e"), value: Math.max(0, row.podiums - row.wins), tone: "podium" },
                { label: localized("rest", "rest"), value: Math.max(0, row.races - row.podiums), tone: "rest" },
              ],
            }),
            percentage(row.wins, row.races),
            percentage(row.podiums, row.races),
          ],
        })),
      }));
      const phone = document.createElement("div");
      phone.className = "ds-tournament-outcomes__phone";
      const legend = document.createElement("div");
      legend.className = "ds-tournament-outcomes__legend";
      for (const [tone, english, dutch] of [
        ["win", "wins", "winst"],
        ["podium", "2nd/3rd", "2e/3e"],
        ["rest", "rest", "rest"],
      ] as const) {
        const item = document.createElement("span");
        item.className = "ds-tournament-outcomes__legend-item";
        const swatch = document.createElement("span");
        swatch.className = "ds-tournament-outcomes__swatch";
        swatch.setAttribute("data-tone", tone);
        swatch.setAttribute("aria-hidden", "true");
        item.append(swatch, localized(english, dutch));
        legend.append(item);
      }
      phone.append(legend);
      for (const row of shown) {
        const item = document.createElement("div");
        item.className = "ds-tournament-outcomes__row";
        const name = document.createElement("span");
        name.className = "ds-tournament-outcomes__name";
        name.textContent = row.displayName;
        const rates = document.createElement("span");
        rates.className = "ds-tournament-outcomes__rates";
        rates.textContent = `${percentage(row.wins, row.races)} · ${percentage(row.podiums, row.races)}`;
        item.append(name, segmentBar({
          label: row.displayName,
          total: row.races,
          parts: [
            { label: localized("wins", "winst"), value: row.wins, tone: "win" },
            { label: localized("2nd/3rd", "2e/3e"), value: Math.max(0, row.podiums - row.wins), tone: "podium" },
            { label: localized("rest", "rest"), value: Math.max(0, row.races - row.podiums), tone: "rest" },
          ],
        }), rates);
        phone.append(item);
      }
      children.push(phone);
    }
    const outcomesPanel = panel({
      title: focusPlayerId() === viewer
        ? localized("How your races end", "Hoe je races eindigen")
        : localized("How the races end", "Hoe de races eindigen"),
      titleLevel: 2,
      children,
    });
    outcomesPanel.classList.add("ds-tournament-outcomes");
    parent.append(outcomesPanel);
  };

  /** Scoring rate, against what the whole community averages. */
  const renderPointsPerRace = (parent: HTMLElement): void => {
    if (selected.length === 0) { return; }
    const shown = comparedEntries();
    const totalRaces = entries.reduce((sum, row) => sum + row.races, 0);
    const totalPoints = entries.reduce((sum, row) => sum + row.points, 0);
    const communityAverage = totalRaces === 0 ? 0 : totalPoints / totalRaces;
    const highest = Math.max(communityAverage, ...shown.map((row) => averagePoints(row) ?? 0), 1);
    const children: (Node | string | null)[] = [];
    const note = document.createElement("p");
    note.className = "ds-body-s";
    note.textContent = localized(
      `The line is the community average, ${communityAverage.toFixed(1)} per race.`,
      `De lijn is het communitygemiddelde, ${communityAverage.toFixed(1)} per race.`,
    );
    children.push(note);
    const drawable = scopeNote(children, [
      "Counted over every race in a finalized tournament.",
      "Geteld over elke race in een afgerond toernooi.",
    ]);
    if (drawable && shown.length > 0) {
      children.push(dataTable({
        caption: localized("Points per race", "Punten per race"),
        columns: [
          { key: "player", label: localized("Player", "Speler"), align: "name" },
          { key: "rate", label: localized("Per race", "Per race"), align: "text", phone: 2 },
        ],
        rows: shown.map((row) => {
          const value = averagePoints(row) ?? 0;
          return {
            cells: [row.displayName, valueBar({
              label: row.displayName,
              value: value.toFixed(1),
              share: (value / highest) * 100,
            })],
          };
        }),
      }));
      const phone = document.createElement("div");
      phone.className = "ds-tournament-points__phone";
      for (const [index, row] of shown.entries()) {
        const value = averagePoints(row) ?? 0;
        const item = document.createElement("div");
        item.className = "ds-tournament-points__row";
        const name = document.createElement("span");
        name.className = "ds-tournament-points__name";
        name.textContent = row.displayName;
        const bar = document.createElement("span");
        bar.className = "ds-tournament-points__bar";
        bar.setAttribute("role", "img");
        bar.setAttribute("aria-label", localized(
          `${row.displayName}: ${value.toFixed(1)} points per race; community average ${communityAverage.toFixed(1)}`,
          `${row.displayName}: ${value.toFixed(1)} punten per race; communitygemiddelde ${communityAverage.toFixed(1)}`,
        ));
        bar.style.setProperty("--ds-point-share", `${(value / highest) * 100}%`);
        bar.style.setProperty("--ds-point-average", `${(communityAverage / highest) * 100}%`);
        const fill = document.createElement("span");
        fill.className = "ds-tournament-points__fill";
        fill.setAttribute("data-series", String(index + 1));
        const averageLine = document.createElement("span");
        averageLine.className = "ds-tournament-points__average";
        bar.append(fill, averageLine);
        const rate = document.createElement("span");
        rate.className = "ds-tournament-points__rate";
        rate.textContent = value.toFixed(1);
        item.append(name, bar, rate);
        phone.append(item);
      }
      children.push(phone);
    }
    const pointsPanel = panel({
      title: localized("Points per race", "Punten per race"),
      titleLevel: 2,
      children,
    });
    pointsPanel.classList.add("ds-tournament-points");
    parent.append(pointsPanel);
  };

  const renderCompetitors = (
    parent: HTMLElement, opponents: readonly TournamentRivalry[],
  ): void => {
    if (opponents.length === 0) { return; }
    const subject = focusPlayerId();
    const subjectName = entries.find((row) => row.playerId === subject)?.displayName;
    const note = document.createElement("p");
    note.className = "ds-body-s";
    note.textContent = subject === viewer || subjectName === undefined
      ? localized(
        "The Players you have shared the most races with, and how those races went.",
        "De spelers met wie je de meeste races deelde, en hoe die races liepen.",
      )
      : localized(
        `The Players ${subjectName} has shared the most races with, and how those races went.`,
        `De spelers met wie ${subjectName} de meeste races deelde, en hoe die races liepen.`,
      );
    // The three numbers on a row carried nothing but a hover title, and a
    // phone has no hover: "114-200 / 314 races / -1.7" told a reader nothing.
    const who = subject === viewer || subjectName === undefined
      ? { en: "you score", nl: "jij scoort" }
      : { en: `${subjectName} scores`, nl: `${subjectName} scoort` };
    const legend = document.createElement("p");
    legend.className = "ds-body-s";
    legend.textContent = localized(
      `Races finished ahead-behind, then how many races were shared. `
      + `The last number is race points per shared race: -1.7 means ${who.en} `
      + `1.7 points fewer than that opponent, on average.`,
      `Races voor-achter geëindigd, daarna hoeveel races gedeeld zijn. `
      + `Het laatste getal is racepunten per gedeelde race: -1,7 betekent dat `
      + `${who.nl} er gemiddeld 1,7 minder dan die tegenstander.`,
    );
    const competitorsPanel = panel({
      title: subject === viewer
        ? localized("Your top 5 competitors", "Jouw top 5 concurrenten")
        : localized("Top 5 competitors", "Top 5 concurrenten"),
      titleLevel: 2,
      children: [note, legend, dataTable({
        caption: localized("Competitors", "Concurrenten"),
        columns: [
          { key: "player", label: localized("Player", "Speler"), align: "name" },
          { key: "record", label: localized("Ahead–behind", "Voor–achter"), align: "num", phone: 2 },
          { key: "share", label: localized("Share ahead", "Aandeel voor"), align: "text", phone: 2 },
          { key: "shared", label: localized("Shared races", "Gedeelde races"), align: "num", phone: 3 },
          { key: "delta", label: localized("Points per race", "Punten per race"), align: "delta", phone: 3 },
        ],
        rows: opponents.slice(0, COMPETITOR_LIMIT).map((opponent) => {
          const decided = opponent.ahead + opponent.behind;
          const ahead = decided === 0 ? 50 : Math.round((opponent.ahead / decided) * 100);
          const record = document.createElement("span");
          record.className = "ds-table__num-inner";
          record.textContent = `${num(opponent.ahead)}–${num(opponent.behind)}`;
          record.title = localized(
            `Ahead ${opponent.ahead}, behind ${opponent.behind}, level ${opponent.tied}`,
            `Voor ${opponent.ahead}, achter ${opponent.behind}, gelijk ${opponent.tied}`,
          );
          const delta = document.createElement("span");
          delta.className = "ds-delta__value";
          delta.setAttribute("data-direction", opponent.averagePointsDelta > 0
            ? "faster" : opponent.averagePointsDelta < 0 ? "slower" : "even");
          delta.textContent = `${opponent.averagePointsDelta > 0 ? "+" : opponent.averagePointsDelta < 0 ? TRUE_MINUS : "±"}${
            Math.abs(opponent.averagePointsDelta).toFixed(1)}`;
          delta.setAttribute("aria-label", localized(
            `${opponent.averagePointsDelta.toFixed(1)} race points per shared race`,
            `${opponent.averagePointsDelta.toFixed(1)} racepunten per gedeelde race`,
          ));
          return {
            cells: [
              playerLink(opponent),
              record,
              valueBar({
                label: localized(`${opponent.displayName}: races finished ahead`,
                  `${opponent.displayName}: races voor geëindigd`),
                value: `${ahead}%`,
                share: ahead,
              }),
              num(opponent.sharedRaces),
              delta,
            ],
          };
        }),
      })],
    });
    competitorsPanel.classList.add("ds-tournament-competitors");
    parent.append(competitorsPanel);
  };

  const renderTable = (parent: HTMLElement): void => {
    const children: (Node | string | null)[] = [];
    const note = document.createElement("p");
    note.className = "ds-body-s ds-tournament-standing__desktop-intro";
    note.textContent = localized(
      "Choose up to two Players to compare with the main Player.",
      "Kies maximaal twee spelers om met de hoofdspeler te vergelijken.",
    );
    children.push(note);
    const phoneIntro = document.createElement("p");
    phoneIntro.className = "ds-body-s ds-tournament-standing__phone-intro";
    phoneIntro.textContent = localized(
      "Tap + to compare up to two Players with the main Player (●).",
      "Tik op + om maximaal twee spelers met de hoofdspeler (●) te vergelijken.",
    );
    children.push(phoneIntro);
    const hasAwayPlayer = entries.some((entry) => ratingIsReverting(entry.lastRaceAtMs, Date.now()));
    if (hasAwayPlayer) {
      const away = document.createElement("p");
      away.className = "ds-body-s ds-tournament-standing__desktop-away";
      away.textContent = localized(
        "\"Away\" marks a Player who has not raced in over a year. A rating reverts "
        + "toward the start from there, and reaches it after three years away.",
        "\"Afwezig\" staat bij een speler die ruim een jaar niet gereden heeft. Een rating "
        + "keert vanaf dan terug naar de start, en is daar na drie jaar afwezigheid.",
      );
      children.push(away);
    }
    const subject = focusPlayerId();
    const standingTable = dataTable({
      caption: localized("Tournament standing", "Toernooistand"),
      columns: [
        { key: "rank", label: "#", align: "rank", name: localized("Position", "Positie") },
        { key: "player", label: localized("Player", "Speler"), align: "name" },
        { key: "score", label: localized("Rating", "Rating"), align: "num", phone: 2 },
        { key: "tournaments", label: localized("Tour.", "Toern."), align: "num", tablet: "drop", phone: "drop" },
        { key: "races", label: localized("Races", "Races"), align: "num", phone: 2 },
        { key: "wins", label: localized("Wins", "Winst"), align: "num", phone: 2 },
        { key: "podiums", label: localized("Top 3", "Top 3"), align: "num", tablet: "drop", phone: "drop" },
        { key: "average", label: localized("Avg", "Gem."), align: "num", tablet: "drop", phone: "drop" },
        { key: "pick", label: localized("Compare", "Vergelijk"), align: "text", phone: 3 },
      ],
      rows: entries.map((entry): DataRow => {
        const rank = document.createElement("span");
        rank.className = "ds-tournament-standing__rank";
        const desktopRank = document.createElement("span");
        desktopRank.className = "ds-tournament-standing__desktop-rank";
        desktopRank.textContent = formatRank(entry.rank, lang());
        const phoneRank = document.createElement("span");
        phoneRank.className = "ds-tournament-standing__phone-rank";
        phoneRank.textContent = String(entry.rank);
        rank.append(desktopRank, phoneRank);
        const name = document.createElement("span");
        name.className = "ds-table__name-inner";
        name.append(playerLink(entry));
        const away = awayMark(entry);
        if (away !== null) {
          name.append(away);
          const phoneAwayMark = document.createElement("span");
          phoneAwayMark.className = "ds-tournament-standing__phone-away-mark";
          phoneAwayMark.textContent = "*";
          name.append(phoneAwayMark);
        }
        const tier = tierFor(entry.rank);
        if (tier !== null) { name.append(tier); }
        if (entry.playerId === viewer) { name.append(youChip(localized("You", "Jij"))); }
        const finish = averageFinish(entry);
        const pick = entry.playerId === subject
          ? chip(localized("Main Player", "Hoofdspeler"), "info")
          : toggleChip({
            label: selected.includes(entry.playerId)
              ? localized("Chosen", "Gekozen") : localized("Compare", "Vergelijk"),
            pressed: selected.includes(entry.playerId),
            title: localized(`Compare ${entry.displayName}`, `Vergelijk ${entry.displayName}`),
            onToggle: () => { toggle(entry.playerId); },
          });
        pick.setAttribute("data-phone-symbol", entry.playerId === subject
          ? "●"
          : selected.includes(entry.playerId) ? "−" : "+");
        return {
          cells: [
            rank,
            name,
            entry.score === undefined ? "—" : entry.score.toFixed(2),
            num(entry.tournaments),
            num(entry.races),
            num(entry.wins),
            num(entry.podiums),
            finish === null ? "—" : finish.toFixed(2),
            pick,
          ],
          podium: entry.rank,
          ...(entry.playerId === viewer ? { kind: "you" as const } : {}),
          attributes: {
            "data-rival": rivals.has(entry.playerId) ? "true" : "false",
            "data-selected": selected.includes(entry.playerId) ? "true" : "false",
            "data-compare-series": selected.indexOf(entry.playerId) < 0
              ? "" : String(selected.indexOf(entry.playerId) + 1),
          },
        };
      }),
    });
    standingTable.classList.add("ds-tournament-standing");
    const scroll = document.createElement("div");
    scroll.className = "ds-tournament-standing__scroll";
    scroll.tabIndex = 0;
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-label", localized("Scrollable Tournament standing", "Schuifbare toernooistand"));
    scroll.append(standingTable);
    children.push(scroll);
    if (hasAwayPlayer) {
      const phoneAway = document.createElement("p");
      phoneAway.className = "ds-body-s ds-tournament-standing__phone-away";
      phoneAway.textContent = localized(
        "* has not raced in over a year. A rating reverts toward the start from there, and reaches it after three years away.",
        "* heeft ruim een jaar niet gereden. Een rating keert vanaf dan terug naar de start, en is daar na drie jaar afwezigheid.",
      );
      children.push(phoneAway);
    }
    if (rivals.size > 0) {
      const rivalNote = document.createElement("p");
      rivalNote.className = "ds-body-s ds-tournament-standing__phone-rivals";
      rivalNote.textContent = localized(
        "Your rivals open the comparison by default.",
        "Je rivalen staan standaard in de vergelijking.",
      );
      children.push(rivalNote);
    }
    const standingPanel = panel({
      title: localized("Tournament standing", "Toernooistand"),
      titleLevel: 2,
      children,
    });
    standingPanel.classList.add("ds-tournament-standing-panel");
    parent.append(standingPanel);
  };

  // ------------------------------------------------------------------ paint

  let opponents: readonly TournamentRivalry[] = [];
  let mountedTracks: ReturnType<typeof mountTournamentTracks> | null = null;

  // `paint` rebuilds the whole body on every selection change, so the track
  // section would refetch each time. The record does not change while the page
  // is open, so one request per Player is enough and the rest come from here.
  const trackRecords = new Map<string, Promise<TrackRecord>>();
  const cachingTrackClient: TournamentTrackClient = {
    async record(playerId, signal) {
      const cached = trackRecords.get(playerId);
      if (cached !== undefined) { return cached; }
      const pending = trackClient.record(playerId, signal);
      trackRecords.set(playerId, pending);
      // A failed read must not be remembered as the answer.
      pending.catch(() => { trackRecords.delete(playerId); });
      return pending;
    },
  };

  /**
   * Whose track record to show. Yours if we know who you are, otherwise the
   * Player at the top - a signed-out visitor should still see what the section
   * is for rather than an empty card.
   */
  const renderTrackRecord = (parent: HTMLElement): void => {
    const wanted = focusPlayerId();
    const focus = entries.find((row) => row.playerId === wanted) ?? entries[0];
    if (focus === undefined) { return; }
    mountedTracks = mountTournamentTracks(
      parent, focus.playerId, focus.displayName, cachingTrackClient,
      {
        initial: {
          open: trackTable.open,
          sort: trackTable.sort,
          descending: trackTable.descending,
          filters: trackTable.filters,
        },
        onStateChange: (state) => {
          trackTable = state;
          syncLink();
        },
        shareLink: () => {
          syncLink();
          return view?.location?.href ?? "";
        },
      },
    );
  };

  /**
   * The Player this page is about: the one asked for, else the viewer, else
   * the Player at the top of the standing - so a signed-out visitor reads the
   * same page, with every card, as somebody who opened it on a name.
   */
  const focusPlayerId = (): string | null => {
    if (focusOverride !== null) { return focusOverride; }
    if (focusReference === null) { return viewer ?? entries[0]?.playerId ?? null; }
    const wanted = focusReference.toLowerCase();
    const match = entries.find((entry) =>
      entry.playerId.toLowerCase() === wanted ||
      entry.username.toLowerCase() === wanted);
    return match?.playerId ?? viewer ?? entries[0]?.playerId ?? null;
  };

  /** Nobody asked for a Player and nobody is signed in: the #1 stands in. */
  const focusIsTheLeader = (): boolean =>
    viewer === null && (focusReference === null ||
      !entries.some((entry) => entry.playerId.toLowerCase() === focusReference.toLowerCase() ||
        entry.username.toLowerCase() === focusReference.toLowerCase()));

  const paint = (): void => {
    // The section owns an in-flight request; dropping its node without saying
    // so would leave that request writing into a detached tree.
    mountedTracks?.unmount();
    mountedTracks = null;
    body.replaceChildren();
    if (entries.length === 0) {
      status.textContent = "";
      body.append(emptyState({
        title: localized(
          "No finalized tournament has been raced yet.",
          "Er is nog geen toernooi afgerond.",
        ),
        body: localized(
          "The standing appears as soon as a tournament night is finalized.",
          "De stand verschijnt zodra een toernooiavond is afgerond.",
        ),
      }));
      return;
    }
    status.textContent = localized(
      `${num(entries.length)} Players, counted over every race in a finalized tournament.`,
      `${num(entries.length)} spelers, geteld over elke race in een afgerond toernooi.`,
    );
    anchorSelection();
    loadShared();
    renderPicker(body);
    renderOwnCard(body);
    renderTrackRecord(body);
    renderCompetitors(body, opponents);
    renderDistribution(body);
    renderOutcomes(body);
    renderPointsPerRace(body);
    renderTable(body);
  };

  /**
   * Read somebody else's record. Their own competitors have to be fetched -
   * leaving the previous Player's head-to-heads under a new name would be a
   * lie - and the comparison re-opens on them, unless the reader has already
   * chosen whom to compare.
   */
  async function refocus(playerId: string | null): Promise<void> {
    focusOverride = playerId;
    opponents = [];
    if (!selectionChosen) {
      selected = playerId === null ? [] : [playerId];
    }
    anchorSelection();
    syncLink();
    paint();
    const subject = focusPlayerId();
    if (subject === null) { return; }
    opponents = await client.rivalries(subject, controller.signal).catch(() => []);
    if (disposed) { return; }
    if (!selectionChosen) {
      const known = new Set(entries.map((row) => row.playerId));
      selected = subject === viewer
        ? [
          subject,
          ...entries
            .filter((row) => rivals.has(row.playerId) && row.playerId !== subject)
            .map((row) => row.playerId),
        ].slice(0, COMPARE_LIMIT)
        : [
          subject,
          ...opponents
            .map((opponent) => opponent.playerId)
            .filter((id) => known.has(id) && id !== subject),
        ].slice(0, COMPARE_LIMIT);
    }
    paint();
  }

  /**
   * The main Player always leads the comparison, and at most two others stand
   * beside them. Called before every paint, so no path can leave the page
   * comparing two other people with each other.
   */
  function anchorSelection(): void {
    const subject = focusPlayerId();
    if (subject === null) { return; }
    selected = [subject, ...selected.filter((id) => id !== subject)]
      .filter((id, index, all) => all.indexOf(id) === index)
      .slice(0, COMPARE_LIMIT);
  }

  function toggle(playerId: string): void {
    const subject = focusPlayerId();
    if (playerId === subject) { return; }
    selectionChosen = true;
    const others = selected.filter((id) => id !== subject);
    const next = others.includes(playerId)
      ? others.filter((candidate) => candidate !== playerId)
      // A third pick replaces the oldest, so the main Player is never dropped.
      : [...others, playerId].slice(-(COMPARE_LIMIT - 1));
    selected = [...(subject === null ? [] : [subject]), ...next];
    syncLink();
    paint();
  }

  const ready = (async (): Promise<void> => {
    const [standing, own, rivalIds] = await Promise.all([
      client.standing(controller.signal),
      viewerPlayerId.catch(() => null),
      rivalPlayerIds.catch(() => new Set<string>()),
    ]);
    if (disposed) { return; }
    entries = standing;
    viewer = own;
    rivals = rivalIds;
    // Open on the Player this page is about, plus the rivals they follow: the
    // comparison people want first is almost always the subject against the
    // people they already race. On a page opened for somebody else the
    // subject is that person, and their own competitors fill the rest - which
    // arrive with the rivalries below, so this is only the first half.
    const subject = focusPlayerId();
    selected = [
      ...(subject !== null && standing.some((row) => row.playerId === subject)
        ? [subject] : []),
      ...(subject === own
        ? standing
          .filter((row) => rivalIds.has(row.playerId) && row.playerId !== own)
          .map((row) => row.playerId)
        : []),
    ].slice(0, COMPARE_LIMIT);
    // Signed out and asked for nobody: the leader against #2 and #3, the
    // comparison the standing itself suggests.
    if (focusIsTheLeader()) {
      selected = standing.slice(0, COMPARE_LIMIT).map((row) => row.playerId);
    }
    if (selected.length === 0) {
      selected = standing.slice(0, 1).map((row) => row.playerId);
    }
    // A link that names who to compare against wins over every default: the
    // reader was sent that comparison on purpose.
    if (link.compare.length > 0) {
      const wanted = link.compare
        .map((reference) => reference.toLowerCase())
        .map((reference) => standing.find((row) =>
          row.username.toLowerCase() === reference || row.playerId.toLowerCase() === reference))
        .filter((row): row is TournamentStandingEntry => row !== undefined)
        .map((row) => row.playerId);
      if (wanted.length > 0) {
        const subjectId = focusPlayerId();
        selected = [...(subjectId === null ? [] : [subjectId]), ...wanted]
          .filter((playerId, index, all) => all.indexOf(playerId) === index)
          .slice(0, COMPARE_LIMIT);
        selectionChosen = true;
      }
    }
    anchorSelection();
    syncLink();
    paint();
    // Whose rivalries to load: the Player this page is about. Loading the
    // viewer's while the rest of the page shows somebody else would put one
    // person's head-to-heads under another person's name.
    const rivalrySubject = focusPlayerId();
    if (rivalrySubject !== null) {
      opponents = await client.rivalries(rivalrySubject, controller.signal)
        .catch(() => []);
      if (disposed) { return; }
      // A page opened for somebody else compares them with the people they
      // actually race, not with the rivals the reader happens to follow. The
      // leader standing in for a signed-out visitor keeps #2 and #3.
      if (!selectionChosen && rivalrySubject !== viewer && !focusIsTheLeader()) {
        const known = new Set(entries.map((row) => row.playerId));
        selected = [
          rivalrySubject,
          ...opponents
            .map((opponent) => opponent.playerId)
            .filter((playerId) => known.has(playerId) && playerId !== rivalrySubject),
        ].slice(0, COMPARE_LIMIT);
      }
      paint();
    }
  })().catch(() => {
    if (!disposed) {
      status.textContent = "";
      body.replaceChildren(errorState({
        title: localized(
          "The Tournament standing could not be loaded. Retry later.",
          "De toernooistand kon niet worden geladen. Probeer het later opnieuw.",
        ),
      }));
    }
  });

  return {
    container,
    ready,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      mountedTracks?.unmount();
      mountedTracks = null;
      closeSheet();
      sheet?.root.remove();
      controller.abort();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}
