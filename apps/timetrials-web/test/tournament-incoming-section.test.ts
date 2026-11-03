import { describe, expect, it } from "vitest";

import { provisionalIncomingGroupSummaries } from "../src/tournament-incoming-section.js";
import type { IncomingTournamentResult } from "../src/tournament-incoming-client.js";

function race(id: string, segment: number, ben: number, evan: number): IncomingTournamentResult {
  return {
    incomingResultId: id,
    tournamentId: "tournament.synthetic_feed",
    sourceKind: "tournament_live_capture",
    status: "pending",
    revision: 1,
    result: {
      scoringSegment: segment,
      placements: [
        { observedPlayerName: "Ben", scoring: { racePoints: ben }, participantReference: { namespace: "producer_local_player", value: "ben" } },
        { observedPlayerName: "Evan", scoring: { racePoints: evan }, participantReference: { namespace: "producer_local_player", value: "evan" } },
      ],
    },
    suggestedPhase: "qualifier",
    suggestedGroupId: "tournament_group.feed_a",
    suggestedRaceNumber: 1,
    occurredAtMs: null,
    capturedAtMs: 1,
    duplicateWarning: false,
    evidenceRecordId: "evidence-1",
    submittedByDisplayName: "Capture operator",
    createdAtMs: 1,
  };
}

describe("provisional Tournament desktop feed", () => {
  it("aggregates part totals and derives connection errors from the highest segment", () => {
    expect(provisionalIncomingGroupSummaries([
      race("incoming.1", 1, 15, 12),
      race("incoming.2", 2, 10, 15),
      race("incoming.3", 2, 12, 10),
    ])).toEqual([{
      groupId: "tournament_group.feed_a",
      races: 3,
      connectionErrors: 1,
      blocked: false,
      totals: [
        { observedPlayer: "Ben", points: 37 },
        { observedPlayer: "Evan", points: 37 },
      ],
    }]);
  });

  it("blocks more than three resets instead of truncating the feed", () => {
    expect(provisionalIncomingGroupSummaries([race("incoming.5", 5, 15, 12)])[0]).toMatchObject({
      connectionErrors: 4,
      blocked: true,
    });
  });
});
