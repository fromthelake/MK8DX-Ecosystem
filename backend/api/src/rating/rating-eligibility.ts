// Who counts for the rating (ADR-0221).
//
// Two switches can narrow it: the installation's `ratingEligibility`
// (`claimed_only`: only Players with a verified claim are ever rated) and a
// night's `verifiedOnly` (only verified Players count from that night). A
// Player who does not count still raced: they keep their place in the
// standings, but the engine rates the remaining field among itself, in the
// same finishing order, as if they had not been in the race. A race left with
// fewer than two counting Players changes nobody.

import type { Pool, RowDataPacket } from "mysql2/promise";

export type RatingEligibility = Readonly<{
  /** True when only Players with a verified claim count for these races. */
  requireClaim: boolean;
  /** The Players with a verified claim; only read when `requireClaim`. */
  claimedPlayerIds: ReadonlySet<number>;
}>;

export const EVERYONE_COUNTS: RatingEligibility = { requireClaim: false, claimedPlayerIds: new Set() };

export function countsForRating(eligibility: RatingEligibility, playerInternalId: number): boolean {
  return !eligibility.requireClaim || eligibility.claimedPlayerIds.has(playerInternalId);
}

/**
 * The placements that count, re-ranked 1..n in their original finishing order.
 * Unidentified placements (null) are kept: they still make the race unrateable,
 * exactly as before (ADR-0155).
 */
export function countingPlacements<T extends Readonly<{ playerInternalId: number | null; finishPosition: number }>>(
  placements: readonly T[],
  eligibility: RatingEligibility,
): readonly T[] {
  if (!eligibility.requireClaim) { return placements; }
  return placements
    .filter((placement) => placement.playerInternalId === null ||
      eligibility.claimedPlayerIds.has(placement.playerInternalId))
    .slice()
    .sort((left, right) => left.finishPosition - right.finishPosition)
    .map((placement, index) => ({ ...placement, finishPosition: index + 1 }));
}

type Executor = Pick<Pool, "execute">;

/** The installation's eligibility setting; no row means every Player counts. */
export async function readInstallationRatingEligibility(executor: Executor): Promise<"all_players" | "claimed_only"> {
  const [rows] = await executor.execute<RowDataPacket[]>(
    "SELECT rating_eligibility AS eligibility FROM installation_settings WHERE installation_settings_id = 1",
  );
  return rows[0]?.["eligibility"] === "claimed_only" ? "claimed_only" : "all_players";
}

export async function readClaimedPlayerIds(executor: Executor): Promise<ReadonlySet<number>> {
  const [rows] = await executor.execute<RowDataPacket[]>(
    "SELECT DISTINCT player_id AS playerId FROM player_claims WHERE claim_status = 'verified'",
  );
  return new Set(rows.map((row) => Number(row["playerId"])).filter((id) => Number.isSafeInteger(id)));
}

/**
 * The Players the corrected history may rate when the installation counts
 * only claimed Players; null when everybody counts.
 */
export async function installationEligiblePlayers(executor: Executor): Promise<ReadonlySet<number> | null> {
  if (await readInstallationRatingEligibility(executor) !== "claimed_only") { return null; }
  return readClaimedPlayerIds(executor);
}
