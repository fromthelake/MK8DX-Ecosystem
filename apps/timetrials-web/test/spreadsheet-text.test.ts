import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { setProductLanguage } from "../src/product-language.js";
import { csvLiteralText, csvImportedText } from "../src/spreadsheet-text.js";
import { csvDocument, csvRecords, csvValue, LAYOUT_COLUMNS, ROSTER_COLUMNS } from "../src/tournament-csv.js";
import {
  seatingCsv,
  standingsCsv,
  tournamentGroupLayoutCsv,
  tournamentLayoutFile,
  tournamentRosterCsv,
  tournamentRosterFileRows,
} from "../src/tournament-operation-view.js";

type Vectors = {
  cases: { value: string; csv: string }[];
  importOnlyCases: { csv: string; value: string }[];
  documentCases: { delimiter: string; cells: string[]; line: string }[];
};

// The one vector file Web, Android and Python share.
const vectors = JSON.parse(readFileSync(
  new URL("../../../packages/domain/policies/spreadsheet-text-v1.json", import.meta.url), "utf8")) as Vectors;
// Roster names: trimmed and distinct by the import's name key, so the import accepts them all.
const names = ["=1+1", "@Sander", "-Zoë", "+Сергей", "'=マリオ", "\uFF1D김민준", "'t Hoofd", "李雷", "-5", "مريم", "🍄Toad"];

const inLanguage = (language: "nl" | "en"): void => {
  vi.stubGlobal("localStorage", { getItem: () => language, setItem: () => undefined });
  setProductLanguage(language);
};

afterEach(() => {
  vi.unstubAllGlobals();
  setProductLanguage("en");
});

describe("text in a CSV export stays text in a spreadsheet", () => {
  it("follows every shared vector, both ways", () => {
    for (const { value, csv } of vectors.cases) {
      expect(csvLiteralText(value), JSON.stringify(value)).toBe(csv);
      expect(csvImportedText(csv), JSON.stringify(csv)).toBe(value);
    }
    for (const { csv, value } of vectors.importOnlyCases) {
      expect(csvImportedText(csv), JSON.stringify(csv)).toBe(value);
    }
  });

  it("writes the exact bytes of the shared document vectors for ; , and tab", () => {
    for (const { delimiter, cells, line } of vectors.documentCases) {
      expect(csvDocument([cells], delimiter)).toBe(`﻿${line}\r\n`);
      const [record] = csvRecords(`h1${delimiter}h2${delimiter}h3${delimiter}h4\r\n${line}\r\n`);
      expect(Object.values(record ?? {}).slice(0, cells.length)).toEqual(cells);
    }
  });

  it("never lets a formula-like name start a cell of the roster export", () => {
    inLanguage("nl");
    const participants = names.map((displayName, index) => ({
      playerId: `player.${index}`, username: `p${index}`, displayName,
      attendance: "present", hasSwitch1: false, hasSwitch2: false, inactive: false,
    }));
    const text = tournamentRosterCsv(participants as never);
    const cells = text.slice(1).split("\r\n").slice(1, -1).map((line) => line.replace(/^"/u, ""));
    expect(cells.length).toBe(names.length);
    for (const cell of cells.filter((line) => !/^[+-]?[0-9]+(?:[.,][0-9]+)?;/u.test(line))) {
      expect(cell, cell).not.toMatch(/^[ \u00A0\u3000]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20\t\r\n]/u);
    }
    // ... and the roster import reads back the real names, not new ones.
    const imported = tournamentRosterFileRows(text)?.map((row) => row.displayName) ?? [];
    expect([...imported].sort()).toEqual([...names].sort());
  });

  it("round-trips the layout export through the layout import in both languages", () => {
    for (const language of ["nl", "en"] as const) {
      inLanguage(language);
      const station = (ownerPlayerId: string, ownerDisplayName: string, seatNumber: 1 | 2) =>
        ({ ownerPlayerId, ownerDisplayName, switchType: "ns1", seatNumber });
      const groups = [{
        name: "=Groep A",
        members: [
          { playerId: "p1", displayName: "=1+1", station: station("p1", "=1+1", 1) },
          { playerId: "p2", displayName: "@Sander", station: station("p1", "=1+1", 2) },
          { playerId: "p3", displayName: "-Zoë" },
        ],
      }];
      const text = tournamentGroupLayoutCsv(groups as never);
      expect(text).toContain("'=1+1");
      expect(text).not.toMatch(/(^|[;,\r\n])=/u);
      const records = csvRecords(text);
      expect(records.map((record) => csvValue(record, LAYOUT_COLUMNS.first))).toEqual(["=1+1", "-Zoë"]);
      expect(records.map((record) => csvValue(record, LAYOUT_COLUMNS.owner))).toEqual(["=1+1", ""]);
      expect(records.map((record) => csvValue(record, LAYOUT_COLUMNS.group))).toEqual(["=Groep A", "=Groep A"]);
      const layout = tournamentLayoutFile(text);
      expect(JSON.stringify(layout)).not.toContain("'=");
    }
  });

  it("keeps real numbers numeric in the standings and seating exports", () => {
    inLanguage("en");
    const document_ = {
      groups: [{
        stage: "qualifier", name: "A", sequence: 1,
        members: [{ playerId: "p1", displayName: "=1+1", station: { ownerPlayerId: "p1", ownerDisplayName: "+Owner", switchType: "ns2", seatNumber: 1 } }],
        standings: { rows: [{ playerId: "p1", displayName: "=1+1", rank: 1, points: 38, races: 4, wins: 1 }] },
      }],
    };
    const standings = standingsCsv(document_ as never).slice(1).split("\r\n")[1]!;
    expect(standings.split(",").slice(3)).toEqual(["'=1+1", "38", "4", "1"]);
    const seating = seatingCsv(document_ as never, "qualifier" as never).slice(1).split("\r\n")[1]!;
    expect(seating.split(",").slice(2)).toEqual(["'+Owner", "NS2", "1", "'=1+1"]);
  });

  it("reads a roster name a person protected by hand the way the export does", () => {
    const rows = tournamentRosterFileRows("Naam;Status;NS1;NS2\r\n'=1+1;Aanwezig;ja;nee\r\n'Sander;Aanwezig;nee;nee\r\n");
    expect(rows?.map((row) => row.displayName)).toEqual(["=1+1", "'Sander"]);
    expect(csvValue(csvRecords("Naam\r\n'@x\r\n")[0]!, ROSTER_COLUMNS.name)).toBe("@x");
  });
});
