import { describe, expect, it } from "vitest";

import { tournamentRaceClassLabel } from "../src/tournament-race-class.js";

describe("Tournament race class label (ADR-0217)", () => {
  it("names every class and Mirror only on a 150cc race", () => {
    expect([50, 100, 150, 200].map((mode) => tournamentRaceClassLabel(mode))).toEqual(["50cc", "100cc", "150cc", "200cc"]);
    expect(tournamentRaceClassLabel(150, true)).toBe("Mirror");
    expect(tournamentRaceClassLabel(200, true)).toBe("200cc");
    expect(tournamentRaceClassLabel(undefined)).toBeNull();
  });
});
