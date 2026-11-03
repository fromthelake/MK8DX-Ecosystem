// T-JOURNEY (docs/design-system/TESTING_STRATEGY.md §3.3), Phase 0 regression guard: the Home Journey
// is computed per engine from one bests dataset, and one engine's progress never leaks into the other.
import { describe, expect, it } from "vitest";

import { buildHomeLadder } from "../src/home-hero.js";

type Best = Parameters<typeof buildHomeLadder>[0][number];
type Row = Parameters<typeof buildHomeLadder>[1][number];

// Divergent fixture: three tracks driven in 150cc (one #1, one top 3), one track in 200cc (rank 12).
const bests = [
  { trackId: "track.mario_kart_stadium", mode: 150, totalTimeMs: 90_000, rank: 1 },
  { trackId: "track.water_park", mode: 150, totalTimeMs: 95_000, rank: 3 },
  { trackId: "track.sweet_sweet_canyon", mode: 150, totalTimeMs: 999_000, rank: 7 },
  { trackId: "track.mario_kart_stadium", mode: 200, totalTimeMs: 999_000, rank: 12 },
] as unknown as readonly Best[];
const rows = [
  { trackId: "track.water_park", mode: 150, leaderBestMs: 94_500 },
  { trackId: "track.mario_kart_stadium", mode: 200, leaderBestMs: 70_000 },
] as unknown as readonly Row[];

describe("Journey 150cc and 200cc are independent", () => {
  it("counts only the selected engine's bests", () => {
    const j150 = buildHomeLadder(bests, rows, 150);
    const j200 = buildHomeLadder(bests, rows, 200);
    expect(j150.tracksDriven).toBe(3);
    expect(j200.tracksDriven).toBe(1);
    expect(j150.trackRecords).toBe(1);
    expect(j200.trackRecords).toBe(0);
    expect(j150.topThreePositions).toBe(2);
    expect(j200.topThreePositions).toBe(0);
    expect(j200.outsideTopTen).toBe(1);
    expect(j150.outsideTopTen).toBe(0);
    expect(j150.withinOneSecond).toBe(1);
    expect(j200.withinOneSecond).toBe(0);
  });

  it("uses each engine's own staff benchmarks", () => {
    const j150 = buildHomeLadder(bests, rows, 150);
    const j200 = buildHomeLadder(bests, rows, 200);
    expect(j150.trackTotal).toBeGreaterThan(0);
    expect(j200.trackTotal).toBeGreaterThan(0);
    // A 999 s time beats no staff ghost in either engine; the 150cc record on Stadium does.
    expect(j200.staffGhostsBeaten).toBe(0);
    expect(j150.staffGhostsBeaten).toBeGreaterThanOrEqual(1);
  });
});
