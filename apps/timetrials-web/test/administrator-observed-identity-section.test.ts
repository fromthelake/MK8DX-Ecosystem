import { describe, expect, it } from "vitest";

import {
  evidenceOf,
  mountAdministratorObservedIdentitySection,
  needsReview,
} from "../src/administrator-observed-identity-section.js";
import {
  ObservedIdentityClientError,
  type ObservedIdentityClient,
  type ObservedIdentityLink,
} from "../src/observed-identity-client.js";

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Set<() => void>>();
  parentNode: FakeNode | null = null;
  className = "";
  textContent: string | null = null;
  id = "";
  type = "";
  value = "";
  placeholder = "";
  checked = false;
  selected = false;
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
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  fire(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) { listener(); }
  }
}

class FakeDocument {
  createElement(tagName: string): FakeNode { return new FakeNode(tagName, this); }
}

/** The row elements themselves; their children share the class prefix. */
function rowsIn(root: FakeNode): FakeNode[] {
  return descendants(root).filter((node) => node.tagName === "li");
}

function descendants(root: FakeNode): FakeNode[] {
  return root.children.flatMap((child) => [child, ...descendants(child)]);
}

function textOf(node: FakeNode): string {
  return [node, ...descendants(node)]
    .map((child) => child.textContent ?? "").join(" ");
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) { await Promise.resolve(); }
}

function link(overrides: Partial<ObservedIdentityLink> = {}): ObservedIdentityLink {
  return {
    linkId: "12", tournamentNumber: 7, sectionId: "3", sectionName: "Talent",
    legacySectionLabel: "TN7: 2e Divisie", observedName: "Wanda",
    playerId: "player.tobias", playerName: "Tobias",
    decisionSource: "derived", orderAgreement: 1, videoPoints: 242,
    historyPoints: 242, note: null, placements: 27, ...overrides,
  };
}

function client(
  links: readonly ObservedIdentityLink[],
  hooks: Partial<ObservedIdentityClient> = {},
): ObservedIdentityClient {
  return {
    async overview() {
      return {
        links,
        players: [
          { playerId: "player.tobias", displayName: "Tobias", tournamentRaces: 92 },
          { playerId: "player.wanda", displayName: "Wanda", tournamentRaces: 120 },
        ],
      };
    },
    async assign() { /* overridden per test */ },
    async restore() { /* overridden per test */ },
    ...hooks,
  };
}

function mount(
  observedClient: ObservedIdentityClient,
): Readonly<{ root: FakeNode; mounted: ReturnType<typeof mountAdministratorObservedIdentitySection> }> {
  const document = new FakeDocument();
  const root = document.createElement("div");
  const mounted = mountAdministratorObservedIdentitySection(
    root as unknown as HTMLElement, observedClient);
  return { root, mounted };
}

describe("evidenceOf", () => {
  it("states the reasoning rather than asking to be trusted", () => {
    expect(evidenceOf(link())).toContain("100%");
    expect(evidenceOf(link())).toContain("242");
    expect(evidenceOf(link())).toContain("27 races");
  });

  it("shows both totals when they disagree", () => {
    const text = evidenceOf(link({ videoPoints: 274, historyPoints: 263 }));
    expect(text).toContain("274");
    expect(text).toContain("263");
  });
});

describe("needsReview", () => {
  it("flags a pairing the two accounts do not agree on", () => {
    expect(needsReview(link({ orderAgreement: 0.94 }))).toBe(true);
    expect(needsReview(link({ videoPoints: 274, historyPoints: 263 }))).toBe(true);
  });

  it("leaves an exact pairing alone", () => {
    expect(needsReview(link())).toBe(false);
  });

  it("never flags a link a person already decided", () => {
    expect(needsReview(link({
      decisionSource: "manual", orderAgreement: 0.5,
    }))).toBe(false);
  });
});

describe("observed identity section", () => {
  it("lists every link with its evidence and a way to change it", async () => {
    const { root, mounted } = mount(client([link()]));
    await mounted.ready;
    await settle();
    const rows = rowsIn(root);
    expect(rows).toHaveLength(1);
    expect(textOf(rows[0]!)).toContain("Wanda");
    expect(textOf(rows[0]!)).toContain("TN7");
    const select = descendants(root).find((node) => node.tagName === "select")!;
    // Every player is offered, with the current one preselected.
    expect(select.children.map((option) => option.value))
      .toEqual(["player.tobias", "player.wanda"]);
    expect(select.children[0]!.selected).toBe(true);
  });

  it("saves the player a person picks", async () => {
    const calls: Array<readonly [string, string]> = [];
    const { root, mounted } = mount(client([link()], {
      async assign(linkId, playerId) { calls.push([linkId, playerId]); },
    }));
    await mounted.ready;
    await settle();
    const select = descendants(root).find((node) => node.tagName === "select")!;
    select.value = "player.wanda";
    select.fire("change");
    await settle();
    expect(calls).toEqual([["12", "player.wanda"]]);
  });

  it("does not save when the choice did not change", async () => {
    let saved = 0;
    const { root, mounted } = mount(client([link()], {
      async assign() { saved += 1; },
    }));
    await mounted.ready;
    await settle();
    const select = descendants(root).find((node) => node.tagName === "select")!;
    select.value = "player.tobias";
    select.fire("change");
    await settle();
    expect(saved).toBe(0);
  });

  it("marks a corrected link and offers to hand it back", async () => {
    let restored: string | null = null;
    const { root, mounted } = mount(client([
      link({ decisionSource: "manual", note: "it was Wanda after all" }),
    ], {
      async restore(linkId) { restored = linkId; },
    }));
    await mounted.ready;
    await settle();
    const row = rowsIn(root)
      .find((node) => node.className.includes("observed-identity-row--manual"))!;
    expect(textOf(row)).toContain("it was Wanda after all");
    const undo = descendants(row).find((node) => node.tagName === "button")!;
    undo.fire("click");
    await settle();
    expect(restored).toBe("12");
  });

  it("can narrow a long list down to the disagreements", async () => {
    const { root, mounted } = mount(client([
      link({ linkId: "1", observedName: "Exact" }),
      link({ linkId: "2", observedName: "Odd", orderAgreement: 0.94 }),
    ]));
    await mounted.ready;
    await settle();
    const box = descendants(root)
      .find((node) => node.tagName === "input" && node.type === "checkbox")!;
    box.checked = true;
    box.fire("change");
    await settle();
    const rows = rowsIn(root);
    expect(rows).toHaveLength(1);
    expect(textOf(rows[0]!)).toContain("Odd");
  });

  it("says plainly when it is not an administrator surface", async () => {
    const { root, mounted } = mount({
      async overview() {
        throw new ObservedIdentityClientError("not_authorized");
      },
      async assign() { /* unused */ },
      async restore() { /* unused */ },
    });
    await mounted.ready;
    await settle();
    expect(textOf(root)).toContain("administrator");
  });
});
