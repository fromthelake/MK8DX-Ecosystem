import type { ActorContext } from "../identity/types.js";

export const NOTIFICATION_KINDS = [
  "overtaken",
  "reaction_received",
  "claim_decided",
  // A link request, delivered to every active administrator; the decision
  // still travels back to the claimant as claim_decided.
  "claim_requested",
  "result_published",
  "group_invited",
  "group_joined",
  "group_left",
  "group_removed",
  "group_role_changed",
  "world_record",
  // Player-to-Player engagement: a poke now, the games and the challenge on
  // the same rails.
  "poke",
  "rock_paper_scissors",
  "dice_roll",
  "challenge",
  // "Request to host" (ADR-0220): a request, delivered to every active
  // administrator, and its outcome back to the person who asked.
  "host_requested",
  "host_request_decided",
  // Open sign-up (ADR-0222): the outcome at closing (on the list or the waiting list), moving up
  // from the waiting list, and being taken off the list by the Director.
  "tournament_signup_selected",
  "tournament_signup_moved_up",
  "tournament_signup_removed",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type NotificationView = Readonly<{
  notificationId: string;
  kind: NotificationKind;
  actorPlayerId?: string;
  actorDisplayName?: string;
  trackId?: string;
  mode?: 150 | 200;
  groupId?: string;
  groupName?: string;
  /** The night a sign-up entry is about (ADR-0222), so the inbox can open its page. */
  tournamentId?: string;
  tournamentName?: string;
  detail?: string;
  actorTimeMs?: number;
  recipientTimeMs?: number;
  deltaMs?: number;
  recipientRank?: number;
  count: number;
  lastEventAtMs: number;
  read: boolean;
}>;

export type NotificationInbox = Readonly<{
  unreadCount: number;
  notifications: readonly NotificationView[];
}>;

/**
 * One of the events an entry counted.
 *
 * The inbox collapses on purpose - forty-nine broken World Records are one
 * line, not forty-nine - but the ones it folded away are still facts, and a
 * Player who reads "49 new World Records" is entitled to ask which.
 */
export type NotificationEventView = Readonly<{
  occurredAtMs: number;
  actorPlayerId?: string;
  actorDisplayName?: string;
  trackId?: string;
  mode?: 150 | 200;
  detail?: string;
  actorTimeMs?: number;
  recipientTimeMs?: number;
  recipientRank?: number;
}>;

export class NotificationError extends Error {
  public constructor(
    public readonly code:
      | "invalid_input"
      | "not_authenticated"
      | "unavailable",
  ) {
    super("Notifications could not be processed.");
    this.name = "NotificationError";
  }
}

export interface NotificationRepository {
  listForAccount(userAccountId: string): Promise<NotificationInbox>;
  listEventsForAccount(
    userAccountId: string,
    notificationId: string,
    limit: number,
  ): Promise<readonly NotificationEventView[]>;
  markRead(
    userAccountId: string,
    notificationIds: readonly string[] | "all",
    nowMs: number,
  ): Promise<void>;
  produceOvertaken(submissionPublicId: string, nowMs: number): Promise<void>;
  produceReactionReceived(resultPublicId: string, nowMs: number): Promise<void>;
  produceClaimRequested(
    playerClaimId: string,
    playerPublicId: string,
    nowMs: number,
    detail?: ClaimReviewerNotice,
  ): Promise<void>;
  produceClaimDecided(
    userAccountPublicId: string,
    decision: ClaimDecisionNotice,
    nowMs: number,
  ): Promise<void>;
  produceHostRequested(requestPublicId: string, nowMs: number): Promise<void>;
  produceTournamentSignup(notice: TournamentSignupNotice, nowMs: number): Promise<void>;
  produceHostRequestDecided(
    requestPublicId: string,
    userAccountPublicId: string,
    decision: HostRequestDecisionNotice,
    nowMs: number,
  ): Promise<void>;
}

/** A change of a Player's sign-up status, for the account that signed up (ADR-0222). */
export type TournamentSignupNotice = Readonly<{
  kind: "tournament_signup_selected" | "tournament_signup_moved_up" | "tournament_signup_removed";
  tournamentInternalId: number;
  recipientInternalId: number;
  detail: "selected" | "waiting" | "moved_up" | "removed";
}>;

/** What the person who asked to host hears back (ADR-0220). */
export type HostRequestDecisionNotice = "approved" | "declined";

/** What a claim's reviewers hear: a new request, or the person's reply to a question (ADR-0216). */
export type ClaimReviewerNotice = "requested" | "reply";
/** What the person asking hears about their claim (ADR-0216 section 5). */
export type ClaimDecisionNotice = "verified" | "rejected" | "info_requested" | "revoked" | "released";

export type NotificationServiceDependencies = Readonly<{
  repository: NotificationRepository;
  now?: () => number;
  // Producer failures must never break the causing product action; they
  // reach the operational log through this hook instead.
  onProducerError?: (context: string, error: unknown) => void;
}>;

const notificationIdPattern = /^[0-9]{1,19}$/;
const maximumMarkIds = 100;
// A World Record import can break at most 192 records at once, which is the
// largest aggregate the product can produce; 200 covers it with room to spare
// and keeps the response bounded.
const maximumEventsPerEntry = 200;

function accountId(actor: ActorContext): string {
  if (actor.role !== "account" && actor.role !== "administrator") {
    throw new NotificationError("not_authenticated");
  }
  return actor.userAccountId;
}

export class NotificationService {
  private readonly repository: NotificationRepository;
  private readonly now: () => number;
  private readonly onProducerError: (context: string, error: unknown) => void;

  public constructor(dependencies: NotificationServiceDependencies) {
    this.repository = dependencies.repository;
    this.now = dependencies.now ?? ((): number => Date.now());
    this.onProducerError = dependencies.onProducerError ?? ((): void => {});
  }

  public async listMine(actor: ActorContext): Promise<NotificationInbox> {
    const viewer = accountId(actor);
    try {
      return await this.repository.listForAccount(viewer);
    } catch {
      throw new NotificationError("unavailable");
    }
  }

  /**
   * What one entry counted, most recent first.
   *
   * Bounded rather than paged: an aggregate is at most a few hundred events by
   * construction, and a Player opening one wants to read it, not to page
   * through it. An entry that predates member-keeping answers with an empty
   * list, which the clients state rather than mistake for "nothing happened".
   */
  public async listEvents(
    actor: ActorContext,
    notificationId: string,
  ): Promise<readonly NotificationEventView[]> {
    const viewer = accountId(actor);
    if (!notificationIdPattern.test(notificationId)) {
      throw new NotificationError("invalid_input");
    }
    try {
      return await this.repository.listEventsForAccount(
        viewer, notificationId, maximumEventsPerEntry,
      );
    } catch {
      throw new NotificationError("unavailable");
    }
  }

  public async markRead(
    actor: ActorContext,
    notificationIds: readonly string[] | "all",
  ): Promise<void> {
    const viewer = accountId(actor);
    if (notificationIds !== "all") {
      if (notificationIds.length === 0 ||
          notificationIds.length > maximumMarkIds ||
          notificationIds.some((id) => !notificationIdPattern.test(id))) {
        throw new NotificationError("invalid_input");
      }
    }
    try {
      await this.repository.markRead(viewer, notificationIds, this.now());
    } catch {
      throw new NotificationError("unavailable");
    }
  }

  // Producers are fire-and-forget: awaited by callers that want ordering,
  // but never allowed to throw into the causing product action.

  public async notifyOvertaken(submissionPublicId: string): Promise<void> {
    try {
      await this.repository.produceOvertaken(submissionPublicId, this.now());
    } catch (error) {
      this.onProducerError("overtaken", error);
    }
  }

  public async notifyReactionReceived(resultPublicId: string): Promise<void> {
    try {
      await this.repository.produceReactionReceived(
        resultPublicId,
        this.now(),
      );
    } catch (error) {
      this.onProducerError("reaction_received", error);
    }
  }

  public async notifyClaimRequested(
    playerClaimId: string,
    playerPublicId: string,
    detail: ClaimReviewerNotice = "requested",
  ): Promise<void> {
    try {
      await this.repository.produceClaimRequested(
        playerClaimId,
        playerPublicId,
        this.now(),
        detail,
      );
    } catch (error) {
      this.onProducerError("claim_requested", error);
    }
  }

  public async notifyClaimDecided(
    userAccountPublicId: string,
    decision: ClaimDecisionNotice,
  ): Promise<void> {
    try {
      await this.repository.produceClaimDecided(
        userAccountPublicId,
        decision,
        this.now(),
      );
    } catch (error) {
      this.onProducerError("claim_decided", error);
    }
  }

  public async notifyHostRequested(requestPublicId: string): Promise<void> {
    try {
      await this.repository.produceHostRequested(requestPublicId, this.now());
    } catch (error) {
      this.onProducerError("host_requested", error);
    }
  }

  public async notifyTournamentSignup(notice: TournamentSignupNotice): Promise<void> {
    try {
      await this.repository.produceTournamentSignup(notice, this.now());
    } catch (error) {
      this.onProducerError(notice.kind, error);
    }
  }

  public async notifyHostRequestDecided(
    requestPublicId: string,
    userAccountPublicId: string,
    decision: HostRequestDecisionNotice,
  ): Promise<void> {
    try {
      await this.repository.produceHostRequestDecided(
        requestPublicId,
        userAccountPublicId,
        decision,
        this.now(),
      );
    } catch (error) {
      this.onProducerError("host_request_decided", error);
    }
  }
}
