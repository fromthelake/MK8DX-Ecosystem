import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ActivityStoryService } from
  "../src/home/activity-story-service.js";
import {
  FollowPreferenceService,
  HomeComebackService,
  MEANINGFUL_VISIT_MS,
  RivalPreferenceService,
  snapshotDecision,
  type HomeComeback,
  type HomeComebackRepository,
  type RivalPreference,
  type RivalPreferenceRepository,
} from "../src/home/home-comeback-service.js";
import { HomeFocusService } from "../src/home/home-focus-service.js";
import type {
  ActorContext,
  IdentityReadRepository,
} from "../src/identity/types.js";

const identityRepository: IdentityReadRepository = {
  async findPublicPlayerById() { return null; },
  async findUserAccountSummaryById() { return null; },
  async findPlayerClaimSummaryById() { return null; },
};

const emptyListRepository: RivalPreferenceRepository = {
  async listRivals() { return []; },
  async addRival() { return true; },
  async removeRival() {},
};

const homeExtras = {
  follows: new FollowPreferenceService(emptyListRepository),
  focus: new HomeFocusService({
    async loadFocusInput() {
      return {
        modePreference: "all" as const,
        trackAccess: "unknown" as const,
        rows: [],
      };
    },
  }),
  stories: {
    async listStories() { return []; },
  } as Pick<ActivityStoryService, "listStories">,
};

const comeback: HomeComeback = {
  player: { playerId: "player.ben", displayName: "Ben" },
  tournament: { rank: 4, of: 61, score: 27.15 },
  timeTrials: { standing: 2, of: 12, totalMs: 11580277, previousStanding: 3 },
  rivals: [{
    playerId: "player.floyd",
    displayName: "Floyd",
    tracksAhead: 77,
    tracksBehind: 19,
    sharedCombos: 96,
    totalDeltaMs: 83482,
    previous: {
      tracksAhead: 74,
      tracksBehind: 22,
      sharedCombos: 96,
      totalDeltaMs: 79264,
    },
  }],
  reactions: { count: 5, resultCount: 3, kinds: ["fire", "laugh"] },
  sinceMs: 1_900_000_000_000,
};

describe("home comeback product", () => {
  it("keeps the baseline stable within the meaningful-visit window", () => {
    // First ever visit: record state, no rotation.
    expect(snapshotDecision(null, 1_000)).toEqual(
      { rotate: false, writeInitial: true },
    );
    // A refresh minutes later must NOT rotate (comeback survives).
    expect(snapshotDecision(1_000, 1_000 + 5 * 60_000)).toEqual(
      { rotate: false, writeInitial: false },
    );
    // A visit after the window is a meaningful visit: rotate.
    expect(snapshotDecision(1_000, 1_000 + MEANINGFUL_VISIT_MS)).toEqual(
      { rotate: true, writeInitial: false },
    );
  });

  it("serves the comeback document to the signed-in account", async () => {
    const repository: HomeComebackRepository = {
      async loadComeback(userAccountId) {
        return userAccountId === "user_account.synthetic" ? comeback : null;
      },
    };
    const rivals: RivalPreferenceRepository = {
      async listRivals() { return []; },
      async addRival() { return true; },
      async removeRival() {},
    };
    const appFor = (actor: ActorContext): ReturnType<typeof buildApp> =>
      buildApp({
        identityRepository,
        home: {
          comeback: new HomeComebackService(repository),
          rivals: new RivalPreferenceService(rivals),
          ...homeExtras,
        },
        resolveActor: async () => actor,
      });

    const signedIn = await appFor(
      { role: "account", userAccountId: "user_account.synthetic" },
    );
    const response = await signedIn.inject({
      method: "GET",
      url: "/v1/home/comeback",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.schemaVersion).toBe("mk8dx.home-comeback.v1");
    expect(body.timeTrials.standing).toBe(2);
    expect(body.rivals[0].previous.tracksAhead).toBe(74);
    expect(body.reactions.count).toBe(5);
    await signedIn.close();

    const anonymous = await appFor({ role: "anonymous" });
    const refused = await anonymous.inject({
      method: "GET",
      url: "/v1/home/comeback",
    });
    expect(refused.statusCode).toBe(401);
    await anonymous.close();

    const unclaimed = await appFor(
      { role: "account", userAccountId: "user_account.other" },
    );
    const noPlayer = await unclaimed.inject({
      method: "GET",
      url: "/v1/home/comeback",
    });
    expect(noPlayer.statusCode).toBe(409);
    await unclaimed.close();
  });

  it("manages rival preferences with a bounded private list", async () => {
    const stored = new Map<string, RivalPreference>();
    const repository: RivalPreferenceRepository = {
      async listRivals() { return [...stored.values()]; },
      async addRival(_account, rivalPlayerId) {
        if (rivalPlayerId === "player.ghost") { return false; }
        stored.set(rivalPlayerId, {
          playerId: rivalPlayerId,
          displayName: rivalPlayerId.replace("player.", ""),
        });
        return true;
      },
      async removeRival(_account, rivalPlayerId) {
        stored.delete(rivalPlayerId);
      },
    };
    const app = await buildApp({
      identityRepository,
      home: {
        comeback: new HomeComebackService({
          async loadComeback() { return comeback; },
        }),
        rivals: new RivalPreferenceService(repository),
        ...homeExtras,
      },
      resolveActor: async () => (
        { role: "account", userAccountId: "user_account.synthetic" }
      ),
    });

    const add = await app.inject({
      method: "PUT",
      url: "/v1/account/rivals",
      payload: { rivalPlayerId: "player.floyd" },
    });
    expect(add.statusCode).toBe(200);
    const list = await app.inject({ method: "GET", url: "/v1/account/rivals" });
    expect(list.json().rivals).toEqual([
      { playerId: "player.floyd", displayName: "floyd" },
    ]);
    const unknown = await app.inject({
      method: "PUT",
      url: "/v1/account/rivals",
      payload: { rivalPlayerId: "player.ghost" },
    });
    expect(unknown.statusCode).toBe(404);
    const remove = await app.inject({
      method: "DELETE",
      url: "/v1/account/rivals",
      payload: { rivalPlayerId: "player.floyd" },
    });
    expect(remove.statusCode).toBe(200);
    expect(stored.size).toBe(0);
    await app.close();
  });
});
