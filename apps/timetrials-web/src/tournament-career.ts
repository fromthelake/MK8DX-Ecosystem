// Tournament career - per-tournament placement statistics aggregated
// from the imported legacy race history, plus the "toughest opponent"
// insight (who finished ahead of this Player most often). All facts
// derive from source-observed finish positions; nothing is fabricated.

import { localized } from "./product-language.js";
import {
  fetchRatingHistory,
  type RatingHistoryPoint,
} from "./rating-graph.js";
import {
  button,
  disclosure,
  panel,
  statBlock,
  statGrid,
  useDocument,
} from "./ds-components.js";

export type TournamentCareerRow = Readonly<{
  tournamentNumber: number;
  finalSection: string;
  races: number;
  wins: number;
  podiums: number;
  averageFinish: number;
}>;

export type TournamentCareer = Readonly<{
  tournaments: readonly TournamentCareerRow[];
  totals: Readonly<{
    tournaments: number;
    races: number;
    wins: number;
    podiums: number;
    averageFinish: number;
  }>;
}>;

// Career facts from the per-race trajectory: grouped per tournament,
// with the Player's last-driven section as the tournament's outcome
// label (the finals group they ended in).
export function tournamentCareer(
  points: readonly RatingHistoryPoint[],
): TournamentCareer | null {
  if (points.length === 0) { return null; }
  const byTournament = new Map<number, RatingHistoryPoint[]>();
  for (const point of points) {
    const bucket = byTournament.get(point.tournamentNumber) ?? [];
    bucket.push(point);
    byTournament.set(point.tournamentNumber, bucket);
  }
  const tournaments: TournamentCareerRow[] = [];
  for (const [tournamentNumber, bucket] of byTournament) {
    const last = bucket.reduce((latest, candidate) =>
      candidate.sequence > latest.sequence ? candidate : latest);
    const wins = bucket.filter(
      (point) => point.finishPosition === 1).length;
    const podiums = bucket.filter(
      (point) => point.finishPosition <= 3).length;
    const finishSum = bucket.reduce(
      (sum, point) => sum + point.finishPosition, 0);
    tournaments.push({
      tournamentNumber,
      finalSection: last.sectionLabel.split(": ")[1] ?? last.sectionLabel,
      races: bucket.length,
      wins,
      podiums,
      averageFinish: finishSum / bucket.length,
    });
  }
  tournaments.sort((a, b) => a.tournamentNumber - b.tournamentNumber);
  const races = points.length;
  return {
    tournaments,
    totals: {
      tournaments: tournaments.length,
      races,
      wins: tournaments.reduce((sum, row) => sum + row.wins, 0),
      podiums: tournaments.reduce((sum, row) => sum + row.podiums, 0),
      averageFinish: points.reduce(
        (sum, point) => sum + point.finishPosition, 0) / races,
    },
  };
}

export type TournamentOpponent = Readonly<{
  playerId: string;
  displayName: string;
  sharedRaces: number;
  aheadOfMe: number;
  meAhead: number;
}>;

export async function fetchTournamentOpponents(
  playerId: string,
  signal?: AbortSignal,
): Promise<readonly TournamentOpponent[]> {
  const response = await fetch(
    `/v1/public/players/${encodeURIComponent(playerId)
    }/tournament-opponents`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      referrerPolicy: "same-origin",
      ...(signal === undefined ? {} : { signal }),
    },
  );
  if (response.status !== 200) { throw new Error("opponents unavailable"); }
  const body = await response.json() as Record<string, unknown>;
  if (body["schemaVersion"] !== "mk8dx.public-tournament-opponents.v1" ||
      !Array.isArray(body["opponents"])) {
    throw new Error("opponents invalid");
  }
  return body["opponents"] as readonly TournamentOpponent[];
}

export type SectionStandings = Readonly<{
  tournamentNumber: number;
  sectionLabel: string;
  standings: readonly Readonly<{
    playerId: string;
    displayName: string;
    points: number;
    races: number;
    characterId?: string;
    characterVariantId?: string;
  }>[];
}>;

export async function fetchTournamentStandings(
  signal?: AbortSignal,
): Promise<readonly SectionStandings[]> {
  const response = await fetch("/v1/public/tournament-standings", {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    mode: "same-origin",
    redirect: "error",
    referrerPolicy: "same-origin",
    ...(signal === undefined ? {} : { signal }),
  });
  if (response.status !== 200) { throw new Error("standings unavailable"); }
  const body = await response.json() as Record<string, unknown>;
  if (body["schemaVersion"] !== "mk8dx.public-tournament-standings.v1" ||
      !Array.isArray(body["sections"])) {
    throw new Error("standings invalid");
  }
  return body["sections"] as readonly SectionStandings[];
}

export type FinalPlacement = Readonly<{
  position: number;
  points: number;
  participants: number;
}>;

// The Player's final placement inside one section: points descending
// with RANK semantics (equal points share the position).
export function sectionPlacement(
  section: SectionStandings,
  playerId: string,
): FinalPlacement | null {
  const mine = section.standings.find(
    (entry) => entry.playerId === playerId);
  if (mine === undefined) { return null; }
  const position = 1 + section.standings.filter(
    (entry) => entry.points > mine.points).length;
  return {
    position,
    points: mine.points,
    participants: section.standings.length,
  };
}

// The tournament's section hierarchy (owner-recovered): qualification
// groups feed tiered finals divisions. Tier 0 is the championship
// group (Kampioen / 1e Divisie / Winnaarspoule), tier 1 the second
// (Talent / 2e Divisie / Verliezerspoule), tier 2 the third
// (Wild / 3e Divisie). Divisions are not always full, so the OVERALL
// tournament placement counts the actual participants of the higher
// tiers rather than assuming twelve per group.
const SECTION_TIERS: Readonly<Record<string, number>> = {
  "Kampioen": 0, "1e Divisie": 0, "Winnaarspoule": 0,
  "Talent": 1, "2e Divisie": 1, "Verliezerspoule": 1,
  "Wild": 2, "3e Divisie": 2,
};

function sectionName(section: SectionStandings): string {
  return section.sectionLabel.split(": ")[1] ?? section.sectionLabel;
}

export type OverallPlacement = Readonly<{
  position: number;
  of: number;
  points: number;
  sectionName: string;
}>;

export function tournamentOverallPlacement(
  sections: readonly SectionStandings[],
  tournamentNumber: number,
  playerId: string,
): OverallPlacement | null {
  const finals = sections.filter((section) =>
    section.tournamentNumber === tournamentNumber &&
    SECTION_TIERS[sectionName(section)] !== undefined);
  const mine = [...finals]
    .sort((a, b) =>
      SECTION_TIERS[sectionName(a)]! - SECTION_TIERS[sectionName(b)]!)
    .find((section) => section.standings.some(
      (entry) => entry.playerId === playerId));
  if (mine === undefined) { return null; }
  const within = sectionPlacement(mine, playerId);
  if (within === null) { return null; }
  const myTier = SECTION_TIERS[sectionName(mine)]!;
  const aboveCount = finals
    .filter((section) => SECTION_TIERS[sectionName(section)]! < myTier)
    .reduce((sum, section) => sum + section.standings.length, 0);
  const of = finals.reduce(
    (sum, section) => sum + section.standings.length, 0);
  return {
    position: aboveCount + within.position,
    of,
    points: within.points,
    sectionName: sectionName(mine),
  };
}

// The championship section of a tournament, using the recovered section
// hierarchy: TN12's Kampioen group, the 1e Divisie era, and the early
// Winnaarspoule tournaments.
const TOP_SECTION_PRIORITY = ["Kampioen", "1e Divisie", "Winnaarspoule"];

export type TournamentChampion = Readonly<{
  tournamentNumber: number;
  sectionLabel: string;
  playerId: string;
  displayName: string;
  points: number;
  characterId?: string;
  characterVariantId?: string;
}>;

export function tournamentChampions(
  sections: readonly SectionStandings[],
): readonly TournamentChampion[] {
  const byTournament = new Map<number, SectionStandings>();
  for (const section of sections) {
    const name = section.sectionLabel.split(": ")[1] ??
      section.sectionLabel;
    const priority = TOP_SECTION_PRIORITY.indexOf(name);
    if (priority === -1) { continue; }
    const current = byTournament.get(section.tournamentNumber);
    const currentName = current === undefined
      ? null
      : current.sectionLabel.split(": ")[1] ?? current.sectionLabel;
    const currentPriority = currentName === null
      ? Number.POSITIVE_INFINITY
      : TOP_SECTION_PRIORITY.indexOf(currentName);
    if (current === undefined || priority < currentPriority) {
      byTournament.set(section.tournamentNumber, section);
    }
  }
  const champions: TournamentChampion[] = [];
  for (const section of byTournament.values()) {
    const winner = [...section.standings].sort((a, b) =>
      b.points - a.points || a.playerId.localeCompare(b.playerId))[0];
    if (winner === undefined) { continue; }
    champions.push({
      tournamentNumber: section.tournamentNumber,
      sectionLabel: section.sectionLabel,
      playerId: winner.playerId,
      displayName: winner.displayName,
      points: winner.points,
      ...(winner.characterId === undefined ? {} : { characterId: winner.characterId }),
      ...(winner.characterVariantId === undefined
        ? {}
        : { characterVariantId: winner.characterVariantId }),
    });
  }
  champions.sort((a, b) => a.tournamentNumber - b.tournamentNumber);
  return champions;
}

function ordinal(position: number, language: "en" | "nl"): string {
  if (language === "nl") { return `${position}e`; }
  if (position === 1) { return "1st"; }
  if (position === 2) { return "2nd"; }
  if (position === 3) { return "3rd"; }
  return `${position}th`;
}

// The toughest opponent: finished ahead of this Player the most times;
// ties break on shared races (more = tougher), then Player id.
export function toughestOpponent(
  opponents: readonly TournamentOpponent[],
): TournamentOpponent | null {
  if (opponents.length === 0) { return null; }
  return [...opponents].sort((a, b) =>
    b.aheadOfMe - a.aheadOfMe ||
    b.sharedRaces - a.sharedRaces ||
    a.playerId.localeCompare(b.playerId))[0] ?? null;
}

// ---------------------------------------------------------------------

export type MountedTournamentCareer = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

export function mountTournamentCareer(
  root: HTMLElement,
  playerId: string,
  /**
   * The shareable name for the link into Ranking. Falls back to the Player id,
   * which that page resolves just as happily.
   */
  username: string | null = null,
): MountedTournamentCareer {
  const document = root.ownerDocument;
  useDocument(document);
  const controller = new AbortController();
  let disposed = false;
  const container = document.createElement("div");
  container.className = "ds-tournament-career";
  root.append(container);

  const ready = Promise.all([
    fetchRatingHistory(playerId, controller.signal).catch(() => []),
    fetchTournamentOpponents(playerId, controller.signal).catch(() => []),
    fetchTournamentStandings(controller.signal)
      .catch(() => [] as readonly SectionStandings[]),
  ]).then(([points, opponents, sections]) => {
    if (disposed) { return; }
    const career = tournamentCareer(points);
    if (career === null) { return; }
    const placementOf = (
      row: TournamentCareerRow,
    ): OverallPlacement | null =>
      tournamentOverallPlacement(
        sections, row.tournamentNumber, playerId);
    const tournamentPodiums = career.tournaments.filter((row) => {
      const placement = placementOf(row);
      return placement !== null && placement.position <= 3;
    }).length;
    // The career says how each tournament went. Where this Player is strong,
    // which tracks they should practise and who they keep running into lives
    // on the Tournament half of Ranking, and until now there was no way to
    // open it for anybody but yourself.
    const toRanking = button({
      label: localized(
        "Tracks, rivals and rating in Ranking →",
        "Banen, rivalen en rating in Ranking →",
      ),
      variant: "quiet",
      href: `/?ranking=tournament&player=${encodeURIComponent(username ?? playerId)}`,
    });
    const totals = statGrid([
      statBlock({ label: localized("Tournaments", "Toernooien"), value: String(career.totals.tournaments) }),
      statBlock({ label: localized("Tournament podiums", "Toernooipodia"), value: String(tournamentPodiums) }),
      statBlock({ label: "Races", value: String(career.totals.races) }),
      statBlock({ label: localized("Race wins", "Racezeges"), value: String(career.totals.wins) }),
      statBlock({ label: localized("Race podiums", "Racepodia"), value: String(career.totals.podiums) }),
      statBlock({ label: localized("Average finish", "Gemiddelde finish"), value: career.totals.averageFinish.toFixed(1) }),
    ]);
    const children: HTMLElement[] = [totals];
    const nemesis = toughestOpponent(opponents);
    if (nemesis !== null && nemesis.aheadOfMe > 0) {
      const line = document.createElement("p");
      line.className = "ds-tournament-career__nemesis ds-body-s";
      const label = document.createTextNode(localized(
        "Toughest opponent: ", "Sterkste tegenstander: "));
      const link = document.createElement("a");
      link.className = "ds-link";
      link.setAttribute(
        "href", `/?player=${encodeURIComponent(nemesis.playerId)}`);
      link.textContent = nemesis.displayName;
      const detail = document.createTextNode(localized(
        ` — ahead in ${nemesis.aheadOfMe} of ${nemesis.sharedRaces} shared races`,
        ` — eindigde voor deze speler in ${nemesis.aheadOfMe} van ${nemesis.sharedRaces} onderlinge races`));
      line.append(label, link, detail);
      children.push(line);
    }
    const list = document.createElement("ul");
    list.className = "ds-tournament-career__list";
    for (const row of career.tournaments) {
      const item = document.createElement("li");
      const placement = placementOf(row);
      const finish = placement === null ? "" : localized(
        ` · finished ${ordinal(placement.position, "en")} of ${placement.of} (${placement.points} pts)`,
        ` · ${ordinal(placement.position, "nl")} van ${placement.of} (${placement.points} pnt)`);
      item.textContent = localized(
        `TN${row.tournamentNumber} · ${row.finalSection}${finish} · ${row.races} races · ${row.wins} win${row.wins === 1 ? "" : "s"} · avg ${row.averageFinish.toFixed(1)}`,
        `TN${row.tournamentNumber} · ${row.finalSection}${finish} · ${row.races} races · ${row.wins} zege${row.wins === 1 ? "" : "s"} · gem. ${row.averageFinish.toFixed(1)}`);
      list.append(item);
    }
    children.push(disclosure({
      summary: localized(
        `Tournament history (${career.tournaments.length})`,
        `Toernooigeschiedenis (${career.tournaments.length})`),
      children: [list],
    }));
    container.append(panel({
      title: localized("Tournament career", "Toernooicarrière"),
      titleLevel: 2,
      actions: [toRanking.root],
      note: localized(
        "Standings derived from finish positions (official 15\u20131 scoring).",
        "Standen afgeleid van finishposities (officiële puntentelling 15\u20131)."),
      children,
    }));
  }).catch(() => undefined);

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
