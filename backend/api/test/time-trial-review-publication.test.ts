// ADR-0225: an administrator publishes a run that waits for review (withheld with reason
// explicit_review_required, as every carried time under "review" is), unchanged and audited. Only
// administrators, only the revision they saw, only a run that is still waiting. The publication path
// itself (rank snapshot, notifications, bests) is the MySQL repository's; its integration test is in
// time-trial-lifecycle.integration.test.ts.

import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  TimeTrialLifecycleError,
  TimeTrialLifecycleService,
  type ManagedTimeTrial,
  type TimeTrialLifecycleRepository,
} from "../src/timetrials/lifecycle-service.js";
import { registerTimeTrialLifecycleRoutes } from "../src/timetrials/lifecycle-routes.js";

const submissionId = "user_submission.time.SYNTHETICREVIEW01";
const admin = { role: "administrator" as const, userAccountId: "user_account.synthetic_review_admin" };
const owner = { role: "account" as const, userAccountId: "user_account.synthetic_review_owner" };

const current = {
  revision: 2, modeCc: 150 as const, trackId: "track.mario_kart_stadium", totalTimeMs: 94_612,
  laps: [], sourceKind: "android_manual", createdAtMs: 1_786_990_000_000,
};
const waiting: ManagedTimeTrial = {
  submissionId, playerId: "player.synthetic_review_01", playerUsername: "review",
  playerDisplayName: "Synthetic Reviewer", retirementState: "active", publicationStatus: "withheld",
  publicationReason: "explicit_review_required", current, revisions: [current], events: [],
  carriedFrom: { origin: "https://club.example.org", originalSubmittedAtMs: 1_786_900_060_000 },
};

function fixture(state: ManagedTimeTrial = waiting) {
  const published: Parameters<TimeTrialLifecycleRepository["publishReviewed"]>[0][] = [];
  let stored = state;
  const repository: TimeTrialLifecycleRepository = {
    async findClaimedPlayer() { return state.playerId; },
    async read() { return stored; },
    async list() { return [stored]; },
    async correct() { return stored; },
    async setRetirement() { return stored; },
    async setVideo() { return stored; },
    async resolveCarriedWaiting() { return { resolved: 0, left: 0 }; },
    async publishReviewed(input) {
      published.push(input);
      stored = {
        ...stored, publicationStatus: "published", publicationReason: "administrator_review_publication",
        events: [...stored.events, {
          sequenceNumber: stored.events.length + 1, eventType: "published", retirementStateAfter: "active",
          revision: stored.current.revision, actorRole: "administrator", reasonCode: "review_approved",
          ...(input.note === undefined ? {} : { note: input.note }), occurredAtMs: 1_900_000_000_000,
        }],
      };
      return stored;
    },
  };
  return { service: new TimeTrialLifecycleService(repository), published };
}

describe("publishing a run that waits for review (ADR-0225)", () => {
  it("publishes the withheld run unchanged and audits who did it", async () => {
    const { service, published } = fixture();
    const result = await service.publishReviewed(admin, submissionId, 2, "checked the video");
    expect(published).toEqual([{
      submissionId, expectedRevision: 2, note: "checked the video", actorUserAccountId: admin.userAccountId,
    }]);
    expect(result).toMatchObject({ publicationStatus: "published", current: { revision: 2, totalTimeMs: 94_612 } });
    expect(result.events.at(-1)).toMatchObject({ eventType: "published", actorRole: "administrator", reasonCode: "review_approved" });
    expect(result.carriedFrom?.origin).toBe("https://club.example.org");
  });

  it("is for administrators only", async () => {
    const { service, published } = fixture();
    await expect(service.publishReviewed(owner, submissionId, 2)).rejects.toMatchObject({ code: "forbidden" });
    await expect(service.publishReviewed({ role: "anonymous" }, submissionId, 2)).rejects.toMatchObject({ code: "not_authenticated" });
    expect(published).toHaveLength(0);
  });

  it("refuses a run that is not waiting for review, or a revision the administrator did not see", async () => {
    for (const state of [
      { ...waiting, publicationStatus: "published" as const, publicationReason: "verified_claim_runtime_acceptance" },
      { ...waiting, publicationReason: "player_private" },
      { ...waiting, publicationReason: "result_retired", retirementState: "retired" as const },
    ]) {
      const { service, published } = fixture(state);
      await expect(service.publishReviewed(admin, submissionId, 2)).rejects.toMatchObject({ code: "conflict" });
      expect(published).toHaveLength(0);
    }
    const { service, published } = fixture();
    await expect(service.publishReviewed(admin, submissionId, 1)).rejects.toMatchObject({ code: "conflict" });
    await expect(service.publishReviewed(admin, submissionId, 0)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(service.publishReviewed(admin, "not-a-submission", 2)).rejects.toMatchObject({ code: "invalid_input" });
    expect(published).toHaveLength(0);
  });

  it("serves POST /v1/administrator/time-trials/:id/actions/publish behind the CSRF proof", async () => {
    const { service } = fixture();
    const app = Fastify();
    await registerTimeTrialLifecycleRoutes(app, {
      resolveActor: async (request) => (request.headers["x-test-actor"] === "owner" ? owner : admin),
      service,
      csrfVerifier: { verify: (_actor, proof) => proof === "synthetic-proof" },
    });
    const url = `/v1/administrator/time-trials/${submissionId}/actions/publish`;
    const withoutProof = await app.inject({ method: "POST", url, payload: { expectedRevision: 2 } });
    expect(withoutProof.statusCode).toBe(403);
    const byOwner = await app.inject({
      method: "POST", url, headers: { "x-test-actor": "owner", "x-mk8dx-csrf": "synthetic-proof" },
      payload: { expectedRevision: 2 },
    });
    expect(byOwner.statusCode).toBe(403);
    const missingRevision = await app.inject({
      method: "POST", url, headers: { "x-mk8dx-csrf": "synthetic-proof" }, payload: {},
    });
    expect(missingRevision.statusCode).toBe(400);
    const published = await app.inject({
      method: "POST", url, headers: { "x-mk8dx-csrf": "synthetic-proof" }, payload: { expectedRevision: 2 },
    });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({
      schemaVersion: "mk8dx.managed-time-trial.v1",
      result: { publicationStatus: "published", events: [{ eventType: "published" }] },
    });
    const again = await app.inject({
      method: "POST", url, headers: { "x-mk8dx-csrf": "synthetic-proof" }, payload: { expectedRevision: 2 },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("time_trial_lifecycle_conflict");
  });
});

describe("carried runs still waiting when approval is no longer asked (ADR-0225)", () => {
  function bulk(waitingNow: number) {
    const calls: Parameters<TimeTrialLifecycleRepository["resolveCarriedWaiting"]>[0][] = [];
    const repository = {
      async findClaimedPlayer() { return null; }, async read() { return waiting; }, async list() { return []; },
      async correct() { return waiting; }, async setRetirement() { return waiting; }, async setVideo() { return waiting; },
      async publishReviewed() { return waiting; },
      async resolveCarriedWaiting(input: Parameters<TimeTrialLifecycleRepository["resolveCarriedWaiting"]>[0]) {
        calls.push(input);
        // The repository refuses inside its transaction when the number waiting changed.
        if (input.expectedCount !== waitingNow) { throw new TimeTrialLifecycleError("conflict", "changed"); }
        return { resolved: waitingNow, left: 0 };
      },
    } satisfies TimeTrialLifecycleRepository;
    return { service: new TimeTrialLifecycleService(repository), calls };
  }

  it("publishes or refuses all of them as one administrator decision", async () => {
    const { service, calls } = bulk(3);
    expect(await service.resolveCarriedWaiting(admin, "publish", 3)).toEqual({ decision: "publish", resolved: 3, left: 0 });
    expect(await service.resolveCarriedWaiting(admin, "refuse", 3)).toEqual({ decision: "refuse", resolved: 3, left: 0 });
    expect(calls).toEqual([
      { decision: "publish", expectedCount: 3, actorUserAccountId: admin.userAccountId },
      { decision: "refuse", expectedCount: 3, actorUserAccountId: admin.userAccountId },
    ]);
  });

  it("refuses a non-administrator, an unknown decision and a count that changed", async () => {
    const { service, calls } = bulk(2);
    await expect(service.resolveCarriedWaiting(owner, "publish", 2)).rejects.toMatchObject({ code: "forbidden" });
    await expect(service.resolveCarriedWaiting({ role: "anonymous" }, "publish", 2)).rejects.toMatchObject({ code: "not_authenticated" });
    await expect(service.resolveCarriedWaiting(admin, "delete", 2)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(service.resolveCarriedWaiting(admin, "publish", 0)).rejects.toMatchObject({ code: "invalid_input" });
    expect(calls).toHaveLength(0);
    await expect(service.resolveCarriedWaiting(admin, "refuse", 3)).rejects.toMatchObject({ code: "conflict" });
  });

  it("serves POST /v1/administrator/time-trials/actions/resolve-carried-waiting", async () => {
    const { service } = bulk(2);
    const app = Fastify();
    await registerTimeTrialLifecycleRoutes(app, {
      resolveActor: async (request) => (request.headers["x-test-actor"] === "owner" ? owner : admin),
      service,
      csrfVerifier: { verify: (_actor, proof) => proof === "synthetic-proof" },
    });
    const url = "/v1/administrator/time-trials/actions/resolve-carried-waiting";
    const proof = { "x-mk8dx-csrf": "synthetic-proof" };
    expect((await app.inject({ method: "POST", url, payload: { decision: "publish", expectedCount: 2 } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url, headers: { ...proof, "x-test-actor": "owner" }, payload: { decision: "publish", expectedCount: 2 } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url, headers: proof, payload: { decision: "keep", expectedCount: 2 } })).statusCode).toBe(400);
    const changed = await app.inject({ method: "POST", url, headers: proof, payload: { decision: "refuse", expectedCount: 5 } });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().code).toBe("time_trial_lifecycle_conflict");
    const done = await app.inject({ method: "POST", url, headers: proof, payload: { decision: "refuse", expectedCount: 2 } });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toEqual({ schemaVersion: "mk8dx.carried-waiting-resolution.v1", decision: "refuse", resolved: 2, left: 0 });
  });
});
