// The classic WordPress export: the community's own TN12-style document, made by the original
// Seating & Standings Manager code itself rather than an imitation of it.
//
// The original export page of the Seating & Standings Manager loads `assets/analytics.js`, which reads two
// PHP endpoints and builds the export (`buildClassicFullHtml`). Those files are vendored unchanged in
// `styles/` (see apps/timetrials-web/CLASSIC_EXPORT_PROVENANCE.md). Here the same page runs in a
// hidden frame and the two endpoints are answered from the published night: `classicDataset`
// gives the race and standing rows in the shape TournamentAnalyticsService::extractTournamentDataset
// wrote, `classicContent` the report texts. The pictures the old code asks for (its own
// `/assets/img/track|cup|character/<index>` files) are answered with this site's own game assets,
// so no picture is copied into the repository. The download it produces is the fallback document
// your TN12 file is, wrapped in the wp:html block markers.

import { CUP_ASSET_MANIFEST, GAME_ASSET_BASE, trackAsset } from "./asset-manifest.js";
import { schema9WebTrackCatalog } from "./schema9-track-catalog.js";
import { tournamentCharacterIcon } from "./tournament-character.js";
import type { PublicTournamentEvent } from "./tournament-operation-client.js";
import { formatWordpressLines } from "./wordpress-export-format.js";
import { shortenClassNames, slimWordpressHtml, wordpressFileName, wordpressSafeScript, type WordpressReportExport } from "./tournament-report-wordpress.js";

export type ClassicCatalog = Readonly<{
  tracks: readonly Readonly<{ trackIndex: number; cupIndex: number; nameUK: string }>[];
  cups: readonly Readonly<{ cupIndex: number; nameUK: string }>[];
  characters: readonly Readonly<{ characterIndex: number; rosterIndex: number; nameUK: string }>[];
}>;

type Row = Record<string, string | number | boolean | null>;

const fold = (value: string): string => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The old catalog's character for the night's character: the variant and the roster it belongs to. */
function classicCharacter(catalog: ClassicCatalog, label: string, roster: string | undefined): Readonly<{ variant: string; roster: string }> {
  const variant = catalog.characters.find((entry) => fold(entry.nameUK) === fold(label));
  if (variant !== undefined) {
    const base = catalog.characters.find((entry) => entry.characterIndex === variant.rosterIndex);
    return { variant: variant.nameUK, roster: base?.nameUK ?? roster ?? variant.nameUK };
  }
  return { variant: label, roster: roster ?? label };
}

/** The old catalog's track and cup names for a schema-9 track id (both follow the game's order). */
function classicTrack(catalog: ClassicCatalog, trackId: string | undefined): Readonly<{ track: string; cup: string }> {
  const index = schema9WebTrackCatalog.find((entry) => entry.id === trackId)?.index;
  const track = index === undefined ? undefined : catalog.tracks.find((entry) => entry.trackIndex === index);
  const cup = track === undefined ? undefined : catalog.cups.find((entry) => entry.cupIndex === track.cupIndex);
  return { track: track?.nameUK ?? "", cup: cup?.nameUK ?? "" };
}

/**
 * The rows TournamentAnalyticsService::extractTournamentDataset produced from a night's workbooks,
 * made from the published night: one race row per counted placement and one standing row per
 * Player and group. Totals and the place after each race are recomputed from the race points.
 */
export function classicDataset(event: PublicTournamentEvent, catalog: ClassicCatalog): Readonly<{ raceRows: Row[]; finalRows: Row[] }> {
  const tournamentId = event.tournamentId;
  const tournamentName = event.report?.title || event.name;
  const raceRows: Row[] = [];
  const finalRows: Row[] = [];
  const finalGroupOf = new Map<string, Readonly<{ id: string; name: string }>>();
  for (const group of event.groups) {
    if (group.stage !== "final") { continue; }
    for (const standing of group.standings) { finalGroupOf.set(standing.displayName, { id: group.groupId, name: group.name }); }
  }
  for (const group of event.groups) {
    const phase = group.stage === "final" ? "post" : "qualifier";
    const base = {
      tournamentId, tournamentName, director: "",
      phase, phaseLabel: phase === "qualifier" ? "Kwalificatie" : "Eindgroep",
      lobbyId: group.groupId, lobbyName: group.name, groupId: group.groupId, groupName: group.name,
      groupKey: `${tournamentId}|${group.groupId}`, videoName: "",
    };
    const target = (name: string): Row => {
      const reached = phase === "qualifier" ? finalGroupOf.get(name) : { id: group.groupId, name: group.name };
      return reached === undefined
        ? { qualifiedTargetLobbyId: "", qualifiedTargetGroupName: "", qualifiedTargetGroupKey: "" }
        : { qualifiedTargetLobbyId: reached.id, qualifiedTargetGroupName: reached.name, qualifiedTargetGroupKey: `${tournamentId}|${reached.id}` };
    };
    const standingOf = new Map(group.standings.map((standing) => [standing.displayName, standing] as const));
    const person = (name: string): Row => {
      const standing = standingOf.get(name);
      const character = standing?.character === undefined
        ? { variant: "", roster: "" }
        : classicCharacter(catalog, standing.character.label, standing.character.roster);
      return {
        playerId: standing?.playerId ?? name, player: name, playerName: name, playerDisplay: name,
        allTimeRank: standing?.seedRank ?? null, skillScore: standing?.seedScore ?? null,
        characterRoster: character.roster, characterVariant: character.variant, character: character.roster,
        ...target(name),
      };
    };
    const totals = new Map<string, number>(group.standings.map((standing) => [standing.displayName, 0] as const));
    const races = [...group.races].filter((race) => race.countsTowardStandings !== false).sort((a, b) => a.raceNumber - b.raceNumber);
    for (const race of races) {
      const before = new Map(totals);
      for (const placement of race.placements) {
        totals.set(placement.displayName, (totals.get(placement.displayName) ?? 0) + placement.racePoints);
      }
      const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
      const placeAfter = (name: string): number => 1 + ranked.findIndex(([, points]) => points === (totals.get(name) ?? 0));
      const { track, cup } = classicTrack(catalog, race.trackId);
      for (const placement of race.placements) {
        raceRows.push({
          ...base,
          raceKey: `${tournamentId}|${group.groupId}||${race.raceNumber}`,
          race: race.raceNumber,
          ...person(placement.displayName),
          trackRaw: track, track, trackSlug: "", trackMusic: "", cupRaw: cup, cup,
          position: placement.finishPosition,
          racePoints: placement.racePoints,
          totalBefore: before.get(placement.displayName) ?? 0,
          totalAfter: totals.get(placement.displayName) ?? 0,
          positionAfterRace: placeAfter(placement.displayName),
          countsTowardTotals: true, needsReview: false, reviewReason: "",
        });
      }
    }
    for (const standing of group.standings) {
      finalRows.push({
        ...base, ...person(standing.displayName),
        position: standing.rank, totalPoints: standing.points, races: standing.races,
      });
    }
  }
  return { raceRows, finalRows };
}

const paragraphsHtml = (texts: readonly string[] | undefined): string =>
  (texts ?? []).map((text) => `<p>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`).join("");
const blocksHtml = (html: readonly string[] | undefined, texts: readonly string[] | undefined): string =>
  html !== undefined && html.length > 0 ? html.join("") : paragraphsHtml(texts);

/** The report texts the old editor stored, from the published report: the story, the Top 5 note and a note per Player. */
export function classicContent(event: PublicTournamentEvent): Readonly<Record<string, unknown>> {
  const report = event.report;
  const shows = { intro: true, summary: true, topTracks: true, ...(report?.visibility ?? {}) } as Record<string, boolean>;
  const intro = [
    shows["intro"] === false ? "" : blocksHtml(report?.introHtml, report?.intro),
    shows["summary"] === false ? "" : blocksHtml(report?.summaryHtml, report?.summary),
  ].join("");
  const notes: Record<string, string> = {};
  for (const player of report?.players ?? []) {
    const html = blocksHtml(player.html, player.paragraphs);
    if (html.length > 0) { notes[player.name] = html; }
  }
  return {
    visibility: {
      showTopCups: false, showCupTrackOverview: false, showTrackDetail: false, showCharacterHub: false,
      showTotalAfterRaceChart: false, showPositionDistributionTable: false, showChartDownloadButtons: false,
    },
    introHtml: intro,
    topTracksIntroHtml: shows["topTracks"] === false ? "" : blocksHtml(report?.topTracksHtml, report?.topTracks),
    playerNotesByPlayer: notes,
    updatedAt: "", updatedBy: "",
  };
}

/** This site's picture for one the old code asks for, or null when it has none. */
export function classicPicture(path: string, catalog: ClassicCatalog): Readonly<{ src: string; size: number }> | null {
  const match = /\/img\/(track|cup|character)\/(\d+)\.(?:webp|png)$/.exec(path);
  if (match === null) { return null; }
  const index = Number(match[2]);
  if (match[1] === "track") {
    const id = schema9WebTrackCatalog.find((entry) => entry.index === index)?.id;
    const preview = id === undefined ? undefined : trackAsset(id)?.previewPath;
    return preview === undefined ? null : { src: `${GAME_ASSET_BASE}${preview}`, size: 320 };
  }
  if (match[1] === "cup") {
    const cup = CUP_ASSET_MANIFEST[index];
    return cup === undefined ? null : { src: `${GAME_ASSET_BASE}${cup.iconPath}`, size: 96 };
  }
  const character = catalog.characters.find((entry) => entry.characterIndex === index);
  if (character === undefined) { return null; }
  const roster = catalog.characters.find((entry) => entry.characterIndex === character.rosterIndex)?.nameUK;
  const icon = tournamentCharacterIcon({ label: character.nameUK, ...(roster === undefined ? {} : { roster }) });
  return icon === null ? null : { src: icon, size: 128 };
}

// ------------------------------------------------------------------ the original page, in a frame

/** The original export page's body without its inline scripts: the controls analytics.js looks up by id. */
const CLASSIC_PAGE_BODY = `<main class="analytics-shell classic-shell">
<header class="analytics-hero classic-hero"><div class="analytics-hero-copy"><p id="classicHeroKicker" class="analytics-kicker"></p><h1 id="heroTitle"></h1><p id="heroSubtitle" class="analytics-intro"></p></div>
<div class="analytics-hero-actions"><a id="backToBoardLink" class="analytics-backlink" href="#"></a><a id="openRecapLink" class="analytics-backlink" href="#"></a><a id="openDashboardLink" class="analytics-backlink" href="#"></a>
<button id="downloadClassicFullBtn" type="button" class="analytics-ghost-btn">Download index.html</button><button id="downloadClassicFragmentBtn" type="button" class="analytics-ghost-btn">Download .entry-content</button></div></header>
<section class="analytics-toolbar recap-toolbar classic-toolbar" aria-label="Selectie">
<label class="toolbar-field"><span id="scopeLabel">Toernooi</span><select id="scopeSelect"></select></label>
<label class="toolbar-field"><span id="groupLabel">Groep</span><select id="groupFilterSelect"></select></label>
<label class="toolbar-field"><span id="playerLabel">Speler</span><select id="playerFilterSelect"></select></label>
<div class="toolbar-field toolbar-field-language"><span id="languageLabel">Taal</span><div class="language-toggle" role="group" aria-label="Taal"><button id="languageNlBtn" type="button" class="analytics-ghost-btn" aria-pressed="true">NL</button><button id="languageUkBtn" type="button" class="analytics-ghost-btn" aria-pressed="false">UK</button></div></div>
<label class="toolbar-field toolbar-field-checkbox"><span id="exportInteractiveLabel"></span><span class="checkbox-row"><input id="exportInteractiveCheckbox" type="checkbox" /><span id="exportInteractiveText"></span></span></label>
<label class="toolbar-field toolbar-field-checkbox"><span id="exportEmbedImagesLabel"></span><span class="checkbox-row"><input id="exportEmbedImagesCheckbox" type="checkbox" /><span id="exportEmbedImagesText"></span></span></label>
<div class="toolbar-field toolbar-field-checkbox classic-visibility-toolbar"><span id="classicSectionVisibilityLabel"></span>
<span class="checkbox-row"><input id="classicShowTopCupsCheckbox" type="checkbox" /><span id="classicShowTopCupsText"></span></span>
<span class="checkbox-row"><input id="classicShowCupTrackOverviewCheckbox" type="checkbox" /><span id="classicShowCupTrackOverviewText"></span></span>
<span class="checkbox-row"><input id="classicShowTrackDetailCheckbox" type="checkbox" /><span id="classicShowTrackDetailText"></span></span>
<span class="checkbox-row"><input id="classicShowCharacterHubCheckbox" type="checkbox" /><span id="classicShowCharacterHubText"></span></span>
<span class="checkbox-row"><input id="classicShowTotalAfterRaceChartCheckbox" type="checkbox" /><span id="classicShowTotalAfterRaceChartText"></span></span>
<span class="checkbox-row"><input id="classicShowPositionDistributionTableCheckbox" type="checkbox" /><span id="classicShowPositionDistributionTableText"></span></span>
<span class="checkbox-row"><input id="classicShowChartDownloadButtonsCheckbox" type="checkbox" /><span id="classicShowChartDownloadButtonsText"></span></span></div>
<div class="toolbar-actions"><button id="saveClassicContentBtn" type="button" class="analytics-ghost-btn">Opslaan</button><span id="classicSaveStatus" class="analytics-status-inline" aria-live="polite"></span><button id="resetFiltersBtn" type="button" class="analytics-ghost-btn">Terug naar standaard</button></div>
</section>
<p id="analyticsStatus" class="analytics-status" aria-live="polite">Laden…</p>
<section id="overviewCards" class="analytics-metrics" aria-label="Kerncijfers"></section>
<section id="analyticsMount" class="analytics-content analytics-content-classic" aria-live="polite"></section>
</main>`;

const CLASSIC_SCRIPT = "styles/classic-report-export.js";
const CLASSIC_CSS = "styles/classic-report-export-css.txt";
const CLASSIC_CATALOG = "styles/classic-report-catalog.json";
/**
 * The old page's "Groep" choice: analytics.js GROUP_FILTER_ALL, _POST_ONLY ("Alle eindgroepen", how
 * the TN12 post was made) and _QUALIFIER_ONLY. One filter drives both the Top 5 and the charts per
 * Player: with every race the Top 5 counts all of them and a Player's charts run on through both
 * stages; with the end groups only, both follow the final groups.
 */
export type ClassicGroups = "__tabs__" | "__all__" | "__post_only__" | "__qualifier_only__";

const CLASSIC_FILE_SUFFIX: Readonly<Record<ClassicGroups, string>> = {
  __tabs__: "tabs",
  __all__: "alle-races",
  __post_only__: "eindgroepen",
  __qualifier_only__: "kwalificatie",
};

/** One player card of the classic file as two blocks, the final group shown, the qualifiers hidden. */
const CLASSIC_TAB_STYLE = `.mk8-classic-tabs{display:flex;gap:6px;justify-content:center;margin:10px 0 4px;flex-wrap:wrap}
.mk8-classic-tabs button{font:inherit;font-size:13px;font-weight:700;padding:5px 14px;border-radius:999px;border:1px solid var(--recap-accent,#1f5fa8);background:#fff;color:var(--recap-accent,#1f5fa8);cursor:pointer}
.mk8-classic-tabs button[aria-pressed="true"]{background:var(--recap-accent,#1f5fa8);color:#fff}
[data-mk8-classic-stage][hidden]{display:none!important}`;

/** The card switch for the classic file: show one block, hide the other, let the old runtime re-measure. */
const CLASSIC_TAB_RUNTIME = `(function(){document.addEventListener('click',function(e){var b=e.target&&e.target.closest?e.target.closest('button[data-mk8-classic-tab]'):null;if(!b)return;e.preventDefault();
var card=b.closest('.recap-player-section');if(!card)return;var want=b.getAttribute('data-mk8-classic-tab');
var blocks=card.querySelectorAll('[data-mk8-classic-stage]');for(var i=0;i<blocks.length;i++){if(blocks[i].getAttribute('data-mk8-classic-stage')===want)blocks[i].removeAttribute('hidden');else blocks[i].setAttribute('hidden','');}
var tabs=card.querySelectorAll('button[data-mk8-classic-tab]');for(var j=0;j<tabs.length;j++)tabs[j].setAttribute('aria-pressed',tabs[j].getAttribute('data-mk8-classic-tab')===want?'true':'false');
try{window.dispatchEvent(new Event('resize'));}catch(_r){}});})();`;

/**
 * The classic file with a switch on every player card, made from three runs of the original code:
 * all races (the Top 5 counts every race), end groups only and qualifiers only. Every card keeps its
 * place and its section; inside it, the final-group block is shown and the qualifier block hidden.
 */
export function mergeClassicStages(allRaces: string, endGroups: string, qualifiers: string, labels: Readonly<{ final: string; qualifier: string }>): string {
  const parser = new DOMParser();
  const base = parser.parseFromString(allRaces, "text/html");
  const finals = parser.parseFromString(endGroups, "text/html");
  const qualifying = parser.parseFromString(qualifiers, "text/html");
  const bodyOf = (doc: Document, id: string): Element | null => doc.querySelector(`section.recap-player-section[id='${id}']`);
  for (const card of [...base.querySelectorAll("section.recap-player-section[id]")]) {
    const final = bodyOf(finals, card.id);
    const qualifier = bodyOf(qualifying, card.id);
    if (final === null || qualifier === null) { continue; }
    const block = (source: Element, stage: string, hidden: boolean): Element => {
      const wrap = base.createElement("div");
      wrap.setAttribute("data-mk8-classic-stage", stage);
      if (hidden) { wrap.setAttribute("hidden", ""); }
      for (const child of [...source.childNodes]) { wrap.append(base.importNode(child, true)); }
      // The qualifier block's ids must not repeat the final block's.
      if (stage === "qualifier") { for (const element of [...wrap.querySelectorAll("[id]")]) { element.id = `q-${element.id}`; } }
      return wrap;
    };
    const tabs = base.createElement("div");
    tabs.className = "mk8-classic-tabs";
    for (const [stage, label] of [["final", labels.final], ["qualifier", labels.qualifier]] as const) {
      const button = base.createElement("button");
      button.type = "button";
      button.setAttribute("data-mk8-classic-tab", stage);
      button.setAttribute("aria-pressed", stage === "final" ? "true" : "false");
      button.textContent = label;
      tabs.append(button);
    }
    card.replaceChildren(tabs, block(final, "final", false), block(qualifier, "qualifier", true));
  }
  const style = base.createElement("style");
  style.id = "mk8-classic-tabs-css";
  style.textContent = CLASSIC_TAB_STYLE;
  base.head.append(style);
  const script = base.createElement("script");
  script.id = "mk8-classic-tabs-runtime";
  script.textContent = CLASSIC_TAB_RUNTIME;
  base.body.append(script);
  return `<!doctype html>\n${base.documentElement.outerHTML}`;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(probe: () => T | null | undefined | false, timeoutMs: number, what: string): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = probe();
    if (value) { return value; }
    if (Date.now() - started > timeoutMs) { throw new Error(`The classic export did not ${what}`); }
    await wait(100);
  }
}

/** A picture of this site, scaled down to what the old export showed (its own files were small). */
async function scaledPicture(host: Document, src: string, size: number): Promise<Blob | null> {
  const response = await fetch(src, { credentials: "same-origin" });
  if (!response.ok) { return null; }
  const blob = await response.blob();
  if (typeof createImageBitmap !== "function") { return blob; }
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
  const canvas = host.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return await new Promise<Blob | null>((resolve) => { canvas.toBlob((out) => { resolve(out ?? blob); }, "image/webp", 0.9); });
}

/**
 * Builds the classic WordPress file of a published night by running the original export in a
 * hidden frame. Runs in the Director's browser on this site's origin.
 */
export async function buildClassicWordpressReport(host: Document, event: PublicTournamentEvent, groupFilter: ClassicGroups = "__tabs__"): Promise<WordpressReportExport> {
  const base = new URL(host.baseURI);
  const catalogText = await (await fetch(new URL(CLASSIC_CATALOG, base).href)).text();
  const catalog = JSON.parse(catalogText) as ClassicCatalog;
  const css = await (await fetch(new URL(CLASSIC_CSS, base).href)).text();
  const dataset = classicDataset(event, catalog);
  const payload = { ok: true, data: {
    availableTournaments: [{ tournamentId: event.tournamentId, tournamentName: event.report?.title || event.name, tournamentDirector: "" }],
    selection: { scope: event.tournamentId, defaultScope: event.tournamentId, player: "", compareA: "", compareB: "", selectedTournamentCount: 1, hasAvailableTournaments: true },
    dataset,
  } };
  const content = { ok: true, scope: event.tournamentId, group: "__all__", lang: "nl", version: 1, key: "__all__|nl", content: classicContent(event) };
  const assetBase = `${base.origin}/classic-export-assets`;

  const frame = host.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  for (const [name, value] of [["position", "fixed"], ["left", "-12000px"], ["top", "0"], ["width", "1280px"], ["height", "1200px"], ["border", "0"]] as const) {
    frame.style.setProperty(name, value);
  }
  host.body.append(frame);
  try {
    const view = frame.contentWindow as (Window & typeof globalThis & Record<string, unknown>) | null;
    const doc = frame.contentDocument;
    if (view === null || doc === null) { throw new Error("No frame to run the classic export in"); }
    doc.open();
    doc.write(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>MK8DX classic export</title></head><body class="analytics-body analytics-body-classic" data-analytics-view="classic">${CLASSIC_PAGE_BODY}</body></html>`);
    doc.close();
    view["__CLASSIC_EXPORT_TEMPLATE__"] = "";
    view["__CLASSIC_EXPORT_CSS__"] = css;
    view["__CLASSIC_EXPORT_ASSET_BASE__"] = assetBase;
    // A frame without an address of its own: the old page's address-bar bookkeeping has nowhere to go.
    try { view.history.replaceState = () => undefined; view.history.pushState = () => undefined; } catch { /* read-only history */ }
    const json = (value: unknown): Response => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
    const realFetch = fetch.bind(globalThis);
    view.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("tournament_analytics_classic_content.php")) { return json(content); }
      if (url.includes("tournament_analytics.php")) { return json(payload); }
      if (url.includes("game_catalog.json")) { return new Response(catalogText, { headers: { "content-type": "application/json" } }); }
      if (url.startsWith(assetBase) || url.includes("/assets/img/")) {
        const picture = classicPicture(url, catalog);
        const blob = picture === null ? null : await scaledPicture(host, picture.src, picture.size).catch(() => null);
        return blob === null ? new Response("", { status: 404 }) : new Response(blob, { headers: { "content-type": blob.type || "image/webp" } });
      }
      return realFetch(input);
    }) as typeof fetch;
    // The download the old page makes is caught here instead of saved.
    let captured: Blob | null = null;
    view.URL.createObjectURL = (blob: Blob) => { captured = blob; return "about:blank"; };
    view.URL.revokeObjectURL = () => undefined;
    view.HTMLAnchorElement.prototype.click = function click() { /* caught above */ };

    const script = doc.createElement("script");
    script.src = new URL(CLASSIC_SCRIPT, base).href;
    doc.body.append(script);
    await until(() => doc.querySelector("#analyticsMount .mk-tournament, #analyticsMount .mk8-classic-export"), 60_000, "draw the report");
    // The community's exports carry the charts' readouts and their pictures.
    for (const id of ["exportInteractiveCheckbox", "exportEmbedImagesCheckbox"]) {
      const box = doc.getElementById(id) as HTMLInputElement | null;
      if (box !== null && !box.checked) {
        box.checked = true;
        box.dispatchEvent(new view.Event("change", { bubbles: true }));
        box.dispatchEvent(new view.Event("input", { bubbles: true }));
      }
    }
    await wait(500);
    /** The old page's file for one "Groep" choice, made in its own control and caught. */
    const capture = async (choice: Exclude<ClassicGroups, "__tabs__">): Promise<string> => {
      const groups = await until(() => {
        const select = doc.getElementById("groupFilterSelect") as HTMLSelectElement | null;
        return select !== null && [...select.options].some((option) => option.value === choice) ? select : null;
      }, 30_000, "offer that group choice");
      if (groups.value !== choice) {
        groups.value = choice;
        groups.dispatchEvent(new view.Event("change", { bubbles: true }));
        await wait(500);
      }
      captured = null;
      (doc.getElementById("downloadClassicFullBtn") as HTMLButtonElement | null)?.dispatchEvent(new view.MouseEvent("click", { bubbles: true }));
      const blob = await until(() => captured, 120_000, "produce its file");
      return (await blob.text()).replace(/^\uFEFF/, "");
    };
    const raw = groupFilter === "__tabs__"
      ? mergeClassicStages(await capture("__all__"), await capture("__post_only__"), await capture("__qualifier_only__"),
        { final: "Eindgroep", qualifier: "Kwalificatie" })
      : await capture(groupFilter);
    // The current analytics.js leaves its runtime raw; the TN12 post had it packed, which is what
    // survives WordPress saving the post. The card switch is packed the same way.
    const pack = (id: string, source: string): string => source.replace(
      new RegExp(`(<script id="${id}">)([\\s\\S]*?)(<\\/script>)`),
      (whole, open: string, body: string, close: string) => body.startsWith("(function(){try{var _d='") ? whole : `${open}${wordpressSafeScript(body)}${close}`,
    );
    // Short class names only where no script or payload names them (the old runtime looks many up).
    const packed = pack("mk8-classic-tabs-runtime", pack("mk8-classic-export-runtime", shortenClassNames(raw, { renameInScripts: false })));
    // Fewer characters, nothing visible changed; the picture table's script runs before the old
    // runtime (both at the end of the body), so the old runtime finds every picture in place.
    const slim = slimWordpressHtml(packed);
    const text = slim.script === null ? slim.html
      : slim.html.replace(/<script id="mk8-classic-export-runtime">/, `<script id="mk8-classic-pictures">${slim.script}</script><script id="mk8-classic-export-runtime">`);
    // Short source lines for pasting into the WordPress code editor (wordpress-export-format.ts).
    const file = formatWordpressLines(`<!-- wp:html -->\n${text}\n<!-- /wp:html -->\n`);
    return {
      html: file,
      // The choice is in the name: four downloads of one night must not all be "(1)", "(2)", "(3)".
      fileName: wordpressFileName(event.report?.title || event.name)
        .replace(/-wordpress\.html$/, `-wordpress-klassiek-${CLASSIC_FILE_SUFFIX[groupFilter]}.html`),
      bytes: new Blob([file]).size,
      charts: (text.match(/data-chart-points=/g) ?? []).length,
      images: (text.match(/data:image\//g) ?? []).length,
    };
  } finally {
    frame.remove();
  }
}
