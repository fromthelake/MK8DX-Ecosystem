import { describe, expect, it } from "vitest";

import {
  DEFAULT_DECAY_PARAMETERS,
  InactivityDecayError,
  currentRating,
  daysBetween,
  decayRating,
  remainingFraction,
} from "../src/rating/inactivity-decay.js";
import {
  RATING_INITIAL_MU,
  RATING_INITIAL_SIGMA,
  conservativeScore,
} from "../src/rating/trueskill-engine.js";

const { graceDays, dormantDays } = DEFAULT_DECAY_PARAMETERS;

describe("the adopted parameters", () => {
  it("is the shape the owner chose, not a default that drifted", () => {
    // Pinned because these are product decisions, not tuning knobs: they
    // decide what an absence costs. Changing one should take a conversation,
    // and failing this test is that conversation starting.
    expect(DEFAULT_DECAY_PARAMETERS).toEqual({
      graceDays: 365, dormantDays: 1095, halfLifeDays: 300,
    });
  });

  it("lets a player miss one tournament for free", () => {
    // Missing exactly one puts 217 to 315 days between a player's own races,
    // and a year of grace covers the whole of that range. This is the rule the
    // grace period exists for, so it is checked across the range rather than
    // at one convenient point.
    for (const days of [217, 252, 273, 315, 365]) {
      expect(remainingFraction(days)).toBe(1);
    }
  });

  it("charges a second missed tournament about a fifth", () => {
    // TN09 to TN12, the longest run of two.
    expect(remainingFraction(448)).toBeCloseTo(0.7858, 4);
  });

  it("takes a player who misses three tournaments about halfway down", () => {
    // TN08 to TN12.
    expect(remainingFraction(567)).toBeCloseTo(0.5423, 4);
  });

  it("still shows a player who left two years ago, and not the one at three", () => {
    // Pascal last raced TN7. Under the two-year rule he was already at zero;
    // under three years he is visibly fading instead, which is the point of
    // showing a slide at all.
    expect(remainingFraction(828)).toBeCloseTo(0.194, 3);
    expect(remainingFraction(1095)).toBe(0);
  });
});

describe("remainingFraction", () => {
  it("costs a regular attendee nothing", () => {
    // The longest gap ever observed between two tournaments is 175 days.
    for (const days of [0, 1, 98, 175, graceDays]) {
      expect(remainingFraction(days)).toBe(1);
    }
  });

  it("is exactly zero from the dormant mark onwards", () => {
    for (const days of [dormantDays, dormantDays + 1, 5_000]) {
      expect(remainingFraction(days)).toBe(0);
    }
  });

  it("decreases strictly across the whole window", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let days = graceDays; days <= dormantDays; days += 1) {
      const value = remainingFraction(days);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });

  it("approaches zero smoothly rather than stepping off a cliff", () => {
    // A plain half-life would still be at 15% here and jump to zero.
    expect(remainingFraction(dormantDays - 1)).toBeLessThan(0.01);
  });

  it("refuses parameters that cannot describe a decay", () => {
    expect(() => remainingFraction(200, {
      graceDays: 500, dormantDays: 400, halfLifeDays: 200,
    })).toThrow(InactivityDecayError);
    expect(() => remainingFraction(200, {
      graceDays: 180, dormantDays: 730, halfLifeDays: 0,
    })).toThrow(InactivityDecayError);
  });
});

describe("decayRating", () => {
  const cases: ReadonlyArray<Readonly<{ name: string; rating: {
    mu: number; sigma: number;
  }; }>> = [
    { name: "Matteo", rating: { mu: 36.97, sigma: 1.78 } },
    { name: "Pascal", rating: { mu: 27.89, sigma: 1.74 } },
    { name: "Thibaut", rating: { mu: 23.96, sigma: 1.75 } },
    // Below the prior: this is the player a sigma-only rule would have
    // dragged to -15.8.
    { name: "Anselm", rating: { mu: 9.18, sigma: 1.92 } },
  ];

  it("shrinks every score in exact proportion", () => {
    for (const { rating } of cases) {
      const start = conservativeScore(rating);
      for (let days = 0; days <= dormantDays; days += 7) {
        const decayed = conservativeScore(decayRating(rating, days));
        expect(decayed).toBeCloseTo(remainingFraction(days) * start, 10);
      }
    }
  });

  it("never takes a non-negative score below zero", () => {
    for (const { rating } of cases) {
      if (conservativeScore(rating) < 0) { continue; }
      for (let days = 0; days <= 3_000; days += 1) {
        expect(conservativeScore(decayRating(rating, days)))
          .toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("lands every player on exactly the prior after two years", () => {
    for (const { rating } of cases) {
      const dormant = decayRating(rating, dormantDays);
      expect(dormant.mu).toBe(RATING_INITIAL_MU);
      expect(dormant.sigma).toBe(RATING_INITIAL_SIGMA);
      expect(conservativeScore(dormant)).toBeCloseTo(0, 12);
    }
  });

  it("leaves a rating untouched inside the grace period", () => {
    const rating = { mu: 36.97, sigma: 1.78 };
    expect(decayRating(rating, 175)).toBe(rating);
  });
});

describe("currentRating", () => {
  const day = 86_400_000;

  it("fades a rating by the time since its last race", () => {
    const rating = { mu: 36.97, sigma: 1.78 };
    const lastRaced = Date.UTC(2024, 4, 31);
    const full = conservativeScore(rating);
    // 163 days, which is where the TN12 players stand: inside grace, untouched.
    expect(currentRating(rating, lastRaced, lastRaced + 163 * day))
      .toBe(rating);
    // 828 days, which is where Pascal stands: fading, not yet gone.
    const fading = conservativeScore(
      currentRating(rating, lastRaced, lastRaced + 828 * day));
    expect(fading).toBeGreaterThan(0);
    expect(fading).toBeLessThan(full * 0.25);
    // Three years, which is where the rule ends.
    expect(conservativeScore(
      currentRating(rating, lastRaced, lastRaced + 1095 * day))).toBe(0);
  });

  it("treats a race in the future as no absence at all", () => {
    expect(daysBetween(1_000, 0)).toBe(0);
  });
});
