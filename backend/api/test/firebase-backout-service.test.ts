import { beforeEach, describe, expect, it } from "vitest";

import {
  FirebaseBackoutError,
  FirebaseTimeTrialBackoutService,
  type FirebaseBackoutOutcome,
  type FirebaseBackoutRecordState,
  type FirebaseBackoutRepository,
  type FirebaseBackoutTarget,
  type FirebaseBackoutTransaction,
  type FirebaseSubmissionRevisionRow,
} from "../src/migration/firebase-backout-service.js";

type FakeRecord = {
  importRecordId: number;
  recordKey: string;
  importStatus: "imported" | "failed" | "backed_out";
  attemptCount: number;
  candidateSha256: string;
  revisionInternalId: number | null;
};

type FakeSubmission = {
  submissionId: string;
  revisions: {
    revisionInternalId: number;
    revisionNumber: number;
    restrictedChildren: number;
  }[];
  publication: { status: string; publishedEvents: number } | null;
};

let deletedRestrictedChildren = 0;

type FakeState = {
  records: Map<string, FakeRecord>;
  submissions: Map<string, FakeSubmission>;
  attempts: { recordKey: string; outcome: FirebaseBackoutOutcome }[];
  runs: string[];
};

function cloneState(state: FakeState): FakeState {
  return {
    records: new Map([...state.records].map(([key, value]) => [key, { ...value }])),
    submissions: new Map([...state.submissions].map(([key, value]) => [key, {
      submissionId: value.submissionId,
      revisions: value.revisions.map((revision) => ({ ...revision })),
      publication: value.publication === null ? null : { ...value.publication },
    }])),
    attempts: state.attempts.map((attempt) => ({ ...attempt })),
    runs: [...state.runs],
  };
}

class FakeTransaction implements FirebaseBackoutTransaction {
  public constructor(private readonly state: FakeState) {}

  private submissionOfRevision(revisionInternalId: number): FakeSubmission {
    for (const submission of this.state.submissions.values()) {
      if (submission.revisions.some(
        (revision) => revision.revisionInternalId === revisionInternalId,
      )) {
        return submission;
      }
    }
    throw new Error("revision not found in fake state");
  }

  public async findBackoutRecordForUpdate(
    recordKey: string,
  ): Promise<FirebaseBackoutRecordState | null> {
    const record = this.state.records.get(recordKey);
    return record === undefined ? null : { ...record };
  }

  public async lockSubmissionRevisions(
    submissionId: string,
  ): Promise<readonly FirebaseSubmissionRevisionRow[]> {
    const submission = this.state.submissions.get(submissionId);
    return submission === undefined ? [] : submission.revisions.map((revision) => ({
      revisionInternalId: revision.revisionInternalId,
      revisionNumber: revision.revisionNumber,
    }));
  }

  public async findPublicationStateForUpdate(submissionId: string): Promise<Readonly<{
    publicationStatus: string;
    publishedEventCount: number;
  }> | null> {
    const publication = this.state.submissions.get(submissionId)?.publication;
    return publication === undefined || publication === null ? null : {
      publicationStatus: publication.status,
      publishedEventCount: publication.publishedEvents,
    };
  }

  public async deleteRevisionWithChildren(
    revisionInternalId: number,
  ): Promise<void> {
    const submission = this.submissionOfRevision(revisionInternalId);
    const target = submission.revisions.find(
      (item) => item.revisionInternalId === revisionInternalId,
    );
    deletedRestrictedChildren += target?.restrictedChildren ?? 0;
    const remaining = submission.revisions.filter(
      (revision) => revision.revisionInternalId !== revisionInternalId,
    );
    const highest = Math.max(
      0,
      ...remaining.map((revision) => revision.revisionNumber),
    );
    const removed = submission.revisions.find(
      (revision) => revision.revisionInternalId === revisionInternalId,
    );
    if (removed !== undefined && removed.revisionNumber < highest) {
      throw new Error("revisions must be deleted in reverse order");
    }
    submission.revisions = remaining;
  }

  public async deletePublicationState(submissionId: string): Promise<void> {
    const submission = this.state.submissions.get(submissionId);
    if (submission === undefined || submission.publication === null) {
      throw new Error("publication state was lost in fake state");
    }
    submission.publication = null;
  }

  public async deleteSubmission(submissionId: string): Promise<void> {
    const submission = this.state.submissions.get(submissionId);
    if (submission === undefined || submission.revisions.length > 0 ||
      submission.publication !== null) {
      throw new Error("submission still has dependent rows in fake state");
    }
    this.state.submissions.delete(submissionId);
  }

  public async markBackedOut(
    record: FirebaseBackoutRecordState,
    _nowMs: number,
  ): Promise<void> {
    const stored = this.state.records.get(record.recordKey);
    if (stored === undefined || stored.importStatus !== "imported") {
      throw new Error("backout target is not imported in fake state");
    }
    stored.importStatus = "backed_out";
    stored.revisionInternalId = null;
    stored.attemptCount += 1;
  }

  public async appendBackoutAttempt(
    record: FirebaseBackoutRecordState,
    outcome: FirebaseBackoutOutcome,
    _nowMs: number,
  ): Promise<void> {
    const stored = this.state.records.get(record.recordKey);
    if (stored === undefined) {
      throw new Error("attempt target is missing in fake state");
    }
    if (outcome !== "backed_out") {
      stored.attemptCount += 1;
    }
    this.state.attempts.push({ recordKey: record.recordKey, outcome });
  }
}

class FakeRepository implements FirebaseBackoutRepository {
  public state: FakeState = {
    records: new Map(),
    submissions: new Map(),
    attempts: [],
    runs: [],
  };

  public importedRunTargets = new Map<string, string[]>();

  public async resolveImportedRunTargets(
    importRunId: string,
  ): Promise<readonly string[]> {
    return this.importedRunTargets.get(importRunId) ?? [];
  }

  public async describeTargets(
    recordKeys: readonly string[],
  ): Promise<readonly FirebaseBackoutTarget[]> {
    return recordKeys.map((recordKey) => {
      const record = this.state.records.get(recordKey);
      if (record === undefined) {
        throw new Error("a backout target record does not exist");
      }
      let submissionId: string | null = null;
      let revision: number | null = null;
      if (record.revisionInternalId !== null) {
        for (const submission of this.state.submissions.values()) {
          const found = submission.revisions.find(
            (item) => item.revisionInternalId === record.revisionInternalId,
          );
          if (found !== undefined) {
            submissionId = submission.submissionId;
            revision = found.revisionNumber;
          }
        }
      }
      return {
        recordKey,
        importStatus: record.importStatus,
        submissionId,
        revision,
      };
    });
  }

  public async createRun(input: Readonly<{ publicId: string }>): Promise<void> {
    this.state.runs.push(input.publicId);
  }

  public async transaction<T>(
    _backoutRunPublicId: string,
    work: (transaction: FirebaseBackoutTransaction) => Promise<T>,
  ): Promise<T> {
    const working = cloneState(this.state);
    const result = await work(new FakeTransaction(working));
    this.state = working;
    return result;
  }

  public async recordRefusal(input: Readonly<{
    recordKey: string;
    outcome: Exclude<
      FirebaseBackoutOutcome,
      "backed_out" | "skipped_already_backed_out"
    >;
  }>): Promise<void> {
    const record = this.state.records.get(input.recordKey);
    if (record !== undefined) {
      record.attemptCount += 1;
    }
    this.state.attempts.push({
      recordKey: input.recordKey,
      outcome: input.outcome,
    });
  }
}

function buildService(repository: FakeRepository): FirebaseTimeTrialBackoutService {
  let runNumber = 0;
  return new FirebaseTimeTrialBackoutService(
    repository,
    { nowMs: () => 1_900_000_200_000 },
    () => {
      runNumber += 1;
      return `migration_import_run.backout_synthetic_${runNumber}`;
    },
  );
}

function seedImportedChain(repository: FakeRepository): void {
  repository.state.records.set(`firebase_record.${"1".repeat(32)}`, {
    importRecordId: 1,
    recordKey: `firebase_record.${"1".repeat(32)}`,
    importStatus: "imported",
    attemptCount: 1,
    candidateSha256: "a".repeat(64),
    revisionInternalId: 11,
  });
  repository.state.records.set(`firebase_record.${"2".repeat(32)}`, {
    importRecordId: 2,
    recordKey: `firebase_record.${"2".repeat(32)}`,
    importStatus: "imported",
    attemptCount: 1,
    candidateSha256: "b".repeat(64),
    revisionInternalId: 12,
  });
  repository.state.records.set(`firebase_record.${"3".repeat(32)}`, {
    importRecordId: 3,
    recordKey: `firebase_record.${"3".repeat(32)}`,
    importStatus: "imported",
    attemptCount: 1,
    candidateSha256: "c".repeat(64),
    revisionInternalId: 21,
  });
  repository.state.submissions.set("user_submission.time.firebase_chain01", {
    submissionId: "user_submission.time.firebase_chain01",
    revisions: [
      { revisionInternalId: 11, revisionNumber: 1, restrictedChildren: 0 },
      { revisionInternalId: 12, revisionNumber: 2, restrictedChildren: 0 },
    ],
    publication: { status: "withheld", publishedEvents: 0 },
  });
  repository.state.submissions.set("user_submission.time.firebase_single01", {
    submissionId: "user_submission.time.firebase_single01",
    revisions: [
      { revisionInternalId: 21, revisionNumber: 1, restrictedChildren: 0 },
    ],
    publication: { status: "withheld", publishedEvents: 0 },
  });
  repository.importedRunTargets.set("migration_import_run.synthetic_1", [
    `firebase_record.${"1".repeat(32)}`,
    `firebase_record.${"2".repeat(32)}`,
    `firebase_record.${"3".repeat(32)}`,
  ]);
}

describe("Firebase Time Trial backout service", () => {
  let repository: FakeRepository;

  beforeEach(() => {
    repository = new FakeRepository();
    seedImportedChain(repository);
  });

  it("backs out a complete unpublished import run atomically", async () => {
    const report = await buildService(repository).backOut({
      importRunId: "migration_import_run.synthetic_1",
    });

    expect(report.totals).toEqual({
      targetRecords: 3,
      backedOut: 3,
      skippedAlreadyBackedOut: 0,
      failed: 0,
    });
    expect(repository.state.submissions.size).toBe(0);
    for (const record of repository.state.records.values()) {
      expect(record.importStatus).toBe("backed_out");
      expect(record.revisionInternalId).toBeNull();
      expect(record.attemptCount).toBe(2);
    }
    expect(
      repository.state.attempts.filter((item) => item.outcome === "backed_out"),
    ).toHaveLength(3);
  });

  it("repeats idempotently by explicit record keys", async () => {
    const service = buildService(repository);
    await service.backOut({ importRunId: "migration_import_run.synthetic_1" });
    const rerun = await service.backOut({
      recordKeys: [
        `firebase_record.${"1".repeat(32)}`,
        `firebase_record.${"2".repeat(32)}`,
        `firebase_record.${"3".repeat(32)}`,
      ],
    });

    expect(rerun.totals).toEqual({
      targetRecords: 3,
      backedOut: 0,
      skippedAlreadyBackedOut: 3,
      failed: 0,
    });
    for (const record of repository.state.records.values()) {
      expect(record.importStatus).toBe("backed_out");
      expect(record.attemptCount).toBe(2);
    }
  });

  it("refuses a published submission and keeps every canonical row", async () => {
    const chain = repository.state.submissions.get(
      "user_submission.time.firebase_chain01",
    );
    if (chain?.publication) {
      chain.publication.status = "published";
      chain.publication.publishedEvents = 1;
    }
    const report = await buildService(repository).backOut({
      importRunId: "migration_import_run.synthetic_1",
    });

    expect(report.totals.backedOut).toBe(1);
    expect(report.totals.failed).toBe(2);
    expect(
      report.records
        .filter((record) => record.outcome === "failed_backout_published"),
    ).toHaveLength(2);
    expect(
      repository.state.submissions.get("user_submission.time.firebase_chain01")
        ?.revisions,
    ).toHaveLength(2);
    const chainRecord = repository.state.records.get(
      `firebase_record.${"1".repeat(32)}`,
    );
    expect(chainRecord?.importStatus).toBe("imported");
    expect(chainRecord?.attemptCount).toBe(2);
  });

  it("refuses a superseded submission with foreign revisions", async () => {
    repository.state.submissions
      .get("user_submission.time.firebase_chain01")?.revisions
      .push({ revisionInternalId: 99, revisionNumber: 3, restrictedChildren: 0 });
    const report = await buildService(repository).backOut({
      recordKeys: [
        `firebase_record.${"1".repeat(32)}`,
        `firebase_record.${"2".repeat(32)}`,
      ],
    });

    expect(report.totals.failed).toBe(2);
    expect(report.records.every(
      (record) => record.outcome === "failed_backout_superseded",
    )).toBe(true);
    expect(
      repository.state.submissions.get("user_submission.time.firebase_chain01")
        ?.revisions,
    ).toHaveLength(3);
  });

  it("removes import-created restricted children and refuses failed records", async () => {
    // P7-B/P7-C imports create restricted evidence and system participant
    // rows; backing the revision out removes them with it.
    deletedRestrictedChildren = 0;
    const single = repository.state.submissions.get(
      "user_submission.time.firebase_single01",
    );
    const singleRevision = single?.revisions[0];
    if (singleRevision !== undefined) {
      singleRevision.restrictedChildren = 2;
    }
    const stateReport = await buildService(repository).backOut({
      recordKeys: [`firebase_record.${"3".repeat(32)}`],
    });
    expect(stateReport.records[0]?.outcome).toBe("backed_out");
    expect(deletedRestrictedChildren).toBe(2);
    expect(
      repository.state.submissions.has("user_submission.time.firebase_single01"),
    ).toBe(false);

    const failedRecord = repository.state.records.get(
      `firebase_record.${"1".repeat(32)}`,
    );
    if (failedRecord !== undefined) {
      failedRecord.importStatus = "failed";
      failedRecord.revisionInternalId = null;
    }
    const failedReport = await buildService(repository).backOut({
      recordKeys: [`firebase_record.${"1".repeat(32)}`],
    });
    expect(failedReport.records[0]?.outcome).toBe("failed_backout_state");
  });

  it("requires exactly one explicit target mode with valid values", async () => {
    const service = buildService(repository);
    await expect(service.backOut({})).rejects.toThrow(FirebaseBackoutError);
    await expect(service.backOut({
      importRunId: "migration_import_run.synthetic_1",
      recordKeys: [`firebase_record.${"1".repeat(32)}`],
    })).rejects.toThrow(FirebaseBackoutError);
    await expect(service.backOut({ recordKeys: [] })).rejects.toThrow(
      FirebaseBackoutError,
    );
    await expect(service.backOut({ recordKeys: ["not-a-record-key"] }))
      .rejects.toThrow(FirebaseBackoutError);
    await expect(service.backOut({
      importRunId: "migration_import_run.synthetic_empty",
    })).rejects.toThrow(/no imported records/);
    expect(repository.state.runs).toHaveLength(0);
  });
});
