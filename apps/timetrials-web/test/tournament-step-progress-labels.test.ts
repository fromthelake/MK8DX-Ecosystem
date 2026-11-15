import { afterEach, describe, expect, it } from "vitest";

import { setProductLanguage } from "../src/product-language.js";
import type { PublicTournamentEvent } from "../src/tournament-operation-client.js";
import { tournamentScoringGroups } from "../src/tournament-step-progress.js";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string): string | null => storage.get(key) ?? null,
    setItem: (key: string, value: string): void => { storage.set(key, value); },
  },
});

// The server stores a generated qualifier group as "Groep <n>"; only the fields the progress line reads.
const event = {
  groups: [
    { groupId: "g1", stage: "qualifier", name: "Groep 1", races: [] },
    { groupId: "g2", stage: "qualifier", name: "Groep 2", races: [{}, {}] },
    { groupId: "f1", stage: "final", name: "Kampioen", tierKey: "champion", races: [] },
  ],
} as unknown as PublicTournamentEvent;

afterEach(() => { setProductLanguage("en"); });

describe("tournament step progress group names (A2 walkthrough: 'Groep 1' on an English page)", () => {
  it("shows a generated group in English on an English page", () => {
    setProductLanguage("en");
    expect(tournamentScoringGroups(event, 5)).toEqual([{ name: "Group 1", races: 0 }, { name: "Group 2", races: 2 }]);
  });

  it("keeps the Dutch name on a Dutch page", () => {
    setProductLanguage("nl");
    expect(tournamentScoringGroups(event, 5).map((row) => row.name)).toEqual(["Groep 1", "Groep 2"]);
  });

  it("never shows the stored Dutch tier name of a final group to an English reader", () => {
    setProductLanguage("en");
    const [final] = tournamentScoringGroups(event, 9);
    expect(final?.name).not.toBe("Kampioen");
  });
});
