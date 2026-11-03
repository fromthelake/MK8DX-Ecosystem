// W06 Tracks & Cups (Phase 12): behaviour and the design-system contract, not class names.
//
// This replaces `cups-view.test.ts`, which pinned the deleted `cups-view__*` layer. Every capability
// it asserted is asserted here — the 24 cups, a cup's four tracks, the track's visual identity, the
// search, its cap, the empty state and the way back — plus what the migration added: the resolved
// engine travelling into every track link (R4), and the directory owning no A4.
import { describe, expect, it } from "vitest";

import { allByClass, byClass, descendants, FakeDocument, FakeNode, texts } from "./dom-double.js";
import { useDocument } from "../src/ds-components.js";
import { mountCupsView, type CupsViewOptions } from "../src/ds-cups.js";

function mount(options: CupsViewOptions = {}): Readonly<{ root: FakeNode; view: ReturnType<typeof mountCupsView> }> {
  const document = new FakeDocument();
  useDocument(document as unknown as Document);
  const root = document.createElement("div");
  const view = mountCupsView(root as unknown as HTMLElement, options);
  return { root, view };
}

const cups = (root: FakeNode): FakeNode[] => allByClass(root, "ds-cups__cup");
const cards = (root: FakeNode): FakeNode[] => allByClass(root, "ds-card");
const search = (root: FakeNode): FakeNode => byClass(root, "ds-cups__search")!;

describe("W06 · the track directory", () => {
  it("opens on the 24 cups and says how much it covers", () => {
    const { root } = mount();
    expect(cups(root)).toHaveLength(24);
    expect(byClass(root, "ds-cups__mobile-title")?.textContent).toBe("Choose a Cup");
    expect(byClass(root, "ds-cups__mobile-meta")?.textContent).toBe("24 cups · 96 tracks");
    expect(byClass(root, "ds-cups__search-label")?.textContent).toBe("Search tracks");
    expect(texts(root).join(" ")).toContain("24 cups");
    expect(texts(root).join(" ")).toContain("96 tracks");
    // A directory navigates; it owns no primary action (§4).
    expect(descendants(root).filter((node) => node.attributes.get("data-variant") === "primary"))
      .toHaveLength(0);
  });

  it("a cup opens its four tracks, each with its art, its cup and a way back", () => {
    const { root } = mount();
    const scrollPositions: number[][] = [];
    root.ownerDocument.defaultView = { scrollTo: (x: number, y: number) => scrollPositions.push([x, y]) };
    cups(root)[0]!.dispatch("click");
    expect(scrollPositions).toEqual([[0, 0]]);
    expect(byClass(root, "ds-cups__mobile-title")?.textContent).toBe("Mushroom Cup");
    expect(byClass(root, "ds-cups__mobile-meta")?.textContent).toBe("Choose your track");
    expect(cards(root)).toHaveLength(4);
    expect(allByClass(root, "ds-thumb__art")).toHaveLength(4);
    expect(allByClass(root, "ds-thumb__badge")).toHaveLength(4);
    expect(allByClass(root, "ds-cups__track-cup")).toHaveLength(4);
    expect(allByClass(root, "ds-cups__mobile-cup")).toHaveLength(1);
    expect(byClass(root, "ds-card__title")?.textContent).toBe("Mario Kart Stadium");
    expect(byClass(root, "ds-card__body")?.textContent).toBe("3 laps · Base game");
    expect(allByClass(root, "ds-cups__mobile-back")).toHaveLength(1);
    const back = allByClass(root, "ds-button").find((node) => node.textContent === "All cups")!;
    back.dispatch("click");
    expect(scrollPositions).toEqual([[0, 0], [0, 0]]);
    expect(cups(root)).toHaveLength(24);
    expect(byClass(root, "ds-cups__mobile-title")?.textContent).toBe("Choose a Cup");
  });

  it("uses the catalog's lap count and expansion origin in track cards", () => {
    const { root } = mount();
    cups(root)[12]!.dispatch("click");
    expect(cards(root)).toHaveLength(4);
    expect(byClass(root, "ds-card__body")?.textContent).toContain("Booster Course Pass");
  });

  it("search finds a track, caps the list and says when nothing matches", () => {
    const { root } = mount();
    const field = search(root);
    field.value = "mario kart stadium";
    field.dispatch("input");
    expect(cards(root)).toHaveLength(1);
    expect(byClass(root, "ds-cups__mobile-meta")?.textContent).toBe("1 track");
    expect(texts(root).join(" ")).toContain("1 track");
    expect(byClass(root, "ds-cups__status")?.textContent).toBe("1 track");

    field.value = "mario";
    field.dispatch("input");
    expect(cards(root)).toHaveLength(6);
    expect(byClass(root, "ds-cups__status")?.textContent).toBe("6 tracks");

    field.value = "circuit";
    field.dispatch("input");
    expect(cards(root).length).toBeLessThanOrEqual(24);

    field.value = "not-a-real-track";
    field.dispatch("input");
    expect(byClass(root, "ds-cups__status")?.textContent).toBe("0 tracks");
    expect(texts(root).join(" ")).toContain("No track matches that search.");
    expect(byClass(root, "ds-state")?.attributes.get("data-state")).toBe("empty");
  });

  it("a single letter is not a search: the cups stay", () => {
    const { root } = mount();
    const field = search(root);
    field.value = "m";
    field.dispatch("input");
    expect(cups(root)).toHaveLength(24);
  });

  it("unmounting takes the whole page with it", () => {
    const { root, view } = mount();
    view.unmount();
    expect(root.children).toHaveLength(0);
  });
});

describe("W06 · engine context (R4)", () => {
  it("without a resolved engine the link leaves it to the track page — never an invented 150", () => {
    const { root, view } = mount();
    cups(root)[0]!.dispatch("click");
    const href = cards(root)[0]!.attributes.get("href") ?? "";
    expect(href).toBe("/?leaderboard=track.mario_kart_stadium");
    expect(href).not.toContain("mode=150");
    expect(view.engine()).toBeNull();
  });

  it("a resolved engine travels into every track link", () => {
    const { root } = mount({ engine: 200 });
    cups(root)[0]!.dispatch("click");
    for (const card of cards(root)) {
      expect(card.attributes.get("href")).toContain("mode=200");
    }
  });

  it("the selector repaints the links and tells the route to rewrite the address", () => {
    const changes: number[] = [];
    const { root, view } = mount({ engine: 150, onEngineChange: (next) => changes.push(next) });
    expect(allByClass(root, "ds-engine-selector")).toHaveLength(1);
    cups(root)[0]!.dispatch("click");
    expect(cards(root)[0]!.attributes.get("href")).toContain("mode=150");

    const option = descendants(root)
      .find((node) => node.className.includes("ds-engine-option") && node.attributes.get("data-engine") === "200")!;
    option.dispatch("click");
    expect(changes).toEqual([200]);
    expect(view.engine()).toBe(200);
    // The view on screen was a cup detail; after the switch its links carry the new engine.
    expect(cards(root)[0]!.attributes.get("href")).toContain("mode=200");
  });

  it("an embedded consumer's own destination is left alone", () => {
    const { root } = mount({ engine: 200, trackHref: (trackId) => `/embedded/${trackId}` });
    cups(root)[0]!.dispatch("click");
    expect(cards(root)[0]!.attributes.get("href")).toBe("/embedded/track.mario_kart_stadium");
  });

  it("a chooser keeps the canonical href and handles a plain click in place", () => {
    const chosen: string[] = [];
    const { root } = mount({
      engine: 150,
      purpose: "post",
      trackHref: (trackId) => `/?post=${trackId}&mode=150`,
      onTrackChosen: (trackId) => chosen.push(trackId),
    });
    cups(root)[0]!.click();
    const card = cards(root)[0]!;
    expect(card.attributes.get("href")).toBe("/?post=track.mario_kart_stadium&mode=150");
    card.click();
    expect(chosen).toEqual(["track.mario_kart_stadium"]);
    expect(texts(root).join(" ")).toContain("opens in Post a time");
  });
});
