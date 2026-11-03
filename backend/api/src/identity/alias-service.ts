import type { AccountStatus, ActorContext } from "./types.js";

const aliasIdPattern = /^alias\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const sourceReferencePattern = /^source\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const reasonCodePattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export type AliasType =
  | "declared"
  | "legacy_handle"
  | "tournament_name"
  | "ocr_observation"
  | "other_observation";
export type AliasVisibility = "public" | "restricted";
export type AliasRecordStatus = "active" | "retired";
export type AliasProvenanceSourceType =
  | "player_declaration"
  | "tournament_manager"
  | "tournament_workbook"
  | "timetrial_firebase"
  | "ocr"
  | "administrator";

const aliasTypes = new Set<AliasType>([
  "declared",
  "legacy_handle",
  "tournament_name",
  "ocr_observation",
  "other_observation",
]);
const sourceTypes = new Set<AliasProvenanceSourceType>([
  "player_declaration",
  "tournament_manager",
  "tournament_workbook",
  "timetrial_firebase",
  "ocr",
  "administrator",
]);

export type AliasServiceErrorCode =
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid_command"
  | "invalid_transition";

export class AliasServiceError extends Error {
  public constructor(
    public readonly code: AliasServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AliasServiceError";
  }
}

export type AliasProvenanceInput = Readonly<{
  sourceType: AliasProvenanceSourceType;
  sourceReference: string;
  observedAtMs: number;
}>;

export type AliasSnapshot = Readonly<{
  aliasId: string;
  playerId: string;
  aliasText: string;
  aliasType: AliasType;
  visibility: AliasVisibility;
  recordStatus: AliasRecordStatus;
  revision: number;
  lastSequence: number;
  reviewedByUserAccountId: string;
  reviewedAtMs: number;
}>;

export type PublicAliasProfile = Readonly<{
  aliasId: string;
  playerId: string;
  aliasText: string;
  aliasType: AliasType;
}>;

export interface AliasReadRepository {
  findPublicAliasById(aliasId: string): Promise<PublicAliasProfile | null>;
  listPublicAliasesByPlayerId(
    playerId: string,
  ): Promise<readonly PublicAliasProfile[]>;
}

export type AliasLifecycleEventInput = Readonly<{
  sequence: number;
  eventType: "alias_created" | "visibility_changed" | "alias_retired";
  actorUserAccountId: string;
  visibilityAfter: AliasVisibility;
  recordStatusAfter: AliasRecordStatus;
  occurredAtMs: number;
  reasonCode?: string;
}>;

export type CreateAliasInput = Readonly<{
  snapshot: AliasSnapshot;
  provenance: readonly AliasProvenanceInput[];
  initialEvent: AliasLifecycleEventInput;
  createdAtMs: number;
}>;

export type AppendAliasEventInput = Readonly<{
  aliasId: string;
  expectedRevision: number;
  nextSnapshot: AliasSnapshot;
  event: AliasLifecycleEventInput;
}>;

export interface AliasWriteTransaction {
  findHumanPlayerStatus(playerId: string): Promise<"active" | "archived" | null>;
  /**
   * True when the account holds the active verified claim on that Player.
   * ADR-0178 allows an account to claim several Players, so this is asked per
   * Player rather than answered from a single owned identity.
   */
  hasVerifiedClaimOnPlayer(userAccountId: string, playerId: string): Promise<boolean>;
  findUserAccountStatus(userAccountId: string): Promise<AccountStatus | null>;
  findAliasForUpdate(aliasId: string): Promise<AliasSnapshot | null>;
  createAlias(input: CreateAliasInput): Promise<void>;
  appendAliasEvent(input: AppendAliasEventInput): Promise<void>;
}

export interface AliasWriteRepository {
  transaction<T>(work: (transaction: AliasWriteTransaction) => Promise<T>): Promise<T>;
}

export interface AliasIdGenerator {
  newAliasId(): string;
}

export interface AliasClock {
  nowMs(): number;
}

export type CreateAliasCommand = Readonly<{
  playerId: string;
  aliasText: string;
  aliasType: AliasType;
  visibility: AliasVisibility;
  provenance: readonly AliasProvenanceInput[];
}>;

export type UpdateAliasCommand = Readonly<
  | {
      aliasId: string;
      action: "set_visibility";
      visibility: AliasVisibility;
      reasonCode?: string;
    }
  | {
      aliasId: string;
      action: "retire";
      reasonCode?: string;
    }
>;

/**
 * Owner decision 2026-08-28: aliases are managed under the profile, by the
 * Player themselves as well as by an administrator. An ordinary account may
 * therefore act, but only on a Player it holds the verified claim on, and only
 * as a self-declaration - it cannot assert someone else's provenance or forge
 * an OCR observation. An administrator keeps the full vocabulary.
 */
function aliasActorAccountId(actor: ActorContext): string {
  if (actor.role !== "administrator" && actor.role !== "account") {
    throw new AliasServiceError("forbidden", "an account actor is required");
  }
  return actor.userAccountId;
}

async function requireAliasAuthority(
  transaction: AliasWriteTransaction,
  actor: ActorContext,
  actorAccountId: string,
  playerId: string,
): Promise<void> {
  if (actor.role === "administrator") { return; }
  const owns = await transaction.hasVerifiedClaimOnPlayer(actorAccountId, playerId);
  if (!owns) {
    throw new AliasServiceError(
      "forbidden",
      "only an administrator or the Player who claimed this identity may manage its aliases",
    );
  }
}

function validateAliasText(value: string): void {
  const unicodeLength = Array.from(value).length;
  if (unicodeLength < 1 || unicodeLength > 128) {
    throw new AliasServiceError("invalid_command", "aliasText is invalid");
  }
}

function validateReasonCode(value: string | undefined): string | undefined {
  if (
    value !== undefined &&
    (value.length > 64 || !reasonCodePattern.test(value))
  ) {
    throw new AliasServiceError("invalid_command", "reasonCode is invalid");
  }
  return value;
}

function validateProvenance(
  provenance: readonly AliasProvenanceInput[],
): readonly AliasProvenanceInput[] {
  if (
    provenance.length < 1 ||
    provenance.some(
      (item) =>
        !sourceTypes.has(item.sourceType) ||
        item.sourceReference.length > 255 ||
        !sourceReferencePattern.test(item.sourceReference) ||
        !Number.isSafeInteger(item.observedAtMs) ||
        item.observedAtMs < 0,
    )
  ) {
    throw new AliasServiceError(
      "invalid_command",
      "at least one privacy-safe Alias provenance item is required",
    );
  }
  return provenance.map((item) => ({ ...item }));
}

export class AliasService {
  public constructor(
    private readonly repository: AliasWriteRepository,
    private readonly idGenerator: AliasIdGenerator,
    private readonly clock: AliasClock,
  ) {}

  public async createAlias(
    actor: ActorContext,
    command: CreateAliasCommand,
  ): Promise<AliasSnapshot> {
    const administratorAccountId = aliasActorAccountId(actor);
    const selfService = actor.role !== "administrator";
    if (!playerIdPattern.test(command.playerId)) {
      throw new AliasServiceError("invalid_command", "playerId is invalid");
    }
    validateAliasText(command.aliasText);
    if (!aliasTypes.has(command.aliasType)) {
      throw new AliasServiceError("invalid_command", "aliasType is invalid");
    }
    if (command.visibility !== "public" && command.visibility !== "restricted") {
      throw new AliasServiceError("invalid_command", "visibility is invalid");
    }
    // A Player declaring their own alias states exactly that, and nothing
    // about how anyone else observed it.
    if (selfService && command.aliasType !== "declared") {
      throw new AliasServiceError(
        "forbidden",
        "an account may only declare its own alias; other Alias types are administrator-reviewed",
      );
    }
    if (selfService &&
      command.provenance.some((item) => item.sourceType !== "player_declaration")
    ) {
      throw new AliasServiceError(
        "forbidden",
        "a self-declared alias carries player_declaration provenance",
      );
    }
    const provenance = validateProvenance(command.provenance);
    const aliasId = this.idGenerator.newAliasId();
    if (!aliasIdPattern.test(aliasId)) {
      throw new AliasServiceError("invalid_command", "generated aliasId is invalid");
    }
    const occurredAtMs = this.clock.nowMs();
    if (!Number.isSafeInteger(occurredAtMs) || occurredAtMs < 0) {
      throw new AliasServiceError("conflict", "Alias clock value is invalid");
    }

    return this.repository.transaction(async (transaction) => {
      await requireAliasAuthority(transaction, actor, administratorAccountId, command.playerId);
      const [playerStatus, administratorStatus] = await Promise.all([
        transaction.findHumanPlayerStatus(command.playerId),
        transaction.findUserAccountStatus(administratorAccountId),
      ]);
      if (playerStatus === null || administratorStatus === null) {
        throw new AliasServiceError("not_found", "Alias review target was not found");
      }
      if (playerStatus !== "active" || administratorStatus !== "active") {
        throw new AliasServiceError("conflict", "Alias review target is not active");
      }
      const snapshot: AliasSnapshot = {
        aliasId,
        playerId: command.playerId,
        aliasText: command.aliasText,
        aliasType: command.aliasType,
        visibility: command.visibility,
        recordStatus: "active",
        revision: 1,
        lastSequence: 1,
        reviewedByUserAccountId: administratorAccountId,
        reviewedAtMs: occurredAtMs,
      };
      await transaction.createAlias({
        snapshot,
        provenance,
        createdAtMs: occurredAtMs,
        initialEvent: {
          sequence: 1,
          eventType: "alias_created",
          actorUserAccountId: administratorAccountId,
          visibilityAfter: command.visibility,
          recordStatusAfter: "active",
          occurredAtMs,
        },
      });
      return snapshot;
    });
  }

  public async updateAlias(
    actor: ActorContext,
    command: UpdateAliasCommand,
  ): Promise<AliasSnapshot> {
    const administratorAccountId = aliasActorAccountId(actor);
    if (!aliasIdPattern.test(command.aliasId)) {
      throw new AliasServiceError("invalid_command", "aliasId is invalid");
    }
    if (command.action !== "set_visibility" && command.action !== "retire") {
      throw new AliasServiceError("invalid_command", "Alias action is invalid");
    }
    const reasonCode = validateReasonCode(command.reasonCode);
    if (
      command.action === "set_visibility" &&
      command.visibility !== "public" &&
      command.visibility !== "restricted"
    ) {
      throw new AliasServiceError("invalid_command", "visibility is invalid");
    }
    const occurredAtMs = this.clock.nowMs();
    if (!Number.isSafeInteger(occurredAtMs) || occurredAtMs < 0) {
      throw new AliasServiceError("conflict", "Alias clock value is invalid");
    }

    return this.repository.transaction(async (transaction) => {
      const [current, administratorStatus] = await Promise.all([
        transaction.findAliasForUpdate(command.aliasId),
        transaction.findUserAccountStatus(administratorAccountId),
      ]);
      if (current === null || administratorStatus === null) {
        throw new AliasServiceError("not_found", "Alias was not found");
      }
      if (administratorStatus !== "active") {
        throw new AliasServiceError("conflict", "administrator account is not active");
      }
      await requireAliasAuthority(transaction, actor, administratorAccountId, current.playerId);
      if (current.recordStatus !== "active") {
        throw new AliasServiceError("invalid_transition", "retired Alias is immutable");
      }
      if (
        command.action === "set_visibility" &&
        current.visibility === command.visibility
      ) {
        throw new AliasServiceError(
          "invalid_transition",
          "Alias visibility is already set",
        );
      }
      const visibility =
        command.action === "set_visibility" ? command.visibility : current.visibility;
      const recordStatus = command.action === "retire" ? "retired" : "active";
      const updated: AliasSnapshot = {
        ...current,
        visibility,
        recordStatus,
        revision: current.revision + 1,
        lastSequence: current.lastSequence + 1,
        reviewedByUserAccountId: administratorAccountId,
        reviewedAtMs: occurredAtMs,
      };
      await transaction.appendAliasEvent({
        aliasId: current.aliasId,
        expectedRevision: current.revision,
        nextSnapshot: updated,
        event: {
          sequence: updated.lastSequence,
          eventType:
            command.action === "set_visibility"
              ? "visibility_changed"
              : "alias_retired",
          actorUserAccountId: administratorAccountId,
          visibilityAfter: visibility,
          recordStatusAfter: recordStatus,
          occurredAtMs,
          ...(reasonCode === undefined ? {} : { reasonCode }),
        },
      });
      return updated;
    });
  }
}
