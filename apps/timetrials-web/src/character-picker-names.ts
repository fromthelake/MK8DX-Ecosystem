/**
 * The game prints "Link" for both Links, which is right on a result screen and in the catalog, but a character
 * picker that lists them both needs to tell them apart (newcomer test 02-11: "Link" appeared twice).
 */
const PICKER_NAMES: Readonly<Record<string, string>> = {
  "character.champion_link": "Link (Breath of the Wild)",
};

export function pickerCharacterName(id: string, name: string): string {
  return PICKER_NAMES[id] ?? name;
}
