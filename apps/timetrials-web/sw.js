const CACHE_VERSION = "mk8dx-shell-v5";
// The installed shell: the document, its manifest, the stylesheets it paints with and the
// self-hosted fonts of the three first-view styles plus the rest of the used set
// (DESIGN_SYSTEM.md §3.1). Without the sheets and fonts, precaching "/" alone made nothing work
// offline - the page came back unstyled and in fallback faces.
const SHELL = [
  "/", "/manifest.webmanifest",
  "/styles/ds-appearance-boot.js",
  "/styles/ds-tokens.css", "/styles/ds-fonts.css", "/styles/ds-base.css",
  "/styles/ds-workflows.css", "/styles/ds-components.css", "/styles/ds-shell.css",
  "/styles/app-icon-192.png", "/styles/app-icon-512.png",
  "/styles/app-icon-maskable-192.png", "/styles/app-icon-maskable-512.png",
  "/dist/main.js",
  "/styles/ds-font-plex-sans-400-latin1.b5ad7bd39f.woff2",
  "/styles/ds-font-plex-sans-500-latin1.b5610af04d.woff2",
  "/styles/ds-font-plex-sans-600-latin1.fff0ab3a88.woff2",
  "/styles/ds-font-plex-sans-700-latin1.914f1400f3.woff2",
  "/styles/ds-font-plex-mono-500-latin1.41201b658a.woff2",
  "/styles/ds-font-plex-mono-600-latin1.b7acd05041.woff2",
  "/styles/ds-font-saira-condensed-700-latin.eb1cf59a1f.woff2",
  "/styles/ds-font-saira-condensed-800-latin.5afa98eefc.woff2",
];

self.addEventListener("install", (event) => {
  // Each entry is added on its own: a renamed content-hashed font must never be able to fail the
  // whole installation, which would leave the origin without a worker and without push at all.
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) =>
    Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined)))));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  // Never replace a failed offline invitation navigation with the cached
  // product home page while a one-use token is in the browser address.
  if (new URL(event.request.url).pathname.startsWith("/offline-invite")) return;
  // Network first; offline falls back to the cached copy. `ignoreSearch` is what makes the fallback
  // work at all: every release cache-busts the stylesheets and the bundle with a ?v= hash, which no
  // precached entry can carry.
  event.respondWith(fetch(event.request).catch(() => caches
    .match(event.request, { ignoreSearch: true })
    .then((response) => response || caches.match("/"))));
});

self.addEventListener("push", (event) => {
  let payload;
  try { payload = event.data?.json(); } catch { payload = null; }
  if (!payload || payload.schemaVersion !== "mk8dx.web-push.v1") return;
  event.waitUntil(Promise.all([
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/styles/app-icon-192.png",
      badge: "/styles/app-icon-192.png",
      tag: payload.tag,
      renotify: false,
      data: { notificationId: payload.notificationId, url: payload.url },
    }),
    typeof self.navigator.setAppBadge === "function"
      ? self.navigator.setAppBadge(payload.unreadCount).catch(() => undefined)
      : Promise.resolve(),
  ]));
});

async function markRead(notificationId) {
  const csrf = await fetch("/v1/session/csrf", { credentials: "same-origin", cache: "no-store" });
  if (!csrf.ok) return;
  const proof = await csrf.json();
  await fetch("/v1/notifications/read", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", [proof.headerName]: proof.value },
    body: JSON.stringify({ notificationIds: [notificationId] }),
  });
}

async function refreshCanonicalBadge() {
  if (typeof self.navigator.setAppBadge !== "function") return;
  const response = await fetch("/v1/notifications", {
    credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" },
  });
  if (!response.ok) return;
  const inbox = await response.json();
  if (Number.isInteger(inbox.unreadCount) && inbox.unreadCount > 0) {
    await self.navigator.setAppBadge(inbox.unreadCount);
  } else if (typeof self.navigator.clearAppBadge === "function") {
    await self.navigator.clearAppBadge();
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const notificationId = event.notification.data?.notificationId;
  const target = new URL(event.notification.data?.url || "/?notifications=1", self.location.origin).href;
  event.waitUntil((async () => {
    const acknowledge = (async () => {
      if (typeof notificationId === "string") await markRead(notificationId).catch(() => undefined);
      await refreshCanonicalBadge().catch(() => undefined);
    })();
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows[0];
    if (existing) {
      if ("navigate" in existing) await existing.navigate(target);
      await existing.focus();
      await acknowledge;
      return;
    }
    await self.clients.openWindow(target);
    await acknowledge;
  })());
});
