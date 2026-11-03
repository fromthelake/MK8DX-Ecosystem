import { describe, expect, it } from "vitest";

import { mountAdministratorClaimReviewSection } from
  "../src/administrator-claim-review-section.js";
import type {
  ClaimReviewCard,
  ClaimReviewClient,
  ClaimReviewQueue,
  ReviewAction,
} from "../src/claim-walk-client.js";
import { PlayerClaimClientError } from "../src/player-claim-client.js";

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  parentNode: FakeNode | null = null;
  className = "";
  id = "";
  textContent: string | null = null;
  type = "";
  name = "";
  value = "";
  maxLength = -1;
  rows = 0;
  disabled = false;
  checked = false;
  hidden = false;
  href = "";
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
  focus(): void {}
  addEventListener(type: string, listener: (event: Event) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
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

function node(root: FakeNode, text: string): FakeNode {
  const result = descendants(root).find((candidate) => candidate.textContent === text);
  if (result === undefined) { throw new Error(`synthetic node missing: ${text}`); }
  return result;
}

function texts(root: FakeNode): string {
  return descendants(root).map((candidate) => candidate.textContent ?? "").join("\n");
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) { await Promise.resolve(); }
}

const mal = { playerId: "player.synthetic_mal", username: "mal", displayName: "Mal" };
const malTt = { playerId: "player.synthetic_mal_tt", username: "mal_tt", displayName: "Mal TT" };

function card(overrides: Partial<ClaimReviewCard> = {}): ClaimReviewCard {
  return {
    playerClaimId: "player_claim.synthetic_review_01",
    claimStatus: "requested",
    disputeStatus: "none",
    requestedAtMs: 1_790_000_000_000,
    updatedAtMs: 1_790_000_000_000,
    reviewerRole: "director",
    requester: { userAccountId: "user_account.synthetic_requester", accountCreatedAtMs: 1_780_000_000_000, verifiedPlayers: [malTt] },
    player: {
      ...mal,
      tournamentNights: 3,
      lastNightName: "TN12",
      lastNightDate: "2026-09-12",
      directorNames: ["Evan"],
      conservativeRating: 21.46,
      publishedTimeTrials: 0,
      otherOpenClaims: 0,
    },
    conflicts: { playerAlreadyLinked: false, sharedTournament: null },
    notes: [{ role: "requester", kind: "request", body: "I raced TN12 as Mal", authorName: null, createdAtMs: 1_790_000_000_000 }],
    ...overrides,
  };
}

class FakeClient implements ClaimReviewClient {
  queue: ClaimReviewQueue = { open: [card()], linked: [] };
  readonly calls: Array<Readonly<{ action: ReviewAction; note?: string; reasonCode?: string }>> = [];
  failure: Error | null = null;
  async listReviews(): Promise<ClaimReviewQueue> {
    if (this.failure !== null) { throw this.failure; }
    return this.queue;
  }
  async review(_id: string, action: ReviewAction, options: Readonly<{ note?: string; reasonCode?: string }>): Promise<void> {
    this.calls.push({ action, ...options });
  }
}

function mount(client: FakeClient, hideWhenEmpty = false) {
  const document = new FakeDocument();
  const root = document.createElement("div");
  const mounted = mountAdministratorClaimReviewSection(
    root as unknown as HTMLElement,
    client,
    { hideWhenEmpty },
  );
  return { root, mounted };
}

describe("claim review cards (ADR-0216)", () => {
  it("says who asks, what is asked for and what approving changes", async () => {
    const client = new FakeClient();
    const { root, mounted } = mount(client);
    await mounted.ready;
    const shown = texts(root);
    expect(shown).toContain("Somebody asks to be linked to Mal (@mal)");
    expect(shown).toContain("already owns Mal TT (@mal_tt)");
    expect(shown).toContain("3 Tournament nights · last: TN12 (2026-09-12) · Director: Evan · rating 21.5");
    expect(shown).toContain("Nothing is merged, and it can be undone.");
    expect(shown).toContain("I raced TN12 as Mal");
    expect(shown).toContain("you review this as Director of their nights");
    expect(shown).not.toContain("reason code");
  });

  it("approves with one button, starting the review first, and passes the note", async () => {
    const client = new FakeClient();
    const { root, mounted } = mount(client);
    await mounted.ready;
    const textarea = descendants(root).find((candidate) => candidate.tagName === "textarea")!;
    textarea.value = "Welcome back";
    node(root, "Approve: this is them").dispatch("click");
    await settle();
    expect(client.calls).toEqual([
      { action: "start_review" },
      { action: "verify", note: "Welcome back" },
    ]);
  });

  it("asks for a question before sending one", async () => {
    const client = new FakeClient();
    const { root, mounted } = mount(client);
    await mounted.ready;
    node(root, "Ask for more information").dispatch("click");
    await settle();
    expect(client.calls).toEqual([]);
    expect(texts(root)).toContain("Write a question for the person first.");
  });

  it("states a conflict and does not offer approval", async () => {
    const client = new FakeClient();
    client.queue = { open: [card({ conflicts: { playerAlreadyLinked: false, sharedTournament: "TN11" } })], linked: [] };
    const { root, mounted } = mount(client);
    await mounted.ready;
    expect(texts(root)).toContain("raced against Mal in TN11, so they are two people.");
    expect(node(root, "Approve: this is them").disabled).toBe(true);
  });

  it("unlinks a linked Player with a chosen reason after a second step", async () => {
    const client = new FakeClient();
    client.queue = {
      open: [],
      linked: [{ playerClaimId: "player_claim.synthetic_linked", player: mal, accountPlayers: [], linkedAtMs: 1, reviewerRole: "administrator" }],
    };
    const { root, mounted } = mount(client);
    await mounted.ready;
    expect(node(root, "Unlink Mal").parentNode?.parentNode?.hidden).toBe(true);
    node(root, "Unlink…").dispatch("click");
    const asked = descendants(root).find((candidate) => candidate.value === "person_asked")!;
    for (const radio of descendants(root).filter((candidate) => candidate.type === "radio")) { radio.checked = false; }
    asked.checked = true;
    node(root, "Unlink Mal").dispatch("click");
    await settle();
    expect(client.calls).toEqual([{ action: "revoke", reasonCode: "person_asked", note: "" }]);
  });

  it("stays hidden for a Director with nothing to review, and leaves for a signed-out visitor", async () => {
    const client = new FakeClient();
    client.queue = { open: [], linked: [] };
    const quiet = mount(client, true);
    await quiet.mounted.ready;
    expect(quiet.root.children[0]?.hidden).toBe(true);

    client.failure = new PlayerClaimClientError("not_authenticated");
    const gone = mount(client);
    await gone.mounted.ready;
    expect(gone.root.children).toHaveLength(0);
  });
});
