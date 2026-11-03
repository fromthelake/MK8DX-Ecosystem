import { describe, expect, it } from "vitest";

import { semicolonRecords, tournamentLayoutImportPlan } from "../src/tournament-operation-view.js";

describe("historical Tournament CSV", () => {
  it("reads the preserved semicolon layout and quoted names without changing the source", () => {
    expect(semicolonRecords([
      "Switcheigenaar;Console;Deelnemer 1;Deelnemer 2;Groep",
      "Evan;NS1;Evan;Merle;Groep 1",
      'Mal;NS1;"Mal; met C";Sigismunda;Groep 3',
      "",
    ].join("\r\n"))).toEqual([
      { Switcheigenaar: "Evan", Console: "NS1", "Deelnemer 1": "Evan", "Deelnemer 2": "Merle", Groep: "Groep 1" },
      { Switcheigenaar: "Mal", Console: "NS1", "Deelnemer 1": "Mal; met C", "Deelnemer 2": "Sigismunda", Groep: "Groep 3" },
    ]);
  });

  it("reads the participant attendance columns with a UTF-8 BOM", () => {
    expect(semicolonRecords("\uFEFFNaam;Status;NS1;NS2\nAlvar;Aanwezig;Ja;nee\n"))
      .toEqual([{ Naam: "Alvar", Status: "Aanwezig", NS1: "Ja", NS2: "nee" }]);
  });

  it("preserves the source final-layout case where a Switch owner is not seated on that Switch", () => {
    expect(semicolonRecords([
      "Switcheigenaar;Console;Deelnemer 1;Deelnemer 2;Groep",
      "Malo;NS1;Brynn;Noah;Talent",
      "Brynn;NS1;Malo;Werner;Wild",
    ].join("\n"))).toEqual([
      { Switcheigenaar: "Malo", Console: "NS1", "Deelnemer 1": "Brynn", "Deelnemer 2": "Noah", Groep: "Talent" },
      { Switcheigenaar: "Brynn", Console: "NS1", "Deelnemer 1": "Malo", "Deelnemer 2": "Werner", Groep: "Wild" },
    ]);
  });

  it("plans a layout with a half-filled console and an unseated member, as the APK reads it", () => {
    const participants = new Map([["evan", "player.evan"], ["merle", "player.merle"], ["nova", "player.nova"], ["ben", "player.ben"]]);
    const groups = [{ name: "Groep 1" }, { name: "Groep 2" }];
    const records = semicolonRecords([
      "Switcheigenaar;Console;Deelnemer 1;Deelnemer 2;Groep",
      "Evan;NS1;Evan;Merle;Groep 1",
      "Ben;NS2;Ben;;Groep 2",
      ";;Nova;;Groep 2",
      "",
    ].join("\r\n"));
    const plan = tournamentLayoutImportPlan(records, participants, groups);
    expect(plan).toEqual({
      rows: 3,
      groups: [
        { name: "Groep 1", seats: [
          { playerId: "player.evan", stationOwnerPlayerId: "player.evan", switchType: "ns1", seatNumber: 1 },
          { playerId: "player.merle", stationOwnerPlayerId: "player.evan", switchType: "ns1", seatNumber: 2 },
        ] },
        { name: "Groep 2", seats: [
          { playerId: "player.ben", stationOwnerPlayerId: "player.ben", switchType: "ns2", seatNumber: 1 },
          { playerId: "player.nova", stationOwnerPlayerId: null, switchType: null, seatNumber: null },
        ] },
      ],
    });
    const refused = tournamentLayoutImportPlan(semicolonRecords([
      "Switcheigenaar;Console;Deelnemer 1;Deelnemer 2;Groep",
      "Evan;Wii;Evan;Evan;Groep 9",
      "",
    ].join("\r\n")), participants, groups);
    expect(refused).toEqual({ rejected: {
      unknownGroups: ["Groep 9"], unknownPlayers: [], invalidConsoles: ["Wii"], duplicatePlayers: ["Evan"],
    } });
  });
});
