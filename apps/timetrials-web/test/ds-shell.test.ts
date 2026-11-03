import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  isKnownRoute, routeDocumentTitle, routeGlobalAction, routeSpectacle,
} from "../src/route-identity.js";

const shellSource = readFileSync(new URL("../src/ds-shell.ts", import.meta.url), "utf8");
const shellStyle = readFileSync(new URL("../styles/ds-shell.css", import.meta.url), "utf8");
const workflowStyle = readFileSync(new URL("../styles/ds-workflows.css", import.meta.url), "utf8");
const productPage = readFileSync(
  new URL("../src/authentication-product-page.ts", import.meta.url), "utf8");

describe("the shell keeps every destination the old header had (T-NAV)", () => {
  it("lets shared chrome own the viewport without changing every route's established canvas", () => {
    expect(shellStyle).not.toContain("body:has(.ds-app) { margin: 0; }");
    expect(shellStyle).toContain("body:has(.ds-rank) { margin: 0; }");
    expect(shellStyle).toContain("margin: -8px -8px 0;");
    expect(shellStyle).toContain("body:has(.ds-rank) .ds-topbar { margin: 0; }");
  });

  it("offers the seven destinations at their existing addresses", () => {
    for (const [key, href] of [
      ["home", '"/"'], ["tracks", '"/?cups=1"'], ["ranking", '"/?ranking=1"'],
      ["records", '"/?records=1"'], ["build", '"/?build=1"'],
      ["community", '"/?community=1"'], ["tournaments", '"/?tournaments=1"'],
    ]) {
      expect(shellSource).toContain(`key: "${key}", href: ${href}`);
    }
  });

  it("puts five of them in the phone tab bar, and the rest in the account menu", () => {
    const tabs = [...shellSource.matchAll(/key: "(\w+)", href: [^,]+, tab: true/gu)]
      .map((match) => match[1]);
    expect(tabs).toEqual(["home", "tracks", "ranking", "build", "tournaments"]);
    // The phone path to Records and Community that the five-slot bar used to lose.
    expect(shellSource).toContain('{ label: text.destinations.records, href: "/?records=1" }');
    expect(shellSource).toContain('{ label: text.destinations.community, href: "/?community=1" }');
  });

  it("keeps the account, notification, apps and language controls of the old header", () => {
    for (const marker of [
      '"/?apps=1"', '"/?notifications=1"', '"/?settings=1"', '"/?mystats=1"',
      "text.administration", "onSwitchAccount", "onSignOut", "languageToggle",
    ]) {
      expect(shellSource).toContain(marker);
    }
    expect(shellSource).toContain('"ds-icon-button ds-topbar__settings"');
    expect(shellStyle).toContain('.ds-topbar__account-name { display: inline;');
    expect(shellStyle).toContain('.ds-topbar__settings:not([hidden]) { display: inline-flex; }');
    expect(shellSource).toContain('notificationsLink.toggleAttribute("data-unread", count > 0);');
    expect(shellStyle).toContain('.ds-topbar__bell[data-unread] { color: var(--ds-action-primary); }');
  });

  it("uses the installed app's compact bottom-tab geometry on phones", () => {
    expect(shellStyle).toContain("min-height: 64px;");
    expect(shellSource).toContain('{ size: "compact", markPx: 48');
    expect(shellStyle).toContain(".ds-topbar__actions { gap: 5px; }");
    expect(shellStyle).toContain(".ds-topbar__actions .ds-icon-button { min-width: 48px; min-height: 48px; }");
    expect(shellStyle).toContain("column-gap: var(--ds-space-xxs);");
    expect(shellStyle).toContain("padding-inline: var(--ds-space-xs);");
    expect(shellStyle).toContain("font-size: 10px; line-height: 11px;");
    expect(shellStyle).toContain('background: var(--ds-surface-selected);');
    expect(shellStyle).toContain('.ds-tab-link[aria-current="page"]::after');
  });

  it("hides what a width does not show, rather than leaving it focusable", () => {
    // A control that is off-screen but still in the tab order is worse than one that is absent.
    expect(shellStyle).toMatch(/\.ds-nav-link\[data-tablet="false"\] \{ display: none; \}/u);
    expect(shellStyle).toMatch(/@media \(min-width: 600px\) \{ \.ds-bottom-tabs \{ display: none; \} \}/u);
  });

  it("gives the page a skip link, one main, and a route announcement", () => {
    expect(shellSource).toContain('el("a", "ds-root ds-skip"');
    expect(shellSource).toContain('el("main", "ds-app__main"');
    expect(shellSource).toContain('role: "status", "aria-live": "polite"');
    expect(shellSource).toContain("documentRef.title =");
  });

  it("marks the current destination with more than colour", () => {
    expect(shellSource).toContain('node.setAttribute("aria-current", "page")');
    expect(shellStyle).toContain('.ds-nav-link[aria-current="page"]');
    expect(shellStyle).toContain('.ds-tab-link[aria-current="page"]');
    // No --active/--current classes: state is ARIA (IMPLEMENTATION_PLAN §0 lint rule 4).
    expect(shellStyle).not.toMatch(/--(active|selected|current)\b/u);
  });

  it("uses line icons, never the emoji glyphs the old header used", () => {
    for (const emoji of ["🔔", "⚙️", "🏆", "⏱", "🍄"]) {
      expect(shellSource).not.toContain(emoji);
      expect(productPage).not.toContain(emoji);
    }
  });
});

describe("the legacy header is gone, not merely unused", () => {
  it("leaves no .site-nav rule in the workflow stylesheet", () => {
    expect(workflowStyle).not.toContain("site-nav");
  });

  it("builds no .site-nav element any more", () => {
    expect(productPage).not.toContain("site-nav");
  });

  it("has no layer left for a migrated route", () => {
    // Ranking (Phase 6) and the Track board (Phase 9) are the design system's own; their route
    // layers are deleted, not merely unused.
    for (const layer of [
      "ranking-pilot", "track-control", "tracks-control",
      "records-control", "compare-control", "community-control", "activity-control",
      "build-control", "player-overview", "player-control", "mastery-control",
      "tournament-control",
    ]) {
      expect(workflowStyle).not.toContain(`.page-shell--${layer}`);
      expect(productPage).not.toContain(`"page-shell--${layer}"`);
    }
  });

  it("has retired the final timing-tower route layer", () => {
    expect(workflowStyle).not.toContain("page-shell--timing-tower");
    expect(productPage).not.toContain('"page-shell--timing-tower"');
  });
});

describe("the global action steps down by context (§4, T-DOCK)", () => {
  it("is filled where nothing else is primary and outline where the content is", () => {
    expect(routeGlobalAction("?ranking=timetrials")).toBe("filled");
    expect(routeGlobalAction("")).toBe("outline");
    expect(routeGlobalAction("?leaderboard=track.big_blue&mode=200")).toBe("outline");
    expect(routeGlobalAction("?tournaments=1")).toBe("outline");
    expect(routeGlobalAction("?notifications=1")).toBe("outline");
  });

  it("becomes a text link during a task or an operator step", () => {
    expect(routeGlobalAction("?tournaments=x&operate=1")).toBe("link");
    expect(routeGlobalAction("?admin=1")).toBe("link");
    expect(routeGlobalAction("?cups=1")).toBe("link");
  });

  it("disappears where there is nothing to post from", () => {
    expect(routeGlobalAction("?signin=1")).toBe("none");
    expect(routeGlobalAction("?welcome=1")).toBe("none");
    expect(routeGlobalAction("?nonsense=1")).toBe("none");
  });

  it("docks on the phone only when it is the filled action, and only signed in", () => {
    // Phase 10 made the dock scroll-aware (T-DOCK): with no watched action it keeps the Phase 5
    // rule exactly, and with one it waits for that action to leave the viewport.
    expect(shellSource).toContain('watcher === null ? dockLevel !== "filled"');
    expect(shellSource).toContain("dockedAction.hidden = !signedIn ||");
    expect(shellStyle).toMatch(/@media \(min-width: 600px\) \{ \.ds-docked \{ display: none; \} \}/u);
    // The dock lives outside <main>, so it is a landmark of its own: a link belonging to no region
    // is what the Phase 12 browser gate found on the first routes that show the dock at the top.
    expect(shellSource).toContain('role: "complementary", "aria-label": text.postTime,');
  });

  it("becomes scroll-aware when a route hands it its own A4", () => {
    expect(shellSource).toContain("watcher = new view.IntersectionObserver((entries) => {");
    expect(shellSource).toContain("for (const entry of entries) { watchedVisible = entry.isIntersecting; }");
    // A route that arms the dock also names its own destination and label; leaving the route
    // disarms it (`shell.setDock(null)` in the product page's unmountProduct).
    expect(shellSource).toContain('dockedLink.setAttribute("href", dock?.href ?? POST_A_TIME_HREF);');
    expect(shellSource).toContain("dockedLabel.textContent = dock?.label ?? text.postTime;");
  });
});

describe("a route knows its own name and spectacle level", () => {
  it("names every destination, and the device page", () => {
    expect(routeDocumentTitle("")).toBe("Home");
    expect(routeDocumentTitle("?ranking=timetrials")).toBe("Ranking");
    expect(routeDocumentTitle("?records=1")).toBe("Records");
    expect(routeDocumentTitle("?settings=1")).toBe("Settings");
    expect(routeDocumentTitle("", "/device")).toBe("Authorize a device");
  });

  it("reads a ranking seen for a Player as the ranking, not that Player's profile", () => {
    expect(routeDocumentTitle("?ranking=tournament&player=ben")).toBe("Ranking");
    expect(routeDocumentTitle("?player=ben")).toBe("Player");
  });

  it("declares the spectacle level per route family (§5)", () => {
    expect(routeSpectacle("")).toBe("high");
    expect(routeSpectacle("?tournament=tournament.x")).toBe("high");
    expect(routeSpectacle("?leaderboard=track.big_blue")).toBe("medium");
    expect(routeSpectacle("?ranking=timetrials")).toBe("low");
    expect(routeSpectacle("?admin=1")).toBe("minimal");
    expect(routeSpectacle("?tournaments=x&operate=1")).toBe("minimal");
  });
});

describe("an unknown address says so instead of showing Home (W33)", () => {
  it("accepts every address the product routes on, including its carriers", () => {
    for (const search of [
      "", "?cups=1", "?ranking=timetrials&mode=200&scope=all", "?leaderboard=track.big_blue",
      "?player=ben&tab=mastery", "?compare=a,b", "?tournaments=tournament.x&operate=1",
      "?night-report=tournament.x", "?signin=1&return=%2F%3Fapps%3D1", "?authError=expired",
      "?welcome=1", "?settings=1", "?notifications=1", "?mystats=1", "?admin=1",
      "?activity=1", "?records=1", "?build=1", "?community=1", "?apps=1", "?design-gallery=1",
    ]) {
      expect(isKnownRoute(search)).toBe(true);
    }
  });

  it("rejects an address that matches nothing", () => {
    for (const search of ["?nonsense=1", "?utm_source=mail", "?leaderboardd=x"]) {
      expect(isKnownRoute(search)).toBe(false);
      expect(routeDocumentTitle(search)).toBe("Page not found");
    }
  });

  it("is reachable from the product page's own dispatch", () => {
    expect(productPage).toContain("renderNotFound()");
    expect(productPage).toContain("isKnownRoute(currentSearch)");
  });
});
