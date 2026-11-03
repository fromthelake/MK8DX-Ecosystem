import { describe, expect, it, vi } from "vitest";

import { mountPlayerVisibilitySettings } from
  "../src/player-visibility-settings.js";
import {
  TimeTrialLifecycleClientError,
  type PlayerVisibilityClient,
} from "../src/time-trial-lifecycle-client.js";

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  parentNode: FakeNode | null = null;
  className = "";
  textContent: string | null = null;
  type = "";
  name = "";
  value = "";
  checked = false;
  disabled = false;
  hidden = false;
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();
  constructor(readonly tagName: string, readonly ownerDocument: FakeDocument) {}
  get firstChild(): FakeNode | null { return this.children[0] ?? null; }
  append(...nodes: FakeNode[]): void {
    for (const node of nodes) { node.parentNode = this; this.children.push(node); }
  }
  removeChild(node: FakeNode): FakeNode {
    const index = this.children.indexOf(node);
    if (index < 0) { throw new Error("synthetic child missing"); }
    this.children.splice(index, 1); node.parentNode = null; return node;
  }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  addEventListener(type: string, listener: (event: Event) => void): void {
    const values = this.listeners.get(type) ?? new Set();
    values.add(listener);
    this.listeners.set(type, values);
  }
  dispatch(type: string): void {
    const event = new Event(type, { cancelable: true });
    for (const listener of this.listeners.get(type) ?? []) { listener(event); }
  }
}
class FakeDocument {
  createElement(tagName: string): FakeNode { return new FakeNode(tagName, this); }
}
function descendants(root: FakeNode): FakeNode[] {
  return root.children.flatMap((child) => [child, ...descendants(child)]);
}
function node(root: FakeNode, value: string): FakeNode {
  const found = descendants(root).find((candidate) => candidate.textContent === value);
  if (found === undefined) { throw new Error(`synthetic node missing: ${value}`); }
  return found;
}
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const state = {
  playerId: "player.synthetic_racer_001",
  username: "SyntheticRacer",
  displayName: "Synthetic Racer",
  visibility: "public" as const,
};

function client(
  overrides: Partial<PlayerVisibilityClient> = {},
): PlayerVisibilityClient {
  return {
    async read() { return state; },
    async setOwn(visibility) { return { ...state, visibility }; },
    async setForPlayer(_playerId, visibility) {
      return { ...state, visibility };
    },
    ...overrides,
  };
}

describe("Player visibility settings", () => {
  it("offers Public Player and Private Player in the Player's own words", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountPlayerVisibilitySettings(
      root as unknown as HTMLElement, client(),
    );
    await mounted.ready;
    expect(node(root, "Public Player")).toBeDefined();
    expect(node(root, "Private Player")).toBeDefined();
    const shown = descendants(root).map((candidate) => candidate.textContent);
    // Never "public account": this is about the racing identity, and it
    // must be clear that nothing is deleted.
    expect(shown.some((value) => String(value).includes("account"))).toBe(true);
    expect(shown.some((value) =>
      String(value).includes("Nothing is deleted"))).toBe(true);
    expect(shown).not.toContain("Public account");
    expect(node(root, "You are a Public Player.")).toBeDefined();
    expect(descendants(root).find((candidate) =>
      candidate.value === "public")?.checked).toBe(true);
    mounted.unmount();
    expect(root.children).toHaveLength(0);
  });

  it("reflects an existing private Player and saves a change once", async () => {
    const setOwn = vi.fn(async () => ({ ...state, visibility: "public" as const }));
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountPlayerVisibilitySettings(
      root as unknown as HTMLElement,
      client({
        async read() { return { ...state, visibility: "private" }; },
        setOwn,
      }),
    );
    await mounted.ready;
    expect(descendants(root).find((candidate) =>
      candidate.value === "private")?.checked).toBe(true);
    expect(node(root, "You are a Private Player.")).toBeDefined();
    const publicChoice = descendants(root).find((candidate) =>
      candidate.value === "public")!;
    const privateChoice = descendants(root).find((candidate) =>
      candidate.value === "private")!;
    publicChoice.checked = true;
    privateChoice.checked = false;
    node(root, "Save").dispatch("click");
    await settle();
    expect(setOwn).toHaveBeenCalledWith("public", expect.any(AbortSignal));
    expect(node(root, "Saved. You are a Public Player.")).toBeDefined();
  });

  it("asks for a Player first instead of reporting a technical conflict", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountPlayerVisibilitySettings(
      root as unknown as HTMLElement,
      client({
        async read() {
          throw new TimeTrialLifecycleClientError("no_verified_player");
        },
      }),
    );
    await mounted.ready;
    expect(node(
      root, "Set up your Player first, then choose how it appears.",
    )).toBeDefined();
    // Nothing can be saved until a Player exists.
    expect(node(root, "Save").disabled).toBe(true);
  });
});
