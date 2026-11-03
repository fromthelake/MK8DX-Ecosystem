import { describe, expect, it } from "vitest";

import {
  ALL_TIME_TRIAL_TRACK_IDS,
  BASE_TIME_TRIAL_TRACK_IDS,
  BCP_TIME_TRIAL_TRACK_IDS,
  defaultTimeTrialTrackScope,
  timeTrialTrackScope,
} from "../src/track-scope.js";

describe("canonical base and Booster Course Pass scopes", () => {
  it("splits the schema-9 order exactly at track index 48", () => {
    expect(BASE_TIME_TRIAL_TRACK_IDS).toHaveLength(48);
    expect(BCP_TIME_TRIAL_TRACK_IDS).toHaveLength(48);
    expect(ALL_TIME_TRIAL_TRACK_IDS).toHaveLength(96);
    expect(BASE_TIME_TRIAL_TRACK_IDS.at(-1)).toBe("track.big_blue");
    expect(BCP_TIME_TRIAL_TRACK_IDS[0]).toBe("track.tour_paris_promenade");
    expect(timeTrialTrackScope("track.gcn_baby_park")).toBe("base");
    expect(timeTrialTrackScope("track.wii_rainbow_road")).toBe("bcp");
  });

  it("uses ownership only as a default, never as track authorization", () => {
    expect(defaultTimeTrialTrackScope("base_only")).toBe("base");
    expect(defaultTimeTrialTrackScope("base_and_bcp")).toBe("all");
    expect(defaultTimeTrialTrackScope("unknown")).toBe("all");
  });
});
