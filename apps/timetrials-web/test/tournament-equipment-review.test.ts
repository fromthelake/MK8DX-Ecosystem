import { describe, expect, it } from "vitest";
import { tournamentEquipmentCorrectionLayout, tournamentLayoutDetachment, tournamentLayoutInspectionStage, tournamentLenderWarning, tournamentLendsWithoutPlaying } from "../src/tournament-equipment-review.js";
import type { TournamentDocument } from "../src/tournament-operation-client.js";
import { setProductLanguage } from "../src/product-language.js";

function fixture(): TournamentDocument {
  return {
    participants: [{ playerId: "player.lender", displayName: "Lender", attendance: "absent" }],
    stations: [], overall: [], lifecycle: [],
    groups: [{ groupId: "group.synthetic", name: "Groep 1", stage: "qualifier", sequence: 1,
      locked: true, races: [{ raceNumber: 1 }], manualScores: [], standings: { rows: [] },
      stations: [{ slotIndex: 1, ownerPlayerId: "player.old", ownerDisplayName: "Old", switchType: "ns1" }],
      // Domain tie order is not necessarily physical seat order.
      members: [
        { playerId: "player.second", displayName: "Second", seatOrder: 1,
          station: { ownerPlayerId: "player.old", ownerDisplayName: "Old", switchType: "ns1", seatNumber: 2 } },
        { playerId: "player.first", displayName: "First", seatOrder: 2,
          station: { ownerPlayerId: "player.old", ownerDisplayName: "Old", switchType: "ns1", seatNumber: 1 } },
        { playerId: "player.third", displayName: "Third", seatOrder: 3 },
      ],
    }],
  } as unknown as TournamentDocument;
}

describe("equipment review request", () => {
  it("uses inspection instead of unlocking or rolling back result-bearing layouts", () => {
    const document = fixture();
    expect(tournamentLayoutInspectionStage(document, 3)).toBe("qualifier");
    expect(tournamentLayoutInspectionStage(document, 5)).toBeNull();
    expect(tournamentLayoutInspectionStage(document, 7)).toBeNull();
    expect(tournamentLayoutInspectionStage({ ...document, groups: [{ ...document.groups[0]!, races: [], manualScores: [{ playerId: "player.first", segmentPoints: [4] }] }] }, 3)).toBe("qualifier");
    expect(tournamentLayoutInspectionStage({ ...document, groups: [{ ...document.groups[0]!, races: [], manualScores: [] }] }, 3)).toBeNull();
  });
  it("counts exactly what a detaching return removes, and nothing when nothing is attached", () => {
    const document = fixture();
    expect(tournamentLayoutDetachment(document, 3)).toEqual({ stage: "qualifier", groups: 1, races: 1, manualScores: 0 });
    expect(tournamentLayoutDetachment(document, 7)).toBeNull();
    const two = { ...document, groups: [document.groups[0]!, { ...document.groups[0]!, groupId: "group.two", races: [{ raceNumber: 1 }, { raceNumber: 2 }], manualScores: [{ playerId: "player.first", segmentPoints: [4] }] }] } as unknown as TournamentDocument;
    expect(tournamentLayoutDetachment(two, 3)).toEqual({ stage: "qualifier", groups: 2, races: 3, manualScores: 1 });
    expect(tournamentLayoutDetachment({ ...document, groups: [{ ...document.groups[0]!, races: [], manualScores: [] }] } as unknown as TournamentDocument, 3)).toBeNull();
  });
  it("warns, in the Director's words, when a Switch is selected for somebody who is not playing", () => {
    // The pure module reads the product language from localStorage; give the
    // node test a minimal one so the Dutch wording can be asserted literally.
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
    setProductLanguage("nl");
    expect(tournamentLenderWarning("Alvar", "present", "NS1")).toBeNull();
    expect(tournamentLenderWarning("Alvar", "absent", "NS1")).toBe(
      "Let op: Alvar staat op Afwezig, maar de Nintendo Switch NS1 van Alvar wordt wel geselecteerd. De console telt dan mee als geleende Switch zonder speler. Weet je dit zeker?",
    );
    expect(tournamentLenderWarning("Alvar", "waiting", "NS2")).toContain("staat op Wachtlijst, maar de Nintendo Switch NS2");
    expect(tournamentLendsWithoutPlaying({ attendance: "absent", hasSwitch1: true, hasSwitch2: false })).toBe(true);
    expect(tournamentLendsWithoutPlaying({ attendance: "absent", hasSwitch1: false, hasSwitch2: false })).toBe(false);
    expect(tournamentLendsWithoutPlaying({ attendance: "present", hasSwitch1: true, hasSwitch2: true })).toBe(false);
  });
  it("replaces a console without moving Players, seat numbers or accepted data", () => {
    const document = fixture();
    const before = structuredClone(document);
    const layout = tournamentEquipmentCorrectionLayout(document, "qualifier", [{
      groupId: "group.synthetic", slotIndex: 0, ownerPlayerId: "player.lender", switchType: "ns2",
    }]);
    expect(layout[0]!.seats.map((seat) => [seat.playerId, seat.seatNumber])).toEqual([
      ["player.second", 2], ["player.first", 1], ["player.third", null],
    ]);
    expect(layout[0]!.seats[0]).toMatchObject({ stationOwnerPlayerId: "player.lender", switchType: "ns2" });
    expect(document).toEqual(before);
  });
  it("seats an unseated Player in a newly supplied console, retaining the original group order", () => {
    const layout = tournamentEquipmentCorrectionLayout(fixture(), "qualifier", [
      { groupId: "group.synthetic", slotIndex: 0, ownerPlayerId: "player.old", switchType: "ns1" },
      { groupId: "group.synthetic", slotIndex: 1, ownerPlayerId: "player.lender", switchType: "ns2" },
    ]);
    expect(layout[0]!.seats[2]).toEqual({ playerId: "player.third", stationOwnerPlayerId: "player.lender", switchType: "ns2", seatNumber: 1 });
    expect(layout[0]!.seats.map((seat) => seat.playerId)).toEqual(["player.second", "player.first", "player.third"]);
  });
  it("removing equipment unseats people without removing them from the group", () => {
    const layout = tournamentEquipmentCorrectionLayout(fixture(), "qualifier", []);
    expect(layout[0]!.seats).toHaveLength(3);
    expect(layout[0]!.seats.every((seat) => seat.stationOwnerPlayerId === null && seat.switchType === null && seat.seatNumber === null)).toBe(true);
  });
});
