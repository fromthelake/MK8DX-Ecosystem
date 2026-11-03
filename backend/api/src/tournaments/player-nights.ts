// The nights a Player took part in, counted the same way wherever a Player is
// described with context: the Director's roster picker (ADR-0218) and the
// person finding themselves at sign-up (ADR-0219).
//
// A night is a canonical Tournament the Player was present at, or a legacy /
// history edition they have races in. One edition counts once: a canonical
// Tournament carrying an edition number and the same edition in the imported
// history are the same night, and the canonical one (it has a Director) wins.

/** A Director's name: the display name of the Player their account owns (first verified claim). */
export const DIRECTOR_NAME_SQL = (accountColumn: string): string => `(
  SELECT named.display_name FROM player_claims AS name_claim
  INNER JOIN players AS named ON named.player_id = name_claim.player_id
  WHERE name_claim.user_account_id = ${accountColumn} AND name_claim.claim_status = 'verified'
  ORDER BY name_claim.updated_at_ms ASC LIMIT 1)`;

export type PlayerNight = Readonly<{
  key: string;
  name: string | null;
  date: string | null;
  /** Sort position: start time for a canonical night, a low number for history editions. */
  at: number;
  director: number | null;
}>;

/** The key under which a canonical Tournament counts (its edition when it has one). */
export function canonicalNightKey(tournamentInternalId: number, editionNumber: number | null): string {
  return editionNumber === null ? `t${tournamentInternalId}` : `TN${editionNumber}`;
}

/** A legacy or history edition: no Director, no date, ordered before every canonical night. */
export function historyEditionNight(editionNumber: number): PlayerNight {
  return { key: `TN${editionNumber}`, name: `TN${editionNumber}`, date: null, at: -1_000_000 + editionNumber, director: null };
}

/** Per Player, the distinct nights they took part in. */
export class PlayerNightLedger {
  private readonly nights = new Map<number, Map<string, PlayerNight>>();

  public add(owner: number, night: PlayerNight): void {
    const list = this.nights.get(owner) ?? new Map<string, PlayerNight>();
    const earlier = list.get(night.key);
    // A canonical night outranks the same edition from the legacy history.
    if (earlier === undefined || (earlier.director === null && night.director !== null)) { list.set(night.key, night); }
    this.nights.set(owner, list);
  }

  public of(owner: number): readonly PlayerNight[] {
    return [...(this.nights.get(owner)?.values() ?? [])];
  }
}

/** The most recent night, or null. */
export function lastPlayerNight(nights: readonly PlayerNight[]): PlayerNight | null {
  return nights.reduce<PlayerNight | null>((latest, night) => latest === null || night.at > latest.at ? night : latest, null);
}

/** The distinct names of the Directors of these nights, in the order first met. */
export function playerNightDirectorNames(
  nights: readonly PlayerNight[],
  directorNames: ReadonlyMap<number, string>,
): readonly string[] {
  return [...new Set(nights
    .map((night) => night.director === null ? undefined : directorNames.get(night.director))
    .filter((name): name is string => name !== undefined))];
}
