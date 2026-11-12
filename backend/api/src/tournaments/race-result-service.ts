import {
  tournamentAssetReferences,
  validateTournamentRaceResult,
  type TournamentAssetReferences,
  type TournamentParticipantReference,
  type TournamentPlacement,
  type TournamentRaceResultV1,
  type TournamentVerification,
} from "./race-result-validation.js";

const keyVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type TournamentProtectedValue = Readonly<{
  ciphertext: Uint8Array;
  encryptionKeyVersion: string;
}>;

export type TournamentProtectedLookupValue = TournamentProtectedValue &
  Readonly<{
    lookupHmac: Uint8Array;
    lookupKeyVersion: string;
  }>;

export interface TournamentAssetCatalog {
  validateReferences(references: TournamentAssetReferences): Promise<readonly unknown[]>;
}

type RestrictedParticipantNamespace = Exclude<
  TournamentParticipantReference["namespace"],
  "player"
>;

export interface TournamentSensitiveValueProtector {
  protectParticipantReference(
    namespace: RestrictedParticipantNamespace,
    value: string,
  ): Promise<TournamentProtectedLookupValue>;
  protectContextReference(
    namespace: string,
    value: string,
  ): Promise<TournamentProtectedLookupValue>;
  protectEvidenceReference(reference: string): Promise<TournamentProtectedValue>;
  protectVerificationIssueMessage(message: string): Promise<TournamentProtectedValue>;
}

export type TournamentPublicRevision = Omit<
  TournamentRaceResultV1,
  "placements" | "context" | "evidence" | "verification"
> & Readonly<{
  observedStageLabel?: string;
  observedGroupLabel?: string;
  verification?: Omit<TournamentVerification, "issues">;
}>;

export type TournamentPlacementPersistenceInput = Omit<
  TournamentPlacement,
  "participantReference"
> & Readonly<{
  playerId: string | null;
  restrictedParticipant:
    | (Readonly<{ namespace: RestrictedParticipantNamespace }> &
        TournamentProtectedLookupValue)
    | null;
}>;

export type TournamentProtectedContext = Readonly<{
  contextKind: "tournament" | "stage" | "group";
  namespace: string;
}> & TournamentProtectedLookupValue;

export type TournamentProtectedEvidence = Readonly<{
  sequenceNumber: number;
  kind: NonNullable<TournamentRaceResultV1["evidence"]>[number]["kind"];
  protectedReference: TournamentProtectedValue;
  sha256?: Uint8Array;
  mediaType?: string;
}>;

export type TournamentProtectedIssue = Readonly<{
  sequenceNumber: number;
  code: string;
  protectedMessage: TournamentProtectedValue;
}>;

export type TournamentRevisionPersistenceInput = Readonly<{
  revision: TournamentPublicRevision;
  placements: readonly TournamentPlacementPersistenceInput[];
  protectedContext: readonly TournamentProtectedContext[];
  protectedEvidence: readonly TournamentProtectedEvidence[];
  protectedIssues: readonly TournamentProtectedIssue[];
}>;

export type TournamentRaceResultState = Readonly<{
  firstCreatedAtMs: number;
  latestRevision: number;
}>;

export interface TournamentWriteTransaction {
  findRaceResultForUpdate(
    raceResultId: string,
  ): Promise<TournamentRaceResultState | null>;
  findActiveHumanPlayersForUpdate(
    playerIds: readonly string[],
  ): Promise<ReadonlySet<string>>;
  insertRaceResult(raceResultId: string, firstCreatedAtMs: number): Promise<void>;
  insertRevision(input: TournamentRevisionPersistenceInput): Promise<void>;
}

export interface TournamentWriteRepository {
  transaction<T>(
    work: (transaction: TournamentWriteTransaction) => Promise<T>,
  ): Promise<T>;
}

export type TournamentResultServiceErrorCode =
  | "invalid_assets"
  | "player_not_found"
  | "revision_conflict"
  | "protection_failed";

export class TournamentResultServiceError extends Error {
  public constructor(
    public readonly code: TournamentResultServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TournamentResultServiceError";
  }
}

function validateProtectedValue(
  value: TournamentProtectedValue,
  maximumCiphertextBytes: number,
): void {
  if (!(value.ciphertext instanceof Uint8Array) || value.ciphertext.length < 1 ||
    value.ciphertext.length > maximumCiphertextBytes ||
    !keyVersionPattern.test(value.encryptionKeyVersion)) {
    throw new TournamentResultServiceError(
      "protection_failed",
      "protected Tournament value is invalid",
    );
  }
}

function validateProtectedLookup(value: TournamentProtectedLookupValue): void {
  validateProtectedValue(value, 2048);
  if (!(value.lookupHmac instanceof Uint8Array) || value.lookupHmac.length !== 32 ||
    !keyVersionPattern.test(value.lookupKeyVersion)) {
    throw new TournamentResultServiceError(
      "protection_failed",
      "protected Tournament lookup is invalid",
    );
  }
}

function sha256Bytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "hex"));
}

export class TournamentRaceResultService {
  public constructor(
    private readonly repository: TournamentWriteRepository,
    private readonly assetCatalog: TournamentAssetCatalog,
    private readonly protector: TournamentSensitiveValueProtector,
  ) {}

  /** What `submit` checks before it writes anything; callers recording several races check them all first. */
  public async check(input: TournamentRaceResultV1): Promise<void> {
    validateTournamentRaceResult(input);
    const assetIssues = await this.assetCatalog.validateReferences(
      tournamentAssetReferences(input),
    );
    if (assetIssues.length > 0) {
      throw new TournamentResultServiceError(
        "invalid_assets",
        "Tournament asset references are invalid",
      );
    }
  }

  public async submit(
    input: TournamentRaceResultV1,
  ): Promise<Readonly<{ raceResultId: string; revision: number }>> {
    await this.check(input);

    const placements: TournamentPlacementPersistenceInput[] = [];
    for (const placement of input.placements) {
      const { participantReference, ...publicPlacement } = placement;
      if (participantReference.namespace === "player") {
        placements.push({
          ...publicPlacement,
          playerId: participantReference.value,
          restrictedParticipant: null,
        });
      } else {
        const restrictedNamespace = participantReference.namespace as
          RestrictedParticipantNamespace;
        const protectedParticipant = await this.protectLookup(
          "participant reference",
          () => this.protector.protectParticipantReference(
            restrictedNamespace,
            participantReference.value,
          ),
        );
        placements.push({
          ...publicPlacement,
          playerId: null,
          restrictedParticipant: {
            namespace: restrictedNamespace,
            ...protectedParticipant,
          },
        });
      }
    }

    const protectedContext: TournamentProtectedContext[] = [];
    const contextEntries = [
      ["tournament", input.context?.tournamentReference],
      ["stage", input.context?.stageReference],
      ["group", input.context?.groupReference],
    ] as const;
    for (const [contextKind, reference] of contextEntries) {
      if (reference === undefined) {
        continue;
      }
      const protectedReference = await this.protectLookup(
        "context reference",
        () => this.protector.protectContextReference(
          reference.namespace,
          reference.value,
        ),
      );
      protectedContext.push({
        contextKind,
        namespace: reference.namespace,
        ...protectedReference,
      });
    }

    const protectedEvidence: TournamentProtectedEvidence[] = [];
    for (const [index, evidence] of (input.evidence ?? []).entries()) {
      const protectedReference = await this.protectValue(
        "evidence reference",
        () => this.protector.protectEvidenceReference(evidence.reference),
      );
      protectedEvidence.push({
        sequenceNumber: index + 1,
        kind: evidence.kind,
        protectedReference,
        ...(evidence.sha256 === undefined ? {} : { sha256: sha256Bytes(evidence.sha256) }),
        ...(evidence.mediaType === undefined ? {} : { mediaType: evidence.mediaType }),
      });
    }

    const protectedIssues: TournamentProtectedIssue[] = [];
    for (const [index, issue] of (input.verification?.issues ?? []).entries()) {
      const protectedMessage = await this.protectValue(
        "verification issue",
        () => this.protector.protectVerificationIssueMessage(issue.message),
      );
      protectedIssues.push({
        sequenceNumber: index + 1,
        code: issue.code,
        protectedMessage,
      });
    }

    const { placements: _placements, context, evidence: _evidence,
      verification, ...baseRevision } = input;
    let publicVerification: Omit<TournamentVerification, "issues"> | undefined;
    if (verification !== undefined) {
      const { issues: _issues, ...fields } = verification;
      publicVerification = fields;
    }
    const revision: TournamentPublicRevision = {
      ...baseRevision,
      ...(context?.observedStageLabel === undefined
        ? {}
        : { observedStageLabel: context.observedStageLabel }),
      ...(context?.observedGroupLabel === undefined
        ? {}
        : { observedGroupLabel: context.observedGroupLabel }),
      ...(publicVerification === undefined ? {} : { verification: publicVerification }),
    };

    return this.repository.transaction(async (transaction) => {
      const current = await transaction.findRaceResultForUpdate(input.raceResultId);
      if (current === null) {
        if (input.revision !== 1) {
          throw new TournamentResultServiceError(
            "revision_conflict",
            "a new Tournament race result must begin at revision 1",
          );
        }
      } else if (input.revision !== current.latestRevision + 1) {
        throw new TournamentResultServiceError(
          "revision_conflict",
          "Tournament race result revision is not the next revision",
        );
      }

      const requestedPlayers = placements.flatMap(
        (placement) => placement.playerId === null ? [] : [placement.playerId],
      );
      const activePlayers = await transaction.findActiveHumanPlayersForUpdate(
        requestedPlayers,
      );
      if (requestedPlayers.some((playerId) => !activePlayers.has(playerId))) {
        throw new TournamentResultServiceError(
          "player_not_found",
          "one or more active Players were not found",
        );
      }
      if (current === null) {
        await transaction.insertRaceResult(
          input.raceResultId,
          input.timestamps.createdAtMs,
        );
      }
      await transaction.insertRevision({
        revision,
        placements,
        protectedContext,
        protectedEvidence,
        protectedIssues,
      });
      return { raceResultId: input.raceResultId, revision: input.revision };
    });
  }

  private async protectLookup(
    resource: string,
    operation: () => Promise<TournamentProtectedLookupValue>,
  ): Promise<TournamentProtectedLookupValue> {
    let value: TournamentProtectedLookupValue;
    try {
      value = await operation();
    } catch {
      throw new TournamentResultServiceError(
        "protection_failed",
        `${resource} protection failed`,
      );
    }
    validateProtectedLookup(value);
    return value;
  }

  private async protectValue(
    resource: string,
    operation: () => Promise<TournamentProtectedValue>,
  ): Promise<TournamentProtectedValue> {
    let value: TournamentProtectedValue;
    try {
      value = await operation();
    } catch {
      throw new TournamentResultServiceError(
        "protection_failed",
        `${resource} protection failed`,
      );
    }
    validateProtectedValue(value, 2048);
    return value;
  }
}
