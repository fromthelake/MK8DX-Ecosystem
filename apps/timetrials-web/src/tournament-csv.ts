// Reading and writing the Tournament's own CSV files.
//
// The files travel between a Dutch Excel (which writes and expects `;`), an
// English Excel (`,`), Google Sheets, the phone and this site, so a reader
// accepts any of them and a writer says which one it used. Headers and
// values are accepted in Dutch and in English: `Naam` or `Name`, `Aanwezig`
// or `Present`, `ja` or `yes`.

import { localized } from "./product-language.js";

export type CsvRecord = Readonly<Record<string, string>>;

const DELIMITERS = [";", ",", "\t"] as const;

/** The delimiter a header line uses: the one that appears most, outside quotes. */
export function csvDelimiter(headerLine: string): string {
  const counts = new Map<string, number>(DELIMITERS.map((candidate) => [candidate, 0]));
  let quoted = false;
  for (const character of headerLine) {
    if (character === '"') { quoted = !quoted; continue; }
    if (quoted) { continue; }
    const seen = counts.get(character);
    if (seen !== undefined) { counts.set(character, seen + 1); }
  }
  const tabs = counts.get("\t") ?? 0;
  const semicolons = counts.get(";") ?? 0;
  const commas = counts.get(",") ?? 0;
  if (tabs > semicolons && tabs > commas) { return "\t"; }
  if (commas > semicolons) { return ","; }
  return ";";
}

/**
 * Every row of a CSV as a record keyed by its header. Handles the byte-order
 * mark Excel writes, the `sep=;` line it sometimes writes in front, quoted
 * fields with embedded delimiters and newlines, and CRLF or LF endings.
 */
export function csvRecords(value: string): readonly CsvRecord[] {
  const withoutBom = value.replace(/^﻿/u, "");
  // Excel's own delimiter hint: `sep=;` on the first line. It is a hint for
  // Excel, not data, and the delimiter it names wins.
  const hint = /^sep=(.)\r?\n/iu.exec(withoutBom);
  const body = hint === null ? withoutBom : withoutBom.slice(hint[0].length);
  const firstBreak = body.search(/\r|\n/u);
  const headerLine = firstBreak < 0 ? body : body.slice(0, firstBreak);
  const delimiter = hint?.[1] ?? csvDelimiter(headerLine);
  const rows: string[][] = [];
  let fields: string[] = [];
  let fieldValue = "";
  let quoted = false;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]!;
    if (character === '"') {
      if (quoted && body[index + 1] === '"') { fieldValue += '"'; index += 1; }
      else { quoted = !quoted; }
    } else if (character === delimiter && !quoted) {
      fields.push(fieldValue.trim()); fieldValue = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && body[index + 1] === "\n") { index += 1; }
      fields.push(fieldValue.trim()); fieldValue = "";
      if (fields.some((field) => field.length > 0)) { rows.push(fields); }
      fields = [];
    } else { fieldValue += character; }
  }
  fields.push(fieldValue.trim());
  if (fields.some((field) => field.length > 0)) { rows.push(fields); }
  const headers = rows.shift()?.map((header) => header.replace(/^﻿/u, "")) ?? [];
  if (headers.length === 0 || headers.some((header) => header.length === 0)) { return []; }
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

const headerKey = (value: string): string => value
  .replace(/^﻿/u, "").normalize("NFKD").replace(/\p{M}/gu, "")
  .toLowerCase().replace(/[^a-z0-9]/gu, "");

/** The value of the first column whose header matches one of these names. */
export function csvValue(record: CsvRecord, names: readonly string[]): string | undefined {
  const wanted = new Set(names.map(headerKey));
  for (const [header, value] of Object.entries(record)) {
    if (wanted.has(headerKey(header))) { return value; }
  }
  return undefined;
}

/** True when every one of these column groups is present in the record. */
export function csvHasColumns(record: CsvRecord, groups: readonly (readonly string[])[]): boolean {
  return groups.every((names) => csvValue(record, names) !== undefined);
}

// The column names a file may use, Dutch first because that is what the
// Manager and the phone write.
export const ROSTER_COLUMNS = {
  name: ["Naam", "Name", "Speler", "Player", "Deelnemer", "Participant"],
  status: ["Status", "Aanwezigheid", "Attendance"],
  switch1: ["NS1", "Switch 1", "Nintendo Switch 1"],
  switch2: ["NS2", "Switch 2", "Nintendo Switch 2"],
} as const;

export const LAYOUT_COLUMNS = {
  owner: ["Switcheigenaar", "Switch owner", "Owner", "Eigenaar"],
  console: ["Console", "Switch", "Type"],
  first: ["Deelnemer 1", "Participant 1", "Player 1", "Speler 1"],
  second: ["Deelnemer 2", "Participant 2", "Player 2", "Speler 2"],
  group: ["Groep", "Group", "Poule"],
} as const;

// What a cell may say. These lists are also what the page shows the operator
// when a cell says something else, so they are the single answer to "what is
// allowed here?".
export const ATTENDANCE_PRESENT_WORDS = ["Aanwezig", "Present", "A", "ja", "yes", "x", "1"] as const;
export const ATTENDANCE_WAITING_WORDS = ["Wachtlijst", "Waiting", "Waiting list", "Reserve", "W"] as const;
export const ATTENDANCE_ABSENT_WORDS = ["Afwezig", "Absent", "nee", "no", "0", "(leeg)"] as const;
export const BOOLEAN_TRUE_WORDS = ["ja", "j", "yes", "y", "true", "waar", "1", "x"] as const;
export const BOOLEAN_FALSE_WORDS = ["nee", "n", "no", "false", "onwaar", "0", "(leeg)"] as const;
export const CONSOLE_WORDS = ["NS1", "NS2", "1", "2", "Switch 1", "Switch 2"] as const;

const lower = (values: readonly string[]): readonly string[] => values.map((value) => value.toLocaleLowerCase("nl"));

/** The attendance a cell states, or null when it states something else. */
export function csvAttendanceOrNull(value: string | undefined): "present" | "waiting" | "absent" | null {
  const text = (value ?? "").trim().toLocaleLowerCase("nl");
  if (text.length === 0) { return "absent"; }
  if (lower(ATTENDANCE_PRESENT_WORDS).includes(text)) { return "present"; }
  if (lower(ATTENDANCE_WAITING_WORDS).includes(text)) { return "waiting"; }
  if (lower(ATTENDANCE_ABSENT_WORDS).includes(text)) { return "absent"; }
  return null;
}

/** `Aanwezig`, `Present`, `A`; `Wachtlijst`, `Waiting`; anything else is absent. */
export function csvAttendance(value: string | undefined): "present" | "waiting" | "absent" {
  return csvAttendanceOrNull(value) ?? "absent";
}

/** The yes or no a cell states, or null when it states something else. */
export function csvBooleanOrNull(value: string | undefined): boolean | null {
  const text = (value ?? "").trim().toLocaleLowerCase("nl");
  if (text.length === 0) { return false; }
  if (lower(BOOLEAN_TRUE_WORDS).includes(text)) { return true; }
  if (lower(BOOLEAN_FALSE_WORDS).includes(text)) { return false; }
  return null;
}

/** `ja`, `j`, `yes`, `y`, `true`, `waar`, `1`, `x` - anything else is false. */
export function csvBoolean(value: string | undefined): boolean {
  return csvBooleanOrNull(value) === true;
}

/** The console a cell names, or null when it names something else. */
export function csvSwitchTypeOrNull(value: string | undefined): "ns1" | "ns2" | null {
  const text = (value ?? "").trim().toLocaleLowerCase("nl").replace(/[^a-z0-9]/gu, "");
  if (["ns1", "nintendoswitch1", "switch1", "1"].includes(text)) { return "ns1"; }
  if (["ns2", "nintendoswitch2", "switch2", "2"].includes(text)) { return "ns2"; }
  return null;
}

/** One thing wrong with one cell, named the way the operator's sheet names it. */
export type CsvIssue = Readonly<{
  /** The row number in the spreadsheet; the header is row 1. */
  row: number;
  column: string;
  value: string;
  problem: string;
  allowed?: readonly string[];
}>;

/** The columns a file must carry, each with the names it may use. */
export function csvMissingColumns(
  record: CsvRecord,
  columns: readonly Readonly<{ label: string; names: readonly string[] }>[],
): readonly Readonly<{ label: string; names: readonly string[] }>[] {
  return columns.filter((column) => csvValue(record, column.names) === undefined);
}

/**
 * The delimiter this visitor's spreadsheet expects: a Dutch Excel splits on
 * `;`, an English one on `,`. Every reader here takes both, so the choice
 * only decides which one opens without a wizard.
 */
export function csvWriteDelimiter(): string {
  return localized("en", "nl") === "nl" ? ";" : ",";
}

/** One CSV file: a byte-order mark so Excel keeps the accents, CRLF rows. */
export function csvDocument(rows: readonly (readonly string[])[], delimiter = csvWriteDelimiter()): string {
  const quote = (value: string): string =>
    new RegExp(`[${delimiter === "\t" ? "\\t" : delimiter}"\r\n]`, "u").test(value)
      ? `"${value.replaceAll('"', '""')}"`
      : value;
  return `﻿${rows.map((row) => row.map(quote).join(delimiter)).join("\r\n")}\r\n`;
}
