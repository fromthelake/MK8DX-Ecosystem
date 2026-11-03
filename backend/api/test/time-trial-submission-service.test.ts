import { describe, expect, it } from "vitest";

import {
  TimeTrialSubmissionError,
  TimeTrialSubmissionService,
  type ProtectedLookupValue,
  type ProtectedValue,
  type TimeTrialAssetCatalog,
  type TimeTrialPlayerReference,
  type TimeTrialRevisionPersistenceInput,
  type TimeTrialSensitiveValueProtector,
  type TimeTrialSubmissionState,
  type TimeTrialSubmissionV1,
  type TimeTrialWriteRepository,
  type TimeTrialWriteTransaction,
} from "../src/timetrials/submission-service.js";

const playerId = "player.synthetic_timetrial_01";

function scanSubmission(): TimeTrialSubmissionV1 {
  return {
    schemaVersion: "mk8dx.time-trial-submission.v1",
    submissionId: "user_submission.time.SYNTHETICSCAN01",
    revision: 1,
    mode: 200,
    trackId: "track.water_park",
    totalTimeMs: 143_000,
    laps: [
      { lapNumber: 1, timeMs: 49_234, confidence: 0.99 },
      { lapNumber: 2, timeMs: 47_567, confidence: 0.98 },
      { lapNumber: 3, timeMs: 46_199, confidence: 0.99 },
    ],
    loadout: {
      characterId: "character.yoshi",
      characterVariantId: "character_variant.yoshi.018_black",
      bodyId: "body.mr_scooty",
      tireId: "tire.roller",
      gliderId: "glider.cloud_glider",
    },
    countryId: "country.nl",
    playerReference: {
      namespace: "producer_local_profile",
      value: "android.synthetic-profile-01",
    },
    observedPlayerName: "Synthetic Racer",
    source: {
      kind: "android_scan",
      producerVersion: "synthetic-test",
      localRecordId: "scan.synthetic-0001",
    },
    timestamps: {
      occurredAtMs: 1_786_901_000_000,
      capturedAtMs: 1_786_901_010_000,
      createdAtMs: 1_786_901_020_000,
    },
    evidence: [
      {
        kind: "screenshot",
        reference: "synthetic/android-scan-0001.png",
        sha256: "11".repeat(32),
        mediaType: "image/png",
      },
    ],
    verification: {
      status: "producer_check_passed",
      method: "synthetic lap check",
      lapSumMatches: true,
      confidence: 0.96,
      fieldConfidence: { totalTime: 0.99, track: 0.98, playerName: 0.82 },
    },
  };
}

class SyntheticCatalog implements TimeTrialAssetCatalog {
  readonly calls: unknown[] = [];
  issues: readonly string[] = [];

  async validateReferences(references: unknown): Promise<readonly string[]> {
    this.calls.push(references);
    return this.issues;
  }
}

class SyntheticProtector implements TimeTrialSensitiveValueProtector {
  readonly participantPlaintext: string[] = [];
  readonly evidencePlaintext: string[] = [];
  invalidParticipant = false;
  throwParticipant = false;

  async protectParticipantReference(
    _namespace: Exclude<TimeTrialPlayerReference["namespace"], "player">,
    value: string,
  ): Promise<ProtectedLookupValue> {
    this.participantPlaintext.push(value);
    if (this.throwParticipant) {
      throw new Error(`provider failed for ${value}`);
    }
    return {
      lookupHmac: new Uint8Array(this.invalidParticipant ? 31 : 32).fill(1),
      lookupKeyVersion: "lookup-v1",
      ciphertext: new Uint8Array([1, 2, 3]),
      encryptionKeyVersion: "encryption-v1",
    };
  }

  async protectEvidenceReference(reference: string): Promise<ProtectedValue> {
    this.evidencePlaintext.push(reference);
    return {
      ciphertext: new Uint8Array([4, 5, 6]),
      encryptionKeyVersion: "encryption-v1",
    };
  }
}

class SyntheticStore implements TimeTrialWriteRepository, TimeTrialWriteTransaction {
  readonly submissions = new Map<string, TimeTrialSubmissionState>();
  readonly activePlayers = new Set([playerId]);
  readonly writes: TimeTrialRevisionPersistenceInput[] = [];
  transactionCount = 0;
  insertSubmissionCount = 0;

  async transaction<T>(
    work: (transaction: TimeTrialWriteTransaction) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1;
    return work(this);
  }

  async findSubmissionForUpdate(
    submissionId: string,
  ): Promise<TimeTrialSubmissionState | null> {
    return this.submissions.get(submissionId) ?? null;
  }

  async findActiveHumanPlayerForUpdate(requestedPlayerId: string): Promise<boolean> {
    return this.activePlayers.has(requestedPlayerId);
  }

  async insertSubmission(submissionId: string, firstCreatedAtMs: number): Promise<void> {
    this.insertSubmissionCount += 1;
    this.submissions.set(submissionId, { firstCreatedAtMs, latestRevision: 0 });
  }

  async insertRevision(input: TimeTrialRevisionPersistenceInput): Promise<void> {
    this.writes.push(input);
    const state = this.submissions.get(input.submission.submissionId);
    if (state === undefined) {
      throw new Error("synthetic submission missing");
    }
    this.submissions.set(input.submission.submissionId, {
      ...state,
      latestRevision: input.submission.revision,
    });
  }
}

function harness() {
  const store = new SyntheticStore();
  const catalog = new SyntheticCatalog();
  const protector = new SyntheticProtector();
  return {
    store,
    catalog,
    protector,
    service: new TimeTrialSubmissionService(store, catalog, protector),
  };
}

describe("Time Trial submission application service", () => {
  it("validates assets then persists a protected restricted-source revision", async () => {
    const { service, store, catalog, protector } = harness();
    const input = scanSubmission();

    await expect(service.submit(input)).resolves.toEqual({
      submissionId: input.submissionId,
      revision: 1,
    });

    expect(catalog.calls).toEqual([
      { trackId: input.trackId, loadout: input.loadout, countryId: input.countryId },
    ]);
    expect(store.insertSubmissionCount).toBe(1);
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0]).toMatchObject({
      playerId: null,
      restrictedParticipant: {
        namespace: "producer_local_profile",
        lookupKeyVersion: "lookup-v1",
        encryptionKeyVersion: "encryption-v1",
      },
      protectedEvidence: [
        {
          sequenceNumber: 1,
          kind: "screenshot",
          mediaType: "image/png",
        },
      ],
    });
    expect(store.writes[0]?.submission).not.toHaveProperty("playerReference");
    expect(store.writes[0]?.submission).not.toHaveProperty("evidence");
    expect(JSON.stringify(store.writes[0])).not.toContain(
      "android.synthetic-profile-01",
    );
    expect(JSON.stringify(store.writes[0])).not.toContain(
      "synthetic/android-scan-0001.png",
    );
    expect(protector.participantPlaintext).toEqual(["android.synthetic-profile-01"]);
    expect(protector.evidencePlaintext).toEqual(["synthetic/android-scan-0001.png"]);
  });

  it("persists a central Player reference without invoking participant protection", async () => {
    const { service, store, protector } = harness();
    const input: TimeTrialSubmissionV1 = {
      ...scanSubmission(),
      submissionId: "user_submission.time.SYNTHETICPLAYER01",
      laps: [],
      totalTimeMs: 94_612,
      playerReference: { namespace: "player", value: playerId },
      evidence: [],
      source: { kind: "web_manual" },
    };

    await service.submit(input);

    expect(store.writes[0]).toMatchObject({
      playerId,
      restrictedParticipant: null,
      protectedEvidence: [],
      publicationEligibility: "explicit_review_required",
    });
    expect(protector.participantPlaintext).toEqual([]);
  });

  it("accepts exact scan corrections and rejects correction provenance on manual sources", async () => {
    const accepted = harness();
    await accepted.service.submit({
      ...scanSubmission(),
      verification: {
        ...scanSubmission().verification!,
        correctedFields: ["track", "character", "coins"],
      },
    });
    expect(accepted.store.writes[0]?.submission.verification?.correctedFields)
      .toEqual(["track", "character", "coins"]);

    const rejected = harness();
    await expect(rejected.service.submit({
      ...scanSubmission(),
      source: { kind: "web_manual" },
      verification: {
        status: "producer_check_passed",
        correctedFields: ["track"],
      },
    })).rejects.toMatchObject({ code: "invalid_submission" });
    expect(rejected.store.writes).toHaveLength(0);
  });

  it("classifies trusted runtime publication without trusting failed producer checks", async () => {
    const accepted = harness();
    const input: TimeTrialSubmissionV1 = {
      ...scanSubmission(),
      submissionId: "user_submission.time.SYNTHETICPUBLISH01",
      laps: [],
      totalTimeMs: 94_612,
      playerReference: { namespace: "player", value: playerId },
      evidence: [],
      source: { kind: "web_manual" },
      verification: { status: "producer_check_passed" },
    };
    await accepted.service.submit(input, { publicationIntent: "trusted_runtime" });
    expect(accepted.store.writes[0]?.publicationEligibility).toBe("runtime_eligible");

    const withheld = harness();
    await withheld.service.submit({
      ...input,
      verification: { status: "needs_review" },
    }, { publicationIntent: "trusted_runtime" });
    expect(withheld.store.writes[0]?.publicationEligibility)
      .toBe("producer_verification_withheld");
  });

  it("rejects missing or inactive central Players inside the transaction", async () => {
    const { service, store } = harness();
    const input: TimeTrialSubmissionV1 = {
      ...scanSubmission(),
      playerReference: { namespace: "player", value: "player.missing_01" },
    };

    await expect(service.submit(input)).rejects.toMatchObject({
      code: "player_not_found",
    });
    expect(store.transactionCount).toBe(1);
    expect(store.writes).toHaveLength(0);
  });

  it("rejects catalog/type/variant-parent issues before protection or a transaction", async () => {
    const { service, store, catalog, protector } = harness();
    catalog.issues = ["character variant parent mismatch"];

    await expect(service.submit(scanSubmission())).rejects.toMatchObject({
      code: "invalid_assets",
    });
    expect(protector.participantPlaintext).toEqual([]);
    expect(store.transactionCount).toBe(0);
  });

  it.each([
    ["two laps", (value: any) => { value.laps = value.laps.slice(0, 2); }],
    ["lap order", (value: any) => { value.laps[1].lapNumber = 3; }],
    ["lap sum", (value: any) => { value.laps[0].timeMs += 1; }],
    ["mushroom aggregate", (value: any) => { value.laps.forEach((lap: any) => { lap.mushroomsUsed = 2; }); }],
  ])("rejects invalid %s semantics before external work", async (_name, mutate) => {
    const { service, store, catalog } = harness();
    const input: any = structuredClone(scanSubmission());
    mutate(input);

    await expect(service.submit(input)).rejects.toMatchObject({
      code: "invalid_submission",
    });
    expect(catalog.calls).toEqual([]);
    expect(store.transactionCount).toBe(0);
  });

  it.each([
    ["unknown field", (value: any) => { value.firebaseUid = "private"; }],
    ["numeric asset", (value: any) => { value.trackId = 0; }],
    ["UserAccount ownership", (value: any) => {
      value.playerReference = {
        namespace: "user_account",
        value: "user_account.synthetic_01",
      };
    }],
    ["raw system identity", (value: any) => {
      value.playerReference = { namespace: "player", value: "NintendoStaff" };
    }],
  ])("rejects %s instead of coercing identity/legacy values", async (_name, mutate) => {
    const { service, store } = harness();
    const input: any = structuredClone(scanSubmission());
    mutate(input);

    await expect(service.submit(input)).rejects.toBeInstanceOf(TimeTrialSubmissionError);
    expect(store.transactionCount).toBe(0);
  });

  it("requires revision 1 for a new submission and strict next revisions thereafter", async () => {
    const first = harness();
    await expect(first.service.submit({ ...scanSubmission(), revision: 2 })).rejects
      .toMatchObject({ code: "revision_conflict" });
    expect(first.store.writes).toHaveLength(0);

    const existing = harness();
    const input = scanSubmission();
    existing.store.submissions.set(input.submissionId, {
      firstCreatedAtMs: input.timestamps.createdAtMs,
      latestRevision: 1,
    });
    await expect(existing.service.submit({ ...input, revision: 1 })).rejects
      .toMatchObject({ code: "revision_conflict" });
    await expect(existing.service.submit({ ...input, revision: 3 })).rejects
      .toMatchObject({ code: "revision_conflict" });
    await expect(existing.service.submit({ ...input, revision: 2 })).resolves
      .toMatchObject({ revision: 2 });
    expect(existing.store.insertSubmissionCount).toBe(0);
    expect(existing.store.writes).toHaveLength(1);
  });

  it("rejects malformed protector output before opening a transaction", async () => {
    const { service, store, protector } = harness();
    protector.invalidParticipant = true;

    await expect(service.submit(scanSubmission())).rejects.toMatchObject({
      code: "protection_failed",
    });
    expect(store.transactionCount).toBe(0);
  });

  it("redacts protector failures and never opens a transaction", async () => {
    const { service, store, protector } = harness();
    protector.throwParticipant = true;

    const failure = service.submit(scanSubmission());
    await expect(failure).rejects.toMatchObject({
      code: "protection_failed",
      message: "participant reference protection failed",
    });
    await expect(failure).rejects.not.toThrow("android.synthetic-profile-01");
    expect(store.transactionCount).toBe(0);
  });

  it("accepts seven coin balances while enforcing the mushroom aggregate", async () => {
    const { service, store } = harness();
    const times = [10_300, 8_600, 8_700, 8_800, 8_600, 8_500, 8_500];
    const input: TimeTrialSubmissionV1 = {
      ...scanSubmission(),
      submissionId: "user_submission.time.SYNTHETICSEVEN01",
      totalTimeMs: 62_000,
      laps: times.map((timeMs, index) => ({
        lapNumber: index + 1,
        timeMs,
        coinsCollected: [10, 8, 6, 9, 10, 7, 10][index]!,
        mushroomsUsed: index < 3 ? 1 : 0,
      })),
    };

    await expect(service.submit(input)).resolves.toMatchObject({ revision: 1 });
    expect(store.writes[0]?.submission.laps).toHaveLength(7);
  });
});
