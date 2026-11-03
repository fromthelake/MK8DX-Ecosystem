import { describe, expect, it, vi } from "vitest";

import { setProductLanguage } from "../src/product-language.js";
import {
  csvAttendance,
  csvBoolean,
  csvDelimiter,
  csvDocument,
  csvHasColumns,
  csvRecords,
  csvValue,
  LAYOUT_COLUMNS,
  ROSTER_COLUMNS,
} from "../src/tournament-csv.js";
import {
  tournamentCsvIssueLines,
  tournamentLayoutFile,
  tournamentRosterCsv,
  tournamentRosterFile,
  tournamentRosterFileRows,
} from "../src/tournament-operation-view.js";

const DUTCH_FILE = "Naam;Status;NS1;NS2\r\nGideon;Aanwezig;ja;nee\r\nMoss HM;Wachtlijst;nee;nee\r\nQuinnie;Afwezig;nee;nee\r\n";
const ENGLISH_FILE = "Name,Status,NS1,NS2\r\nGideon,Present,yes,no\r\nMoss HM,Waiting,no,no\r\nQuinnie,Absent,no,no\r\n";

describe("a Tournament CSV, in whichever shape it arrives", () => {
  it("finds the delimiter from the header, ignoring what is inside quotes", () => {
    expect(csvDelimiter("Naam;Status;NS1;NS2")).toBe(";");
    expect(csvDelimiter("Name,Status,NS1,NS2")).toBe(",");
    expect(csvDelimiter("Naam\tStatus\tNS1\tNS2")).toBe("\t");
    expect(csvDelimiter('"Naam, voluit";Status')).toBe(";");
    // A single column has no delimiter to find; the Dutch one is the default.
    expect(csvDelimiter("Naam")).toBe(";");
  });

  it("reads semicolons, commas, tabs, a byte-order mark and Excel's sep= line", () => {
    const rows = (text: string) => csvRecords(text).map((record) => csvValue(record, ROSTER_COLUMNS.name));
    expect(rows(DUTCH_FILE)).toEqual(["Gideon", "Moss HM", "Quinnie"]);
    expect(rows(ENGLISH_FILE)).toEqual(["Gideon", "Moss HM", "Quinnie"]);
    expect(rows("﻿" + DUTCH_FILE)).toEqual(["Gideon", "Moss HM", "Quinnie"]);
    expect(rows("sep=,\r\n" + ENGLISH_FILE)).toEqual(["Gideon", "Moss HM", "Quinnie"]);
    expect(rows("Naam\tStatus\tNS1\tNS2\nGideon\tAanwezig\tja\tnee\n")).toEqual(["Gideon"]);
  });

  it("keeps a quoted delimiter inside its own field", () => {
    const records = csvRecords('Naam;Status;NS1;NS2\r\n"Berg, Ben van der";Aanwezig;ja;nee\r\n');
    expect(csvValue(records[0]!, ROSTER_COLUMNS.name)).toBe("Berg, Ben van der");
  });

  it("matches a column by any of its Dutch or English names, ignoring case and spaces", () => {
    const [dutch] = csvRecords(DUTCH_FILE);
    const [english] = csvRecords(ENGLISH_FILE);
    expect(csvValue(dutch!, ROSTER_COLUMNS.name)).toBe("Gideon");
    expect(csvValue(english!, ROSTER_COLUMNS.name)).toBe("Gideon");
    expect(csvValue(csvRecords("SPELER;status;ns1;ns2\r\nBen;Aanwezig;ja;nee\r\n")[0]!, ROSTER_COLUMNS.name)).toBe("Ben");
    expect(csvHasColumns(dutch!, [ROSTER_COLUMNS.name, ROSTER_COLUMNS.status])).toBe(true);
    expect(csvHasColumns(dutch!, [LAYOUT_COLUMNS.group])).toBe(false);
  });

  it("reads attendance and the console columns in both languages", () => {
    expect(["Aanwezig", "present", "A", "ja"].map(csvAttendance)).toEqual(["present", "present", "present", "present"]);
    expect(["Wachtlijst", "waiting", "Reserve"].map(csvAttendance)).toEqual(["waiting", "waiting", "waiting"]);
    expect(["Afwezig", "absent", "", undefined].map(csvAttendance)).toEqual(["absent", "absent", "absent", "absent"]);
    expect(["ja", "Yes", "TRUE", "1", "x"].map(csvBoolean)).toEqual([true, true, true, true, true]);
    expect(["nee", "no", "", undefined].map(csvBoolean)).toEqual([false, false, false, false]);
  });

  it("reads the same roster from a Dutch and an English file", () => {
    const dutch = tournamentRosterFileRows(DUTCH_FILE);
    const english = tournamentRosterFileRows(ENGLISH_FILE);
    expect(dutch).toEqual(english);
    expect(dutch).toEqual([
      { row: 2, displayName: "Gideon", attendance: "present", hasSwitch1: true, hasSwitch2: false },
      { row: 3, displayName: "Moss HM", attendance: "waiting", hasSwitch1: false, hasSwitch2: false },
      { row: 4, displayName: "Quinnie", attendance: "absent", hasSwitch1: false, hasSwitch2: false },
    ]);
  });

  it("refuses a file that is not a roster", () => {
    expect(tournamentRosterFileRows("")).toBeNull();
    expect(tournamentRosterFileRows("Baan;Cup\r\nBaby Park;Shell\r\n")).toBeNull();
    expect(tournamentRosterFileRows("Naam;Status;NS1;NS2\r\n")).toBeNull();
  });

  it("writes a file with a byte-order mark, CRLF rows and the language's delimiter", () => {
    const previous = globalThis.localStorage;
    vi.stubGlobal("localStorage", { getItem: () => "nl", setItem: () => undefined });
    setProductLanguage("nl");
    const dutch = csvDocument([["Naam", "Status"], ["Berg; Ben", "Aanwezig"]]);
    expect(dutch).toBe('﻿Naam;Status\r\n"Berg; Ben";Aanwezig\r\n');
    vi.stubGlobal("localStorage", { getItem: () => "en", setItem: () => undefined });
    setProductLanguage("en");
    expect(csvDocument([["Name", "Status"], ["Ben, van der Berg", "Present"]]))
      .toBe('﻿Name,Status\r\n"Ben, van der Berg",Present\r\n');
    vi.stubGlobal("localStorage", previous);
    setProductLanguage("en");
  });

  it("writes a roster the reader reads back, in either language", () => {
    const previous = globalThis.localStorage;
    for (const language of ["nl", "en"] as const) {
      vi.stubGlobal("localStorage", { getItem: () => language, setItem: () => undefined });
      setProductLanguage(language);
      const text = tournamentRosterCsv([
        { playerId: "player.a", username: "gideon", displayName: "Gideon", attendance: "present", hasSwitch1: true, hasSwitch2: false, inactive: false },
        { playerId: "player.b", username: "quinnie", displayName: "Quinnie", attendance: "absent", hasSwitch1: false, hasSwitch2: false, inactive: false },
      ] as never);
      expect(text.startsWith("﻿")).toBe(true);
      expect(tournamentRosterFileRows(text)).toEqual([
        { row: 2, displayName: "Gideon", attendance: "present", hasSwitch1: true, hasSwitch2: false },
        { row: 3, displayName: "Quinnie", attendance: "absent", hasSwitch1: false, hasSwitch2: false },
      ]);
    }
    vi.stubGlobal("localStorage", previous);
    setProductLanguage("en");
  });
});

describe("what the import tells the operator when a file is wrong", () => {
  it("names the row, the column and what that column takes", () => {
    const report = tournamentRosterFile("Naam;Status;NS1;NS2\r\nGideon;Aanwezigg;ja;nee\r\nBen;Aanwezig;jaa;nee\r\n");
    expect(report.ok).toBe(false);
    if (report.ok) { return; }
    expect(report.issues).toEqual([
      { row: 2, column: "Status", value: "Aanwezigg", problem: "this is not an attendance.", allowed: expect.arrayContaining(["Aanwezig", "Present", "Wachtlijst", "Afwezig"]) },
      { row: 3, column: "NS1", value: "jaa", problem: "this is not a yes or a no.", allowed: expect.arrayContaining(["ja", "nee", "yes", "no"]) },
    ]);
    const lines = tournamentCsvIssueLines(report.issues);
    expect(lines[0]).toContain("Row 2, column Status");
    expect(lines[0]).toContain('"Aanwezigg"');
    expect(lines[0]).toContain("Allowed: Aanwezig");
  });

  it("names a missing column with the headers it accepts", () => {
    const report = tournamentRosterFile("Naam;NS1;NS2\r\nGideon;ja;nee\r\n");
    expect(report.ok).toBe(false);
    if (report.ok) { return; }
    expect(report.issues).toEqual([{
      row: 1, column: "Status", value: "", problem: "this column is missing.",
      allowed: ["Status", "Aanwezigheid", "Attendance"],
    }]);
  });

  it("names both rows when a Player appears twice", () => {
    const report = tournamentRosterFile("Naam;Status;NS1;NS2\r\nBen;Aanwezig;ja;nee\r\nben;Afwezig;nee;nee\r\n");
    expect(report.ok).toBe(false);
    if (report.ok) { return; }
    expect(report.issues[0]).toMatchObject({ row: 3, column: "Naam", value: "ben", problem: "this name is already on row 2." });
  });

  it("says an empty file has no rows rather than failing silently", () => {
    const report = tournamentRosterFile("");
    expect(report.ok).toBe(false);
    if (report.ok) { return; }
    expect(report.issues[0]!.problem).toContain("no rows were found");
    expect(tournamentRosterFileRows("")).toBeNull();
  });

  it("checks a layout file per row: the group, the console and the pair of seats", () => {
    const report = tournamentLayoutFile([
      "Switcheigenaar;Console;Deelnemer 1;Deelnemer 2;Groep",
      "Ben;NS3;Ben;Evan;Groep 1",
      "Nova;;Nova;;Groep 1",
      ";;Evan;;",
      ";NS1;;Valerio;Groep 1",
    ].join("\r\n"));
    expect(report.ok).toBe(false);
    if (report.ok) { return; }
    expect(report.issues.map((issue) => [issue.row, issue.column, issue.problem])).toEqual([
      [2, "Console", "this is not a console."],
      [3, "Console", "a row with a Switch owner needs its console."],
      [4, "Groep", "every row needs a group."],
      [5, "Switcheigenaar", "a row with a console needs its Switch owner."],
      [5, "Deelnemer 1", "seat 2 is filled while seat 1 is empty."],
    ]);
  });

  it("reads a good layout file in either language", () => {
    const dutch = tournamentLayoutFile("Switcheigenaar;Console;Deelnemer 1;Deelnemer 2;Groep\r\nBen;NS1;Ben;Evan;Groep 1\r\n");
    const english = tournamentLayoutFile("Switch owner,Console,Player 1,Player 2,Group\r\nBen,NS1,Ben,Evan,Groep 1\r\n");
    expect(dutch).toEqual(english);
    expect(dutch.ok && dutch.rows[0]).toEqual({
      "Switcheigenaar": "Ben", "Console": "NS1", "Deelnemer 1": "Ben", "Deelnemer 2": "Evan", "Groep": "Groep 1",
    });
  });
});
