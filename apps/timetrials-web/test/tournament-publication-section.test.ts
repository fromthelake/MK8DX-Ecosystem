import { describe, expect, it, vi } from "vitest";

import { mountTournamentPublicationSection } from
  "../src/tournament-publication-section.js";
import {
  TournamentPublicationClientError,
  type TournamentPublicationClient,
} from "../src/tournament-publication-client.js";

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  parentNode: FakeNode | null = null;
  className = "";
  id = "";
  textContent: string | null = null;
  type = "";
  value = "";
  maxLength = -1;
  required = false;
  disabled = false;
  checked = false;
  pattern = "";
  placeholder = "";
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
    const values = this.listeners.get(type) ?? new Set(); values.add(listener); this.listeners.set(type, values);
  }
  dispatch(type: string): void {
    const event = new Event(type, { cancelable: true });
    for (const listener of this.listeners.get(type) ?? []) { listener(event); }
  }
}
class FakeDocument { createElement(tagName: string): FakeNode { return new FakeNode(tagName, this); } }
function descendants(root: FakeNode): FakeNode[] { return root.children.flatMap((child) => [child, ...descendants(child)]); }
async function settle(): Promise<void> { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

const candidate = {
  raceResultId: "tournament_race_result.synthetic_race_001",
  revision: 2,
  currentRevision: 2,
  raceNumber: 3,
  scoringSegment: 1,
  trackId: "track.mario_kart_stadium",
  placementCount: 12,
  publishable: true,
};
const snapshot = {
  publicationId: "tournament_publication.synthetic_event_001",
  eventName: "Synthetic Cup",
  status: "published" as const,
  revision: 1,
  resultCount: 1,
  publishedAtMs: 1_900_000_000_000,
  updatedAtMs: 1_900_000_000_000,
};

function client(overrides: Partial<TournamentPublicationClient> = {}): TournamentPublicationClient {
  return {
    async listReview() { return { publications: [], candidates: [candidate] }; },
    async submitRaceResult() { return "imported" as const; },
    async create() { return snapshot; },
    async republish() { return snapshot; },
    async retract() {
      const { publishedAtMs: _publishedAtMs, ...current } = snapshot;
      return { ...current, status: "retracted" as const };
    },
    async listPlayer() { return []; },
    async loadPublic() { throw new Error("unused"); },
    ...overrides,
  };
}

describe("Tournament publication section", () => {
  it("removes the administrator workflow for ordinary accounts", async () => {
    const document = new FakeDocument(); const root = document.createElement("div");
    const mounted = mountTournamentPublicationSection(root as unknown as HTMLElement, client({
      async listReview() { throw new TournamentPublicationClientError("not_authorized"); },
    }));
    await mounted.ready;
    expect(root.children).toHaveLength(0);
  });

  it("publishes an explicitly selected current revision with event and audit reason", async () => {
    let loads = 0;
    const create = vi.fn(async () => snapshot);
    const document = new FakeDocument(); const root = document.createElement("div");
    const mounted = mountTournamentPublicationSection(root as unknown as HTMLElement, client({
      async listReview() { return loads++ === 0 ? { publications: [], candidates: [candidate] } : { publications: [snapshot], candidates: [{ ...candidate, currentPublicationId: snapshot.publicationId }] }; },
      create,
    }));
    await mounted.ready;
    const nodes = descendants(root);
    const inputs = nodes.filter((node) => node.tagName === "input");
    const checkbox = inputs.find((node) => node.type === "checkbox")!;
    const textInputs = inputs.filter((node) => node.type !== "checkbox");
    checkbox.checked = true;
    textInputs[0]!.value = "Synthetic Cup";
    textInputs[1]!.value = "event_completed";
    nodes.find((node) => node.tagName === "form")!.dispatch("submit");
    await settle();
    expect(create).toHaveBeenCalledWith(
      "Synthetic Cup",
      [{ raceResultId: candidate.raceResultId, revision: 2 }],
      "event_completed",
      expect.any(AbortSignal),
    );
  });

  it("keeps non-central or inactive-Player candidates disabled", async () => {
    const document = new FakeDocument(); const root = document.createElement("div");
    const mounted = mountTournamentPublicationSection(root as unknown as HTMLElement, client({
      async listReview() { return { publications: [], candidates: [{ ...candidate, publishable: false }] }; },
    }));
    await mounted.ready;
    expect(descendants(root).find((node) => node.type === "checkbox")?.disabled).toBe(true);
  });
});
