// Replaying the corrected tournament history into ratings (ADR-0189).
//
// The replay walks races in `race_sequence` order and rates each one on its
// own, exactly as the proven legacy semantics do. Two things are new.
//
// First, the measured parameters: beta and tau were estimated on the whole
// 9,828-placement history rather than inherited from a library default.
//
// Second, decay. A player's rating is faded by the time since their own
// previous rated race before that race is rated, so somebody returning after
// two years away comes back at the prior and re-learns quickly. Within a
// tournament every race shares a date, so no decay happens mid-tournament -
// the rule only ever acts across the gap between two tournaments.
//
// Decay is never written. What is stored is the post-race rating; what a
// reader sees is that rating faded to today. So the replay stays deterministic
// from the race dates alone, and the decay rule can be retuned without
// touching a stored row.

import {
  DEFAULT_DECAY_PARAMETERS,
  decayRating,
  type DecayParameters,
} from "./inactivity-decay.js";
import {
  MEASURED_RATING_PARAMETERS,
  conservativeScore,
  initialRating,
  rateFreeForAllRace,
  type Rating,
  type RatingParameters,
} from "./trueskill-engine.js";

export type ReplayRace = Readonly<{
  raceSequence: number;
  tournamentNumber: number;
  heldAtMs: number;
  countsTowardRating: boolean;
  placements: readonly Readonly<{
    playerId: number;
    finishPosition: number;
  }>[];
}>;

export type ReplayEvent = Readonly<{
  playerId: number;
  raceSequence: number;
  occurredAtMs: number;
  before: Rating;
  after: Rating;
  decayedFrom: Rating | null;
  decayDays: number;
}>;

export type ReplayResult = Readonly<{
  events: readonly ReplayEvent[];
  finalRatings: ReadonlyMap<number, Rating>;
  lastRatedAtMs: ReadonlyMap<number, number>;
  racesRated: number;
  racesSkipped: number;
  decayApplications: number;
}>;

export class HistoryReplayError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "HistoryReplayError";
  }
}

export type ReplayOptions = Readonly<{
  parameters?: RatingParameters;
  decay?: DecayParameters | null;
}>;

export function replayHistory(
  races: readonly ReplayRace[],
  options: ReplayOptions = {},
): ReplayResult {
  const parameters = options.parameters ?? MEASURED_RATING_PARAMETERS;
  const decay = options.decay === undefined
    ? DEFAULT_DECAY_PARAMETERS : options.decay;

  const ordered = races.slice()
    .sort((left, right) => left.raceSequence - right.raceSequence);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index]!.raceSequence === ordered[index - 1]!.raceSequence) {
      throw new HistoryReplayError(
        `two races share sequence ${ordered[index]!.raceSequence}`);
    }
    if (ordered[index]!.heldAtMs < ordered[index - 1]!.heldAtMs) {
      throw new HistoryReplayError(
        `race ${ordered[index]!.raceSequence} is dated before the race that ` +
        "precedes it; the sequence must be chronological or decay would run " +
        "backwards");
    }
  }

  const ratings = new Map<number, Rating>();
  const lastRatedAtMs = new Map<number, number>();
  const events: ReplayEvent[] = [];
  let racesRated = 0;
  let racesSkipped = 0;
  let decayApplications = 0;

  for (const race of ordered) {
    if (!race.countsTowardRating) { racesSkipped += 1; continue; }
    if (race.placements.length < 2) {
      throw new HistoryReplayError(
        `race ${race.raceSequence} has fewer than two participants`);
    }

    const players = race.placements.map((placement) => placement.playerId);
    if (new Set(players).size !== players.length) {
      throw new HistoryReplayError(
        `race ${race.raceSequence} lists a player twice`);
    }

    const before: Rating[] = [];
    const faded: Array<Rating | null> = [];
    const gaps: number[] = [];
    for (const playerId of players) {
      const stored = ratings.get(playerId) ?? initialRating();
      const lastAt = lastRatedAtMs.get(playerId);
      if (decay === null || lastAt === undefined) {
        before.push(stored);
        faded.push(null);
        gaps.push(0);
        continue;
      }
      const days = Math.max(
        0, Math.floor((race.heldAtMs - lastAt) / 86_400_000));
      const decayed = decayRating(stored, days, decay);
      if (decayed !== stored) { decayApplications += 1; }
      before.push(decayed);
      faded.push(decayed === stored ? null : stored);
      gaps.push(days);
    }

    const after = rateFreeForAllRace(
      before,
      race.placements.map((placement) => placement.finishPosition),
      parameters,
    );

    for (const [index, playerId] of players.entries()) {
      ratings.set(playerId, after[index]!);
      lastRatedAtMs.set(playerId, race.heldAtMs);
      events.push({
        playerId,
        raceSequence: race.raceSequence,
        occurredAtMs: race.heldAtMs,
        before: before[index]!,
        after: after[index]!,
        decayedFrom: faded[index]!,
        decayDays: gaps[index]!,
      });
    }
    racesRated += 1;
  }

  return {
    events, finalRatings: ratings, lastRatedAtMs, racesRated, racesSkipped,
    decayApplications,
  };
}

/** The Score a reader should see today, decay included. */
export function scoreToday(
  rating: Rating,
  lastRatedAtMs: number,
  nowMs: number,
  decay: DecayParameters = DEFAULT_DECAY_PARAMETERS,
): number {
  const days = Math.max(0, Math.floor((nowMs - lastRatedAtMs) / 86_400_000));
  return conservativeScore(decayRating(rating, days, decay));
}
