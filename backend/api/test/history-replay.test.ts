import { describe, expect, it } from "vitest";

import {
  HistoryReplayError,
  replayHistory,
  scoreToday,
  type ReplayRace,
} from "../src/rating/history-replay.js";
import {
  LEGACY_RATING_PARAMETERS,
  MEASURED_RATING_PARAMETERS,
  conservativeScore,
} from "../src/rating/trueskill-engine.js";

const DAY = 86_400_000;

function race(
  raceSequence: number,
  heldAtMs: number,
  order: readonly number[],
  countsTowardRating = true,
): ReplayRace {
  return {
    raceSequence,
    tournamentNumber: 1,
    heldAtMs,
    countsTowardRating,
    placements: order.map((playerId, offset) => ({
      playerId, finishPosition: offset + 1,
    })),
  };
}

describe("replayHistory", () => {
  it("rates a race and leaves nobody at the prior who took part", () => {
    const result = replayHistory([race(1, 0, [10, 20, 30])]);
    expect(result.racesRated).toBe(1);
    expect(result.events).toHaveLength(3);
    const winner = result.finalRatings.get(10)!;
    const loser = result.finalRatings.get(30)!;
    expect(winner.mu).toBeGreaterThan(loser.mu);
    expect(winner.sigma).toBeLessThan(25 / 3);
  });

  it("skips a race that does not count, without touching anyone", () => {
    const result = replayHistory([
      race(1, 0, [10, 20]),
      race(2, 0, [20, 10], false),
    ]);
    expect(result.racesRated).toBe(1);
    expect(result.racesSkipped).toBe(1);
    const only = replayHistory([race(1, 0, [10, 20])]);
    expect(result.finalRatings.get(10)).toEqual(only.finalRatings.get(10));
  });

  it("does not decay inside a tournament, however many races it has", () => {
    const sameDay = Array.from({ length: 30 }, (_, index) =>
      race(index + 1, 1_000, [10, 20]));
    expect(replayHistory(sameDay).decayApplications).toBe(0);
  });

  it("does not decay a player who misses at most one tournament", () => {
    // The longest real gap is 175 days, and the longest gap created by missing
    // exactly one tournament is 315. A year of grace covers both.
    const seasons = [0, 175 * DAY, 490 * DAY, 665 * DAY].map(
      (heldAtMs, index) => race(index + 1, heldAtMs, [10, 20]));
    expect(replayHistory(seasons).decayApplications).toBe(0);
  });

  it("brings a player back at the prior after three years away", () => {
    const result = replayHistory([
      race(1, 0, [10, 20, 30]),
      race(2, 0, [10, 20, 30]),
      // 10 and 20 keep playing; 30 disappears for well over three years.
      race(3, 1200 * DAY, [10, 20, 30]),
    ]);
    const returning = result.events.find(
      (event) => event.playerId === 30 && event.raceSequence === 3)!;
    expect(returning.decayDays).toBe(1200);
    expect(returning.decayedFrom).not.toBeNull();
    expect(conservativeScore(returning.before)).toBeCloseTo(0, 10);
    expect(returning.before.sigma).toBeCloseTo(25 / 3, 10);
  });

  it("can be run without decay, which reproduces the legacy behaviour", () => {
    const races = [race(1, 0, [10, 20]), race(2, 900 * DAY, [10, 20])];
    const withDecay = replayHistory(races, { decay: null });
    expect(withDecay.decayApplications).toBe(0);
    const undated = replayHistory(
      [race(1, 0, [10, 20]), race(2, 0, [10, 20])], { decay: null });
    expect(withDecay.finalRatings.get(10))
      .toEqual(undated.finalRatings.get(10));
  });

  it("keeps the measured parameters less certain than the legacy ones", () => {
    // A field of twelve, because that is the regime the parameters were
    // measured in. With only four karts the relation inverts: a small field
    // teaches the model so little per race that the larger tau dominates.
    const field = Array.from({ length: 12 }, (_, index) => index + 1);
    const races = Array.from({ length: 160 }, (_, index) =>
      race(index + 1, 0, field));
    const legacy = replayHistory(races,
      { parameters: LEGACY_RATING_PARAMETERS, decay: null });
    const measured = replayHistory(races,
      { parameters: MEASURED_RATING_PARAMETERS, decay: null });
    // The whole point of the measured pair: sigma stops collapsing, so the
    // -3*sigma in a published Score means something again.
    expect(measured.finalRatings.get(1)!.sigma)
      .toBeGreaterThan(legacy.finalRatings.get(1)!.sigma * 2);
  });

  it("refuses a history whose dates run backwards", () => {
    expect(() => replayHistory([
      race(1, 100 * DAY, [10, 20]),
      race(2, 0, [10, 20]),
    ])).toThrow(HistoryReplayError);
  });

  it("refuses two races sharing a sequence", () => {
    expect(() => replayHistory([race(1, 0, [10, 20]), race(1, 0, [10, 20])]))
      .toThrow(HistoryReplayError);
  });

  it("refuses a race that lists a player twice", () => {
    expect(() => replayHistory([race(1, 0, [10, 10])]))
      .toThrow(/lists a player twice/);
  });
});

describe("scoreToday", () => {
  it("fades a stored rating without changing it", () => {
    const rating = { mu: 36.97, sigma: 1.78 };
    const raced = Date.UTC(2026, 2, 27);
    expect(scoreToday(rating, raced, raced + 163 * DAY))
      .toBeCloseTo(conservativeScore(rating), 12);
    expect(scoreToday(rating, raced, raced + 828 * DAY))
      .toBeCloseTo(conservativeScore(rating) * 0.194, 2);
    expect(scoreToday(rating, raced, raced + 1095 * DAY)).toBe(0);
  });
});
