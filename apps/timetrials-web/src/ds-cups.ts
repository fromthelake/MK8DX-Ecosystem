// W06 Tracks & Cups on the design system (Phase 12).
//
// MEDIUM spectacle (DESIGN_SYSTEM §5): the directory opens with an art strip, and the art on it is
// the cup icons and the track thumbnails it is a directory of — never decoration for its own sake.
// It owns no A4: a directory's one job is getting the reader to a board, so every card is the
// action (§4, the matrix's "none (navigation)").
//
// Engine context (ENGINE_CONTEXT_INVENTORY R4): this page never invented an engine before — its
// links left `mode` off and the track page resolved 150. A reader who came here from a 200cc board
// was silently put back on 150. The directory now resolves the engine once, exactly as every other
// surface does (link `mode` > the account's single-engine preference > 150), says which engine the
// boards will open in, and carries it into every track link. No number on this page depends on the
// engine, so nothing else changes when it is switched — which is why the control is labelled for
// what it does.
import {
  artHero,
  button,
  cardLink,
  el,
  emptyState,
  engineSelector,
  nextId,
  panel,
  type EngineSelectorHandle,
} from "./ds-components.js";
import { formatCount, type NumberLanguage } from "./ds-numeric.js";
import {
  CUP_ASSET_MANIFEST,
  GAME_ASSET_BASE,
  type CupAssetEntry,
  type TrackAssetEntry,
} from "./asset-manifest.js";
import { dutchPresentation, presentationSearchText } from "./dutch-ui-copy.js";
import { leaderboardHref, type EngineMode } from "./engine-context.js";
import { localized, productLanguage } from "./product-language.js";
import { schema9WebTrackCatalog } from "./schema9-track-catalog.js";

export type MountedCupsView = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  /** The engine the track links carry, or null when the route left it to the track page. */
  engine(): EngineMode | null;
  unmount(): void;
}>;

export type CupsViewOptions = Readonly<{
  /**
   * The canonical directory routes to the track board by default; bounded embedded consumers may
   * override only the resulting Track destination. An override owns its own engine handling.
   */
  trackHref?: (trackId: string) => string;
  /** An embedded chooser can keep normal link semantics while selecting in place on a plain click. */
  onTrackChosen?: (trackId: string) => void;
  /** Changes only the explanatory sentence; the directory presentation stays shared. */
  purpose?: "directory" | "post";
  /** The engine the links carry, already resolved by the route (R4). */
  engine?: EngineMode;
  /** Told when the reader changes it, so the route can rewrite the address. */
  onEngineChange?: (engine: EngineMode) => void;
}>;

const SEARCH_MINIMUM = 2;
const SEARCH_LIMIT = 24;

const cupIcon = (cup: CupAssetEntry, className: string, px: number): HTMLElement =>
  el("img", className, {
    src: `${GAME_ASSET_BASE}${cup.iconPath}`, alt: "", loading: "lazy",
    width: String(px), height: String(px), "aria-hidden": "true",
  });

export function mountCupsView(root: HTMLElement, options: CupsViewOptions = {}): MountedCupsView {
  const language = (): NumberLanguage => productLanguage();
  let disposed = false;
  // Without a resolved engine from the route (an embedded consumer), the link carries none and the
  // track page resolves it — never an invented 150 (R4).
  let engine: EngineMode | null = options.engine ?? null;
  let selector: EngineSelectorHandle | null = null;
  /** The cup whose four tracks are on screen, so an engine change repaints where the reader is. */
  let openCup: CupAssetEntry | null = null;

  const trackCount = CUP_ASSET_MANIFEST.reduce((total, cup) => total + cup.tracks.length, 0);
  const trackFacts = new Map(schema9WebTrackCatalog.map((track) => [track.id, track]));
  const trackHref = (track: TrackAssetEntry): string =>
    options.trackHref === undefined ? leaderboardHref(track.id, engine) : options.trackHref(track.id);
  const scrollToTop = (): void => { root.ownerDocument.defaultView?.scrollTo(0, 0); };

  const container = el("div", "ds-root ds-cups ds-stack", { "data-spectacle": "medium" });

  // ---------------------------------------------------------------- hero and search
  const searchId = nextId("ds-cups-search");
  const search = el("input", "ds-text-input ds-cups__search", {
    id: searchId, type: "search", autocomplete: "off", maxlength: "64",
    "aria-label": localized("Search tracks", "Circuits zoeken"),
    placeholder: localized("Search tracks", "Circuits zoeken"),
  });
  const resultStatus = el("p", "ds-cups__status ds-micro", { role: "status", "aria-live": "polite" });
  const content = el("div", "ds-stack", {});

  const aside: HTMLElement[] = [];
  if (options.engine !== undefined) {
    // Labelled for what it actually does here: nothing on this page is per engine, the boards are.
    const engineLabel = localized("Boards open in", "Klassementen openen in");
    selector = engineSelector({
      label: engineLabel,
      value: options.engine,
      onChange: (next) => {
        if (disposed || next === engine) { return; }
        engine = next;
        options.onEngineChange?.(next);
        paint();
      },
    });
    aside.push(el("div", "ds-cups__engine", {},
      el("span", "ds-cups__engine-label", {}, engineLabel), selector.root));
  }

  const hero = artHero({
    spectacle: "medium",
    title: localized("Tracks & Cups", "Circuits en bekers"),
    titleStep: "display-3",
    eyebrow: [localized(
      `Track directory · ${formatCount(CUP_ASSET_MANIFEST.length, language())} cups · ${formatCount(trackCount, language())} tracks`,
      `Circuitgids · ${formatCount(CUP_ASSET_MANIFEST.length, language())} bekers · ${formatCount(trackCount, language())} circuits`,
    )],
    children: [
      el("p", "ds-cups__lede", {}, options.purpose === "post"
        ? localized(
          "Choose a cup, or search the track you raced. Every track opens in Post a time.",
          "Kies een beker of zoek het circuit dat je reed. Elk circuit opent in Tijd plaatsen.",
        )
        : localized(
          "Choose a cup, or search a track by name. Every track opens on its leaderboard.",
          "Kies een beker of zoek een circuit op naam. Elk circuit opent op zijn klassement.",
        )),
    ],
    aside,
  });

  const controls = el("div", "ds-cups__controls", {},
    el("label", "ds-cups__search-label", { for: searchId },
      localized("Search tracks", "Circuits zoeken")),
    search, resultStatus);

  const mobileTitle = el("h1", "ds-cups__mobile-title", {}, localized("Choose a Cup", "Kies een beker"));
  const mobileMeta = el("p", "ds-cups__mobile-meta", {}, localized(
    `${formatCount(CUP_ASSET_MANIFEST.length, language())} cups · ${formatCount(trackCount, language())} tracks`,
    `${formatCount(CUP_ASSET_MANIFEST.length, language())} bekers · ${formatCount(trackCount, language())} circuits`,
  ));
  const mobileIcon = el("span", "ds-cups__mobile-icon", {});
  const mobileBack = el("span", "ds-cups__mobile-back", {});
  const mobileHeading = el("div", "ds-cups__mobile-heading", {},
    mobileIcon, el("div", "ds-cups__mobile-copy", {}, mobileTitle, mobileMeta), mobileBack);
  container.append(hero, mobileHeading, controls, content);
  root.append(container);

  // ---------------------------------------------------------------- the three views

  const trackCard = (cup: CupAssetEntry, track: TrackAssetEntry): HTMLElement => {
    const facts = trackFacts.get(track.id);
    const expansion = facts !== undefined && facts.index >= 48;
    const lapCount = facts?.lapCount ?? 3;
    const card = cardLink({
      href: trackHref(track),
      title: dutchPresentation(track.name),
      body: localized(
        `${lapCount} laps · ${expansion ? "Booster Course Pass" : "Base game"}`,
        `${lapCount} ronden · ${expansion ? "Booster Course Pass" : "Basisspel"}`,
      ),
      art: { src: `${GAME_ASSET_BASE}${track.previewPath}`, badge: `${GAME_ASSET_BASE}${cup.iconPath}` },
    });
    const title = card.querySelector(".ds-card__title");
    title?.replaceChildren(cupIcon(cup, "ds-cups__track-cup", 20), dutchPresentation(track.name));
    if (options.onTrackChosen !== undefined) {
      card.addEventListener("click", (event) => {
        const pointer = event as MouseEvent;
        if (pointer.button !== 0 || pointer.metaKey || pointer.ctrlKey || pointer.shiftKey || pointer.altKey) { return; }
        event.preventDefault();
        options.onTrackChosen?.(track.id);
      });
    }
    return card;
  };

  const renderCupGrid = (): void => {
    openCup = null;
    container.dataset.view = "grid";
    mobileTitle.textContent = localized("Choose a Cup", "Kies een beker");
    mobileIcon.replaceChildren();
    mobileBack.replaceChildren();
    mobileMeta.textContent = localized(
      `${formatCount(CUP_ASSET_MANIFEST.length, language())} cups · ${formatCount(trackCount, language())} tracks`,
      `${formatCount(CUP_ASSET_MANIFEST.length, language())} bekers · ${formatCount(trackCount, language())} circuits`,
    );
    resultStatus.textContent = localized(
      `${formatCount(CUP_ASSET_MANIFEST.length, language())} cups · ${formatCount(trackCount, language())} tracks`,
      `${formatCount(CUP_ASSET_MANIFEST.length, language())} bekers · ${formatCount(trackCount, language())} circuits`,
    );
    const grid = el("div", "ds-cups__grid", { role: "list",
      "aria-label": localized("Cups", "Bekers") });
    for (const cup of CUP_ASSET_MANIFEST) {
      const name = dutchPresentation(cup.name);
      const open = el("button", "ds-cups__cup", {
        type: "button",
        "aria-label": localized(
          `${name} · ${formatCount(cup.tracks.length, language())} tracks`,
          `${name} · ${formatCount(cup.tracks.length, language())} circuits`),
      },
        cupIcon(cup, "ds-cups__cup-icon", 64),
        el("span", "ds-cups__cup-name", {}, name.replace(/ Cup$/, "").replace(/ Beker$/, "")));
      open.addEventListener("click", () => {
        if (!disposed) { renderCupDetail(cup); scrollToTop(); }
      });
      grid.append(el("span", "ds-cups__grid-cell", { role: "listitem" }, open));
    }
    content.replaceChildren(grid);
  };

  const renderCupDetail = (cup: CupAssetEntry): void => {
    openCup = cup;
    container.dataset.view = "detail";
    search.value = "";
    const name = dutchPresentation(cup.name);
    mobileTitle.textContent = name;
    mobileMeta.textContent = localized("Choose your track", "Kies je circuit");
    mobileIcon.replaceChildren(cupIcon(cup, "ds-cups__mobile-cup", 34));
    mobileBack.replaceChildren(button({
      label: localized("All cups", "Alle bekers"), variant: "secondary", size: "sm",
      onPress: () => { if (!disposed) { renderCupGrid(); scrollToTop(); } },
    }).root);
    resultStatus.textContent = localized(
      `${name} · ${formatCount(cup.tracks.length, language())} tracks`,
      `${name} · ${formatCount(cup.tracks.length, language())} circuits`);
    const back = button({
      label: localized("All cups", "Alle bekers"), variant: "secondary", size: "sm",
      onPress: () => { if (!disposed) { renderCupGrid(); scrollToTop(); } },
    });
    const heading = el("div", "ds-cups__cup-head", {}, cupIcon(cup, "ds-cups__cup-head-icon", 48));
    const block = panel({
      title: name, titleLevel: 2, actions: [back.root],
      children: [heading, el("div", "ds-cups__tracks", {},
        ...cup.tracks.map((track) => trackCard(cup, track)))],
    });
    content.replaceChildren(block);
  };

  const renderSearchResults = (query: string): void => {
    openCup = null;
    container.dataset.view = "search";
    mobileTitle.textContent = localized("Choose a Cup", "Kies een beker");
    mobileIcon.replaceChildren();
    mobileBack.replaceChildren();
    const needle = query.toLocaleLowerCase("nl-NL");
    const matches: { cup: CupAssetEntry; track: TrackAssetEntry }[] = [];
    for (const cup of CUP_ASSET_MANIFEST) {
      for (const track of cup.tracks) {
        if (presentationSearchText(track.name).includes(needle)) { matches.push({ cup, track }); }
      }
    }
    if (matches.length === 0) {
      mobileMeta.textContent = localized("0 tracks", "0 circuits");
      resultStatus.textContent = localized("0 tracks", "0 circuits");
      content.replaceChildren(emptyState({
        title: localized("No track matches that search.", "Geen circuit komt overeen met deze zoekopdracht."),
        body: localized("Try part of the track's name, or browse the cups.",
          "Probeer een deel van de circuitnaam, of blader door de bekers."),
      }));
      return;
    }
    const shown = Math.min(matches.length, SEARCH_LIMIT);
    mobileMeta.textContent = localized(
      `${formatCount(shown, language())} ${shown === 1 ? "track" : "tracks"}`,
      `${formatCount(shown, language())} ${shown === 1 ? "circuit" : "circuits"}`,
    );
    resultStatus.textContent = localized(
      `${formatCount(shown, language())} ${shown === 1 ? "track" : "tracks"}`,
      `${formatCount(shown, language())} ${shown === 1 ? "circuit" : "circuits"}`);
    content.replaceChildren(el("div", "ds-cups__tracks", {},
      ...matches.slice(0, SEARCH_LIMIT).map(({ cup, track }) => trackCard(cup, track))));
  };

  /**
   * Repaint whatever view is on screen — the engine changed, so every track link has to. The
   * reader's place is kept: an open cup stays open.
   */
  const paint = (): void => {
    const query = search.value.trim();
    if (query.length >= SEARCH_MINIMUM) { renderSearchResults(query); return; }
    if (openCup !== null) { renderCupDetail(openCup); return; }
    renderCupGrid();
  };

  search.addEventListener("input", () => {
    if (disposed) { return; }
    const query = search.value.trim();
    // Typing leaves a cup: the search is over all 96 tracks, not the four on screen.
    if (query.length >= SEARCH_MINIMUM) { renderSearchResults(query); return; }
    renderCupGrid();
  });

  renderCupGrid();
  return {
    container,
    ready: Promise.resolve(),
    engine: () => engine,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}
