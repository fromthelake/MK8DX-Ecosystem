import { describe, expect, it } from "vitest";

import {
  publicTournamentWhatsAppText,
  stageExport,
} from "../src/public-tournament-whatsapp.js";
import { tournamentWhatsAppText } from "../src/tournament-operation-view.js";

// The group chat has read this shape for years. The operator tools and the
// night's own public page must produce the same text for the same night, so
// these tests hold the two against each other rather than against a string
// somebody typed once.

function publicEvent(overrides: Record<string, unknown> = {}) {
  return {
    tournamentId: "tournament.night-9",
    name: "Race Night 9",
    eventDate: "2026-09-12",
    stage: "qualifiers",
    publicResults: true,
    participantCount: 4,
    groups: [{
      groupId: "group.q1", stage: "qualifier", sequence: 1, name: "Groep 1",
      seating: [
        { playerId: "player.ben", displayName: "Ben", seatOrder: 0, stationOwnerDisplayName: "Ben", switchType: "ns2", seatNumber: 1 },
        { playerId: "player.nova", displayName: "Nova", seatOrder: 1, stationOwnerDisplayName: "Ben", switchType: "ns2", seatNumber: 2 },
        { playerId: "player.evan", displayName: "Evan", seatOrder: 2, stationOwnerDisplayName: "Nintendo Switch van Evan", switchType: "ns1", seatNumber: 1 },
      ],
      standings: [
        { rank: 1, playerId: "player.ben", displayName: "Ben", points: 42, races: 4, wins: 2, complete: true },
        { rank: 2, playerId: "player.nova", displayName: "Nova", points: 30, races: 4, wins: 1, complete: true },
      ],
      races: [],
    }],
    overall: [],
    ...overrides,
  } as never;
}

/** The same night as the operator sees it, in the operator's own document. */
function operatorDocument() {
  return {
    tournamentId: "tournament.night-9",
    name: "Race Night 9",
    groups: [{
      groupId: "group.q1", stage: "qualifier", sequence: 1, name: "Groep 1",
      locked: false, manualScoreSegments: 1, manualScores: [],
      members: [
        { playerId: "player.ben", displayName: "Ben", seatOrder: 0, station: { ownerPlayerId: "player.ben", ownerDisplayName: "Ben", switchType: "ns2", seatNumber: 1 } },
        { playerId: "player.nova", displayName: "Nova", seatOrder: 1, station: { ownerPlayerId: "player.ben", ownerDisplayName: "Ben", switchType: "ns2", seatNumber: 2 } },
        { playerId: "player.evan", displayName: "Evan", seatOrder: 2, station: { ownerPlayerId: "player.evan", ownerDisplayName: "Nintendo Switch van Evan", switchType: "ns1", seatNumber: 1 } },
      ],
      standings: { source: "races", rows: [
        { rank: 1, playerId: "player.ben", displayName: "Ben", points: 42, races: 4, wins: 2, complete: true },
        { rank: 2, playerId: "player.nova", displayName: "Nova", points: 30, races: 4, wins: 1, complete: true },
      ] },
      races: [],
    }],
  } as never;
}

describe("the WhatsApp text a participant can paste", () => {
  it("writes the same seating lines the operator export writes", () => {
    expect(publicTournamentWhatsAppText(publicEvent(), "qualifier", "layout"))
      .toBe(tournamentWhatsAppText(operatorDocument(), "qualifier", "layout"));
  });

  it("writes the same results the operator export writes", () => {
    expect(publicTournamentWhatsAppText(publicEvent(), "qualifier", "results"))
      .toBe(tournamentWhatsAppText(operatorDocument(), "qualifier", "results"));
  });

  it("marks the console and never writes the owner prefix twice", () => {
    const text = publicTournamentWhatsAppText(publicEvent(), "qualifier", "layout");
    expect(text).toContain("— [NS2] Nintendo Switch van Ben: #1 Ben & #2 Nova");
    expect(text).toContain("— [NS1] Nintendo Switch van Evan: #1 Evan");
    expect(text).not.toContain("Nintendo Switch van Nintendo Switch");
  });

  it("says so plainly when nobody has been seated yet", () => {
    const empty = publicEvent({
      groups: [{
        groupId: "group.q1", stage: "qualifier", sequence: 1, name: "Groep 1",
        seating: [], standings: [], races: [],
      }],
    });
    expect(publicTournamentWhatsAppText(empty, "qualifier", "layout"))
      .toBe("Kwalificatiegroep 1\n— Nog geen plaatsing");
  });

  it("copies what the night is actually at", () => {
    expect(stageExport(publicEvent({ stage: "setup" })))
      .toMatchObject({ stage: "qualifier", mode: "layout" });
    expect(stageExport(publicEvent({ stage: "finals" })))
      .toMatchObject({ stage: "final", mode: "auto" });
    expect(stageExport(publicEvent({ stage: "finalized" })))
      .toMatchObject({ stage: null, mode: "results" });
  });
});
