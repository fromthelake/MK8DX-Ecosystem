import { afterEach, describe, expect, it } from "vitest";

import {
  dutchPresentation,
  presentationSearchText,
} from "../src/dutch-ui-copy.js";
import { setProductLanguage } from "../src/product-language.js";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string): string | null => storage.get(key) ?? null,
    setItem: (key: string, value: string): void => { storage.set(key, value); },
  },
});

describe("Dutch presentation catalog", () => {
  afterEach(() => {
    storage.clear();
    setProductLanguage("en");
  });

  it("uses canonical Dutch names for cups, tracks, loadout parts and countries", () => {
    setProductLanguage("nl");
    expect(dutchPresentation("Mushroom Cup")).toBe("Paddenstoelbeker");
    expect(dutchPresentation("Mario Kart Stadium")).toBe("Mario Kart-Stadion");
    expect(dutchPresentation("Standard Kart")).toBe("Standaardkart");
    expect(dutchPresentation("country.nl")).toBe("Nederland");
  });

  it("lets Dutch search terms find the unchanged canonical English value", () => {
    expect(presentationSearchText("Mario Kart Stadium")).toContain("mario kart-stadion");
    expect(presentationSearchText("Standard Kart")).toContain("standaardkart");
  });

  it("localizes embedded track workflow copy but leaves player names intact", () => {
    setProductLanguage("nl");
    expect(dutchPresentation("Mario Kart Stadium · 3 laps")).toBe("Mario Kart-Stadion · 3 ronden");
    expect(dutchPresentation("BEnZor")).toBe("BEnZor");
  });

  it("localizes dynamic activity, ranking and record labels naturally", () => {
    setProductLanguage("nl");
    expect(dutchPresentation("9h ago")).toBe("9 uur geleden");
    expect(dutchPresentation("2d ago")).toBe("2 dagen geleden");
    expect(dutchPresentation("View 2 runs & details")).toBe("2 runs en details bekijken");
    expect(dutchPresentation("8 Players · 150cc · total across 96 tracks"))
      .toBe("8 spelers · 150cc · totaal over 96 circuits");
    expect(dutchPresentation("7 Players · 200cc · BCP 48 · total across 48 tracks"))
      .toBe("7 spelers · 200cc · Uitbreiding 48 · totaal over 48 circuits");
    expect(dutchPresentation("5 Players · 150cc · Base 48 · click a Player column to sort"))
      .toBe("5 spelers · 150cc · Basis 48 · klik op een spelerskolom om te sorteren");
    expect(dutchPresentation("72 tracks led")).toBe("72 circuits aangevoerd");
    expect(dutchPresentation("Calculating your records…")).toBe("Je records worden berekend…");
    expect(dutchPresentation("Choose Player")).toBe("Kies een speler");
    expect([
      dutchPresentation("Lowest mastery"),
      dutchPresentation("Closest rival"),
      dutchPresentation("Biggest gap"),
    ]).toEqual(["Laagste Mastery", "Dichtste rivaal", "Grootste achterstand"]);
    expect([
      dutchPresentation("Staff ghosts left"),
      dutchPresentation("Within 1s of #1"),
      dutchPresentation("Current track records"),
      dutchPresentation("Tracks left to drive"),
      dutchPresentation("Top 3 positions"),
    ]).toEqual([
      "Staff-ghosts te verslaan",
      "Binnen 1 s van #1",
      "Huidige circuitrecords",
      "Circuits nog te rijden",
      "Top 3-posities",
    ]);
    expect(dutchPresentation("Base tracks · Staff ghosts defeated"))
      .toBe("Basiscircuits · staff-ghosts verslagen");
    expect(dutchPresentation("DLC tracks · Times set"))
      .toBe("DLC-circuits · tijden gezet");
    expect(dutchPresentation("Do you have the Booster Course Pass? Set it in Settings so progress uses the right journey."))
      .toContain("Circuit-uitbreidingspas");
  });

  it("localizes required and optional onboarding guidance", () => {
    setProductLanguage("nl");
    expect(dutchPresentation("Username *")).toBe("Gebruikersnaam *");
    expect(dutchPresentation("Display name (optional)"))
      .toBe("Weergavenaam (optioneel)");
    expect(dutchPresentation("Required Player step complete"))
      .toBe("Verplichte spelersstap voltooid");
    expect(dutchPresentation("Save character")).toBe("Coureur opslaan");
  });
});
