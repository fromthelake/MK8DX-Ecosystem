import { afterEach, describe, expect, it, vi } from "vitest";

import { allTrackAssets } from "../src/asset-manifest.js";
import {
  ensureMasteryWorldRecords,
  masteryTierLabel,
  masteryUsesLiveWorldRecords,
  trackMasteryTier,
} from "../src/mastery-thresholds.js";
import { primeFromBootstrap } from "../src/preloaded-responses.js";

// Owner 2026-09-26: every Mastery label follows the current World Records, whichever page opens
// first. The page bootstrap carries them; nothing asks a second time.
describe("the live Mastery baseline", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("comes with the bootstrap and is not requested again", async () => {
    const records = allTrackAssets().flatMap((track) =>
      ([150, 200] as const).map((mode) => ({ mode, trackId: track.id, totalTimeMs: 60_000 })));
    expect(records).toHaveLength(192);
    const requested: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      requested.push(String(input));
      return new Response(JSON.stringify({
        schemaVersion: "mk8dx.home-bootstrap.v1", authenticated: false,
        worldRecordTimes: { schemaVersion: "mk8dx.world-record-times.v1", records },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const trackId = records[0]!.trackId;
    expect(masteryUsesLiveWorldRecords()).toBe(false);
    await primeFromBootstrap();
    expect(masteryUsesLiveWorldRecords()).toBe(true);
    // A 60.000 World Record puts 60.500 at the top level and a minute slower far below it.
    expect(masteryTierLabel(trackMasteryTier(trackId, 150, 60_500) ?? 22)).toBe("Deity");
    expect(trackMasteryTier(trackId, 150, 120_000)).toBeGreaterThan(15);
    expect(await ensureMasteryWorldRecords()).toBe(true);
    expect(requested.filter((url) => url.includes("world-records"))).toHaveLength(0);
  });
});
