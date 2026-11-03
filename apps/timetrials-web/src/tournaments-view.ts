// What a night *is*, in the words the list and the night page both read from.
//
// The DOM of W17 (the list) and W19–W21 (the night) lives in `ds-tournaments.ts` since Phase 11;
// this module is the derivation the two share and the one the tests pin: which shelf a night
// belongs on, how late it is, what its row says about itself, which pictures it has and which of
// them is where it actually stands. Nothing here draws, and nothing here decides scoring,
// standings or publication (class C).

import type { PublicTournamentEvent, PublicTournamentSummary } from "./tournament-operation-client.js";
import type { TournamentExportMode } from "./tournament-export-image.js";
import { localized } from "./product-language.js";
import { tournamentIsBeingRaced } from "./tournament-viewer-standing.js";
import { formatTournamentStart } from "./tournament-start-clock.js";

export type MountedTournamentsView = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

export { tournamentGroupLabel } from "./tournaments-view-labels.js";

/** A past edition served from the community's own history, read-only. */
export function isHistoryEditionId(tournamentId: string): boolean {
  return /^tournament\.history-tn\d+$/u.test(tournamentId);
}

export function tournamentStageLabel(stage: PublicTournamentSummary["stage"]): string {
  switch (stage) {
    case "setup": return localized("Preparing", "Voorbereiden");
    case "qualifiers": return localized("Qualifiers in progress", "Kwalificaties bezig");
    case "finals": return localized("Finals in progress", "Finales bezig");
    case "finalized": return localized("Final results", "Einduitslag");
    default: return localized("Tournament", "Toernooi");
  }
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_NL = ["Jan", "Feb", "Mrt", "Apr", "Mei", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];

/** A night's date with the month in letters: 2026-Sep-05, never 2026-09-05. */
export function formatTournamentDate(value: string | undefined, finalizedAtMs?: number): string {
  const iso = value ?? (finalizedAtMs === undefined ? undefined : new Date(finalizedAtMs).toISOString().slice(0, 10));
  if (iso === undefined) { return ""; }
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(iso);
  if (parts === null) { return iso; }
  const month = (localized("en", "nl") === "nl" ? MONTHS_NL : MONTHS_EN)[Number(parts[2]) - 1] ?? parts[2];
  return `${parts[1]}-${month}-${parts[3]}`;
}

/**
 * Which of the shelves a night belongs on.
 *
 * "Bezig" is the owner's own word for a night that is being raced, and that begins at Step 5, where
 * the first scores are entered. Everything before it - the roster, the groups, the layout and its
 * export - is a night being made, however close it is. Splitting them keeps "Bezig" meaning one
 * thing: look here, this is happening.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A full day past its start, a night that is still open says so. An evening runs past midnight and
 * somebody finishes the scoring the next morning; a day later than that, something has gone wrong.
 */
export const TOURNAMENT_OVERDUE_MS = DAY_MS;

/**
 * Three days past its start it is not "in progress" by any reading: it never finished. It moves to
 * its own shelf rather than standing at the top of the page pretending to be tonight.
 */
export const TOURNAMENT_STALLED_MS = 3 * DAY_MS;

/** When the night began, from the clock if it has one and the day if not. */
export function tournamentStartedMs(
  summary: Pick<PublicTournamentSummary, "startAtMs" | "eventDate">,
): number | undefined {
  if (summary.startAtMs !== undefined) { return summary.startAtMs; }
  if (summary.eventDate === undefined) { return undefined; }
  const parsed = Date.parse(`${summary.eventDate}T12:00:00Z`);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * How many whole days a night is past its start, once it is a day past it and still not finished.
 * `null` while it is finished, or still in its own day.
 */
export function tournamentOverdueDays(
  summary: PublicTournamentSummary,
  now: number = Date.now(),
): number | null {
  if (summary.stage === "finalized") { return null; }
  const start = tournamentStartedMs(summary);
  if (start === undefined || start > now - TOURNAMENT_OVERDUE_MS) { return null; }
  return Math.floor((now - start) / DAY_MS);
}

export type TournamentShelf =
  "running" | "soon" | "draft" | "stalled" | "unpublished" | "removed" | "finished";

export function tournamentListShelf(
  summary: PublicTournamentSummary,
  now: number = Date.now(),
): TournamentShelf {
  // A removed night is out of everything - the lists, the results and the rating - and only its
  // administrator is told it is still there at all.
  if (summary.removed === true) { return "removed"; }
  // A finished night the community cannot read is not in the archive: it is the Director's own,
  // waiting to be published or left alone. The server sends `published: false` only to somebody
  // who may see it at all.
  if (summary.stage === "finalized") {
    return summary.published === false ? "unpublished" : "finished";
  }
  const started = tournamentStartedMs(summary);
  // Three days late is not late any more: it is a night nobody closed.
  if (started !== undefined && started <= now - TOURNAMENT_STALLED_MS) { return "stalled"; }
  if (tournamentIsBeingRaced(summary.stage, summary.workflowStep)) { return "running"; }
  // A night with its start still ahead is coming, not merely being made. It is the one a reader
  // most wants to find, and a signed-out visitor has no card to be told it by.
  return summary.startAtMs !== undefined && summary.startAtMs > now ? "soon" : "draft";
}

/**
 * What a row says about itself, which has to agree with the shelf it is on. The stage alone said
 * "Kwalificaties bezig" over a night sitting under "In aanmaak", because the stage turns a step
 * before the racing does.
 */
export function tournamentRowStatus(
  summary: PublicTournamentSummary,
  shelf: TournamentShelf,
): string {
  if (shelf === "soon" && summary.startAtMs !== undefined) {
    return formatTournamentStart(summary.startAtMs, summary.timezone);
  }
  if (shelf === "draft" || shelf === "soon") { return localized("Preparing", "Voorbereiden"); }
  return tournamentStageLabel(summary.stage);
}

/** The SP-rank band a seed falls in, as the APK colours it. */
export function tournamentSeedTierKey(seedRank: number | undefined): string {
  if (seedRank === undefined || seedRank < 1) { return "unknown"; }
  return ["champion", "talent", "wild", "adventure", "feest"][Math.floor((seedRank - 1) / 12)] ?? "unknown";
}

export type PublicCheckpoint = Readonly<{
  key: string; label: string; stage: "qualifier" | "final"; mode: TournamentExportMode;
}>;

/** The four pictures the APK offers, as far as this night has them. */
export function publicTournamentCheckpoints(event: PublicTournamentEvent): readonly PublicCheckpoint[] {
  // A standing row exists the moment somebody is placed in a group, with a zero beside their name.
  // Offering that as "the result" made a night at Step 5 look like a night that had finished its
  // qualifiers: the picture showed two groups of noughts. A result needs a race to have been driven.
  const has = (stage: "qualifier" | "final", mode: TournamentExportMode): boolean =>
    event.groups.some((group) => group.stage === stage && (mode === "layout"
      ? group.seating.length > 0
      : group.standings.some((row) => row.races > 0)));
  const all: PublicCheckpoint[] = [
    { key: "qualifier-layout", label: localized("Qualifier layout", "Kwalificatie-indeling"), stage: "qualifier", mode: "layout" },
    { key: "qualifier-results", label: localized("Qualifier result", "Kwalificatie-uitslag"), stage: "qualifier", mode: "results" },
    { key: "final-layout", label: localized("Final group layout", "Eindgroep-indeling"), stage: "final", mode: "layout" },
    { key: "final-results", label: localized("Final result", "Eindgroep-uitslag"), stage: "final", mode: "results" },
  ];
  return all.filter((checkpoint) => has(checkpoint.stage, checkpoint.mode));
}

/**
 * Where the night stands, which is not always the newest picture on offer. A stage's result is only
 * the result once every group in it has raced: with one group of three scored, the results drawing
 * is two columns of noughts beside one real standing, and posting that reads as a finished
 * qualifier. The tab stays available for a Director who wants the interim standing; this is only
 * what opens by default.
 */
export function publicTournamentCurrentCheckpoint(
  event: PublicTournamentEvent,
): PublicCheckpoint | undefined {
  const checkpoints = publicTournamentCheckpoints(event);
  const complete = (checkpoint: PublicCheckpoint): boolean => {
    const groups = event.groups.filter((group) => group.stage === checkpoint.stage);
    if (groups.length === 0) { return false; }
    return checkpoint.mode === "layout"
      ? groups.every((group) => group.seating.length > 0)
      : groups.every((group) => group.standings.some((row) => row.races > 0));
  };
  for (let index = checkpoints.length - 1; index >= 0; index -= 1) {
    const checkpoint = checkpoints[index]!;
    if (complete(checkpoint)) { return checkpoint; }
  }
  return checkpoints[checkpoints.length - 1];
}
