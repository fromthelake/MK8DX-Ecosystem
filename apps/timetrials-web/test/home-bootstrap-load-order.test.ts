// Web bootstrap / load-order gate (ADR-0159). Guards the behaviour that
// broke silently during the performance work: Home must ask the platform
// ONCE (`/v1/bootstrap`) before anything else, carry the session answer
// from it, hand every preloaded section to its client exactly once, never
// re-request those sections over the network, and still paint its critical
// shell (navigation + hero) when a section is missing.

import { afterEach, describe, expect, it, vi } from "vitest";

import type { WebAuthenticationClient } from "../src/authentication-client.js";
import { mountAuthenticationProductPage } from
  "../src/authentication-product-page.js";
import { forgetRemembered } from "../src/preloaded-responses.js";

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  readonly styleValues = new Map<string, string>();
  readonly style = {
    setProperty: (name: string, value: string) => { this.styleValues.set(name, value); },
    removeProperty: (name: string) => { this.styleValues.delete(name); },
    getPropertyValue: (name: string) => this.styleValues.get(name) ?? "",
  };
  readonly classList = {
    add: (name: string) => { this.className = `${this.className} ${name}`.trim(); },
    remove: (name: string) => { this.className = this.className.split(" ").filter((c) => c !== name).join(" "); },
    toggle: (name: string, force?: boolean) => {
      const has = this.className.split(" ").includes(name);
      const next = force ?? !has;
      if (next && !has) { this.classList.add(name); }
      if (!next && has) { this.classList.remove(name); }
      return next;
    },
    contains: (name: string) => this.className.split(" ").includes(name),
  };
  parentNode: FakeNode | null = null;
  className = "";
  private ownText: string | null = null;
  // As in the DOM: text content is own text plus descendants', and assigning it replaces children.
  get textContent(): string | null {
    if (this.children.length === 0) { return this.ownText; }
    return `${this.ownText ?? ""}${this.children.map((child) => child.textContent ?? "").join("")}`;
  }

  set textContent(value: string | null) {
    for (const child of this.children.splice(0)) { child.parentNode = null; }
    this.ownText = value;
  }
  type = "";
  name = "";
  value = "";
  id = "";
  autocomplete = "";
  maxLength = -1;
  required = false;
  disabled = false;
  hidden = false;
  open = false;
  checked = false;
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();
  public constructor(readonly tagName: string, readonly ownerDocument: FakeDocument) {}
  public get firstChild(): FakeNode | null { return this.children[0] ?? null; }
  append(...nodes: (FakeNode | string)[]): void {
    for (const node of nodes) {
      if (typeof node === "string") { this.ownText = `${this.ownText ?? ""}${node}`; continue; }
      node.parentNode = this;
      this.children.push(node);
    }
  }

  prepend(...nodes: FakeNode[]): void { for (const node of nodes.reverse()) { node.parentNode = this; this.children.unshift(node); } }
  removeChild(node: FakeNode): FakeNode {
    const index = this.children.indexOf(node);
    if (index < 0) { throw new Error("synthetic child missing"); }
    this.children.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  replaceChildren(...nodes: (FakeNode | string)[]): void { this.textContent = null; this.append(...nodes); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  toggleAttribute(name: string, force?: boolean): boolean {
    const next = force ?? !this.attributes.has(name);
    if (next) { this.attributes.set(name, ""); } else { this.attributes.delete(name); }
    return next;
  }
  readonly dataset: Record<string, string> = {};
  addEventListener(type: string, listener: (event: Event) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(): void { /* not needed */ }
  querySelector(): FakeNode | null { return null; }
  querySelectorAll(): FakeNode[] { return []; }
  focus(): void { /* not needed */ }
}
class FakeDocument {
  activeElement: FakeNode | null = null;
  readonly documentElement = new FakeNode("html", this);
  readonly body = new FakeNode("body", this);
  createElement(tagName: string): FakeNode { return new FakeNode(tagName, this); }
  createElementNS(_namespace: string, tagName: string): FakeNode { return new FakeNode(tagName, this); }
  querySelector(): FakeNode | null { return null; }
  createTextNode(text: string): FakeNode { const node = new FakeNode("#text", this); node.textContent = text; return node; }
  createDocumentFragment(): FakeNode { return new FakeNode("#fragment", this); }
}
function descendants(root: FakeNode): FakeNode[] {
  return root.children.flatMap((child) => [child, ...descendants(child)]);
}
async function settle(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) { await Promise.resolve(); }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const bootstrapSections = {
  schemaVersion: "mk8dx.home-bootstrap.v1",
  authenticated: true,
  notifications: { schemaVersion: "mk8dx.notifications.v1", unreadCount: 0, notifications: [] },
  claims: { schemaVersion: "mk8dx.account-player-claims.v1", claims: [] },
  comeback: { schemaVersion: "mk8dx.home-comeback.v1", items: [] },
  focus: { schemaVersion: "mk8dx.home-focus.v1", cards: [] },
  follows: { schemaVersion: "mk8dx.account-follows.v1", players: [] },
  rivals: { schemaVersion: "mk8dx.player-rivals.v1", rivals: [] },
  stories: { schemaVersion: "mk8dx.public-activity-stories.v1", stories: [] },
  trackBests: { schemaVersion: "mk8dx.public-track-bests.v1", bests: [] },
  reactions: { schemaVersion: "mk8dx.public-time-trial-reactions.v1", reactions: [] },
};

// The preload layer wraps globalThis.fetch once per module (ADR-0159), so
// the recorder is installed once, up front, and only its handler changes per
// test - replacing globalThis.fetch later would silently bypass the layer.
const recorded: string[] = [];
let handler: (url: string, path: string) => Response = () =>
  new Response(JSON.stringify({ code: "not_found", message: "synthetic" }), { status: 404, headers: { "content-type": "application/json" } });
globalThis.fetch = vi.fn(async (input: string | URL | Request): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  recorded.push(url);
  return handler(url, url.split("?")[0] ?? url);
}) as unknown as typeof fetch;

afterEach(() => { forgetRemembered(); });

function recordingFetch(overrides: Record<string, () => Response> = {}) {
  recorded.length = 0;
  handler = (url, path) => {
    const override = overrides[path] ?? overrides[url];
    if (override !== undefined) { return override(); }
    if (path === "/v1/bootstrap") {
      return new Response(JSON.stringify(bootstrapSections), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ code: "not_found", message: "synthetic" }), { status: 404, headers: { "content-type": "application/json" } });
  };
  return recorded;
}

function sessionClient(sessionSpy: ReturnType<typeof vi.fn>): WebAuthenticationClient {
  return {
    session: sessionSpy as unknown as WebAuthenticationClient["session"],
    async capabilities() { return { administrator: false }; },
    async requestMagicLink() {},
    async signOut() {},
    async device(userCode) { return { userCode, clientId: "mk8dx.timetrials.android.v1" }; },
    async approveDevice() {},
    async denyDevice() {},
  };
}

describe("Home bootstrap load order", () => {
  it("asks /v1/bootstrap first and exactly once, carries the session, and paints the shell", async () => {
    // Sections absent: every client goes to the network, which is the worst
    // case for ordering - the bootstrap must still be the first platform call.
    const calls = recordingFetch({
      "/v1/bootstrap": () => new Response(JSON.stringify({ schemaVersion: "mk8dx.home-bootstrap.v1", authenticated: true }), {
        status: 200, headers: { "content-type": "application/json" },
      }),
    });
    const sessionSpy = vi.fn(async () => ({ authenticated: true }));
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: sessionClient(sessionSpy),
      pathname: "/",
      search: "",
    });
    await mounted.ready;
    await settle();
    const platformCalls = calls.filter((url) => url.startsWith("/v1/") || url.startsWith("/api/"));
    expect(platformCalls[0]).toBe("/v1/bootstrap");
    expect(platformCalls.filter((url) => url === "/v1/bootstrap")).toHaveLength(1);
    // The session answer rides on the bootstrap: no separate get-session round trip.
    expect(platformCalls.some((url) => url.startsWith("/api/auth/get-session"))).toBe(false);
    expect(sessionSpy).not.toHaveBeenCalled();
    // Critical shell painted: primary navigation with Tournaments, the hero, signed-in chrome.
    const nodes = descendants(root);
    const navLinks = nodes.filter((node) => node.className === "ds-nav-link" && node.tagName === "a")
      .map((node) => node.textContent);
    expect(navLinks).toEqual(["Home", "Tracks", "Ranking", "Records", "Build", "Community", "Tournaments"]);
    // Getting the app is an offer, not a place, so it sits in the top bar
    // beside the account controls - where the five-slot phone tab bar
    // cannot drop it, as it used to.
    const apps = nodes.find((node) => node.className.includes("ds-topbar__apps"));
    expect(apps?.attributes.get("href")).toBe("/?apps=1");
    expect(nodes.some((node) => node.className.includes("ds-home"))).toBe(true);
    // The signed-in identity is the account menu's own trigger.
    expect(nodes.find((node) => node.className === "ds-topbar__account")).toBeDefined();
    // The phone keeps five tabs, and a skip link leads into the one <main>.
    expect(nodes.filter((node) => node.className === "ds-tab-link")).toHaveLength(5);
    expect(nodes.filter((node) => node.tagName === "main")).toHaveLength(1);
    expect(nodes.find((node) => node.className === "ds-root ds-skip")
      ?.attributes.get("href")).toBe("#mk8dx-main");
    mounted.unmount();
  });

  it("serves every preloaded section from the bootstrap and never re-requests it", async () => {
    const calls = recordingFetch();
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: sessionClient(vi.fn(async () => ({ authenticated: true }))),
      pathname: "/",
      search: "",
    });
    await mounted.ready;
    await settle();
    const platformCalls = calls.filter((url) => url.startsWith("/v1/") || url.startsWith("/api/"));
    const preloadedPaths = [
      "/v1/notifications", "/v1/me/player-claims", "/v1/home/comeback", "/v1/home/focus",
      "/v1/account/follows", "/v1/account/rivals", "/v1/public/activity-stories",
      "/v1/public/track-bests",
      "/v1/public/time-trial-reactions",
    ];
    for (const path of preloadedPaths) {
      expect(platformCalls.filter((url) => (url.split("?")[0] ?? url) === path),
        `${path} must be served from the bootstrap, not fetched again`).toHaveLength(0);
    }
    // Every platform request is distinct, and the burst stays far inside
    // the hosting budget (ADR-0159: about five application requests a second).
    const counts = new Map<string, number>();
    for (const url of platformCalls) { counts.set(url, (counts.get(url) ?? 0) + 1); }
    expect([...counts.entries()].filter(([, count]) => count > 1)).toEqual([]);
    expect(platformCalls.length).toBeLessThanOrEqual(4);
    mounted.unmount();
  });

  it("does not probe private Player claims on the signed-out landing", async () => {
    const calls = recordingFetch({
      "/v1/bootstrap": () => new Response(JSON.stringify({
        ...bootstrapSections,
        authenticated: false,
        claims: null,
      }), { status: 200, headers: { "content-type": "application/json" } }),
    });
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: sessionClient(vi.fn(async () => null)),
      pathname: "/",
      search: "",
    });
    await mounted.ready;
    await settle();
    expect(calls.filter((url) =>
      (url.split("?")[0] ?? url) === "/v1/me/player-claims",
    )).toHaveLength(0);
    mounted.unmount();
  });

  it("fetches a missing section once, and falls back to the session check when the bootstrap fails", async () => {
    const { notifications: _dropped, ...partial } = bootstrapSections;
    const calls = recordingFetch({
      "/v1/bootstrap": () => new Response(JSON.stringify(partial), { status: 200, headers: { "content-type": "application/json" } }),
      "/v1/notifications": () => new Response(JSON.stringify({ schemaVersion: "mk8dx.notifications.v1" }), { status: 200, headers: { "content-type": "application/json" } }),
    });
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: sessionClient(vi.fn(async () => ({ authenticated: true }))),
      pathname: "/",
      search: "",
    });
    await mounted.ready;
    await settle();
    // The navigation badge and the inbox share one answer.
    expect(calls.filter((url) => (url.split("?")[0] ?? url) === "/v1/notifications").length).toBeLessThanOrEqual(1);
    mounted.unmount();

    const failing = recordingFetch({ "/v1/bootstrap": () => new Response("", { status: 503 }) });
    const sessionSpy = vi.fn(async () => ({ authenticated: true }));
    const root2 = document.createElement("div");
    const mounted2 = mountAuthenticationProductPage(root2 as unknown as HTMLElement, {
      client: sessionClient(sessionSpy),
      pathname: "/",
      search: "",
    });
    await mounted2.ready;
    await settle();
    expect(sessionSpy).toHaveBeenCalled();
    expect(descendants(root2).some((node) => node.className.includes("ds-home"))).toBe(true);
    expect(failing.filter((url) => url === "/v1/bootstrap")).toHaveLength(1);
    mounted2.unmount();
  });

  it("does not pay for the bootstrap on pages that do not need it", async () => {
    const calls = recordingFetch();
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: sessionClient(vi.fn(async () => null)),
      pathname: "/",
      search: "?cups=1",
    });
    await mounted.ready;
    await settle();
    // Tracks renders from the static catalog: no bootstrap, no platform call.
    expect(calls.filter((url) => url.startsWith("/v1/bootstrap"))).toHaveLength(0);
    expect(calls.filter((url) => url.startsWith("/v1/") || url.startsWith("/api/"))).toHaveLength(0);
    mounted.unmount();
  });
});
