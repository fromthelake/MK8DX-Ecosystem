import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RATING_INITIAL_MU,
  RATING_INITIAL_SIGMA,
  RatingEngineError,
  conservativeScore,
  initialRating,
  rateFreeForAllRace,
  type Rating,
} from "../src/rating/trueskill-engine.js";

type GoldenParticipant = Readonly<{
  player: string;
  rank: number;
  muBefore: number;
  sigmaBefore: number;
  muAfter: number;
  sigmaAfter: number;
}>;
type GoldenRace = Readonly<{ race: number; participants: GoldenParticipant[] }>;

const golden = JSON.parse(readFileSync(
  join(__dirname, "fixtures", "rating", "synthetic-golden-races.json"),
  "utf8",
)) as Readonly<{ fixtureKind: string; races: GoldenRace[] }>;

describe("canonical TrueSkill engine (ADR-0154 semantics)", () => {
  it("matches the reference implementation over the synthetic golden set", () => {
    expect(golden.fixtureKind).toBe("mk8dx.synthetic-trueskill-golden.v1");
    const ratings = new Map<string, Rating>();
    let worst = 0;
    for (const race of golden.races) {
      const participants = race.participants.map((participant) =>
        ratings.get(participant.player) ?? initialRating());
      const ranks = race.participants.map((participant) => participant.rank);
      const updated = rateFreeForAllRace(participants, ranks);
      for (const [index, participant] of race.participants.entries()) {
        const result = updated[index]!;
        worst = Math.max(
          worst,
          Math.abs(result.mu - participant.muAfter),
          Math.abs(result.sigma - participant.sigmaAfter),
        );
        ratings.set(participant.player, result);
      }
    }
    // 426 observations across 60 races, chained: full-precision parity with
    // the proven reference implementation.
    expect(worst).toBeLessThan(1e-9);
  });

  it("starts new players at the recovered initial rating with score zero", () => {
    const rating = initialRating();
    expect(rating.mu).toBe(RATING_INITIAL_MU);
    expect(rating.sigma).toBe(RATING_INITIAL_SIGMA);
    expect(conservativeScore(rating)).toBe(0);
  });

  it("moves winners up, losers down, and shrinks certainty", () => {
    const [winner, loser] = rateFreeForAllRace(
      [initialRating(), initialRating()],
      [1, 2],
    );
    expect(winner!.mu).toBeGreaterThan(RATING_INITIAL_MU);
    expect(loser!.mu).toBeLessThan(RATING_INITIAL_MU);
    expect(winner!.sigma).toBeLessThan(RATING_INITIAL_SIGMA);
    expect(loser!.sigma).toBeLessThan(RATING_INITIAL_SIGMA);
    // symmetric first race
    expect(winner!.mu + loser!.mu).toBeCloseTo(50, 10);
  });

  it("returns results in participant order, not rank order", () => {
    const strong: Rating = { mu: 30, sigma: 1 };
    const weak: Rating = { mu: 20, sigma: 1 };
    const [first, second] = rateFreeForAllRace([weak, strong], [2, 1]);
    expect(first!.mu).toBeLessThan(second!.mu);
  });

  it("rejects ties, bad ranks, and invalid ratings", () => {
    expect(() => rateFreeForAllRace([initialRating()], [1]))
      .toThrow(RatingEngineError);
    expect(() => rateFreeForAllRace(
      [initialRating(), initialRating()], [1, 1],
    )).toThrow(/no ties/);
    expect(() => rateFreeForAllRace(
      [initialRating(), initialRating()], [1, 3],
    )).toThrow(RatingEngineError);
    expect(() => rateFreeForAllRace(
      [initialRating(), { mu: 25, sigma: 0 }], [1, 2],
    )).toThrow(RatingEngineError);
  });

  it("only rates listed participants (absent players are untouched by design)", () => {
    const updated = rateFreeForAllRace(
      [initialRating(), initialRating(), initialRating()],
      [2, 1, 3],
    );
    expect(updated).toHaveLength(3);
  });
});
