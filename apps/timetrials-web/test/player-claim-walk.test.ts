import { describe, expect, it } from "vitest";

import {
  createClaimWalkClient,
  type ClaimWalkClient,
  type ClaimWalkItem,
} from "../src/claim-walk-client.js";
import { claimWalkStatusLine, mountPlayerClaimWalk } from "../src/player-claim-walk.js";

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  parentNode: FakeNode | null = null;
  className = "";
  textContent: string | null = null;
  type = "";
  name = "";
  value = "";
  maxLength = -1;
  rows = 0;
  disabled = false;
  hidden = false;
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();
  constructor(readonly tagName: string, readonly ownerDocument: FakeDocument) {}
  get firstChild(): FakeNode | null { return this.children[0] ?? null; }
  append(...nodes: FakeNode[]): void {
    for (const node of nodes) { node.parentNode = this; this.children.push(node); }
  }
  removeChild(node: FakeNode): FakeNode {
    this.children.splice(this.children.indexOf(node), 1);
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

function node(root: FakeNode, text: string): FakeNode {
  const found = descendants(root).find((candidate) => candidate.textContent === text);
  if (found === undefined) { throw new Error(`synthetic node missing: ${text}`); }
  return found;
}

async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1) { await Promise.resolve(); }
}

const now = Date.UTC(2026, 9, 31, 12);
const mal = { playerId: "player.synthetic_mal", username: "mal", displayName: "Mal" };

function item(overrides: Partial<ClaimWalkItem> = {}): ClaimWalkItem {
  return {
    playerClaimId: "player_claim.synthetic_walk_01",
    player: mal,
    claimStatus: "requested",
    disputeStatus: "none",
    requestedAtMs: now - 3 * 86_400_000,
    updatedAtMs: now - 86_400_000,
    reviewerDirectorNames: ["Evan"],
    lastDecision: null,
    notes: [],
    ...overrides,
  };
}

describe("the claim walk status line (ADR-0216)", () => {
  it("says who decides and how long it waits", () => {
    expect(claimWalkStatusLine(item(), now)).toMatch(/^Your request for Mal waits for Evan or the administrators since .* \(3 days\)\.$/);
    expect(claimWalkStatusLine(item({ reviewerDirectorNames: [] }), now)).toContain("waits for the administrators");
  });

  it("puts a reviewer's question first", () => {
    const asked = item({
      claimStatus: "under_review",
      notes: [{ role: "reviewer", kind: "question", body: "Which nights?", authorName: "Evan", createdAtMs: now }],
    });
    expect(claimWalkStatusLine(asked, now)).toBe("Evan has a question about Mal:");
  });

  it("names who declined or unlinked and why", () => {
    expect(claimWalkStatusLine(item({
      claimStatus: "rejected",
      lastDecision: { decision: "rejected", byRole: "director", byName: "Evan", reasonCode: "not_this_person", decidedAtMs: now },
    }), now)).toMatch(/^Declined by Evan on .*: they could not confirm that Mal is you\.$/);
    expect(claimWalkStatusLine(item({
      claimStatus: "revoked",
      lastDecision: { decision: "revoked", byRole: "administrator", byName: null, reasonCode: "person_asked", decidedAtMs: now },
    }), now)).toMatch(/^Mal was unlinked by an administrator on .*, because the person asked for it\.$/);
    expect(claimWalkStatusLine(item({ claimStatus: "verified" }), now)).toBe("Linked: you are Mal.");
  });
});

class FakeWalkClient implements ClaimWalkClient {
  items: readonly ClaimWalkItem[] = [];
  readonly calls: string[] = [];
  async listMine() { return this.items; }
  async reply(id: string, note: string) { this.calls.push(`reply|${id}|${note}`); }
  async release(id: string, note: string | undefined) { this.calls.push(`release|${id}|${note ?? ""}`); }
}

describe("the person's claim walk", () => {
  it("answers a question and unlinks only after the confirmation", async () => {
    const client = new FakeWalkClient();
    client.items = [
      item({
        claimStatus: "under_review",
        notes: [{ role: "reviewer", kind: "question", body: "Which nights?", authorName: "Evan", createdAtMs: now }],
      }),
      item({ playerClaimId: "player_claim.synthetic_walk_02", claimStatus: "verified", player: { ...mal, displayName: "Mal TT" } }),
    ];
    let changed = 0;
    const document = new FakeDocument();
    const root = document.createElement("div");
    const walk = mountPlayerClaimWalk(root as unknown as HTMLElement, client, () => { changed += 1; });
    await walk.ready;
    expect(node(root, "Which nights?")).toBeDefined();
    const answer = descendants(root).find((candidate) => candidate.name === "claim_reply_player_claim.synthetic_walk_01")!;
    answer.value = "TN10 to TN12";
    node(root, "Send").dispatch("click");
    await settle();
    expect(client.calls).toEqual(["reply|player_claim.synthetic_walk_01|TN10 to TN12"]);
    expect(changed).toBe(1);

    const unlink = node(root, "Unlink Mal TT");
    expect(unlink.parentNode?.parentNode?.hidden).toBe(true);
    node(root, "This is not me: unlink").dispatch("click");
    expect(unlink.parentNode?.parentNode?.hidden).toBe(false);
    unlink.dispatch("click");
    await settle();
    expect(client.calls.at(-1)).toBe("release|player_claim.synthetic_walk_02|");
  });
});

describe("the claim walk client", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });

  it("reads the walk key for key and refuses an unknown field", async () => {
    const walk = { schemaVersion: "mk8dx.account-player-claim-walk.v1", claims: [item()] };
    await expect(createClaimWalkClient(async () => json(walk)).listMine()).resolves.toEqual([item()]);
    const extra = { ...walk, claims: [{ ...item(), surprise: true }] };
    await expect(createClaimWalkClient(async () => json(extra)).listMine())
      .rejects.toMatchObject({ code: "invalid_response" });
  });

  it("posts a question with its note behind a CSRF proof", async () => {
    const requests: Array<Readonly<{ url: string; body?: string }>> = [];
    const client = createClaimWalkClient(async (url, init) => {
      requests.push({ url, ...(typeof init.body === "string" ? { body: init.body } : {}) });
      return url === "/v1/session/csrf"
        ? json({ schemaVersion: "mk8dx.web-csrf.v1", headerName: "x-mk8dx-csrf", value: "proof" })
        : json({});
    });
    await expect(client.review("player_claim.synthetic_walk_01", "request_information", { note: "  " }))
      .rejects.toMatchObject({ code: "invalid_input" });
    await client.review("player_claim.synthetic_walk_01", "request_information", { note: " Which nights? " });
    expect(requests.at(-1)).toEqual({
      url: "/v1/player-claims/player_claim.synthetic_walk_01/actions",
      body: JSON.stringify({ action: "request_information", evidenceIds: [], note: "Which nights?" }),
    });
  });
});
