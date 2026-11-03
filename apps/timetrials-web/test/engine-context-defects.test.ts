// Engine-context defects R1–R14 (docs/design-system/ENGINE_CONTEXT_INVENTORY.md §3).
//
// Written in Phase 0 as EXPECTED FAILURES (`it.fails`): each test asserts the correct behaviour and
// fails against today's code for the documented reason. A test is flipped to a plain `it` only in
// the commit that fixes its defect. Defects that live in SQL or in screens migrated later are listed
// as `it.todo` with the phase that resolves them; the browser-level ones (R4 router default, Mastery/Compare start, R6; R11 as a passing guard)
// are in tooling/design-system/engine-context.browser.mjs.
import { afterEach, describe, expect, it, vi } from "vitest";

import { notificationLink } from "../src/notification-section.js";
import type { NotificationView } from "../src/notification-client.js";
import { SCAN_HANDOFF_STORAGE_KEY, takeScanHandoff } from "../src/scan-handoff.js";

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Array<() => void>>();
  parentNode: FakeNode | null = null;
  className = "";
  textContent: string | null = null;
  type = ""; value = ""; placeholder = ""; loading = ""; width = 0; height = 0;
  constructor(readonly tagName: string, readonly ownerDocument: FakeDocument) {}
  get firstChild(): FakeNode | null { return this.children[0] ?? null; }
  append(...nodes: FakeNode[]): void { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  removeChild(node: FakeNode): FakeNode { this.children.splice(this.children.indexOf(node), 1); node.parentNode = null; return node; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  addEventListener(name: string, handler: () => void): void { this.listeners.set(name, [...(this.listeners.get(name) ?? []), handler]); }
  dispatch(name: string): void { for (const handler of this.listeners.get(name) ?? []) { handler(); } }
}
class FakeDocument { createElement(tagName: string): FakeNode { return new FakeNode(tagName, this); } }
const descendants = (root: FakeNode): FakeNode[] => root.children.flatMap((child) => [child, ...descendants(child)]);

function memoryStorage(initial: Record<string, string>): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length(): number { return values.size; },
    clear(): void { values.clear(); },
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, value); },
  } as Storage;
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("R2 · the bootstrap prefetch cache answers only the request it was made for", () => {
  it("a Ranking request for other Players never receives the Home bootstrap's preference-filtered bests", async () => {
    const network: string[] = [];
    vi.stubGlobal("fetch", (input: string) => {
      network.push(input);
      if (input.startsWith("/v1/bootstrap")) {
        return Promise.resolve(new Response(JSON.stringify({
          schemaVersion: "mk8dx.home-bootstrap.v1",
          authenticated: true,
          trackBests: { schemaVersion: "mk8dx.public-track-bests.v1", players: [{ playerId: "player.viewer", bests: [] }] },
        }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      return Promise.resolve(new Response(JSON.stringify({ schemaVersion: "mk8dx.public-track-bests.v1", players: [] }), { status: 200 }));
    });
    const cache = await import("../src/preloaded-responses.js");
    cache.installResponseCache();
    // A non-Home route primes the shared chrome (as Ranking does at authentication-product-page.ts:1204) ...
    await cache.primeFromBootstrap();
    // ... and then asks for a different set of Players.
    await fetch("/v1/public/track-bests?players=player.someone-else");
    expect(network).toContain("/v1/public/track-bests?players=player.someone-else");
  });
});

describe("R4 · no hard-coded 150cc where an engine should be resolved", () => {
  // The Cups directory (W06) resolves the engine once and carries it into every track link, and
  // carries none when the route resolved none: asserted on the migrated view in ds-cups.test.ts.

  it("a notification without an engine does not invent 150cc in its link", () => {
    const view = {
      notificationId: "7", kind: "overtaken", actorPlayerId: "player.floyd", actorDisplayName: "Floyd",
      trackId: "track.mount_wario", actorTimeMs: 115_331, recipientTimeMs: 115_942, deltaMs: -611,
      recipientRank: 4, count: 1, lastEventAtMs: 1_900_000_000_000, read: false,
    } as unknown as NotificationView;
    expect(notificationLink(view, null)).not.toContain("mode=150");
  });

  // R4 · Mastery tab, Compare, the router default and the manual form start from EngineContext: fixed in
  // Phase 1; covered by engine-context.test.ts, manual-product-page.test.ts and the browser check.
  it.todo("R4 · the Home empty focus card uses the selected engine — resolved with Home (Phase 10)");
});

describe("R12 · a scan handoff never silently becomes 150cc", () => {
  it("a handoff with a missing or invalid engine is rejected, not coerced to 150", () => {
    const raw = JSON.stringify({ trackId: "track.mario_kart_stadium", mode: "fast", totalDigits: "125456", laps: [] });
    expect(takeScanHandoff(memoryStorage({ [SCAN_HANDOFF_STORAGE_KEY]: raw }), "track.mario_kart_stadium")).toBeNull();
  });
});

describe("defects resolved in later phases (documented, not yet executable here)", () => {
  it.todo("R1 · Home: an engine hidden by the preference shows a hidden state + local 'Show … anyway', never zeros — Phase 10");
  it.todo("R3 · Home feed and /?activity use one data contract for the engine filter — Phase 12");
  it.todo("R5 · headline Time Trials standing matches the selected engine (200cc standing needs API E2) — E2 before Phase 10; Ranking part Phase 6");
  it.todo("R8 · the stored Ranking engine is always visible (today the selector shows it; the summary line comes with Phase 6)");
  it.todo("R9 · competitive metrics split per engine; engine-independent counts labelled Combined — engine-data track E1/E2/E4");
  it.todo("R10 · 200cc focus cards get the mastery-crossing bullet (home-focus.ts masteryCrossing returns null for 200) — Phase 10");
  it.todo("R13 · World-record notification aggregate per engine (SQL, mysql-world-record-repository.ts) — E3, MySQL integration test");
  it.todo("R14 · Record Book/career ranking filters inactive Players first and shares tied ranks (SQL) — E1, MySQL integration test");
});
