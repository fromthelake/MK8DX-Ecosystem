import type { ActorContext } from "../identity/types.js";

/**
 * The mapping between a name that was on the console and the person who was
 * actually holding the controller.
 *
 * The binder derives these from the races themselves - finishing order, end
 * points, and whether one race's running total continues the previous one -
 * and it is right almost every time. Almost is the problem. In TN07 the screen
 * said "Wanda" for the 242 points the rated history credits to Tobias: the
 * account was Wanda's, the driver was not. No amount of arithmetic finds that;
 * somebody who was in the room does.
 *
 * So a derived link is a starting point and this surface is where it stops
 * being one. A person picks the player, and the next rebuild of the history
 * leaves their answer alone.
 */

export type ObservedIdentityError =
  | "not_authorized" | "invalid_input" | "not_found" | "unavailable";

export class ObservedIdentityAdminError extends Error {
  public readonly code: ObservedIdentityError;
  public constructor(code: ObservedIdentityError, message: string) {
    super(message);
    this.name = "ObservedIdentityAdminError";
    this.code = code;
  }
}

export type ObservedIdentityLink = Readonly<{
  linkId: string;
  tournamentNumber: number;
  sectionId: string;
  sectionName: string;
  legacySectionLabel: string | null;
  observedName: string;
  playerId: string;
  playerName: string;
  decisionSource: "derived" | "manual";
  /** How often the binder's pairing agreed with the rated finishing order. */
  orderAgreement: number | null;
  videoPoints: number | null;
  historyPoints: number | null;
  note: string | null;
  placements: number;
}>;

export type LinkablePlayer = Readonly<{
  playerId: string;
  displayName: string;
  tournamentRaces: number;
}>;

export type ObservedIdentityOverview = Readonly<{
  links: readonly ObservedIdentityLink[];
  players: readonly LinkablePlayer[];
}>;

export type ObservedIdentityRepository = Readonly<{
  listLinks(): Promise<readonly ObservedIdentityLink[]>;
  listLinkablePlayers(): Promise<readonly LinkablePlayer[]>;
  assign(command: Readonly<{
    linkId: string;
    playerId: string;
    note: string | null;
    decidedByUserAccountId: string | null;
    decidedAtMs: number;
  }>): Promise<boolean>;
  restoreDerived(linkId: string): Promise<boolean>;
}>;

// ActorContext models account and administrator as one member with a union
// role, so Extract cannot pick the administrator out of it.
type AdministratorActor = Readonly<{
  role: "administrator"; userAccountId: string;
}>;

function requireAdministrator(actor: ActorContext): AdministratorActor {
  if (actor.role !== "administrator") {
    throw new ObservedIdentityAdminError(
      "not_authorized",
      "Reviewing observed identities is an administrator surface.",
    );
  }
  return actor as AdministratorActor;
}

const NOTE_LIMIT = 240;

export class ObservedIdentityAdminService {
  readonly #repository: ObservedIdentityRepository;
  readonly #nowMs: () => number;

  public constructor(
    repository: ObservedIdentityRepository,
    nowMs: () => number = () => Date.now(),
  ) {
    this.#repository = repository;
    this.#nowMs = nowMs;
  }

  public async overview(
    actor: ActorContext,
  ): Promise<ObservedIdentityOverview> {
    requireAdministrator(actor);
    const [links, players] = await Promise.all([
      this.#repository.listLinks(),
      this.#repository.listLinkablePlayers(),
    ]);
    return { links, players };
  }

  /** Replace what the binder concluded with what a person knows. */
  public async assign(
    actor: ActorContext,
    command: Readonly<{ linkId: string; playerId: string; note?: string }>,
  ): Promise<void> {
    const administrator = requireAdministrator(actor);
    if (command.linkId.length === 0 || command.linkId.length > 32 ||
      !/^[0-9]+$/u.test(command.linkId)) {
      throw new ObservedIdentityAdminError(
        "invalid_input", "The link reference is invalid.");
    }
    if (!/^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(command.playerId)) {
      throw new ObservedIdentityAdminError(
        "invalid_input", "The Player reference is invalid.");
    }
    const note = command.note?.trim() ?? "";
    if (note.length > NOTE_LIMIT) {
      throw new ObservedIdentityAdminError(
        "invalid_input", `A note is at most ${NOTE_LIMIT} characters.`);
    }
    const changed = await this.#repository.assign({
      linkId: command.linkId,
      playerId: command.playerId,
      note: note.length === 0 ? null : note,
      decidedByUserAccountId: administrator.userAccountId,
      decidedAtMs: this.#nowMs(),
    });
    if (!changed) {
      throw new ObservedIdentityAdminError(
        "not_found", "That observed name is no longer in the history.");
    }
  }

  /**
   * Hand a seat back to the binder. Useful when a correction turns out to have
   * been the mistake: the derived answer is recomputed on the next rebuild
   * rather than frozen as somebody's error.
   */
  public async restoreDerived(
    actor: ActorContext, linkId: string,
  ): Promise<void> {
    requireAdministrator(actor);
    if (!/^[0-9]+$/u.test(linkId)) {
      throw new ObservedIdentityAdminError(
        "invalid_input", "The link reference is invalid.");
    }
    const changed = await this.#repository.restoreDerived(linkId);
    if (!changed) {
      throw new ObservedIdentityAdminError(
        "not_found", "That observed name is no longer in the history.");
    }
  }
}
