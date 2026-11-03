import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { parseScoreWorkbookBase64 } from "../src/tournaments/score-workbook-import.js";

async function workbookBase64(
  rows: readonly (readonly (string | number)[])[],
  resultRows: readonly (readonly (string | number)[])[] = [],
): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Final Standings");
  rows.forEach((row) => sheet.addRow([...row]));
  if (resultRows.length > 0) {
    const results = workbook.addWorksheet("Results");
    resultRows.forEach((row) => results.addRow([...row]));
  }
  const bytes = await workbook.xlsx.writeBuffer();
  return Buffer.from(bytes).toString("base64");
}

describe("original Tournament_Results.xlsx score import", () => {
  it("groups Final Standings and preserves communication-error segments", async () => {
    const preview = await parseScoreWorkbookBase64(await workbookBase64([
      ["VideoName", "Races", "Position", "PlayerName", "TotalPoints", "Character", "Points Segment 1", "Points Segment 2"],
      ["Qualifier A", 8, 1, "Ben", 82, "Mario", 40, 42],
      ["Qualifier A", 8, 2, "Evan", 75, "Luigi", 35, 40],
    ]));
    expect(preview).toEqual([{
      videoName: "Qualifier A",
      races: [],
      rows: [
        // The character the workbook recorded travels with the row: the
        // community's report prints that picture beside the name.
        { playerName: "Ben", totalPoints: 82, position: 1, pointSegments: [40, 42], character: "Mario" },
        { playerName: "Evan", totalPoints: 75, position: 2, pointSegments: [35, 40], character: "Luigi" },
      ],
    }]);
  });

  it("accepts original mixed exports where only one group has communication-error segments", async () => {
    const preview = await parseScoreWorkbookBase64(await workbookBase64([
      ["VideoName", "Races", "Position", "PlayerName", "TotalPoints", "Character", "Points Segment 1", "Points Segment 2"],
      ["Kampioen", 31, 1, "Ben", 82, "Mario", 40, 42],
      ["Talent", 32, 1, "Evan", 75, "Luigi", "", ""],
    ]));
    expect(preview).toEqual([
      { videoName: "Kampioen", races: [], rows: [{ playerName: "Ben", totalPoints: 82, position: 1, pointSegments: [40, 42], character: "Mario" }] },
      { videoName: "Talent", races: [], rows: [{ playerName: "Evan", totalPoints: 75, position: 1, pointSegments: [], character: "Luigi" }] },
    ]);
  });

  it("recovers per-race finish order and track labels from the Results sheet", async () => {
    const preview = await parseScoreWorkbookBase64(await workbookBase64([
      ["VideoName", "Position", "PlayerName", "TotalPoints"],
      ["Qualifier A", 1, "Ben", 27],
      ["Qualifier A", 2, "Evan", 24],
    ], [
      ["Video", "Race", "Track", "Position", "Player"],
      ["Qualifier A", 1, "Mario Kart Stadium", 2, "Evan"],
      ["Qualifier A", 1, "Mario Kart Stadium", 1, "Ben"],
      ["Qualifier A", 2, "Toad Harbour", 1, "Evan"],
      ["Qualifier A", 2, "Toad Harbour", 2, "Ben"],
    ]));
    expect(preview[0]?.races).toEqual([
      { raceNumber: 1, trackName: "Mario Kart Stadium", finishOrder: ["Ben", "Evan"] },
      { raceNumber: 2, trackName: "Toad Harbour", finishOrder: ["Evan", "Ben"] },
    ]);
  });

  it("maps an optional Class column to the race's mode and Mirror flag (ADR-0217)", async () => {
    const preview = await parseScoreWorkbookBase64(await workbookBase64([
      ["VideoName", "Position", "PlayerName", "TotalPoints"],
      ["Cup", 1, "Ben", 27],
      ["Cup", 2, "Evan", 24],
    ], [
      ["Video", "Race", "Track", "Position", "Player", "Class"],
      ["Cup", 1, "Mario Kart Stadium", 1, "Ben", "50cc"],
      ["Cup", 1, "Mario Kart Stadium", 2, "Evan", "50cc"],
      ["Cup", 2, "Toad Harbour", 1, "Evan", "Mirror"],
      ["Cup", 2, "Toad Harbour", 2, "Ben", "Mirror"],
      ["Cup", 3, "Water Park", 1, "Evan", ""],
      ["Cup", 3, "Water Park", 2, "Ben", ""],
    ]));
    expect(preview[0]?.races.map(({ mode, mirror }) => ({ mode, mirror }))).toEqual([
      { mode: 50, mirror: undefined }, { mode: 150, mirror: true }, { mode: undefined, mirror: undefined },
    ]);
    expect(Object.keys(preview[0]!.races[2]!)).not.toContain("mode");
    await expect(parseScoreWorkbookBase64(await workbookBase64([["VideoName", "Position", "PlayerName", "TotalPoints"]], [
      ["Video", "Race", "Track", "Position", "Player", "Class"],
      ["Cup", 1, "Mario Kart Stadium", 1, "Ben", "50cc"],
      ["Cup", 1, "Mario Kart Stadium", 2, "Evan", "200cc"],
    ]))).rejects.toThrow(/andere Class/u);
    await expect(parseScoreWorkbookBase64(await workbookBase64([["VideoName", "Position", "PlayerName", "TotalPoints"]], [
      ["Video", "Race", "Track", "Position", "Player", "Class"],
      ["Cup", 1, "Mario Kart Stadium", 1, "Ben", "75cc"],
    ]))).rejects.toThrow(/onbekende Class/u);
  });

  it("carries an empty Track as the placeholder so the race can be named, not refused", async () => {
    const preview = await parseScoreWorkbookBase64(await workbookBase64([
      ["VideoName", "Position", "PlayerName", "TotalPoints"],
      ["Qualifier A", 1, "Ben", 27],
      ["Qualifier A", 2, "Evan", 24],
    ], [
      ["Video", "Race", "Track", "Position", "Player"],
      // The recording started after race 1's track card.
      ["Qualifier A", 1, "", 1, "Ben"],
      ["Qualifier A", 1, "", 2, "Evan"],
      ["Qualifier A", 2, "UNKNOWN", 1, "Evan"],
      ["Qualifier A", 2, "UNKNOWN", 2, "Ben"],
    ]));
    expect(preview[0]?.races.map((race) => race.trackName)).toEqual(["UNKNOWN", "UNKNOWN"]);
  });

  it("reports the first recorded race's prior totals when the recording started late", async () => {
    const preview = await parseScoreWorkbookBase64(await workbookBase64([
      ["VideoName", "Position", "PlayerName", "TotalPoints"],
      ["Qualifier B", 1, "Gideon", 57],
      ["Qualifier B", 2, "Dagmar", 24],
      ["Qualifier A", 1, "Ben", 27],
    ], [
      ["Video", "Race", "Track", "Position", "Player", "Race Points", "Total Before Race", "Total After Race"],
      ["Qualifier B", 3, "Big Blue", 2, "Dagmar", 12, 0, 12],
      ["Qualifier B", 3, "Big Blue", 1, "Gideon", 15, 30, 45],
      ["Qualifier B", 4, "Toad Harbour", 1, "Dagmar", 12, 12, 24],
      ["Qualifier B", 4, "Toad Harbour", 2, "Gideon", 12, 45, 57],
      ["Qualifier A", 1, "Mario Kart Stadium", 1, "Ben", 15, 0, 15],
      ["Qualifier A", 1, "Mario Kart Stadium", 2, "Evan", 12, 0, 12],
    ]));
    const byName = new Map(preview.map((video) => [video.videoName, video]));
    expect(byName.get("Qualifier B")?.carriedPoints).toEqual([{ playerName: "Gideon", points: 30 }]);
    expect(byName.get("Qualifier A")).not.toHaveProperty("carriedPoints");
  });

  it("rejects segment totals that disagree with TotalPoints", async () => {
    await expect(parseScoreWorkbookBase64(await workbookBase64([
      ["VideoName", "PlayerName", "TotalPoints", "Points Segment 1", "Points Segment 2"],
      ["Final A", "Ben", 90, 40, 42],
    ]))).rejects.toThrow("tellen niet op");
  });
});
