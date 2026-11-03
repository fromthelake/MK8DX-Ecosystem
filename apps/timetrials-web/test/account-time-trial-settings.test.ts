import { describe, expect, it } from "vitest";

import {
  accountPreferenceFieldUpdate,
  type AccountTimeTrialPreferences,
} from "../src/account-time-trial-settings.js";

describe("account preference field saves", () => {
  const persisted: AccountTimeTrialPreferences = {
    modePreference: "all",
    screenName: "SavedName",
    trackAccess: "unknown",
  };

  it("changes engine class without submitting an unsaved screen name", () => {
    expect(accountPreferenceFieldUpdate(
      persisted,
      "modePreference",
      "200",
    )).toEqual({ modePreference: "200", screenName: "SavedName", trackAccess: "unknown" });
  });

  it("changes the optional screen name without submitting an unsaved mode", () => {
    expect(accountPreferenceFieldUpdate(
      persisted,
      "screenName",
      "NewName",
    )).toEqual({ modePreference: "all", screenName: "NewName", trackAccess: "unknown" });
  });

  it("changes DLC access without submitting other unsaved fields", () => {
    expect(accountPreferenceFieldUpdate(
      persisted,
      "trackAccess",
      "base_and_bcp",
    )).toEqual({ modePreference: "all", screenName: "SavedName", trackAccess: "base_and_bcp" });
  });
});
