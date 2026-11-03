import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import type { ActorContext, IdentityReadRepository } from
  "../src/identity/types.js";
import { TimeTrialRevisionReadError } from
  "../src/timetrials/revision-read-service.js";
import type { TimeTrialSubmissionV1 } from
  "../src/timetrials/submission-service.js";

class NullIdentityReads implements IdentityReadRepository {
  async findPublicPlayerById(): Promise<null> { return null; }
  async findUserAccountSummaryById(): Promise<null> { return null; }
  async findPlayerClaimSummaryById(): Promise<null> { return null; }
}

function revision(): TimeTrialSubmissionV1 {
  return {
    schemaVersion: "mk8dx.time-trial-submission.v1",
    submissionId: "user_submission.time.SYNTHETICREAD01",
    revision: 3,
    mode: 200,
    trackId: "track.water_park",
    totalTimeMs: 143_000,
    laps: [
      { lapNumber: 1, timeMs: 49_234, coinsCollected: 4, confidence: 0.98 },
      { lapNumber: 2, timeMs: 47_567, coinsCollected: 3, mushroomsUsed: 1 },
      { lapNumber: 3, timeMs: 46_199, coinsCollected: 3, mushroomsUsed: 2 },
    ],
    loadout: {
      characterId: "character.mario",
      bodyId: "body.standard_kart",
      tireId: "tire.standard",
      gliderId: "glider.super_glider",
    },
    countryId: "country.nl",
    playerReference: {
      namespace: "producer_local_profile",
      value: "private-local-profile-7",
    },
    observedPlayerName: "Private Observed Name",
    source: {
      kind: "android_scan",
      producerVersion: "synthetic-test",
      localRecordId: "private-local-record",
    },
    timestamps: {
      occurredAtMs: 1_786_901_000_000,
      capturedAtMs: 1_786_901_010_000,
      createdAtMs: 1_786_901_020_000,
      submittedAtMs: 1_786_901_030_000,
    },
    evidence: [{
      kind: "screenshot",
      reference: "private/evidence.png",
      sha256: "ab".repeat(32),
      mediaType: "image/png",
    }],
    verification: {
      status: "needs_review",
      method: "synthetic",
      lapSumMatches: true,
      confidence: 0.9,
      fieldConfidence: { totalTime: 0.99, playerName: 0.5 },
    },
  };
}

class SyntheticReadService {
  readonly calls: Array<Readonly<{
    actor: ActorContext;
    submissionId: string;
    revision: number;
    purposeCode: string;
  }>> = [];
  error: unknown;
  output: unknown = revision();

  async readRevision(
    actor: ActorContext,
    submissionId: string,
    targetRevision: number,
    purposeCode: string,
  ): Promise<TimeTrialSubmissionV1> {
    this.calls.push({
      actor,
      submissionId,
      revision: targetRevision,
      purposeCode,
    });
    if (this.error !== undefined) { throw this.error; }
    return this.output as TimeTrialSubmissionV1;
  }
}

const openApps: FastifyInstance[] = [];

async function appHarness() {
  const service = new SyntheticReadService();
  const resolveActor = vi.fn(async () => ({
    role: "administrator" as const,
    userAccountId: "user_account.synthetic_admin_01",
  }));
  const app = await buildApp({
    identityRepository: new NullIdentityReads(),
    resolveActor,
    timeTrialRevisionRead: { service },
  });
  openApps.push(app);
  return { app, service, resolveActor };
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("Time Trial revision read HTTP boundary", () => {
  it("passes the administrator target and purpose to the audited service", async () => {
    const { app, service } = await appHarness();
    const response = await app.inject({
      method: "GET",
      url: "/v1/time-trial-submissions/user_submission.time.SYNTHETICREAD01" +
        "/revisions/3?purposeCode=administrative_review",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(revision());
    expect(service.calls).toEqual([{
      actor: {
        role: "administrator",
        userAccountId: "user_account.synthetic_admin_01",
      },
      submissionId: "user_submission.time.SYNTHETICREAD01",
      revision: 3,
      purposeCode: "administrative_review",
    }]);
  });

  it("uses one non-enumerating response for forbidden and missing reads", async () => {
    const forbidden = await appHarness();
    forbidden.service.error = new TimeTrialRevisionReadError(
      "forbidden",
      "private authorization detail",
    );
    const missing = await appHarness();
    missing.service.error = new TimeTrialRevisionReadError(
      "not_found",
      "private storage detail",
    );
    const url = "/v1/time-trial-submissions/user_submission.time.SYNTHETICREAD01" +
      "/revisions/3?purposeCode=administrative_review";

    const forbiddenResponse = await forbidden.app.inject({ method: "GET", url });
    const missingResponse = await missing.app.inject({ method: "GET", url });

    expect(forbiddenResponse.statusCode).toBe(404);
    expect(forbiddenResponse.json()).toEqual(missingResponse.json());
    expect(forbiddenResponse.json()).toEqual({
      code: "time_trial_revision_not_found",
      message: "The Time Trial revision was not found.",
    });
    expect(forbiddenResponse.body).not.toContain("authorization detail");
    expect(missingResponse.body).not.toContain("storage detail");
  });

  it.each([
    ["bad id", "/v1/time-trial-submissions/bad/revisions/3?purposeCode=administrative_review"],
    ["bad revision", "/v1/time-trial-submissions/user_submission.time.SYNTHETICREAD01/revisions/0?purposeCode=administrative_review"],
    ["unsafe revision", "/v1/time-trial-submissions/user_submission.time.SYNTHETICREAD01/revisions/9999999999999999?purposeCode=administrative_review"],
    ["missing purpose", "/v1/time-trial-submissions/user_submission.time.SYNTHETICREAD01/revisions/3"],
    ["bad purpose", "/v1/time-trial-submissions/user_submission.time.SYNTHETICREAD01/revisions/3?purposeCode=Private%20review"],
    ["extra query", "/v1/time-trial-submissions/user_submission.time.SYNTHETICREAD01/revisions/3?purposeCode=administrative_review&private=1"],
  ])("rejects %s before identity or service access", async (_label, url) => {
    const { app, service, resolveActor } = await appHarness();
    const response = await app.inject({ method: "GET", url });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: "invalid_time_trial_revision_read",
      message: "The Time Trial revision read request is invalid.",
    });
    expect(resolveActor).not.toHaveBeenCalled();
    expect(service.calls).toHaveLength(0);
  });

  it("fails closed when service output is not exact canonical V1", async () => {
    const { app, service } = await appHarness();
    service.output = { ...revision(), decryptedKeyMaterial: "private-key-detail" };
    const response = await app.inject({
      method: "GET",
      url: "/v1/time-trial-submissions/user_submission.time.SYNTHETICREAD01" +
        "/revisions/3?purposeCode=administrative_review",
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: "time_trial_revision_read_failed",
      message: "The Time Trial revision could not be read.",
    });
    expect(response.body).not.toContain("private-key-detail");
  });

  it("redacts resolver, read, and decryption failures", async () => {
    const resolver = await appHarness();
    resolver.resolveActor.mockRejectedValueOnce(new Error("private provider detail"));
    const read = await appHarness();
    read.service.error = new TimeTrialRevisionReadError(
      "read_failed",
      "private decryption detail",
    );
    const unexpected = await appHarness();
    unexpected.service.error = new Error("private SQL detail");
    const url = "/v1/time-trial-submissions/user_submission.time.SYNTHETICREAD01" +
      "/revisions/3?purposeCode=administrative_review";

    for (const fixture of [resolver, read, unexpected]) {
      const response = await fixture.app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({ code: "time_trial_revision_read_failed" });
      expect(response.body).not.toMatch(/provider detail|decryption detail|SQL detail/);
    }
  });

  it("does not register without the explicit read service dependency", async () => {
    const app = await buildApp({ identityRepository: new NullIdentityReads() });
    openApps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/v1/time-trial-submissions/user_submission.time.SYNTHETICREAD01" +
        "/revisions/3?purposeCode=administrative_review",
    });
    expect(response.statusCode).toBe(404);
  });
});
