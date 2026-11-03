import type { ActorContext } from "../identity/types.js";
import { TournamentOperatorCapabilityError } from "./tournament-operator-capability-service.js";

/**
 * "Request to host" (ADR-0220). A signed-in account that is not a Director asks the administrators
 * to let it host Tournaments; an administrator approves (the existing tournament.operation grant,
 * audited like a grant given by hand) or declines with an optional reason. One open request per
 * account; administrators and Directors never ask.
 */

export const HOST_REQUEST_NOTE_MAXIMUM = 300;

export type HostRequestStatus = "open" | "approved" | "declined";

export type HostRequestView = Readonly<{
  requestId: string;
  status: HostRequestStatus;
  note: string | null;
  requestedAtMs: number;
  decidedAtMs: number | null;
  declineReason: string | null;
}>;

/** What the Tournaments page needs to know about the person looking at it. */
export type HostRequestStanding = Readonly<{
  administrator: boolean;
  director: boolean;
  request: HostRequestView | null;
}>;

export type HostRequestPlayer = Readonly<{ playerId: string; username: string; displayName: string }>;

export type HostRequestQueueItem = Readonly<{
  requestId: string;
  userAccountId: string;
  accountCreatedAtMs: number;
  players: readonly HostRequestPlayer[];
  note: string | null;
  requestedAtMs: number;
}>;

export type HostRequestDecision = Readonly<{
  requestId: string;
  userAccountId: string;
  status: "approved" | "declined";
  decidedAtMs: number;
}>;

export interface DirectorHostRequestRepository {
  /** The account's most recent request, or null. */
  latestForAccount(userAccountId: string): Promise<HostRequestView | null>;
  /** Inserts an open request; "open_exists" when the account already has one. */
  insert(input: Readonly<{
    requestId: string; userAccountId: string; note: string | null; nowMs: number;
  }>): Promise<"created" | "open_exists" | "account_not_found">;
  listOpen(limit: number): Promise<readonly HostRequestQueueItem[]>;
  /**
   * Approves an open request in one transaction: the tournament.operation grant (unless the account
   * already holds one) and the request's decision. "not_open" when it was already decided.
   */
  approve(input: Readonly<{
    requestId: string; actorUserAccountId: string; grantId: string; reasonCode: string; nowMs: number;
  }>): Promise<HostRequestDecision | "not_found" | "not_open">;
  decline(input: Readonly<{
    requestId: string; actorUserAccountId: string; reason: string | null; nowMs: number;
  }>): Promise<HostRequestDecision | "not_found" | "not_open">;
}

export type HostRequestNotifier = Readonly<{
  hostRequested(requestId: string): Promise<void>;
  hostRequestDecided(requestId: string, userAccountId: string, decision: "approved" | "declined"): Promise<void>;
}>;

export class DirectorHostRequestError extends Error {
  public constructor(
    public readonly code:
      | "not_authenticated"
      | "forbidden"
      | "invalid_input"
      | "already_director"
      | "already_open"
      | "not_found"
      | "conflict"
      | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "DirectorHostRequestError";
  }
}

const requestIdPattern = /^director_host_request\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
// Line breaks are allowed in a note; other control characters are not.
const controlCharacters = /[\u0000-\u0009\u000b-\u001f\u007f]/u;

/** A trimmed note of at most 300 characters, or null for an empty one. */
export function cleanHostRequestText(value: unknown): string | null {
  if (value === undefined || value === null) { return null; }
  if (typeof value !== "string") {
    throw new DirectorHostRequestError("invalid_input", "the note must be text");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) { return null; }
  if ([...trimmed].length > HOST_REQUEST_NOTE_MAXIMUM || controlCharacters.test(trimmed)) {
    throw new DirectorHostRequestError("invalid_input", "the note is too long or contains control characters");
  }
  return trimmed;
}

/** A closed or missing account cannot be made a Director; anything else is the database. */
function persistenceFailure(error: unknown): never {
  if (error instanceof DirectorHostRequestError) { throw error; }
  if (error instanceof TournamentOperatorCapabilityError && error.code === "not_found") {
    throw new DirectorHostRequestError("not_found", "the asking account is no longer active");
  }
  throw new DirectorHostRequestError("unavailable", "the decision could not be saved");
}

export class DirectorHostRequestService {
  public constructor(
    private readonly dependencies: Readonly<{
      repository: DirectorHostRequestRepository;
      hasTournamentOperation(userAccountId: string): Promise<boolean>;
      ids: Readonly<{ newRequestId(): string; newGrantId(): string }>;
      clock: Readonly<{ nowMs(): number }>;
      notifier?: HostRequestNotifier;
    }>,
  ) {}

  public async standing(actor: ActorContext): Promise<HostRequestStanding> {
    const account = this.account(actor);
    try {
      const [director, request] = await Promise.all([
        this.dependencies.hasTournamentOperation(account),
        this.dependencies.repository.latestForAccount(account),
      ]);
      return { administrator: actor.role === "administrator", director, request };
    } catch {
      throw new DirectorHostRequestError("unavailable", "host requests are unavailable");
    }
  }

  public async submit(actor: ActorContext, rawNote: unknown): Promise<HostRequestStanding> {
    const account = this.account(actor);
    if (actor.role === "administrator") {
      throw new DirectorHostRequestError("forbidden", "administrators host without asking");
    }
    const note = cleanHostRequestText(rawNote);
    if (await this.dependencies.hasTournamentOperation(account)) {
      throw new DirectorHostRequestError("already_director", "this account is already a Director");
    }
    const requestId = this.dependencies.ids.newRequestId();
    const outcome = await this.dependencies.repository.insert({
      requestId, userAccountId: account, note, nowMs: this.now(),
    }).catch(() => { throw new DirectorHostRequestError("unavailable", "the request could not be saved"); });
    if (outcome === "open_exists") {
      throw new DirectorHostRequestError("already_open", "this account already has an open request");
    }
    if (outcome === "account_not_found") {
      throw new DirectorHostRequestError("not_found", "account not found");
    }
    await this.dependencies.notifier?.hostRequested(requestId);
    return await this.standing(actor);
  }

  public async queue(actor: ActorContext): Promise<readonly HostRequestQueueItem[]> {
    this.administrator(actor);
    try {
      return await this.dependencies.repository.listOpen(100);
    } catch {
      throw new DirectorHostRequestError("unavailable", "host requests are unavailable");
    }
  }

  public async approve(actor: ActorContext, requestId: string): Promise<HostRequestDecision> {
    const administrator = this.administrator(actor);
    this.requestId(requestId);
    const outcome = await this.dependencies.repository.approve({
      requestId,
      actorUserAccountId: administrator,
      grantId: this.dependencies.ids.newGrantId(),
      reasonCode: "director_host_request_approved",
      nowMs: this.now(),
    }).catch(persistenceFailure);
    const decision = this.decided(outcome);
    await this.dependencies.notifier?.hostRequestDecided(requestId, decision.userAccountId, "approved");
    return decision;
  }

  public async decline(actor: ActorContext, requestId: string, rawReason: unknown): Promise<HostRequestDecision> {
    const administrator = this.administrator(actor);
    this.requestId(requestId);
    const reason = cleanHostRequestText(rawReason);
    const outcome = await this.dependencies.repository.decline({
      requestId, actorUserAccountId: administrator, reason, nowMs: this.now(),
    }).catch(persistenceFailure);
    const decision = this.decided(outcome);
    await this.dependencies.notifier?.hostRequestDecided(requestId, decision.userAccountId, "declined");
    return decision;
  }

  private decided(outcome: HostRequestDecision | "not_found" | "not_open"): HostRequestDecision {
    if (outcome === "not_found") { throw new DirectorHostRequestError("not_found", "request not found"); }
    if (outcome === "not_open") { throw new DirectorHostRequestError("conflict", "request was already decided"); }
    return outcome;
  }

  private account(actor: ActorContext): string {
    if (actor.role !== "account" && actor.role !== "administrator") {
      throw new DirectorHostRequestError("not_authenticated", "sign in to ask to host");
    }
    return actor.userAccountId;
  }

  private administrator(actor: ActorContext): string {
    if (actor.role === "anonymous" || actor.role === "migration_operator") {
      throw new DirectorHostRequestError("not_authenticated", "sign in first");
    }
    if (actor.role !== "administrator") {
      throw new DirectorHostRequestError("forbidden", "administrator actor required");
    }
    return actor.userAccountId;
  }

  private requestId(value: string): void {
    if (value.length > 180 || !requestIdPattern.test(value)) {
      throw new DirectorHostRequestError("invalid_input", "request id is invalid");
    }
  }

  private now(): number {
    const value = this.dependencies.clock.nowMs();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new DirectorHostRequestError("unavailable", "clock is invalid");
    }
    return value;
  }
}
