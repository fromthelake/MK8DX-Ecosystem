import { describe, expect, it, vi } from "vitest";

import { createTournamentOperationClient } from "../src/tournament-operation-client.js";

/**
 * The whole console hangs on this parse. It reads the night the server sends
 * and refuses anything it does not recognise, which is the right instinct and
 * the reason a field listed on the wrong side of that check took every night
 * down: an ordinary standings row has no `correctedFromRaces`, the parser
 * demanded one, and the console said "Het toernooi kon niet worden geladen"
 * for every tournament on the site.
 *
 * So: one night, in the exact shape `tournament-operation-routes.ts` promises,
 * parsed end to end. A field the server sends only sometimes belongs in the
 * optional list, and this test is what says so.
 */

const standingRow = {
  rank: 1,
  playerId: "player.ben",
  displayName: "Ben",
  points: 42,
  races: 4,
  wins: 2,
  bestRace: 15,
  complete: true,
};

const document_ = (rows: readonly Record<string, unknown>[]) => ({
  schemaVersion: "mk8dx.tournament-operation.v1",
  summary: {
    tournamentId: "tournament.synthetic_event_0001",
    name: "Toernooi 13",
    stage: "qualifiers",
    workflowStep: 5,
    qualifierRounds: true,
    qualifierTieBreakMode: "sp",
    finalTieBreakMode: "sp",
    revision: 7,
    participantCount: 1,
    presentCount: 1,
    publicResults: false,
    affectsRating: true,
    updatedAtMs: 1_900_000_000_000,
    seedingSource: "community_rating",
    verifiedOnly: false,
    placementStrategy: "balanced",
    ownerSeatingMode: "owner_strict",
  },
  participants: [{
    playerId: "player.ben", username: "ben", displayName: "Ben",
    attendance: "present", hasSwitch1: true, hasSwitch2: false, inactive: false,
  }],
  stations: [],
  groups: [{
    groupId: "tournament_group.synthetic_event_0001_q1",
    stage: "qualifier",
    sequence: 1,
    name: "Groep 1",
    locked: false,
    manualScoreSegments: 1,
    members: [{ playerId: "player.ben", displayName: "Ben", seatOrder: 1 }],
    races: [],
    manualScores: [],
    standings: { source: "races", rows, tieGroups: [] },
  }],
  overall: [],
  lifecycle: [],
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}

describe("reading a night the server sent", () => {
  it("parses a standing that was never corrected", async () => {
    const client = createTournamentOperationClient(vi.fn(async () => json(document_([standingRow]))));
    const night = await client.load("tournament.synthetic_event_0001");
    expect(night.groups[0]!.standings.rows[0]!.points).toBe(42);
    expect(night.groups[0]!.standings.rows[0]!.correctedFromRaces).toBeUndefined();
  });

  it("keeps the total the races added up to when a Director corrected it", async () => {
    const client = createTournamentOperationClient(
      vi.fn(async () => json(document_([{ ...standingRow, points: 44, correctedFromRaces: 42 }]))),
    );
    const night = await client.load("tournament.synthetic_event_0001");
    expect(night.groups[0]!.standings.rows[0]!.points).toBe(44);
    expect(night.groups[0]!.standings.rows[0]!.correctedFromRaces).toBe(42);
  });

  it("reads every race class and refuses a Mirror that is not 150cc (ADR-0217)", async () => {
    const race = (extra: Record<string, unknown>) => ({
      raceNumber: 1, raceResultId: "tournament_race_result.synthetic_race_0001", revision: 1, scoringSegment: 1,
      sourceKind: "manual_entry", trackId: "track.mario_kart_stadium", countsTowardStandings: true,
      placements: [{ finishPosition: 1, playerId: "player.ben", displayName: "Ben", racePoints: 15 }], ...extra,
    });
    const night = (races: readonly Record<string, unknown>[]) => {
      const value = document_([standingRow]);
      return { ...value, groups: [{ ...value.groups[0]!, races }] };
    };
    const loaded = await createTournamentOperationClient(vi.fn(async () => json(night([
      race({ mode: 50 }), race({ raceNumber: 2, mode: 100 }), race({ raceNumber: 3, mode: 150, mirror: true }),
    ])))).load("tournament.synthetic_event_0001");
    expect(loaded.groups[0]!.races.map(({ mode, mirror }) => [mode, mirror]))
      .toEqual([[50, undefined], [100, undefined], [150, true]]);
    await expect(createTournamentOperationClient(vi.fn(async () => json(night([race({ mode: 200, mirror: true })]))))
      .load("tournament.synthetic_event_0001")).rejects.toThrow();
  });

  it("still refuses a key nobody knows", async () => {
    // The instinct that caused the outage is the right one and stays: a field
    // the client does not understand is a contract change, not a shrug.
    const client = createTournamentOperationClient(
      vi.fn(async () => json(document_([{ ...standingRow, mysteryColumn: 3 }]))),
    );
    await expect(client.load("tournament.synthetic_event_0001")).rejects.toThrow();
  });
});
