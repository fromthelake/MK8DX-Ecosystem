// Installation settings (ADR-0221): who creates Players, and who counts for
// the one rating this installation keeps. ADR-0225 adds a third: whether this
// community accepts Time Trial times carried from another community.
//
// Only administrators change them. Every change is audited (who, when, which
// setting, from what to what). Changing who counts does not silently rebuild
// anybody's rating: the administrator page says the ratings are out of date
// and the administrator recalculates them explicitly, through the same
// faithful history replay every other recalculation uses (ADR-0155 addendum).
// A claim that is approved, released or revoked while claims matter for the
// rating makes the ratings out of date in the same way.

import type { ActorContext } from "../identity/types.js";

export type PlayerCreationPolicy = "self_and_directors" | "self_only" | "directors_only";
export type RatingEligibilityPolicy = "all_players" | "claimed_only";
/** ADR-0225: off refuses carried times, review holds each for an administrator, allowed applies the normal rules. */
export type CarriedTimesPolicy = "off" | "review" | "allowed";

export const PLAYER_CREATION_POLICIES: readonly PlayerCreationPolicy[] = ["self_and_directors", "self_only", "directors_only"];
export const RATING_ELIGIBILITY_POLICIES: readonly RatingEligibilityPolicy[] = ["all_players", "claimed_only"];
export const CARRIED_TIMES_POLICIES: readonly CarriedTimesPolicy[] = ["off", "review", "allowed"];

export type InstallationSettings = Readonly<{
  playerCreation: PlayerCreationPolicy;
  ratingEligibility: RatingEligibilityPolicy;
  carriedTimes: CarriedTimesPolicy;
}>;

export const DEFAULT_INSTALLATION_SETTINGS: InstallationSettings = {
  playerCreation: "self_and_directors",
  ratingEligibility: "all_players",
  carriedTimes: "off",
};

export function selfServicePlayerCreationAllowed(settings: InstallationSettings): boolean {
  return settings.playerCreation !== "directors_only";
}

export function directorPlayerCreationAllowed(settings: InstallationSettings): boolean {
  return settings.playerCreation !== "self_only";
}

export type StoredInstallationSettings = InstallationSettings & Readonly<{
  revision: number;
  ratingEligibilityChangedAtMs: number | null;
  updatedAtMs: number;
}>;

export type RatingRecomputeStatus = Readonly<{
  /** True when the ratings no longer follow the current rules of who counts. */
  needed: boolean;
  /** Eligibility changed after the last recalculation. */
  eligibilityChanged: boolean;
  /** Claims of Players with races approved, released or revoked since then, while claims matter. */
  claimChanges: number;
  lastRecalculatedAtMs: number | null;
}>;

export type InstallationSettingsAdministration = InstallationSettings & Readonly<{
  revision: number;
  updatedAtMs: number | null;
  ratingRecompute: RatingRecomputeStatus;
}>;

export type RatingRecomputeResult = Readonly<{
  epoch: number;
  includedPublications: number;
  appliedRaces: number;
  skippedRaces: number;
  ratedPlayers: number;
}>;

export class InstallationSettingsError extends Error {
  public constructor(
    public readonly code: "forbidden" | "invalid_input" | "conflict" | "recompute_unavailable" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "InstallationSettingsError";
  }
}

export interface InstallationSettingsTransaction {
  findActiveAdministratorAccount(userAccountPublicId: string): Promise<number | null>;
  readForUpdate(): Promise<StoredInstallationSettings | null>;
  write(input: Readonly<{
    revision: number;
    playerCreation: PlayerCreationPolicy;
    ratingEligibility: RatingEligibilityPolicy;
    carriedTimes: CarriedTimesPolicy;
    ratingEligibilityChangedAtMs: number | null;
    updatedByInternalId: number;
    nowMs: number;
  }>): Promise<void>;
  appendChange(input: Readonly<{
    settingKey: "player_creation" | "rating_eligibility" | "carried_times";
    previousValue: string;
    newValue: string;
    changedByInternalId: number;
    nowMs: number;
  }>): Promise<void>;
}

export interface InstallationSettingsRepository {
  read(): Promise<StoredInstallationSettings | null>;
  /**
   * When the ratings were last rebuilt, and how many claims of Players with
   * races changed since a moment; `claimsMatter` says whether any night (or
   * the installation) currently counts only verified Players.
   */
  recomputeFacts(since: Readonly<{ ratingEligibility: RatingEligibilityPolicy }>): Promise<Readonly<{
    lastRecalculatedAtMs: number | null;
    claimsMatter: boolean;
    claimChangesSinceLastRecalculation: number;
  }>>;
  transaction<T>(work: (transaction: InstallationSettingsTransaction) => Promise<T>): Promise<T>;
}

export type InstallationSettingsReader = Readonly<{ current(): Promise<InstallationSettings> }>;

export class InstallationSettingsService implements InstallationSettingsReader {
  public constructor(
    private readonly dependencies: Readonly<{
      repository: InstallationSettingsRepository;
      clock: Readonly<{ nowMs(): number }>;
      /** The faithful recalculation (RatingLifecycleService.recalculate with the history replay). */
      recomputeRatings?: (input: Readonly<{ administratorAccountId: string; reasonCode: string }>) => Promise<RatingRecomputeResult>;
    }>,
  ) {}

  /** The public settings; the defaults while no administrator has saved any. */
  public async current(): Promise<InstallationSettings> {
    try {
      const stored = await this.dependencies.repository.read();
      return stored === null
        ? DEFAULT_INSTALLATION_SETTINGS
        : {
          playerCreation: stored.playerCreation,
          ratingEligibility: stored.ratingEligibility,
          carriedTimes: stored.carriedTimes,
        };
    } catch (error) {
      throw unavailable(error);
    }
  }

  public async administration(actor: ActorContext): Promise<InstallationSettingsAdministration> {
    administratorOnly(actor);
    try {
      const authorized = await this.dependencies.repository.transaction((transaction) =>
        transaction.findActiveAdministratorAccount(actor.userAccountId));
      if (authorized === null) { throw new InstallationSettingsError("forbidden", "An active administrator account is required."); }
      return await this.view(await this.dependencies.repository.read());
    } catch (error) {
      throw unavailable(error);
    }
  }

  public async update(actor: ActorContext, input: Readonly<{
    expectedRevision: number;
    playerCreation?: string;
    ratingEligibility?: string;
    carriedTimes?: string;
  }>): Promise<InstallationSettingsAdministration> {
    administratorOnly(actor);
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new InstallationSettingsError("invalid_input", "expectedRevision must be a whole number of at least 0.");
    }
    const playerCreation = input.playerCreation === undefined ? undefined : oneOf(input.playerCreation, PLAYER_CREATION_POLICIES, "playerCreation");
    const ratingEligibility = input.ratingEligibility === undefined ? undefined : oneOf(input.ratingEligibility, RATING_ELIGIBILITY_POLICIES, "ratingEligibility");
    const carriedTimes = input.carriedTimes === undefined ? undefined : oneOf(input.carriedTimes, CARRIED_TIMES_POLICIES, "carriedTimes");
    const nowMs = this.dependencies.clock.nowMs();
    try {
      const stored = await this.dependencies.repository.transaction(async (transaction) => {
        const administrator = await transaction.findActiveAdministratorAccount(actor.userAccountId);
        if (administrator === null) { throw new InstallationSettingsError("forbidden", "An active administrator account is required."); }
        const current = await transaction.readForUpdate();
        const revision = current?.revision ?? 0;
        if (revision !== input.expectedRevision) {
          throw new InstallationSettingsError("conflict", "The settings changed meanwhile. Reload and try again.");
        }
        const before: InstallationSettings = current ?? DEFAULT_INSTALLATION_SETTINGS;
        const after: InstallationSettings = {
          playerCreation: playerCreation ?? before.playerCreation,
          ratingEligibility: ratingEligibility ?? before.ratingEligibility,
          carriedTimes: carriedTimes ?? before.carriedTimes,
        };
        const creationChanged = after.playerCreation !== before.playerCreation;
        const eligibilityChanged = after.ratingEligibility !== before.ratingEligibility;
        const carriedChanged = after.carriedTimes !== before.carriedTimes;
        if (!creationChanged && !eligibilityChanged && !carriedChanged) { return current; }
        await transaction.write({
          revision: revision + 1,
          playerCreation: after.playerCreation,
          ratingEligibility: after.ratingEligibility,
          carriedTimes: after.carriedTimes,
          ratingEligibilityChangedAtMs: eligibilityChanged ? nowMs : current?.ratingEligibilityChangedAtMs ?? null,
          updatedByInternalId: administrator,
          nowMs,
        });
        if (creationChanged) {
          await transaction.appendChange({
            settingKey: "player_creation", previousValue: before.playerCreation, newValue: after.playerCreation,
            changedByInternalId: administrator, nowMs,
          });
        }
        if (eligibilityChanged) {
          await transaction.appendChange({
            settingKey: "rating_eligibility", previousValue: before.ratingEligibility, newValue: after.ratingEligibility,
            changedByInternalId: administrator, nowMs,
          });
        }
        if (carriedChanged) {
          await transaction.appendChange({
            settingKey: "carried_times", previousValue: before.carriedTimes, newValue: after.carriedTimes,
            changedByInternalId: administrator, nowMs,
          });
        }
        return transaction.readForUpdate();
      });
      return await this.view(stored);
    } catch (error) {
      throw unavailable(error);
    }
  }

  /**
   * The explicit, audited recalculation the administrator confirms after
   * changing who counts (or after claims changed while claims matter). It is
   * the faithful history replay; its `rating_recalculations` row names the
   * administrator and the reason `installation_rating_eligibility`.
   */
  public async recomputeRatings(actor: ActorContext): Promise<RatingRecomputeResult> {
    administratorOnly(actor);
    const recompute = this.dependencies.recomputeRatings;
    if (recompute === undefined) {
      throw new InstallationSettingsError("recompute_unavailable", "Ratings cannot be recalculated on this installation.");
    }
    try {
      return await recompute({ administratorAccountId: actor.userAccountId, reasonCode: "installation_rating_eligibility" });
    } catch (error) {
      if (error instanceof InstallationSettingsError) { throw error; }
      const code = (error as { code?: unknown }).code;
      if (code === "forbidden") { throw new InstallationSettingsError("forbidden", "An active administrator account is required."); }
      // The history replay refuses an installation without a corrected
      // history (the QA mirror); say so instead of a generic failure.
      const message = error instanceof Error && /history/i.test(error.message)
        ? `The rating history cannot be replayed here: ${error.message}`
        : "The ratings could not be recalculated.";
      throw new InstallationSettingsError("recompute_unavailable", message);
    }
  }

  private async view(stored: StoredInstallationSettings | null): Promise<InstallationSettingsAdministration> {
    const settings = stored ?? DEFAULT_INSTALLATION_SETTINGS;
    const facts = await this.dependencies.repository.recomputeFacts({ ratingEligibility: settings.ratingEligibility });
    const changedAt = stored?.ratingEligibilityChangedAtMs ?? null;
    const eligibilityChanged = changedAt !== null &&
      (facts.lastRecalculatedAtMs === null || changedAt > facts.lastRecalculatedAtMs);
    const claimChanges = facts.claimsMatter ? facts.claimChangesSinceLastRecalculation : 0;
    return {
      playerCreation: settings.playerCreation,
      ratingEligibility: settings.ratingEligibility,
      carriedTimes: settings.carriedTimes,
      revision: stored?.revision ?? 0,
      updatedAtMs: stored?.updatedAtMs ?? null,
      ratingRecompute: {
        needed: eligibilityChanged || claimChanges > 0,
        eligibilityChanged,
        claimChanges,
        lastRecalculatedAtMs: facts.lastRecalculatedAtMs,
      },
    };
  }
}

function administratorOnly(actor: ActorContext): asserts actor is Readonly<{ role: "administrator"; userAccountId: string }> {
  if (actor.role !== "administrator") {
    throw new InstallationSettingsError("forbidden", "Only administrators manage the installation settings.");
  }
}

function oneOf<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) {
    throw new InstallationSettingsError("invalid_input", `${label} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

function unavailable(error: unknown): Error {
  if (error instanceof InstallationSettingsError) { return error; }
  return new InstallationSettingsError("unavailable", "Installation settings are temporarily unavailable.");
}
