// ADR-0225: a time carried from another community. The receiving installation decides with its
// carriedTimes setting (off refuses with 403 carried_times_disabled, review holds the run for an
// administrator, allowed applies the normal rules), refuses a time "carried" from itself (400
// carried_from_self), stores where the time came from and returns it with the managed run.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  TimeTrialSubmissionService,
  validateTimeTrialSubmission,
  type CarriedTimesPolicy,
  type TimeTrialRevisionPersistenceInput,
  type TimeTrialSubmissionV1,
  type TimeTrialWriteRepository,
} from "../src/timetrials/submission-service.js";
import { registerTimeTrialSubmissionRoutes } from "../src/timetrials/submission-routes.js";
import { registerTimeTrialLifecycleRoutes } from "../src/timetrials/lifecycle-routes.js";
import type { ManagedTimeTrial } from "../src/timetrials/lifecycle-service.js";

const OWN_ORIGIN = "https://times.example.net";
const OTHER_ORIGIN = "https://club.example.org";

function carried(overrides: Partial<NonNullable<TimeTrialSubmissionV1["carriedFrom"]>> = {}): TimeTrialSubmissionV1 {
  return {
    schemaVersion: "mk8dx.time-trial-submission.v1",
    submissionId: "user_submission.time.SYNTHETICCARRIED01",
    revision: 1,
    mode: 150,
    trackId: "track.mario_kart_stadium",
    totalTimeMs: 94_612,
    laps: [],
    playerReference: { namespace: "player", value: "player.synthetic_carried_01" },
    source: { kind: "android_manual" },
    timestamps: { occurredAtMs: 1_786_900_000_000, createdAtMs: 1_786_990_000_000 },
    carriedFrom: {
      origin: OTHER_ORIGIN,
      communityName: "Synthetic Club",
      originalSubmissionId: "user_submission.time.SYNTHETICORIGIN01",
      originalSubmittedAtMs: 1_786_900_060_000,
      ...overrides,
    },
  };
}

function harness(policy: CarriedTimesPolicy | null) {
  const written: TimeTrialRevisionPersistenceInput[] = [];
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
  let reads = 0;
  const service = new TimeTrialSubmissionService(
    repository,
    { async validateReferences() { return []; } },
    {
      async protectParticipantReference() { throw new Error("unused"); },
      async protectEvidenceReference() { throw new Error("unused"); },
    },
    undefined,
    policy === null ? undefined : {
      policy: async () => { reads += 1; return policy; },
      ownOrigins: [OWN_ORIGIN, "https://192.168.1.50:8443"],
    },
  );
  return { service, written, reads: () => reads };
}

describe("carried times: the receiving community decides (ADR-0225)", () => {
  it("refuses every carried time while the setting is off, before anything is written", async () => {
    const { service, written } = harness("off");
    await expect(service.submit(carried(), { publicationIntent: "trusted_runtime" }))
      .rejects.toMatchObject({ code: "carried_times_disabled" });
    expect(written).toHaveLength(0);
    // An installation composed without the gate behaves as off.
    const bare = harness(null);
    await expect(bare.service.submit(carried(), { publicationIntent: "trusted_runtime" }))
      .rejects.toMatchObject({ code: "carried_times_disabled" });
  });

  it("refuses a time carried from this installation itself, whatever the setting", async () => {
    for (const origin of [OWN_ORIGIN, "https://times.example.net:443", "https://192.168.1.50:8443"]) {
      const { service, written } = harness("allowed");
      await expect(service.submit(carried({ origin }), { publicationIntent: "trusted_runtime" }))
        .rejects.toMatchObject({ code: "carried_from_self" });
      expect(written).toHaveLength(0);
    }
  });

  it("holds a carried time for an administrator under review, even when it would publish", async () => {
    const { service, written } = harness("review");
    await service.submit(carried(), { publicationIntent: "trusted_runtime" });
    expect(written[0]?.publicationEligibility).toBe("explicit_review_required");
    expect(written[0]?.submission.carriedFrom).toEqual(carried().carriedFrom);
  });

  it("applies the normal publication rules when carried times are allowed", async () => {
    const { service, written, reads } = harness("allowed");
    await service.submit(carried(), { publicationIntent: "trusted_runtime" });
    expect(written[0]?.publicationEligibility).toBe("runtime_eligible");
    expect(written[0]?.submission.carriedFrom?.origin).toBe(OTHER_ORIGIN);
    expect(reads()).toBe(1);
    const failed = harness("allowed");
    await failed.service.submit({ ...carried(), verification: { status: "needs_review" } }, { publicationIntent: "trusted_runtime" });
    expect(failed.written[0]?.publicationEligibility).toBe("producer_verification_withheld");
  });

  it("does not read the setting for a time set here", async () => {
    const { service, written, reads } = harness("off");
    const { carriedFrom: _carriedFrom, ...local } = carried();
    await service.submit(local, { publicationIntent: "trusted_runtime" });
    expect(written[0]?.publicationEligibility).toBe("runtime_eligible");
    expect(written[0]?.submission).not.toHaveProperty("carriedFrom");
    expect(reads()).toBe(0);
  });
});

describe("carriedFrom in the contract (ADR-0225)", () => {
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const json = (path: string) => JSON.parse(readFileSync(`${repositoryRoot}${path}`, "utf8")) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
  ajv.addSchema(json("packages/domain/schemas/asset-id-v1.schema.json"));
  ajv.addSchema(json("packages/domain/schemas/identity-reference-v1.schema.json"));
  const canonical = ajv.compile(json("packages/domain/schemas/time-trial-submission-v1.schema.json"));

  const valid: readonly TimeTrialSubmissionV1[] = [
    carried(),
    { ...carried(), carriedFrom: { origin: OTHER_ORIGIN, originalSubmittedAtMs: 0 } },
    { ...carried(), carriedFrom: { origin: "https://192.168.1.50:8443", originalSubmittedAtMs: 1 } },
    { ...carried(), carriedFrom: { origin: "https://[fd00::1]", originalSubmittedAtMs: 1 } },
  ];
  const invalid: readonly unknown[] = [
    { ...carried(), carriedFrom: { origin: "http://club.example.org", originalSubmittedAtMs: 1 } },
    { ...carried(), carriedFrom: { origin: "https://club.example.org/times", originalSubmittedAtMs: 1 } },
    { ...carried(), carriedFrom: { origin: "https://Club.example.org", originalSubmittedAtMs: 1 } },
    { ...carried(), carriedFrom: { origin: `https://${"a".repeat(250)}.org`, originalSubmittedAtMs: 1 } },
    { ...carried(), carriedFrom: { origin: OTHER_ORIGIN } },
    { ...carried(), carriedFrom: { origin: OTHER_ORIGIN, originalSubmittedAtMs: -1 } },
    { ...carried(), carriedFrom: { origin: OTHER_ORIGIN, originalSubmittedAtMs: 1, communityName: "" } },
    { ...carried(), carriedFrom: { origin: OTHER_ORIGIN, originalSubmittedAtMs: 1, communityName: "x".repeat(81) } },
    { ...carried(), carriedFrom: { origin: OTHER_ORIGIN, originalSubmittedAtMs: 1, originalSubmissionId: "x".repeat(129) } },
    { ...carried(), carriedFrom: { origin: OTHER_ORIGIN, originalSubmittedAtMs: 1, note: "extra" } },
    { ...carried(), carriedFrom: "https://club.example.org" },
  ];

  it("accepts the same carried submissions in the schema and the API validator", () => {
    for (const document of valid) {
      expect(canonical(document), JSON.stringify(canonical.errors)).toBe(true);
      expect(() => validateTimeTrialSubmission(document)).not.toThrow();
    }
  });

  it("refuses the same malformed carriedFrom in the schema and the API validator", () => {
    for (const document of invalid) {
      expect(canonical(document), JSON.stringify(document)).toBe(false);
      expect(() => validateTimeTrialSubmission(document)).toThrow(/carriedFrom is invalid/);
    }
  });

  it("validates the published carried example", () => {
    const example = json("packages/domain/examples/timetrial-carried.example.json");
    expect(canonical(example)).toBe(true);
    expect(() => validateTimeTrialSubmission(example)).not.toThrow();
  });
});

describe("carried times over HTTP (ADR-0225)", () => {
  async function submitApp(policy: CarriedTimesPolicy) {
    const app = Fastify();
    await registerTimeTrialSubmissionRoutes(app, {
      resolveActor: async () => ({ role: "account", userAccountId: "user_account.synthetic_carry" }),
      authorizer: { async authorize() { return true; } },
      service: harness(policy).service,
    });
    return app;
  }

  it("answers 403 carried_times_disabled while off and 400 carried_from_self for its own origin", async () => {
    const off = await submitApp("off");
    const refused = await off.inject({ method: "POST", url: "/v1/time-trial-submissions", payload: carried() });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: "carried_times_disabled" });
    const allowed = await submitApp("allowed");
    const self = await allowed.inject({
      method: "POST", url: "/v1/time-trial-submissions", payload: carried({ origin: OWN_ORIGIN }),
    });
    expect(self.statusCode).toBe(400);
    expect(self.json()).toMatchObject({ code: "carried_from_self" });
    const accepted = await allowed.inject({ method: "POST", url: "/v1/time-trial-submissions", payload: carried() });
    expect(accepted.statusCode).toBe(201);
  });

  it("returns carriedFrom with the managed run and in the administrator list", async () => {
    const current = {
      revision: 1, modeCc: 150 as const, trackId: "track.mario_kart_stadium", totalTimeMs: 94_612,
      laps: [], sourceKind: "android_manual", createdAtMs: 1_786_990_000_000,
    };
    const managed: ManagedTimeTrial = {
      submissionId: "user_submission.time.SYNTHETICCARRIED01", playerId: "player.synthetic_carried_01",
      playerUsername: "carried", playerDisplayName: "Synthetic Carrier", retirementState: "active",
      publicationStatus: "withheld", publicationReason: "explicit_review_required", current,
      revisions: [current], events: [],
      carriedFrom: carried().carriedFrom!,
    };
    const app = Fastify();
    await registerTimeTrialLifecycleRoutes(app, {
      resolveActor: async () => ({ role: "administrator", userAccountId: "user_account.synthetic_admin" }),
      service: {
        async readOwnedOrAdministered() { return managed; },
        async listOwn() { return [managed]; },
        async listForAdministrator() { return [managed]; },
        async correct() { return managed; },
        async retire() { return managed; },
        async restore() { return managed; },
        async setVideo() { return managed; },
      },
    });
    const detail = await app.inject({ method: "GET", url: `/v1/time-trials/${managed.submissionId}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().result.carriedFrom).toEqual(carried().carriedFrom);
    const list = await app.inject({ method: "GET", url: "/v1/administrator/time-trials?publicationStatus=withheld" });
    expect(list.statusCode).toBe(200);
    expect(list.json().results[0].carriedFrom).toEqual(carried().carriedFrom);
  });
});
