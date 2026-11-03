import { describe, expect, it } from "vitest";
import { buildTournamentInsights, buildUtpMovementAudit, wordpressReportHtml } from "../src/tournament-insights.js";

const document = {
  summary: { tournamentId: "tournament.synthetic_report", name: "<Night>", stage: "finals", revision: 1, participantCount: 2, presentCount: 2, publicResults: true, affectsRating: true, updatedAtMs: 1 },
  participants: [{ playerId: "player.alpha", username: "alpha", displayName: "Alpha", attendance: "present", hasSwitch1: true, hasSwitch2: false }, { playerId: "player.beta", username: "beta", displayName: "Beta", attendance: "present", hasSwitch1: false, hasSwitch2: true }],
  stations: [], overall: [], lifecycle: [], schemaVersion: "mk8dx.tournament-operation.v1",
  groups: [{ groupId: "tournament_group.qualifier", stage: "qualifier", sequence: 1, name: "Q1", locked: true, manualScoreSegments: 1, manualScores: [], standings: { source: "races", rows: [] }, members: [
    { playerId: "player.alpha", displayName: "Alpha", seatOrder: 1, station: { ownerPlayerId: "player.alpha", ownerDisplayName: "Alpha", switchType: "ns1", seatNumber: 1 } },
    { playerId: "player.beta", displayName: "Beta", seatOrder: 2, station: { ownerPlayerId: "player.beta", ownerDisplayName: "Beta", switchType: "ns2", seatNumber: 1 } }],
    races: [{ raceNumber: 1, raceResultId: "tournament_race_result.synthetic01", revision: 1, trackId: "track.test", countsTowardStandings: true, placements: [{ finishPosition: 1, playerId: "player.alpha", displayName: "Alpha", racePoints: 15 }, { finishPosition: 2, playerId: "player.beta", displayName: "Beta", racePoints: 12 }] }] },
    { groupId: "tournament_group.final", stage: "final", sequence: 1, name: "F1", locked: false, manualScoreSegments: 1, manualScores: [], standings: { source: "none", rows: [] }, members: [{ playerId: "player.beta", displayName: "Beta", seatOrder: 1, station: { ownerPlayerId: "player.alpha", ownerDisplayName: "Alpha", switchType: "ns1", seatNumber: 1 } }], races: [] }],
} as never;

describe("source-derived Tournament insights", () => {
  it("recovers performance, track, head-to-head, and UTP movement outcomes", () => {
    const insights = buildTournamentInsights(document);
    expect(insights.raceCount).toBe(1); expect(insights.players[0]?.wins).toBe(1);
    expect(insights.tracks[0]?.topPlayer).toBe("Alpha"); expect(insights.headToHead[0]?.sharedRaces).toBe(1);
    expect(buildUtpMovementAudit(document)).toMatchObject({ donations: 1, moves: 1, cost: 4 });
  });
  it("produces escaped WordPress-ready report HTML", () => {
    const html = wordpressReportHtml(document, { introText: "Intro <safe>", tracksIntroText: "Tracks", playerNotes: {} });
    expect(html).toContain("&lt;Night&gt;"); expect(html).toContain("Intro &lt;safe&gt;"); expect(html).toContain("<svg");
  });
});
