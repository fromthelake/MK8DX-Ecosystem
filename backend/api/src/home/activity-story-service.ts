// Community ACTIVITY STORIES: recent published Time Trial activity
// clustered into stories instead of raw event rows.
//
// Clustering semantics (deterministic, simplest understandable form):
// results of the same Player + Track + mode belong to one story while
// each is within 24 hours of the story's most recent result. Newer
// results anchor the story; an older result more than 24 hours before
// the anchor starts the previous story.
//
// Honesty rules:
// - "runs" counts canonical published submissions in the story;
// - "started -> best" is session-internal (first and best time of the
//   story) and never fabricated;
// - the compact run position is the immutable publication-time snapshot;
// - rank movement and "passed" Players are only claimed when the story
//   produced the Player's current overall best on that combo, measured
//   against the pre-story personal best (or the session start when no
//   earlier time exists) over CURRENT published human standings;
// - only human Players take part (system/reference identities are
//   excluded by the repository contract).

export const STORY_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ActivityStoryLap = Readonly<{
  lapNumber: number;
  timeMs: number;
  coinsCollected?: number;
  mushroomsUsed?: number;
}>;

export type ActivityStoryLoadout = Readonly<{
  characterId?: string;
  characterVariantId?: string;
  bodyId?: string;
  bodyVariantId?: string;
  tireId?: string;
  gliderId?: string;
  gliderVariantId?: string;
}>;

export type StoryResult = Readonly<{
  resultId: string;
  playerId: string;
  displayName: string;
  countryId?: string;
  avatarId?: string;
  trackId: string;
  mode: 150 | 200;
  totalTimeMs: number;
  resultAtMs: number;
  laps?: readonly ActivityStoryLap[];
  loadout?: ActivityStoryLoadout;
  sourceKind: string;
  correctedFields?: readonly string[];
  rankAtPublication?: number;
}>;

export type StoryCluster = Readonly<{
  playerId: string;
  displayName: string;
  countryId?: string;
  avatarId?: string;
  trackId: string;
  mode: 150 | 200;
  runs: readonly Readonly<{
    resultId: string;
    timeMs: number;
    atMs: number;
    laps?: readonly ActivityStoryLap[];
    loadout?: ActivityStoryLoadout;
    sourceKind: string;
    correctedFields?: readonly string[];
    rankAtPublication?: number;
  }>[];
  startMs: number;
  bestMs: number;
  rankAtPublication?: number;
  latestAtMs: number;
}>;

export function clusterStories(
  results: readonly StoryResult[],
): readonly StoryCluster[] {
  const byKey = new Map<string, StoryResult[]>();
  for (const result of results) {
    const key = `${result.playerId}#${result.trackId}#${result.mode}`;
    const bucket = byKey.get(key) ?? [];
    bucket.push(result);
    byKey.set(key, bucket);
  }
  const clusters: StoryCluster[] = [];
  for (const bucket of byKey.values()) {
    const sorted = [...bucket].sort((a, b) =>
      b.resultAtMs - a.resultAtMs || a.resultId.localeCompare(b.resultId));
    let index = 0;
    while (index < sorted.length) {
      const anchor = sorted[index]!;
      const members = [anchor];
      let next = index + 1;
      while (next < sorted.length &&
             anchor.resultAtMs - sorted[next]!.resultAtMs <=
               STORY_WINDOW_MS) {
        members.push(sorted[next]!);
        next += 1;
      }
      index = next;
      const chronological = [...members].sort((a, b) =>
        a.resultAtMs - b.resultAtMs || a.resultId.localeCompare(b.resultId));
      const bestMember = [...members].sort((a, b) =>
        a.totalTimeMs - b.totalTimeMs || a.resultId.localeCompare(b.resultId))[0]!;
      clusters.push({
        playerId: anchor.playerId,
        displayName: anchor.displayName,
        ...(anchor.countryId === undefined
          ? {} : { countryId: anchor.countryId }),
        ...(anchor.avatarId === undefined
          ? {} : { avatarId: anchor.avatarId }),
        trackId: anchor.trackId,
        mode: anchor.mode,
        runs: chronological.map((member) => ({
          resultId: member.resultId,
          timeMs: member.totalTimeMs,
          atMs: member.resultAtMs,
          laps: member.laps ?? [],
          ...(member.loadout === undefined
            ? {}
            : { loadout: member.loadout }),
          sourceKind: member.sourceKind,
          ...(member.correctedFields === undefined
            ? {}
            : { correctedFields: member.correctedFields }),
          ...(member.rankAtPublication === undefined
            ? {}
            : { rankAtPublication: member.rankAtPublication }),
        })),
        startMs: chronological[0]!.totalTimeMs,
        bestMs: bestMember.totalTimeMs,
        ...(bestMember.rankAtPublication === undefined
          ? {}
          : { rankAtPublication: bestMember.rankAtPublication }),
        latestAtMs: anchor.resultAtMs,
      });
    }
  }
  clusters.sort((a, b) =>
    b.latestAtMs - a.latestAtMs ||
    a.playerId.localeCompare(b.playerId) ||
    a.trackId.localeCompare(b.trackId) ||
    a.mode - b.mode);
  return clusters;
}

export type PassedPlayer = Readonly<{
  playerId: string;
  displayName: string;
}>;

export type ActivityStory = Readonly<{
  player: Readonly<{
    playerId: string;
    displayName: string;
    countryId?: string;
    avatarId?: string;
  }>;
  trackId: string;
  mode: 150 | 200;
  runs: number;
  startMs: number;
  bestMs: number;
  improvedMs?: number;
  personalBest: boolean;
  personalBestDeltaMs?: number;
  /** Story best minus this Player's personal best immediately before the story. */
  playerDeltaMs?: number;
  /** Human-leaderboard position captured when the displayed best run published. */
  runRank?: number;
  rank?: Readonly<{
    after: number;
    before?: number;
    passed: readonly PassedPlayer[];
    passedCount: number;
  }>;
  latestAtMs: number;
  reactions?: Readonly<{ count: number; kinds: readonly string[] }>;
  runDetails: readonly Readonly<{
    resultId: string;
    timeMs: number;
    atMs: number;
    laps?: readonly ActivityStoryLap[];
    loadout?: ActivityStoryLoadout;
    sourceKind: string;
    correctedFields?: readonly string[];
  }>[];
}>;

// Rank movement over CURRENT published human standings: "passed" are
// the other Players whose current best lies strictly between the
// story's best and the movement baseline (pre-story PB, or session
// start without one). Claimed only when the story set the Player's PB.
export function storyRankMovement(
  cluster: StoryCluster,
  humanBests: readonly Readonly<{
    playerId: string;
    displayName: string;
    bestMs: number;
  }>[],
  preStoryBestMs: number | null,
): ActivityStory["rank"] {
  const mine = humanBests.find(
    (entry) => entry.playerId === cluster.playerId);
  if (mine === undefined) { return undefined; }
  const after = 1 + humanBests.filter(
    (entry) => entry.bestMs < mine.bestMs).length;
  const setPersonalBest = mine.bestMs === cluster.bestMs &&
    (preStoryBestMs === null || cluster.bestMs <= preStoryBestMs);
  if (!setPersonalBest) {
    return { after, passed: [], passedCount: 0 };
  }
  const baseline = preStoryBestMs ?? cluster.startMs;
  const passed = humanBests
    .filter((entry) => entry.playerId !== cluster.playerId &&
      entry.bestMs > cluster.bestMs && entry.bestMs < baseline)
    .sort((a, b) => a.bestMs - b.bestMs ||
      a.playerId.localeCompare(b.playerId));
  return {
    after,
    ...(passed.length > 0 ? { before: after + passed.length } : {}),
    passed: passed.slice(0, 3).map((entry) => ({
      playerId: entry.playerId,
      displayName: entry.displayName,
    })),
    passedCount: passed.length,
  };
}

export interface ActivityStoryRepository {
  listRecentResults(
    sinceMs: number,
    limit: number,
  ): Promise<readonly StoryResult[]>;
  listHumanBestsForCombos(combos: readonly Readonly<{
    key: string;
    trackId: string;
    mode: 150 | 200;
  }>[]): Promise<ReadonlyMap<string, readonly Readonly<{
    playerId: string;
    displayName: string;
    bestMs: number;
  }>[]>>;
  preStoryBests(targets: readonly Readonly<{
    key: string;
    playerId: string;
    trackId: string;
    mode: 150 | 200;
    beforeAtMs: number;
  }>[]): Promise<ReadonlyMap<string, number>>;
  reactionSummaries(resultIds: readonly string[]): Promise<
    ReadonlyMap<string, Readonly<{ count: number; kinds: readonly string[] }>>
  >;
}

export class ActivityStoryError extends Error {
  public constructor() {
    super("Community activity stories are temporarily unavailable.");
    this.name = "ActivityStoryError";
  }
}

// No calendar window: "recent" means the most recent published
// results, however old the calendar dates are, so a quiet community
// still sees its last sessions. The raw-result cap bounds the work;
// with very heavy activity the oldest of these stories age out first.
const RECENT_LIMIT = 500;
const STORY_LIMIT = 30;
const RUN_DETAIL_LIMIT = 20;

export class ActivityStoryService {
  public constructor(
    private readonly repository: ActivityStoryRepository,
  ) {}

  public async listStories(): Promise<readonly ActivityStory[]> {
    try {
      const results = await this.repository.listRecentResults(
        0,
        RECENT_LIMIT,
      );
      const clusters = clusterStories(results).slice(0, STORY_LIMIT);

      const comboTargets = new Map<string, Readonly<{
        key: string; trackId: string; mode: 150 | 200;
      }>>();
      for (const cluster of clusters) {
        const key = `${cluster.trackId}#${cluster.mode}`;
        comboTargets.set(key, { key, trackId: cluster.trackId, mode: cluster.mode });
      }
      const preStoryTargets = clusters.map((cluster, index) => ({
        key: String(index),
        playerId: cluster.playerId,
        trackId: cluster.trackId,
        mode: cluster.mode,
        beforeAtMs: cluster.runs[0]!.atMs,
      }));
      const [bestsByCombo, preStoryBests, reactionSummaries] =
        await Promise.all([
          this.repository.listHumanBestsForCombos([...comboTargets.values()]),
          this.repository.preStoryBests(preStoryTargets),
          this.repository.reactionSummaries(clusters.flatMap((cluster) =>
            cluster.runs.map((run) => run.resultId))),
        ]);

      const stories: ActivityStory[] = [];
      for (const [clusterIndex, cluster] of clusters.entries()) {
        const humanBests =
          bestsByCombo.get(`${cluster.trackId}#${cluster.mode}`) ?? [];
        const preStoryBest = preStoryBests.get(String(clusterIndex)) ?? null;
        const rank = storyRankMovement(cluster, humanBests, preStoryBest);
        const improvedMs = cluster.startMs - cluster.bestMs;
        let reactionCount = 0;
        const reactionKinds: string[] = [];
        for (const run of cluster.runs) {
          const summary = reactionSummaries.get(run.resultId);
          if (summary === undefined) { continue; }
          reactionCount += summary.count;
          for (const kind of summary.kinds) {
            if (!reactionKinds.includes(kind) && reactionKinds.length < 3) {
              reactionKinds.push(kind);
            }
          }
        }
        const currentBest = humanBests.find(
          (entry) => entry.playerId === cluster.playerId)?.bestMs;
        const personalBest = currentBest === cluster.bestMs &&
          (preStoryBest === null || cluster.bestMs <= preStoryBest);
        const personalBestDeltaMs = personalBest && preStoryBest !== null
          ? preStoryBest - cluster.bestMs
          : undefined;
        const playerDeltaMs = preStoryBest === null
          ? undefined
          : cluster.bestMs - preStoryBest;
        stories.push({
          player: {
            playerId: cluster.playerId,
            displayName: cluster.displayName,
            ...(cluster.countryId === undefined
              ? {} : { countryId: cluster.countryId }),
            ...(cluster.avatarId === undefined
              ? {} : { avatarId: cluster.avatarId }),
          },
          trackId: cluster.trackId,
          mode: cluster.mode,
          runs: cluster.runs.length,
          startMs: cluster.startMs,
          bestMs: cluster.bestMs,
          ...(cluster.runs.length > 1 && improvedMs > 0
            ? { improvedMs }
            : {}),
          personalBest,
          ...(personalBestDeltaMs !== undefined && personalBestDeltaMs > 0
            ? { personalBestDeltaMs }
            : {}),
          ...(playerDeltaMs === undefined ? {} : { playerDeltaMs }),
          ...(cluster.rankAtPublication === undefined
            ? {}
            : { runRank: cluster.rankAtPublication }),
          ...(rank === undefined ? {} : { rank }),
          latestAtMs: cluster.latestAtMs,
          ...(reactionCount > 0
            ? { reactions: { count: reactionCount, kinds: reactionKinds } }
            : {}),
          runDetails: cluster.runs.slice(0, RUN_DETAIL_LIMIT),
        });
      }
      return stories;
    } catch {
      throw new ActivityStoryError();
    }
  }
}
