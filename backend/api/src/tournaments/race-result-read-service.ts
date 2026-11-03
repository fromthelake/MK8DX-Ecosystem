import type { ActorContext } from "../identity/types.js";
import type { TournamentProtectedValue, TournamentPublicRevision } from
  "./race-result-service.js";
import {
  TournamentValidationError,
  validateTournamentRaceResult,
  type TournamentEvidence,
  type TournamentParticipantReference,
  type TournamentPlacement,
  type TournamentRaceResultV1,
} from "./race-result-validation.js";

const resultIdPattern =
  /^tournament_race_result\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const purposePattern = /^[a-z][a-z0-9._-]{1,63}$/;

type RestrictedParticipantNamespace = Exclude<
  TournamentParticipantReference["namespace"],
  "player"
>;

export type StoredTournamentPlacement = Omit<TournamentPlacement, "participantReference"> &
Readonly<{
  playerId: string | null;
  restrictedParticipant: Readonly<{
    namespace: RestrictedParticipantNamespace;
    protectedValue: TournamentProtectedValue;
  }> | null;
}>;

export type StoredTournamentContext = Readonly<{
  contextKind: "tournament" | "stage" | "group";
  namespace: string;
  protectedValue: TournamentProtectedValue;
}>;

export type StoredTournamentEvidence = Readonly<{
  sequenceNumber: number;
  kind: TournamentEvidence["kind"];
  protectedReference: TournamentProtectedValue;
  sha256?: Uint8Array;
  mediaType?: string;
}>;

export type StoredTournamentIssue = Readonly<{
  sequenceNumber: number;
  code: string;
  protectedMessage: TournamentProtectedValue;
}>;

export type AuditedStoredTournamentRevision = Readonly<{
  publicRevision: TournamentPublicRevision;
  placements: readonly StoredTournamentPlacement[];
  protectedContext: readonly StoredTournamentContext[];
  protectedEvidence: readonly StoredTournamentEvidence[];
  protectedIssues: readonly StoredTournamentIssue[];
}>;

export type TournamentRevisionReadRequest = Readonly<{
  raceResultId: string;
  revision: number;
  accessorUserAccountId: string;
  purposeCode: string;
  accessedAtMs: number;
}>;

export interface TournamentRevisionReadRepository {
  /** Returns protected rows only after their access-audit transaction commits. */
  findRevisionAndAudit(
    request: TournamentRevisionReadRequest,
  ): Promise<AuditedStoredTournamentRevision | null>;
}

export interface TournamentRestrictedValueReader {
  decryptParticipantReference(value: TournamentProtectedValue): string;
  decryptContextReference(value: TournamentProtectedValue): string;
  decryptEvidenceReference(value: TournamentProtectedValue): string;
  decryptVerificationIssueMessage(value: TournamentProtectedValue): string;
}

export class TournamentRevisionReadError extends Error {
  public constructor(
    public readonly code: "invalid_request" | "forbidden" | "not_found" | "read_failed",
    message: string,
  ) {
    super(message);
    this.name = "TournamentRevisionReadError";
  }
}

function hex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}

export class TournamentRevisionReadService {
  public constructor(
    private readonly repository: TournamentRevisionReadRepository,
    private readonly reader: TournamentRestrictedValueReader,
    private readonly clock: Readonly<{ nowMs(): number }>,
  ) {}

  public async readRevision(
    actor: ActorContext,
    raceResultId: string,
    revision: number,
    purposeCode: string,
  ): Promise<TournamentRaceResultV1> {
    if (!resultIdPattern.test(raceResultId) || !Number.isSafeInteger(revision) ||
      revision < 1 || !purposePattern.test(purposeCode)) {
      throw new TournamentRevisionReadError("invalid_request", "read request is invalid");
    }
    if (actor.role !== "administrator") {
      throw new TournamentRevisionReadError("forbidden", "revision access is forbidden");
    }
    const stored = await this.repository.findRevisionAndAudit({
      raceResultId,
      revision,
      accessorUserAccountId: actor.userAccountId,
      purposeCode,
      accessedAtMs: this.clock.nowMs(),
    });
    if (stored === null) {
      throw new TournamentRevisionReadError("not_found", "revision was not found");
    }
    try {
      const placements = stored.placements.map((placement): TournamentPlacement => {
        if ((placement.playerId === null) === (placement.restrictedParticipant === null)) {
          throw new Error("persisted participant shape is invalid");
        }
        const { playerId, restrictedParticipant, ...publicPlacement } = placement;
        return {
          ...publicPlacement,
          participantReference: playerId === null
            ? {
                namespace: restrictedParticipant!.namespace,
                value: this.reader.decryptParticipantReference(
                  restrictedParticipant!.protectedValue,
                ),
              }
            : { namespace: "player", value: playerId },
        };
      });
      const contextReferences: Record<string, unknown> = {};
      for (const item of stored.protectedContext) {
        const key = `${item.contextKind}Reference`;
        if (Object.hasOwn(contextReferences, key)) {
          throw new Error("persisted context shape is invalid");
        }
        contextReferences[key] = {
          namespace: item.namespace,
          value: this.reader.decryptContextReference(item.protectedValue),
        };
      }
      const context = {
        ...contextReferences,
        ...(stored.publicRevision.observedStageLabel === undefined ? {} : {
          observedStageLabel: stored.publicRevision.observedStageLabel,
        }),
        ...(stored.publicRevision.observedGroupLabel === undefined ? {} : {
          observedGroupLabel: stored.publicRevision.observedGroupLabel,
        }),
      } as NonNullable<TournamentRaceResultV1["context"]>;
      const evidence = stored.protectedEvidence.map((item, index): TournamentEvidence => {
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
      const issues = stored.protectedIssues.map((item, index) => {
        if (item.sequenceNumber !== index + 1) {
          throw new Error("persisted issue shape is invalid");
        }
        return {
          code: item.code,
          message: this.reader.decryptVerificationIssueMessage(item.protectedMessage),
        };
      });
      const { observedStageLabel: _stage, observedGroupLabel: _group,
        verification, ...publicRevision } = stored.publicRevision;
      const result: TournamentRaceResultV1 = {
        ...publicRevision,
        placements,
        ...(Object.keys(context).length === 0 ? {} : { context }),
        ...(evidence.length === 0 ? {} : { evidence }),
        ...(verification === undefined ? {} : {
          verification: {
            ...verification,
            ...(issues.length === 0 ? {} : { issues }),
          },
        }),
      };
      validateTournamentRaceResult(result);
      return result;
    } catch (error) {
      if (error instanceof Error || error instanceof TournamentValidationError) {
        throw new TournamentRevisionReadError("read_failed", "revision could not be read");
      }
      throw error;
    }
  }
}
