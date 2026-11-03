"use strict";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let progress = null;
let selectedMode = 150;
let historyUrl = "http://127.0.0.1:8777/";
let language = "en";
let SITE_ORIGIN = "https://example.invalid";
let availableUpdate = null;
let rankTab = "total";
let selectedRankScopes = new Set(["global"]);
let rankScopesInitialized = false;
let rankScopePlayerId = null;
let selectedRankPlayerIds = [];
let rankSelectionPlayerId = null;
let rankViewPlayerId = null;
let rankScrollY = 0;
let rankScrollNeedsRestore = false;
let rankScrollSaveTimer = null;
let rankComparisonTracks = [];
const rankPlayerNames = new Map();
const rankReferenceNames = new Map([
  ["reference.nintendo_staff", "Nintendo Ghost"],
  ["reference.world_record", "World Record"],
]);
let rankSearchController = null;
let buildCatalog = null;
let buildVariants = {characters:[],bodies:[],gliders:[],themes:{}};
let buildSelection = {};
let buildPickerCategory = null;

const siteCopy = value => value.replaceAll("example.invalid", new URL(SITE_ORIGIN).host);
// The game's 15 localisations (livetrial_languages.py, the website and the Android app use the same codes).
// English and Dutch live in the code; the other 13 read the shared catalogs from /i18n/<code>.json: English is the
// key, looked up exactly, then against message templates ({0}, {1} where the code inserts a value), else game
// names from Clean Assets.
const DASHBOARD_LANGUAGES = [
  ["en", "English (UK)"], ["nl", "Nederlands"], ["en-US", "English (US)"], ["fr", "Français"], ["fr-CA", "Français (Canada)"],
  ["de", "Deutsch"], ["es", "Español (España)"], ["es-419", "Español (Latinoamérica)"], ["it", "Italiano"], ["pt", "Português"],
  ["ru", "Русский"], ["ja", "日本語"], ["ko", "한국어"], ["zh-CN", "简体中文"], ["zh-TW", "繁體中文"],
];
const DASHBOARD_LOCALES = {en:"en-GB", nl:"nl-NL", "en-US":"en-US", fr:"fr-FR", "fr-CA":"fr-CA", de:"de-DE", es:"es-ES", "es-419":"es-419", it:"it-IT", pt:"pt-PT", ru:"ru-RU", ja:"ja-JP", ko:"ko-KR", "zh-CN":"zh-CN", "zh-TW":"zh-TW"};
let catalog = null;
const usesCatalog = () => language !== "en" && language !== "nl";
const translatesPage = () => language === "nl" || usesCatalog();
const localeTag = () => DASHBOARD_LOCALES[language] || "en-GB";
function compileCatalog(document) {
  const exact = new Map(), templates = [];
  for (const [source, translation] of Object.entries(document.messages || {})) {
    if (typeof translation !== "string" || !translation) continue;
    const count = (source.match(/\{\d+\}/g) || []).length;
    if (count === 0) { exact.set(source, translation); continue; }
    const literals = source.split(/\{\d+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    templates.push({pattern: new RegExp(`^${literals.join("([\\s\\S]*?)")}$`), translation, count});
  }
  const gameNames = Object.entries(document.gameNames || {}).filter(([english, local]) => english && local && english !== local)
    .sort(([left], [right]) => right.length - left.length);
  return {exact, templates, gameNames};
}
function catalogText(text) {
  if (!catalog || !text) return undefined;
  if (catalog.exact.has(text)) return catalog.exact.get(text);
  for (const template of catalog.templates) {
    const match = template.pattern.exec(text);
    // A placeholder the translation leaves out may only have carried an English plural ("{0} player{1}").
    const used = new Set([...template.translation.matchAll(/\{(\d+)\}/g)].map(found => Number(found[1])));
    if (match && match.length - 1 === template.count && match.slice(1).every((value, index) => used.has(index) || /^[A-Za-z]{0,3}$/.test(value))) {
      const values = match.slice(1).map(value => catalogText(value) ?? value);
      return template.translation.replace(/\{(\d+)\}/g, (whole, index) => values[Number(index)] ?? whole);
    }
  }
  return catalog.gameNames.find(([english]) => english === text)?.[1];
}
function catalogPageText(value) {
  const trimmed = value.trim();
  if (!trimmed) return value;
  let translated = catalogText(trimmed);
  if (translated === undefined) {
    translated = trimmed;
    for (const [english, local] of catalog?.gameNames || []) if (translated.includes(english)) translated = translated.replaceAll(english, local);
  }
  if (translated === trimmed) return value;
  const start = value.indexOf(trimmed);
  return value.slice(0, start) + translated + value.slice(start + trimmed.length);
}
async function loadCatalog(code) {
  try {
    const response = await fetch(`/i18n/${code}.json`, {cache: "no-cache"});
    if (response.ok) catalog = compileCatalog(await response.json());
  } catch (_) { catalog = null; }
}
const tr = (en, nl) => siteCopy(language === "nl" ? nl : usesCatalog() ? (catalogText(en) ?? en) : en);
const dutchPresentation = globalThis.MK8DX_DUTCH_PRESENTATION || {byId:{},byEnglish:{}};
const dutchUiCopy = {
  "All results synchronized":"Alle resultaten zijn gesynchroniseerd","Among rivals":"Onder rivalen",
  "Average":"Gemiddelde","Back":"Terug","Body":"Chassis","Build":"Voertuig","BUILD":"VOERTUIG",
  "Character":"Coureur","Close notifications":"Meldingen sluiten","Combined time":"Gecombineerde tijd",
  "Community activity":"Communityactiviteit","Delta per track":"Verschil per circuit","Glider":"Paraglider",
  "Global":"Wereldwijd","Kart builder":"Voertuigbouwer","Loading your MK8DX progress…":"Jouw MK8DX-voortgang laden…",
  "Medals":"Medailles","Nintendo Ghost":"Nintendo-ghost","Notifications":"Meldingen","Player":"Speler",
  "Progress & rivals":"Voortgang en rivalen","Rank":"Ranglijst","RANK":"RANGLIJST","Refresh progress":"Voortgang vernieuwen",
  "Reset filters":"Filters herstellen","Rivals":"Rivalen","Run history":"Ritgeschiedenis","Search body":"Chassis zoeken",
  "Search character":"Coureur zoeken","Search glider":"Paraglider zoeken","Search player name":"Spelersnaam zoeken",
  "Search tire":"Banden zoeken","Search track":"Circuit zoeken","Tire":"Banden","Tires":"Banden",
  "Total":"Totaal","Track":"Circuit","World Record":"Wereldrecord","YOUR FOCUS":"JOUW FOCUS"
};
Object.assign(dutchUiCopy, {
  "AVERAGE":"GEMIDDELDE","CLOSEST BATTLES":"KLEINSTE DUELS","COMBINED TIME":"GECOMBINEERDE TIJD",
  "COMMUNITY ACTIVITY":"COMMUNITYACTIVITEIT","GLOBAL STANDING":"WERELDWIJDE STAND","LOCAL EVIDENCE":"LOKAAL BEWIJS",
  "MASTERY":"MASTERY","PLAYER PROGRESS":"SPELERSVOORTGANG","PUBLISHED BESTS":"GEPUBLICEERDE BESTE TIJDEN",
  "All results synchronized":"Alle resultaten zijn gesynchroniseerd","Close notifications":"Meldingen sluiten",
  "Compare totals, medals, Mastery and tracks":"Vergelijk totalen, medailles, Mastery en circuits",
  "Compare totals, medals, Mastery and circuits":"Vergelijk totalen, medailles, Mastery en circuits",
  "Engine class":"Raceklasse","Global progress and Rival battles use the same canonical bests as the website and phone app.":"Wereldwijde voortgang en duels met rivalen gebruiken dezelfde canonieke beste tijden als de website en telefoonapp.",
  "Kart builder":"Voertuigbouwer","Loading your MK8DX progress…":"Jouw MK8DX-voortgang laden…",
  "Notifications":"Meldingen","Open in a separate window":"In een apart venster openen",
  "Progress & rivals":"Voortgang en rivalen","Rating distribution":"Verdeling van niveaus",
  "Recent Time Trials":"Recente Time Trials","Run history & live capture":"Ritgeschiedenis en live-opname",
  "Saved result synchronization":"Synchronisatie van opgeslagen resultaten","Search player name to compare":"Spelersnaam zoeken om te vergelijken",
  "Selected comparison players":"Geselecteerde vergelijkingsspelers","Shared comparisons":"Gedeelde vergelijkingen",
  "Tire":"Banden","Where the next gain is waiting":"Waar jouw volgende verbetering ligt",
  "Your chosen Players":"Jouw gekozen spelers","tracks driven in this class":"circuits gereden in deze klasse",
  "RACE. RECORD. IMPROVE.":"RACE. LEG VAST. VERBETER.",
  "Your published times from example.invalid, together with Mastery and the people you chose as rivals.":"Jouw gepubliceerde tijden op example.invalid, samen met Mastery en de spelers die je als rivalen hebt gekozen.",
  "Public community Rank · Nintendo Ghost selected as reference.":"Openbare communityranglijst · Nintendo-ghost geselecteerd als referentie.",
  "Public Rank is unavailable right now.":"De openbare ranglijst is nu niet beschikbaar.",
  "Showing the latest safe offline copy.":"De laatste veilig opgeslagen offline versie wordt getoond.",
  "Up to date with example.invalid.":"Bijgewerkt met example.invalid.",
  "Refreshing from example.invalid…":"Vernieuwen vanaf example.invalid…",
  "Progress could not be loaded. Capture and run history still work.":"Voortgang kon niet worden geladen. Opname en ritgeschiedenis blijven werken.",
  "No target yet":"Nog geen doel",
  "Keep recording times to unlock this comparison.":"Blijf tijden vastleggen om deze vergelijking te ontgrendelen.",
  "Clear comparisons with your own best and the platform used to submit each result.":"Duidelijke vergelijkingen met je eigen beste tijd en het platform waarop elke uitslag is ingestuurd.",
  "Compact filters use the same saved Global, rivals and private Group scope as Web and Android.":"Compacte filters gebruiken dezelfde opgeslagen wereldwijde, rivalen- en privégroepsselectie als Web en Android.",
  "Search every part, keep full names visible and see whether the setup meets the Magic 8 and Meta rules.":"Zoek elk onderdeel, houd volledige namen zichtbaar en bekijk of de combinatie aan de Magic 8- en metaregels voldoet.",
  "PUBLIC PLAYER PREFERENCES":"OPENBARE SPELERSVOORKEUREN",
  "Open public profile":"Openbaar profiel openen",
  "Country not selected":"Geen land geselecteerd",
  "track / mode records":"circuit-/klasserecords",
  "96-track standing":"stand over 96 circuits",
  "per 150cc track":"per 150cc-circuit",
  "My records":"Mijn records","MY RECORDS & STATS":"MIJN RECORDS EN CIJFERS",
  "Mastery across your tracks":"Mastery over je circuits",
  "Click a level to see those tracks in the record book.":"Klik op een niveau om die circuits in het recordboek te zien.",
  "MOMENTUM":"VORM","Your runs per week":"Je ritten per week","HIGHLIGHTS":"UITGELICHT",
  "RECORD BOOK":"RECORDBOEK","Every track, your best time":"Elk circuit, je beste tijd",
  "TOURNAMENTS":"TOERNOOIEN","Your tournament career":"Je toernooicarrière",
  "Tournament figures count every race, whatever the engine class it was raced in.":"Toernooicijfers tellen elke race, in welke motorklasse die ook is gereden.",
  "Engine class":"Motorklasse","Order":"Volgorde","Filter the record book by Mastery":"Filter het recordboek op Mastery",
  "Cup":"Beker","Rival":"Rivaal","Closest":"Dichtstbij","Delta":"Verschil",
  "RESULTS ON THIS PC":"RESULTATEN OP DEZE PC","Recognized runs":"Herkende ritten","Refresh":"Vernieuwen",
  "When":"Wanneer","Time":"Tijd","State":"Status","Settings":"Instellingen","Quit LiveTrial":"LiveTrial afsluiten",
  "A correction saves a new version; the earlier one is kept.":"Een correctie bewaart een nieuwe versie; de eerdere blijft bewaard."
});
const dutchDomainNames = Object.entries(dutchPresentation.byEnglish)
  .filter(([english,dutch])=>english!==dutch).sort(([left],[right])=>right.length-left.length);
function dutchText(value) {
  if(usesCatalog()&&value)return siteCopy(catalogPageText(value));
  if(language!=="nl"||!value)return value ? siteCopy(value) : value;
  const trimmed=value.trim();
  let translated=dutchPresentation.byId[trimmed]||dutchPresentation.byEnglish[trimmed]||dutchUiCopy[trimmed]||trimmed;
  for(const [english,dutch] of dutchDomainNames)translated=translated.replaceAll(english,dutch);
  const phrases=[["Nintendo Ghost","Nintendo-ghost"],["World Record","Wereldrecord"],["Search track","Circuit zoeken"],["Search player","Speler zoeken"],[" tracks"," circuits"],[" cups"," bekers"],[" laps"," ronden"],["Lap ","Ronde "],["coins","munten"],["mushrooms","paddenstoelen"],["Character","Coureur"],["Body","Chassis"],["Tires","Banden"],["Glider","Paraglider"],["Track","Circuit"],["Player","Speler"]];
  for(const [english,dutch] of phrases)translated=translated.replaceAll(english,dutch);
  if(translated===trimmed)return siteCopy(value);
  const start=value.indexOf(trimmed);return siteCopy(value.slice(0,start)+translated+value.slice(start+trimmed.length));
}
function dutchSearchText(value){return `${value}\n${dutchPresentation.byEnglish[value]||dutchPresentation.byId[value]||value}`.toLowerCase()}
function localizeElement(element) {
  // Never text a person typed or will send as typed: form fields and anything marked
  // data-no-translate (the YouTube upload form, owner 2026-09-29: no silent changes).
  if(!translatesPage()||element.matches("script,style")||element.closest("textarea,[data-no-translate]"))return;
  for(const attribute of ["placeholder","title","aria-label"]){const value=element.getAttribute(attribute);if(value){const next=dutchText(value);if(next!==value)element.setAttribute(attribute,next)}}
  const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node;
  while((node=walker.nextNode())){if(!node.parentElement?.matches("script,style")&&!node.parentElement?.closest("textarea,[data-no-translate]")){const value=node.nodeValue||"",next=dutchText(value);if(next!==value)node.nodeValue=next}}
}
const dutchObserver=new MutationObserver(mutations=>{if(!translatesPage())return;for(const mutation of mutations){for(const node of mutation.addedNodes){if(node instanceof Element)localizeElement(node);else if(node.parentElement)localizeElement(node.parentElement)}if(mutation.type==="characterData"&&mutation.target.parentElement)localizeElement(mutation.target.parentElement)}});
dutchObserver.observe(document.documentElement,{childList:true,subtree:true,characterData:true});

// The Web's MASTERY_TIER_COLORS (apps/timetrials-web/src/mastery-thresholds.ts),
// also used by Android; a test keeps the three lists equal.
const masteryColors = {
  "Deity":"#B02727","Myth A":"#7B1FA2","Myth B":"#8E24AA","Myth C":"#AB47BC",
  "Titan A":"#3F51B5","Titan B":"#5C6BC0","Titan C":"#7986CB","Hero A":"#1976D2",
  "Hero B":"#2196F3","Hero C":"#64B5F6","Exp A":"#00796B","Exp B":"#009688",
  "Exp C":"#4DB6AC","Adv A":"#2E7D32","Adv B":"#388E3C","Adv C":"#66BB6A",
  "Int A":"#FFA000","Int B":"#FFB300","Int C":"#FFD54F","Beg A":"#FF7043",
  "Beg B":"#FF8A65","Beg C":"#FFAB91","Noob":"#BDBDBD"
};

// Web's tierChip(): dark ink on light levels, white on dark ones.
function tierInk(colour) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour || "");
  if (!match) return "#FFFFFF";
  const channel = value => { const encoded = parseInt(value, 16) / 255; return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4; };
  const luminance = 0.2126 * channel(match[1]) + 0.7152 * channel(match[2]) + 0.0722 * channel(match[3]);
  return luminance > 0.42 ? "#0B0D12" : "#FFFFFF";
}

function clock(ms, total = false) {
  if (!Number.isFinite(ms)) return "—";
  const sign = ms < 0 ? "−" : "";
  const value = Math.abs(Math.round(ms));
  const hours = Math.floor(value / 3600000);
  const minutes = Math.floor(value / 60000) % 60;
  const seconds = Math.floor(value / 1000) % 60;
  const millis = String(value % 1000).padStart(3, "0");
  if (hours || total) return `${sign}${hours}:${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}.${millis}`;
  return `${sign}${minutes}:${String(seconds).padStart(2,"0")}.${millis}`;
}

function delta(ms) {
  if (!Number.isFinite(ms)) return "—";
  const prefix = ms > 0 ? "+" : ms < 0 ? "−" : "=";
  return `${prefix}${clock(Math.abs(ms), true)}`;
}

function trackDelta(ms) {
  if (!Number.isFinite(ms)) return "—";
  const prefix = ms > 0 ? "+" : ms < 0 ? "−" : "=";
  const value = Math.min(599999, Math.abs(Math.round(ms)));
  return `${prefix}${Math.floor(value / 60000)}:${String(Math.floor(value / 1000) % 60).padStart(2,"0")}.${String(value % 1000).padStart(3,"0")}`;
}

function deltaColor(ms, fullScaleMs = 3000) {
  const scale = Number(fullScaleMs) > 0 ? Number(fullScaleMs) : 3000;
  const clamped = Math.max(-scale, Math.min(scale, Number(ms) || 0));
  const amount = Math.abs(clamped) / scale;
  const start = [255, 213, 79], end = clamped < 0 ? [46, 204, 113] : [239, 83, 80];
  return `rgb(${start.map((value, index) => Math.round(value + (end[index] - value) * amount)).join(" ")})`;
}

function masteryBadge(label) {
  const colour = masteryColors[label] || "#27a6ff";
  return label ? `<span class="mastery-badge" style="--tier:${colour};--tier-ink:${tierInk(colour)}">${escapeHtml(label)}</span>` : "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
}

function modeBadge(mode) {
  return `<span class="cc cc-${mode}">${mode}cc</span>`;
}

function platformIcon(platform) {
  if (platform === "android") return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 10h14v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M7 10a5 5 0 0 1 10 0M8 5 6.8 3M16 5l1.2-2"/><circle cx="9" cy="8" r="1"/><circle cx="15" cy="8" r="1"/></svg>`;
  if (platform === "windows") return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 20h8M12 17v3"/><path fill="currentColor" d="M7 7l4-.6v4.1H7zm5-.8 5-.7v5h-5zM7 11.5h4v4.1l-4-.6zm5 0h5v5l-5-.7z"/></svg>`;
  if (platform === "web") return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>`;
  if (platform === "ios" || platform === "macos") return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.8 12.7c0-2.6 2.1-3.8 2.2-3.9a4.8 4.8 0 0 0-3.8-2.1c-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.3-.9a5 5 0 0 0-4.2 2.6c-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.5 1.3-.1 1.8-.8 3.4-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.2 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.8-1.1-2.8-3.9zM14.2 5c.7-.9 1.2-2.1 1.1-3.3-1 .1-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.2 1.1.1 2.3-.6 3-1.5z"/></svg>`;
  if (platform === "linux") return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2c-2.7 0-4.4 2.6-4.4 5.8 0 1.3-.4 2.4-1.2 3.5-1.4 1.8-2.1 4.1-1.3 6.2.5 1.2 1.4 2 2.5 2.2.8 1.4 2.5 2.3 4.4 2.3s3.6-.9 4.4-2.3c1.1-.2 2-1 2.5-2.2.8-2.1.1-4.4-1.3-6.2-.8-1.1-1.2-2.2-1.2-3.5C16.4 4.6 14.7 2 12 2z"/><circle cx="10.3" cy="7.3" r=".8" fill="#fff"/><circle cx="13.7" cy="7.3" r=".8" fill="#fff"/><path d="M9 11c2 1.3 4 1.3 6 0M8 17c2.5 1.6 5.5 1.6 8 0"/></svg>`;
  return `<span aria-hidden="true">?</span>`;
}

function platformBadge(platform) {
  const label = platform === "android" ? "Android" : platform === "windows" ? "Windows" : platform === "web" ? "Web" : platform === "ios" ? "iOS" : platform === "macos" ? "macOS" : platform === "linux" ? "Linux" : tr("Unknown", "Onbekend");
  return `<span class="source source-${platform}">${platformIcon(platform)}<span>${label}</span></span>`;
}

function applyLanguage() {
  // A catalog language reads the page's static English from its catalog; the observer covers what renders later.
  if (usesCatalog()) { localizeElement(document.documentElement); return; }
  if (language !== "nl") return;
  $(".tab[data-tab='records']").textContent = "Mijn records";
  $(".tab[data-tab='history']").textContent = "Ritgeschiedenis";
  $("#sync-label").textContent = "Voortgang vernieuwen";
  $("#notifications-panel .notification-head strong").textContent = "Meldingen";
  $(".rivals-block h2").textContent = "Jouw gekozen spelers";
  $(".battles-block .eyebrow").textContent = "KLEINSTE DUELS";
  $("#history-panel .history-head h2").textContent = "Ritgeschiedenis";
  $(".tab[data-tab='live']").textContent = "Live";
  $("#live-title").textContent = "Live-opname";
  $("#history-new").textContent = "Open in een apart venster";
  localizeElement(document.documentElement);
}

function relativeTime(timestamp) {
  const ms = Math.max(0, Date.now() - timestamp);
  if (ms < 60000) return tr("just now", "zojuist");
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h`;
  return `${Math.floor(ms / 86400000)}d`;
}

const LOADOUT_SPECS=[["character","characterId","characterVariantId"],["body","bodyId","bodyVariantId"],["tire","tireId",null],["glider","gliderId","gliderVariantId"]];
// Every slot of a kart combination, null where the loadout names nothing (or the catalog lacks it).
function loadoutSlots(loadout) {
  if(!buildCatalog)return [];
  const characterId=loadout?.characterVariantId||loadout?.characterId;
  return LOADOUT_SPECS.map(([category,idKey,variantKey])=>{
    const base=(buildCatalog.categories?.[category]||[]).find(row=>row.id===loadout?.[idKey]); if(!base)return {category,part:null};
    const variants=category==="character"?buildVariants.characters:category==="body"?buildVariants.bodies:category==="glider"?buildVariants.gliders:[];
    const variant=variants.find(row=>row.id===loadout[variantKey])||(category!=="character"?matchedBuildVariant(base,characterId):null);
    return {category,part:{name:variant?`${base.name} · ${variant.name}`:base.name,icon:variant?.iconPath||base.iconPath,baseIcon:base.iconPath}};
  });
}
// loadout-variants.json names body/glider colours "variants/body_variant.<kart>.<nnn_colour>.png"; the
// packaged assets keep them as "variants/<kart>/<nnn_colour>.png". A few themed colours have no picture
// at all: their <img> carries data-fallback (the base part) and falls back once, as the Build tab does.
const gameAsset = path => `/api/game-asset?path=${encodeURIComponent(String(path || "").replace(/^(images\/vehicles\/(?:bodies|gliders)\/variants\/)(?:body|glider)_variant\.([^./]+)\.([^/]+)$/, "$1$2/$3"))}`;
document.addEventListener("error", event => {
  const image = event.target;
  if (image instanceof HTMLImageElement && image.dataset.fallback && !image.dataset.fellBack) { image.dataset.fellBack = "1"; image.src = gameAsset(image.dataset.fallback); }
}, true);
// Home's quick row: the four part icons, then mushrooms and coins (or rupees, bells, shines) per lap.
function loadoutIcons(loadout) {
  const slots=loadoutSlots(loadout);
  if(!slots.some(slot=>slot.part))return "";
  return `<span class="quick-loadout">${slots.map(slot=>slot.part?`<img src="${gameAsset(slot.part.icon)}" data-fallback="${escapeHtml(slot.part.baseIcon)}" alt="" title="${escapeHtml(slot.part.name)}" loading="lazy">`:`<span class="quick-missing">—</span>`).join("")}</span>`;
}
const TRACK_CURRENCY = {"track.hyrule_circuit":["images/items/icons/002_rupee.png","Rupees per lap","Roepies per ronde"],"track.yoshis_island":["images/items/icons/001_shine.png","Yoshi coins per lap","Yoshi-munten per ronde"],"track.animal_crossing":["images/items/icons/003_bell.png","Bells per lap","Bellen per ronde"]};
function lapMetrics(row) {
  const laps=row.laps||[]; if(!laps.length)return "";
  let previous=0;
  const coins=laps.map(lap=>{if(lap.coins==null)return "—";const delta=lap.coins-previous;previous=lap.coins;return String(delta);});
  const mushrooms=laps.map(lap=>lap.mushrooms==null?"—":String(lap.mushrooms));
  const [coinIcon,coinEn,coinNl]=TRACK_CURRENCY[row.trackId]||["images/items/icons/000_coin.png","Coins per lap","Munten per ronde"];
  const metric=(icon,label,values)=>`<span class="quick-metric" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"><img src="${gameAsset(icon)}" alt="">${values.join("·")}</span>`;
  return metric("images/items/icons/014_mushroom.png",tr("Mushrooms per lap","Paddenstoelen per ronde"),mushrooms)+metric(coinIcon,tr(coinEn,coinNl),coins);
}
function activityLoadout(loadout) {
  if(!loadout||!buildCatalog)return "";
  const parts=loadoutSlots(loadout).flatMap(slot=>slot.part?[slot.part]:[]);
  return parts.length?`<div class="activity-loadout">${parts.map(part=>`<span title="${escapeHtml(part.name)}"><img src="/api/game-asset?path=${encodeURIComponent(part.icon)}" alt="">${escapeHtml(part.name)}</span>`).join("")}</div>`:"";
}

let recordSort = "cup";
let levelFilter = null;
const tierColor = label => masteryColors[label] || "#27a6ff";
const recordsFor = () => progress?.myRecords?.modes?.[String(selectedMode)] || null;
const countText = value => Number(value || 0).toLocaleString(localeTag());
// Web's formatDelta() for a time still to find: "−0.029", "−3:06.677", "−11:32:25.035".
const gapText = ms => {
  const size = Math.abs(Math.round(Number(ms) || 0));
  if (size === 0) return "±0.000";
  return `−${size < 60000 ? `${Math.floor(size / 1000)}.${String(size % 1000).padStart(3, "0")}` : clock(size)}`;
};
const shortDate = atMs => new Date(atMs).toLocaleDateString(localeTag(), {day:"numeric", month:"short"});
const leaderboardUrl = trackId => `${SITE_ORIGIN}/?leaderboard=${encodeURIComponent(trackId)}&mode=${selectedMode}`;
function trackThumb(trackId) {
  const id = encodeURIComponent(trackId);
  return `<span class="track-thumb"><img src="/api/track-image?trackId=${id}" alt="" loading="lazy"><img class="track-thumb-cup" src="/api/cup-image?trackId=${id}" alt="" loading="lazy"></span>`;
}

function renderRecordsHero() {
  const mode = progress.modes.find(row => row.mode === selectedMode);
  const standing = recordsFor()?.standing;
  $("#hero-rank").innerHTML = standing && standing.rank
    ? `<strong>#${standing.rank}</strong><span>${tr(`of ${standing.of}`, `van ${standing.of}`)} · ${modeBadge(selectedMode)} ${tr("total", "totaal")} <b>${clock(standing.totalMs, true)}</b></span>`
    : "";
  $("#hero-art").style.backgroundImage = mode?.strongest ? `url('/api/track-image?trackId=${encodeURIComponent(mode.strongest.trackId)}')` : "";
  const slot = $("#records-summary");
  if (!mode || !mode.overallMastery) { slot.innerHTML = ""; return; }
  const overall = mode.overallMastery;
  const card = (label, value, small) => `<article class="summary"><span>${escapeHtml(label)}</span><strong>${value}</strong><small>${small}</small></article>`;
  slot.innerHTML = [
    card(tr("OVERALL MASTERY", "TOTALE MASTERY"), masteryBadge(overall.label),
      overall.nextLabel && Number.isFinite(overall.improveByMs) ? `${gapText(overall.improveByMs)} ${tr("to", "tot")} ${escapeHtml(overall.nextLabel)}` : tr("Top level", "Hoogste niveau")),
    card(tr("TRACKS RACED", "GEREDEN CIRCUITS"), `${mode.driven}/${mode.trackCount}`, tr("with a published time", "met een gepubliceerde tijd")),
    card(tr("TOP 3 ON A TRACK", "TOP 3 OP EEN CIRCUIT"), countText(mode.top3), tr("podium places", "podiumplaatsen")),
    card(tr("STRONGEST TRACK", "STERKSTE CIRCUIT"),
      mode.strongest ? `<span class="strongest-name">${escapeHtml(mode.strongest.trackName)}</span>${masteryBadge(mode.strongest.mastery)}` : "—", ""),
  ].join("");
}

function renderLevels() {
  const cards = recordsFor()?.cards || [];
  const counts = new Map();
  let open = 0;
  for (const card of cards) {
    if (!card.best) { open += 1; continue; }
    counts.set(card.best.label, (counts.get(card.best.label) || 0) + 1);
  }
  const levels = Object.keys(masteryColors).filter(label => counts.has(label)).map(label => ({label, count: counts.get(label)}));
  const total = cards.length || 1;
  const bar = $("#level-bar");
  bar.innerHTML = levels.map(level => `<span style="--tier:${tierColor(level.label)};--share:${level.count / total * 100}%" title="${escapeHtml(level.label)}: ${level.count}"></span>`).join("")
    + (open ? `<span class="open" style="--share:${open / total * 100}%" title="${tr("Not raced", "Niet gereden")}: ${open}"></span>` : "");
  bar.setAttribute("aria-label", levels.map(level => `${level.label} ${level.count}`).join(", "));
  $("#level-legend").innerHTML = levels.map(level => `<button type="button" class="level-button" data-level="${escapeHtml(level.label)}" aria-pressed="${levelFilter === level.label}">${masteryBadge(level.label)}<b>${level.count}</b></button>`).join("")
    + (open ? `<button type="button" class="level-button" data-level="open" aria-pressed="${levelFilter === "open"}"><span class="open-chip">${tr("Not raced", "Niet gereden")}</span><b>${open}</b></button>` : "");
  $$("#level-legend [data-level]").forEach(button => button.addEventListener("click", () => {
    levelFilter = levelFilter === button.dataset.level ? null : button.dataset.level;
    recordSort = "cup";
    renderLevels();
    renderRecordBook();
    if (levelFilter) $(".record-book-block").scrollIntoView({behavior: "smooth", block: "start"});
  }));
}

function renderMomentum() {
  const runs = progress.myRecords?.runs;
  const block = $("#momentum-block");
  block.classList.toggle("hidden", !Array.isArray(runs));
  if (!Array.isArray(runs)) return;
  const week = 7 * 24 * 3600000, now = Date.now();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const weeks = Array.from({length: 12}, (_, index) => ({startMs: start.getTime() - (11 - index) * week, runs: 0}));
  const since = now - 30 * 24 * 3600000, bestSoFar = new Map();
  let pbs = 0, latest = null;
  for (const run of runs.filter(row => row.mode === selectedMode).sort((a, b) => a.atMs - b.atMs)) {
    const bucket = [...weeks].reverse().find(candidate => run.atMs >= candidate.startMs);
    if (bucket && run.atMs < bucket.startMs + week) bucket.runs += 1;
    const previous = bestSoFar.get(run.trackId);
    if (previous === undefined || run.totalTimeMs < previous) {
      if (previous !== undefined && run.atMs >= since) { pbs += 1; latest = {trackId: run.trackId, gainMs: previous - run.totalTimeMs, atMs: run.atMs}; }
      bestSoFar.set(run.trackId, run.totalTimeMs);
    }
  }
  const trackName = trackId => (recordsFor()?.cards || []).find(card => card.trackId === trackId)?.trackName || trackId;
  $("#momentum-line").innerHTML = pbs === 0
    ? tr("No new personal bests in the last 30 days — the record book shows where the next one is closest.", "Geen nieuwe persoonlijke records in de laatste 30 dagen — het recordboek laat zien waar de volgende het dichtst bij is.")
    : `<strong>${tr(`${pbs} personal ${pbs === 1 ? "best" : "bests"}`, `${pbs} persoonlijke ${pbs === 1 ? "record" : "records"}`)}</strong> ${tr("in the last 30 days", "in de laatste 30 dagen")}`
      + (latest ? ` · ${tr("latest", "laatste")}: ${escapeHtml(trackName(latest.trackId))} <b class="gain">${gapText(latest.gainMs)}</b> (${shortDate(latest.atMs)})` : "");
  const max = Math.max(1, ...weeks.map(row => row.runs));
  const chart = $("#momentum-chart");
  chart.setAttribute("aria-label", tr(`${selectedMode}cc runs per week, last 12 weeks`, `${selectedMode}cc-ritten per week, laatste 12 weken`));
  chart.innerHTML = weeks.map(row => {
    const date = new Date(row.startMs), label = `${date.getDate()}/${date.getMonth() + 1}`;
    return `<div class="momentum-week" title="${tr(`Week of ${label}: ${row.runs} runs`, `Week van ${label}: ${row.runs} ritten`)}"><b>${row.runs || ""}</b><i style="--height:${row.runs / max * 100}%"></i><small>${label}</small></div>`;
  }).join("");
}

function highlightTile(kicker, card, headline, detail) {
  return card ? `<a class="highlight" href="${leaderboardUrl(card.trackId)}" target="_blank" rel="noreferrer">${trackThumb(card.trackId)}<span class="highlight-copy"><span class="kicker">${kicker}</span><strong>${escapeHtml(card.trackName)}</strong><span class="highlight-headline">${headline}</span><small>${detail}</small></span></a>` : "";
}

function renderHighlights() {
  const records = recordsFor();
  const cards = records?.cards || [];
  const raced = cards.filter(card => card.best);
  const closest = raced.filter(card => card.best.gapMs != null).sort((a, b) => a.best.gapMs - b.best.gapMs)[0];
  const standing = raced.filter(card => card.best.rank).sort((a, b) => a.best.rank - b.best.rank || a.best.tier - b.best.tier)[0];
  const firsts = raced.filter(card => card.best.rank === 1).length;
  const busiest = raced.filter(card => Number.isFinite(card.best.attempts)).sort((a, b) => b.best.attempts - a.best.attempts)[0];
  const above = (progress.focusByMode?.[String(selectedMode)] || {}).closestGap;
  const aboveCard = above ? cards.find(card => card.trackId === above.trackId) : null;
  const combo = records?.combo ? activityLoadout(records.combo.loadout) : "";
  const tiles = [
    closest ? highlightTile(tr("CLOSEST TO THE NEXT LEVEL", "DICHTST BIJ HET VOLGENDE NIVEAU"), closest,
      `${gapText(closest.best.gapMs)} ${tr("to", "tot")} ${masteryBadge(closest.best.nextLabel)}`,
      tr(`Now ${clock(closest.best.timeMs)} · ${closest.best.label}`, `Nu ${clock(closest.best.timeMs)} · ${closest.best.label}`)) : "",
    aboveCard ? highlightTile(tr("CLOSEST TO THE PLAYER ABOVE", "DICHTST BIJ DE SPELER BOVEN JE"), aboveCard,
      `${gapText(above.nextGapMs)} ${tr("to", "tot")} ${escapeHtml(above.targetName || tr("the Player above", "de speler boven je"))}`,
      tr(`You are #${above.rank} with ${clock(above.myBestMs)}`, `Je staat #${above.rank} met ${clock(above.myBestMs)}`)) : "",
    standing ? highlightTile(tr("BEST STANDING", "BESTE POSITIE"), standing,
      tr(`#${standing.best.rank} of ${standing.best.field ?? "?"}`, `#${standing.best.rank} van ${standing.best.field ?? "?"}`),
      firsts > 1 ? tr(`You are #1 on ${firsts} tracks at ${selectedMode}cc`, `Je staat #1 op ${firsts} circuits in ${selectedMode}cc`)
        : `${clock(standing.best.timeMs)} · ${standing.best.label}`) : "",
    busiest ? highlightTile(tr("MOST ATTEMPTS", "MEESTE POGINGEN"), busiest,
      tr(`${countText(busiest.best.attempts)} runs`, `${countText(busiest.best.attempts)} ritten`),
      tr(`Best ${clock(busiest.best.timeMs)}`, `Beste ${clock(busiest.best.timeMs)}`)) : "",
    combo ? `<div class="highlight combo"><span class="highlight-copy"><span class="kicker">${tr("YOUR GO-TO COMBO", "JE FAVORIETE COMBINATIE")}</span>${combo}<small>${tr(`${records.combo.runs} of your last ${records.combo.of} ${selectedMode}cc runs`, `${records.combo.runs} van je laatste ${records.combo.of} ${selectedMode}cc-ritten`)}</small></span></div>` : "",
  ].filter(Boolean);
  $("#highlights-block").classList.toggle("hidden", tiles.length === 0);
  $("#highlights").innerHTML = tiles.join("");
}

function recordCard(card) {
  const best = card.best;
  if (!best) {
    return `<a class="record-card unraced" href="${SITE_ORIGIN}/?post=${encodeURIComponent(card.trackId)}&mode=${selectedMode}" target="_blank" rel="noreferrer">${trackThumb(card.trackId)}<span class="record-copy"><strong title="${escapeHtml(card.trackName)}">${escapeHtml(card.trackName)}</strong><span class="record-line"></span><small class="record-facts"><span>${tr("Not raced yet", "Nog niet gereden")}</span><span>${tr("Post a time", "Plaats een tijd")}</span></small></span></a>`;
  }
  // Two fixed fact lines (standing, then activity) so every card has the same height (owner 2026-09-27).
  const standing = [
    best.rank ? tr(`#${best.rank} of ${best.field ?? "?"}`, `#${best.rank} van ${best.field ?? "?"}`) : null,
    best.nextLabel ? `${gapText(best.gapMs)} ${tr("to", "tot")} ${escapeHtml(best.nextLabel)}` : tr("Top level", "Hoogste niveau"),
  ].filter(Boolean).join(" · ");
  const activity = [
    Number.isFinite(best.attempts) ? tr(`${best.attempts} ${best.attempts === 1 ? "run" : "runs"}`, `${best.attempts} ${best.attempts === 1 ? "rit" : "ritten"}`) : null,
    best.setAtMs ? shortDate(best.setAtMs) : null,
  ].filter(Boolean).join(" · ");
  return `<a class="record-card${best.rank === 1 ? " first" : ""}" href="${leaderboardUrl(card.trackId)}" target="_blank" rel="noreferrer">${trackThumb(card.trackId)}<span class="record-copy"><strong title="${escapeHtml(card.trackName)}">${escapeHtml(card.trackName)}</strong><span class="record-line"><b>${clock(best.timeMs)}</b>${masteryBadge(best.label)}</span><small class="record-facts"><span>${standing}</span><span>${activity || "&nbsp;"}</span></small></span></a>`;
}

function renderRecordBook() {
  const cards = recordsFor()?.cards || [];
  const sorts = [["cup", "By cup", "Per cup"], ["mastery", "Best Mastery", "Beste Mastery"], ["next", "Closest to next level", "Dichtst bij volgend niveau"], ["rank", "Best rank", "Beste positie"]];
  if (cards.some(card => card.best?.setAtMs)) sorts.push(["recent", "Recently set", "Recent gezet"]);
  if (!sorts.some(([value]) => value === recordSort)) recordSort = "cup";
  $("#record-sort").innerHTML = sorts.map(([value, en, nl]) => `<button type="button" data-record-sort="${value}" class="${recordSort === value ? "active" : ""}" aria-pressed="${recordSort === value}">${tr(en, nl)}</button>`).join("");
  $$("[data-record-sort]").forEach(button => button.addEventListener("click", () => { recordSort = button.dataset.recordSort; renderRecordBook(); }));
  const raced = cards.filter(card => card.best).length;
  $("#record-book-note").textContent = tr(`${raced} of ${cards.length} tracks at ${selectedMode}cc. Every card opens the track's leaderboard on example.invalid.`,
    `${raced} van ${cards.length} circuits op ${selectedMode}cc. Elke kaart opent de ranglijst van het circuit op example.invalid.`);
  const shown = cards.filter(card => levelFilter === null || (levelFilter === "open" ? !card.best : card.best?.label === levelFilter));
  const filter = $("#record-filter");
  filter.classList.toggle("hidden", levelFilter === null);
  if (levelFilter !== null) {
    filter.innerHTML = `<span>${levelFilter === "open" ? tr("Showing tracks not raced yet.", "Alleen nog niet gereden circuits.") : `${tr("Showing", "Alleen")} ${masteryBadge(levelFilter)}`}</span><button type="button" id="clear-level">${tr("Show every track", "Toon alle circuits")}</button>`;
    $("#clear-level").addEventListener("click", () => { levelFilter = null; renderLevels(); renderRecordBook(); });
  }
  const book = $("#record-book");
  if (recordSort === "cup") {
    const cups = new Map();
    for (const card of shown) { const key = card.cupId || "all"; cups.set(key, [...(cups.get(key) || []), card]); }
    book.className = "cup-grid";
    book.innerHTML = [...cups.values()].map(list => `<section class="cup-group"><h3><img src="/api/cup-image?trackId=${encodeURIComponent(list[0].trackId)}" alt="" loading="lazy">${escapeHtml(list[0].cupName || tr("All tracks", "Alle circuits"))}</h3><div class="cup-tracks">${list.map(recordCard).join("")}</div></section>`).join("");
  } else {
    // Best Mastery: the highest level first (a lower tier number is a better level), then the one closest to the next level.
    const key = card => recordSort === "next" ? (card.best.gapMs ?? Number.MAX_SAFE_INTEGER) : recordSort === "rank" ? (card.best.rank ?? Number.MAX_SAFE_INTEGER) : recordSort === "mastery" ? (card.best.tier ?? Number.MAX_SAFE_INTEGER) : -(card.best.setAtMs || 0);
    const tieBreak = (a, b) => recordSort === "mastery" ? (a.best.gapMs ?? Number.MAX_SAFE_INTEGER) - (b.best.gapMs ?? Number.MAX_SAFE_INTEGER) : 0;
    book.className = "record-list";
    book.innerHTML = shown.filter(card => card.best).sort((a, b) => key(a) - key(b) || tieBreak(a, b) || a.trackName.localeCompare(b.trackName)).map(recordCard).join("");
  }
  if (!book.innerHTML) book.innerHTML = `<p class="empty-row">${tr("No tracks at this level.", "Geen circuits op dit niveau.")}</p>`;
}

function renderRatingGraph(points) {
  if (points.length < 2) return "";
  const width = 1000, height = 220, padX = 36, padY = 22;
  const scores = points.map(point => point.score);
  const min = Math.min(...scores), max = Math.max(...scores), span = max - min || 1;
  const x = index => padX + index / (points.length - 1) * (width - 2 * padX);
  const y = score => height - padY - (score - min) / span * (height - 2 * padY);
  const line = points.map((point, index) => `${x(index).toFixed(1)},${y(point.score).toFixed(1)}`).join(" ");
  const marks = [];
  points.forEach((point, index) => {
    const next = points[index + 1];
    if (index > 0 && points[index - 1].tournamentNumber !== point.tournamentNumber) {
      marks.push(`<line class="rating-divider" x1="${x(index).toFixed(1)}" x2="${x(index).toFixed(1)}" y1="${padY}" y2="${height - padY}"></line>`);
    }
    if (!next || next.tournamentNumber !== point.tournamentNumber) {
      marks.push(`<circle class="rating-point" cx="${x(index).toFixed(1)}" cy="${y(point.score).toFixed(1)}" r="5"><title>TN${point.tournamentNumber} · ${tr("rating", "rating")} ${point.score.toFixed(2)}</title></circle><text class="rating-label" x="${x(index).toFixed(1)}" y="${height - 4}">TN${point.tournamentNumber}</text>`);
    }
  });
  const last = points[points.length - 1];
  return `<div class="rating-head"><span class="kicker">${tr("RATING", "RATING")}</span><strong>${last.score.toFixed(2)}</strong><small>${tr(`after ${points.length} counted races · high ${max.toFixed(2)}`, `na ${points.length} getelde races · hoogste ${max.toFixed(2)}`)}</small></div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${tr("Tournament rating per race", "Toernooirating per race")}"><polyline class="rating-line" points="${line}"></polyline>${marks.join("")}</svg>`;
}

function renderTournaments() {
  const tournaments = progress.myRecords?.tournaments;
  const points = progress.myRecords?.ratingHistory || [];
  const block = $("#tournaments-block");
  const show = Boolean(tournaments && tournaments.raceCount > 0) || points.length > 1;
  block.classList.toggle("hidden", !show);
  if (!show) return;
  const counted = tournaments?.countedRaceCount || 0, wins = tournaments?.wins || 0, podiums = tournaments?.podiums || 0;
  const average = counted ? (tournaments.countedFinishPositionTotal / counted).toFixed(1) : "—";
  $("#tournament-stats").innerHTML = tournaments ? [
    [tr("COUNTED RACES", "GETELDE RACES"), countText(counted)], [tr("WINS", "OVERWINNINGEN"), countText(wins)],
    [tr("PODIUMS", "PODIUMPLAATSEN"), countText(podiums)], [tr("AVERAGE FINISH", "GEMIDDELDE FINISH"), average],
  ].map(([label, value]) => `<article class="summary"><span>${label}</span><strong>${value}</strong></article>`).join("") : "";
  $("#tournament-bar").innerHTML = counted ? [["win", tr("Wins", "Overwinningen"), wins], ["podium", tr("Other podiums", "Overige podiumplaatsen"), podiums - wins], ["rest", tr("Rest", "Rest"), counted - podiums]]
    .filter(part => part[2] > 0).map(([tone, label, value]) => `<span class="finish-${tone}" style="--share:${value / counted * 100}%" title="${label}: ${value}"><b>${label} ${value}</b></span>`).join("") : "";
  $("#rating-graph").innerHTML = renderRatingGraph(points);
}

function renderTotals() {
  const records = progress.myRecords;
  const a = records?.modes?.["150"], b = records?.modes?.["200"];
  if (!records || !a || !b) { $("#records-totals").textContent = ""; return; }
  const parts = [];
  if (Number.isFinite(records.submissionCount)) parts.push(tr(`${countText(records.submissionCount)} runs submitted (150cc ${countText(a.attempts)} · 200cc ${countText(b.attempts)})`, `${countText(records.submissionCount)} ingezonden ritten (150cc ${countText(a.attempts)} · 200cc ${countText(b.attempts)})`));
  parts.push(tr(`${countText(a.cells + b.cells)} personal bests (150cc ${countText(a.cells)} · 200cc ${countText(b.cells)})`, `${countText(a.cells + b.cells)} persoonlijke records (150cc ${countText(a.cells)} · 200cc ${countText(b.cells)})`));
  $("#records-totals").textContent = `${tr("Totals", "Totalen")}: ${parts.join(" · ")}. ${tr("Calculated from your latest synchronized results.", "Berekend uit je laatst gesynchroniseerde resultaten.")}`;
}

function renderMyRecords() {
  if (!progress?.myRecords) return;
  renderRecordsHero();
  renderLevels();
  renderMomentum();
  renderHighlights();
  renderRecordBook();
  renderTournaments();
  renderTotals();
}

function renderRivals(view) {
  // Follows the engine switch; an older view without per-class rows keeps the combined numbers.
  const rivals = view.rivalsByMode?.[String(selectedMode)] || view.rivals;
  const battles = view.rivalBattlesByMode?.[String(selectedMode)] || {count: view.rivalBattleCount, battles: view.rivalBattles};
  $("#rivals").innerHTML = rivals.length ? rivals.map(row => `
    <article class="rival">
      <strong>${escapeHtml(row.displayName)} ${view.rivalsByMode ? modeBadge(selectedMode) : ""}</strong>
      <div class="rival-stat"><span>${tr("you lead", "jij leidt")}</span><b>${row.tracksAhead}</b></div>
      <div class="rival-stat behind"><span>${tr("they lead", "zij leiden")}</span><b>${row.tracksBehind}</b></div>
    </article>`).join("") : `<p class="empty-row">${tr("No rivals selected yet. Choose them in your website settings.", "Nog geen rivalen gekozen. Kies ze in je instellingen op de website.")}</p>`;
  $("#battle-count").textContent = tr(`${battles.count} shared comparisons`, `${battles.count} gedeelde vergelijkingen`);
  // Sortable, with the track picture and cup (owner 2026-09-27); twelve rows until "Show all".
  const cupOrder = new Map((view.myRecords?.modes?.[String(selectedMode)]?.cards || []).map((card, index) => [card.trackId, index]));
  const byName = (a, b) => a.trackName.localeCompare(b.trackName) || a.rival.localeCompare(b.rival);
  const orders = {
    closest: (a, b) => Math.abs(a.deltaMs) - Math.abs(b.deltaMs) || byName(a, b),
    delta: (a, b) => a.deltaMs - b.deltaMs || byName(a, b),
    track: byName,
    cup: (a, b) => (cupOrder.get(a.trackId) ?? 999) - (cupOrder.get(b.trackId) ?? 999) || a.rival.localeCompare(b.rival),
    rival: (a, b) => a.rival.localeCompare(b.rival) || Math.abs(a.deltaMs) - Math.abs(b.deltaMs),
  };
  const sorted = [...battles.battles].sort(orders[battleSort] || orders.closest);
  const shownBattles = battlesExpanded ? sorted : sorted.slice(0, 12);
  $$("[data-battle-sort]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.battleSort === battleSort)));
  const more = $("#battles-more");
  more.classList.toggle("hidden", sorted.length <= 12);
  more.textContent = battlesExpanded ? tr("Show the closest 12", "Toon de dichtste 12") : tr(`Show all ${sorted.length}`, `Toon alle ${sorted.length}`);
  $("#battles").innerHTML = shownBattles.length ? shownBattles.map(row => `
    <tr><td><span class="battle-track">${trackThumb(row.trackId)}<span>${escapeHtml(row.trackName)} <span class="cc">${row.mode}CC</span></span></span></td>
    <td>${escapeHtml(row.rival)}</td>
    <td class="number" style="color:${deltaColor(row.deltaMs)};font-weight:800">${trackDelta(row.deltaMs)}</td></tr>`).join("") : `<tr><td colspan="3" class="empty-row">${tr(`No shared ${selectedMode}cc Rival times yet.`, `Nog geen gedeelde ${selectedMode}cc-tijden met rivalen.`)}</td></tr>`;
}

let battleSort = "closest";
let battlesExpanded = false;
$$("[data-battle-sort]").forEach(button => button.addEventListener("click", () => { battleSort = button.dataset.battleSort; if (progress) renderRivals(progress); }));
$("#battles-more").addEventListener("click", () => { battlesExpanded = !battlesExpanded; if (progress) renderRivals(progress); });

function rankRows(view) {
  const rows = (view.globalStandings || []).filter(row => row.mode === selectedMode);
  if (selectedRankScopes.has("global")) return rows;
  const ids = new Set();
  if (selectedRankScopes.has("rivals")) (view.rivals || []).forEach(row => ids.add(row.playerId));
  for (const group of view.rankScopes?.groups || []) if (selectedRankScopes.has(`group:${group.groupId}`)) group.playerIds.forEach(id => ids.add(id));
  return rows.filter(row => ids.has(row.playerId));
}

function combinedPerTrack(view) {
  const merged = new Map();
  for (const track of [...(view.perTrack || []), ...rankComparisonTracks]) {
    const key=`${track.mode}|${track.trackId}`, current=merged.get(key)||{...track,players:[]};
    const players=new Map((current.players||[]).map(player=>[player.playerId,player]));
    for(const player of track.players||[])players.set(player.playerId,player);
    merged.set(key,{...current,...track,players:[...players.values()]});
  }
  return [...merged.values()];
}

async function refreshRankComparison() {
  const humanIds=selectedRankPlayerIds.filter(id=>id.startsWith("player."));
  if(!humanIds.length){rankComparisonTracks=[];if(progress)renderRank(progress);return;}
  try {
    const response=await fetch(`/api/rank-data?players=${humanIds.map(encodeURIComponent).join(",")}`,{cache:"no-store"});
    const body=await response.json(); rankComparisonTracks=Array.isArray(body.perTrack)?body.perTrack:[];
  } catch(_){rankComparisonTracks=[]}
  if(progress)renderRank(progress);
}

function toggleRankPlayer(playerId,displayName) {
  rankPlayerNames.set(playerId,displayName||playerId);
  if(selectedRankPlayerIds.includes(playerId))selectedRankPlayerIds=selectedRankPlayerIds.filter(id=>id!==playerId);
  else if(selectedRankPlayerIds.length<5)selectedRankPlayerIds=[...selectedRankPlayerIds,playerId];
  void refreshRankComparison();
}

function worldRecordMarkup(record) {
  if (!record) return "";
  const holders = Array.isArray(record.holders) && record.holders.length ? record.holders : [record];
  const names = holders.map(holder => {
    const detail = (holder.lapTimesMs || []).map((lap,index)=>`Lap ${index+1}: ${clock(lap)} · coins ${(holder.coinsPerLap||[])[index] ?? "—"} · mushrooms ${(holder.mushroomsPerLap||[])[index] ?? "—"}`).join("\n");
    const label = escapeHtml(holder.playerName);
    return holder.videoUrl
      ? `<a title="${escapeHtml(detail)}" href="${escapeHtml(holder.videoUrl)}" target="_blank" rel="noreferrer">${label}</a>`
      : `<span title="${escapeHtml(detail)}">${label}</span>`;
  }).join(" / ");
  return `<br><span class="world-record">WR ${clock(record.totalTimeMs)} · ${names}</span>`;
}

function renderRank(view) {
  const preference = view.rankScopes?.preference || {global:true,rivals:false,groupIds:[]};
  const playerId = view.player?.playerId || "anonymous";
  const rankViewKey=`mk8dx.rankView.${playerId}`;
  if(rankViewPlayerId!==playerId){
    const saved=(()=>{try{return JSON.parse(localStorage.getItem(rankViewKey)||"null")}catch(_){return null}})();
    selectedMode=saved?.mode===200?200:150;
    rankTab=["total","medals","mastery","tracks"].includes(saved?.tab)?saved.tab:"total";
    selectedRankPlayerIds=Array.isArray(saved?.selectedPlayerIds)&&saved.selectedPlayerIds.length?saved.selectedPlayerIds.slice(0,3):(playerId.startsWith("player.")?[playerId]:["reference.nintendo_staff"]);
    $("#track-search").value=typeof saved?.trackQuery==="string"?saved.trackQuery:"";
    rankScrollY=Number.isFinite(saved?.scrollY)&&saved.scrollY>=0?saved.scrollY:0;
    rankScrollNeedsRestore=true;
    $$(".mode").forEach(item=>item.classList.toggle("active",Number(item.dataset.mode)===selectedMode));
    $$('[data-rank-tab]').forEach(item=>item.classList.toggle("active",item.dataset.rankTab===rankTab));
    rankViewPlayerId=playerId;
  }
  if(rankSelectionPlayerId!==playerId){
    rankSelectionPlayerId=playerId;
    rankComparisonTracks=[];
  }
  rankPlayerNames.set(playerId,view.player?.displayName||playerId);
  for(const [id,name] of rankReferenceNames)rankPlayerNames.set(id,name);
  const storageKey = `mk8dx.rankScopes.${playerId}`;
  if (!rankScopesInitialized || rankScopePlayerId !== playerId) {
    const saved = (() => { try { const value=JSON.parse(localStorage.getItem(storageKey)||"null"); return Array.isArray(value)?value:null } catch(_){ return null } })();
    selectedRankScopes = new Set(saved || [...(preference.global ? ["global"] : []), ...(preference.rivals ? ["rivals"] : []), ...(preference.groupIds || []).map(id => `group:${id}`)]);
    if (!selectedRankScopes.size) selectedRankScopes.add("global");
    rankScopesInitialized = true;
    rankScopePlayerId = playerId;
  }
  const controls = [{key:"global",label:"Global"},...(playerId.startsWith("player.")?[{key:"rivals",label:"Among rivals"}]:[]),...(view.rankScopes?.groups || []).map(group=>({key:`group:${group.groupId}`,label:group.name}))];
  const validKeys = new Set(controls.map(item=>item.key));
  selectedRankScopes = new Set([...selectedRankScopes].filter(key=>validKeys.has(key)));
  if (!selectedRankScopes.size) selectedRankScopes.add("global");
  $("#rank-scopes").innerHTML = controls.map(item => `<button type="button" class="rank-scope ${selectedRankScopes.has(item.key) ? "active" : ""}" data-rank-scope="${escapeHtml(item.key)}">${escapeHtml(item.label)}</button>`).join("")+`<button type="button" class="rank-reset" data-rank-reset>${tr("Reset filters","Filters resetten")}</button>`;
  $$("[data-rank-scope]").forEach(button => button.addEventListener("click", () => {
    const key = button.dataset.rankScope;
    if (selectedRankScopes.has(key)) {
      if (selectedRankScopes.size > 1) selectedRankScopes.delete(key);
    } else selectedRankScopes.add(key);
    try { localStorage.setItem(storageKey, JSON.stringify([...selectedRankScopes])) } catch(_) {}
    renderRank(view);
  }));
  $('[data-rank-reset]').addEventListener("click",()=>{
    selectedMode=150;rankTab="total";selectedRankScopes=new Set(["global"]);selectedRankPlayerIds=playerId.startsWith("player.")?[playerId]:["reference.nintendo_staff"];
    $("#track-search").value="";try{localStorage.removeItem(rankViewKey);localStorage.removeItem(storageKey)}catch(_){}
    rankViewPlayerId=null;renderRank(view);
  });
  const scopedRows = rankRows(view);
  const globalRows=(view.globalStandings||[]).filter(row=>row.mode===selectedMode);
  for(const row of globalRows)rankPlayerNames.set(row.playerId,row.playerDisplayName);
  const referenceRows=[...rankReferenceNames].map(([id,name])=>{const times=combinedPerTrack(view).filter(row=>row.mode===selectedMode).flatMap(row=>(row.players||[]).filter(player=>player.playerId===id).map(player=>player.timeMs));return {rank:null,playerId:id,playerDisplayName:name,mode:selectedMode,totalTimeMs:times.reduce((sum,value)=>sum+value,0),averageTimeMs:times.length?Math.round(times.reduce((sum,value)=>sum+value,0)/times.length):0,playedTracks:times.length,goldMedals:null,silverMedals:null,bronzeMedals:null,reference:true}});
  const comparisonRows=[...globalRows,...referenceRows];
  const rows = selectedRankPlayerIds.length >= 2 ? comparisonRows.filter(row=>selectedRankPlayerIds.includes(row.playerId)) : [...scopedRows,...referenceRows.filter(row=>selectedRankPlayerIds.includes(row.playerId))];
  $("#rank-selected-players").innerHTML=`<strong>${tr("Reference Players:","Referentiespelers:")}</strong>${[...rankReferenceNames].map(([id,name])=>`<button type="button" data-rank-reference="${id}" class="rank-reference ${id.endsWith("nintendo_staff")?"nintendo":"world-record"} ${selectedRankPlayerIds.includes(id)?"active":""}">${id.endsWith("nintendo_staff")?"Ⓝ":"🏆"} ${selectedRankPlayerIds.includes(id)?"✓ ":""}${escapeHtml(name)}</button>`).join("")}${selectedRankPlayerIds.map(id=>`<button type="button" data-remove-rank-player="${escapeHtml(id)}">${escapeHtml(rankPlayerNames.get(id)||id)} ×</button>`).join("")}`;
  $$('[data-rank-reference]').forEach(button=>button.addEventListener("click",()=>toggleRankPlayer(button.dataset.rankReference,rankPlayerNames.get(button.dataset.rankReference))));
  $$('[data-remove-rank-player]').forEach(button=>button.addEventListener("click",()=>toggleRankPlayer(button.dataset.removeRankPlayer,rankPlayerNames.get(button.dataset.removeRankPlayer))));
  const content = $("#rank-content");
  $("#track-search").classList.toggle("hidden", rankTab !== "tracks");
  if (rankTab === "total") {
    content.innerHTML = `<div class="table-wrap"><table><thead><tr><th>#</th><th>Player</th><th>Tracks</th><th>Total</th><th>Average</th></tr></thead><tbody>${rows.map((row,index)=>{const rank=selectedRankScopes.has("global")?row.rank:index+1,position=row.reference?"REF":rank===1?"🏆 #1":rank===2?"🥈 #2":rank===3?"🥉 #3":`#${rank}`;return `<tr><td>${position}</td><td>${escapeHtml(row.playerDisplayName)}</td><td>${row.playedTracks}/96</td><td>${clock(row.totalTimeMs,true)}</td><td>${clock(row.averageTimeMs)}</td></tr>`}).join("")}</tbody></table></div>`;
  } else if (rankTab === "medals") {
    const medalRows=[...scopedRows].sort((left,right)=>right.goldMedals-left.goldMedals||right.silverMedals-left.silverMedals||right.bronzeMedals-left.bronzeMedals||left.playerDisplayName.localeCompare(right.playerDisplayName));
    content.innerHTML = `<div class="table-wrap"><table><thead><tr><th>#</th><th>Player</th><th>🏆 Gold</th><th>🥈 Silver</th><th>🥉 Bronze</th></tr></thead><tbody>${medalRows.map((row,index)=>`<tr><td>${index+1}</td><td>${escapeHtml(row.playerDisplayName)}</td><td>${row.goldMedals}</td><td>${row.silverMedals}</td><td>${row.bronzeMedals}</td></tr>`).join("")}</tbody></table></div>`;
  } else if (rankTab === "mastery") {
    const requestedIds = selectedRankPlayerIds.length ? selectedRankPlayerIds : rows.slice(0,3).map(row=>row.playerId), perTrack = combinedPerTrack(view).filter(row=>row.mode===selectedMode);
    const totalById=new Map(comparisonRows.map(row=>[row.playerId,row.totalTimeMs]));
    const ids=[...requestedIds].sort((left,right)=>(totalById.get(left)??Number.POSITIVE_INFINITY)-(totalById.get(right)??Number.POSITIVE_INFINITY)||(rankPlayerNames.get(left)||left).localeCompare(rankPlayerNames.get(right)||right));
    content.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Mastery</th>${ids.map(id=>`<th>${escapeHtml(rankPlayerNames.get(id)||id)}</th>`).join("")}</tr></thead><tbody>${Object.keys(masteryColors).map(label=>`<tr><th style="color:${masteryColors[label]}">${label}</th>${ids.map(id=>{const count=perTrack.reduce((sum,track)=>sum+((track.players||[]).some(player=>player.playerId===id&&player.mastery===label)?1:0),0);return `<td><span class="rank-mastery-bar" style="--tier:${masteryColors[label]};--width:${count/96*100}%">${count}</span></td>`}).join("")}</tr>`).join("")}</tbody></table></div>`;
  } else {
    const query = $("#track-search").value.trim().toLowerCase(), ids = selectedRankPlayerIds.length ? selectedRankPlayerIds : rows.slice(0,5).map(row=>row.playerId);
    const tracks = combinedPerTrack(view).filter(row=>row.mode===selectedMode&&dutchSearchText(row.trackName).includes(query));
    // With one column there is nothing to compare against: no "=0:00.000" on every row, but a hint.
    const compared = ids.length > 1;
    const hint = compared ? "" : `<p class="rank-hint">${tr("Add a Player with the search above, or the Nintendo Ghost or World Record, to see the gap on every track.", "Voeg met de zoekbalk hierboven een speler toe, of de Nintendo-ghost of het wereldrecord, om op elk circuit het verschil te zien.")}</p>`;
    content.innerHTML = `${hint}<div class="table-wrap"><table><thead><tr><th>Track</th>${ids.map(id=>`<th>${escapeHtml(rankPlayerNames.get(id)||id)}</th>`).join("")}</tr></thead><tbody>${tracks.map(track=>{const available=(track.players||[]).filter(p=>ids.includes(p.playerId)),fastest=Math.min(...available.map(p=>p.timeMs));return `<tr><th class="rank-track-art" style="background-image:linear-gradient(rgb(0 0 0 / 25%),rgb(0 0 0 / 48%)),url('/api/track-image?trackId=${encodeURIComponent(track.trackId)}')"><span><img class="rank-track-cup" src="/api/cup-image?trackId=${encodeURIComponent(track.trackId)}" alt="">${escapeHtml(track.trackName)}</span></th>${ids.map(id=>{const p=available.find(row=>row.playerId===id),gap=p?p.timeMs-fastest:0;return `<td>${p?`${clock(p.timeMs)}<br>${compared?`<span style="color:${deltaColor(gap)};font-weight:900">${trackDelta(gap)}</span><br>`:""}${masteryBadge(p.mastery)}`:"—"}</td>`}).join("")}</tr>`}).join("")}</tbody></table></div>`;
  }
  renderRivals(view);
  try{localStorage.setItem(rankViewKey,JSON.stringify({mode:selectedMode,tab:rankTab,selectedPlayerIds:selectedRankPlayerIds,trackQuery:$("#track-search").value,scrollY:window.scrollY}))}catch(_){}
  if(rankScrollNeedsRestore){rankScrollNeedsRestore=false;requestAnimationFrame(()=>window.scrollTo(0,rankScrollY));}
}

window.addEventListener("scroll",()=>{
  if(!rankViewPlayerId)return;
  rankScrollY=window.scrollY;
  clearTimeout(rankScrollSaveTimer);
  rankScrollSaveTimer=setTimeout(()=>{
    const key=`mk8dx.rankView.${rankViewPlayerId}`;
    try{
      const saved=JSON.parse(localStorage.getItem(key)||"{}");
      localStorage.setItem(key,JSON.stringify({...saved,scrollY:rankScrollY}));
    }catch(_){}
  },120);
},{passive:true});

const normalizeColor = value => String(value || "").replaceAll("_","").toLowerCase();
function characterFamily(id) { return buildVariants.characters.find(row=>row.id===id)?.colorFamily || buildVariants.themes[id] || null; }
function matchedBuildVariant(part, characterId) {
  const family=characterFamily(characterId); if(!family)return null;
  const variants=part.id.startsWith("body.")?buildVariants.bodies:part.id.startsWith("glider.")?buildVariants.gliders:[];
  return variants.find(row=>row.baseId===part.id&&normalizeColor(row.colorFamily)===normalizeColor(family))||null;
}
function buildParts(category) {
  const base=buildCatalog?.categories?.[category]||[];
  if(category!=="character")return base;
  const menuOrder=part=>Number(part.order ?? /^images\/characters\/menu\/(\d{3})_/.exec(part.iconPath)?.[1]) || 0;
  return [...base,...buildVariants.characters.flatMap(variant=>{const parent=base.find(part=>part.id===variant.baseId);return parent?[{...parent,id:variant.id,name:`${parent.name} · ${variant.name}`,iconPath:variant.iconPath,baseIconPath:parent.iconPath,order:variant.order}]:[]})]
    .sort((left,right)=>menuOrder(left)-menuOrder(right));
}
function buildPart(category) { return buildParts(category).find(part=>part.id===buildSelection[category])||buildParts(category)[0]; }
function buildIcon(part) { const variant=matchedBuildVariant(part,buildSelection.character);return variant?.iconPath||part.iconPath; }
// Web's builder key (ds-build.ts BUILD_PART_COLORS and STAT_SECTIONS): which part paid for a number.
const BUILD_PART_COLORS = {
  character: {segment:"#FF9800", text:"#111820", en:"Character", nl:"Coureur"},
  body: {segment:"#2196F3", text:"#08131F", en:"Body", nl:"Chassis"},
  tire: {segment:"#2ECC71", text:"#07150d", en:"Tires", nl:"Banden"},
  glider: {segment:"#9B27B0", text:"#ffffff", en:"Glider", nl:"Paraglider"},
};
const BUILD_STAT_SECTIONS = [
  {en:"Speed", nl:"Snelheid", rows:[["speedLand","Ground","Grond"],["speedWater","Water","Water"],["speedGliding","Air","Lucht"],["speedAntiGravity","Anti-Gravity","Antizwaartekracht"]]},
  {en:"Handling", nl:"Wegligging", rows:[["handlingLand","Ground","Grond"],["handlingWater","Water","Water"],["handlingGliding","Air","Lucht"],["handlingAntiGravity","Anti-Gravity","Antizwaartekracht"]]},
  {en:"Other", nl:"Overig", rows:[["acceleration","Acceleration","Acceleratie"],["miniTurbo","Mini-Turbo","Mini-Turbo"],["weight","Weight","Gewicht"],["traction","Traction","Grip"],["invincibility","Invincibility","Onkwetsbaarheid"]]},
];
function buildContributions(key) {
  const parts = Object.fromEntries(["character","body","tire","glider"].map(category => [category, Math.max(0, Number(buildPart(category)?.stats?.[key] || 0))]));
  return {...parts, total: Math.min(buildCatalog.effectiveCap, parts.character + parts.body + parts.tire + parts.glider)};
}
function buildTotal(key) { return Math.min(buildCatalog.effectiveCap,["character","body","tire","glider"].reduce((sum,category)=>sum+Number(buildPart(category)?.stats?.[key]||0),0)); }
function renderBuild() {
  if(!buildCatalog||!buildParts("character").length){$("#build-pickers").innerHTML=`<p class="empty-row">Build catalog is unavailable in this package.</p>`;return;}
  const categories=["character","body","tire","glider"];
  for(const category of categories) if(!buildSelection[category]) buildSelection[category]=buildParts(category)[0].id;
  const speed=buildTotal("speedLand"),mini=buildTotal("miniTurbo"),optimum=Math.abs(speed+mini-8)<.001&&speed<=mini,meta=Math.abs(speed-3.25)<.001&&Math.abs(mini-4.75)<.001;
  $("#build-feedback").innerHTML=`<div class="build-headline"><div><span>${tr("Speed","Snelheid")}</span><strong>${speed.toFixed(2)}</strong></div><div><span>Mini-Turbo</span><strong>${mini.toFixed(2)}</strong></div></div><span class="build-flag ${optimum?"yes":"no"}" title="Ground Speed + Mini-Turbo must equal 8.00 and Speed may not exceed Mini-Turbo.">${optimum?"✓ Optimum Build":"✕ Not optimum"}</span><span class="build-flag ${meta?"meta":"no"}" title="The Meta is exactly 3.25 Ground Speed and 4.75 Mini-Turbo.">${meta?"★ The Meta":"☆ Not The Meta"}</span><p>${meta?tr("The Meta is active.","De meta is actief."):optimum?tr("Optimum: Magic 8 is met and the build leans toward Mini-Turbo.","Optimaal: Magic 8 is behaald en de combinatie leunt naar Mini-Turbo."):`${tr("Speed","Snelheid")} + Mini-Turbo is ${(speed+mini).toFixed(2)} (${tr("target","doel")} 8.00)${speed>mini?`; ${tr("Speed is too high.","Snelheid is te hoog.")}`:"."}`} ${tr("Meta target: combine any character, body, tires and glider that reach exactly 3.25 Ground Speed and 4.75 Mini-Turbo. Optimum alternatives follow the Magic 8 rule: both stats total 8.00 and Ground Speed is not higher than Mini-Turbo.","Meta-doel: combineer een coureur, chassis, banden en paraglider die samen exact 3.25 grondsnelheid en 4.75 Mini-Turbo bereiken. Optimale alternatieven volgen de Magic 8-regel: beide waarden zijn samen 8.00 en grondsnelheid is niet hoger dan Mini-Turbo.")}</p>`;
  const selectedCards=categories.map(category=>{const part=buildPart(category);return `<button type="button" class="build-picker ${buildPickerCategory===category?"active":""}" style="--build-part:${BUILD_PART_COLORS[category].segment}" data-build-open="${category}" aria-expanded="${buildPickerCategory===category}"><span>${category==="tire"?"Tires":category[0].toUpperCase()+category.slice(1)}</span><img data-build-image="${category}" src="/api/game-asset?path=${encodeURIComponent(buildIcon(part))}" alt=""><strong>${escapeHtml(part.name)}</strong></button>`}).join("");
  const activeParts=buildPickerCategory?buildParts(buildPickerCategory):[];
  const picker=buildPickerCategory?`<section class="build-option-panel"><input type="search" data-build-filter placeholder="Search ${buildPickerCategory}" aria-label="Search ${buildPickerCategory}"><div class="build-option-grid">${activeParts.map(part=>`<button type="button" data-build-option="${escapeHtml(part.id)}" data-build-name="${escapeHtml(dutchSearchText(part.name))}" class="${part.id===buildSelection[buildPickerCategory]?"selected":""}"><img src="/api/game-asset?path=${encodeURIComponent(buildIcon(part))}" alt=""><span>${escapeHtml(part.name)}</span></button>`).join("")}</div></section>`:"";
  $("#build-pickers").innerHTML=`<div class="build-selected">${selectedCards}</div>${picker}`;
  $$('[data-build-open]').forEach(button=>button.addEventListener("click",()=>{buildPickerCategory=buildPickerCategory===button.dataset.buildOpen?null:button.dataset.buildOpen;renderBuild()}));
  $$('[data-build-option]').forEach(button=>button.addEventListener("click",()=>{buildSelection[buildPickerCategory]=button.dataset.buildOption;buildPickerCategory=null;renderBuild()}));
  $('[data-build-filter]')?.addEventListener("input",event=>{const query=event.currentTarget.value.trim().toLowerCase();$$('[data-build-name]').forEach(button=>button.hidden=query&& !button.dataset.buildName.includes(query))});
  $$('[data-build-image]').forEach(image=>image.addEventListener("error",()=>{const part=buildPart(image.dataset.buildImage);if(part&&image.src!==part.iconPath)image.src=`/api/game-asset?path=${encodeURIComponent(part.baseIconPath||part.iconPath)}`} ,{once:true}));
  // Web's meter: one segment per part in the part's colour with its contribution printed on it,
  // a hairline at every whole point, and "total/cap" beside it; all 13 stats in three groups.
  const cap=buildCatalog.effectiveCap;
  const partName=category=>tr(BUILD_PART_COLORS[category].en,BUILD_PART_COLORS[category].nl);
  $("#build-stats-title").textContent=tr("Build stats","Kartstatistieken");
  $("#build-legend").innerHTML=categories.map(category=>`<li><span class="build-swatch" style="--build-part:${BUILD_PART_COLORS[category].segment}"></span>${partName(category)}</li>`).join("");
  const statRow=([key,en,nl])=>{
    const parts=buildContributions(key);
    const label=`${tr(en,nl)}: ${parts.total.toFixed(2)} / ${cap.toFixed(2)} - `+categories.filter(category=>parts[category]>0).map(category=>`${partName(category)} +${parts[category].toFixed(2)}`).join(", ");
    const segments=categories.filter(category=>parts[category]>0).map(category=>`<span class="build-segment" style="flex-grow:${parts[category]};--build-part:${BUILD_PART_COLORS[category].segment};--build-ink:${BUILD_PART_COLORS[category].text}" title="${partName(category)} +${parts[category].toFixed(2)}"><span>${parts[category].toFixed(2)}</span></span>`).join("");
    const ticks=Array.from({length:Math.floor(cap)},(_,index)=>`<span class="build-tick" style="left:${((index+1)/cap*100).toFixed(3)}%"></span>`).join("");
    return `<div class="build-row"><span class="build-row-label">${tr(en,nl)}</span><div class="build-meter" role="img" aria-label="${escapeHtml(label)}"><div class="build-fill" style="width:${(parts.total/cap*100).toFixed(2)}%">${segments}</div>${ticks}</div><span class="build-row-value">${parts.total.toFixed(2)}/${cap.toFixed(2)}</span></div>`;
  };
  const groups=BUILD_STAT_SECTIONS.map(section=>`<section class="build-group"><h3>${tr(section.en,section.nl)}</h3>${section.rows.map(statRow).join("")}</section>`).join("");
  $("#build-stats").innerHTML=groups;
}

async function loadBuild() {
  try {
    const [catalog,variants]=await Promise.all([fetch("/api/build-catalog",{cache:"no-store"}).then(r=>r.json()),fetch("/loadout-variants.json",{cache:"no-store"}).then(r=>r.json())]);
    buildCatalog=catalog;buildVariants=variants;renderBuild();if(progress)renderHighlights();
  } catch(_){renderBuild()}
}

function notificationText(row) {
  const actor = row.actorDisplayName || tr("Someone", "Iemand");
  if (row.kind === "time_beaten") return tr(`${actor} beat your Time Trial time`, `${actor} heeft jouw Time Trial-tijd verbeterd`);
  if (row.kind === "reaction_received") return tr("A Player reacted to your Time Trial", "Een speler reageerde op jouw Time Trial");
  if (row.kind === "claim_decided") return row.detail === "verified" ? tr("Your Player claim was approved", "Jouw spelerclaim is goedgekeurd") : tr("Your Player claim was declined", "Jouw spelerclaim is afgewezen");
  if (row.kind === "result_published") return tr("Your Time Trial was published", "Jouw Time Trial is gepubliceerd");
  if (row.kind === "world_record") return tr(`A new ${row.mode || ""}cc World Record was set; Mastery has been recalculated`, `Er is een nieuw ${row.mode || ""}cc-wereldrecord; Mastery is opnieuw berekend`);
  if (row.kind === "group_invited") return tr(`${actor} invited you to ${row.groupName || "a group"}`, `${actor} heeft je uitgenodigd voor ${row.groupName || "een groep"}`);
  if (row.kind === "group_joined") return tr(`${actor} joined ${row.groupName || "your group"}`, `${actor} is lid geworden van ${row.groupName || "jouw groep"}`);
  if (row.kind === "group_left") return tr(`${actor} left ${row.groupName || "your group"}`, `${actor} heeft ${row.groupName || "jouw groep"} verlaten`);
  if (["group_removed", "group_role_changed"].includes(row.kind)) return tr(`${row.groupName || "A group"} was updated`, `${row.groupName || "Een groep"} is gewijzigd`);
  return tr("Time Trial notification", "Time Trial-melding");
}

function renderTopStatus(document) {
  const pending = Number.isInteger(document.pendingCount) ? document.pendingCount : 0;
  const sync = $("#sync-status");
  sync.classList.toggle("synchronized", pending === 0);
  sync.classList.toggle("waiting", pending > 0);
  sync.setAttribute("aria-label", pending === 0 ? tr("All results synchronized", "Alle resultaten zijn gesynchroniseerd") : tr(`${pending} results waiting to sync`, `${pending} resultaten wachten op synchronisatie`));
  sync.querySelector(".counter").textContent = pending > 0 ? String(Math.min(99, pending)) : "";

  if (document.update) availableUpdate = document.update;
  const view = document.view || {};
  const notifications = Array.isArray(view.notifications) ? view.notifications : [];
  const unread = Number.isInteger(view.unreadNotificationCount) ? view.unreadNotificationCount : 0;
  const total = unread + (availableUpdate ? 1 : 0);
  $("#notifications-toggle .counter").textContent = total ? String(Math.min(99, total)) : "";
  const items = [];
  renderUpdateBanner();
  if (availableUpdate) items.push(`<article class="notification update"><strong>${availableUpdate.required ? tr("Windows update required", "Windows-update vereist") : tr("Windows update available", "Windows-update beschikbaar")}</strong><p>${tr(`Version ${availableUpdate.version} is available. This reminder stays until you install it.`, `Versie ${availableUpdate.version} is beschikbaar. Deze herinnering blijft staan totdat je deze installeert.`)}</p><a href="${escapeHtml(availableUpdate.downloadUrl)}" target="_blank" rel="noreferrer">${tr("Open download", "Download openen")}</a></article>`);
  for (const row of notifications) items.push(`<article class="notification ${row.read ? "" : "unread"}"><strong>${escapeHtml(notificationText(row))}</strong><small>${relativeTime(row.lastEventAtMs)}</small></article>`);
  $("#notifications-list").innerHTML = items.length ? items.join("") : `<p class="empty-row">${tr("No notifications yet.", "Nog geen meldingen.")}</p>`;
}

// Below the site's floor this version no longer sends (owner 2026-09-28): say so at the top of
// every tab, with the download; capture, analysis and saved runs keep working.
function renderUpdateBanner() {
  const banner = $("#update-banner"), update = availableUpdate;
  banner.classList.toggle("hidden", !update?.required);
  if (!update?.required) return;
  banner.innerHTML = `<p><strong>${escapeHtml(tr(`This LiveTrial (${update.currentVersion || ""}) is no longer supported.`, `Deze LiveTrial (${update.currentVersion || ""}) wordt niet meer ondersteund.`))}</strong>
    ${escapeHtml(tr(`Install ${update.version} to send results again. Capture, analysis and your saved runs keep working; nothing is lost.`, `Installeer ${update.version} om weer te versturen. Opnemen, analyseren en je opgeslagen ritten blijven werken; er gaat niets verloren.`))}</p>
    <a class="update-banner-download" href="${escapeHtml(update.downloadUrl)}" target="_blank" rel="noreferrer">${tr("Download the update", "Update downloaden")}</a>`;
}

// The refresh control doubles as the sync clock (owner 2026-09-27): when the copy was fetched,
// coloured by freshness, and whether the last attempt worked.
let lastSync = {state: "loading", atMs: null};
const FRESH_MS = 60 * 60 * 1000;
function renderSync() {
  const button = $("#refresh");
  const {state, atMs} = lastSync;
  const when = Number.isFinite(atMs) ? new Date(atMs) : null;
  const today = when && when.toDateString() === new Date().toDateString();
  const time = when ? when.toLocaleTimeString(localeTag(), {hour: "2-digit", minute: "2-digit"}) : "";
  const stamp = when ? (today ? time : `${shortDate(atMs)} ${time}`) : "";
  const sync = state === "loading" ? "loading" : state === "error" ? "error" : when && Date.now() - atMs < FRESH_MS ? "fresh" : "stale";
  button.dataset.sync = sync;
  $("#sync-label").textContent = sync === "loading" ? tr("Refreshing…", "Vernieuwen…")
    : stamp ? tr(`Synced ${stamp}`, `Gesynchroniseerd ${stamp}`) : tr("Refresh progress", "Voortgang vernieuwen");
  $("#sync-detail").textContent = sync === "loading" ? tr("example.invalid", "example.invalid")
    : sync === "error" ? (state === "error" && lastSync.signedOut ? tr("Signed out · sign in again", "Afgemeld · meld opnieuw aan") : tr("Last try failed · click to retry", "Laatste poging mislukt · klik om opnieuw te proberen"))
    : sync === "fresh" ? tr("Up to date · click to refresh", "Actueel · klik om te vernieuwen")
    : tr("Older copy · click to refresh", "Oudere kopie · klik om te vernieuwen");
  button.title = when ? tr(`Copy from ${when.toLocaleString("en-GB")}`, `Kopie van ${when.toLocaleString("nl-NL")}`) : "";
}
setInterval(() => { if (lastSync.state !== "loading") renderSync(); }, 60000);

function render(document) {
  renderTopStatus(document);
  const fetchedAt = document.view?.fetchedAtMs;
  lastSync = {
    state: document.needsSignIn || !document.view || document.status === "unavailable" ? "error" : "done",
    // Signed out is its own reason on the sync button, not "last try failed".
    signedOut: Boolean(document.needsSignIn),
    atMs: Number.isFinite(fetchedAt) ? fetchedAt : null,
  };
  renderSync();
  window.document.body.classList.toggle("public-rank", document.status === "public");
  const status = $("#status");
  status.className = `status ${document.status === "live" || document.status === "public" ? "" : document.status === "cached" ? "cached" : "error"}`;
  $("#status-copy").textContent = dutchText(document.message || (document.status === "live" ? "Up to date with example.invalid." : "Showing the latest safe offline copy."));
  const copyAt = document.view?.fetchedAtMs;
  if (document.needsSignIn && Number.isFinite(copyAt)) {
    // An expired sign-in otherwise looks like a normal offline moment; say how old and how to fix it.
    const days = Math.floor(Math.max(0, Date.now() - copyAt) / 86400000);
    const age = days === 0 ? tr("from today", "van vandaag") : tr(`from ${shortDate(copyAt)}, ${days} ${days === 1 ? "day" : "days"} old`, `van ${shortDate(copyAt)}, ${days} ${days === 1 ? "dag" : "dagen"} oud`);
    status.className = "status error";
    $("#status-copy").textContent = actionSecret()
      ? tr(`${document.needsSignIn} is signed out: this is your copy ${age}. Sign in again to update it and send waiting results.`,
        `${document.needsSignIn} is afgemeld: dit is je kopie ${age}. Meld je opnieuw aan om hem bij te werken en wachtende resultaten te verzenden.`)
      : tr(`${document.needsSignIn} is signed out: this is your copy ${age}. Sign in again in the LiveTrial window (choose S) to update it and send waiting results.`,
        `${document.needsSignIn} is afgemeld: dit is je kopie ${age}. Meld je opnieuw aan in het LiveTrial-venster (kies S) om hem bij te werken en wachtende resultaten te verzenden.`);
    $("#status .status-action-button")?.remove();
    if (actionSecret()) {
      const button = window.document.createElement("button");
      button.type = "button"; button.className = "status-action-button"; button.textContent = tr("Sign in again", "Opnieuw aanmelden");
      button.addEventListener("click", () => startSignIn());
      $("#status").append(button);
    }
  } else { $("#status .status-action-button")?.remove(); }
  if (!document.view && document.needsSignIn && actionSecret()) {
    $("#content").classList.add("hidden");
    $("#empty").classList.remove("hidden");
    status.className = "status error";
    $("#status-copy").textContent = tr(`${document.needsSignIn} is signed out on this PC.`, `${document.needsSignIn} is afgemeld op deze pc.`);
    $("#status .status-action-button")?.remove();
    $("#empty-title").textContent = tr(`Sign in again as ${document.needsSignIn}`, `Opnieuw aanmelden als ${document.needsSignIn}`);
    $("#empty-copy").textContent = tr("Your progress and waiting results come back once you sign in again. Capture and run history keep working meanwhile.",
      "Je voortgang en wachtende resultaten komen terug zodra je opnieuw aanmeldt. Opnemen en ritgeschiedenis blijven intussen werken.");
    const button = window.document.createElement("button");
    button.type = "button"; button.className = "status-action-button"; button.textContent = tr("Sign in again", "Opnieuw aanmelden");
    button.addEventListener("click", () => startSignIn());
    $("#status").append(button);
    return;
  }
  if (!document.view) {
    $("#content").classList.add("hidden");
    $("#empty").classList.remove("hidden");
    $("#empty-title").textContent = document.status === "signedOut" ? "RACE. RECORD. IMPROVE." : tr("Player progress is unavailable", "Spelervoortgang is niet beschikbaar");
    $("#empty-copy").textContent = document.status === "signedOut"
      ? tr("Your Mario Kart 8 Deluxe times, captured locally and synchronized when you sign in.", "Jouw Mario Kart 8 Deluxe-tijden, lokaal vastgelegd en gesynchroniseerd zodra je inlogt.")
      : document.message || tr("Capture and local run history still work normally.", "Opname en lokale geschiedenis blijven normaal werken.");
    return;
  }
  progress = document.view;
  if (progress.modePreference === "150" || progress.modePreference === "200") {
    selectedMode = Number(progress.modePreference);
    $$(".mode").forEach(item => {
      const allowed = Number(item.dataset.mode) === selectedMode;
      item.classList.toggle("active", allowed);
      item.hidden = !allowed;
    });
  }
  $("#empty").classList.add("hidden");
  $("#content").classList.remove("hidden");
  $("#player-name").textContent = progress.player.displayName;
  const profile = progress.publicPlayerProfile || {};
  const favorites = [profile.avatarId, profile.favoriteBodyId, profile.favoriteTireId, profile.favoriteGliderId].filter(Boolean);
  if (profile.countryId || profile.timeTrialModePreference || favorites.length) {
    const mode = profile.timeTrialModePreference === "150" ? "150cc" : profile.timeTrialModePreference === "200" ? "200cc" : "150cc + 200cc";
    $("#player-meta").innerHTML = `${escapeHtml(profile.countryId ? tr(profile.countryId.substring(8).toUpperCase(), (globalThis.MK8DX_DUTCH_PRESENTATION?.byId || {})[profile.countryId] || profile.countryId) : tr("Country not selected", "Land niet geselecteerd"))} · Time Trials ${mode} · <a href="${SITE_ORIGIN}/?player=${encodeURIComponent(profile.playerId || progress.player.playerId)}" target="_blank" rel="noreferrer">${tr("Open public profile", "Openbaar profiel openen")} ↗</a>`;
  } else {
    $("#player-meta").innerHTML = `<a href="${SITE_ORIGIN}/?player=${encodeURIComponent(progress.player.playerId)}" target="_blank" rel="noreferrer">${tr("Open public profile", "Openbaar profiel openen")} ↗</a>`;
  }
  renderRank(progress);
  renderMyRecords();
}

async function load(refresh = false) {
  const button = $("#refresh");
  button.disabled = true;
  lastSync = {...lastSync, state: "loading"};
  renderSync();
  if (refresh) {
    $("#status").className = "status loading";
    $("#status-copy").textContent = tr("Refreshing from example.invalid…", "Vernieuwen vanaf example.invalid…");
  }
  try {
    const response = await fetch(`/api/progress${refresh ? "?refresh=1" : ""}`, {cache:"no-store"});
    const document = await response.json();
    render(document);
    // A refresh that ends on the offline copy did not reach the site.
    if (refresh && document.status === "cached" && lastSync.state !== "error") { lastSync = {...lastSync, state: "error"}; renderSync(); }
  } catch (_) {
    render({status:"unavailable", message:tr("Progress could not be loaded. Capture and run history still work.", "Voortgang kon niet worden geladen. Opname en ritgeschiedenis blijven werken.")});
  } finally {
    button.disabled = false;
  }
}

function showTab(name) {
  if (!["records", "rank", "build", "live", "history"].includes(name) || (name === "live" && !appMode)) name = "records";
  if (name === "records" && document.body.classList.contains("public-rank")) name = "rank";
  $$(".tab").forEach(button => {
    const active = button.dataset.tab === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  $("#progress-panel").classList.toggle("active", name !== "history" && name !== "live");
  $("#progress-panel").dataset.view = name;
  $("#history-panel").classList.toggle("active", name === "history");
  $("#live-panel").classList.toggle("active", name === "live");
  window.scrollTo(0, 0);
  // The local history server can still be starting when the first frame opens.
  // Reopening History retries a failed frame without touching saved runs.
  if (name === "history") reloadHistory(true);
  if (name === "history") { showHistoryView(historyView); loadResults(); }
  if (name === "live") { syncLive(); loadResults(); }
  try { localStorage.setItem("mk8dx.dashboard.tab", name); } catch (_) {}
}

$("#app-icon").addEventListener("error", () => $(".brand-icon").classList.add("fallback"));
// Signed out, the button says "sign in again": then it opens the sign-in, otherwise it refreshes.
$("#refresh").addEventListener("click", () => lastSync.state === "error" && lastSync.signedOut ? startSignIn() : load(true));
$("#sync-status").addEventListener("click", () => actionSecret() ? toggleWaiting() : showTab("history"));
$("#notifications-toggle").addEventListener("click", () => {
  const panel = $("#notifications-panel");
  closePanels(panel.classList.contains("hidden") ? "notifications-panel" : null);
  panel.classList.toggle("hidden");
  $("#notifications-toggle").setAttribute("aria-expanded", panel.classList.contains("hidden") ? "false" : "true");
});
$("#notifications-close").addEventListener("click", () => {
  $("#notifications-panel").classList.add("hidden");
  $("#notifications-toggle").setAttribute("aria-expanded", "false");
});
$$('.tab').forEach(button => button.addEventListener("click", () => showTab(button.dataset.tab)));
$$('.mode').forEach(button => button.addEventListener("click", () => {
  selectedMode = Number(button.dataset.mode);
  $$('.mode').forEach(item => item.classList.toggle("active", Number(item.dataset.mode) === selectedMode));
  levelFilter = null;
  if (progress) renderRank(progress);
  if (progress) renderMyRecords();
}));
$$("[data-rank-tab]").forEach(button => button.addEventListener("click", () => {
  rankTab = button.dataset.rankTab; $$("[data-rank-tab]").forEach(item=>item.classList.toggle("active",item===button)); if(progress) renderRank(progress);
}));
$("#track-search").addEventListener("input",()=>{if(progress)renderRank(progress)});
$("#rank-player-search").addEventListener("input",async event=>{
  rankSearchController?.abort(); rankSearchController=new AbortController();
  const query=event.target.value.trim(), results=$("#rank-player-results"); results.innerHTML="";
  if(query.length<2)return;
  try {
    const response=await fetch(`/api/rank-data?query=${encodeURIComponent(query)}`,{cache:"no-store",signal:rankSearchController.signal});
    const body=await response.json();
    results.innerHTML=(body.players||[]).filter(row=>!selectedRankPlayerIds.includes(row.playerId)).map(row=>`<button type="button" data-add-rank-player="${escapeHtml(row.playerId)}">Compare ${escapeHtml(row.displayName)}</button>`).join("");
    $$('[data-add-rank-player]').forEach(button=>button.addEventListener("click",()=>{
      const row=(body.players||[]).find(candidate=>candidate.playerId===button.dataset.addRankPlayer);
      if(row){toggleRankPlayer(row.playerId,row.displayName);event.target.value="";results.innerHTML=""}
    }));
  } catch(_) {}
});

// ---------------------------------------------------------------- accounts and sending
// Actions are POSTs carrying this launch's secret, which only this page has.
const actionSecret = () => window.document.querySelector('meta[name="livetrial-action"]')?.content || "";
function reloadAfterRestart() {
  try {
    if (Date.now() - Number(sessionStorage.getItem("mk8dx.livetrial.reloaded") || 0) < 30000) return;
    sessionStorage.setItem("mk8dx.livetrial.reloaded", String(Date.now()));
  } catch (_) { return; }
  location.reload();
}
async function action(name, body = {}) {
  const response = await fetch(`/api/action/${name}`, {method: "POST", cache: "no-store",
    headers: {"Content-Type": "application/json", "X-LiveTrial-Action": actionSecret()}, body: JSON.stringify(body)});
  // A 403 means this page holds the secret of an earlier launch: LiveTrial was started again
  // while the window stayed open. Load the page afresh once (owner 2026-09-27: a stale window
  // showed no live feed).
  if (response.status === 403 && actionSecret()) reloadAfterRestart();
  const document = await response.json().catch(() => ({ok: false}));
  if (!document.ok) throw new Error(document.message || tr("That did not work. Nothing was changed.", "Dat lukte niet. Er is niets gewijzigd."));
  return document.result;
}
let accountsCache = [];
const initial = label => (label || "?").trim().charAt(0).toUpperCase();
function closePanels(except) {
  for (const id of ["account-panel", "waiting-panel", "notifications-panel"]) if (id !== except) $(`#${id}`).classList.add("hidden");
  $("#account-toggle").setAttribute("aria-expanded", String(except === "account-panel"));
}
function renderAccountToggle() {
  const active = accountsCache.find(row => row.active);
  $("#account-name").textContent = active ? active.label : tr("Sign in", "Aanmelden");
  $("#account-toggle .account-avatar").textContent = active ? initial(active.label) : "";
  $("#account-toggle").classList.toggle("expired", Boolean(active && !active.signedIn));
}
function renderAccounts(listing, confirmSlot = null) {
  accountsCache = listing.accounts;
  renderAccountToggle();
  $("#account-panel-title").textContent = tr("Accounts on this PC", "Accounts op deze pc");
  $("#account-add").textContent = tr("+ Add account", "+ Account toevoegen");
  $("#account-add").disabled = listing.accounts.length >= listing.limit;
  $("#account-list").innerHTML = listing.accounts.length ? listing.accounts.map(row => `
    <div class="account-row${row.active ? " active" : ""}">
      <span class="account-avatar" aria-hidden="true">${escapeHtml(initial(row.label))}</span>
      <span><strong>${escapeHtml(row.label)}</strong><small class="${row.signedIn ? "" : "expired"}">${row.active ? tr("In use", "In gebruik") + " · " : ""}${row.signedIn ? tr("Signed in", "Aangemeld") : tr("Needs to sign in again", "Moet opnieuw aanmelden")}</small></span>
      <span class="account-row-actions">
        ${row.signedIn ? "" : `<button type="button" class="primary" data-account-signin="${escapeHtml(row.slotId)}">${tr("Sign in again", "Opnieuw aanmelden")}</button>`}
        ${row.active ? "" : `<button type="button" data-account-switch="${escapeHtml(row.slotId)}">${tr("Use", "Gebruiken")}</button>`}
        <button type="button" class="danger" data-account-remove="${escapeHtml(row.slotId)}" aria-label="${escapeHtml(tr(`Remove ${row.label}`, `${row.label} verwijderen`))}">${tr("Remove", "Verwijderen")}</button>
      </span>
      ${confirmSlot === row.slotId ? `<div class="account-confirm">${tr(`Remove ${escapeHtml(row.label)} from this PC? Saved runs stay on this PC.`, `${escapeHtml(row.label)} van deze pc verwijderen? Opgeslagen ritten blijven op deze pc.`)} <button type="button" class="link-button" data-account-remove-yes="${escapeHtml(row.slotId)}">${tr("Yes, remove", "Ja, verwijderen")}</button><button type="button" class="link-button" data-account-remove-no>${tr("Keep", "Houden")}</button></div>` : ""}
    </div>`).join("") : `<p class="empty-row">${tr("No accounts yet. Runs are still recorded and kept on this PC.", "Nog geen accounts. Ritten worden nog steeds op deze pc vastgelegd en bewaard.")}</p>`;
  $$("[data-account-switch]").forEach(button => button.addEventListener("click", () => accountStep(() => action("accounts.switch", {slotId: button.dataset.accountSwitch}), true)));
  $$("[data-account-signin]").forEach(button => button.addEventListener("click", () => startSignIn()));
  $$("[data-account-remove]").forEach(button => button.addEventListener("click", () => renderAccounts({accounts: accountsCache, limit: listing.limit}, button.dataset.accountRemove)));
  $$("[data-account-remove-yes]").forEach(button => button.addEventListener("click", () => accountStep(() => action("accounts.remove", {slotId: button.dataset.accountRemoveYes}), true)));
  $$("[data-account-remove-no]").forEach(button => button.addEventListener("click", () => renderAccounts({accounts: accountsCache, limit: listing.limit})));
  refreshYouTube();
}
async function accountStep(step, reload) {
  try {
    renderAccounts(await step());
    if (reload) { rankViewPlayerId = null; rankScopesInitialized = false; await load(true); }
  } catch (error) {
    $("#account-list").insertAdjacentHTML("afterbegin", `<p class="empty-row error-row">${escapeHtml(error.message)}</p>`);
  }
}
async function refreshAccounts() {
  if (!actionSecret()) { $("#account-toggle").hidden = true; return; }
  try { renderAccounts(await action("accounts.list")); } catch (_) {}
}
$("#account-toggle").addEventListener("click", () => {
  const panel = $("#account-panel");
  const open = panel.classList.contains("hidden");
  closePanels(open ? "account-panel" : null);
  panel.classList.toggle("hidden", !open);
  if (open) refreshAccounts();
});
$("#account-close").addEventListener("click", () => closePanels(null));
$("#account-add").addEventListener("click", () => startSignIn());

// Sign-in: the code to confirm on example.invalid, followed until the site answers.
let signInFlow = null, signInTimer = null;
function signInState(text, kind = "") {
  return `<div class="signin-state ${kind}"><span class="status-dot"></span><span>${text}</span></div>`;
}
async function startSignIn() {
  closePanels(null);
  $("#signin-dialog").classList.remove("hidden");
  $("#signin-title").textContent = tr("Sign in", "Aanmelden");
  $("#signin-body").innerHTML = signInState(tr("Asking example.invalid for a sign-in code…", "Aanmeldcode opvragen bij example.invalid…"));
  try {
    signInFlow = await action("signin.start");
  } catch (error) {
    $("#signin-body").innerHTML = signInState(escapeHtml(error.message), "error");
    return;
  }
  // Two ways in (owner 2026-09-27): an email with a link and a code (ADR-0209), or approving on the site.
  $("#signin-body").innerHTML = `
    <form id="signin-email-form" class="signin-step">
      <label for="signin-email">${tr("Email of your MK8DX account", "E-mail van je MK8DX-account")}</label>
      <div class="signin-row"><input id="signin-email" type="email" autocomplete="email" required maxlength="320" placeholder="name@example.com">
      <button type="submit" class="account-add">${tr("Email me a link and code", "Mail me een link en code")}</button></div>
    </form>
    <form id="signin-code-form" class="signin-step hidden">
      <p id="signin-email-sent"></p>
      <label for="signin-code-input">${tr("Code from the email", "Code uit de e-mail")}</label>
      <div class="signin-row"><input id="signin-code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="7" pattern="[0-9 ]{6,7}" placeholder="123456">
      <button type="submit" class="account-add">${tr("Sign in", "Aanmelden")}</button></div>
      <p class="signin-hint">${tr("Or click the button in the email. No email? Check spam, or send it again.", "Of klik op de knop in de e-mail. Geen e-mail? Kijk in je spam of stuur hem opnieuw.")} <button type="button" id="signin-resend" class="link-button">${tr("Send again", "Opnieuw sturen")}</button></p>
    </form>
    <details class="signin-alt">
      <summary>${tr("Or approve on example.invalid", "Of keur goed op example.invalid")}</summary>
      <p>${tr("Check that the site shows this code:", "Controleer dat de site deze code toont:")}</p>
      <div class="signin-code">${escapeHtml(signInFlow.userCode)}</div>
      <a class="account-add" href="${escapeHtml(signInFlow.verificationUriComplete)}" target="_blank" rel="noreferrer">${tr("Open the approval page", "Open de goedkeuringspagina")}</a>
    </details>
    <div id="signin-feedback"></div>
    <div id="signin-progress">${signInState(tr("Waiting for your approval…", "Wachten op je goedkeuring…"))}</div>`;
  const feedback = (text, kind = "error") => { $("#signin-feedback").innerHTML = text ? `<p class="signin-feedback ${kind}">${escapeHtml(text)}</p>` : ""; };
  const sendEmail = async () => {
    const email = $("#signin-email").value.trim();
    feedback("");
    try {
      await action("signin.email", {flowId: signInFlow.flowId, email});
      $("#signin-email-sent").textContent = tr(`If ${email} belongs to an MK8DX account with a Player, a link and a code are on their way.`,
        `Als ${email} bij een MK8DX-account met een speler hoort, zijn een link en een code onderweg.`);
      $("#signin-code-form").classList.remove("hidden");
      $("#signin-code-input").focus();
    } catch (error) { feedback(error.message); }
  };
  $("#signin-email-form").addEventListener("submit", event => { event.preventDefault(); sendEmail(); });
  $("#signin-resend").addEventListener("click", () => sendEmail());
  $("#signin-code-form").addEventListener("submit", async event => {
    event.preventDefault();
    feedback("");
    try {
      await action("signin.code", {flowId: signInFlow.flowId, code: $("#signin-code-input").value});
      feedback(tr("Code accepted. Signing in…", "Code geaccepteerd. Aanmelden…"), "ok");
      pollSignIn();
    } catch (error) { feedback(error.message); }
  });
  $("#signin-email").focus();
  clearInterval(signInTimer);
  signInTimer = setInterval(pollSignIn, 2000);
}
async function pollSignIn() {
  if (!signInFlow) return;
  let status;
  try { status = await action("signin.status", {flowId: signInFlow.flowId}); } catch (_) { return; }
  if (status.state === "pending") return;
  clearInterval(signInTimer); signInTimer = null;
  const messages = {
    signed_in: [tr(`Signed in as ${escapeHtml(status.account?.label || "")}.`, `Aangemeld als ${escapeHtml(status.account?.label || "")}.`), "done"],
    denied: [tr("The approval was refused on the site. Nothing was changed.", "De goedkeuring is geweigerd op de site. Er is niets gewijzigd."), "error"],
    expired: [tr("The code expired. Start again for a new one.", "De code is verlopen. Begin opnieuw voor een nieuwe."), "error"],
    cancelled: [tr("Sign-in cancelled.", "Aanmelden geannuleerd."), "error"],
    failed: [tr("Signing in did not finish. Nothing was changed.", "Aanmelden is niet gelukt. Er is niets gewijzigd."), "error"],
  };
  const [text, kind] = messages[status.state] || messages.failed;
  const progress = $("#signin-progress");
  if (progress) progress.innerHTML = signInState(text, kind);
  if (status.state === "signed_in") {
    rankViewPlayerId = null; rankScopesInitialized = false;
    await refreshAccounts();
    await load(true);
    setTimeout(() => $("#signin-dialog").classList.add("hidden"), 1200);
  }
}
$("#signin-close").addEventListener("click", async () => {
  $("#signin-dialog").classList.add("hidden");
  clearInterval(signInTimer); signInTimer = null;
  if (signInFlow) { try { await action("signin.cancel", {flowId: signInFlow.flowId}); } catch (_) {} signInFlow = null; }
});

// Waiting results: grouped by the account that recorded them; each goes out with its own account.
function renderWaiting(waiting) {
  $("#waiting-title").textContent = tr("Waiting to be sent", "Wacht op verzending");
  $("#waiting-send").textContent = tr("Send now", "Nu verzenden");
  $("#waiting-history").textContent = tr("Open run history", "Ritgeschiedenis openen");
  const reasons = {
    ready: tr("Goes out with this account", "Gaat mee met dit account"),
    sign_in_again: tr("Waits until this account signs in again", "Wacht tot dit account opnieuw aanmeldt"),
    account_removed: tr("Its account was removed from this PC; kept here", "Het account is van deze pc verwijderd; blijft hier bewaard"),
    update_required: tr("This LiveTrial version is no longer supported; update it to send", "Deze LiveTrial-versie wordt niet meer ondersteund; update om te versturen"),
    no_account: tr("Recorded while no account was signed in, so it is only on this PC. Choose Send as to put it on your account.", "Opgenomen terwijl er geen account was aangemeld, dus alleen op deze pc. Kies Verstuur als om hem op je account te zetten."),
    account_mismatch: tr("Does not match its account; kept here", "Past niet bij het account; blijft hier bewaard"),
  };
  $("#waiting-list").innerHTML = waiting.total ? waiting.groups.map(group => `
    <div class="waiting-row${group.reason === "ready" ? "" : " blocked"}"><span><strong>${escapeHtml(group.label || (group.reason === "update_required" ? tr("All results", "Alle ritten") : tr("No account", "Geen account")))}</strong><small>${escapeHtml(reasons[group.reason] || "")}</small></span><span class="waiting-actions">${group.reason === "no_account" ? sendAsButton(null) : ""}<b>${group.count}</b></span></div>`).join("")
    : `<p class="empty-row">${tr("Everything has been sent.", "Alles is verzonden.")}</p>`;
  bindSendButtons($("#waiting-list"));
  $("#waiting-send").disabled = !waiting.groups.some(group => group.reason === "ready");
}
async function toggleWaiting() {
  const panel = $("#waiting-panel");
  const open = panel.classList.contains("hidden");
  closePanels(open ? "waiting-panel" : null);
  panel.classList.toggle("hidden", !open);
  if (open) { try { renderWaiting(await action("results.waiting")); } catch (error) { $("#waiting-list").innerHTML = `<p class="empty-row">${escapeHtml(error.message)}</p>`; } }
}
$("#waiting-close").addEventListener("click", () => closePanels(null));
$("#waiting-history").addEventListener("click", () => { closePanels(null); historyView = "status"; showTab("history"); });
$("#waiting-send").addEventListener("click", async () => {
  $("#waiting-send").disabled = true;
  try {
    const sent = await action("results.send");
    renderWaiting(sent.waiting);
    $("#waiting-list").insertAdjacentHTML("afterbegin", `<p class="empty-row">${tr(`Sent ${sent.sent} of ${sent.attempted}.`, `${sent.sent} van ${sent.attempted} verzonden.`)}</p>`);
    await load(false);
  } catch (error) {
    $("#waiting-list").insertAdjacentHTML("afterbegin", `<p class="empty-row">${escapeHtml(error.message)}</p>`);
    $("#waiting-send").disabled = false;
  }
});

// ---------------------------------------------------------------- the app (ADR-0208 steps 2-4)
// Shown only when LiveTrial runs as the visual app (its server offers app.status); a dashboard
// opened from the troubleshooting menu keeps accounts and sending only.
let appMode = false, appStatus = null, appTimer = null, lastJobKey = null, lastSavedKey = null, liveUp = false, lastRunTimer = 0;
let historyManagedByApp = false;
function appDialog(title, html) {
  closePanels(null);
  $("#app-dialog-title").textContent = title;
  $("#app-dialog-body").innerHTML = html;
  $("#app-dialog").classList.remove("hidden");
}
const closeAppDialog = () => $("#app-dialog").classList.add("hidden");
$("#app-dialog-close").addEventListener("click", closeAppDialog);
const dialogError = text => { const box = $("#app-dialog-body .dialog-error"); if (box) box.innerHTML = text ? `<p class="signin-feedback error">${escapeHtml(text)}</p>` : ""; };

function renderCaptureBar() {
  const status = appStatus;
  if (!status) return;
  const job = status.job, busy = status.busy;
  const button = $("#capture-button"), analyse = $("#analyze-button"), line = $("#capture-status");
  button.classList.toggle("running", busy);
  button.textContent = busy ? (job?.state === "stopping" ? tr("Stopping…", "Stoppen…") : tr("■ Stop", "■ Stoppen")) : tr("● Start capture", "● Opname starten");
  button.disabled = job?.state === "stopping" || (!busy && !status.engineAvailable);
  analyse.textContent = tr("Analyse a video", "Video analyseren");
  analyse.disabled = busy || !status.engineAvailable;
  line.classList.toggle("failed", !busy && job?.state === "failed");
  if (busy && job) {
    const what = job.kind === "capture" ? tr(`Capturing from <b>${escapeHtml(job.label)}</b>`, `Opname van <b>${escapeHtml(job.label)}</b>`)
      : tr(`Analysing <b>${escapeHtml(job.label)}</b>`, `<b>${escapeHtml(job.label)}</b> analyseren`);
    const live = job.kind === "capture" ? ` · <a href="#" id="show-live">${tr("show the live picture", "toon het livebeeld")}</a>` : "";
    line.innerHTML = `<span class="live-dot"></span>${what} · ${tr(`${job.saved} run(s) saved`, `${job.saved} rit(ten) opgeslagen`)}${live}`;
    $("#show-live")?.addEventListener("click", event => { event.preventDefault(); showTab("live"); });
  } else if (job && (job.state === "done" || job.state === "failed")) {
    const finished = job.kind === "capture" ? tr("Capture ended.", "Opname beëindigd.") : tr("Analysis finished.", "Analyse klaar.");
    line.innerHTML = job.state === "done" ? `${finished} ${escapeHtml(tr(job.message, job.message.replace("run(s) saved", "rit(ten) opgeslagen")))}` : escapeHtml(job.message);
  } else if (!status.engineAvailable) {
    line.textContent = tr("The recognition engine is not part of this installation.", "De herkenningsengine hoort niet bij deze installatie.");
  } else {
    line.textContent = status.ffmpegAvailable ? tr("Ready. Choose Start capture to record from the capture card.", "Klaar. Kies Opname starten om van de capturekaart op te nemen.")
      : tr("Capture needs FFmpeg; Start capture explains how to install it. Analysing a video works without it.", "Opnemen heeft FFmpeg nodig; Opname starten legt uit hoe je het installeert. Een video analyseren werkt zonder.");
  }
  // When a job starts or ends the run history changes hands (engine vs. history server): reload it.
  const key = job ? `${job.kind}:${job.startedAtMs}:${busy}` : "none";
  if (lastJobKey !== null && key !== lastJobKey) {
    if (busy && job?.kind === "capture") { liveUp = false; sessionSeen = null; showTab("live"); }
    if (!busy) { liveUp = false; setTimeout(reloadHistory, 2500); load(false); loadResults(); }
  }
  lastJobKey = key;
  const saved = job ? `${job.startedAtMs}:${job.saved}` : "none";
  if (lastSavedKey !== null && saved !== lastSavedKey && job?.saved) loadResults();
  lastSavedKey = saved;
  if (busy && job?.kind === "capture") refreshGhosts();
  syncLive();
}
// The engine owns 127.0.0.1:8777 while it captures (the live picture) and the run-history
// server owns it otherwise, so the Live tab shows the engine and Run history waits for it.
function capturing() { return Boolean(appStatus?.busy && appStatus.job?.kind === "capture"); }
function syncLive() {
  const live = capturing(), frame = $("#live-frame");
  // Visible on every tab: the Live tab itself says whether capture is on (owner 2026-09-27).
  const tab = $(".tab[data-tab='live']");
  tab.classList.toggle("on-air", live);
  tab.title = live ? tr("Capture is on", "Opname staat aan") : tr("Capture is off", "Opname staat uit");
  tab.setAttribute("aria-label", `Live: ${tab.title}`);
  // Between Start and the engine answering (it loads recognition first, ~20 s) Live says so,
  // instead of an empty box that looks like a dead feed (owner 2026-09-27).
  const starting = live && !appStatus.liveReady && !liveUp;
  $("#live-idle").classList.toggle("hidden", live && !starting);
  $("#live-idle").classList.toggle("starting", starting);
  $("#live-start").classList.toggle("hidden", starting);
  frame.classList.toggle("hidden", !live || starting);
  $("#live-idle-text").textContent = starting
    ? tr("The engine is starting: it loads the recognition first, which takes about 20 seconds. The live picture appears here by itself.",
      "De engine start op: eerst wordt de herkenning geladen, dat duurt ongeveer 20 seconden. Het livebeeld verschijnt hier vanzelf.")
    : tr("Not capturing. Start capture and the live picture appears here, with every trigger the engine recognises and each finished race as it comes in.",
      "Er loopt geen opname. Start een opname en het livebeeld verschijnt hier, met elke trigger die de engine herkent en elke uitgereden rit zodra die binnenkomt.");
  $("#live-start").textContent = tr("● Start capture", "● Opname starten");
  $("#live-start").disabled = Boolean(appStatus?.busy) || !appStatus?.engineAvailable;
  if (!live) { if (frame.getAttribute("src")) frame.removeAttribute("src"); return; }
  // The engine needs a few seconds to start serving; the app says when it answers. Its
  // history then comes from the engine too, so Run history reloads once.
  if (liveUp || !appStatus.liveReady) return;
  liveUp = true;
  loadLiveFrame();
  reloadHistory();
}
// The live view reports its height as soon as it shows the capture. If it has not within 8 s
// (the port changed hands at the wrong moment, a hiccup), load it again instead of staying blank.
let liveFrameLoadedAt = 0, liveFrameShownAt = 0;
// A frame that navigates again adds an entry to the window's history, and a window with history
// may not close itself: Quit then left the app window open (owner 2026-10-29). A fresh frame's
// first page replaces its blank start instead, so the window keeps one entry and Quit closes it.
function navigateFrame(id, url) {
  const old = $(`#${id}`), fresh = old.cloneNode(false);
  fresh.src = url;
  old.replaceWith(fresh);
}
function loadLiveFrame() {
  liveFrameLoadedAt = Date.now(); liveFrameShownAt = 0;
  navigateFrame("live-frame", `${historyUrl}?view=live&embedded=1&theme=dark&lang=${language}&t=${Date.now()}`);
}
setInterval(() => {
  if (liveUp && capturing() && !liveFrameShownAt && Date.now() - liveFrameLoadedAt > 8000) loadLiveFrame();
}, 2000);
// The engine's live block says how tall it is, so the frame fits it and never scrolls on its own.
window.addEventListener("message", event => {
  if (event.origin !== new URL(historyUrl).origin || event.source !== $("#live-frame").contentWindow) return;
  const height = Number(event.data && event.data.livetrialHeight);
  if (Number.isFinite(height) && height > 0 && height < 20000) {
    $("#live-frame").style.height = `${Math.ceil(height) + 4}px`;
    liveFrameShownAt = Date.now();
  }
});
// Run history: every run (the engine's history, also while capturing) or the send status table.
let historyView = "all";
function showHistoryView(view) {
  historyView = view === "status" ? "status" : "all";
  $$("[data-history-view]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.historyView === historyView)));
  $("#history-all").textContent = tr("All runs", "Alle ritten");
  $("#history-status").textContent = tr("Send status & corrections", "Verzendstatus & correcties");
  $("#clips-open").textContent = tr("Clips & YouTube", "Clips & YouTube");
  $("#history-frame").classList.toggle("hidden", historyView !== "all");
  $("#results-block").classList.toggle("hidden", historyView !== "status" || !appMode);
}
$$("[data-history-view]").forEach(button => button.addEventListener("click", () => showHistoryView(button.dataset.historyView)));
$("#live-start").addEventListener("click", () => $("#capture-button").click());
function reloadHistory(force = false) {
  const frame = $("#history-frame");
  const waiting = historyManagedByApp && appStatus?.historyReady !== true;
  $("#history-loading").classList.toggle("hidden", !waiting);
  $("#history-loading").textContent = tr("Run history is starting…", "Ritgeschiedenis wordt gestart…");
  if (waiting) {
    frame.removeAttribute("src");
    return;
  }
  if (force || frame.getAttribute("src")) navigateFrame("history-frame", `${historyUrl}?view=history&theme=dark&lang=${language}&t=${Date.now()}`);
}
async function pollApp() {
  try {
    const wasReady = appStatus?.historyReady === true;
    appStatus = await action("app.status");
    renderCaptureBar();
    if ($("#history-panel").classList.contains("active") && (wasReady !== (appStatus.historyReady === true) || (appStatus.historyReady && !$("#history-frame").getAttribute("src")))) reloadHistory(true);
  } catch (_) {}
}
async function startApp() {
  if (!actionSecret()) return;
  try { appStatus = await action("app.status"); } catch (_) { return; }
  appMode = true;
  $$(".app-only").forEach(node => node.classList.remove("hidden"));
  renderCaptureBar();
  if ($("#history-panel").classList.contains("active")) reloadHistory(true);
  clearInterval(appTimer);
  appTimer = setInterval(pollApp, 3000);
  loadResults();
}

// Capture: choose the capture card, check one still picture, start; Stop asks the engine to end cleanly.
$("#capture-button").addEventListener("click", async () => {
  if (appStatus?.busy) {
    try { appStatus = { ...appStatus, job: await action("job.stop") }; renderCaptureBar(); } catch (error) { $("#capture-status").textContent = error.message; }
    return;
  }
  appDialog(tr("Start capture", "Opname starten"), `<p>${tr("Looking for video devices…", "Videoapparaten zoeken…")}</p><div class="dialog-error"></div>`);
  let listing;
  try { listing = await action("capture.devices"); } catch (error) { $("#app-dialog-body").innerHTML = `<p class="signin-feedback error">${escapeHtml(error.message)}</p>`; return; }
  if (!listing.devices.length) {
    $("#app-dialog-body").innerHTML = `<p>${tr("No video device was found. Connect the capture card, wait a few seconds and try again.", "Er is geen videoapparaat gevonden. Sluit de capturekaart aan, wacht een paar seconden en probeer het opnieuw.")}</p>`;
    return;
  }
  const chosen = listing.devices.find(device => device.remembered) || listing.devices[0];
  $("#app-dialog-body").innerHTML = `
    <p>${tr("Which one is the capture card?", "Welke is de capturekaart?")}</p>
    <div class="device-list">${listing.devices.map(device => `<label class="device-option"><input type="radio" name="device" value="${device.index}" ${device.index === chosen.index ? "checked" : ""}> <span>${escapeHtml(device.name)}${device.remembered ? ` <small>(${tr("used last time", "vorige keer gebruikt")})</small>` : ""}</span></label>`).join("")}</div>
    <img id="device-preview" class="device-preview hidden" alt="">
    <p id="device-question" class="hidden">${tr("Is that your Switch?", "Is dat je Switch?")}</p>
    <div class="dialog-error"></div>
    <div class="dialog-actions">
      <button type="button" id="device-check" class="capture-secondary">${tr("Check the picture", "Beeld controleren")}</button>
      <button type="button" id="device-start" class="account-add">${tr("Start capture", "Opname starten")}</button>
    </div>`;
  const selected = () => Number($("#app-dialog-body input[name=device]:checked").value);
  $("#device-check").addEventListener("click", async () => {
    dialogError(""); $("#device-check").disabled = true; $("#device-check").textContent = tr("Taking a picture…", "Foto maken…");
    try {
      const shot = await action("capture.preview", {index: selected()});
      $("#device-preview").src = shot.previewUrl; $("#device-preview").classList.remove("hidden"); $("#device-question").classList.remove("hidden");
    } catch (error) { dialogError(error.message); }
    $("#device-check").disabled = false; $("#device-check").textContent = tr("Check the picture", "Beeld controleren");
  });
  $("#device-start").addEventListener("click", async () => {
    dialogError("");
    try {
      appStatus = { ...appStatus, busy: true, job: await action("capture.start", {index: selected()}) };
      closeAppDialog(); renderCaptureBar();
      liveUp = false; showTab("live");
    } catch (error) { dialogError(error.message); }
  });
});

// Analyse a video: choose the file (copied into LiveTrial's folder) or paste its path.
$("#analyze-button").addEventListener("click", () => {
  appDialog(tr("Analyse a video", "Video analyseren"), `
    <div class="dialog-field"><label for="video-file">${tr("Choose the video", "Kies de video")}</label><input id="video-file" type="file" accept="video/*,.mkv,.ts"></div>
    <div class="dialog-field"><label for="video-path">${tr("Or paste its path", "Of plak het pad")}</label><input id="video-path" type="text" placeholder="C:\\Videos\\race.mp4"></div>
    <progress id="upload-progress" class="upload-progress hidden" max="100" value="0"></progress>
    <div class="dialog-error"></div>
    <div class="dialog-actions"><button type="button" id="video-start" class="account-add">${tr("Analyse", "Analyseren")}</button></div>
    <p class="section-note">${tr("Recognized runs are saved as they are found and can be sent afterwards.", "Herkende ritten worden opgeslagen zodra ze gevonden zijn en kunnen daarna verzonden worden.")}</p>`);
  $("#video-start").addEventListener("click", async () => {
    dialogError("");
    const file = $("#video-file").files[0], typed = $("#video-path").value.trim();
    let body;
    try {
      if (file) {
        $("#video-start").disabled = true;
        const progress = $("#upload-progress"); progress.classList.remove("hidden");
        body = {uploadId: await uploadVideo(file, percent => { progress.value = percent; })};
      } else if (typed) {
        body = {path: typed};
      } else { dialogError(tr("Choose a video, or paste its path.", "Kies een video of plak het pad.")); return; }
      appStatus = { ...appStatus, busy: true, job: await action("analyze.start", body) };
      closeAppDialog(); renderCaptureBar();
    } catch (error) { dialogError(error.message); $("#video-start").disabled = false; }
  });
});
function uploadVideo(file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/upload?name=${encodeURIComponent(file.name)}`);
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.setRequestHeader("X-LiveTrial-Action", actionSecret());
    request.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    request.onload = () => {
      let document = null; try { document = JSON.parse(request.responseText); } catch (_) {}
      if (request.status === 200 && document?.ok) resolve(document.result.uploadId);
      else reject(new Error(document?.message || tr("The video could not be copied. Try again, or paste its path.", "De video kon niet worden gekopieerd. Probeer het opnieuw of plak het pad.")));
    };
    request.onerror = () => reject(new Error(tr("The video could not be copied. Try again, or paste its path.", "De video kon niet worden gekopieerd. Probeer het opnieuw of plak het pad.")));
    request.send(file);
  });
}

// Settings: language, server and automatic send.
$("#settings-toggle").addEventListener("click", async () => {
  appDialog(tr("Settings", "Instellingen"), `<p>${tr("Loading…", "Laden…")}</p>`);
  let settings;
  try { settings = await action("settings.get"); } catch (error) { $("#app-dialog-body").innerHTML = `<p class="signin-feedback error">${escapeHtml(error.message)}</p>`; return; }
  $("#app-dialog-body").innerHTML = `
    <div class="dialog-field"><label for="setting-server">${tr("Community website address", "Adres van je communitywebsite")}</label>
      <input id="setting-server" type="url" spellcheck="false" autocomplete="url" value="${escapeHtml(settings.serverOrigin === "https://example.invalid" ? "" : settings.serverOrigin)}" placeholder="https://www.example.org">
      <small class="quit-note">${tr("Changing server keeps accounts and waiting runs separate. LiveTrial restarts after saving.", "Bij een andere server blijven accounts en wachtende ritten gescheiden. LiveTrial start opnieuw na opslaan.")}</small>
      <button type="button" class="capture-secondary" id="setting-server-save">${tr("Save server", "Server opslaan")}</button></div>
    <div class="dialog-field"><label>${tr("Language", "Taal")}</label><span class="segmented" id="setting-language">
      <button type="button" data-language="en" aria-pressed="${settings.language === "en"}">English</button><button type="button" data-language="nl" aria-pressed="${settings.language === "nl"}">Nederlands</button></span>
      <select id="setting-language-more" aria-label="${tr("More languages", "Meer talen")}"><option value="">…</option>${DASHBOARD_LANGUAGES.filter(([code]) => code !== "en" && code !== "nl").map(([code, name]) => `<option value="${code}" lang="${code}"${settings.language === code ? " selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select></div>
    <div class="dialog-field"><label for="setting-console-language">${tr("Language of your Switch", "Taal van je Switch")}</label>
      <select id="setting-console-language">
        <option value="auto" ${settings.consoleLanguage === "auto" ? "selected" : ""}>${tr("Automatic — recognised at the start of each session", "Automatisch — herkend bij de start van elke sessie")}</option>
        ${(settings.consoleLanguages || []).map(item => `<option value="${escapeHtml(item.code)}" ${item.code === settings.consoleLanguage ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
      </select>
      <small class="quit-note">${tr("Mario Kart shows its banners, menus and track names in the Switch's system language. Automatic recognises it in the menus (track, character and part names) and keeps it until you stop, so start LiveTrial before you choose a track; a language you choose here stays chosen.", "Mario Kart toont banners, menu's en baannamen in de systeemtaal van de Switch. Automatisch herkent die in de menu's (namen van banen, characters en onderdelen) en houdt hem vast tot je stopt; start LiveTrial dus voordat je een baan kiest. Een taal die je hier kiest blijft gekozen.")}</small></div>
    <div class="dialog-field"><label>${tr("Send new runs automatically", "Nieuwe ritten automatisch verzenden")}</label><span class="segmented" id="setting-auto">
      <button type="button" data-auto="true" aria-pressed="${settings.autoSend}">${tr("On", "Aan")}</button><button type="button" data-auto="false" aria-pressed="${!settings.autoSend}">${tr("Off", "Uit")}</button></span>
      <small class="quit-note">${tr("Runs are always saved on this PC first; without a connection they wait and go out later.", "Ritten worden altijd eerst op deze pc opgeslagen; zonder verbinding wachten ze en gaan ze later mee.")}</small></div>
    <div class="dialog-field"><label for="setting-ghost-names">${tr("My ghost names", "Mijn ghostnamen")}<span id="setting-ghost-account"></span></label>
      <input id="setting-ghost-names" type="text" maxlength="340" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(tr("e.g. BAwSer, BasAi", "bijv. BAwSer, BasAi"))}">
      <small class="quit-note">${tr("While this account is the active one, a ghost with exactly one of these names is linked to it by itself once you leave it; Nintendo staff ghosts, world-record times and times you already have never are. Separate names with commas. You can undo a link until it is sent.", "Zolang dit account actief is, wordt een ghost met precies een van deze namen vanzelf eraan gekoppeld zodra je hem verlaat; Nintendo-staffghosts, wereldrecordtijden en tijden die je al hebt nooit. Scheid namen met komma's. Je kunt een koppeling ongedaan maken tot hij verzonden is.")}</small>
      <button type="button" class="capture-secondary" id="setting-ghost-save">${tr("Save names", "Namen bewaren")}</button></div>
    <div class="dialog-error"></div>
    <p class="quit-note">LiveTrial ${escapeHtml(settings.version)} · ${tr("your data", "je gegevens")}: ${escapeHtml(settings.dataFolder)}<br>${tr("Troubleshooting: the numbered menu is still available as", "Probleemoplossing: het genummerde menu is nog beschikbaar als")} <code>LiveTrialCli.exe menu</code>.</p>`;
  $("#setting-console-language").addEventListener("change", async event => {
    try { await action("settings.set", {consoleLanguage: event.target.value}); dialogError(""); } catch (error) { dialogError(error.message); }
  });
  $("#setting-language-more")?.addEventListener("change", async event => {
    if (!event.target.value) return;
    try { await action("settings.set", {language: event.target.value}); location.reload(); } catch (error) { dialogError(error.message); }
  });
  $$("#setting-language [data-language]").forEach(button => button.addEventListener("click", async () => {
    try { await action("settings.set", {language: button.dataset.language}); location.reload(); } catch (error) { dialogError(error.message); }
  }));
  $("#setting-server-save").addEventListener("click", async () => {
    const origin = $("#setting-server").value.trim();
    if (origin === settings.serverOrigin) { dialogError(tr("This community is already selected.", "Deze community is al gekozen.")); return; }
    if (!confirm(tr("Switch to this community and restart LiveTrial? Existing accounts and pending runs stay with their old server.", "Naar deze community wisselen en LiveTrial opnieuw starten? Bestaande accounts en wachtende ritten blijven bij de oude server."))) return;
    let saved = false;
    try {
      await action("settings.set", {serverOrigin: origin});
      saved = true;
      await action("app.restart");
    } catch (error) {
      if (saved) $("#app-dialog-body").innerHTML = `<p>${tr("The address was saved, but the automatic restart did not start. Quit LiveTrial and open it again.", "Het adres is opgeslagen, maar automatisch opnieuw starten lukte niet. Sluit LiveTrial af en open het opnieuw.")}</p>`;
      else dialogError(error.message);
      return;
    }
    const oldSecret = actionSecret();
    $("#app-dialog-body").innerHTML = `<p>${tr("Address saved. LiveTrial is restarting…", "Adres opgeslagen. LiveTrial start opnieuw…")}</p>`;
    for (let attempt = 0; attempt < 120; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      try {
        const page = await (await fetch("/", {cache: "no-store"})).text();
        const nextSecret = page.match(/<meta name="livetrial-action" content="([^"]+)">/)?.[1];
        if (nextSecret && nextSecret !== oldSecret) { location.reload(); return; }
      } catch (_) {}
    }
    $("#app-dialog-body").innerHTML = `<p>${tr("The address was saved, but LiveTrial did not reopen. Open LiveTrial again to use the new community.", "Het adres is opgeslagen, maar LiveTrial is niet opnieuw geopend. Open LiveTrial opnieuw voor de nieuwe community.")}</p>`;
  });
  $$("#setting-auto [data-auto]").forEach(button => button.addEventListener("click", async () => {
    try {
      const next = await action("settings.set", {autoSend: button.dataset.auto === "true"});
      $$("#setting-auto [data-auto]").forEach(item => item.setAttribute("aria-pressed", String((item.dataset.auto === "true") === next.autoSend)));
    } catch (error) { dialogError(error.message); }
  }));
  // My ghost names: per account (owner 2026-09-28: "BAwSer ... and more recently BasAi").
  const namesInput = $("#setting-ghost-names"), namesSave = $("#setting-ghost-save");
  try {
    const current = await action("ghosts.names");
    namesInput.value = current.names.join(", ");
    $("#setting-ghost-account").textContent = ` (${current.account})`;
  } catch (error) {
    namesInput.disabled = true; namesSave.disabled = true;
    namesInput.placeholder = error.message;
  }
  namesSave.addEventListener("click", async () => {
    namesSave.disabled = true;
    try {
      const saved = await action("ghosts.names", {names: namesInput.value.split(",").map(name => name.trim()).filter(Boolean)});
      namesInput.value = saved.names.join(", ");
      namesSave.textContent = tr("✓ Saved", "✓ Bewaard");
      dialogError("");
    } catch (error) { dialogError(error.message); }
    namesSave.disabled = false;
  });
});

// Quit: a running capture or analysis is stopped cleanly first (owner 2026-09-27).
$("#quit-toggle").addEventListener("click", () => {
  const job = appStatus?.busy ? appStatus.job : null;
  const running = job?.kind === "capture"
    ? tr("Quitting stops the capture first, the same way Stop does. Races you finished are already saved; a race still in progress is not.", "Afsluiten stopt eerst de opname, net als Stoppen. Ritten die je hebt uitgereden zijn al bewaard; een race die nog bezig is niet.")
    : job?.kind === "analyze"
      ? tr("Quitting stops the analysis. Runs it found so far are kept; the rest of the video is not read.", "Afsluiten stopt de analyse. Ritten die tot nu toe gevonden zijn blijven bewaard; de rest van de video wordt niet gelezen.")
      : "";
  appDialog(tr("Quit LiveTrial?", "LiveTrial afsluiten?"), `
    ${running ? `<p><b>${escapeHtml(running)}</b></p>` : ""}
    <p>${tr("Capture and sending stop until you start LiveTrial again. Everything saved stays on this PC.", "Opnemen en verzenden stoppen tot je LiveTrial weer start. Alles wat is opgeslagen blijft op deze pc.")}</p>
    <div class="dialog-error"></div>
    <div class="dialog-actions"><button type="button" id="quit-yes" class="account-add">${job?.kind === "capture" ? tr("Stop capture and quit", "Opname stoppen en afsluiten") : job ? tr("Stop analysis and quit", "Analyse stoppen en afsluiten") : tr("Quit", "Afsluiten")}</button><button type="button" id="quit-no" class="capture-secondary">${tr("Keep open", "Openhouden")}</button></div>`);
  $("#quit-no").addEventListener("click", closeAppDialog);
  $("#quit-yes").addEventListener("click", async () => {
    $("#quit-yes").disabled = true; $("#quit-no").disabled = true;
    try {
      const answer = await action("app.quit");
      clearInterval(appTimer);
      if (answer.stopping) {
        $("#app-dialog-body").innerHTML = `<p>${answer.stopping === "capture" ? tr("Stopping the capture and saving what is finished…", "Opname stoppen en bewaren wat klaar is…") : tr("Stopping the analysis…", "Analyse stoppen…")}</p>`;
        // LiveTrial closes itself once the job has ended; the page just waits for it to go.
        for (let i = 0; i < 120; i++) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          try { await fetch("/api/config", {cache: "no-store"}); } catch (_) { break; }
        }
      }
      $("#app-dialog-body").innerHTML = `<p>${tr("LiveTrial is closed. You can close this window.", "LiveTrial is afgesloten. Je kunt dit venster sluiten.")}</p>`;
      setTimeout(() => window.close(), 800);
    } catch (error) { dialogError(error.message); $("#quit-yes").disabled = false; $("#quit-no").disabled = false; }
  });
});

// Results on this PC, each correctable (a new revision; the earlier one is kept).
let resultsCache = {results: [], tracks: []};
async function loadResults() {
  if (!appMode) return;
  try { resultsCache = await action("results.list"); } catch (_) { return; }
  $("#results-title").textContent = tr("Recognized runs", "Herkende ritten");
  $("#results-note").textContent = tr("A correction saves a new version; the earlier one is kept.", "Een correctie bewaart een nieuwe versie; de eerdere blijft bewaard.");
  $("#results-rows").innerHTML = resultsCache.results.length ? resultsCache.results.slice(0, 30).map(row => `
    <tr><td>${escapeHtml(new Date(row.createdAtMs).toLocaleString(localeTag(), {day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"}))}</td>
    <td><span class="player-cell">${escapeHtml(row.player || (row.noAccount ? tr("No account", "Geen account") : tr("Removed account", "Verwijderd account")))}${row.noAccount && row.state === "pending" ? sendAsButton([row.entryKey]) : ""}</span></td><td><span class="track-cell">${trackThumb(row.trackId)}<span>${escapeHtml(row.trackName)} <span class="cc cc-${row.mode}">${row.mode}CC</span>${loadoutIcons(row.loadout)}</span></span></td>
    <td class="number">${escapeHtml(row.totalTime)}</td><td>${resultState(row)}</td>
    <td>${row.correctable ? `<button type="button" class="capture-secondary" data-correct="${escapeHtml(row.entryKey)}">${tr("Correct", "Corrigeren")}</button>` : ""}</td></tr>`).join("")
    : `<tr><td colspan="6" class="empty-row">${tr("No recognized runs on this PC yet.", "Nog geen herkende ritten op deze pc.")}</td></tr>`;
  $$("[data-correct]").forEach(button => button.addEventListener("click", () => openCorrection(button.dataset.correct)));
  bindSendButtons($("#results-rows"));
  renderLastRun();
  renderSession();
}
// Live: the races of the current (or just finished) capture, newest first, each with its state.
// Ghosts the engine detected on the ghost menu sit between them as Ghost race rows (ADR-0210):
// nothing is linked to an account until the Player chooses Mine.
let sessionSeen = null;
let ghostsCache = {ghosts: []}, ghostsKey = "";
async function refreshGhosts() {
  if (!appMode) return;
  try {
    const next = await action("ghosts.list");
    const key = JSON.stringify(next.ghosts);
    // A ghost that changed may just have become a result (Mine, or linked by a declared
    // name), so the results are read again with it.
    if (key !== ghostsKey) { ghostsKey = key; ghostsCache = next; await loadResults(); }
  } catch (_) {}
}
function ghostRowHtml(g, fresh) {
  const when = escapeHtml(new Date(g.seenAtMs || Date.now()).toLocaleTimeString(localeTag(), {hour: "2-digit", minute: "2-digit"}));
  const track = tracksCatalog()[g.trackId];
  const trackName = track ? track.name : tr("Track not read", "Baan niet gelezen");
  const marks = [
    g.staffGhost ? `<span class="state ghost-mark">${tr("Nintendo staff", "Nintendo-staff")}</span>` : "",
    g.worldRecord ? `<span class="state ghost-mark">${tr("World record", "Wereldrecord")}</span>` : "",
    g.already === "website" ? (g.websiteUrl
      ? `<a class="state synced website-link" href="${escapeHtml(g.websiteUrl)}" target="_blank" rel="noreferrer" title="${escapeHtml(tr("Open it on the website", "Open hem op de website"))}">✓ ${tr("Already on the website", "Staat al op de website")} ↗</a>`
      : `<span class="state synced">✓ ${tr("Already on the website", "Staat al op de website")}</span>`) : "",
    g.already === "saved" ? `<span class="state synced">✓ ${tr("Already saved", "Al bewaard")}</span>` : "",
    g.probablyYours ? `<span class="state ghost-hint">${tr("Probably yours", "Waarschijnlijk van jou")}</span>` : "",
  ].join("");
  const active = accountsCache.find(row => row.active);
  const mine = !g.canClaim ? "" : active
    ? `<button type="button" class="capture-secondary ghost-mine" data-ghost-mine="${escapeHtml(g.id)}" data-ghost-wr="${g.worldRecord ? 1 : 0}">${escapeHtml(tr(`Mine (${active.label})`, `Van mij (${active.label})`))}</button>`
    : `<button type="button" class="capture-secondary" data-send-signin>${tr("Sign in to claim it", "Meld je aan om hem te claimen")}</button>`;
  // "Not mine" only where it is a real question: a Nintendo staff ghost is never anybody's.
  const notMine = g.decision || g.staffGhost ? "" : `<button type="button" class="capture-secondary" data-ghost-dismiss="${escapeHtml(g.id)}">${tr("Not mine", "Niet van mij")}</button>`;
  // ADR-0210 rule 10: your ghost of a time already on the website fills in what that result lacks.
  const complete = g.canComplete && active
    ? `<button type="button" class="capture-secondary ghost-mine" data-ghost-complete="${escapeHtml(g.id)}" title="${escapeHtml(tr("Adds what this ghost shows and your website result lacks (laps, coins, mushrooms, parts); nothing is replaced", "Voegt toe wat deze ghost laat zien en je websiteresultaat mist (rondes, munten, paddenstoelen, onderdelen); niets wordt vervangen"))}">${tr("Add missing details", "Ontbrekende details toevoegen")}</button>`
    : "";
  const completion = g.completion ? completionText(g.completion) : "";
  const exportJson = `<button type="button" class="capture-secondary quiet" data-ghost-export="${escapeHtml(g.id)}" title="${escapeHtml(tr("Export this ghost as JSON", "Deze ghost als JSON exporteren"))}">⤓ JSON</button>`;
  // Line 1: when, which track, the time and what it is. Line 2: who drove it and with what, and
  // the choices, which wrap under it on a narrower screen instead of pushing line 1 apart.
  return `
    <div class="session-row ghost-row${fresh ? " fresh" : ""}">
      <span class="session-when">${when}</span>
      <span class="session-track">${trackThumb(g.trackId)}<span>${escapeHtml(trackName)} <span class="cc cc-${g.mode}">${g.mode}CC</span></span></span>
      <span class="session-time">${escapeHtml(g.total || "")}</span>
      <span class="session-status">${marks}${completion}</span>
      <span class="session-line2"><span class="session-quick"><span class="ghost-badge" title="${escapeHtml(tr("Read from the Select-a-Ghost panel; not linked to any account", "Gelezen van het Select-a-Ghost-paneel; aan geen account gekoppeld"))}">👻 ${tr("Ghost race", "Ghostrit")}</span>
        <b class="ghost-name">${escapeHtml(g.name || "?")}</b>${g.countryId ? `<span class="ghost-country">${escapeHtml(g.countryId.substring(8).toUpperCase())}</span>` : ""}
        ${loadoutIcons(g.loadout)}${lapMetrics(g)}</span>
      <span class="session-actions">${mine}${complete}${notMine}${exportJson}</span></span>
    </div>`;
}
const COMPLETED_FIELD_NAMES = {
  laps: ["lap times", "rondetijden"], coinsCollected: ["coins", "munten"], mushroomsUsed: ["mushrooms", "paddenstoelen"],
  character: ["character", "personage"], characterVariant: ["character colour", "kleur personage"],
  body: ["body", "kart"], bodyVariant: ["body colour", "kleur kart"], tire: ["tires", "banden"],
  glider: ["glider", "zweefvlieger"], gliderVariant: ["glider colour", "kleur zweefvlieger"],
};
function completionText(c) {
  if (c.outcome === "website_differs") {
    return `<span class="state blocked">${tr("Differs from your website result; nothing added", "Wijkt af van je websiteresultaat; niets toegevoegd")}</span>`;
  }
  const names = (c.fields || []).map(field => (COMPLETED_FIELD_NAMES[field] || [field, field])[language === "nl" ? 1 : 0]);
  const how = c.auto ? tr(` (your name ${c.byName})`, ` (je naam ${c.byName})`) : "";
  return names.length
    ? `<span class="state synced">✓ ${escapeHtml(tr(`Added to your website result: ${names.join(", ")}`, `Toegevoegd aan je websiteresultaat: ${names.join(", ")}`) + how)}</span>`
    : `<span class="state synced">✓ ${tr("Your website result already has everything", "Je websiteresultaat heeft alles al")}</span>`;
}
function resultRowHtml(row, fresh) {
  return `
    <div class="session-row${fresh ? " fresh" : ""}">
      <span class="session-when">${escapeHtml(new Date(row.createdAtMs).toLocaleTimeString(localeTag(), {hour: "2-digit", minute: "2-digit"}))}</span>
      <span class="session-track">${trackThumb(row.trackId)}<span>${escapeHtml(row.trackName)} <span class="cc cc-${row.mode}">${row.mode}CC</span></span></span>
      <span class="session-time">${escapeHtml(row.totalTime)}</span>
      <span class="session-status">${resultState(row)}</span>
      <span class="session-line2"><span class="session-quick">${row.fromGhost ? `<span class="ghost-badge">👻 ${tr("From your ghost", "Van je ghost")}</span>` : ""}${row.ghostLink?.auto ? `<span class="state ghost-hint">${escapeHtml(tr(`Linked by your name ${row.ghostLink.byName}`, `Gekoppeld via je naam ${row.ghostLink.byName}`))}</span>` : ""}${loadoutIcons(row.loadout)}${lapMetrics(row)}</span>
      <span class="session-actions">${row.ghostLink?.auto && row.state === "pending" ? `<button type="button" class="capture-secondary" data-ghost-undo="${escapeHtml(row.ghostLink.ghostId)}">${tr("Undo", "Ongedaan maken")}</button>` : ""}${row.noAccount && row.state === "pending" ? sendAsButton([row.entryKey]) : ""}${!row.noAccount && row.state !== "synced" ? `<button type="button" class="capture-secondary" data-send-now>${tr("Send now", "Nu verzenden")}</button>` : ""}${row.correctable ? `<button type="button" class="capture-secondary quiet" data-correct="${escapeHtml(row.entryKey)}">${tr("Correct", "Corrigeren")}</button>` : ""}</span></span>
    </div>`;
}
function tracksCatalog() {
  const out = {};
  for (const t of resultsCache?.tracks || []) out[t.id] = t;
  return out;
}
function downloadJson(document_, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(document_, null, 1)], {type: "application/json"}));
  const link = Object.assign(document.createElement("a"), {href: url, download: name});
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function bindGhostButtons(root) {
  root.querySelectorAll("[data-ghost-mine]").forEach(button => button.addEventListener("click", async () => {
    const wr = button.dataset.ghostWr === "1";
    if (wr && !window.confirm(tr("This is the world record time. Is it really your own ghost?", "Dit is de wereldrecordtijd. Is dit echt je eigen ghost?"))) return;
    button.disabled = true;
    try {
      const done = await action("ghosts.claim", {id: button.dataset.ghostMine, confirmWorldRecord: wr});
      button.replaceWith(Object.assign(document.createElement("span"), {className: "state synced", textContent: done.sent ? tr(`✓ Sent as ${done.account}`, `✓ Verstuurd als ${done.account}`) : tr(`✓ Saved for ${done.account}`, `✓ Bewaard voor ${done.account}`)}));
    } catch (error) {
      button.replaceWith(Object.assign(document.createElement("span"), {className: "state blocked", textContent: error.message}));
    }
    ghostsKey = ""; await refreshGhosts(); load(false);
  }));
  root.querySelectorAll("[data-ghost-complete]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try { await action("ghosts.complete", {id: button.dataset.ghostComplete}); }
    catch (error) { button.replaceWith(Object.assign(document.createElement("span"), {className: "state blocked", textContent: error.message})); }
    ghostsKey = ""; await refreshGhosts();
  }));
  root.querySelectorAll("[data-ghost-undo]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try { await action("ghosts.undo", {id: button.dataset.ghostUndo}); }
    catch (error) { button.replaceWith(Object.assign(document.createElement("span"), {className: "state blocked", textContent: error.message})); }
    ghostsKey = ""; await refreshGhosts(); load(false);
  }));
  root.querySelectorAll("[data-ghost-dismiss]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try { await action("ghosts.dismiss", {id: button.dataset.ghostDismiss}); } catch (_) {}
    ghostsKey = ""; await refreshGhosts();
  }));
  root.querySelectorAll("[data-ghost-export]").forEach(button => button.addEventListener("click", async () => {
    try {
      const document_ = await action("ghosts.export", {ids: [button.dataset.ghostExport]});
      const g = (document_.ghosts || [])[0] || {};
      downloadJson(document_, `ghost-${(g.trackId || "track").replace(/^track\./, "")}-${g.cc || ""}cc-${(g.total || "").replace(/[:.]/g, "")}.json`);
    } catch (error) { button.textContent = error.message; button.disabled = true; }
  }));
}
function renderSession() {
  const job = appStatus?.job, block = $("#session-block");
  const inSession = job && job.kind === "capture";
  block.classList.toggle("hidden", !appMode || !inSession);
  if (!inSession) return;
  $("#session-eyebrow").textContent = capturing() ? tr("THIS SESSION", "DEZE SESSIE") : tr("LAST SESSION", "VORIGE SESSIE");
  $("#session-title").textContent = tr("Races as they come in", "Ritten zodra ze binnenkomen");
  const rows = (resultsCache?.results || []).filter(row => row.createdAtMs >= job.startedAtMs - 60000);
  // a ghost marked Mine is now one of the results above; its detection row steps aside
  const ghostRows = (ghostsCache?.ghosts || []).filter(g => g.decision !== "mine");
  const seen = sessionSeen || new Set([...rows.map(row => row.entryKey), ...ghostRows.map(g => g.id)]);
  const items = [
    ...rows.map(row => ({at: row.createdAtMs, html: resultRowHtml(row, !seen.has(row.entryKey))})),
    ...ghostRows.map(g => ({at: g.seenAtMs || 0, html: ghostRowHtml(g, !seen.has(g.id))})),
  ].sort((a, b) => b.at - a.at);
  $("#session-rows").innerHTML = items.length ? items.map(item => item.html).join("")
    : `<p class="empty-row">${capturing() ? tr("No finished race yet. Each race you finish appears here with whether it is on the website, and every ghost you look at on the ghost menu as a Ghost race.", "Nog geen uitgereden rit. Elke rit die je uitrijdt verschijnt hier, met of hij al op de website staat, en elke ghost die je in het ghostmenu bekijkt als Ghostrit.") : tr("No race was saved in this session.", "In deze sessie is geen rit opgeslagen.")}</p>`;
  sessionSeen = new Set([...rows.map(row => row.entryKey), ...ghostRows.map(g => g.id)]);
  $$("#session-rows [data-correct]").forEach(button => button.addEventListener("click", () => openCorrection(button.dataset.correct)));
  bindSendButtons($("#session-rows"));
  bindGhostButtons($("#session-rows"));
}
function resultState(row) {
  if (row.noAccount && row.state === "pending") return `<span class="state blocked">${tr("Only on this PC", "Alleen op deze pc")}</span>`;
  if (row.state === "synced") return `<span class="state synced">✓ ${tr("On the website", "Op de website")}</span>`;
  // More than 12 % faster than the World Record: the website refuses it, in the owner's words.
  if (row.state === "failed" && row.implausibleTime) return `<span class="state blocked">${tr("The proposed time is highly unreasonable, please double check all information.", "De voorgestelde tijd is zeer onwaarschijnlijk, controleer alle gegevens nog eens.")}</span>`;
  if (row.state === "failed") return `<span class="state failed">${tr("Not sent yet", "Nog niet verzonden")}</span>`;
  return `<span class="state pending">${tr("Waiting to be sent", "Wacht op verzending")}</span>`;
}
// A run recorded without an account goes out only when the person picks the account for it.
function sendAsButton(entryKeys) {
  const active = accountsCache.find(row => row.active);
  if (!active) return ` <button type="button" class="capture-secondary send-as" data-send-signin>${tr("Sign in to send it", "Meld je aan om te versturen")}</button>`;
  return ` <button type="button" class="capture-secondary send-as" data-send-as='${escapeHtml(JSON.stringify(entryKeys))}'>${escapeHtml(tr(`Send as ${active.label}`, `Verstuur als ${active.label}`))}</button>`;
}
function bindSendButtons(root) {
  root.querySelectorAll("[data-send-signin]").forEach(button => button.addEventListener("click", () => startSignIn()));
  root.querySelectorAll("[data-send-now]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try { await action("results.send"); } catch (_) {}
    await loadResults(); load(false);
  }));
  root.querySelectorAll("[data-send-as]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    const keys = JSON.parse(button.dataset.sendAs);
    try {
      const done = await action("results.send_as", keys ? {entryKeys: keys} : {});
      button.replaceWith(Object.assign(document.createElement("span"), {className: "state synced", textContent: done.sent ? tr(`✓ Sent as ${done.account}`, `✓ Verstuurd als ${done.account}`) : tr(`Moved to ${done.account}; it goes out with the next send`, `Naar ${done.account} gezet; gaat mee met de volgende verzending`)}));
    } catch (error) {
      button.replaceWith(Object.assign(document.createElement("span"), {className: "state blocked", textContent: error.message}));
    }
    await loadResults(); load(false);
    if (!$("#waiting-panel").classList.contains("hidden")) { try { renderWaiting(await action("results.waiting")); } catch (_) {} }
  }));
}
// After each race: which race was saved and whether it is on the website yet.
function renderLastRun() {
  const box = $("#last-run"), row = resultsCache?.results?.[0], job = appStatus?.job;
  const recent = row && job && row.createdAtMs >= job.startedAtMs - 60000 && job.saved > 0;
  box.classList.toggle("hidden", !recent);
  clearTimeout(lastRunTimer);
  if (!recent) return;
  let state;
  if (row.noAccount && row.state === "pending") state = `<span class="state blocked">${tr("Saved on this PC only: no account was signed in", "Alleen op deze pc bewaard: er was geen account aangemeld")}</span>${sendAsButton([row.entryKey])}`;
  else if (row.state === "synced") state = `<span class="state synced">✓ ${tr("On the website", "Staat op de website")}</span>`;
  else {
    state = `<span class="state pending">${tr("Saved, waiting to be sent", "Opgeslagen, wacht op verzending")}</span> <button type="button" class="capture-secondary" data-send-now>${tr("Send now", "Nu verzenden")}</button>`;
    // Automatic send may still be on its way: look again shortly.
    lastRunTimer = setTimeout(loadResults, 5000);
  }
  box.innerHTML = `<p class="eyebrow">${tr("LAST RACE", "LAATSTE RIT")}</p><b>${escapeHtml(row.trackName)} · ${row.mode}cc · ${escapeHtml(row.totalTime)}</b>${row.player ? `<span>${escapeHtml(row.player)}</span>` : ""}${state}`;
  bindSendButtons(box);
}
$("#results-refresh").addEventListener("click", () => loadResults());
function openCorrection(entryKey) {
  const row = resultsCache.results.find(item => item.entryKey === entryKey);
  if (!row) return;
  const laps = row.laps.length ? row.laps : [];
  appDialog(tr("Correct a recognized run", "Een herkende rit corrigeren"), `
    <div class="dialog-field"><label for="fix-track">${tr("Track", "Circuit")}</label><select id="fix-track">${resultsCache.tracks.map(track => `<option value="${escapeHtml(track.id)}" ${track.id === row.trackId ? "selected" : ""}>${escapeHtml(track.name)}</option>`).join("")}</select></div>
    <div class="dialog-field"><label>${tr("Engine class", "Motorklasse")}</label><span class="segmented" id="fix-mode"><button type="button" data-mode="150" aria-pressed="${row.mode === 150}">150cc</button><button type="button" data-mode="200" aria-pressed="${row.mode === 200}">200cc</button></span></div>
    <div class="dialog-field"><label for="fix-total">${tr("Total time", "Totaaltijd")}</label><input id="fix-total" value="${escapeHtml(row.totalTime)}" placeholder="1:42.123"></div>
    <div class="dialog-field"><label>${tr("Kart combination", "Kartcombinatie")}</label><div class="loadout-slots" id="fix-loadout"></div>
      <div class="loadout-choose hidden" id="fix-loadout-choose"><input id="fix-loadout-filter" type="search" autocomplete="off"><div class="loadout-grid" id="fix-loadout-grid"></div></div></div>
    ${laps.length ? `<div class="dialog-field"><label>${tr("Laps: time, coins, mushrooms", "Rondes: tijd, munten, paddenstoelen")}</label><div class="lap-grid">${laps.map((lap, index) => `<span>${index + 1}</span><input data-lap-time="${index}" value="${escapeHtml(lap.time)}"><input data-lap-coins="${index}" inputmode="numeric" value="${lap.coins ?? ""}"><input data-lap-mushrooms="${index}" inputmode="numeric" value="${lap.mushrooms ?? ""}">`).join("")}</div></div>` : ""}
    <div class="fix-checks" id="fix-checks" aria-live="polite"></div>
    <div class="dialog-error"></div>
    <div class="dialog-actions"><button type="button" id="fix-save" class="account-add">${tr("Save correction", "Correctie opslaan")}</button></div>`);
  let mode = row.mode;
  const originalLoadout = JSON.stringify(row.loadout || {});
  const loadout = {...(row.loadout || {})};
  let choosing = null;
  const slotNames = {character: tr("Character", "Coureur"), body: tr("Body", "Chassis"), tire: tr("Tires", "Banden"), glider: tr("Glider", "Paraglider")};
  // Colour variants follow the character, as in the game and on the Build tab.
  const followCharacter = () => {
    const characterKey = loadout.characterVariantId || loadout.characterId;
    for (const [category, idKey, variantKey] of LOADOUT_SPECS.filter(spec => spec[2] && spec[0] !== "character")) {
      const base = (buildCatalog?.categories?.[category] || []).find(part => part.id === loadout[idKey]);
      const variant = base && characterKey ? matchedBuildVariant(base, characterKey) : null;
      if (variant) loadout[variantKey] = variant.id; else delete loadout[variantKey];
    }
  };
  const renderSlots = () => {
    $("#fix-loadout").innerHTML = loadoutSlots(loadout).map(slot => `<button type="button" class="loadout-slot${choosing === slot.category ? " active" : ""}" data-slot="${slot.category}">
      ${slot.part ? `<img src="${gameAsset(slot.part.icon)}" data-fallback="${escapeHtml(slot.part.baseIcon)}" alt="">` : `<span class="quick-missing">?</span>`}<span><small>${escapeHtml(slotNames[slot.category])}</small>${escapeHtml(slot.part?.name || tr("not read", "niet gelezen"))}</span></button>`).join("");
    $$("#fix-loadout [data-slot]").forEach(button => button.addEventListener("click", () => {
      choosing = choosing === button.dataset.slot ? null : button.dataset.slot;
      $("#fix-loadout-filter").value = ""; renderSlots(); renderChoices();
    }));
  };
  const renderChoices = () => {
    $("#fix-loadout-choose").classList.toggle("hidden", !choosing);
    if (!choosing) return;
    $("#fix-loadout-filter").placeholder = tr(`Find a ${slotNames[choosing].toLowerCase()}…`, `${slotNames[choosing]} zoeken…`);
    const needle = $("#fix-loadout-filter").value.trim().toLowerCase();
    const parts = buildParts(choosing).filter(part => !needle || part.name.toLowerCase().includes(needle));
    $("#fix-loadout-grid").innerHTML = parts.map(part => `<button type="button" class="loadout-choice" data-part="${escapeHtml(part.id)}" title="${escapeHtml(part.name)}"><img src="${gameAsset(part.iconPath)}" data-fallback="${escapeHtml(part.baseIconPath || part.iconPath)}" alt="" loading="lazy"><span>${escapeHtml(part.name)}</span></button>`).join("")
      || `<p class="empty-row">${tr("Nothing matches.", "Niets gevonden.")}</p>`;
    $$("#fix-loadout-grid [data-part]").forEach(button => button.addEventListener("click", () => {
      const id = button.dataset.part;
      if (choosing === "character") {
        const variant = buildVariants.characters.find(row => row.id === id);
        loadout.characterId = variant ? variant.baseId : id;
        if (variant) loadout.characterVariantId = id; else delete loadout.characterVariantId;
      } else if (choosing === "tire") loadout.tireId = id;
      else loadout[`${choosing}Id`] = id;
      followCharacter();
      choosing = null; renderSlots(); renderChoices();
    }));
  };
  $("#fix-loadout-filter").addEventListener("input", renderChoices);
  renderSlots();
  // Checked while typing, in words that say what is wrong; the save button waits until it is right.
  let confirmedFaster = false;
  const parseClock = text => { const m = /^(\d+):([0-5]\d)\.(\d{3})$/.exec(String(text || "").trim()); return m ? Number(m[1]) * 60000 + Number(m[2]) * 1000 + Number(m[3]) : null; };
  const wholeIn = (text, low, high) => { const t = String(text || "").trim(); if (t === "") return {empty: true}; if (!/^\d+$/.test(t) || Number(t) < low || Number(t) > high) return {bad: true}; return {value: Number(t)}; };
  const checkCorrection = () => {
    const errors = [], warnings = [];
    const total = parseClock($("#fix-total").value);
    if (total === null) errors.push(tr("Total time: use a time such as 1:42.123.", "Totaaltijd: gebruik een tijd zoals 1:42.123."));
    const track = resultsCache.tracks.find(item => item.id === $("#fix-track").value);
    let lapSum = null;
    if (laps.length) {
      const times = laps.map((_, index) => parseClock($(`[data-lap-time="${index}"]`).value));
      times.forEach((time, index) => { if (time === null) errors.push(tr(`Lap ${index + 1}: use a time such as 0:34.567.`, `Ronde ${index + 1}: gebruik een tijd zoals 0:34.567.`)); });
      if (track?.lapCount && track.lapCount !== laps.length)
        errors.push(tr(`${track.name} has ${track.lapCount} laps; this run has ${laps.length}.`, `${track.name} heeft ${track.lapCount} rondes; deze rit heeft er ${laps.length}.`));
      if (total !== null && times.every(time => time !== null)) {
        lapSum = times.reduce((sum, time) => sum + time, 0);
        if (lapSum !== total) errors.push(tr(`The laps add up to ${clock(lapSum)}, the total time is ${clock(total)}.`, `De rondes tellen op tot ${clock(lapSum)}, de totaaltijd is ${clock(total)}.`));
      }
      let mushroomTotal = 0;
      laps.forEach((_, index) => {
        const coins = wholeIn($(`[data-lap-coins="${index}"]`).value, 0, 10);
        if (coins.bad) errors.push(tr(`Lap ${index + 1}: coins are a whole number from 0 to 10 (what you hold at the end of the lap).`, `Ronde ${index + 1}: munten zijn een heel getal van 0 tot 10 (wat je aan het eind van de ronde hebt).`));
        const mushrooms = wholeIn($(`[data-lap-mushrooms="${index}"]`).value, 0, 3);
        if (mushrooms.bad) errors.push(tr(`Lap ${index + 1}: mushrooms are a whole number from 0 to 3.`, `Ronde ${index + 1}: paddenstoelen zijn een heel getal van 0 tot 3.`));
        mushroomTotal += mushrooms.value || 0;
      });
      if (mushroomTotal > 3) errors.push(tr(`${mushroomTotal} mushrooms in total; a time trial has 3.`, `${mushroomTotal} paddenstoelen in totaal; een time trial heeft er 3.`));
    }
    const record = resultsCache.worldRecords?.[`${$("#fix-track").value}|${mode}`];
    if (total !== null && record && total < record.timeMs)
      warnings.push(tr(`${clock(total)} is faster than the World Record (${clock(record.timeMs)}${record.holder ? `, ${record.holder}` : ""}). Is this time right?`,
        `${clock(total)} is sneller dan het wereldrecord (${clock(record.timeMs)}${record.holder ? `, ${record.holder}` : ""}). Klopt deze tijd echt?`));
    if (!warnings.length) confirmedFaster = false;
    $("#fix-checks").innerHTML = errors.map(text => `<p class="fix-check error">✕ ${escapeHtml(text)}</p>`).join("")
      + (lapSum !== null && lapSum !== total ? `<p class="fix-check"><button type="button" class="capture-secondary" id="fix-use-sum">${tr(`Use the lap sum (${clock(lapSum)}) as total`, `Som van de rondes (${clock(lapSum)}) als totaal`)}</button></p>` : "")
      + warnings.map(text => `<p class="fix-check warning">⚠ ${escapeHtml(text)}</p>`).join("")
      + (warnings.length && !errors.length ? `<label class="fix-check confirm"><input type="checkbox" id="fix-confirm" ${confirmedFaster ? "checked" : ""}> ${tr("Yes, this time is right", "Ja, deze tijd klopt")}</label>` : "");
    $("#fix-use-sum")?.addEventListener("click", () => { $("#fix-total").value = clock(lapSum); checkCorrection(); });
    $("#fix-confirm")?.addEventListener("change", event => { confirmedFaster = event.target.checked; checkCorrection(); });
    $("#fix-save").disabled = errors.length > 0 || (warnings.length > 0 && !confirmedFaster);
  };
  $("#app-dialog-body").addEventListener("input", event => { if (event.target.id !== "fix-loadout-filter") checkCorrection(); });
  $("#fix-track").addEventListener("change", checkCorrection);
  $$("#fix-mode [data-mode]").forEach(button => button.addEventListener("click", () => {
    mode = Number(button.dataset.mode);
    $$("#fix-mode [data-mode]").forEach(item => item.setAttribute("aria-pressed", String(Number(item.dataset.mode) === mode)));
    checkCorrection();
  }));
  checkCorrection();
  $("#fix-save").addEventListener("click", async () => {
    dialogError("");
    const body = {entryKey, trackId: $("#fix-track").value, mode, totalTime: $("#fix-total").value.trim()};
    if (laps.length) body.laps = laps.map((_, index) => ({time: $(`[data-lap-time="${index}"]`).value.trim(), coins: $(`[data-lap-coins="${index}"]`).value.trim(), mushrooms: $(`[data-lap-mushrooms="${index}"]`).value.trim()}));
    if (JSON.stringify(loadout) !== originalLoadout) body.loadout = loadout;
    try {
      const saved = await action("results.correct", body);
      const fieldNames = {track: ["track", "circuit"], mode: ["class", "klasse"], totalTime: ["total time", "totaaltijd"], laps: ["lap times", "rondetijden"], coins: ["coins", "munten"], mushrooms: ["mushrooms", "paddenstoelen"], character: ["character", "coureur"], characterVariant: ["character colour", "kleur coureur"], body: ["body", "chassis"], bodyVariant: ["body colour", "kleur chassis"], tire: ["tires", "banden"], glider: ["glider", "paraglider"], gliderVariant: ["glider colour", "kleur paraglider"]};
      const fields = saved.corrected.map(field => (fieldNames[field] || [field, field])[language === "nl" ? 1 : 0]).join(", ");
      $("#app-dialog-body").innerHTML = `<p>${tr(`Correction saved (${fields}). It goes out with the next send.`, `Correctie opgeslagen (${fields}). Die gaat mee met de volgende verzending.`)}</p>`;
      loadResults(); load(false);
    } catch (error) { dialogError(error.message); }
  });
}

// YouTube (optional, ADR-0213): the active account's own channel. A clip goes up only when the
// person presses Upload on it; the video goes from this PC straight to YouTube.
let youtubeTimer = null;
function youtubeHead(state) {
  return `<div class="youtube-head"><strong>YouTube</strong><span class="state ${state === "connected" ? "synced" : state === "reconnect_required" ? "failed" : "pending"}">${
    state === "connected" ? tr("Connected", "Gekoppeld")
    : state === "connecting" ? tr("Connecting…", "Koppelen…")
    : state === "reconnect_required" ? tr("Connect again", "Opnieuw koppelen")
    : state === "unavailable" ? tr("Not set up", "Niet ingesteld")
    : tr("Not connected", "Niet gekoppeld")}</span></div>`;
}
// What a Player agrees to when uploading, and where the policies are (YouTube API Services terms).
function youtubePolicyLinks(status) {
  const links = status.links || {};
  const item = (href, label) => href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${label}</a>` : "";
  return `<p class="youtube-note small">${tr("Uploading uses the YouTube API Services: by uploading you agree to the", "Uploaden gebruikt de YouTube API Services: door te uploaden ga je akkoord met de")} ${item(links.youtubeTerms, tr("YouTube Terms of Service", "YouTube-servicevoorwaarden"))} · ${item(links.googlePrivacy, tr("Google Privacy Policy", "Privacybeleid van Google"))}${links.privacy ? ` · ${item(links.privacy, tr("LiveTrial privacy policy", "Privacybeleid LiveTrial"))}` : ""}${links.terms ? ` · ${item(links.terms, tr("Terms of use", "Gebruiksvoorwaarden"))}` : ""}</p>`;
}
function renderYouTube(status) {
  const box = $("#youtube-block");
  clearTimeout(youtubeTimer);
  box.classList.remove("hidden");
  const notice = status.notice ? `<p class="youtube-note error-row">${escapeHtml(status.notice)}</p>` : "";
  let body;
  if (!status.configured) {
    body = `<p class="youtube-note">${status.problem === "invalid_client" ? escapeHtml(status.message) : tr("YouTube integration is not configured", "YouTube-koppeling is niet ingesteld")}.</p>
      <p class="youtube-note small">${tr("Optional. To use it, place your Google Desktop client file here:", "Optioneel. Zet daarvoor je Google Desktop-clientbestand hier:")} <code>${escapeHtml(status.clientLocation)}</code></p>`;
  } else if (status.state === "no_account") {
    body = `<p class="youtube-note">${tr("Choose or add an account to connect its YouTube channel.", "Kies of voeg een account toe om het YouTube-kanaal ervan te koppelen.")}</p>`;
  } else if (status.state === "connecting") {
    body = `<p class="youtube-note">${tr("Finish in your browser: sign in with Google and allow uploads.", "Rond het af in je browser: meld je aan bij Google en sta uploaden toe.")}</p>
      <button type="button" class="capture-secondary" data-youtube="youtube.cancel">${tr("Cancel", "Annuleren")}</button>`;
    youtubeTimer = setTimeout(refreshYouTube, 2000);
  } else if (status.state === "connected") {
    body = `<p class="youtube-note">${escapeHtml(tr(`Clips you upload go to ${status.account}'s YouTube channel.`, `Clips die je uploadt gaan naar het YouTube-kanaal van ${status.account}.`))}</p>
      ${youtubeDisconnectAsk ? youtubeDisconnectHtml(status) : `<button type="button" class="capture-secondary" data-youtube-disconnect-ask>${tr("Disconnect YouTube", "YouTube ontkoppelen")}</button>`}
      <p class="youtube-note small">${tr("Disconnecting removes LiveTrial's access from this PC. Videos already on YouTube stay there.", "Ontkoppelen haalt de toegang van LiveTrial van deze pc. Video's die al op YouTube staan blijven staan.")}
        ${tr("To also remove the permission at Google:", "Om de toestemming ook bij Google in te trekken:")} <a href="${escapeHtml(status.links.googlePermissions)}" target="_blank" rel="noreferrer">myaccount.google.com/permissions</a></p>
      ${youtubePolicyLinks(status)}`;
  } else {
    body = `<p class="youtube-note">${status.state === "reconnect_required"
      ? tr("Google ended LiveTrial's access (while the Google app is in testing, after 7 days). Connect again to upload.", "Google heeft de toegang van LiveTrial beëindigd (zolang de Google-app in de testfase is, na 7 dagen). Koppel opnieuw om te uploaden.")
      : escapeHtml(tr(`Connect ${status.account}'s YouTube channel to upload clips as evidence. LiveTrial never sees your Google password.`, `Koppel het YouTube-kanaal van ${status.account} om clips als bewijs te uploaden. LiveTrial ziet nooit je Google-wachtwoord.`))}</p>
      <button type="button" class="account-add" data-youtube="youtube.connect">${status.state === "reconnect_required" ? tr("Connect again", "Opnieuw koppelen") : tr("Connect YouTube", "YouTube koppelen")}</button>
      <p class="youtube-note small">${tr("LiveTrial asks Google only for permission to upload videos, and uploads only the clip you choose.", "LiveTrial vraagt Google alleen toestemming om video's te uploaden, en uploadt alleen de clip die jij kiest.")}</p>
      ${youtubePolicyLinks(status)}`;
  }
  const forgotten = Number.isInteger(status.forgotten) && status.forgotten > 0
    ? `<p class="youtube-note">${tr(`Upload history of ${status.forgotten} clip(s) forgotten on this PC. The videos are still on YouTube.`, `Uploadgeschiedenis van ${status.forgotten} clip(s) op deze pc vergeten. De video's staan nog op YouTube.`)}</p>` : "";
  box.innerHTML = youtubeHead(status.state) + notice + forgotten + body;
  box.querySelectorAll("[data-youtube]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try { renderYouTube(await action(button.dataset.youtube)); }
    catch (error) { box.insertAdjacentHTML("beforeend", `<p class="youtube-note error-row">${escapeHtml(error.message)}</p>`); button.disabled = false; }
  }));
  box.querySelector("[data-youtube-disconnect-ask]")?.addEventListener("click", () => { youtubeDisconnectAsk = true; renderYouTube(status); });
  box.querySelector("[data-youtube-disconnect-keep]")?.addEventListener("click", () => { youtubeDisconnectAsk = false; renderYouTube(status); });
  box.querySelector("[data-youtube-disconnect-yes]")?.addEventListener("click", async event => {
    event.target.disabled = true;
    const forgetHistory = Boolean(box.querySelector("#youtube-forget-history")?.checked);
    try { youtubeDisconnectAsk = false; renderYouTube(await action("youtube.disconnect", {forgetHistory})); }
    catch (error) { box.insertAdjacentHTML("beforeend", `<p class="youtube-note error-row">${escapeHtml(error.message)}</p>`); event.target.disabled = false; }
  });
}
// Disconnect asks first: the authorization always goes; the local upload history only if asked
// (owner 2026-09-29). Nothing on YouTube is ever deleted.
let youtubeDisconnectAsk = false;
function youtubeDisconnectHtml(status) {
  const count = status.uploadCount || 0;
  return `<div class="youtube-disconnect-confirm">
    <p>${escapeHtml(tr(`Disconnect YouTube for ${status.account}? LiveTrial's access is removed from this PC. Videos already on YouTube are not deleted.`, `YouTube ontkoppelen voor ${status.account}? De toegang van LiveTrial wordt van deze pc gehaald. Video's die al op YouTube staan worden niet verwijderd.`))}</p>
    ${count ? `<label class="youtube-forget-history"><input type="checkbox" id="youtube-forget-history"> ${tr(`Also forget locally stored YouTube upload history for this Player (${count} clip(s)).`, `Ook de lokaal bewaarde YouTube-uploadgeschiedenis van deze speler vergeten (${count} clip(s)).`)}</label>
    <small class="youtube-note small">${tr("If you keep it, LiveTrial keeps showing those clips as on YouTube with their links, and will not upload them again.", "Als je hem bewaart, blijft LiveTrial die clips als 'op YouTube' met hun link tonen en uploadt hij ze niet opnieuw.")}</small>` : ""}
    <span class="youtube-disconnect-actions"><button type="button" class="capture-secondary" data-youtube-disconnect-yes>${tr("Disconnect", "Ontkoppelen")}</button>
    <button type="button" class="link-button" data-youtube-disconnect-keep>${tr("Keep connected", "Gekoppeld houden")}</button></span>
  </div>`;
}
async function refreshYouTube() {
  if (!actionSecret() || $("#account-panel").classList.contains("hidden")) return;
  try { renderYouTube(await action("youtube.status")); } catch (_) {}
}

// Clips on this PC: finished runs as clear cards (end-screen picture, track, class, total time,
// laps); watch one, upload it to YouTube, copy the youtu.be link. Unfinished runs behind a switch.
let clipsTimer = null, clipsShowAll = false, clipsForgetId = null;
// The upload form (owner 2026-09-29): title, description and visibility, pre-filled from the race,
// sent exactly as the Player leaves them. {clipId, title, description, privacy, options, busy, error}
let clipsForm = null;
const utf8Bytes = text => new TextEncoder().encode(text).length;
const YOUTUBE_TERMS_URL = "https://www.youtube.com/t/terms";
const YOUTUBE_GUIDELINES_URL = "https://www.youtube.com/howyoutubeworks/policies/community-guidelines/";
function clipFormProblem(form) {
  if (!form.title.trim()) return tr("Enter a title for the video.", "Vul een titel voor de video in.");
  if ([...form.title].length > 100) return tr(`The title is ${[...form.title].length} characters; YouTube allows 100.`, `De titel is ${[...form.title].length} tekens; YouTube staat er 100 toe.`);
  if (/[\r\n]/.test(form.title)) return tr("A title is one line.", "Een titel is één regel.");
  if (utf8Bytes(form.description) > 5000) return tr(`The description is too long for YouTube (${utf8Bytes(form.description)} of 5000 bytes).`, `De beschrijving is te lang voor YouTube (${utf8Bytes(form.description)} van 5000 bytes).`);
  if (/[<>]/.test(form.title) || /[<>]/.test(form.description)) return tr("YouTube does not accept < or > in a title or description.", "YouTube accepteert geen < of > in een titel of beschrijving.");
  return "";
}
function clipFormHtml(form) {
  const privacy = form.options.map(option => `<button type="button" data-clip-form-privacy="${option.value}" aria-pressed="${option.value === form.privacy}" ${option.available ? "" : "disabled"}>${
    {private: tr("Private", "Privé"), unlisted: tr("Unlisted", "Niet vermeld"), public: tr("Public", "Openbaar")}[option.value]}</button>`).join("");
  const problem = form.error || clipFormProblem(form);
  const notice = tr(
    `By clicking 'Upload to YouTube', you certify that the content you are uploading complies with the <a href="${YOUTUBE_TERMS_URL}" target="_blank" rel="noreferrer">YouTube Terms of Service</a>, including the <a href="${YOUTUBE_GUIDELINES_URL}" target="_blank" rel="noreferrer">YouTube Community Guidelines</a>.`,
    `Door op 'Uploaden naar YouTube' te klikken, verklaar je dat de inhoud die je uploadt voldoet aan de <a href="${YOUTUBE_TERMS_URL}" target="_blank" rel="noreferrer">Servicevoorwaarden van YouTube</a>, inclusief de <a href="${YOUTUBE_GUIDELINES_URL}" target="_blank" rel="noreferrer">Communityrichtlijnen van YouTube</a>.`);
  return `<div class="clip-upload-form" data-clip-form="${escapeHtml(form.clipId)}">
    <label class="dialog-field"><span>${tr("Title on YouTube", "Titel op YouTube")} <small class="clip-form-count" id="clip-form-title-count">${[...form.title].length}/100</small></span>
      <input id="clip-form-title" type="text" spellcheck="false" data-no-translate value="${escapeHtml(form.title)}"></label>
    <label class="dialog-field"><span>${tr("Description", "Beschrijving")} <small class="clip-form-count" id="clip-form-description-count">${utf8Bytes(form.description)}/5000</small></span>
      <textarea id="clip-form-description" rows="10" spellcheck="false" data-no-translate>${escapeHtml(form.description)}</textarea></label>
    <div class="dialog-field"><span>${tr("Visibility on YouTube", "Zichtbaarheid op YouTube")}</span><span class="segmented">${privacy}</span>
      <small class="quit-note clip-form-hint">${tr("Google allows only Private uploads until LiveTrial's YouTube review is done. A Private video can only be watched by you, so it is not yet visible as evidence on the website.", "Google staat alleen privé-uploads toe tot de YouTube-controle van LiveTrial klaar is. Een privévideo kan alleen jij bekijken, dus die is nog niet zichtbaar als bewijs op de website.")}</small></div>
    <p class="clip-upload-notice">${notice}</p>
    <p class="clip-form-problem state failed" id="clip-form-problem"${problem ? "" : " hidden"}>${escapeHtml(problem)}</p>
    <span class="clip-form-actions"><button type="button" class="account-add" id="clip-form-upload" ${problem || form.busy ? "disabled" : ""}>${tr("Upload to YouTube", "Uploaden naar YouTube")}</button>
      <button type="button" class="link-button" id="clip-form-cancel">${tr("Cancel", "Annuleren")}</button></span>
  </div>`;
}
const megabytes = bytes => `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;
function clipUploadHtml(clip, youtube, busy) {
  const upload = clip.upload;
  if (upload?.state === "uploaded") {
    const confirm = clipsForgetId === clip.clipId
      ? `<p class="clip-forget-confirm">${tr("Forget this upload on this PC? The video stays on YouTube; delete it there in YouTube Studio if you want it gone.", "Deze upload op deze pc vergeten? De video blijft op YouTube staan; verwijder hem daar in YouTube Studio als je hem weg wilt.")}
         <button type="button" class="link-button" data-clip-forget-yes="${escapeHtml(clip.clipId)}">${tr("Yes, forget", "Ja, vergeten")}</button>
         <button type="button" class="link-button" data-clip-forget-no>${tr("Keep", "Houden")}</button></p>` : "";
    const privateNote = upload.privacyStatus === "private"
      ? `<p class="clip-private-note">${tr("Private: only you can watch it, so it is not usable as public evidence on the website.", "Privé: alleen jij kunt hem bekijken, dus hij is niet bruikbaar als openbaar bewijs op de website.")}</p>` : "";
    return `<span class="state synced">✓ ${tr("On YouTube", "Op YouTube")}${upload.privacyStatus === "private" ? ` · ${tr("Private", "Privé")}` : ""}</span>
      <span class="clip-link"><a href="${escapeHtml(upload.url)}" target="_blank" rel="noreferrer">${escapeHtml(upload.url)}</a>
      <button type="button" class="capture-secondary" data-clip-copy="${escapeHtml(upload.url)}">${tr("Copy link", "Link kopiëren")}</button>
      <button type="button" class="link-button" data-clip-forget="${escapeHtml(clip.clipId)}">${tr("Forget this upload", "Deze upload vergeten")}</button></span>
      ${privateNote}${confirm}`;
  }
  if (upload && ["preparing", "uploading", "processing"].includes(upload.state)) {
    const label = upload.state === "preparing" ? tr("Preparing…", "Voorbereiden…") : upload.state === "processing" ? tr("Finishing…", "Afronden…") : tr(`Uploading ${upload.percent}%`, `Uploaden ${upload.percent}%`);
    // Speed and time left once the first chunks are out (upload speed, owner 2026-09-29).
    const speed = upload.bytesPerSecond ? ` · ${(upload.bytesPerSecond / 1048576).toFixed(1)} MB/s` : "";
    const left = Number.isFinite(upload.secondsLeft)
      ? ` · ${tr(`${Math.floor(upload.secondsLeft / 60)}:${String(upload.secondsLeft % 60).padStart(2, "0")} left`, `nog ${Math.floor(upload.secondsLeft / 60)}:${String(upload.secondsLeft % 60).padStart(2, "0")}`)}` : "";
    return `<span class="clip-progress"><progress max="100" value="${upload.percent}"></progress><span>${label}${speed}${left}</span></span>`;
  }
  if (clipsForm?.clipId === clip.clipId) return clipFormHtml(clipsForm);
  const failed = upload?.state === "failed" ? `<span class="state failed">${escapeHtml(upload.message)}</span>` : "";
  const ready = youtube.state === "connected" && !busy && !clipsForm;
  // Opens the review form; the upload itself starts only from the form's own button.
  return `${failed}<button type="button" class="capture-secondary" data-clip-upload="${escapeHtml(clip.clipId)}" ${ready ? "" : "disabled"}>${upload?.state === "failed" ? tr("Try again…", "Opnieuw proberen…") : tr("Upload to YouTube…", "Uploaden naar YouTube…")}</button>`;
}
function clipCardHtml(clip, youtube, busy) {
  const when = new Date(clip.recordedAtMs || clip.modifiedAtMs).toLocaleString(localeTag(), {day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"});
  const still = clip.hasStill ? `/api/clip-still?clip=${encodeURIComponent(clip.clipId)}`
    : clip.trackId ? `/api/track-image?trackId=${encodeURIComponent(clip.trackId)}` : "";
  const laps = (clip.laps || []).filter(lap => lap.time).map(lap => escapeHtml(lap.time)).join(" · ");
  const wide = ["uploaded", "failed"].includes(clip.upload?.state) ? " wide" : "";
  // The review form gets its own full-width row under the picture and the race facts (owner: too cramped).
  const formOpen = clipsForm?.clipId === clip.clipId && !["uploaded", "preparing", "uploading", "processing"].includes(clip.upload?.state);
  return `<article class="clip-card${clip.complete ? "" : " unfinished"}">
    <span class="clip-still">${still ? `<img src="${still}" alt="" loading="lazy" data-fallback="${clip.trackId ? `/api/track-image?trackId=${encodeURIComponent(clip.trackId)}` : ""}">` : ""}</span>
    <span class="clip-body">
      <span class="clip-head"><strong>${escapeHtml(clip.trackName || tr("Unknown track", "Onbekend circuit"))}</strong>${clip.engineClass ? `<span class="cc cc-${clip.engineClass}">${clip.engineClass}CC</span>` : ""}${clip.kind === "ghost" ? `<span class="state clip-ghost">${tr("Ghost replay", "Ghost-replay")}${clip.ghostName ? ` · <span data-no-translate>${escapeHtml(clip.ghostName)}</span>` : ""}</span>` : ""}${clip.complete ? "" : `<span class="state blocked">${tr("Not finished", "Niet uitgereden")}</span>`}</span>
      ${clip.cupName ? `<small class="clip-cup">${escapeHtml(clip.cupName)}</small>` : ""}
      ${clip.time ? `<span class="clip-time">${escapeHtml(clip.time)}</span>` : ""}
      ${laps ? `<small class="clip-laps">${tr("Laps", "Rondes")} ${laps}</small>` : ""}
      <small class="clip-meta">${escapeHtml(when)} · ${megabytes(clip.bytes)} · <a href="${escapeHtml(historyUrl + "runs/" + clip.clipId)}" target="_blank" rel="noreferrer">${tr("Watch", "Bekijken")}</a></small>
      ${formOpen ? "" : `<span class="clip-actions${wide}">${clipUploadHtml(clip, youtube, busy)}</span>`}
    </span>
    ${formOpen ? clipFormHtml(clipsForm) : ""}
  </article>`;
}
async function renderClips() {
  clearTimeout(clipsTimer);
  if ($("#app-dialog").classList.contains("hidden") || !$("#app-dialog-body .clips")) return;
  let listing;
  try { listing = await action("clips.list"); } catch (error) { dialogError(error.message); return; }
  const youtube = listing.youtube;
  const intro = youtube.state === "connected"
    ? `<p class="youtube-note">${escapeHtml(tr(`Uploads go to ${youtube.account}'s YouTube channel. Nothing is uploaded until you review a clip's title, description and visibility and press Upload to YouTube.`, `Uploads gaan naar het YouTube-kanaal van ${youtube.account}. Er wordt niets geüpload tot je de titel, beschrijving en zichtbaarheid van een clip hebt bekeken en op Uploaden naar YouTube drukt.`))}</p>`
    : `<p class="youtube-note">${!youtube.configured ? tr("YouTube integration is not configured. Clips stay on this PC.", "YouTube-koppeling is niet ingesteld. Clips blijven op deze pc.")
      : youtube.state === "no_account" ? tr("Choose an account in the account menu to upload clips.", "Kies een account in het accountmenu om clips te uploaden.")
      : tr("Connect YouTube in the account menu (top right) to upload clips.", "Koppel YouTube in het accountmenu (rechtsboven) om clips te uploaden.")}</p>`;
  // Finished runs, plus any clip with an upload (so an uploaded unfinished run can still be forgotten).
  const complete = listing.clips.filter(clip => clip.complete || clip.upload);
  const unfinished = listing.clips.length - complete.length;
  const shown = clipsShowAll ? listing.clips : complete;
  const toggle = unfinished ? `<label class="clip-toggle"><input type="checkbox" id="clips-show-all" ${clipsShowAll ? "checked" : ""}> ${tr(`Show unfinished runs (${unfinished})`, `Niet uitgereden ritten tonen (${unfinished})`)}</label>` : "";
  const rows = shown.length ? shown.map(clip => clipCardHtml(clip, youtube, listing.uploading)).join("")
    : `<p class="empty-row">${listing.clips.length ? tr("No finished runs with a recognized time yet.", "Nog geen uitgereden ritten met een herkende tijd.") : tr("No clips on this PC yet. LiveTrial keeps one clip per race while it captures.", "Nog geen clips op deze pc. LiveTrial bewaart tijdens het opnemen één clip per rit.")}</p>`;
  $("#app-dialog-body").innerHTML = `<div class="clips">${intro}${toggle}<div class="dialog-error"></div><div class="clip-list">${rows}</div></div>`;
  // A missing end-screen picture falls back to the track picture (no inline handlers: CSP).
  $$("#app-dialog-body .clip-still img").forEach(img => img.addEventListener("error", () => {
    if (img.dataset.fallback && img.getAttribute("src") !== img.dataset.fallback) img.src = img.dataset.fallback; else img.remove();
  }));
  $("#clips-show-all")?.addEventListener("change", event => { clipsShowAll = event.target.checked; renderClips(); });
  $$("#app-dialog-body [data-clip-upload]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const draft = await action("clips.draft", {clipId: button.dataset.clipUpload});
      clipsForm = {clipId: draft.clipId, title: draft.title, description: draft.description,
        privacy: draft.privacy.default, options: draft.privacy.options, busy: false, error: ""};
    } catch (error) { dialogError(error.message); }
    renderClips();
  }));
  bindClipForm();
  $$("#app-dialog-body [data-clip-copy]").forEach(button => button.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(button.dataset.clipCopy); button.textContent = tr("✓ Copied", "✓ Gekopieerd"); }
    catch (_) { window.prompt(tr("Copy this link:", "Kopieer deze link:"), button.dataset.clipCopy); }
  }));
  $$("#app-dialog-body [data-clip-forget]").forEach(button => button.addEventListener("click", () => { clipsForgetId = button.dataset.clipForget; renderClips(); }));
  $$("#app-dialog-body [data-clip-forget-no]").forEach(button => button.addEventListener("click", () => { clipsForgetId = null; renderClips(); }));
  $$("#app-dialog-body [data-clip-forget-yes]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try { await action("clips.forget", {clipId: button.dataset.clipForgetYes}); } catch (error) { dialogError(error.message); }
    clipsForgetId = null;
    renderClips();
  }));
  // While the Player edits, the list is not redrawn under their cursor.
  if (listing.uploading && !clipsForm) clipsTimer = setTimeout(renderClips, 1000);
}
function bindClipForm() {
  const root = $("#app-dialog-body .clip-upload-form");
  if (!root || !clipsForm) return;
  const title = root.querySelector("#clip-form-title"), description = root.querySelector("#clip-form-description");
  const refresh = () => {
    clipsForm.error = "";
    root.querySelector("#clip-form-title-count").textContent = `${[...clipsForm.title].length}/100`;
    root.querySelector("#clip-form-description-count").textContent = `${utf8Bytes(clipsForm.description)}/5000`;
    const problem = clipFormProblem(clipsForm);
    const box = root.querySelector("#clip-form-problem");
    box.textContent = problem;
    box.hidden = !problem;
    root.querySelector("#clip-form-upload").disabled = Boolean(problem) || clipsForm.busy;
  };
  title.addEventListener("input", () => { clipsForm.title = title.value; refresh(); });
  description.addEventListener("input", () => { clipsForm.description = description.value; refresh(); });
  root.querySelectorAll("[data-clip-form-privacy]").forEach(button => button.addEventListener("click", () => {
    clipsForm.privacy = button.dataset.clipFormPrivacy;
    root.querySelectorAll("[data-clip-form-privacy]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
  }));
  root.querySelector("#clip-form-cancel").addEventListener("click", () => { clipsForm = null; renderClips(); });
  root.querySelector("#clip-form-upload").addEventListener("click", async () => {
    if (clipFormProblem(clipsForm)) return;
    clipsForm.busy = true;
    refresh();
    try {
      // Exactly what is in the form: no trimming, no rewriting.
      await action("clips.upload", {clipId: clipsForm.clipId, privacyStatus: clipsForm.privacy,
        title: clipsForm.title, description: clipsForm.description});
      clipsForm = null;
    } catch (error) {
      clipsForm.busy = false;
      clipsForm.error = error.message;
    }
    renderClips();
  });
}
$("#clips-open").addEventListener("click", () => {
  clipsForgetId = null;
  clipsForm = null;
  appDialog(tr("Clips on this PC", "Clips op deze pc"), `<div class="clips"><p>${tr("Loading…", "Laden…")}</p></div>`);
  renderClips();
});

(async () => {
  refreshAccounts();
  try {
    const config = await (await fetch("/api/config", {cache:"no-store"})).json();
    language = DASHBOARD_LANGUAGES.some(([code]) => code === config.language) ? config.language : "en";
    if (usesCatalog()) await loadCatalog(language);
    historyManagedByApp = Boolean(config.app);
    if (config.app) {
      try {
        const settings = await action("settings.get");
        if (typeof settings.serverOrigin === "string") SITE_ORIGIN = settings.serverOrigin;
      } catch (_) {}
    }
    document.documentElement.lang = language;
    applyLanguage();
    if (config.historyUrl === historyUrl) {
      $("#history-new").href = config.historyUrl;
    }
  } catch (_) {}
  // The app layer renders its own words, so it starts once the language is known (or not at all).
  await startApp();
  await load(true);
  await loadBuild();
  const savedTab=(()=>{try{return localStorage.getItem("mk8dx.dashboard.tab")}catch(_){return null}})();
  showTab(savedTab==="progress"?"records":savedTab);
})();
