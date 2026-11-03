import { describe, expect, it } from "vitest";

import {
  nearestPointIndex,
  ratingGraphGeometry,
  type RatingHistoryPoint,
} from "../src/rating-graph.js";

const point = (
  sequence: number,
  tournamentNumber: number,
  score: number,
): RatingHistoryPoint => ({
  sequence,
  tournamentNumber,
  sectionLabel: `TN${tournamentNumber}: Winnaarspoule`,
  raceIndex: sequence,
  finishPosition: 1,
  score,
});

describe("tournament rating graph geometry", () => {
  it("maps the trajectory deterministically with tournament ticks", () => {
    const geometry = ratingGraphGeometry([
      point(1, 4, 0),
      point(2, 4, 10),
      point(3, 5, 20),
      point(4, 5, 15),
    ], 100, 100)!;
    // One tick per tournament, at the first race of that tournament.
    expect(geometry.ticks.map((tick) => tick.label)).toEqual(["TN4", "TN5"]);
    expect(geometry.minScore).toBe(0);
    expect(geometry.maxScore).toBe(20);
    expect(geometry.lastScore).toBe(15);
    // Four points, first at the left pad, last at width - pad.
    const xs = geometry.linePoints.split(" ")
      .map((pair) => Number(pair.split(",")[0]));
    expect(xs[0]).toBe(8);
    expect(xs[3]).toBe(92);
    // Higher score means smaller y (drawn upward).
    const ys = geometry.linePoints.split(" ")
      .map((pair) => Number(pair.split(",")[1]));
    expect(ys[2]).toBeLessThan(ys[0]!);
    // Deterministic.
    expect(ratingGraphGeometry([
      point(1, 4, 0), point(2, 4, 10), point(3, 5, 20), point(4, 5, 15),
    ], 100, 100)).toEqual(geometry);
  });

  it("declines to draw fewer than two points", () => {
    expect(ratingGraphGeometry([], 100, 100)).toBeNull();
    expect(ratingGraphGeometry([point(1, 4, 5)], 100, 100)).toBeNull();
  });

  it("maps pointer positions to the nearest race deterministically", () => {
    // Width 100, pads 8: four points at x = 8, 36, 64, 92.
    expect(nearestPointIndex(8, 100, 4)).toBe(0);
    expect(nearestPointIndex(23, 100, 4)).toBe(1);
    expect(nearestPointIndex(64, 100, 4)).toBe(2);
    expect(nearestPointIndex(95, 100, 4)).toBe(3);
    // Outside the padded area clamps to the edges.
    expect(nearestPointIndex(-20, 100, 4)).toBe(0);
    expect(nearestPointIndex(500, 100, 4)).toBe(3);
    expect(nearestPointIndex(50, 100, 1)).toBe(0);
  });
});
