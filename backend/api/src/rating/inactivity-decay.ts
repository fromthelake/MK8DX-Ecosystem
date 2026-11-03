// Inactivity decay (ADR-0189).
//
// A rating that never fades says a player is still as good as the last time
// anyone saw them, which stops being true. So after a grace period a rating
// falls back toward the prior, and reaches it after two years away.
//
// mu and sigma revert at the same rate, and that is the load-bearing choice.
// The prior (25, 25/3) is exactly score zero, so:
//
//   score' = mu' - 3*sigma'
//          = (25 + (mu-25)r) - 3*(25/3 + (sigma-25/3)r)
//          = r * (mu - 3*sigma)
//
// The displayed score therefore shrinks in exact proportion, monotonically,
// and cannot pass through zero into negative territory whatever the player's
// mu was. Widening sigma alone does not have that property: `mu - 3*sigma`
// falls three times as fast through sigma as it rises through mu, so every
// below-average player is dragged below zero on the way down. Measured on the
// real history that put one player at -15.8.
//
// The curve is a half-life, normalised over its window so it lands on zero
// instead of jumping to it. A plain half-life never reaches zero and would
// need a cliff at the two-year mark.

import {
  RATING_INITIAL_MU,
  RATING_INITIAL_SIGMA,
  type Rating,
} from "./trueskill-engine.js";

export type DecayParameters = Readonly<{
  /** Days of absence that cost nothing at all. */
  graceDays: number;
  /** Days of absence after which the rating is exactly the prior. */
  dormantDays: number;
  /** Shape: days for the remaining rating to halve, before normalisation. */
  halfLifeDays: number;
}>;

// Grace is a year, which is not an arbitrary round number: missing exactly one
// tournament puts 217 to 315 days between a player's own races, so a year of
// grace means **one missed tournament costs nothing at all**. That is a rule
// somebody can hold in their head, which a percentage is not.
//
// Zero at three years. Two was tried first and reached zero faster than the
// club forgets people; three lets the slide be visible for longer, which is the
// point of showing it.
//
// The half-life shapes the curve in between. It is the dial the owner set, and
// what it now decides is what missing a *second* tournament costs - the first
// is free. At 300 days somebody who misses two and returns after 448 days
// keeps 79%, and after three tournaments 54%.
export const DEFAULT_DECAY_PARAMETERS: DecayParameters = {
  graceDays: 365, dormantDays: 1095, halfLifeDays: 300,
};

export const MILLISECONDS_PER_DAY = 86_400_000;

export class InactivityDecayError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InactivityDecayError";
  }
}

/**
 * The fraction of a rating's distance from the prior that survives `days` of
 * absence. Exactly 1 within the grace period, exactly 0 from the dormant mark,
 * strictly decreasing in between.
 */
export function remainingFraction(
  days: number,
  parameters: DecayParameters = DEFAULT_DECAY_PARAMETERS,
): number {
  const { graceDays, dormantDays, halfLifeDays } = parameters;
  if (!(dormantDays > graceDays) || !(halfLifeDays > 0) || graceDays < 0) {
    throw new InactivityDecayError(
      "decay needs a positive half-life and a dormant mark after the grace",
    );
  }
  if (!Number.isFinite(days)) {
    throw new InactivityDecayError("days of absence must be a finite number");
  }
  if (days <= graceDays) { return 1; }
  if (days >= dormantDays) { return 0; }
  const window = dormantDays - graceDays;
  const residual = 0.5 ** (window / halfLifeDays);
  const active = days - graceDays;
  return (0.5 ** (active / halfLifeDays) - residual) / (1 - residual);
}

/** Revert a rating toward the prior by the fraction the absence has cost. */
export function decayRating(
  rating: Rating,
  days: number,
  parameters: DecayParameters = DEFAULT_DECAY_PARAMETERS,
): Rating {
  const remaining = remainingFraction(days, parameters);
  if (remaining === 1) { return rating; }
  return {
    mu: RATING_INITIAL_MU + (rating.mu - RATING_INITIAL_MU) * remaining,
    sigma: RATING_INITIAL_SIGMA +
      (rating.sigma - RATING_INITIAL_SIGMA) * remaining,
  };
}

/** Whole days between two instants, floored; never negative. */
export function daysBetween(fromMs: number, toMs: number): number {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    throw new InactivityDecayError("both instants must be finite");
  }
  return Math.max(0, Math.floor((toMs - fromMs) / MILLISECONDS_PER_DAY));
}

/**
 * The rating as it stands today: the stored post-race rating, faded by the
 * time since that race. Decay is always derived and never written, so the
 * stored rating stays the thing the replay produced and the rule can be
 * retuned without touching a row.
 */
export function currentRating(
  rating: Rating,
  lastRatedAtMs: number,
  nowMs: number,
  parameters: DecayParameters = DEFAULT_DECAY_PARAMETERS,
): Rating {
  return decayRating(rating, daysBetween(lastRatedAtMs, nowMs), parameters);
}
