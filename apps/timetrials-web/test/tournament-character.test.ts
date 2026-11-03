import { describe, expect, it } from "vitest";

import { tournamentCharacterIcon, tournamentCharacterKey } from "../src/tournament-character.js";

describe("the character a score workbook names", () => {
  it("finds the character itself when the catalog carries that name", () => {
    expect(tournamentCharacterKey("Mario")).toBe("character.mario");
    expect(tournamentCharacterKey("Tanooki Mario")).toBe("character.tanooki_mario");
    expect(tournamentCharacterKey("waluigi")).toBe("character.waluigi");
  });

  it("reads a colour and its roster as one variant", () => {
    // Tournament Live writes "Pink Yoshi" with roster "Yoshi".
    const pink = tournamentCharacterKey("Pink Yoshi", "Yoshi");
    expect(pink).toMatch(/^character_variant\.yoshi\./u);
    expect(tournamentCharacterIcon({ key: pink!, label: "Pink Yoshi" })).toMatch(/^\/assets\/images\/characters\//u);
  });

  it("falls back to the roster when the colour is not one the catalog has", () => {
    expect(tournamentCharacterKey("Fluorescent Yoshi", "Yoshi")).toBe("character.yoshi");
  });

  it("reads the names the Processor spells its own way", () => {
    // The recording cannot tell a Mii's weight class; medium is the default.
    expect(tournamentCharacterKey("Mii")).toBe("character.mii_medium");
    expect(tournamentCharacterKey("Villager (Male)", "Villager")).toBe("character.villager_male");
    expect(tournamentCharacterKey("Metal Mario", "Metal/Gold Mario")).toBe("character.metal_mario");
    expect(tournamentCharacterKey("Purple Inkling Boy", "Inkling")).toMatch(/^character(_variant)?\.inkling_boy/u);
  });

  it("says nothing about a name nobody carries", () => {
    expect(tournamentCharacterKey("")).toBeNull();
    expect(tournamentCharacterKey("Nobody At All")).toBeNull();
    expect(tournamentCharacterIcon(undefined)).toBeNull();
    expect(tournamentCharacterIcon({ label: "Nobody At All" })).toBeNull();
  });

  it("resolves a picture from the label alone when no key travelled", () => {
    expect(tournamentCharacterIcon({ label: "Bowser" })).toMatch(/bowser/u);
  });
});
