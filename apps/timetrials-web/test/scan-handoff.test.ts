import { describe, expect, it } from "vitest";

import {
  SCAN_HANDOFF_STORAGE_KEY,
  normalizeScanPartId,
  scannerHref,
  takeScanHandoff,
} from "../src/scan-handoff.js";

function storage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length(): number { return values.size; },
    clear(): void { values.clear(); },
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, value); },
  } as Storage;
}

const complete = JSON.stringify({
  trackId: "track.mario_kart_stadium",
  mode: 200,
  totalDigits: "125456",
  laps: ["041500", "041956", "042000"],
  characterId: "character_variant.yoshi.019_red",
  bodyId: "body.mach_8",
  tireId: "tire.roller",
  gliderId: "glider.super_glider",
  observedPlayerName: "Ben",
});

describe("browser scanner handoff", () => {
  it("reads a recognized scan for the track it was taken for", () => {
    const store = storage({ [SCAN_HANDOFF_STORAGE_KEY]: complete });
    const handoff = takeScanHandoff(store, "track.mario_kart_stadium");
    expect(handoff?.mode).toBe(200);
    expect(handoff?.totalDigits).toBe("125456");
    expect(handoff?.laps).toEqual(["041500", "041956", "042000"]);
    expect(handoff?.observedPlayerName).toBe("Ben");
  });

  it("clears the scan once it has been read, so a reload does not re-apply it", () => {
    const store = storage({ [SCAN_HANDOFF_STORAGE_KEY]: complete });
    expect(takeScanHandoff(store, "track.mario_kart_stadium")).not.toBeNull();
    expect(takeScanHandoff(store, "track.mario_kart_stadium")).toBeNull();
  });

  it("never applies a scan to a different track", () => {
    const store = storage({ [SCAN_HANDOFF_STORAGE_KEY]: complete });
    expect(takeScanHandoff(store, "track.baby_park")).toBeNull();
    // And it stays available for the track it actually belongs to.
    expect(takeScanHandoff(store, "track.mario_kart_stadium")).not.toBeNull();
  });

  it("refuses a scan without a usable total", () => {
    for (const raw of [
      "not json",
      JSON.stringify({ trackId: "track.mario_kart_stadium" }),
      JSON.stringify({ trackId: "track.mario_kart_stadium", totalDigits: "12345" }),
      JSON.stringify({ totalDigits: "125456" }),
    ]) {
      const store = storage({ [SCAN_HANDOFF_STORAGE_KEY]: raw });
      expect(takeScanHandoff(store, "track.mario_kart_stadium")).toBeNull();
    }
  });

  it("drops a lap it could not read rather than inventing digits", () => {
    const store = storage({
      [SCAN_HANDOFF_STORAGE_KEY]: JSON.stringify({
        trackId: "track.mario_kart_stadium",
        mode: 150,
        totalDigits: "125456",
        laps: ["041500", "4195", null],
      }),
    });
    expect(takeScanHandoff(store, "track.mario_kart_stadium")?.laps)
      .toEqual(["041500", "", ""]);
  });

  it("resolves a recognized colour variant to the part the form offers", () => {
    expect(normalizeScanPartId("character_variant.yoshi.019_red", "character"))
      .toBe("character.yoshi");
    expect(normalizeScanPartId("body.mach_8", "body")).toBe("body.mach_8");
  });

  it("keeps the exact colour variants it read beside the base parts", () => {
    const store = storage({
      [SCAN_HANDOFF_STORAGE_KEY]: JSON.stringify({
        trackId: "track.mario_kart_stadium", mode: 150, totalDigits: "125456", laps: [],
        characterId: "character_variant.yoshi.020_yellow",
        bodyId: "body_variant.pipe_frame.022_yellow",
        gliderId: "glider_variant.not_a_real_glider.001_blue",
      }),
    });
    const handoff = takeScanHandoff(store, "track.mario_kart_stadium");
    expect(handoff?.characterId).toBe("character.yoshi");
    expect(handoff?.bodyId).toBe("body.pipe_frame");
    expect(handoff?.variants).toEqual({
      characterId: "character_variant.yoshi.020_yellow",
      bodyId: "body_variant.pipe_frame.022_yellow",
    });
  });

  it("drops an identity this build does not know instead of guessing", () => {
    expect(normalizeScanPartId("body.not_a_real_kart", "body")).toBeUndefined();
    expect(normalizeScanPartId("body.mach_8", "glider")).toBeUndefined();
    expect(normalizeScanPartId("", "tire")).toBeUndefined();
    expect(normalizeScanPartId(42, "character")).toBeUndefined();
  });

  it("hands the scanner the track, the engine class and the way back", () => {
    const href = scannerHref(
      "/scanner/",
      "track.gcn_baby_park",
      200,
      "/?leaderboard=track.gcn_baby_park&mode=200",
      "endscreen",
      7,
    );
    expect(href.startsWith("/scanner/?")).toBe(true);
    const parameters = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    expect(parameters.get("track")).toBe("track.gcn_baby_park");
    expect(parameters.get("mode")).toBe("200");
    expect(parameters.get("handoff")).toBe(SCAN_HANDOFF_STORAGE_KEY);
    expect(parameters.get("return")).toBe("/?leaderboard=track.gcn_baby_park&mode=200");
    expect(parameters.get("layout")).toBe("endscreen");
    expect(parameters.get("laps")).toBe("7");
  });
});
