import { describe, expect, it, vi } from "vitest";

import type { WebAuthenticationClient } from "../src/authentication-client.js";
import { mountAuthenticationProductPage } from
  "../src/authentication-product-page.js";

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  readonly classList = {
    add: (name: string) => { this.className = `${this.className} ${name}`.trim(); },
    remove: (name: string) => {
      this.className = this.className.split(" ").filter((entry) => entry !== name).join(" ");
    },
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
  // As in the DOM: an element's text content is its own text plus its descendants', and assigning
  // text replaces the children. The design-system factories pass labels as children, so a double
  // that kept text and children apart would report the wrong thing for every component.
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
  autocomplete = "";
  maxLength = -1;
  required = false;
  disabled = false;
  hidden = false;
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();

  // Inline styles the components set for a measured size (the brand rasters).
  readonly style = {
    values: new Map<string, string>(),
    setProperty(name: string, value: string) { this.values.set(name, value); },
    removeProperty(name: string) { this.values.delete(name); },
    getPropertyValue(name: string) { return this.values.get(name) ?? ""; },
  };

  public constructor(readonly tagName: string, readonly ownerDocument: FakeDocument) {}

  public querySelector(selector: string): FakeNode | null {
    const wanted = selector.replace(/^\./u, "");
    return descendants(this).find((candidate) =>
      candidate.className.split(" ").includes(wanted) ||
      candidate.tagName === selector) ?? null;
  }

  public get isConnected(): boolean { return this.parentNode !== null; }

  public focus(): void { this.ownerDocument.activeElement = this; }

  public get firstChild(): FakeNode | null { return this.children[0] ?? null; }

  // The design-system factories pass label text as a child, exactly as the DOM allows. A text child
  // of an element is that element's text content, so the double records it the same way and the
  // assertions below keep reading `textContent`.
  append(...nodes: (FakeNode | string)[]): void {
    for (const node of nodes) {
      if (typeof node === "string") {
        this.ownText = `${this.ownText ?? ""}${node}`;
        continue;
      }
      node.parentNode = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes: (FakeNode | string)[]): void {
    this.textContent = null;
    this.append(...nodes);
  }

  public querySelectorAll(selector: string): FakeNode[] {
    const wanted = selector.replace(/^\./u, "");
    return descendants(this).filter((candidate) =>
      candidate.tagName === selector || candidate.className.split(" ").includes(wanted));
  }

  // The confirmation and the device card are platform dialogs (ADR-0224).
  open = false;
  showModal(): void { this.open = true; }
  close(): void { this.open = false; this.dispatch("close"); }
  remove(): void { this.parentNode?.removeChild(this); }
  contains(node: FakeNode | null): boolean {
    return node !== null && (node === this || descendants(this).includes(node));
  }

  removeChild(node: FakeNode): FakeNode {
    const index = this.children.indexOf(node);
    if (index < 0) { throw new Error("synthetic child missing"); }
    this.children.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }

  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }

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

  dispatch(type: string): void {
    const event = new Event(type, { cancelable: true });
    for (const [name, value] of [["button", 0], ["metaKey", false], ["ctrlKey", false],
      ["shiftKey", false], ["altKey", false]] as const) {
      Object.defineProperty(event, name, { value, configurable: true });
    }
    for (const listener of this.listeners.get(type) ?? []) { listener(event); }
  }
}

class FakeDocument {
  activeElement: FakeNode | null = null;
  readonly documentElement = new FakeNode("html", this);
  readonly body = new FakeNode("body", this);
  createElement(tagName: string): FakeNode { return new FakeNode(tagName, this); }
  createElementNS(_namespace: string, tagName: string): FakeNode {
    return new FakeNode(tagName, this);
  }
  querySelector(selector: string): FakeNode | null { return this.body.querySelector(selector); }
}

function descendants(root: FakeNode): FakeNode[] {
  return root.children.flatMap((child) => [child, ...descendants(child)]);
}

/**
 * The legacy route layer. Since Phase 5 it lives inside the AppShell's one <main>, not at the root:
 * the shell frames every route, and `.page-shell--*` still shapes the content that has not migrated.
 */
function routeLayer(root: FakeNode): FakeNode {
  const found = descendants(root).find((candidate) =>
    candidate.className.split(" ").includes("page-shell"));
  if (found === undefined) { throw new Error("the route layer is missing"); }
  return found;
}

function node(root: FakeNode, text: string): FakeNode {
  // An element's text content includes its descendants', so a wrapper around one label matches it
  // too. The innermost match is the control a reader would actually click.
  const matches = descendants(root).filter((candidate) => candidate.textContent === text);
  const found = matches.find((candidate) =>
    !descendants(candidate).some((inner) => inner.textContent === text)) ?? matches[0];
  if (found === undefined) { throw new Error(`synthetic node missing: ${text}`); }
  // Components put a label in its own element inside the control; the control is what carries the
  // destination and the hidden state, so the search resolves to it.
  const isControl = (candidate: FakeNode): boolean =>
    candidate.tagName === "a" || candidate.tagName === "button";
  if (isControl(found)) { return found; }
  for (let cursor = found.parentNode; cursor !== null; cursor = cursor.parentNode) {
    if (isControl(cursor)) { return cursor; }
  }
  return found;
}

function client(
  overrides: Partial<WebAuthenticationClient> = {},
): WebAuthenticationClient {
  return {
    async session() { return null; },
    async capabilities() { return null; },
    async requestMagicLink() {},
    async signOut() {},
    async device(userCode) {
      return {
        userCode,
        clientId: "mk8dx.timetrials.android.v1",
      };
    },
    async approveDevice() {},
    async denyDevice() {},
    ...overrides,
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("passwordless authentication product page", () => {
  it("shows only the host invitation route on an offline installation", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const requestMagicLink = vi.fn(async () => undefined);
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({ async installationMode() { return "offline-invitation"; }, requestMagicLink }),
      pathname: "/", search: "?signin=1",
    });
    await mounted.ready;
    await settle();
    expect(String(root.textContent)).toContain("personal invitation link or QR code");
    expect(String(root.textContent)).toContain("setup QR");
    expect(descendants(root).some((node) => node.type === "email")).toBe(false);
    expect(requestMagicLink).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it("explains offline invitation before device approval", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({ async installationMode() { return "offline-invitation"; } }),
      pathname: "/device", search: "?user_code=ABCD-1234",
    });
    await mounted.ready;
    await settle();
    expect(String(root.textContent)).toContain("return to approve this device");
    expect(descendants(root).some((node) => node.type === "email")).toBe(false);
    mounted.unmount();
  });

  it("does not request the protected app catalog for an anonymous visitor", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const session = vi.fn(async () => null);
    const fetchPort = vi.fn();
    vi.stubGlobal("fetch", fetchPort);
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({ session }),
      pathname: "/",
      search: "?apps=1",
    });

    await mounted.ready;

    expect(session).toHaveBeenCalledOnce();
    expect(fetchPort).not.toHaveBeenCalled();
    expect(node(root, "Sign in to download the MK8DX apps.")).toBeDefined();
    // Signing in must lead back to the download offer, not to generic Home.
    expect(node(root, "Sign in").attributes.get("href"))
      .toBe("/?signin=1&return=%2F%3Fapps%3D1");
    mounted.unmount();
    vi.unstubAllGlobals();
  });

  it("mounts an anonymous public leaderboard before any session resolves", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const session = vi.fn(async () => null);
    const unmount = vi.fn();
    const mountLeaderboard = vi.fn(() => ({ ready: Promise.resolve(), unmount }));
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({ session }),
      pathname: "/",
      search: "?leaderboard=track.mario_kart_stadium&mode=200",
      mountLeaderboard: mountLeaderboard as never,
    });
    await mounted.ready;
    // The board renders for everyone; the session resolves afterwards
    // only to decide whether the inline submission field appears.
    expect(mountLeaderboard).toHaveBeenCalledWith(
      expect.anything(),
      "track.mario_kart_stadium",
      200,
      expect.anything(),
    );
    expect(node(root, "Home").attributes.get("href")).toBe("/");
    mounted.unmount();
    expect(unmount).toHaveBeenCalledOnce();
  });

  it("hands a shared run's id to the leaderboard it opens (ADR-0199 &run=)", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mountLeaderboard = vi.fn(() => ({ ready: Promise.resolve(), unmount() {} }));
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({ session: vi.fn(async () => null) }),
      pathname: "/",
      search: "?leaderboard=track.mario_kart_stadium&mode=200&run=user_submission.time.A1",
      mountLeaderboard: mountLeaderboard as never,
    });
    await mounted.ready;
    expect(mountLeaderboard).toHaveBeenCalledWith(
      expect.anything(),
      "track.mario_kart_stadium",
      200,
      expect.objectContaining({ focusResultId: "user_submission.time.A1" }),
    );
    mounted.unmount();
  });

  it("renders the public Player profile without waiting on a session", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    // Owner decision: the public profile stays session-independent and
    // renders immediately; the signed-in enrichment (Follow/Rival
    // controls, topbar state) is a NON-BLOCKING check afterwards. A
    // session that never resolves must not block the public render.
    const session = vi.fn(() => new Promise<never>(() => undefined));
    const unmount = vi.fn();
    const mountPublicProfile = vi.fn(() => ({
      ready: Promise.resolve(),
      unmount,
    }));
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({ session: session as never }),
      pathname: "/",
      search: "?player=player.synthetic_public_page_01",
      mountPublicProfile: mountPublicProfile as never,
    });
    await mounted.ready;
    expect(mountPublicProfile).toHaveBeenCalledWith(
      expect.anything(),
      "player.synthetic_public_page_01",
      "overview",
      // Who is looking, handed over unresolved so the public profile never
      // waits on a session to render.
      expect.any(Promise),
    );
    // W25-W27 carry their own design-system surfaces and no legacy route layer.
    expect(routeLayer(root).classList.contains(
      "page-shell--timing-tower",
    )).toBe(false);
    expect(routeLayer(root).classList.contains(
      "page-shell--player-control",
    )).toBe(false);
    expect(routeLayer(root).classList.contains(
      "page-shell--player-overview",
    )).toBe(false);
    expect(node(root, "Home").attributes.get("href")).toBe("/");
    mounted.unmount();
    expect(unmount).toHaveBeenCalledOnce();
  });

  it("keeps Mastery on the Player route without a legacy route palette", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mountPublicProfile = vi.fn(() => ({
      ready: Promise.resolve(),
      unmount() {},
    }));
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({ session: vi.fn(() => new Promise<never>(() => undefined)) as never }),
      pathname: "/",
      search: "?player=player.synthetic_public_page_01&tab=mastery",
      mountPublicProfile: mountPublicProfile as never,
    });
    await mounted.ready;
    expect(mountPublicProfile).toHaveBeenCalledWith(
      expect.anything(),
      "player.synthetic_public_page_01",
      "mastery",
      // Who is looking, handed over unresolved so the public profile never
      // waits on a session to render.
      expect.any(Promise),
    );
    expect(routeLayer(root).classList.contains("page-shell--player-control"))
      .toBe(false);
    expect(routeLayer(root).classList.contains("page-shell--mastery-control"))
      .toBe(false);
    expect(routeLayer(root).classList.contains("page-shell--player-overview"))
      .toBe(false);
    mounted.unmount();
  });

  it("scopes Player comparison styling without changing its route contract", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mountCompare = vi.fn(() => ({
      ready: Promise.resolve(),
      unmount() {},
    }));
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({ session: vi.fn(() => new Promise<never>(() => undefined)) as never }),
      pathname: "/",
      search: "?compare=player.a,player.b",
      mountCompare: mountCompare as never,
    });
    await mounted.ready;
    // W12 is on the design system (Phase 12): the route still hands the view both Player ids, and
    // now also the engine handling the address carries (R6). It needs no legacy route frame.
    expect(mountCompare).toHaveBeenCalledWith(
      expect.anything(),
      "player.a",
      "player.b",
      expect.objectContaining({ onEngineChange: expect.any(Function) }),
    );
    expect(routeLayer(root).classList.contains("page-shell--timing-tower"))
      .toBe(false);
    expect(routeLayer(root).classList.contains("page-shell--compare-control"))
      .toBe(false);
    mounted.unmount();
  });

  it("scopes the Build configurator without changing its permalink route", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mountBuild = vi.fn(() => ({
      ready: Promise.resolve(),
      unmount() {},
    }));
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({ session: vi.fn(() => new Promise<never>(() => undefined)) as never }),
      pathname: "/",
      search: "?build=character.mario,body.standard_kart,tire.normal,glider.super_glider",
      mountBuild: mountBuild as never,
    });
    await mounted.ready;
    expect(mountBuild).toHaveBeenCalledWith(
      expect.anything(),
      "character.mario,body.standard_kart,tire.normal,glider.super_glider",
    );
    // W14 is on the design system (Phase 12): no legacy route frame, and the permalink is unchanged.
    expect(routeLayer(root).classList.contains("page-shell--timing-tower"))
      .toBe(false);
    expect(routeLayer(root).classList.contains("page-shell--build-control"))
      .toBe(false);
    mounted.unmount();
  });

  it("keeps signed-in chrome current on published Tournament standings", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const session = vi.fn(async () => null);
    const unmount = vi.fn();
    const mountPublicTournament = vi.fn(() => ({
      ready: Promise.resolve(),
      unmount,
    }));
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({ session }),
      pathname: "/",
      search: "?tournament=tournament_publication.synthetic_event_001",
      mountPublicTournament: mountPublicTournament as never,
    });
    await mounted.ready;
    expect(session).toHaveBeenCalledOnce();
    expect(mountPublicTournament).toHaveBeenCalledWith(
      expect.anything(),
      "tournament_publication.synthetic_event_001",
    );
    // W22 is on the design system (Phase 12): it needs no legacy route frame. The Night and
    // operator families have since retired `tournament-control` too.
    expect(routeLayer(root).classList.contains(
      "page-shell--timing-tower",
    )).toBe(false);
    expect(routeLayer(root).classList.contains(
      "page-shell--tournament-control",
    )).toBe(false);
    expect(routeLayer(root).classList.contains(
      "page-shell--player-control",
    )).toBe(false);
    expect(routeLayer(root).classList.contains(
      "page-shell--mastery-control",
    )).toBe(false);
    expect(routeLayer(root).classList.contains(
      "page-shell--compare-control",
    )).toBe(false);
    expect(routeLayer(root).classList.contains(
      "page-shell--build-control",
    )).toBe(false);
    expect(routeLayer(root).classList.contains(
      "page-shell--activity-control",
    )).toBe(false);
    expect(routeLayer(root).classList.contains(
      "page-shell--community-control",
    )).toBe(false);
    mounted.unmount();
    expect(unmount).toHaveBeenCalledOnce();
  });

  it("shows generic magic-link feedback without revealing account existence", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const requestMagicLink = vi.fn(async () => undefined);
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({ requestMagicLink }),
      pathname: "/",
      search: "",
    });
    await mounted.ready;

    const input = descendants(root).find((candidate) => candidate.type === "email")!;
    input.value = "player@example.test";
    descendants(root).find((candidate) => candidate.tagName === "form")!.dispatch("submit");
    await settle();
    expect(requestMagicLink).toHaveBeenCalledWith(
      "player@example.test",
      "/",
      expect.any(AbortSignal),
    );
    expect(mounted.status.textContent).toBe("Check player@example.test");
    const feedback = String(descendants(root)
      .find((candidate) => candidate.className === "ds-body-s ds-signin__status")
      ?.textContent);
    // The wording must not depend on whether that address has an account.
    expect(feedback).toContain("If that address can receive mail");
    expect(feedback).not.toMatch(/existing|already have|new account|unknown/i);
  });

  it("renders the hero-first Home without duplicated navigation", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({
        async session() { return { authenticated: true }; },
        async capabilities() { return { administrator: true }; },
      }),
      pathname: "/",
      search: "",
    });
    await mounted.ready;
    await settle();

    const texts = descendants(routeLayer(root)).map((candidate) => candidate.textContent);
    // No duplicated page chrome: the shell already carries the brand, the identity, notifications
    // and - since Phase 5 - Settings and Sign out inside the account menu.
    expect(texts).not.toContain("Signed in.");
    expect(texts).not.toContain("Sign out");
    expect(texts).not.toContain("Settings");
    expect(descendants(root).find((candidate) =>
      candidate.className === "ds-icon-button ds-topbar__bell")?.hidden).toBe(false);
    for (const label of ["Notifications", "Settings"]) {
      expect(descendants(root).some((candidate) =>
        candidate.attributes.get("role") === "menuitem" &&
        candidate.textContent === label)).toBe(true);
    }
    // The notification preview exists but stays hidden while nothing is
    // unread; the topbar bell remains the permanent entrance.
    const inbox = descendants(root).find((candidate) =>
      candidate.className === "notifications");
    expect(inbox).toBeUndefined();
    // Phase 10: Home is the design system's own HIGH-spectacle page, not the retired `.home-hero`
    // block. In this synthetic session the comeback document is unreachable, and an unreachable
    // Home now says so (W34) instead of telling a Player who already has one to set one up - which
    // is what the old `catch { comeback = null }` did.
    expect(descendants(root).some((candidate) =>
      candidate.className.includes("ds-home"))).toBe(true);
    expect(descendants(root).some((candidate) =>
      candidate.attributes.get("data-state") === "error")).toBe(true);
    mounted.unmount();
  });

  it("serves Settings and My stats as dedicated session pages", async () => {
    const document = new FakeDocument();
    const cases: [string, Record<string, unknown>, () => void][] = [];
    const mountClaim = vi.fn(() => ({ ready: Promise.resolve(), unmount() {} }));
    const mountInsights = vi.fn(() => ({ ready: Promise.resolve(), unmount() {} }));
    cases.push(["?settings=1", { mountClaim }, () => {
      expect(mountClaim).toHaveBeenCalledOnce();
    }]);
    cases.push(["?mystats=1", { mountInsights }, () => {
      expect(mountInsights).toHaveBeenCalledOnce();
    }]);
    for (const [search, overrides, assert] of cases) {
      const root = document.createElement("div");
      const mounted = mountAuthenticationProductPage(
        root as unknown as HTMLElement,
        {
          client: client({
            async session() {
              return { authenticated: true };
            },
          }),
          pathname: "/",
          search,
          ...(overrides as object),
        },
      );
      await mounted.ready;
      assert();
      mounted.unmount();
    }
  });

  it("keeps the Admin page behind an administrator session", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mountAdministratorReview = vi.fn(() => ({
      ready: Promise.resolve(),
      unmount() {},
    }));
    const mountTournamentPublication = vi.fn(() => ({
      ready: Promise.resolve(),
      unmount() {},
    }));
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({
        async session() { return { authenticated: true }; },
        async capabilities() { return { administrator: true }; },
      }),
      pathname: "/",
      search: "?admin=1",
      mountAdministratorReview: mountAdministratorReview as never,
      mountTournamentPublication: mountTournamentPublication as never,
    });
    await mounted.ready;
    expect(mountAdministratorReview).toHaveBeenCalledOnce();
    expect(mountTournamentPublication).toHaveBeenCalledOnce();
    mounted.unmount();

    const ordinaryRoot = document.createElement("div");
    const ordinaryReview = vi.fn();
    const ordinary = mountAuthenticationProductPage(
      ordinaryRoot as unknown as HTMLElement,
      {
        client: client({
          async session() {
            return { authenticated: true };
          },
        }),
        pathname: "/",
        search: "?admin=1",
        mountAdministratorReview: ordinaryReview as never,
      },
    );
    await ordinary.ready;
    // Only the link requests a Director may decide (ADR-0216), hidden while there are none.
    expect(ordinaryReview).toHaveBeenCalledOnce();
    expect(ordinaryReview.mock.calls[0]?.[2]).toEqual({ hideWhenEmpty: true });
    expect(ordinary.status.textContent).toBe(
      "Administrator access is required.",
    );
    ordinary.unmount();
  });

  it("does not probe administrator products for an ordinary account", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mountAdministratorReview = vi.fn();
    const mountTournamentPublication = vi.fn();
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({
        async session() { return { authenticated: true }; },
        async capabilities() { return { administrator: false }; },
      }),
      pathname: "/",
      search: "",
      mountPostTime: () => ({ unmount() {}, heading: document.createElement("h1") as unknown as HTMLElement }),
      mountClaim: () => ({ ready: Promise.resolve(), unmount() {} }),
      mountInsights: () => ({ ready: Promise.resolve(), unmount() {} }),
      mountAdministratorReview: mountAdministratorReview as never,
      mountTournamentPublication: mountTournamentPublication as never,
    });
    await mounted.ready;

    expect(mountAdministratorReview).not.toHaveBeenCalled();
    expect(mountTournamentPublication).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it("offers Switch account beside Sign out, and Player visibility, in Settings", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const signOut = vi.fn(async () => undefined);
    const mountPlayerVisibility = vi.fn(() => ({
      ready: Promise.resolve(),
      unmount() {},
    }));
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({
        async session() { return { authenticated: true }; },
        async capabilities() { return { administrator: false }; },
        signOut,
      }),
      pathname: "/",
      search: "?settings=1",
      mountClaim: () => ({ ready: Promise.resolve(), unmount() {} }),
      mountPlayerVisibility: mountPlayerVisibility as never,
    });
    await mounted.ready;
    // Public/Private Player belongs with the Player itself.
    expect(mountPlayerVisibility).toHaveBeenCalledOnce();
    expect(node(routeLayer(root), "Sign out")).toBeDefined();
    // Handing the browser to someone else is its own intention, and it is
    // described honestly rather than hidden behind Sign out.
    expect(descendants(root).some((candidate) =>
      String(candidate.textContent).includes(
        "Switching signs you out here first"))).toBe(true);
    node(routeLayer(root), "Switch account").dispatch("click");
    await settle();
    await settle();
    expect(signOut).toHaveBeenCalledOnce();
    expect(mounted.status.textContent).toBe(
      "Signed out. Sign in with a different account to continue.",
    );
    mounted.unmount();
  });

  it("signs out on all devices only after the confirmation, through the revocation (ADR-0224)", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const signOut = vi.fn(async () => undefined);
    const signOutEverywhere = vi.fn(async () => undefined);
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({
        async session() { return { authenticated: true }; },
        async capabilities() { return { administrator: false }; },
        signOut,
        signOutEverywhere,
      }),
      pathname: "/",
      search: "?settings=1",
      mountClaim: () => ({ ready: Promise.resolve(), unmount() {} }),
      mountPlayerVisibility: () => ({ ready: Promise.resolve(), unmount() {} }),
    });
    await mounted.ready;
    node(root, "Sign out on all devices").dispatch("click");
    // Nothing happens before the person confirms.
    expect(signOutEverywhere).not.toHaveBeenCalled();
    const confirmation = descendants(document.body).find((candidate) => candidate.tagName === "dialog");
    expect(confirmation?.open).toBe(true);
    expect(String(confirmation?.textContent)).toContain("other browsers, phones and the apps");
    node(document.body, "Sign out everywhere").dispatch("click");
    await settle();
    await settle();
    await settle();
    expect(signOutEverywhere).toHaveBeenCalledOnce();
    expect(signOut).not.toHaveBeenCalled();
    expect(mounted.status.textContent).toBe("Signed out on all devices.");
    // The ordinary Sign out is still this device only.
    expect(node(root, "Sign out")).toBeDefined();
    mounted.unmount();
  });

  it("offers Add another device only to a Player account in an offline-invitation installation", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("synthetic offline"); }));
    try {
      const card = {
        invitationUrl: `https://192.168.1.20/offline-invite#token=${"A".repeat(43)}`,
        expiresAtMs: Date.now() + 900_000,
        qr: { size: 21, modules: Array.from({ length: 441 }, () => true) },
      };
      const cases = [
        { mode: "offline-invitation", administrator: false, offered: true },
        { mode: "offline-invitation", administrator: true, offered: false },
        { mode: "email-link", administrator: false, offered: false },
      ] as const;
      for (const { mode, administrator, offered } of cases) {
        const document = new FakeDocument();
        const root = document.createElement("div");
        const createDeviceInvitation = vi.fn(async () => card);
        const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
          client: client({
            async session() { return { authenticated: true }; },
            async capabilities() { return { administrator }; },
            async installationMode() { return mode; },
            createDeviceInvitation,
          }),
          pathname: "/",
          search: "?settings=1",
          mountClaim: () => ({ ready: Promise.resolve(), unmount() {} }),
          mountPlayerVisibility: () => ({ ready: Promise.resolve(), unmount() {} }),
        });
        await mounted.ready;
        await vi.advanceTimersByTimeAsync(1_200);
        const items = descendants(root).filter((candidate) =>
          candidate.textContent === "Add another device" && candidate.tagName === "button");
        expect(items.length > 0).toBe(offered);
        if (offered) {
          items[0]!.dispatch("click");
          await settle();
          await settle();
          expect(createDeviceInvitation).toHaveBeenCalledOnce();
          const dialog = descendants(document.body).find((candidate) => candidate.tagName === "dialog");
          expect(dialog?.open).toBe(true);
          expect(descendants(dialog!).some((candidate) => candidate.value === card.invitationUrl)).toBe(true);
          dialog!.close();
        }
        mounted.unmount();
      }
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("shows the header signed out the moment the session ends", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({
        async session() { return { authenticated: true }; },
        async capabilities() { return { administrator: false }; },
      }),
      pathname: "/",
      search: "?settings=1",
      mountClaim: () => ({ ready: Promise.resolve(), unmount() {} }),
      mountPlayerVisibility: () => ({ ready: Promise.resolve(), unmount() {} }),
    });
    await mounted.ready;
    const byClass = (name: string): FakeNode => {
      const found = descendants(root).find((candidate) => candidate.className === name);
      if (found === undefined) { throw new Error(`synthetic class missing: ${name}`); }
      return found;
    };
    // Signed in: the account controls, no Sign in, no language switch.
    expect(byClass("ds-icon-button ds-topbar__bell").hidden).toBe(false);
    expect(byClass("ds-topbar__account-slot").hidden).toBe(false);
    expect(node(root, "Sign in").hidden).toBe(true);
    expect(byClass("ds-language-toggle").hidden).toBe(true);
    node(routeLayer(root), "Sign out").dispatch("click");
    await settle();
    await settle();
    // Signed out: the shell says so at once, without a reload.
    expect(node(root, "Sign in").hidden).toBe(false);
    expect(byClass("ds-language-toggle").hidden).toBe(false);
    for (const control of ["ds-icon-button ds-topbar__bell", "ds-topbar__account-slot"]) {
      expect(byClass(control).hidden).toBe(true);
    }
    mounted.unmount();
  });

  it("offers a signed-out visitor NL | EN in the header", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client(),
      pathname: "/",
      search: "?apps=1",
    });
    await mounted.ready;
    await settle();
    const toggle = descendants(root).find((candidate) =>
      candidate.classList.contains("ds-language-toggle"));
    expect(toggle?.hidden).toBe(false);
    expect(toggle?.children.slice(0, 2).map((option) => option.textContent)).toEqual(["EN", "NL"]);
    // The 13 other game languages share one compact list (roadmap LANGUAGES_15).
    expect(toggle?.children[2]?.className).toBe("ds-language-more");
    expect(toggle?.children[2]?.children).toHaveLength(14);
    // English is the product default, so it is the pressed option. The selected state is ARIA, not
    // a --active class (IMPLEMENTATION_PLAN §0 lint rule 4).
    expect(toggle?.children.slice(0, 2).map((option) => option.attributes.get("aria-pressed")))
      .toEqual(["true", "false"]);
    expect(toggle?.children.every((option) =>
      !String(option.className).includes("--active"))).toBe(true);
    mounted.unmount();
  });

  it("uses URL-addressable design-system sections for Administration", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mountAdministratorTimeTrials = vi.fn(() => ({
      ready: Promise.resolve(),
      unmount() {},
    }));
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({
        async session() { return { authenticated: true }; },
        async capabilities() { return { administrator: true }; },
      }),
      pathname: "/",
      search: "?admin=1",
      mountAdministratorReview: (() => ({
        ready: Promise.resolve(), unmount() {},
      })) as never,
      mountTournamentPublication: (() => ({
        ready: Promise.resolve(), unmount() {},
      })) as never,
      mountAdministratorTimeTrials: mountAdministratorTimeTrials as never,
    });
    await mounted.ready;
    expect(mountAdministratorTimeTrials).toHaveBeenCalledOnce();
    expect(routeLayer(root).classList.contains("page-shell--timing-tower")).toBe(false);
    expect(descendants(root).filter((candidate) => candidate.tagName === "h1" && !candidate.hidden))
      .toHaveLength(1);
    const tab = node(root, "Time Trials");
    expect(tab.tagName).toBe("a");
    expect(tab.attributes.get("href")).toBe("/?admin=time-trials");
    expect(tab.attributes.has("aria-current")).toBe(false);
    expect(tab.className.includes("--active")).toBe(false);
    tab.dispatch("click");
    expect(tab.attributes.get("aria-current")).toBe("page");
    expect(node(root, "Overview").attributes.has("aria-current")).toBe(false);
    mounted.unmount();
  });

  it("gives a new account the welcome route, not the Settings page", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mountWelcome = vi.fn(() => ({ ready: Promise.resolve(), unmount() {} }));
    const mountClaim = vi.fn();
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({
        async session() { return { authenticated: true }; },
        async capabilities() { return { administrator: false }; },
      }),
      pathname: "/",
      search: "?welcome=1",
      mountWelcome: mountWelcome as never,
      mountClaim: mountClaim as never,
    });
    await mounted.ready;
    expect(mountWelcome).toHaveBeenCalledOnce();
    expect(routeLayer(root).classList.contains("page-shell--timing-tower")).toBe(false);
    // None of the Settings furniture: no sign-out button, no language
    // dropdown, no claim section, no pile of Save buttons.
    expect(mountClaim).not.toHaveBeenCalled();
    expect(descendants(routeLayer(root)).some((candidate) =>
      String(candidate.textContent) === "Sign out")).toBe(false);
    expect(descendants(routeLayer(root)).filter((candidate) =>
      String(candidate.textContent).startsWith("Save"))).toHaveLength(0);
    mounted.unmount();
  });

  it("no longer redirects the retired ?settings=1&onboarding=1 address (2026-11-02: no old links)", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mountWelcome = vi.fn(() => ({ ready: Promise.resolve(), unmount() {} }));
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({
        async session() { return { authenticated: true }; },
        async capabilities() { return { administrator: false }; },
      }),
      pathname: "/",
      search: "?settings=1&onboarding=1",
      mountWelcome: mountWelcome as never,
    });
    await mounted.ready;
    expect(mountWelcome).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it("says so when a sign-in link has expired or was already opened", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({ async session() { return null; } }),
      pathname: "/",
      search: "?authError=1",
    });
    await mounted.ready;
    // W03 (Phase 12): the failed-link notice is the design system's warning message, one sentence
    // in one live region, so the reader is told the same way everything else tells them.
    const failure = descendants(root).find((candidate) =>
      candidate.className === "ds-status" && candidate.attributes.get("data-tone") === "warning");
    expect(failure).toBeDefined();
    expect(String(failure?.textContent)).toContain("That link did not work");
    expect(String(failure?.textContent)).toContain("we will send a fresh one");
    mounted.unmount();
  });

  it("lets a delegated Tournament operator run Web without administrator access", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mountTournamentOperation = vi.fn((container: unknown, _options?: unknown) => ({
      container,
      ready: Promise.resolve(),
      unmount() {},
    }));
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({
        async session() { return { authenticated: true }; },
        async capabilities() { return { administrator: false, tournamentOperation: true }; },
      }),
      pathname: "/",
      search: "?tournaments=1&operate=1",
      mountTournamentOperation: mountTournamentOperation as never,
    });
    await mounted.ready;
    expect(mountTournamentOperation).toHaveBeenCalledOnce();
    expect(mountTournamentOperation.mock.calls[0]?.[1]).toMatchObject({ administrator: false });
    expect(mounted.status.textContent).not.toContain("Administrator");
    // Phase 14: Race Direction owns a MINIMAL design-system root. A delegated operator still gets
    // the exact same capability, but neither of the retired route palettes frames it.
    expect(routeLayer(root).classList.contains("page-shell--timing-tower"))
      .toBe(false);
    expect(routeLayer(root).classList.contains("page-shell--tournament-control"))
      .toBe(false);
    mounted.unmount();
  });

  it("shows Time Trial and Tournament ranking as distinct visible tabs", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mountTimeTrialStanding = vi.fn(() => ({
      ready: Promise.resolve(),
      unmount() {},
    }));
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client(),
      pathname: "/",
      search: "?ranking=timetrials",
      mountTimeTrialStanding: mountTimeTrialStanding as never,
    });
    await mounted.ready;
    expect(node(root, "Time Trials")).toBeDefined();
    expect(node(root, "Tournament")).toBeDefined();
    expect(mountTimeTrialStanding).toHaveBeenCalledOnce();
    // Ranking is migrated: it has no legacy route layer left to carry.
    expect(routeLayer(root).classList.contains("page-shell--ranking-pilot"))
      .toBe(false);
    // Presentation changes, navigation does not: the canonical track destination and its label
    // are the same in the top bar and in the phone tab bar (the widths only choose which is shown).
    const tracks = descendants(root).filter((candidate) =>
      candidate.attributes.get("data-nav-key") === "tracks");
    expect(tracks.length).toBe(2);
    for (const link of tracks) {
      expect(link.attributes.get("href")).toBe("/?cups=1");
      expect(link.textContent).toBe("Tracks");
    }
    mounted.unmount();
  });

  it("reviews and approves a prefilled allow-listed device request", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const approveDevice = vi.fn(async () => undefined);
    const lookup = vi.fn(async () => ({
      userCode: "ABCD-1234",
      clientId: "mk8dx.timetrials.android.v1" as const,
    }));
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({
        async session() { return { authenticated: true }; },
        device: lookup,
        approveDevice,
      }),
      pathname: "/device",
      search: "?user_code=ABCD-1234",
    });
    await mounted.ready;

    expect(lookup).toHaveBeenCalledWith("ABCD-1234");
    expect(node(root, "MK8DX Time Trials for Android requests access to your account."))
      .toBeDefined();
    node(root, "Approve device").dispatch("click");
    await settle();
    expect(approveDevice).toHaveBeenCalledWith("ABCD-1234");
    expect(mounted.status.textContent).toBe(
      "Device approved. Go back to the app to finish signing in.",
    );
  });

  it("returns to the interrupted protected page after signing in", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const requestMagicLink = vi.fn(async () => undefined);
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({ requestMagicLink }),
      pathname: "/",
      search: "?settings=1",
    });
    await mounted.ready;
    const input = descendants(root).find((candidate) => candidate.type === "email")!;
    input.value = "player@example.test";
    descendants(root).find((candidate) => candidate.tagName === "form")!.dispatch("submit");
    await settle();
    // The interrupted destination rides the magic link.
    expect(requestMagicLink).toHaveBeenCalledWith(
      "player@example.test",
      "/?settings=1",
      expect.any(AbortSignal),
    );
    mounted.unmount();
  });

  it("leads with the form and honours the carried destination on the sign-in route", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const requestMagicLink = vi.fn(async () => undefined);
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({ requestMagicLink }),
      pathname: "/",
      search: "?signin=1&return=%2F%3Fapps%3D1",
    });
    await mounted.ready;
    // The person clicked Sign in: the form leads, the landing follows.
    const landing = descendants(root).find((candidate) =>
      candidate.className.includes("ds-home"))!;
    expect(landing.children[0]?.className).toBe("ds-panel");
    expect(landing.children[0]?.textContent).toContain("Sign in, or start racing with us");
    expect(landing.children[1]?.className).toBe("ds-hero");
    const input = descendants(root).find((candidate) => candidate.type === "email")!;
    input.value = "player@example.test";
    descendants(root).find((candidate) => candidate.tagName === "form")!.dispatch("submit");
    await settle();
    expect(requestMagicLink).toHaveBeenCalledWith(
      "player@example.test",
      "/?apps=1",
      expect.any(AbortSignal),
    );
    mounted.unmount();
  });

  it("refuses a tampered return destination and falls back to Home", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const requestMagicLink = vi.fn(async () => undefined);
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({ requestMagicLink }),
      pathname: "/",
      search: "?signin=1&return=https%3A%2F%2Fevil.example%2F",
    });
    await mounted.ready;
    const input = descendants(root).find((candidate) => candidate.type === "email")!;
    input.value = "player@example.test";
    descendants(root).find((candidate) => candidate.tagName === "form")!.dispatch("submit");
    await settle();
    expect(requestMagicLink).toHaveBeenCalledWith(
      "player@example.test",
      "/",
      expect.any(AbortSignal),
    );
    mounted.unmount();
  });

  it("continues a signed-in visitor from the sign-in route to the destination", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mountInsights = vi.fn(() => ({ ready: Promise.resolve(), unmount() {} }));
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({
        async session() { return { authenticated: true }; },
      }),
      pathname: "/",
      search: "?signin=1&return=%2F%3Fmystats%3D1",
      mountInsights: mountInsights as never,
    });
    await mounted.ready;
    expect(mountInsights).toHaveBeenCalledOnce();
    mounted.unmount();
  });

  it("hands the track board the way back after a sign-in, and keeps no route layer", async () => {
    // Phase 9: the board owns the entry and the sign-in prompt (asserted in ds-track-board.test.ts).
    // What the router still owes it is the return intent for this exact track and engine class - and
    // no legacy route layer, because W07 is the design system's own page now.
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mountLeaderboard = vi.fn(() => ({ ready: Promise.resolve(), unmount() {} }));
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client(),
      pathname: "/",
      search: "?leaderboard=track.big_blue&mode=200",
      mountLeaderboard: mountLeaderboard as never,
    });
    await mounted.ready;
    await settle();
    const [, trackId, mode, boardOptions] = mountLeaderboard.mock.calls[0] as unknown as
      [unknown, string, number, { signInHref?: (returnTo: string) => string }];
    expect(trackId).toBe("track.big_blue");
    expect(mode).toBe(200);
    expect(boardOptions.signInHref?.("/?leaderboard=track.big_blue&mode=200")).toBe(
      "/?signin=1&return=%2F%3Fleaderboard%3Dtrack.big_blue%26mode%3D200",
    );
    expect(routeLayer(root).classList.contains("page-shell--track-control"))
      .toBe(false);
    expect(descendants(root).some((candidate) =>
      candidate.className === "track-board__submission")).toBe(false);
    mounted.unmount();
  });

  it("scopes the Track directory presentation without changing its route", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mountCups = vi.fn(() => ({ ready: Promise.resolve(), unmount() {} }));
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client(),
      pathname: "/",
      search: "?cups=1",
      mountCups: mountCups as never,
    });
    await mounted.ready;
    expect(mountCups).toHaveBeenCalledOnce();
    // W06 is on the design system (Phase 12): it draws `.ds-root` and needs no legacy route frame.
    expect(routeLayer(root).classList.contains("page-shell--tracks-control")).toBe(false);
    expect(routeLayer(root).classList.contains("page-shell--timing-tower")).toBe(false);
    expect(node(root, "Tracks").attributes.get("href")).toBe("/?cups=1");
    mounted.unmount();
  });

  it("scopes Record Control without changing the Records route", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client(),
      pathname: "/",
      search: "?records=1",
    });
    await mounted.ready;
    // W13 is on the design system (Phase 12): no legacy route frame, and the route is unchanged.
    expect(routeLayer(root).classList.contains("page-shell--records-control"))
      .toBe(false);
    expect(routeLayer(root).classList.contains("page-shell--timing-tower")).toBe(false);
    expect(node(root, "Records").attributes.get("href")).toBe("/?records=1");
    mounted.unmount();
  });

  it("scopes Community Control without changing the Community route", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const unmount = vi.fn();
    const mountCommunity = vi.fn(() => ({
      ready: Promise.resolve(),
      unmount,
    }));
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client(),
      pathname: "/",
      search: "?community=1",
      mountCommunity: mountCommunity as never,
    });
    await mounted.ready;
    expect(mountCommunity).toHaveBeenCalledOnce();
    // W15 is on the design system (Phase 12): no legacy route frame, and the route is unchanged.
    expect(routeLayer(root).classList.contains("page-shell--community-control"))
      .toBe(false);
    expect(routeLayer(root).classList.contains("page-shell--timing-tower")).toBe(false);
    expect(node(root, "Community").attributes.get("href"))
      .toBe("/?community=1");
    mounted.unmount();
    expect(unmount).toHaveBeenCalledOnce();
  });

  it("preserves the device callback while signed out", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const requestMagicLink = vi.fn(async () => undefined);
    const mounted = mountAuthenticationProductPage(root as unknown as HTMLElement, {
      client: client({ requestMagicLink }),
      pathname: "/device",
      search: "?user_code=ABCD-1234",
    });
    await mounted.ready;
    const input = descendants(root).find((candidate) => candidate.type === "email")!;
    input.value = "player@example.test";
    descendants(root).find((candidate) => candidate.tagName === "form")!.dispatch("submit");
    await settle();
    expect(requestMagicLink).toHaveBeenCalledWith(
      "player@example.test",
      "/device?user_code=ABCD-1234",
      expect.any(AbortSignal),
    );
  });
});
