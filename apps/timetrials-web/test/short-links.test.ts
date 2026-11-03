import { describe, expect, it } from "vitest";
import { expandShortLink, findRun, runCode } from "../src/short-links.js";

describe("short addresses (ADR-0199)", () => {
  it("opens a leaderboard by the schema-9 track index, keeping the class and a shared run", () => {
    expect(expandShortLink("?lb=8&mode=150")).toBe("?leaderboard=track.sunshine_airport&mode=150");
    expect(expandShortLink("?lb=0&mode=200&run=user_submission.time.A1"))
      .toBe("?leaderboard=track.mario_kart_stadium&mode=200&run=user_submission.time.A1");
    expect(expandShortLink("?lb=8")).toBe("?leaderboard=track.sunshine_airport");
    expect(expandShortLink("?lb=8&mode=300")).toBe("?leaderboard=track.sunshine_airport");
  });

  it("names a shared run by an 8-character code from its id", () => {
    expect(runCode("user_submission.time.firebase_41c260dac25d3a3b3f0d90e1")).toBe("41c260da");
    expect(runCode("user_submission.time.LIVETRIALd5b96452115dcbb2ff9dec7f6ddf7882d1b0291a")).toBe("d5b96452");
    expect(runCode("user_submission.time.a85ae472-de8c-4a9a-a329-3937d732693e")).toBe("a85ae472");
    expect(expandShortLink("?lb=8&mode=150&run=41c260da"))
      .toBe("?leaderboard=track.sunshine_airport&mode=150&run=41c260da");
  });

  it("finds the one run a link names on the board, by code, short id or full id", () => {
    const board = ["user_submission.time.firebase_41c260dac25d3a3b3f0d90e1",
      "user_submission.time.a85ae472-de8c-4a9a-a329-3937d732693e"];
    expect(findRun(board, "41c260da")).toBe(board[0]);
    expect(findRun(board, "41C260DA")).toBe(board[0]);
    expect(findRun(board, "firebase_41c260dac25d3a3b3f0d90e1")).toBe(board[0]);
    expect(findRun(board, board[1]!)).toBe(board[1]);
    expect(findRun(board, "ffffffff")).toBeUndefined();
    // two results with the same code: none is opened rather than the wrong one
    expect(findRun([...board, "user_submission.time.41c260da-0000-0000-0000-000000000000"], "41c260da")).toBeUndefined();
  });

  it("sends an unknown track number to the track list", () => {
    expect(expandShortLink("?lb=999")).toBe("?cups=1");
    expect(expandShortLink("?lb=abc")).toBe("?cups=1");
  });

  it("leaves every other address alone", () => {
    expect(expandShortLink("")).toBeNull();
    expect(expandShortLink("?leaderboard=track.sunshine_airport&mode=150")).toBeNull();
    expect(expandShortLink("?player=player.ben")).toBeNull();
  });
});
