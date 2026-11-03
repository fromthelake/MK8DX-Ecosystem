import { describe, expect, it } from "vitest";

import { filledLaps, parseReferenceGhostReadings, readingFor } from "../src/reference-ghost-readings.js";

const reading = {
  kind: "nintendo_staff", trackId: "track.mario_kart_stadium", mode: 150, totalTimeMs: 90_000,
  observedName: "Nin★Sho", countryId: "country.jp", loadout: null, lapTimesMs: [30_000, 30_000, 30_000],
  coinsPerLap: [4, 3, 3], mushroomsPerLap: [1, 1, 1], events: null, source: "ghost_replay",
  confirmations: 1, conflicts: 0, updatedAtMs: 1,
};

describe("the public ghost readings (ADR-0212)", () => {
  it("parses the API's document and refuses a shape it does not know", () => {
    const [parsed] = parseReferenceGhostReadings({ schemaVersion: "mk8dx.reference-ghost-readings.v1", readings: [reading] });
    expect(parsed).toEqual({
      kind: "nintendo_staff", trackId: "track.mario_kart_stadium", mode: 150, totalTimeMs: 90_000,
      lapTimesMs: [30_000, 30_000, 30_000], coinsPerLap: [4, 3, 3], mushroomsPerLap: [1, 1, 1],
    });
    expect(() => parseReferenceGhostReadings({ schemaVersion: "mk8dx.reference-ghost-readings.v1", readings: [{ ...reading, extra: 1 }] }))
      .toThrow();
    expect(() => parseReferenceGhostReadings({ schemaVersion: "mk8dx.reference-ghost-readings.v2", readings: [] })).toThrow();
  });

  it("matches a reading by kind and exact time, and fills only what is missing", () => {
    const [parsed] = parseReferenceGhostReadings({ schemaVersion: "mk8dx.reference-ghost-readings.v1", readings: [reading] });
    expect(readingFor([parsed!], "nintendo_staff", 90_000)).toBe(parsed);
    expect(readingFor([parsed!], "world_record", 90_000)).toBeUndefined();
    expect(readingFor([parsed!], "nintendo_staff", 90_001)).toBeUndefined();
    expect(filledLaps(undefined, [1, 2, 3])).toEqual([1, 2, 3]);
    expect(filledLaps([], [1, 2, 3])).toEqual([1, 2, 3]);
    expect(filledLaps([9, 9, 9], [1, 2, 3])).toEqual([9, 9, 9]);
  });
});
