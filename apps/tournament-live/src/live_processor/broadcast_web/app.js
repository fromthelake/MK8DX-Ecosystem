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
  const plural = completed === 1 ? "" : "s";
  const n = payload.display_race;
  // Canonical vocabulary (see docs/broadcast_dashboard_redesign.md), kept in
  // lockstep with the server's ``_describe_view``: exactly two nouns —
  // "Race result" (one race) and "Overall standings" (cumulative).
  if (payload.phase === "standby") return { eyebrow: "Standby", caption: "Waiting for the first race" };
  if (payload.phase === "racing") {
    return {
      eyebrow: `Race ${n} in progress`,
      caption: completed ? `Overall standings · after ${completed} race${plural}` : `Race ${n} · in progress`,
    };
  }
  if (payload.phase === "review" && kind === "race") {
    return { eyebrow: "Race result", caption: `Race ${n} result` };
  }
  return { eyebrow: "Overall standings", caption: `Overall standings · after ${completed} race${plural}` };
}

// Sub-line under the "Overall standings" banner/card — the only place race
// count is spelled out so the banner title stays the canonical noun.
function totalsSubText(payload) {
  const completed = payload.races_completed || 0;
  return completed ? `after ${completed} race${completed === 1 ? "" : "s"}` : "overall points";
}

// "of Y" suffix for the Race counter when the operator has set a group size.
function raceCounterSuffix(payload) {
  const total = Number(payload.races_total || 0);
  if (!total || payload.display_race == null) return "";
  return ` of ${total}`;
}

// Plain "X" or "X of Y" race label for the compact grid cards.
function raceCounterLabel(payload) {
  if (payload.display_race == null) return "–";
  return `${payload.display_race}${raceCounterSuffix(payload)}`;
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
  if (fixedGridView) {
    renderGrid();
    return;
  }
  activeFeed = pickActiveFeed();
  updateRotationRing();
  const payload = activeFeed ? feeds.get(activeFeed) : null;

  el.empty.hidden = true;
  if (!payload) {
    el.title.textContent = "Waiting for feed…";
    el.eyebrow.textContent = "Tournament standings";
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
  el.title.textContent = payload.title || "Live standings";
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
    el.colRace.textContent = "Last race";
    el.board.classList.remove("view-race");
    el.board.classList.add("view-total");
    renderRacingHero(payload);
    reconcileRows(view.rows);
  } else {
    // The points column means different things per view, so label it honestly
    // and emphasise whichever column the rows are actually sorted by.
    el.colRace.textContent = isRaceView ? "This race" : "Last race";
    el.board.classList.toggle("view-race", isRaceView);
    el.board.classList.toggle("view-total", !isRaceView);
    renderTrackOrTotals(payload, view.kind);
    reconcileRows(view.rows);
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
        <div class="gridempty__title">Waiting for live feeds…</div>
        <div class="gridempty__sub">Load videos and start the virtual capture to fill the tournament tables.</div>
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
  const waitingText = track.name_uk || track.track_icon ? "Waiting for first race…" : "Detecting track…";
  const caption = desc.caption;
  const raceLabel = raceCounterLabel(payload);
  // Finished = the group has completed all its configured races (races per group).
  // Purely visual: a checkered flag + gold accent so a done group reads at a glance.
  const racesTotal = Number(payload.races_total) || 0;
  const finished = racesTotal > 0 && (payload.races_completed || 0) >= racesTotal;
  // The mode pill makes "single race vs whole series" readable at a glance —
  // the most important fact on the card. Coloured by the view-race/view-total
  // class on the section (gold = latest race, green = overall standings).
  const modeLabel = finished ? "Finished" : payload.phase === "standby" ? "Standby" : isRaceView ? "Latest race" : "Overall";
  // Gap-to-leader column: deficit in total points behind P1 (every row carries a
  // running total, so this is meaningful in both views).
  const totalRows = payload.total_rows || [];
  const leaderTotal = totalRows.length ? Math.max(...totalRows.map((r) => Number(r.total) || 0)) : 0;
  // A race that's being reviewed rotates race-result <-> overall; show the
  // bottom-left ring counting down to that swap so it never feels abrupt.
  const showRing = payload.phase === "review" && payload.totals_ready;
  const nextLabel = view.kind === "race" ? "Overall standings" : "Race result";
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
  const cupShort = (track.cup_uk || "").replace(/\s*cup\s*$/i, "").trim();
  // Connection-error / temporary-player-drop banner. Suspected = a drop just
  // happened and totals may be corrected once the next race confirms the field.
  const ce = payload.connection_error;
  const cr = payload.connection_reset;
  const connErrHtml = cr
    ? `<div class="gridcard__connerr is-reset">↺ Connection reset — totals continued from prior standings</div>`
    : ce
    ? `<div class="gridcard__connerr ${ce.suspected ? "is-suspected" : "is-adjusted"}">${
        ce.suspected
          ? "⚠ Connection error — scores may adjust after the next race"
          : `Scores adjusted — player drop (race ${(ce.excluded_races || []).join(", ")} discounted)`
      }</div>`
    : "";
  const trackHtml = showTotalsBar
    ? `<div class="gridcard__track gridcard__track--totals">
        <div class="gridcard__trophy">${trophySvg}</div>
        <div class="gridcard__tracktext"><b>Overall standings</b><span>${escapeHtml(totalsSubText(payload))}</span></div>
      </div>`
    : `<div class="gridcard__track${isRacing ? " gridcard__track--live" : ""}">
        <div class="gridcard__cupwrap">
          ${track.cup_icon ? `<img class="gridcard__cup" src="${track.cup_icon}" alt="" />` : `<span class="gridcard__cup gridcard__cup--ph"></span>`}
          ${cupShort ? `<span class="gridcard__cuplabel">${escapeHtml(cupShort)}</span>` : ""}
        </div>
        ${track.track_icon ? `<img class="gridcard__trackimg" src="${track.track_icon}" alt="" />` : `<span class="gridcard__trackplaceholder"></span>`}
        <div class="gridcard__tracktext">
          <b>${track.name_uk ? FLAG_EU + escapeHtml(track.name_uk) : "Track pending"}</b>
          <span>${track.name_nl ? FLAG_NL + escapeHtml(track.name_nl) : (track.name_uk ? "" : "Detecting track…")}</span>
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
        <div class="gridcard__race"><span>Race</span><b>${escapeHtml(raceLabel)}</b></div>
      </header>
      ${trackHtml}
      ${connErrHtml}
      ${debugView ? `<div class="gridcard__debug">${escapeHtml(gridDebugText(payload))}</div>` : ""}
      <div class="gridcard__tablecap">${escapeHtml(caption)}</div>
      <div class="gridcols">
        <span>Pos</span><span class="gridcols__delta">+/–</span><span>Driver</span><span>Race</span><span>Gap</span><span>Total</span>
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
        <span>Next: ${escapeHtml(nextLabel)}</span>
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
  const dropMark = item.dropped ? `<span class="gridrow__drop" title="No result this race — possible connection error">⚠</span>` : "";
  // Disconnected (absent this race) — carried over with last total. The no-wifi mark
  // sits after the full name so the name is never clipped by it.
  const dcMark = item.disconnected ? `<span class="gridrow__dcwrap" title="Disconnected — last total kept">${ICON_NO_WIFI}</span>` : "";
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
  const tag = `<span class="gridcard__livetag"><i class="gridcard__livedot${state.cls === "waiting" ? " waiting" : ""}"></i>LIVE</span>`;
  if (state.cls === "waiting") {
    return tag + `<span class="gridcard__livewait">Waiting for race results to come in</span>`;
  }
  if (state.clock) {
    return tag + `<span class="gridcard__livenext">Next result</span><span class="gridcard__liveclock">${escapeHtml(state.clock)}</span>`;
  }
  return tag + `<span class="gridcard__livewait">Tracking race…</span>`;
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
  const race = confirmed.pending_race ? ` race ${confirmed.pending_race}` : "";
  if (status === "running" && confirmed.started_at && payload.server_time) {
    const startedOffset = payload.server_time - confirmed.started_at;
    const elapsed = Math.max(0, startedOffset + (now() - (feedSeen.get(payload.feed) || now())));
    return `confirmed ${status}${race} ${formatClock(elapsed)}`;
  }
  if (status === "completed" && confirmed.duration_seconds != null) {
    return `confirmed in ${Math.round(Number(confirmed.duration_seconds))}s`;
  }
  if (status === "queued") {
    return `confirmed queued${race}`;
  }
  if (status === "failed") {
    return `confirmed failed${race}`;
  }
  return `confirmed ${status}${race}`;
}

function feedStatusState(feed, payload) {
  const sync = feed ? feedSync.get(feed) : null;
  let cls = "offline";
  let label = "OFFLINE";
  let countdownText = "";
  let detail = "Waiting for feed";
  let clock = "";   // bare m:ss when a live countdown is running

  if (payload) {
    const seen = feedSeen.get(feed);
    const recent = seen !== undefined && now() - seen < LIVENESS_WINDOW;
    if (sync && sync.synced) {
      cls = "insync";
      label = "UP TO DATE";
      detail = "Standings current";
    } else if (sync && sync.hasCountdown) {
      const remaining = sync.deadline - now();
      if (remaining > 0) {
        cls = "live";
        label = "LIVE";
        clock = formatClock(remaining);
        countdownText = "Next result in " + clock;
        detail = countdownText;
      } else {
        cls = "waiting";
        label = "DUE";
        detail = "Waiting for race results to come in";
      }
    } else if (recent) {
      cls = "live";
      label = "LIVE";
      detail = "Tracking race";
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
  if (!fixedGridView) return;
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
      el.heroStatus.textContent = "Race in progress";
    } else if (state.cls === "waiting") {
      el.heroCountdown.textContent = "any moment";
      el.heroStatus.textContent = "Awaiting results";
    } else {
      el.heroCountdown.textContent = "—";
      el.heroStatus.textContent = "Race in progress";
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
  el.heroTrackName.textContent = track.name_uk || "Track pending";
  el.heroTrackSub.textContent =
    [track.cup_uk, track.name_nl].filter(Boolean).join(" · ") || "waiting for track detection";
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
  el.trackName.textContent = track.name_uk || "Unknown track";
  el.trackSub.textContent = [track.cup_uk, track.name_nl].filter(Boolean).join(" · ");
  toggleImg(el.trackArt, track.track_icon);
  toggleImg(el.cupArt, track.cup_icon);
  const status = payload.race_status;
  if (status === "ongoing" || status === "finished") {
    el.trackStatus.hidden = false;
    el.trackStatus.className = "racechip " + status;
    el.trackStatus.textContent = status === "ongoing" ? "On going" : "Finished";
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
  if (payload.status === "provisional") return "latest race · awaiting confirmation";
  if (completed) return `${completed} race${completed === 1 ? "" : "s"} confirmed`;
  return "standing by";
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

render();
fitToViewport();
if (staticMode) {
  bootstrapStatic();
} else {
  handshake();
  connect();
}
