import { describe, expect, it } from "vitest";

import { AVATAR_GROUPS, avatarAppearance } from "../src/avatar-manifest.js";
import { mountAvatarSettings } from "../src/avatar-settings.js";

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, () => void>();
  parentNode: FakeNode | null = null;
  className = "";
  textContent: string | null = null;
  type = "";
  src = "";
  alt = "";
  title = "";
  loading = "";
  hidden = false;
  disabled = false;
  constructor(readonly tagName: string, readonly ownerDocument: FakeDocument) {}
  append(...nodes: FakeNode[]): void {
    for (const node of nodes) { node.parentNode = this; this.children.push(node); }
  }
  get firstChild(): FakeNode | null { return this.children[0] ?? null; }
  removeChild(node: FakeNode): FakeNode {
    const index = this.children.indexOf(node);
    if (index < 0) { throw new Error("synthetic child missing"); }
    this.children.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  addEventListener(name: string, handler: () => void): void {
    this.listeners.set(name, handler);
  }
  click(): void { this.listeners.get("click")?.(); }
}
class FakeDocument {
  createElement(tagName: string): FakeNode { return new FakeNode(tagName, this); }
}
function descendants(root: FakeNode): FakeNode[] {
  return root.children.flatMap((child) => [child, ...descendants(child)]);
}

describe("profile character selection", () => {
  it("exposes the full canonical appearance set with variants grouped", () => {
    expect(AVATAR_GROUPS.length).toBeGreaterThan(0);
    const total = AVATAR_GROUPS.length +
      AVATAR_GROUPS.reduce((sum, group) => sum + group.variants.length, 0);
    // 54 base characters + 28 canonical variants = 82 appearances; the
    // exact numbers come from the pinned catalog, never hard-coded logic.
    expect(total).toBe(82);
    const yoshi = AVATAR_GROUPS.find((group) => group.id === "character.yoshi");
    expect(yoshi).toBeDefined();
    expect(yoshi!.variants.length).toBeGreaterThan(0);
    for (const variant of yoshi!.variants) {
      expect(variant.id.startsWith("character_variant.yoshi.")).toBe(true);
      expect(variant.iconPath.startsWith("images/characters/menu/")).toBe(true);
    }
    expect(avatarAppearance("character.mario")?.name).toBe("Mario");
    expect(avatarAppearance("nonsense")).toBeUndefined();
  });

  it("selects a base, expands its variants, and persists the exact id", async () => {
    const saved: (string | null)[] = [];
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountAvatarSettings(
      root as unknown as HTMLElement,
      { async setAvatar(avatarId) { saved.push(avatarId); } },
      null,
    );
    const nodes = descendants(root);
    const yoshi = AVATAR_GROUPS.find((group) => group.id === "character.yoshi")!;
    const yoshiButton = nodes.find((node) =>
      node.attributes.get("aria-label") === yoshi.name &&
      node.tagName === "button")!;
    yoshiButton.click();
    const variant = yoshi.variants[0]!;
    const variantButton = descendants(root).find((node) =>
      node.attributes.get("aria-label") === variant.name &&
      node.tagName === "button")!;
    variantButton.click();
    const save = descendants(root).find((node) =>
      node.textContent === "Save")!;
    save.click();
    await Promise.resolve();
    expect(saved).toEqual([variant.id]);
    const texts = descendants(root).map((node) => node.textContent);
    expect(texts).toContain(variant.name);
    mounted.unmount();
    expect(root.children).toHaveLength(0);
  });
});
