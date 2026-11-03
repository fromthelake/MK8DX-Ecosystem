// YOUR FOCUS - the three distinct competitive concepts on Home:
//
//   LOWEST MASTERY "where is my current mastery weakest?"
//   CLOSEST RIVAL  "which competitor is nearest to my time?"
//   BIGGEST GAP    "where is my largest deficit?"
//
// Two contexts share the same concepts:
//   RIVALS - only the privately selected rivals take part;
//   GLOBAL - the human community; per track the meaningful battle is
//            the next human position above you. System/reference
//            identities (Nintendo, World Record) are never competitors,
//            they only provide difficulty context.
//
// LOWEST MASTERY is deliberately independent of the selected competitive
// context. Rivals/Global affect the gap cards; the Player's weakest driven
// track/mode remains the same honest mastery fact in both views.

import { trackBenchmarks } from "./benchmark-manifest.js";
import {
  type MasteryTierLabel,
  masteryTierLabel,
  trackMasteryTier,
  trackThresholdLadder,
} from "./mastery-thresholds.js";
import type { TrackBest } from "./mastery-view.js";

export type FocusDifficulty = "tough" | "solid" | "open";

export type FocusCard = Readonly<{
  kind: "best" | "closest" | "biggest";
  trackId: string;
  mode: 150 | 200;
  headline: string;
  gapMs?: number;
  context?: string;
  bullets: readonly string[];
  myBestMs: number | null;
  targetMs?: number;
  targetLabel?: string;
  targetPlayerId?: string;
  // The target's position on that combo, known the moment their bests
  // arrive. The card used to load a whole leaderboard after painting and
  // rewrite this line under the reader.
  targetRank?: number;
  /** Mastery of the time being chased, rendered with the canonical tier colour. */
  targetMasteryLabel?: MasteryTierLabel;
  difficulty: FocusDifficulty;
  masteryLabel?: MasteryTierLabel;
  nextMasteryLabel?: MasteryTierLabel;
  improveByMs?: number;
}>;

export type FocusSet = Readonly<{
  best: FocusCard | null;
  closest: FocusCard | null;
  biggest: FocusCard | null;
}>;

export type RivalBests = Readonly<{
  playerId: string;
  displayName: string;
  bests: readonly TrackBest[];
}>;

// GLOBAL context rows from /v1/home/focus.
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

export type FocusDocument = Readonly<{
  modePreference: "all" | "150" | "200";
  trackAccess: "unknown" | "base_only" | "base_and_bcp";
  rows: readonly FocusRow[];
}>;

export async function fetchFocusRows(
  signal: AbortSignal,
): Promise<FocusDocument | null> {
  const response = await fetch("/v1/home/focus", {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    mode: "same-origin",
    redirect: "error",
    referrerPolicy: "same-origin",
    cache: "no-store",
    signal,
  });
  if (response.status === 409) { return null; }
  if (response.status !== 200) { throw new Error("focus unavailable"); }
  const body = await response.json() as Record<string, unknown>;
  if (body["schemaVersion"] !== "mk8dx.home-focus.v1" ||
      !Array.isArray(body["rows"]) ||
      (body["modePreference"] !== "all" && body["modePreference"] !== "150" &&
       body["modePreference"] !== "200") ||
      (body["trackAccess"] !== "unknown" && body["trackAccess"] !== "base_only" &&
       body["trackAccess"] !== "base_and_bcp")) {
    throw new Error("focus invalid");
  }
  return {
    modePreference: body["modePreference"],
    trackAccess: body["trackAccess"],
    rows: body["rows"] as readonly FocusRow[],
  };
}

// ---------------------------------------------------------------------
// Shared reasoning helpers.

function closenessBucket(relativeGap: number): number {
  if (relativeGap <= 0.005) { return 0; }
  if (relativeGap <= 0.02) { return 1; }
  if (relativeGap <= 0.05) { return 2; }
  return 3;
}

const ELITE_TIER = 4;   // Deity .. Titan A: an elite target time.
const STRONG_TIER = 7;  // Titan B .. Hero A: a solid but real target.
const NEAR_WORLD_RECORD = 1.01;

function worldRecordMs(
  trackId: string,
  mode: 150 | 200,
): number | undefined {
  return trackBenchmarks(trackId, mode)
    .find((entry) => entry.kind === "world_record")?.timeMs;
}

function targetStrength(
  trackId: string,
  mode: 150 | 200,
  targetMs: number,
): Readonly<{
  difficulty: FocusDifficulty;
  nearWorldRecord: boolean;
  tier: number | null;
}> {
  const tier = trackMasteryTier(trackId, mode, targetMs);
  const record = worldRecordMs(trackId, mode);
  const nearWorldRecord = record !== undefined &&
    targetMs <= record * NEAR_WORLD_RECORD;
  const difficulty: FocusDifficulty =
    nearWorldRecord || (tier != null && tier <= ELITE_TIER)
      ? "tough"
      : tier != null && tier <= STRONG_TIER
        ? "solid"
        : "open";
  return { difficulty, nearWorldRecord, tier };
}

function strengthContext(
  strength: ReturnType<typeof targetStrength>,
  kind: FocusCard["kind"],
): string {
  const meaning = kind === "biggest"
    ? "Largest time deficit."
    : "Nearest faster time.";
  return strength.nearWorldRecord
    ? `${meaning.slice(0, -1)} · near the World Record.`
    : meaning;
}

export function formatGap(milliseconds: number): string {
  const absolute = Math.min(599_999, Math.abs(Math.round(milliseconds)));
  const minutes = Math.floor(absolute / 60_000);
  const seconds = Math.floor((absolute % 60_000) / 1_000);
  const millis = absolute % 1_000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${
    String(millis).padStart(3, "0")}`;
}

/**
 * Would reaching this target cross a mastery tier? (R10, ENGINE_CONTEXT_INVENTORY §3.)
 *
 * Per engine. It used to answer `null` for anything that was not 150cc, although the canonical
 * thresholds exist for both engine classes, so a 200cc focus card never earned its crossing bullet.
 */
function masteryCrossing(
  trackId: string,
  mode: 150 | 200,
  myBestMs: number,
  targetMs: number,
): number | null {
  const ladder = trackThresholdLadder(trackId, mode);
  const tier = trackMasteryTier(trackId, mode, myBestMs);
  if (ladder === undefined || tier == null || tier <= 0) { return null; }
  const nextThreshold = ladder[tier - 1];
  return nextThreshold !== undefined && targetMs <= nextThreshold
    ? tier - 1
    : null;
}

// ---------------------------------------------------------------------
// RIVALS context.

function bestOf(
  bests: readonly TrackBest[],
  trackId: string,
  mode: 150 | 200,
): number | undefined {
  return bests.find((entry) =>
    entry.trackId === trackId && entry.mode === mode)?.totalTimeMs;
}

type RivalCandidate = Readonly<{
  trackId: string;
  mode: 150 | 200;
  gapMs: number;
  relativeGap: number;
  rival: RivalBests;
  passCount: number;
  rivalBestMs: number;
  myBestMs: number;
  strength: ReturnType<typeof targetStrength>;
  masteryTo: number | null;
  rank: number;
  targetRank: number;
  upside: number;
}>;

function rivalCandidates(
  myBests: readonly TrackBest[],
  rivals: readonly RivalBests[],
): RivalCandidate[] {
  const candidates: RivalCandidate[] = [];
  for (const mine of myBests) {
    for (const rival of rivals) {
      const theirEntry = rival.bests.find((entry) =>
        entry.trackId === mine.trackId && entry.mode === mine.mode);
      if (theirEntry === undefined ||
          theirEntry.totalTimeMs >= mine.totalTimeMs) { continue; }
      const theirs = theirEntry.totalTimeMs;
      const gapMs = mine.totalTimeMs - theirs;
      const relativeGap = gapMs / theirs;
      const passCount = rivals.filter((candidate) => {
        const other = bestOf(candidate.bests, mine.trackId, mine.mode);
        return other !== undefined && other >= theirs &&
          other < mine.totalTimeMs;
      }).length;
      const strength = targetStrength(mine.trackId, mine.mode, theirs);
      const masteryTo = masteryCrossing(
        mine.trackId, mine.mode, mine.totalTimeMs, theirs);
      const rank = closenessBucket(relativeGap) +
        (strength.difficulty === "tough" ? 2
          : strength.difficulty === "solid" ? 1 : 0);
      candidates.push({
        trackId: mine.trackId,
        mode: mine.mode,
        gapMs,
        relativeGap,
        rival,
        passCount,
        rivalBestMs: theirs,
        myBestMs: mine.totalTimeMs,
        strength,
        masteryTo,
        rank,
        targetRank: theirEntry.rank,
        upside: passCount * 2 + (masteryTo !== null ? 1 : 0),
      });
    }
  }
  return candidates;
}

function rivalCard(
  kind: FocusCard["kind"],
  candidate: RivalCandidate,
): FocusCard {
  const name = candidate.rival.displayName;
  const bullets: string[] = [];
  if (kind === "best") {
    if (candidate.passCount > 1) {
      bullets.push(`Passes ${candidate.passCount} rivals`);
    }
    if (candidate.masteryTo !== null) {
      bullets.push(
        `Mastery → ${masteryTierLabel(candidate.masteryTo)}`);
    }
  }
  if (candidate.targetRank > 0) { bullets.push(`#${candidate.targetRank}`); }
  const context = strengthContext(candidate.strength, kind);
  return {
    kind,
    trackId: candidate.trackId,
    mode: candidate.mode,
    headline: kind === "best" ? `Beat ${name}` : name,
    gapMs: candidate.gapMs,
    context,
    bullets,
    myBestMs: candidate.myBestMs,
    targetMs: candidate.rivalBestMs,
    targetLabel: name,
    targetPlayerId: candidate.rival.playerId,
    targetRank: candidate.targetRank,
    ...(candidate.strength.tier == null ? {} : {
      targetMasteryLabel: masteryTierLabel(candidate.strength.tier),
    }),
    difficulty: candidate.strength.difficulty,
  };
}

const byTrack = (a: RivalCandidate, b: RivalCandidate): number =>
  a.trackId.localeCompare(b.trackId) || a.mode - b.mode ||
  a.rival.playerId.localeCompare(b.rival.playerId);

export function buildRivalFocus(
  myBests: readonly TrackBest[],
  rivals: readonly RivalBests[],
  fallbackMode: 150 | 200 = 150,
): FocusSet {
  const candidates = rivalCandidates(myBests, rivals);
  if (candidates.length === 0) {
    return {
      best: lowestMasteryFocus(myBests, fallbackMode),
      closest: null,
      biggest: null,
    };
  }
  const closest = [...candidates].sort((a, b) =>
    a.gapMs - b.gapMs || byTrack(a, b))[0]!;
  const biggest = [...candidates].sort((a, b) =>
    b.gapMs - a.gapMs || byTrack(a, b))[0]!;
  return {
    best: lowestMasteryFocus(myBests, fallbackMode),
    closest: rivalCard("closest", closest),
    biggest: rivalCard("biggest", biggest),
  };
}

// ---------------------------------------------------------------------
// GLOBAL context: per track the next human position above you.

type GlobalCandidate = Readonly<{
  row: FocusRow;
  above: NonNullable<FocusRow["above"]>;
  gapMs: number;
  relativeGap: number;
  strength: ReturnType<typeof targetStrength>;
  masteryTo: number | null;
  rank: number;
  upside: number;
}>;

function globalCandidates(
  rows: readonly FocusRow[],
): GlobalCandidate[] {
  const candidates: GlobalCandidate[] = [];
  for (const row of rows) {
    if (row.above === undefined) { continue; }
    const gapMs = row.myBestMs - row.above.bestMs;
    if (gapMs <= 0) { continue; }
    const relativeGap = gapMs / row.above.bestMs;
    const strength = targetStrength(row.trackId, row.mode, row.above.bestMs);
    const masteryTo = masteryCrossing(
      row.trackId, row.mode, row.myBestMs, row.above.bestMs);
    const rank = closenessBucket(relativeGap) +
      (strength.difficulty === "tough" ? 2
        : strength.difficulty === "solid" ? 1 : 0);
    // Upside: taking #1 or a podium spot outweighs an ordinary step.
    const positionValue = row.above.rank === 1
      ? 3 : row.above.rank <= 3 ? 2 : 0;
    candidates.push({
      row,
      above: row.above,
      gapMs,
      relativeGap,
      strength,
      masteryTo,
      rank,
      upside: positionValue + (masteryTo !== null ? 1 : 0),
    });
  }
  return candidates;
}

function globalCard(
  kind: FocusCard["kind"],
  candidate: GlobalCandidate,
): FocusCard {
  const name = candidate.above.displayName;
  const bullets: string[] = [];
  if (kind === "best") {
    bullets.push(candidate.above.rank === 1
      ? "Takes #1"
      : `→ #${candidate.above.rank} of ${candidate.row.humanCount}`);
    if (candidate.masteryTo !== null) {
      bullets.push(
        `Mastery → ${masteryTierLabel(candidate.masteryTo)}`);
    }
  }
  bullets.push(`#${candidate.above.rank} of ${candidate.row.humanCount} · you #${candidate.row.myRank}`);
  const strengthLine = strengthContext(candidate.strength, kind);
  return {
    kind,
    trackId: candidate.row.trackId,
    mode: candidate.row.mode,
    headline: kind === "best" ? `Beat ${name}` : name,
    gapMs: candidate.gapMs,
    context: strengthLine,
    bullets,
    myBestMs: candidate.row.myBestMs,
    targetMs: candidate.above.bestMs,
    targetLabel: name,
    targetPlayerId: candidate.above.playerId,
    targetRank: candidate.above.rank,
    ...(candidate.strength.tier == null ? {} : {
      targetMasteryLabel: masteryTierLabel(candidate.strength.tier),
    }),
    difficulty: candidate.strength.difficulty,
  };
}

const byGlobalTrack = (a: GlobalCandidate, b: GlobalCandidate): number =>
  a.row.trackId.localeCompare(b.row.trackId) || a.row.mode - b.row.mode;

export function buildGlobalFocus(
  rows: readonly FocusRow[],
  myBests: readonly TrackBest[] = [],
  fallbackMode: 150 | 200 = 150,
): FocusSet {
  const effectiveBests = myBests.length > 0 ? myBests : rows.map((row) => ({
    trackId: row.trackId,
    mode: row.mode,
    totalTimeMs: row.myBestMs,
    rank: row.myRank,
  }));
  const candidates = globalCandidates(rows);
  if (candidates.length === 0) {
    return {
      best: lowestMasteryFocus(effectiveBests, fallbackMode),
      closest: null,
      biggest: null,
    };
  }
  const closest = [...candidates].sort((a, b) =>
    a.gapMs - b.gapMs || byGlobalTrack(a, b))[0]!;
  const biggest = [...candidates].sort((a, b) =>
    b.gapMs - a.gapMs || byGlobalTrack(a, b))[0]!;
  return {
    best: lowestMasteryFocus(effectiveBests, fallbackMode),
    closest: globalCard("closest", closest),
    biggest: globalCard("biggest", biggest),
  };
}

// ---------------------------------------------------------------------
// The weakest driven track/mode. Higher tier indexes are lower Mastery;
// ties use the largest gap to the next tier and then stable track ordering.

export function lowestMasteryFocus(
  myBests: readonly TrackBest[],
  fallbackMode: 150 | 200 = 150,
): FocusCard | null {
  let weakest: Readonly<{
    trackId: string;
    mode: 150 | 200;
    deltaMs: number;
    tier: number;
    myBestMs: number;
  }> | null = null;
  for (const mine of myBests) {
    const ladder = trackThresholdLadder(mine.trackId, mine.mode);
    const tier = trackMasteryTier(mine.trackId, mine.mode, mine.totalTimeMs);
    if (ladder === undefined || tier == null) { continue; }
    const nextThreshold = tier > 0 ? ladder[tier - 1] : undefined;
    const deltaMs = nextThreshold === undefined
      ? 0 : Math.max(0, mine.totalTimeMs - nextThreshold);
    if (weakest === null || tier > weakest.tier ||
        (tier === weakest.tier && deltaMs > weakest.deltaMs) ||
        (tier === weakest.tier && deltaMs === weakest.deltaMs &&
         `${mine.trackId}#${mine.mode}` < `${weakest.trackId}#${weakest.mode}`)) {
      weakest = {
        trackId: mine.trackId,
        mode: mine.mode,
        deltaMs,
        tier,
        myBestMs: mine.totalTimeMs,
      };
    }
  }
  if (weakest !== null) {
    const currentLabel = masteryTierLabel(weakest.tier);
    const nextLabel = weakest.tier > 0
      ? masteryTierLabel(weakest.tier - 1) : null;
    return {
      kind: "best",
      trackId: weakest.trackId,
      mode: weakest.mode,
      headline: `Your lowest Mastery: ${currentLabel}`,
      context: nextLabel === null
        ? "This is already your strongest possible Mastery tier."
        : `Improve by ${formatGap(weakest.deltaMs)} to reach ${nextLabel}.`,
      bullets: [],
      myBestMs: weakest.myBestMs,
      difficulty: "open",
      masteryLabel: currentLabel,
      ...(nextLabel === null ? {} : { nextMasteryLabel: nextLabel, improveByMs: weakest.deltaMs }),
    };
  }
  if (myBests.length === 0) {
    return {
      kind: "best",
      trackId: "track.mario_kart_stadium",
      mode: fallbackMode,
      headline: "Set your first time",
      context: "Every rivalry starts with a first lap.",
      bullets: [],
      myBestMs: null,
      difficulty: "open",
    };
  }
  return null;
}

// Compatibility export for existing consumers while the product wording has
// moved from an opaque recommendation to the weakest Mastery fact.
export const fallbackFocus = lowestMasteryFocus;
