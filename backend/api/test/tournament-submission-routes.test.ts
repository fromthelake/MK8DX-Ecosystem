import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import { AdministratorTournamentSubmissionAuthorizer } from
  "../src/tournaments/administrator-submission-authorizer.js";
import type { IdentityReadRepository } from "../src/identity/types.js";
import { TournamentResultServiceError } from
  "../src/tournaments/race-result-service.js";
import type {
  TournamentSubmissionAuthorizationContext,
} from "../src/tournaments/race-result-routes.js";
import type { TournamentRaceResultV1 } from
  "../src/tournaments/race-result-validation.js";

class NullIdentityReads implements IdentityReadRepository {
  async findPublicPlayerById(): Promise<null> { return null; }
  async findUserAccountSummaryById(): Promise<null> { return null; }
  async findPlayerClaimSummaryById(): Promise<null> { return null; }
}

function raceResult(): TournamentRaceResultV1 {
  return {
    schemaVersion: "mk8dx.tournament-race-result.v1",
    raceResultId: "tournament_race_result.SYNTHETICHTTP01",
    revision: 1,
    raceNumber: 1,
    scoringSegment: 1,
    mode: 150,
    trackId: "track.mario_kart_stadium",
    countsTowardStandings: true,
    context: {
      tournamentReference: {
        namespace: "producer_local_tournament",
        value: "private-tournament-reference",
      },
      observedGroupLabel: "Private Group Label",
    },
    placements: [{
      finishPosition: 1,
      participantReference: {
        namespace: "unresolved_observation",
        value: "private-participant-reference",
      },
      observedPlayerName: "Private Participant Name",
      scoring: {
        racePoints: 15,
        totalBeforeRace: 0,
        totalAfterRace: 15,
        rankAfterRace: 1,
      },
    }],
    source: {
      kind: "tournament_recorded_video",
      transport: "native_contract",
      producerVersion: "synthetic-test",
    },
    timestamps: { createdAtMs: 1_786_901_020_000 },
    evidence: [{ kind: "video", reference: "private/evidence.mp4" }],
  };
}

class SyntheticTournamentService {
  readonly calls: TournamentRaceResultV1[] = [];
  error: unknown;
  includePrivateOutput = false;

  async submit(input: TournamentRaceResultV1) {
    this.calls.push(input);
    if (this.error !== undefined) { throw this.error; }
    return {
      raceResultId: input.raceResultId,
      revision: input.revision,
      ...(this.includePrivateOutput ? { protectedContext: "must-be-stripped" } : {}),
    };
  }
}

class SyntheticAuthorizer {
  readonly calls: TournamentSubmissionAuthorizationContext[] = [];
  allowed = true;
  error: unknown;

  async authorize(context: TournamentSubmissionAuthorizationContext): Promise<boolean> {
    this.calls.push(context);
    if (this.error !== undefined) { throw this.error; }
    return this.allowed;
  }
}

const openApps: FastifyInstance[] = [];

async function appHarness() {
  const service = new SyntheticTournamentService();
  const authorizer = new SyntheticAuthorizer();
  const resolveActor = vi.fn(async () => ({
    role: "account" as const,
    userAccountId: "user_account.synthetic_tournament_submitter_01",
  }));
  const app = await buildApp({
    identityRepository: new NullIdentityReads(),
    resolveActor,
    tournamentSubmission: { service, authorizer },
  });
  openApps.push(app);
  return { app, service, authorizer, resolveActor };
}

class SyntheticCsrfVerifier {
  accepted = "valid-proof";
  readonly calls: string[] = [];

  verify(_actor: unknown, proof: string): boolean {
    this.calls.push(proof);
    return proof === this.accepted;
  }
}

async function csrfAppHarness(
  actor: { role: "anonymous" } | { role: "account" | "administrator"; userAccountId: string },
) {
  const service = new SyntheticTournamentService();
  const authorizer = new SyntheticAuthorizer();
  const csrfVerifier = new SyntheticCsrfVerifier();
  const app = await buildApp({
    identityRepository: new NullIdentityReads(),
    resolveActor: vi.fn(async () => actor),
    tournamentSubmission: { service, authorizer, csrfVerifier },
  });
  openApps.push(app);
  return { app, service, authorizer, csrfVerifier };
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("Tournament race-result submission HTTP boundary", () => {
  it("authorizes safe metadata and returns an allow-listed created revision", async () => {
    const { app, service, authorizer } = await appHarness();
    service.includePrivateOutput = true;
    const input = raceResult();
    const response = await app.inject({
      method: "POST",
      url: "/v1/tournament-race-results",
      payload: input,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ raceResultId: input.raceResultId, revision: 1 });
    expect(service.calls).toEqual([input]);
    expect(authorizer.calls).toEqual([{
      actor: {
        role: "account",
        userAccountId: "user_account.synthetic_tournament_submitter_01",
      },
      producerKind: "tournament_recorded_video",
      revision: 1,
      placementCount: 1,
    }]);
    expect(JSON.stringify(authorizer.calls)).not.toMatch(
      /private-tournament|Private Group|private-participant|Private Participant|private\/evidence/,
    );
  });

  it("denies through injected policy before the application service", async () => {
    const { app, service, authorizer } = await appHarness();
    authorizer.allowed = false;
    const response = await app.inject({
      method: "POST",
      url: "/v1/tournament-race-results",
      payload: raceResult(),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      code: "tournament_submission_forbidden",
      message: "The Tournament race-result submission is not authorized.",
    });
    expect(service.calls).toHaveLength(0);
  });

  it("validates the closed contract before actor resolution or authorization", async () => {
    const { app, service, authorizer, resolveActor } = await appHarness();
    const response = await app.inject({
      method: "POST",
      url: "/v1/tournament-race-results",
      payload: { ...raceResult(), rawWorkbookPath: "private.xlsx" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: "invalid_tournament_race_result",
      message: "The Tournament race result is invalid.",
    });
    expect(resolveActor).not.toHaveBeenCalled();
    expect(authorizer.calls).toHaveLength(0);
    expect(service.calls).toHaveLength(0);
    expect(response.body).not.toContain("private.xlsx");
  });

  it("maps known service failures without exposing protected input", async () => {
    const { app, service } = await appHarness();
    const cases = [
      ["invalid_assets", 400, "invalid_tournament_race_result"],
      ["player_not_found", 404, "tournament_player_not_found"],
      ["revision_conflict", 409, "tournament_revision_conflict"],
      ["protection_failed", 500, "tournament_submission_failed"],
    ] as const;
    for (const [code, status, responseCode] of cases) {
      service.error = new TournamentResultServiceError(code, "private adapter detail");
      const response = await app.inject({
        method: "POST",
        url: "/v1/tournament-race-results",
        payload: raceResult(),
      });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toMatchObject({ code: responseCode });
      expect(response.body).not.toContain("private adapter detail");
      expect(response.body).not.toContain("private-participant-reference");
    }
  });

  it("redacts unexpected policy and persistence failures", async () => {
    const policy = await appHarness();
    policy.authorizer.error = new Error("private policy configuration");
    let response = await policy.app.inject({
      method: "POST",
      url: "/v1/tournament-race-results",
      payload: raceResult(),
    });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("private policy configuration");

    const persistence = await appHarness();
    persistence.service.error = new Error("private SQL detail");
    response = await persistence.app.inject({
      method: "POST",
      url: "/v1/tournament-race-results",
      payload: raceResult(),
    });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("private SQL detail");
  });

  it("rejects oversized JSON before actor, policy, or service execution", async () => {
    const { app, service, authorizer, resolveActor } = await appHarness();
    const response = await app.inject({
      method: "POST",
      url: "/v1/tournament-race-results",
      payload: {
        ...raceResult(),
        scoringNote: `synthetic-marker-${"x".repeat(140_000)}`,
      },
    });
    expect(response.statusCode).toBe(413);
    expect(response.body).not.toContain("synthetic-marker");
    expect(resolveActor).not.toHaveBeenCalled();
    expect(authorizer.calls).toHaveLength(0);
    expect(service.calls).toHaveLength(0);
  });

  it("does not register the route without the complete optional dependency", async () => {
    const app = await buildApp({ identityRepository: new NullIdentityReads() });
    openApps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/tournament-race-results",
      payload: raceResult(),
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("Tournament race-result browser submission boundary", () => {
  it("requires authentication before any policy or service work", async () => {
    const { app, service, authorizer, csrfVerifier } = await csrfAppHarness({
      role: "anonymous",
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/tournament-race-results",
      payload: raceResult(),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      code: "tournament_authentication_required",
      message: "Authentication is required.",
    });
    expect(csrfVerifier.calls).toHaveLength(0);
    expect(authorizer.calls).toHaveLength(0);
    expect(service.calls).toHaveLength(0);
  });

  it("refuses a missing or invalid same-origin proof", async () => {
    const { app, service, authorizer, csrfVerifier } = await csrfAppHarness({
      role: "administrator",
      userAccountId: "user_account.synthetic_administrator_01",
    });

    const missing = await app.inject({
      method: "POST",
      url: "/v1/tournament-race-results",
      payload: raceResult(),
    });
    expect(missing.statusCode).toBe(403);
    expect(missing.json()).toEqual({
      code: "tournament_csrf_forbidden",
      message: "The CSRF proof is invalid.",
    });

    const wrong = await app.inject({
      method: "POST",
      url: "/v1/tournament-race-results",
      headers: { "x-mk8dx-csrf": "forged-proof" },
      payload: raceResult(),
    });
    expect(wrong.statusCode).toBe(403);
    expect(csrfVerifier.calls).toEqual(["forged-proof"]);
    expect(authorizer.calls).toHaveLength(0);
    expect(service.calls).toHaveLength(0);
  });

  it("accepts an authenticated proven request and still applies the policy", async () => {
    const { app, service, authorizer, csrfVerifier } = await csrfAppHarness({
      role: "administrator",
      userAccountId: "user_account.synthetic_administrator_01",
    });
    const input = raceResult();

    const response = await app.inject({
      method: "POST",
      url: "/v1/tournament-race-results",
      headers: { "x-mk8dx-csrf": "valid-proof" },
      payload: input,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      raceResultId: input.raceResultId,
      revision: 1,
    });
    expect(csrfVerifier.calls).toEqual(["valid-proof"]);
    expect(authorizer.calls).toHaveLength(1);
    expect(service.calls).toEqual([input]);
  });
});

describe("AdministratorTournamentSubmissionAuthorizer", () => {
  const authorizer = new AdministratorTournamentSubmissionAuthorizer();
  const base = {
    producerKind: "tournament_recorded_video" as const,
    revision: 1,
    placementCount: 12,
  };

  it("admits only the audited administrator role", async () => {
    await expect(authorizer.authorize({
      ...base,
      actor: { role: "administrator", userAccountId: "user_account.a" },
    })).resolves.toBe(true);
    await expect(authorizer.authorize({
      ...base,
      actor: { role: "account", userAccountId: "user_account.a" },
    })).resolves.toBe(false);
    await expect(authorizer.authorize({
      ...base,
      actor: { role: "anonymous" },
    })).resolves.toBe(false);
    await expect(authorizer.authorize({
      ...base,
      actor: { role: "migration_operator" },
    })).resolves.toBe(false);
  });

  it("does not constrain the producer kind or revision", async () => {
    await expect(authorizer.authorize({
      ...base,
      producerKind: "tournament_live_capture",
      revision: 7,
      actor: { role: "administrator", userAccountId: "user_account.a" },
    })).resolves.toBe(true);
  });
});
