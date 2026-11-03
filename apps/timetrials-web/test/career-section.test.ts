import { afterEach, describe, expect, it, vi } from "vitest";

import { chartPoints, fetchCareer, mountCareerSection } from "../src/career-section.js";
import { FakeDocument } from "./dom-double.js";

describe("player career section", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("refuses a combined count that disagrees with its engine breakdown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      schemaVersion: "mk8dx.public-player-career.v1",
      timeTrials: {
        published: 3, published150: 1, published200: 1,
        tracks150: 1, tracks200: 1,
        firsts: 0, firsts150: 0, firsts200: 0,
        podiums: 0, podiums150: 0, podiums200: 0,
      },
    }), { status: 200, headers: { "content-type": "application/json" } })));

    await expect(fetchCareer("player.synthetic", new AbortController().signal))
      .rejects.toThrow("career engine breakdown invalid");
  });

  it("maps rating history onto stable chart geometry", () => {
    const history = [
      { sequence: 0, eventType: "seed", occurredAtMs: 0, score: 25 },
      { sequence: 1, eventType: "race", occurredAtMs: 1, score: 27 },
      { sequence: 2, eventType: "race", occurredAtMs: 2, score: 26 },
    ] as const;
    const points = chartPoints(history, 600, 170, 18);
    expect(points).toHaveLength(3);
    expect(points[0]!.x).toBe(18);
    expect(points[2]!.x).toBe(582);
    // The highest score sits at the top of the inner area.
    expect(points[1]!.y).toBe(18);
    expect(points[0]!.y).toBe(152);
    // A single point centers horizontally instead of dividing by zero.
    expect(chartPoints([history[0]!], 600, 170, 18)[0]!.x).toBe(300);
  });

  it("renders Time Trial career facts without repeating the Tournament rating", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountCareerSection(
      root as unknown as HTMLElement,
      "player.synthetic",
      async () => ({
        timeTrials: {
          published: 105,
          published150: 101,
          published200: 4,
          tracks150: 96,
          tracks200: 4,
          firsts: 41,
          firsts150: 39,
          firsts200: 2,
          podiums: 88,
          podiums150: 84,
          podiums200: 4,
          mostPlayed: {
            trackId: "track.mario_kart_stadium", count: 9, count150: 8, count200: 1,
          },
        },
        rating: {
          score: 27.15,
          rank: 4,
          peakScore: 28.4,
          history: [{
            sequence: 0,
            eventType: "seed" as const,
            occurredAtMs: 1_899_000_000_000,
            score: 27.15,
          }],
        },
      }),
    );
    await mounted.ready;
    expect(mounted.container.getAttribute("aria-label")).toBe("Time Trial career");
    const text = root.textContent ?? "";
    expect(text).toContain("105");
    expect(text).toContain("96/96");
    expect(text).toContain("Leaderboard #1s");
    expect(text).toContain("Mario Kart Stadium");
    expect(text).toContain("150cc 39 · 200cc 2");
    expect(text).toContain("Time Trial career");
    expect(text).not.toContain("Ranked #4");
    expect(text).not.toContain("peak 28.40");
    expect(text).not.toContain("Rating");
    mounted.unmount();
    expect(root.children).toHaveLength(0);
  });
});
