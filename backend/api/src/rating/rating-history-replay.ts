// The faithful rating replay: the corrected TN4+ history with the measured
// parameters and decay - the epochs production runs on - and then every
// pinned result set that still counts, applied on top, oldest first. This is
// what reopening a finalized night runs (ADR-0155 addendum 2026-09-15), so
// the rating lands where the night was never applied and finalizing again
// applies it exactly once.
//
// `RatingLifecycleService.recalculate` is not this: it replays the seed
// baseline plus publications and lands elsewhere. The QA mirror carries no
// history tables, so there the replay reports that it cannot run; production
// carries them.

import type { Pool } from "mysql2/promise";

import { recomputeHistory, type RecomputeReport, type RecomputeRun } from "./history-recompute-main.js";
import { installationEligiblePlayers } from "./rating-eligibility.js";

export type HistoryReplayInput = Readonly<{ administratorAccountId: string; reasonCode: string }>;
export type HistoryReplayResult = Readonly<{
  epoch: number;
  includedPublications: number;
  appliedRaces: number;
  skippedRaces: number;
  ratedPlayers: number;
}>;

export type HistoryReplayLifecycle = Readonly<{
  listIncludedPublications(): Promise<readonly string[]>;
  applyPublication(publicationPublicId: string): Promise<Readonly<{ appliedRaces: number; skippedRaces: number }>>;
}>;

export function createHistoryReplay(
  pool: Pool,
  lifecycle: HistoryReplayLifecycle,
  recompute: (pool: Pool, run: RecomputeRun) => Promise<RecomputeReport> = recomputeHistory,
  eligiblePlayers: (pool: Pool) => Promise<ReadonlySet<number> | null> = installationEligiblePlayers,
): (input: HistoryReplayInput) => Promise<HistoryReplayResult> {
  return async (input) => {
    // ADR-0221: with "only claimed Players count" the history is replayed with
    // only those Players; each result set then applies its own night's rule.
    const report = await recompute(pool, {
      parameters: "measured", decay: true, dryRun: false,
      operator: input.administratorAccountId, reasonCode: input.reasonCode,
      eligiblePlayerIds: await eligiblePlayers(pool),
      // A new community has no imported history; it starts from nothing.
      allowEmptyHistory: true,
    });
    let appliedRaces = 0;
    let skippedRaces = report.racesSkipped;
    const publications = await lifecycle.listIncludedPublications();
    for (const publicationId of publications) {
      const applied = await lifecycle.applyPublication(publicationId);
      appliedRaces += applied.appliedRaces;
      skippedRaces += applied.skippedRaces;
    }
    return { epoch: report.epoch, includedPublications: publications.length, appliedRaces, skippedRaces, ratedPlayers: report.playersRated };
  };
}
