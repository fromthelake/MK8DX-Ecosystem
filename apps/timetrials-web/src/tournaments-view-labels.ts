// The names a group is shown under: the tier's own name in the visitor's
// language, and "Groep 3" as "Group 3" in English. Shared by the night page
// and its report so both say the same thing.
//
// The server stores a final group under its Dutch tier name ("Kampioen"); a
// group without a tier key is recognised by that stored name, so no screen
// shows the raw Dutch name to a reader of another language.

import { localized } from "./product-language.js";
import { TOURNAMENT_TIERS, tournamentGroupTierByName, tournamentTierLabel } from "./tournament-tiers.js";

export function tournamentGroupLabel(name: string, tierKey?: string): string {
  const tier = tierKey === undefined
    ? tournamentGroupTierByName(name)
    : TOURNAMENT_TIERS.find((candidate) => candidate.key === tierKey);
  if (tier === undefined) { return name; }
  return tournamentTierLabel(tier.key) ?? name;
}

export function displayTournamentGroupLabel(name: string, tierKey?: string): string {
  const label = tournamentGroupLabel(name, tierKey);
  const generatedGroup = /^Groep (\d+)$/i.exec(label.trim());
  return generatedGroup === null ? label : localized(`Group ${generatedGroup[1]}`, `Groep ${generatedGroup[1]}`);
}
