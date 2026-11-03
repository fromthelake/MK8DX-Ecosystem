import {
  TimeTrialSubmissionError,
  type ProtectedLookupValue,
  type ProtectedTimeTrialEvidence,
  type ProtectedValue,
  type TimeTrialAssetCatalog,
  type TimeTrialSensitiveValueProtector,
  type TimeTrialWriteTransaction,
} from "../timetrials/submission-service.js";
import {
  planCanonicalSha256,
  validateFirebaseImportPlan,
  type FirebaseImportPlanRecord,
} from "./firebase-import-plan.js";

const runIdPattern = /^migration_import_run\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const keyVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type FirebaseImportOutcome =
  | "imported"
  | "skipped_already_imported"
  | "failed_stale_player_revision"
  | "failed_player_not_found"
  | "failed_candidate_conflict"
  | "failed_revision_conflict"
  | "failed_legacy_owner_conflict"
  | "failed_persistence";

export type FirebaseImportProvenance = Readonly<{
  recordKey: string;
  candidateSha256: string;
  recordKind: "reviewed_player" | "system_reference";
  legacyVisible: boolean | null;
  resolutionId: string | null;
  administratorGrantId: string | null;
  reasonCode: string | null;
  reviewedAtMs: number | null;
  expectedPlayerRevision: number | null;
  targetPlayerId: string | null;
}>;

export type FirebaseImportCheckpointState = Readonly<{
  importRecordId: number;
  candidateSha256: string;
  importStatus: "imported" | "failed" | "backed_out";
  attemptCount: number;
}>;

export interface FirebaseImportTransaction extends TimeTrialWriteTransaction {
  findImportRecordForUpdate(
    recordKey: string,
  ): Promise<FirebaseImportCheckpointState | null>;
  findActiveHumanPlayerRevisionForUpdate(playerId: string): Promise<number | null>;
  ensureLegacyOwnerIdentifier(input: Readonly<{
    protectedOwner: ProtectedLookupValue;
    targetPlayerId: string;
    nowMs: number;
  }>): Promise<number | "conflict">;
  findRevisionInternalId(submissionId: string, revision: number): Promise<number>;
  markImported(input: Readonly<{
    existing: FirebaseImportCheckpointState | null;
    provenance: FirebaseImportProvenance;
    legacyIdentifierId: number | null;
    revisionInternalId: number;
    nowMs: number;
  }>): Promise<void>;
  appendAttempt(input: Readonly<{
    existing: FirebaseImportCheckpointState;
    outcome: "skipped_already_imported" | "failed_candidate_conflict";
    candidateSha256: string;
    nowMs: number;
  }>): Promise<void>;
}

export interface FirebaseImportRepository {
  createRun(input: Readonly<{
    publicId: string;
    planSha256: string;
    runnerVersion: string;
    startedAtMs: number;
  }>): Promise<void>;
  transaction<T>(
    runPublicId: string,
    work: (transaction: FirebaseImportTransaction) => Promise<T>,
  ): Promise<T>;
  recordFailure(input: Readonly<{
    runPublicId: string;
    provenance: FirebaseImportProvenance;
    outcome: Exclude<FirebaseImportOutcome, "imported" | "skipped_already_imported">;
    nowMs: number;
  }>): Promise<void>;
}

export type FirebaseImportRecordResult = Readonly<{
  recordKey: string;
  candidateSha256: string;
  outcome: FirebaseImportOutcome;
}>;

export type FirebaseImportReport = Readonly<{
  runId: string;
  planSha256: string;
  totals: Readonly<{
    planRecords: number;
    imported: number;
    skippedAlreadyImported: number;
    failed: number;
  }>;
  records: readonly FirebaseImportRecordResult[];
}>;

export class FirebaseImportError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "FirebaseImportError";
  }
}

class FirebaseImportAbort extends Error {
  public constructor(
    public readonly outcome: Exclude<
      FirebaseImportOutcome,
      "imported" | "skipped_already_imported"
    >,
  ) {
    super(`import aborted: ${outcome}`);
    this.name = "FirebaseImportAbort";
  }
}

function provenanceOf(record: FirebaseImportPlanRecord): FirebaseImportProvenance {
  if (record.recordKind === "system_reference") {
    return {
      recordKey: record.recordKey,
      candidateSha256: record.candidateSha256,
      recordKind: "system_reference",
      legacyVisible: record.legacyVisible,
      resolutionId: null,
      administratorGrantId: null,
      reasonCode: null,
      reviewedAtMs: null,
      expectedPlayerRevision: null,
      targetPlayerId: null,
    };
  }
  return {
    recordKey: record.recordKey,
    candidateSha256: record.candidateSha256,
    recordKind: "reviewed_player",
    legacyVisible: record.legacyVisible,
    resolutionId: record.resolution.resolutionId,
    administratorGrantId: record.resolution.administratorGrantId,
    reasonCode: record.resolution.reasonCode,
    reviewedAtMs: record.resolution.reviewedAtMs,
    expectedPlayerRevision: record.resolution.expectedPlayerRevision,
    targetPlayerId: record.resolution.playerId,
  };
}

function validProtectedValue(
  value: ProtectedValue,
  maximumCiphertextBytes: number,
): boolean {
  return value.ciphertext instanceof Uint8Array &&
    value.ciphertext.length >= 1 &&
    value.ciphertext.length <= maximumCiphertextBytes &&
    keyVersionPattern.test(value.encryptionKeyVersion);
}

export class FirebaseTimeTrialImportService {
  public constructor(
    private readonly repository: FirebaseImportRepository,
    private readonly assetCatalog: TimeTrialAssetCatalog,
    private readonly protector: TimeTrialSensitiveValueProtector,
    private readonly clock: Readonly<{ nowMs(): number }>,
    private readonly runIdSource: () => string,
  ) {}

  public async importPlan(planInput: unknown): Promise<FirebaseImportReport> {
    const plan = validateFirebaseImportPlan(planInput);
    for (const record of plan.records) {
      const candidate = record.candidate;
      const issues = await this.assetCatalog.validateReferences({
        trackId: candidate.trackId,
        ...(candidate.loadout === undefined ? {} : { loadout: candidate.loadout }),
        ...(candidate.countryId === undefined
          ? {}
          : { countryId: candidate.countryId }),
      });
      if (issues.length > 0) {
        throw new FirebaseImportError(
          "an import-plan candidate has invalid asset references",
        );
      }
    }
    const runId = this.runIdSource();
    if (!runIdPattern.test(runId) || runId.length > 150) {
      throw new FirebaseImportError("import run identifier is invalid");
    }
    const planSha256 = planCanonicalSha256(plan);
    const startedAtMs = this.clock.nowMs();
    if (!Number.isSafeInteger(startedAtMs) || startedAtMs < 0) {
      throw new FirebaseImportError("import clock is invalid");
    }
    await this.repository.createRun({
      publicId: runId,
      planSha256,
      runnerVersion: plan.runnerVersion,
      startedAtMs,
    });

    const records: FirebaseImportRecordResult[] = [];
    for (const record of plan.records) {
      records.push(await this.importRecord(runId, record));
    }
    const imported = records.filter((item) => item.outcome === "imported").length;
    const skipped = records.filter(
      (item) => item.outcome === "skipped_already_imported",
    ).length;
    return {
      runId,
      planSha256,
      totals: {
        planRecords: records.length,
        imported,
        skippedAlreadyImported: skipped,
        failed: records.length - imported - skipped,
      },
      records,
    };
  }

  private async importRecord(
    runId: string,
    record: FirebaseImportPlanRecord,
  ): Promise<FirebaseImportRecordResult> {
    const provenance = provenanceOf(record);
    let protectedOwner: ProtectedLookupValue;
    try {
      protectedOwner = record.recordKind === "reviewed_player"
        ? await this.protector.protectParticipantReference(
          "legacy_firebase_user",
          record.legacyOwner.value,
        )
        : await this.protector.protectParticipantReference(
          "unresolved_observation",
          record.systemReference.value,
        );
    } catch {
      return this.failClosed(runId, provenance, "failed_persistence");
    }
    if (!validProtectedValue(protectedOwner, 1024) ||
      !(protectedOwner.lookupHmac instanceof Uint8Array) ||
      protectedOwner.lookupHmac.length !== 32 ||
      !keyVersionPattern.test(protectedOwner.lookupKeyVersion)) {
      return this.failClosed(runId, provenance, "failed_persistence");
    }

    // P7-B: retained media references migrate only as protected ciphertext;
    // media bytes are never fetched, stored, or required for success.
    const protectedEvidence: ProtectedTimeTrialEvidence[] = [];
    for (const [index, evidence] of (record.candidate.evidence ?? []).entries()) {
      let protectedReference: ProtectedValue;
      try {
        protectedReference = await this.protector.protectEvidenceReference(
          evidence.reference,
        );
      } catch {
        return this.failClosed(runId, provenance, "failed_persistence");
      }
      if (!validProtectedValue(protectedReference, 2048)) {
        return this.failClosed(runId, provenance, "failed_persistence");
      }
      protectedEvidence.push({
        sequenceNumber: index + 1,
        kind: evidence.kind,
        protectedReference,
        ...(evidence.sha256 === undefined
          ? {}
          : { sha256: Uint8Array.from(Buffer.from(evidence.sha256, "hex")) }),
        ...(evidence.mediaType === undefined
          ? {}
          : { mediaType: evidence.mediaType }),
      });
    }

    try {
      const outcome = await this.repository.transaction(runId, async (tx) => {
        const nowMs = this.clock.nowMs();
        const existing = await tx.findImportRecordForUpdate(record.recordKey);
        if (existing !== null && existing.importStatus === "imported") {
          const repeated = existing.candidateSha256 === record.candidateSha256;
          await tx.appendAttempt({
            existing,
            outcome: repeated
              ? "skipped_already_imported"
              : "failed_candidate_conflict",
            candidateSha256: record.candidateSha256,
            nowMs,
          });
          return repeated
            ? ("skipped_already_imported" as const)
            : ("failed_candidate_conflict" as const);
        }

        let legacyIdentifierId: number | null = null;
        let playerId: string | null = null;
        if (record.recordKind === "reviewed_player") {
          const playerRevision = await tx.findActiveHumanPlayerRevisionForUpdate(
            record.resolution.playerId,
          );
          if (playerRevision === null) {
            throw new FirebaseImportAbort("failed_player_not_found");
          }
          if (playerRevision !== record.resolution.expectedPlayerRevision) {
            throw new FirebaseImportAbort("failed_stale_player_revision");
          }
          const ensured = await tx.ensureLegacyOwnerIdentifier({
            protectedOwner,
            targetPlayerId: record.resolution.playerId,
            nowMs,
          });
          if (ensured === "conflict") {
            throw new FirebaseImportAbort("failed_legacy_owner_conflict");
          }
          legacyIdentifierId = ensured;
          playerId = record.resolution.playerId;
        }

        const candidate = record.candidate;
        const current = await tx.findSubmissionForUpdate(candidate.submissionId);
        if (current === null) {
          if (candidate.revision !== 1) {
            throw new FirebaseImportAbort("failed_revision_conflict");
          }
          await tx.insertSubmission(
            candidate.submissionId,
            candidate.timestamps.createdAtMs,
          );
        } else if (candidate.revision !== current.latestRevision + 1) {
          throw new FirebaseImportAbort("failed_revision_conflict");
        }
        const {
          playerReference: _playerReference,
          evidence: _evidence,
          ...publicFields
        } = candidate;
        await tx.insertRevision({
          submission: publicFields,
          playerId,
          // P7-C: a system/reference identity persists as the existing
          // restricted non-human participant reference, never as a Player.
          restrictedParticipant: record.recordKind === "system_reference"
            ? { namespace: "unresolved_observation", ...protectedOwner }
            : null,
          protectedEvidence,
          // Migrated results are never auto-published; publication review and
          // legacy visibility remain separate policy decisions (P7-A).
          publicationEligibility: "explicit_review_required",
        });
        const revisionInternalId = await tx.findRevisionInternalId(
          candidate.submissionId,
          candidate.revision,
        );
        await tx.markImported({
          existing,
          provenance,
          legacyIdentifierId,
          revisionInternalId,
          nowMs,
        });
        return "imported" as const;
      });
      return {
        recordKey: record.recordKey,
        candidateSha256: record.candidateSha256,
        outcome,
      };
    } catch (error) {
      const outcome = error instanceof FirebaseImportAbort
        ? error.outcome
        : error instanceof TimeTrialSubmissionError &&
            error.code === "revision_conflict"
          ? ("failed_revision_conflict" as const)
          : ("failed_persistence" as const);
      return this.failClosed(runId, provenance, outcome);
    }
  }

  private async failClosed(
    runId: string,
    provenance: FirebaseImportProvenance,
    outcome: Exclude<FirebaseImportOutcome, "imported" | "skipped_already_imported">,
  ): Promise<FirebaseImportRecordResult> {
    await this.repository.recordFailure({
      runPublicId: runId,
      provenance,
      outcome,
      nowMs: this.clock.nowMs(),
    });
    return {
      recordKey: provenance.recordKey,
      candidateSha256: provenance.candidateSha256,
      outcome,
    };
  }
}
