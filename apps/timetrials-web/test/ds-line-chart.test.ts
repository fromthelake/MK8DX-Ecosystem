import { beforeEach, describe, expect, it } from "vitest";

import {
  lineChart,
  lineGeometry,
  nearestLinePoint,
  useDocument,
} from "../src/ds-components.js";
import { byClass, descendants, FakeDocument, type FakeNode } from "./dom-double.js";

describe("design-system LineChart", () => {
  beforeEach(() => { useDocument(new FakeDocument() as unknown as Document); });

  it("maps flat and single-value series without unstable geometry", () => {
    expect(lineGeometry([], 100, 60, 10, 10)).toEqual([]);
    expect(lineGeometry([7], 100, 60, 10, 10)).toEqual([{ x: 50, y: 50 }]);
    expect(lineGeometry([2, 4], 100, 60, 10, 10)).toEqual([
      { x: 10, y: 50 },
      { x: 90, y: 10 },
    ]);
    expect(lineGeometry([4, 4], 100, 60, 10, 10)).toEqual([
      { x: 10, y: 50 },
      { x: 90, y: 50 },
    ]);
  });

  it("clamps pointer positions to the nearest real point", () => {
    expect(nearestLinePoint(-100, 5, 100, 10)).toBe(0);
    expect(nearestLinePoint(50, 5, 100, 10)).toBe(2);
    expect(nearestLinePoint(500, 5, 100, 10)).toBe(4);
    expect(nearestLinePoint(50, 1, 100, 10)).toBe(0);
  });

  it("keeps every dense-series value while reducing ordinary marker size", () => {
    const values = Array.from({ length: 81 }, (_, index) => index);
    const root = lineChart({
      label: "Rating history",
      values,
      describe: (index, value) => `Point ${index}: ${value}`,
      kindOf: (index) => index === 0 ? "seed" : "normal",
      ticks: [{ index: 0, label: "Start" }, { index: 80, label: "Now" }],
      summary: "Now 80",
    }) as unknown as FakeNode;

    const nodes = descendants(root);
    const svg = nodes.find((node) => node.getAttribute("class") === "ds-line");
    const dots = nodes.filter((node) => node.getAttribute("class") === "ds-line__dot");
    expect(svg?.getAttribute("data-density")).toBe("dense");
    expect(svg?.getAttribute("tabindex")).toBe("0");
    expect(dots).toHaveLength(81);
    expect(dots[0]?.getAttribute("data-kind")).toBe("seed");
    expect(dots[0]?.getAttribute("r")).toBe("3.6");
    expect(dots[1]?.getAttribute("r")).toBe("1.5");
    expect(nodes.filter((node) => node.getAttribute("class") === "ds-line__tick")).toHaveLength(2);
    expect(byClass(root, "ds-line__readout")?.textContent).toBe("Now 80");
  });
});
