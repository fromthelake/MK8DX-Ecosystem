// ADR-0217: a Tournament race's class, read from the track-intro badge. A Mirror race is mode 150 with mirror: true.
import { localized } from "./product-language.js";

export type TournamentRaceMode = 50 | 100 | 150 | 200;
export const TOURNAMENT_RACE_MODES: readonly TournamentRaceMode[] = [50, 100, 150, 200];

export function isTournamentRaceMode(value: unknown): value is TournamentRaceMode {
  return TOURNAMENT_RACE_MODES.includes(value as TournamentRaceMode);
}

/** "50cc" … "200cc", or "Mirror" for a mirrored 150cc race; null when the class is not known. */
export function tournamentRaceClassLabel(mode: number | undefined, mirror?: boolean): string | null {
  if (mode === undefined) { return null; }
  if (mirror === true && mode === 150) { return localized("Mirror", "Spiegel"); }
  return `${mode}cc`;
}

