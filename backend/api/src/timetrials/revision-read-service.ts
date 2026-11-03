import type { ActorContext } from "../identity/types.js";
import type {
  ProtectedValue,
  TimeTrialEvidence,
  TimeTrialPlayerReference,
  TimeTrialSubmissionV1,
} from "./submission-service.js";
import {
  TimeTrialSubmissionError,
  validateTimeTrialSubmission,
} from "./submission-service.js";

const submissionIdPattern =
  /^user_submission\.time\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const purposePattern = /^[a-z][a-z0-9._-]{1,63}$/;

export type StoredTimeTrialParticipant = Readonly<{
  namespace: Exclude<TimeTrialPlayerReference["namespace"], "player">;
  protectedValue: ProtectedValue;
}>;

export type StoredTimeTrialEvidence = Readonly<{
  sequenceNumber: number;
  kind: TimeTrialEvidence["kind"];
  protectedReference: ProtectedValue;
  sha256?: Uint8Array;
  mediaType?: string;
}>;

export type AuditedStoredTimeTrialRevision = Readonly<{
  publicFields: Omit<TimeTrialSubmissionV1, "playerReference" | "evidence">;
  playerId: string | null;
  restrictedParticipant: StoredTimeTrialParticipant | null;
  protectedEvidence: readonly StoredTimeTrialEvidence[];
}>;

export type TimeTrialRevisionReadRequest = Readonly<{
  submissionId: string;
  revision: number;
  accessorUserAccountId: string;
  purposeCode: string;
  accessedAtMs: number;
}>;

export interface TimeTrialRevisionReadRepository {
  /** Returns protected rows only after their access-audit transaction commits. */
  findRevisionAndAudit(
    request: TimeTrialRevisionReadRequest,
  ): Promise<AuditedStoredTimeTrialRevision | null>;
}

export interface TimeTrialRestrictedValueReader {
  decryptParticipantReference(value: ProtectedValue): string;
  decryptEvidenceReference(value: ProtectedValue): string;
}

export interface TimeTrialReadClock {
  nowMs(): number;
}

export type TimeTrialRevisionReadErrorCode =
  | "invalid_request"
  | "forbidden"
  | "not_found"
  | "read_failed";

export class TimeTrialRevisionReadError extends Error {
  public constructor(
    public readonly code: TimeTrialRevisionReadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TimeTrialRevisionReadError";
  }
}

function hex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}

function assertRequest(
  submissionId: string,
  revision: number,
  purposeCode: string,
): void {
  if (!submissionIdPattern.test(submissionId) ||
    !Number.isSafeInteger(revision) || revision < 1 ||
    !purposePattern.test(purposeCode)) {
    throw new TimeTrialRevisionReadError("invalid_request", "read request is invalid");
  }
}

export class TimeTrialRevisionReadService {
  public constructor(
    private readonly repository: TimeTrialRevisionReadRepository,
    private readonly reader: TimeTrialRestrictedValueReader,
    private readonly clock: TimeTrialReadClock,
  ) {}

  public async readRevision(
    actor: ActorContext,
    submissionId: string,
    revision: number,
    purposeCode: string,
  ): Promise<TimeTrialSubmissionV1> {
    assertRequest(submissionId, revision, purposeCode);
    if (actor.role !== "administrator") {
      throw new TimeTrialRevisionReadError("forbidden", "revision access is forbidden");
    }

    const stored = await this.repository.findRevisionAndAudit({
      submissionId,
      revision,
      accessorUserAccountId: actor.userAccountId,
      purposeCode,
      accessedAtMs: this.clock.nowMs(),
    });
    if (stored === null) {
      throw new TimeTrialRevisionReadError("not_found", "revision was not found");
    }

    try {
      if ((stored.playerId === null) === (stored.restrictedParticipant === null)) {
        throw new Error("persisted participant shape is invalid");
      }
      const playerReference: TimeTrialPlayerReference = stored.playerId === null
        ? {
            namespace: stored.restrictedParticipant!.namespace,
            value: this.reader.decryptParticipantReference(
              stored.restrictedParticipant!.protectedValue,
            ),
          }
        : { namespace: "player", value: stored.playerId };
      const evidence = stored.protectedEvidence.map((item, index): TimeTrialEvidence => {
        if (item.sequenceNumber !== index + 1 ||
          (item.sha256 !== undefined && item.sha256.length !== 32)) {
          throw new Error("persisted evidence shape is invalid");
        }
        return {
          kind: item.kind,
          reference: this.reader.decryptEvidenceReference(item.protectedReference),
          ...(item.sha256 === undefined ? {} : { sha256: hex(item.sha256) }),
          ...(item.mediaType === undefined ? {} : { mediaType: item.mediaType }),
        };
      });
      const result: TimeTrialSubmissionV1 = {
        ...stored.publicFields,
        playerReference,
        ...(evidence.length === 0 ? {} : { evidence }),
      };
      validateTimeTrialSubmission(result);
      return result;
    } catch (error) {
      if (error instanceof TimeTrialSubmissionError || error instanceof Error) {
        throw new TimeTrialRevisionReadError(
          "read_failed",
          "revision could not be read",
        );
      }
      throw error;
    }
  }
}
