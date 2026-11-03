import { afterEach, describe, expect, it, vi } from "vitest";

import { CUP_ASSET_MANIFEST } from "../src/asset-manifest.js";
import { trackMasteryTier } from "../src/mastery-thresholds.js";
import { mountTimeTrialStanding } from "../src/time-trial-standing-view.js";
import { FakeDocument } from "./dom-double.js";

afterEach(() => vi.unstubAllGlobals());

describe("Ranking's live World Record Mastery baseline", () => {
  it("applies a complete snapshot before rendering, as the APK does", async () => {
    const tracks = CUP_ASSET_MANIFEST.flatMap((cup) => cup.tracks);
    const records = ([150, 200] as const).flatMap((mode) => tracks.map((track) => ({
      mode, trackId: track.id, totalTimeMs: mode === 150 ? 79_000 : 60_000,
      playerName: "WR", lapTimesMs: [1, 1, 1], coinsPerLap: [0, 0, 0], mushroomsPerLap: [0, 0, 0],
    })));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      schemaVersion: "mk8dx.world-records.v1", records,
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const document = new FakeDocument();
    const mounted = mountTimeTrialStanding(
      document.createElement("div") as unknown as HTMLElement,
      Promise.resolve({ viewerPlayerId: null, rivalPlayerIds: new Set<string>() }),
      async () => [],
      { tab: "medals" },
    );
    await mounted.ready;

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(trackMasteryTier("track.3ds_toad_circuit", 150, 92_829)).toBe(16); // Int A
    mounted.unmount();
  });
});
