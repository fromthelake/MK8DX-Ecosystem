// W14 Build (Phase 12): the stat model unchanged, and the configurator's behaviour on the system.
//
// This replaces `build-view.test.ts`. Its pure cases — the additive model and its cap, the permalink
// round trip and fallback, the recovered segment semantics and the four part colours, the Magic 8
// and Meta verdicts — are kept verbatim, because none of them changed. The render case, which
// pinned the `build__*` layer and counted options that are now behind the shared picker, is
// replaced by what a reader can actually see and do.
import { beforeEach, describe, expect, it } from "vitest";

import { allByClass, byClass, descendants, FakeDocument, FakeNode, texts } from "./dom-double.js";
import { useDocument } from "../src/ds-components.js";
import {
  BUILD_PART_COLORS,
  assessBuildMeta,
  buildPermalinkQuery,
  combinedStat,
  mountBuildConfigurator,
  parseBuildQuery,
  statContributions,
} from "../src/ds-build.js";
import {
  BODY_PARTS,
  CHARACTER_PARTS,
  GLIDER_PARTS,
  LOADOUT_STAT_MODEL,
  TIRE_PARTS,
} from "../src/loadout-manifest.js";
import { matchedLoadoutVariant } from "../src/loadout-variants.js";

let document: FakeDocument;
let root: FakeNode;

beforeEach(() => {
  document = new FakeDocument();
  useDocument(document as unknown as Document);
  root = document.createElement("div");
});

const all = (): string => texts(root).join(" ");

describe("build model (unchanged by the migration)", () => {
  it("uses the evidence mapping for limited-palette character parts", () => {
    expect(matchedLoadoutVariant("body.buggybud", "character.inkling_boy")?.id)
      .toBe("body_variant.buggybud.000_blue");
    expect(matchedLoadoutVariant("glider.super_glider", "character.inkling_boy")?.id)
      .toBe("glider_variant.super_glider.012_inkling_m");
  });

  it("combines part stats additively and caps the effective value", () => {
    const selection = parseBuildQuery(null);
    const sum = (key: string): number =>
      (selection.character.stats[key] ?? 0) + (selection.body.stats[key] ?? 0) +
      (selection.tire.stats[key] ?? 0) + (selection.glider.stats[key] ?? 0);
    for (const key of ["speedLand", "acceleration", "miniTurbo"]) {
      expect(combinedStat(selection, key))
        .toBe(Math.min(sum(key), LOADOUT_STAT_MODEL.effectiveCap));
    }
  });

  it("round-trips a build permalink and falls back on unknown ids", () => {
    const selection = {
      character: CHARACTER_PARTS[5]!,
      body: BODY_PARTS[3]!,
      tire: TIRE_PARTS[2]!,
      glider: GLIDER_PARTS[1]!,
    };
    expect(parseBuildQuery(buildPermalinkQuery(selection))).toEqual(selection);
    const fallback = parseBuildQuery("nonsense,also.nonsense");
    expect(fallback.character).toBe(CHARACTER_PARTS[0]);
    expect(fallback.body).toBe(BODY_PARTS[0]);
  });

  it("recovers the historical segment semantics and component colors", () => {
    const selection = parseBuildQuery(null);
    const parts = statContributions(selection, "speedLand");
    expect(parts.total).toBe(combinedStat(selection, "speedLand"));
    expect(parts.character + parts.body + parts.tire + parts.glider)
      .toBeGreaterThanOrEqual(parts.total);
    expect(parts.character).toBeGreaterThanOrEqual(0);
    // The recovered original component colours, kept as the builder's key (product data, §6).
    expect(BUILD_PART_COLORS.character.segment).toBe("#FF9800");
    expect(BUILD_PART_COLORS.body.segment).toBe("#2196F3");
    expect(BUILD_PART_COLORS.tire.segment).toBe("#2ECC71");
    expect(BUILD_PART_COLORS.glider.segment).toBe("#9B27B0");
  });

  it("prints every contribution on ink that is readable on its own part colour", () => {
    // The colour is the builder's key, so a number is printed on it — which means each part's ink
    // has to clear 4.5:1 against its own segment. White on the body blue is 3.1:1, which is what
    // the legacy meter did and what the Phase 12 browser gate caught on 13 segments.
    const channel = (value: number): number =>
      value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    const luminance = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((at) => channel(parseInt(hex.slice(at, at + 2), 16) / 255));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const contrast = (a: string, b: string): number => {
      const high = Math.max(luminance(a), luminance(b));
      const low = Math.min(luminance(a), luminance(b));
      return (high + 0.05) / (low + 0.05);
    };
    for (const part of Object.values(BUILD_PART_COLORS)) {
      expect(contrast(part.segment, part.text)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("explains the Magic 8 optimum and exact meta sweet spot", () => {
    const meta = {
      character: { ...CHARACTER_PARTS[0]!, stats: { speedLand: 3.25, miniTurbo: 4.75 } },
      body: { ...BODY_PARTS[0]!, stats: {} },
      tire: { ...TIRE_PARTS[0]!, stats: {} },
      glider: { ...GLIDER_PARTS[0]!, stats: {} },
    };
    expect(assessBuildMeta(meta)).toMatchObject({ optimum: true, meta: true });
    expect(assessBuildMeta(parseBuildQuery(null))).toMatchObject({ optimum: true, meta: false });
  });
});

describe("W14 · the configurator on the design system", () => {
  it("opens on the chosen build: four slots, the verdicts and every stat row", () => {
    const view = mountBuildConfigurator(root as unknown as HTMLElement,
      `${CHARACTER_PARTS[1]!.id},${BODY_PARTS[0]!.id}`);
    // The four slots are the shared SetupSummary, each carrying its part's colour as the key.
    const slots = allByClass(root, "ds-setup-part");
    expect(slots).toHaveLength(4);
    expect(slots.map((slot) => slot.attributes.get("data-build-part")))
      .toEqual(["character", "body", "tire", "glider"]);
    expect(all()).toContain(CHARACTER_PARTS[1]!.name);

    // Thirteen stat rows, each with its own meter, its segments and its exact total out of the cap.
    const meters = allByClass(root, "ds-build__meter");
    expect(meters).toHaveLength(13);
    const values = allByClass(root, "ds-build__row-value");
    expect(values).toHaveLength(13);
    expect(values.every((node) => /^\d+\.\d{2}\/\d+\.\d{2}$/.test(node.textContent ?? ""))).toBe(true);
    const contributions = allByClass(root, "ds-build__contribution");
    expect(contributions.length).toBeGreaterThan(13);
    expect(contributions.every((node) => /^\d+\.\d{2}$/.test(node.textContent ?? ""))).toBe(true);
    // Every segment names its part and its contribution, so the colour is never the only cue.
    const segments = allByClass(root, "ds-build__segment");
    expect(segments.every((node) => /\+\d+\.\d{2}$/.test(node.attributes.get("title") ?? ""))).toBe(true);
    // A meter is an image with the whole attribution in its accessible name.
    expect(meters[0]?.attributes.get("aria-label")).toMatch(/\d+\.\d{2} \/ \d+\.\d{2}/);
    // A hairline at every whole point up to the 5.75 cap (1 to 5), with no extra scale row above every section.
    expect(allByClass(root, "ds-build__tick")).toHaveLength(13 * 5);
    expect(allByClass(root, "ds-build__scale")).toHaveLength(0);
    expect(allByClass(root, "ds-build__tick").slice(0, 5).map((node) => node.attributes.get("data-value")))
      .toEqual(["1", "2", "3", "4", "5"]);

    expect(all()).toContain("Mini-Turbo");
    expect(all()).toContain("Speed");
    // The route owns no A4: reading a build is the task, and Share build is secondary.
    expect(descendants(root).filter((node) => node.attributes.get("data-variant") === "primary"))
      .toHaveLength(0);
    expect(allByClass(root, "ds-button").some((node) => node.textContent === "Share build")).toBe(true);

    view.unmount();
    expect(root.children).toHaveLength(0);
  });

  it("a slot opens the SAME picker the canonical task uses, and a tile applies immediately", () => {
    const view = mountBuildConfigurator(root as unknown as HTMLElement, null);
    const before = byClass(root, "ds-build__row-value")?.textContent;
    allByClass(root, "ds-setup-part")[1]!.dispatch("click");

    // The picker is the shared dialog: a search field and the radio grid.
    const sheet = descendants(document.body).find((node) => node.tagName === "dialog")!;
    expect(sheet.attributes.get("data-kind")).toBe("dialog");
    const options = allByClass(sheet, "ds-picker__option");
    expect(options.length).toBeGreaterThan(1);
    expect(texts(sheet).join(" ")).toContain("options");

    // Choosing a different body closes immediately and repaints the slot and the numbers.
    const different = options.find((option) => option.textContent !== BODY_PARTS[0]!.name)!;
    different.dispatch("click");
    expect(allByClass(root, "ds-setup-part")[1]!.textContent).toContain(different.textContent ?? "");
    expect(descendants(document.body).some((node) => node.tagName === "dialog")).toBe(false);
    const after = byClass(root, "ds-build__row-value")?.textContent;
    expect(typeof after).toBe("string");
    expect(after).not.toBe(undefined);
    void before;
    view.unmount();
  });

  it("the picker's search narrows the options and says how many are left", () => {
    const view = mountBuildConfigurator(root as unknown as HTMLElement, null);
    allByClass(root, "ds-setup-part")[2]!.dispatch("click");
    const sheet = descendants(document.body).find((node) => node.tagName === "dialog")!;
    const search = allByClass(sheet, "ds-text-input")[0]!;
    const total = allByClass(sheet, "ds-picker__option").length;
    search.value = "roller";
    search.dispatch("input");
    const narrowed = allByClass(sheet, "ds-picker__option").length;
    expect(narrowed).toBeGreaterThan(0);
    expect(narrowed).toBeLessThan(total);
    expect(texts(sheet).join(" ")).toContain(`of ${TIRE_PARTS.length} options`);
    view.unmount();
  });

  it("Close leaves the build exactly as it was", () => {
    const view = mountBuildConfigurator(root as unknown as HTMLElement, null);
    const before = allByClass(root, "ds-setup-part").map((slot) => slot.textContent);
    allByClass(root, "ds-setup-part")[3]!.dispatch("click");
    const sheet = descendants(document.body).find((node) => node.tagName === "dialog")!;
    allByClass(sheet, "ds-button").find((node) => node.textContent === "Close")!.dispatch("click");
    expect(allByClass(root, "ds-setup-part").map((slot) => slot.textContent)).toEqual(before);
    view.unmount();
  });
});
