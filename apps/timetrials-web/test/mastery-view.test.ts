import { afterEach, describe, expect, it, vi } from "vitest";

import { mountTrackMastery } from "../src/mastery-view.js";
import { descendants, FakeDocument } from "./dom-double.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Track Mastery engine context", () => {
  it("marks the preference-resolved engine as selected when its data arrives", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      schemaVersion: "mk8dx.public-player-track-bests.v1",
      bests: [],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountTrackMastery(
      root as unknown as HTMLElement,
      "player.synthetic_mastery_01",
      { readPreference: async () => "200" },
    );

    await mounted.ready;

    const selected = descendants(root).find((node) =>
      node.classList.contains("ds-engine-option") &&
      node.attributes.get("aria-checked") === "true");
    expect(selected?.attributes.get("data-engine")).toBe("200");
    expect(selected?.textContent).toContain("200cc");
  });
});
