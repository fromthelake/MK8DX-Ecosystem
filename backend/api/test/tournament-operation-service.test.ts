import { describe, expect, it } from "vitest";

import {
  rosterNameKey,
  tournamentInactiveRosterCutoffMs,
  tournamentSeedsAreDrawn,
} from "../src/tournaments/tournament-operation-service.js";

describe("Tournament historical roster inactivity", () => {
  // ADR-0177 decision 16. The owner rejected the three-calendar-month rule: a
  // Player is Inactive only when three whole Tournaments have been played
  // without them, not merely because time has passed.
  const tn10 = Date.UTC(2025, 4, 16);
  const tn11 = Date.UTC(2025, 9, 3);
  const tn12 = Date.UTC(2026, 2, 27);

  it("cuts off at the third most recent completed Tournament", () => {
    expect(tournamentInactiveRosterCutoffMs([tn12, tn11, tn10])).toBe(tn10);
  });

  it("keeps the window at three even when more Tournaments exist", () => {
    const tn9 = Date.UTC(2025, 0, 3);
    expect(tournamentInactiveRosterCutoffMs([tn12, tn11, tn10, tn9])).toBe(tn10);
  });

  it("marks nobody inactive until three Tournaments have been completed", () => {
    expect(tournamentInactiveRosterCutoffMs([tn12, tn11])).toBeNull();
    expect(tournamentInactiveRosterCutoffMs([])).toBeNull();
  });
});

describe("Tournament seeding SP", () => {
  // The owner found Step 2 showing SP from before the ratings were rebuilt.
  // The stored seed is a record of what a draw used; until a draw exists
  // there is no such record to protect, and the live rating is the truth.
  it("shows the live rating while no group has been drawn", () => {
    expect(tournamentSeedsAreDrawn(0, false)).toBe(false);
  });

  it("keeps the drawn seeds once a group exists", () => {
    expect(tournamentSeedsAreDrawn(1, false)).toBe(true);
    expect(tournamentSeedsAreDrawn(6, false)).toBe(true);
  });

  it("keeps them for a finalized Tournament whatever its groups say", () => {
    // A finalized Tournament is history end to end; nothing about it may move
    // because a rating was recomputed afterwards.
    expect(tournamentSeedsAreDrawn(0, true)).toBe(true);
  });
});

describe("the name a roster file writes", () => {
  // The Web called every Player who was not yet in the night "unknown", tried
  // to create them, and the server refused the whole file with
  // "display_name_taken" - so a perfectly good file imported nothing.
  it("is the same key however it is spelled", () => {
    expect(rosterNameKey("Moss HM")).toBe(rosterNameKey("moss hm"));
    expect(rosterNameKey(" Jan Ywe ")).toBe("janywe");
    expect(rosterNameKey("Renée")).toBe("renee");
    expect(rosterNameKey("Milo-V")).toBe("milov");
  });

  it("keeps two different people apart", () => {
    expect(rosterNameKey("Moss HM")).not.toBe(rosterNameKey("Moss HZ"));
    expect(rosterNameKey("Milo V")).not.toBe(rosterNameKey("Milo J"));
  });
});
