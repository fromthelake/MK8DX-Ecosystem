import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { buildApp } from "../src/app.js";
import {
  ClaimLifecycleService,
  type AppendClaimEventInput,
  type ClaimIdGenerator,
  type ClaimSnapshot,
  type ClaimWriteRepository,
  type ClaimWriteTransaction,
  type Clock,
  type CreateClaimInput,
  type EvidenceAccessActor,
} from "../src/identity/claim-lifecycle-service.js";
import type {
  AccountStatus,
  ActorContext,
  IdentityReadRepository,
} from "../src/identity/types.js";

const playerId = "player.synthetic_http_claim_01";
const ownerAccountId = "user_account.synthetic_http_owner_01";
const otherAccountId = "user_account.synthetic_http_other_01";
const adminAccountId = "user_account.synthetic_http_admin_01";
const evidenceId = "restricted_evidence.synthetic_http_claim_01";

class NullIdentityReads implements IdentityReadRepository {
  async findPublicPlayerById(): Promise<null> {
    return null;
  }

  async findUserAccountSummaryById(): Promise<null> {
    return null;
  }

  async findPlayerClaimSummaryById(): Promise<null> {
    return null;
  }
}

class RouteTestStore implements ClaimWriteRepository, ClaimWriteTransaction {
  readonly claims = new Map<string, ClaimSnapshot>();
  readonly evidenceActors: EvidenceAccessActor[] = [];
  readonly accounts = new Map<string, AccountStatus>([
    [ownerAccountId, "active"],
    [otherAccountId, "active"],
    [adminAccountId, "active"],
  ]);
  transactionCount = 0;
  allowEvidence = true;

  async transaction<T>(
    work: (transaction: ClaimWriteTransaction) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1;
    return work(this);
  }

  async findHumanPlayerStatus(
    requestedPlayerId: string,
  ): Promise<"active" | null> {
    return requestedPlayerId === playerId ? "active" : null;
  }

  async findUserAccountStatus(
    userAccountId: string,
  ): Promise<AccountStatus | null> {
    return this.accounts.get(userAccountId) ?? null;
  }

  async findClaimForUpdate(playerClaimId: string): Promise<ClaimSnapshot | null> {
    return this.claims.get(playerClaimId) ?? null;
  }

  async isDirectorForPlayer(): Promise<boolean> {
    return false;
  }

  async addClaimNote(): Promise<void> {}

  async hasVerifiedClaimForPlayer(requestedPlayerId: string): Promise<boolean> {
    return [...this.claims.values()].some(
      (claim) => claim.playerId === requestedPlayerId && claim.claimStatus === "verified",
    );
  }

  async findTournamentSharedWithAccountPlayers(): Promise<string | null> {
    return null;
  }

  async canUseEvidenceReferences(
    actor: EvidenceAccessActor,
    evidenceIds: readonly string[],
  ): Promise<boolean> {
    this.evidenceActors.push(actor);
    return this.allowEvidence || evidenceIds.length === 0;
  }

  async createClaim(input: CreateClaimInput): Promise<void> {
    this.claims.set(input.snapshot.playerClaimId, input.snapshot);
  }

  async appendClaimEvent(input: AppendClaimEventInput): Promise<void> {
    const current = this.claims.get(input.playerClaimId);
    if (current?.revision !== input.expectedRevision) {
      throw new Error("synthetic revision conflict");
    }
    this.claims.set(input.playerClaimId, input.nextSnapshot);
  }
}

class RouteTestIds implements ClaimIdGenerator {
  private claimSequence = 0;
  private reviewSequence = 0;

  newPlayerClaimId(): string {
    this.claimSequence += 1;
    return `player_claim.synthetic_http_${this.claimSequence}`;
  }

  newRestrictedReviewId(): string {
    this.reviewSequence += 1;
    return `restricted_review.synthetic_http_${this.reviewSequence}`;
  }
}

class RouteTestClock implements Clock {
  private current = 1_900_000_000_000;

  nowMs(): number {
    this.current += 1;
    return this.current;
  }
}

async function resolveTestActor(request: FastifyRequest): Promise<ActorContext> {
  const role = request.headers["x-test-role"];
  const accountId = request.headers["x-test-account-id"];
  if (role === "administrator") {
    return { role: "administrator", userAccountId: adminAccountId };
  }
  if (role === "account" && typeof accountId === "string") {
    return { role: "account", userAccountId: accountId };
  }
  if (role === "migration_operator") {
    return { role: "migration_operator" };
  }
  return { role: "anonymous" };
}

const apps: FastifyInstance[] = [];

async function testApp() {
  const store = new RouteTestStore();
  const lifecycle = new ClaimLifecycleService(
    store,
    new RouteTestIds(),
    new RouteTestClock(),
  );
  const app = await buildApp({
    identityRepository: new NullIdentityReads(),
    resolveActor: resolveTestActor,
    claimLifecycle: lifecycle,
  });
  apps.push(app);
  return { app, store, lifecycle };
}

const accountHeaders = {
  "x-test-role": "account",
  "x-test-account-id": ownerAccountId,
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("claim mutation HTTP boundary", () => {
  it("creates a requested claim from the resolved account with a private DTO", async () => {
    const { app, store } = await testApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/player-claims",
      headers: accountHeaders,
      payload: { playerId, evidenceIds: [evidenceId] },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      playerClaimId: "player_claim.synthetic_http_1",
      playerId,
      userAccountId: ownerAccountId,
      claimStatus: "requested",
      disputeStatus: "none",
      revision: 1,
      lastSequence: 1,
    });
    expect(response.body).not.toContain("evidence");
    expect(response.body).not.toContain("review");
    expect(store.evidenceActors).toEqual([
      { actorType: "requesting_account", userAccountId: ownerAccountId },
    ]);
  });

  it("requires a fresh account-bound CSRF proof when hosted composition enables it", async () => {
    const store = new RouteTestStore();
    const lifecycle = new ClaimLifecycleService(
      store,
      new RouteTestIds(),
      new RouteTestClock(),
    );
    const app = await buildApp({
      identityRepository: new NullIdentityReads(),
      resolveActor: resolveTestActor,
      claimLifecycle: lifecycle,
      claimCsrfVerifier: {
        verify(actor, token) {
          return actor.role === "account" &&
            actor.userAccountId === ownerAccountId && token === "fresh-proof";
        },
      },
    });
    apps.push(app);

    const missing = await app.inject({
      method: "POST",
      url: "/v1/player-claims",
      headers: accountHeaders,
      payload: { playerId, evidenceIds: [] },
    });
    expect(missing.statusCode).toBe(403);
    expect(missing.json()).toEqual({
      code: "claim_csrf_invalid",
      message: "A fresh request proof is required.",
    });
    expect(store.transactionCount).toBe(0);

    const accepted = await app.inject({
      method: "POST",
      url: "/v1/player-claims",
      headers: { ...accountHeaders, "x-mk8dx-csrf": "fresh-proof" },
      payload: { playerId, evidenceIds: [] },
    });
    expect(accepted.statusCode).toBe(201);
    expect(store.transactionCount).toBe(1);
  });

  it("rejects anonymous creation and inaccessible evidence without leaking it", async () => {
    const anonymous = await testApp();
    const anonymousResponse = await anonymous.app.inject({
      method: "POST",
      url: "/v1/player-claims",
      payload: { playerId, evidenceIds: [evidenceId] },
    });
    expect(anonymousResponse.statusCode).toBe(403);
    expect(anonymous.store.transactionCount).toBe(0);

    const inaccessible = await testApp();
    inaccessible.store.allowEvidence = false;
    const evidenceResponse = await inaccessible.app.inject({
      method: "POST",
      url: "/v1/player-claims",
      headers: accountHeaders,
      payload: { playerId, evidenceIds: [evidenceId] },
    });
    expect(evidenceResponse.statusCode).toBe(403);
    expect(evidenceResponse.body).not.toContain(evidenceId);
  });

  it.each([
    { playerId, evidenceIds: [evidenceId, evidenceId] },
    { playerId, evidenceIds: [], unexpected: "private" },
    { playerId: ownerAccountId, evidenceIds: [] },
    {
      playerId,
      evidenceIds: Array.from(
        { length: 33 },
        (_, index) => `restricted_evidence.synthetic_http_${index}`,
      ),
    },
  ])("rejects malformed bodies before the lifecycle transaction", async (payload) => {
    const { app, store } = await testApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/player-claims",
      headers: accountHeaders,
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(store.transactionCount).toBe(0);
  });

  it("runs administrator review, verification, dispute, resolution, and release", async () => {
    const { app } = await testApp();
    const requested = await app.inject({
      method: "POST",
      url: "/v1/player-claims",
      headers: accountHeaders,
      payload: { playerId, evidenceIds: [] },
    });
    const claimId = requested.json<{ playerClaimId: string }>().playerClaimId;

    const accountReview = await app.inject({
      method: "POST",
      url: `/v1/player-claims/${claimId}/actions`,
      headers: accountHeaders,
      payload: { action: "start_review" },
    });
    expect(accountReview.statusCode).toBe(404);

    for (const action of ["start_review", "verify"] as const) {
      const response = await app.inject({
        method: "POST",
        url: `/v1/player-claims/${claimId}/actions`,
        headers: { "x-test-role": "administrator" },
        payload: { action },
      });
      expect(response.statusCode).toBe(200);
    }

    const otherDispute = await app.inject({
      method: "POST",
      url: `/v1/player-claims/${claimId}/disputes`,
      headers: {
        "x-test-role": "account",
        "x-test-account-id": otherAccountId,
      },
      payload: {},
    });
    expect(otherDispute.statusCode).toBe(404);

    const ownerDispute = await app.inject({
      method: "POST",
      url: `/v1/player-claims/${claimId}/disputes`,
      headers: accountHeaders,
      payload: { reasonCode: "ownership_disputed" },
    });
    expect(ownerDispute.statusCode).toBe(200);
    expect(ownerDispute.json()).toMatchObject({ disputeStatus: "open", revision: 4 });

    const resolved = await app.inject({
      method: "POST",
      url: `/v1/player-claims/${claimId}/actions`,
      headers: { "x-test-role": "administrator" },
      payload: { action: "resolve_dispute" },
    });
    expect(resolved.statusCode).toBe(200);

    const released = await app.inject({
      method: "POST",
      url: `/v1/player-claims/${claimId}/actions`,
      headers: { "x-test-role": "administrator" },
      payload: { action: "release", reasonCode: "assisted_release" },
    });
    expect(released.statusCode).toBe(200);
    expect(released.json()).toMatchObject({
      claimStatus: "released",
      disputeStatus: "resolved",
      revision: 6,
    });
  });

  it("gives unauthorized and missing targeted claims the same response", async () => {
    const { app } = await testApp();
    const unauthorized = await app.inject({
      method: "POST",
      url: "/v1/player-claims/player_claim.synthetic_http_1/actions",
      headers: accountHeaders,
      payload: { action: "start_review" },
    });
    const missing = await app.inject({
      method: "POST",
      url: "/v1/player-claims/player_claim.synthetic_missing_1/actions",
      headers: { "x-test-role": "administrator" },
      payload: { action: "start_review" },
    });
    expect(unauthorized.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(unauthorized.json()).toEqual(missing.json());
  });

  it("hides unexpected adapter errors behind a fixed response", async () => {
    const app = await buildApp({
      identityRepository: new NullIdentityReads(),
      resolveActor: resolveTestActor,
      claimLifecycle: {
        requestClaim: async () => {
          throw new Error("private SQL and evidence detail");
        },
        administratorAction: async () => {
          throw new Error("private SQL and review detail");
        },
        openDispute: async () => {
          throw new Error("private SQL and evidence detail");
        },
        releaseOwnClaim: async () => {
          throw new Error("private SQL and claim detail");
        },
        replyToClaim: async () => {
          throw new Error("private SQL and note detail");
        },
      },
    });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/player-claims",
      headers: accountHeaders,
      payload: { playerId, evidenceIds: [] },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: "claim_operation_failed",
      message: "The claim operation could not be completed.",
    });
    expect(response.body).not.toMatch(/sql|evidence|review/i);
  });
});
