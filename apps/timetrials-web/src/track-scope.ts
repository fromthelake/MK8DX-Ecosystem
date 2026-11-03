import type { TimeTrialTrackAccess } from "./account-time-trial-settings.js";
import { CUP_ASSET_MANIFEST } from "./asset-manifest.js";

export type TimeTrialTrackScope = "base" | "bcp" | "all";

const all = CUP_ASSET_MANIFEST.flatMap((cup) => cup.tracks.map((track) => track.id));
if (all.length !== 96 || new Set(all).size !== 96) {
  throw new Error("canonical Time Trial track catalog must contain 96 tracks");
}

export const BASE_TIME_TRIAL_TRACK_IDS: readonly string[] = all.slice(0, 48);
export const BCP_TIME_TRIAL_TRACK_IDS: readonly string[] = all.slice(48);
export const ALL_TIME_TRIAL_TRACK_IDS: readonly string[] = all;

export function timeTrialTrackIds(scope: TimeTrialTrackScope): readonly string[] {
  return scope === "base" ? BASE_TIME_TRIAL_TRACK_IDS
    : scope === "bcp" ? BCP_TIME_TRIAL_TRACK_IDS : ALL_TIME_TRIAL_TRACK_IDS;
}

export function defaultTimeTrialTrackScope(access: TimeTrialTrackAccess | undefined): TimeTrialTrackScope {
  return access === "base_only" ? "base" : "all";
}

export function timeTrialTrackScope(trackId: string): Exclude<TimeTrialTrackScope, "all"> | null {
  const index = all.indexOf(trackId);
  return index < 0 ? null : index < 48 ? "base" : "bcp";
}
