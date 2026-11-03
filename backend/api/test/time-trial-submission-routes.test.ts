import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import type { IdentityReadRepository } from "../src/identity/types.js";
import {
  TimeTrialSubmissionError,
  type TimeTrialSubmissionResult,
  type TimeTrialSubmissionContext,
  type TimeTrialSubmissionV1,
} from "../src/timetrials/submission-service.js";
import type {
  TimeTrialSubmissionAuthorizationContext,
} from "../src/timetrials/submission-routes.js";

class NullIdentityReads implements IdentityReadRepository {
  async findPublicPlayerById(): Promise<null> { return null; }
  async findUserAccountSummaryById(): Promise<null> { return null; }
  async findPlayerClaimSummaryById(): Promise<null> { return null; }
}

function submission(): TimeTrialSubmissionV1 {
  return {
    schemaVersion: "mk8dx.time-trial-submission.v1",
    submissionId: "user_submission.time.SYNTHETICHTTP01",
    revision: 1,
    mode: 200,
    trackId: "track.water_park",
    totalTimeMs: 143_000,
    laps: [
      { lapNumber: 1, timeMs: 49_234 },
      { lapNumber: 2, timeMs: 47_567 },
      { lapNumber: 3, timeMs: 46_199 },
    ],
    playerReference: {
      namespace: "producer_local_profile",
      value: "private-profile-reference",
    },
    observedPlayerName: "Private Observed Name",
    source: { kind: "android_scan", producerVersion: "synthetic-test" },
    timestamps: { createdAtMs: 1_786_901_020_000 },
    evidence: [{ kind: "screenshot", reference: "private/evidence.png" }],
  };
}

class SyntheticSubmissionService {
  readonly calls: TimeTrialSubmissionV1[] = [];
  readonly contexts: TimeTrialSubmissionContext[] = [];
  error: unknown;
  includePrivateOutput = false;

  async submit(
    input: TimeTrialSubmissionV1,
    context: TimeTrialSubmissionContext,
  ): Promise<TimeTrialSubmissionResult> {
    this.calls.push(input);
    this.contexts.push(context);
    if (this.error !== undefined) { throw this.error; }
    return {
      submissionId: input.submissionId,
      revision: input.revision,
      ...(this.includePrivateOutput
        ? { protectedEvidence: "must-be-stripped" }
        : {}),
    };
  }
}

class SyntheticAuthorizer {
  readonly calls: TimeTrialSubmissionAuthorizationContext[] = [];
  allowed = true;
  error: unknown;

  async authorize(context: TimeTrialSubmissionAuthorizationContext): Promise<boolean> {
    this.calls.push(context);
    if (this.error !== undefined) { throw this.error; }
    return this.allowed;
  }
}

const openApps: FastifyInstance[] = [];

async function appHarness() {
  const service = new SyntheticSubmissionService();
  const authorizer = new SyntheticAuthorizer();
  const resolveActor = vi.fn(async () => ({
    role: "account" as const,
    userAccountId: "user_account.synthetic_http_submitter_01",
  }));
  const app = await buildApp({
    identityRepository: new NullIdentityReads(),
    resolveActor,
    timeTrialSubmission: { service, authorizer },
  });
  openApps.push(app);
  return { app, service, authorizer, resolveActor };
}

function scanTestSubmission(): TimeTrialSubmissionV1 {
  return {
    ...submission(),
    playerReference: {
      namespace: "player",
      value: "player.synthetic_http_submitter_01",
    },
    source: { kind: "android_scan_test", producerVersion: "android-2.2" },
  };
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("Time Trial submission HTTP boundary", () => {
  it("applies distributed-burst and account submission budgets before writing", async () => {
    const service = new SyntheticSubmissionService();
    const authorizer = new SyntheticAuthorizer();
    const consume = vi.fn(async () => undefined);
    const app = await buildApp({
      identityRepository: new NullIdentityReads(),
      resolveActor: async () => ({
        role: "account",
        userAccountId: "user_account.synthetic_http_submitter_01",
      }),
      timeTrialSubmission: {
        service,
        authorizer,
        rateLimiter: { consume },
      },
    });
    openApps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/time-trial-submissions",
      payload: submission(),
    });
    expect(response.statusCode).toBe(201);
    expect(consume.mock.calls).toEqual([
      ["global", "time-trial-submit-global-10s", 10, 50],
      ["global", "time-trial-submit-global-minute", 60, 300],
      ["user_account.synthetic_http_submitter_01", "time-trial-submit-10m", 600, 240],
      ["user_account.synthetic_http_submitter_01", "time-trial-submit-day", 86_400, 1_000],
    ]);
    expect(service.calls).toHaveLength(1);
  });

  it("routes an explicit Android test scan to ephemeral storage and lists it for its account", async () => {
    const service = new SyntheticSubmissionService();
    const authorizer = new SyntheticAuthorizer();
    const input = scanTestSubmission();
    const testService = {
      submit: vi.fn(async (candidate: TimeTrialSubmissionV1, accountId: string) => ({
        submissionId: candidate.submissionId,
        revision: candidate.revision,
        accountId,
      })),
      listForAccount: vi.fn(async () => [{
        submissionId: input.submissionId,
        revision: 1,
        playerId: input.playerReference.value,
        mode: 200 as const,
        trackId: input.trackId,
        totalTimeMs: input.totalTimeMs,
        createdAtMs: 1_786_901_020_000,
        expiresAtMs: 1_786_987_420_000,
      }]),
    };
    const app = await buildApp({
      identityRepository: new NullIdentityReads(),
      resolveActor: async () => ({
        role: "account",
        userAccountId: "user_account.synthetic_http_submitter_01",
      }),
      timeTrialSubmission: { service, authorizer, testService },
    });
    openApps.push(app);

    const posted = await app.inject({
      method: "POST",
      url: "/v1/time-trial-submissions",
      payload: input,
    });
    expect(posted.statusCode).toBe(201);
    expect(service.calls).toHaveLength(0);
    expect(testService.submit).toHaveBeenCalledWith(
      input,
      "user_account.synthetic_http_submitter_01",
    );

    const listed = await app.inject({ method: "GET", url: "/v1/time-trial-scan-tests" });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({ results: await testService.listForAccount() });
  });

  it("authorizes safe metadata and returns an allow-listed created revision", async () => {
    const { app, service, authorizer } = await appHarness();
    service.includePrivateOutput = true;
    const input = submission();
    const response = await app.inject({
      method: "POST",
      url: "/v1/time-trial-submissions",
      payload: input,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      submissionId: input.submissionId,
      revision: 1,
    });
    expect(service.calls).toEqual([input]);
    expect(service.contexts).toEqual([{ publicationIntent: "trusted_runtime" }]);
    expect(authorizer.calls).toEqual([{
      actor: {
        role: "account",
        userAccountId: "user_account.synthetic_http_submitter_01",
      },
      sourceKind: "android_scan",
      playerReferenceNamespace: "producer_local_profile",
      centralPlayerId: null,
      revision: 1,
    }]);
    expect(JSON.stringify(authorizer.calls)).not.toMatch(
      /private-profile-reference|Private Observed Name|private\/evidence/,
    );
  });

  it("adds the feedback block only when asked for it, and never fails the submission over it", async () => {
    const service = new SyntheticSubmissionService();
    const authorizer = new SyntheticAuthorizer();
    const feedback = {
      forSubmission: vi.fn(async (submissionId: string, userAccountId: string | null) => ({
        trackId: "track.water_park", modeCc: 200 as const, totalTimeMs: 143_000,
        personalBest: { previousBestMs: 144_500, deltaMs: -1_500, improved: true },
        rank: {
          after: 2, before: 4, passedCount: 2, rivalsPassed: 1,
          passed: [{
            playerId: "player.evan", username: "evan", displayName: "Evan",
            bestMs: 144_000, rival: true,
          }],
        },
        ...(submissionId === "" || userAccountId === "" ? {} : {}),
      })),
    };
    const app = await buildApp({
      identityRepository: new NullIdentityReads(),
      resolveActor: async () => ({
        role: "account",
        userAccountId: "user_account.synthetic_http_submitter_01",
      }),
      timeTrialSubmission: { service, authorizer, feedback },
    });
    openApps.push(app);
    const input = submission();

    const plain = await app.inject({
      method: "POST", url: "/v1/time-trial-submissions", payload: input,
    });
    expect(plain.statusCode).toBe(201);
    expect(plain.json()).toEqual({ submissionId: input.submissionId, revision: 1 });
    expect(feedback.forSubmission).not.toHaveBeenCalled();

    const asked = await app.inject({
      method: "POST", url: "/v1/time-trial-submissions?feedback=v1", payload: input,
    });
    expect(asked.statusCode).toBe(201);
    expect(asked.json()).toEqual({
      submissionId: input.submissionId,
      revision: 1,
      feedback: {
        trackId: "track.water_park", modeCc: 200, totalTimeMs: 143_000,
        personalBest: { previousBestMs: 144_500, deltaMs: -1_500, improved: true },
        rank: {
          after: 2, before: 4, passedCount: 2, rivalsPassed: 1,
          passed: [{
            playerId: "player.evan", username: "evan", displayName: "Evan",
            bestMs: 144_000, rival: true,
          }],
        },
      },
    });
    expect(feedback.forSubmission).toHaveBeenCalledWith(
      input.submissionId, "user_account.synthetic_http_submitter_01", "v1",
    );

    feedback.forSubmission.mockRejectedValueOnce(new Error("database away"));
    const degraded = await app.inject({
      method: "POST", url: "/v1/time-trial-submissions?feedback=v1", payload: input,
    });
    expect(degraded.statusCode).toBe(201);
    expect(degraded.json()).toEqual({ submissionId: input.submissionId, revision: 1 });

    const unknownVersion = await app.inject({
      method: "POST", url: "/v1/time-trial-submissions?feedback=v3", payload: input,
    });
    expect(unknownVersion.statusCode).toBe(400);
  });

  it("denies through injected policy before the application service", async () => {
    const { app, service, authorizer } = await appHarness();
    authorizer.allowed = false;
    const response = await app.inject({
      method: "POST",
      url: "/v1/time-trial-submissions",
      payload: submission(),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      code: "time_trial_submission_forbidden",
      message: "The Time Trial submission is not authorized.",
    });
    expect(service.calls).toHaveLength(0);
  });

  it("passes only an explicit public central Player ID to authorization", async () => {
    const { app, authorizer } = await appHarness();
    const response = await app.inject({
      method: "POST",
      url: "/v1/time-trial-submissions",
      payload: {
        ...submission(),
        playerReference: {
          namespace: "player",
          value: "player.synthetic_http_submitter_01",
        },
      },
    });
    expect(response.statusCode).toBe(201);
    expect(authorizer.calls[0]).toMatchObject({
      playerReferenceNamespace: "player",
      centralPlayerId: "player.synthetic_http_submitter_01",
    });
  });

  it("requires and verifies CSRF before authorizing web manual input", async () => {
    const service = new SyntheticSubmissionService();
    const authorizer = new SyntheticAuthorizer();
    const actor = {
      role: "account" as const,
      userAccountId: "user_account.synthetic_http_submitter_01",
    };
    const csrfVerifier = { verify: vi.fn(async () => true) };
    const app = await buildApp({
      identityRepository: new NullIdentityReads(),
      resolveActor: async () => actor,
      timeTrialSubmission: { service, authorizer, csrfVerifier },
    });
    openApps.push(app);
    const input = {
      ...submission(),
      playerReference: {
        namespace: "player" as const,
        value: "player.synthetic_http_submitter_01",
      },
      source: {
        kind: "web_manual" as const,
        producerVersion: "web-csrf-test",
      },
    };
    const response = await app.inject({
      method: "POST",
      url: "/v1/time-trial-submissions",
      headers: { "X-MK8DX-CSRF": "synthetic-csrf-proof" },
      payload: input,
    });
    expect(response.statusCode).toBe(201);
    expect(csrfVerifier.verify).toHaveBeenCalledWith(actor, "synthetic-csrf-proof");
    expect(authorizer.calls).toHaveLength(1);
    expect(service.calls).toEqual([input]);
  });

  it("denies missing, invalid, or unconfigured CSRF before web authorization", async () => {
    for (const [csrfVerifier, headers] of [
      [{ verify: vi.fn(async () => false) }, { "X-MK8DX-CSRF": "invalid" }],
      [{ verify: vi.fn(async () => true) }, {}],
      [undefined, { "X-MK8DX-CSRF": "unconfigured" }],
    ] as const) {
      const service = new SyntheticSubmissionService();
      const authorizer = new SyntheticAuthorizer();
      const app = await buildApp({
        identityRepository: new NullIdentityReads(),
        resolveActor: async () => ({
          role: "account",
          userAccountId: "user_account.synthetic_http_submitter_01",
        }),
        timeTrialSubmission: {
          service,
          authorizer,
          ...(csrfVerifier === undefined ? {} : { csrfVerifier }),
        },
      });
      openApps.push(app);
      const response = await app.inject({
        method: "POST",
        url: "/v1/time-trial-submissions",
        headers,
        payload: {
          ...submission(),
          source: { kind: "web_manual", producerVersion: "web-csrf-test" },
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        code: "time_trial_csrf_forbidden",
        message: "The CSRF proof is invalid.",
      });
      expect(authorizer.calls).toHaveLength(0);
      expect(service.calls).toHaveLength(0);
    }
  });

  it("returns authentication required, not forbidden, for an anonymous native submission", async () => {
    // The Android outbox retries `not_authenticated` (401) and deliberately
    // never retries `not_authorized` (403), because 403 means this account may
    // genuinely not do this. Answering 403 to a client whose session merely
    // expired parked the saved result forever.
    for (const kind of [
      "android_manual", "android_scan", "livetrial_capture",
      "livetrial_recorded_video",
    ]) {
      const service = new SyntheticSubmissionService();
      const authorizer = new SyntheticAuthorizer();
      const app = await buildApp({
        identityRepository: new NullIdentityReads(),
        resolveActor: async () => ({ role: "anonymous" }),
        timeTrialSubmission: { service, authorizer },
      });
      openApps.push(app);
      const response = await app.inject({
        method: "POST",
        url: "/v1/time-trial-submissions",
        payload: {
          ...submission(),
          source: { kind, producerVersion: "native-anonymous-test" },
        },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        code: "time_trial_authentication_required",
        message: "Authentication is required.",
      });
      expect(authorizer.calls).toHaveLength(0);
      expect(service.calls).toHaveLength(0);
    }
  });

  it("returns authentication required before checking web CSRF", async () => {
    const service = new SyntheticSubmissionService();
    const authorizer = new SyntheticAuthorizer();
    const csrfVerifier = { verify: vi.fn(async () => true) };
    const app = await buildApp({
      identityRepository: new NullIdentityReads(),
      resolveActor: async () => ({ role: "anonymous" }),
      timeTrialSubmission: { service, authorizer, csrfVerifier },
    });
    openApps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/time-trial-submissions",
      headers: { "X-MK8DX-CSRF": "synthetic-csrf-proof" },
      payload: {
        ...submission(),
        source: { kind: "web_manual", producerVersion: "web-csrf-test" },
      },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      code: "time_trial_authentication_required",
      message: "Authentication is required.",
    });
    expect(csrfVerifier.verify).not.toHaveBeenCalled();
    expect(authorizer.calls).toHaveLength(0);
    expect(service.calls).toHaveLength(0);
  });

  it("validates the closed contract before actor resolution or authorization", async () => {
    const { app, service, authorizer, resolveActor } = await appHarness();
    const response = await app.inject({
      method: "POST",
      url: "/v1/time-trial-submissions",
      payload: { ...submission(), rawFirebaseUid: "private-uid" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: "invalid_time_trial_submission",
      message: "The Time Trial submission is invalid.",
    });
    expect(resolveActor).not.toHaveBeenCalled();
    expect(authorizer.calls).toHaveLength(0);
    expect(service.calls).toHaveLength(0);
    expect(response.body).not.toContain("private-uid");
  });

  it("maps known service failures without exposing protected input", async () => {
    const { app, service } = await appHarness();
    const cases = [
      ["invalid_assets", 400, "invalid_time_trial_submission"],
      ["player_not_found", 404, "time_trial_player_not_found"],
      ["revision_conflict", 409, "time_trial_revision_conflict"],
      ["protection_failed", 500, "time_trial_submission_failed"],
    ] as const;
    for (const [code, status, responseCode] of cases) {
      service.error = new TimeTrialSubmissionError(code, "private adapter detail");
      const response = await app.inject({
        method: "POST",
        url: "/v1/time-trial-submissions",
        payload: submission(),
      });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toMatchObject({ code: responseCode });
      expect(response.body).not.toContain("private adapter detail");
      expect(response.body).not.toContain("private-profile-reference");
    }
  });

  it("redacts unexpected policy and service failures", async () => {
    const policy = await appHarness();
    policy.authorizer.error = new Error("private policy configuration");
    let response = await policy.app.inject({
      method: "POST",
      url: "/v1/time-trial-submissions",
      payload: submission(),
    });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("private policy configuration");

    const persistence = await appHarness();
    persistence.service.error = new Error("private SQL detail");
    response = await persistence.app.inject({
      method: "POST",
      url: "/v1/time-trial-submissions",
      payload: submission(),
    });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("private SQL detail");
  });

  it("rejects oversized JSON before actor, policy, or service execution", async () => {
    const { app, service, authorizer, resolveActor } = await appHarness();
    const response = await app.inject({
      method: "POST",
      url: "/v1/time-trial-submissions",
      payload: {
        ...submission(),
        observedPlayerName: `synthetic-marker-${"x".repeat(70_000)}`,
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
      url: "/v1/time-trial-submissions",
      payload: submission(),
    });
    expect(response.statusCode).toBe(404);
  });
});
