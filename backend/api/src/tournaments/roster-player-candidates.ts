// ADR-0218: a name is never an identity.
//
// Typing "Marc" in a roster, or a roster file naming "Marc", yields candidates
// with enough context to tell the Marcs apart - whose nights they played, the
// last night, a character picture when one was recorded, claimed or not - and
// the client always offers "new Player" beside them. Nothing here links a
// name to a Player: the Director's explicit choice does, through the ordinary
// participant writes that carry Player ids.

import { rosterNameKey, type PlayerRecord } from "./tournament-operation-service.js";

export const ROSTER_CANDIDATES_PER_NAME = 10;

/** Everything the picker may say about one Player, seen from one Director. */
export type RosterCandidateContext = Readonly<{
  player: PlayerRecord;
  /** Installation-wide public aliases and this Director's own aliases. */
  aliases: readonly Readonly<{ text: string; directorScoped: boolean }>[];
  claimed: boolean;
  /** Nights the Player was present at, plus legacy and history editions. */
  nights: number;
  /** Nights of this Director the Player was present at. */
  nightsWithDirector: number;
  /** On any roster of this Director (present, waiting or absent). */
  knownToDirector: boolean;
  lastNightName: string | null;
  lastNightDate: string | null;
  directorNames: readonly string[];
  characterKey: string | null;
  characterLabel: string | null;
  inTournament: boolean;
}>;

export type RosterCandidateMatch = "display_name" | "alias" | "username" | "partial";

export type RosterPlayerCandidate = Readonly<{
  playerId: string;
  username: string;
  displayName: string;
  matchedBy: RosterCandidateMatch;
  aliasText?: string;
  /** "director" when the alias is this Director's own, else "installation". */
  aliasScope?: "director" | "installation";
  claimed: boolean;
  inTournament: boolean;
  nights: number;
  nightsWithDirector: number;
  lastNightName?: string;
  lastNightDate?: string;
  directorNames: readonly string[];
  characterKey?: string;
  characterLabel?: string;
}>;

export type RosterNameCandidates = Readonly<{
  name: string;
  /**
   * The name is already the display name of a Player on this Director's
   * rosters: creating a new Player with it asks for a confirmation first.
   */
  sameNameInOwnNights: boolean;
  candidates: readonly RosterPlayerCandidate[];
}>;

const MATCH_ORDER: Readonly<Record<RosterCandidateMatch, number>> = {
  display_name: 0, alias: 1, username: 2, partial: 3,
};

/** The trimmed, case-folded form the creation check compares (migration 0043's key). */
export function displayNameKey(value: string): string {
  return value.trim().toLowerCase();
}

function candidateFor(
  context: RosterCandidateContext,
  matchedBy: RosterCandidateMatch,
  alias?: Readonly<{ text: string; directorScoped: boolean }>,
): RosterPlayerCandidate {
  return {
    playerId: context.player.playerId,
    username: context.player.username,
    displayName: context.player.displayName,
    matchedBy,
    ...(alias === undefined ? {} : {
      aliasText: alias.text,
      aliasScope: alias.directorScoped ? "director" as const : "installation" as const,
    }),
    claimed: context.claimed,
    inTournament: context.inTournament,
    nights: context.nights,
    nightsWithDirector: context.nightsWithDirector,
    ...(context.lastNightName === null ? {} : { lastNightName: context.lastNightName }),
    ...(context.lastNightDate === null ? {} : { lastNightDate: context.lastNightDate }),
    directorNames: context.directorNames.slice(0, 5),
    ...(context.characterKey === null ? {} : { characterKey: context.characterKey }),
    ...(context.characterLabel === null ? {} : { characterLabel: context.characterLabel }),
  };
}

/**
 * Candidates for each typed name. Exact matches on the display name, an alias
 * (this Director's first) or the username come first; with `partial` the
 * names that merely contain what was typed follow. Within one kind of match
 * the Players of this night, then of this Director's nights, come first.
 */
export function rosterCandidatesFor(
  names: readonly string[],
  contexts: readonly RosterCandidateContext[],
  options: Readonly<{ partial?: boolean; limit?: number }> = {},
): readonly RosterNameCandidates[] {
  const limit = options.limit ?? ROSTER_CANDIDATES_PER_NAME;
  return names.map((name) => {
    const key = rosterNameKey(name);
    const found = new Map<string, Readonly<{ candidate: RosterPlayerCandidate; context: RosterCandidateContext }>>();
    const offer = (context: RosterCandidateContext, candidate: RosterPlayerCandidate): void => {
      const existing = found.get(context.player.playerId);
      if (existing !== undefined && MATCH_ORDER[existing.candidate.matchedBy] <= MATCH_ORDER[candidate.matchedBy]) { return; }
      found.set(context.player.playerId, { candidate, context });
    };
    if (key.length > 0) {
      for (const context of contexts) {
        if (!context.player.active) { continue; }
        if (rosterNameKey(context.player.displayName) === key) {
          offer(context, candidateFor(context, "display_name"));
          continue;
        }
        const aliases = [...context.aliases].sort((left, right) => Number(right.directorScoped) - Number(left.directorScoped));
        const alias = aliases.find((entry) => rosterNameKey(entry.text) === key);
        if (alias !== undefined) {
          offer(context, candidateFor(context, "alias", alias));
          continue;
        }
        if (rosterNameKey(context.player.username) === key) {
          offer(context, candidateFor(context, "username"));
          continue;
        }
        if (options.partial === true && key.length >= 2 && (
          rosterNameKey(context.player.displayName).includes(key) ||
          rosterNameKey(context.player.username).includes(key) ||
          context.aliases.some((entry) => rosterNameKey(entry.text).includes(key)))) {
          offer(context, candidateFor(context, "partial"));
        }
      }
    }
    const ranked = [...found.values()].sort((left, right) =>
      MATCH_ORDER[left.candidate.matchedBy] - MATCH_ORDER[right.candidate.matchedBy] ||
      Number(right.context.inTournament) - Number(left.context.inTournament) ||
      right.context.nightsWithDirector - left.context.nightsWithDirector ||
      right.context.nights - left.context.nights ||
      left.candidate.displayName.localeCompare(right.candidate.displayName, "nl") ||
      left.candidate.username.localeCompare(right.candidate.username, "nl"));
    const wanted = displayNameKey(name);
    return {
      name,
      sameNameInOwnNights: contexts.some((context) =>
        context.knownToDirector && displayNameKey(context.player.displayName) === wanted),
      candidates: ranked.slice(0, limit).map((entry) => entry.candidate),
    };
  });
}
