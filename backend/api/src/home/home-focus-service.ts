import type { ActorContext } from "../identity/types.js";

// The Home focus read model for GLOBAL context: for every (track, mode)
// combo where the signed-in Player has a published best, the human
// leaderboard context needed to build Best Next / Closest Battle /
// Biggest Gap cards against the community.
//
// Semantics (recovered from the public leaderboard):
// - only published results of active human Players take part -
//   system/reference identities (restricted_reference rows without a
//   Player) are excluded by construction;
// - rank uses RANK() semantics: 1 + number of strictly faster bests;
// - "above" is the next human position above the Player: the slowest
//   best that is still strictly faster than the Player's best, ties
//   breaking on the stable order key (internal id) for determinism.

export type HumanBest = Readonly<{
  playerId: string;
  displayName: string;
  trackId: string;
  mode: 150 | 200;
  bestMs: number;
  // Stable tie-break key (internal id order), never exposed.
  orderKey: number;
}>;

export type FocusRow = Readonly<{
  trackId: string;
  mode: 150 | 200;
  myBestMs: number;
  myRank: number;
  humanCount: number;
  leaderBestMs: number;
  above?: Readonly<{
    playerId: string;
    displayName: string;
    bestMs: number;
    rank: number;
  }>;
}>;

export type HomeFocusDocument = Readonly<{
  modePreference: "all" | "150" | "200";
  trackAccess: "unknown" | "base_only" | "base_and_bcp";
  rows: readonly FocusRow[];
}>;

export function computeFocusRows(
  ownPlayerId: string,
  bests: readonly HumanBest[],
): readonly FocusRow[] {
  const combos = new Map<string, HumanBest[]>();
  for (const best of bests) {
    const key = `${best.trackId}#${best.mode}`;
    const bucket = combos.get(key) ?? [];
    bucket.push(best);
    combos.set(key, bucket);
  }
  const rows: FocusRow[] = [];
  for (const bucket of combos.values()) {
    const mine = bucket.find((entry) => entry.playerId === ownPlayerId);
    if (mine === undefined) { continue; }
    const myRank = 1 +
      bucket.filter((entry) => entry.bestMs < mine.bestMs).length;
    const leaderBestMs = Math.min(...bucket.map((entry) => entry.bestMs));
    const aboveCandidates = bucket
      .filter((entry) => entry.bestMs < mine.bestMs)
      .sort((a, b) => b.bestMs - a.bestMs || a.orderKey - b.orderKey);
    const above = aboveCandidates[0];
    rows.push({
      trackId: mine.trackId,
      mode: mine.mode,
      myBestMs: mine.bestMs,
      myRank,
      humanCount: bucket.length,
      leaderBestMs,
      ...(above === undefined
        ? {}
        : {
            above: {
              playerId: above.playerId,
              displayName: above.displayName,
              bestMs: above.bestMs,
              rank: 1 + bucket.filter(
                (entry) => entry.bestMs < above.bestMs).length,
            },
          }),
    });
  }
  rows.sort((a, b) =>
    a.trackId.localeCompare(b.trackId) || a.mode - b.mode);
  return rows;
}

export class HomeFocusError extends Error {
  public constructor(
    public readonly code:
      | "not_authenticated"
      | "no_player"
      | "unavailable",
  ) {
    super("The Home focus context could not be loaded.");
    this.name = "HomeFocusError";
  }
}

export interface HomeFocusRepository {
  // null when the account has no verified Player.
  loadFocusInput(userAccountId: string): Promise<Readonly<{
    modePreference: "all" | "150" | "200";
    trackAccess: "unknown" | "base_only" | "base_and_bcp";
    // Already reduced to at most one row per owned track/engine combo. The
    // SQL repository must not stream the whole community through Node merely
    // to calculate ranks and the nearest faster Player.
    rows: readonly FocusRow[];
  }> | null>;
}

export class HomeFocusService {
  public constructor(private readonly repository: HomeFocusRepository) {}

  public async loadMine(actor: ActorContext): Promise<HomeFocusDocument> {
    if (actor.role !== "account" && actor.role !== "administrator") {
      throw new HomeFocusError("not_authenticated");
    }
    let input: Awaited<ReturnType<HomeFocusRepository["loadFocusInput"]>>;
    try {
      input = await this.repository.loadFocusInput(actor.userAccountId);
    } catch {
      throw new HomeFocusError("unavailable");
    }
    if (input === null) {
      throw new HomeFocusError("no_player");
    }
    const rows = input.rows.filter((row) =>
      input.modePreference === "all" || String(row.mode) === input.modePreference);
    return { modePreference: input.modePreference, trackAccess: input.trackAccess, rows };
  }
}
