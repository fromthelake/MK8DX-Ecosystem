// The model behind the signed-in Home (W02). The page itself is the design system's `ds-home.ts`
// since Phase 10; what lives here is the arithmetic and the Player-language interpretation, which
// the Journey test (T-JOURNEY) and the Home browser gate both read.
//
// The page it feeds pairs identity with the TWO competitive domains:
//   TOURNAMENT   rank/rating + the recovered seating classification;
//   TIME TRIALS  global standing + Mastery (Mastery is a Time Trial
//                concept, never a third domain).
// Beside them, YOUR FOCUS shows the three distinct challenge concepts
// (Best Next / Closest Battle / Biggest Gap) with a RIVALS|GLOBAL
// context toggle. RECENT KEY EVENTS interprets meaningful publications
// from the last seven days, independently of whether Home was open. Depth lives on the
// profile/compare pages - Home only carries headlines and next actions.

import { benchmarksByKind } from "./benchmark-manifest.js";
import { trackBenchmarks } from "./benchmark-manifest.js";
import type { ActivityStory } from "./activity-stories.js";
import { trackAsset } from "./asset-manifest.js";
import type { FocusRow } from "./home-focus.js";

// Presentation only: the canonical short Mastery labels ("Adv B")
// spelled out for the hero ("Advanced B"). Semantics and colors stay
// keyed on the canonical short label.
const MASTERY_LONG_PREFIX: Readonly<Record<string, string>> = {
  Exp: "Expert",
  Adv: "Advanced",
  Int: "Intermediate",
  Beg: "Beginner",
};

export function masteryLongLabel(label: string): string {
  const [prefix, ...rest] = label.split(" ");
  const long = prefix === undefined
    ? label
    : MASTERY_LONG_PREFIX[prefix] ?? prefix;
  return [long, ...rest].join(" ");
}
import type { TrackBest } from "./mastery-view.js";
import type { RankTrackFocus } from "./rank-track-focus.js";


type RivalComparison = Readonly<{
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
  /** `played` is false until the Player has a rated race; older servers omit it. */
  tournament?: Readonly<{ rank: number; of: number; score: number; played?: boolean }>;
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

export type HomeLadder = Readonly<{
  staffGhostsBeaten: number;
  withinOneSecond: number;
  trackRecords: number;
  tracksDriven: number;
  topThreePositions: number;
  outsideTopTen: number;
  trackTotal: number;
}>;

export type HomeLadderCell = Readonly<{
  key: "staff" | "driven";
  label: string;
  value: string;
  progress: number;
  focus: RankTrackFocus;
}>;

/**
 * Home's own primary action. Since Phase 7 there is one canonical Post-a-Time task, so Home opens
 * it directly (with the task's own TrackSelector) instead of routing through the cup directory.
 */
export const HOME_SUBMIT_HREF = "/?post=1";

export function homeLadderCells(metrics: HomeLadder): readonly HomeLadderCell[] {
  const total = Math.max(1, metrics.trackTotal);
  return [
    {
      key: "driven",
      label: "Times set",
      value: `${metrics.tracksDriven}/${metrics.trackTotal}`,
      progress: metrics.tracksDriven / total,
      focus: "tracks-left",
    },
    {
      key: "staff",
      label: "Staff ghosts defeated",
      value: `${metrics.staffGhostsBeaten}/${metrics.trackTotal}`,
      progress: metrics.staffGhostsBeaten / total,
      focus: "staff-left",
    },
  ];
}

export function homeProgressState(progress: number): Readonly<{
  percentage: number;
  width: string;
  complete: boolean;
  empty: boolean;
}> {
  const bounded = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const percentage = Math.round(bounded * 100);
  return {
    percentage,
    width: `${(bounded * 100).toFixed(1)}%`,
    complete: percentage === 100,
    empty: percentage === 0,
  };
}

export type HomeCompetitiveCell = Readonly<{
  label: string; value: number; focus: RankTrackFocus;
}>;

export function homeCompetitiveCells(metrics: HomeLadder): readonly HomeCompetitiveCell[] {
  return [
    { label: "Within 1s of #1", value: metrics.withinOneSecond, focus: "near-record" },
    { label: "Top 3 positions", value: metrics.topThreePositions, focus: "top-three" },
    { label: "Current #1s", value: metrics.trackRecords, focus: "current-records" },
    { label: "Outside top 10", value: metrics.outsideTopTen, focus: "outside-top-ten" },
  ];
}

export function buildHomeLadder(
  bests: readonly TrackBest[],
  rows: readonly FocusRow[],
  mode: 150 | 200,
  trackIds?: readonly string[],
): HomeLadder {
  const activeTrackIds = trackIds === undefined ? null : new Set(trackIds);
  const modeBests = bests.filter((best) => best.mode === mode &&
    (activeTrackIds === null || activeTrackIds.has(best.trackId)));
  const staffTimes = new Map(
    benchmarksByKind("nintendo_staff", mode)
      .filter((entry) => activeTrackIds === null || activeTrackIds.has(entry.trackId))
      .map((entry) => [
      entry.trackId, entry.timeMs,
    ]),
  );
  const leaderTimes = new Map(
    rows.filter((row) => row.mode === mode &&
      (activeTrackIds === null || activeTrackIds.has(row.trackId))).map((row) => [
      row.trackId, row.leaderBestMs,
    ]),
  );
  return {
    staffGhostsBeaten: modeBests.filter((best) => {
      const staff = staffTimes.get(best.trackId);
      return staff !== undefined && best.totalTimeMs < staff;
    }).length,
    withinOneSecond: modeBests.filter((best) => {
      const leader = leaderTimes.get(best.trackId);
      return best.rank > 1 && leader !== undefined &&
        best.totalTimeMs - leader <= 1_000;
    }).length,
    trackRecords: modeBests.filter((best) => best.rank === 1).length,
    tracksDriven: new Set(modeBests.map((best) => best.trackId)).size,
    topThreePositions: modeBests.filter((best) => best.rank <= 3).length,
    outsideTopTen: modeBests.filter((best) => best.rank > 10).length,
    trackTotal: staffTimes.size,
  };
}

export async function fetchComeback(
  signal: AbortSignal,
): Promise<HomeComeback | null> {
  const response = await fetch("/v1/home/comeback", {
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
  if (response.status !== 200) { throw new Error("comeback unavailable"); }
  const body = await response.json() as Record<string, unknown>;
  if (body["schemaVersion"] !== "mk8dx.home-comeback.v1") {
    throw new Error("comeback invalid");
  }
  return body as unknown as HomeComeback;
}

function formatTime(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = milliseconds % 1_000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${
    String(millis).padStart(3, "0")}`;
}

function formatAggregateGap(milliseconds: number): string {
  const absolute = Math.abs(milliseconds);
  if (absolute < 60_000) return `${(absolute / 1000).toFixed(3)}s`;
  return formatTime(absolute);
}

// ---------------------------------------------------------------------
// SINCE YOU WERE AWAY - interpreted lines, never raw event rows.

export function comebackLines(comeback: HomeComeback): readonly string[] {
  const lines: string[] = [];
  const standing = comeback.timeTrials;
  if (standing.previousStanding !== undefined &&
      standing.previousStanding !== standing.standing &&
      standing.standing > 0) {
    const up = standing.standing < standing.previousStanding;
    lines.push(`${up ? "↑" : "↓"} You moved from #${
      standing.previousStanding} to #${standing.standing} in Time Trials 150cc`);
  }
  for (const rival of comeback.rivals) {
    if (rival.previous === undefined) { continue; }
    const netTracks = rival.tracksAhead - rival.previous.tracksAhead;
    if (netTracks !== 0) {
      lines.push(netTracks > 0
        ? `⚔ You gained ${netTracks} track${
          netTracks === 1 ? "" : "s"} on ${rival.displayName}`
        : `⚔ ${rival.displayName} gained ${-netTracks} track${
          netTracks === -1 ? "" : "s"} on you`);
    }
    const deltaChange = rival.totalDeltaMs - rival.previous.totalDeltaMs;
    if (deltaChange !== 0) {
      const ahead = rival.totalDeltaMs >= 0;
      if (deltaChange > 0) {
        lines.push(ahead
          ? `⏱ Your advantage over ${rival.displayName} improved by ${
            formatAggregateGap(deltaChange)}`
          : `⏱ Your gap to ${rival.displayName} shrank by ${
            formatAggregateGap(deltaChange)}`);
      } else {
        lines.push(ahead
          ? `⏱ Your advantage over ${rival.displayName} shrank by ${
            formatAggregateGap(deltaChange)}`
          : `⏱ Your gap to ${rival.displayName} grew by ${
            formatAggregateGap(deltaChange)}`);
      }
    }
  }
  return lines;
}

export type RecentKeyOutcome = Readonly<{
  kind: "passed" | "ghost" | "rank" | "pb" | "first";
  targetName?: string;
  /** Signed like every product delta: negative is ahead/faster, positive is behind/slower. */
  deltaMs?: number;
  timeMs?: number;
  beforeRank?: number;
  afterRank?: number;
  english: string;
  dutch: string;
}>;

export type RecentKeyEvent = Readonly<{
  atMs: number;
  trackId: string;
  mode: 150 | 200;
  /** Canonical publication identity when the Activity contract carries it. */
  runId?: string;
  primaryOutcome: RecentKeyOutcome;
  secondaryOutcomes: readonly RecentKeyOutcome[];
}>;

const KEY_EVENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const RECENT_KEY_EVENT_LIMIT = 15;

function eventGap(milliseconds: number, dutch: boolean): string {
  const value = formatAggregateGap(milliseconds);
  return dutch ? value.replace(".", ",") : value;
}

function podiumAchievementMark(rank: number): string {
  return rank === 1 ? "🏆 " : rank === 2 ? "🥈 " : rank === 3 ? "🥉 " : "";
}

/**
 * Recent events are anchored to an actual published run, not to whether Home
 * happened to be open. The comparison is deliberately current: a line says
 * how far the Player is from a rival now, and only claims an overtake when the
 * story's pre-PB and current times prove the crossing.
 */
export function recentKeyEvents(
  comeback: HomeComeback,
  stories: readonly ActivityStory[],
  bestsByPlayer: ReadonlyMap<string, readonly TrackBest[]>,
  nowMs: number,
): readonly RecentKeyEvent[] {
  const events: RecentKeyEvent[] = [];
  const seen = new Set<string>();
  const priority: Readonly<Record<RecentKeyOutcome["kind"], number>> = {
    passed: 0,
    rank: 1,
    ghost: 2,
    pb: 3,
    first: 3,
  };
  const add = (
    story: ActivityStory,
    run: Readonly<{ resultId?: string; timeMs: number; atMs: number }>,
    outcomes: readonly RecentKeyOutcome[],
  ): void => {
    if (outcomes.length === 0 || run.atMs < nowMs - KEY_EVENT_WINDOW_MS) { return; }
    const key = run.resultId === undefined
      ? `${story.player.playerId}#${story.trackId}#${story.mode}#${run.atMs}#${run.timeMs}`
      : `${story.player.playerId}#${story.trackId}#${story.mode}#${run.resultId}`;
    if (seen.has(key)) { return; }
    seen.add(key);
    const ordered = outcomes.map((outcome, index) => ({ outcome, index }))
      .sort((left, right) => priority[left.outcome.kind] - priority[right.outcome.kind] ||
        left.index - right.index)
      .map(({ outcome }) => outcome);
    events.push({
      atMs: run.atMs,
      trackId: story.trackId,
      mode: story.mode,
      ...(run.resultId === undefined ? {} : { runId: run.resultId }),
      primaryOutcome: ordered[0]!,
      secondaryOutcomes: ordered.slice(1),
    });
  };
  const ownStories = stories.filter((story) =>
    story.player.playerId === comeback.player.playerId &&
    story.personalBest && story.latestAtMs >= nowMs - KEY_EVENT_WINDOW_MS)
    .sort((a, b) => b.latestAtMs - a.latestAtMs);
  for (const story of ownStories) {
    const name = trackAsset(story.trackId)?.name ?? story.trackId;
    let runningBest = story.personalBestDeltaMs !== undefined
      ? story.bestMs + story.personalBestDeltaMs
      : story.playerDeltaMs !== undefined
        ? story.bestMs - story.playerDeltaMs
        : undefined;
    const details: readonly Readonly<{
      resultId?: string;
      timeMs: number;
      atMs: number;
    }>[] = story.runDetails.length === 0
      ? [{ timeMs: story.bestMs, atMs: story.latestAtMs }]
      : [...story.runDetails].sort((left, right) => left.atMs - right.atMs ||
        left.resultId.localeCompare(right.resultId));
    const bestRunId = [...details].sort((left, right) => left.timeMs - right.timeMs ||
      left.atMs - right.atMs || (left.resultId ?? "").localeCompare(right.resultId ?? ""))[0]
      ?.resultId;
    for (const detail of details) {
      if (runningBest !== undefined && detail.timeMs > runningBest) { continue; }
      const previous = runningBest;
      const own = detail.timeMs;
      const outcomes: RecentKeyOutcome[] = [];
      for (const rival of comeback.rivals) {
        const rivalTime = (bestsByPlayer.get(rival.playerId) ?? [])
          .find((best) => best.trackId === story.trackId && best.mode === story.mode)
          ?.totalTimeMs;
        if (rivalTime === undefined) { continue; }
        const crossed = (detail.resultId === bestRunId &&
          story.rank?.passed.some((player) => player.playerId === rival.playerId) === true) ||
          (previous !== undefined && previous >= rivalTime && own < rivalTime);
        if (crossed) {
          const lead = rivalTime - own;
          outcomes.push({
            kind: "passed", targetName: rival.displayName, deltaMs: own - rivalTime,
            english: lead > 0
              ? `⚔ ${name}: passed ${rival.displayName} ✓ · lead ${eventGap(lead, false)}.`
              : lead === 0
                ? `⚔ ${name}: passed ${rival.displayName} ✓ · currently tied.`
                : `⚔ ${name}: passed ${rival.displayName} in this run ✓ · currently ${eventGap(-lead, false)} behind.`,
            dutch: lead > 0
              ? `⚔ ${name}: ${rival.displayName} gepasseerd ✓ · voorsprong ${eventGap(lead, true)}.`
              : lead === 0
                ? `⚔ ${name}: ${rival.displayName} gepasseerd ✓ · momenteel gelijk.`
                : `⚔ ${name}: ${rival.displayName} met deze run gepasseerd ✓ · momenteel ${eventGap(-lead, true)} achter.`,
          });
        }
      }
      const staff = trackBenchmarks(story.trackId, story.mode)
        .find((entry) => entry.kind === "nintendo_staff")?.timeMs;
      if (staff !== undefined && own < staff && (previous === undefined || previous >= staff)) {
        outcomes.push({
          kind: "ghost", deltaMs: own - staff,
          english: `👻 ${name}: Nintendo Ghost defeated ✓`,
          dutch: `👻 ${name}: Nintendo Ghost verslagen ✓`,
        });
      }
      if (detail.resultId === bestRunId && story.rank?.before !== undefined &&
          story.rank.after < story.rank.before) {
        outcomes.push({
          kind: "rank", beforeRank: story.rank.before, afterRank: story.rank.after,
          english: `🏁 ${name}: track rank: #${story.rank.before} → ${
            podiumAchievementMark(story.rank.after)}#${story.rank.after}.`,
          dutch: `🏁 ${name}: circuitrang: #${story.rank.before} → ${
            podiumAchievementMark(story.rank.after)}#${story.rank.after}.`,
        });
      }
      const gain = previous === undefined ? undefined : previous - own;
      if (gain === undefined || gain > 0) {
        outcomes.push({
          kind: gain === undefined ? "first" : "pb",
          ...(gain === undefined ? {} : { deltaMs: -gain }),
          timeMs: own,
          english: gain === undefined
            ? `⏱ ${name}: first published time, ${formatTime(own)}.`
            : `⏱ ${name}: new PB by ${eventGap(gain, false)} → ${formatTime(own)}.`,
          dutch: gain === undefined
            ? `⏱ ${name}: eerste gepubliceerde tijd, ${formatTime(own)}.`
            : `⏱ ${name}: nieuwe PR met ${eventGap(gain, true)} → ${formatTime(own)}.`,
        });
      }
      add(story, {
        ...(detail.resultId === undefined ? {} : { resultId: detail.resultId }),
        timeMs: own, atMs: detail.atMs,
      }, outcomes);
      runningBest = previous === undefined ? own : Math.min(previous, own);
    }
  }
  return events.sort((left, right) => right.atMs - left.atMs ||
    left.trackId.localeCompare(right.trackId) || left.mode - right.mode ||
    (left.runId ?? "").localeCompare(right.runId ?? ""))
    .slice(0, RECENT_KEY_EVENT_LIMIT);
}

// The current rival headline in Player language (direction explained,
// coverage explicit).
export function rivalHeadline(rival: RivalComparison): string {
  const direction = rival.totalDeltaMs >= 0 ? "faster than" : "behind";
  return `VS ${rival.displayName}: ${rival.tracksAhead}–${
    rival.tracksBehind} tracks · ${
    formatAggregateGap(rival.totalDeltaMs)} ${direction} across ${
    rival.sharedCombos} shared combos`;
}
