// The character a Player drove, as a score workbook names it, matched onto the
// catalog so the report can print the same picture the community's own export
// does.
//
// Tournament Live and the recorded Processor write two columns: `Character`
// ("Pink Yoshi", "Tanooki Mario", "Mii") and `Character Roster` ("Yoshi",
// "Tanooki Mario", "Mii") - the second is the base a colour belongs to. The
// catalog has the bases (`character.yoshi`) and their colour variants
// (`character_variant.yoshi.0xx_pink`), so the pair resolves to one picture.

import { GAME_ASSET_BASE } from "./asset-manifest.js";
import { CHARACTER_PARTS } from "./loadout-manifest.js";
import { CHARACTER_COLOR_VARIANTS } from "./loadout-variants.js";

export type TournamentCharacter = Readonly<{
  /** The catalog identifier, when one was recognised. */
  key?: string;
  /** Always what the workbook wrote. */
  label: string;
  roster?: string;
}>;

const fold = (value: string): string => value.normalize("NFKD").replace(/\p{M}/gu, "")
  .toLowerCase().replace(/[^a-z0-9]/gu, "");

const BY_KEY = new Map<string, string>([
  ...CHARACTER_PARTS.map((part) => [part.id, part.iconPath] as const),
  ...CHARACTER_COLOR_VARIANTS.map((variant) => [variant.id, variant.iconPath] as const),
]);

const BY_NAME = new Map<string, string>(CHARACTER_PARTS.map((part) => [fold(part.name), part.id] as const));

/**
 * The recording cannot tell a Mii's weight class, so a bare "Mii" is the
 * medium one (the owner's decision of 2026-09-08); the label stays "Mii".
 * The Processor also names the two Villagers differently from the catalog.
 */
const NAME_ALIASES = new Map<string, string>([
  ["mii", fold("Mii (Medium)")],
  ["villagermale", fold("Villager (Boy)")],
  ["villagerfemale", fold("Villager (Girl)")],
]);

/** Every colour a variant answers to, longest first so "light blue" wins. */
const COLOURS = [...new Set(CHARACTER_COLOR_VARIANTS.flatMap((variant) => [fold(variant.colorFamily), fold(variant.name)]))]
  .filter((colour) => colour.length > 2)
  .sort((left, right) => right.length - left.length);

/**
 * The catalog identifier for a workbook's character, or null when nothing in
 * the catalog carries that name. "Pink Yoshi" with roster "Yoshi" is the pink
 * variant of Yoshi; "Waluigi" is Waluigi; "Mii" is nobody the catalog knows.
 */
export function tournamentCharacterKey(character: string, roster?: string): string | null {
  const wanted = fold(character);
  if (wanted.length === 0) { return null; }
  const aliased = NAME_ALIASES.get(wanted) ?? wanted;
  const exact = BY_NAME.get(aliased);
  if (exact !== undefined) { return exact; }
  // "Purple Inkling Boy" is a colour and a character the catalog carries.
  for (const colour of COLOURS) {
    if (!aliased.startsWith(colour)) { continue; }
    const rest = aliased.slice(colour.length);
    const base = BY_NAME.get(NAME_ALIASES.get(rest) ?? rest);
    if (base === undefined) { continue; }
    const variant = CHARACTER_COLOR_VARIANTS.find((candidate) => candidate.baseId === base &&
      (fold(candidate.colorFamily) === colour || fold(candidate.name) === colour));
    return variant?.id ?? base;
  }
  const base = roster === undefined ? null : BY_NAME.get(fold(roster));
  if (base === null || base === undefined) { return null; }
  // What the character name says beyond its roster is the colour.
  const colour = fold(character).replace(fold(roster ?? ""), "");
  if (colour.length === 0) { return base; }
  const variant = CHARACTER_COLOR_VARIANTS.find((candidate) =>
    candidate.baseId === base && (fold(candidate.colorFamily) === colour || fold(candidate.name) === colour));
  return variant?.id ?? base;
}

/** The picture of a recorded character, or null when the catalog has none. */
export function tournamentCharacterIcon(character: TournamentCharacter | undefined): string | null {
  if (character === undefined) { return null; }
  const key = character.key ?? tournamentCharacterKey(character.label, character.roster) ?? null;
  if (key === null) { return null; }
  const path = BY_KEY.get(key);
  return path === undefined ? null : `${GAME_ASSET_BASE}${path}`;
}
