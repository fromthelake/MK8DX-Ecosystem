// Tournament rank classification - RECOVERED semantics, not invented.
//
// Source evidence: apps/tournament-manager/assets/app.js
//   FIXED_TIER_DEFINITIONS + tierByStanding(): the all-time Tournament
//   ranking is divided into fixed groups of twelve (the lobby size).
//   Colors come from the same product's tier badges
//   (.player-tier-badge.tier-*).
//
// Dutch is the canonical product language of these names; the English ones
// are the owner-approved translations (Kampioen->Champion, Talent->Talent,
// Wild->Wild, Avontuur->Adventure, Feest->Party, and for the ranking bands
// beyond the fifth group Paddenstoel->Mushroom, Inktvis->Squid,
// Schild->Shield, Wolk->Cloud, Toerist->Tourist, Munt->Coin). The reader
// always sees them in their own language through `tournamentTierLabel`.
// A rank outside the defined bands has no label ("Onbekend" in the source);
// the pages simply show no badge then. This is a TOURNAMENT concept - never
// mix it with Time Trial Mastery.

import { localized } from "./product-language.js";

export type TournamentGroupTierKey = "champion" | "talent" | "wild" | "adventure" | "feest";
export type TournamentRankingBandKey = TournamentGroupTierKey
  | "mushroom" | "squid" | "shield" | "cloud" | "tourist" | "coin";

export type TournamentTier<Key extends string = TournamentGroupTierKey> = Readonly<{
  key: Key;
  /** The English name; `tournamentTierLabel` gives the reader's language. */
  name: string;
  dutchName: string;
  minRank: number;
  maxRank: number;
  color: string;
}>;

/**
 * The five tiers a final group can be: a night has at most five final groups,
 * and this list is also the final-group layout (do not extend it with the
 * ranking bands below).
 */
export const TOURNAMENT_TIERS: readonly TournamentTier[] = [
  { key: "champion", name: "Champion", dutchName: "Kampioen", minRank: 1, maxRank: 12,
    color: "#F59E0B" },
  { key: "talent", name: "Talent", dutchName: "Talent", minRank: 13, maxRank: 24,
    color: "#38BDF8" },
  { key: "wild", name: "Wild", dutchName: "Wild", minRank: 25, maxRank: 36,
    color: "#A78BFA" },
  { key: "adventure", name: "Adventure", dutchName: "Avontuur", minRank: 37, maxRank: 48,
    color: "#4ADE80" },
  { key: "feest", name: "Party", dutchName: "Feest", minRank: 49, maxRank: 60,
    color: "#EC4899" },
];

/**
 * The all-time ranking's badge: eleven bands of twelve (ranks 1-132). The
 * first five are the group tiers themselves; the six after them only ever
 * appear as a ranking badge, never as a final group. Their colours are a
 * proposal awaiting owner approval - each lives on its own line here.
 */
export const TOURNAMENT_RANKING_BANDS: readonly TournamentTier<TournamentRankingBandKey>[] = [
  ...TOURNAMENT_TIERS,
  { key: "mushroom", name: "Mushroom", dutchName: "Paddenstoel", minRank: 61, maxRank: 72,
    color: "#EF4444" },
  { key: "squid", name: "Squid", dutchName: "Inktvis", minRank: 73, maxRank: 84,
    color: "#14B8A6" },
  { key: "shield", name: "Shield", dutchName: "Schild", minRank: 85, maxRank: 96,
    color: "#1D4ED8" },
  { key: "cloud", name: "Cloud", dutchName: "Wolk", minRank: 97, maxRank: 108,
    color: "#E2E8F0" },
  { key: "tourist", name: "Tourist", dutchName: "Toerist", minRank: 109, maxRank: 120,
    color: "#A3E635" },
  { key: "coin", name: "Coin", dutchName: "Munt", minRank: 121, maxRank: 132,
    color: "#9A3412" },
];

/**
 * A tier's or band's name in the reader's language. Every name is written out
 * as its own `localized` call so the message extraction (and so every product
 * language's catalog) carries it. Null for a key that is no tier.
 */
export function tournamentTierLabel(key: string): string | null {
  switch (key) {
    case "champion": return localized("Champion", "Kampioen");
    case "talent": return localized("Talent", "Talent");
    case "wild": return localized("Wild", "Wild");
    case "adventure": return localized("Adventure", "Avontuur");
    case "feest": return localized("Party", "Feest");
    case "mushroom": return localized("Mushroom", "Paddenstoel");
    case "squid": return localized("Squid", "Inktvis");
    case "shield": return localized("Shield", "Schild");
    case "cloud": return localized("Cloud", "Wolk");
    case "tourist": return localized("Tourist", "Toerist");
    case "coin": return localized("Coin", "Munt");
    default: return null;
  }
}

/**
 * The group tier a stored group name stands for, when the group carries no
 * tier key: the server stores final groups under their Dutch name
 * ("Kampioen"), and older documents sometimes under the English one.
 */
export function tournamentGroupTierByName(name: string): TournamentTier | undefined {
  const normalized = name.trim().toLocaleLowerCase("nl");
  return TOURNAMENT_TIERS.find((tier) =>
    tier.dutchName.toLocaleLowerCase("nl") === normalized
    || tier.name.toLocaleLowerCase("en") === normalized);
}

/**
 * The colour a Tournament group is drawn in: the board's edge, the chip beside its name and the
 * wash a qualifier row carries for the final group it went on to.
 *
 * ONE definition (Phase 11). The report used to carry a second, paler set for the light "paper" it
 * was printed on; with the paper gone there is one, the site's own — including the two an early
 * edition used for its winners' and losers' poule, which are group names rather than places in the
 * all-time ranking. The colour is product data (§6) and never the only carrier: the group is always
 * named in words beside it.
 */
export function tournamentGroupColour(tierKey: string | undefined): string | null {
  if (tierKey === undefined) { return null; }
  const key = tierKey === "winners" ? "champion" : tierKey === "losers" ? "talent" : tierKey;
  return TOURNAMENT_TIERS.find((tier) => tier.key === key)?.color ?? null;
}

/** The all-time ranking badge for a rank: one of the eleven bands, or none above 132. */
export function tournamentTierByRank(rank: number): TournamentTier<TournamentRankingBandKey> | null {
  if (!Number.isSafeInteger(rank) || rank <= 0) { return null; }
  return TOURNAMENT_RANKING_BANDS.find((tier) =>
    rank >= tier.minRank && rank <= tier.maxRank) ?? null;
}
