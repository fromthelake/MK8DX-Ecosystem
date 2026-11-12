import type { ActorContext } from "../identity/types.js";

// The Home comeback read model: one coherent document answering "how am
// I doing, what changed while I was away" for the signed-in Player.
//
// Global Time Trial standing uses the recovered historical semantics:
// every Player's 150cc total time over the 96 canonical tracks, where
// an undriven track counts as the historical ten-minute fallback; lower
// total ranks higher, ties break on public Player id. Only Players with
// at least one published 150cc result take part.
//
// Rival comparison semantics: a (track, class) combo is SHARED when
// both Players have a published best for it; tracksAhead counts shared
// combos where the Player's best is strictly faster, totalDeltaMs is
// SUM(rival best - own best) over shared combos (positive = the Player
// is faster overall). Deltas since the last visit compare the same
// rival THEN vs NOW only - changing the rival selection never creates
// competitive movement.
//
// Meaningful-visit semantics: the displayed baseline ('prev') only
// rotates when the recorded state ('curr') is at least
// MEANINGFUL_VISIT_MS old, so a refresh never wipes the comeback.

export const MEANINGFUL_VISIT_MS = 60 * 60 * 1000;

// Deterministic meaningful-visit semantics: the displayed baseline only
// rotates when the recorded state is old enough, so a refresh (or any
// visit within the window) reproduces the same comeback instead of
// wiping it.
export function snapshotDecision(
  currAtMs: number | null,
  nowMs: number,
): Readonly<{ rotate: boolean; writeInitial: boolean }> {
  if (currAtMs === null) { return { rotate: false, writeInitial: true }; }
  return {
    rotate: nowMs - currAtMs >= MEANINGFUL_VISIT_MS,
    writeInitial: false,
  };
}

export type RivalComparison = Readonly<{
  playerId: string;
  displayName: string;
  avatarId?: string;
  tracksAhead: number;
  tracksBehind: number;
  sharedCombos: number;
  totalDeltaMs: number;
  previous?: Readonly<{
    tracksAhead: number;
    tracksBehind: number;
    sharedCombos: number;
    totalDeltaMs: number;
  }>;
}>;

export type HomeComeback = Readonly<{
  player: Readonly<{
    playerId: string;
    displayName: string;
    avatarId?: string;
  }>;
  tournament?: Readonly<{ rank: number; of: number; score: number; played: boolean }>;
  timeTrials: Readonly<{
    standing: number;
    of: number;
    totalMs: number;
    previousStanding?: number;
  }>;
  rivals: readonly RivalComparison[];
  reactions?: Readonly<{
    count: number;
    resultCount: number;
    kinds: readonly string[];
  }>;
  sinceMs?: number;
}>;

export class HomeComebackError extends Error {
  public constructor(
    public readonly code:
      | "not_authenticated"
      | "no_player"
      | "unavailable",
  ) {
    super("The Home overview could not be loaded.");
    this.name = "HomeComebackError";
  }
}

export interface HomeComebackRepository {
  loadComeback(userAccountId: string, nowMs: number): Promise<
    HomeComeback | null
  >;
}

export class HomeComebackService {
  public constructor(
    private readonly repository: HomeComebackRepository,
    private readonly now: () => number = () => Date.now(),
  ) {}

  public async loadMine(actor: ActorContext): Promise<HomeComeback> {
    if (actor.role !== "account" && actor.role !== "administrator") {
      throw new HomeComebackError("not_authenticated");
    }
    let comeback: HomeComeback | null;
    try {
      comeback = await this.repository.loadComeback(
        actor.userAccountId,
        this.now(),
      );
    } catch {
      throw new HomeComebackError("unavailable");
    }
    if (comeback === null) {
      throw new HomeComebackError("no_player");
    }
    return comeback;
  }
}

// ----------------------------------------------------------------------
// Rival preference management (private account preference, never a
// social graph: no consent, no notification, not publicly readable).

export type RivalPreference = Readonly<{
  playerId: string;
  displayName: string;
  avatarId?: string;
}>;

export class RivalPreferenceError extends Error {
  public constructor(
    public readonly code:
      | "invalid_input"
      | "not_authenticated"
      | "not_found"
      | "unavailable",
  ) {
    super("The rival selection could not be updated.");
    this.name = "RivalPreferenceError";
  }
}

export interface RivalPreferenceRepository {
  listRivals(userAccountId: string): Promise<readonly RivalPreference[]>;
  // false when the rival Player does not exist (or is the own Player).
  addRival(
    userAccountId: string,
    rivalPlayerId: string,
    nowMs: number,
  ): Promise<boolean>;
  removeRival(userAccountId: string, rivalPlayerId: string): Promise<void>;
}

const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const maximumRivals = 10;
const maximumFollows = 25;

// The generic private Player-list preference: RIVALS feed competitive
// comparisons/challenges, FOLLOWS only raise personal feed relevance.
// Both are bounded, private, and never a social graph.
class PlayerListPreferenceService {
  public constructor(
    private readonly repository: RivalPreferenceRepository,
    private readonly maximum: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private accountOf(actor: ActorContext): string {
    if (actor.role !== "account" && actor.role !== "administrator") {
      throw new RivalPreferenceError("not_authenticated");
    }
    return actor.userAccountId;
  }

  public async listMine(
    actor: ActorContext,
  ): Promise<readonly RivalPreference[]> {
    const account = this.accountOf(actor);
    try {
      return await this.repository.listRivals(account);
    } catch {
      throw new RivalPreferenceError("unavailable");
    }
  }

  public async add(actor: ActorContext, rivalPlayerId: string): Promise<void> {
    const account = this.accountOf(actor);
    if (!playerIdPattern.test(rivalPlayerId)) {
      throw new RivalPreferenceError("invalid_input");
    }
    let existing: readonly RivalPreference[];
    try {
      existing = await this.repository.listRivals(account);
    } catch {
      throw new RivalPreferenceError("unavailable");
    }
    if (existing.length >= this.maximum) {
      throw new RivalPreferenceError("invalid_input");
    }
    let added: boolean;
    try {
      added = await this.repository.addRival(
        account,
        rivalPlayerId,
        this.now(),
      );
    } catch {
      throw new RivalPreferenceError("unavailable");
    }
    if (!added) {
      throw new RivalPreferenceError("not_found");
    }
  }

  public async remove(
    actor: ActorContext,
    rivalPlayerId: string,
  ): Promise<void> {
    const account = this.accountOf(actor);
    if (!playerIdPattern.test(rivalPlayerId)) {
      throw new RivalPreferenceError("invalid_input");
    }
    try {
      await this.repository.removeRival(account, rivalPlayerId);
    } catch {
      throw new RivalPreferenceError("unavailable");
    }
  }
}

export class RivalPreferenceService extends PlayerListPreferenceService {
  public constructor(
    repository: RivalPreferenceRepository,
    now: () => number = () => Date.now(),
  ) {
    super(repository, maximumRivals, now);
  }
}

// FOLLOW: "show me this Player's public activity more prominently".
// The followed Player is never notified and the list is never public.
export type FollowPreference = RivalPreference;

export class FollowPreferenceService extends PlayerListPreferenceService {
  public constructor(
    repository: RivalPreferenceRepository,
    now: () => number = () => Date.now(),
  ) {
    super(repository, maximumFollows, now);
  }
}
