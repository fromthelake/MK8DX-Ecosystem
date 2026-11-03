// Seeding from a Director's own nights (ADR-0221).
//
// No new score is invented. The races of the Director's own finished,
// published nights are replayed, oldest first, through the same replay the
// corrected history uses (ADR-0189: the measured parameters and the decay
// between nights), starting every Player at the engine's prior. The result is
// a rating as if those nights were the only Tournaments that ever happened;
// the draw ranks the present Players by its conservative score. Nothing of it
// is stored: the community rating, the night's SP column and its tie-breaks
// are untouched.

import { replayHistory, type ReplayRace } from "./history-replay.js";
import { conservativeScore } from "./trueskill-engine.js";

export type DirectorNightRace = Readonly<{
  /** When the night was held; nights are replayed in this order. */
  heldAtMs: number;
  placements: readonly Readonly<{ playerInternalId: number | null; finishPosition: number }>[];
}>;

export type DirectorNightSeed = Readonly<{ score: number; rank: number }>;

/**
 * Score and rank (1 = best, shared on an exact tie) for every Player the
 * Director's nights rated. Unidentified placements are left out; a race with
 * fewer than two identified Players rates nobody.
 */
export function directorNightRatings(races: readonly DirectorNightRace[]): ReadonlyMap<number, DirectorNightSeed> {
  const ordered = races
    .map((race, index) => ({ race, index }))
    .sort((left, right) => left.race.heldAtMs - right.race.heldAtMs || left.index - right.index);
  const replayRaces: ReplayRace[] = ordered.map(({ race }, index) => {
    const placements = race.placements
      .filter((placement): placement is Readonly<{ playerInternalId: number; finishPosition: number }> =>
        placement.playerInternalId !== null)
      .slice()
      .sort((left, right) => left.finishPosition - right.finishPosition);
    const unique = new Set(placements.map((placement) => placement.playerInternalId)).size === placements.length;
    return {
      raceSequence: index + 1,
      tournamentNumber: 0,
      heldAtMs: race.heldAtMs,
      countsTowardRating: placements.length >= 2 && unique,
      placements: placements.map((placement, position) => ({
        playerId: placement.playerInternalId,
        finishPosition: position + 1,
      })),
    };
  });
  const result = replayHistory(replayRaces);
  const scores = [...result.finalRatings].map(([playerId, rating]) => [playerId, conservativeScore(rating)] as const);
  const seeds = new Map<number, DirectorNightSeed>();
  for (const [playerId, score] of scores) {
    const better = scores.filter(([, other]) => other > score).length;
    seeds.set(playerId, { score, rank: better + 1 });
  }
  return seeds;
}
