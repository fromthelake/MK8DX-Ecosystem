// The WordPress export of a published night report: one self-contained HTML fragment that the
// Director copies in full and pastes into a WordPress "Custom HTML" block, as the community has
// done since the Seating & Standings Manager's classic export (its tournament_analytics report page).
//
// The fragment is the report the community reads on this site, not a second layout: the real
// renderer draws it in a hidden light-appearance frame, and everything that page needs travels
// inside the file - the stylesheet rules it uses, the fonts, every picture as a data URI, and per
// chart the readouts with a small runtime that does what bindReportChart does here (pointer,
// slider, tap to hold, arrow keys) plus the bar that names the section the reader is in.
//
// A WordPress theme brings its own CSS, so the stylesheet is made to win there:
//   - every rule is scoped under the fragment's id, one extra id per cascade layer, so the site's
//     layer order survives being flattened and an id outranks any theme class selector;
//   - elements outside SVG first get `all: revert`, which drops the theme's styling back to the
//     browser's defaults before this site's rules apply;
//   - rem becomes px, because themes set the root font size (Twenty Fifteen: 62.5 %).

import { useDocument } from "./ds-components.js";
import type { PublicTournamentEvent } from "./tournament-operation-client.js";
import { REPORT_CONTEXT_BARS, renderTournamentReport } from "./tournament-night-report-view.js";
import { REPORT_CHART_BINDINGS, type ChartPoint, type ChartReadoutMode } from "./tournament-report-chart.js";
import { tournamentReportStages, type ReportStage } from "./tournament-report.js";
import type { TournamentStory } from "./tournament-stories.js";
import { formatWordpressLines } from "./wordpress-export-format.js";

/** The fragment's file, as the Director downloads it. */
export type WordpressReportExport = Readonly<{
  html: string;
  fileName: string;
  bytes: number;
  charts: number;
  images: number;
}>;

const ROOT_FONT_PX = 16;
/** Pictures are kept at twice the size they are shown, which is sharp on a phone and small. */
const IMAGE_SCALE = 2;
const READOUT_ICON_PX = 48;
/** The width of a WordPress post column (Twenty Fifteen: about 660 px); the layout is settled at it. */
const COLUMN_PX = 680;

// ------------------------------------------------------------------ pure helpers (tested)

/** A selector list split at its top-level commas (not those inside :is(), :not() or [attr]). */
export function splitSelectorList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let index = 0; index < list.length; index += 1) {
    const char = list[index]!;
    if (quote !== null) { if (char === quote && list[index - 1] !== "\\") { quote = null; } continue; }
    if (char === "\"" || char === "'") { quote = char; } else if (char === "(" || char === "[") { depth += 1; } else if (char === ")" || char === "]") { depth -= 1; } else if (char === "," && depth === 0) {
      parts.push(list.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts.filter((part) => part.length > 0);
}

/** rem as px at the site's own root size; a WordPress theme's root size must not shrink the report. */
export function remToPx(css: string): string {
  return css.replace(/(-?\d*\.?\d+)rem\b/g, (_, value: string) => `${Math.round(Number(value) * ROOT_FONT_PX * 1000) / 1000}px`);
}

const ROOT_COMPOUND = /^\s*(?:(?::root|html|body)(?:\[[^\]]*\]|:(?!:)[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?)*\s*(?:>\s*)?)+/;

/**
 * A selector moved under the fragment: what the page applied to the document root or body lands on
 * the fragment itself, everything else becomes a descendant of it. Returns whether the selector
 * addressed the root, so only inheritable typography is carried over from such rules.
 */
export function scopeSelector(selector: string, prefix: string): Readonly<{ selector: string; root: boolean }> {
  const match = ROOT_COMPOUND.exec(selector);
  if (match === null) { return { selector: `${prefix} ${selector.trim()}`, root: false }; }
  const rest = selector.slice(match[0].length).trim();
  return rest.length === 0 ? { selector: prefix, root: true } : { selector: `${prefix} ${rest}`, root: false };
}

/** What a page-root rule may still say on the fragment: tokens and typography, not page layout. */
export function rootDeclarations(cssText: string): string {
  return cssText.split(";").map((part) => part.trim()).filter((part) => {
    const name = part.split(":", 1)[0]?.trim().toLowerCase() ?? "";
    return name.startsWith("--") || /^(color|font|font-[a-z-]+|line-height|letter-spacing|text-[a-z-]+|-webkit-font-smoothing|-moz-osx-font-smoothing|color-scheme|accent-color)$/.test(name);
  }).join(";");
}

/** The selector without what only a pointer or the state of a form can make true, to test it. */
export function staticSelector(selector: string): string {
  return selector
    .replace(/::?(before|after|marker|placeholder|selection|backdrop|first-line|first-letter|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+)(\([^)]*\))?/g, "")
    .replace(/:(hover|focus-visible|focus-within|focus|active|visited|link|any-link|target|checked|indeterminate|disabled|enabled|placeholder-shown|autofill)(?![\w-])/g, "")
    .trim();
}

/** A file name a Director recognises: the night's name, then "wordpress". */
export function wordpressFileName(name: string): string {
  const slug = name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug.length === 0 ? "toernooi" : slug}-wordpress.html`;
}

/**
 * The file as WordPress takes it: one Custom HTML block. The block delimiters must be the very
 * first and last lines (no byte order mark before them), or the block editor treats the paste as
 * ordinary content and takes the markup apart - the community's TN12 export has the same shape.
 * The charset line lets a browser that opens the file read it as UTF-8.
 */
export function wordpressBlock(name: string, parts: readonly string[]): string {
  return [
    "<!-- wp:html -->",
    '<meta charset="utf-8">',
    `<!-- ${name.replace(/--/g, "- -")} · MK8DX WordPress export (mk8dx.example) -->`,
    ...parts,
    "<!-- /wp:html -->",
  ].join(String.fromCharCode(10)) + String.fromCharCode(10);
}

/**
 * A script packed the way the community's TN12 export packed its runtime: one line of base64 that
 * the browser decodes and evaluates. WordPress rewrites characters inside a script when it saves a
 * post (line breaks, `&`, `<`), which broke the raw runtime of the first exports on the community's site;
 * the packed form has none of them and is the one that demonstrably works there. The wrapper is
 * TN12's, character for character.
 */
export function wordpressSafeScript(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return "(function(){try{var _d='" + btoa(binary) + "';var _s='';if(typeof atob==='function'){_s=decodeURIComponent(escape(atob(_d)));}if(_s){(0,eval)(_s);}}catch(_e){if(typeof console!=='undefined'&&console&&typeof console.warn==='function'){console.warn('MK8 export runtime failed',_e);}}})();";
}

const STAGE_PREFIX = "q-";

/** Every id in a copied stage, and every reference to one inside it, with a prefix. */
export function prefixIds(root: Element, prefix: string, references = true): void {
  const elements = [root, ...root.querySelectorAll("*")];
  for (const element of elements) {
    if (element.id) { element.id = `${prefix}${element.id}`; }
    for (const name of ["for", "aria-labelledby", "aria-describedby", "aria-controls"]) {
      const value = element.getAttribute(name);
      if (value) { element.setAttribute(name, value.split(/\s+/).map((part) => `${prefix}${part}`).join(" ")); }
    }
    const href = element.getAttribute("href");
    if (references && href !== null && href.startsWith("#") && href.length > 1) { element.setAttribute("href", `#${prefix}${href.slice(1)}`); }
    if (references && element.tagName === "OPTION" && element.parentElement?.classList.contains("tournament-report__finder")) {
      const value = element.getAttribute("value");
      if (value) { element.setAttribute("value", `${prefix}${value}`); }
    }
  }
}

const PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
const SVG_NUMBER_ATTRIBUTES = /(\s(?:x|y|x1|x2|y1|y2|cx|cy|r|rx|ry|width|height|points|d|transform|stroke-width)=")([^"]*)"/g;

/**
 * The same document in fewer characters, with nothing a reader can see changed: chart coordinates
 * to one decimal (a chart is 860 units wide; 251.94736842105266 and 251.9 draw the same pixel),
 * no whitespace between the elements of a chart, and every picture that appears more than once
 * stored once (its <img> tags point into a table that a packed script fills in).
 * Returns the slimmer markup and that script, to be placed after the markup.
 */
export function slimWordpressHtml(html: string): Readonly<{ html: string; script: string | null }> {
  const round = (value: string): string => value.replace(/-?\d+\.\d{2,}/g, (number) => {
    const rounded = Math.round(Number(number) * 10) / 10;
    return Object.is(rounded, -0) ? "0" : String(rounded);
  });
  let out = html.replace(/<svg[\s\S]*?<\/svg>/g, (svg) =>
    svg.replace(SVG_NUMBER_ATTRIBUTES, (_whole, open: string, value: string) => `${open}${round(value)}"`).replace(/>\s+</g, "><"));
  // Pictures in markup only: scripts and styles are left as they are.
  const counts = new Map<string, number>();
  const outside = out.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "");
  for (const match of outside.matchAll(/<img\b[^>]*?\ssrc="(data:image\/[^"]+)"/g)) {
    counts.set(match[1]!, (counts.get(match[1]!) ?? 0) + 1);
  }
  const table: string[] = [];
  const index = new Map<string, number>();
  for (const [source, count] of counts) {
    if (count > 1 && source.length > PIXEL.length + 40) { index.set(source, table.length); table.push(source); }
  }
  if (table.length === 0) { return { html: out, script: null }; }
  out = out.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<img\b[^>]*>/g, (tag) => {
    if (!tag.startsWith("<img")) { return tag; }
    return tag.replace(/\ssrc="(data:image\/[^"]+)"/, (whole, source: string) => {
      const at = index.get(source);
      return at === undefined ? whole : ` src="${PIXEL}" data-mk8img="${at}"`;
    });
  });
  const script = `(function(){var T=${scriptJson(table)};var l=document.querySelectorAll('img[data-mk8img]');for(var i=0;i<l.length;i++){var k=+l[i].getAttribute('data-mk8img');if(T[k])l[i].setAttribute('src',T[k]);l[i].removeAttribute('data-mk8img');}})();`;
  return { html: out, script: wordpressSafeScript(script) };
}

/**
 * The document with its long class names shortened. A class is renamed in its class attributes and
 * in the CSS selectors; with `renameInScripts` it is renamed in the scripts too (only BEM-style
 * names with "-" or "_", so a Player's name in the data is never touched). A class that appears
 * anywhere else - an attribute value, a chart payload, a script that is not renamed, an attribute
 * selector - keeps its name, so nothing that looks for it by name can miss it.
 */
export function shortenClassNames(html: string, options: Readonly<{ renameInScripts: boolean }>): string {
  const SCRIPT_OR_STYLE = /<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/g;
  const markup = html.replace(SCRIPT_OR_STYLE, "");
  const counts = new Map<string, number>();
  for (const match of markup.matchAll(/\sclass="([^"]*)"/g)) {
    for (const token of match[1]!.split(/\s+/)) { if (token) { counts.set(token, (counts.get(token) ?? 0) + 1); } }
  }
  // Every word that appears outside class attributes and CSS selectors (and outside the scripts
  // that will be renamed too). URL escapes are split so "%22chart-dot%22" yields "chart-dot".
  const elsewhere = new Set<string>();
  const words = (text: string): void => {
    for (const word of text.replace(/%[0-9A-Fa-f]{2}/g, " ").match(/[\w-]+/g) ?? []) { elsewhere.add(word); }
  };
  words(markup.replace(/\sclass="[^"]*"/g, " "));
  for (const block of html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) ?? []) {
    if (!options.renameInScripts) { words(block); continue; }
    // Renamed scripts: their simple words still count, since only BEM-style names are renamed there.
    for (const word of block.match(/[\w-]+/g) ?? []) { if (!/[-_]/.test(word)) { elsewhere.add(word); } }
  }
  const attributeSelectors = [...html.matchAll(/\[class[*^$|~]?="([^"]+)"\]/g)].map((match) => match[1]!);
  const taken = new Set<string>([...counts.keys(), ...elsewhere]);
  for (const block of html.match(/<style\b[^>]*>[\s\S]*?<\/style>/g) ?? []) {
    for (const word of block.match(/[\w-]+/g) ?? []) { taken.add(word); }
  }
  const candidates = [...counts.entries()]
    .filter(([token]) => !elsewhere.has(token) && token.length > 3 && !attributeSelectors.some((part) => token.includes(part)))
    .filter(([token]) => !options.renameInScripts || /[-_]/.test(token) || !html.includes(token))
    .sort((a, b) => b[1] * b[0].length - a[1] * a[0].length);
  const rename = new Map<string, string>();
  let next = 0;
  for (const [token] of candidates) {
    let short: string;
    do { short = `m${(next++).toString(36)}`; } while (taken.has(short));
    if (short.length >= token.length) { continue; }
    rename.set(token, short);
  }
  if (rename.size === 0) { return html; }
  const swap = (word: string): string => rename.get(word) ?? word;
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|\sclass="[^"]*"/g, (part) => {
    if (part.startsWith("<style")) { return part.replace(/\.(-?[_a-zA-Z][\w-]*)/g, (whole, name: string) => rename.has(name) ? `.${swap(name)}` : whole); }
    if (part.startsWith("<script")) {
      if (!options.renameInScripts) { return part; }
      return part.replace(/[\w-]+/g, (word) => /[-_]/.test(word) ? swap(word) : word);
    }
    return part.replace(/[^\s"=]+/g, (word) => word === "class" ? word : swap(word));
  });
}

/** JSON that can sit inside a <script> element whatever it contains. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(new RegExp(String.fromCharCode(0x2028), "g"), "\\u2028")
    .replace(new RegExp(String.fromCharCode(0x2029), "g"), "\\u2029");
}

// ------------------------------------------------------------------ the readouts, compact

/**
 * A readout point as numbers: every string is an index into one string table and every picture an
 * index into one picture table, so the 6,000 readouts of a night cost a few megabytes less than the
 * markup they become. [race, label, mode, values]; a value is
 * [label, colour, display, lines, icons, pictures-per-line, pack|0], a picture [image, alt].
 */
export type EncodedPicture = readonly [number, number];
export type EncodedValue = readonly [number, number, number, readonly number[], readonly EncodedPicture[], readonly (readonly EncodedPicture[])[], readonly [number, number, number, number, number] | 0];
export type EncodedPoint = readonly [number, number, number, readonly EncodedValue[]];

const MODES: readonly ChartReadoutMode[] = ["place-track", "benchmark", "delta", "compact"];

export function encodeReadoutPoint(
  point: ChartPoint,
  text: (value: string) => number,
  picture: (source: string) => number,
): EncodedPoint {
  const pictures = (list: readonly Readonly<{ src: string; alt: string }>[] | undefined): EncodedPicture[] =>
    (list ?? []).map((icon) => [picture(icon.src), text(icon.alt)] as const);
  return [text(point.head.race), text(point.head.label), MODES.indexOf(point.mode), point.values.map((value): EncodedValue => [
    text(value.label), text(value.color), text(value.display),
    (value.lines ?? []).map(text),
    pictures(value.icons),
    (value.pictures ?? []).map((list) => pictures(list)),
    value.pack === undefined ? 0 : [text(value.pack.displayName), value.pack.benchmarkTotal, value.pack.playerTotal, value.pack.delta, text(value.pack.unit)],
  ])];
}

/**
 * readoutHtml (tournament-report-chart.ts) in plain ES5, reading an encoded point. A unit test
 * holds the two to the same markup for every mode; change one and change the other.
 */
export const WORDPRESS_READOUT_JS = `function mk8Readout(D,p,resting,empty){
function esc(v){return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function S(i){return D.s[i];}
function key(c){return '<svg class="tournament-report__readout-key" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="5" fill="'+esc(c)+'"/></svg>';}
function pic(list){var o='';if(!list)return o;for(var i=0;i<list.length;i++){o+='<img class="tournament-report__readout-icon" src="'+esc(D.img[list[i][0]]||'')+'" alt="" title="'+esc(S(list[i][1]))+'" aria-hidden="true" loading="lazy" decoding="async">';}return o;}
function row(v){var lines=[];for(var i=0;i<v[3].length;i++){var line=S(v[3][i]);if(line.replace(/^\\s+|\\s+$/g,'').length>0)lines.push([line,v[5][i]]);}
var o='<tr><th scope="row">'+key(S(v[1]))+esc(S(v[0]))+'</th><td>'+esc(S(v[2]));
if(lines.length){o+='<span class="tournament-report__readout-lines">';for(var j=0;j<lines.length;j++)o+='<span class="tournament-report__readout-line">'+pic(lines[j][1])+esc(lines[j][0])+'</span>';o+='</span>';}
return o+'</td></tr>';}
var race=S(p[0]),label=S(p[1]),mode=p[2],values=p[3];
var head='<p class="tournament-report__readout-head'+(resting?' tournament-report__readout-head--resting':'')+'"><strong>'+esc(race)+'</strong>'+(label.length===0?'':'<span>'+esc(label)+'</span>')+'</p>';
if(values.length===0)return head+'<table class="tournament-report__readout-table"><tbody><tr><td class="tournament-report__readout-empty" colspan="2">'+esc(empty)+'</td></tr></tbody></table>';
var rows='',i,v;
for(i=0;i<values.length;i++){v=values[i];
if(mode===0){var kept=[];for(var k=0;k<v[3].length;k++){var l=S(v[3][k]);if(l.replace(/^\\s+|\\s+$/g,'').length>0)kept.push(l);}
rows+='<tr><td class="tournament-report__readout-place">'+esc(S(v[2]))+'</td><td class="tournament-report__readout-track"><span class="tournament-report__readout-line">'+pic(v[4])+esc(kept.length?kept[0]:'-')+'</span>';
for(var e=1;e<kept.length;e++)rows+='<span class="tournament-report__readout-extra">'+esc(kept[e])+'</span>';rows+='</td></tr>';}
else if(mode===1&&v[6]){var pk=v[6];var name=S(pk[0]);
rows+='<tr><th scope="row">'+key(S(v[1]))+esc(S(v[0]))+'</th><td><span class="tournament-report__benchmark"><span class="tournament-report__benchmark-delta">'+esc((pk[3]>0?'+':'')+pk[3])+'</span><span class="tournament-report__benchmark-unit">'+esc(S(pk[4]))+'</span><span class="tournament-report__benchmark-name">'+esc(name.length===0?'-':name)+'</span><span class="tournament-report__benchmark-score">'+pk[2]+'</span><span class="tournament-report__benchmark-vs">vs</span><span class="tournament-report__benchmark-score">'+pk[1]+'</span></span></td></tr>';}
else rows+=row(v);}
var variant=mode===0?' tournament-report__readout-table--place':mode===1?' tournament-report__readout-table--benchmark':mode===2?' tournament-report__readout-table--delta':' tournament-report__readout-table--compact';
return head+'<table class="tournament-report__readout-table'+variant+'"><tbody>'+rows+'</tbody></table>';}`;

// ------------------------------------------------------------------ the runtime the fragment carries

/**
 * Plain ES5 so any browser a WordPress reader has runs it. It is the behaviour of bindReportChart
 * and the report's context bar, reading the readouts the export wrote instead of a live model.
 */
export const WORDPRESS_RUNTIME = `(function(){
${WORDPRESS_READOUT_JS}
var D=window.__MK8_REPORT_DATA__&&window.__MK8_REPORT_DATA__[ID];var root=document.getElementById(ID);
if(!D||!root||root.getAttribute('data-mk8-bound'))return;root.setAttribute('data-mk8-bound','1');
function pics(scope){var list=scope.querySelectorAll('img[data-mk8i]');for(var i=0;i<list.length;i++){var k=+list[i].getAttribute('data-mk8i');if(D.img[k])list[i].setAttribute('src',D.img[k]);list[i].removeAttribute('data-mk8i');}}
function toggle(el,name,on){if(el.classList){if(on)el.classList.add(name);else el.classList.remove(name);}}
function bind(shell){var c=D.charts[+shell.getAttribute('data-mk8-chart')];var fig=shell.parentNode;if(!c||!fig)return;
var readout=fig.querySelector('.tournament-report__readout');var svg=shell.querySelector('svg');if(!svg||!readout)return;
var guide=svg.querySelector('.tournament-report__guide');var dots=svg.querySelectorAll('.tournament-report__dot, .tournament-report__bar, .tournament-report__podium');
var scrub=fig.querySelector('.tournament-report__scrubber');var active=-1,locked=-1,last=c.p.length-1;
function paint(i,resting){if(i<0||i>last)return;active=resting?-1:i;
if(guide){if(resting)guide.setAttribute('hidden','');else{guide.setAttribute('x1',c.x[i]);guide.setAttribute('x2',c.x[i]);guide.removeAttribute('hidden');}}
for(var j=0;j<dots.length;j++)toggle(dots[j],'is-active',!resting&&+dots[j].getAttribute('data-index')===i);
readout.innerHTML=mk8Readout(D,c.p[i],resting,D.s[c.e]);if(scrub)scrub.value=String(i);}
function rest(){paint(c.ri,true);}
function nearest(x){var r=svg.getBoundingClientRect();if(!r.width)return 0;var v=(x-r.left)/r.width*c.w,best=0,d=1e9;for(var j=0;j<c.x.length;j++){var o=Math.abs(c.x[j]-v);if(o<d){d=o;best=j;}}return best;}
if(scrub){var step=function(e){locked=-1;paint(Math.max(0,Math.min(last,+e.target.value)));};scrub.addEventListener('input',step);scrub.addEventListener('change',step);}
shell.addEventListener('pointermove',function(e){if(locked<0)paint(nearest(e.clientX));});
shell.addEventListener('pointerdown',function(e){var i=nearest(e.clientX);if(e.pointerType!=='touch'&&e.pointerType!=='pen'){paint(i);return;}if(locked===i){locked=-1;rest();return;}locked=i;paint(i);});
shell.addEventListener('pointerleave',function(){if(locked<0)rest();});
shell.addEventListener('keydown',function(e){var s=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;if(!s)return;e.preventDefault();locked=-1;paint(Math.min(last,Math.max(0,(active<0?c.ri:active)+s)));});
rest();}
var shells=root.querySelectorAll('[data-mk8-chart]');for(var i=0;i<shells.length;i++)bind(shells[i]);
function stages(){return root.querySelectorAll('[data-mk8-stage]');}
function active(){var w=stages();for(var i=0;i<w.length;i++){if(!w[i].hasAttribute('hidden'))return w[i];}return root;}
var shown=-1,tops=null,waiting=false;
function show(stage,anchor){var w=stages();if(!w.length)return;for(var i=0;i<w.length;i++){if(w[i].getAttribute('data-mk8-stage')===stage)w[i].removeAttribute('hidden');else w[i].setAttribute('hidden','');}
var b=root.querySelectorAll('.tournament-report__stages button[data-stage]');for(var j=0;j<b.length;j++)b[j].setAttribute('aria-pressed',b[j].getAttribute('data-stage')===stage?'true':'false');
tops=null;shown=-1;offsets();update();if(anchor){var t=document.getElementById(anchor);if(t&&t.scrollIntoView)t.scrollIntoView({block:'start'});}}
root.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a[href^="#"]'):null;
if(a&&root.contains(a)){var id=a.getAttribute('href').slice(1);var t=document.getElementById(id);if(t&&t.offsetParent===null){var alt=document.getElementById(id.indexOf(D.stagePrefix)===0?id.slice(D.stagePrefix.length):D.stagePrefix+id);if(alt&&alt.offsetParent!==null){e.preventDefault();alt.scrollIntoView({block:'start'});}}return;}
var b=e.target&&e.target.closest?e.target.closest('button[data-stage]'):null;if(!b||!root.contains(b))return;e.preventDefault();
if(b.classList&&b.classList.contains('tournament-report__stage--player')){if(b.getAttribute('aria-pressed')==='true')return;var sec=b.closest('[data-mk8-pair]');var other=sec&&document.getElementById(sec.getAttribute('data-mk8-pair'));if(!other)return;
var before=sec.getBoundingClientRect().top;
if(sec.getAttribute('data-mk8-visiting')){other.removeAttribute('hidden');goHome(sec);}else{visit(other,sec);}
window.scrollBy(0,(sec.getAttribute('data-mk8-visiting')?sec:other).getBoundingClientRect().top-before);tops=null;shown=-1;update();return;}
homeAll();show(b.getAttribute('data-stage'),null);});
function visit(guest,host){var mark=document.createElement('i');mark.setAttribute('hidden','');mark.setAttribute('data-mk8-home',guest.id);guest.parentNode.insertBefore(mark,guest);
host.parentNode.insertBefore(guest,host.nextSibling);host.setAttribute('hidden','');guest.setAttribute('data-mk8-visiting','1');}
function goHome(guest){var marks=root.querySelectorAll('[data-mk8-home]');for(var i=0;i<marks.length;i++){if(marks[i].getAttribute('data-mk8-home')===guest.id){marks[i].parentNode.insertBefore(guest,marks[i]);marks[i].parentNode.removeChild(marks[i]);break;}}guest.removeAttribute('data-mk8-visiting');}
function homeAll(){var v=root.querySelectorAll('[data-mk8-visiting]');for(var i=0;i<v.length;i++){var host=document.getElementById(v[i].getAttribute('data-mk8-pair'));if(host)host.removeAttribute('hidden');goHome(v[i]);}}
var finders=root.querySelectorAll('.tournament-report__finder');
for(var f=0;f<finders.length;f++)finders[f].addEventListener('change',function(e){var s=e.target;if(s.value){var t=document.getElementById(s.value);if(t&&t.scrollIntoView)t.scrollIntoView({block:'start'});else location.hash=s.value;s.value='';}});
function bar(){var a=active();var box=a.querySelector('.tournament-report__context');return{box:box,where:box&&box.querySelector('.ds-index__where'),items:a.querySelectorAll('[data-mk8-ctx]'),paper:a.querySelector('.tournament-report')};}
function offsets(){var c=bar();if(!c.paper||!c.box||!c.paper.style||!c.paper.style.setProperty)return;var adminBar=document.getElementById('wpadminbar');var top=adminBar&&adminBar.getBoundingClientRect?Math.max(0,adminBar.getBoundingClientRect().height):0;c.paper.style.setProperty('--report-context-top',top+'px');c.paper.style.setProperty('--report-context-offset',(Math.ceil(c.box.getBoundingClientRect().height)+12)+'px');}
function update(){waiting=false;var c=bar();if(!c.where||!c.items.length)return;var off=window.pageYOffset||0;
if(!tops){tops=[];for(var j=0;j<c.items.length;j++)tops.push(c.items[j].offsetParent===null?null:c.items[j].getBoundingClientRect().top+off);}
var probe=off+c.box.getBoundingClientRect().height+26;var cur=-1;for(var k=c.items.length-1;k>=0;k--){if(tops[k]!==null&&tops[k]<=probe){cur=k;break;}}
if(cur<0){for(var m=0;m<c.items.length;m++){if(tops[m]!==null){cur=m;break;}}}if(cur<0)return;
var n=+c.items[cur].getAttribute('data-mk8-ctx');if(n!==shown){shown=n;c.where.innerHTML=D.s[D.ctx[n]];pics(c.where);offsets();}}
var later=window.requestAnimationFrame||function(fn){return setTimeout(fn,60);};
window.addEventListener('scroll',function(){if(!waiting){waiting=true;later(update);}},{passive:true});
window.addEventListener('resize',function(){tops=null;offsets();update();});
window.addEventListener('load',function(){tops=null;update();});
offsets();update();
pics(root);
})();`;

// ------------------------------------------------------------------ the builder (real browser only)

type Bound = Readonly<{ x: readonly number[]; w: number; p: readonly EncodedPoint[]; ri: number; e: number }>;

/** A string table: repeated readouts and bar lines travel once. */
class Strings {
  readonly list: string[] = [];
  private readonly seen = new Map<string, number>();
  add(value: string): number {
    const known = this.seen.get(value);
    if (known !== undefined) { return known; }
    this.list.push(value);
    this.seen.set(value, this.list.length - 1);
    return this.list.length - 1;
  }
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { resolve(String(reader.result)); };
    reader.onerror = () => { reject(reader.error ?? new Error("read failed")); };
    reader.readAsDataURL(blob);
  });
}

/** One picture as a data URI, never larger than it needs to be to stay sharp where it is shown. */
class Pictures {
  private readonly cache = new Map<string, Promise<string | null>>();
  constructor(private readonly host: Document) {}

  get(source: string, width: number, height: number): Promise<string | null> {
    const key = `${source}|${width}x${height}`;
    let pending = this.cache.get(key);
    if (pending === undefined) {
      pending = this.load(source, width, height).catch(() => null);
      this.cache.set(key, pending);
    }
    return pending;
  }

  private async load(source: string, width: number, height: number): Promise<string | null> {
    if (source.startsWith("data:")) { return source; }
    const response = await fetch(source, { credentials: "same-origin" });
    if (!response.ok) { return null; }
    const blob = await response.blob();
    if (blob.type.includes("svg") || typeof createImageBitmap !== "function") { return blobDataUrl(blob); }
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, width / bitmap.width, height / bitmap.height);
    if (scale >= 1 && blob.size < 24_000) { bitmap.close(); return blobDataUrl(blob); }
    const canvas = this.host.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (context === null) { bitmap.close(); return blobDataUrl(blob); }
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const webp = canvas.toDataURL("image/webp", 0.9);
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
  }
}

async function stylesheetsReady(frame: Document, expected: number, timeoutMs = 20_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    const sheets = [...frame.styleSheets];
    const loaded = sheets.filter((sheet) => { try { return sheet.cssRules.length >= 0; } catch { return false; } });
    if (loaded.length >= expected) { return; }
    if (Date.now() - started > timeoutMs) { throw new Error("The report's stylesheets did not load"); }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

type CssOutput = { rules: string[]; fonts: Map<string, string>; keyframes: string[] };

/** The stylesheet rules the drawn report uses, scoped under the fragment. */
function collectCss(frame: Document, id: string): CssOutput {
  const layerNames: string[] = [];
  const output: CssOutput = { rules: [], fonts: new Map(), keyframes: [] };
  const relevant = (selector: string): boolean => {
    const test = staticSelector(selector);
    if (test.length === 0) { return false; }
    try { return frame.querySelector(test) !== null; } catch { return true; }
  };
  // One extra id per layer keeps the layer order once the layers are gone: an id outweighs any
  // number of classes, and unlayered rules (which beat every layer) get the most.
  const prefixFor = (layer: number): string => `#${id}`.repeat(layer + 2);
  const layerIndex = (name: string): number => {
    let index = layerNames.indexOf(name);
    if (index < 0) { layerNames.push(name); index = layerNames.length - 1; }
    return index;
  };
  const walk = (rules: CSSRuleList, layer: number | null, into: string[]): void => {
    for (const rule of [...rules]) {
      const kind = rule.constructor.name;
      if (kind === "CSSLayerStatementRule") {
        for (const name of (rule as CSSLayerStatementRule).nameList) { layerIndex(name); }
      } else if (kind === "CSSLayerBlockRule") {
        walk((rule as CSSLayerBlockRule).cssRules, layerIndex((rule as CSSLayerBlockRule).name), into);
      } else if (kind === "CSSMediaRule" && /width/.test((rule as CSSMediaRule).conditionText)) {
        // A WordPress post is a column inside a wide window, so a breakpoint on the window would
        // give the column the desktop layout. Width queries are settled here, at the column's width.
        if (frame.defaultView?.matchMedia((rule as CSSMediaRule).conditionText).matches === true) {
          walk((rule as CSSMediaRule).cssRules, layer, into);
        }
      } else if (kind === "CSSMediaRule" || kind === "CSSSupportsRule") {
        const inner: string[] = [];
        walk((rule as CSSGroupingRule).cssRules, layer, inner);
        if (inner.length > 0) {
          const condition = (rule as CSSConditionRule).conditionText;
          into.push(`${kind === "CSSMediaRule" ? "@media" : "@supports"} ${condition}{${inner.join("")}}`);
        }
      } else if (kind === "CSSFontFaceRule") {
        const face = rule as CSSFontFaceRule;
        output.fonts.set(face.cssText, face.parentStyleSheet?.href ?? frame.baseURI);
      } else if (kind === "CSSKeyframesRule") {
        output.keyframes.push(rule.cssText);
      } else if (kind === "CSSStyleRule") {
        const style = rule as CSSStyleRule;
        // Layers are numbered as they are declared; unlayered rules come after all of them.
        const prefix = prefixFor(layer === null ? 16 : layer);
        const scoped = splitSelectorList(style.selectorText).filter(relevant).map((selector) => scopeSelector(selector, prefix));
        if (scoped.length === 0) { continue; }
        const own = scoped.filter((entry) => !entry.root).map((entry) => entry.selector);
        const roots = scoped.filter((entry) => entry.root).map((entry) => entry.selector);
        const declarations = remToPx(style.style.cssText);
        if (own.length > 0 && declarations.length > 0) { into.push(`${own.join(",")}{${declarations}}`); }
        const rootOnly = rootDeclarations(declarations);
        if (roots.length > 0 && rootOnly.length > 0) { into.push(`${[...new Set(roots)].join(",")}{${rootOnly}}`); }
      }
    }
  };
  for (const sheet of [...frame.styleSheets]) {
    try { walk(sheet.cssRules, null, output.rules); } catch { /* a sheet that refuses reading has nothing of ours */ }
  }
  return output;
}

async function embedCssUrls(css: string, base: string, pictures: Pictures): Promise<string> {
  const found = [...css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)].map((match) => match[2]!).filter((url) => !url.startsWith("data:"));
  const replacements = new Map<string, string>();
  for (const url of new Set(found)) {
    const absolute = new URL(url, base).href;
    const data = /\.(woff2?|ttf|otf)(\?|$)/.test(absolute)
      ? await fetch(absolute).then((response) => response.ok ? response.blob() : null).then((blob) => blob === null ? null : blobDataUrl(blob)).catch(() => null)
      : await pictures.get(absolute, 4096, 4096);
    if (data !== null) { replacements.set(url, data); }
  }
  return css.replace(/url\((['"]?)([^'")]+)\1\)/g, (whole, _quote: string, url: string) => {
    const data = replacements.get(url);
    return data === undefined ? whole : `url("${data}")`;
  });
}

/**
 * Builds the WordPress fragment of a published report. Runs in the Director's own browser, on this
 * site's origin: it needs the site's stylesheets, pictures and fonts, and a real layout to measure.
 */
export async function buildWordpressReport(
  host: Document,
  event: PublicTournamentEvent,
  story: TournamentStory | null,
): Promise<WordpressReportExport> {
  const id = `mk8-report-${wordpressFileName(event.name).replace(/-wordpress\.html$/, "")}`;
  const frame = host.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  // Properties, never a style attribute: the hosted pages refuse inline style.
  for (const [name, value] of [["position", "fixed"], ["left", "-12000px"], ["top", "0"], ["width", `${COLUMN_PX}px`], ["height", "1200px"], ["border", "0"]] as const) {
    frame.style.setProperty(name, value);
  }
  host.body.append(frame);
  try {
    const doc = frame.contentDocument;
    if (doc === null) { throw new Error("No frame to draw the report in"); }
    const links = [...host.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map((link) => link.href);
    doc.open();
    doc.write(`<!doctype html><html lang="${host.documentElement.lang || "nl"}" data-appearance-choice="light"><head><meta charset="utf-8"></head><body></body></html>`);
    doc.close();
    for (const href of links) {
      const link = doc.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      doc.head.append(link);
    }
    await stylesheetsReady(doc, links.length);
    await doc.fonts?.ready;

    // Every stage the night raced, finals first, each with the site's own switch between them;
    // the file shows the finals and the reader switches, as on the site.
    const stages: readonly ReportStage[] = tournamentReportStages(event).length > 0 ? tournamentReportStages(event) : ["final"];
    const papers: { stage: ReportStage; paper: HTMLElement }[] = [];
    try {
      for (const stage of stages) {
        const drawn = renderTournamentReport(doc, event, story, {
          standalone: true, followFragment: false, stage,
          ...(stages.length > 1 ? { onStage: () => undefined } : {}),
        });
        if (drawn[0] === undefined) { continue; }
        doc.body.append(drawn[0]);
        // Every Player's charts now, not when their section scrolls into view.
        for (const element of [...drawn[0].querySelectorAll<HTMLElement & { drawCharts?: () => void }>("*")]) { element.drawCharts?.(); }
        papers.push({ stage, paper: drawn[0] });
      }
    } finally {
      useDocument(host);
    }
    if (papers.length === 0) { throw new Error("This night has no report to export"); }
    await new Promise((resolve) => setTimeout(resolve, 50));

    const pictures = new Pictures(host);
    const strings = new Strings();
    const images: string[] = [];
    const imageIndex = new Map<string, number>();
    const readoutPicture = async (source: string): Promise<number | null> => {
      const absolute = new URL(source, host.baseURI).href;
      const known = imageIndex.get(absolute);
      if (known !== undefined) { return known; }
      const data = await pictures.get(absolute, READOUT_ICON_PX, READOUT_ICON_PX);
      if (data === null) { return null; }
      images.push(data);
      imageIndex.set(absolute, images.length - 1);
      return images.length - 1;
    };
    /** Readout pictures become table references: one track picture is shown in hundreds of readouts. */
    const withPictureRefs = async (html: string): Promise<string> => {
      const sources = [...html.matchAll(/<img([^>]*?) src="([^"]+)"/g)].map((match) => match[2]!);
      const refs = new Map<string, number | null>();
      for (const source of new Set(sources)) { refs.set(source, await readoutPicture(source.replace(/&amp;/g, "&"))); }
      return html.replace(/<img([^>]*?) src="([^"]+)"/g, (whole, attributes: string, source: string) => {
        const ref = refs.get(source);
        return ref === null || ref === undefined ? whole : `<img${attributes} data-mk8i="${ref}" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="`;
      });
    };

    const contextLines: number[] = [];
    const charts: Bound[] = [];
    const css = collectCss(doc, id);
    // The copies live in a document without a window, so the data URIs written into them load
    // nothing (the hosted page's image policy would refuse every one and say so in the console).
    const inert = host.implementation.createHTMLDocument("");
    const stageHtml: string[] = [];
    const clones: { stage: ReportStage; clone: Element }[] = [];
    let pictureCount = 0;
    for (const [position, { stage, paper }] of papers.entries()) {
      // The bar's line for every section, said by the report's own bar.
      const context = REPORT_CONTEXT_BARS.get(paper);
      if (context !== undefined) {
        const where = context.bar.querySelector(".ds-index__where");
        for (let index = 0; index < context.sections.length; index += 1) {
          context.show(index);
          context.sections[index]!.setAttribute("data-mk8-ctx", String(contextLines.length));
          contextLines.push(strings.add(await withPictureRefs(where?.innerHTML ?? "")));
        }
        context.show(0);
      }
      // Every chart's readouts, in the order the shells appear.
      for (const shell of [...paper.querySelectorAll<HTMLElement>(".tournament-report__chart-shell")]) {
        const binding = REPORT_CHART_BINDINGS.get(shell);
        if (binding === undefined || binding.points.length === 0) { continue; }
        const restIndex = binding.layout === "bar"
          ? binding.points.reduce((best, point, current) => (point.values[0]?.value ?? 0) > (binding.points[best]?.values[0]?.value ?? 0) ? current : best, 0)
          : binding.points.length - 1;
        // Pictures first (they are fetched), then the points can be encoded synchronously.
        for (const point of binding.points) {
          for (const value of point.values) {
            for (const icon of [...(value.icons ?? []), ...(value.pictures ?? []).flat()]) { await readoutPicture(icon.src); }
          }
        }
        const encoded = binding.points.map((point) => encodeReadoutPoint(point, (value) => strings.add(value),
          (source) => imageIndex.get(new URL(source, host.baseURI).href) ?? -1));
        shell.setAttribute("data-mk8-chart", String(charts.length));
        charts.push({ x: binding.positions.map((x) => Math.round(x * 10) / 10), w: binding.width, p: encoded, ri: restIndex, e: strings.add(binding.emptyLabel) });
      }
      // The page itself, with its pictures inside it.
      const sizes = [...paper.querySelectorAll("img")].map((image) => {
        const box = image.getBoundingClientRect();
        return { src: image.currentSrc || image.src, width: Math.ceil((box.width || 128) * IMAGE_SCALE), height: Math.ceil((box.height || 128) * IMAGE_SCALE) };
      });
      const clone = inert.importNode(paper, true);
      const cloneImages = [...clone.querySelectorAll("img")];
      pictureCount += cloneImages.length;
      for (let index = 0; index < cloneImages.length; index += 1) {
        const image = cloneImages[index]!;
        const size = sizes[index];
        image.removeAttribute("srcset");
        image.removeAttribute("loading");
        if (size === undefined || size.src.length === 0) { continue; }
        const data = await pictures.get(size.src, size.width, size.height);
        if (data !== null) { image.setAttribute("src", data); }
      }
      for (const link of [...clone.querySelectorAll<HTMLAnchorElement>("a[href]")]) {
        const href = link.getAttribute("href") ?? "";
        if (!href.startsWith("#")) { link.setAttribute("href", new URL(href, host.baseURI).href); }
      }
      // Both stages carry a section per Player: the second one's ids get a prefix so every link,
      // the Player finder and the switch land in the stage they belong to.
      if (position > 0) { prefixIds(clone, STAGE_PREFIX); }
      clones.push({ stage, clone });
    }
    // A Player's own switch swaps their section in place, as on the site: the runtime moves the
    // other stage's section to this spot and home again, so every section is in the file once.
    if (clones.length === 2) {
      const [first, second] = [clones[0]!.clone, clones[1]!.clone];
      for (const section of [...first.querySelectorAll<HTMLElement>("[id^='speler-']")]) {
        const partner = second.querySelector<HTMLElement>(`[id='${STAGE_PREFIX}${section.id}']`);
        if (partner !== null && section.querySelector(".tournament-report__stage--player") !== null) {
          section.setAttribute("data-mk8-pair", partner.id);
          partner.setAttribute("data-mk8-pair", section.id);
        }
      }
    }
    for (const [position, { stage, clone }] of clones.entries()) {
      stageHtml.push(`<div data-mk8-stage="${stage}"${position === 0 ? "" : " hidden"}>${clone.outerHTML}</div>`);
    }

    let stylesheet = [
      // Fonts first, then the theme's styling dropped to the browser's own, then the site's rules.
      ...[...css.fonts.keys()],
      `#${id}{display:block;width:100%;max-width:100%;margin:0 auto;padding:0;font-size:${ROOT_FONT_PX}px;line-height:1.5;text-align:left}`,
      `#${id} :where(:not(svg, svg *)),#${id} :where(:not(svg, svg *))::before,#${id} :where(:not(svg, svg *))::after{all:revert}`,
      `#${id} :where(img){max-width:100%}`,
      ...css.keyframes,
      ...css.rules,
      `${`#${id}`.repeat(20)}{font-size:${ROOT_FONT_PX}px}`,
      // A post column is narrow: the group tables go one below the other, as in the classic export.
      `${`#${id}`.repeat(20)} .tournament-report__standings-grid{grid-template-columns:1fr}`,
      `${`#${id}`.repeat(20)} [data-mk8-stage][hidden],${`#${id}`.repeat(20)} [data-mk8-pair][hidden]{display:none}`,
    ].join("\n");
    // Font files resolve against their own stylesheet; everything else against the page.
    const fontBase = [...css.fonts.values()][0] ?? host.baseURI;
    stylesheet = await embedCssUrls(stylesheet, fontBase, pictures);

    const data = { img: images, s: strings.list, charts, ctx: contextLines, stagePrefix: STAGE_PREFIX };
    const runtimeSource = `window.__MK8_REPORT_DATA__=window.__MK8_REPORT_DATA__||{};window.__MK8_REPORT_DATA__[${scriptJson(id)}]=${scriptJson(data)};`
      + WORDPRESS_RUNTIME.replace(/\bID\b/g, scriptJson(id));
    // Short class names everywhere at once (markup, stylesheet, runtime and its data), then the
    // slimmer charts and pictures, then the runtime packed for WordPress.
    const short = shortenClassNames([
      `<style id="${id}-css">\n${stylesheet}\n</style>`,
      `<div id="${id}" class="mk8-wp-export">${stageHtml.join("")}</div>`,
      `<script id="${id}-runtime">${runtimeSource}</script>`,
    ].join("\n"), { renameInScripts: true });
    const slim = slimWordpressHtml(short);
    const packedBody = slim.html.replace(/(<script id="[^"]*-runtime">)([\s\S]*?)(<\/script>)/,
      (_whole, open: string, body: string, close: string) => `${open}${wordpressSafeScript(body)}${close}`);
    // Short source lines for pasting into the WordPress code editor (wordpress-export-format.ts).
    const file = formatWordpressLines(wordpressBlock(event.name, [
      packedBody,
      ...(slim.script === null ? [] : [`<script id="${id}-pictures">${slim.script}</script>`]),
    ]));
    return {
      html: file,
      fileName: wordpressFileName(event.name),
      bytes: new Blob([file]).size,
      charts: charts.length,
      images: pictureCount + images.length,
    };
  } finally {
    frame.remove();
  }
}
