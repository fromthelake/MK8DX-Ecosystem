import { describe, expect, it, vi } from "vitest";

import {
  AdministratorOverviewClientError,
  createAdministratorOverviewClient,
  parseAdministratorOverview,
  type AdministratorOverview,
} from "../src/administrator-overview-client.js";
import { mountAdministratorOverviewSection } from
  "../src/administrator-overview-section.js";

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  parentNode: FakeNode | null = null;
  className = "";
  textContent: string | null = null;
  type = "";
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();
  constructor(readonly tagName: string, readonly ownerDocument: FakeDocument) {}
  get firstChild(): FakeNode | null { return this.children[0] ?? null; }
  append(...nodes: FakeNode[]): void {
    for (const node of nodes) { node.parentNode = this; this.children.push(node); }
  }
  removeChild(node: FakeNode): FakeNode {
    const index = this.children.indexOf(node);
    if (index < 0) { throw new Error("synthetic child missing"); }
    this.children.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  addEventListener(type: string, listener: (event: Event) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) { listener(new Event(type)); }
  }
}

class FakeDocument {
  createElement(tagName: string): FakeNode { return new FakeNode(tagName, this); }
}

function descendants(root: FakeNode): FakeNode[] {
  return root.children.flatMap((child) => [child, ...descendants(child)]);
}

const overview: AdministratorOverview = {
  generatedAtMs: 1_800_000_000_000,
  registered: { signInIdentities: 9, accounts: 8, players: 71, linkedPlayers: 7, administrators: 1 },
  active: {
    last24h: { signedIn: 2, submitted: 1 },
    last7d: { signedIn: 5, submitted: 3 },
    last30d: { signedIn: 8, submitted: 3 },
  },
  pending: { playerClaims: 2 },
};

describe("administrator overview section", () => {
  it("shows the figures with a sentence each and opens the claims on request", async () => {
    const root = new FakeNode("div", new FakeDocument());
    const onOpenClaims = vi.fn();
    const mounted = mountAdministratorOverviewSection(root as never, {
      client: { overview: async () => overview },
      onOpenClaims,
    });
    await mounted.ready;

    const texts = descendants(root).map((node) => node.textContent).filter((t) => t !== null);
    expect(texts).toContain("Link requests waiting");
    expect(texts).toContain("Registered");
    expect(texts).toContain("people who have signed in at least once · 8 active accounts");
    expect(texts).toContain("7 linked to an account · 1 administrator");
    expect(texts).toContain("Active in the last 24 hours");
    expect(texts).toContain("signed in · 3 submitted a Time Trial");
    const figures = descendants(root)
      .filter((node) => node.className.split(" ").includes("admin-overview__figure"))
      .map((node) => node.textContent);
    expect(figures).toEqual(["2", "9", "71", "2", "5", "8"]);

    descendants(root).find((node) => node.textContent === "Review the link requests")!.dispatch("click");
    expect(onOpenClaims).toHaveBeenCalledOnce();
    mounted.unmount();
    expect(root.children).toHaveLength(0);
  });

  it("withdraws for somebody who is not an administrator", async () => {
    const root = new FakeNode("div", new FakeDocument());
    const mounted = mountAdministratorOverviewSection(root as never, {
      client: { overview: async () => { throw new AdministratorOverviewClientError("not_authorized"); } },
    });
    await mounted.ready;
    expect(root.children).toHaveLength(0);
  });
});

describe("administrator overview client", () => {
  const document = {
    schemaVersion: "mk8dx.administrator-overview.v1",
    generatedAtMs: 1_800_000_000_000,
    registered: { signInIdentities: 9, accounts: 8, players: 71, linkedPlayers: 7, administrators: 1 },
    active: {
      last24h: { signedIn: 2, submitted: 1 },
      last7d: { signedIn: 5, submitted: 3 },
      last30d: { signedIn: 8, submitted: 3 },
    },
    pending: { playerClaims: 2 },
  };

  it("reads the document and refuses a widened or wrong one", async () => {
    expect(parseAdministratorOverview(document)).toEqual(overview);
    expect(() => parseAdministratorOverview({ ...document, schemaVersion: "v2" }))
      .toThrow(AdministratorOverviewClientError);
    expect(() => parseAdministratorOverview({ ...document, pending: { playerClaims: -1 } }))
      .toThrow(AdministratorOverviewClientError);

    const fetchPort = vi.fn(async (_input: string) => new Response(JSON.stringify(document), { status: 200 }));
    const client = createAdministratorOverviewClient(fetchPort as never);
    expect(await client.overview()).toEqual(overview);
    expect(fetchPort.mock.calls[0]![0]).toBe("/v1/administrator/overview");

    const refused = createAdministratorOverviewClient(vi.fn(async () =>
      new Response("{}", { status: 403 })) as never);
    await expect(refused.overview()).rejects.toMatchObject({ code: "not_authorized" });
  });
});
