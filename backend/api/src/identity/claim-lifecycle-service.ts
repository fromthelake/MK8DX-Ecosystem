import type {
  AccountStatus,
  ActorContext,
  ClaimStatus,
  DisputeStatus,
} from "./types.js";

const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const playerClaimIdPattern = /^player_claim\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const userAccountIdPattern = /^user_account\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const evidenceIdPattern = /^restricted_evidence\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const reviewIdPattern = /^restricted_review\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const reasonCodePattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export type ClaimLifecycleErrorCode =
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid_command"
  | "invalid_transition";

export class ClaimLifecycleError extends Error {
  public constructor(
    public readonly code: ClaimLifecycleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ClaimLifecycleError";
  }
}

export type ClaimSnapshot = Readonly<{
  playerClaimId: string;
  playerId: string;
  userAccountId: string;
  claimStatus: ClaimStatus;
  disputeStatus: DisputeStatus;
  revision: number;
  lastSequence: number;
}>;

export type ClaimLifecycleEventType =
  | "claim_requested"
  | "review_started"
  | "claim_verified"
  | "claim_rejected"
  | "claim_released"
  | "claim_revoked"
  | "dispute_opened"
  | "dispute_resolved";

/** Who acted on a claim; a Director reviews claims on Players from their own Tournaments (ADR-0216). */
export type ClaimActorType = "requesting_account" | "administrator" | "director";

export type ClaimLifecycleEventInput = Readonly<{
  sequence: number;
  eventType: ClaimLifecycleEventType;
  actorType: ClaimActorType;
  actorUserAccountId: string;
  occurredAtMs: number;
  evidenceIds: readonly string[];
  reasonCode?: string;
  privateReviewReference?: string;
}>;

export type EvidenceAccessActor = Readonly<{
  actorType: "requesting_account" | "administrator";
  userAccountId: string;
}>;

export type ClaimNoteRole = "requester" | "reviewer";
export type ClaimNoteKind = "request" | "question" | "reply" | "decision";

/** A short message between the person asking and the claim's reviewers (ADR-0216 section 3). */
export type ClaimNoteInput = Readonly<{
  playerClaimId: string;
  authorUserAccountId: string;
  authorRole: ClaimNoteRole;
  noteKind: ClaimNoteKind;
  body: string;
  createdAtMs: number;
}>;

export type CreateClaimInput = Readonly<{
  snapshot: ClaimSnapshot;
  evidenceIds: readonly string[];
  initialEvent: ClaimLifecycleEventInput;
  createdAtMs: number;
}>;

export type AppendClaimEventInput = Readonly<{
  playerClaimId: string;
  expectedRevision: number;
  nextSnapshot: ClaimSnapshot;
  event: ClaimLifecycleEventInput;
}>;

export interface ClaimWriteTransaction {
  findHumanPlayerStatus(playerId: string): Promise<"active" | "archived" | null>;
  findUserAccountStatus(userAccountId: string): Promise<AccountStatus | null>;
  findClaimForUpdate(playerClaimId: string): Promise<ClaimSnapshot | null>;
  hasVerifiedClaimForPlayer(playerId: string): Promise<boolean>;
  /**
   * A Tournament in which `playerId` met a Player this account already owns through a verified claim, or
   * null. Two competitors in one event are two people, so such a pair never belongs to one account
   * (ADR-0178 section 3); current Tournaments, legacy races and history editions all count.
   */
  findTournamentSharedWithAccountPlayers(userAccountId: string, playerId: string): Promise<string | null>;
  canUseEvidenceReferences(
    actor: EvidenceAccessActor,
    evidenceIds: readonly string[],
  ): Promise<boolean>;
  /**
   * Whether this account directs a Tournament in which the Player took part. Legacy and history
   * editions have no Director, so they never count (ADR-0216 section 1).
   */
  isDirectorForPlayer(userAccountId: string, playerId: string): Promise<boolean>;
  createClaim(input: CreateClaimInput): Promise<void>;
  appendClaimEvent(input: AppendClaimEventInput): Promise<void>;
  addClaimNote(input: ClaimNoteInput): Promise<void>;
}

export interface ClaimWriteRepository {
  transaction<T>(work: (transaction: ClaimWriteTransaction) => Promise<T>): Promise<T>;
}

export interface ClaimIdGenerator {
  newPlayerClaimId(): string;
  newRestrictedReviewId(): string;
}

export interface Clock {
  nowMs(): number;
}

export type RequestClaimCommand = Readonly<{
  playerId: string;
  evidenceIds: readonly string[];
  /** What the person asking tells the reviewer, for example where they played. */
  note?: string;
}>;

export type AdministratorClaimAction =
  | "start_review"
  | "verify"
  | "reject"
  | "release"
  | "revoke"
  | "resolve_dispute"
  | "request_information";

export type AdministratorClaimCommand = Readonly<{
  playerClaimId: string;
  action: AdministratorClaimAction;
  evidenceIds?: readonly string[];
  reasonCode?: string;
  /** A note to the person asking; required when asking for more information. */
  note?: string;
}>;

/** The claim after a reviewer's action, and the role the reviewer acted in. */
export type ReviewOutcome = ClaimSnapshot & Readonly<{ reviewerRole: "administrator" | "director" }>;

export type ClaimNoteCommand = Readonly<{
  playerClaimId: string;
  note: string;
}>;

export type ReleaseOwnClaimCommand = Readonly<{
  playerClaimId: string;
  note?: string;
}>;

export type OpenDisputeCommand = Readonly<{
  playerClaimId: string;
  evidenceIds?: readonly string[];
  reasonCode?: string;
}>;

type AdminTransition = Readonly<{
  requiredStatus?: ClaimStatus;
  allowedStatuses?: ReadonlySet<ClaimStatus>;
  nextStatus?: ClaimStatus;
  eventType: ClaimLifecycleEventType;
}>;

const adminTransitions: Readonly<Record<AdministratorClaimAction, AdminTransition>> = {
  start_review: {
    requiredStatus: "requested",
    nextStatus: "under_review",
    eventType: "review_started",
  },
  verify: {
    requiredStatus: "under_review",
    nextStatus: "verified",
    eventType: "claim_verified",
  },
  reject: {
    requiredStatus: "under_review",
    nextStatus: "rejected",
    eventType: "claim_rejected",
  },
  release: {
    allowedStatuses: new Set(["requested", "under_review", "verified"]),
    nextStatus: "released",
    eventType: "claim_released",
  },
  revoke: {
    requiredStatus: "verified",
    nextStatus: "revoked",
    eventType: "claim_revoked",
  },
  resolve_dispute: {
    eventType: "dispute_resolved",
  },
  // Moves a fresh request under review; a claim already under review only gets the question.
  request_information: {
    allowedStatuses: new Set(["requested", "under_review"]),
    nextStatus: "under_review",
    eventType: "review_started",
  },
};

/**
 * The reviewer presses a button with a plain reason; the audit code is derived from it (ADR-0216
 * section 2). A typed reason still wins where the API gives one.
 */
const defaultReasonCodes: Partial<Readonly<Record<AdministratorClaimAction, string>>> = {
  verify: "identity_confirmed",
  reject: "not_this_person",
  revoke: "linked_by_mistake",
};

/** Revoke reasons a reviewer may give (ADR-0216 section 2). */
export const revokeReasonCodes: ReadonlySet<string> = new Set([
  "linked_by_mistake",
  "account_misuse",
  "person_asked",
]);

const noteMaxCharacters = 500;

function validateNote(value: string | undefined, required: boolean): string | undefined {
  if (value === undefined || value.trim() === "") {
    if (required) {
      throw new ClaimLifecycleError("invalid_command", "note is required");
    }
    return undefined;
  }
  // Line breaks stay; other control characters do not belong in a note.
  const note = value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim();
  if (note === "" || [...note].length > noteMaxCharacters) {
    throw new ClaimLifecycleError("invalid_command", `note must be 1 to ${noteMaxCharacters} characters`);
  }
  return note;
}

function validateEvidenceIds(values: readonly string[] | undefined): readonly string[] {
  const evidenceIds = values ?? [];
  if (
    evidenceIds.some((value) => !evidenceIdPattern.test(value)) ||
    new Set(evidenceIds).size !== evidenceIds.length
  ) {
    throw new ClaimLifecycleError(
      "invalid_command",
      "evidence references must be unique restricted_evidence.* identifiers",
    );
  }
  return [...evidenceIds];
}

/**
 * One verified claim per Player; an account may own several Players, never two competitors of one
 * Tournament (ADR-0178). Said per side, because the two are fixed differently.
 */
async function refuseOccupiedOrSharedTournament(
  transaction: ClaimWriteTransaction,
  userAccountId: string,
  playerId: string,
): Promise<void> {
  if (await transaction.hasVerifiedClaimForPlayer(playerId)) {
    throw new ClaimLifecycleError("conflict", "this Player is already linked to an account");
  }
  const shared = await transaction.findTournamentSharedWithAccountPlayers(userAccountId, playerId);
  if (shared !== null) {
    throw new ClaimLifecycleError(
      "conflict",
      `this account already owns a Player who raced against this Player in ${shared}`,
    );
  }
}

function validateReasonCode(value: string | undefined): string | undefined {
  if (value !== undefined && !reasonCodePattern.test(value)) {
    throw new ClaimLifecycleError("invalid_command", "reasonCode is invalid");
  }
  return value;
}

function requireAccountActor(
  actor: ActorContext,
  requiredRole: "account" | "administrator",
): string {
  if (actor.role !== requiredRole) {
    throw new ClaimLifecycleError("forbidden", `${requiredRole} actor required`);
  }
  return actor.userAccountId;
}

function requireClaimId(value: string): void {
  if (!playerClaimIdPattern.test(value)) {
    throw new ClaimLifecycleError("invalid_command", "playerClaimId is invalid");
  }
}

function requireReviewId(value: string): void {
  if (!reviewIdPattern.test(value)) {
    throw new ClaimLifecycleError(
      "invalid_command",
      "privateReviewReference is invalid",
    );
  }
}

function nextSnapshot(
  current: ClaimSnapshot,
  claimStatus: ClaimStatus = current.claimStatus,
  disputeStatus: DisputeStatus = current.disputeStatus,
): ClaimSnapshot {
  return {
    ...current,
    claimStatus,
    disputeStatus,
    revision: current.revision + 1,
    lastSequence: current.lastSequence + 1,
  };
}

export class ClaimLifecycleService {
  public constructor(
    private readonly repository: ClaimWriteRepository,
    private readonly idGenerator: ClaimIdGenerator,
    private readonly clock: Clock,
  ) {}

  public async requestClaim(
    actor: ActorContext,
    command: RequestClaimCommand,
  ): Promise<ClaimSnapshot> {
    // Administrators claim their own Player through the same self-service
    // flow (the first owner-administrator is the canonical example), so the
    // requesting actor may be a plain account or an administrator; the claim
    // always binds to the actor's own user account.
    if (actor.role !== "account" && actor.role !== "administrator") {
      throw new ClaimLifecycleError("forbidden", "account actor required");
    }
    const userAccountId = actor.userAccountId;
    if (!playerIdPattern.test(command.playerId)) {
      throw new ClaimLifecycleError("invalid_command", "playerId is invalid");
    }
    const evidenceIds = validateEvidenceIds(command.evidenceIds);
    const note = validateNote(command.note, false);
    const playerClaimId = this.idGenerator.newPlayerClaimId();
    requireClaimId(playerClaimId);
    const occurredAtMs = this.clock.nowMs();

    return this.repository.transaction(async (transaction) => {
      if (
        !(await transaction.canUseEvidenceReferences(
          { actorType: "requesting_account", userAccountId },
          evidenceIds,
        ))
      ) {
        throw new ClaimLifecycleError("forbidden", "restricted evidence is not accessible");
      }
      const [playerStatus, accountStatus] = await Promise.all([
        transaction.findHumanPlayerStatus(command.playerId),
        transaction.findUserAccountStatus(userAccountId),
      ]);
      if (playerStatus === null || accountStatus === null) {
        throw new ClaimLifecycleError("not_found", "claim target was not found");
      }
      if (playerStatus !== "active" || accountStatus !== "active") {
        throw new ClaimLifecycleError("conflict", "claim target is not active");
      }
      await refuseOccupiedOrSharedTournament(transaction, userAccountId, command.playerId);

      const snapshot: ClaimSnapshot = {
        playerClaimId,
        playerId: command.playerId,
        userAccountId,
        claimStatus: "requested",
        disputeStatus: "none",
        revision: 1,
        lastSequence: 1,
      };
      await transaction.createClaim({
        snapshot,
        evidenceIds,
        createdAtMs: occurredAtMs,
        initialEvent: {
          sequence: 1,
          eventType: "claim_requested",
          actorType: "requesting_account",
          actorUserAccountId: userAccountId,
          occurredAtMs,
          evidenceIds,
        },
      });
      if (note !== undefined) {
        await transaction.addClaimNote({
          playerClaimId,
          authorUserAccountId: userAccountId,
          authorRole: "requester",
          noteKind: "request",
          body: note,
          createdAtMs: occurredAtMs,
        });
      }
      return snapshot;
    });
  }

  /**
   * Links a Player to somebody else's account, decided by an administrator.
   *
   * The self-service flow deliberately binds a claim to the *requesting*
   * account, which is right when a Player claims themselves. It cannot express
   * the owner reconnecting people who already existed before this ecosystem: a
   * returning Player should be able to sign in with the address they always
   * used and find their history, rather than build a second identity beside
   * it.
   *
   * This is an administrator decision, so it is recorded as one: the claim is
   * created already verified, its first lifecycle event is `claim_verified`
   * with an administrator actor and a reason code, and the account it binds to
   * is stated explicitly rather than taken from whoever is signed in. It is
   * reversible through the ordinary `revoke` action.
   *
   * One verified claim per Player still holds. An account may own several Players (a Time Trial
   * identity and a Tournament identity recorded separately, ADR-0178), but never two that met in
   * the same Tournament. Linking never merges Players: each keeps its own history and rating.
   */
  public async administratorLink(
    actor: ActorContext,
    command: Readonly<{
      userAccountId: string;
      playerId: string;
      reasonCode: string;
      evidenceIds?: readonly string[];
    }>,
  ): Promise<ClaimSnapshot> {
    const administratorAccountId = requireAccountActor(actor, "administrator");
    if (!playerIdPattern.test(command.playerId)) {
      throw new ClaimLifecycleError("invalid_command", "playerId is invalid");
    }
    if (!userAccountIdPattern.test(command.userAccountId)) {
      throw new ClaimLifecycleError("invalid_command", "userAccountId is invalid");
    }
    // A link decided for somebody else always says why, so the reason is
    // required here rather than optional as it is on the review actions.
    const reasonCode = validateReasonCode(command.reasonCode);
    if (reasonCode === undefined) {
      throw new ClaimLifecycleError("invalid_command", "reasonCode is required");
    }
    const evidenceIds = validateEvidenceIds(command.evidenceIds);
    const playerClaimId = this.idGenerator.newPlayerClaimId();
    requireClaimId(playerClaimId);
    const occurredAtMs = this.clock.nowMs();

    return this.repository.transaction(async (transaction) => {
      if (
        !(await transaction.canUseEvidenceReferences(
          { actorType: "administrator", userAccountId: administratorAccountId },
          evidenceIds,
        ))
      ) {
        throw new ClaimLifecycleError("forbidden", "restricted evidence is not accessible");
      }
      const [playerStatus, accountStatus] = await Promise.all([
        transaction.findHumanPlayerStatus(command.playerId),
        transaction.findUserAccountStatus(command.userAccountId),
      ]);
      if (playerStatus === null || accountStatus === null) {
        throw new ClaimLifecycleError("not_found", "claim target was not found");
      }
      if (playerStatus !== "active" || accountStatus !== "active") {
        throw new ClaimLifecycleError("conflict", "claim target is not active");
      }
      await refuseOccupiedOrSharedTournament(transaction, command.userAccountId, command.playerId);

      const snapshot: ClaimSnapshot = {
        playerClaimId,
        playerId: command.playerId,
        userAccountId: command.userAccountId,
        claimStatus: "verified",
        disputeStatus: "none",
        revision: 1,
        lastSequence: 1,
      };
      await transaction.createClaim({
        snapshot,
        evidenceIds,
        createdAtMs: occurredAtMs,
        initialEvent: {
          sequence: 1,
          eventType: "claim_verified",
          actorType: "administrator",
          actorUserAccountId: administratorAccountId,
          occurredAtMs,
          evidenceIds,
          reasonCode,
        },
      });
      return snapshot;
    });
  }

  /**
   * A reviewer's decision on a claim. Administrators review every claim; a Director reviews claims on
   * Players who took part in a Tournament they direct, but never their own (ADR-0216 section 1). The
   * audit records which role decided.
   */
  public async administratorAction(
    actor: ActorContext,
    command: AdministratorClaimCommand,
  ): Promise<ReviewOutcome> {
    if (actor.role !== "administrator" && actor.role !== "account") {
      throw new ClaimLifecycleError("forbidden", "administrator or Director required");
    }
    const reviewerAccountId = actor.userAccountId;
    requireClaimId(command.playerClaimId);
    const evidenceIds = validateEvidenceIds(command.evidenceIds);
    const reasonCode = validateReasonCode(command.reasonCode) ?? defaultReasonCodes[command.action];
    if (command.action === "revoke" && reasonCode !== undefined && !revokeReasonCodes.has(reasonCode)) {
      throw new ClaimLifecycleError("invalid_command", "revoke reason is not one of the offered reasons");
    }
    const note = validateNote(command.note, command.action === "request_information");
    const transition = adminTransitions[command.action];
    const occurredAtMs = this.clock.nowMs();

    return this.repository.transaction(async (transaction) => {
      const current = await transaction.findClaimForUpdate(command.playerClaimId);
      if (current === null) {
        throw new ClaimLifecycleError("not_found", "PlayerClaim was not found");
      }
      let reviewerRole: "administrator" | "director" = "administrator";
      if (actor.role !== "administrator") {
        // A Director never decides their own claim, and attaches no restricted evidence.
        if (
          current.userAccountId === reviewerAccountId ||
          !(await transaction.isDirectorForPlayer(reviewerAccountId, current.playerId))
        ) {
          throw new ClaimLifecycleError("forbidden", "administrator or Director required");
        }
        if (evidenceIds.length > 0 || command.action === "resolve_dispute") {
          throw new ClaimLifecycleError("forbidden", "administrator required");
        }
        reviewerRole = "director";
      }
      if (
        !(await transaction.canUseEvidenceReferences(
          {
            actorType: "administrator",
            userAccountId: reviewerAccountId,
          },
          evidenceIds,
        ))
      ) {
        throw new ClaimLifecycleError("forbidden", "restricted evidence is not accessible");
      }
      if (
        transition.requiredStatus !== undefined &&
        current.claimStatus !== transition.requiredStatus
      ) {
        throw new ClaimLifecycleError("invalid_transition", "claim status transition is invalid");
      }
      if (
        transition.allowedStatuses !== undefined &&
        !transition.allowedStatuses.has(current.claimStatus)
      ) {
        throw new ClaimLifecycleError("invalid_transition", "claim status transition is invalid");
      }
      if (command.action === "resolve_dispute" && current.disputeStatus !== "open") {
        throw new ClaimLifecycleError("invalid_transition", "no open dispute exists");
      }
      if (command.action !== "resolve_dispute" && current.disputeStatus === "open") {
        throw new ClaimLifecycleError(
          "invalid_transition",
          "open dispute must be resolved before another status transition",
        );
      }
      if (command.action === "verify") {
        await refuseOccupiedOrSharedTournament(transaction, current.userAccountId, current.playerId);
      }

      // A question on a claim already under review changes nothing but the conversation.
      const changesStatus = !(command.action === "request_information" && current.claimStatus === "under_review");
      let updated = current;
      if (changesStatus) {
        const privateReviewReference = this.idGenerator.newRestrictedReviewId();
        requireReviewId(privateReviewReference);
        updated = nextSnapshot(
          current,
          transition.nextStatus ?? current.claimStatus,
          command.action === "resolve_dispute" ? "resolved" : current.disputeStatus,
        );
        await transaction.appendClaimEvent({
          playerClaimId: current.playerClaimId,
          expectedRevision: current.revision,
          nextSnapshot: updated,
          event: {
            sequence: updated.lastSequence,
            eventType: transition.eventType,
            actorType: reviewerRole,
            actorUserAccountId: reviewerAccountId,
            occurredAtMs,
            evidenceIds,
            privateReviewReference,
            ...(reasonCode === undefined ? {} : { reasonCode }),
          },
        });
      }
      if (note !== undefined) {
        await transaction.addClaimNote({
          playerClaimId: current.playerClaimId,
          authorUserAccountId: reviewerAccountId,
          authorRole: "reviewer",
          noteKind: command.action === "request_information" ? "question" : "decision",
          body: note,
          createdAtMs: occurredAtMs,
        });
      }
      return { ...updated, reviewerRole };
    });
  }

  /**
   * "This is not me": an account gives up its own claim, whether still asked for or already linked
   * (ADR-0216 section 4). The Player keeps its nights, rating and results.
   */
  public async releaseOwnClaim(
    actor: ActorContext,
    command: ReleaseOwnClaimCommand,
  ): Promise<ClaimSnapshot> {
    if (actor.role !== "account" && actor.role !== "administrator") {
      throw new ClaimLifecycleError("forbidden", "claim owner required");
    }
    requireClaimId(command.playerClaimId);
    const note = validateNote(command.note, false);
    const occurredAtMs = this.clock.nowMs();

    return this.repository.transaction(async (transaction) => {
      const current = await transaction.findClaimForUpdate(command.playerClaimId);
      if (current === null || current.userAccountId !== actor.userAccountId) {
        throw new ClaimLifecycleError("not_found", "PlayerClaim was not found");
      }
      if (!adminTransitions.release.allowedStatuses?.has(current.claimStatus)) {
        throw new ClaimLifecycleError("invalid_transition", "claim status transition is invalid");
      }
      if (current.disputeStatus === "open") {
        throw new ClaimLifecycleError(
          "invalid_transition",
          "open dispute must be resolved before another status transition",
        );
      }
      const updated = nextSnapshot(current, "released");
      await transaction.appendClaimEvent({
        playerClaimId: current.playerClaimId,
        expectedRevision: current.revision,
        nextSnapshot: updated,
        event: {
          sequence: updated.lastSequence,
          eventType: "claim_released",
          actorType: "requesting_account",
          actorUserAccountId: actor.userAccountId,
          occurredAtMs,
          evidenceIds: [],
          reasonCode: "account_released",
        },
      });
      if (note !== undefined) {
        await transaction.addClaimNote({
          playerClaimId: current.playerClaimId,
          authorUserAccountId: actor.userAccountId,
          authorRole: "requester",
          noteKind: "reply",
          body: note,
          createdAtMs: occurredAtMs,
        });
      }
      return updated;
    });
  }

  /** The person asking answers a reviewer's question, or adds to their request, while it is open. */
  public async replyToClaim(
    actor: ActorContext,
    command: ClaimNoteCommand,
  ): Promise<ClaimSnapshot> {
    if (actor.role !== "account" && actor.role !== "administrator") {
      throw new ClaimLifecycleError("forbidden", "claim owner required");
    }
    requireClaimId(command.playerClaimId);
    const note = validateNote(command.note, true) as string;
    const occurredAtMs = this.clock.nowMs();

    return this.repository.transaction(async (transaction) => {
      const current = await transaction.findClaimForUpdate(command.playerClaimId);
      if (current === null || current.userAccountId !== actor.userAccountId) {
        throw new ClaimLifecycleError("not_found", "PlayerClaim was not found");
      }
      if (current.claimStatus !== "requested" && current.claimStatus !== "under_review") {
        throw new ClaimLifecycleError("invalid_transition", "this claim is no longer open");
      }
      await transaction.addClaimNote({
        playerClaimId: current.playerClaimId,
        authorUserAccountId: actor.userAccountId,
        authorRole: "requester",
        noteKind: "reply",
        body: note,
        createdAtMs: occurredAtMs,
      });
      return current;
    });
  }

  public async openDispute(
    actor: ActorContext,
    command: OpenDisputeCommand,
  ): Promise<ClaimSnapshot> {
    requireClaimId(command.playerClaimId);
    if (actor.role !== "account" && actor.role !== "administrator") {
      throw new ClaimLifecycleError("forbidden", "claim owner or administrator required");
    }
    const evidenceIds = validateEvidenceIds(command.evidenceIds);
    const reasonCode = validateReasonCode(command.reasonCode);
    const occurredAtMs = this.clock.nowMs();

    return this.repository.transaction(async (transaction) => {
      const current = await transaction.findClaimForUpdate(command.playerClaimId);
      if (current === null) {
        throw new ClaimLifecycleError("not_found", "PlayerClaim was not found");
      }
      if (actor.role === "account" && actor.userAccountId !== current.userAccountId) {
        throw new ClaimLifecycleError("forbidden", "claim owner or administrator required");
      }
      if (
        !(await transaction.canUseEvidenceReferences(
          {
            actorType:
              actor.role === "administrator"
                ? "administrator"
                : "requesting_account",
            userAccountId: actor.userAccountId,
          },
          evidenceIds,
        ))
      ) {
        throw new ClaimLifecycleError("forbidden", "restricted evidence is not accessible");
      }
      if (
        !new Set<ClaimStatus>(["verified", "rejected"]).has(current.claimStatus) ||
        current.disputeStatus === "open"
      ) {
        throw new ClaimLifecycleError("invalid_transition", "claim cannot open a dispute");
      }
      const updated = nextSnapshot(current, current.claimStatus, "open");
      await transaction.appendClaimEvent({
        playerClaimId: current.playerClaimId,
        expectedRevision: current.revision,
        nextSnapshot: updated,
        event: {
          sequence: updated.lastSequence,
          eventType: "dispute_opened",
          actorType: actor.role === "administrator" ? "administrator" : "requesting_account",
          actorUserAccountId: actor.userAccountId,
          occurredAtMs,
          evidenceIds,
          ...(reasonCode === undefined ? {} : { reasonCode }),
        },
      });
      return updated;
    });
  }
}
