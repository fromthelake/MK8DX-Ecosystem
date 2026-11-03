import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { buildApp } from "../src/app.js";
import type {
  ActorContext,
  IdentityReadRepository,
  PrivatePlayerClaimSummary,
  PrivateUserAccountSummary,
  PublicPlayerProfile,
} from "../src/identity/types.js";

const playerId = "player.synthetic_racer_01";
const ownerAccountId = "user_account.synthetic_owner_01";
const otherAccountId = "user_account.synthetic_other_01";
const claimId = "player_claim.synthetic_claim_01";

class InMemoryIdentityRepository implements IdentityReadRepository {
  public playerReads = 0;
  public accountReads = 0;
  public claimReads = 0;

  public readonly player = {
    playerId,
    username: { value: "SyntheticRacer" },
    displayName: "Synthetic Racer",
    usernameHistory: ["private-history-must-not-serialize"],
    userAccountId: ownerAccountId,
  } as PublicPlayerProfile;

  public readonly account = {
    userAccountId: ownerAccountId,
    accountStatus: "active",
    email: "synthetic@example.invalid",
    authenticationSubject: "private-auth-subject",
  } as PrivateUserAccountSummary;

  public readonly claim = {
    playerClaimId: claimId,
    playerId,
    userAccountId: ownerAccountId,
    claimStatus: "verified",
    disputeStatus: "none",
    evidence: ["restricted_evidence.synthetic_01"],
    review: { reviewer: "private-reviewer" },
  } as PrivatePlayerClaimSummary;

  async findPublicPlayerById(id: string): Promise<PublicPlayerProfile | null> {
    this.playerReads += 1;
    return id === playerId ? this.player : null;
  }

  async findUserAccountSummaryById(
    id: string,
  ): Promise<PrivateUserAccountSummary | null> {
    this.accountReads += 1;
    return id === ownerAccountId ? this.account : null;
  }

  async findPlayerClaimSummaryById(
    id: string,
  ): Promise<PrivatePlayerClaimSummary | null> {
    this.claimReads += 1;
    return id === claimId ? this.claim : null;
  }
}

async function syntheticActorResolver(
  request: FastifyRequest,
): Promise<ActorContext> {
  const role = request.headers["x-test-role"];
  const accountId = request.headers["x-test-account-id"];
  if (role === "administrator") {
    return {
      role: "administrator",
      userAccountId: "user_account.synthetic_admin_01",
    };
  }
  if (role === "migration_operator") {
    return { role: "migration_operator" };
  }
  if (role === "account" && typeof accountId === "string") {
    return { role: "account", userAccountId: accountId };
  }
  return { role: "anonymous" };
}

const apps: FastifyInstance[] = [];

async function testApp(repository = new InMemoryIdentityRepository()) {
  const app = await buildApp({
    identityRepository: repository,
    resolveActor: syntheticActorResolver,
  });
  apps.push(app);
  return { app, repository };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("public Player projection", () => {
  it("is anonymously readable and serializes only approved public fields", async () => {
    const { app } = await testApp();
    const response = await app.inject({
      method: "GET",
      url: `/v1/players/${playerId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      playerId,
      username: { value: "SyntheticRacer" },
      displayName: "Synthetic Racer",
    });
    expect(response.body).not.toContain("usernameHistory");
    expect(response.body).not.toContain("userAccountId");
  });

  it("rejects a UserAccount identifier before repository access", async () => {
    const { app, repository } = await testApp();
    const response = await app.inject({
      method: "GET",
      url: `/v1/players/${ownerAccountId}`,
    });

    expect(response.statusCode).toBe(400);
    expect(repository.playerReads).toBe(0);
  });

  it("returns a bounded not-found response", async () => {
    const { app } = await testApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/players/player.synthetic_missing_01",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      code: "identity_not_found",
      message: "The requested identity resource was not found.",
    });
  });
});

describe("private UserAccount authorization", () => {
  it("returns the private summary to its owning account without auth details", async () => {
    const { app } = await testApp();
    const response = await app.inject({
      method: "GET",
      url: `/v1/user-accounts/${ownerAccountId}`,
      headers: {
        "x-test-role": "account",
        "x-test-account-id": ownerAccountId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      userAccountId: ownerAccountId,
      accountStatus: "active",
    });
    expect(response.body).not.toContain("email");
    expect(response.body).not.toContain("authenticationSubject");
  });

  it.each([
    ["anonymous", undefined],
    ["account", otherAccountId],
    ["migration_operator", undefined],
  ])("hides the account from %s", async (role, accountId) => {
    const { app, repository } = await testApp();
    const headers: Record<string, string> = { "x-test-role": role };
    if (accountId !== undefined) {
      headers["x-test-account-id"] = accountId;
    }
    const response = await app.inject({
      method: "GET",
      url: `/v1/user-accounts/${ownerAccountId}`,
      headers,
    });

    expect(response.statusCode).toBe(404);
    expect(repository.accountReads).toBe(0);
  });

  it("allows an administrator without making Player ownership implicit", async () => {
    const { app, repository } = await testApp();
    const response = await app.inject({
      method: "GET",
      url: `/v1/user-accounts/${ownerAccountId}`,
      headers: { "x-test-role": "administrator" },
    });

    expect(response.statusCode).toBe(200);
    expect(repository.accountReads).toBe(1);
    expect(repository.playerReads).toBe(0);
    expect(repository.claimReads).toBe(0);
  });
});

describe("private PlayerClaim authorization", () => {
  it.each([
    ["account", ownerAccountId],
    ["administrator", undefined],
  ])("allows %s to read the private claim summary", async (role, accountId) => {
    const { app } = await testApp();
    const headers: Record<string, string> = { "x-test-role": role };
    if (accountId !== undefined) {
      headers["x-test-account-id"] = accountId;
    }
    const response = await app.inject({
      method: "GET",
      url: `/v1/player-claims/${claimId}`,
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      playerClaimId: claimId,
      playerId,
      userAccountId: ownerAccountId,
      claimStatus: "verified",
      disputeStatus: "none",
    });
    expect(response.body).not.toContain("evidence");
    expect(response.body).not.toContain("review");
  });

  it.each([
    ["anonymous", undefined],
    ["account", otherAccountId],
    ["migration_operator", undefined],
  ])("returns the same 404 to unauthorized %s", async (role, accountId) => {
    const { app } = await testApp();
    const headers: Record<string, string> = { "x-test-role": role };
    if (accountId !== undefined) {
      headers["x-test-account-id"] = accountId;
    }
    const response = await app.inject({
      method: "GET",
      url: `/v1/player-claims/${claimId}`,
      headers,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      code: "identity_not_found",
      message: "The requested identity resource was not found.",
    });
  });

  it("returns the same 404 for a missing claim", async () => {
    const { app } = await testApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/player-claims/player_claim.synthetic_missing_01",
      headers: {
        "x-test-role": "account",
        "x-test-account-id": ownerAccountId,
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      code: "identity_not_found",
      message: "The requested identity resource was not found.",
    });
  });
});
