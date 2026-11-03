// GENERATED FILE — do not edit by hand.
// Source: canonical schema-9 asset deployment database
// (schemaVersion 9, generated 2026-07-08T09:53:23+00:00).
// Regenerate with tooling/web/generate_asset_manifest.mjs.
// Paths resolve under the same-origin /assets/ game-asset route; the image
// pack itself is a private production deployment, never part of Git.

export type TrackAssetEntry = Readonly<{
  id: string;
  name: string;
  previewPath: string;
}>;

export type CupAssetEntry = Readonly<{
  id: string;
  name: string;
  iconPath: string;
  tracks: readonly TrackAssetEntry[];
}>;

export const GAME_ASSET_BASE = "/assets/";

export const CUP_ASSET_MANIFEST: readonly CupAssetEntry[] = [
  {
    "id": "cup.mushroom_cup",
    "name": "Mushroom Cup",
    "iconPath": "images/cups/000_mushroom_cup.png",
    "tracks": [
      {
        "id": "track.mario_kart_stadium",
        "name": "Mario Kart Stadium",
        "previewPath": "images/tracks/previews/000_mario_kart_stadium.png"
      },
      {
        "id": "track.water_park",
        "name": "Water Park",
        "previewPath": "images/tracks/previews/001_water_park.png"
      },
      {
        "id": "track.sweet_sweet_canyon",
        "name": "Sweet Sweet Canyon",
        "previewPath": "images/tracks/previews/002_sweet_sweet_canyon.png"
      },
      {
        "id": "track.thwomp_ruins",
        "name": "Thwomp Ruins",
        "previewPath": "images/tracks/previews/003_thwomp_ruins.png"
      }
    ]
  },
  {
    "id": "cup.flower_cup",
    "name": "Flower Cup",
    "iconPath": "images/cups/001_flower_cup.png",
    "tracks": [
      {
        "id": "track.mario_circuit",
        "name": "Mario Circuit",
        "previewPath": "images/tracks/previews/004_mario_circuit.png"
      },
      {
        "id": "track.toad_harbour",
        "name": "Toad Harbor",
        "previewPath": "images/tracks/previews/005_toad_harbour.png"
      },
      {
        "id": "track.twisted_mansion",
        "name": "Twisted Mansion",
        "previewPath": "images/tracks/previews/006_twisted_mansion.png"
      },
      {
        "id": "track.shy_guy_falls",
        "name": "Shy Guy Falls",
        "previewPath": "images/tracks/previews/007_shy_guy_falls.png"
      }
    ]
  },
  {
    "id": "cup.star_cup",
    "name": "Star Cup",
    "iconPath": "images/cups/002_star_cup.png",
    "tracks": [
      {
        "id": "track.sunshine_airport",
        "name": "Sunshine Airport",
        "previewPath": "images/tracks/previews/008_sunshine_airport.png"
      },
      {
        "id": "track.dolphin_shoals",
        "name": "Dolphin Shoals",
        "previewPath": "images/tracks/previews/009_dolphin_shoals.png"
      },
      {
        "id": "track.electrodrome",
        "name": "Electrodrome",
        "previewPath": "images/tracks/previews/010_electrodrome.png"
      },
      {
        "id": "track.mount_wario",
        "name": "Mount Wario",
        "previewPath": "images/tracks/previews/011_mount_wario.png"
      }
    ]
  },
  {
    "id": "cup.special_cup",
    "name": "Special Cup",
    "iconPath": "images/cups/003_special_cup.png",
    "tracks": [
      {
        "id": "track.cloudtop_cruise",
        "name": "Cloudtop Cruise",
        "previewPath": "images/tracks/previews/012_cloudtop_cruise.png"
      },
      {
        "id": "track.bone_dry_dunes",
        "name": "Bone-Dry Dunes",
        "previewPath": "images/tracks/previews/013_bone_dry_dunes.png"
      },
      {
        "id": "track.bowsers_castle",
        "name": "Bowser's Castle",
        "previewPath": "images/tracks/previews/014_bowsers_castle.png"
      },
      {
        "id": "track.rainbow_road",
        "name": "Rainbow Road",
        "previewPath": "images/tracks/previews/015_rainbow_road.png"
      }
    ]
  },
  {
    "id": "cup.shell_cup",
    "name": "Shell Cup",
    "iconPath": "images/cups/004_shell_cup.png",
    "tracks": [
      {
        "id": "track.wii_moo_moo_meadows",
        "name": "Wii Moo Moo Meadows",
        "previewPath": "images/tracks/previews/016_wii_moo_moo_meadows.png"
      },
      {
        "id": "track.gba_mario_circuit",
        "name": "GBA Mario Circuit",
        "previewPath": "images/tracks/previews/017_gba_mario_circuit.png"
      },
      {
        "id": "track.ds_cheep_cheep_beach",
        "name": "DS Cheep Cheep Beach",
        "previewPath": "images/tracks/previews/018_ds_cheep_cheep_beach.png"
      },
      {
        "id": "track.n64_toads_turnpike",
        "name": "N64 Toad's Turnpike",
        "previewPath": "images/tracks/previews/019_n64_toads_turnpike.png"
      }
    ]
  },
  {
    "id": "cup.banana_cup",
    "name": "Banana Cup",
    "iconPath": "images/cups/005_banana_cup.png",
    "tracks": [
      {
        "id": "track.gcn_dry_dry_desert",
        "name": "GCN Dry Dry Desert",
        "previewPath": "images/tracks/previews/020_gcn_dry_dry_desert.png"
      },
      {
        "id": "track.snes_donut_plains_3",
        "name": "SNES Donut Plains 3",
        "previewPath": "images/tracks/previews/021_snes_donut_plains_3.png"
      },
      {
        "id": "track.n64_royal_raceway",
        "name": "N64 Royal Raceway",
        "previewPath": "images/tracks/previews/022_n64_royal_raceway.png"
      },
      {
        "id": "track.3ds_dk_jungle",
        "name": "3DS DK Jungle",
        "previewPath": "images/tracks/previews/023_3ds_dk_jungle.png"
      }
    ]
  },
  {
    "id": "cup.leaf_cup",
    "name": "Leaf Cup",
    "iconPath": "images/cups/006_leaf_cup.png",
    "tracks": [
      {
        "id": "track.ds_wario_stadium",
        "name": "DS Wario Stadium",
        "previewPath": "images/tracks/previews/024_ds_wario_stadium.png"
      },
      {
        "id": "track.gcn_sherbet_land",
        "name": "GCN Sherbet Land",
        "previewPath": "images/tracks/previews/025_gcn_sherbet_land.png"
      },
      {
        "id": "track.3ds_melody_motorway",
        "name": "3DS Music Park",
        "previewPath": "images/tracks/previews/026_3ds_melody_motorway.png"
      },
      {
        "id": "track.n64_yoshi_valley",
        "name": "N64 Yoshi Valley",
        "previewPath": "images/tracks/previews/027_n64_yoshi_valley.png"
      }
    ]
  },
  {
    "id": "cup.lightning_cup",
    "name": "Lightning Cup",
    "iconPath": "images/cups/007_lightning_cup.png",
    "tracks": [
      {
        "id": "track.ds_tick_tock_clock",
        "name": "DS Tick-Tock Clock",
        "previewPath": "images/tracks/previews/028_ds_tick_tock_clock.png"
      },
      {
        "id": "track.3ds_piranha_plant_pipeway",
        "name": "3DS Piranha Plant Slide",
        "previewPath": "images/tracks/previews/029_3ds_piranha_plant_pipeway.png"
      },
      {
        "id": "track.wii_grumble_volcano",
        "name": "Wii Grumble Volcano",
        "previewPath": "images/tracks/previews/030_wii_grumble_volcano.png"
      },
      {
        "id": "track.n64_rainbow_road",
        "name": "N64 Rainbow Road",
        "previewPath": "images/tracks/previews/031_n64_rainbow_road.png"
      }
    ]
  },
  {
    "id": "cup.egg_cup",
    "name": "Egg Cup",
    "iconPath": "images/cups/008_egg_cup.png",
    "tracks": [
      {
        "id": "track.gcn_yoshi_circuit",
        "name": "GCN Yoshi Circuit",
        "previewPath": "images/tracks/previews/032_gcn_yoshi_circuit.png"
      },
      {
        "id": "track.excitebike_arena",
        "name": "Excitebike Arena",
        "previewPath": "images/tracks/previews/033_excitebike_arena.png"
      },
      {
        "id": "track.dragon_driftway",
        "name": "Dragon Driftway",
        "previewPath": "images/tracks/previews/034_dragon_driftway.png"
      },
      {
        "id": "track.mute_city",
        "name": "Mute City",
        "previewPath": "images/tracks/previews/035_mute_city.png"
      }
    ]
  },
  {
    "id": "cup.triforce_cup",
    "name": "Triforce Cup",
    "iconPath": "images/cups/009_triforce_cup.png",
    "tracks": [
      {
        "id": "track.wii_warios_gold_mine",
        "name": "Wii Wario's Gold Mine",
        "previewPath": "images/tracks/previews/036_wii_warios_gold_mine.png"
      },
      {
        "id": "track.snes_rainbow_road",
        "name": "SNES Rainbow Road",
        "previewPath": "images/tracks/previews/037_snes_rainbow_road.png"
      },
      {
        "id": "track.ice_ice_outpost",
        "name": "Ice Ice Outpost",
        "previewPath": "images/tracks/previews/038_ice_ice_outpost.png"
      },
      {
        "id": "track.hyrule_circuit",
        "name": "Hyrule Circuit",
        "previewPath": "images/tracks/previews/039_hyrule_circuit.png"
      }
    ]
  },
  {
    "id": "cup.crossing_cup",
    "name": "Crossing Cup",
    "iconPath": "images/cups/010_crossing_cup.png",
    "tracks": [
      {
        "id": "track.gcn_baby_park",
        "name": "GCN Baby Park",
        "previewPath": "images/tracks/previews/040_gcn_baby_park.png"
      },
      {
        "id": "track.gba_cheese_land",
        "name": "GBA Cheese Land",
        "previewPath": "images/tracks/previews/041_gba_cheese_land.png"
      },
      {
        "id": "track.wild_woods",
        "name": "Wild Woods",
        "previewPath": "images/tracks/previews/042_wild_woods.png"
      },
      {
        "id": "track.animal_crossing",
        "name": "Animal Crossing",
        "previewPath": "images/tracks/previews/043_animal_crossing.png"
      }
    ]
  },
  {
    "id": "cup.bell_cup",
    "name": "Bell Cup",
    "iconPath": "images/cups/011_bell_cup.png",
    "tracks": [
      {
        "id": "track.3ds_koopa_city",
        "name": "3DS Neo Bowser City",
        "previewPath": "images/tracks/previews/044_3ds_koopa_city.png"
      },
      {
        "id": "track.gba_ribbon_road",
        "name": "GBA Ribbon Road",
        "previewPath": "images/tracks/previews/045_gba_ribbon_road.png"
      },
      {
        "id": "track.super_bell_subway",
        "name": "Super Bell Subway",
        "previewPath": "images/tracks/previews/046_super_bell_subway.png"
      },
      {
        "id": "track.big_blue",
        "name": "Big Blue",
        "previewPath": "images/tracks/previews/047_big_blue.png"
      }
    ]
  },
  {
    "id": "cup.golden_dash_cup",
    "name": "Golden Dash Cup",
    "iconPath": "images/cups/012_golden_dash_cup.png",
    "tracks": [
      {
        "id": "track.tour_paris_promenade",
        "name": "Tour Paris Promenade",
        "previewPath": "images/tracks/previews/048_tour_paris_promenade.png"
      },
      {
        "id": "track.3ds_toad_circuit",
        "name": "3DS Toad Circuit",
        "previewPath": "images/tracks/previews/049_3ds_toad_circuit.png"
      },
      {
        "id": "track.n64_choco_mountain",
        "name": "N64 Choco Mountain",
        "previewPath": "images/tracks/previews/050_n64_choco_mountain.png"
      },
      {
        "id": "track.wii_coconut_mall",
        "name": "Wii Coconut Mall",
        "previewPath": "images/tracks/previews/051_wii_coconut_mall.png"
      }
    ]
  },
  {
    "id": "cup.lucky_cat_cup",
    "name": "Lucky Cat Cup",
    "iconPath": "images/cups/013_lucky_cat_cup.png",
    "tracks": [
      {
        "id": "track.tour_tokyo_blur",
        "name": "Tour Tokyo Blur",
        "previewPath": "images/tracks/previews/052_tour_tokyo_blur.png"
      },
      {
        "id": "track.ds_shroom_ridge",
        "name": "DS Shroom Ridge",
        "previewPath": "images/tracks/previews/053_ds_shroom_ridge.png"
      },
      {
        "id": "track.gba_sky_garden",
        "name": "GBA Sky Garden",
        "previewPath": "images/tracks/previews/054_gba_sky_garden.png"
      },
      {
        "id": "track.ninja_hideaway",
        "name": "Ninja Hideaway",
        "previewPath": "images/tracks/previews/055_ninja_hideaway.png"
      }
    ]
  },
  {
    "id": "cup.turnip_cup",
    "name": "Turnip Cup",
    "iconPath": "images/cups/014_turnip_cup.png",
    "tracks": [
      {
        "id": "track.tour_new_york_minute",
        "name": "Tour New York Minute",
        "previewPath": "images/tracks/previews/056_tour_new_york_minute.png"
      },
      {
        "id": "track.snes_mario_circuit_3",
        "name": "SNES Mario Circuit 3",
        "previewPath": "images/tracks/previews/057_snes_mario_circuit_3.png"
      },
      {
        "id": "track.n64_kalimari_desert",
        "name": "N64 Kalimari Desert",
        "previewPath": "images/tracks/previews/058_n64_kalimari_desert.png"
      },
      {
        "id": "track.ds_waluigi_pinball",
        "name": "DS Waluigi Pinball",
        "previewPath": "images/tracks/previews/059_ds_waluigi_pinball.png"
      }
    ]
  },
  {
    "id": "cup.propeller_cup",
    "name": "Propeller Cup",
    "iconPath": "images/cups/015_propeller_cup.png",
    "tracks": [
      {
        "id": "track.tour_sydney_sprint",
        "name": "Tour Sydney Sprint",
        "previewPath": "images/tracks/previews/060_tour_sydney_sprint.png"
      },
      {
        "id": "track.gba_snow_land",
        "name": "GBA Snow Land",
        "previewPath": "images/tracks/previews/061_gba_snow_land.png"
      },
      {
        "id": "track.wii_mushroom_gorge",
        "name": "Wii Mushroom Gorge",
        "previewPath": "images/tracks/previews/062_wii_mushroom_gorge.png"
      },
      {
        "id": "track.sky_high_sundae",
        "name": "Sky-High Sundae",
        "previewPath": "images/tracks/previews/063_sky_high_sundae.png"
      }
    ]
  },
  {
    "id": "cup.rock_cup",
    "name": "Rock Cup",
    "iconPath": "images/cups/016_rock_cup.png",
    "tracks": [
      {
        "id": "track.tour_london_loop",
        "name": "Tour London Loop",
        "previewPath": "images/tracks/previews/064_tour_london_loop.png"
      },
      {
        "id": "track.gba_boo_lake",
        "name": "GBA Boo Lake",
        "previewPath": "images/tracks/previews/065_gba_boo_lake.png"
      },
      {
        "id": "track.3ds_alpine_pass",
        "name": "3DS Rock Rock Mountain",
        "previewPath": "images/tracks/previews/066_3ds_alpine_pass.png"
      },
      {
        "id": "track.wii_maple_treeway",
        "name": "Wii Maple Treeway",
        "previewPath": "images/tracks/previews/067_wii_maple_treeway.png"
      }
    ]
  },
  {
    "id": "cup.moon_cup",
    "name": "Moon Cup",
    "iconPath": "images/cups/017_moon_cup.png",
    "tracks": [
      {
        "id": "track.tour_berlin_byways",
        "name": "Tour Berlin Byways",
        "previewPath": "images/tracks/previews/068_tour_berlin_byways.png"
      },
      {
        "id": "track.ds_peach_gardens",
        "name": "DS Peach Gardens",
        "previewPath": "images/tracks/previews/069_ds_peach_gardens.png"
      },
      {
        "id": "track.merry_mountain",
        "name": "Merry Mountain",
        "previewPath": "images/tracks/previews/070_merry_mountain.png"
      },
      {
        "id": "track.3ds_rainbow_road",
        "name": "3DS Rainbow Road",
        "previewPath": "images/tracks/previews/071_3ds_rainbow_road.png"
      }
    ]
  },
  {
    "id": "cup.fruit_cup",
    "name": "Fruit Cup",
    "iconPath": "images/cups/018_fruit_cup.png",
    "tracks": [
      {
        "id": "track.tour_amsterdam_drift",
        "name": "Tour Amsterdam Drift",
        "previewPath": "images/tracks/previews/072_tour_amsterdam_drift.png"
      },
      {
        "id": "track.gba_riverside_park",
        "name": "GBA Riverside Park",
        "previewPath": "images/tracks/previews/073_gba_riverside_park.png"
      },
      {
        "id": "track.wii_dk_summit",
        "name": "Wii DK Summit",
        "previewPath": "images/tracks/previews/074_wii_dk_summit.png"
      },
      {
        "id": "track.yoshis_island",
        "name": "Yoshi's Island",
        "previewPath": "images/tracks/previews/075_yoshis_island.png"
      }
    ]
  },
  {
    "id": "cup.boomerang_cup",
    "name": "Boomerang Cup",
    "iconPath": "images/cups/019_boomerang_cup.png",
    "tracks": [
      {
        "id": "track.tour_bangkok_rush",
        "name": "Tour Bangkok Rush",
        "previewPath": "images/tracks/previews/076_tour_bangkok_rush.png"
      },
      {
        "id": "track.ds_mario_circuit",
        "name": "DS Mario Circuit",
        "previewPath": "images/tracks/previews/077_ds_mario_circuit.png"
      },
      {
        "id": "track.gcn_waluigi_stadium",
        "name": "GCN Waluigi Stadium",
        "previewPath": "images/tracks/previews/078_gcn_waluigi_stadium.png"
      },
      {
        "id": "track.tour_singapore_speedway",
        "name": "Tour Singapore Speedway",
        "previewPath": "images/tracks/previews/079_tour_singapore_speedway.png"
      }
    ]
  },
  {
    "id": "cup.feather_cup",
    "name": "Feather Cup",
    "iconPath": "images/cups/020_feather_cup.png",
    "tracks": [
      {
        "id": "track.tour_athens_dash",
        "name": "Tour Athens Dash",
        "previewPath": "images/tracks/previews/080_tour_athens_dash.png"
      },
      {
        "id": "track.gcn_daisy_cruiser",
        "name": "GCN Daisy Cruiser",
        "previewPath": "images/tracks/previews/081_gcn_daisy_cruiser.png"
      },
      {
        "id": "track.wii_moonview_highway",
        "name": "Wii Moonview Highway",
        "previewPath": "images/tracks/previews/082_wii_moonview_highway.png"
      },
      {
        "id": "track.squeaky_clean_sprint",
        "name": "Squeaky Clean Sprint",
        "previewPath": "images/tracks/previews/083_squeaky_clean_sprint.png"
      }
    ]
  },
  {
    "id": "cup.cherry_cup",
    "name": "Cherry Cup",
    "iconPath": "images/cups/021_cherry_cup.png",
    "tracks": [
      {
        "id": "track.tour_los_angeles_laps",
        "name": "Tour Los Angeles Laps",
        "previewPath": "images/tracks/previews/084_tour_los_angeles_laps.png"
      },
      {
        "id": "track.gba_sunset_wilds",
        "name": "GBA Sunset Wilds",
        "previewPath": "images/tracks/previews/085_gba_sunset_wilds.png"
      },
      {
        "id": "track.wii_koopa_cape",
        "name": "Wii Koopa Cape",
        "previewPath": "images/tracks/previews/086_wii_koopa_cape.png"
      },
      {
        "id": "track.tour_vancouver_velocity",
        "name": "Tour Vancouver Velocity",
        "previewPath": "images/tracks/previews/087_tour_vancouver_velocity.png"
      }
    ]
  },
  {
    "id": "cup.acorn_cup",
    "name": "Acorn Cup",
    "iconPath": "images/cups/022_acorn_cup.png",
    "tracks": [
      {
        "id": "track.tour_rome_avanti",
        "name": "Tour Rome Avanti",
        "previewPath": "images/tracks/previews/088_tour_rome_avanti.png"
      },
      {
        "id": "track.gcn_dk_mountain",
        "name": "GCN DK Mountain",
        "previewPath": "images/tracks/previews/089_gcn_dk_mountain.png"
      },
      {
        "id": "track.wii_daisy_circuit",
        "name": "Wii Daisy Circuit",
        "previewPath": "images/tracks/previews/090_wii_daisy_circuit.png"
      },
      {
        "id": "track.piranha_plant_cove",
        "name": "Piranha Plant Cove",
        "previewPath": "images/tracks/previews/091_piranha_plant_cove.png"
      }
    ]
  },
  {
    "id": "cup.spiny_cup",
    "name": "Spiny Cup",
    "iconPath": "images/cups/023_spiny_cup.png",
    "tracks": [
      {
        "id": "track.tour_madrid_drive",
        "name": "Tour Madrid Drive",
        "previewPath": "images/tracks/previews/092_tour_madrid_drive.png"
      },
      {
        "id": "track.3ds_rosalinas_ice_world",
        "name": "3DS Rosalina's Ice World",
        "previewPath": "images/tracks/previews/093_3ds_rosalinas_ice_world.png"
      },
      {
        "id": "track.snes_bowser_castle_3",
        "name": "SNES Bowser Castle 3",
        "previewPath": "images/tracks/previews/094_snes_bowser_castle_3.png"
      },
      {
        "id": "track.wii_rainbow_road",
        "name": "Wii Rainbow Road",
        "previewPath": "images/tracks/previews/095_wii_rainbow_road.png"
      }
    ]
  }
];

const trackAssetsById = new Map<string, TrackAssetEntry & { cup: CupAssetEntry }>();
for (const cup of CUP_ASSET_MANIFEST) {
  for (const track of cup.tracks) {
    trackAssetsById.set(track.id, { ...track, cup });
  }
}

export function trackAsset(
  trackId: string,
): (TrackAssetEntry & { cup: CupAssetEntry }) | undefined {
  return trackAssetsById.get(trackId);
}

/**
 * Every track in the game, in cup order.
 *
 * Needed wherever a surface has to show what somebody has *not* done: a track
 * record that only lists the tracks you raced cannot tell you which ones you
 * have never touched, and that is usually the more useful half.
 */
export function allTrackAssets():
readonly (TrackAssetEntry & { cup: CupAssetEntry })[] {
  return [...trackAssetsById.values()];
}

export const COUNTRY_ASSET_MANIFEST: readonly Readonly<{
  id: string; name: string; flagPath: string;
}>[] =
[
 {
  "id": "country.al",
  "name": "Albania",
  "flagPath": "images/countries/mk8_flags/001_al.png"
 },
 {
  "id": "country.ao",
  "name": "Angola",
  "flagPath": "images/countries/mk8_flags/005_ao.png"
 },
 {
  "id": "country.ar",
  "name": "Argentina",
  "flagPath": "images/countries/mk8_flags/009_ar.png"
 },
 {
  "id": "country.aw",
  "name": "Aruba",
  "flagPath": "images/countries/mk8_flags/011_aw.png"
 },
 {
  "id": "country.au",
  "name": "Australia",
  "flagPath": "images/countries/mk8_flags/012_au.png"
 },
 {
  "id": "country.at",
  "name": "Austria",
  "flagPath": "images/countries/mk8_flags/013_at.png"
 },
 {
  "id": "country.az",
  "name": "Azerbaijan",
  "flagPath": "images/countries/mk8_flags/014_az.png"
 },
 {
  "id": "country.bs",
  "name": "Bahamas",
  "flagPath": "images/countries/mk8_flags/015_bs.png"
 },
 {
  "id": "country.bb",
  "name": "Barbados",
  "flagPath": "images/countries/mk8_flags/018_bb.png"
 },
 {
  "id": "country.by",
  "name": "Belarus",
  "flagPath": "images/countries/mk8_flags/019_by.png"
 },
 {
  "id": "country.be",
  "name": "Belgium",
  "flagPath": "images/countries/mk8_flags/020_be.png"
 },
 {
  "id": "country.bz",
  "name": "Belize",
  "flagPath": "images/countries/mk8_flags/021_bz.png"
 },
 {
  "id": "country.bo",
  "name": "Bolivia",
  "flagPath": "images/countries/mk8_flags/025_bo.png"
 },
 {
  "id": "country.ba",
  "name": "Bosnia & Herzegovina",
  "flagPath": "images/countries/mk8_flags/027_ba.png"
 },
 {
  "id": "country.bw",
  "name": "Botswana",
  "flagPath": "images/countries/mk8_flags/028_bw.png"
 },
 {
  "id": "country.br",
  "name": "Brazil",
  "flagPath": "images/countries/mk8_flags/030_br.png"
 },
 {
  "id": "country.bn",
  "name": "Brunei",
  "flagPath": "images/countries/mk8_flags/032_bn.png"
 },
 {
  "id": "country.bg",
  "name": "Bulgaria",
  "flagPath": "images/countries/mk8_flags/033_bg.png"
 },
 {
  "id": "country.ca",
  "name": "Canada",
  "flagPath": "images/countries/mk8_flags/039_ca.png"
 },
 {
  "id": "country.td",
  "name": "Chad",
  "flagPath": "images/countries/mk8_flags/042_td.png"
 },
 {
  "id": "country.cl",
  "name": "Chile",
  "flagPath": "images/countries/mk8_flags/043_cl.png"
 },
 {
  "id": "country.co",
  "name": "Colombia",
  "flagPath": "images/countries/mk8_flags/047_co.png"
 },
 {
  "id": "country.hr",
  "name": "Croatia",
  "flagPath": "images/countries/mk8_flags/053_hr.png"
 },
 {
  "id": "country.cy",
  "name": "Cyprus",
  "flagPath": "images/countries/mk8_flags/056_cy.png"
 },
 {
  "id": "country.cz",
  "name": "Czechia",
  "flagPath": "images/countries/mk8_flags/057_cz.png"
 },
 {
  "id": "country.dk",
  "name": "Denmark",
  "flagPath": "images/countries/mk8_flags/059_dk.png"
 },
 {
  "id": "country.do",
  "name": "Dominican Republic",
  "flagPath": "images/countries/mk8_flags/062_do.png"
 },
 {
  "id": "country.ec",
  "name": "Ecuador",
  "flagPath": "images/countries/mk8_flags/063_ec.png"
 },
 {
  "id": "country.eg",
  "name": "Egypt",
  "flagPath": "images/countries/mk8_flags/064_eg.png"
 },
 {
  "id": "country.sv",
  "name": "El Salvador",
  "flagPath": "images/countries/mk8_flags/065_sv.png"
 },
 {
  "id": "country.ee",
  "name": "Estonia",
  "flagPath": "images/countries/mk8_flags/068_ee.png"
 },
 {
  "id": "country.sz",
  "name": "Eswatini",
  "flagPath": "images/countries/mk8_flags/069_sz.png"
 },
 {
  "id": "country.fi",
  "name": "Finland",
  "flagPath": "images/countries/mk8_flags/074_fi.png"
 },
 {
  "id": "country.fr",
  "name": "France",
  "flagPath": "images/countries/mk8_flags/075_fr.png"
 },
 {
  "id": "country.de",
  "name": "Germany",
  "flagPath": "images/countries/mk8_flags/082_de.png"
 },
 {
  "id": "country.gh",
  "name": "Ghana",
  "flagPath": "images/countries/mk8_flags/083_gh.png"
 },
 {
  "id": "country.gr",
  "name": "Greece",
  "flagPath": "images/countries/mk8_flags/085_gr.png"
 },
 {
  "id": "country.gt",
  "name": "Guatemala",
  "flagPath": "images/countries/mk8_flags/090_gt.png"
 },
 {
  "id": "country.hn",
  "name": "Honduras",
  "flagPath": "images/countries/mk8_flags/098_hn.png"
 },
 {
  "id": "country.hu",
  "name": "Hungary",
  "flagPath": "images/countries/mk8_flags/100_hu.png"
 },
 {
  "id": "country.is",
  "name": "Iceland",
  "flagPath": "images/countries/mk8_flags/101_is.png"
 },
 {
  "id": "country.in",
  "name": "India",
  "flagPath": "images/countries/mk8_flags/102_in.png"
 },
 {
  "id": "country.id",
  "name": "Indonesia",
  "flagPath": "images/countries/mk8_flags/103_id.png"
 },
 {
  "id": "country.ie",
  "name": "Ireland",
  "flagPath": "images/countries/mk8_flags/106_ie.png"
 },
 {
  "id": "country.il",
  "name": "Israel",
  "flagPath": "images/countries/mk8_flags/108_il.png"
 },
 {
  "id": "country.it",
  "name": "Italy",
  "flagPath": "images/countries/mk8_flags/109_it.png"
 },
 {
  "id": "country.jm",
  "name": "Jamaica",
  "flagPath": "images/countries/mk8_flags/110_jm.png"
 },
 {
  "id": "country.jp",
  "name": "Japan",
  "flagPath": "images/countries/mk8_flags/111_jp.png"
 },
 {
  "id": "country.jo",
  "name": "Jordan",
  "flagPath": "images/countries/mk8_flags/113_jo.png"
 },
 {
  "id": "country.kz",
  "name": "Kazakhstan",
  "flagPath": "images/countries/mk8_flags/114_kz.png"
 },
 {
  "id": "country.kw",
  "name": "Kuwait",
  "flagPath": "images/countries/mk8_flags/119_kw.png"
 },
 {
  "id": "country.lv",
  "name": "Latvia",
  "flagPath": "images/countries/mk8_flags/122_lv.png"
 },
 {
  "id": "country.lb",
  "name": "Lebanon",
  "flagPath": "images/countries/mk8_flags/123_lb.png"
 },
 {
  "id": "country.lt",
  "name": "Lithuania",
  "flagPath": "images/countries/mk8_flags/128_lt.png"
 },
 {
  "id": "country.lu",
  "name": "Luxembourg",
  "flagPath": "images/countries/mk8_flags/129_lu.png"
 },
 {
  "id": "country.mg",
  "name": "Madagascar",
  "flagPath": "images/countries/mk8_flags/131_mg.png"
 },
 {
  "id": "country.my",
  "name": "Malaysia",
  "flagPath": "images/countries/mk8_flags/133_my.png"
 },
 {
  "id": "country.ml",
  "name": "Mali",
  "flagPath": "images/countries/mk8_flags/135_ml.png"
 },
 {
  "id": "country.mt",
  "name": "Malta",
  "flagPath": "images/countries/mk8_flags/136_mt.png"
 },
 {
  "id": "country.mr",
  "name": "Mauritania",
  "flagPath": "images/countries/mk8_flags/139_mr.png"
 },
 {
  "id": "country.mu",
  "name": "Mauritius",
  "flagPath": "images/countries/mk8_flags/140_mu.png"
 },
 {
  "id": "country.mx",
  "name": "Mexico",
  "flagPath": "images/countries/mk8_flags/142_mx.png"
 },
 {
  "id": "country.md",
  "name": "Moldova",
  "flagPath": "images/countries/mk8_flags/144_md.png"
 },
 {
  "id": "country.mn",
  "name": "Mongolia",
  "flagPath": "images/countries/mk8_flags/146_mn.png"
 },
 {
  "id": "country.ma",
  "name": "Morocco",
  "flagPath": "images/countries/mk8_flags/149_ma.png"
 },
 {
  "id": "country.mz",
  "name": "Mozambique",
  "flagPath": "images/countries/mk8_flags/150_mz.png"
 },
 {
  "id": "country.na",
  "name": "Namibia",
  "flagPath": "images/countries/mk8_flags/152_na.png"
 },
 {
  "id": "country.nl",
  "name": "Netherlands",
  "flagPath": "images/countries/mk8_flags/155_nl.png"
 },
 {
  "id": "country.nz",
  "name": "New Zealand",
  "flagPath": "images/countries/mk8_flags/157_nz.png"
 },
 {
  "id": "country.ni",
  "name": "Nicaragua",
  "flagPath": "images/countries/mk8_flags/158_ni.png"
 },
 {
  "id": "country.ng",
  "name": "Nigeria",
  "flagPath": "images/countries/mk8_flags/160_ng.png"
 },
 {
  "id": "country.mk",
  "name": "North Macedonia",
  "flagPath": "images/countries/mk8_flags/163_mk.png"
 },
 {
  "id": "country.no",
  "name": "Norway",
  "flagPath": "images/countries/mk8_flags/165_no.png"
 },
 {
  "id": "country.om",
  "name": "Oman",
  "flagPath": "images/countries/mk8_flags/166_om.png"
 },
 {
  "id": "country.pk",
  "name": "Pakistan",
  "flagPath": "images/countries/mk8_flags/167_pk.png"
 },
 {
  "id": "country.pa",
  "name": "Panama",
  "flagPath": "images/countries/mk8_flags/170_pa.png"
 },
 {
  "id": "country.pg",
  "name": "Papua New Guinea",
  "flagPath": "images/countries/mk8_flags/171_pg.png"
 },
 {
  "id": "country.py",
  "name": "Paraguay",
  "flagPath": "images/countries/mk8_flags/172_py.png"
 },
 {
  "id": "country.pe",
  "name": "Peru",
  "flagPath": "images/countries/mk8_flags/173_pe.png"
 },
 {
  "id": "country.ph",
  "name": "Philippines",
  "flagPath": "images/countries/mk8_flags/174_ph.png"
 },
 {
  "id": "country.pl",
  "name": "Poland",
  "flagPath": "images/countries/mk8_flags/176_pl.png"
 },
 {
  "id": "country.pt",
  "name": "Portugal",
  "flagPath": "images/countries/mk8_flags/177_pt.png"
 },
 {
  "id": "country.qa",
  "name": "Qatar",
  "flagPath": "images/countries/mk8_flags/179_qa.png"
 },
 {
  "id": "country.ro",
  "name": "Romania",
  "flagPath": "images/countries/mk8_flags/180_ro.png"
 },
 {
  "id": "country.ru",
  "name": "Russia",
  "flagPath": "images/countries/mk8_flags/181_ru.png"
 },
 {
  "id": "country.rw",
  "name": "Rwanda",
  "flagPath": "images/countries/mk8_flags/182_rw.png"
 },
 {
  "id": "country.rs",
  "name": "Serbia",
  "flagPath": "images/countries/mk8_flags/196_rs.png"
 },
 {
  "id": "country.sc",
  "name": "Seychelles",
  "flagPath": "images/countries/mk8_flags/197_sc.png"
 },
 {
  "id": "country.sg",
  "name": "Singapore",
  "flagPath": "images/countries/mk8_flags/199_sg.png"
 },
 {
  "id": "country.sk",
  "name": "Slovakia",
  "flagPath": "images/countries/mk8_flags/201_sk.png"
 },
 {
  "id": "country.si",
  "name": "Slovenia",
  "flagPath": "images/countries/mk8_flags/202_si.png"
 },
 {
  "id": "country.kr",
  "name": "South Korea",
  "flagPath": "images/countries/mk8_flags/118_kr.png"
 },
 {
  "id": "country.es",
  "name": "Spain",
  "flagPath": "images/countries/mk8_flags/208_es.png"
 },
 {
  "id": "country.sr",
  "name": "Suriname",
  "flagPath": "images/countries/mk8_flags/211_sr.png"
 },
 {
  "id": "country.se",
  "name": "Sweden",
  "flagPath": "images/countries/mk8_flags/213_se.png"
 },
 {
  "id": "country.ch",
  "name": "Switzerland",
  "flagPath": "images/countries/mk8_flags/214_ch.png"
 },
 {
  "id": "country.tz",
  "name": "Tanzania",
  "flagPath": "images/countries/mk8_flags/218_tz.png"
 },
 {
  "id": "country.th",
  "name": "Thailand",
  "flagPath": "images/countries/mk8_flags/219_th.png"
 },
 {
  "id": "country.tt",
  "name": "Trinidad & Tobago",
  "flagPath": "images/countries/mk8_flags/224_tt.png"
 },
 {
  "id": "country.tn",
  "name": "Tunisia",
  "flagPath": "images/countries/mk8_flags/225_tn.png"
 },
 {
  "id": "country.tr",
  "name": "Türkiye",
  "flagPath": "images/countries/mk8_flags/226_tr.png"
 },
 {
  "id": "country.ug",
  "name": "Uganda",
  "flagPath": "images/countries/mk8_flags/230_ug.png"
 },
 {
  "id": "country.ua",
  "name": "Ukraine",
  "flagPath": "images/countries/mk8_flags/231_ua.png"
 },
 {
  "id": "country.ae",
  "name": "United Arab Emirates",
  "flagPath": "images/countries/mk8_flags/232_ae.png"
 },
 {
  "id": "country.gb",
  "name": "United Kingdom",
  "flagPath": "images/countries/mk8_flags/233_gb.png"
 },
 {
  "id": "country.us",
  "name": "United States",
  "flagPath": "images/countries/mk8_flags/234_us.png"
 },
 {
  "id": "country.ve",
  "name": "Venezuela",
  "flagPath": "images/countries/mk8_flags/239_ve.png"
 },
 {
  "id": "country.vn",
  "name": "Vietnam",
  "flagPath": "images/countries/mk8_flags/240_vn.png"
 },
 {
  "id": "country.zm",
  "name": "Zambia",
  "flagPath": "images/countries/mk8_flags/246_zm.png"
 },
 {
  "id": "country.zw",
  "name": "Zimbabwe",
  "flagPath": "images/countries/mk8_flags/247_zw.png"
 }
];

const COUNTRY_FLAG_PATHS: Readonly<Record<string, string>> =
{
 "country.al": "images/countries/mk8_flags/001_al.png",
 "country.ao": "images/countries/mk8_flags/005_ao.png",
 "country.ar": "images/countries/mk8_flags/009_ar.png",
 "country.aw": "images/countries/mk8_flags/011_aw.png",
 "country.au": "images/countries/mk8_flags/012_au.png",
 "country.at": "images/countries/mk8_flags/013_at.png",
 "country.az": "images/countries/mk8_flags/014_az.png",
 "country.bs": "images/countries/mk8_flags/015_bs.png",
 "country.bb": "images/countries/mk8_flags/018_bb.png",
 "country.by": "images/countries/mk8_flags/019_by.png",
 "country.be": "images/countries/mk8_flags/020_be.png",
 "country.bz": "images/countries/mk8_flags/021_bz.png",
 "country.bo": "images/countries/mk8_flags/025_bo.png",
 "country.ba": "images/countries/mk8_flags/027_ba.png",
 "country.bw": "images/countries/mk8_flags/028_bw.png",
 "country.br": "images/countries/mk8_flags/030_br.png",
 "country.bn": "images/countries/mk8_flags/032_bn.png",
 "country.bg": "images/countries/mk8_flags/033_bg.png",
 "country.ca": "images/countries/mk8_flags/039_ca.png",
 "country.td": "images/countries/mk8_flags/042_td.png",
 "country.cl": "images/countries/mk8_flags/043_cl.png",
 "country.co": "images/countries/mk8_flags/047_co.png",
 "country.hr": "images/countries/mk8_flags/053_hr.png",
 "country.cy": "images/countries/mk8_flags/056_cy.png",
 "country.cz": "images/countries/mk8_flags/057_cz.png",
 "country.dk": "images/countries/mk8_flags/059_dk.png",
 "country.do": "images/countries/mk8_flags/062_do.png",
 "country.ec": "images/countries/mk8_flags/063_ec.png",
 "country.eg": "images/countries/mk8_flags/064_eg.png",
 "country.sv": "images/countries/mk8_flags/065_sv.png",
 "country.ee": "images/countries/mk8_flags/068_ee.png",
 "country.sz": "images/countries/mk8_flags/069_sz.png",
 "country.fi": "images/countries/mk8_flags/074_fi.png",
 "country.fr": "images/countries/mk8_flags/075_fr.png",
 "country.de": "images/countries/mk8_flags/082_de.png",
 "country.gh": "images/countries/mk8_flags/083_gh.png",
 "country.gr": "images/countries/mk8_flags/085_gr.png",
 "country.gt": "images/countries/mk8_flags/090_gt.png",
 "country.hn": "images/countries/mk8_flags/098_hn.png",
 "country.hu": "images/countries/mk8_flags/100_hu.png",
 "country.is": "images/countries/mk8_flags/101_is.png",
 "country.in": "images/countries/mk8_flags/102_in.png",
 "country.id": "images/countries/mk8_flags/103_id.png",
 "country.ie": "images/countries/mk8_flags/106_ie.png",
 "country.il": "images/countries/mk8_flags/108_il.png",
 "country.it": "images/countries/mk8_flags/109_it.png",
 "country.jm": "images/countries/mk8_flags/110_jm.png",
 "country.jp": "images/countries/mk8_flags/111_jp.png",
 "country.jo": "images/countries/mk8_flags/113_jo.png",
 "country.kz": "images/countries/mk8_flags/114_kz.png",
 "country.kr": "images/countries/mk8_flags/118_kr.png",
 "country.kw": "images/countries/mk8_flags/119_kw.png",
 "country.lv": "images/countries/mk8_flags/122_lv.png",
 "country.lb": "images/countries/mk8_flags/123_lb.png",
 "country.lt": "images/countries/mk8_flags/128_lt.png",
 "country.lu": "images/countries/mk8_flags/129_lu.png",
 "country.mg": "images/countries/mk8_flags/131_mg.png",
 "country.my": "images/countries/mk8_flags/133_my.png",
 "country.ml": "images/countries/mk8_flags/135_ml.png",
 "country.mt": "images/countries/mk8_flags/136_mt.png",
 "country.mr": "images/countries/mk8_flags/139_mr.png",
 "country.mu": "images/countries/mk8_flags/140_mu.png",
 "country.mx": "images/countries/mk8_flags/142_mx.png",
 "country.md": "images/countries/mk8_flags/144_md.png",
 "country.mn": "images/countries/mk8_flags/146_mn.png",
 "country.ma": "images/countries/mk8_flags/149_ma.png",
 "country.mz": "images/countries/mk8_flags/150_mz.png",
 "country.na": "images/countries/mk8_flags/152_na.png",
 "country.nl": "images/countries/mk8_flags/155_nl.png",
 "country.nz": "images/countries/mk8_flags/157_nz.png",
 "country.ni": "images/countries/mk8_flags/158_ni.png",
 "country.ng": "images/countries/mk8_flags/160_ng.png",
 "country.mk": "images/countries/mk8_flags/163_mk.png",
 "country.no": "images/countries/mk8_flags/165_no.png",
 "country.om": "images/countries/mk8_flags/166_om.png",
 "country.pk": "images/countries/mk8_flags/167_pk.png",
 "country.pa": "images/countries/mk8_flags/170_pa.png",
 "country.pg": "images/countries/mk8_flags/171_pg.png",
 "country.py": "images/countries/mk8_flags/172_py.png",
 "country.pe": "images/countries/mk8_flags/173_pe.png",
 "country.ph": "images/countries/mk8_flags/174_ph.png",
 "country.pl": "images/countries/mk8_flags/176_pl.png",
 "country.pt": "images/countries/mk8_flags/177_pt.png",
 "country.qa": "images/countries/mk8_flags/179_qa.png",
 "country.ro": "images/countries/mk8_flags/180_ro.png",
 "country.ru": "images/countries/mk8_flags/181_ru.png",
 "country.rw": "images/countries/mk8_flags/182_rw.png",
 "country.rs": "images/countries/mk8_flags/196_rs.png",
 "country.sc": "images/countries/mk8_flags/197_sc.png",
 "country.sg": "images/countries/mk8_flags/199_sg.png",
 "country.sk": "images/countries/mk8_flags/201_sk.png",
 "country.si": "images/countries/mk8_flags/202_si.png",
 "country.es": "images/countries/mk8_flags/208_es.png",
 "country.sr": "images/countries/mk8_flags/211_sr.png",
 "country.se": "images/countries/mk8_flags/213_se.png",
 "country.ch": "images/countries/mk8_flags/214_ch.png",
 "country.tz": "images/countries/mk8_flags/218_tz.png",
 "country.th": "images/countries/mk8_flags/219_th.png",
 "country.tt": "images/countries/mk8_flags/224_tt.png",
 "country.tn": "images/countries/mk8_flags/225_tn.png",
 "country.tr": "images/countries/mk8_flags/226_tr.png",
 "country.ug": "images/countries/mk8_flags/230_ug.png",
 "country.ua": "images/countries/mk8_flags/231_ua.png",
 "country.ae": "images/countries/mk8_flags/232_ae.png",
 "country.gb": "images/countries/mk8_flags/233_gb.png",
 "country.us": "images/countries/mk8_flags/234_us.png",
 "country.ve": "images/countries/mk8_flags/239_ve.png",
 "country.vn": "images/countries/mk8_flags/240_vn.png",
 "country.zm": "images/countries/mk8_flags/246_zm.png",
 "country.zw": "images/countries/mk8_flags/247_zw.png"
};

export function countryFlagPath(
  countryId: string | null | undefined,
): string | undefined {
  return countryId == null ? undefined : COUNTRY_FLAG_PATHS[countryId];
}
