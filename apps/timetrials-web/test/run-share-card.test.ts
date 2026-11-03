import { describe, expect, it } from "vitest";
import {
  formatRunTime,
  runShareFileName,
  runShareHeight,
  runShareImagePaths,
  runShareText,
  runShareUrl,
  type RunShareModel,
} from "../src/run-share-card.js";

const model: RunShareModel = {
  trackId: "track.mario_kart_stadium",
  trackName: "Mario Kart Stadium",
  cupName: "Mushroom Cup",
  cupIconPath: "images/cups/mushroom.png",
  trackPreviewPath: "images/tracks/mks.png",
  mode: 200,
  playerName: "Ben",
  rank: 2,
  timeMs: 95_432,
  parts: [{ name: "Mario", iconPath: "images/characters/mario.png" }],
  laps: [{ lapNumber: 1, timeMs: 31_000, coins: 3, mushrooms: 1 }],
  coinIconPath: "images/items/icons/000_coin.png",
  mushroomIconPath: "images/items/icons/014_mushroom.png",
  url: "https://example.test/?lb=0&mode=200&run=41c260da",
};

describe("run share card", () => {
  it("links the leaderboard, the class and the run (ADR-0199)", () => {
    expect(runShareUrl("https://example.test", "track.mario_kart_stadium", 200,
      "user_submission.time.firebase_41c260dac25d3a3b3f0d90e1")).toBe(model.url);
    // A track outside the catalog keeps the long form; an id without the prefix is kept as it is.
    expect(runShareUrl("https://example.test", "track.unknown", 150, "r 1"))
      .toBe("https://example.test/?leaderboard=track.unknown&mode=150&run=r%201");
  });

  it("names the Player, track, class, time and place beside the link", () => {
    expect(runShareText(model)).toBe(`Ben · Mario Kart Stadium 200cc · 1:35.432 (#2)\n${model.url}`);
    expect(formatRunTime(61_005)).toBe("1:01.005");
    expect(runShareFileName(model)).toBe("mk8dx-mario-kart-stadium-200cc-ben.png");
  });

  it("loads every picture the card draws and grows with the laps", () => {
    expect(runShareImagePaths(model)).toEqual([
      "images/tracks/mks.png", "images/cups/mushroom.png", "images/items/icons/000_coin.png",
      "images/items/icons/014_mushroom.png", "images/characters/mario.png",
    ]);
    expect(runShareHeight(7)).toBeGreaterThan(runShareHeight(3));
  });
});
