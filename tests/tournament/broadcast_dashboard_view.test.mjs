// The Live spectator dashboard's viewer settings (scoreboard mode, track/cup name language), run on
// the real broadcast_web/app.js in a minimal fake DOM. Run: node --test tests/tournament/broadcast_dashboard_view.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const APP = readFileSync(join(ROOT, "apps/tournament-live/src/live_processor/broadcast_web/app.js"), "utf8");
const CATALOG = JSON.parse(readFileSync(join(ROOT,
  "packages/tournament-extraction/python/src/mk8dx_tournament_extraction/track-names-v1.json"), "utf8"));
// The slice the server's /api/display-names returns (display_assets.display_name_catalog).
const DISPLAY_NAMES = {
  locales: CATALOG.locales,
  tracks: Object.fromEntries(CATALOG.tracks.map((t) => [t.id, t.names])),
  cups: Object.fromEntries(CATALOG.cups.map((c) => [c.id, c.names])),
};

const escapeText = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.hidden = false;
    this.title = "";
    this._text = "";
    this._html = "";
    this.offsetTop = 0;
    this.offsetWidth = 100;
    this.offsetHeight = 100;
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      toggle: (name, on) => ((on ?? !classes.has(name)) ? classes.add(name) : classes.delete(name)),
      contains: (name) => classes.has(name),
    };
  }
  set textContent(value) { this._text = String(value); this._html = escapeText(value); }
  get textContent() { return this._text; }
  set innerHTML(value) { this._html = String(value); this._text = String(value).replace(/<[^>]*>/g, ""); }
  get innerHTML() { return this._html; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  appendChild(child) {
    this.children = this.children.filter((c) => c !== child).concat(child);
    child.parent = this;
    if (child.id) FakeElement.registry?.set(child.id, child);
    return child;
  }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  closest() { return new FakeElement(); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  addEventListener() {}
  animate() {}
  getBoundingClientRect() { return { width: 0, height: 0 }; }
}

// Loads app.js as a static snapshot (?nolive=1: no SSE, timers or rotation) with the given feeds.
async function loadDashboard({ search = "", feeds = [], storage = {}, storageThrows = false } = {}) {
  const elements = new Map();
  FakeElement.registry = elements;
  const store = { ...storage };
  const fetched = [];
  const document = {
    body: new FakeElement("body"),
    activeElement: null,
    getElementById(id) {
      // The page's own elements exist up front; ones the script creates (the grid) once appended.
      if (!elements.has(id) && id !== "grid-board") elements.set(id, new FakeElement(id));
      return elements.get(id) ?? null;
    },
    createElement: () => new FakeElement(),
    querySelector: () => new FakeElement(),
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const localStorage = {
    getItem(key) { if (storageThrows) throw new Error("blocked"); return store[key] ?? null; },
    setItem(key, value) { if (storageThrows) throw new Error("blocked"); store[key] = String(value); },
  };
  const json = (data) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
  const context = {
    console, Intl, Math, JSON, Number, String, Object, Array, Map, Set, Promise, URLSearchParams, Error,
    location: { search: `?nolive=1&controls=0${search ? "&" + search : ""}` },
    document,
    performance: { now: () => 1000 },
    requestAnimationFrame: () => 0,
    setInterval: () => 0,
    setTimeout: () => 0,
    clearTimeout: () => {},
    EventSource: class {},
    fetch(url) {
      fetched.push(url);
      if (url === "/api/handshake") return json({ session_id: "test", latest_event_id: 1, feeds });
      if (url === "/api/display-names") return json(DISPLAY_NAMES);
      return Promise.reject(new Error("offline"));
    },
  };
  context.window = { localStorage, innerWidth: 1920, innerHeight: 1080, addEventListener() {} };
  vm.createContext(context);
  vm.runInContext(APP, context);
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
  return { app: context, el: (id) => document.getElementById(id), store, fetched,
    grid: () => document.getElementById("stage").children.find((c) => c.id === "grid-board") };
}

const row = (position, driver, total, extra = {}) => ({
  position, driver, character: "Mario", character_icon: "/assets/character/0.png",
  race_points: 15 - position, total, delta: 0, dropped: false, disconnected: false, ...extra,
});
const TRACK = {
  name_uk: "Mario Kart Stadium", name_nl: "Mario Kart-Stadion", cup_uk: "Mushroom Cup", cup_nl: "Paddenstoelbeker",
  track_icon: "/assets/images/tracks/previews/000_mario_kart_stadium.png", cup_icon: "/assets/images/cups/000_mushroom_cup.png",
  id: "track.mario_kart_stadium", cup_id: "cup.mushroom_cup",
};
const TOTALS = [row(1, "Anna", 90), row(2, "Bram", 80)];
const RACE = [row(1, "Bram", 95), row(2, "Anna", 102)];

function feed(overrides = {}) {
  return {
    feed: "g1", title: "Group 1", badge: { label: "A", color: "#e52521", text_color: "#fff" },
    phase: "review", status: "confirmed", race_status: "finished", totals_ready: true,
    races_completed: 7, races_total: 12, display_race: 7, rows_kind: "race",
    track: TRACK, rows: RACE, total_rows: TOTALS, race_rows: RACE,
    countdown: {}, synced: true, confirmed: { status: "updated" }, server_time: 1, event_id: 1,
    ...overrides,
  };
}
// The just-finished race 8 is known, its totals are not confirmed yet.
const PENDING = { status: "provisional", totals_ready: false, display_race: 8, races_completed: 7 };

test("Automatic stays the default and leads the review with the race result", async () => {
  const { app, el } = await loadDashboard({ feeds: [feed()] });
  assert.equal(app.overallOnly(), false);
  assert.equal(app.pickView(feed()).kind, "race");
  assert.equal(el("eyebrow").textContent, "Race result");
  assert.equal(el("board-caption").textContent, "Race 7 result");
  // Unchanged default wording for the cumulative view.
  assert.equal(app.describeView(feed(), "total").caption, "Overall standings · after 7 races");
});

test("Automatic shows the race result, not stale totals, while confirmation is pending", async () => {
  const { app } = await loadDashboard({ feeds: [] });
  assert.equal(app.pickView(feed(PENDING)).kind, "race");
});

test("Overall only from the URL shows the confirmed standings and which race they include", async () => {
  const { app, el } = await loadDashboard({ search: "scoreboard=overall", feeds: [feed()] });
  assert.equal(app.overallOnly(), true);
  const view = app.pickView(feed());
  assert.equal(view.kind, "total");
  assert.deepEqual(view.rows.map((r) => r.driver), ["Anna", "Bram"]);
  assert.equal(el("eyebrow").textContent, "Overall standings");
  assert.equal(el("board-caption").textContent, "Overall standings · after race 7 of 12");
  assert.equal(el("totals-sub").textContent, "after race 7 of 12");
  assert.equal(el("totalsbar").hidden, false);
  assert.equal(el("trackbar").hidden, true);
});

test("Overall only never presents the pending race as confirmed", async () => {
  const pending = feed(PENDING);
  const { app, el } = await loadDashboard({ search: "scoreboard=overall", feeds: [pending] });
  const view = app.pickView(pending);
  assert.equal(view.kind, "total");
  assert.equal(view.rows, pending.total_rows);  // the confirmed standings after race 7, untouched
  assert.equal(el("board-caption").textContent,
    "Overall standings · after race 7 of 12 · race 8 awaiting confirmation");
});

test("Overall only before the first confirmation shows an honest empty table", async () => {
  const first = feed({ ...PENDING, display_race: 1, races_completed: 0, total_rows: [] });
  const { el, grid } = await loadDashboard({ search: "scoreboard=overall", feeds: [first] });
  assert.equal(el("emptystate").hidden, false);
  assert.equal(el("emptystate").textContent, "Overall standings appear once race 1 is confirmed");
  assert.equal(el("board-caption").textContent, "Overall standings · no race confirmed yet · race 1 awaiting confirmation");
  assert.equal(grid(), undefined);
});

test("Overall only in the fixed grid: totals header, no swap ring, every phase", async () => {
  const feeds = [
    feed({ feed: "standby", phase: "standby", race_status: "", races_completed: 0, display_race: null, total_rows: [], race_rows: [], rows: [], track: {} }),
    feed({ feed: "racing", phase: "racing", race_status: "ongoing", display_race: 8, race_rows: [], synced: false }),
    feed({ feed: "review", ...PENDING }),
    feed({ feed: "confirmed" }),
    feed({ feed: "dropped", total_rows: [row(1, "Anna", 90), row(2, "Bram", 80, { disconnected: true, race_points: null })] }),
    feed({ feed: "finished", phase: "totals", races_completed: 12, display_race: 12, race_rows: [] }),
  ];
  const { grid } = await loadDashboard({ search: "view=grid&scoreboard=overall", feeds });
  const cards = grid().innerHTML.split("<section class=\"gridcard ").slice(1);
  assert.equal(cards.length, 6);
  assert.ok(!grid().innerHTML.includes("data-review-ring"), "no race-result swap ring in Overall only");
  const [standby, racing, review, confirmed, dropped, finished] = cards;
  assert.match(standby, /Standby/);
  assert.match(racing, /gridcard__track--live/);
  assert.match(racing, /Overall standings · after race 7 of 12/);
  assert.match(review, /^view-total/);
  assert.match(review, /after race 7 of 12 · race 8 awaiting confirmation/);
  assert.match(confirmed, /^view-total/);
  assert.match(dropped, /is-disconnected/);
  assert.match(finished, /Finished/);
});

test("Automatic in the fixed grid keeps the swap ring", async () => {
  const { grid } = await loadDashboard({ search: "view=grid", feeds: [feed()] });
  assert.match(grid().innerHTML, /data-review-ring/);
  assert.match(grid().innerHTML, /Next: Overall standings/);
});

test("the choice is kept per viewer and the URL parameter wins", async () => {
  const stored = await loadDashboard({ storage: { "mk8dx.broadcast.viewSettings.v1": '{"scoreboard":"overall","trackLang":"ru-RU"}' } });
  assert.equal(stored.app.overallOnly(), true);
  const overridden = await loadDashboard({ search: "scoreboard=auto&trackLang=ja",
    storage: { "mk8dx.broadcast.viewSettings.v1": '{"scoreboard":"overall","trackLang":"ru-RU"}' } });
  assert.equal(overridden.app.overallOnly(), false);
  assert.equal(overridden.app.localizedTrack(TRACK).nameLang, "ja-JP");
  const chooser = await loadDashboard();
  chooser.app.applyViewSettings({ scoreboard: "overall", trackLang: "ko-KR" });
  assert.deepEqual(JSON.parse(chooser.store["mk8dx.broadcast.viewSettings.v1"]), { scoreboard: "overall", trackLang: "ko-KR" });
});

test("blocked storage falls back to the defaults without breaking the page", async () => {
  const { app, el } = await loadDashboard({ storageThrows: true, feeds: [feed()] });
  assert.equal(app.overallOnly(), false);
  app.applyViewSettings({ scoreboard: "overall" });
  assert.equal(app.overallOnly(), true);
  assert.equal(el("eyebrow").textContent, "Overall standings");
});

test("default track names stay English + Dutch and need no catalog", async () => {
  const { app, grid, fetched } = await loadDashboard({ search: "view=grid", feeds: [feed({ phase: "racing", race_status: "ongoing" })] });
  assert.equal(app.localizedTrack(TRACK), null);
  assert.ok(!fetched.includes("/api/display-names"));
  assert.match(grid().innerHTML, /Mario Kart Stadium/);
  assert.match(grid().innerHTML, /Mario Kart-Stadion/);
  assert.match(grid().innerHTML, /class="gridcard__cuplabel"[^>]*>Mushroom</);
});

for (const [lang, locale, trackName, cupName] of [
  ["ja", "ja-JP", "マリオカートスタジアム", "キノコカップ"],
  ["ru", "ru-RU", "Стадион Mario Kart", "Кубок гриба"],
  ["en", "en-GB", "Mario Kart Stadium", "Mushroom"],
]) {
  test(`track and cup names by canonical ID in ${lang}, grid and normal view`, async () => {
    const racing = feed({ phase: "racing", race_status: "ongoing" });
    const gridView = await loadDashboard({ search: `view=grid&trackLang=${lang}`, feeds: [racing] });
    assert.ok(gridView.fetched.includes("/api/display-names"));
    const html = gridView.grid().innerHTML;
    assert.ok(html.includes(`<b lang="${locale}" title="${trackName}">${trackName}</b>`), html);
    assert.ok(html.includes(`lang="${locale}" title=`) && html.includes(`>${cupName}</span>`));
    assert.ok(!html.includes("Mario Kart-Stadion"), "the Dutch line is replaced by the chosen language");
    const normal = await loadDashboard({ search: `trackLang=${lang}`, feeds: [racing] });
    assert.equal(normal.el("hero-track-name").textContent, trackName);
    assert.equal(normal.el("hero-track-name").getAttribute("lang"), locale);
  });
}

test("a missing localized name falls back to English", async () => {
  const { app } = await loadDashboard({ search: "trackLang=ja" });
  const unknown = { ...TRACK, id: "track.not_in_catalog", cup_id: "cup.not_in_catalog" };
  assert.deepEqual({ ...app.localizedTrack(unknown) },
    { name: "Mario Kart Stadium", nameLang: "en-GB", cup: "Mushroom Cup", cupLang: "en-GB" });
  assert.equal(app.normalizeTrackLang("xx"), "");
  assert.equal(app.normalizeTrackLang("zh-tw"), "zh-TW");
});
