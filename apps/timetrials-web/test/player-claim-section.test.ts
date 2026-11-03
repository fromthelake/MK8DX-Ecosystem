import { describe, expect, it, vi } from "vitest";

import {
  PlayerClaimClientError,
  type PlayerClaimClient,
} from "../src/player-claim-client.js";
import type { PlayerVisibilityClient } from
  "../src/time-trial-lifecycle-client.js";
import { mountPlayerClaimSection } from "../src/player-claim-section.js";

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
  minLength = -1;
  maxLength = -1;
  required = false;
  autocomplete = "";
  disabled = false;
  checked = false;
  hidden = false;
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();
  constructor(readonly tagName: string, readonly ownerDocument: FakeDocument) {}
  get firstChild(): FakeNode | null { return this.children[0] ?? null; }
  append(...nodes: FakeNode[]): void {
    for (const node of nodes) {
      node.parentNode = this;
      this.children.push(node);
    }
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
}

function visibilityClient(
  overrides: Partial<PlayerVisibilityClient> = {},
): PlayerVisibilityClient {
  return {
    async read() { throw new Error("unused"); },
    async setOwn() { throw new Error("must not set visibility"); },
    async setForPlayer() { throw new Error("unused"); },
    ...overrides,
  };
}

describe("Player claim product section", () => {
  it("requires explicit search, selection, and confirmation", async () => {
    const search = vi.fn(async () => [{
      playerId: "player.synthetic_claim_ui_01",
      username: "SyntheticRacer",
      displayName: "Synthetic Racer",
      aliases: [] as readonly string[],
    }]);
    const request = vi.fn(async () => ({
      playerClaimId: "player_claim.synthetic_claim_ui_01",
      playerId: "player.synthetic_claim_ui_01",
      claimStatus: "requested" as const,
      disputeStatus: "none" as const,
    }));
    const client: PlayerClaimClient = {
      async listMine() { return []; },
      search,
      request,
      async createOwnPlayer() { throw new Error("must not create"); },
    };
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountPlayerClaimSection(root as unknown as HTMLElement, client);
    await mounted.ready;

    const input = descendants(root).find((candidate) => candidate.type === "search")!;
    input.value = "Synthetic";
    descendants(root).find((candidate) => candidate.tagName === "form")!.dispatch("submit");
    await settle();
    expect(search).toHaveBeenCalledWith("Synthetic", expect.any(AbortSignal));
    node(root, "Synthetic Racer (@SyntheticRacer)").dispatch("click");
    expect(request).not.toHaveBeenCalled();
    expect(node(root, "View public profile").attributes.get("href"))
      .toBe("/?player=player.synthetic_claim_ui_01");
    node(root, "This is me").dispatch("click");
    await settle();
    expect(request).toHaveBeenCalledWith(
      "player.synthetic_claim_ui_01",
      expect.any(AbortSignal),
      "",
    );
    expect(node(
      root,
      "We have asked the team to link Synthetic Racer to your account. " +
      "You will hear back here.",
    )).toBeDefined();
  });

  it("shows current verified state without enabling a second request", async () => {
    const client: PlayerClaimClient = {
      async listMine() {
        return [{
          playerClaimId: "player_claim.synthetic_claim_ui_01",
          playerId: "player.synthetic_claim_ui_01",
          playerUsername: "SyntheticRacer",
          playerDisplayName: "Synthetic Racer",
          claimStatus: "verified",
          disputeStatus: "none",
          updatedAtMs: 1787011200000,
        }];
      },
      async search() { return []; },
      async request() { throw new Error("must not request"); },
      async createOwnPlayer() { throw new Error("must not create"); },
    };
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountPlayerClaimSection(root as unknown as HTMLElement, client);
    await mounted.ready;
    expect(node(root, "Verified Player: Synthetic Racer (@SyntheticRacer)."))
      .toBeDefined();
    expect(descendants(root).some((candidate) => candidate.type === "search"))
      .toBe(false);
  });

  it("creates a new own Player through the self-service form", async () => {
    const createOwnPlayer = vi.fn(async () => ({
      playerId: "player.synthetic_new_01",
      username: "fresh_racer",
      displayName: "Fresh Racer",
      playerClaimId: "player_claim.synthetic_new_01",
    }));
    const client: PlayerClaimClient = {
      async listMine() { return []; },
      async search() { return []; },
      async request() { throw new Error("must not request"); },
      createOwnPlayer,
    };
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountPlayerClaimSection(root as unknown as HTMLElement, client);
    await mounted.ready;

    expect(node(root, "Create your Player")).toBeDefined();
    const username = descendants(root).find((candidate) =>
      candidate.name === "new_player_username")!;
    username.value = "fresh_racer";
    const displayName = descendants(root).find((candidate) =>
      candidate.name === "new_player_display_name")!;
    displayName.value = "Fresh Racer";
    const forms = descendants(root).filter((candidate) =>
      candidate.tagName === "form");
    forms[1]!.dispatch("submit");
    await settle();
    expect(createOwnPlayer).toHaveBeenCalledWith(
      "fresh_racer",
      "Fresh Racer",
      expect.any(AbortSignal),
    );
    expect(descendants(root).some((candidate) =>
      String(candidate.textContent).includes(
        "Fresh Racer (@fresh_racer) has been created",
      ))).toBe(true);
  });

  it("keeps the create form usable when the username is taken", async () => {
    const client: PlayerClaimClient = {
      async listMine() { return []; },
      async search() { return []; },
      async request() { throw new Error("must not request"); },
      async createOwnPlayer() {
        throw new PlayerClaimClientError("username_taken");
      },
    };
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountPlayerClaimSection(root as unknown as HTMLElement, client);
    await mounted.ready;
    const username = descendants(root).find((candidate) =>
      candidate.name === "new_player_username")!;
    username.value = "taken_name";
    const forms = descendants(root).filter((candidate) =>
      candidate.tagName === "form");
    forms[1]!.dispatch("submit");
    await settle();
    expect(node(
      root,
      "That username is already in use. Choose another one.",
    )).toBeDefined();
  });
});

describe("new arrival onboarding", () => {
  const client: PlayerClaimClient = {
    async listMine() { return []; },
    async search() { return []; },
    async request() { throw new Error("must not request"); },
    async createOwnPlayer() {
      return {
        playerId: "player.synthetic_new_01",
        username: "fresh_racer",
        displayName: "Fresh Racer",
        playerClaimId: "player_claim.synthetic_new_01",
      };
    },
  };

  it("asks which path fits before showing either form", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountPlayerClaimSection(
      root as unknown as HTMLElement, client, visibilityClient(),
    );
    await mounted.ready;
    expect(node(root, "I already have a Player")).toBeDefined();
    expect(node(root, "I'm new here")).toBeDefined();
    // Neither is preselected: only the person can answer "have you raced
    // here before?".
    const panels = descendants(root).filter((candidate) =>
      candidate.className === "player-claim__panel");
    expect(panels).toHaveLength(2);
    expect(panels.every((panel) => panel.hidden)).toBe(true);
    // No jargon in the copy a new arrival reads.
    const copy = descendants(root).map((candidate) =>
      String(candidate.textContent)).join(" ");
    expect(copy).not.toMatch(/PlayerClaim|canonical|claim target/i);

    node(root, "I already have a Player").dispatch("click");
    expect(panels[0]!.hidden).toBe(false);
    expect(panels[1]!.hidden).toBe(true);
    node(root, "I'm new here").dispatch("click");
    expect(panels[0]!.hidden).toBe(true);
    expect(panels[1]!.hidden).toBe(false);
    mounted.unmount();
  });

  it("marks only the real required creation fields and explains an empty username", async () => {
    const createOwnPlayer = vi.fn(client.createOwnPlayer);
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountPlayerClaimSection(
      root as unknown as HTMLElement,
      { ...client, createOwnPlayer },
      visibilityClient(),
    );
    await mounted.ready;
    expect(node(root, "Username *")).toBeDefined();
    expect(node(root, "Display name (optional)")).toBeDefined();
    expect(node(root, "How should your Player appear? *")).toBeDefined();
    descendants(root).filter((candidate) =>
      candidate.tagName === "form")[1]!.dispatch("submit");
    await settle();
    const username = descendants(root).find((candidate) =>
      candidate.name === "new_player_username")!;
    expect(username.attributes.get("aria-invalid")).toBe("true");
    expect(node(root, "Username is required.")).toBeDefined();
    expect(createOwnPlayer).not.toHaveBeenCalled();
  });

  it("highlights a duplicate display name without clearing either entered value", async () => {
    const duplicateClient: PlayerClaimClient = {
      ...client,
      async createOwnPlayer() {
        throw new PlayerClaimClientError("display_name_taken");
      },
    };
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountPlayerClaimSection(
      root as unknown as HTMLElement,
      duplicateClient,
      visibilityClient(),
    );
    await mounted.ready;
    const username = descendants(root).find((candidate) =>
      candidate.name === "new_player_username")!;
    const displayName = descendants(root).find((candidate) =>
      candidate.name === "new_player_display_name")!;
    username.value = "second_ben";
    displayName.value = "Ben";
    descendants(root).filter((candidate) =>
      candidate.tagName === "form")[1]!.dispatch("submit");
    await settle();
    expect(displayName.attributes.get("aria-invalid")).toBe("true");
    expect(node(root, "This display name is already in use by another Player."))
      .toBeDefined();
    expect(username.value).toBe("second_ben");
    expect(displayName.value).toBe("Ben");
  });

  it("makes a chosen Private Player private right after creating it", async () => {
    const setOwn = vi.fn(async () => ({
      playerId: "player.synthetic_new_01",
      username: "fresh_racer",
      displayName: "Fresh Racer",
      visibility: "private" as const,
    }));
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountPlayerClaimSection(
      root as unknown as HTMLElement, client, visibilityClient({ setOwn }),
    );
    await mounted.ready;
    expect(node(root, "Public Player")).toBeDefined();
    expect(node(root, "Private Player")).toBeDefined();
    descendants(root).find((candidate) =>
      candidate.name === "new_player_username")!.value = "fresh_racer";
    const privateChoice = descendants(root).find((candidate) =>
      candidate.value === "private")!;
    privateChoice.checked = true;
    descendants(root).filter((candidate) =>
      candidate.tagName === "form")[1]!.dispatch("submit");
    await settle();
    await settle();
    expect(setOwn).toHaveBeenCalledWith("private", expect.any(AbortSignal));
  });

  it("leaves a Public Player public without a second call", async () => {
    const setOwn = vi.fn(async () => {
      throw new Error("must not be called");
    });
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountPlayerClaimSection(
      root as unknown as HTMLElement,
      client,
      visibilityClient({ setOwn: setOwn as never }),
    );
    await mounted.ready;
    descendants(root).find((candidate) =>
      candidate.name === "new_player_username")!.value = "fresh_racer";
    descendants(root).filter((candidate) =>
      candidate.tagName === "form")[1]!.dispatch("submit");
    await settle();
    await settle();
    expect(setOwn).not.toHaveBeenCalled();
    expect(descendants(root).some((candidate) =>
      String(candidate.textContent).includes(
        "Fresh Racer (@fresh_racer) has been created"))).toBe(true);
  });
});
