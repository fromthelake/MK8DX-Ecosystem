import { describe, expect, it } from "vitest";
import { CUP_ASSET_MANIFEST } from "../src/asset-manifest.js";
import { applyWorldRecordMasteryBaseline, MASTERY_WR_RATIOS, trackThresholdLadder } from "../src/mastery-thresholds.js";

describe("daily World Record Mastery baseline", () => {
  it("updates only from a complete deduplicated 96+96 snapshot", () => {
    const tracks = CUP_ASSET_MANIFEST.flatMap((cup) => cup.tracks);
    expect(applyWorldRecordMasteryBaseline(tracks.map((track) => ({ mode: 150, trackId: track.id, totalTimeMs: 100_000 })))).toBe(false);
    const complete = ([150, 200] as const).flatMap((mode) => tracks.map((track) => ({ mode, trackId: track.id, totalTimeMs: mode === 150 ? 100_000 : 80_000 })));
    expect(applyWorldRecordMasteryBaseline(complete)).toBe(true);
    expect(trackThresholdLadder(tracks[0]!.id, 200)?.[0]).toBe(Math.round(80_000 * MASTERY_WR_RATIOS[0]! / 100) * 100);
  });
});
