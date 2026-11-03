import { describe, expect, it, vi } from "vitest";

import {
  createPlayerProfilePreferenceClient,
  profilePreferenceFieldUpdate,
} from "../src/player-profile-preference-settings.js";

const stored = {
  schemaVersion: "mk8dx.player-profile-preferences.v1",
  countryId: "country.nl",
  favoriteCharacterId: "character.yoshi",
  favoriteBodyId: "body.standard_kart",
  favoriteTireId: "tire.roller",
  favoriteGliderId: "glider.cloud_glider",
};

describe("public Player preference client", () => {
  it("loads saved values and sends one CSRF-protected atomic update", async () => {
    const expected = {
      countryId: stored.countryId,
      favoriteCharacterId: stored.favoriteCharacterId,
      favoriteBodyId: stored.favoriteBodyId,
      favoriteTireId: stored.favoriteTireId,
      favoriteGliderId: stored.favoriteGliderId,
    };
    const fetchPort = vi.fn(async (path: string, init: RequestInit) => {
      if (path === "/v1/session/csrf") return new Response(JSON.stringify({ headerName: "X-MK8DX-CSRF", value: "proof" }), { status: 200 });
      if (init.method === "PUT") {
        expect(init.headers).toMatchObject({ "X-MK8DX-CSRF": "proof" });
        expect(JSON.parse(String(init.body))).toEqual(expected);
      }
      return new Response(JSON.stringify(stored), { status: 200 });
    });
    const client = createPlayerProfilePreferenceClient(fetchPort);
    await expect(client.read()).resolves.toEqual(expected);
    await expect(client.save(expected)).resolves.toEqual(expected);
  });

  it("changes one optional profile field without submitting unsaved siblings", () => {
    const expected = {
      countryId: stored.countryId,
      favoriteCharacterId: stored.favoriteCharacterId,
      favoriteBodyId: "body.mr_scooty",
      favoriteTireId: stored.favoriteTireId,
      favoriteGliderId: stored.favoriteGliderId,
    };
    expect(profilePreferenceFieldUpdate(
      {
        countryId: stored.countryId,
        favoriteCharacterId: stored.favoriteCharacterId,
        favoriteBodyId: stored.favoriteBodyId,
        favoriteTireId: stored.favoriteTireId,
        favoriteGliderId: stored.favoriteGliderId,
      },
      "favoriteBodyId",
      "body.mr_scooty",
    )).toEqual(expected);
  });
});
