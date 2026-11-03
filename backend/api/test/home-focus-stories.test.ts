import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import {
  ActivityStoryService,
  clusterStories,
  storyRankMovement,
  STORY_WINDOW_MS,
  type ActivityStoryRepository,
  type StoryResult,
} from "../src/home/activity-story-service.js";
import {
  FollowPreferenceService,
  HomeComebackService,
  RivalPreferenceService,
  type RivalPreference,
  type RivalPreferenceRepository,
} from "../src/home/home-comeback-service.js";
import {
  computeFocusRows,
  HomeFocusService,
  type HumanBest,
} from "../src/home/home-focus-service.js";
import type { IdentityReadRepository } from "../src/identity/types.js";

const identityRepository: IdentityReadRepository = {
  async findPublicPlayerById() { return null; },
  async findUserAccountSummaryById() { return null; },
  async findPlayerClaimSummaryById() { return null; },
};

const best = (
  playerId: string,
  trackId: string,
  mode: 150 | 200,
  bestMs: number,
  orderKey: number,
): HumanBest => ({
  playerId,
  displayName: playerId.replace("player.", ""),
  trackId,
  mode,
  bestMs,
  orderKey,
});

describe("home focus (GLOBAL context)", () => {
  it("computes rank, leader and the next human above deterministically", () => {
    const rows = computeFocusRows("player.ben", [
      best("player.matteo", "track.wild_woods", 150, 117_848, 1),
      best("player.floyd", "track.wild_woods", 150, 117_894, 2),
      best("player.ben", "track.wild_woods", 150, 118_372, 3),
      best("player.leonora", "track.wild_woods", 150, 120_752, 4),
      // A track someone else drives but Ben does not: no row.
      best("player.floyd", "track.big_blue", 150, 87_022, 2),
    ]);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.myRank).toBe(3);
    expect(row.humanCount).toBe(4);
    expect(row.leaderBestMs).toBe(117_848);
    // The next human ABOVE is Floyd (#2), not the leader.
    expect(row.above).toEqual({
      playerId: "player.floyd",
      displayName: "floyd",
      bestMs: 117_894,
      rank: 2,
    });
  });

  it("handles the leader (no one above) and tie-breaks stably", () => {
    const rows = computeFocusRows("player.ben", [
      best("player.ben", "track.big_blue", 150, 87_022, 3),
      best("player.floyd", "track.big_blue", 150, 88_000, 2),
      // Two players tied above on another track: smallest order key wins.
      best("player.ben", "track.mario_circuit", 150, 116_500, 3),
      best("player.floyd", "track.mario_circuit", 150, 115_000, 2),
      best("player.lex", "track.mario_circuit", 150, 115_000, 1),
    ]);
    const leader = rows.find((row) => row.trackId === "track.big_blue")!;
    expect(leader.myRank).toBe(1);
    expect(leader.above).toBeUndefined();
    const tied = rows.find((row) => row.trackId === "track.mario_circuit")!;
    // RANK semantics: two tied times above mean rank 3.
    expect(tied.myRank).toBe(3);
    expect(tied.above?.playerId).toBe("player.lex");
    expect(tied.above?.rank).toBe(1);
  });
});

const result = (
  id: string,
  playerId: string,
  trackId: string,
  timeMs: number,
  atMs: number,
  mode: 150 | 200 = 150,
): StoryResult => ({
  resultId: `user_submission.time.${id}`,
  playerId,
  displayName: playerId.replace("player.", ""),
  trackId,
  mode,
  totalTimeMs: timeMs,
  resultAtMs: atMs,
  sourceKind: "android_scan",
});

describe("activity stories", () => {
  it("clusters Player+Track+mode within the 24h window", () => {
    const base = 1_700_000_000_000;
    const clusters = clusterStories([
      // Twelve-run Big Blue session by Ben within one day.
      result("A00001", "player.ben", "track.big_blue", 89_381, base),
      result("A00002", "player.ben", "track.big_blue", 88_100, base + 60_000),
      result("A00003", "player.ben", "track.big_blue", 87_022, base + 120_000),
      // Same track two days later: a separate story.
      result("A00004", "player.ben", "track.big_blue", 86_900,
        base + 2 * STORY_WINDOW_MS),
      // Same window, other track and other mode: separate stories.
      result("A00005", "player.ben", "track.mute_city", 90_000, base + 1_000),
      result("A00006", "player.ben", "track.big_blue", 60_000, base + 2_000,
        200),
    ]);
    expect(clusters).toHaveLength(4);
    const laterStory = clusters[0]!;
    expect(laterStory.runs).toHaveLength(1);
    expect(laterStory.bestMs).toBe(86_900);
    const session = clusters.find((cluster) =>
      cluster.trackId === "track.big_blue" && cluster.mode === 150 &&
      cluster.runs.length === 3)!;
    // Session-internal truth: started at the chronologically first run.
    expect(session.startMs).toBe(89_381);
    expect(session.bestMs).toBe(87_022);
    // Determinism: same input, same clusters.
    expect(clusterStories([
      result("A00001", "player.ben", "track.big_blue", 89_381, base),
      result("A00002", "player.ben", "track.big_blue", 88_100, base + 60_000),
      result("A00003", "player.ben", "track.big_blue", 87_022, base + 120_000),
      result("A00004", "player.ben", "track.big_blue", 86_900,
        base + 2 * STORY_WINDOW_MS),
      result("A00005", "player.ben", "track.mute_city", 90_000, base + 1_000),
      result("A00006", "player.ben", "track.big_blue", 60_000, base + 2_000,
        200),
    ])).toEqual(clusters);
  });

  it("claims rank movement only when the story set the personal best", () => {
    const base = 1_700_000_000_000;
    const cluster = clusterStories([
      result("B00001", "player.floyd", "track.mario_circuit", 118_102, base),
      result("B00002", "player.floyd", "track.mario_circuit", 116_331,
        base + 60_000),
    ])[0]!;
    const standings = [
      { playerId: "player.matteo", displayName: "Matteo", bestMs: 115_000 },
      { playerId: "player.floyd", displayName: "Floyd", bestMs: 116_331 },
      { playerId: "player.ben", displayName: "Ben", bestMs: 116_900 },
      { playerId: "player.lex", displayName: "Lex", bestMs: 117_500 },
      { playerId: "player.valerio", displayName: "Valerio", bestMs: 119_000 },
    ];
    // No earlier time: movement measured from the session start.
    const movement = storyRankMovement(cluster, standings, null)!;
    expect(movement.after).toBe(2);
    expect(movement.before).toBe(4);
    expect(movement.passedCount).toBe(2);
    expect(movement.passed.map((entry) => entry.displayName))
      .toEqual(["Ben", "Lex"]);
    // A pre-story PB faster than the session best: no movement claims.
    const noClaim = storyRankMovement(cluster, standings, 116_000);
    expect(noClaim?.passedCount).toBe(0);
    expect(noClaim?.before).toBeUndefined();
    // A pre-story PB between start and best bounds the claim honestly.
    const bounded = storyRankMovement(cluster, standings, 117_000)!;
    expect(bounded.passed.map((entry) => entry.displayName)).toEqual(["Ben"]);
  });

  it("keeps the displayed best run's publication-time rank immutable", () => {
    const base = 1_700_000_000_000;
    const cluster = clusterStories([
      {
        ...result("B10001", "player.floyd", "track.mario_circuit", 118_000, base),
        rankAtPublication: 4,
      },
      {
        ...result("B10002", "player.floyd", "track.mario_circuit", 117_000,
          base + 1_000),
        rankAtPublication: 3,
      },
    ])[0]!;
    expect(cluster.bestMs).toBe(117_000);
    expect(cluster.rankAtPublication).toBe(3);
  });

  it("serves public stories with reactions and honest improvements", async () => {
    const base = 1_700_000_000_000;
    const repository: ActivityStoryRepository = {
      async listRecentResults() {
        return [
          result("C00001", "player.floyd", "track.mario_circuit", 118_102,
            base),
          {
            ...result("C00002", "player.floyd", "track.mario_circuit", 116_331,
              base + 60_000),
            rankAtPublication: 1,
          },
          {
            ...result("C00003", "player.ben", "track.big_blue", 87_022,
              base + 30_000),
            laps: [
              { lapNumber: 1, timeMs: 29_000, coinsCollected: 10 },
              { lapNumber: 2, timeMs: 29_000, coinsCollected: 8 },
              { lapNumber: 3, timeMs: 29_022 },
            ],
            loadout: {
              characterId: "character.yoshi",
              bodyId: "body.mr_scooty",
              tireId: "tire.roller",
              gliderId: "glider.cloud_glider",
            },
          },
        ];
      },
      async listHumanBestsForCombos(combos) {
        return new Map(combos.map((combo) => [combo.key, [
          { playerId: "player.floyd", displayName: "Floyd", bestMs: 116_331 },
          { playerId: "player.ben", displayName: "Ben", bestMs: 116_900 },
        ]]));
      },
      async preStoryBests(targets) {
        return new Map(targets.map((target) => [target.key, 118_102]));
      },
      async reactionSummaries(resultIds) {
        return new Map(resultIds.map((id) => [
          id, { count: 2, kinds: ["fire"] },
        ]));
      },
    };
    const service = new ActivityStoryService(repository);
    const stories = await service.listStories();
    expect(stories).toHaveLength(2);
    const story = stories[0]!;
    expect(story.runs).toBe(2);
    expect(story.improvedMs).toBe(1_771);
    expect(story.personalBest).toBe(true);
    expect(story.personalBestDeltaMs).toBe(1_771);
    expect(story.playerDeltaMs).toBe(-1_771);
    expect(story.runRank).toBe(1);
    expect(story.rank?.after).toBe(1);
    expect(story.rank?.passed[0]?.displayName).toBe("Ben");
    expect(story.reactions).toEqual({ count: 4, kinds: ["fire"] });

    const detailed = (await service.listStories()).find(
      (entry) => entry.player.playerId === "player.ben",
    );
    expect(detailed?.runDetails[0]).toMatchObject({
      laps: [
        { lapNumber: 1, timeMs: 29_000, coinsCollected: 10 },
        { lapNumber: 2, timeMs: 29_000, coinsCollected: 8 },
        { lapNumber: 3, timeMs: 29_022 },
      ],
      loadout: {
        characterId: "character.yoshi",
        bodyId: "body.mr_scooty",
        tireId: "tire.roller",
        gliderId: "glider.cloud_glider",
      },
    });

    // The public route needs no session and returns the document.
    const app = await buildApp({
      identityRepository,
      home: {
        comeback: new HomeComebackService({
          async loadComeback() { return null; },
        }),
        rivals: new RivalPreferenceService({
          async listRivals() { return []; },
          async addRival() { return false; },
          async removeRival() {},
        }),
        follows: new FollowPreferenceService({
          async listRivals() { return []; },
          async addRival() { return false; },
          async removeRival() {},
        }),
        focus: new HomeFocusService({
          async loadFocusInput() { return null; },
        }),
        stories: service,
      },
      resolveActor: async () => ({ role: "anonymous" }),
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/public/activity-stories",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().schemaVersion).toBe("mk8dx.activity-stories.v1");
    expect(response.json().stories).toHaveLength(2);
    // Focus and follows refuse anonymous actors (privacy: the follow
    // list is never publicly readable).
    expect((await app.inject({ method: "GET", url: "/v1/home/focus" }))
      .statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/account/follows" }))
      .statusCode).toBe(401);
    await app.close();
  });

  it("keeps standings, personal references and reactions batched for 200 results", async () => {
    const calls = { standings: 0, previous: 0, reactions: 0 };
    let previousTargets = 0;
    const base = 1_700_000_000_000;
    const repository: ActivityStoryRepository = {
      async listRecentResults() {
        return Array.from({ length: 200 }, (_, index) => result(
          `P${String(index).padStart(5, "0")}`,
          `player.batch_${index}`,
          index % 2 === 0 ? "track.mario_circuit" : "track.big_blue",
          100_000 + index,
          base + index,
          index % 3 === 0 ? 200 : 150,
        ));
      },
      async listHumanBestsForCombos(combos) {
        calls.standings += 1;
        return new Map(combos.map((combo) => [combo.key, []]));
      },
      async preStoryBests(targets) {
        calls.previous += 1;
        previousTargets = targets.length;
        return new Map();
      },
      async reactionSummaries() {
        calls.reactions += 1;
        return new Map();
      },
    };

    const stories = await new ActivityStoryService(repository).listStories();

    expect(stories).toHaveLength(30);
    expect(previousTargets).toBe(30);
    expect(calls).toEqual({ standings: 1, previous: 1, reactions: 1 });
  });

  it("manages the private follow list separately from rivals", async () => {
    const follows = new Map<string, RivalPreference>();
    const followRepository: RivalPreferenceRepository = {
      async listRivals() { return [...follows.values()]; },
      async addRival(_account, playerId) {
        if (playerId === "player.ghost") { return false; }
        follows.set(playerId, {
          playerId,
          displayName: playerId.replace("player.", ""),
        });
        return true;
      },
      async removeRival(_account, playerId) { follows.delete(playerId); },
    };
    const app = await buildApp({
      identityRepository,
      home: {
        comeback: new HomeComebackService({
          async loadComeback() { return null; },
        }),
        rivals: new RivalPreferenceService({
          async listRivals() { return []; },
          async addRival() { return false; },
          async removeRival() {},
        }),
        follows: new FollowPreferenceService(followRepository),
        focus: new HomeFocusService({
          async loadFocusInput() { return null; },
        }),
        stories: { async listStories() { return []; } },
      },
      resolveActor: async () => (
        { role: "account", userAccountId: "user_account.synthetic" }
      ),
    });
    const add = await app.inject({
      method: "PUT",
      url: "/v1/account/follows",
      payload: { playerId: "player.leonora" },
    });
    expect(add.statusCode).toBe(200);
    const list = await app.inject({
      method: "GET",
      url: "/v1/account/follows",
    });
    expect(list.json().follows).toEqual([
      { playerId: "player.leonora", displayName: "leonora" },
    ]);
    const unknown = await app.inject({
      method: "PUT",
      url: "/v1/account/follows",
      payload: { playerId: "player.ghost" },
    });
    expect(unknown.statusCode).toBe(404);
    const remove = await app.inject({
      method: "DELETE",
      url: "/v1/account/follows",
      payload: { playerId: "player.leonora" },
    });
    expect(remove.statusCode).toBe(200);
    expect(follows.size).toBe(0);
    await app.close();
    });
  });

  it("keeps a non-PB story's comparison with the Player's prior best", async () => {
    const atMs = 1_700_000_000_000;
    const repository: ActivityStoryRepository = {
      async listRecentResults() {
        return [result("SELF01", "player.ben", "track.big_blue", 102_000, atMs)];
      },
      async listHumanBestsForCombos(combos) {
        return new Map(combos.map((combo) => [combo.key, [
          { playerId: "player.ben", displayName: "Ben", bestMs: 100_000 },
        ]]));
      },
      async preStoryBests(targets) {
        return new Map(targets.map((target) => [target.key, 100_000]));
      },
      async reactionSummaries() { return new Map(); },
    };
    const story = (await new ActivityStoryService(repository).listStories())[0]!;
    expect(story.personalBest).toBe(false);
    expect(story.personalBestDeltaMs).toBeUndefined();
    expect(story.playerDeltaMs).toBe(2_000);
  });
