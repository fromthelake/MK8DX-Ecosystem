// ADR-0219: finding yourself at sign-up, with the public context that tells
// namesakes apart, sorted by the two answers.

import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { buildApp } from "../src/app.js";
import type { IdentityReadRepository } from "../src/identity/types.js";
import {
  claimNameMatch,
  EMPTY_CLAIM_CANDIDATE_CONTEXT,
  matchClaimPlayers,
  matchesClaimAnswers,
  rankClaimCandidates,
  type ClaimCandidateContext,
  type NamedClaimPlayer,
} from "../src/profiles/claim-candidates.js";
import { ClaimCandidateService, type ClaimCandidateRepository } from "../src/profiles/claim-candidate-service.js";
import {
  canonicalNightKey,
  historyEditionNight,
  lastPlayerNight,
  playerNightDirectorNames,
  PlayerNightLedger,
} from "../src/tournaments/player-nights.js";

const malTimeTrials: NamedClaimPlayer = {
  internalId: 1, playerId: "player.synthetic_mal_tt", username: "mal_tt", displayName: "Mal", aliases: [],
};
const malNights: NamedClaimPlayer = {
  internalId: 2, playerId: "player.synthetic_mal", username: "mal", displayName: "Mal", aliases: ["Malie"],
};
const malo: NamedClaimPlayer = {
  internalId: 3, playerId: "player.synthetic_malo", username: "malo", displayName: "Malo", aliases: [],
};
const nova: NamedClaimPlayer = {
  internalId: 4, playerId: "player.synthetic_nova", username: "nova", displayName: "Nova", aliases: ["Lamal"],
};
const kana: NamedClaimPlayer = {
  internalId: 5, playerId: "player.synthetic_kana", username: "kana", displayName: "かな", aliases: [],
};
const players = [malTimeTrials, malNights, malo, nova, kana];

const timeTrialContext: ClaimCandidateContext = {
  claimed: false,
  timeTrials: { times: 42, lastAt: "2026-10-30", classes: [150, 200] },
  tournaments: { nights: 0, directorNames: [], lastNight: null },
};
const nightContext: ClaimCandidateContext = {
  claimed: true,
  timeTrials: { times: 0, lastAt: null, classes: [] },
  tournaments: { nights: 7, directorNames: ["Ben", "Evan"], lastNight: { name: "TN13", date: "2026-10-04" } },
};
const contexts = new Map<number, ClaimCandidateContext>([[1, timeTrialContext], [2, nightContext]]);

describe("claim candidate matching (ADR-0219)", () => {
  it("matches display name, username and public aliases, exact before prefix before partial", () => {
    expect(claimNameMatch(malNights, "mal")).toBe("exact");
    expect(claimNameMatch(malNights, "MALIE")).toBe("exact");
    expect(claimNameMatch(malo, "Mal")).toBe("prefix");
    expect(claimNameMatch(nova, "mal")).toBe("partial");
    expect(claimNameMatch(nova, "zz")).toBeNull();
    expect(matchClaimPlayers(players, "mal").map((entry) => entry.player.playerId)).toEqual([
      "player.synthetic_mal", "player.synthetic_mal_tt", "player.synthetic_malo", "player.synthetic_nova",
    ]);
  });

  it("still finds a name written in another script", () => {
    expect(matchClaimPlayers(players, "かな").map((entry) => entry.player.username)).toEqual(["kana"]);
  });

  it("puts the Players who fit the answers first and says which ones do", () => {
    const matched = matchClaimPlayers(players, "mal");
    const timeTrialsOnly = rankClaimCandidates(matched, contexts, { timeTrials: true, tournaments: false });
    expect(timeTrialsOnly.map((candidate) => [candidate.username, candidate.matchesAnswers])).toEqual([
      ["mal_tt", true], ["mal", false], ["malo", false], ["nova", false],
    ]);
    const tournamentsOnly = rankClaimCandidates(matched, contexts, { timeTrials: false, tournaments: true });
    expect(tournamentsOnly.map((candidate) => candidate.username).slice(0, 2)).toEqual(["mal", "mal_tt"]);
    expect(tournamentsOnly[0]).toEqual({
      playerId: "player.synthetic_mal", username: "mal", displayName: "Mal", aliases: ["Malie"],
      claimed: true, matchesAnswers: true,
      timeTrials: { times: 0, lastAt: null, classes: [] },
      tournaments: { nights: 7, directorNames: ["Ben", "Evan"], lastNight: { name: "TN13", date: "2026-10-04" } },
    });
    const both = rankClaimCandidates(matched, contexts, { timeTrials: true, tournaments: true });
    expect(both.filter((candidate) => candidate.matchesAnswers).map((candidate) => candidate.username))
      .toEqual(["mal_tt", "mal"]);
  });

  it("treats no yes as everyone fitting, and an empty context as fitting nothing", () => {
    expect(matchesClaimAnswers(EMPTY_CLAIM_CANDIDATE_CONTEXT, { timeTrials: false, tournaments: false })).toBe(true);
    expect(matchesClaimAnswers(EMPTY_CLAIM_CANDIDATE_CONTEXT, { timeTrials: true, tournaments: true })).toBe(false);
  });
});

describe("player nights (shared with ADR-0218)", () => {
  it("counts one edition once, preferring the canonical night, and names its Directors", () => {
    const ledger = new PlayerNightLedger();
    ledger.add(9, historyEditionNight(12));
    ledger.add(9, { key: canonicalNightKey(5, 12), name: "TN12", date: "2026-09-12", at: 10, director: 70 });
    ledger.add(9, { key: canonicalNightKey(6, null), name: "Club night", date: "2026-10-01", at: 20, director: 71 });
    ledger.add(9, historyEditionNight(4));
    const nights = ledger.of(9);
    expect(nights).toHaveLength(3);
    expect(lastPlayerNight(nights)?.name).toBe("Club night");
    expect(playerNightDirectorNames(nights, new Map([[70, "Ben"], [71, "Evan"]]))).toEqual(["Ben", "Evan"]);
    expect(ledger.of(10)).toEqual([]);
  });
});

class Repository implements ClaimCandidateRepository {
  public loaded: number[][] = [];
  public broken = false;
  async listNamedPlayers() {
    if (this.broken) { throw new Error("database down"); }
    return players;
  }
  async loadContexts(ids: readonly number[]) {
    this.loaded.push([...ids]);
    return contexts;
  }
}

const identityRepository: IdentityReadRepository = {
  async findPublicPlayerById() { return null; },
  async findUserAccountSummaryById() { return null; },
  async findPlayerClaimSummaryById() { return null; },
};
const apps: FastifyInstance[] = [];
const accountId = "user_account.synthetic_claim_candidates";

async function mounted(repository: Repository) {
  const app = await buildApp({
    identityRepository,
    resolveActor: async (request: FastifyRequest) =>
      request.headers.cookie === "session=synthetic" || /^Bearer synthetic/u.test(request.headers.authorization ?? "")
        ? { role: "account" as const, userAccountId: accountId }
        : { role: "anonymous" as const },
    claimCandidates: {
      service: new ClaimCandidateService(repository),
      csrfVerifier: { verify: (_actor, token) => token === "proof" },
    },
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("claim candidate routes (ADR-0219)", () => {
  const body = { query: "mal", timeTrials: true, tournaments: false };

  it("answers a signed-in browser with the same-origin proof", async () => {
    const repository = new Repository();
    const app = await mounted(repository);
    const response = await app.inject({
      method: "POST", url: "/v1/me/claim-candidates", payload: body,
      headers: { cookie: "session=synthetic", "x-mk8dx-csrf": "proof" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const document = response.json() as { schemaVersion: string; candidates: { username: string; matchesAnswers: boolean }[] };
    expect(document.schemaVersion).toBe("mk8dx.claim-candidates.v1");
    expect(document.candidates.map((candidate) => candidate.username)).toEqual(["mal_tt", "mal", "malo", "nova"]);
    // Only the name matches get their context read.
    expect(repository.loaded).toEqual([[2, 1, 3, 4]]);
  });

  it("refuses without the proof, without a session and with a short query", async () => {
    const app = await mounted(new Repository());
    const noProof = await app.inject({
      method: "POST", url: "/v1/me/claim-candidates", payload: body, headers: { cookie: "session=synthetic", "x-mk8dx-csrf": "wrong" },
    });
    expect(noProof.statusCode).toBe(403);
    const anonymous = await app.inject({ method: "POST", url: "/v1/me/claim-candidates", payload: body, headers: { "x-mk8dx-csrf": "proof" } });
    expect(anonymous.statusCode).toBe(401);
    const short = await app.inject({
      method: "POST", url: "/v1/me/claim-candidates", payload: { ...body, query: "m" },
      headers: { cookie: "session=synthetic", "x-mk8dx-csrf": "proof" },
    });
    expect(short.statusCode).toBe(400);
    const blank = await app.inject({
      method: "POST", url: "/v1/me/claim-candidates", payload: { ...body, query: "   " },
      headers: { cookie: "session=synthetic", "x-mk8dx-csrf": "proof" },
    });
    expect(blank.statusCode).toBe(400);
  });

  it("answers the phone's bearer token on the native twin, and nothing else there", async () => {
    const app = await mounted(new Repository());
    const native = await app.inject({
      method: "POST", url: "/v1/native/claim-candidates", payload: { ...body, timeTrials: false, tournaments: true },
      headers: { authorization: "Bearer synthetic-native-token-0123456789" },
    });
    expect(native.statusCode).toBe(200);
    expect((native.json() as { candidates: { username: string }[] }).candidates[0]?.username).toBe("mal");
    const cookieOnly = await app.inject({
      method: "POST", url: "/v1/native/claim-candidates", payload: body, headers: { cookie: "session=synthetic" },
    });
    expect(cookieOnly.statusCode).toBe(403);
  });

  it("hides a broken repository behind a fixed answer", async () => {
    const repository = new Repository();
    repository.broken = true;
    const app = await mounted(repository);
    const response = await app.inject({
      method: "POST", url: "/v1/me/claim-candidates", payload: body,
      headers: { cookie: "session=synthetic", "x-mk8dx-csrf": "proof" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ code: "claim_product_unavailable", message: "Player claims are temporarily unavailable." });
  });
});
