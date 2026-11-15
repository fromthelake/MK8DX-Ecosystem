"use strict";

const params = new URLSearchParams(location.search);
const requestedFeed = params.get("feed");
const fixedGridView = ["grid", "fixed", "tables"].includes((params.get("view") || "").toLowerCase());
// ?debug=1 restores the raw engine telemetry (found/completed/confirmed/sync)
// for operators; the default broadcast view never shows that jargon.
const debugView = params.get("debug") === "1";
if (params.get("bg") === "transparent") {
  document.body.classList.add("transparent");
}
if (fixedGridView) {
  document.body.classList.add("fixed-grid-view");
}
// ?density=tv scales the grid card type up for 1-/2-up layouts where there's
// room — readable at TV distance on a stream.
if ((params.get("density") || "").toLowerCase() === "tv") {
  document.body.classList.add("density-tv");
}

// Viewer settings: the language of the dashboard's own texts, the scoreboard
// mode and the language of the track/cup names. A URL parameter (?lang=de,
// ?scoreboard=overall, ?trackLang=ja) sets them for an unattended OBS source;
// otherwise the viewer's last choice is kept in this browser, and the texts
// follow the browser's language (English when it is none of the 15). Display
// only: no setting changes scoring or which language the recognition reads the
// console in, and the text language is independent of the track-name language.
const SETTINGS_KEY = "mk8dx.broadcast.viewSettings.v1";
// The 15 game locales of the Clean Assets track/cup names (track-names-v1.json).
const TRACK_LOCALES = [
  "en-GB", "en-US", "nl-NL", "fr-FR", "fr-CA", "de-DE", "es-ES", "es-419",
  "it-IT", "pt-PT", "ru-RU", "ja-JP", "ko-KR", "zh-CN", "zh-TW",
];
// Short language codes accepted in ?trackLang= besides the full locales.
const TRACK_LANG_SHORT = {
  en: "en-GB", nl: "nl-NL", fr: "fr-FR", de: "de-DE", es: "es-ES", it: "it-IT",
  pt: "pt-PT", ru: "ru-RU", ja: "ja-JP", ko: "ko-KR", zh: "zh-CN",
};

// The dashboard texts' languages: the 15 game languages (English = the source).
const UI_LANGUAGES = [
  "en", "en-US", "nl", "fr", "fr-CA", "de", "es", "es-419",
  "it", "pt", "ru", "ja", "ko", "zh-CN", "zh-TW",
];

// One language tag (de-DE, es-MX, zh-Hant-TW, ...) as a dashboard language, else
// "": exact, then by region (es-MX -> es-419, zh-Hant/TW/HK/MO -> zh-TW, other
// zh -> zh-CN), then by base language, as the launchers choose theirs.
function matchUiLanguage(value) {
  const tag = String(value || "").trim().replace(/_/g, "-").toLowerCase();
  const parts = tag.split("-");
  if (!parts[0]) return "";
  const exact = UI_LANGUAGES.find((code) => code.toLowerCase() === tag);
  if (exact) return exact;
  if (parts[0] === "zh") {
    return parts.slice(1).some((part) => ["hant", "tw", "hk", "mo"].includes(part)) ? "zh-TW" : "zh-CN";
  }
  if (parts[0] === "es" && parts.length > 1 && parts[1] !== "es") return "es-419";
  return UI_LANGUAGES.find((code) => code === parts[0]) || "";
}

function browserLanguages() {
  try {
    const nav = typeof navigator === "undefined" ? null : navigator;
    if (!nav) return [];
    return (nav.languages && nav.languages.length ? [...nav.languages] : [nav.language]).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function normalizeScoreboardMode(value) {
  return String(value || "").trim().toLowerCase() === "overall" ? "overall" : "auto";
}

// "" = the default English + Dutch presentation.
function normalizeTrackLang(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  const exact = TRACK_LOCALES.find((locale) => locale.toLowerCase() === text);
  return exact || TRACK_LANG_SHORT[text] || "";
}

function readStoredSettings() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function storeSettings(value) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
  } catch (_) { /* private window or blocked storage: the choice lasts this page only */ }
}

const viewSettings = (() => {
  const stored = readStoredSettings();
  return {
    // "" = follow the browser's language.
    lang: matchUiLanguage(params.has("lang") ? params.get("lang") : stored.lang),
    scoreboard: normalizeScoreboardMode(params.has("scoreboard") ? params.get("scoreboard") : stored.scoreboard),
    trackLang: normalizeTrackLang(params.has("trackLang") ? params.get("trackLang") : stored.trackLang),
  };
})();
function overallOnly() {
  return viewSettings.scoreboard === "overall";
}

// The language the dashboard texts are shown in.
function uiLanguage() {
  if (viewSettings.lang) return viewSettings.lang;
  for (const tag of browserLanguages()) {
    const code = matchUiLanguage(tag);
    if (code) return code;
  }
  return "en";
}

// The dashboard's own texts, English as the key (the shared catalog pipeline:
// tooling/i18n/extract_broadcast_messages.py + build_web_catalogs.mjs), loaded
// from the server (/api/messages/<language>) for the chosen language. A missing
// catalog or text stays English; {0}, {1} are filled after the lookup. A key may
// carry a context before a bar ("column header|Gap": the short form for a narrow
// column, its own translation); without a translation the English after the bar
// is shown.
let uiMessages = {};
let uiMessagesFor = "en";
let uiMessagesLoading = "";

function t(english, ...values) {
  const own = Object.prototype.hasOwnProperty.call(uiMessages, english) ? uiMessages[english] : null;
  const template = typeof own === "string" && own.trim() ? own : english.slice(english.indexOf("|") + 1);
  return template.replace(/\{(\d+)\}/g, (match, index) => (index < values.length ? String(values[index]) : match));
}

function ensureUiMessages() {
  const code = uiLanguage();
  if (code === uiMessagesFor || code === uiMessagesLoading) return;
  if (/^en(-|$)/.test(code)) {
    uiMessages = {};
    uiMessagesFor = code;
    uiMessagesLoading = "";
    applyStaticTexts();
    return;
  }
  uiMessagesLoading = code;
  fetch(`/api/messages/${encodeURIComponent(code)}`, { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
    .then((data) => {
      if (uiMessagesLoading !== code) return;  // another language was chosen meanwhile
      uiMessagesLoading = "";
      uiMessages = data && data.messages && typeof data.messages === "object" ? data.messages : {};
      uiMessagesFor = code;
      applyStaticTexts();
      render();
    });
}

// The page's fixed texts (index.html, the settings panel) carry their English in
// data-i18n (text) / data-i18n-title (title + aria-label).
function applyStaticTexts() {
  const root = typeof document !== "undefined" ? document.documentElement : null;
  if (root) root.setAttribute("lang", uiMessagesFor === "en" ? "en" : uiMessagesFor);
  if (typeof document !== "undefined") document.title = t("MK8DX Live Scoreboard");
  for (const node of document.querySelectorAll("[data-i18n]")) {
    node.textContent = t(node.getAttribute("data-i18n"));
  }
  for (const node of document.querySelectorAll("[data-i18n-title]")) {
    const text = t(node.getAttribute("data-i18n-title"));
    node.setAttribute("title", text);
    if (node.hasAttribute("aria-label")) node.setAttribute("aria-label", text);
  }
}

// Inline flag SVGs (Windows/Chrome won't render flag emoji as flags). EU next to
// the UK/English track name, NL next to the Dutch name. Sized in `em` so they
// scale with whatever text they sit beside.
const FLAG_NL =
  `<svg class="flag" viewBox="0 0 9 6" aria-hidden="true"><rect width="9" height="2" fill="#AE1C28"/><rect y="2" width="9" height="2" fill="#fff"/><rect y="4" width="9" height="2" fill="#21468B"/></svg>`;
const FLAG_EU = (() => {
  // 12 stars in a ring centred on the flag (viewBox 36×24 → centre 18,12).
  let stars = "";
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6 - Math.PI / 2;
    const cx = 18 + 7 * Math.cos(a);
    const cy = 12 + 7 * Math.sin(a);
    let pts = "";
    for (let k = 0; k < 10; k++) {
      const r = k % 2 === 0 ? 1.7 : 0.65;
      const ang = (k * Math.PI) / 5 - Math.PI / 2;
      pts += `${(cx + r * Math.cos(ang)).toFixed(2)},${(cy + r * Math.sin(ang)).toFixed(2)} `;
    }
    stars += `<polygon points="${pts.trim()}" fill="#FFCC00"/>`;
  }
  return `<svg class="flag" viewBox="0 0 36 24" aria-hidden="true"><rect width="36" height="24" fill="#003399"/>${stars}</svg>`;
})();
// Checkered flag shown on a group's card once it has finished all its races.
const FLAG_FINISH = (() => {
  const cols = 4, rows = 3, cell = 3.4, x0 = 5.6, y0 = 3.8;
  let cells = "";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const fill = (r + c) % 2 === 0 ? "#11152b" : "#ffffff";
      cells += `<rect x="${(x0 + c * cell).toFixed(2)}" y="${(y0 + r * cell).toFixed(2)}" width="${cell}" height="${cell}" fill="${fill}"/>`;
    }
  }
  return `<svg class="finflag" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.6" y="2.4" width="1.5" height="19.2" rx="0.6" fill="#cbd3f5"/>${cells}</svg>`;
})();

// "No wifi" mark for a disconnected player: wifi arcs + dot, crossed by a slash.
const ICON_NO_WIFI =
  `<svg class="gridrow__dc" viewBox="0 0 24 24" aria-hidden="true">` +
  `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">` +
  `<path d="M5 12.6a10 10 0 0 1 14 0"/><path d="M8.5 15.8a5.4 5.4 0 0 1 7 0"/></g>` +
  `<circle cx="12" cy="19.2" r="1.5" fill="currentColor"/>` +
  `<line x1="3.5" y1="3.5" x2="20.5" y2="20.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` +
  `</svg>`;

const MIN_ROWS = 12;          // reserve a full 12-driver board even when empty
const ROTATE_MS = 12000;      // slideboard rotation between feeds
const REVIEW_ROTATE_MS = 14000;// race-result <-> totals rotation while reviewing a finished race
const LIVENESS_WINDOW = 90;   // seconds since last update to still count as "live"

const feeds = new Map();      // feed id -> payload
const feedSync = new Map();   // feed id -> { synced, hasCountdown, deadline, seconds }
const feedSeen = new Map();   // feed id -> performance.now()/1000 of last update
const lastGridKind = new Map();// feed id -> last shown view kind (to fade only on a real swap)
// Each feed's review rotation runs on its OWN clock, started when it entered the
// review window — so one group finishing a race never resets another's ring.
const feedReviewStart = new Map(); // feed id -> perf-seconds it entered review
const lastReviewSub = new Map();   // feed id -> last computed sub-view (to detect flips)

let activeFeed = requestedFeed || null;
let userPinnedFeed = Boolean(requestedFeed);
let lastRingFeed = null;
let serverSession = null;
let lastEventId = 0;

const el = {
  board: document.getElementById("board"),
  rotring: document.getElementById("rotring"),
  rotbar: document.getElementById("rotbar"),
  title: document.getElementById("title"),
  eyebrow: document.getElementById("eyebrow"),
  raceSeq: document.getElementById("race-seq"),
  raceTotal: document.getElementById("race-total"),
  trackbar: document.getElementById("trackbar"),
  trackArt: document.getElementById("track-art"),
  cupArt: document.getElementById("cup-art"),
  trackName: document.getElementById("track-name"),
  trackSub: document.getElementById("track-sub"),
  trackStatus: document.getElementById("track-status"),
  totalsbar: document.getElementById("totalsbar"),
  totalsSub: document.getElementById("totals-sub"),
  racehero: document.getElementById("racehero"),
  heroTrackArt: document.getElementById("hero-track-art"),
  heroCupArt: document.getElementById("hero-cup-art"),
  heroTrackName: document.getElementById("hero-track-name"),
  heroTrackSub: document.getElementById("hero-track-sub"),
  heroStatus: document.getElementById("hero-status"),
  heroCountdown: document.getElementById("hero-countdown"),
  rows: document.getElementById("rows"),
  boardCaption: document.getElementById("board-caption"),
  colRace: document.getElementById("col-race"),
  empty: document.getElementById("emptystate"),
  footStatus: document.getElementById("foot-status"),
  livepill: document.getElementById("livepill"),
  liveLabel: document.getElementById("livelabel"),
  countdown: document.getElementById("countdown"),
  badge: document.getElementById("badge"),
  stage: document.getElementById("stage"),
};

const now = () => performance.now() / 1000;

// Per-feed review rotation, driven purely by each feed's own start time so the
// groups never affect one another. Each half lasts REVIEW_ROTATE_MS.
function reviewSubFor(feed) {
  const start = feedReviewStart.get(feed);
  if (start === undefined) return "race";
  const half = REVIEW_ROTATE_MS / 1000;
  return (now() - start) % (2 * half) < half ? "race" : "total";
}
// Fraction (0..1) through the current half — fills this feed's transition ring.
function reviewFracFor(feed) {
  const start = feedReviewStart.get(feed);
  if (start === undefined) return 0;
  const half = REVIEW_ROTATE_MS / 1000;
  return ((now() - start) % half) / half;
}

function pickActiveFeed() {
  if (activeFeed && feeds.has(activeFeed)) return activeFeed;
  if (userPinnedFeed) return activeFeed;
  const first = feeds.keys().next();
  return first.done ? null : first.value;
}

function ingest(payload) {
  if (!payload || !payload.feed) return;
  const eventId = Number(payload.event_id || 0);
  if (eventId > lastEventId) lastEventId = eventId;
  if (payload.server_session && payload.server_session !== serverSession) {
    serverSession = payload.server_session;
  }
  // Lead the review rotation with the fresh race result whenever a feed first
  // enters the review window (a race just finished).
  const prev = feeds.get(payload.feed);
  if (payload.phase === "review" && (!prev || prev.phase !== "review")) {
    feedReviewStart.set(payload.feed, now());  // start this feed's own rotation clock
  }
  feeds.set(payload.feed, payload);
  feedSeen.set(payload.feed, now());
  const cd = payload.countdown || {};
  const sync = { synced: !!payload.synced, hasCountdown: false, deadline: 0, seconds: cd.seconds || null };
  if (cd.started_at && cd.seconds && payload.server_time && !payload.synced) {
    const remainingAtSend = cd.started_at + cd.seconds - payload.server_time;
    sync.hasCountdown = true;
    sync.deadline = now() + remainingAtSend;
  }
  feedSync.set(payload.feed, sync);
}

// Which list to show for a feed: during "review" we rotate between the race
// result and the totals; every other phase shows the server's default view.
function pickView(payload) {
  if (payload.phase === "review" && overallOnly()) {
    // Overall only: always the cumulative standings. They hold confirmed races
    // only, so a just-finished race shows up here once it is confirmed; the
    // caption says which race they include until then.
    return { kind: "total", rows: payload.total_rows || [] };
  }
  if (payload.phase === "review") {
    // Only rotate to the totals once they include the just-finished race
    // (confirmed); until then keep showing the race result rather than a stale
    // standings that predates this race.
    const canShowTotal = !!payload.totals_ready;
    const kind = reviewSubFor(payload.feed) === "total" && canShowTotal ? "total" : "race";
    const rows = kind === "race" ? (payload.race_rows || []) : (payload.total_rows || []);
    return { kind, rows };
  }
  // Racing shows the running totals beneath the hero; everything else uses the
  // server's default view.
  if (payload.phase === "racing") {
    return { kind: "total", rows: payload.total_rows || [] };
  }
  return { kind: payload.rows_kind || "total", rows: payload.rows || [] };
}

// Plain-English (eyebrow, caption) for a phase + shown list. Mirrors the
// server's ``_describe_view`` so the header reads the same either way.
function describeView(payload, kind) {
  const completed = payload.races_completed || 0;
  const n = payload.display_race;
  // Canonical vocabulary (see docs/broadcast_dashboard_redesign.md), kept in
  // lockstep with the server's ``_describe_view``: exactly two nouns —
  // "Race result" (one race) and "Overall standings" (cumulative).
  if (payload.phase === "standby") return { eyebrow: t("Standby"), caption: t("Waiting for the first race") };
  if (overallOnly() && kind === "total" && (payload.phase !== "racing" || completed)) {
    // Overall only spells out which confirmed race the standings include.
    const eyebrow = payload.phase === "racing" ? t("Race {0} in progress", n) : t("Overall standings");
    return { eyebrow, caption: `${t("Overall standings")} · ${overallProgressText(payload)}` };
  }
  if (payload.phase === "racing") {
    return {
      eyebrow: t("Race {0} in progress", n),
      caption: completed ? `${t("Overall standings")} · ${afterRacesText(completed)}` : t("Race {0} · in progress", n),
    };
  }
  if (payload.phase === "review" && kind === "race") {
    return { eyebrow: t("Race result"), caption: t("Race {0} result", n) };
  }
  return { eyebrow: t("Overall standings"), caption: `${t("Overall standings")} · ${afterRacesText(completed)}` };
}

// "after 1 race" / "after 7 races".
function afterRacesText(completed) {
  return completed === 1 ? t("after 1 race") : t("after {0} races", completed);
}

// Sub-line under the "Overall standings" banner/card — the only place race
// count is spelled out so the banner title stays the canonical noun.
function totalsSubText(payload) {
  if (overallOnly()) return overallProgressText(payload);
  const completed = payload.races_completed || 0;
  return completed ? afterRacesText(completed) : t("overall points");
}

// The race a finished-but-unconfirmed result belongs to: its points are not in
// the overall standings yet. null when the standings are up to date.
function pendingConfirmationRace(payload) {
  if (payload.phase !== "review" || payload.totals_ready) return null;
  return payload.display_race != null ? payload.display_race : (payload.races_completed || 0) + 1;
}

// Overall only, before the first race is confirmed: an honest empty table.
function overallWaitingText(payload) {
  const pending = pendingConfirmationRace(payload);
  return t("Overall standings appear once race {0} is confirmed", pending != null ? pending : 1);
}

// "after race 7 of 12" (+ "· race 8 awaiting confirmation") — which confirmed
// race the overall standings include. Never claims an unconfirmed race.
function overallProgressText(payload) {
  const completed = payload.races_completed || 0;
  const total = Number(payload.races_total || 0);
  const pending = pendingConfirmationRace(payload);
  const base = completed
    ? (total ? t("after race {0} of {1}", completed, total) : t("after race {0}", completed))
    : t("no race confirmed yet");
  return pending != null ? `${base} · ${t("race {0} awaiting confirmation", pending)}` : base;
}

// "of Y" suffix for the Race counter when the operator has set a group size.
function raceCounterSuffix(payload) {
  const total = Number(payload.races_total || 0);
  if (!total || payload.display_race == null) return "";
  return ` ${t("of {0}", total)}`;
}

// Plain "X" or "X of Y" race label for the compact grid cards.
function raceCounterLabel(payload) {
  if (payload.display_race == null) return "–";
  return `${payload.display_race}${raceCounterSuffix(payload)}`;
}

// Track/cup names in the viewer's chosen language, looked up by the canonical
// track/cup IDs in the payload (never by translating the recognized text).
// Loaded from the server once, only when a language is chosen.
let displayNames = null;            // { tracks: {id: {locale: name}}, cups: {...} }
let displayNamesLoading = false;
let displayNamesRetryAt = 0;

function ensureDisplayNames() {
  if (!viewSettings.trackLang || displayNames || displayNamesLoading) return;
  if (performance.now() < displayNamesRetryAt) return;
  displayNamesLoading = true;
  fetch("/api/display-names", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data && data.tracks) {
        displayNames = data;
        render();
      } else {
        displayNamesRetryAt = performance.now() + 10000;
      }
    })
    .catch(() => { displayNamesRetryAt = performance.now() + 10000; })
    .finally(() => { displayNamesLoading = false; });
}

// null = the default English + Dutch presentation. Otherwise the name in the
// chosen locale, falling back to English when a name (or the catalog) is missing;
// `*Lang` is the locale the shown text is actually in (for the lang attribute).
function localizedTrack(track) {
  const locale = viewSettings.trackLang;
  if (!locale) return null;
  const pick = (table, id, fallback) => {
    const names = displayNames && id ? (displayNames[table] || {})[id] : null;
    if (names && names[locale]) return { text: names[locale], lang: locale };
    if (names && names["en-GB"]) return { text: names["en-GB"], lang: "en-GB" };
    return { text: fallback || "", lang: "en-GB" };
  };
  const name = pick("tracks", track.id, track.name_uk);
  const cup = pick("cups", track.cup_id, track.cup_uk);
  return { name: name.text, nameLang: name.lang, cup: cup.text, cupLang: cup.lang };
}

// The grid shows the cup name under its icon without the redundant "Cup" word —
// only in English, where that word is a separate trailing word.
function shortCupName(name, lang) {
  const text = String(name || "");
  return /^en(-|$)/.test(lang || "en") ? text.replace(/\s*cup\s*$/i, "").trim() : text.trim();
}

// A narrow column header: the short form ("column header|This race"), the full text as its title. The
// keys are spelled out so the extractor finds them.
const COLUMN_HEADERS = {
  "This race": () => [t("column header|This race"), t("This race")],
  "Last race": () => [t("column header|Last race"), t("Last race")],
};
function setColumnHeader(node, english) {
  const [label, full] = COLUMN_HEADERS[english]();
  node.textContent = label;
  node.title = full;
}

function setLang(node, lang) {
  if (lang) node.setAttribute("lang", lang);
  else node.removeAttribute("lang");
}

function deltaMarkup(delta) {
  if (delta > 0) return `<span class="row__delta up">▲${delta}</span>`;
  if (delta < 0) return `<span class="row__delta down">▼${Math.abs(delta)}</span>`;
  return `<span class="row__delta">–</span>`;
}

function racePill(points) {
  if (points === null || points === undefined || points === "") return "";
  const value = Number(points);
  if (!(value > 0)) return `<span class="racepill zero">${points}</span>`;
  // Colour the pill by value across the MK8DX 1..15 race-point range: the most
  // points reads green, the fewest red (hue 0=red → 135=green).
  const hue = Math.round(Math.max(0, Math.min(1, (value - 1) / 14)) * 135);
  return `<span class="racepill" style="--h:${hue}">+${value}</span>`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
}

// For a double-quoted attribute value (escapeHtml leaves quotes as they are).
function escapeAttr(text) {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

function rowKey(item) {
  if (item.filler) return `__f${item.position}`;
  // Key named rows by driver (stable for FLIP re-ordering); fall back to a
  // position-unique key for unnamed finishers so they never collide on a shared
  // icon and leave a stale row behind on a view switch.
  return item.driver ? `d:${item.driver}` : `p:${item.position}`;
}

function buildRow(item) {
  const li = document.createElement("li");
  li.className = "row enter";
  li.dataset.key = rowKey(item);
  renderRowContent(li, item);
  return li;
}

function renderRowContent(li, item) {
  li.classList.remove("rank-1", "rank-2", "rank-3", "filler");
  if (item.filler) {
    li.classList.add("filler");
    li.innerHTML =
      `<span class="row__rank">${item.position}</span>` +
      `<span class="row__delta"></span>` +
      `<span class="row__driver"><span class="row__icon"></span><span class="row__name"></span></span>` +
      `<span class="row__race"></span>` +
      `<span class="row__total"></span>`;
    li.dataset.total = "0";
    return;
  }
  if (item.position <= 3) li.classList.add(`rank-${item.position}`);
  li.innerHTML =
    `<span class="row__rank">${item.position}</span>` +
    deltaMarkup(item.delta || 0) +
    `<span class="row__driver">` +
      `<img class="row__icon" src="${item.character_icon}" alt="${escapeHtml(item.character || "")}" ` +
        `onerror="this.onerror=null;this.src='/assets/character/unknown.png'" />` +
      `<span class="row__name">${escapeHtml(item.driver || "—")}</span>` +
    `</span>` +
    `<span class="row__race">${racePill(item.race_points)}</span>` +
    `<span class="row__total">${item.total}</span>`;
  li.dataset.total = String(item.total);
}

// Rotation ring: a circle that fills over the slideboard interval so viewers
// see when the next group is coming. Restarts only when the shown feed changes
// (i.e. on an actual rotation), not on every data update. Coloured by the group
// that's up next.
function updateRotationRing() {
  const ids = [...feeds.keys()];
  const rotating = !userPinnedFeed && ids.length > 1;
  if (!rotating) {
    el.rotring.hidden = true;
    lastRingFeed = null;
    return;
  }
  el.rotring.hidden = false;
  if (activeFeed === lastRingFeed) return;
  lastRingFeed = activeFeed;
  const idx = ids.indexOf(activeFeed);
  const next = feeds.get(ids[(idx + 1) % ids.length]);
  el.rotbar.style.stroke = (next && next.badge && next.badge.color) || "#ffffff";
  el.rotbar.style.animation = "none";
  void el.rotbar.getBoundingClientRect(); // force reflow so the animation restarts
  el.rotbar.style.animation = `rotfill ${ROTATE_MS}ms linear`;
}

function render() {
  ensureUiMessages();
  ensureDisplayNames();
  if (fixedGridView) {
    renderGrid();
    return;
  }
  activeFeed = pickActiveFeed();
  updateRotationRing();
  const payload = activeFeed ? feeds.get(activeFeed) : null;

  el.empty.hidden = true;
  if (!payload) {
    el.title.textContent = t("Waiting for feed…");
    el.eyebrow.textContent = t("Tournament standings");
    el.raceSeq.textContent = "–";
    el.raceTotal.textContent = "";
    el.boardCaption.textContent = "";
    el.board.classList.remove("view-race", "view-total", "racing");
    el.trackbar.hidden = true;
    el.totalsbar.hidden = true;
    reconcileRows([]);
    renderStatus();
    requestAnimationFrame(fitToViewport);
    return;
  }

  const isRacing = payload.phase === "racing";
  const view = pickView(payload);
  const isRaceView = view.kind === "race";
  const desc = describeView(payload, view.kind);
  el.title.textContent = payload.title || t("Live standings");
  // The eyebrow names the on-screen list ("Race result" / "Overall standings")
  // so the auto-switch between the two is never ambiguous.
  el.eyebrow.textContent = desc.eyebrow;
  el.raceSeq.textContent = payload.display_race != null ? String(payload.display_race) : "–";
  el.raceTotal.textContent = raceCounterSuffix(payload);
  el.boardCaption.textContent = desc.caption;
  renderBadge(payload.badge);

  // While a race is being played the track + countdown hero replaces the
  // banner, with the running Total Standings shown beneath it.
  el.board.classList.toggle("racing", isRacing);
  if (isRacing) {
    el.trackbar.hidden = true;
    el.totalsbar.hidden = true;
    setColumnHeader(el.colRace, "Last race");
    el.board.classList.remove("view-race");
    el.board.classList.add("view-total");
    renderRacingHero(payload);
    reconcileRows(view.rows);
  } else {
    // The points column means different things per view, so label it honestly
    // and emphasise whichever column the rows are actually sorted by.
    setColumnHeader(el.colRace, isRaceView ? "This race" : "Last race");
    el.board.classList.toggle("view-race", isRaceView);
    el.board.classList.toggle("view-total", !isRaceView);
    renderTrackOrTotals(payload, view.kind);
    reconcileRows(view.rows);
    // Overall only before the first confirmed race: say why the table is empty.
    if (overallOnly() && payload.phase === "review" && !view.rows.length) {
      el.empty.textContent = overallWaitingText(payload);
      el.empty.hidden = false;
    }
  }

  el.footStatus.textContent = statusText(payload);
  renderStatus();
  requestAnimationFrame(fitToViewport);
}

function renderGrid() {
  let grid = document.getElementById("grid-board");
  if (!grid) {
    if (el.board) el.board.closest(".shell").hidden = true;
    grid = document.createElement("main");
    grid.id = "grid-board";
    grid.className = "gridboard";
    grid.setAttribute("aria-live", "polite");
    el.stage.appendChild(grid);
  }
  const payloads = [...feeds.values()];
  if (!payloads.length) {
    grid.innerHTML = `
      <section class="gridempty">
        <div class="gridempty__title">${escapeHtml(t("Waiting for live feeds…"))}</div>
        <div class="gridempty__sub">${escapeHtml(t("Load videos and start the virtual capture to fill the tournament tables."))}</div>
      </section>`;
    renderStatus();
    return;
  }
  grid.innerHTML = payloads.map(buildGridCard).join("");
}

function buildGridCard(payload) {
  const view = pickView(payload);
  const isRaceView = view.kind === "race";
  const desc = describeView(payload, view.kind);
  const rows = view.rows;
  const filler = [];
  for (let position = rows.length; position < MIN_ROWS; position++) {
    filler.push({ filler: true, position: position + 1 });
  }
  // Before any result, the 12-row height is reserved as a faint skeleton with a
  // single calm message over it — never a column of dashes that reads as broken.
  const isEmpty = rows.length === 0;
  const badge = payload.badge || {};
  const track = payload.track || {};
  const waitingText = overallOnly() && payload.phase === "review"
    ? overallWaitingText(payload)
    : track.name_uk || track.track_icon ? t("Waiting for first race…") : t("Detecting track…");
  const caption = desc.caption;
  const raceLabel = raceCounterLabel(payload);
  // Finished = the group has completed all its configured races (races per group).
  // Purely visual: a checkered flag + gold accent so a done group reads at a glance.
  const racesTotal = Number(payload.races_total) || 0;
  const finished = racesTotal > 0 && (payload.races_completed || 0) >= racesTotal;
  // The mode pill makes "single race vs whole series" readable at a glance —
  // the most important fact on the card. Coloured by the view-race/view-total
  // class on the section (gold = latest race, green = overall standings).
  const modeLabel = finished ? t("Finished") : payload.phase === "standby" ? t("Standby") : isRaceView ? t("Latest race") : t("Overall");
  // Gap-to-leader column: deficit in total points behind P1 (every row carries a
  // running total, so this is meaningful in both views).
  const totalRows = payload.total_rows || [];
  const leaderTotal = totalRows.length ? Math.max(...totalRows.map((r) => Number(r.total) || 0)) : 0;
  // A race that's being reviewed rotates race-result <-> overall; show the
  // bottom-left ring counting down to that swap so it never feels abrupt.
  // Overall only never swaps, so it has no countdown ring.
  const showRing = payload.phase === "review" && payload.totals_ready && !overallOnly();
  const nextLabel = view.kind === "race" ? t("Overall standings") : t("Race result");
  // Fade the list only when the shown view actually flips, not on every refresh.
  const prevKind = lastGridKind.get(payload.feed);
  const swap = prevKind !== undefined && prevKind !== view.kind;
  lastGridKind.set(payload.feed, view.kind);
  // Highlight mode: "qualifier" splits the overall standings into advancement
  // bands (Kampioen/Talent/Wild); otherwise the podium top-3 is highlighted.
  // Bands are by overall position, so they only apply on the totals view — the
  // latest-race result still gets the standard 1/2/3 podium even in qualifier.
  const qualifier = payload.highlight_mode === "qualifier";
  const banding = qualifier && view.kind === "total";
  const bandClasses = banding ? qualifierBandClasses(rows) : null;
  const podium = !banding;
  const rowsHtml = rows
    .concat(filler)
    .map((item, idx) => buildGridRow(item, leaderTotal, bandClasses ? bandClasses[idx] : "", podium))
    .join("");
  // While a race is being played, the LIVE state + next-result countdown live
  // inside the track panel (so they clearly belong to *that* race), not above the
  // overall-standings table where they read as live positions.
  const isRacing = payload.phase === "racing";
  const liveboxHtml = isRacing
    ? `<div class="gridcard__live" data-live-body="${escapeHtml(payload.feed || "")}">${liveboxBodyHtml(feedStatusState(payload.feed, payload))}</div>`
    : "";
  const showTotalsBar =
    payload.phase === "totals" || (payload.phase === "review" && view.kind === "total");
  // Header art order: cup emblem first, then the (enlarged) track image to its
  // right, then the name. Trophy emblem stands in for the cup on the totals view.
  const trophySvg =
    `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v2h3v3a4 4 0 0 1-4 4h-.3A6 6 0 0 1 13 15.9V18h3v2H8v-2h3v-2.1A6 6 0 0 1 7.3 12H7a4 4 0 0 1-4-4V5h3V3zm0 4H5v1a2 2 0 0 0 1 1.7V7zm12 0v2.7A2 2 0 0 0 19 8V7h-1z"/></svg>`;
  // Cup name sits under its icon; drop the redundant "Cup" word (the icon says it).
  const named = localizedTrack(track);
  const cupShort = named ? shortCupName(named.cup, named.cupLang) : shortCupName(track.cup_uk, "en-GB");
  const cupLangAttr = named ? ` lang="${escapeAttr(named.cupLang)}"` : "";
  const cupFull = named ? named.cup : track.cup_uk || "";
  // Default: the English (EU flag) and Dutch (NL flag) names; a chosen language
  // shows that one name.
  const trackNameHtml = named
    ? (named.name
      ? `<b lang="${escapeAttr(named.nameLang)}" title="${escapeAttr(named.name)}">${escapeHtml(named.name)}</b><span>&nbsp;</span>`
      : `<b>${escapeHtml(t("Track pending"))}</b><span>${escapeHtml(t("Detecting track…"))}</span>`)
    : `<b>${track.name_uk ? FLAG_EU + escapeHtml(track.name_uk) : escapeHtml(t("Track pending"))}</b>
          <span>${track.name_nl ? FLAG_NL + escapeHtml(track.name_nl) : (track.name_uk ? "" : escapeHtml(t("Detecting track…")))}</span>`;
  // Connection-error / temporary-player-drop banner. Suspected = a drop just
  // happened and totals may be corrected once the next race confirms the field.
  const ce = payload.connection_error;
  const cr = payload.connection_reset;
  const connErrHtml = cr
    ? `<div class="gridcard__connerr is-reset">↺ ${escapeHtml(t("Connection reset — totals continued from prior standings"))}</div>`
    : ce
    ? `<div class="gridcard__connerr ${ce.suspected ? "is-suspected" : "is-adjusted"}">${
        ce.suspected
          ? `⚠ ${escapeHtml(t("Connection error — scores may adjust after the next race"))}`
          : escapeHtml(t("Scores adjusted — player drop (race {0} discounted)", (ce.excluded_races || []).join(", ")))
      }</div>`
    : "";
  const trackHtml = showTotalsBar
    ? `<div class="gridcard__track gridcard__track--totals">
        <div class="gridcard__trophy">${trophySvg}</div>
        <div class="gridcard__tracktext"><b>${escapeHtml(t("Overall standings"))}</b><span>${escapeHtml(totalsSubText(payload))}</span></div>
      </div>`
    : `<div class="gridcard__track${isRacing ? " gridcard__track--live" : ""}">
        <div class="gridcard__cupwrap">
          ${track.cup_icon ? `<img class="gridcard__cup" src="${track.cup_icon}" alt="" />` : `<span class="gridcard__cup gridcard__cup--ph"></span>`}
          ${cupShort ? `<span class="gridcard__cuplabel"${cupLangAttr} title="${escapeAttr(cupFull)}">${escapeHtml(cupShort)}</span>` : ""}
        </div>
        ${track.track_icon ? `<img class="gridcard__trackimg" src="${track.track_icon}" alt="" />` : `<span class="gridcard__trackplaceholder"></span>`}
        <div class="gridcard__tracktext">
          ${trackNameHtml}
        </div>
        ${liveboxHtml}
      </div>`;
  return `
    <section class="gridcard ${isRaceView ? "view-race" : "view-total"}${finished ? " is-finished" : ""}${banding ? " is-banded" : ""}" style="--badge:${escapeHtml(badge.color || "#94A3B8")};--badge-text:${escapeHtml(badge.text_color || "#101426")}">
      <header class="gridcard__header">
        <div class="gridcard__badge">${escapeHtml(badge.label || payload.feed || "MK8DX")}</div>
        <div class="gridcard__title">
          <span class="gridcard__mode${finished ? " gridcard__mode--finished" : ""}">${finished ? FLAG_FINISH : ""}${escapeHtml(modeLabel)}</span>
        </div>
        <div class="gridcard__race"><span>${escapeHtml(t("Race"))}</span><b>${escapeHtml(raceLabel)}</b></div>
      </header>
      ${trackHtml}
      ${connErrHtml}
      ${debugView ? `<div class="gridcard__debug">${escapeHtml(gridDebugText(payload))}</div>` : ""}
      <div class="gridcard__tablecap">${escapeHtml(caption)}</div>
      <div class="gridcols">
        ${[[t("column header|Pos"), t("Pos")], ["+/–", "+/–"], [t("Driver"), t("Driver")],
          [t("column header|Race"), t("Race")], [t("column header|Gap"), t("Gap")],
          [t("column header|Total"), t("Total")]].map(([label, full], index) =>
          `<span${index === 1 ? ' class="gridcols__delta"' : ""} title="${escapeAttr(full)}">${escapeHtml(label)}</span>`).join("")}
      </div>
      <div class="gridrows-wrap${isEmpty ? " is-empty" : ""}">
        <ol class="gridrows${swap ? " swap" : ""}">${rowsHtml}</ol>
        ${isEmpty ? `<div class="gridcard__waiting"><span>${escapeHtml(waitingText)}</span></div>` : ""}
      </div>
      ${showRing ? `<div class="gridcard__rotate" data-review-ring="${escapeHtml(payload.feed || "")}">
        <svg class="rotmini" viewBox="0 0 36 36" aria-hidden="true">
          <circle class="rotmini__t" cx="18" cy="18" r="15"></circle>
          <circle class="rotmini__b" cx="18" cy="18" r="15" style="stroke-dashoffset:${(94.25 * (1 - reviewFracFor(payload.feed))).toFixed(2)}"></circle>
        </svg>
        <span>${escapeHtml(t("Next: {0}", nextLabel))}</span>
      </div>` : ""}
    </section>`;
}

// Qualifier advancement bands per group: top 4 (Kampioen), then the rest split
// as evenly as possible into the middle (Talent) and bottom (Wild) bands — so a
// group of 12 → 4/4/4 and a group of 10 → 4/3/3 (12/11/11 across three groups).
//
// Slots are fixed, so a tie straddling a band boundary can't all advance to the
// same band. Players in such a tie get a *mixed* class (e.g. "qband-top-mid") —
// the actual split is decided externally on the tiebreak. Returns one class per
// row (rows are the overall standings, already sorted by total).
function qualifierBandClasses(rows) {
  const n = rows.length;
  const top = Math.min(4, n);
  const b1 = top;                                       // slots 0..b1-1 = top
  const b2 = top + Math.ceil(Math.max(0, n - top) / 2); // b1..b2-1 = mid; b2.. = bot
  const bandOf = (i) => (i < b1 ? "top" : i < b2 ? "mid" : "bot");
  const out = new Array(n);
  let i = 0;
  while (i < n) {
    let j = i; // extend over the tie group (consecutive rows with equal total)
    const total = Number(rows[i].total);
    while (j + 1 < n && Number(rows[j + 1].total) === total) j++;
    const spanned = []; // distinct bands the tie group covers, in top→bot order
    for (let k = i; k <= j; k++) {
      const b = bandOf(k);
      if (!spanned.includes(b)) spanned.push(b);
    }
    const cls = "qband-" + spanned.join("-"); // one band, or a mixed boundary class
    for (let k = i; k <= j; k++) out[k] = cls;
    i = j + 1;
  }
  return out;
}

function buildGridRow(item, leaderTotal, hlClass, podium) {
  if (item.filler) {
    return `<li class="gridrow filler"><span>${item.position}</span><span></span><span class="gridrow__skel"></span><span></span><span></span><span></span></li>`;
  }
  const icon = item.character_icon || "/assets/character/unknown.png";
  const d = item.delta || 0;
  const deltaCls = d > 0 ? "up" : d < 0 ? "down" : "flat";
  const gap = Number(item.total) - (leaderTotal || 0);
  const gapText = gap < 0 ? String(gap) : "—";  // leader (and anyone tied at top) reads as "—"
  // Qualifier band (precomputed, handles boundary ties) or the end-round podium.
  const hl = hlClass || (podium && item.position <= 3 ? `rank-${item.position}` : "");
  // Dropped this race (suspected connection error) — flag the row with a ⚠.
  const dropMark = item.dropped ? `<span class="gridrow__drop" title="${escapeAttr(t("No result this race — possible connection error"))}">⚠</span>` : "";
  // Disconnected (absent this race) — carried over with last total. The no-wifi mark
  // sits after the full name so the name is never clipped by it.
  const dcMark = item.disconnected ? `<span class="gridrow__dcwrap" title="${escapeAttr(t("Disconnected — last total kept"))}">${ICON_NO_WIFI}</span>` : "";
  const rowCls = `${hl}${item.dropped ? " is-dropped" : ""}${item.disconnected ? " is-disconnected" : ""}`;
  return `<li class="gridrow ${rowCls}">
    <span class="gridrow__rank">${item.position}</span>
    <span class="gridrow__delta ${deltaCls}">${item.disconnected ? "·" : deltaText(d)}</span>
    <span class="gridrow__driver"><img src="${icon}" alt="" onerror="this.onerror=null;this.src='/assets/character/unknown.png'" />${dropMark}<b>${escapeHtml(item.driver || "—")}</b>${dcMark}</span>
    <span class="gridrow__race">${item.disconnected ? "" : racePill(item.race_points)}</span>
    <span class="gridrow__gap">${gapText}</span>
    <span class="gridrow__total">${item.total}</span>
  </li>`;
}

function deltaText(delta) {
  if (delta > 0) return `▲${delta}`;
  if (delta < 0) return `▼${Math.abs(delta)}`;
  return "·";  // neutral: held position, or no previous race to compare
}

// Inner HTML for the in-track LIVE box: a LIVE tag plus either the next-result
// countdown or a plain "waiting for results" message. Recomputed on the tick.
function liveboxBodyHtml(state) {
  if (!state) return "";
  const tag = `<span class="gridcard__livetag"><i class="gridcard__livedot${state.cls === "waiting" ? " waiting" : ""}"></i>${escapeHtml(t("LIVE"))}</span>`;
  if (state.cls === "waiting") {
    return tag + `<span class="gridcard__livewait">${escapeHtml(t("Waiting for race results to come in"))}</span>`;
  }
  if (state.clock) {
    return tag + `<span class="gridcard__livenext">${escapeHtml(t("Next result"))}</span><span class="gridcard__liveclock">${escapeHtml(state.clock)}</span>`;
  }
  return tag + `<span class="gridcard__livewait">${escapeHtml(t("Tracking race…"))}</span>`;
}

// Raw engine telemetry — operators only, shown when ?debug=1.
function gridDebugText(payload) {
  const completed = payload.races_completed || 0;
  const found = payload.races_found || 0;
  const kind = pickView(payload).kind === "race" ? "latest race" : "total";
  const sync = payload.synced ? "in sync" : "live";
  const confirmed = confirmedStatusText(payload);
  return `${sync} · found ${found} · completed ${completed} · showing ${kind}${confirmed ? " · " + confirmed : ""}`;
}

function confirmedStatusText(payload) {
  const confirmed = payload.confirmed || {};
  const status = confirmed.status || "idle";
  if (status === "idle" || status === "updated") return "";
  const pending = confirmed.pending_race;
  const race = pending ? ` race ${pending}` : "";
  if (status === "running" && confirmed.started_at && payload.server_time) {
    const startedOffset = payload.server_time - confirmed.started_at;
    const elapsed = Math.max(0, startedOffset + (now() - (feedSeen.get(payload.feed) || now())));
    return pending
      ? t("confirmed running race {0} {1}", pending, formatClock(elapsed))
      : t("confirmed running {0}", formatClock(elapsed));
  }
  if (status === "completed" && confirmed.duration_seconds != null) {
    return t("confirmed in {0}s", Math.round(Number(confirmed.duration_seconds)));
  }
  if (status === "queued") {
    return pending ? t("confirmed queued race {0}", pending) : t("confirmed queued");
  }
  if (status === "failed") {
    return pending ? t("confirmed failed race {0}", pending) : t("confirmed failed");
  }
  return `confirmed ${status}${race}`;  // an unexpected engine state: shown as it is
}

function feedStatusState(feed, payload) {
  const sync = feed ? feedSync.get(feed) : null;
  let cls = "offline";
  let label = t("OFFLINE");
  let countdownText = "";
  let detail = t("Waiting for feed");
  let clock = "";   // bare m:ss when a live countdown is running

  if (payload) {
    const seen = feedSeen.get(feed);
    const recent = seen !== undefined && now() - seen < LIVENESS_WINDOW;
    if (sync && sync.synced) {
      cls = "insync";
      label = t("UP TO DATE");
      detail = t("Standings current");
    } else if (sync && sync.hasCountdown) {
      const remaining = sync.deadline - now();
      if (remaining > 0) {
        cls = "live";
        label = t("LIVE");
        clock = formatClock(remaining);
        countdownText = t("Next result in {0}", clock);
        detail = countdownText;
      } else {
        cls = "waiting";
        label = t("DUE");
        detail = t("Waiting for race results to come in");
      }
    } else if (recent) {
      cls = "live";
      label = t("LIVE");
      detail = t("Tracking race");
    }
  }

  return { cls, label, countdownText, detail, clock };
}

// Tick the in-track LIVE box for every racing card so the countdown counts down
// (and flips to the "waiting for results" message when it elapses).
function updateRacingLiveboxes() {
  if (!fixedGridView) return;
  for (const node of document.querySelectorAll("[data-live-body]")) {
    const feed = node.getAttribute("data-live-body") || "";
    const payload = feeds.get(feed);
    if (!payload || payload.phase !== "racing") continue;
    node.innerHTML = liveboxBodyHtml(feedStatusState(feed, payload));
  }
}

// The bottom-left transition rings: fill over the review rotation so viewers
// see the race-result <-> overall swap coming. Driven from a timestamp (not a
// CSS animation) so it survives the grid's full re-renders.
function updateReviewRings() {
  if (!fixedGridView) return;
  const C = 94.25;  // 2·π·r for r=15
  for (const node of document.querySelectorAll("[data-review-ring]")) {
    const frac = reviewFracFor(node.getAttribute("data-review-ring"));
    const bar = node.querySelector(".rotmini__b");
    if (bar) bar.style.strokeDashoffset = String((C * (1 - frac)).toFixed(2));
  }
}

// Each feed flips its review sub-view on its own clock; re-render when any does
// so the shown list (and ring label) follows, independent of the other groups.
function checkReviewFlips() {
  if (!fixedGridView || overallOnly()) return;
  let flipped = false;
  for (const [feed, payload] of feeds) {
    if (payload.phase !== "review") {
      if (lastReviewSub.has(feed)) lastReviewSub.delete(feed);
      continue;
    }
    const sub = reviewSubFor(feed);
    if (lastReviewSub.get(feed) !== sub) {
      lastReviewSub.set(feed, sub);
      flipped = true;
    }
  }
  if (flipped) render();
}

// LIVE / UP TO DATE / DUE / OFFLINE + the next-update countdown. Runs both on
// new data and on a steady tick so the timer counts down and expires to DUE.
function renderStatus() {
  updateRacingLiveboxes();
  updateReviewRings();
  const feed = activeFeed;
  const payload = feed ? feeds.get(feed) : null;
  const state = feedStatusState(feed, payload);

  el.livepill.className = "livepill " + state.cls;
  el.liveLabel.textContent = state.label;

  const racing = payload && payload.phase === "racing";
  // The in-race hero owns the big countdown, so suppress the small header one
  // while racing to avoid showing the timer twice.
  if (state.countdownText && !racing) {
    el.countdown.hidden = false;
    el.countdown.textContent = state.countdownText;
  } else {
    el.countdown.hidden = true;
  }

  if (racing) {
    if (state.clock) {
      el.heroCountdown.textContent = state.clock;
      el.heroStatus.textContent = t("Race in progress");
    } else if (state.cls === "waiting") {
      el.heroCountdown.textContent = t("any moment");
      el.heroStatus.textContent = t("Awaiting results");
    } else {
      el.heroCountdown.textContent = "—";
      el.heroStatus.textContent = t("Race in progress");
    }
  }
}

function formatClock(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

function fitToViewport() {
  if (fixedGridView) return;
  const shell = document.querySelector(".shell");
  if (!shell) return;
  shell.style.transform = "none";
  const pad = 28;
  const w = shell.offsetWidth || 1;
  const h = shell.offsetHeight || 1;
  const scale = Math.min((window.innerWidth - pad) / w, (window.innerHeight - pad) / h, 2.4);
  shell.style.transform = `scale(${Math.max(scale, 0.2).toFixed(4)})`;
}

// The in-race hero: big track art + cup + a live countdown to the next result.
// The countdown text itself is kept in sync by renderStatus (ticks every 250ms).
function renderRacingHero(payload) {
  const track = payload.track || {};
  const named = localizedTrack(track);
  if (named) {
    el.heroTrackName.textContent = named.name || t("Track pending");
    el.heroTrackSub.textContent = named.cup || t("waiting for track detection");
  } else {
    el.heroTrackName.textContent = track.name_uk || t("Track pending");
    el.heroTrackSub.textContent =
      [track.cup_uk, track.name_nl].filter(Boolean).join(" · ") || t("waiting for track detection");
  }
  setLang(el.heroTrackName, named && named.name ? named.nameLang : "");
  setLang(el.heroTrackSub, named && named.cup ? named.cupLang : "");
  el.heroTrackName.title = el.heroTrackName.textContent;
  toggleImg(el.heroTrackArt, track.track_icon);
  toggleImg(el.heroCupArt, track.cup_icon);
}

// Banner follows the shown list: the "Overall standings" placeholder when the
// totals are on screen (review/total or totals-only phase), otherwise the track
// banner with an On going / Finished chip.
function renderTrackOrTotals(payload, kind) {
  const track = payload.track || {};
  const showTotalsBar =
    payload.phase === "totals" || (payload.phase === "review" && kind === "total");
  if (showTotalsBar) {
    el.trackbar.hidden = true;
    el.totalsbar.hidden = false;
    el.totalsSub.textContent = totalsSubText(payload);
    return;
  }
  el.totalsbar.hidden = true;
  const hasTrack = track.name_uk || track.track_icon;
  el.trackbar.hidden = !hasTrack;
  if (!hasTrack) return;
  const named = localizedTrack(track);
  el.trackName.textContent = (named ? named.name : track.name_uk) || t("Unknown track");
  el.trackSub.textContent = named ? named.cup : [track.cup_uk, track.name_nl].filter(Boolean).join(" · ");
  setLang(el.trackName, named && named.name ? named.nameLang : "");
  setLang(el.trackSub, named && named.cup ? named.cupLang : "");
  el.trackName.title = el.trackName.textContent;
  el.trackSub.title = el.trackSub.textContent;
  toggleImg(el.trackArt, track.track_icon);
  toggleImg(el.cupArt, track.cup_icon);
  const status = payload.race_status;
  if (status === "ongoing" || status === "finished") {
    el.trackStatus.hidden = false;
    el.trackStatus.className = "racechip " + status;
    el.trackStatus.textContent = status === "ongoing" ? t("On going") : t("Finished");
  } else {
    el.trackStatus.hidden = true;
  }
}

function renderBadge(badge) {
  if (!badge || !badge.label) return;
  el.badge.textContent = badge.label;
  if (badge.color) el.badge.style.background = badge.color;
  if (badge.text_color) el.badge.style.color = badge.text_color;
}

function toggleImg(img, src) {
  if (src) {
    img.src = src;
    img.style.visibility = "visible";
  } else {
    img.removeAttribute("src");
    img.style.visibility = "hidden";
  }
}

function statusText(payload) {
  const completed = payload.races_completed || 0;
  const confirmed = confirmedStatusText(payload);
  if (confirmed) return confirmed;
  if (payload.status === "provisional") return t("latest race · awaiting confirmation");
  if (completed) return completed === 1 ? t("1 race confirmed") : t("{0} races confirmed", completed);
  return t("standing by");
}

function reconcileRows(rows) {
  const items = rows.slice();
  for (let position = rows.length; position < MIN_ROWS; position++) {
    items.push({ filler: true, position: position + 1 });
  }

  const container = el.rows;
  const existing = new Map();
  for (const li of container.children) existing.set(li.dataset.key, li);

  const firstTops = new Map();
  for (const [key, li] of existing) firstTops.set(key, li.offsetTop);

  const ordered = [];
  for (const item of items) {
    const key = rowKey(item);
    let li = existing.get(key);
    if (li) {
      const oldTotal = Number(li.dataset.total || "0");
      renderRowContent(li, item);
      if (!item.filler && item.total > oldTotal) flash(li);
      existing.delete(key);
    } else {
      li = buildRow(item);
    }
    ordered.push(li);
  }
  for (const [, stale] of existing) stale.remove();
  for (const li of ordered) container.appendChild(li);

  for (const li of ordered) {
    if (li.classList.contains("filler")) continue;
    const first = firstTops.get(li.dataset.key);
    if (first === undefined) continue;
    const dy = first - li.offsetTop;
    if (Math.abs(dy) < 1) continue;
    li.animate(
      [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
      { duration: 440, easing: "cubic-bezier(.2,.7,.2,1)" }
    );
  }
}

function flash(li) {
  li.classList.remove("bumped");
  void li.offsetWidth;
  li.classList.add("bumped");
}

async function bootstrapStatic() {
  await handshake();
}

async function handshake() {
  try {
    const res = await fetch("/api/handshake", { cache: "no-store" });
    const data = await res.json();
    serverSession = data.session_id || serverSession;
    lastEventId = Number(data.latest_event_id || lastEventId || 0);
    for (const payload of data.feeds || []) ingest(payload);
  } catch (_) {
    await refreshSnapshot();
  }
  render();
}

// Signature of the feed set by event id — lets the safety-net poll skip a full
// re-render (which would interrupt the swap fade) when nothing has changed.
function feedsSignature() {
  let s = "";
  for (const [k, p] of feeds) s += `${k}:${p.event_id || 0};`;
  return s;
}

async function refreshSnapshot() {
  const before = feedsSignature();
  try {
    const res = await fetch("/api/feeds", { cache: "no-store" });
    const data = await res.json();
    for (const payload of data.feeds || []) ingest(payload);
  } catch (_) { /* leave empty state */ }
  if (feedsSignature() !== before) render();
}

function connect() {
  const source = new EventSource("/events");
  source.addEventListener("scoreboard", (ev) => {
    try {
      const incomingId = Number(ev.lastEventId || 0);
      const missed = incomingId && lastEventId && incomingId > lastEventId + 1;
      const data = JSON.parse(ev.data);
      ingest(data);
      if (missed) refreshSnapshot();
      render();
      sendRenderBeacon(data);
    } catch (_) { /* ignore malformed frame */ }
  });
  source.addEventListener("reset", (ev) => {
    feeds.clear();
    feedSync.clear();
    feedSeen.clear();
    const incomingId = Number(ev.lastEventId || 0);
    if (incomingId > lastEventId) lastEventId = incomingId;
    if (!userPinnedFeed) activeFeed = null;
    render();
  });
  source.onopen = () => el.board.classList.remove("is-disconnected");
  source.onerror = () => el.board.classList.add("is-disconnected");
}

// Monitoring: report when this payload was rendered, so the latency report can
// measure the server->browser-paint hop. Same machine => Date.now() shares the
// server clock. Fire-and-forget; the server only logs it when MK8DX_MONITOR is set.
function sendRenderBeacon(data) {
  try {
    const body = JSON.stringify({
      event_id: Number(data.event_id || 0),
      server_time: Number(data.server_time || 0),
      client_time: Date.now() / 1000,
      feed: data.feed || "",
      phase: data.phase || "",
      race_sequence: data.race_sequence || data.display_race || null,
    });
    fetch("/timing", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } })
      .catch(() => {});
  } catch (_) { /* never let beacon errors affect rendering */ }
}

function rotateFeeds() {
  if (userPinnedFeed) return;
  const ids = [...feeds.keys()];
  if (ids.length < 2) return;
  const idx = ids.indexOf(activeFeed);
  activeFeed = ids[(idx + 1) % ids.length];
  render();
}

// Apply a changed viewer setting: keep it for this browser and redraw.
function applyViewSettings(next) {
  if (next.lang !== undefined) viewSettings.lang = matchUiLanguage(next.lang);
  if (next.scoreboard !== undefined) viewSettings.scoreboard = normalizeScoreboardMode(next.scoreboard);
  if (next.trackLang !== undefined) viewSettings.trackLang = normalizeTrackLang(next.trackLang);
  storeSettings({ lang: viewSettings.lang, scoreboard: viewSettings.scoreboard, trackLang: viewSettings.trackLang });
  lastGridKind.clear();
  render();
}

// Language name in its own language ("日本語 (日本)"), from the browser.
function localeLabel(locale) {
  try {
    const label = new Intl.DisplayNames([locale], { type: "language" }).of(locale);
    if (label) return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
  } catch (_) { /* older engine: show the code */ }
  return locale;
}

// A small gear (bottom right) for interactive viewers; it fades out when the
// pointer rests. Not shown in an OBS browser source (window.obsstudio) or with
// ?controls=0 — unattended sources use the URL parameters instead.
function mountViewControls() {
  if (window.obsstudio || params.get("controls") === "0") return;
  const wrap = document.createElement("div");
  wrap.className = "viewctl";
  wrap.innerHTML =
    `<button type="button" class="viewctl__gear" aria-expanded="false" aria-controls="viewctl-panel" data-i18n-title="Display settings" title="${escapeAttr(t("Display settings"))}">` +
      `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>` +
      `<span class="viewctl__sr" data-i18n="Display settings">${escapeHtml(t("Display settings"))}</span>` +
    `</button>` +
    `<div class="viewctl__panel" id="viewctl-panel" hidden>` +
      `<label class="viewctl__field"><span data-i18n="Language">${escapeHtml(t("Language"))}</span><select data-setting="lang">` +
        `<option value="" data-i18n="Browser language (default)">${escapeHtml(t("Browser language (default)"))}</option>` +
        UI_LANGUAGES.map((code) => `<option value="${code}" lang="${code}">${escapeHtml(localeLabel(code))}</option>`).join("") +
      `</select></label>` +
      `<label class="viewctl__field"><span data-i18n="Scoreboard">${escapeHtml(t("Scoreboard"))}</span><select data-setting="scoreboard">` +
        `<option value="auto" data-i18n="Automatic (race result ↔ overall)">${escapeHtml(t("Automatic (race result ↔ overall)"))}</option>` +
        `<option value="overall" data-i18n="Overall only">${escapeHtml(t("Overall only"))}</option>` +
      `</select></label>` +
      `<label class="viewctl__field"><span data-i18n="Track names">${escapeHtml(t("Track names"))}</span><select data-setting="trackLang">` +
        `<option value="" data-i18n="English + Dutch (default)">${escapeHtml(t("English + Dutch (default)"))}</option>` +
        TRACK_LOCALES.map((locale) => `<option value="${locale}" lang="${locale}">${escapeHtml(localeLabel(locale))}</option>`).join("") +
      `</select></label>` +
    `</div>`;
  document.body.appendChild(wrap);
  const gear = wrap.querySelector(".viewctl__gear");
  const panel = wrap.querySelector(".viewctl__panel");
  const selects = wrap.querySelectorAll("select");
  const sync = () => {
    for (const select of selects) select.value = viewSettings[select.dataset.setting] || "";
  };
  sync();
  for (const select of selects) {
    select.addEventListener("change", () => applyViewSettings({ [select.dataset.setting]: select.value }));
  }
  let idleTimer = 0;
  const wake = () => {
    document.body.classList.add("viewctl-awake");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (panel.hidden && !wrap.contains(document.activeElement)) document.body.classList.remove("viewctl-awake");
    }, 3000);
  };
  for (const type of ["pointermove", "pointerdown", "keydown"]) window.addEventListener(type, wake, { passive: true });
  gear.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    gear.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) sync();
    wake();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      panel.hidden = true;
      gear.setAttribute("aria-expanded", "false");
      gear.focus();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!panel.hidden && !wrap.contains(event.target)) {
      panel.hidden = true;
      gear.setAttribute("aria-expanded", "false");
    }
  });
}

// nolive=1 is a fully static snapshot (handshake once, no SSE, no polling or
// rotation) — used for previews/screenshots that must settle to a steady frame.
const staticMode = params.get("nolive") === "1";

window.addEventListener("resize", fitToViewport);
if (!staticMode) {
  setInterval(renderStatus, 250);   // keeps the countdown ticking + expiry to WAITING
  setInterval(rotateFeeds, ROTATE_MS);
  setInterval(checkReviewFlips, 250); // re-render when any feed's review half flips
  setInterval(refreshSnapshot, 1000); // safety net: recover if an SSE update was missed
}

mountViewControls();
render();
fitToViewport();
if (staticMode) {
  bootstrapStatic();
} else {
  handshake();
  connect();
}
