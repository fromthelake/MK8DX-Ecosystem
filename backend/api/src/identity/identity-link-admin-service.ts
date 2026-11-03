import type { ActorContext } from "./types.js";

/**
 * The administrator's view of who is who, and the two writes that change it.
 *
 * Three things have to line up before a returning Player sees their own
 * history: the address they sign in with, the Player their Time Trials belong
 * to, and the Player their Tournament results belong to. Usually those last
 * two are the same Player row and the whole job is one link. Sometimes they
 * are not - somebody recorded in the Tournament years under one name and in
 * Time Trials under another - and then the owner has to be able to see both
 * and decide.
 *
 * This service exists so that decision is always available and always
 * reversible, rather than something only a migration script could express.
 */
export type IdentityLinkError = "not_authorized" | "invalid_input" | "unavailable";

export class IdentityLinkAdminError extends Error {
  public constructor(public readonly code: IdentityLinkError, message: string) {
    super(message);
    this.name = "IdentityLinkAdminError";
  }
}

/** An address that can sign in, and the Player it currently resolves to. */
export type LinkableAccount = Readonly<{
  userAccountId: string;
  email: string | null;
  accountStatus: string;
  screenName: string | null;
  linkedPlayerId: string | null;
  linkedPlayerName: string | null;
  playerClaimId: string | null;
  lastSeenAtMs: number | null;
}>;

/**
 * A Player an administrator might link to, with enough of its history shown to
 * make the choice an informed one rather than a guess at a name.
 */
export type LinkablePlayer = Readonly<{
  playerId: string;
  displayName: string;
  username: string | null;
  timeTrials: number;
  tournamentRaces: number;
  linkedAccountId: string | null;
}>;

export type IdentityLinkOverview = Readonly<{
  accounts: readonly LinkableAccount[];
  players: readonly LinkablePlayer[];
}>;

export interface IdentityLinkReadRepository {
  listAccounts(): Promise<readonly LinkableAccount[]>;
  listPlayers(): Promise<readonly LinkablePlayer[]>;
  findClaimIdForAccount(userAccountId: string): Promise<string | null>;
}

export interface IdentityLinkClaimPort {
  administratorLink(
    actor: ActorContext,
    command: Readonly<{ userAccountId: string; playerId: string; reasonCode: string }>,
  ): Promise<{ playerClaimId: string }>;
  administratorAction(
    actor: ActorContext,
    command: Readonly<{
      playerClaimId: string;
      action: "revoke";
      reasonCode: string;
    }>,
  ): Promise<unknown>;
}

const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const userAccountIdPattern = /^user_account\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const reasonCodePattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;

function requireAdministrator(actor: ActorContext): void {
  if (actor.role !== "administrator") {
    throw new IdentityLinkAdminError(
      "not_authorized", "Player linking is an administrator surface.",
    );
  }
}

export class IdentityLinkAdminService {
  public constructor(
    private readonly repository: IdentityLinkReadRepository,
    private readonly claims: IdentityLinkClaimPort,
  ) {}

  public async overview(actor: ActorContext): Promise<IdentityLinkOverview> {
    requireAdministrator(actor);
    try {
      const [accounts, players] = await Promise.all([
        this.repository.listAccounts(),
        this.repository.listPlayers(),
      ]);
      return { accounts, players };
    } catch (error) {
      if (error instanceof IdentityLinkAdminError) { throw error; }
      throw new IdentityLinkAdminError("unavailable", "Player linking is unavailable.");
    }
  }

  public async link(
    actor: ActorContext,
    command: Readonly<{ userAccountId: string; playerId: string; reasonCode?: string }>,
  ): Promise<{ playerClaimId: string }> {
    requireAdministrator(actor);
    if (!userAccountIdPattern.test(command.userAccountId) ||
      !playerIdPattern.test(command.playerId)) {
      throw new IdentityLinkAdminError("invalid_input", "Provide a valid account and Player.");
    }
    const reasonCode = command.reasonCode ?? "administrator_link";
    if (!reasonCodePattern.test(reasonCode)) {
      throw new IdentityLinkAdminError("invalid_input", "The reason code is invalid.");
    }
    return this.claims.administratorLink(actor, {
      userAccountId: command.userAccountId,
      playerId: command.playerId,
      reasonCode,
    });
  }

  public async unlink(
    actor: ActorContext,
    command: Readonly<{ userAccountId: string; reasonCode?: string }>,
  ): Promise<{ unlinked: boolean }> {
    requireAdministrator(actor);
    if (!userAccountIdPattern.test(command.userAccountId)) {
      throw new IdentityLinkAdminError("invalid_input", "Provide a valid account.");
    }
    const reasonCode = command.reasonCode ?? "administrator_unlink";
    if (!reasonCodePattern.test(reasonCode)) {
      throw new IdentityLinkAdminError("invalid_input", "The reason code is invalid.");
    }
    const playerClaimId = await this.repository.findClaimIdForAccount(command.userAccountId);
    if (playerClaimId === null) {
      // Already unlinked: say so plainly rather than failing a request whose
      // intended end state already holds.
      return { unlinked: false };
    }
    await this.claims.administratorAction(actor, {
      playerClaimId, action: "revoke", reasonCode,
    });
    return { unlinked: true };
  }
}
