import ExcelJS from "exceljs";

import type { TournamentRaceMode } from "./race-result-validation.js";

export type ScoreWorkbookRow = Readonly<{
  playerName: string;
  totalPoints: number;
  position?: number;
  pointSegments: readonly number[];
  /** The character the workbook recorded, e.g. "Pink Yoshi". */
  character?: string;
  /** Its roster, e.g. "Yoshi": the base the colour belongs to. */
  characterRoster?: string;
}>;

export type ScoreWorkbookVideo = Readonly<{
  videoName: string;
  rows: readonly ScoreWorkbookRow[];
  races: readonly Readonly<{
    raceNumber: number;
    trackName: string;
    /** ADR-0217: the race's class from an optional Class column (50cc … 200cc, Mirror). */
    mode?: TournamentRaceMode;
    mirror?: true;
    finishOrder: readonly string[];
  }>[];
  /**
   * The first recorded race's prior totals, when the recording started after
   * race 1: points the races in this file do not contain.
   */
  carriedPoints?: readonly Readonly<{ playerName: string; points: number }>[];
}>;

/** What the extractors write as Track for a race without a readable track card. */
export const WORKBOOK_TRACK_PLACEHOLDER = "UNKNOWN";

function text(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) { return ""; }
  if (typeof value === "object") {
    if ("result" in value) { return text(value.result as ExcelJS.CellValue); }
    if ("richText" in value) { return value.richText.map((entry) => entry.text).join("").trim(); }
    if ("text" in value && typeof value.text === "string") { return value.text.trim(); }
  }
  return String(value).trim();
}

type RaceClass = Readonly<{ mode: TournamentRaceMode; mirror?: true }>;

/** A Class cell ("50cc", "100", "200 cc", "Mirror"); undefined when empty. */
function raceClass(value: string, rowNumber: number): RaceClass | undefined {
  const cell = value.toLowerCase().replace(/\s+/gu, "");
  if (cell === "") { return undefined; }
  if (cell === "mirror" || cell === "spiegel") { return { mode: 150, mirror: true }; }
  const match = /^(50|100|150|200)(cc)?$/u.exec(cell);
  if (match === null) { throw new RangeError(`Results rij ${rowNumber} heeft een onbekende Class ("${value}").`); }
  return { mode: Number(match[1]) as TournamentRaceMode };
}

function sameClass(left: RaceClass | undefined, right: RaceClass | undefined): boolean {
  return left?.mode === right?.mode && left?.mirror === right?.mirror;
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("nl-NL");
}

function integer(value: string, label: string): number {
  // A Dutch spreadsheet may hand over "38,0" as text; the comma is the same
  // decimal point. A real fraction still fails, as it must.
  const parsed = Number(value.replace(/\s/gu, "").replace(",", "."));
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10000) {
    throw new RangeError(`${label} is geen geldig geheel puntenaantal ("${value}").`);
  }
  return parsed;
}

export async function parseScoreWorkbookBase64(workbookBase64: string): Promise<readonly ScoreWorkbookVideo[]> {
  const encoded = workbookBase64.replace(/^data:[^;]+;base64,/u, "").trim();
  if (encoded.length === 0 || encoded.length > 14_000_000) { throw new RangeError("Excel-bestand ontbreekt of is te groot."); }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0 || bytes.length > 10_000_000) { throw new RangeError("Excel-bestand ontbreekt of is te groot."); }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
  const results = workbook.worksheets.find((candidate) => normalized(candidate.name) === "results");
  const racesByVideo = new Map<string, ScoreWorkbookVideo["races"]>();
  const carriedByVideo = new Map<string, NonNullable<ScoreWorkbookVideo["carriedPoints"]>>();
  if (results !== undefined) {
    const resultHeaders = new Map<string, number>();
    results.getRow(1).eachCell({ includeEmpty: false }, (cell, column) => {
      const label = text(cell.value);
      if (label !== "") { resultHeaders.set(normalized(label), column); }
    });
    const video = resultHeaders.get("video");
    const race = resultHeaders.get("race");
    const track = resultHeaders.get("track");
    const position = resultHeaders.get("position");
    const player = resultHeaders.get("player");
    const totalBefore = resultHeaders.get("total before race");
    const classColumn = resultHeaders.get("class");
    if ([video, race, track, position, player].every((column) => column !== undefined)) {
      const grouped = new Map<string, { trackName: string; raceClass?: RaceClass; placements: { position: number; playerName: string; totalBefore: number }[] }>();
      for (let rowNumber = 2; rowNumber <= results.rowCount; rowNumber += 1) {
        const row = results.getRow(rowNumber);
        const videoName = text(row.getCell(video!).value);
        const playerName = text(row.getCell(player!).value);
        const rawRace = text(row.getCell(race!).value);
        const rawPosition = text(row.getCell(position!).value);
        // An empty Track is the extractor's "no track card" case: carry the
        // placeholder so the Director is told which race still needs it.
        const trackName = text(row.getCell(track!).value) || WORKBOOK_TRACK_PLACEHOLDER;
        if (videoName === "" && playerName === "" && rawRace === "" && rawPosition === "") { continue; }
        const raceNumber = Number(rawRace);
        const finishPosition = Number(rawPosition);
        if (videoName === "" || playerName === "" || !Number.isInteger(raceNumber) || raceNumber < 1 || raceNumber > 64 ||
            !Number.isInteger(finishPosition) || finishPosition < 1 || finishPosition > 12) {
          throw new RangeError(`Results rij ${rowNumber} mist een geldige Video, Race, Position of Player.`);
        }
        const key = `${videoName}\u0000${raceNumber}`;
        const rowClass = classColumn === undefined ? undefined : raceClass(text(row.getCell(classColumn).value), rowNumber);
        const entry = grouped.get(key) ?? {
          trackName, ...(rowClass === undefined ? {} : { raceClass: rowClass }), placements: [],
        };
        if (normalized(entry.trackName) !== normalized(trackName)) {
          throw new RangeError(`Results rij ${rowNumber} gebruikt binnen dezelfde race een andere Track.`);
        }
        if (!sameClass(entry.raceClass, rowClass)) {
          throw new RangeError(`Results rij ${rowNumber} gebruikt binnen dezelfde race een andere Class.`);
        }
        if (entry.placements.some((placement) => placement.position === finishPosition ||
            normalized(placement.playerName) === normalized(playerName))) {
          throw new RangeError(`Results rij ${rowNumber} bevat een dubbele positie of speler.`);
        }
        const before = totalBefore === undefined ? 0 : Number(text(row.getCell(totalBefore).value));
        entry.placements.push({
          position: finishPosition, playerName,
          totalBefore: Number.isInteger(before) && before > 0 && before <= 10000 ? before : 0,
        });
        grouped.set(key, entry);
      }
      const mutable = new Map<string, { raceNumber: number; trackName: string; mode?: TournamentRaceMode; mirror?: true; finishOrder: string[] }[]>();
      const firstRace = new Map<string, { raceNumber: number; carried: { playerName: string; points: number }[] }>();
      for (const [key, entry] of grouped) {
        const split = key.lastIndexOf("\u0000");
        const videoName = key.slice(0, split);
        const raceNumber = Number(key.slice(split + 1));
        const placements = entry.placements.sort((left, right) => left.position - right.position);
        if (placements.some((placement, index) => placement.position !== index + 1)) {
          throw new RangeError(`Results voor ${videoName} race ${raceNumber} bevat geen aaneengesloten posities.`);
        }
        const finishOrder = placements.map((placement) => placement.playerName);
        if (finishOrder.length < 2) { continue; }
        const rows = mutable.get(videoName) ?? [];
        rows.push({ raceNumber, trackName: entry.trackName, ...(entry.raceClass ?? {}), finishOrder });
        mutable.set(videoName, rows);
        const first = firstRace.get(videoName);
        if (first === undefined || raceNumber < first.raceNumber) {
          firstRace.set(videoName, {
            raceNumber,
            carried: placements.map((placement) => ({ playerName: placement.playerName, points: placement.totalBefore })),
          });
        }
      }
      for (const [videoName, races] of mutable) {
        racesByVideo.set(normalized(videoName), races.sort((left, right) => left.raceNumber - right.raceNumber));
        const carried = firstRace.get(videoName)?.carried.filter((entry) => entry.points > 0) ?? [];
        if (carried.length > 0) { carriedByVideo.set(normalized(videoName), carried); }
      }
    }
  }
  const sheet = workbook.worksheets.find((candidate) => normalized(candidate.name) === "final standings");
  if (sheet === undefined) { throw new RangeError('Tabblad "Final Standings" ontbreekt.'); }
  if (sheet.rowCount < 2 || sheet.rowCount > 1000 || sheet.columnCount > 64) {
    throw new RangeError('Tabblad "Final Standings" bevat geen geldig aantal rijen of kolommen.');
  }

  const headers = new Map<string, number>();
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, column) => {
    const label = text(cell.value);
    if (label !== "") { headers.set(normalized(label), column); }
  });
  const videoColumn = headers.get("videoname");
  const playerColumn = headers.get("playername");
  const totalColumn = headers.get("totalpoints");
  if (videoColumn === undefined || playerColumn === undefined || totalColumn === undefined) {
    throw new RangeError('Tabblad "Final Standings" mist VideoName, PlayerName of TotalPoints.');
  }
  const positionColumn = headers.get("position");
  // Tournament Live and the recorded Processor both write which character a
  // Player drove; the community's report prints that picture beside the name.
  const characterColumn = headers.get("character");
  const rosterColumn = headers.get("characterrostername") ?? headers.get("characterroster");
  const segmentColumns = [...headers.entries()]
    .map(([header, column]) => ({ match: /^points?\s+segment\s+(\d+)$/iu.exec(header), column }))
    .filter((entry): entry is { match: RegExpExecArray; column: number } => entry.match !== null)
    .map((entry) => ({ segment: Number(entry.match[1]), column: entry.column }))
    .filter((entry) => entry.segment >= 1 && entry.segment <= 4)
    .sort((left, right) => left.segment - right.segment);

  const videos = new Map<string, ScoreWorkbookRow[]>();
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const videoName = text(row.getCell(videoColumn).value);
    const playerName = text(row.getCell(playerColumn).value);
    const rawTotal = text(row.getCell(totalColumn).value);
    if (videoName === "" && playerName === "" && rawTotal === "") { continue; }
    if (videoName === "" || playerName === "" || rawTotal === "") {
      throw new RangeError(`Final Standings rij ${rowNumber} mist VideoName, PlayerName of TotalPoints.`);
    }
    const totalPoints = integer(rawTotal, `Final Standings rij ${rowNumber} TotalPoints`);
    const rawSegments = segmentColumns.map((entry) => ({
      entry,
      raw: text(row.getCell(entry.column).value),
    }));
    // The original export keeps shared Points Segment columns even for groups
    // that had no communication error. An entirely blank row therefore means
    // one undivided total, not zero points in every workbook-wide segment.
    const pointSegments = rawSegments.every(({ raw }) => raw === "")
      ? []
      : rawSegments.map(({ entry, raw }) => raw === ""
        ? 0
        : integer(raw, `Final Standings rij ${rowNumber} Points Segment ${entry.segment}`));
    if (pointSegments.length > 0 && pointSegments.reduce((sum, value) => sum + value, 0) !== totalPoints) {
      throw new RangeError(`Final Standings rij ${rowNumber}: scoredelen tellen niet op tot TotalPoints.`);
    }
    const rawPosition = positionColumn === undefined ? "" : text(row.getCell(positionColumn).value);
    const position = rawPosition === "" ? undefined : integer(rawPosition, `Final Standings rij ${rowNumber} Position`);
    const key = videoName;
    const videoRows = videos.get(key) ?? [];
    if (videoRows.some((candidate) => normalized(candidate.playerName) === normalized(playerName))) {
      throw new RangeError(`Final Standings bevat speler "${playerName}" dubbel voor "${videoName}".`);
    }
    const character = characterColumn === undefined ? "" : text(row.getCell(characterColumn).value);
    const roster = rosterColumn === undefined ? "" : text(row.getCell(rosterColumn).value);
    videoRows.push({
      playerName, totalPoints, ...(position === undefined ? {} : { position }), pointSegments,
      ...(character === "" ? {} : { character: character.slice(0, 64) }),
      ...(roster === "" ? {} : { characterRoster: roster.slice(0, 64) }),
    });
    videos.set(key, videoRows);
  }
  if (videos.size === 0) { throw new RangeError('Tabblad "Final Standings" bevat geen importeerbare data.'); }
  return [...videos.entries()].sort(([left], [right]) => left.localeCompare(right, "nl", { numeric: true }))
    .map(([videoName, rows]) => {
      const carriedPoints = carriedByVideo.get(normalized(videoName));
      return { videoName, rows, races: racesByVideo.get(normalized(videoName)) ?? [], ...(carriedPoints === undefined ? {} : { carriedPoints }) };
    });
}
