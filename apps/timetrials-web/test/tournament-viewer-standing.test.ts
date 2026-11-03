import { describe, expect, it, vi } from "vitest";

import {
  seatingMessage,
  viewerStandingIn,
  viewerTournamentStanding,
} from "../src/tournament-viewer-standing.js";
import { tournamentGroupLabel } from "../src/tournaments-view-labels.js";

const localize = (english: string): string => english;

function event(overrides: Record<string, unknown> = {}) {
  return {
    tournamentId: "tournament.night-9",
    name: "Race Night 9",
    eventDate: "2026-09-12",
    stage: "qualifier",
    publicResults: true,
    participantCount: 8,
    groups: [{
      groupId: "group.a", stage: "qualifier", sequence: 1, name: "Group A",
      seating: [],
      standings: [
        { rank: 1, playerId: "player.ben", displayName: "Ben", points: 0, races: 0, wins: 0, complete: false },
        { rank: 2, playerId: "player.nova", displayName: "Nova", points: 0, races: 0, wins: 0, complete: false },
      ],
      races: [],
    }],
    overall: [],
    updatedAtMs: 10,
    ...overrides,
  } as never;
}

describe("what the Tournaments page says to a Player who is not a Director", () => {
  it("finds the Player in a group and knows they are not seated yet", () => {
    const standing = viewerStandingIn(event(), "player.ben");
    expect(standing).toMatchObject({
      kind: "participating", name: "Race Night 9", groupName: "Group A", seated: false,
    });
  });

  it("counts a Player as seated once their group has actually raced", () => {
    const started = event({
      groups: [{
        groupId: "group.a", stage: "qualifier", sequence: 1, name: "Group A",
        seating: [],
        standings: [
          { rank: 1, playerId: "player.ben", displayName: "Ben", points: 12, races: 4, wins: 2, complete: false },
        ],
        races: [],
      }],
    });
    expect(viewerStandingIn(started, "player.ben")).toMatchObject({ seated: true });
  });

  it("names a final group in the reader's language, never the stored Dutch name", () => {
    const finals = event({
      groups: [{
        groupId: "group.final", stage: "final", sequence: 1, name: "Kampioen", tierKey: "champion",
        seating: [],
        standings: [
          { rank: 1, playerId: "player.ben", displayName: "Ben", points: 0, races: 0, wins: 0, complete: false },
        ],
        races: [],
      }],
    });
    expect(viewerStandingIn(finals, "player.ben")).toMatchObject({ groupName: "Champion" });
    vi.stubGlobal("localStorage", { getItem: () => "nl", setItem: () => undefined });
    try {
      expect(viewerStandingIn(finals, "player.ben")).toMatchObject({ groupName: "Kampioen" });
    } finally {
      vi.unstubAllGlobals();
    }
    // A stored tier name without a tier key is still recognised.
    expect(tournamentGroupLabel("Kampioen")).toBe("Champion");
    expect(tournamentGroupLabel("Feest")).toBe("Party");
    expect(tournamentGroupLabel("Winnaarspoule")).toBe("Winnaarspoule");
  });

  it("says nothing about a Player who is not in the night", () => {
    expect(viewerStandingIn(event(), "player.evan")).toBeNull();
  });

  it("prefers a running night over a finished one", () => {
    const running = event();
    const finished = event({
      tournamentId: "tournament.night-8", name: "Race Night 8", stage: "finalized",
      updatedAtMs: 99,
      overall: [{ placement: 3, playerId: "player.ben", displayName: "Ben", groupName: "Final", groupRank: 3, points: 30 }],
    });
    const standing = viewerTournamentStanding(
      [
        { tournamentId: "tournament.night-9", name: "Race Night 9", stage: "qualifier", participantCount: 8, updatedAtMs: 10 },
        { tournamentId: "tournament.night-8", name: "Race Night 8", stage: "finalized", participantCount: 8, updatedAtMs: 99 },
      ] as never,
      new Map([["tournament.night-9", running], ["tournament.night-8", finished]]),
      "player.ben",
    );
    expect(standing).toMatchObject({ kind: "participating", name: "Race Night 9" });
  });

  it("falls back to the last night the Player actually raced", () => {
    const finished = event({
      tournamentId: "tournament.night-8", name: "Race Night 8", stage: "finalized",
      groups: [], updatedAtMs: 99,
      overall: [{ placement: 3, playerId: "player.ben", displayName: "Ben", groupName: "Final", groupRank: 3, points: 30 }],
    });
    const standing = viewerTournamentStanding(
      [{ tournamentId: "tournament.night-8", name: "Race Night 8", stage: "finalized", participantCount: 8, updatedAtMs: 99 }] as never,
      new Map([["tournament.night-8", finished]]),
      "player.ben",
    );
    expect(standing).toMatchObject({ kind: "history", latestName: "Race Night 8", placement: 3 });
  });

  it("says never for a Player who has never appeared, and for a visitor", () => {
    const finished = event({ groups: [], overall: [] });
    const summaries = [{ tournamentId: "tournament.night-9", name: "Race Night 9", stage: "qualifier", participantCount: 8, updatedAtMs: 10 }] as never;
    expect(viewerTournamentStanding(summaries, new Map([["tournament.night-9", finished]]), "player.evan"))
      .toEqual({ kind: "never" });
    expect(viewerTournamentStanding(summaries, new Map(), null)).toEqual({ kind: "never" });
  });

  it("tells an unseated Player to wait for the Director, and a seated one where they are", () => {
    const waiting = viewerStandingIn(event(), "player.ben");
    expect(seatingMessage(waiting as never, localize))
      .toBe("You are in Race Night 9 · 2026-09-12. Wait to be seated by the Director.");
    const seated = { ...(waiting as unknown as Record<string, unknown>), seated: true } as never;
    expect(seatingMessage(seated, localize))
      .toBe("You are racing in Race Night 9 · 2026-09-12, in Group A.");
  });

  it("names the console once the Director has seated the Player", () => {
    const seated = event({
      groups: [{
        groupId: "group.a", stage: "qualifier", sequence: 1, name: "Group A",
        seating: [{
          playerId: "player.ben", displayName: "Ben", seatOrder: 0,
          stationOwnerDisplayName: "Evan", switchType: "ns2", seatNumber: 2,
        }],
        standings: [
          { rank: 1, playerId: "player.ben", displayName: "Ben", points: 0, races: 0, wins: 0, complete: false },
        ],
        races: [],
      }],
    });
    const standing = viewerStandingIn(seated, "player.ben");
    // A seat is the Director's answer, so the Player is no longer waiting even
    // though their group has not raced yet.
    expect(standing).toMatchObject({ seated: true });
    expect(seatingMessage(standing as never, localize)).toBe(
      "You are racing in Race Night 9 · 2026-09-12, in Group A · [NS2] Nintendo Switch van Evan, seat #2.",
    );
  });

  it("never invents a console for a Player who has not been seated", () => {
    const other = event({
      groups: [{
        groupId: "group.a", stage: "qualifier", sequence: 1, name: "Group A",
        seating: [{
          playerId: "player.nova", displayName: "Nova", seatOrder: 0,
          stationOwnerDisplayName: "Nintendo Switch van Evan", switchType: "ns1", seatNumber: 1,
        }],
        standings: [
          { rank: 1, playerId: "player.ben", displayName: "Ben", points: 0, races: 0, wins: 0, complete: false },
        ],
        races: [],
      }],
    });
    const standing = viewerStandingIn(other, "player.ben");
    expect(standing).toMatchObject({ seated: false });
    expect(seatingMessage(standing as never, localize))
      .toBe("You are in Race Night 9 · 2026-09-12. Wait to be seated by the Director.");
  });
});
