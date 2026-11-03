import { describe, expect, it } from "vitest";

import {
  leaderboardHref,
  parseEngineMode,
  resolveEngineMode,
} from "../src/engine-context.js";

describe("EngineContext", () => {
  it("parses only 150 and 200", () => {
    expect(parseEngineMode(150)).toBe(150);
    expect(parseEngineMode("200")).toBe(200);
    for (const value of [undefined, null, "", "100", 0, "150cc", 151]) {
      expect(parseEngineMode(value)).toBeNull();
    }
  });

  it("resolves explicit > surface > single-engine preference > 150", () => {
    expect(resolveEngineMode({ explicit: 200, surface: 150, preference: "150" }))
      .toEqual({ mode: 200, source: "explicit" });
    expect(resolveEngineMode({ surface: 200, preference: "150" }))
      .toEqual({ mode: 200, source: "surface" });
    expect(resolveEngineMode({ preference: "200" })).toEqual({ mode: 200, source: "preference" });
    expect(resolveEngineMode({ preference: "all" })).toEqual({ mode: 150, source: "default" });
    expect(resolveEngineMode({})).toEqual({ mode: 150, source: "default" });
  });

  it("puts a known engine into a track link and leaves an unknown one to the track page", () => {
    expect(leaderboardHref("track.a b", 200)).toBe("/?leaderboard=track.a%20b&mode=200");
    expect(leaderboardHref("track.x", null)).toBe("/?leaderboard=track.x");
    expect(leaderboardHref("track.x", undefined, { notification: "7" }))
      .toBe("/?leaderboard=track.x&notification=7");
  });
});
