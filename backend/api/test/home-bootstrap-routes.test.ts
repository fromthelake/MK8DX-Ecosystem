// The bootstrap answers in one request what several routes answer
// individually. Its whole design rests on each section being *the same
// document* that its own route serves, so that is what these tests
// assert: not a hand-written expectation, which would drift with the
// routes, but the routes themselves.
//
// Three sections once shipped with a shape their schema rejected - the
// rating ladder sends ranked entries rather than raw ratings, and neither
// the history nor the opponents document carries a playerId - and the
// whole response failed to serialise in silence. A comparison against the
// real routes catches that class of mistake immediately - verified by
// reintroducing it, which fails two of these tests.
//
// One limit worth knowing: the serialiser strips properties a schema does
// not declare rather than rejecting them, so these tests catch a missing
// or wrongly named field but not an extra one.

import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import type {
  ActorContext,
  IdentityReadRepository,
} from "../src/identity/types.js";

const OWN = "player.ben";
const VIEWED = "player.matteo";

const player = {
  playerId: OWN,
  username: { value: "ben" },
  displayName: "Ben",
};
const viewedPlayer = {
  playerId: VIEWED,
  username: { value: "matteo" },
  displayName: "Matteo",
};

const identityRepository: IdentityReadRepository = {
  async findPublicPlayerById(playerId: string) {
    if (playerId === OWN) { return player; }
    if (playerId === VIEWED) { return viewedPlayer; }
    return null;
  },
  async findUserAccountSummaryById() { return null; },
  async findPlayerClaimSummaryById() { return null; },
};

const story = {
  player: { playerId: OWN, displayName: "Ben" },
  trackId: "track.mario_kart_stadium",
  mode: 150 as const,
  runs: 1,
  startMs: 92_000,
  bestMs: 91_234,
  personalBest: true,
  latestAtMs: 1_900_000_000_000,
  runDetails: [
    {
      resultId: "user_submission.time.STORYRESULT01",
      timeMs: 91_234,
      atMs: 1_900_000_000_000,
      sourceKind: "android_scan",
    },
  ],
};

const comeback = {
  player: { playerId: OWN, displayName: "Ben" },
  timeTrials: { standing: 3, of: 8, totalMs: 9_000_000 },
  rivals: [{
    playerId: VIEWED,
    displayName: "Matteo",
    tracksAhead: 4,
    tracksBehind: 2,
    sharedCombos: 6,
    totalDeltaMs: 1_500,
  }],
};

const account: ActorContext = { role: "account", userAccountId: "account.1" };

// Every dependency the bootstrap and the individual routes share, so the
// two answer from exactly the same data.
function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    identityRepository,
    resolveActor: async (): Promise<ActorContext> => account,
    home: {
      comeback: { async loadMine() { return comeback; } },
      rivals: {
        async listMine() { return [{ playerId: VIEWED, displayName: "Matteo" }]; },
        async add() {}, async remove() {},
      },
      follows: {
        async listMine() { return [{ playerId: VIEWED, displayName: "Matteo" }]; },
        async add() {}, async remove() {},
      },
      focus: {
        async loadMine() {
          return { modePreference: "all" as const, trackAccess: "base_and_bcp" as const, rows: [{
            trackId: "track.mario_kart_stadium", mode: 150 as const,
            myBestMs: 91_234, myRank: 1, humanCount: 2, leaderBestMs: 91_234,
          }] };
        },
      },
      stories: { async listStories() { return [story]; } },
    },
    notifications: {
      service: {
        async listMine() { return { unreadCount: 2, notifications: [] }; },
        async markRead() {},
        async listEvents() { return []; },
      },
    },
    playerClaimProduct: {
      service: {
        async search() { return []; },
        async searchPublic() { return []; },
        async list() { return []; },
        async listLinkedPlayerAccounts() { return []; },
        async listMine() {
          return [{
            playerClaimId: "player_claim.ben",
            playerId: OWN,
            playerUsername: "ben",
            playerDisplayName: "Ben",
            claimStatus: "verified" as const,
            disputeStatus: "none" as const,
            updatedAtMs: 1_900_000_000_000,
          }];
        },
        async listReviewQueue() { return []; },
      },
    },
    publicTimeTrials: {
      service: {
        async listPlayerTrackBests() { return []; },
        async listStandings() { return []; },
        async listTrackBestsForPlayers(ids: readonly string[]) {
          return new Map(ids.map((id) => [id, [{
            trackId: "track.mario_kart_stadium", mode: 150 as const,
            totalTimeMs: 91_234, rank: 1,
          }]]));
        },
        async listRecentResults() { return []; },
        async listLeaderboard() { return []; },
        async listPlayerResults() { return []; },
      },
    },
    reactions: {
      service: {
        async summarize() {
          return [{
            resultId: "user_submission.time.STORYRESULT01",
            counts: {},
          }];
        },
        async react() {}, async remove() {},
      },
    },
    publicRatings: {
      repository: {
        async listRatings() {
          return [{
            playerId: OWN, username: "ben", displayName: "Ben",
            mu: 30, sigma: 2, updatedAtMs: 1_900_000_000_000,
          }];
        },
      },
      history: {
        async listRatingHistory() { return []; },
        async listOpponents() { return []; },
        async listTournamentStandings() { return []; },
        async headToHead() { return null; },
      },
    },
    publicCareer: {
      service: {
        async loadCareer() {
          return {
            playerId: VIEWED,
            timeTrials: {
              published: 0, published150: 0, published200: 0,
              tracks150: 0, tracks200: 0,
              firsts: 0, firsts150: 0, firsts200: 0,
              podiums: 0, podiums150: 0, podiums200: 0,
            },
          };
        },
      },
    },
    aliasRepository: {
      async listPublicAliasesByPlayerId() { return []; },
      async findPublicAliasById() { return null; },
    },
    ...overrides,
  } satisfies Parameters<typeof buildApp>[0];
}

const apps: FastifyInstance[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

async function bootstrap(
  app: FastifyInstance,
  query = "",
): Promise<Record<string, unknown>> {
  const response = await app.inject({
    method: "GET", url: `/v1/bootstrap${query}`,
  });
  // The body carries the reason a section failed to serialise; without it
  // a failure here is just a number.
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as Record<string, unknown>;
}

async function route(
  app: FastifyInstance,
  url: string,
): Promise<unknown> {
  const response = await app.inject({ method: "GET", url });
  expect(response.statusCode).toBe(200);
  return response.json();
}

describe("page bootstrap", () => {
  it("serves each Home section as the document its own route serves", async () => {
    const app = await buildApp(dependencies());
    apps.push(app);
    const body = await bootstrap(app);

    expect(body["schemaVersion"]).toBe("mk8dx.home-bootstrap.v1");
    expect(body["authenticated"]).toBe(true);

    for (const [section, url] of [
      ["notifications", "/v1/notifications"],
      ["claims", "/v1/me/player-claims"],
      ["comeback", "/v1/home/comeback"],
      ["focus", "/v1/home/focus"],
      ["follows", "/v1/account/follows"],
      ["rivals", "/v1/account/rivals"],
      ["stories", "/v1/public/activity-stories"],
    ] as const) {
      expect(body[section], `section ${section}`)
        .toEqual(await route(app, url));
    }

    // Fetched by id rather than at a fixed path, so compared separately.
    expect(body["player"]).toEqual(await route(app, `/v1/players/${OWN}`));
    expect(body["trackBests"]).toEqual(await route(
      app, `/v1/public/track-bests?players=${OWN},${VIEWED}`));
    expect(body["reactions"]).toEqual(await route(
      app,
      "/v1/public/time-trial-reactions" +
      "?resultIds=user_submission.time.STORYRESULT01",
    ));
  });

  it("serves each profile section as the document its own route serves", async () => {
    const app = await buildApp(dependencies());
    apps.push(app);
    const body = await bootstrap(app, `?player=${VIEWED}`);

    expect(body["profile"]).toEqual(await route(app, `/v1/players/${VIEWED}`));
    for (const [section, url] of [
      ["ratingLeaderboard", "/v1/public/rating-leaderboard"],
      ["tournamentStandings", "/v1/public/tournament-standings"],
      ["ratingHistory", `/v1/public/players/${VIEWED}/rating-history`],
      ["opponents", `/v1/public/players/${VIEWED}/tournament-opponents`],
      ["career", `/v1/public/players/${VIEWED}/career`],
      ["aliases", `/v1/players/${VIEWED}/aliases`],
    ] as const) {
      expect(body[section], `section ${section}`)
        .toEqual(await route(app, url));
    }
  });

  it("does not compute Home sections for a profile view", async () => {
    const app = await buildApp(dependencies());
    apps.push(app);
    const body = await bootstrap(app, `?player=${VIEWED}`);
    for (const section of
      ["comeback", "focus", "trackBests", "follows", "rivals", "stories"]) {
      expect(body[section], `section ${section}`).toBeUndefined();
    }
  });

  it("projects canonical overtake evidence into signed-in Community relevance", async () => {
    const defaults = dependencies();
    const floydStory = {
      ...story,
      player: { playerId: "player.floyd", displayName: "Floyd" },
      trackId: "track.mario_circuit",
      bestMs: 116_331,
      startMs: 116_900,
      runDetails: [{
        resultId: "user_submission.time.FLOYD01", timeMs: 116_331,
        atMs: story.latestAtMs, sourceKind: "web_manual",
      }],
    };
    const app = await buildApp(dependencies({
      home: {
        ...defaults.home,
        stories: { async listStories() { return [floydStory]; } },
      },
      notifications: {
        service: {
          async listMine() {
            return { unreadCount: 1, notifications: [{
              notificationId: "41", kind: "overtaken" as const,
              actorPlayerId: "player.floyd", actorDisplayName: "Floyd",
              trackId: "track.mario_circuit", mode: 150 as const,
              actorTimeMs: 116_331, recipientTimeMs: 116_942,
              deltaMs: -611, recipientRank: 4, count: 1,
              lastEventAtMs: story.latestAtMs, read: false,
            }] };
          },
          async markRead() {},
          async listEvents() { return []; },
        },
      },
    }));
    apps.push(app);
    const body = await bootstrap(app);
    const stories = (body["stories"] as { stories: readonly Record<string, unknown>[] }).stories;
    expect(stories[0]?.["viewerOvertake"]).toEqual({
      notificationId: "41", actorTimeMs: 116_331,
      recipientTimeMs: 116_942, deltaMs: -611, recipientRank: 4,
    });
    // The public activity route never receives a personal notification proof.
    const publicStories = await route(app, "/v1/public/activity-stories") as { stories: readonly Record<string, unknown>[] };
    expect(publicStories.stories[0]?.["viewerOvertake"]).toBeUndefined();
  });

  it("leaves a failing section out instead of losing the page", async () => {
    const app = await buildApp(dependencies({
      home: {
        ...dependencies().home,
        comeback: {
          async loadMine(): Promise<never> {
            throw new Error("comeback unavailable");
          },
        },
      },
    }));
    apps.push(app);
    const body = await bootstrap(app);
    expect(body["comeback"]).toBeUndefined();
    // trackBests depends on comeback, so it goes too - but nothing else.
    expect(body["trackBests"]).toBeUndefined();
    expect(body["rivals"]).toBeUndefined();
    expect(body["focus"]).toBeDefined();
    expect(body["stories"]).toBeDefined();
    expect(body["notifications"]).toBeDefined();
  });

  it("answers a signed-out visitor with the public sections only", async () => {
    const app = await buildApp(dependencies({
      resolveActor: async (): Promise<ActorContext> => ({ role: "anonymous" }),
    }));
    apps.push(app);
    const body = await bootstrap(app);
    expect(body["authenticated"]).toBe(false);
    expect(body["stories"]).toBeDefined();
    for (const section of ["notifications", "claims", "comeback", "focus", "rivals"]) {
      expect(body[section], `section ${section}`).toBeUndefined();
    }
  });

  it("carries the World Record times Mastery is computed from, only when complete", async () => {
    const tracks = [...new Set(Array.from({ length: 96 }, (_, index) => `track.synthetic_${index}`))];
    const records = tracks.flatMap((trackId) => [150, 200].map((mode) => ({
      mode, trackId, trackName: trackId, totalTimeMs: 90_000, playerName: "WR", sourceUrl: "https://example.test",
      lapTimesMs: [], coinsPerLap: [], mushroomsPerLap: [], holders: [],
    })));
    const complete = await buildApp(dependencies({
      resolveActor: async (): Promise<ActorContext> => ({ role: "anonymous" }),
      worldRecords: { service: { async list() { return records as never; } } },
    }));
    apps.push(complete);
    const body = await bootstrap(complete);
    const times = body["worldRecordTimes"] as Readonly<{ schemaVersion: string; records: readonly Record<string, unknown>[] }>;
    expect(times.schemaVersion).toBe("mk8dx.world-record-times.v1");
    expect(times.records).toHaveLength(192);
    expect(Object.keys(times.records[0]!).sort()).toEqual(["mode", "totalTimeMs", "trackId"]);
    const partial = await buildApp(dependencies({
      worldRecords: { service: { async list() { return records.slice(0, 10) as never; } } },
    }));
    apps.push(partial);
    expect((await bootstrap(partial))["worldRecordTimes"]).toBeUndefined();
  });

  it("refuses a malformed Player id", async () => {
    const app = await buildApp(dependencies());
    apps.push(app);
    const response = await app.inject({
      method: "GET", url: "/v1/bootstrap?player=not-a-player-id",
    });
    expect(response.statusCode).toBe(400);
  });
});
