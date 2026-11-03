import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { buildApp } from "../src/app.js";
import type { IdentityReadRepository } from "../src/identity/types.js";
import {
  ClaimReviewReadService,
  type AccountClaimWalkItem,
  type ClaimReviewer,
  type ClaimReviewQueue,
  type ClaimReviewReadRepository,
} from "../src/profiles/claim-review-read-service.js";

const accountId = "user_account.synthetic_claim_walk_01";
const directorId = "user_account.synthetic_claim_walk_director";
const player = { playerId: "player.synthetic_mal", username: "mal", displayName: "Mal" };
const otherPlayer = { playerId: "player.synthetic_mal_tt", username: "mal_tt", displayName: "Mal" };

const walk: AccountClaimWalkItem = {
  playerClaimId: "player_claim.synthetic_walk_01",
  player,
  claimStatus: "under_review",
  disputeStatus: "none",
  requestedAtMs: 1_790_000_000_000,
  updatedAtMs: 1_790_000_100_000,
  reviewerDirectorNames: ["Evan"],
  lastDecision: null,
  notes: [
    { role: "requester", kind: "request", body: "I played TN12", authorName: null, createdAtMs: 1_790_000_000_000 },
    { role: "reviewer", kind: "question", body: "Which character?", authorName: "Evan", createdAtMs: 1_790_000_100_000 },
  ],
};

class Repository implements ClaimReviewReadRepository {
  public reviewers: ClaimReviewer[] = [];
  async listClaimWalkForAccount(requested: string) {
    return requested === accountId ? [walk] : [];
  }
  async listReviewQueue(reviewer: ClaimReviewer): Promise<ClaimReviewQueue> {
    this.reviewers.push(reviewer);
    return {
      open: [{
        playerClaimId: walk.playerClaimId,
        claimStatus: "under_review",
        disputeStatus: "none",
        requestedAtMs: walk.requestedAtMs,
        updatedAtMs: walk.updatedAtMs,
        reviewerRole: reviewer.administrator ? "administrator" : "director",
        requester: { userAccountId: accountId, accountCreatedAtMs: 1_780_000_000_000, verifiedPlayers: [otherPlayer] },
        player: {
          ...player,
          tournamentNights: 3,
          lastNightName: "TN12",
          lastNightDate: "2026-09-12",
          directorNames: ["Evan"],
          conservativeRating: 21.5,
          publishedTimeTrials: 0,
          otherOpenClaims: 0,
        },
        conflicts: { playerAlreadyLinked: false, sharedTournament: null },
        notes: walk.notes,
      }],
      linked: [{
        playerClaimId: "player_claim.synthetic_linked_01",
        player: otherPlayer,
        accountPlayers: [],
        linkedAtMs: 1_785_000_000_000,
        reviewerRole: reviewer.administrator ? "administrator" : "director",
      }],
    };
  }
}

const identityRepository: IdentityReadRepository = {
  async findPublicPlayerById() { return null; },
  async findUserAccountSummaryById() { return null; },
  async findPlayerClaimSummaryById() { return null; },
};
const apps: FastifyInstance[] = [];

async function mounted(repository: Repository) {
  const app = await buildApp({
    identityRepository,
    resolveActor: async (request: FastifyRequest) =>
      request.headers.authorization === "Synthetic account"
        ? { role: "account" as const, userAccountId: accountId }
        : request.headers.authorization === "Synthetic director"
          ? { role: "account" as const, userAccountId: directorId }
          : request.headers.authorization === "Synthetic administrator"
            ? { role: "administrator" as const, userAccountId: directorId }
            : { role: "anonymous" as const },
    claimReviews: { service: new ClaimReviewReadService(repository) },
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("claim walk reads (ADR-0216)", () => {
  it("gives the person asking their claims with the conversation", async () => {
    const app = await mounted(new Repository());
    const anonymous = await app.inject({ method: "GET", url: "/v1/me/player-claim-walk" });
    expect(anonymous.statusCode).toBe(401);
    const response = await app.inject({
      method: "GET",
      url: "/v1/me/player-claim-walk",
      headers: { authorization: "Synthetic account" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ schemaVersion: "mk8dx.account-player-claim-walk.v1", claims: [walk] });
  });

  it("serves the review cards to administrators and Directors in their own role", async () => {
    const repository = new Repository();
    const app = await mounted(repository);
    for (const [authorization, role] of [
      ["Synthetic director", "director"],
      ["Synthetic administrator", "administrator"],
    ] as const) {
      const response = await app.inject({ method: "GET", url: "/v1/player-claim-reviews", headers: { authorization } });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { schemaVersion: string; open: { reviewerRole: string; player: { tournamentNights: number } }[]; linked: unknown[] };
      expect(body.schemaVersion).toBe("mk8dx.player-claim-review-queue.v1");
      expect(body.open[0]?.reviewerRole).toBe(role);
      expect(body.open[0]?.player.tournamentNights).toBe(3);
      expect(body.linked).toHaveLength(1);
    }
    expect(repository.reviewers).toEqual([
      { userAccountId: directorId, administrator: false },
      { userAccountId: directorId, administrator: true },
    ]);
    const anonymous = await app.inject({ method: "GET", url: "/v1/player-claim-reviews" });
    expect(anonymous.statusCode).toBe(401);
  });

  it("hides a broken repository behind a fixed answer", async () => {
    const repository = new Repository();
    repository.listReviewQueue = async () => { throw new Error("private SQL detail"); };
    const app = await mounted(repository);
    const response = await app.inject({
      method: "GET",
      url: "/v1/player-claim-reviews",
      headers: { authorization: "Synthetic administrator" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("private");
  });
});
