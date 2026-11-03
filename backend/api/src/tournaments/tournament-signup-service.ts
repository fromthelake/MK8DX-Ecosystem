import type { ActorContext } from "../identity/types.js";
import { TOURNAMENT_MAX_PARTICIPANTS } from "./tournament-operation-domain.js";
import {
  isSignupDrawSeed,
  newSignupDrawSeed,
  SIGNUP_DRAW_ALGORITHM,
  signupDrawOrder,
} from "./tournament-signup-draw.js";

/**
 * Open sign-up, the waiting list and the player's status line (ADR-0222).
 *
 * A night's list is the Director's roster by default, prefilled from the Players of earlier nights
 * exactly as before. A Director may open sign-up with a closing time, a maximum and a selection:
 * first come, first served, or a draw from a seed published after closing. Sign-ups never keep a
 * parallel list: they write the existing roster rows (attendance present / waiting / absent and the
 * NS1/NS2 fields) while the night is still at Step 2 without groups. The sign-up tables hold only
 * what the roster cannot say: when somebody signed up, their order and the outcome.
 *
 * Closing has no job runner of its own: every read or write of a night's sign-up first closes it
 * when its time has passed (in one transaction under the night's row lock, exactly once), and the
 * API process sweeps due nights every minute so the notifications do not wait for a visitor.
 */

export type SignupMode = "director" | "open";
export type SignupSelection = "first_come" | "draw";
export type SignupEntryStatus = "pending" | "selected" | "waiting" | "withdrawn" | "removed";
export type SignupAttendance = "present" | "waiting" | "absent";
export type SignupViewerState =
  | "signed_out"
  | "no_player"
  | "director_roster"
  | "not_signed_up"
  | "pending"
  | "selected"
  | "waiting"
  | "withdrawn"
  | "removed"
  | "closed";
export type SignupNoticeKind =
  | "tournament_signup_selected"
  | "tournament_signup_moved_up"
  | "tournament_signup_removed";

export type SignupTournament = Readonly<{
  internalId: number;
  tournamentId: string;
  name: string;
  directorInternalId: number;
  stage: string;
  workflowStep: number;
  maxParticipants: number | null;
  startAtMs: number | null;
  timezone: string | null;
  groupCount: number;
}>;

export type SignupSettingsRecord = Readonly<{
  mode: SignupMode;
  selection: SignupSelection;
  capacity: number;
  closesAtMs: number;
  status: "open" | "closed";
  drawSeed: string | null;
  drawAlgorithm: string | null;
  closedAtMs: number | null;
}>;

export type SignupRosterRow = Readonly<{
  playerInternalId: number;
  playerId: string;
  displayName: string;
  publicIdentity: boolean;
  attendance: SignupAttendance;
  hasSwitch1: boolean;
  hasSwitch2: boolean;
}>;

export type SignupEntryRecord = Readonly<{
  playerInternalId: number;
  playerId: string;
  displayName: string;
  publicIdentity: boolean;
  accountInternalId: number;
  status: SignupEntryStatus;
  queuePosition: number | null;
  signedUpAtMs: number;
}>;

export type SignupViewerAccount = Readonly<{
  internalId: number;
  players: readonly Readonly<{ internalId: number; playerId: string; displayName: string }>[];
}>;

export interface TournamentSignupTransaction {
  findTournament(tournamentId: string, lock: boolean): Promise<SignupTournament | null>;
  loadSettings(tournamentInternalId: number, lock: boolean): Promise<SignupSettingsRecord | null>;
  saveSettings(input: Readonly<{
    tournamentInternalId: number; settings: SignupSettingsRecord; actorInternalId: number; nowMs: number;
  }>): Promise<void>;
  loadRoster(tournamentInternalId: number): Promise<readonly SignupRosterRow[]>;
  loadEntries(tournamentInternalId: number): Promise<readonly SignupEntryRecord[]>;
  /** Inserts or replaces the Player's one sign-up row for this night. */
  saveEntry(input: Readonly<{
    tournamentInternalId: number;
    playerInternalId: number;
    accountInternalId: number;
    status: SignupEntryStatus;
    queuePosition: number | null;
    signedUpAtMs: number;
    decided: boolean;
    nowMs: number;
  }>): Promise<void>;
  /** Writes the roster row (inserted Absent without consoles when missing) and its cable numbers. */
  writeRoster(input: Readonly<{
    tournamentInternalId: number;
    playerInternalId: number;
    attendance?: SignupAttendance;
    hasSwitch1?: boolean;
    hasSwitch2?: boolean;
    nowMs: number;
  }>): Promise<void>;
  /** The night's revision moves on, so an open operation board reloads before its next write. */
  touchTournament(tournamentInternalId: number, nowMs: number): Promise<void>;
  appendLifecycle(input: Readonly<{
    tournamentInternalId: number; eventType: string; detail: string | null; actorInternalId: number; nowMs: number;
  }>): Promise<void>;
  viewerAccount(userAccountId: string): Promise<SignupViewerAccount | null>;
  operatorAccount(userAccountId: string): Promise<Readonly<{ internalId: number; isAdministrator: boolean }> | null>;
  listDueTournamentIds(nowMs: number, limit: number): Promise<readonly string[]>;
}

export interface TournamentSignupRepository {
  transaction<T>(work: (transaction: TournamentSignupTransaction) => Promise<T>): Promise<T>;
}

export type SignupNotice = Readonly<{
  kind: SignupNoticeKind;
  tournamentInternalId: number;
  recipientInternalId: number;
  detail: "selected" | "waiting" | "moved_up" | "removed";
}>;

export type TournamentSignupNotifier = Readonly<{ signupChanged(notice: SignupNotice): Promise<void> }>;

export type SignupListEntry = Readonly<{ position: number; playerId: string | null; displayName: string }>;

/** What a night's page shows everybody, and the signed-in viewer about themselves. */
export type TournamentSignupDocument = Readonly<{
  tournamentId: string;
  mode: SignupMode;
  selection: SignupSelection | null;
  status: "director" | "open" | "closed";
  closesAtMs: number | null;
  timezone: string | null;
  capacity: number | null;
  taken: number;
  closedAtMs: number | null;
  drawSeed: string | null;
  drawAlgorithm: string | null;
  active: readonly SignupListEntry[];
  waiting: readonly SignupListEntry[];
  viewer: Readonly<{
    state: SignupViewerState;
    playerId: string | null;
    hasSwitch1: boolean;
    hasSwitch2: boolean;
    waitingPosition: number | null;
    canSignUp: boolean;
    canWithdraw: boolean;
    canChangeConsoles: boolean;
  }>;
}>;

export type SignupBoardEntry = Readonly<{
  playerId: string;
  displayName: string;
  status: SignupEntryStatus;
  position: number | null;
  signedUpAtMs: number;
  attendance: SignupAttendance | null;
  hasSwitch1: boolean;
  hasSwitch2: boolean;
}>;

/** What the Director's board shows: the settings, every sign-up and whether enough consoles come. */
export type TournamentSignupBoard = Readonly<{
  tournamentId: string;
  editable: boolean;
  settings: Readonly<{
    mode: SignupMode;
    selection: SignupSelection | null;
    status: "director" | "open" | "closed";
    closesAtMs: number | null;
    capacity: number | null;
    closedAtMs: number | null;
    drawSeed: string | null;
    drawAlgorithm: string | null;
  }>;
  entries: readonly SignupBoardEntry[];
  consoles: Readonly<{ players: number; coming: number; needed: number; warning: boolean }>;
}>;

export class TournamentSignupError extends Error {
  public constructor(
    public readonly code:
      | "not_authenticated"
      | "forbidden"
      | "invalid_input"
      | "not_found"
      | "no_verified_player"
      | "closed"
      | "conflict"
      | "unavailable",
    message = "The sign-up could not be completed.",
  ) {
    super(message);
    this.name = "TournamentSignupError";
  }
}

const tournamentIdPattern = /^tournament\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const MAXIMUM_CLOSING_MS = 253_402_300_799_999;

function tournamentId(value: string): string {
  if (!tournamentIdPattern.test(value) || value.length > 160) {
    throw new TournamentSignupError("invalid_input", "tournamentId is invalid");
  }
  return value;
}

function signedIn(actor: ActorContext): string {
  if (actor.role !== "account" && actor.role !== "administrator") {
    throw new TournamentSignupError("not_authenticated", "Sign in to sign up.");
  }
  return actor.userAccountId;
}

/** Sign-ups may change the roster only before the night: Step 2, no groups, not finished. */
export function signupRosterEditable(tournament: SignupTournament): boolean {
  return tournament.stage === "setup" && tournament.workflowStep === 2 && tournament.groupCount === 0;
}

/** The places the selection fills: the sign-up maximum, never more than the night may seat. */
export function signupEffectiveCapacity(tournament: SignupTournament, settings: SignupSettingsRecord): number {
  return Math.min(settings.capacity, tournament.maxParticipants ?? TOURNAMENT_MAX_PARTICIPANTS, TOURNAMENT_MAX_PARTICIPANTS);
}

function acceptingSignups(tournament: SignupTournament, settings: SignupSettingsRecord | null, nowMs: number): boolean {
  return settings !== null && settings.mode === "open" && settings.status === "open" &&
    nowMs < settings.closesAtMs && signupRosterEditable(tournament);
}

type Working = {
  tournament: SignupTournament;
  settings: SignupSettingsRecord | null;
  roster: Map<number, SignupRosterRow>;
  entries: Map<number, SignupEntryRecord>;
};

export class TournamentSignupService {
  private readonly newSeed: () => string;

  public constructor(private readonly dependencies: Readonly<{
    repository: TournamentSignupRepository;
    clock: Readonly<{ nowMs(): number }>;
    notifier?: TournamentSignupNotifier;
    newSeed?: () => string;
    operationalLog?: Readonly<{ log(entry: Record<string, unknown>): void }>;
  }>) {
    this.newSeed = dependencies.newSeed ?? newSignupDrawSeed;
  }

  // -- the night's page ---------------------------------------------------

  public async status(actor: ActorContext, requestedTournamentId: string): Promise<TournamentSignupDocument> {
    const id = tournamentId(requestedTournamentId);
    return this.run(async (transaction, notices, nowMs) => {
      const working = await this.load(transaction, id, notices, nowMs);
      const viewer = actor.role === "account" || actor.role === "administrator"
        ? await transaction.viewerAccount(actor.userAccountId)
        : null;
      return this.document(working, actor, viewer, nowMs);
    });
  }

  /** Signs the viewer's verified Player up, or changes the consoles they bring while it is open. */
  public async signUp(actor: ActorContext, requestedTournamentId: string, input: Readonly<{
    hasSwitch1: boolean; hasSwitch2: boolean; playerId?: string;
  }>): Promise<TournamentSignupDocument> {
    const accountId = signedIn(actor);
    const id = tournamentId(requestedTournamentId);
    if (typeof input.hasSwitch1 !== "boolean" || typeof input.hasSwitch2 !== "boolean") {
      throw new TournamentSignupError("invalid_input", "hasSwitch1 and hasSwitch2 are required");
    }
    if (input.playerId !== undefined && !playerIdPattern.test(input.playerId)) {
      throw new TournamentSignupError("invalid_input", "playerId is invalid");
    }
    return this.run(async (transaction, notices, nowMs) => {
      const working = await this.load(transaction, id, notices, nowMs);
      const viewer = await transaction.viewerAccount(accountId);
      const player = this.viewerPlayer(working, viewer, input.playerId);
      if (!acceptingSignups(working.tournament, working.settings, nowMs)) {
        throw new TournamentSignupError("closed", "Sign-up is closed for this night.");
      }
      const settings = working.settings!;
      const existing = working.entries.get(player.internalId);
      const row = working.roster.get(player.internalId);
      const consoles = { hasSwitch1: input.hasSwitch1, hasSwitch2: input.hasSwitch2 };
      if (existing !== undefined && (existing.status === "pending" || existing.status === "selected" ||
        existing.status === "waiting")) {
        // Already signed up: only the consoles change, until closing.
        await transaction.writeRoster({
          tournamentInternalId: working.tournament.internalId, playerInternalId: player.internalId, ...consoles, nowMs,
        });
        await transaction.touchTournament(working.tournament.internalId, nowMs);
        await transaction.appendLifecycle({
          tournamentInternalId: working.tournament.internalId, eventType: "signup_consoles_changed",
          detail: `${player.playerId}:${input.hasSwitch1 ? "ns1" : ""}${input.hasSwitch2 ? "ns2" : ""}`,
          actorInternalId: viewer!.internalId, nowMs,
        });
        return this.reloadDocument(transaction, id, actor, viewer, notices, nowMs);
      }
      if (existing?.status === "removed") {
        throw new TournamentSignupError("forbidden", "The Director took you off this night's list.");
      }
      // A first sign-up, or signing up again after withdrawing.
      let status: SignupEntryStatus = "pending";
      let queuePosition: number | null = null;
      let attendance: SignupAttendance | undefined;
      if (row?.attendance === "present") {
        // The Director already put this Player on the list by hand.
        status = "selected";
      } else if (settings.selection === "first_come") {
        const present = [...working.roster.values()].filter((entry) => entry.attendance === "present").length;
        if (present < signupEffectiveCapacity(working.tournament, settings)) {
          status = "selected";
          attendance = "present";
        } else {
          status = "waiting";
          queuePosition = this.nextQueuePosition(working);
          attendance = "waiting";
        }
      }
      await transaction.saveEntry({
        tournamentInternalId: working.tournament.internalId,
        playerInternalId: player.internalId,
        accountInternalId: viewer!.internalId,
        status,
        queuePosition,
        signedUpAtMs: nowMs,
        decided: status !== "pending",
        nowMs,
      });
      await transaction.writeRoster({
        tournamentInternalId: working.tournament.internalId,
        playerInternalId: player.internalId,
        ...(attendance === undefined ? {} : { attendance }),
        ...consoles,
        nowMs,
      });
      await transaction.touchTournament(working.tournament.internalId, nowMs);
      await transaction.appendLifecycle({
        tournamentInternalId: working.tournament.internalId, eventType: "signup_joined",
        detail: `${player.playerId}:${status}`, actorInternalId: viewer!.internalId, nowMs,
      });
      return this.reloadDocument(transaction, id, actor, viewer, notices, nowMs);
    });
  }

  /**
   * The viewer withdraws. Before the night a place on the list moves to the first of the waiting
   * list (once the list has been selected), who is told so.
   */
  public async withdraw(actor: ActorContext, requestedTournamentId: string): Promise<TournamentSignupDocument> {
    const accountId = signedIn(actor);
    const id = tournamentId(requestedTournamentId);
    return this.run(async (transaction, notices, nowMs) => {
      const working = await this.load(transaction, id, notices, nowMs);
      const viewer = await transaction.viewerAccount(accountId);
      if (viewer === null || viewer.players.length === 0) {
        throw new TournamentSignupError("no_verified_player", "A verified Player is required.");
      }
      const entry = viewer.players.map((player) => working.entries.get(player.internalId))
        .find((candidate) => candidate !== undefined &&
          (candidate.status === "pending" || candidate.status === "selected" || candidate.status === "waiting"));
      if (entry === undefined) {
        throw new TournamentSignupError("conflict", "You are not signed up for this night.");
      }
      if (!signupRosterEditable(working.tournament)) {
        throw new TournamentSignupError("closed", "The night has started; ask the Director.");
      }
      await this.setEntry(transaction, working, entry, "withdrawn", null, nowMs, "absent");
      this.compactWaiting(working);
      await this.persistWaitingOrder(transaction, working, nowMs);
      await this.fill(transaction, working, notices, nowMs);
      await transaction.touchTournament(working.tournament.internalId, nowMs);
      await transaction.appendLifecycle({
        tournamentInternalId: working.tournament.internalId, eventType: "signup_withdrawn",
        detail: entry.playerId, actorInternalId: viewer.internalId, nowMs,
      });
      return this.reloadDocument(transaction, id, actor, viewer, notices, nowMs);
    });
  }

  // -- the Director --------------------------------------------------------

  public async board(actor: ActorContext, requestedTournamentId: string): Promise<TournamentSignupBoard> {
    const accountId = signedIn(actor);
    const id = tournamentId(requestedTournamentId);
    return this.run(async (transaction, notices, nowMs) => {
      const working = await this.load(transaction, id, notices, nowMs);
      await this.director(transaction, accountId, working.tournament);
      return this.boardOf(working, nowMs);
    });
  }

  /** Opens sign-up, changes its terms while it is open, or returns the night to the Director's roster. */
  public async configure(actor: ActorContext, requestedTournamentId: string, input: Readonly<{
    mode: SignupMode; selection?: SignupSelection; closesAtMs?: number; capacity?: number;
  }>): Promise<TournamentSignupBoard> {
    const accountId = signedIn(actor);
    const id = tournamentId(requestedTournamentId);
    if (input.mode !== "director" && input.mode !== "open") {
      throw new TournamentSignupError("invalid_input", "mode must be director or open");
    }
    return this.run(async (transaction, notices, nowMs) => {
      const working = await this.load(transaction, id, notices, nowMs);
      const director = await this.director(transaction, accountId, working.tournament);
      const current = working.settings;
      if (current?.status === "closed") {
        throw new TournamentSignupError("closed", "Sign-up has closed; its terms are fixed.");
      }
      if (!signupRosterEditable(working.tournament)) {
        throw new TournamentSignupError("closed", "Sign-up can only be changed before the night (Step 2, no groups).");
      }
      let next: SignupSettingsRecord;
      if (input.mode === "director") {
        if (current === null) { return this.boardOf(working, nowMs); }
        next = { ...current, mode: "director" };
      } else {
        const selection = input.selection ?? current?.selection;
        const closesAtMs = input.closesAtMs ?? current?.closesAtMs;
        const capacity = input.capacity ?? current?.capacity;
        if (selection !== "first_come" && selection !== "draw") {
          throw new TournamentSignupError("invalid_input", "selection must be first_come or draw");
        }
        if (closesAtMs === undefined || !Number.isSafeInteger(closesAtMs) || closesAtMs > MAXIMUM_CLOSING_MS ||
          closesAtMs <= nowMs) {
          throw new TournamentSignupError("invalid_input", "closesAtMs must be a time in the future");
        }
        if (capacity === undefined || !Number.isSafeInteger(capacity) || capacity < 1 ||
          capacity > TOURNAMENT_MAX_PARTICIPANTS) {
          throw new TournamentSignupError("invalid_input", `capacity must be 1-${TOURNAMENT_MAX_PARTICIPANTS}`);
        }
        if (current !== null && current.selection !== selection && working.entries.size > 0) {
          throw new TournamentSignupError("conflict", "The selection cannot change once Players have signed up.");
        }
        next = {
          mode: "open", selection, capacity, closesAtMs,
          status: "open", drawSeed: null, drawAlgorithm: null, closedAtMs: null,
        };
      }
      await transaction.saveSettings({
        tournamentInternalId: working.tournament.internalId, settings: next, actorInternalId: director, nowMs,
      });
      working.settings = next;
      // A larger maximum under first come, first served moves the waiting list up at once.
      if (next.mode === "open") { await this.fill(transaction, working, notices, nowMs); }
      await transaction.touchTournament(working.tournament.internalId, nowMs);
      await transaction.appendLifecycle({
        tournamentInternalId: working.tournament.internalId, eventType: "signup_configured",
        detail: next.mode === "open"
          ? `mode=open;selection=${next.selection};capacity=${next.capacity};closes=${next.closesAtMs}`
          : "mode=director",
        actorInternalId: director, nowMs,
      });
      return this.boardOf(await this.reload(transaction, id), nowMs);
    });
  }

  /** Closes sign-up now instead of at its time (the draw, if any, runs at once). */
  public async closeNow(actor: ActorContext, requestedTournamentId: string): Promise<TournamentSignupBoard> {
    const accountId = signedIn(actor);
    const id = tournamentId(requestedTournamentId);
    return this.run(async (transaction, notices, nowMs) => {
      const working = await this.load(transaction, id, notices, nowMs);
      const director = await this.director(transaction, accountId, working.tournament);
      if (working.settings === null || working.settings.mode !== "open" || working.settings.status !== "open") {
        throw new TournamentSignupError("conflict", "Sign-up is not open.");
      }
      await this.close(transaction, working, notices, nowMs, director);
      return this.boardOf(await this.reload(transaction, id), nowMs);
    });
  }

  /**
   * The Director moves a sign-up by hand: onto the list, onto the waiting list at a position, or off
   * the list. The roster follows; moving up and removing are told to the Player.
   */
  public async move(actor: ActorContext, requestedTournamentId: string, input: Readonly<{
    playerId: string; to: "selected" | "waiting" | "removed"; position?: number;
  }>): Promise<TournamentSignupBoard> {
    const accountId = signedIn(actor);
    const id = tournamentId(requestedTournamentId);
    if (!playerIdPattern.test(input.playerId)) { throw new TournamentSignupError("invalid_input", "playerId is invalid"); }
    if (input.to !== "selected" && input.to !== "waiting" && input.to !== "removed") {
      throw new TournamentSignupError("invalid_input", "to must be selected, waiting or removed");
    }
    if (input.position !== undefined && (!Number.isSafeInteger(input.position) || input.position < 1 ||
      input.position > 1000)) {
      throw new TournamentSignupError("invalid_input", "position must be 1 or more");
    }
    return this.run(async (transaction, notices, nowMs) => {
      const working = await this.load(transaction, id, notices, nowMs);
      const director = await this.director(transaction, accountId, working.tournament);
      if (!signupRosterEditable(working.tournament)) {
        throw new TournamentSignupError("closed", "The night has started; use the attendance at Step 2.");
      }
      const entry = [...working.entries.values()].find((candidate) => candidate.playerId === input.playerId);
      if (entry === undefined) { throw new TournamentSignupError("not_found", "This Player has not signed up."); }
      if (entry.status === "withdrawn") {
        throw new TournamentSignupError("conflict", "This Player withdrew; add them on the roster instead.");
      }
      const tournamentInternalId = working.tournament.internalId;
      if (input.to === "selected") {
        if (entry.status !== "selected") {
          const present = [...working.roster.values()].filter((row) => row.attendance === "present").length;
          const presentAlready = working.roster.get(entry.playerInternalId)?.attendance === "present";
          const hardCap = Math.min(working.tournament.maxParticipants ?? TOURNAMENT_MAX_PARTICIPANTS, TOURNAMENT_MAX_PARTICIPANTS);
          if (!presentAlready && present >= hardCap) {
            throw new TournamentSignupError("conflict", "The night is full.");
          }
          const from = entry.status;
          await this.setEntry(transaction, working, entry, "selected", null, nowMs, "present");
          notices.push({
            kind: from === "waiting" ? "tournament_signup_moved_up" : "tournament_signup_selected",
            tournamentInternalId, recipientInternalId: entry.accountInternalId,
            detail: from === "waiting" ? "moved_up" : "selected",
          });
        }
      } else if (input.to === "waiting") {
        const others = this.waitingOrder(working).filter((candidate) => candidate.playerInternalId !== entry.playerInternalId);
        const index = Math.min(Math.max((input.position ?? others.length + 1) - 1, 0), others.length);
        const updated = await this.setEntry(transaction, working, entry, "waiting", 0, nowMs, "waiting");
        others.splice(index, 0, updated);
        others.forEach((candidate, position) => {
          working.entries.set(candidate.playerInternalId, { ...candidate, queuePosition: position + 1 });
        });
      } else if (entry.status !== "removed") {
        await this.setEntry(transaction, working, entry, "removed", null, nowMs, "absent");
        notices.push({
          kind: "tournament_signup_removed", tournamentInternalId,
          recipientInternalId: entry.accountInternalId, detail: "removed",
        });
      }
      this.compactWaiting(working);
      await this.persistWaitingOrder(transaction, working, nowMs);
      await transaction.touchTournament(tournamentInternalId, nowMs);
      await transaction.appendLifecycle({
        tournamentInternalId, eventType: "signup_moved",
        detail: `${entry.playerId}:${input.to}${input.position === undefined ? "" : `:${input.position}`}`,
        actorInternalId: director, nowMs,
      });
      return this.boardOf(await this.reload(transaction, id), nowMs);
    });
  }

  /** The API process calls this every minute: every night whose sign-up time passed is closed once. */
  public async closeDue(): Promise<number> {
    const nowMs = this.dependencies.clock.nowMs();
    const due = await this.dependencies.repository.transaction((transaction) =>
      transaction.listDueTournamentIds(nowMs, 20));
    let closed = 0;
    for (const id of due) {
      try {
        await this.run(async (transaction, notices, now) => { await this.load(transaction, id, notices, now); });
        closed += 1;
      } catch (error) {
        this.dependencies.operationalLog?.log({
          event: "tournament_signup_close_failed",
          category: "tournament",
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }
    return closed;
  }

  // -- internals -----------------------------------------------------------

  private async run<T>(
    work: (transaction: TournamentSignupTransaction, notices: SignupNotice[], nowMs: number) => Promise<T>,
  ): Promise<T> {
    const notices: SignupNotice[] = [];
    const nowMs = this.dependencies.clock.nowMs();
    let result: T;
    try {
      result = await this.dependencies.repository.transaction((transaction) => work(transaction, notices, nowMs));
    } catch (error) {
      if (error instanceof TournamentSignupError) { throw error; }
      this.dependencies.operationalLog?.log({
        event: "tournament_signup_failed",
        category: "tournament",
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      throw new TournamentSignupError("unavailable");
    }
    // Told after the commit: a notice never announces what was rolled back.
    for (const notice of notices) {
      await this.dependencies.notifier?.signupChanged(notice).catch(() => undefined);
    }
    return result;
  }

  /** Loads the night under its row lock and closes its sign-up first when the time has passed. */
  private async load(
    transaction: TournamentSignupTransaction,
    id: string,
    notices: SignupNotice[],
    nowMs: number,
  ): Promise<Working> {
    const working = await this.reload(transaction, id, true);
    const settings = working.settings;
    if (settings !== null && settings.mode === "open" && settings.status === "open" && nowMs >= settings.closesAtMs) {
      await this.close(transaction, working, notices, nowMs, working.tournament.directorInternalId);
      return this.reload(transaction, id);
    }
    return working;
  }

  private async reload(transaction: TournamentSignupTransaction, id: string, lock = false): Promise<Working> {
    const tournament = await transaction.findTournament(id, lock);
    if (tournament === null) { throw new TournamentSignupError("not_found", "tournament not found"); }
    const settings = await transaction.loadSettings(tournament.internalId, lock);
    const roster = new Map((await transaction.loadRoster(tournament.internalId))
      .map((row) => [row.playerInternalId, row] as const));
    const entries = new Map((await transaction.loadEntries(tournament.internalId))
      .map((entry) => [entry.playerInternalId, entry] as const));
    return { tournament, settings, roster, entries };
  }

  private async reloadDocument(
    transaction: TournamentSignupTransaction,
    id: string,
    actor: ActorContext,
    viewer: SignupViewerAccount | null,
    _notices: SignupNotice[],
    nowMs: number,
  ): Promise<TournamentSignupDocument> {
    return this.document(await this.reload(transaction, id), actor, viewer, nowMs);
  }

  /**
   * Closing: the draw (or the order of signing up) decides who is on the list and who waits, and
   * everyone hears their outcome. Exactly once: the settings row is locked and flips to closed.
   */
  private async close(
    transaction: TournamentSignupTransaction,
    working: Working,
    notices: SignupNotice[],
    nowMs: number,
    actorInternalId: number,
  ): Promise<void> {
    const settings = working.settings!;
    const tournamentInternalId = working.tournament.internalId;
    const editable = signupRosterEditable(working.tournament);
    let seed: string | null = null;
    if (settings.selection === "draw") {
      const pending = [...working.entries.values()].filter((entry) => entry.status === "pending");
      seed = this.newSeed();
      if (!isSignupDrawSeed(seed)) { throw new Error("invalid draw seed"); }
      const byPlayerId = new Map(pending.map((entry) => [entry.playerId, entry] as const));
      const drawn = signupDrawOrder(seed, pending.map((entry) => entry.playerId)).map((playerId) => byPlayerId.get(playerId)!);
      let present = [...working.roster.values()].filter((row) => row.attendance === "present").length;
      const capacity = signupEffectiveCapacity(working.tournament, settings);
      let queue = this.waitingOrder(working).length;
      for (const entry of drawn) {
        const alreadyPresent = working.roster.get(entry.playerInternalId)?.attendance === "present";
        if (alreadyPresent || present < capacity) {
          if (!alreadyPresent) { present += 1; }
          await this.setEntry(transaction, working, entry, "selected", null, nowMs, editable ? "present" : undefined);
          notices.push({
            kind: "tournament_signup_selected", tournamentInternalId,
            recipientInternalId: entry.accountInternalId, detail: "selected",
          });
        } else {
          queue += 1;
          await this.setEntry(transaction, working, entry, "waiting", queue, nowMs, editable ? "waiting" : undefined);
          notices.push({
            kind: "tournament_signup_selected", tournamentInternalId,
            recipientInternalId: entry.accountInternalId, detail: "waiting",
          });
        }
      }
    }
    const closed: SignupSettingsRecord = {
      ...settings,
      status: "closed",
      closedAtMs: nowMs,
      drawSeed: seed,
      drawAlgorithm: seed === null ? null : SIGNUP_DRAW_ALGORITHM,
    };
    await transaction.saveSettings({ tournamentInternalId, settings: closed, actorInternalId, nowMs });
    working.settings = closed;
    await transaction.touchTournament(tournamentInternalId, nowMs);
    await transaction.appendLifecycle({
      tournamentInternalId, eventType: "signup_closed",
      detail: seed === null ? `selection=${settings.selection}` : `selection=draw;seed=${seed}`,
      actorInternalId, nowMs,
    });
  }

  /**
   * While places are free, the first of the waiting list moves up. Only once the list has been
   * selected: under first come, first served from the start, under a draw after closing.
   */
  private async fill(
    transaction: TournamentSignupTransaction,
    working: Working,
    notices: SignupNotice[],
    nowMs: number,
  ): Promise<void> {
    const settings = working.settings;
    if (settings === null || settings.mode !== "open" || !signupRosterEditable(working.tournament)) { return; }
    if (settings.selection === "draw" && settings.status !== "closed") { return; }
    const capacity = signupEffectiveCapacity(working.tournament, settings);
    let present = [...working.roster.values()].filter((row) => row.attendance === "present").length;
    for (const next of this.waitingOrder(working)) {
      if (present >= capacity) { break; }
      await this.setEntry(transaction, working, next, "selected", null, nowMs, "present");
      present += 1;
      notices.push({
        kind: "tournament_signup_moved_up", tournamentInternalId: working.tournament.internalId,
        recipientInternalId: next.accountInternalId, detail: "moved_up",
      });
    }
    this.compactWaiting(working);
    await this.persistWaitingOrder(transaction, working, nowMs);
  }

  private async setEntry(
    transaction: TournamentSignupTransaction,
    working: Working,
    entry: SignupEntryRecord,
    status: SignupEntryStatus,
    queuePosition: number | null,
    nowMs: number,
    attendance: SignupAttendance | undefined,
  ): Promise<SignupEntryRecord> {
    const updated: SignupEntryRecord = { ...entry, status, queuePosition };
    working.entries.set(entry.playerInternalId, updated);
    if (status !== "waiting") {
      await transaction.saveEntry({
        tournamentInternalId: working.tournament.internalId,
        playerInternalId: entry.playerInternalId,
        accountInternalId: entry.accountInternalId,
        status,
        queuePosition: null,
        signedUpAtMs: entry.signedUpAtMs,
        decided: true,
        nowMs,
      });
    }
    if (attendance !== undefined) {
      await transaction.writeRoster({
        tournamentInternalId: working.tournament.internalId,
        playerInternalId: entry.playerInternalId,
        attendance,
        nowMs,
      });
      const row = working.roster.get(entry.playerInternalId);
      working.roster.set(entry.playerInternalId, row === undefined
        ? {
          playerInternalId: entry.playerInternalId, playerId: entry.playerId, displayName: entry.displayName,
          publicIdentity: entry.publicIdentity, attendance, hasSwitch1: false, hasSwitch2: false,
        }
        : { ...row, attendance });
    }
    if (status === "waiting" && queuePosition !== null && queuePosition > 0) {
      await this.persistEntryPosition(transaction, working, updated, nowMs);
    }
    return updated;
  }

  private async persistEntryPosition(
    transaction: TournamentSignupTransaction,
    working: Working,
    entry: SignupEntryRecord,
    nowMs: number,
  ): Promise<void> {
    await transaction.saveEntry({
      tournamentInternalId: working.tournament.internalId,
      playerInternalId: entry.playerInternalId,
      accountInternalId: entry.accountInternalId,
      status: "waiting",
      queuePosition: entry.queuePosition,
      signedUpAtMs: entry.signedUpAtMs,
      decided: true,
      nowMs,
    });
  }

  private waitingOrder(working: Working): SignupEntryRecord[] {
    return [...working.entries.values()]
      .filter((entry) => entry.status === "waiting")
      .sort((left, right) => (left.queuePosition ?? 0) - (right.queuePosition ?? 0) ||
        left.signedUpAtMs - right.signedUpAtMs || left.playerInternalId - right.playerInternalId);
  }

  private nextQueuePosition(working: Working): number {
    return this.waitingOrder(working).reduce((highest, entry) => Math.max(highest, entry.queuePosition ?? 0), 0) + 1;
  }

  /** Waiting positions are 1..n without gaps, in their current order. */
  private compactWaiting(working: Working): void {
    this.waitingOrder(working).forEach((entry, index) => {
      working.entries.set(entry.playerInternalId, { ...entry, queuePosition: index + 1 });
    });
  }

  private async persistWaitingOrder(
    transaction: TournamentSignupTransaction, working: Working, nowMs: number,
  ): Promise<void> {
    for (const entry of this.waitingOrder(working)) {
      await this.persistEntryPosition(transaction, working, entry, nowMs);
    }
  }

  private viewerPlayer(
    working: Working,
    viewer: SignupViewerAccount | null,
    requestedPlayerId: string | undefined,
  ): Readonly<{ internalId: number; playerId: string }> {
    if (viewer === null || viewer.players.length === 0) {
      throw new TournamentSignupError("no_verified_player", "A verified Player is required to sign up.");
    }
    if (requestedPlayerId !== undefined) {
      const chosen = viewer.players.find((player) => player.playerId === requestedPlayerId);
      if (chosen === undefined) { throw new TournamentSignupError("forbidden", "This Player is not yours."); }
      return chosen;
    }
    // The Player already signed up (or withdrawn) speaks for the account; otherwise its first claim.
    return viewer.players.find((player) => working.entries.has(player.internalId)) ?? viewer.players[0]!;
  }

  private async director(
    transaction: TournamentSignupTransaction,
    userAccountId: string,
    tournament: SignupTournament,
  ): Promise<number> {
    const operator = await transaction.operatorAccount(userAccountId);
    if (operator === null) { throw new TournamentSignupError("forbidden", "A Director is required."); }
    if (!operator.isAdministrator && operator.internalId !== tournament.directorInternalId) {
      throw new TournamentSignupError("forbidden", "This night belongs to another Director.");
    }
    return operator.internalId;
  }

  private document(
    working: Working,
    actor: ActorContext,
    viewer: SignupViewerAccount | null,
    nowMs: number,
  ): TournamentSignupDocument {
    const { tournament, settings } = working;
    const open = settings !== null && settings.mode === "open";
    const accepting = acceptingSignups(tournament, settings, nowMs);
    const presentRows = [...working.roster.values()]
      .filter((row) => row.attendance === "present")
      .sort((left, right) => left.displayName.localeCompare(right.displayName) || left.playerId.localeCompare(right.playerId));
    const waiting = this.waitingOrder(working);
    const status: TournamentSignupDocument["status"] = !open ? "director" : accepting ? "open" : "closed";

    let state: SignupViewerState = "signed_out";
    let playerId: string | null = null;
    let consoles = { hasSwitch1: false, hasSwitch2: false };
    let waitingPosition: number | null = null;
    if (actor.role === "account" || actor.role === "administrator") {
      if (viewer === null || viewer.players.length === 0) {
        state = "no_player";
      } else {
        const player = viewer.players.find((candidate) => working.entries.has(candidate.internalId)) ?? viewer.players[0]!;
        playerId = player.playerId;
        const entry = working.entries.get(player.internalId);
        const row = working.roster.get(player.internalId);
        if (row !== undefined) { consoles = { hasSwitch1: row.hasSwitch1, hasSwitch2: row.hasSwitch2 }; }
        if (!open) {
          state = "director_roster";
        } else if (entry === undefined) {
          state = accepting ? "not_signed_up" : "closed";
        } else {
          state = entry.status;
          if (entry.status === "waiting") {
            waitingPosition = waiting.findIndex((candidate) => candidate.playerInternalId === entry.playerInternalId) + 1;
          }
        }
      }
    }
    const active = state === "pending" || state === "selected" || state === "waiting";
    return {
      tournamentId: tournament.tournamentId,
      mode: open ? "open" : "director",
      selection: open ? settings.selection : null,
      status,
      closesAtMs: open ? settings.closesAtMs : null,
      timezone: tournament.timezone,
      capacity: open ? signupEffectiveCapacity(tournament, settings) : null,
      taken: presentRows.length,
      closedAtMs: open ? settings.closedAtMs : null,
      drawSeed: open && settings.status === "closed" ? settings.drawSeed : null,
      drawAlgorithm: open && settings.status === "closed" ? settings.drawAlgorithm : null,
      // The lists are public only for a night with open sign-up; a Director's roster stays the
      // Director's until the groups are drawn.
      active: open ? presentRows.map((row, index) => ({
        position: index + 1, playerId: row.publicIdentity ? row.playerId : null, displayName: row.displayName,
      })) : [],
      waiting: open ? waiting.map((entry, index) => ({
        position: index + 1, playerId: entry.publicIdentity ? entry.playerId : null, displayName: entry.displayName,
      })) : [],
      viewer: {
        state,
        playerId,
        ...consoles,
        waitingPosition,
        canSignUp: accepting && (state === "not_signed_up" || state === "withdrawn"),
        canWithdraw: active && signupRosterEditable(tournament),
        canChangeConsoles: accepting && active,
      },
    };
  }

  private boardOf(working: Working, nowMs: number): TournamentSignupBoard {
    const { tournament, settings } = working;
    const open = settings !== null && settings.mode === "open";
    const accepting = acceptingSignups(tournament, settings, nowMs);
    const order: Record<SignupEntryStatus, number> = { selected: 0, pending: 1, waiting: 2, removed: 3, withdrawn: 4 };
    const entries = [...working.entries.values()].sort((left, right) =>
      order[left.status] - order[right.status] ||
      (left.queuePosition ?? 0) - (right.queuePosition ?? 0) ||
      left.signedUpAtMs - right.signedUpAtMs || left.playerId.localeCompare(right.playerId));
    // Who is expected tonight: the list, and before a draw everyone still waiting for it.
    const expected = [...working.roster.values()].filter((row) => row.attendance === "present" ||
      working.entries.get(row.playerInternalId)?.status === "pending");
    const coming = expected.reduce((sum, row) => sum + (row.hasSwitch1 ? 1 : 0) + (row.hasSwitch2 ? 1 : 0), 0);
    const players = open
      ? Math.min(expected.length, Math.max(signupEffectiveCapacity(tournament, settings),
        expected.filter((row) => row.attendance === "present").length))
      : expected.length;
    const needed = Math.ceil(players / 2);
    return {
      tournamentId: tournament.tournamentId,
      editable: signupRosterEditable(tournament),
      settings: {
        mode: open ? "open" : "director",
        selection: settings?.selection ?? null,
        status: !open ? "director" : accepting ? "open" : "closed",
        closesAtMs: settings?.closesAtMs ?? null,
        capacity: settings?.capacity ?? null,
        closedAtMs: settings?.closedAtMs ?? null,
        drawSeed: settings?.drawSeed ?? null,
        drawAlgorithm: settings?.drawAlgorithm ?? null,
      },
      entries: entries.map((entry) => {
        const row = working.roster.get(entry.playerInternalId);
        return {
          playerId: entry.playerId,
          displayName: entry.displayName,
          status: entry.status,
          position: entry.status === "waiting" ? entry.queuePosition : null,
          signedUpAtMs: entry.signedUpAtMs,
          attendance: row?.attendance ?? null,
          hasSwitch1: row?.hasSwitch1 ?? false,
          hasSwitch2: row?.hasSwitch2 ?? false,
        };
      }),
      consoles: { players, coming, needed, warning: players > 0 && coming < needed },
    };
  }
}
