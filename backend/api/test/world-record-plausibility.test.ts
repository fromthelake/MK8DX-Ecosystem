// Owner 2026-09-28: a time more than 12 % faster than the World Record is refused everywhere.
import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  IMPLAUSIBLE_TIME_CODE,
  IMPLAUSIBLE_TIME_MESSAGE,
  isImplausiblyFast,
  type WorldRecordTimes,
} from "../src/timetrials/world-record-plausibility.js";
import {
  TimeTrialSubmissionError,
  TimeTrialSubmissionService,
  type TimeTrialSubmissionV1,
  type TimeTrialWriteRepository,
} from "../src/timetrials/submission-service.js";
import { registerTimeTrialSubmissionRoutes } from "../src/timetrials/submission-routes.js";
import {
  TimeTrialLifecycleError,
  TimeTrialLifecycleService,
  type ManagedTimeTrial,
  type TimeTrialLifecycleRepository,
} from "../src/timetrials/lifecycle-service.js";

const WR_MS = 100_000;                                   // 1:40.000; 12 % faster is 1:28.000
const records: WorldRecordTimes = {
  async timeMs(trackId) { return trackId === "track.mario_kart_stadium" ? WR_MS : null; },
};

function submission(totalTimeMs: number, trackId = "track.mario_kart_stadium"): TimeTrialSubmissionV1 {
  return {
    schemaVersion: "mk8dx.time-trial-submission.v1",
    submissionId: "user_submission.time.PLAUSIBLE01",
    revision: 1,
    mode: 150,
    trackId,
    totalTimeMs,
    laps: [],
    playerReference: { namespace: "player", value: "player.one" },
    source: { kind: "web_manual" },
    timestamps: { createdAtMs: 1_900_000_000_000 },
  };
}

function service(written: unknown[]): TimeTrialSubmissionService {
  const repository: TimeTrialWriteRepository = {
    async transaction(work) {
      return work({
        async findSubmissionForUpdate() { return null; },
        async findActiveHumanPlayerForUpdate() { return true; },
        async insertSubmission() {},
        async insertRevision(input) { written.push(input); },
      });
    },
  };
  return new TimeTrialSubmissionService(
    repository,
    { async validateReferences() { return []; } },
    {
      async protectParticipantReference() { throw new Error("unused"); },
      async protectEvidenceReference() { throw new Error("unused"); },
    },
    records,
  );
}

describe("the 12 % World Record guard", () => {
  it("draws the line at exactly 88 % of the World Record", () => {
    expect(isImplausiblyFast(88_000, WR_MS)).toBe(false);
    expect(isImplausiblyFast(87_999, WR_MS)).toBe(true);
    expect(isImplausiblyFast(50_000, null)).toBe(false);      // no World Record known: not checked
  });

  it("refuses such a submission before anything is written, and accepts a fast real one", async () => {
    const written: unknown[] = [];
    await expect(service(written).submit(submission(80_000), { publicationIntent: "trusted_runtime" }))
      .rejects.toMatchObject({ code: "implausible_time", message: IMPLAUSIBLE_TIME_MESSAGE });
    expect(written).toHaveLength(0);
    await service(written).submit(submission(99_000), { publicationIntent: "trusted_runtime" });
    await service(written).submit(submission(50_000, "track.sunshine_airport"), { publicationIntent: "trusted_runtime" });
    expect(written).toHaveLength(2);
  });

  it("answers 400 with its own code and the owner's words", async () => {
    const app = Fastify();
    await registerTimeTrialSubmissionRoutes(app, {
      resolveActor: async () => ({ role: "account", userAccountId: "user_account.one" }),
      authorizer: { async authorize() { return true; } },
      csrfVerifier: { verify: () => true },
      service: {
        async submit() { throw new TimeTrialSubmissionError("implausible_time", IMPLAUSIBLE_TIME_MESSAGE); },
      },
    });
    const response = await app.inject({
      method: "POST", url: "/v1/time-trial-submissions", headers: { "x-mk8dx-csrf": "proof" },
      payload: submission(80_000),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: IMPLAUSIBLE_TIME_CODE, message: IMPLAUSIBLE_TIME_MESSAGE });
  });

  it("refuses a correction to such a time", async () => {
    const current = {
      revision: 1, modeCc: 150 as const, trackId: "track.mario_kart_stadium", totalTimeMs: 101_000,
      laps: [], sourceKind: "web_manual", createdAtMs: 1,
    };
    const managed: ManagedTimeTrial = {
      submissionId: "user_submission.time.PLAUSIBLE01", playerId: "player.one", playerUsername: "one",
      playerDisplayName: "One", retirementState: "active", publicationStatus: "published",
      publicationReason: "verified_claim_runtime_acceptance", current, revisions: [current], events: [],
    };
    let corrected = 0;
    const repository: TimeTrialLifecycleRepository = {
      async findClaimedPlayer() { return "player.one"; },
      async read() { return managed; },
      async list() { return []; },
      async correct() { corrected += 1; return managed; },
      async setRetirement() { return managed; },
      async setVideo() { return managed; },
    };
    const lifecycle = new TimeTrialLifecycleService(repository, records);
    const owner = { role: "account" as const, userAccountId: "user_account.one" };
    await expect(lifecycle.correct(owner, managed.submissionId, { totalTimeMs: 80_000, laps: [], reasonCode: "incorrect_time" }))
      .rejects.toEqual(new TimeTrialLifecycleError("invalid_input", IMPLAUSIBLE_TIME_MESSAGE));
    await lifecycle.correct(owner, managed.submissionId, { totalTimeMs: 99_500, laps: [], reasonCode: "incorrect_time" });
    expect(corrected).toBe(1);
  });
});
