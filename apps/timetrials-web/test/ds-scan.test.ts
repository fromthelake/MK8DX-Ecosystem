import { beforeEach, describe, expect, it } from "vitest";

import { useDocument } from "../src/ds-components.js";
import { openScanSourcePicker } from "../src/ds-scan.js";
import { byClass, descendants, FakeDocument } from "./dom-double.js";

let document: FakeDocument;

beforeEach(() => {
  document = new FakeDocument();
  useDocument(document as unknown as Document);
});

describe("scan source picker", () => {
  it("offers exactly the two illustrated camera modes and opens one immediately", () => {
    const choices: string[] = [];
    openScanSourcePicker({ onChoose: (source) => choices.push(source), storage: null });

    const dialog = document.body.querySelector("dialog")!;
    const cards = descendants(dialog).filter((node) => node.classList.contains("ds-scan-source"));
    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.getAttribute("data-source"))).toEqual([
      "ghost_detail", "endscreen",
    ]);
    expect(cards.map((card) => card.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining("👻 Ghost Select screen"),
      expect.stringContaining("🎴 Race End Screen"),
    ]));
    expect(cards[1]?.textContent)
      .toContain("The end time(s) shown directly after a run.");
    expect(cards[1]?.textContent).not.toContain("two result cards");
    expect(descendants(dialog).filter((node) => node.tagName === "img").map((node) => node.src))
      .toEqual([
        "/assets/images/scan/ghost-select.png",
        "/assets/images/scan/race-end.jpg",
      ]);
    expect(byClass(dialog, "ds-dialog__actions")?.childElementCount).toBe(0);

    cards[1]!.click();
    expect(choices).toEqual(["endscreen"]);
    expect(document.body.querySelector("dialog")).toBeNull();
  });
});
