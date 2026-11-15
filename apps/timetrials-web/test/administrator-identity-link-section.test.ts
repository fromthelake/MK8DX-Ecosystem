import { describe, expect, it } from "vitest";

import { mountAdministratorIdentityLinkSection } from "../src/administrator-identity-link-section.js";
import {
  createIdentityLinkClient,
  IdentityLinkClientError,
  type IdentityLinkClient,
} from "../src/identity-link-client.js";

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
  hidden = false;
  constructor(readonly tagName: string, readonly ownerDocument: FakeDocument) {}
  append(...nodes: FakeNode[]): void {
    for (const node of nodes) { node.parentNode = this; this.children.push(node); }
  }
  get firstChild(): FakeNode | null { return this.children[0] ?? null; }
  removeChild(node: FakeNode): FakeNode {
    this.children.splice(this.children.indexOf(node), 1);
    node.parentNode = null;
    return node;
  }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  fire(type: string): void { for (const listener of this.listeners.get(type) ?? []) { listener(); } }
}

class FakeDocument {
  createElement(tagName: string): FakeNode { return new FakeNode(tagName, this); }
}

const descendants = (root: FakeNode): FakeNode[] => root.children.flatMap((child) => [child, ...descendants(child)]);
const textOf = (node: FakeNode): string => [node, ...descendants(node)].map((child) => child.textContent ?? "").join(" ");
const settle = async (): Promise<void> => { for (let index = 0; index < 8; index += 1) { await Promise.resolve(); } };

const overview = {
  accounts: [{
    userAccountId: "user_account.a", email: "someone@example.test", accountStatus: "active",
    screenName: null, linkedPlayerId: null, linkedPlayerName: null, playerClaimId: null,
  }],
  players: [],
};

function mount(client: IdentityLinkClient) {
  const document = new FakeDocument();
  const root = document.createElement("div");
  mountAdministratorIdentityLinkSection(root as unknown as HTMLElement, client);
  const open = descendants(root).find((node) => node.className.includes("identity-link-open"))!;
  return { root, open };
}

describe("administrator accounts list (every account's e-mail address)", () => {
  it("loads nothing until the administrator opens it", async () => {
    let calls = 0;
    const { root, open } = mount({
      async overview() { calls += 1; return overview; },
      async link() {}, async unlink() {},
    });
    await settle();
    expect(calls).toBe(0);
    expect(textOf(root)).not.toContain("someone@example.test");
    open.fire("click");
    await settle();
    expect(calls).toBe(1);
    expect(descendants(root)).not.toContain(open);
    expect(textOf(root)).toContain("someone@example.test");
  });

  it("stays closed and offers the button again when the fresh confirmation was not given", async () => {
    const { root, open } = mount({
      async overview() { throw new IdentityLinkClientError("step_up_required"); },
      async link() {}, async unlink() {},
    });
    open.fire("click");
    await settle();
    expect(root.children.length).toBe(1);
    expect(descendants(root)).toContain(open);
    expect(textOf(root)).toContain("fresh confirmation");
  });

  it("recognises the server's step-up answer", async () => {
    const client = createIdentityLinkClient(async () => new Response(
      JSON.stringify({ code: "step_up_required", message: "Confirm." }),
      { status: 403, headers: { "x-mk8dx-step-up": "required", "content-type": "application/json" } }));
    await expect(client.overview()).rejects.toMatchObject({ code: "step_up_required" });
    const plain = createIdentityLinkClient(async () => new Response(
      JSON.stringify({ code: "identity_link_forbidden", message: "No." }), { status: 403 }));
    await expect(plain.overview()).rejects.toMatchObject({ code: "not_authorized" });
  });
});
