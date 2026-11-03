import { candidateCanonicalSha256 } from "./firebase-import-plan.js";

const runIdPattern = /^migration_import_run\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const recordKeyPattern = /^firebase_record\.[a-f0-9]{32}$/;

export const FIREBASE_BACKOUT_RUNNER_VERSION =
  "firebase-timetrial-import-backout.v1";

export type FirebaseBackoutOutcome =
  | "backed_out"
  | "skipped_already_backed_out"
  | "failed_backout_published"
  | "failed_backout_superseded"
  | "failed_backout_state";

export type FirebaseBackoutRequest = Readonly<{
  importRunId?: string;
  recordKeys?: readonly string[];
}>;

export type FirebaseBackoutTarget = Readonly<{
  recordKey: string;
  importStatus: "imported" | "failed" | "backed_out";
  submissionId: string | null;
  revision: number | null;
}>;

export type FirebaseBackoutRecordState = Readonly<{
  importRecordId: number;
  recordKey: string;
  importStatus: "imported" | "failed" | "backed_out";
  attemptCount: number;
  candidateSha256: string;
  revisionInternalId: number | null;
}>;

export type FirebaseSubmissionRevisionRow = Readonly<{
  revisionInternalId: number;
  revisionNumber: number;
}>;

export interface FirebaseBackoutTransaction {
  findBackoutRecordForUpdate(
    recordKey: string,
  ): Promise<FirebaseBackoutRecordState | null>;
  lockSubmissionRevisions(
    submissionId: string,
  ): Promise<readonly FirebaseSubmissionRevisionRow[]>;
  findPublicationStateForUpdate(submissionId: string): Promise<Readonly<{
    publicationStatus: string;
    publishedEventCount: number;
  }> | null>;
  deleteRevisionWithChildren(revisionInternalId: number): Promise<void>;
  deletePublicationState(submissionId: string): Promise<void>;
  deleteSubmission(submissionId: string): Promise<void>;
  markBackedOut(
    record: FirebaseBackoutRecordState,
    nowMs: number,
  ): Promise<void>;
  appendBackoutAttempt(
    record: FirebaseBackoutRecordState,
    outcome: FirebaseBackoutOutcome,
    nowMs: number,
  ): Promise<void>;
}

export interface FirebaseBackoutRepository {
  resolveImportedRunTargets(importRunId: string): Promise<readonly string[]>;
  describeTargets(
    recordKeys: readonly string[],
  ): Promise<readonly FirebaseBackoutTarget[]>;
  createRun(input: Readonly<{
    publicId: string;
    planSha256: string;
    runnerVersion: string;
    startedAtMs: number;
  }>): Promise<void>;
  transaction<T>(
    backoutRunPublicId: string,
    work: (transaction: FirebaseBackoutTransaction) => Promise<T>,
  ): Promise<T>;
  recordRefusal(input: Readonly<{
    backoutRunPublicId: string;
    recordKey: string;
    outcome: Exclude<
      FirebaseBackoutOutcome,
      "backed_out" | "skipped_already_backed_out"
    >;
    nowMs: number;
  }>): Promise<void>;
}

export type FirebaseBackoutRecordResult = Readonly<{
  recordKey: string;
  outcome: FirebaseBackoutOutcome;
}>;

export type FirebaseBackoutReport = Readonly<{
  backoutRunId: string;
  requestSha256: string;
  totals: Readonly<{
    targetRecords: number;
    backedOut: number;
    skippedAlreadyBackedOut: number;
    failed: number;
  }>;
  records: readonly FirebaseBackoutRecordResult[];
}>;

export class FirebaseBackoutError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "FirebaseBackoutError";
  }
}

class FirebaseBackoutAbort extends Error {
  public constructor(
    public readonly outcome: Exclude<
      FirebaseBackoutOutcome,
      "backed_out" | "skipped_already_backed_out"
    >,
  ) {
    super(`backout aborted: ${outcome}`);
    this.name = "FirebaseBackoutAbort";
  }
}

export class FirebaseTimeTrialBackoutService {
  public constructor(
    private readonly repository: FirebaseBackoutRepository,
    private readonly clock: Readonly<{ nowMs(): number }>,
    private readonly runIdSource: () => string,
  ) {}

  public async backOut(
    request: FirebaseBackoutRequest,
  ): Promise<FirebaseBackoutReport> {
    const recordKeys = await this.resolveRecordKeys(request);
    const backoutRunId = this.runIdSource();
    if (!runIdPattern.test(backoutRunId) || backoutRunId.length > 141) {
      throw new FirebaseBackoutError("backout run identifier is invalid");
    }
    const requestSha256 = candidateCanonicalSha256({
      importRunId: request.importRunId ?? null,
      recordKeys,
    });
    const startedAtMs = this.clock.nowMs();
    if (!Number.isSafeInteger(startedAtMs) || startedAtMs < 0) {
      throw new FirebaseBackoutError("backout clock is invalid");
    }
    await this.repository.createRun({
      publicId: backoutRunId,
      planSha256: requestSha256,
      runnerVersion: FIREBASE_BACKOUT_RUNNER_VERSION,
      startedAtMs,
    });

    const targets = await this.repository.describeTargets(recordKeys);
    if (targets.length !== recordKeys.length ||
      targets.some((target, index) => target.recordKey !== recordKeys[index])) {
      throw new FirebaseBackoutError("backout targets could not be described");
    }
    const submissionGroups = new Map<string, FirebaseBackoutTarget[]>();
    const results = new Map<string, FirebaseBackoutOutcome>();
    for (const target of targets) {
      if (target.importStatus === "backed_out") {
        // Recorded inside the group transaction when the submission still has
        // sibling work; a fully backed-out target is confirmed idempotently.
        results.set(target.recordKey, "skipped_already_backed_out");
        continue;
      }
      if (target.importStatus !== "imported" || target.submissionId === null) {
        results.set(target.recordKey, "failed_backout_state");
        await this.repository.recordRefusal({
          backoutRunPublicId: backoutRunId,
          recordKey: target.recordKey,
          outcome: "failed_backout_state",
          nowMs: this.clock.nowMs(),
        });
        continue;
      }
      const group = submissionGroups.get(target.submissionId) ?? [];
      group.push(target);
      submissionGroups.set(target.submissionId, group);
    }

    for (const [submissionId, group] of [...submissionGroups.entries()].sort(
      ([left], [right]) => (left < right ? -1 : 1),
    )) {
      const outcome = await this.backOutSubmission(
        backoutRunId,
        submissionId,
        group,
      );
      for (const target of group) {
        results.set(target.recordKey, outcome);
      }
    }

    const records = recordKeys.map((recordKey) => ({
      recordKey,
      outcome: results.get(recordKey) as FirebaseBackoutOutcome,
    }));
    const backedOut = records.filter(
      (record) => record.outcome === "backed_out",
    ).length;
    const skipped = records.filter(
      (record) => record.outcome === "skipped_already_backed_out",
    ).length;
    return {
      backoutRunId,
      requestSha256,
      totals: {
        targetRecords: records.length,
        backedOut,
        skippedAlreadyBackedOut: skipped,
        failed: records.length - backedOut - skipped,
      },
      records,
    };
  }

  private async resolveRecordKeys(
    request: FirebaseBackoutRequest,
  ): Promise<readonly string[]> {
    const byRun = request.importRunId !== undefined;
    const byKeys = request.recordKeys !== undefined;
    if (byRun === byKeys) {
      throw new FirebaseBackoutError(
        "exactly one of an import run or explicit record keys is required",
      );
    }
    if (byRun) {
      const importRunId = request.importRunId as string;
      if (!runIdPattern.test(importRunId) || importRunId.length > 150) {
        throw new FirebaseBackoutError("import run identifier is invalid");
      }
      const keys = await this.repository.resolveImportedRunTargets(importRunId);
      if (keys.length === 0) {
        throw new FirebaseBackoutError(
          "the import run has no imported records to back out",
        );
      }
      return [...keys].sort();
    }
    const keys = request.recordKeys as readonly string[];
    if (keys.length === 0 || keys.length > 10_000 ||
      keys.some((key) => !recordKeyPattern.test(key)) ||
      new Set(keys).size !== keys.length) {
      throw new FirebaseBackoutError("explicit record keys are invalid");
    }
    return [...keys].sort();
  }

  private async backOutSubmission(
    backoutRunId: string,
    submissionId: string,
    group: readonly FirebaseBackoutTarget[],
  ): Promise<FirebaseBackoutOutcome> {
    try {
      return await this.repository.transaction(backoutRunId, async (tx) => {
        const nowMs = this.clock.nowMs();
        const records: FirebaseBackoutRecordState[] = [];
        for (const target of group) {
          const record = await tx.findBackoutRecordForUpdate(target.recordKey);
          if (record === null || record.importStatus === "failed") {
            throw new FirebaseBackoutAbort("failed_backout_state");
          }
          if (record.importStatus === "backed_out") {
            await tx.appendBackoutAttempt(
              record,
              "skipped_already_backed_out",
              nowMs,
            );
            continue;
          }
          if (record.revisionInternalId === null) {
            throw new FirebaseBackoutAbort("failed_backout_state");
          }
          records.push(record);
        }
        if (records.length === 0) {
          return "skipped_already_backed_out" as const;
        }

        const revisions = await tx.lockSubmissionRevisions(submissionId);
        const targetRevisionIds = new Set(
          records.map((record) => record.revisionInternalId as number),
        );
        // Only a complete unsuperseded migration-owned revision chain may be
        // backed out; anything else stays and requires explicit review.
        if (revisions.length !== targetRevisionIds.size ||
          revisions.some(
            (revision) => !targetRevisionIds.has(revision.revisionInternalId),
          )) {
          throw new FirebaseBackoutAbort("failed_backout_superseded");
        }

        const publication = await tx.findPublicationStateForUpdate(submissionId);
        if (publication === null) {
          throw new FirebaseBackoutAbort("failed_backout_state");
        }
        if (publication.publicationStatus !== "withheld" ||
          publication.publishedEventCount > 0) {
          throw new FirebaseBackoutAbort("failed_backout_published");
        }

        for (const record of records) {
          await tx.markBackedOut(record, nowMs);
          await tx.appendBackoutAttempt(record, "backed_out", nowMs);
        }
        await tx.deletePublicationState(submissionId);
        const orderedRevisions = [...revisions].sort(
          (left, right) => right.revisionNumber - left.revisionNumber,
        );
        // Import-created restricted evidence and system participant rows are
        // removed with their revision; a restricted access-log entry against
        // one of them makes the whole submission group fail closed instead.
        for (const revision of orderedRevisions) {
          await tx.deleteRevisionWithChildren(revision.revisionInternalId);
        }
        await tx.deleteSubmission(submissionId);
        return "backed_out" as const;
      });
    } catch (error) {
      const outcome = error instanceof FirebaseBackoutAbort
        ? error.outcome
        : ("failed_backout_state" as const);
      for (const target of group) {
        await this.repository.recordRefusal({
          backoutRunPublicId: backoutRunId,
          recordKey: target.recordKey,
          outcome,
          nowMs: this.clock.nowMs(),
        });
      }
      return outcome;
    }
  }
}
