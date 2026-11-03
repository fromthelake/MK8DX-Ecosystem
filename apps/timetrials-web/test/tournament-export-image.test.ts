import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { PublicTournamentEvent, TournamentDocument } from "../src/tournament-operation-client.js";
import {
  TOURNAMENT_EXPORT_MIN_TABLE_WIDTH,
  tournamentExportColumnWidths,
  tournamentExportDutchDate,
  tournamentExportFileName,
  tournamentExportStretchedWidths,
  tournamentExportMetric,
  tournamentExportMinimums,
  tournamentExportShareCaption,
  tournamentExportSourceFromDocument,
  tournamentExportSourceFromPublicEvent,
  tournamentLayoutImageModel,
  tournamentResultsImageModel,
} from "../src/tournament-export-image.js";

const document_ = {
  summary: { name: "TN13 · Friday night", eventDate: "2026-09-05", timezone: "Europe/Amsterdam" },
  participants: [
    { playerId: "player.ben", username: "ben", displayName: "Ben", seedRank: 3, seedScore: 27.5 },
    { playerId: "player.evan", username: "evan", displayName: "Evan", seedRank: 14, seedScore: 20.25 },
    { playerId: "player.nova", username: "nova", displayName: "Nova", seedRank: 40, seedScore: 10 },
    { playerId: "player.kikker", username: "kikker", displayName: "Kikker", isNew: true },
  ],
  groups: [
    {
      groupId: "group.q1", stage: "qualifier", sequence: 1, name: "Groep 1",
      members: [
        { playerId: "player.ben", displayName: "Ben", seatOrder: 0, station: { ownerPlayerId: "player.ben", ownerDisplayName: "Ben", switchType: "ns2", seatNumber: 1 } },
        { playerId: "player.evan", displayName: "Evan", seatOrder: 1, station: { ownerPlayerId: "player.ben", ownerDisplayName: "Ben", switchType: "ns2", seatNumber: 2 } },
        { playerId: "player.nova", displayName: "Nova", seatOrder: 2, station: { ownerPlayerId: "player.nova", ownerDisplayName: "Nova", switchType: "ns1", seatNumber: 1 } },
        { playerId: "player.kikker", displayName: "Kikker", seatOrder: 3 },
      ],
      standings: { source: "races", rows: [
        { rank: 1, playerId: "player.evan", displayName: "Evan", points: 30 },
        { rank: 2, playerId: "player.ben", displayName: "Ben", points: 28 },
        { rank: 3, playerId: "player.nova", displayName: "Nova", points: 12 },
        { rank: 4, playerId: "player.kikker", displayName: "Kikker", points: 4 },
      ] },
      races: [],
    },
    {
      groupId: "group.f1", stage: "final", sequence: 1, name: "Kampioen", tierKey: "champion",
      members: [
        { playerId: "player.evan", displayName: "Evan", seatOrder: 0, station: { ownerPlayerId: "player.ben", ownerDisplayName: "Ben", switchType: "ns2", seatNumber: 1 } },
        { playerId: "player.ben", displayName: "Ben", seatOrder: 1, station: { ownerPlayerId: "player.ben", ownerDisplayName: "Ben", switchType: "ns2", seatNumber: 2 } },
      ],
      standings: { source: "races", rows: [
        { rank: 1, playerId: "player.ben", displayName: "Ben", points: 45 },
        { rank: 2, playerId: "player.evan", displayName: "Evan", points: 40 },
      ] },
      races: [],
    },
  ],
} as unknown as TournamentDocument;

describe("tournament export image (APK parity)", () => {
  it("writes the Dutch date, the comma metric and the APK file name", () => {
    expect(tournamentExportDutchDate({ eventDate: "2026-09-05" })).toBe("5 september 2026");
    expect(tournamentExportDutchDate({ startAtMs: Date.UTC(2026, 11, 31, 22, 30), timezone: "Europe/Amsterdam" }))
      .toBe("31 december 2026");
    expect(tournamentExportDutchDate({})).toBeNull();
    expect(tournamentExportMetric(27.5)).toBe("27,50");
    expect(tournamentExportFileName("TN13 · Friday night", "qualifier", "layout")).toBe("tn13_friday_night_kwalificatie_indeling.png");
    expect(tournamentExportFileName("   ", "final", "results")).toBe("mk8dx_toernooi_eindgroepen_uitslag.png");
  });

  it("numbers UTP per Tournament in board order and ignores the server's lifetime cable numbers", () => {
    const lifetime = {
      ...document_,
      groups: document_.groups.map((group) => ({
        ...group,
        members: group.members.map((member) => member.station === undefined ? member : {
          ...member,
          station: { ...member.station, utpCableNumber: member.station.ownerPlayerId === "player.ben" ? 14 : 7 },
        }),
      })),
    } as unknown as TournamentDocument;
    const source = tournamentExportSourceFromDocument(lifetime);
    const cables = source.groups.map((group) => group.members.map((member) => member.station?.utpCableNumber));
    expect(cables).toEqual([[1, 1, 2, undefined], [1, 1]]);
    const model = tournamentLayoutImageModel(source, "qualifier");
    expect(model.groups[0]!.rows.map((row) => row.values[1])).toEqual(["1", "2"]);
    expect(tournamentLayoutImageModel(source, "final").groups[0]!.rows.map((row) => row.values[1])).toEqual(["1"]);
  });

  it("builds the layout picture: one row per console, UTP, SP-rank tiers and the seat dots", () => {
    const model = tournamentLayoutImageModel(tournamentExportSourceFromDocument(document_), "qualifier");
    expect(model.title).toBe("🏁 Kwalificatie Indeling");
    expect(model.subtitle).toBe("TN13 · Friday night · 5 september 2026");
    expect(model.headers).toEqual(["Nintendo Switch", "UTP", "SP Rank", "Deelnemer 1", "SP Rank", "Deelnemer 2"]);
    expect(model.isQualifier).toBe(true);
    const group = model.groups[0]!;
    expect(group.heading).toBe("Groep 1");
    expect(group.participantCount).toBe(4);
    expect(group.rows.map((row) => row.values)).toEqual([
      ["Ben", "1", "#3", "Ben", "#14", "Evan"],
      ["Nova", "2", "#40", "Nova", "-", "-"],
    ]);
    expect(group.rows[0]!.switchType).toBe("ns2");
    expect(group.rows[0]!.rankTierKeys).toEqual({ 2: "champion", 4: "talent" });
    expect(group.rows[1]!.rankTierKeys).toEqual({ 2: "adventure", 4: "unknown" });
    expect(group.rows[0]!.switchDotColor).toBe("#93C5FD");
    expect(tournamentExportMetric(group.averageSkill)).toBe("19,25");
    expect(tournamentExportMetric(group.spreadPlus)).toBe("8,25");
    expect(tournamentExportMetric(group.spreadMinus)).toBe("9,25");
    expect(group.skillKnown).toBe(true);
    expect([group.borderStart, group.borderEnd]).toEqual(["#93C5FD", "#3730A3"]);
  });

  it("builds the results pictures: podium pills and medals in the final, destinations in the qualifier", () => {
    const source = tournamentExportSourceFromDocument(document_);
    const qualifier = tournamentResultsImageModel(source, "qualifier");
    expect(qualifier.title).toBe("🏁 Resultaat Kwalificatie");
    expect(qualifier.headers).toEqual(["Positie", "SP Rank", "Deelnemer", "Naar Eindgroep", "Score"]);
    expect(qualifier.groups[0]!.rows.map((row) => row.values)).toEqual([
      ["#1", "#14", "Evan", "Kampioen", "30"],
      ["#2", "#3", "Ben", "Kampioen", "28"],
      ["#3", "#40", "Nova", "-", "12"],
      ["#4", "#?", "Kikker", "-", "4"],
    ]);
    expect(qualifier.groups[0]!.rows[0]!.rankTierKeys).toEqual({ 1: "talent", 3: "champion" });
    expect(qualifier.groups[0]!.rows.every((row) => row.medal === "")).toBe(true);

    const final = tournamentResultsImageModel(source, "final");
    expect(final.title).toBe("🏁 Resultaat Eind Groep");
    expect(final.headers).toEqual(["Positie", "SP Rank", "Deelnemer", "Score"]);
    expect(final.groups[0]!.heading).toBe("Kampioen");
    expect(final.groups[0]!.groupTierKey).toBe("champion");
    expect(final.groups[0]!.rows.map((row) => [row.medal, row.positionRank, ...row.values])).toEqual([
      ["🏆", 1, "#1", "#3", "Ben", "45"],
      ["🥈", 2, "#2", "#14", "Evan", "40"],
    ]);
    expect(tournamentExportMinimums("results", false)).toEqual([72, 54, 94, 52]);
  });

  it("splits a qualifier evenly across the tiers when no final groups exist yet", () => {
    const withoutFinals = { ...document_, groups: document_.groups.filter((group) => group.stage === "qualifier") } as TournamentDocument;
    const model = tournamentResultsImageModel(tournamentExportSourceFromDocument(withoutFinals), "qualifier");
    expect(model.groups[0]!.rows.map((row) => row.values[3])).toEqual(["Kampioen", "Kampioen", "Kampioen", "Kampioen"]);
  });

  it("measures column widths the APK way: header or widest cell plus padding, never under the minimum", () => {
    const model = tournamentLayoutImageModel(tournamentExportSourceFromDocument(document_), "qualifier");
    const widths = tournamentExportColumnWidths(model, tournamentExportMinimums("layout", true), (text) => text.length * 6);
    expect(widths).toEqual([100, 36, 52, 76, 52, 76]);
  });

  it("reads the public event: seats keyed by owner name and Switch, UTP by first appearance, seeds carried", () => {
    const event = {
      tournamentId: "tournament.x", name: "TN14", eventDate: "2026-09-12", stage: "finalized",
      publicResults: true, participantCount: 3, overall: [],
      groups: [{
        groupId: "group.q1", stage: "qualifier", sequence: 1, name: "Groep 1",
        seating: [
          { playerId: "player.nova", displayName: "Nova", seatOrder: 2, stationOwnerDisplayName: "Nova", switchType: "ns1", seatNumber: 1, seedRank: 40, seedScore: 10 },
          { playerId: "player.ben", displayName: "Ben", seatOrder: 0, stationOwnerDisplayName: "Ben", switchType: "ns2", seatNumber: 1, seedRank: 3, seedScore: 27.5 },
          { displayName: "Private", seatOrder: 1, stationOwnerDisplayName: "Ben", switchType: "ns2", seatNumber: 2 },
        ],
        standings: [
          { rank: 1, playerId: "player.ben", displayName: "Ben", points: 30, races: 2, wins: 2, complete: true, seedRank: 3, seedScore: 27.5 },
          { rank: 2, displayName: "Private", points: 20, races: 2, wins: 0, complete: true },
        ],
        races: [],
      }],
    } as unknown as PublicTournamentEvent;
    const source = tournamentExportSourceFromPublicEvent(event);
    const layout = tournamentLayoutImageModel(source, "qualifier");
    expect(layout.groups[0]!.rows.map((row) => row.values)).toEqual([
      ["Ben", "1", "#3", "Ben", "#?", "Private"],
      ["Nova", "2", "#40", "Nova", "-", "-"],
    ]);
    const results = tournamentResultsImageModel(source, "qualifier");
    expect(results.groups[0]!.rows.map((row) => row.values)).toEqual([
      ["#1", "#3", "Ben", "Kampioen", "30"],
      ["#2", "#?", "Private", "-", "20"],
    ]);
    expect(results.subtitle).toBe("TN14 · 12 september 2026");
  });
});

describe("a night nobody had an SP for", () => {
  it("says so instead of printing an average of zero", () => {
    // TN4 is the first rated edition: no Player carried a rating into it, so
    // there is no average, no spread, and nothing to round to 0,00.
    const unrated = {
      ...document_,
      participants: (document_ as unknown as { participants: unknown[] }).participants
        .map((row) => { const { seedRank: _r, seedScore: _s, ...rest } = row as Record<string, unknown>; return rest; }),
    } as unknown as TournamentDocument;
    const model = tournamentLayoutImageModel(tournamentExportSourceFromDocument(unrated), "qualifier");
    const group = model.groups[0]!;
    expect(group.skillKnown).toBe(false);
    expect(group.averageSkill).toBe(0);
    expect(group.rows.map((row) => row.values[2])).toEqual(["#?", "#?"]);
  });
});

describe("the frame the picture is drawn in", () => {
  it("never comes out narrower than a qualifier's table", () => {
    // A final standing with short names measures 272; shared next to a
    // qualifier's 354 it read as a picture of something else. The columns take
    // the missing room, in proportion, so both are 354 wide.
    const stretched = tournamentExportStretchedWidths([72, 54, 94, 52]);
    expect(stretched.reduce((sum, width) => sum + width, 0)).toBe(TOURNAMENT_EXPORT_MIN_TABLE_WIDTH);
    // The name column was the widest and stays the widest.
    expect(Math.max(...stretched)).toBe(stretched[2]);
    expect(stretched.every((width, index) => width >= [72, 54, 94, 52][index]!)).toBe(true);
  });

  it("gives a wide table all the room it measured", () => {
    // The floor is a floor, never a cap: a seating board with long names has
    // to fit, and nothing may be squeezed to hit a shape.
    expect(tournamentExportStretchedWidths([120, 100, 90, 80])).toEqual([120, 100, 90, 80]);
  });

  it("keeps the one-column picture one column", () => {
    // The owner's decision: a WhatsApp export stays a single column, because
    // that is what reads on a phone. The frame is the only thing that was
    // levelled - the groups still stack, however many there are.
    expect(TOURNAMENT_EXPORT_MIN_TABLE_WIDTH).toBe(354);
  });
});

describe("the message a shared picture travels with", () => {
  const dated = (extra: Record<string, unknown>): TournamentDocument => ({
    ...document_,
    summary: { ...(document_ as unknown as { summary: Record<string, unknown> }).summary, ...extra },
  } as unknown as TournamentDocument);

  it("says which night, when, and which of the four boards", () => {
    // The picture carries every name and score already; the message says
    // only what it cannot. 20:00 is the start time read in the night's own
    // timezone - 18:00 UTC in September is 20:00 in Amsterdam.
    const source = tournamentExportSourceFromDocument(dated({
      eventDate: "2026-09-11", startAtMs: 1_789_149_600_000, timezone: "Europe/Amsterdam",
    }));
    expect(tournamentExportShareCaption(source, "qualifier", "layout")).toBe(
      "TN13 · Friday night\n11 september 2026 · 20:00\n🏁 Kwalificatie Indeling",
    );
    expect(tournamentExportShareCaption(source, "qualifier", "results")).toBe(
      "TN13 · Friday night\n11 september 2026 · 20:00\n🏁 Resultaat Kwalificatie",
    );
    expect(tournamentExportShareCaption(source, "final", "layout")).toBe(
      "TN13 · Friday night\n11 september 2026 · 20:00\n🏁 Eind Groep Indeling",
    );
    expect(tournamentExportShareCaption(source, "final", "results")).toBe(
      "TN13 · Friday night\n11 september 2026 · 20:00\n🏁 Resultaat Eind Groep",
    );
  });

  it("leaves out a clock nobody set", () => {
    // A night saved with only a date says the day and offers no time.
    const source = tournamentExportSourceFromDocument(document_ as unknown as TournamentDocument);
    expect(tournamentExportShareCaption(source, "qualifier", "results")).toBe(
      "TN13 · Friday night\n5 september 2026\n🏁 Resultaat Kwalificatie",
    );
  });

  it("carries no roster", () => {
    const source = tournamentExportSourceFromDocument(document_ as unknown as TournamentDocument);
    const caption = tournamentExportShareCaption(source, "qualifier", "layout");
    expect(caption).not.toContain("Ben");
    expect(caption.split("\n")).toHaveLength(3);
  });
});

describe("the picture is shown at its own shape", () => {
  const appRoot = fileURLToPath(new URL("../", import.meta.url));
  const renderer = readFileSync(`${appRoot}src/tournament-export-image.ts`, "utf8");
  const style = readFileSync(`${appRoot}styles/ds-workflows.css`, "utf8");
  const pictureRule = style.slice(
    style.indexOf(".tournament-export-picture canvas {"),
    style.indexOf("}", style.indexOf(".tournament-export-picture canvas {")),
  );

  it("gives the canvas no inline size", () => {
    // An inline width beats the stylesheet, and with a height bound above it
    // the drawing was squeezed into a box of the wrong shape: 0.29 wide-to-tall
    // shown at 0.81. How large it appears is the page's business.
    expect(renderer).not.toContain("canvas.style.width");
    expect(renderer).not.toContain("canvas.style.height");
  });

  it("bounds the box, not the canvas", () => {
    // A results picture is a tall strip. The frame scrolls; the picture keeps
    // its shape and a width you can read.
    expect(pictureRule).not.toContain("max-height");
    expect(pictureRule).toContain("max-width");
    expect(style).toContain("margin: var(--ds-space-sm) 0; max-height: 70vh; overflow: auto;");
  });

  it("gets every renderer colour from the generated fixed-Dark adapter", () => {
    const tokens = readFileSync(`${appRoot}src/tournament-export-tokens.generated.ts`, "utf8");
    expect(renderer).toContain('from "./tournament-export-tokens.generated.js"');
    expect(renderer).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(renderer).not.toMatch(/rgba?\(/i);
    expect(tokens).toContain("GENERATED by packages/design-tokens/generate.mjs");
    expect(tokens).toContain('"page": "#080C1C"');
  });
});
