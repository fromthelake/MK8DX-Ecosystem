// Legacy race history parsing/ordering/verification - the pure core of
// the mariokart8.nl per-race import (TN4..TN12).
//
// Ordering is the PROVEN canonical replay order (ADR-0154): tournament
// number, then qualification-style sections before finals sections,
// then section name, then race index. The bit-compatible 865-race
// replay used exactly this order, so replaying the ordered races
// through the canonical engine must reproduce the seeded ratings.

import {
  conservativeScore,
  initialRating,
  rateFreeForAllRace,
  type Rating,
} from "./trueskill-engine.js";

export type LegacyHistoryEntry = Readonly<{
  section: string;
  raceIndex: number;
  position: number;
  scoreAfter: number;
  delta?: number;
}>;

export type LegacyHistoryDocument = Readonly<{
  artifactKind: string;
  perPlayer: Readonly<Record<string, readonly LegacyHistoryEntry[]>>;
}>;

export type LegacyMappingRow = Readonly<{
  legacyPlayerId: number;
  playerId: string;
}>;

export type LegacyRace = Readonly<{
  raceSequence: number;
  tournamentNumber: number;
  sectionLabel: string;
  raceIndex: number;
  placements: readonly Readonly<{
    playerId: string;
    finishPosition: number;
    scoreAfter: number;
    scoreDelta?: number;
  }>[];
}>;

const sectionPattern = /^TN(\d+): (.+)$/;

function tournamentNumberOf(section: string): number {
  const match = sectionPattern.exec(section);
  if (match === null) {
    throw new Error(`unrecognized section label: ${section}`);
  }
  return Number(match[1]);
}

function phaseOf(section: string): number {
  return /^(Poule|Kwalificatie|Winnaarspoule|Verliezerspoule)/
    .test(section.split(": ")[1] ?? "") ? 0 : 1;
}

export function buildLegacyRaces(
  history: LegacyHistoryDocument,
  mapping: readonly LegacyMappingRow[],
): readonly LegacyRace[] {
  const playerById = new Map<number, string>();
  for (const row of mapping) {
    playerById.set(row.legacyPlayerId, row.playerId);
  }
  const races = new Map<string, {
    playerId: string;
    finishPosition: number;
    scoreAfter: number;
    scoreDelta?: number;
  }[]>();
  for (const [legacyId, entries] of Object.entries(history.perPlayer)) {
    const playerId = playerById.get(Number(legacyId));
    if (playerId === undefined) {
      throw new Error(`legacy player ${legacyId} has no canonical mapping`);
    }
    for (const entry of entries) {
      tournamentNumberOf(entry.section);
      if (!Number.isSafeInteger(entry.position) ||
          entry.position < 1 || entry.position > 12 ||
          !Number.isSafeInteger(entry.raceIndex) || entry.raceIndex < 1) {
        throw new Error(`invalid history entry for legacy player ${
          legacyId}: ${entry.section} race ${entry.raceIndex}`);
      }
      const key = `${entry.section}#${entry.raceIndex}`;
      const bucket = races.get(key) ?? [];
      bucket.push({
        playerId,
        finishPosition: entry.position,
        scoreAfter: entry.scoreAfter,
        ...(entry.delta === undefined ? {} : { scoreDelta: entry.delta }),
      });
      races.set(key, bucket);
    }
  }
  const orderedKeys = [...races.keys()].sort((a, b) => {
    const [sectionA, indexA] = a.split("#") as [string, string];
    const [sectionB, indexB] = b.split("#") as [string, string];
    return tournamentNumberOf(sectionA) - tournamentNumberOf(sectionB) ||
      phaseOf(sectionA) - phaseOf(sectionB) ||
      sectionA.localeCompare(sectionB) ||
      Number(indexA) - Number(indexB);
  });
  return orderedKeys.map((key, index) => {
    const [section, raceIndex] = key.split("#") as [string, string];
    const placements = [...races.get(key)!].sort((a, b) =>
      a.finishPosition - b.finishPosition);
    for (let position = 1; position < placements.length; position += 1) {
      if (placements[position]!.finishPosition ===
          placements[position - 1]!.finishPosition) {
        throw new Error(`duplicate finish position in ${key}`);
      }
    }
    return {
      raceSequence: index + 1,
      tournamentNumber: tournamentNumberOf(section),
      sectionLabel: section,
      raceIndex: Number(raceIndex),
      placements,
    };
  });
}

export type ReplayVerification = Readonly<{
  races: number;
  observations: number;
  trajectoryMismatches: number;
  finalRatings: ReadonlyMap<string, Rating>;
}>;

// Replay the ordered races through the canonical engine and compare the
// derived display score (2 decimals) with the legacy-recorded scoreAfter
// per observation. Mismatches indicate ordering or data corruption.
export function verifyReplay(
  races: readonly LegacyRace[],
): ReplayVerification {
  const ratings = new Map<string, Rating>();
  let observations = 0;
  let trajectoryMismatches = 0;
  for (const race of races) {
    const participants = race.placements.map((placement) =>
      ratings.get(placement.playerId) ?? initialRating());
    const ranks = race.placements.map(
      (placement) => placement.finishPosition);
    const updated = rateFreeForAllRace(participants, ranks);
    for (const [index, placement] of race.placements.entries()) {
      const rating = updated[index]!;
      ratings.set(placement.playerId, rating);
      observations += 1;
      const derived = Math.round(conservativeScore(rating) * 100) / 100;
      if (Math.abs(derived - placement.scoreAfter) > 0.005) {
        trajectoryMismatches += 1;
      }
    }
  }
  return {
    races: races.length,
    observations,
    trajectoryMismatches,
    finalRatings: ratings,
  };
}
