import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { buildApp } from "../src/app.js";
import {
  AliasServiceError,
  type AliasReadRepository,
  type AliasSnapshot,
  type CreateAliasCommand,
  type PublicAliasProfile,
  type UpdateAliasCommand,
} from "../src/identity/alias-service.js";
import type {
  ActorContext,
  IdentityReadRepository,
} from "../src/identity/types.js";

const aliasId = "alias.synthetic_http_01";
const playerId = "player.synthetic_http_alias_01";
const adminAccountId = "user_account.synthetic_http_alias_admin_01";

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

class SyntheticAliasReads implements AliasReadRepository {
  reads = 0;
  playerReads = 0;
  throwUnexpected = false;
  profile: PublicAliasProfile | null = {
    aliasId,
    playerId,
    aliasText: "Synthetic HTTP Alias",
    aliasType: "tournament_name",
  };

  async findPublicAliasById(requestedAliasId: string) {
    this.reads += 1;
    if (this.throwUnexpected) {
      throw new Error("private Alias SQL detail");
    }
    return requestedAliasId === aliasId ? this.profile : null;
  }

  async listPublicAliasesByPlayerId(requestedPlayerId: string) {
    this.playerReads += 1;
    if (this.throwUnexpected) {
      throw new Error("private Alias SQL detail");
    }
    return requestedPlayerId === playerId && this.profile !== null
      ? [this.profile]
      : [];
  }
}

class SyntheticAliasService {
  readonly createCalls: { actor: ActorContext; command: CreateAliasCommand }[] = [];
  readonly updateCalls: { actor: ActorContext; command: UpdateAliasCommand }[] = [];
  throwUnexpected = false;

  private snapshot(): AliasSnapshot {
    return {
      aliasId,
      playerId,
      aliasText: "Synthetic HTTP Alias",
      aliasType: "tournament_name",
      visibility: "restricted",
      recordStatus: "active",
      revision: 1,
      lastSequence: 1,
      reviewedByUserAccountId: adminAccountId,
      reviewedAtMs: 2_200_000_000_000,
    };
  }

  async createAlias(actor: ActorContext, command: CreateAliasCommand) {
    if (this.throwUnexpected) {
      throw new Error("private provenance SQL detail");
    }
    if (actor.role !== "administrator") {
      throw new AliasServiceError("forbidden", "administrator required");
    }
    this.createCalls.push({ actor, command });
    return this.snapshot();
  }

  async updateAlias(actor: ActorContext, command: UpdateAliasCommand) {
    if (actor.role !== "administrator") {
      throw new AliasServiceError("forbidden", "administrator required");
    }
    if (command.aliasId !== aliasId) {
      throw new AliasServiceError("not_found", "Alias missing");
    }
    this.updateCalls.push({ actor, command });
    return {
      ...this.snapshot(),
      visibility:
        command.action === "set_visibility" ? command.visibility : "restricted",
      recordStatus: command.action === "retire" ? "retired" : "active",
      revision: 2,
      lastSequence: 2,
    } as AliasSnapshot;
  }
}

async function resolveActor(request: FastifyRequest): Promise<ActorContext> {
  return request.headers["x-test-role"] === "administrator"
    ? { role: "administrator", userAccountId: adminAccountId }
    : { role: "anonymous" };
}

const apps: FastifyInstance[] = [];

async function testApp() {
  const repository = new SyntheticAliasReads();
  const service = new SyntheticAliasService();
  const app = await buildApp({
    identityRepository: new NullIdentityReads(),
    resolveActor,
    aliasRepository: repository,
    aliasService: service,
  });
  apps.push(app);
  return { app, repository, service };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("Alias HTTP boundary", () => {
  it("serves only the allow-listed public Alias projection anonymously", async () => {
    const { app } = await testApp();
    const response = await app.inject({ method: "GET", url: `/v1/aliases/${aliasId}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      aliasId,
      playerId,
      aliasText: "Synthetic HTTP Alias",
      aliasType: "tournament_name",
    });
    expect(response.body).not.toMatch(/provenance|review|visibility|status/i);
  });

  it("uses the same 404 for filtered and missing public Aliases", async () => {
    const filtered = await testApp();
    filtered.repository.profile = null;
    const filteredResponse = await filtered.app.inject({
      method: "GET",
      url: `/v1/aliases/${aliasId}`,
    });
    const missingResponse = await filtered.app.inject({
      method: "GET",
      url: "/v1/aliases/alias.synthetic_missing_01",
    });
    expect(filteredResponse.statusCode).toBe(404);
    expect(missingResponse.statusCode).toBe(404);
    expect(filteredResponse.json()).toEqual(missingResponse.json());
  });

  it("lists only the bounded public Alias projection for one Player", async () => {
    const { app, repository } = await testApp();
    const response = await app.inject({
      method: "GET",
      url: `/v1/players/${playerId}/aliases`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schemaVersion: "mk8dx.public-player-aliases.v1",
      playerId,
      aliases: [{
        aliasId,
        playerId,
        aliasText: "Synthetic HTTP Alias",
        aliasType: "tournament_name",
      }],
    });
    expect(repository.playerReads).toBe(1);
    expect(response.body).not.toMatch(/provenance|review|visibility|status/i);
  });

  it("validates Player Alias list IDs and redacts repository failures", async () => {
    const invalid = await testApp();
    const invalidResponse = await invalid.app.inject({
      method: "GET",
      url: `/v1/players/${aliasId}/aliases`,
    });
    expect(invalidResponse.statusCode).toBe(400);
    expect(invalid.repository.playerReads).toBe(0);

    const failing = await testApp();
    failing.repository.throwUnexpected = true;
    const failedResponse = await failing.app.inject({
      method: "GET",
      url: `/v1/players/${playerId}/aliases`,
    });
    expect(failedResponse.statusCode).toBe(500);
    expect(failedResponse.json()).toEqual({
      code: "alias_read_failed",
      message: "The Aliases could not be read.",
    });
    expect(failedResponse.body).not.toMatch(/sql|private/i);
  });

  it("rejects wrong identifier namespaces before public repository access", async () => {
    const { app, repository } = await testApp();
    const response = await app.inject({
      method: "GET",
      url: `/v1/aliases/${playerId}`,
    });
    expect(response.statusCode).toBe(400);
    expect(repository.reads).toBe(0);
  });

  it("creates through the resolved administrator and strips review/provenance", async () => {
    const { app, service } = await testApp();
    const payload = {
      playerId,
      aliasText: "Synthetic HTTP Alias",
      aliasType: "tournament_name",
      visibility: "restricted",
      provenance: [
        {
          sourceType: "tournament_workbook",
          sourceReference: "source.synthetic_http_alias_01",
          observedAtMs: 2_100_000_000_000,
        },
      ],
    };
    const response = await app.inject({
      method: "POST",
      url: "/v1/aliases",
      headers: { "x-test-role": "administrator" },
      payload,
    });
    expect(response.statusCode).toBe(201);
    expect(service.createCalls[0]).toMatchObject({
      actor: { role: "administrator", userAccountId: adminAccountId },
      command: payload,
    });
    expect(response.body).not.toMatch(/provenance|reviewedBy|reviewedAt/i);
  });

  it("rejects anonymous mutation and malformed private provenance", async () => {
    const anonymous = await testApp();
    const anonymousResponse = await anonymous.app.inject({
      method: "POST",
      url: "/v1/aliases",
      payload: {
        playerId,
        aliasText: "Synthetic HTTP Alias",
        aliasType: "tournament_name",
        visibility: "restricted",
        provenance: [
          {
            sourceType: "tournament_workbook",
            sourceReference: "source.synthetic_http_alias_01",
            observedAtMs: 1,
          },
        ],
      },
    });
    expect(anonymousResponse.statusCode).toBe(403);

    const malformed = await testApp();
    const malformedResponse = await malformed.app.inject({
      method: "POST",
      url: "/v1/aliases",
      headers: { "x-test-role": "administrator" },
      payload: {
        playerId,
        aliasText: "Synthetic HTTP Alias",
        aliasType: "tournament_name",
        visibility: "restricted",
        provenance: [
          {
            sourceType: "tournament_workbook",
            sourceReference: "raw private legacy id",
            observedAtMs: 1,
          },
        ],
      },
    });
    expect(malformedResponse.statusCode).toBe(400);
    expect(malformed.service.createCalls).toHaveLength(0);
  });

  it("applies strict visibility/retirement commands and hides targeted authorization", async () => {
    const { app, service } = await testApp();
    const unauthorized = await app.inject({
      method: "POST",
      url: `/v1/aliases/${aliasId}/actions`,
      payload: { action: "retire" },
    });
    const missing = await app.inject({
      method: "POST",
      url: "/v1/aliases/alias.synthetic_missing_01/actions",
      headers: { "x-test-role": "administrator" },
      payload: { action: "retire" },
    });
    expect(unauthorized.statusCode).toBe(404);
    expect(unauthorized.json()).toEqual(missing.json());

    const visible = await app.inject({
      method: "POST",
      url: `/v1/aliases/${aliasId}/actions`,
      headers: { "x-test-role": "administrator" },
      payload: { action: "set_visibility", visibility: "public" },
    });
    expect(visible.statusCode).toBe(200);
    expect(service.updateCalls[0]?.command).toMatchObject({
      aliasId,
      action: "set_visibility",
      visibility: "public",
    });

    const malformed = await app.inject({
      method: "POST",
      url: `/v1/aliases/${aliasId}/actions`,
      headers: { "x-test-role": "administrator" },
      payload: { action: "retire", visibility: "public" },
    });
    expect(malformed.statusCode).toBe(400);
  });

  it("redacts unexpected adapter errors", async () => {
    const { app, service } = await testApp();
    service.throwUnexpected = true;
    const response = await app.inject({
      method: "POST",
      url: "/v1/aliases",
      headers: { "x-test-role": "administrator" },
      payload: {
        playerId,
        aliasText: "Synthetic HTTP Alias",
        aliasType: "tournament_name",
        visibility: "restricted",
        provenance: [
          {
            sourceType: "administrator",
            sourceReference: "source.synthetic_http_alias_01",
            observedAtMs: 1,
          },
        ],
      },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: "alias_operation_failed",
      message: "The Alias operation could not be completed.",
    });
    expect(response.body).not.toMatch(/sql|provenance/i);
  });

  it("redacts unexpected public read errors", async () => {
    const { app, repository } = await testApp();
    repository.throwUnexpected = true;
    const response = await app.inject({ method: "GET", url: `/v1/aliases/${aliasId}` });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: "alias_read_failed",
      message: "The Alias could not be read.",
    });
    expect(response.body).not.toMatch(/sql|private/i);
  });
});
