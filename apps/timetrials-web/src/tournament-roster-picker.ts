// ADR-0218: a name is never an identity.
//
// What the Director sees to choose between Players a typed name may mean:
// whose nights they played, the last night, a character picture when one was
// recorded, claimed or not. The choice itself is always the Director's; these
// helpers only describe candidates and say what an import row starts as.

import { localized } from "./product-language.js";
import { tournamentCharacterIcon } from "./tournament-character.js";
import type { RosterNameCandidates, RosterPlayerCandidate } from "./tournament-operation-client.js";

const nightsText = (count: number): string => count === 1
  ? localized("1 night", "1 avond")
  : localized(`${count} nights`, `${count} avonden`);

/** One line of context that tells two equal names apart. */
export function rosterCandidateContext(candidate: RosterPlayerCandidate): string {
  const parts: string[] = [`@${candidate.username}`];
  if (candidate.matchedBy === "alias" && candidate.aliasText !== undefined) {
    parts.push(candidate.aliasScope === "director"
      ? localized(`your name for them: ${candidate.aliasText}`, `jouw naam voor deze speler: ${candidate.aliasText}`)
      : localized(`also known as ${candidate.aliasText}`, `ook bekend als ${candidate.aliasText}`));
  }
  if (candidate.nights === 0) {
    parts.push(localized("no nights yet", "nog geen avonden"));
  } else if (candidate.nightsWithDirector > 0) {
    parts.push(localized(
      `${nightsText(candidate.nights)}, ${candidate.nightsWithDirector} with this Director`,
      `${nightsText(candidate.nights)}, ${candidate.nightsWithDirector} bij deze Directeur`,
    ));
  } else {
    parts.push(nightsText(candidate.nights));
  }
  if (candidate.lastNightName !== undefined) {
    parts.push(candidate.lastNightDate === undefined
      ? localized(`last: ${candidate.lastNightName}`, `laatst: ${candidate.lastNightName}`)
      : localized(`last: ${candidate.lastNightName} (${candidate.lastNightDate})`, `laatst: ${candidate.lastNightName} (${candidate.lastNightDate})`));
  }
  if (candidate.directorNames.length > 0) {
    parts.push(localized(`Directors: ${candidate.directorNames.join(", ")}`, `Directeuren: ${candidate.directorNames.join(", ")}`));
  }
  parts.push(candidate.claimed
    ? localized("has an account", "heeft een account")
    : localized("no account yet", "nog geen account"));
  if (candidate.inTournament) { parts.push(localized("on this night's list", "staat op de lijst van deze avond")); }
  return parts.join(" · ");
}

/** The candidate as a small card: picture, name and the context line. */
export function rosterCandidateElement(owner: Document, candidate: RosterPlayerCandidate): HTMLElement {
  const card = owner.createElement("span");
  card.className = "tournament-roster-candidate";
  const icon = tournamentCharacterIcon(candidate.characterLabel === undefined ? undefined : {
    label: candidate.characterLabel,
    ...(candidate.characterKey === undefined ? {} : { key: candidate.characterKey }),
  });
  if (icon !== null) {
    const picture = owner.createElement("img");
    picture.className = "tournament-roster-candidate__icon";
    picture.src = icon;
    picture.alt = "";
    picture.width = 28;
    picture.height = 28;
    picture.loading = "lazy";
    card.append(picture);
  }
  const words = owner.createElement("span");
  words.className = "tournament-roster-candidate__words";
  const name = owner.createElement("strong");
  name.textContent = candidate.displayName;
  const context = owner.createElement("small");
  context.className = "tournament-roster-candidate__context";
  context.textContent = rosterCandidateContext(candidate);
  words.append(name, context);
  card.append(words);
  return card;
}

/**
 * ADR-0221: what a Director reads where "new Player" would be, when the
 * installation lets Players only create themselves by signing up.
 */
export function rosterCreationClosedText(): string {
  return localized(
    "On this site Players create themselves when they sign up. Ask the person to sign up, then add their Player.",
    "Op deze site maken spelers zichzelf aan bij het aanmelden. Vraag de persoon zich aan te melden en voeg daarna zijn speler toe.",
  );
}

/**
 * The choice for one typed name: every candidate with its context and a
 * button, then "new Player". A name already on this Director's rosters makes
 * "new Player" say so and ask once more before it creates another one.
 */
export function rosterChoiceList(owner: Document, entry: RosterNameCandidates, handlers: Readonly<{
  pickLabel: (candidate: RosterPlayerCandidate) => string;
  onPick: (candidate: RosterPlayerCandidate) => void;
  /** Absent when this place cannot create a Player. */
  onCreate?: (confirmSameName: boolean) => void;
  /** ADR-0221: shown instead of "new Player" when the installation closed that path. */
  creationClosed?: boolean;
  /** A candidate already on this night's list cannot be picked again here. */
  blockOnNight?: boolean;
}>): HTMLElement {
  const box = owner.createElement("div");
  box.className = "tournament-roster-choices";
  const intro = owner.createElement("p");
  intro.className = "tournament-op__hint";
  intro.textContent = entry.candidates.length === 0
    ? localized(`Nobody is called "${entry.name}" yet.`, `Niemand heet nog "${entry.name}".`)
    : localized(
      `Who is "${entry.name}"? A name is never an identity: choose the Player, or create a new one.`,
      `Wie is "${entry.name}"? Een naam is nooit een identiteit: kies de speler, of maak een nieuwe aan.`,
    );
  box.append(intro);
  const list = owner.createElement("ul");
  list.className = "tournament-roster-choices__list";
  for (const candidate of entry.candidates) {
    const item = owner.createElement("li");
    item.className = "tournament-roster-choices__item";
    const pick = owner.createElement("button");
    pick.type = "button";
    pick.className = "tt-auth__button";
    const blocked = handlers.blockOnNight === true && candidate.inTournament;
    pick.textContent = blocked ? localized("Already on the list", "Staat al op de lijst") : handlers.pickLabel(candidate);
    pick.disabled = blocked;
    pick.addEventListener("click", () => handlers.onPick(candidate));
    item.append(rosterCandidateElement(owner, candidate), pick);
    list.append(item);
  }
  if (entry.candidates.length > 0) { box.append(list); }
  const onCreate = handlers.creationClosed === true ? undefined : handlers.onCreate;
  if (handlers.creationClosed === true) {
    const closed = owner.createElement("p");
    closed.className = "tournament-op__hint";
    closed.textContent = rosterCreationClosedText();
    box.append(closed);
  }
  if (onCreate !== undefined) {
    const create = owner.createElement("button");
    create.type = "button";
    create.className = "tt-auth__button";
    if (entry.sameNameInOwnNights) {
      const warning = owner.createElement("p");
      warning.className = "tournament-op__hint tournament-roster-choices__warning";
      warning.setAttribute("role", "alert");
      warning.textContent = localized(
        `There is already a "${entry.name}" in your nights. Only create a new Player if this is someone else; their username gets a number (for example -2).`,
        `Er is al een "${entry.name}" in jouw avonden. Maak alleen een nieuwe speler aan als dit iemand anders is; de gebruikersnaam krijgt een nummer (bijvoorbeeld -2).`,
      );
      box.append(warning);
      create.textContent = localized(`Create another "${entry.name}"`, `Nog een "${entry.name}" aanmaken`);
    } else {
      create.textContent = localized(`New Player "${entry.name}"`, `Nieuwe speler "${entry.name}"`);
    }
    create.addEventListener("click", () => onCreate(entry.sameNameInOwnNights));
    box.append(create);
  }
  return box;
}

/** The text a `<select>` option can carry (no pictures there). */
export function rosterCandidateOptionText(candidate: RosterPlayerCandidate): string {
  return `${candidate.displayName} — ${rosterCandidateContext(candidate)}`;
}

export type RosterRowChoice =
  | Readonly<{ kind: "player"; playerId: string }>
  | Readonly<{ kind: "new" }>
  | Readonly<{ kind: "skip" }>;

/**
 * What an import row starts as before the Director applies the file. Only an
 * unambiguous answer is suggested: the one Player of this night's list who
 * carries the name, or the one Player of this Director's own nights who does.
 * A name nobody carries starts as "new Player" (creation still asks twice).
 * Every other row waits for a choice (null). Nothing is written until the
 * Director applies the whole table.
 */
export function rosterImportSuggestion(entry: RosterNameCandidates): RosterRowChoice | null {
  const exact = entry.candidates.filter((candidate) => candidate.matchedBy !== "partial");
  if (exact.length === 0) { return { kind: "new" }; }
  const onNight = exact.filter((candidate) => candidate.inTournament);
  if (onNight.length === 1) { return { kind: "player", playerId: onNight[0]!.playerId }; }
  if (onNight.length > 1) { return null; }
  const own = exact.filter((candidate) => candidate.nightsWithDirector > 0 ||
    (candidate.matchedBy === "alias" && candidate.aliasScope === "director"));
  if (exact.length === 1 && own.length === 1) { return { kind: "player", playerId: own[0]!.playerId }; }
  return null;
}

/**
 * The spellings worth keeping as the Director's own alias: the file named the
 * Player differently from their display name and username, and not by a name
 * they already answer to.
 */
export function rosterAliasesToRemember(
  rows: readonly Readonly<{ name: string; candidate: RosterPlayerCandidate }>[],
): readonly Readonly<{ playerId: string; name: string }>[] {
  const fold = (value: string): string => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/gu, "");
  const seen = new Set<string>();
  const keep: { playerId: string; name: string }[] = [];
  for (const row of rows) {
    const key = fold(row.name);
    if (key.length === 0) { continue; }
    if (key === fold(row.candidate.displayName) || key === fold(row.candidate.username)) { continue; }
    // A name that already matched as an alias is one the Player answers to.
    if (row.candidate.matchedBy === "alias") { continue; }
    const unique = `${row.candidate.playerId}\n${key}`;
    if (seen.has(unique)) { continue; }
    seen.add(unique);
    keep.push({ playerId: row.candidate.playerId, name: row.name.trim() });
  }
  return keep;
}
