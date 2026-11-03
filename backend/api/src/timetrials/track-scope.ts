export type TimeTrialTrackScope = "base" | "bcp" | "all";

// Canonical schema-9 order: indices 0..47 are the base game (including the
// original Wii U DLC); indices 48..95 are the Booster Course Pass.
const BASE_TRACK_IDS = [
  "track.mario_kart_stadium", "track.water_park", "track.sweet_sweet_canyon", "track.thwomp_ruins",
  "track.mario_circuit", "track.toad_harbour", "track.twisted_mansion", "track.shy_guy_falls",
  "track.sunshine_airport", "track.dolphin_shoals", "track.electrodrome", "track.mount_wario",
  "track.cloudtop_cruise", "track.bone_dry_dunes", "track.bowsers_castle", "track.rainbow_road",
  "track.wii_moo_moo_meadows", "track.gba_mario_circuit", "track.ds_cheep_cheep_beach", "track.n64_toads_turnpike",
  "track.gcn_dry_dry_desert", "track.snes_donut_plains_3", "track.n64_royal_raceway", "track.3ds_dk_jungle",
  "track.ds_wario_stadium", "track.gcn_sherbet_land", "track.3ds_melody_motorway", "track.n64_yoshi_valley",
  "track.ds_tick_tock_clock", "track.3ds_piranha_plant_pipeway", "track.wii_grumble_volcano", "track.n64_rainbow_road",
  "track.gcn_yoshi_circuit", "track.excitebike_arena", "track.dragon_driftway", "track.mute_city",
  "track.wii_warios_gold_mine", "track.snes_rainbow_road", "track.ice_ice_outpost", "track.hyrule_circuit",
  "track.gcn_baby_park", "track.gba_cheese_land", "track.wild_woods", "track.animal_crossing",
  "track.3ds_koopa_city", "track.gba_ribbon_road", "track.super_bell_subway", "track.big_blue",
] as const;

export const BASE_TIME_TRIAL_TRACK_IDS: readonly string[] = BASE_TRACK_IDS;
export const TIME_TRIAL_SCOPE_TRACK_COUNT: Readonly<Record<TimeTrialTrackScope, 48 | 96>> = {
  base: 48, bcp: 48, all: 96,
};

export function timeTrialScopeSql(
  scope: TimeTrialTrackScope,
  column: "revision.track_id" | "best.track_id" = "revision.track_id",
): Readonly<{
  clause: string; parameters: readonly string[];
}> {
  if (scope === "all") return { clause: "", parameters: [] };
  const placeholders = BASE_TRACK_IDS.map(() => "?").join(",");
  return {
    clause: ` AND ${column} ${scope === "base" ? "IN" : "NOT IN"} (${placeholders})`,
    parameters: BASE_TRACK_IDS,
  };
}
