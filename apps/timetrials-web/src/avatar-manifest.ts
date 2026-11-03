// GENERATED FILE - do not edit by hand.
// Sources: pinned schema-9 asset catalog (character/variant IDs) and
// the deploy database (names, menu icon paths).
// Regenerate with tooling/web/generate_avatar_manifest.mjs.

export type AvatarAppearance = Readonly<{
  id: string;
  name: string;
  iconPath: string;
}>;

export type AvatarGroup = Readonly<{
  id: string;
  name: string;
  iconPath: string;
  variants: readonly AvatarAppearance[];
}>;

export const AVATAR_GROUPS: readonly AvatarGroup[] =
[
 {
  "id": "character.mario",
  "name": "Mario",
  "iconPath": "images/characters/menu/000_mario.png",
  "variants": []
 },
 {
  "id": "character.luigi",
  "name": "Luigi",
  "iconPath": "images/characters/menu/001_luigi.png",
  "variants": []
 },
 {
  "id": "character.peach",
  "name": "Peach",
  "iconPath": "images/characters/menu/002_peach.png",
  "variants": []
 },
 {
  "id": "character.daisy",
  "name": "Daisy",
  "iconPath": "images/characters/menu/003_daisy.png",
  "variants": []
 },
 {
  "id": "character.rosalina",
  "name": "Rosalina",
  "iconPath": "images/characters/menu/004_rosalina.png",
  "variants": []
 },
 {
  "id": "character.tanooki_mario",
  "name": "Tanooki Mario",
  "iconPath": "images/characters/menu/005_tanooki_mario.png",
  "variants": []
 },
 {
  "id": "character.cat_peach",
  "name": "Cat Peach",
  "iconPath": "images/characters/menu/006_cat_peach.png",
  "variants": []
 },
 {
  "id": "character.birdo",
  "name": "Birdo",
  "iconPath": "images/characters/menu/007_birdo.png",
  "variants": [
   {
    "id": "character_variant.birdo.008_light_blue",
    "name": "Light Blue Birdo",
    "iconPath": "images/characters/menu/008_birdo_light_blue.png"
   },
   {
    "id": "character_variant.birdo.009_black",
    "name": "Black Birdo",
    "iconPath": "images/characters/menu/009_birdo_black.png"
   },
   {
    "id": "character_variant.birdo.010_red",
    "name": "Red Birdo",
    "iconPath": "images/characters/menu/010_birdo_red.png"
   },
   {
    "id": "character_variant.birdo.011_yellow",
    "name": "Yellow Birdo",
    "iconPath": "images/characters/menu/011_birdo_yellow.png"
   },
   {
    "id": "character_variant.birdo.012_white",
    "name": "White Birdo",
    "iconPath": "images/characters/menu/012_birdo_white.png"
   },
   {
    "id": "character_variant.birdo.013_blue",
    "name": "Blue Birdo",
    "iconPath": "images/characters/menu/013_birdo_blue.png"
   },
   {
    "id": "character_variant.birdo.014_green",
    "name": "Green Birdo",
    "iconPath": "images/characters/menu/014_birdo_green.png"
   },
   {
    "id": "character_variant.birdo.015_orange",
    "name": "Orange Birdo",
    "iconPath": "images/characters/menu/015_birdo_orange.png"
   }
  ]
 },
 {
  "id": "character.yoshi",
  "name": "Yoshi",
  "iconPath": "images/characters/menu/016_yoshi.png",
  "variants": [
   {
    "id": "character_variant.yoshi.017_light_blue",
    "name": "Light Blue Yoshi",
    "iconPath": "images/characters/menu/017_light_blue_yoshi.png"
   },
   {
    "id": "character_variant.yoshi.018_black",
    "name": "Black Yoshi",
    "iconPath": "images/characters/menu/018_black_yoshi.png"
   },
   {
    "id": "character_variant.yoshi.019_red",
    "name": "Red Yoshi",
    "iconPath": "images/characters/menu/019_red_yoshi.png"
   },
   {
    "id": "character_variant.yoshi.020_yellow",
    "name": "Yellow Yoshi",
    "iconPath": "images/characters/menu/020_yellow_yoshi.png"
   },
   {
    "id": "character_variant.yoshi.021_white",
    "name": "White Yoshi",
    "iconPath": "images/characters/menu/021_white_yoshi.png"
   },
   {
    "id": "character_variant.yoshi.022_blue",
    "name": "Blue Yoshi",
    "iconPath": "images/characters/menu/022_blue_yoshi.png"
   },
   {
    "id": "character_variant.yoshi.023_pink",
    "name": "Pink Yoshi",
    "iconPath": "images/characters/menu/023_pink_yoshi.png"
   },
   {
    "id": "character_variant.yoshi.024_orange",
    "name": "Orange Yoshi",
    "iconPath": "images/characters/menu/024_orange_yoshi.png"
   }
  ]
 },
 {
  "id": "character.toad",
  "name": "Toad",
  "iconPath": "images/characters/menu/025_toad.png",
  "variants": []
 },
 {
  "id": "character.koopa_troopa",
  "name": "Koopa Troopa",
  "iconPath": "images/characters/menu/026_koopa_troopa.png",
  "variants": []
 },
 {
  "id": "character.shy_guy",
  "name": "Shy Guy",
  "iconPath": "images/characters/menu/027_shy_guy.png",
  "variants": [
   {
    "id": "character_variant.shy_guy.028_light_blue",
    "name": "Light Blue Shy Guy",
    "iconPath": "images/characters/menu/028_light_blue_shy_guy.png"
   },
   {
    "id": "character_variant.shy_guy.029_black",
    "name": "Black Shy Guy",
    "iconPath": "images/characters/menu/029_black_shy_guy.png"
   },
   {
    "id": "character_variant.shy_guy.030_green",
    "name": "Green Shy Guy",
    "iconPath": "images/characters/menu/030_green_shy_guy.png"
   },
   {
    "id": "character_variant.shy_guy.031_yellow",
    "name": "Yellow Shy Guy",
    "iconPath": "images/characters/menu/031_yellow_shy_guy.png"
   },
   {
    "id": "character_variant.shy_guy.032_white",
    "name": "White Shy Guy",
    "iconPath": "images/characters/menu/032_white_shy_guy.png"
   },
   {
    "id": "character_variant.shy_guy.033_blue",
    "name": "Blue Shy Guy",
    "iconPath": "images/characters/menu/033_blue_shy_guy.png"
   },
   {
    "id": "character_variant.shy_guy.034_pink",
    "name": "Pink Shy Guy",
    "iconPath": "images/characters/menu/034_pink_shy_guy.png"
   },
   {
    "id": "character_variant.shy_guy.035_orange",
    "name": "Orange Shy Guy",
    "iconPath": "images/characters/menu/035_orange_shy_guy.png"
   }
  ]
 },
 {
  "id": "character.lakitu",
  "name": "Lakitu",
  "iconPath": "images/characters/menu/036_lakitu.png",
  "variants": []
 },
 {
  "id": "character.toadette",
  "name": "Toadette",
  "iconPath": "images/characters/menu/037_toadette.png",
  "variants": []
 },
 {
  "id": "character.king_boo",
  "name": "King Boo",
  "iconPath": "images/characters/menu/038_king_boo.png",
  "variants": []
 },
 {
  "id": "character.petey_piranha",
  "name": "Petey Piranha",
  "iconPath": "images/characters/menu/039_petey_piranha.png",
  "variants": []
 },
 {
  "id": "character.baby_mario",
  "name": "Baby Mario",
  "iconPath": "images/characters/menu/040_baby_mario.png",
  "variants": []
 },
 {
  "id": "character.baby_luigi",
  "name": "Baby Luigi",
  "iconPath": "images/characters/menu/041_baby_luigi.png",
  "variants": []
 },
 {
  "id": "character.baby_peach",
  "name": "Baby Peach",
  "iconPath": "images/characters/menu/042_baby_peach.png",
  "variants": []
 },
 {
  "id": "character.baby_daisy",
  "name": "Baby Daisy",
  "iconPath": "images/characters/menu/043_baby_daisy.png",
  "variants": []
 },
 {
  "id": "character.baby_rosalina",
  "name": "Baby Rosalina",
  "iconPath": "images/characters/menu/044_baby_rosalina.png",
  "variants": []
 },
 {
  "id": "character.metal_mario",
  "name": "Metal Mario",
  "iconPath": "images/characters/menu/045_metal_mario.png",
  "variants": []
 },
 {
  "id": "character.gold_mario",
  "name": "Gold Mario",
  "iconPath": "images/characters/menu/046_gold_mario.png",
  "variants": []
 },
 {
  "id": "character.pink_gold_peach",
  "name": "Pink Gold Peach",
  "iconPath": "images/characters/menu/047_pink_gold_peach.png",
  "variants": []
 },
 {
  "id": "character.wiggler",
  "name": "Wiggler",
  "iconPath": "images/characters/menu/048_wiggler.png",
  "variants": []
 },
 {
  "id": "character.wario",
  "name": "Wario",
  "iconPath": "images/characters/menu/049_wario.png",
  "variants": []
 },
 {
  "id": "character.waluigi",
  "name": "Waluigi",
  "iconPath": "images/characters/menu/050_waluigi.png",
  "variants": []
 },
 {
  "id": "character.donkey_kong",
  "name": "Donkey Kong",
  "iconPath": "images/characters/menu/051_donkey_kong.png",
  "variants": []
 },
 {
  "id": "character.bowser",
  "name": "Bowser",
  "iconPath": "images/characters/menu/052_bowser.png",
  "variants": []
 },
 {
  "id": "character.dry_bones",
  "name": "Dry Bones",
  "iconPath": "images/characters/menu/053_dry_bones.png",
  "variants": []
 },
 {
  "id": "character.bowser_jr",
  "name": "Bowser Jr.",
  "iconPath": "images/characters/menu/054_bowser_jr.png",
  "variants": []
 },
 {
  "id": "character.dry_bowser",
  "name": "Dry Bowser",
  "iconPath": "images/characters/menu/055_dry_bowser.png",
  "variants": []
 },
 {
  "id": "character.kamek",
  "name": "Kamek",
  "iconPath": "images/characters/menu/056_kamek.png",
  "variants": []
 },
 {
  "id": "character.lemmy",
  "name": "Lemmy",
  "iconPath": "images/characters/menu/057_lemmy.png",
  "variants": []
 },
 {
  "id": "character.larry",
  "name": "Larry",
  "iconPath": "images/characters/menu/058_larry.png",
  "variants": []
 },
 {
  "id": "character.wendy",
  "name": "Wendy",
  "iconPath": "images/characters/menu/059_wendy.png",
  "variants": []
 },
 {
  "id": "character.ludwig",
  "name": "Ludwig",
  "iconPath": "images/characters/menu/060_ludwig.png",
  "variants": []
 },
 {
  "id": "character.iggy",
  "name": "Iggy",
  "iconPath": "images/characters/menu/061_iggy.png",
  "variants": []
 },
 {
  "id": "character.roy",
  "name": "Roy",
  "iconPath": "images/characters/menu/062_roy.png",
  "variants": []
 },
 {
  "id": "character.morton",
  "name": "Morton",
  "iconPath": "images/characters/menu/063_morton.png",
  "variants": []
 },
 {
  "id": "character.peachette",
  "name": "Peachette",
  "iconPath": "images/characters/menu/064_peachette.png",
  "variants": []
 },
 {
  "id": "character.inkling_girl",
  "name": "Inkling Girl",
  "iconPath": "images/characters/menu/065_inkling_girl.png",
  "variants": [
   {
    "id": "character_variant.inkling_girl.066_green",
    "name": "Green Inkling Girl",
    "iconPath": "images/characters/menu/066_green_inkling_girl.png"
   },
   {
    "id": "character_variant.inkling_girl.067_pink",
    "name": "Pink Inkling Girl",
    "iconPath": "images/characters/menu/067_pink_inkling_girl.png"
   }
  ]
 },
 {
  "id": "character.inkling_boy",
  "name": "Inkling Boy",
  "iconPath": "images/characters/menu/068_inkling_boy.png",
  "variants": [
   {
    "id": "character_variant.inkling_boy.069_purple",
    "name": "Purple Inkling Boy",
    "iconPath": "images/characters/menu/069_purple_inkling_boy.png"
   },
   {
    "id": "character_variant.inkling_boy.070_cyan",
    "name": "Cyan Inkling Boy",
    "iconPath": "images/characters/menu/070_cyan_inkling_boy.png"
   }
  ]
 },
 {
  "id": "character.villager_male",
  "name": "Villager (Boy)",
  "iconPath": "images/characters/menu/071_villager_male.png",
  "variants": []
 },
 {
  "id": "character.villager_female",
  "name": "Villager (Girl)",
  "iconPath": "images/characters/menu/072_villager_female.png",
  "variants": []
 },
 {
  "id": "character.isabelle",
  "name": "Isabelle",
  "iconPath": "images/characters/menu/073_isabelle.png",
  "variants": []
 },
 {
  "id": "character.champion_link",
  "name": "Link",
  "iconPath": "images/characters/menu/074_champion_link.png",
  "variants": []
 },
 {
  "id": "character.link",
  "name": "Link",
  "iconPath": "images/characters/menu/075_link.png",
  "variants": []
 },
 {
  "id": "character.diddy_kong",
  "name": "Diddy Kong",
  "iconPath": "images/characters/menu/076_diddy_kong.png",
  "variants": []
 },
 {
  "id": "character.funky_kong",
  "name": "Funky Kong",
  "iconPath": "images/characters/menu/077_funky_kong.png",
  "variants": []
 },
 {
  "id": "character.pauline",
  "name": "Pauline",
  "iconPath": "images/characters/menu/078_pauline.png",
  "variants": []
 },
 {
  "id": "character.mii_light",
  "name": "Mii (Small)",
  "iconPath": "images/characters/menu/079_mii_light.png",
  "variants": []
 },
 {
  "id": "character.mii_medium",
  "name": "Mii (Medium)",
  "iconPath": "images/characters/menu/080_mii_medium.png",
  "variants": []
 },
 {
  "id": "character.mii_heavy",
  "name": "Mii (Large)",
  "iconPath": "images/characters/menu/081_mii_heavy.png",
  "variants": []
 }
];

const appearancesById = new Map<string, AvatarAppearance>();
for (const group of AVATAR_GROUPS) {
  appearancesById.set(group.id, group);
  for (const variant of group.variants) {
    appearancesById.set(variant.id, variant);
  }
}

export function avatarAppearance(
  avatarId: string | null | undefined,
): AvatarAppearance | undefined {
  return avatarId == null ? undefined : appearancesById.get(avatarId);
}
