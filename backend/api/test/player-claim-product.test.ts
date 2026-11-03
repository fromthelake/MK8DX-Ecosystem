import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { buildApp } from "../src/app.js";
import type { IdentityReadRepository } from "../src/identity/types.js";
import {
  PlayerClaimProductService,
  type PlayerClaimProductRepository,
} from "../src/profiles/player-claim-product-service.js";

const accountId = "user_account.synthetic_claim_product_01";
const playerId = "player.synthetic_claim_product_01";

class Repository implements PlayerClaimProductRepository {
  public queries: string[] = [];
  async searchActivePlayers(query: string) {
    this.queries.push(query);
    return [{ playerId, username: "SyntheticRacer", displayName: "Synthetic Racer", aliases: [] }];
  }
  async listActivePlayers() {
    return [{ playerId, username: "SyntheticRacer", displayName: "Synthetic Racer", aliases: [] }];
  }
  async listLinkedPlayerAccounts() {
    return [{ playerId, username: "SyntheticRacer", displayName: "Synthetic Racer", userAccountId: accountId }];
  }
  async listClaimsForAccount(requestedAccountId: string) {
    return requestedAccountId === accountId ? [{
      playerClaimId: "player_claim.synthetic_claim_product_01",
      playerId,
      playerUsername: "SyntheticRacer",
      playerDisplayName: "Synthetic Racer",
      claimStatus: "requested" as const,
      disputeStatus: "none" as const,
      updatedAtMs: 1787011200000,
    }] : [];
  }
  async listClaimsForAdministrator() {
    return this.listClaimsForAccount(accountId);
  }
}

const identityRepository: IdentityReadRepository = {
  async findPublicPlayerById() { return null; },
  async findUserAccountSummaryById() { return null; },
  async findPlayerClaimSummaryById() { return null; },
};
const apps: FastifyInstance[] = [];

async function mounted(service: PlayerClaimProductService) {
  const app = await buildApp({
    identityRepository,
    resolveActor: async (request: FastifyRequest) =>
      request.headers.authorization === "Synthetic account"
        ? { role: "account" as const, userAccountId: accountId }
        : request.headers.authorization === "Synthetic administrator"
          ? { role: "administrator" as const, userAccountId: accountId }
          : { role: "anonymous" as const },
    playerClaimProduct: { service },
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("Player claim search/status product", () => {
  it("requires an account and validates search before repository access", async () => {
    const repository = new Repository();
    const service = new PlayerClaimProductService(repository);
    await expect(service.search({ role: "anonymous" }, "Sy"))
      .rejects.toMatchObject({ code: "not_authenticated" });
    await expect(service.search({ role: "account", userAccountId: accountId }, " x "))
      .rejects.toMatchObject({ code: "invalid_query" });
    expect(repository.queries).toEqual([]);
    await expect(service.search(
      { role: "account", userAccountId: accountId },
      " Synthetic ",
    )).resolves.toHaveLength(1);
    expect(repository.queries).toEqual(["Synthetic"]);
  });

  it("tells an administrator which account holds which Player", async () => {
    // Granting Tournament access used to mean typing an opaque
    // `user_account.<uuid>` from memory. This is the mapping that lets an
    // administrator pick a person by name instead.
    const app = await mounted(new PlayerClaimProductService(new Repository()));
    const forbidden = await app.inject({
      method: "GET",
      url: "/v1/administrator/linked-player-accounts",
      headers: { authorization: "Synthetic account" },
    });
    expect(forbidden.statusCode).toBe(403);
    const anonymous = await app.inject({
      method: "GET",
      url: "/v1/administrator/linked-player-accounts",
    });
    expect(anonymous.statusCode).toBe(401);
    const allowed = await app.inject({
      method: "GET",
      url: "/v1/administrator/linked-player-accounts",
      headers: { authorization: "Synthetic administrator" },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({
      schemaVersion: "mk8dx.administrator-linked-player-accounts.v1",
      players: [{
        playerId,
        username: "SyntheticRacer",
        displayName: "Synthetic Racer",
        userAccountId: accountId,
      }],
    });
    // No email, and nothing else private about the account, is served here.
    expect(JSON.stringify(allowed.json())).not.toMatch(/@|email/i);
  });

  it("mounts closed directory and own-claim responses", async () => {
    const app = await mounted(new PlayerClaimProductService(new Repository()));
    const headers = { authorization: "Synthetic account" };
    const directory = await app.inject({
      method: "GET",
      url: "/v1/player-directory?query=Synthetic",
      headers,
    });
    expect(directory.statusCode).toBe(200);
    expect(directory.json()).toEqual({
      schemaVersion: "mk8dx.player-directory.v1",
      players: [{ playerId, username: "SyntheticRacer", displayName: "Synthetic Racer", aliases: [] }],
    });
    const completeDirectory = await app.inject({
      method: "GET",
      url: "/v1/player-directory",
      headers,
    });
    expect(completeDirectory.statusCode).toBe(200);
    expect(completeDirectory.json()).toEqual(directory.json());
    const claims = await app.inject({
      method: "GET",
      url: "/v1/me/player-claims",
      headers,
    });
    expect(claims.statusCode).toBe(200);
    expect(claims.json()).toEqual({
      schemaVersion: "mk8dx.account-player-claims.v1",
      claims: [{
        playerClaimId: "player_claim.synthetic_claim_product_01",
        playerId,
        playerUsername: "SyntheticRacer",
        playerDisplayName: "Synthetic Racer",
        claimStatus: "requested",
        disputeStatus: "none",
        updatedAtMs: 1787011200000,
      }],
    });
    expect(claims.body).not.toMatch(/evidence|email|review/i);
  });

  it("rejects anonymous enumeration and extra query parameters", async () => {
    const app = await mounted(new PlayerClaimProductService(new Repository()));
    const anonymous = await app.inject({
      method: "GET",
      url: "/v1/player-directory?query=Synthetic",
    });
    expect(anonymous.statusCode).toBe(401);
    const publicDirectory = await app.inject({
      method: "GET",
      url: "/v1/public/player-directory?query=Synthetic",
    });
    expect(publicDirectory.statusCode).toBe(200);
    expect(publicDirectory.json()).toEqual({
      schemaVersion: "mk8dx.player-directory.v1",
      players: [{ playerId, username: "SyntheticRacer", displayName: "Synthetic Racer", aliases: [] }],
    });
    const malformed = await app.inject({
      method: "GET",
      url: "/v1/player-directory?query=Synthetic&private=true",
      headers: { authorization: "Synthetic account" },
    });
    expect(malformed.statusCode).toBe(400);
  });

  it("exposes the bounded claim queue only to a current administrator", async () => {
    const app = await mounted(new PlayerClaimProductService(new Repository()));
    const forbidden = await app.inject({
      method: "GET",
      url: "/v1/administrator/player-claims",
      headers: { authorization: "Synthetic account" },
    });
    expect(forbidden.statusCode).toBe(403);
    const queue = await app.inject({
      method: "GET",
      url: "/v1/administrator/player-claims",
      headers: { authorization: "Synthetic administrator" },
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json()).toMatchObject({
      schemaVersion: "mk8dx.administrator-player-claim-queue.v1",
      claims: [{ playerClaimId: "player_claim.synthetic_claim_product_01" }],
    });
    expect(queue.body).not.toMatch(/userAccountId|evidence|email|review/i);
  });
});
