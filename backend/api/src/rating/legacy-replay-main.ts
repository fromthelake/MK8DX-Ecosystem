// Phase 8 validation CLI: replay the restricted legacy race history through
// the canonical TypeScript rating engine and reconcile against the
// authoritative restricted seed. Inputs stay outside Git; output is
// privacy-safe aggregates only (counts and worst absolute errors).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  conservativeScore,
  initialRating,
  rateFreeForAllRace,
  type Rating,
} from "./trueskill-engine.js";

type HistoryEntry = Readonly<{
  section: string;
  raceIndex: number;
  position: number;
  scoreAfter: number;
}>;

export function runLegacyReplay(argv: readonly string[]): string {
  if (argv.length !== 4 || argv[0] !== "--history" || argv[2] !== "--seed") {
    throw new Error("expected --history <restricted-json> --seed <restricted-json>");
  }
  const history = JSON.parse(readFileSync(argv[1]!, "utf8")) as Readonly<{
    perPlayer: Readonly<Record<string, HistoryEntry[]>>;
  }>;
  const seed = JSON.parse(readFileSync(argv[3]!, "utf8")) as Readonly<{
    rows: readonly Readonly<{
      legacyPlayerId: number; mu: string; sigma: string;
    }>[];
  }>;

  const races = new Map<string, { legacyId: number; position: number;
    scoreAfter: number }[]>();
  for (const [legacyId, entries] of Object.entries(history.perPlayer)) {
    for (const entry of entries) {
      const key = `${entry.section}#${entry.raceIndex}`;
      const observations = races.get(key) ?? [];
      observations.push({
        legacyId: Number(legacyId),
        position: entry.position,
        scoreAfter: entry.scoreAfter,
      });
      races.set(key, observations);
    }
  }

  const phase = (section: string): number =>
    /^(Poule|Kwalificatie|Winnaarspoule|Verliezerspoule)/
      .test(section.split(": ", 1 + 1)[1] ?? "") ? 0 : 1;
  const ordered = [...races.keys()].sort((a, b) => {
    const [sectionA, indexA] = a.split("#") as [string, string];
    const [sectionB, indexB] = b.split("#") as [string, string];
    const tournamentA = Number(sectionA.split(":")[0]!.slice(2));
    const tournamentB = Number(sectionB.split(":")[0]!.slice(2));
    return tournamentA - tournamentB ||
      phase(sectionA) - phase(sectionB) ||
      sectionA.localeCompare(sectionB) ||
      Number(indexA) - Number(indexB);
  });

  const ratings = new Map<number, Rating>();
  let observations = 0;
  let trajectoryMismatches = 0;
  for (const key of ordered) {
    const race = races.get(key)!;
    const participants = race.map((observation) =>
      ratings.get(observation.legacyId) ?? initialRating());
    const ranks = race.map((observation) => observation.position);
    const updated = rateFreeForAllRace(participants, ranks);
    for (const [index, observation] of race.entries()) {
      const rating = updated[index]!;
      ratings.set(observation.legacyId, rating);
      observations += 1;
      const derived = Math.round(conservativeScore(rating) * 100) / 100;
      if (Math.abs(derived - observation.scoreAfter) > 0.005) {
        trajectoryMismatches += 1;
      }
    }
  }

  let worstMu = 0;
  let worstSigma = 0;
  let missing = 0;
  for (const row of seed.rows) {
    const rating = ratings.get(row.legacyPlayerId);
    if (rating === undefined) {
      missing += 1;
      continue;
    }
    worstMu = Math.max(worstMu, Math.abs(rating.mu - Number(row.mu)));
    worstSigma = Math.max(
      worstSigma, Math.abs(rating.sigma - Number(row.sigma)));
  }
  return JSON.stringify({
    races: ordered.length,
    observations,
    trajectoryMismatches,
    seedPlayers: seed.rows.length,
    seedPlayersMissingFromReplay: missing,
    worstFinalMuError: worstMu,
    worstFinalSigmaError: worstSigma,
  }, null, 2);
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined &&
    import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  try {
    process.stdout.write(`${runLegacyReplay(process.argv.slice(2))}\n`);
  } catch (error) {
    process.stderr.write(`legacy replay failed: ${
      error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  }
}
