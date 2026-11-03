import { describe, expect, it } from "vitest";

import {
  deltaDirection,
  formatCount,
  formatDelta,
  formatRank,
  formatTime,
  heroRankStep,
  rankColumnCh,
} from "../src/ds-numeric.js";

// T-NUM (TESTING_STRATEGY §5): the protected range #1 … #99,999, points to 5 digits, totals to 16 h.
describe("design-system numeric typography", () => {
  it("formats every protected rank exactly, with the language's separator", () => {
    const ranks = [1, 9, 10, 99, 100, 999, 1_000, 9_999, 10_000, 99_999];
    expect(ranks.map((rank) => formatRank(rank, "en"))).toEqual([
      "#1", "#9", "#10", "#99", "#100", "#999", "#1,000", "#9,999", "#10,000", "#99,999",
    ]);
    expect(ranks.map((rank) => formatRank(rank, "nl")).slice(6)).toEqual([
      "#1.000", "#9.999", "#10.000", "#99.999",
    ]);
    expect(formatCount(12_345, "nl")).toBe("12.345");
    expect(() => formatRank(0, "en")).toThrow(RangeError);
  });

  it("sizes the rank column from the largest rank in the dataset, separators included", () => {
    expect(rankColumnCh(9, "en")).toBe(2);
    expect(rankColumnCh(999, "en")).toBe(4);
    expect(rankColumnCh(1_000, "en")).toBe(6);
    expect(rankColumnCh(99_999, "nl")).toBe(7);
  });

  it("puts hero ranks on four fixed steps, never per value", () => {
    expect([1, 12, 99].map(heroRankStep)).toEqual(["display-2", "display-2", "display-2"]);
    expect(heroRankStep(100)).toBe("display-3");
    expect(heroRankStep(9_999)).toBe("display-4");
    expect([10_000, 99_999, 123_456].map(heroRankStep)).toEqual(["display-5", "display-5", "display-5"]);
  });

  it("writes times as M:SS.mmm and, from an hour, H:MM:SS.mmm up to 16 h", () => {
    expect(formatTime(1)).toBe("0:00.001");
    expect(formatTime(599_999)).toBe("9:59.999");
    expect(formatTime(105_912)).toBe("1:45.912");
    expect(formatTime(3_600_000)).toBe("1:00:00.000");
    expect(formatTime(16 * 3_600_000 - 1)).toBe("15:59:59.999");
  });

  it("signs every delta with + or a true minus and names its direction", () => {
    expect(formatDelta(-412)).toBe("−0.412");
    expect(formatDelta(62_004)).toBe("+1:02.004");
    expect(formatDelta(0)).toBe("±0.000");
    expect([-1, 1, 0].map(deltaDirection)).toEqual(["faster", "slower", "even"]);
  });
});
