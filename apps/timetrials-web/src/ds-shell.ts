// AppShell: the one navigation frame every route renders inside (DESIGN_SYSTEM.md §11, §24).
//
// It replaces the legacy `.site-nav` header and its 31 per-route overrides. Nothing it offers is
// new capability: every destination, the Apps offer, the language switch, the unread badge, the
// signed-in identity, Settings, Notifications, Administration, Sign out and Switch account are the
// controls the old header had, regrouped into the specified shape and given the shell behaviour the
// old header never had (skip link, per-route title, focus into the page, route announcement).
//
// What changes per width is which of the same destinations are visible, and where:
//   >= 1100  seven destinations in the top bar
//   600-1099 four destinations + More (Records, Build, Community)
//   <  600   five bottom tabs (Home, Tracks, Ranking, Build, Tournaments); Records and Community
//            keep a path through the account menu, which is the phone route the old bar had lost.
// The width rules live in CSS with `display: none`, so a hidden destination is also out of the tab
// order - a visually hidden but focusable duplicate is a worse bug than a missing one.
//
// Route content is NOT inside a `.ds-root`: until a route migrates it keeps its legacy look
// (IMPLEMENTATION_PLAN §3 rule 2). The chrome carries `.ds-root` itself.

import {
  brandLockup, el, lineIcon, menu, nextId, stopwatchIcon, type MenuItem,
} from "./ds-components.js";

export type NavKey =
  | "home" | "tracks" | "ranking" | "records" | "build" | "community" | "tournaments";
export type ShellActive = NavKey | "apps" | null;
/** DESIGN_SYSTEM §4: the global action steps down where the content carries its own primary. */
export type GlobalActionLevel = "filled" | "outline" | "link" | "none";
export type SpectacleLevel = "high" | "medium" | "low" | "minimal";

export type ShellIdentity = Readonly<{
  displayName: string;
  href: string;
  avatarSrc?: string;
}>;

export type ShellText = Readonly<{
  skip: string;
  /** The context bar's own landmark name: what running the page *as a role* is called. */
  mode: string;
  primary: string;
  sections: string;
  more: string;
  account: string;
  notifications: string;
  signIn: string;
  signOut: string;
  switchAccount: string;
  settings: string;
  myStats: string;
  administration: string;
  profile: string;
  apps: string;
  appsLabel: string;
  postTime: string;
  brandLabel: string;
  back: string;
  close: string;
  language: string;
  destinations: Readonly<Record<NavKey, string>>;
}>;

export type AppShellOptions = Readonly<{
  text: ShellText;
  brandAssetBase: string;
  /** Rendered when the viewer is signed out, exactly where the old header put it. */
  languageToggle: HTMLElement;
  onSignOut: () => void;
  onSwitchAccount: () => void;
}>;

export type AppShellHandle = Readonly<{
  root: HTMLElement;
  main: HTMLElement;
  announcer: HTMLElement;
  setActive(key: ShellActive): void;
  setSignedIn(signedIn: boolean): void;
  setIdentity(identity: ShellIdentity | null): void;
  setUnread(count: number): void;
  setAdministrator(administrator: boolean): void;
  setSignInHref(href: string): void;
  setGlobalAction(level: GlobalActionLevel): void;
  /**
   * The docked "Post a time" (DESIGN_SYSTEM §11, T-DOCK). Without a watch it follows the route's
   * global-action level, as it has since Phase 5: docked only where the page has no filled action.
   * With a watch it becomes scroll-aware - the route carries its own A4, so the dock appears only
   * once that action has left the viewport, and disappears again when it comes back. The label and
   * the destination may be the route's own (the track page docks "Post your time · 150cc").
   */
  setDock(dock: Readonly<{
    watch: HTMLElement; href?: string; label?: string;
  }> | null): void;
  setSpectacle(level: SpectacleLevel): void;
  setContextBar(node: HTMLElement | null): void;
  setTask(task: Readonly<{ title: string; backHref?: string; onClose?: () => void }> | null): void;
  /** The whole per-route hand-off: document title, announcement and focus into the page. */
  enterRoute(options: Readonly<{ title: string; announce?: boolean; focus?: boolean }>): void;
  setBrandAppearance(appearance: "dark" | "light"): void;
  /** "bare" is the device-approval page: the brand and nothing to navigate with. */
  setChrome(mode: "full" | "bare"): void;
  dispose(): void;
}>;

const ICONS: Readonly<Record<NavKey | "apps" | "bell" | "settings" | "more" | "account" | "close" | "back", readonly string[]>> = {
  home: ["M3 11 12 3l9 8v9h-6v-6H9v6H3z"],
  tracks: ["M10 2h4M12 4v3M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16M12 13l3-2.5"],
  ranking: ["M5 20V10h4v10m2 0V4h4v16m2 0v-7h4v7"],
  records: ["M6 3h9l3 3v15H6zM9 8h6M9 12h6M9 16h4"],
  build: [
    "M3.2 14.6v-1.9l1.5 -3A2 2 0 0 1 6.5 8.6h6.4l3.5 4l3 0.7A1.8 1.8 0 0 1 20.8 14.6M6.8 12.3h6",
    "M4 14.6a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0 -4.8 0M15.6 14.6a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0 -4.8 0",
    "M1.6 9.4h3.4M3.3 9.4v1.6",
  ],
  community: ["M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M3 20v-1a5 5 0 0 1 5-5h0a5 5 0 0 1 5 5v1M16 6.2a3 3 0 0 1 0 5.6M18 20v-1a5 5 0 0 0-2.5-4.3"],
  tournaments: ["M7 3h10v5c0 4-2 6-5 6s-5-2-5-6zM7 5H3v3c0 2 2 3 5 3m9-6h4v3c0 2-2 3-5 3m-4 3v4m-4 3h8"],
  apps: ["M12 3v11m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"],
  bell: ["M6 9a6 6 0 0 1 12 0c0 4 1 5 2 6H4c1-1 2-2 2-6", "M10 19a2 2 0 0 0 4 0"],
  settings: [
    "M12 2l1.2 2.6 2.8.5 2-2 3 3-2 2 .5 2.8L22 12l-2.6 1.2-.5 2.8 2 2-3 3-2-2-2.8.5L12 22l-1.2-2.6-2.8-.5-2 2-3-3 2-2-.5-2.8L2 12l2.6-1.2.5-2.8-2-2 3-3 2 2 2.8-.5z",
    "M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0",
  ],
  more: ["M5 12h.01M12 12h.01M19 12h.01"],
  account: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8", "M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"],
  close: ["M6 6l12 12M18 6 6 18"],
  back: ["M15 5l-7 7 7 7"],
};

/** Every destination, with the phone tab set marked (DESIGN_SYSTEM §11). */
const DESTINATIONS: readonly Readonly<{ key: NavKey; href: string; tab: boolean; tablet: boolean }>[] = [
  { key: "home", href: "/", tab: true, tablet: true },
  { key: "tracks", href: "/?cups=1", tab: true, tablet: true },
  { key: "ranking", href: "/?ranking=1", tab: true, tablet: true },
  { key: "records", href: "/?records=1", tab: false, tablet: false },
  { key: "build", href: "/?build=1", tab: true, tablet: false },
  { key: "community", href: "/?community=1", tab: false, tablet: false },
  { key: "tournaments", href: "/?tournaments=1", tab: true, tablet: true },
];

/**
 * The canonical Post-a-Time task (Phase 7, POST_A_TIME_ARCHITECTURE §9). Without a track it opens
 * the task's own TrackSelector - never the generic Tracks page, which was the Phase 5 placeholder.
 */
export const POST_A_TIME_HREF = "/?post=1";

export function mountAppShell(host: HTMLElement, options: AppShellOptions): AppShellHandle {
  const documentRef = host.ownerDocument;
  const text = options.text;
  const mainId = "mk8dx-main";
  const root = el("div", "ds-app", {
    "data-spectacle": "low", "data-task": "false", "data-chrome": "full",
  });

  // ---- skip link, brand, destinations
  const skip = el("a", "ds-root ds-skip", { href: `#${mainId}` }, text.skip);
  // The identity has three forms and one set of rules (DESIGN_SYSTEM §2): the full lockup from
  // 1100 px, the compact lockup from 360, the mark alone below that. The width decides, so the
  // lockup is rebuilt when the width crosses a rule - never squeezed to fit.
  const brand = el("a", "ds-topbar__brand", { href: "/" });
  let brandAppearance: "dark" | "light" = "dark";
  const brandWidthQueries = (globalThis.matchMedia === undefined
    ? []
    : [
      { size: "full", markPx: 48, media: globalThis.matchMedia("(min-width: 1100px)") },
      { size: "compact", markPx: 48, media: globalThis.matchMedia("(min-width: 360px)") },
    ] as const);
  const renderBrand = (): void => {
    const form = brandWidthQueries.find((candidate) => candidate.media.matches);
    brand.replaceChildren(brandLockup({
      appearance: brandAppearance,
      assetBase: options.brandAssetBase,
      label: text.brandLabel,
      size: form?.size ?? "mark",
      markPx: form?.markPx ?? 24,
      compactIconSrc: "/styles/app-icon-192.png",
      platform: "WEB",
    }));
  };
  for (const candidate of brandWidthQueries) {
    candidate.media.addEventListener?.("change", renderBrand);
  }
  const setBrandAppearance = (appearance: "dark" | "light"): void => {
    brandAppearance = appearance;
    renderBrand();
  };
  renderBrand();

  const links = new Map<ShellActive, HTMLElement[]>();
  const remember = (key: ShellActive, node: HTMLElement): HTMLElement => {
    links.set(key, [...(links.get(key) ?? []), node]);
    return node;
  };
  const primaryNav = el("nav", "ds-primary-nav", { "aria-label": text.primary });
  for (const destination of DESTINATIONS) {
    primaryNav.append(remember(destination.key, el("a", "ds-nav-link", {
      href: destination.href, "data-nav-key": destination.key,
      "data-tablet": destination.tablet ? "true" : "false",
    }, text.destinations[destination.key])));
  }
  // The tablet width shows four destinations plus More; the three it drops keep a path here.
  const moreMenu = menu({
    label: text.more,
    align: "end",
    triggerClassName: "ds-nav-link ds-nav-link--more",
    triggerContent: [lineIcon(ICONS.more), text.more],
    items: DESTINATIONS.filter((destination) => !destination.tablet).map((destination) => ({
      label: text.destinations[destination.key], href: destination.href,
    })),
  });
  moreMenu.root.className = "ds-menu ds-primary-nav__more";
  primaryNav.append(moreMenu.root);

  // ---- right cluster
  const globalAction = el("a", "ds-button ds-slant ds-topbar__action", {
    href: POST_A_TIME_HREF, "data-variant": "global", "data-size": "sm",
  }, stopwatchIcon(), el("span", "ds-button__label", {}, text.postTime));
  // The accessible name is the visible label, not a longer description of it: a voice-control user
  // says what they can read (WCAG 2.5.3). The longer sentence stays as the tooltip.
  const appsLink = remember("apps", el("a", "ds-icon-button ds-topbar__apps", {
    href: "/?apps=1", "data-nav-key": "apps",
    "aria-label": text.appsLabel, title: text.apps,
  }, lineIcon(ICONS.apps), el("span", "ds-topbar__apps-label", {}, text.appsLabel)));
  const unreadBadge = el("span", "ds-badge", { "aria-hidden": "true" });
  const notificationsLink = el("a", "ds-icon-button ds-topbar__bell", {
    href: "/?notifications=1", "aria-label": text.notifications,
  }, lineIcon(ICONS.bell), unreadBadge);
  notificationsLink.hidden = true;
  const settingsLink = el("a", "ds-icon-button ds-topbar__settings", {
    href: "/?settings=1", "aria-label": text.settings,
  }, lineIcon(ICONS.settings));
  settingsLink.hidden = true;
  const signInLink = el("a", "ds-button ds-topbar__signin", {
    href: "/?signin=1", "data-variant": "secondary", "data-size": "sm",
  }, el("span", "ds-button__label", {}, text.signIn));
  signInLink.hidden = true;

  const accountAvatar = el("img", "ds-topbar__avatar", { alt: "" });
  const accountName = el("span", "ds-topbar__account-name", {});
  let administrator = false;
  let identity: ShellIdentity | null = null;
  const accountItems = (): readonly MenuItem[] => [
    ...(identity === null ? [] : [{ label: text.profile, href: identity.href }]),
    { label: text.myStats, href: "/?mystats=1" },
    { label: text.destinations.records, href: "/?records=1" },
    { label: text.destinations.community, href: "/?community=1" },
    { label: text.notifications, href: "/?notifications=1" },
    { label: text.settings, href: "/?settings=1" },
    ...(administrator ? [{ label: text.administration, href: "/?admin=1" }] : []),
    { label: text.switchAccount, onSelect: options.onSwitchAccount },
    { label: text.signOut, tone: "danger" as const, onSelect: options.onSignOut },
  ];
  // The trigger shows the Player's name, so the accessible name has to contain it.
  const accountLabel = (): string =>
    identity === null ? text.account : `${identity.displayName} · ${text.account}`;
  let accountMenu = menu({
    label: accountLabel(), align: "end", triggerClassName: "ds-topbar__account",
    triggerContent: [lineIcon(ICONS.account), accountName], items: accountItems(),
  });
  const accountSlot = el("div", "ds-topbar__account-slot", {}, accountMenu.root);
  accountSlot.hidden = true;
  const rebuildAccountMenu = (): void => {
    accountMenu = menu({
      label: accountLabel(), align: "end", triggerClassName: "ds-topbar__account",
      triggerContent: [
        ...(identity?.avatarSrc === undefined ? [lineIcon(ICONS.account)] : [accountAvatar]),
        accountName,
      ],
      items: accountItems(),
    });
    accountSlot.replaceChildren(accountMenu.root);
  };

  const actions = el("div", "ds-topbar__actions", {},
    globalAction, appsLink, options.languageToggle, signInLink, accountSlot, notificationsLink, settingsLink);

  // ---- task mode: the tabs give way to Back, the task title and Close (§11)
  const taskTitle = el("span", "ds-taskbar__title", {});
  const taskBack = el("a", "ds-icon-button", { href: "/", "aria-label": text.back }, lineIcon(ICONS.back));
  const taskClose = el("button", "ds-icon-button", { type: "button", "aria-label": text.close }, lineIcon(ICONS.close));
  const taskBar = el("div", "ds-taskbar", {}, taskBack, taskTitle, taskClose);
  taskBar.hidden = true;
  let taskCloseHandler: (() => void) | null = null;
  taskClose.addEventListener("click", () => { taskCloseHandler?.(); });

  const header = el("header", "ds-root ds-topbar", {},
    el("div", "ds-topbar__inner", {}, brand, primaryNav, actions), taskBar);

  // ---- operator / administrator context bar (§11)
  // A landmark of its own: it is page-level chrome that sits outside the header and the main
  // region, and axe reports content outside every landmark as soon as a route fills it (Phase 11).
  const contextBar = el("div", "ds-root ds-context-bar", {
    role: "region", "aria-label": text.mode,
  });
  contextBar.hidden = true;

  // ---- the one <main>
  const main = el("main", "ds-app__main", { id: mainId, tabindex: "-1" });

  // ---- phone tabs and the docked action
  const bottomTabs = el("nav", "ds-root ds-bottom-tabs", { "aria-label": text.sections });
  for (const destination of DESTINATIONS.filter((candidate) => candidate.tab)) {
    bottomTabs.append(remember(destination.key, el("a", "ds-tab-link", {
      href: destination.href, "data-nav-key": destination.key,
    }, lineIcon(ICONS[destination.key]), el("span", "ds-tab-link__label", {}, text.destinations[destination.key]))));
  }
  const dockedLabel = el("span", "ds-button__label", {}, text.postTime);
  const dockedLink = el("a", "ds-button ds-slant", {
    href: POST_A_TIME_HREF, "data-variant": "primary", "data-size": "md",
  }, stopwatchIcon(), dockedLabel);
  // The dock is chrome that sits outside <main>, so it needs a landmark of its own: without one its
  // link is content belonging to no region. Found by the Phase 12 browser gate, on the first routes
  // whose own A4 does not keep the dock hidden at the top of the page.
  const dockedAction = el("div", "ds-root ds-docked", {
    role: "complementary", "aria-label": text.postTime,
  }, dockedLink);
  dockedAction.hidden = true;

  const announcer = el("p", "ds-visually-hidden", {
    id: nextId("ds-route"), role: "status", "aria-live": "polite", "aria-atomic": "true",
  });

  root.append(skip, header, contextBar, main, bottomTabs, dockedAction, announcer);
  host.append(root);

  // ---- behaviour
  let signedIn = false;
  const setActive = (key: ShellActive): void => {
    for (const [candidate, nodes] of links) {
      for (const node of nodes) {
        if (candidate === key) { node.setAttribute("aria-current", "page"); }
        else { node.removeAttribute("aria-current"); }
      }
    }
  };
  // The scroll-aware dock (T-DOCK). `watched` is the route's own A4; while it is on screen the dock
  // stays away, because one viewport spends A4 once.
  let watcher: IntersectionObserver | null = null;
  let watchedVisible = true;
  let dockLevel: GlobalActionLevel = "filled";
  const applyDock = (): void => {
    dockedAction.hidden = !signedIn ||
      (watcher === null ? dockLevel !== "filled" : dockLevel === "none" || watchedVisible);
  };
  const stopWatching = (): void => {
    watcher?.disconnect();
    watcher = null;
    watchedVisible = true;
  };
  const setGlobalAction = (level: GlobalActionLevel): void => {
    // A4 is spent once per viewport: the header action is never "filled" while the phone dock is,
    // and a task or an operator step drops it to a text link.
    globalAction.hidden = level === "none";
    globalAction.setAttribute("data-variant", level === "link" ? "quiet" : "global");
    globalAction.classList.toggle("ds-slant", level !== "link");
    dockLevel = level;
    applyDock();
    root.setAttribute("data-global-action", level);
  };
  let level: GlobalActionLevel = "filled";
  const applySession = (): void => {
    notificationsLink.hidden = !signedIn;
    settingsLink.hidden = !signedIn;
    accountSlot.hidden = !signedIn;
    signInLink.hidden = signedIn;
    options.languageToggle.hidden = signedIn;
    globalAction.hidden = !signedIn || level === "none";
    setGlobalAction(signedIn ? level : "none");
  };

  return {
    root, main, announcer,
    setActive,
    setSignedIn(next): void {
      signedIn = next;
      if (!next) { identity = null; accountName.textContent = ""; }
      applySession();
    },
    setIdentity(next): void {
      identity = next;
      accountName.textContent = next?.displayName ?? "";
      if (next?.avatarSrc !== undefined) { accountAvatar.setAttribute("src", next.avatarSrc); }
      rebuildAccountMenu();
      applySession();
    },
    setUnread(count): void {
      unreadBadge.textContent = count > 0 ? String(count) : "";
      notificationsLink.toggleAttribute("data-unread", count > 0);
      notificationsLink.setAttribute(
        "aria-label",
        count > 0 ? `${text.notifications} (${String(count)})` : text.notifications,
      );
    },
    setAdministrator(next): void {
      if (administrator === next) { return; }
      administrator = next;
      rebuildAccountMenu();
    },
    setSignInHref(href): void { signInLink.setAttribute("href", href); },
    setGlobalAction(next): void { level = next; applySession(); },
    setDock(dock): void {
      stopWatching();
      dockedLink.setAttribute("href", dock?.href ?? POST_A_TIME_HREF);
      dockedLabel.textContent = dock?.label ?? text.postTime;
      if (dock === null || dock === undefined) { applyDock(); return; }
      const view = documentRef.defaultView as unknown as
        { IntersectionObserver?: typeof IntersectionObserver } | null;
      if (view?.IntersectionObserver === undefined) {
        // No observer (a DOM double, or a very old browser): the dock keeps the Phase 5 rule rather
        // than guessing, so it is never wrong, only less clever.
        applyDock();
        return;
      }
      watchedVisible = true;
      watcher = new view.IntersectionObserver((entries) => {
        for (const entry of entries) { watchedVisible = entry.isIntersecting; }
        applyDock();
      }, { threshold: 0 });
      watcher.observe(dock.watch);
      applyDock();
    },
    setSpectacle(next): void { root.setAttribute("data-spectacle", next); },
    setContextBar(node): void {
      contextBar.replaceChildren(...(node === null ? [] : [node]));
      contextBar.hidden = node === null;
    },
    setTask(task): void {
      root.setAttribute("data-task", task === null ? "false" : "true");
      taskBar.hidden = task === null;
      if (task === null) { taskCloseHandler = null; return; }
      taskTitle.textContent = task.title;
      taskBack.setAttribute("href", task.backHref ?? "/");
      taskCloseHandler = task.onClose ?? null;
      taskClose.hidden = task.onClose === undefined;
    },
    enterRoute({ title, announce = true, focus = true }): void {
      documentRef.title = `${title} · MK8DX Time Trials`;
      if (announce) { announcer.textContent = title; }
      // Focus follows the reader into the page: the route's own H1 when it has a visible one, the
      // <main> itself otherwise (Home and the task views render no heading of their own).
      const heading = [...main.querySelectorAll("h1")]
        .find((candidate) => !candidate.hidden && candidate.textContent !== "");
      const target: HTMLElement = heading ?? main;
      if (target === main) { main.setAttribute("aria-label", title); }
      else { main.removeAttribute("aria-label"); }
      // The first page load is not a navigation: nothing moves the reader's focus there.
      if (!focus) { return; }
      if (target !== main && target.getAttribute("tabindex") === null) {
        target.setAttribute("tabindex", "-1");
      }
      // A heading is not normally focusable, so it is made focusable for this one move. Whether a
      // ring is painted is left to the browser's `:focus-visible` heuristic: after a keyboard
      // activation it shows, after a pointer one it does not, which is the behaviour a reader of
      // either kind expects.
      target.focus?.();
    },
    setBrandAppearance,
    setChrome(mode): void { root.setAttribute("data-chrome", mode); },
    dispose(): void {
      stopWatching();
      if (root.parentNode === host) { host.removeChild(root); }
    },
  };
}
