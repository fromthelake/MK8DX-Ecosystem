// ADR-0219: finding yourself at sign-up, with context.
//
// A new account answers two questions - are your Time Trial times already on
// this website, have you taken part in a tournament listed here - and then
// types the name it races under. Each Player that name may mean comes back
// with exactly the public context that tells the namesakes apart: published
// Time Trials (how many, the last one, the classes) and public nights (how
// many, their Directors, the last one). Players who fit the answers come
// first. Nothing here requests or approves a claim (ADR-0006, ADR-0178).

import { rosterNameKey } from "../tournaments/tournament-operation-service.js";

export const CLAIM_CANDIDATE_LIMIT = 20;
/** How many name matches get their context read before the answers sort them. */
export const CLAIM_CANDIDATE_CONTEXT_LIMIT = 100;

export type ClaimCandidateAnswers = Readonly<{ timeTrials: boolean; tournaments: boolean }>;

/** A Player with every name it answers to; the internal id never leaves the server. */
export type NamedClaimPlayer = Readonly<{
  internalId: number;
  playerId: string;
  username: string;
  displayName: string;
  /** Installation-wide public aliases only; a Director's own aliases are theirs (ADR-0218). */
  aliases: readonly string[];
}>;

export type ClaimCandidateTimeTrials = Readonly<{
  times: number;
  /** Date (YYYY-MM-DD, UTC) of the most recent published time, or null. */
  lastAt: string | null;
  classes: readonly (150 | 200)[];
}>;

export type ClaimCandidateTournaments = Readonly<{
  nights: number;
  directorNames: readonly string[];
  lastNight: Readonly<{ name: string; date: string | null }> | null;
}>;

/** Public context of one Player; a private Player's context is empty. */
export type ClaimCandidateContext = Readonly<{
  claimed: boolean;
  timeTrials: ClaimCandidateTimeTrials;
  tournaments: ClaimCandidateTournaments;
}>;

export type ClaimCandidateMatch = "exact" | "prefix" | "partial";

export type ClaimCandidate = Readonly<{
  playerId: string;
  username: string;
  displayName: string;
  aliases: readonly string[];
  claimed: boolean;
  /** The Player has what the person said they have (Time Trials, nights, or either when both). */
  matchesAnswers: boolean;
  timeTrials: ClaimCandidateTimeTrials;
  tournaments: ClaimCandidateTournaments;
}>;

export const EMPTY_CLAIM_CANDIDATE_CONTEXT: ClaimCandidateContext = {
  claimed: false,
  timeTrials: { times: 0, lastAt: null, classes: [] },
  tournaments: { nights: 0, directorNames: [], lastNight: null },
};

const MATCH_ORDER: Readonly<Record<ClaimCandidateMatch, number>> = { exact: 0, prefix: 1, partial: 2 };

/**
 * The comparison key of a name: the roster key (accents and punctuation
 * dropped), or, for a name written entirely in another script, the trimmed
 * lower-case name itself so that it can still be found.
 */
export function claimNameKey(value: string): string {
  const key = rosterNameKey(value);
  return key.length > 0 ? key : value.trim().toLocaleLowerCase();
}

/** How a Player's names match what was typed, or null. */
export function claimNameMatch(player: NamedClaimPlayer, query: string): ClaimCandidateMatch | null {
  const wanted = claimNameKey(query);
  if (wanted.length === 0) { return null; }
  const keys = [player.displayName, player.username, ...player.aliases]
    .map(claimNameKey)
    .filter((key) => key.length > 0);
  if (keys.some((key) => key === wanted)) { return "exact"; }
  if (keys.some((key) => key.startsWith(wanted))) { return "prefix"; }
  if (wanted.length >= 2 && keys.some((key) => key.includes(wanted))) { return "partial"; }
  return null;
}

/** The Players a typed name may mean, best name match first, at most `limit`. */
export function matchClaimPlayers(
  players: readonly NamedClaimPlayer[],
  query: string,
  limit = CLAIM_CANDIDATE_CONTEXT_LIMIT,
): readonly Readonly<{ player: NamedClaimPlayer; match: ClaimCandidateMatch }>[] {
  const found: { player: NamedClaimPlayer; match: ClaimCandidateMatch }[] = [];
  for (const player of players) {
    const match = claimNameMatch(player, query);
    if (match !== null) { found.push({ player, match }); }
  }
  return found
    .sort((left, right) => MATCH_ORDER[left.match] - MATCH_ORDER[right.match] ||
      left.player.displayName.localeCompare(right.player.displayName, "nl") ||
      left.player.username.localeCompare(right.player.username, "nl"))
    .slice(0, limit);
}

/** Whether a Player has what the person said they have. With no "yes" every Player fits. */
export function matchesClaimAnswers(context: ClaimCandidateContext, answers: ClaimCandidateAnswers): boolean {
  if (!answers.timeTrials && !answers.tournaments) { return true; }
  return (answers.timeTrials && context.timeTrials.times > 0) ||
    (answers.tournaments && context.tournaments.nights > 0);
}

/**
 * The candidates in the order the person should see them: Players who fit the
 * answers first, then the better name match, then the Player with more of what
 * was answered (times, nights), then by name. Unfitting Players stay in the
 * list (after the fitting ones) because a private Player shows no context and
 * a person may misremember; the client tells the two groups apart.
 */
export function rankClaimCandidates(
  matched: readonly Readonly<{ player: NamedClaimPlayer; match: ClaimCandidateMatch }>[],
  contexts: ReadonlyMap<number, ClaimCandidateContext>,
  answers: ClaimCandidateAnswers,
  limit = CLAIM_CANDIDATE_LIMIT,
): readonly ClaimCandidate[] {
  const weight = (context: ClaimCandidateContext): number =>
    (answers.timeTrials ? context.timeTrials.times : 0) + (answers.tournaments ? context.tournaments.nights : 0);
  return matched
    .map(({ player, match }) => {
      const context = contexts.get(player.internalId) ?? EMPTY_CLAIM_CANDIDATE_CONTEXT;
      return { player, match, context, fits: matchesClaimAnswers(context, answers) };
    })
    .sort((left, right) => Number(right.fits) - Number(left.fits) ||
      MATCH_ORDER[left.match] - MATCH_ORDER[right.match] ||
      weight(right.context) - weight(left.context) ||
      left.player.displayName.localeCompare(right.player.displayName, "nl") ||
      left.player.username.localeCompare(right.player.username, "nl"))
    .slice(0, limit)
    .map(({ player, context, fits }) => ({
      playerId: player.playerId,
      username: player.username,
      displayName: player.displayName,
      aliases: player.aliases.slice(0, 8),
      claimed: context.claimed,
      matchesAnswers: fits,
      timeTrials: {
        times: context.timeTrials.times,
        lastAt: context.timeTrials.lastAt,
        classes: [...context.timeTrials.classes],
      },
      tournaments: {
        nights: context.tournaments.nights,
        directorNames: context.tournaments.directorNames.slice(0, 5),
        lastNight: context.tournaments.lastNight,
      },
    }));
}
