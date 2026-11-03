import { describe, expect, it } from "vitest";

import {
  AccountTimeTrialPreferencesError,
  AccountTimeTrialPreferencesService,
  type AccountTimeTrialPreferences,
} from "../src/profiles/account-time-trial-preferences.js";
import type { ActorContext } from "../src/identity/types.js";

const actor: ActorContext = {
  role: "account",
  userAccountId: "user_account.ben",
};

describe("account Time Trial preferences", () => {
  it("defaults can be read and bounded values update atomically", async () => {
    let stored: AccountTimeTrialPreferences = { modePreference: "all", screenName: null, trackAccess: "unknown" };
    const service = new AccountTimeTrialPreferencesService({
      async read() { return stored; },
      async update(_id, value) { stored = value; return true; },
    }, () => 123);
    expect(await service.readMine(actor)).toEqual(stored);
    await expect(service.updateMine(actor, { modePreference: "150", screenName: " BEnZor ", trackAccess: "base_and_bcp" }))
      .resolves.toEqual({ modePreference: "150", screenName: "BEnZor", trackAccess: "base_and_bcp" });
  });

  it("preserves the DLC preference for legacy v1 clients that omit it", async () => {
    let stored: AccountTimeTrialPreferences = {
      modePreference: "all",
      screenName: "Ben",
      trackAccess: "base_and_bcp",
    };
    const service = new AccountTimeTrialPreferencesService({
      async read() { return stored; },
      async update(_id, value) { stored = value; return true; },
    }, () => 123);

    await expect(service.updateMine(actor, { modePreference: "200", screenName: "Ben" }))
      .resolves.toEqual({ modePreference: "200", screenName: "Ben", trackAccess: "base_and_bcp" });
  });

  it("rejects unsupported modes and control-like screen names", async () => {
    const service = new AccountTimeTrialPreferencesService({
      async read() { return { modePreference: "all", screenName: null, trackAccess: "unknown" }; },
      async update() { return true; },
    });
    await expect(service.updateMine(actor, { modePreference: "300", screenName: null, trackAccess: "unknown" }))
      .rejects.toMatchObject({ code: "invalid_input" } satisfies Partial<AccountTimeTrialPreferencesError>);
    await expect(service.updateMine(actor, { modePreference: "all", screenName: "<script>", trackAccess: "base_only" }))
      .rejects.toMatchObject({ code: "invalid_input" });
    await expect(service.updateMine(actor, { modePreference: "all", screenName: null, trackAccess: "inferred_no" }))
      .rejects.toMatchObject({ code: "invalid_input" });
  });
});
