import { describe, expect, it } from "vitest";

import { disambiguatedName, repeatedDisplayNames } from "../src/name-disambiguation.js";

describe("equal names on one page (ADR-0218)", () => {
  it("adds the username only where two Players share a name", () => {
    const entries = [
      { playerId: "player.mal", displayName: "Mal", username: "mal" },
      { playerId: "player.mal_2", displayName: " mal ", username: "mal-2" },
      { playerId: "player.nova", displayName: "Nova", username: "nova" },
    ];
    const repeated = repeatedDisplayNames(entries);
    expect(entries.map((entry) => disambiguatedName(entry, repeated))).toEqual([
      "Mal (@mal)", " mal  (@mal-2)", "Nova",
    ]);
  });

  it("does not call one Player listed twice a repeat", () => {
    const repeated = repeatedDisplayNames([
      { playerId: "player.mal", displayName: "Mal" },
      { playerId: "player.mal", displayName: "Mal" },
    ]);
    expect(disambiguatedName({ displayName: "Mal", username: "mal" }, repeated)).toBe("Mal");
  });
});
