import { describe, expect, it } from "vitest";

import { buildScoreWorkbook } from "../src/tournaments/score-workbook-export.js";
import { parseScoreWorkbookBase64 } from "../src/tournaments/score-workbook-import.js";

// Owner, 2026-09-15: a Step 5/9 export re-imported at Step 5/9 lost every
// character, because the export never wrote the column the import reads.
describe("the score workbook export", () => {
  it("writes the character beside every standing, so an export re-imported keeps it", async () => {
    const document = {
      summary: { tournamentId: "tournament.synthetic01", name: "Friday night", startAtMs: 1_700_000_000_000, updatedAtMs: 1_700_000_000_000 },
      groups: [{
        groupId: "tournament_group.q1", stage: "qualifier", sequence: 1, name: "Groep 1",
        members: [
          { playerId: "player.ben", displayName: "Ben", seatOrder: 1, character: { key: "character.yoshi", label: "Pink Yoshi", roster: "Yoshi" } },
          { playerId: "player.evan", displayName: "Evan", seatOrder: 2 },
        ],
        manualScores: [],
        races: [{
          raceNumber: 1, trackId: "track.baby_park", countsTowardStandings: true,
          placements: [
            { playerId: "player.ben", displayName: "Ben", finishPosition: 1, racePoints: 15 },
            { playerId: "player.evan", displayName: "Evan", finishPosition: 2, racePoints: 12 },
          ],
        }],
        standings: {
          source: "races",
          rows: [
            { rank: 1, playerId: "player.ben", displayName: "Ben", points: 15, races: 1, wins: 1, bestRace: 1, complete: true },
            { rank: 2, playerId: "player.evan", displayName: "Evan", points: 12, races: 1, wins: 0, bestRace: 2, complete: true },
          ],
          tieGroups: [],
        },
      }],
    };
    const exported = await buildScoreWorkbook(document as never, 5, [{ trackId: "track.baby_park", displayName: "Baby Park" }]);
    const videos = await parseScoreWorkbookBase64(exported.workbookBase64);
    const groep = videos.find((video) => video.videoName === "Groep 1");
    expect(groep).toBeDefined();
    const ben = groep!.rows.find((row) => row.playerName === "Ben");
    const evan = groep!.rows.find((row) => row.playerName === "Evan");
    expect([ben?.character, ben?.characterRoster]).toEqual(["Pink Yoshi", "Yoshi"]);
    expect(evan?.character ?? undefined).toBeUndefined();
  });
});
