// What the Tournaments page has to say to someone who is not running the night.
//
// A Director sees the console. Everybody else saw the same list of nights and
// nothing about themselves, which is the wrong answer to "am I in this?". This
// works out that answer from what the public documents carry, including the
// seat the night's own page now publishes.

import type { PublicTournamentEvent, PublicTournamentSummary } from
  "./tournament-operation-client.js";
import { displayTournamentGroupLabel } from "./tournaments-view-labels.js";

export type ViewerTournamentStanding =
  /** Racing tonight: the Player appears in a tournament that is not finished. */
  | Readonly<{
      kind: "participating";
      tournamentId: string;
      name: string;
      eventDate?: string;
      /** When the night starts, and the clock it starts by. */
      startAtMs?: number;
      timezone?: string;
      /** True once the night is being raced, rather than still being set up. */
      running: boolean;
      /** The group they are in, already in the reader's language ("Champion", not the stored "Kampioen"). */
      groupName?: string;
      groupRank?: number;
      /** Seated already, or still waiting for the Director to seat them. */
      seated: boolean;
      /** The reader's own SP rank when the night started, for its colour. */
      seedRank?: number;
      /** The console to sit at, once the Director has assigned one. */
      station?: Readonly<{
        /** Whose console it is, so the reader can open their profile. */
        ownerPlayerId?: string;
        ownerDisplayName: string;
        switchType: "ns1" | "ns2";
        seatNumber: number;
      }>;
      /**
       * Who else sits at that console. The night is played two to a Switch,
       * and each one is a person the reader can look up, with the SP rank the
       * WhatsApp picture colours them by.
       */
      seatMates: readonly Readonly<{
        displayName: string;
        playerId?: string;
        seedRank?: number;
      }>[];
      /**
       * How the night is going for them so far, once it has started scoring.
       * It grows with the evening: the group's own standing while the races
       * run, and the placement over everyone once the night is finished.
       */
      result?: Readonly<{
        points: number;
        races: number;
        wins: number;
        groupRank: number;
        groupSize: number;
        /** Only once the night is over. */
        placement?: number;
        of?: number;
      }>;
    }>
  /** Has raced before, but not in anything that is running now. */
  | Readonly<{ kind: "history"; latestTournamentId: string; latestName: string;
      eventDate?: string; placement?: number; of?: number }>
  /** Never appeared in a tournament. */
  | Readonly<{ kind: "never" }>;

/**
 * A Player is in a tournament when they hold a standing row in one of its
 * groups. Seated means the group they are in has actually started scoring:
 * before that, being listed is an invitation, not a seat.
 */
/**
 * Whether a night is being raced, which is the owner's own rule: from Step 5,
 * where the first scores are entered. Everything before it - the roster, the
 * groups, the layout and its export - is a night being made, however close it
 * is. One rule, so the shelf a night sits on and the card above it can never
 * say different things about the same evening.
 */
export function tournamentIsBeingRaced(
  stage: PublicTournamentSummary["stage"], workflowStep: number | undefined,
): boolean {
  if (stage === "finalized") { return false; }
  // The server carries the step on every night that is not finalized.
  return workflowStep !== undefined && workflowStep >= 5;
}

export function viewerStandingIn(
  event: PublicTournamentEvent,
  viewerPlayerId: string,
): ViewerTournamentStanding | null {
  // The last group they hold a row in, so a Player who has moved from the
  // qualifier into a final group is told about the group they are in now.
  const groups = [...event.groups].sort((left, right) =>
    (left.stage === right.stage ? left.sequence - right.sequence : left.stage === "qualifier" ? -1 : 1));
  for (const group of [...groups].reverse()) {
    const row = group.standings.find((entry) => entry.playerId === viewerPlayerId);
    if (row === undefined) { continue; }
    const seat = group.seating.find((entry) => entry.playerId === viewerPlayerId);
    // Everyone at the same console, in seat order and never themselves. The
    // group chat's own question is "who am I sitting with".
    const seatMates = seat === undefined ? [] : group.seating
      .filter((entry) =>
        entry.stationOwnerDisplayName === seat.stationOwnerDisplayName &&
        entry.switchType === seat.switchType &&
        entry.seatNumber !== seat.seatNumber)
      .sort((left, right) => left.seatNumber - right.seatNumber)
      .map((entry) => ({
        displayName: entry.displayName,
        ...(entry.playerId === undefined ? {} : { playerId: entry.playerId }),
        ...(entry.seedRank === undefined ? {} : { seedRank: entry.seedRank }),
      }));
    // The overall order exists while the night is still being raced, but it is
    // not a result yet: saying "26th of 36" halfway through the qualifiers
    // reads as a verdict on an evening that has not happened.
    const placement = event.stage === "finalized"
      ? event.overall.find((entry) => entry.playerId === viewerPlayerId)
      : undefined;
    return {
      kind: "participating",
      tournamentId: event.tournamentId,
      name: event.name,
      ...(event.eventDate === undefined ? {} : { eventDate: event.eventDate }),
      ...(event.startAtMs === undefined ? {} : { startAtMs: event.startAtMs }),
      ...(event.timezone === undefined ? {} : { timezone: event.timezone }),
      running: tournamentIsBeingRaced(event.stage, event.workflowStep),
      groupName: displayTournamentGroupLabel(group.name, group.tierKey),
      groupRank: row.rank,
      // A seat is the Director's answer to "where do I sit"; racing is the
      // answer to "has it started". Either one means you are not waiting.
      seated: row.races > 0 || seat !== undefined,
      ...(seat?.seedRank === undefined ? {} : { seedRank: seat.seedRank }),
      ...(seat === undefined ? {} : {
        station: {
          ...(seat.stationOwnerPlayerId === undefined
            ? {}
            : { ownerPlayerId: seat.stationOwnerPlayerId }),
          ownerDisplayName: seat.stationOwnerDisplayName,
          switchType: seat.switchType,
          seatNumber: seat.seatNumber,
        },
      }),
      seatMates,
      ...(row.races === 0 ? {} : {
        result: {
          points: row.points, races: row.races, wins: row.wins,
          groupRank: row.rank, groupSize: group.standings.length,
          ...(placement === undefined ? {} : { placement: placement.placement }),
          ...(event.overall.length === 0 ? {} : { of: event.overall.length }),
        },
      }),
    };
  }
  return null;
}

/**
 * Which of a reader's nights is the one to show them, most relevant first.
 *
 * The newest-touched night is the wrong answer: a Director editing next
 * Friday's roster makes it the newest, and the night being raced tonight drops
 * behind it. So a night that is actually being raced comes first, then the one
 * that starts soonest from now, and only then whatever was last touched.
 */
/**
 * How long a night that has started still counts as the one happening now: a
 * full day from its start time.
 *
 * A calendar date is the wrong measure. The evening runs past midnight, and
 * whoever opens the page at half past one wants the same card they had at
 * eight - the group, the console, who is beside them. A day from the start
 * covers that, and a night left half-scored last week still drops behind the
 * one that is actually coming.
 */
export const NIGHT_WINDOW_MS = 86_400_000;

/**
 * Whether this is the night on now: its start is within the last day, or it is
 * being raced and has not been abandoned. A night with no start time recorded
 * has only its stage to go on.
 */
export function tournamentIsTonight(
  summary: Readonly<{
    stage: PublicTournamentSummary["stage"];
    workflowStep?: number;
    startAtMs?: number;
  }>,
  now: number = Date.now(),
): boolean {
  const started = summary.startAtMs;
  if (started !== undefined && started <= now - NIGHT_WINDOW_MS) { return false; }
  return started !== undefined && started <= now
    ? true
    : tournamentIsBeingRaced(summary.stage, summary.workflowStep);
}

export function orderViewerNights(
  summaries: readonly PublicTournamentSummary[],
  now: number = Date.now(),
): readonly PublicTournamentSummary[] {
  const rank = (summary: PublicTournamentSummary): number => {
    if (tournamentIsTonight(summary, now)) { return 0; }
    return summary.startAtMs !== undefined && summary.startAtMs > now ? 1 : 2;
  };
  return [...summaries].sort((left, right) => {
    const order = rank(left) - rank(right);
    if (order !== 0) { return order; }
    // Among nights still to come, the nearest one; among the rest, the newest.
    return rank(left) === 1
      ? (left.startAtMs ?? 0) - (right.startAtMs ?? 0)
      : right.updatedAtMs - left.updatedAtMs;
  });
}

/**
 * The answer for one Player across everything the public list carries: the
 * night they are in if one is running, otherwise the last one they raced,
 * otherwise nothing at all.
 */
export function viewerTournamentStanding(
  summaries: readonly PublicTournamentSummary[],
  events: ReadonlyMap<string, PublicTournamentEvent>,
  viewerPlayerId: string | null,
): ViewerTournamentStanding {
  if (viewerPlayerId === null) { return { kind: "never" }; }
  const ordered = orderViewerNights(summaries);
  for (const summary of ordered) {
    if (summary.stage === "finalized") { continue; }
    const event = events.get(summary.tournamentId);
    if (event === undefined) { continue; }
    const standing = viewerStandingIn(event, viewerPlayerId);
    if (standing !== null) { return standing; }
    // A night still being set up has no groups yet, so no standing row holds
    // the reader - and that is exactly the night a countdown is for. The
    // server has already said they are on the list; the card can say when.
    if (summary.viewerParticipated === true) {
      return {
        kind: "participating",
        tournamentId: event.tournamentId,
        name: event.name,
        ...(event.eventDate === undefined ? {} : { eventDate: event.eventDate }),
        ...(event.startAtMs === undefined ? {} : { startAtMs: event.startAtMs }),
        ...(event.timezone === undefined ? {} : { timezone: event.timezone }),
        running: false,
        seated: false,
        seatMates: [],
      };
    }
  }
  for (const summary of ordered) {
    const event = events.get(summary.tournamentId);
    if (event === undefined) { continue; }
    const placement = event.overall.find((entry) => entry.playerId === viewerPlayerId);
    const inGroups = event.groups.some(
      (group) => group.standings.some((entry) => entry.playerId === viewerPlayerId),
    );
    if (placement === undefined && !inGroups) { continue; }
    return {
      kind: "history",
      latestTournamentId: event.tournamentId,
      latestName: event.name,
      ...(event.eventDate === undefined ? {} : { eventDate: event.eventDate }),
      ...(placement === undefined ? {} : { placement: placement.placement }),
      ...(event.overall.length === 0 ? {} : { of: event.overall.length }),
    };
  }
  return { kind: "never" };
}

/**
 * Where to sit. The night is played on Nintendo Switch consoles the community
 * supplies, and the marker is the one the group chat already uses: [NS1] or
 * [NS2] against the owner's own name. Until the Director seats you there is
 * nothing to say but that, and this never invents a console.
 *
 * A start time is deliberately absent: the tournament data carries a date and
 * no time, so writing one here would be a guess.
 */
export function seatingMessage(
  standing: Extract<ViewerTournamentStanding, { kind: "participating" }>,
  localize: (english: string, dutch: string) => string,
): string {
  const when = standing.eventDate === undefined
    ? ""
    : ` · ${standing.eventDate}`;
  if (standing.station !== undefined) {
    const marker = standing.station.switchType === "ns2" ? "[NS2]" : "[NS1]";
    const owner = stationLabel(standing.station.ownerDisplayName);
    return localize(
      `You are racing in ${standing.name}${when}, in ${standing.groupName ?? "your group"} · ${marker} ${owner}, seat #${standing.station.seatNumber}.`,
      `Je rijdt mee in ${standing.name}${when}, in ${standing.groupName ?? "je groep"} · ${marker} ${owner}, plek #${standing.station.seatNumber}.`,
    );
  }
  return standing.seated
    ? localize(
      `You are racing in ${standing.name}${when}, in ${standing.groupName ?? "your group"}.`,
      `Je rijdt mee in ${standing.name}${when}, in ${standing.groupName ?? "je groep"}.`,
    )
    : localize(
      `You are in ${standing.name}${when}. Wait to be seated by the Director.`,
      `Je staat in ${standing.name}${when}. Wacht tot de Director je een plek geeft.`,
    );
}

/**
 * "Nintendo Switch van Bas" - the owner's own name, with any stored prefix
 * removed first so it is never written twice. The same rule the WhatsApp
 * layout export has always used.
 */
function stationLabel(ownerDisplayName: string): string {
  const owner = ownerDisplayName
    .replace(/^(Nintendo Switch van|Switch van|Console)\s+/i, "")
    .trim();
  return owner === "" ? "Nintendo Switch" : `Nintendo Switch van ${owner}`;
}
