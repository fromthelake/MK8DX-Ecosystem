import { describe, expect, it } from "vitest";

import { deltaPresentation } from "../src/competitive-presentation.js";

describe("competitive delta presentation", () => {
  it("uses explicit signs and the fixed red-yellow-green three-second gradient", () => {
    expect(deltaPresentation(-3_000)).toEqual({ text: "−0:00:03.000", color: "rgb(46 204 113)" });
    expect(deltaPresentation(0)).toEqual({ text: "=0:00:00.000", color: "rgb(255 213 79)" });
    expect(deltaPresentation(3_000)).toEqual({ text: "+0:00:03.000", color: "rgb(239 83 80)" });
    expect(deltaPresentation(9_000).color).toBe("rgb(239 83 80)");
  });

  it("scales 96-track totals over plus or minus 288 seconds", () => {
    expect(deltaPresentation(-288_000, 288_000).color).toBe("rgb(46 204 113)");
    expect(deltaPresentation(0, 288_000).color).toBe("rgb(255 213 79)");
    expect(deltaPresentation(288_000, 288_000).color).toBe("rgb(239 83 80)");
    expect(deltaPresentation(144_000, 288_000).color).toBe("rgb(247 148 80)");
  });
});
