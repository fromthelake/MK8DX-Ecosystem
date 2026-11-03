import type { ActorContext } from "../identity/types.js";

// Country is public profile metadata, never identity evidence: a signed
// in account may set, change, or clear the country of the Player it
// holds a verified claim on. Values come only from the canonical
// schema-9 country catalog - no free text, no inference.

export class PlayerCountryError extends Error {
  public constructor(
    public readonly code:
      | "invalid_input"
      | "not_authenticated"
      | "no_verified_player"
      | "unavailable",
  ) {
    super("The Player country could not be updated.");
    this.name = "PlayerCountryError";
  }
}

export interface PlayerCountryRepository {
  // Returns false when the account holds no verified Player claim.
  setCountryForAccount(
    userAccountId: string,
    countryId: string | null,
  ): Promise<boolean>;
}

export interface CountryCatalog {
  hasCountry(countryId: string): boolean;
}

const countryIdPattern = /^country\.[a-z0-9_]+$/;

export class PlayerCountryService {
  public constructor(
    private readonly repository: PlayerCountryRepository,
    private readonly catalog: CountryCatalog,
  ) {}

  public async setOwnCountry(
    actor: ActorContext,
    countryId: string | null,
  ): Promise<void> {
    if (actor.role !== "account" && actor.role !== "administrator") {
      throw new PlayerCountryError("not_authenticated");
    }
    if (countryId !== null &&
        (!countryIdPattern.test(countryId) ||
         !this.catalog.hasCountry(countryId))) {
      throw new PlayerCountryError("invalid_input");
    }
    let updated: boolean;
    try {
      updated = await this.repository.setCountryForAccount(
        actor.userAccountId,
        countryId,
      );
    } catch {
      throw new PlayerCountryError("unavailable");
    }
    if (!updated) {
      throw new PlayerCountryError("no_verified_player");
    }
  }
}

export class MysqlPlayerCountryRepository implements PlayerCountryRepository {
  public constructor(
    private readonly executor: Pick<
      import("mysql2/promise").Pool,
      "execute"
    >,
  ) {}

  public async setCountryForAccount(
    userAccountId: string,
    countryId: string | null,
  ): Promise<boolean> {
    const [rows] = await this.executor.execute(
      `SELECT player.player_id AS playerInternalId
       FROM players AS player
       INNER JOIN player_claims AS claim
         ON claim.player_id = player.player_id
        AND claim.claim_status = 'verified'
       INNER JOIN user_accounts AS account
         ON account.user_account_id = claim.user_account_id
       WHERE account.public_id = ? AND player.record_status = 'active'
       LIMIT 1`,
      [userAccountId],
    );
    const row = (rows as readonly { playerInternalId?: unknown }[])[0];
    const playerInternalId = Number(row?.playerInternalId);
    if (!Number.isSafeInteger(playerInternalId)) { return false; }
    await this.executor.execute(
      `UPDATE players SET country_id = ? WHERE player_id = ?`,
      [countryId, playerInternalId],
    );
    return true;
  }
}
