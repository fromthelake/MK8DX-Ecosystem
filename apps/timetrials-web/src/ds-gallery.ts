// Checkpoint-1 component gallery (IMPLEMENTATION_PLAN §3.2): a real route built from the real
// design-system primitives, for the owner review on development and the QA mirror only.
// main.ts loads this module with a non-literal dynamic import, so the release bundle never contains
// it, and tooling/deployment/build_hosted_release.mjs refuses a package that does (it also drops
// styles/ds-gallery.css). Query: ?design-gallery[&appearance=dark|light|hc][&lang=en|nl][&scale=100|115|130][&tab=…]
import {
  armedButton,
  brandLockup,
  button,
  chip,
  combinedValue,
  dialog,
  el,
  engineMark,
  engineSelector,
  field,
  filterChips,
  heroRank,
  hiddenByPreference,
  menu,
  nextId,
  rankingTable,
  segmentedControl,
  setupPicker,
  setupSummary,
  statusMessage,
  stepper,
  tabs,
  timeInput,
  youChip,
} from "./ds-components.js";
import { formatCount, formatRank, type NumberLanguage } from "./ds-numeric.js";
import { GAME_ASSET_BASE } from "./asset-manifest.js";
import { BODY_PARTS, CHARACTER_PARTS, TIRE_PARTS } from "./loadout-manifest.js";

type Appearance = "dark" | "light" | "hc";
const STYLESHEETS = ["ds-tokens.css", "ds-fonts.css", "ds-base.css", "ds-components.css", "ds-gallery.css"];
const BRAND_BASE = `${GAME_ASSET_BASE}images/brand/`;

function readParams(): Readonly<{ appearance: Appearance; language: NumberLanguage; scale: 100 | 115 | 130; tab: string }> {
  const query = new URLSearchParams(window.location.search);
  const appearance = query.get("appearance");
  const scale = Number(query.get("scale"));
  let stored: string | null = null;
  try { stored = window.localStorage.getItem("mk8dx.product-language.v1"); } catch { stored = null; }
  const lang = query.get("lang") ?? stored;
  return {
    appearance: appearance === "light" || appearance === "hc" ? appearance : "dark",
    language: lang === "nl" ? "nl" : "en",
    scale: scale === 115 || scale === 130 ? scale : 100,
    tab: query.get("tab") ?? "total",
  };
}

function hrefWith(changes: Readonly<Record<string, string>>): string {
  const query = new URLSearchParams(window.location.search);
  query.set("design-gallery", "1");
  for (const [key, value] of Object.entries(changes)) { query.set(key, value); }
  return `/?${query.toString()}`;
}

export function mountDesignGallery(host: HTMLElement): void {
  const params = readParams();
  const t = (en: string, nl: string): string => (params.language === "nl" ? nl : en);
  const lang = params.language;
  document.documentElement.setAttribute("lang", lang);
  document.title = t("Design system · Checkpoint 1", "Designsysteem · Checkpoint 1");
  document.documentElement.style.setProperty("font-size", `${params.scale}%`);
  // The gallery owns its page frame (the legacy sheets are loaded, but must not shape it).
  document.body.style.setProperty("margin", "0");
  for (const file of STYLESHEETS) {
    // Since Phase 4 the product document links the system sheets itself; only
    // the gallery's own layout sheet still has to be added here.
    if (document.querySelector(`link[data-ds="${file}"], link[href*="${file}"]`) === null) {
      document.head.append(el("link", "", { rel: "stylesheet", href: `./styles/${file}`, "data-ds": file }));
    }
  }
  const brandAppearance = params.appearance === "light" ? "light" : "dark";

  const root = el("div", "ds-root ds-gallery", { "data-appearance": params.appearance, "data-spectacle": "low" });
  const main = el("main", "ds-gallery__main", { id: "ds-gallery-main" });
  const sectionIndex = el("nav", "ds-gallery__index", { "aria-label": t("Sections", "Onderdelen") });
  const sections: HTMLElement[] = [];
  const section = (id: string, title: string, intro: string, ...content: (Node | null)[]): void => {
    const headingId = `${id}-title`;
    const node = el("section", "ds-gallery__section", { id, "aria-labelledby": headingId },
      el("p", "ds-kicker", {}, "CP1"),
      el("h2", "ds-display-6", { id: headingId }, title),
      el("p", "ds-body-s ds-gallery__intro", {}, intro),
      ...content);
    sections.push(node);
    sectionIndex.append(el("a", "ds-gallery__index-link", { href: `#${id}` }, title));
  };
  const row = (...children: (Node | null)[]): HTMLElement => el("div", "ds-gallery__row", {}, ...children);
  const labelled = (label: string, ...children: (Node | null)[]): HTMLElement =>
    el("div", "ds-gallery__sample", {}, el("span", "ds-label", {}, label), el("div", "ds-gallery__sample-body", {}, ...children));
  const panel = (appearance: Appearance, ...children: (Node | null)[]): HTMLElement =>
    el("div", "ds-root ds-gallery__panel", { "data-appearance": appearance }, ...children);

  // ---- header + controls
  const controls = el("div", "ds-gallery__controls", {},
    segmentedControl<Appearance>({
      label: t("Appearance", "Weergave"),
      choices: [{ value: "dark", label: t("Dark", "Donker") }, { value: "light", label: t("Light", "Licht") }, { value: "hc", label: t("High contrast", "Hoog contrast") }],
      value: params.appearance,
      onChange: (value) => { window.location.assign(hrefWith({ appearance: value })); },
    }).root,
    segmentedControl<NumberLanguage>({
      label: t("Language", "Taal"),
      choices: [{ value: "en", label: "English" }, { value: "nl", label: "Nederlands" }],
      value: lang,
      onChange: (value) => { window.location.assign(hrefWith({ lang: value })); },
    }).root,
    segmentedControl<100 | 115 | 130>({
      label: t("Text size", "Tekstgrootte"),
      choices: [{ value: 100, label: "100%" }, { value: 115, label: "115%" }, { value: 130, label: "130%" }],
      value: params.scale,
      onChange: (value) => { window.location.assign(hrefWith({ scale: String(value) })); },
    }).root);
  const header = el("header", "ds-gallery__header", {},
    el("a", "ds-gallery__skip", { href: "#ds-gallery-main" }, t("Skip to content", "Naar de inhoud")),
    brandLockup({ appearance: brandAppearance, assetBase: BRAND_BASE, label: "MK8DX Time Trials", size: "compact" }),
    el("div", "ds-gallery__title", {},
      el("h1", "ds-display-4", {}, t("Design system", "Designsysteem")),
      el("p", "ds-body-s", {}, t(
        "Checkpoint 1: the real components with the frozen tokens. Development and QA mirror only.",
        "Checkpoint 1: de echte componenten met de bevroren tokens. Alleen ontwikkeling en QA-spiegel."))),
    controls);

  // ---- 1 identity
  const identityPanel = (appearance: "dark" | "light"): HTMLElement => panel(appearance,
    el("p", "ds-label", {}, appearance === "dark" ? t("Dark", "Donker") : t("Light", "Licht")),
    labelled(t("Full lockup", "Volledig logo"), brandLockup({ appearance, assetBase: BRAND_BASE, label: "MK8DX Time Trials" })),
    labelled(t("Compact lockup", "Compact logo"), brandLockup({ appearance, assetBase: BRAND_BASE, label: "MK8DX Time Trials", size: "compact" })),
    labelled(t("Mark 16 / 24 / 32 / 48", "Beeldmerk 16 / 24 / 32 / 48"), row(
      ...([16, 24, 32, 48] as const).map((px) => brandLockup({ appearance, assetBase: BRAND_BASE, label: `MK8DX ${px}px`, size: "mark", markPx: px })))));
  section("identity", t("Identity", "Identiteit"), t(
    "The original owner artwork, pixel-derived for Light; the monochrome mark replaces it in forced colours.",
    "Het originele logo van de eigenaar, pixelgetrouw afgeleid voor Licht; in geforceerde kleuren verschijnt het monochrome beeldmerk."),
  el("div", "ds-gallery__pair", {}, identityPanel("dark"), identityPanel("light")));

  // ---- 2 typography
  const longName = "Maximiliaan van der Westhuizen-Oosterbroek";
  section("typography", t("Typography", "Typografie"), t(
    "Saira Condensed for display, IBM Plex Sans for the interface, IBM Plex Mono for data. Self-hosted.",
    "Saira Condensed voor koppen, IBM Plex Sans voor de interface, IBM Plex Mono voor gegevens. Zelf gehost."),
  el("div", "ds-gallery__stack", {},
    ...(["display-1", "display-2", "display-3", "display-4", "display-5", "display-6"] as const).map((step) =>
      labelled(step, el("p", `ds-${step}`, {}, t("Tournament night", "Toernooiavond")))),
    labelled("kicker", el("p", "ds-kicker", {}, t("Time Trials · 150cc", "Time Trials · 150cc"))),
    labelled("title", el("p", "ds-title", {}, t("Your best times", "Je beste tijden"))),
    labelled("body", el("p", "ds-body", {}, t(
      "Post a time from the end screen or the ghost panel; you check every value before it counts.",
      "Leg een tijd vast vanaf het eindscherm of het ghostpaneel; je controleert elke waarde voordat die telt."))),
    labelled("body-s", el("p", "ds-body-s", {}, t("Updated 3 minutes ago", "3 minuten geleden bijgewerkt"))),
    labelled("label", el("p", "ds-label", {}, t("Total time", "Totaaltijd"))),
    labelled("micro", el("p", "ds-micro", {}, t("TRACK · CLASS", "CIRCUIT · KLASSE"))),
    labelled(t("Data roles", "Gegevensrollen"), el("div", "ds-gallery__stack", {},
      el("span", "ds-data-xl", {}, "1:45.912"),
      el("span", "ds-data-l", {}, formatRank(1_234, lang)),
      el("span", "ds-data-m", {}, formatCount(12_345, lang)),
      el("span", "ds-data", {}, "0:35.392  0:35.100  0:35.420"),
      el("span", "ds-data-s", {}, "−0.412  +1:02.004"))),
    labelled(t("Long name", "Lange naam"), el("p", "ds-title ds-gallery__narrow", {}, longName)),
    labelled(t("Digits and letters", "Cijfers en letters"), el("p", "ds-data", {}, "0O 1lI 5S 8B · 0123456789"))));

  // ---- 3 attention
  section("attention", t("Attention", "Aandacht"), t(
    "A4 is the one thing to do (one per view); A3 identity and key results; A2 sections; A1 rows; A0 meta.",
    "A4 is het ene dat je moet doen (één per scherm); A3 identiteit en kernresultaat; A2 onderdelen; A1 rijen; A0 details."),
  el("div", "ds-gallery__stack", {},
    labelled("A4", button({ label: t("Post a time", "Tijd vastleggen"), variant: "primary", icon: "stopwatch" }).root),
    labelled("A3", row(heroRank(12, lang, t("Your position", "Jouw positie")),
      el("div", "", {}, el("p", "ds-display-6", {}, "Evan"), youChip(t("You", "Jij"))))),
    labelled("A2", row(el("h3", "ds-title", {}, t("Track times", "Circuittijden")), chip(t("Advanced", "Gevorderd"), "advanced"), engineMark(150))),
    labelled("A1", row(el("span", "ds-body", {}, t("Mario Kart Stadium", "Mario Kart-stadion")), button({ label: t("Compare", "Vergelijken") }).root)),
    labelled("A0", row(el("span", "ds-label", {}, t("Set 2 days ago", "2 dagen geleden gereden")), button({ label: t("Details", "Details"), variant: "quiet" }).root)),
    labelled(t("Global action levels", "Niveaus van de hoofdactie"), row(
      button({ label: t("Post a time", "Tijd vastleggen"), variant: "primary", icon: "stopwatch", size: "sm" }).root,
      button({ label: t("Post a time", "Tijd vastleggen"), variant: "global", icon: "stopwatch" }).root,
      el("a", "ds-button", { href: "#attention", "data-variant": "quiet" }, t("Post a time", "Tijd vastleggen"))))));

  // ---- 4 colour semantics
  const swatch = (token: string, label: string, text?: string): HTMLElement =>
    el("div", "ds-gallery__swatch", { "data-token": token }, el("span", "ds-gallery__chip-colour", { "aria-hidden": "true" }),
      el("span", "ds-label", {}, label), el("span", "ds-micro", {}, text ?? `--ds-${token}`));
  let hiddenShown = false;
  const hiddenSlot = el("div", "");
  const renderHidden = (): void => {
    hiddenSlot.replaceChildren(hiddenShown
      ? el("div", "ds-gallery__stack", {}, row(engineMark(200), el("span", "ds-data-m", {}, "14 / 96")),
        button({ label: t("Hide 200cc again", "200cc weer verbergen"), variant: "quiet", onPress: () => { hiddenShown = false; renderHidden(); } }).root)
      : hiddenByPreference({
        text: t("200cc is hidden by your Time Trial preference. Nothing is lost.", "200cc is verborgen door je Time Trial-voorkeur. Er gaat niets verloren."),
        showLabel: t("Show 200cc anyway", "Toch 200cc tonen"),
        onShow: () => { hiddenShown = true; renderHidden(); },
      }));
  };
  renderHidden();
  section("colour", t("Colour semantics", "Kleurbetekenis"), t(
    "Flare is action, volt is you, blue is 150cc, red is 200cc. Colour is never the only cue.",
    "Flare is actie, volt ben jij, blauw is 150cc, rood is 200cc. Kleur is nooit het enige signaal."),
  el("div", "ds-gallery__swatches", {},
    swatch("action-primary", t("Action (flare)", "Actie (flare)")),
    swatch("personal-accent", t("You (volt)", "Jij (volt)")),
    swatch("engine-150", "150cc"),
    swatch("engine-200", "200cc"),
    swatch("status-success", t("Success", "Gelukt")),
    swatch("status-warning", t("Warning", "Waarschuwing")),
    swatch("status-error", t("Error", "Fout")),
    swatch("status-info", t("Info", "Info")),
    swatch("live", "Live"),
    swatch("focus-ring", t("Focus", "Focus"))),
  row(chip("Live", "live"), chip(t("Faster", "Sneller"), "success"), chip(t("Check", "Controleren"), "warning"),
    chip(t("Rejected", "Afgewezen"), "error"), chip(t("Race direction", "Wedstrijdleiding"), "race-direction"), youChip(t("You", "Jij"))),
  labelled(t("Combined (engine-independent count)", "Gecombineerd (telling los van de klasse)"),
    combinedValue({ label: t("Combined", "Gecombineerd"), total: formatCount(184, lang), breakdown: `150cc ${formatCount(122, lang)} · 200cc ${formatCount(62, lang)}` })),
  labelled(t("Hidden by preference (hidden ≠ zero)", "Verborgen door voorkeur (verborgen ≠ nul)"), hiddenSlot),
  el("div", "ds-gallery__stack", {},
    statusMessage("info", t("Scanned values are marked; check them before you publish.", "Gescande waarden zijn gemarkeerd; controleer ze voordat je publiceert.")),
    statusMessage("success", t("Published. You are #12 of 214.", "Gepubliceerd. Je staat #12 van 214.")),
    statusMessage("warning", t("Lap 3 looks unusual. Check it.", "Ronde 3 ziet er ongebruikelijk uit. Controleer hem.")),
    statusMessage("error", t("Publishing failed. Your entry is kept; try again.", "Publiceren is mislukt. Je invoer is bewaard; probeer het opnieuw."))));

  // ---- 5 actions
  const loading = button({ label: t("Publish", "Publiceren"), variant: "secondary" });
  loading.setLoading(t("Publishing…", "Bezig met publiceren…"));
  const armed = armedButton({
    label: t("Publish time", "Tijd publiceren"), armedLabel: t("Press again to publish", "Druk nogmaals om te publiceren"),
    nextStep: t("Publishes 1:45.912 on Mario Kart Stadium · 150cc", "Publiceert 1:45.912 op Mario Kart-stadion · 150cc"),
    icon: "stopwatch", onConfirm: () => { armedStatus.textContent = t("Published (demo).", "Gepubliceerd (demo)."); },
  });
  const armedStatus = el("p", "ds-body-s", { role: "status" });
  section("actions", t("Actions", "Acties"), t(
    "One primary per view. Disabled actions stay focusable and always say why.",
    "Eén primaire actie per scherm. Uitgeschakelde acties blijven bereikbaar en zeggen altijd waarom."),
  el("div", "ds-gallery__stack", {},
    labelled(t("Primary · sm / md / lg", "Primair · sm / md / lg"), row(
      button({ label: t("Post a time", "Tijd vastleggen"), variant: "primary", icon: "stopwatch", size: "sm" }).root,
      button({ label: t("Post a time", "Tijd vastleggen"), variant: "primary", icon: "stopwatch" }).root,
      button({ label: t("Post a time", "Tijd vastleggen"), variant: "primary", icon: "stopwatch", size: "lg" }).root)),
    labelled(t("Stepped-down global · secondary · quiet · destructive", "Afgezwakt · secundair · stil · verwijderen"), row(
      button({ label: t("Post a time", "Tijd vastleggen"), variant: "global", icon: "stopwatch" }).root,
      button({ label: t("Compare", "Vergelijken") }).root,
      button({ label: t("Show all laps", "Alle ronden tonen"), variant: "quiet" }).root,
      button({ label: t("Withdraw time", "Tijd intrekken"), variant: "danger" }).root)),
    labelled(t("Disabled with a reason", "Uitgeschakeld met reden"),
      button({ label: t("Publish", "Publiceren"), variant: "primary", disabledReason: t("Publish · enter a total time first", "Publiceren · vul eerst een totaaltijd in") }).root),
    labelled(t("Loading", "Bezig"), loading.root),
    labelled(t("Armed (two presses)", "Gewapend (twee keer drukken)"), armed.root, armedStatus)));

  // ---- 6 engine
  const engineStatus = el("p", "ds-body-s", { role: "status" }, t("Showing 150cc", "150cc wordt getoond"));
  const rule = el("div", "ds-engine-rule", { "data-engine": "150", "aria-hidden": "true" });
  const selectorLarge = engineSelector({
    label: t("Engine class", "Klasse"), value: 150, size: "lg",
    onChange: (engine) => {
      selectorSmall.set(engine);
      rule.setAttribute("data-engine", String(engine));
      engineStatus.textContent = t(`Showing ${engine}cc`, `${engine}cc wordt getoond`);
    },
  });
  const selectorSmall = engineSelector({ label: t("Engine class (compact)", "Klasse (compact)"), value: 150, onChange: (engine) => selectorLarge.set(engine) });
  section("engine", "EngineSelector", t(
    "A radio group: arrow keys move and select. Selected = engine tint + 3 px underline + ✓ + bold label.",
    "Een keuzegroep: pijltjestoetsen verplaatsen en kiezen. Gekozen = klassekleur + 3 px streep + ✓ + vet."),
  el("div", "ds-gallery__stack", {},
    labelled(t("Selector (live)", "Keuze (werkt)"), selectorLarge.root, selectorSmall.root, rule, engineStatus),
    labelled(t("Both states, Dark and Light", "Beide standen, Donker en Licht"), el("div", "ds-gallery__pair", {},
      ...(["dark", "light"] as const).map((appearance) => panel(appearance,
        engineSelector({ label: `150 ${appearance}`, value: 150, onChange: () => undefined }).root,
        engineSelector({ label: `200 ${appearance}`, value: 200, onChange: () => undefined }).root)))),
    labelled("EngineMark", row(engineMark(150), engineMark(200), engineMark(150, "lg"), engineMark(200, "lg"), engineMark(150, "plain"), engineMark(200, "plain"))),
    labelled(t("Without colour: ✓, chevrons, text and underline still tell", "Zonder kleur: ✓, pijlen, tekst en streep blijven zichtbaar"),
      el("div", "ds-gallery__grayscale", {}, engineSelector({ label: t("Grayscale", "Grijstinten"), value: 200, onChange: () => undefined }).root, engineMark(150), engineMark(200)))));

  // ---- 7 selection
  const tabItems = [
    { key: "total", label: t("Total", "Totaal") }, { key: "medals", label: t("Medals", "Medailles") },
    { key: "mastery", label: t("Mastery", "Meesterschap") }, { key: "tracks", label: t("Tracks", "Circuits") },
  ];
  section("selection", t("Selection", "Selectie"), t(
    "The calm selected state: surface lift + ✓ + underline. Tabs are real links (the URL keeps the tab).",
    "De rustige gekozen stand: lichter vlak + ✓ + streep. Tabbladen zijn echte links (de URL onthoudt het tabblad)."),
  el("div", "ds-gallery__stack", {},
    labelled(t("Tabs (URL-addressable)", "Tabbladen (via de URL)"), tabs({
      label: t("Ranking views", "Rankingweergaven"),
      items: tabItems.map((item) => ({ href: `${hrefWith({ tab: item.key })}#selection`, label: item.label, current: params.tab === item.key })),
    }), el("p", "ds-body-s", {}, t(`Current tab: ${params.tab}`, `Huidig tabblad: ${params.tab}`))),
    labelled(t("Segmented control", "Segmentkeuze"), segmentedControl<string>({
      label: t("Scope", "Bereik"),
      choices: [{ value: "base", label: t("Base game", "Basisspel") }, { value: "bcp", label: "Booster Course Pass" }, { value: "all", label: t("All", "Alle") }],
      value: "base", onChange: () => undefined,
    }).root),
    labelled(t("Filter chips", "Filterchips"), filterChips({
      label: t("Show", "Toon"),
      chips: [{ value: "rivals", label: t("Rivals", "Rivalen"), pressed: true }, { value: "friends", label: t("Friends", "Vrienden"), pressed: false }, { value: "country", label: t("My country", "Mijn land"), pressed: false }],
      onChange: () => undefined,
    }))));

  // ---- 8 data
  const players = ["Evan", "Nova", "Matteo", "Valerio", "Leonora", longName, "Ben", "Tess"];
  const stressRows = [
    { rank: 1, name: players[0]!, timeMs: 105_412 },
    { rank: 2, name: players[1]!, timeMs: 105_498, deltaMs: 86 },
    { rank: 3, name: players[2]!, timeMs: 105_912, deltaMs: 500 },
    { rank: 99, name: players[3]!, timeMs: 108_004, deltaMs: 2_592 },
    { rank: 999, name: players[4]!, timeMs: 111_250, deltaMs: 5_838 },
    { rank: 1_000, name: players[5]!, timeMs: 111_251, deltaMs: 5_839, kind: "you" as const, youLabel: t("You", "Jij") },
    { rank: 10_000, name: players[6]!, timeMs: 125_000, deltaMs: 19_588 },
    { rank: 99_999, name: players[7]!, timeMs: 3_725_004, deltaMs: 3_619_592 },
  ];
  const headers = { rank: "#", player: t("Player", "Speler"), time: t("Time", "Tijd"), gap: t("Gap", "Verschil") };
  section("data", t("Tables and ranks", "Tabellen en posities"), t(
    "Ranks #1 to #99,999: the rank column is sized from the largest rank in the table; names shorten first, numbers never.",
    "Posities #1 tot #99.999: de positiekolom volgt de grootste positie in de tabel; namen worden eerst ingekort, getallen nooit."),
  el("div", "ds-gallery__stack", {},
    labelled(t("Stress set (#1 … #99,999)", "Stresstest (#1 … #99.999)"), rankingTable({
      caption: t("Mario Kart Stadium · 150cc", "Mario Kart-stadion · 150cc"), language: lang, headers, density: "timing",
      rows: [...stressRows.slice(0, 3), { rank: 12, name: t("Nintendo ghost", "Nintendo-ghost"), timeMs: 106_500, deltaMs: 1_088, kind: "reference" }, ...stressRows.slice(3)],
    })),
    labelled(t("Small board: the column stays narrow", "Kleine lijst: de kolom blijft smal"), rankingTable({
      caption: t("Night 13 · group A", "Avond 13 · groep A"), language: lang, headers,
      rows: stressRows.slice(0, 3).map((row, index) => ({ ...row, rank: index + 1 })).concat([{ rank: 4, name: "Ben", timeMs: 106_004, deltaMs: -212, kind: "you", youLabel: t("You", "Jij") }]),
    })),
    labelled(t("Hero rank: four fixed steps", "Grote positie: vier vaste stappen"), el("div", "ds-gallery__heroes", {},
      ...[1, 12, 123, 1_234, 12_345, 99_999].map((rank) => heroRank(rank, lang, t("Position", "Positie")))))));

  // ---- 9 forms
  const totalError = nextId("ds-total-error");
  const coins = (lap: number): HTMLElement => stepper({
    label: t(`Coins after lap ${lap}`, `Munten na ronde ${lap}`), value: lap === 1 ? 3 : 5, min: 0, max: 10,
    decrementLabel: t("Fewer coins", "Minder munten"), incrementLabel: t("More coins", "Meer munten"),
  });
  const mushrooms = (lap: number): HTMLElement => segmentedControl<number>({
    label: t(`Mushrooms in lap ${lap}`, `Paddenstoelen in ronde ${lap}`),
    choices: [0, 1, 2, 3].map((value) => ({ value, label: String(value) })), value: lap === 1 ? 1 : 0, onChange: () => undefined,
  }).root;
  const lapRow = (lap: number, digits: string, extra?: Readonly<{ source?: boolean; doubt?: boolean }>): HTMLElement =>
    el("div", "ds-lap-row", {},
      el("span", "ds-lap-row__label", {}, t(`Lap ${lap}`, `Ronde ${lap}`)),
      timeInput({ label: t(`Lap ${lap} time`, `Tijd ronde ${lap}`), digits, size: "compact", ...(extra?.doubt ? { doubt: true } : {}) }).root,
      coins(lap), mushrooms(lap));
  const pickerStatus = el("p", "ds-body-s", { role: "status" });
  const setupParts = [
    { kind: t("Character", "Coureur"), name: CHARACTER_PARTS[16]?.name ?? "Yoshi", art: `${GAME_ASSET_BASE}${CHARACTER_PARTS[16]?.iconPath ?? ""}` },
    { kind: t("Body", "Chassis"), name: BODY_PARTS[1]?.name ?? "Pipe Frame", art: `${GAME_ASSET_BASE}${BODY_PARTS[1]?.iconPath ?? ""}`, doubt: t("Check: scanned", "Controleer: gescand") },
    { kind: t("Tires", "Banden"), name: TIRE_PARTS[0]?.name ?? "Standard", art: `${GAME_ASSET_BASE}${TIRE_PARTS[0]?.iconPath ?? ""}` },
    { kind: t("Glider", "Paraglider"), name: null },
  ];
  section("forms", t("Forms", "Formulieren"), t(
    "The Post-a-Time primitives: TimeInput, lap rows, setup summary and picker, scan marks, doubt and errors. Not wired into the live form yet.",
    "De bouwstenen van Tijd vastleggen: tijdinvoer, rondes, opstelling en kiezer, scanmarkering, twijfel en fouten. Nog niet gekoppeld aan het echte formulier."),
  el("div", "ds-gallery__stack", {},
    field({ label: t("Total time", "Totaaltijd"), control: timeInput({ label: t("Total time", "Totaaltijd"), digits: "" }).root, hint: t("Type the digits: 1 45 912", "Typ de cijfers: 1 45 912") }),
    field({ label: t("Total time (scanned)", "Totaaltijd (gescand)"), control: timeInput({ label: t("Total time", "Totaaltijd"), digits: "145912" }).root, source: { kind: "scan", label: t("Scanned", "Gescand") } }),
    field({ label: t("Total time (scanned, then edited)", "Totaaltijd (gescand, daarna aangepast)"), control: timeInput({ label: t("Total time", "Totaaltijd"), digits: "145812" }).root, source: { kind: "edited", label: t("Edited", "Aangepast") } }),
    field({ label: t("Total time (doubtful)", "Totaaltijd (twijfel)"), control: timeInput({ label: t("Total time", "Totaaltijd"), digits: "145912", doubt: true }).root, doubt: t("The scan was unsure about the last digit.", "De scan twijfelde over het laatste cijfer.") }),
    field({ label: t("Total time (error)", "Totaaltijd (fout)"), control: timeInput({ label: t("Total time", "Totaaltijd"), digits: "175912", invalid: true, describedBy: totalError }).root, errorId: totalError, error: t("Check the total time — seconds go up to 59.", "Controleer de totaaltijd — seconden gaan tot 59.") }),
    labelled(t("Lap rows", "Rondes"), el("div", "ds-lap-rows", {}, lapRow(1, "035392", { source: true }), lapRow(2, "035100"), lapRow(3, "035420", { doubt: true }))),
    labelled(t("Setup summary", "Opstelling"), setupSummary({ label: t("Setup", "Opstelling"), parts: setupParts, emptyName: t("Choose", "Kiezen"), onOpen: (index) => { pickerStatus.textContent = t(`Open picker for part ${index + 1}`, `Kiezer openen voor onderdeel ${index + 1}`); } }), pickerStatus),
    labelled(t("Setup picker", "Onderdelenkiezer"), setupPicker<string>({
      label: t("Character", "Coureur"),
      choices: CHARACTER_PARTS.slice(0, 12).map((part) => ({ value: part.id, label: part.name, art: `${GAME_ASSET_BASE}${part.iconPath}` })),
      value: CHARACTER_PARTS[1]?.id ?? null, onChange: () => undefined,
    }))));

  // ---- 10 overlays
  const plainDialog = dialog({
    title: t("Withdraw this time?", "Deze tijd intrekken?"),
    body: [el("p", "ds-body", {}, t("1:45.912 on Mario Kart Stadium · 150cc leaves the leaderboard. You can post it again later.", "1:45.912 op Mario Kart-stadion · 150cc verdwijnt van de ranglijst. Je kunt hem later opnieuw vastleggen."))],
    actions: [
      button({ label: t("Cancel", "Annuleren"), onPress: () => plainDialog.close() }).root,
      button({ label: t("Withdraw time", "Tijd intrekken"), variant: "danger", onPress: () => plainDialog.close() }).root,
    ],
  });
  const sheet = dialog({
    kind: "sheet", title: t("Choose a track", "Kies een circuit"),
    body: [el("p", "ds-body-s", {}, t("A sheet on phones; a centred panel on larger screens.", "Een blad op telefoons; een middenpaneel op grotere schermen."))],
    actions: [button({ label: t("Close", "Sluiten"), onPress: () => sheet.close() }).root],
  });
  const filterSheet = dialog({
    kind: "sheet", title: t("Filters", "Filters"),
    body: [
      field({ label: t("Engine class", "Klasse"), control: engineSelector({ label: t("Engine class", "Klasse"), value: 150, onChange: () => undefined }).root }),
      field({ label: t("Scope", "Bereik"), control: segmentedControl<string>({ label: t("Scope", "Bereik"), choices: [{ value: "base", label: t("Base game", "Basisspel") }, { value: "all", label: t("All", "Alle") }], value: "all", onChange: () => undefined }).root }),
      field({ label: t("Show", "Toon"), control: filterChips({ label: t("Show", "Toon"), chips: [{ value: "rivals", label: t("Rivals", "Rivalen"), pressed: false }, { value: "friends", label: t("Friends", "Vrienden"), pressed: true }], onChange: () => undefined }) }),
    ],
    actions: [
      button({ label: t("Reset", "Herstellen"), variant: "quiet", onPress: () => filterSheet.close() }).root,
      button({ label: t("Apply", "Toepassen"), variant: "secondary", onPress: () => filterSheet.close() }).root,
    ],
  });
  const menuStatus = el("p", "ds-body-s", { role: "status" });
  section("overlays", t("Overlays", "Overlays"), t(
    "Dialog, Sheet, Menu and FilterSheet: focus moves in, Escape closes, focus returns to the opener.",
    "Dialoog, blad, menu en filterblad: de focus gaat erin, Escape sluit, de focus keert terug naar de opener."),
  row(
    button({ label: t("Open dialog", "Dialoog openen"), onPress: () => plainDialog.open() }).root,
    button({ label: t("Open sheet", "Blad openen"), onPress: () => sheet.open() }).root,
    button({ label: t("Open filters", "Filters openen"), onPress: () => filterSheet.open() }).root,
    menu({ label: t("Account", "Account"), items: [
      { label: t("My records", "Mijn records"), onSelect: () => { menuStatus.textContent = t("My records", "Mijn records"); } },
      { label: t("Settings", "Instellingen"), onSelect: () => { menuStatus.textContent = t("Settings", "Instellingen"); } },
      { label: t("Sign out", "Afmelden"), tone: "danger", onSelect: () => { menuStatus.textContent = t("Sign out (demo)", "Afmelden (demo)"); } },
    ] }).root),
  el("div", "ds-filter-summary", {}, el("span", "", {}, t("Filters:", "Filters:")), engineMark(150), chip(t("All tracks", "Alle circuits"), "neutral"), chip(t("Friends", "Vrienden"), "info")),
  menuStatus);

  // ---- 11 accessibility
  section("accessibility", t("Accessibility", "Toegankelijkheid"), t(
    "Focus is always visible (inside slanted shapes too); text follows the reader's size; forced colours keep ✓ and underlines.",
    "De focus is altijd zichtbaar (ook in schuine vormen); tekst volgt de ingestelde grootte; geforceerde kleuren behouden ✓ en strepen."),
  el("div", "ds-gallery__stack", {},
    labelled(t("Focus inside the clip: press Tab", "Focus binnen de vorm: druk op Tab"), row(
      button({ label: t("Post a time", "Tijd vastleggen"), variant: "primary", icon: "stopwatch" }).root,
      button({ label: t("Compare", "Vergelijken") }).root,
      el("a", "ds-tab", { href: "#accessibility", "aria-current": "page" }, t("Tab link", "Tabbladlink")))),
    labelled(t("Light and Dark side by side", "Licht en Donker naast elkaar"), el("div", "ds-gallery__pair", {},
      ...(["dark", "light"] as const).map((appearance) => panel(appearance,
        el("p", "ds-title", {}, appearance === "dark" ? t("Dark", "Donker") : t("Light", "Licht")),
        el("p", "ds-body", {}, t("Body text on the raised surface.", "Lopende tekst op het verhoogde vlak.")),
        el("p", "ds-label", {}, t("Meta text (A0)", "Detailtekst (A0)")),
        button({ label: t("Post a time", "Tijd vastleggen"), variant: "primary", icon: "stopwatch", size: "sm" }).root)))),
    el("ul", "ds-body-s ds-gallery__list", {},
      el("li", "", {}, t("Text size: use the 100 / 115 / 130 % control above, or the browser's text size.", "Tekstgrootte: gebruik de keuze 100 / 115 / 130 % hierboven, of de tekstgrootte van de browser.")),
      el("li", "", {}, t("Reduced motion: all transitions come from motion tokens and drop to zero.", "Minder beweging: alle overgangen komen uit bewegingstokens en vallen weg.")),
      el("li", "", {}, t("Forced colours: system colours, ✓ and underlines as borders, the monochrome mark.", "Geforceerde kleuren: systeemkleuren, ✓ en strepen als randen, het monochrome beeldmerk.")))));

  main.append(...sections);
  root.append(header, sectionIndex, main);
  host.replaceChildren(root);
}
