import { describe, expect, it } from "vitest";

import {
  DEFAULT_PLAYER_RATING_SOURCE_REFERENCE,
  DEFAULT_RATING_MU_DECIMAL,
  DEFAULT_RATING_SIGMA_DECIMAL,
} from "../src/identity/mysql-player-onboarding-repository.js";
import {
  RATING_INITIAL_MU,
  RATING_INITIAL_SIGMA,
  conservativeScore,
} from "../src/rating/trueskill-engine.js";
import { seedQualifierGroups } from "../src/tournaments/tournament-operation-domain.js";

// Owner decision 2026-08-27, ADR-0177 decision 20: a newly created Player is
// given the canonical TrueSkill prior instead of no rating at all, and that
// prior is what makes them seed last.
describe("Default rating for a newly created Player", () => {
  const mu = Number(DEFAULT_RATING_MU_DECIMAL);
  const sigma = Number(DEFAULT_RATING_SIGMA_DECIMAL);

  it("stores the canonical engine prior", () => {
    expect(mu).toBe(RATING_INITIAL_MU);
    expect(sigma).toBeCloseTo(RATING_INITIAL_SIGMA, 15);
  });

  it("derives a conservative score of zero, never negative", () => {
    const score = conservativeScore({ mu, sigma });
    expect(score).toBeCloseTo(0, 12);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("scores below every rated Player in the canonical database", () => {
    // The lowest and highest live canonical scores on 2026-08-27.
    expect(conservativeScore({ mu, sigma })).toBeLessThan(13.02);
  });

  it("records the prior as a distinguishable seed event", () => {
    expect(DEFAULT_PLAYER_RATING_SOURCE_REFERENCE)
      .toBe("default_trueskill_prior_v1");
  });
});

describe("A newcomer seeds last in Maak kwalificatiegroepen", () => {
  const participant = (name: string, rank: number | null, score: number | null) => ({
    playerId: `player-${name}`,
    displayName: name,
    seedRank: rank,
    seedScore: score,
    hasSwitch1: false,
    hasSwitch2: false,
  });

  it("places the prior-rated newcomer in the last group, last position", () => {
    const rated = Array.from({ length: 11 }, (_, index) =>
      participant(`rated${index + 1}`, index + 1, 28 - index));
    const newcomer = participant("Kikker", 12, 0);
    const groups = seedQualifierGroups([...rated, newcomer], {
      strategy: "minimal_move",
      seedOrder: "ranked",
      random: () => 0,
    });
    const last = groups[groups.length - 1]!;
    expect(last.members[last.members.length - 1]).toBe("player-Kikker");
  });

  it("also places an entirely unrated Player last", () => {
    const rated = Array.from({ length: 11 }, (_, index) =>
      participant(`rated${index + 1}`, index + 1, 28 - index));
    const unrated = participant("Onbekend", null, null);
    const groups = seedQualifierGroups([...rated, unrated], {
      strategy: "minimal_move",
      seedOrder: "ranked",
      random: () => 0,
    });
    const last = groups[groups.length - 1]!;
    expect(last.members[last.members.length - 1]).toBe("player-Onbekend");
  });
});
