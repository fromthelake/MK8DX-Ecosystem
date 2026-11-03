import type { ActorContext } from "./types.js";
import {
  directorPlayerCreationAllowed,
  selfServicePlayerCreationAllowed,
  type InstallationSettingsReader,
} from "../administration/installation-settings-service.js";

// Owner decision 2026-08-20: new users without any existing history create
// their own Player through self-service onboarding. The created Player is
// bound to the creating account with an immediately verified claim — claims
// protect existing identities, and a brand-new Player has no history to
// claim falsely — recorded with a full lifecycle audit trail.

const usernamePattern = /^[a-z0-9_-]{3,16}$/;
const controlCharacters = /[\u0000-\u001f\u007f]/;

export const SELF_SERVICE_PLAYER_CREATION_REASON =
  "self_service_player_creation";

export class PlayerOnboardingError extends Error {
  public constructor(
    public readonly code:
      | "forbidden"
      | "invalid_command"
      | "conflict"
      | "username_taken"
      | "display_name_taken"
      | "already_linked"
      | "roster_rejected"
      /** ADR-0221: the installation does not let this path create Players. */
      | "player_creation_disabled",
    message: string,
    /** For player_creation_disabled: which path is closed. */
    public readonly closedPath?: "self" | "directors",
  ) {
    super(message);
    this.name = "PlayerOnboardingError";
  }
}

/** ADR-0221: a Player-creation path the installation's setting has closed. */
export class PlayerCreationDisabled extends PlayerOnboardingError {
  public constructor(closedPath: "self" | "directors") {
    super(
      "player_creation_disabled",
      closedPath === "self"
        ? "On this site, Players are created by the Directors. Ask a Director to add you, then claim that Player."
        : "On this site, Players create themselves when they sign up. Ask the person to sign up, then add their Player.",
      closedPath,
    );
    this.name = "PlayerCreationDisabled";
  }
}

export type CreateOwnPlayerCommand = Readonly<{
  username: string;
  displayName?: string;
}>;

export type OwnPlayerCreated = Readonly<{
  playerId: string;
  username: string;
  displayName: string;
  playerClaimId: string;
}>;

export interface PlayerOnboardingTransaction {
  findUserAccountStatus(userAccountId: string): Promise<string | null>;
  hasVerifiedClaimForUserAccount(userAccountId: string): Promise<boolean>;
  createPlayerWithUsername(input: Readonly<{
    playerId: string;
    username: string;
    displayName: string;
    nowMs: number;
    /**
     * ADR-0221: whether the new Player starts at the default rating. False
     * when the installation counts only claimed Players and nobody claims
     * this one yet; absent = true.
     */
    seedRating?: boolean;
  }>): Promise<"created" | "username_taken">;
  /** ADR-0218: true while a current username already compares equal. */
  usernameTaken?(username: string): Promise<boolean>;
  /**
   * ADR-0218: the display-name keys (trimmed, lower case) among `displayNames`
   * that already belong to a Player on a roster of this Director's own nights.
   * The Director is the Tournament's when `tournamentId` names one, otherwise
   * the acting account. Across Directors a repeated name is allowed.
   */
  displayNamesInDirectorNights?(input: Readonly<{
    actorUserAccountId: string;
    tournamentId: string | null;
    displayNames: readonly string[];
  }>): Promise<ReadonlySet<string>>;
  createVerifiedClaim(input: Readonly<{
    playerClaimId: string;
    playerId: string;
    userAccountId: string;
    reasonCode: string;
    nowMs: number;
  }>): Promise<void>;
}

export interface PlayerOnboardingRepository {
  transaction<T>(
    work: (transaction: PlayerOnboardingTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface OnboardingIdGenerator {
  newPlayerId(): string;
  newPlayerClaimId(): string;
}

export interface OnboardingClock {
  nowMs(): number;
}

export const ADMINISTRATOR_PLAYER_CREATION_REASON =
  "administrator_player_creation";

export type AdministratorPlayerCreated = Readonly<{
  playerId: string;
  username: string;
  displayName: string;
}>;

/**
 * ADR-0177 decisions 9 and 10, revised by ADR-0218: a roster import may create
 * canonical Players from reviewed display names. A name is never an identity:
 * display names may repeat, the username is derived under ADR-0151 and gets the
 * next free suffix (`marc`, `marc-2`), and a name that already exists in the
 * Director's own nights needs `confirmSameName` (the warning the clients show).
 * Any rejection rejects the whole batch so nothing is half-written.
 */
export type RosterPlayerRequest = Readonly<{ row: number; displayName: string; confirmSameName?: boolean }>;

export type RosterPlayerRejection = Readonly<{
  row: number;
  displayName: string;
  reason:
    | "invalid_display_name"
    | "duplicate_display_name_in_file"
    /** ADR-0218: the name exists in this Director's own nights and was not confirmed. */
    | "display_name_taken"
    | "username_taken";
}>;

export class RosterPlayerCreationRejected extends PlayerOnboardingError {
  public constructor(public readonly rejections: readonly RosterPlayerRejection[]) {
    super("roster_rejected", "the roster import was rejected");
    this.name = "RosterPlayerCreationRejected";
  }
}

/** ADR-0151 migration seeding rule: normalize a display name to the V1 syntax. */
export function rosterUsernameFor(displayName: string): string | null {
  const normalized = displayName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/_+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 16);
  return usernamePattern.test(normalized) ? normalized : null;
}

/**
 * ADR-0218: usernames stay unique with a suffix. The second Marc is `marc-2`;
 * the base is shortened so the result keeps to the 16-character syntax.
 */
export function rosterUsernameWithSuffix(base: string, sequence: number): string {
  if (sequence <= 1) { return base; }
  const tail = `-${sequence}`;
  const head = base.slice(0, 16 - tail.length).replace(/[_-]+$/u, "");
  return `${head}${tail}`;
}

const ROSTER_USERNAME_SUFFIX_LIMIT = 999;

export class PlayerOnboardingService {
  public constructor(
    private readonly repository: PlayerOnboardingRepository,
    private readonly idGenerator: OnboardingIdGenerator,
    private readonly clock: OnboardingClock,
    /** ADR-0221: who may create Players and who counts; absent = the defaults (everybody). */
    private readonly settings?: InstallationSettingsReader,
  ) {}

  /** ADR-0221: refuses when the installation closed the Directors' path; tells whether to seed a rating. */
  private async directorCreation(): Promise<Readonly<{ seedRating: boolean }>> {
    if (this.settings === undefined) { return { seedRating: true }; }
    const settings = await this.settings.current();
    if (!directorPlayerCreationAllowed(settings)) { throw new PlayerCreationDisabled("directors"); }
    return { seedRating: settings.ratingEligibility !== "claimed_only" };
  }

  // ADR-0160: an administrator can create a canonical Player for someone at
  // a tournament night who has no account yet. The Player has no UserAccount
  // and no PlayerClaim - exactly the shape of the existing account-less
  // competitive Players - so nobody is auto-linked and no email is sent.
  public async createPlayerForAdministrator(
    actor: ActorContext,
    command: CreateOwnPlayerCommand,
  ): Promise<AdministratorPlayerCreated> {
    if (actor.role !== "administrator") {
      throw new PlayerOnboardingError("forbidden", "administrator actor required");
    }
    const username = command.username;
    if (!usernamePattern.test(username)) {
      throw new PlayerOnboardingError(
        "invalid_command",
        "username must be 3-16 lower-case a-z, 0-9, '-', or '_' characters",
      );
    }
    const displayName = (command.displayName ?? username).trim();
    if (displayName.length < 1 || displayName.length > 64 ||
      controlCharacters.test(displayName)) {
      throw new PlayerOnboardingError(
        "invalid_command",
        "displayName must be 1-64 printable characters",
      );
    }
    const { seedRating } = await this.directorCreation();
    const playerId = this.idGenerator.newPlayerId();
    const nowMs = this.clock.nowMs();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      throw new PlayerOnboardingError("conflict", "onboarding clock is invalid");
    }
    return this.repository.transaction(async (transaction) => {
      const accountStatus =
        await transaction.findUserAccountStatus(actor.userAccountId);
      if (accountStatus !== "active") {
        throw new PlayerOnboardingError("conflict", "the administrator account is not active");
      }
      const creation = await transaction.createPlayerWithUsername({
        playerId, username, displayName, nowMs, seedRating,
      });
      if (creation === "username_taken") {
        throw new PlayerOnboardingError("username_taken", "this username is already in use");
      }
      return { playerId, username, displayName };
    });
  }

  /**
   * Creates every named Player in one transaction, or none of them. The caller
   * is a Tournament operator: an administrator, or an account the
   * `rosterOperatorCheck` dependency accepts.
   */
  public async createRosterPlayers(
    actor: ActorContext,
    requests: readonly RosterPlayerRequest[],
    rosterOperatorCheck?: (userAccountId: string) => Promise<boolean>,
    options: Readonly<{ tournamentId?: string }> = {},
  ): Promise<readonly AdministratorPlayerCreated[]> {
    const authorized = actor.role === "administrator" ||
      (actor.role === "account" && rosterOperatorCheck !== undefined &&
        await rosterOperatorCheck(actor.userAccountId));
    if (!authorized) {
      throw new PlayerOnboardingError("forbidden", "Tournament operator actor required");
    }
    if (requests.length === 0 || requests.length > 512) {
      throw new PlayerOnboardingError("invalid_command", "between 1 and 512 Players may be created at once");
    }
    const { seedRating } = await this.directorCreation();
    const rejections: RosterPlayerRejection[] = [];
    const seenDisplayNames = new Map<string, number>();
    const planned: Array<{ row: number; displayName: string; base: string; confirmSameName: boolean }> = [];
    for (const request of requests) {
      const displayName = request.displayName.trim();
      const username = rosterUsernameFor(displayName);
      if (displayName.length < 1 || displayName.length > 64 ||
        controlCharacters.test(displayName) || username === null) {
        rejections.push({ row: request.row, displayName, reason: "invalid_display_name" });
        continue;
      }
      // A file names each row by its name, so the same name twice in one file
      // stays ambiguous; two Players called Marc come from two separate picks.
      const displayKey = displayName.toLowerCase();
      if (seenDisplayNames.has(displayKey)) {
        rejections.push({ row: request.row, displayName, reason: "duplicate_display_name_in_file" });
        continue;
      }
      seenDisplayNames.set(displayKey, request.row);
      planned.push({ row: request.row, displayName, base: username, confirmSameName: request.confirmSameName === true });
    }
    if (rejections.length > 0) { throw new RosterPlayerCreationRejected(rejections); }
    const nowMs = this.clock.nowMs();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      throw new PlayerOnboardingError("conflict", "onboarding clock is invalid");
    }
    return this.repository.transaction(async (transaction) => {
      const created: AdministratorPlayerCreated[] = [];
      const failures: RosterPlayerRejection[] = [];
      // ADR-0218: a name that already exists in this Director's own nights is
      // created only after the Director confirmed the warning; across
      // Directors a repeated name is allowed without a question.
      const ownNames = transaction.displayNamesInDirectorNights === undefined
        ? new Set<string>()
        : await transaction.displayNamesInDirectorNights({
          actorUserAccountId: actor.userAccountId,
          tournamentId: options.tournamentId ?? null,
          displayNames: planned.map((entry) => entry.displayName),
        });
      for (const entry of planned) {
        if (!entry.confirmSameName && ownNames.has(entry.displayName.toLowerCase())) {
          failures.push({ row: entry.row, displayName: entry.displayName, reason: "display_name_taken" });
        }
      }
      if (failures.length > 0) { throw new RosterPlayerCreationRejected(failures); }
      const allocated = new Set<string>();
      for (const entry of planned) {
        let username: string | null = null;
        for (let sequence = 1; sequence <= ROSTER_USERNAME_SUFFIX_LIMIT && username === null; sequence += 1) {
          const candidate = rosterUsernameWithSuffix(entry.base, sequence);
          if (allocated.has(candidate)) { continue; }
          if (transaction.usernameTaken !== undefined && await transaction.usernameTaken(candidate)) { continue; }
          username = candidate;
        }
        if (username === null) {
          failures.push({ row: entry.row, displayName: entry.displayName, reason: "username_taken" });
          continue;
        }
        allocated.add(username);
        const playerId = this.idGenerator.newPlayerId();
        const outcome = await transaction.createPlayerWithUsername({
          playerId, username, displayName: entry.displayName, nowMs, seedRating,
        });
        if (outcome === "created") {
          created.push({ playerId, username, displayName: entry.displayName });
          continue;
        }
        failures.push({ row: entry.row, displayName: entry.displayName, reason: outcome });
      }
      // Rolling back the transaction is what makes "nothing is written" true.
      if (failures.length > 0) { throw new RosterPlayerCreationRejected(failures); }
      return created;
    });
  }

  public async createOwnPlayer(
    actor: ActorContext,
    command: CreateOwnPlayerCommand,
  ): Promise<OwnPlayerCreated> {
    if (actor.role !== "account" && actor.role !== "administrator") {
      throw new PlayerOnboardingError("forbidden", "account actor required");
    }
    const userAccountId = actor.userAccountId;
    if (this.settings !== undefined && !selfServicePlayerCreationAllowed(await this.settings.current())) {
      throw new PlayerCreationDisabled("self");
    }
    const username = command.username;
    if (!usernamePattern.test(username)) {
      throw new PlayerOnboardingError(
        "invalid_command",
        "username must be 3-16 lower-case a-z, 0-9, '-', or '_' characters",
      );
    }
    const displayName = (command.displayName ?? username).trim();
    if (displayName.length < 1 || displayName.length > 64 ||
      controlCharacters.test(displayName)) {
      throw new PlayerOnboardingError(
        "invalid_command",
        "displayName must be 1-64 printable characters",
      );
    }
    const playerId = this.idGenerator.newPlayerId();
    const playerClaimId = this.idGenerator.newPlayerClaimId();
    const nowMs = this.clock.nowMs();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      throw new PlayerOnboardingError("conflict", "onboarding clock is invalid");
    }

    return this.repository.transaction(async (transaction) => {
      const accountStatus =
        await transaction.findUserAccountStatus(userAccountId);
      if (accountStatus === null || accountStatus !== "active") {
        throw new PlayerOnboardingError(
          "conflict",
          "the signed-in account is not active",
        );
      }
      if (await transaction.hasVerifiedClaimForUserAccount(userAccountId)) {
        throw new PlayerOnboardingError(
          "already_linked",
          "this account is already linked to a Player",
        );
      }
      const creation = await transaction.createPlayerWithUsername({
        playerId,
        username,
        displayName,
        nowMs,
      });
      if (creation === "username_taken") {
        throw new PlayerOnboardingError(
          "username_taken",
          "this username is already in use",
        );
      }
      await transaction.createVerifiedClaim({
        playerClaimId,
        playerId,
        userAccountId,
        reasonCode: SELF_SERVICE_PLAYER_CREATION_REASON,
        nowMs,
      });
      return { playerId, username, displayName, playerClaimId };
    });
  }
}
