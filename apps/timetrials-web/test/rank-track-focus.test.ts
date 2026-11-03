import { describe, expect, it } from "vitest";

import {
  matchesRankTrackFocus,
  parseRankTrackFocus,
  rankTrackFocusHref,
} from "../src/rank-track-focus.js";

describe("Home-to-Ranking track focus", () => {
  it("builds a shareable existing Ranking route and rejects unknown filters", () => {
    expect(rankTrackFocusHref("staff-left", 150)).toBe(
      "/?ranking=timetrials&tab=tracks&mode=150&focus=staff-left",
    );
    expect(parseRankTrackFocus("top-three")).toBe("top-three");
    expect(parseRankTrackFocus("invented")).toBeNull();
  });

  it("uses the same evidence semantics as the Home metrics", () => {
    expect(matchesRankTrackFocus("staff-left", {
      bestTimeMs: 101_000,
      staffTimeMs: 100_000,
    })).toBe(true);
    expect(matchesRankTrackFocus("staff-left", {
      bestTimeMs: 99_999,
      staffTimeMs: 100_000,
    })).toBe(false);
    expect(matchesRankTrackFocus("near-record", {
      bestRank: 2,
      bestTimeMs: 100_900,
      leaderTimeMs: 100_000,
    })).toBe(true);
    expect(matchesRankTrackFocus("near-record", {
      bestRank: 1,
      bestTimeMs: 100_000,
      leaderTimeMs: 100_000,
    })).toBe(false);
    expect(matchesRankTrackFocus("current-records", { bestRank: 1 }))
      .toBe(true);
    expect(matchesRankTrackFocus("tracks-left", {})).toBe(true);
    expect(matchesRankTrackFocus("top-three", { bestRank: 3 })).toBe(true);
    expect(matchesRankTrackFocus("outside-top-ten", { bestRank: 11 }))
      .toBe(true);
  });
});
