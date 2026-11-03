// ADR-0221 installation settings against fakes: the defaults without a row,
// administrator-only audited changes with a revision check, the "ratings are
// out of date" status, the explicit recalculation, the routes (public read,
// CSRF-guarded writes) and the Player-creation paths each setting closes. The
// lifecycle on a real database is in installation-settings.integration.test.ts.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import {
  InstallationSettingsService,
  type InstallationSettings,
  type InstallationSettingsRepository,
  type InstallationSettingsTransaction,
  type RatingRecomputeResult,
  type StoredInstallationSettings,
} from "../src/administration/installation-settings-service.js";
import { PlayerCreationDisabled, PlayerOnboardingService } from "../src/identity/player-onboarding-service.js";
import type { ActorContext, IdentityReadRepository } from "../src/identity/types.js";

const administrator = "user_account.synthetic_settings_admin";
const person = "user_account.synthetic_settings_person";
const admin: ActorContext = { role: "administrator", userAccountId: administrator };
const account: ActorContext = { role: "account", userAccountId: person };

class Repository implements InstallationSettingsRepository {
  public stored: StoredInstallationSettings | null = null;
  public changes: { settingKey: string; previousValue: string; newValue: string; nowMs: number }[] = [];
  public facts = { lastRecalculatedAtMs: null as number | null, claimsMatter: false, claimChangesSinceLastRecalculation: 0 };
  async read() { return this.stored; }
  async recomputeFacts() { return this.facts; }
  async transaction<T>(work: (transaction: InstallationSettingsTransaction) => Promise<T>): Promise<T> {
    return work({
      findActiveAdministratorAccount: async (id) => (id === administrator ? 1 : null),
      readForUpdate: async () => this.stored,
      write: async (input) => {
        this.stored = {
          revision: input.revision, playerCreation: input.playerCreation, ratingEligibility: input.ratingEligibility,
          ratingEligibilityChangedAtMs: input.ratingEligibilityChangedAtMs, updatedAtMs: input.nowMs,
        };
      },
      appendChange: async (input) => { this.changes.push(input); },
    });
  }
}

function fixture(recompute?: (input: { administratorAccountId: string; reasonCode: string }) => Promise<RatingRecomputeResult>) {
  const repository = new Repository();
  let now = 1_900_000_000_000;
  const service = new InstallationSettingsService({
    repository,
    clock: { nowMs: () => now },
    ...(recompute === undefined ? {} : { recomputeRatings: recompute }),
  });
  return { repository, service, tick: (ms: number) => { now += ms; } };
}

describe("installation settings (ADR-0221)", () => {
  it("reads the defaults while no administrator saved any", async () => {
    const { service } = fixture();
    expect(await service.current()).toEqual({ playerCreation: "self_and_directors", ratingEligibility: "all_players" });
    expect(await service.administration(admin)).toEqual({
      playerCreation: "self_and_directors", ratingEligibility: "all_players", revision: 0, updatedAtMs: null,
      ratingRecompute: { needed: false, eligibilityChanged: false, claimChanges: 0, lastRecalculatedAtMs: null },
    });
  });

  it("lets only an administrator change them, audits each change and checks the revision", async () => {
    const { repository, service } = fixture();
    await expect(service.update(account, { expectedRevision: 0, playerCreation: "self_only" }))
      .rejects.toMatchObject({ code: "forbidden" });
    await expect(service.administration(account)).rejects.toMatchObject({ code: "forbidden" });
    await expect(service.update(admin, { expectedRevision: 0, playerCreation: "everybody" }))
      .rejects.toMatchObject({ code: "invalid_input" });
    const saved = await service.update(admin, { expectedRevision: 0, playerCreation: "directors_only" });
    expect(saved).toMatchObject({ playerCreation: "directors_only", ratingEligibility: "all_players", revision: 1 });
    expect(repository.changes).toEqual([
      { settingKey: "player_creation", previousValue: "self_and_directors", newValue: "directors_only", changedByInternalId: 1, nowMs: 1_900_000_000_000 },
    ]);
    await expect(service.update(admin, { expectedRevision: 0, ratingEligibility: "claimed_only" }))
      .rejects.toMatchObject({ code: "conflict" });
    // Saving the same values is not a change and writes no audit row.
    await service.update(admin, { expectedRevision: 1, playerCreation: "directors_only" });
    expect(repository.changes).toHaveLength(1);
  });

  it("says the ratings are out of date after eligibility changed, until they are recalculated", async () => {
    const recompute = vi.fn(async () => ({ epoch: 4, includedPublications: 2, appliedRaces: 30, skippedRaces: 1, ratedPlayers: 12 }));
    const { repository, service, tick } = fixture(recompute);
    repository.facts.lastRecalculatedAtMs = 1_800_000_000_000;
    const changed = await service.update(admin, { expectedRevision: 0, ratingEligibility: "claimed_only" });
    expect(changed.ratingRecompute).toEqual({
      needed: true, eligibilityChanged: true, claimChanges: 0, lastRecalculatedAtMs: 1_800_000_000_000,
    });
    await expect(service.recomputeRatings(account)).rejects.toMatchObject({ code: "forbidden" });
    expect(await service.recomputeRatings(admin)).toEqual({
      epoch: 4, includedPublications: 2, appliedRaces: 30, skippedRaces: 1, ratedPlayers: 12,
    });
    expect(recompute).toHaveBeenCalledWith({ administratorAccountId: administrator, reasonCode: "installation_rating_eligibility" });
    tick(1000);
    repository.facts.lastRecalculatedAtMs = 1_900_000_000_500;
    expect((await service.administration(admin)).ratingRecompute.needed).toBe(false);
  });

  it("counts claim changes only while claims matter for the rating", async () => {
    const { repository, service } = fixture();
    repository.facts = { lastRecalculatedAtMs: 5, claimsMatter: false, claimChangesSinceLastRecalculation: 3 };
    expect((await service.administration(admin)).ratingRecompute).toMatchObject({ needed: false, claimChanges: 0 });
    repository.facts.claimsMatter = true;
    expect((await service.administration(admin)).ratingRecompute).toMatchObject({ needed: true, claimChanges: 3 });
  });

  it("explains a recalculation the installation cannot run", async () => {
    const { service } = fixture(async () => { throw new Error("the corrected history is empty - build it first"); });
    await expect(service.recomputeRatings(admin)).rejects.toMatchObject({
      code: "recompute_unavailable",
      message: expect.stringContaining("the corrected history is empty"),
    });
    const { service: without } = fixture();
    await expect(without.recomputeRatings(admin)).rejects.toMatchObject({ code: "recompute_unavailable" });
  });
});

const identityRepository: IdentityReadRepository = {
  async findPublicPlayerById() { return null; },
  async findUserAccountSummaryById() { return null; },
  async findPlayerClaimSummaryById() { return null; },
};
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

async function appFor(service: InstallationSettingsService): Promise<FastifyInstance> {
  const app = await buildApp({
    identityRepository,
    resolveActor: async (request: FastifyRequest): Promise<ActorContext> => {
      const who = request.headers["x-test-actor"];
      if (who === "admin") { return admin; }
      if (who === "person") { return account; }
      return { role: "anonymous" };
    },
    installationSettings: { service, csrfVerifier: { verify: (_actor, token) => token === "synthetic-csrf-proof-0001" } },
  });
  apps.push(app);
  return app;
}

describe("installation settings: the routes (ADR-0221)", () => {
  it("serves the public settings to anyone and the administration view only to administrators", async () => {
    const { service } = fixture();
    const app = await appFor(service);
    const open = await app.inject({ method: "GET", url: "/v1/installation-settings" });
    expect(open.statusCode).toBe(200);
    expect(open.json()).toEqual({
      schemaVersion: "mk8dx.installation-settings.v1", playerCreation: "self_and_directors", ratingEligibility: "all_players",
    });
    expect((await app.inject({ method: "GET", url: "/v1/administrator/installation-settings", headers: { "x-test-actor": "person" } })).statusCode).toBe(403);
    const view = await app.inject({ method: "GET", url: "/v1/administrator/installation-settings", headers: { "x-test-actor": "admin" } });
    expect(view.json()).toMatchObject({ schemaVersion: "mk8dx.installation-settings-administration.v1", revision: 0, updatedAtMs: null });
  });

  it("needs the CSRF proof to change the settings or recalculate", async () => {
    const { service } = fixture(async () => ({ epoch: 2, includedPublications: 0, appliedRaces: 0, skippedRaces: 0, ratedPlayers: 0 }));
    const app = await appFor(service);
    const refused = await app.inject({
      method: "POST", url: "/v1/administrator/installation-settings",
      headers: { "x-test-actor": "admin" }, payload: { expectedRevision: 0, playerCreation: "self_only" },
    });
    expect(refused.statusCode).toBe(403);
    const saved = await app.inject({
      method: "POST", url: "/v1/administrator/installation-settings",
      headers: { "x-test-actor": "admin", "x-mk8dx-csrf": "synthetic-csrf-proof-0001" },
      payload: { expectedRevision: 0, playerCreation: "self_only" },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ playerCreation: "self_only", revision: 1 });
    const stale = await app.inject({
      method: "POST", url: "/v1/administrator/installation-settings",
      headers: { "x-test-actor": "admin", "x-mk8dx-csrf": "synthetic-csrf-proof-0001" },
      payload: { expectedRevision: 0, ratingEligibility: "claimed_only" },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("installation_settings_conflict");
    const recomputed = await app.inject({
      method: "POST", url: "/v1/administrator/installation-settings/actions/recompute-ratings",
      headers: { "x-test-actor": "admin", "x-mk8dx-csrf": "synthetic-csrf-proof-0001" }, payload: {},
    });
    expect(recomputed.statusCode).toBe(200);
    expect(recomputed.json()).toEqual({
      schemaVersion: "mk8dx.installation-rating-recompute.v1", epoch: 2, includedPublications: 0, appliedRaces: 0, skippedRaces: 0, ratedPlayers: 0,
    });
  });
});

function onboarding(settings: InstallationSettings) {
  const createPlayerWithUsername = vi.fn(async (_input: { seedRating?: boolean }) => "created" as const);
  const transaction = {
    findUserAccountStatus: vi.fn(async () => "active"),
    hasVerifiedClaimForUserAccount: vi.fn(async () => false),
    createPlayerWithUsername,
    usernameTaken: vi.fn(async () => false),
    createVerifiedClaim: vi.fn(async () => undefined),
  };
  let sequence = 0;
  const service = new PlayerOnboardingService(
    { transaction: async (work: (t: unknown) => unknown) => work(transaction) } as never,
    { newPlayerId: () => `player.synthetic_${(sequence += 1)}`, newPlayerClaimId: () => "player_claim.synthetic" },
    { nowMs: () => 1_900_000_000_000 },
    { current: async () => settings },
  );
  return { service, createPlayerWithUsername };
}

describe("who creates Players (ADR-0221)", () => {
  it("closes self sign-up when only Directors create Players", async () => {
    const { service } = onboarding({ playerCreation: "directors_only", ratingEligibility: "all_players" });
    await expect(service.createOwnPlayer(account, { username: "mal" })).rejects.toBeInstanceOf(PlayerCreationDisabled);
    await expect(service.createOwnPlayer(account, { username: "mal" })).rejects.toMatchObject({ closedPath: "self" });
    expect(await service.createRosterPlayers(admin, [{ row: 2, displayName: "Mal" }])).toHaveLength(1);
  });

  it("closes the Directors' paths when Players only create themselves", async () => {
    const { service } = onboarding({ playerCreation: "self_only", ratingEligibility: "all_players" });
    await expect(service.createRosterPlayers(admin, [{ row: 2, displayName: "Mal" }])).rejects.toMatchObject({ closedPath: "directors" });
    await expect(service.createPlayerForAdministrator(admin, { username: "mal" })).rejects.toMatchObject({ closedPath: "directors" });
    expect((await service.createOwnPlayer(account, { username: "mal" })).username).toBe("mal");
  });

  it("gives a Director-made Player no rating when only claimed Players count", async () => {
    const { service, createPlayerWithUsername } = onboarding({ playerCreation: "self_and_directors", ratingEligibility: "claimed_only" });
    await service.createRosterPlayers(admin, [{ row: 2, displayName: "Mal" }]);
    expect(createPlayerWithUsername.mock.calls[0]![0]).toMatchObject({ seedRating: false });
    const everybody = onboarding({ playerCreation: "self_and_directors", ratingEligibility: "all_players" });
    await everybody.service.createRosterPlayers(admin, [{ row: 2, displayName: "Mal" }]);
    expect(everybody.createPlayerWithUsername.mock.calls[0]![0]).toMatchObject({ seedRating: true });
  });
});
