import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

import { classicContent, classicDataset, classicPicture, type ClassicCatalog } from "../src/tournament-report-classic.js";
import type { PublicTournamentEvent } from "../src/tournament-operation-client.js";

const catalog: ClassicCatalog = {
  cups: [{ cupIndex: 0, nameUK: "Mushroom Cup" }, { cupIndex: 15, nameUK: "Banana Cup" }],
  tracks: [
    { trackIndex: 0, cupIndex: 0, nameUK: "Mario Kart Stadium" },
    { trackIndex: 62, cupIndex: 15, nameUK: "Wii Mushroom Gorge" },
  ],
  characters: [
    { characterIndex: 3, rosterIndex: 3, nameUK: "Yoshi" },
    { characterIndex: 40, rosterIndex: 3, nameUK: "White Yoshi" },
    { characterIndex: 10, rosterIndex: 10, nameUK: "Rosalina" },
  ],
};

const event = {
  tournamentId: "tournament.x",
  name: "Toernooi 99",
  stage: "finalized",
  groups: [
    {
      groupId: "g.q1", stage: "qualifier", sequence: 1, name: "Groep 1",
      standings: [
        { rank: 1, displayName: "Ann", points: 27, races: 2, playerId: "player.ann", seedRank: 2, seedScore: 30.5, character: { label: "White Yoshi", roster: "Yoshi" } },
        { rank: 2, displayName: "Bob", points: 24, races: 2, playerId: "player.bob", seedRank: 5, seedScore: 20, character: { label: "Rosalina", roster: "Rosalina" } },
      ],
      races: [
        { raceNumber: 2, countsTowardStandings: true, trackId: "track.mario_kart_stadium", placements: [
          { finishPosition: 1, displayName: "Bob", racePoints: 15, playerId: "player.bob" },
          { finishPosition: 2, displayName: "Ann", racePoints: 12, playerId: "player.ann" }] },
        { raceNumber: 1, countsTowardStandings: true, trackId: "track.wii_mushroom_gorge", placements: [
          { finishPosition: 1, displayName: "Ann", racePoints: 15, playerId: "player.ann" },
          { finishPosition: 3, displayName: "Bob", racePoints: 9, playerId: "player.bob" }] },
        { raceNumber: 3, countsTowardStandings: false, trackId: "track.mario_kart_stadium", placements: [
          { finishPosition: 1, displayName: "Ann", racePoints: 15, playerId: "player.ann" }] },
      ],
    },
    {
      groupId: "g.f1", stage: "final", sequence: 1, name: "Kampioen",
      standings: [{ rank: 1, displayName: "Ann", points: 15, races: 1, playerId: "player.ann", character: { label: "White Yoshi", roster: "Yoshi" } }],
      races: [],
    },
  ],
  overall: [],
  report: {
    title: "TN99 ‘Test’", summary: ["Plain <summary>"], topTracksHtml: ["<p>Top <strong>5</strong></p>"],
    players: [{ name: "Ann", paragraphs: ["x"], html: ["<p>Ann won</p>"] }, { name: "Bob", paragraphs: [] }],
    visibility: { intro: false, summary: true, topTracks: true },
  },
} as unknown as PublicTournamentEvent;

describe("the classic export's data, from a published night", () => {
  it("keeps the vendored browser export script parseable", () => {
    const source = readFileSync(new URL("../styles/classic-report-export.js", import.meta.url), "utf8");
    expect(() => new Script(source)).not.toThrow();
  });
  const { raceRows, finalRows } = classicDataset(event, catalog);

  it("has a race row per counted placement, in race order, with running totals and places", () => {
    expect(raceRows.map((row) => [row["race"], row["player"], row["totalBefore"], row["totalAfter"], row["positionAfterRace"]])).toEqual([
      [1, "Ann", 0, 15, 1], [1, "Bob", 0, 9, 2],
      [2, "Bob", 9, 24, 2], [2, "Ann", 15, 27, 1],
    ]);
    expect(raceRows[0]).toMatchObject({
      phase: "qualifier", phaseLabel: "Kwalificatie", groupKey: "tournament.x|g.q1", tournamentName: "TN99 ‘Test’",
      track: "Wii Mushroom Gorge", cup: "Banana Cup", racePoints: 15, position: 1,
      characterVariant: "White Yoshi", characterRoster: "Yoshi", character: "Yoshi",
      allTimeRank: 2, skillScore: 30.5,
      qualifiedTargetGroupName: "Kampioen", qualifiedTargetGroupKey: "tournament.x|g.f1",
    });
    // Bob reached no final group.
    expect(raceRows[1]).toMatchObject({ qualifiedTargetGroupName: "", qualifiedTargetLobbyId: "" });
  });

  it("has a standing row per Player and group", () => {
    expect(finalRows.map((row) => [row["phase"], row["groupName"], row["player"], row["position"], row["totalPoints"], row["races"]])).toEqual([
      ["qualifier", "Groep 1", "Ann", 1, 27, 2], ["qualifier", "Groep 1", "Bob", 2, 24, 2], ["post", "Kampioen", "Ann", 1, 15, 1],
    ]);
  });

  it("carries the published writing as the old editor stored it", () => {
    const content = classicContent(event);
    expect(content["introHtml"]).toBe("<p>Plain &lt;summary&gt;</p>");
    expect(content["topTracksIntroHtml"]).toBe("<p>Top <strong>5</strong></p>");
    expect(content["playerNotesByPlayer"]).toEqual({ Ann: "<p>Ann won</p>" });
  });

  it("answers the old code's pictures with this site's own assets", () => {
    expect(classicPicture("https://x/classic-export-assets/img/track/0.webp", catalog)?.src).toMatch(/^\/assets\/images\/tracks\/previews\/000_mario_kart_stadium\.png$/);
    expect(classicPicture("/assets/img/cup/0.webp", catalog)?.src).toMatch(/^\/assets\/images\/cups\/000_mushroom_cup\.png$/);
    expect(classicPicture("/assets/img/character/40.png", catalog)?.src).toMatch(/^\/assets\/.*yoshi.*white|white.*yoshi/i);
    expect(classicPicture("/assets/img/flag/3.png", catalog)).toBeNull();
  });
});
