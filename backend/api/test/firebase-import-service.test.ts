import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  candidateCanonicalSha256,
  type FirebaseImportPlan,
  type FirebaseImportPlanRecord,
} from "../src/migration/firebase-import-plan.js";
import {
  FirebaseImportError,
  FirebaseTimeTrialImportService,
  type FirebaseImportCheckpointState,
  type FirebaseImportOutcome,
  type FirebaseImportProvenance,
  type FirebaseImportRepository,
  type FirebaseImportTransaction,
} from "../src/migration/firebase-import-service.js";
import type {
  ProtectedLookupValue,
  ProtectedValue,
  TimeTrialAssetCatalog,
  TimeTrialPlayerReference,
  TimeTrialRevisionPersistenceInput,
  TimeTrialSensitiveValueProtector,
  TimeTrialSubmissionState,
  TimeTrialSubmissionV1,
} from "../src/timetrials/submission-service.js";

const fixturePath = resolve(
  import.meta.dirname,
  "../../../tooling/migration/timetrials/fixtures/synthetic-firebase-import-plan-v1.json",
);

function loadFixturePlan(): FirebaseImportPlan {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as FirebaseImportPlan;
}

class AcceptingCatalog implements TimeTrialAssetCatalog {
  async validateReferences(): Promise<readonly string[]> {
    return [];
  }
}

class RejectingCatalog implements TimeTrialAssetCatalog {
  async validateReferences(): Promise<readonly string[]> {
    return ["unknown asset"];
  }
}

class DeterministicProtector implements TimeTrialSensitiveValueProtector {
  async protectParticipantReference(
    namespace: Exclude<TimeTrialPlayerReference["namespace"], "player">,
    value: string,
  ): Promise<ProtectedLookupValue> {
    return {
      lookupHmac: Uint8Array.from(
        createHash("sha256").update(`${namespace}:${value}`).digest(),
      ),
      lookupKeyVersion: "test-lookup-v1",
      ciphertext: Uint8Array.from([0xa1, 0xa2, 0xa3]),
      encryptionKeyVersion: "test-encryption-v1",
    };
  }

  async protectEvidenceReference(): Promise<ProtectedValue> {
    return {
      ciphertext: Uint8Array.from([0xb1]),
      encryptionKeyVersion: "test-encryption-v1",
    };
  }
}

class FailingProtector implements TimeTrialSensitiveValueProtector {
  async protectParticipantReference(): Promise<ProtectedLookupValue> {
    throw new Error("synthetic protection failure");
  }

  async protectEvidenceReference(): Promise<ProtectedValue> {
    throw new Error("synthetic protection failure");
  }
}

type StoredRecord = {
  importRecordId: number;
  candidateSha256: string;
  importStatus: "imported" | "failed" | "backed_out";
  attemptCount: number;
  provenance: FirebaseImportProvenance;
  legacyIdentifierId: number | null;
  revisionInternalId: number | null;
};

type StoredRevision = {
  submissionId: string;
  revision: number;
  playerId: string | null;
  publicationEligibility: string | undefined;
  restrictedParticipant: TimeTrialRevisionPersistenceInput["restrictedParticipant"];
  evidenceCount: number;
  internalId: number;
};

type FakeState = {
  runs: { publicId: string; planSha256: string }[];
  records: Map<string, StoredRecord>;
  attempts: {
    recordKey: string;
    attemptNumber: number;
    outcome: FirebaseImportOutcome;
    candidateSha256: string;
  }[];
  submissions: Map<string, { firstCreatedAtMs: number }>;
  revisions: StoredRevision[];
  legacyOwners: Map<string, { playerId: string; id: number; accountLinked: boolean }>;
  nextId: number;
};

function cloneState(state: FakeState): FakeState {
  return {
    runs: state.runs.map((run) => ({ ...run })),
    records: new Map(
      [...state.records].map(([key, value]) => [key, { ...value }]),
    ),
    attempts: state.attempts.map((attempt) => ({ ...attempt })),
    submissions: new Map(
      [...state.submissions].map(([key, value]) => [key, { ...value }]),
    ),
    revisions: state.revisions.map((revision) => ({ ...revision })),
    legacyOwners: new Map(
      [...state.legacyOwners].map(([key, value]) => [key, { ...value }]),
    ),
    nextId: state.nextId,
  };
}

class FakeTransaction implements FirebaseImportTransaction {
  public constructor(
    private readonly state: FakeState,
    private readonly players: Map<string, { revision: number; active: boolean }>,
  ) {}

  public async findImportRecordForUpdate(
    recordKey: string,
  ): Promise<FirebaseImportCheckpointState | null> {
    const record = this.state.records.get(recordKey);
    if (record === undefined) {
      return null;
    }
    return {
      importRecordId: record.importRecordId,
      candidateSha256: record.candidateSha256,
      importStatus: record.importStatus,
      attemptCount: record.attemptCount,
    };
  }

  public async findActiveHumanPlayerRevisionForUpdate(
    playerId: string,
  ): Promise<number | null> {
    const player = this.players.get(playerId);
    return player !== undefined && player.active ? player.revision : null;
  }

  public async ensureLegacyOwnerIdentifier(input: Readonly<{
    protectedOwner: ProtectedLookupValue;
    targetPlayerId: string;
    nowMs: number;
  }>): Promise<number | "conflict"> {
    const key = Buffer.from(input.protectedOwner.lookupHmac).toString("hex");
    const existing = this.state.legacyOwners.get(key);
    if (existing !== undefined) {
      if (existing.accountLinked || existing.playerId !== input.targetPlayerId) {
        return "conflict";
      }
      return existing.id;
    }
    const id = this.state.nextId;
    this.state.nextId += 1;
    this.state.legacyOwners.set(key, {
      playerId: input.targetPlayerId,
      id,
      accountLinked: false,
    });
    return id;
  }

  public async findSubmissionForUpdate(
    submissionId: string,
  ): Promise<TimeTrialSubmissionState | null> {
    const submission = this.state.submissions.get(submissionId);
    if (submission === undefined) {
      return null;
    }
    const latestRevision = Math.max(
      0,
      ...this.state.revisions
        .filter((revision) => revision.submissionId === submissionId)
        .map((revision) => revision.revision),
    );
    return { firstCreatedAtMs: submission.firstCreatedAtMs, latestRevision };
  }

  public async findActiveHumanPlayerForUpdate(playerId: string): Promise<boolean> {
    const player = this.players.get(playerId);
    return player !== undefined && player.active;
  }

  public async insertSubmission(
    submissionId: string,
    firstCreatedAtMs: number,
  ): Promise<void> {
    this.state.submissions.set(submissionId, { firstCreatedAtMs });
  }

  public async insertRevision(
    input: TimeTrialRevisionPersistenceInput,
  ): Promise<void> {
    const internalId = this.state.nextId;
    this.state.nextId += 1;
    this.state.revisions.push({
      submissionId: input.submission.submissionId,
      revision: input.submission.revision,
      playerId: input.playerId,
      publicationEligibility: input.publicationEligibility,
      restrictedParticipant: input.restrictedParticipant,
      evidenceCount: input.protectedEvidence.length,
      internalId,
    });
  }

  public async findRevisionInternalId(
    submissionId: string,
    revision: number,
  ): Promise<number> {
    const found = this.state.revisions.find(
      (item) => item.submissionId === submissionId && item.revision === revision,
    );
    if (found === undefined) {
      throw new Error("revision was not found in fake state");
    }
    return found.internalId;
  }

  public async markImported(input: Readonly<{
    existing: FirebaseImportCheckpointState | null;
    provenance: FirebaseImportProvenance;
    legacyIdentifierId: number;
    revisionInternalId: number;
    nowMs: number;
  }>): Promise<void> {
    const attemptNumber = input.existing === null
      ? 1
      : input.existing.attemptCount + 1;
    const importRecordId = input.existing?.importRecordId ?? this.state.nextId;
    if (input.existing === null) {
      this.state.nextId += 1;
    }
    this.state.records.set(input.provenance.recordKey, {
      importRecordId,
      candidateSha256: input.provenance.candidateSha256,
      importStatus: "imported",
      attemptCount: attemptNumber,
      provenance: input.provenance,
      legacyIdentifierId: input.legacyIdentifierId,
      revisionInternalId: input.revisionInternalId,
    });
    this.state.attempts.push({
      recordKey: input.provenance.recordKey,
      attemptNumber,
      outcome: "imported",
      candidateSha256: input.provenance.candidateSha256,
    });
  }

  public async appendAttempt(input: Readonly<{
    existing: FirebaseImportCheckpointState;
    outcome: "skipped_already_imported" | "failed_candidate_conflict";
    candidateSha256: string;
    nowMs: number;
  }>): Promise<void> {
    const key = [...this.state.records.entries()].find(
      ([, value]) => value.importRecordId === input.existing.importRecordId,
    )?.[0];
    if (key === undefined) {
      throw new Error("attempt target was not found in fake state");
    }
    const record = this.state.records.get(key) as StoredRecord;
    record.attemptCount += 1;
    this.state.attempts.push({
      recordKey: key,
      attemptNumber: record.attemptCount,
      outcome: input.outcome,
      candidateSha256: input.candidateSha256,
    });
  }
}

class FakeRepository implements FirebaseImportRepository {
  public state: FakeState = {
    runs: [],
    records: new Map(),
    attempts: [],
    submissions: new Map(),
    revisions: [],
    legacyOwners: new Map(),
    nextId: 1,
  };

  public players = new Map<string, { revision: number; active: boolean }>();
  public injectFaultAfterWork = false;

  public async createRun(input: Readonly<{
    publicId: string;
    planSha256: string;
    runnerVersion: string;
    startedAtMs: number;
  }>): Promise<void> {
    this.state.runs.push({
      publicId: input.publicId,
      planSha256: input.planSha256,
    });
  }

  public async transaction<T>(
    _runPublicId: string,
    work: (transaction: FirebaseImportTransaction) => Promise<T>,
  ): Promise<T> {
    const working = cloneState(this.state);
    const result = await work(new FakeTransaction(working, this.players));
    if (this.injectFaultAfterWork) {
      throw new Error("injected fault before commit");
    }
    this.state = working;
    return result;
  }

  public async recordFailure(input: Readonly<{
    runPublicId: string;
    provenance: FirebaseImportProvenance;
    outcome: Exclude<
      FirebaseImportOutcome,
      "imported" | "skipped_already_imported"
    >;
    nowMs: number;
  }>): Promise<void> {
    const existing = this.state.records.get(input.provenance.recordKey);
    if (existing === undefined) {
      const importRecordId = this.state.nextId;
      this.state.nextId += 1;
      this.state.records.set(input.provenance.recordKey, {
        importRecordId,
        candidateSha256: input.provenance.candidateSha256,
        importStatus: "failed",
        attemptCount: 1,
        provenance: input.provenance,
        legacyIdentifierId: null,
        revisionInternalId: null,
      });
      this.state.attempts.push({
        recordKey: input.provenance.recordKey,
        attemptNumber: 1,
        outcome: input.outcome,
        candidateSha256: input.provenance.candidateSha256,
      });
      return;
    }
    existing.attemptCount += 1;
    if (existing.importStatus === "failed") {
      existing.candidateSha256 = input.provenance.candidateSha256;
      existing.provenance = input.provenance;
    }
    this.state.attempts.push({
      recordKey: input.provenance.recordKey,
      attemptNumber: existing.attemptCount,
      outcome: input.outcome,
      candidateSha256: input.provenance.candidateSha256,
    });
  }
}

function buildService(
  repository: FakeRepository,
  protector: TimeTrialSensitiveValueProtector = new DeterministicProtector(),
  catalog: TimeTrialAssetCatalog = new AcceptingCatalog(),
): FirebaseTimeTrialImportService {
  let runNumber = 0;
  return new FirebaseTimeTrialImportService(
    repository,
    catalog,
    protector,
    { nowMs: () => 1_900_000_100_000 },
    () => {
      runNumber += 1;
      return `migration_import_run.synthetic_${runNumber}`;
    },
  );
}

function registerFixturePlayers(repository: FakeRepository): void {
  for (const record of loadFixturePlan().records) {
    if (record.recordKind === "reviewed_player") {
      repository.players.set(record.resolution.playerId, {
        revision: 1,
        active: true,
      });
    }
  }
}

function customPlanRecord(
  overrides: Readonly<{
    recordKeySuffix: string;
    submissionSuffix: string;
    revision?: number;
    playerId?: string;
    expectedPlayerRevision?: number;
    legacyValue?: string;
    createdAtMs?: number;
  }>,
): Extract<FirebaseImportPlanRecord, { recordKind: "reviewed_player" }> {
  const playerId = overrides.playerId ?? "player.synthetic_custom_target";
  const candidate: TimeTrialSubmissionV1 = {
    schemaVersion: "mk8dx.time-trial-submission.v1",
    submissionId:
      `user_submission.time.firebase_${overrides.submissionSuffix}`,
    revision: overrides.revision ?? 1,
    mode: 150,
    trackId: "track.mario_kart_stadium",
    totalTimeMs: 95_000,
    laps: [],
    playerReference: { namespace: "player", value: playerId },
    source: { kind: "web_manual" },
    timestamps: { createdAtMs: overrides.createdAtMs ?? 1_760_002_000_000 },
  };
  return {
    recordKind: "reviewed_player",
    recordKey: `firebase_record.${overrides.recordKeySuffix.padEnd(32, "0")}`,
    candidateSha256: candidateCanonicalSha256(candidate),
    candidate,
    legacyVisible: true,
    legacyOwner: {
      namespace: "legacy_firebase_user",
      value: overrides.legacyValue ?? "synthetic_firebase_uid_custom",
    },
    resolution: {
      resolutionId: "migration_identity_resolution.synthetic_custom",
      playerId,
      expectedPlayerRevision: overrides.expectedPlayerRevision ?? 1,
      administratorGrantId: "administrator_grant.synthetic_migration_review",
      reasonCode: "synthetic_exact_match",
      reviewedAtMs: 1_900_000_000_000,
    },
  };
}

function systemPlanRecord(): FirebaseImportPlanRecord {
  const candidate: TimeTrialSubmissionV1 = {
    schemaVersion: "mk8dx.time-trial-submission.v1",
    submissionId: "user_submission.time.firebase_systemunit01",
    revision: 1,
    mode: 150,
    trackId: "track.mario_kart_stadium",
    totalTimeMs: 91_000,
    laps: [],
    playerReference: {
      namespace: "unresolved_observation",
      value: "legacy_system.world_record",
    },
    source: { kind: "web_manual" },
    timestamps: { createdAtMs: 1_760_002_200_000 },
    evidence: [{
      kind: "screenshot",
      reference: "migration-media://synthetic/system.png",
    }],
  };
  return {
    recordKind: "system_reference",
    recordKey: `firebase_record.${"9".repeat(32)}`,
    candidateSha256: candidateCanonicalSha256(candidate),
    candidate,
    legacyVisible: true,
    systemReference: {
      namespace: "unresolved_observation",
      value: "legacy_system.world_record",
    },
  };
}

function customPlan(
  records: readonly FirebaseImportPlanRecord[],
): FirebaseImportPlan {
  return {
    schemaVersion: "mk8dx.firebase-timetrial-import-plan.v1",
    runnerVersion: "firebase-timetrial-batch-dry-run.v1",
    inputSha256: "ab".repeat(32),
    records,
  };
}

describe("Firebase Time Trial import service", () => {
  let repository: FakeRepository;

  beforeEach(() => {
    repository = new FakeRepository();
  });

  it("imports every eligible fixture candidate atomically and never publishes", async () => {
    registerFixturePlayers(repository);
    const service = buildService(repository);

    const report = await service.importPlan(loadFixturePlan());

    // The lone hidden revision-2 record has no revision 1 in the synthetic
    // corpus, so its incomplete chain fails closed; everything else imports.
    expect(report.totals).toEqual({
      planRecords: 10,
      imported: 9,
      skippedAlreadyImported: 0,
      failed: 1,
    });
    expect(report.records.filter(
      (item) => item.outcome === "failed_revision_conflict",
    )).toHaveLength(1);
    expect(repository.state.submissions.size).toBe(9);
    expect(repository.state.revisions).toHaveLength(9);
    let systemRevisions = 0;
    let evidenceBearing = 0;
    for (const revision of repository.state.revisions) {
      expect(revision.publicationEligibility).toBe("explicit_review_required");
      if (revision.playerId === null) {
        expect(revision.restrictedParticipant).not.toBeNull();
        expect(revision.restrictedParticipant?.namespace).toBe(
          "unresolved_observation",
        );
        systemRevisions += 1;
      } else {
        expect(revision.restrictedParticipant).toBeNull();
      }
      if (revision.evidenceCount > 0) {
        evidenceBearing += 1;
      }
    }
    expect(systemRevisions).toBe(2);
    expect(evidenceBearing).toBe(3);
    expect(repository.state.records.size).toBe(10);
    for (const record of repository.state.records.values()) {
      expect(record.attemptCount).toBe(1);
      if (record.importStatus !== "imported") {
        continue;
      }
      expect(record.revisionInternalId).not.toBeNull();
      if (record.provenance.recordKind === "reviewed_player") {
        expect(record.legacyIdentifierId).not.toBeNull();
        expect(record.provenance.resolutionId).toMatch(
          /^migration_identity_resolution\./,
        );
      } else {
        expect(record.legacyIdentifierId).toBeNull();
        expect(record.provenance.resolutionId).toBeNull();
      }
    }
    expect(repository.state.legacyOwners.size).toBe(7);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("player.synthetic_migrated");
    expect(serialized).not.toContain("synthetic_firebase_uid");
    expect(serialized).not.toContain("administrator_grant.");
    expect(serialized).not.toContain("migration-media://");
  });

  it("repeats idempotently: a rerun skips without new canonical rows", async () => {
    registerFixturePlayers(repository);
    const service = buildService(repository);

    await service.importPlan(loadFixturePlan());
    const rerun = await service.importPlan(loadFixturePlan());

    expect(rerun.totals).toEqual({
      planRecords: 10,
      imported: 0,
      skippedAlreadyImported: 9,
      failed: 1,
    });
    expect(repository.state.revisions).toHaveLength(9);
    expect(repository.state.submissions.size).toBe(9);
    expect(
      repository.state.attempts.filter(
        (attempt) => attempt.outcome === "skipped_already_imported",
      ),
    ).toHaveLength(9);
    for (const record of repository.state.records.values()) {
      expect(record.attemptCount).toBe(2);
    }
  });

  it("imports a lone system-reference record without any Player dependency", async () => {
    const record = systemPlanRecord();
    const report = await buildService(repository).importPlan(
      customPlan([record]),
    );

    expect(report.records[0]?.outcome).toBe("imported");
    const revision = repository.state.revisions[0];
    expect(revision?.playerId).toBeNull();
    expect(revision?.restrictedParticipant?.namespace).toBe(
      "unresolved_observation",
    );
    expect(revision?.evidenceCount).toBe(1);
    const checkpoint = repository.state.records.get(record.recordKey);
    expect(checkpoint?.importStatus).toBe("imported");
    expect(checkpoint?.legacyIdentifierId).toBeNull();
    expect(checkpoint?.provenance.recordKind).toBe("system_reference");
    expect(repository.state.legacyOwners.size).toBe(0);
  });

  it("rejects a changed candidate for an imported record without writing", async () => {
    registerFixturePlayers(repository);
    const service = buildService(repository);
    await service.importPlan(loadFixturePlan());

    const changed = loadFixturePlan();
    const record = changed.records[0] as unknown as {
      candidate: {
        totalTimeMs: number;
        laps: { timeMs: number }[];
      };
      candidateSha256: string;
    };
    record.candidate.totalTimeMs += 1;
    const lastLap = record.candidate.laps[record.candidate.laps.length - 1];
    if (lastLap !== undefined) {
      lastLap.timeMs += 1;
    }
    record.candidateSha256 = candidateCanonicalSha256(record.candidate);
    const report = await buildService(repository).importPlan(changed);

    expect(report.records[0]?.outcome).toBe("failed_candidate_conflict");
    expect(repository.state.revisions).toHaveLength(9);
    expect(
      repository.state.records.get(
        report.records[0]?.recordKey as string,
      )?.importStatus,
    ).toBe("imported");
  });

  it("fails closed on a stale Player revision and retries after review", async () => {
    const record = customPlanRecord({
      recordKeySuffix: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01",
      submissionSuffix: "staletest01",
      expectedPlayerRevision: 1,
    });
    repository.players.set(record.resolution.playerId, {
      revision: 2,
      active: true,
    });
    const service = buildService(repository);

    const stale = await service.importPlan(customPlan([record]));
    expect(stale.records[0]?.outcome).toBe("failed_stale_player_revision");
    expect(repository.state.submissions.size).toBe(0);
    expect(repository.state.revisions).toHaveLength(0);
    const checkpoint = repository.state.records.get(record.recordKey);
    expect(checkpoint?.importStatus).toBe("failed");
    expect(checkpoint?.attemptCount).toBe(1);

    const reviewed = customPlan([{
      ...record,
      resolution: { ...record.resolution, expectedPlayerRevision: 2 },
    }]);
    const retried = await buildService(repository).importPlan(reviewed);
    expect(retried.records[0]?.outcome).toBe("imported");
    const updated = repository.state.records.get(record.recordKey);
    expect(updated?.importStatus).toBe("imported");
    expect(updated?.attemptCount).toBe(2);
    expect(repository.state.revisions).toHaveLength(1);
  });

  it("fails closed on a missing Player, a conflicting legacy owner, and a revision gap", async () => {
    const missingPlayer = customPlanRecord({
      recordKeySuffix: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa02",
      submissionSuffix: "missingplayer01",
    });
    const service = buildService(repository);
    const missingReport = await service.importPlan(customPlan([missingPlayer]));
    expect(missingReport.records[0]?.outcome).toBe("failed_player_not_found");

    repository.players.set("player.synthetic_custom_target", {
      revision: 1,
      active: true,
    });
    repository.players.set("player.synthetic_other_player", {
      revision: 1,
      active: true,
    });
    const owner = customPlanRecord({
      recordKeySuffix: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa03",
      submissionSuffix: "ownerfirst01",
      legacyValue: "synthetic_firebase_uid_shared_owner",
    });
    await buildService(repository).importPlan(customPlan([owner]));
    const conflicting = customPlanRecord({
      recordKeySuffix: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa04",
      submissionSuffix: "ownersecond01",
      legacyValue: "synthetic_firebase_uid_shared_owner",
      playerId: "player.synthetic_other_player",
    });
    const conflictReport = await buildService(repository).importPlan(
      customPlan([conflicting]),
    );
    expect(conflictReport.records[0]?.outcome).toBe(
      "failed_legacy_owner_conflict",
    );

    const gap = customPlanRecord({
      recordKeySuffix: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa05",
      submissionSuffix: "revisiongap01",
      revision: 2,
    });
    const gapReport = await buildService(repository).importPlan(
      customPlan([gap]),
    );
    expect(gapReport.records[0]?.outcome).toBe("failed_revision_conflict");
    expect(repository.state.revisions).toHaveLength(1);
  });

  it("imports an ordered revision chain for one legacy submission", async () => {
    repository.players.set("player.synthetic_custom_target", {
      revision: 1,
      active: true,
    });
    const first = customPlanRecord({
      recordKeySuffix: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa06",
      submissionSuffix: "chain01",
      revision: 1,
    });
    const second = customPlanRecord({
      recordKeySuffix: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa07",
      submissionSuffix: "chain01",
      revision: 2,
      createdAtMs: 1_760_002_100_000,
    });
    const report = await buildService(repository).importPlan(
      customPlan([first, second]),
    );
    expect(report.records.map((item) => item.outcome)).toEqual([
      "imported",
      "imported",
    ]);
    expect(repository.state.submissions.size).toBe(1);
    expect(repository.state.revisions).toHaveLength(2);
  });

  it("rolls back canonical writes and records a durable failure on a late fault", async () => {
    registerFixturePlayers(repository);
    repository.injectFaultAfterWork = true;
    const report = await buildService(repository).importPlan(loadFixturePlan());

    expect(report.totals.failed).toBe(10);
    // The lone revision-2 record aborts on its incomplete chain before the
    // injected fault; every other record fails on the fault itself.
    expect(report.records.filter(
      (item) => item.outcome === "failed_persistence",
    )).toHaveLength(9);
    expect(report.records.filter(
      (item) => item.outcome === "failed_revision_conflict",
    )).toHaveLength(1);
    expect(repository.state.submissions.size).toBe(0);
    expect(repository.state.revisions).toHaveLength(0);
    expect(repository.state.legacyOwners.size).toBe(0);
    expect(repository.state.records.size).toBe(10);
    expect(
      [...repository.state.records.values()].every(
        (item) => item.importStatus === "failed",
      ),
    ).toBe(true);
  });

  it("records protection failures without reaching the repository transaction", async () => {
    registerFixturePlayers(repository);
    const report = await buildService(
      repository,
      new FailingProtector(),
    ).importPlan(loadFixturePlan());

    expect(report.totals.failed).toBe(10);
    expect(repository.state.submissions.size).toBe(0);
    expect(repository.state.records.size).toBe(10);
  });

  it("re-imports a backed-out record as a fresh canonical revision", async () => {
    registerFixturePlayers(repository);
    await buildService(repository).importPlan(loadFixturePlan());
    for (const [recordKey, record] of repository.state.records) {
      if (record.importStatus !== "imported") {
        continue;
      }
      repository.state.records.set(recordKey, {
        ...record,
        importStatus: "backed_out",
        revisionInternalId: null,
      });
    }
    repository.state.submissions.clear();
    repository.state.revisions = [];

    const report = await buildService(repository).importPlan(loadFixturePlan());

    expect(report.totals).toEqual({
      planRecords: 10,
      imported: 9,
      skippedAlreadyImported: 0,
      failed: 1,
    });
    expect(repository.state.revisions).toHaveLength(9);
    for (const record of repository.state.records.values()) {
      expect(record.attemptCount).toBe(2);
      if (record.provenance.recordKind === "reviewed_player" &&
        record.importStatus === "imported") {
        expect(record.legacyIdentifierId).not.toBeNull();
      }
    }
  });

  it("rejects invalid asset references before creating a run", async () => {
    registerFixturePlayers(repository);
    const service = buildService(
      repository,
      new DeterministicProtector(),
      new RejectingCatalog(),
    );
    await expect(service.importPlan(loadFixturePlan())).rejects.toThrow(
      FirebaseImportError,
    );
    expect(repository.state.runs).toHaveLength(0);
    expect(repository.state.records.size).toBe(0);
  });
});
