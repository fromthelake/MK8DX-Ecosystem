// What the shell needs to know about the route it is framing (DESIGN_SYSTEM.md §4, §5, §11).
//
// Three questions, answered from the query alone so they can be answered before, during and after a
// render, and tested without a DOM:
//   - what this page is called (its `document.title` and the route announcement);
//   - which spectacle level it declares, so a LOW route cannot use HIGH components;
//   - which level the global "Post a time" action steps down to here.
//
// It also answers whether a query is a route at all: an address that matches nothing used to render
// Home silently, which told a reader their link worked when it had not (W33).

import { localized } from "./product-language.js";
import type { GlobalActionLevel, SpectacleLevel } from "./ds-shell.js";

/**
 * Every query key the product routes on, plus the carriers that travel with them. A query none of
 * whose keys appear here addresses nothing.
 */
const ROUTE_KEYS: ReadonlySet<string> = new Set([
  "cups", "ranking", "records", "build", "community", "activity",
  "tournaments", "tournament", "night-report", "operate", "director",
  "player", "tab", "compare", "leaderboard", "post", "mode", "scope", "focus",
  "apps", "settings", "notifications", "mystats", "admin",
  "signin", "authError", "welcome", "return",
  // The link in a native sign-in email (ADR-0209).
  "device-email",
  // Development and QA only; main.ts loads the gallery for it.
  "design-gallery",
]);

export function isKnownRoute(search: string): boolean {
  const query = new URLSearchParams(search);
  const keys = [...query.keys()];
  return keys.length === 0 || keys.some((key) => ROUTE_KEYS.has(key));
}

type RouteShape = Readonly<{
  title: () => string;
  spectacle: SpectacleLevel;
  /** DESIGN_SYSTEM §4: filled where nothing else is primary, outline where the content is. */
  action: GlobalActionLevel;
}>;

/** In order: the first key that matches decides, so `?ranking=…&player=…` is still the Ranking. */
const ROUTES: readonly Readonly<{ key: string; shape: RouteShape }>[] = [
  { key: "night-report", shape: { title: () => localized("Night report", "Avondverslag"), spectacle: "high", action: "outline" } },
  { key: "tournament", shape: { title: () => localized("Tournament", "Toernooi"), spectacle: "high", action: "outline" } },
  { key: "operate", shape: { title: () => localized("Race direction", "Wedstrijdleiding"), spectacle: "minimal", action: "link" } },
  { key: "tournaments", shape: { title: () => localized("Tournaments", "Toernooien"), spectacle: "medium", action: "outline" } },
  // The canonical Post-a-Time task (W08). It carries the one A4 of the viewport itself - Publish -
  // so the global action steps all the way down (§4), and the shell hides the tabs (task mode).
  { key: "post", shape: { title: () => localized("Post a time", "Tijd plaatsen"), spectacle: "low", action: "none" } },
  { key: "leaderboard", shape: { title: () => localized("Track", "Circuit"), spectacle: "medium", action: "outline" } },
  { key: "ranking", shape: { title: () => localized("Ranking", "Klassement"), spectacle: "low", action: "filled" } },
  { key: "cups", shape: { title: () => localized("Tracks & cups", "Circuits en cups"), spectacle: "medium", action: "link" } },
  { key: "compare", shape: { title: () => localized("Compare", "Vergelijken"), spectacle: "low", action: "filled" } },
  { key: "build", shape: { title: () => localized("Build", "Kart"), spectacle: "low", action: "filled" } },
  { key: "records", shape: { title: () => localized("Records", "Records"), spectacle: "medium", action: "filled" } },
  { key: "community", shape: { title: () => localized("Community", "Community"), spectacle: "low", action: "filled" } },
  { key: "activity", shape: { title: () => localized("Activity", "Activiteit"), spectacle: "low", action: "filled" } },
  { key: "apps", shape: { title: () => localized("Get the app", "Download de app"), spectacle: "low", action: "filled" } },
  { key: "player", shape: { title: () => localized("Player", "Speler"), spectacle: "medium", action: "outline" } },
  { key: "signin", shape: { title: () => localized("Sign in", "Aanmelden"), spectacle: "minimal", action: "none" } },
  { key: "device-email", shape: { title: () => localized("Approve a sign-in", "Aanmelding goedkeuren"), spectacle: "minimal", action: "none" } },
  { key: "authError", shape: { title: () => localized("Sign in", "Aanmelden"), spectacle: "minimal", action: "none" } },
  { key: "welcome", shape: { title: () => localized("Welcome", "Welkom"), spectacle: "low", action: "none" } },
  { key: "settings", shape: { title: () => localized("Settings", "Instellingen"), spectacle: "low", action: "filled" } },
  { key: "notifications", shape: { title: () => localized("Notifications", "Meldingen"), spectacle: "low", action: "outline" } },
  { key: "mystats", shape: { title: () => localized("My records & stats", "Mijn records en cijfers"), spectacle: "medium", action: "filled" } },
  { key: "admin", shape: { title: () => localized("Administration", "Beheer"), spectacle: "minimal", action: "link" } },
];

const HOME: RouteShape = {
  title: () => localized("Home", "Start"),
  spectacle: "high",
  // Home's hero carries its own primary action, so the global one steps down (§4).
  action: "outline",
};
const NOT_FOUND: RouteShape = {
  title: () => localized("Page not found", "Pagina niet gevonden"),
  spectacle: "low",
  action: "none",
};

/**
 * One night is not the list of them (W19-W21 against W17): the night is the HIGH page of the
 * family, with the art, the display type and the boards, and it is called after what it is. The
 * list stays MEDIUM. `&operate=1` is Race Direction and is matched before either.
 */
const NIGHT: RouteShape = {
  title: () => localized("Tournament night", "Toernooiavond"),
  spectacle: "high",
  action: "outline",
};

function shapeOf(search: string): RouteShape {
  if (!isKnownRoute(search)) { return NOT_FOUND; }
  const query = new URLSearchParams(search);
  const night = query.get("tournaments");
  if (night !== null && query.get("operate") === null && /^tournament\./.test(night)) { return NIGHT; }
  return ROUTES.find((route) => query.get(route.key) !== null)?.shape ?? HOME;
}

export function routeDocumentTitle(search: string, pathname = "/"): string {
  if (pathname === "/device") { return localized("Authorize a device", "Apparaat goedkeuren"); }
  return shapeOf(search).title();
}

export function routeSpectacle(search: string): SpectacleLevel {
  return shapeOf(search).spectacle;
}

export function routeGlobalAction(search: string): GlobalActionLevel {
  return shapeOf(search).action;
}

/**
 * The operator/administrator context bar (DESIGN_SYSTEM §11): when a page is run *as* a role rather
 * than read, the shell says so instead of the page having to. It is presentation only - no operator
 * interaction changes before the recorded Director walkthrough (OD-09).
 */
export function routeContextBar(
  search: string,
): Readonly<{ mode: "race-direction" | "administration"; label: string }> | null {
  const query = new URLSearchParams(search);
  if (query.get("operate") !== null) {
    return {
      mode: "race-direction",
      label: localized("Race direction · Director mode", "Wedstrijdleiding · Directeurmodus"),
    };
  }
  if (query.get("admin") !== null) {
    return {
      mode: "administration",
      label: localized("Administration · administrator mode", "Beheer · beheerdersmodus"),
    };
  }
  return null;
}
