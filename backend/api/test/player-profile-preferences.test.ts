import { describe, expect, it } from "vitest";

import {
  PlayerProfilePreferenceError,
  PlayerProfilePreferenceService,
  type PlayerProfilePreferences,
} from "../src/profiles/player-profile-preferences.js";
import type { ActorContext } from "../src/identity/types.js";

const actor: ActorContext = { role: "account", userAccountId: "user_account.ben" };
const value: PlayerProfilePreferences = {
  countryId: "country.nl",
  favoriteCharacterId: "character_variant.yoshi.017_light_blue",
  favoriteBodyId: "body.standard_kart",
  favoriteTireId: "tire.roller",
  favoriteGliderId: "glider.cloud_glider",
};

describe("Player profile preferences", () => {
  it("reads and atomically saves catalog-backed preferences for a verified Player", async () => {
    let stored = value;
    const service = new PlayerProfilePreferenceService({
      async readForAccount() { return stored; },
      async updateForAccount(_id, next) { stored = next; return true; },
    }, {
      hasCountry: (id) => id === value.countryId,
      hasCharacterAppearance: (id) => id === value.favoriteCharacterId,
      hasBody: (id) => id === value.favoriteBodyId,
      hasTire: (id) => id === value.favoriteTireId,
      hasGlider: (id) => id === value.favoriteGliderId,
    }, () => 123);
    await expect(service.readMine(actor)).resolves.toEqual(value);
    await expect(service.updateMine(actor, value)).resolves.toEqual(value);
    expect(stored).toEqual(value);
  });

  it("rejects unknown catalog IDs and accounts without a verified Player", async () => {
    const service = new PlayerProfilePreferenceService({
      async readForAccount() { return null; },
      async updateForAccount() { return false; },
    }, {
      hasCountry: () => false,
      hasCharacterAppearance: () => false,
      hasBody: () => false,
      hasTire: () => false,
      hasGlider: () => false,
    });
    await expect(service.readMine(actor)).rejects.toMatchObject({ code: "no_verified_player" } satisfies Partial<PlayerProfilePreferenceError>);
    await expect(service.updateMine(actor, { ...value, countryId: "country.unknown" }))
      .rejects.toMatchObject({ code: "invalid_input" });
  });
});
