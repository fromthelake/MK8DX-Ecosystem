import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { buildScoreWorkbook } from "../src/tournaments/score-workbook-export.js";
import { parseScoreWorkbookBase64 } from "../src/tournaments/score-workbook-import.js";

// The workbook is the API's only spreadsheet export. Text goes in as string
// cells (ExcelJS never turns a string into a formula), so unlike the CSV
// exports (packages/domain/policies/spreadsheet-text-v1.json) it needs no
// apostrophe and its import takes none off.

function documentWith(names: readonly string[]) {
  const ids = names.map((_, index) => `player.p${index}`);
  return {
    summary: { tournamentId: "tournament.synthetic01", name: "=Friday", startAtMs: 1_700_000_000_000, updatedAtMs: 1_700_000_000_000 },
    groups: [{
      groupId: "tournament_group.q1", stage: "qualifier", sequence: 1, name: "@Groep 1",
      members: names.map((displayName, index) => ({
        playerId: ids[index], displayName, seatOrder: index + 1,
        character: { key: "character.yoshi", label: "=Yoshi", roster: "+Yoshi" },
      })),
      manualScores: [],
      races: [{
        raceNumber: 1, trackId: "track.baby_park", countsTowardStandings: true, scoringNote: "-note",
        placements: names.map((displayName, index) => ({
          playerId: ids[index], displayName, finishPosition: index + 1, racePoints: 12 - index,
        })),
      }],
      standings: {
        source: "races",
        rows: names.map((displayName, index) => ({
          rank: index + 1, playerId: ids[index], displayName, points: 12 - index, races: 1,
          wins: index === 0 ? 1 : 0, bestRace: index + 1, complete: true,
        })),
        tieGroups: [],
      },
    }],
  };
}

describe("text in the score workbook stays text in a spreadsheet", () => {
  it("writes formula-like names as string cells and the points as number cells", async () => {
    const names = ["=1+1", "@SUM(A1:A2)", "+Сергей", "-マリオ", "=HYPERLINK(\"https://example.invalid\",\"x\")", "Zoë"];
    const exported = await buildScoreWorkbook(documentWith(names) as never, 5,
      [{ trackId: "track.baby_park", displayName: "=Baby Park", cupName: "@Cup" }]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(exported.workbookBase64, "base64") as never);
    let formulas = 0;
    let strings = 0;
    for (const sheet of workbook.worksheets) {
      sheet.eachRow((row) => row.eachCell((cell) => {
        if (cell.type === ExcelJS.ValueType.Formula || cell.formula !== undefined) { formulas += 1; }
        if (typeof cell.value === "string" && /^[=+\-@]/u.test(cell.value)) {
          expect(cell.type, `${sheet.name}!${cell.address}`).toBe(ExcelJS.ValueType.String);
          strings += 1;
        }
      }));
    }
    expect(formulas).toBe(0);
    expect(strings).toBeGreaterThan(names.length * 2);
    const results = workbook.getWorksheet("Results")!;
    const first = results.getRow(2);
    expect(first.getCell(6).value).toBe("=1+1");
    expect(first.getCell(5).type).toBe(ExcelJS.ValueType.Number);
    expect(first.getCell(9).type).toBe(ExcelJS.ValueType.Number);
    const standings = workbook.getWorksheet("Final Standings")!;
    expect(standings.getRow(2).getCell(3).value).toBe("=1+1");
    expect(standings.getRow(2).getCell(4).type).toBe(ExcelJS.ValueType.Number);

    // The export read back by the Step 5/9 import names the same Players.
    const videos = await parseScoreWorkbookBase64(exported.workbookBase64);
    expect(videos[0]!.rows.map((row) => row.playerName)).toEqual(names);
  });

  it("adds no CSV apostrophe to a workbook, so every name, apostrophes included, reads back unchanged", async () => {
    const names = ["'=1+1", "'t Hoofd", "''@x", "-5", "李雷"];
    const exported = await buildScoreWorkbook(documentWith(names) as never, 5,
      [{ trackId: "track.baby_park", displayName: "Baby Park" }]);
    const videos = await parseScoreWorkbookBase64(exported.workbookBase64);
    expect(videos[0]!.rows.map((row) => row.playerName)).toEqual(names);
  });
});
