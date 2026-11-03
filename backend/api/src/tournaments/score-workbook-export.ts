import ExcelJS from "exceljs";

import type { TournamentDocument } from "./tournament-operation-service.js";

export type ScoreWorkbookExport = Readonly<{
  fileName: string;
  mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  workbookBase64: string;
}>;

const MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const;

function safeName(value: string): string {
  const normalized = value.normalize("NFKD").replace(/[^A-Za-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "").slice(0, 80);
  return normalized === "" ? "Tournament_Results" : normalized;
}

export async function buildScoreWorkbook(
  document: TournamentDocument,
  step: 5 | 6 | 9 | 10,
  trackLabels: readonly Readonly<{ trackId: string; displayName: string; cupName?: string }>[],
): Promise<ScoreWorkbookExport> {
  const stage = step <= 6 ? "qualifier" : "final";
  const labels = new Map(trackLabels.map((track) => [track.trackId, track.displayName]));
  // The Cup column existed from the start and was never filled: the console
  // sent the track's name but not its cup, so every row read empty while the
  // Seating & Standings Manager's own workbook names the cup (owner, 2026-09-15).
  const cups = new Map(trackLabels.flatMap((track) =>
    track.cupName === undefined || track.cupName === "" ? [] : [[track.trackId, track.cupName] as const]));
  const groups = document.groups.filter((group) => group.stage === stage)
    .sort((left, right) => left.sequence - right.sequence);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MK8DX Ecosystem";
  workbook.created = new Date(document.summary.startAtMs ?? document.summary.updatedAtMs);

  const results = workbook.addWorksheet("Results", { views: [{ state: "frozen", ySplit: 1 }] });
  // "Character" and "Character Roster" sit where the original workbook puts
  // them, right after the Player, so the two files read the same way.
  results.addRow([
    "Video", "Race", "Track", "Cup", "Position", "Player",
    "Character", "Character Roster", "Race Points",
    "Total Points (Cumulative)", "Total Points (Final)", "Race Voided", "Scoring Notes",
  ]);
  for (const group of groups) {
    const cumulative = new Map<string, number>();
    const finalPoints = new Map(group.standings.rows.map((row) => [row.playerId, row.points]));
    const characters = new Map(group.members.map((member) => [member.playerId, member.character]));
    for (const race of [...group.races].sort((left, right) => left.raceNumber - right.raceNumber)) {
      for (const placement of [...race.placements].sort((left, right) => left.finishPosition - right.finishPosition)) {
        const total = (cumulative.get(placement.playerId) ?? 0) +
          (race.countsTowardStandings ? placement.racePoints : 0);
        cumulative.set(placement.playerId, total);
        const character = characters.get(placement.playerId);
        results.addRow([
          group.name, race.raceNumber, labels.get(race.trackId) ?? race.trackId,
          cups.get(race.trackId) ?? "",
          placement.finishPosition, placement.displayName,
          character?.label ?? "", character?.roster ?? "",
          placement.racePoints, total,
          finalPoints.get(placement.playerId) ?? total,
          race.countsTowardStandings ? "" : "TRUE", race.scoringNote ?? "",
        ]);
      }
    }
  }

  const standings = workbook.addWorksheet("Final Standings", { views: [{ state: "frozen", ySplit: 1 }] });
  // "Character" and "CharacterRosterName" are the columns the import reads
  // (Tournament Live and the Processor write them); without them a Step 5/9
  // export re-imported at Step 5/9 lost every character (owner, 2026-09-15).
  standings.addRow([
    "Position", "VideoName", "PlayerName", "TotalPoints", "Wins", "Best Race", "Races Played",
    "Character", "CharacterRosterName",
    "Points Segment 1", "Points Segment 2", "Points Segment 3", "Points Segment 4",
  ]);
  for (const group of groups) {
    const characters = new Map(group.members.map((member) => [member.playerId, member.character]));
    for (const row of [...group.standings.rows].sort((left, right) => left.rank - right.rank)) {
      const segments = group.manualScores.find((score) => score.playerId === row.playerId)?.segmentPoints ?? [];
      const character = characters.get(row.playerId);
      standings.addRow([
        row.rank, group.name, row.displayName, row.points, row.wins, row.bestRace, row.races,
        character?.label ?? "", character?.roster ?? "",
        ...Array.from({ length: 4 }, (_, index) => segments[index] ?? ""),
      ]);
    }
  }

  for (const sheet of [results, standings]) {
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D6F42" } };
    header.alignment = { vertical: "middle" };
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
    sheet.columns.forEach((column) => { column.width = Math.min(34, Math.max(12, column.header?.toString().length ?? 12)); });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    fileName: `${safeName(document.summary.name)}-stap-${step}.xlsx`,
    mediaType: MEDIA_TYPE,
    workbookBase64: Buffer.from(buffer).toString("base64"),
  };
}
