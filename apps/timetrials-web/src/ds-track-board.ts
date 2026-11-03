// W07 Track leaderboard on the design system (Phase 9, docs/design-system/SCREEN_MIGRATION_MATRIX.md).
//
// MEDIUM spectacle (DESIGN_SYSTEM §5): an art hero strip carries the track, ONE EngineSelector owns
// the engine for the whole page, and the board is the design-system DataTable with the World Record
// and the Nintendo staff ghost as reference rows that consume no rank, the viewer's own row as the
// personal row, and per-row details as an A0 row action.
//
// Engine context is data (ENGINE_CONTEXT_INVENTORY §4): switching the selector reloads the board,
// the references, the Player's PB, the gap and the entry action together, and rewrites the address.
// Nothing on this page paints one engine's numbers under the other engine's label.
import {
  button,
  dataTable,
  disclosure,
  emptyState,
  engineMark,
  engineSelector,
  errorState,
  artHero,
  el,
  lineIcon,
  panel,
  skeleton,
  youChip,
  type DataColumn,
  type DataRow,
} from "./ds-components.js";
import { formatDelta, formatRank, formatTime, type NumberLanguage } from "./ds-numeric.js";
import {
  CUP_ASSET_MANIFEST,
  GAME_ASSET_BASE,
  countryFlagPath,
  trackAsset,
  COUNTRY_ASSET_MANIFEST,
} from "./asset-manifest.js";
import { trackBenchmarks, type BenchmarkEntry } from "./benchmark-manifest.js";
import { attachOwnerTimeTrialManagement } from "./time-trial-management.js";
import { runShareUrl, shareRun, type RunShareModel } from "./run-share-card.js";
import { findRun } from "./short-links.js";
import {
  createPublicTimeTrialClient,
  type PublicTimeTrialClient,
  type PublicTimeTrialResult,
} from "./public-time-trial-client.js";
import { createPlayerClaimClient, type PlayerClaimClient } from "./player-claim-client.js";
import { fetchWorldRecords, type WorldRecord, type WorldRecordHolder } from "./time-trial-standing-view.js";
import {
  fetchReferenceGhostReadings,
  filledLaps,
  readingFor,
  type ReferenceGhostReading,
} from "./reference-ghost-readings.js";
import { leaderboardHref, type EngineMode } from "./engine-context.js";
import { localized, productLanguage, sourceLanguage } from "./product-language.js";
import { schema9WebTrackCatalog } from "./schema9-track-catalog.js";
import { trackCurrency } from "./track-currency.js";
import { platformMark, PRODUCT_PLATFORM_LABELS, sourcePlatform } from "./platform-mark.js";
import {
  BODY_PARTS,
  CHARACTER_PARTS,
  GLIDER_PARTS,
  TIRE_PARTS,
  type LoadoutPart,
} from "./loadout-manifest.js";
import {
  BODY_COLOR_VARIANTS,
  CHARACTER_COLOR_VARIANTS,
  GLIDER_COLOR_VARIANTS,
  loadoutVariantById,
  matchedLoadoutVariant,
  type LoadoutVariant,
} from "./loadout-variants.js";

export type MountedTrackBoard = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  /** The engine the page is showing; the router reads it back when it rewrites the address. */
  engine(): EngineMode;
  unmount(): void;
}>;

export type TrackBoardOptions = Readonly<{
  client?: PublicTimeTrialClient;
  claimClient?: Pick<PlayerClaimClient, "listMine">;
  loadWorldRecords?: (signal?: AbortSignal) => Promise<readonly WorldRecord[]>;
  /** ADR-0212: what LiveTrial read from this track's staff and World Record ghosts. */
  loadReferenceReadings?: (trackId: string, mode: 150 | 200, signal?: AbortSignal) => Promise<readonly ReferenceGhostReading[]>;
  currentTimeMs?: () => number;
  /** Whether the viewer may post a time at all (a session with a claimed Player). */
  signedIn?: () => Promise<boolean>;
  /** Where "Sign in to post" goes; the router supplies the return intent. */
  signInHref?: (returnTo: string) => string;
  /** Called after an engine switch so the address (and the page title) follow the data (R6). */
  onEngineChange?: (engine: EngineMode) => void;
  /** The board's own A4, handed to the shell so the phone dock is scroll-aware (T-DOCK). */
  onPrimaryAction?: (node: HTMLElement, href: string, label: string) => void;
  /** A shared run's link (`&run=`, ADR-0199): its row's Details are opened and scrolled to once. */
  focusResultId?: string;
}>;

const trackNames = new Map(schema9WebTrackCatalog.map((track) => [track.id, track.displayName]));
const lapCounts = new Map(schema9WebTrackCatalog.map((track) => [track.id, track.lapCount]));
const loadoutParts = new Map(
  [...CHARACTER_PARTS, ...BODY_PARTS, ...TIRE_PARTS, ...GLIDER_PARTS].map((part) => [part.id, part] as const),
);
const countryNamesById = new Map(COUNTRY_ASSET_MANIFEST.map((country) => [country.id, country.name] as const));
const countryNamesByFlagPath = new Map(COUNTRY_ASSET_MANIFEST.map((country) => [country.flagPath, country.name] as const));

type ComboPart = Readonly<{ buildId: string; explicitVariant: boolean; name: string; iconPath: string }>;

function partPresentation(
  id: string | undefined,
  explicitVariantId: string | undefined,
  colorCharacterId: string | undefined,
): ComboPart | undefined {
  const part = id === undefined ? undefined : loadoutParts.get(id);
  if (part === undefined) { return undefined; }
  const explicit = loadoutVariantById(explicitVariantId);
  const matched = explicit ?? (
    !part.id.startsWith("character.") && colorCharacterId !== undefined
      ? matchedLoadoutVariant(part.id, colorCharacterId)
      : undefined
  );
  return {
    buildId: part.id.startsWith("character.") && explicit !== undefined ? explicit.id : part.id,
    explicitVariant: explicit !== undefined,
    name: matched === undefined ? part.name : `${matched.name} ${part.name}`,
    iconPath: matched?.iconPath ?? part.iconPath,
  };
}

function normalizedPartName(value: string): string {
  return value.normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "").toLocaleLowerCase();
}

function namedPart(
  name: string | undefined,
  parts: readonly LoadoutPart[],
  variants: readonly LoadoutVariant[] = [],
): ComboPart | undefined {
  if (name === undefined) { return undefined; }
  const normalized = normalizedPartName(name);
  const exact = parts.find((part) => normalizedPartName(part.name) === normalized);
  if (exact !== undefined) {
    return { buildId: exact.id, explicitVariant: false, name: exact.name, iconPath: exact.iconPath };
  }
  for (const variant of variants) {
    const base = parts.find((part) => part.id === variant.baseId);
    if (base === undefined) { continue; }
    const candidates = [`${variant.name}${base.name}`, `${variant.colorFamily}${base.name}`, `${base.name}${variant.name}`];
    if (candidates.some((candidate) => normalizedPartName(candidate) === normalized)) {
      return {
        buildId: base.id.startsWith("character.") ? variant.id : base.id,
        explicitVariant: true, name, iconPath: variant.iconPath,
      };
    }
  }
  // Some record names carry an unrendered Mii/theme suffix; the canonical base icon is more truthful
  // than dropping the whole combo.
  const fallback = [...parts]
    .sort((left, right) => right.name.length - left.name.length)
    .find((part) => {
      const base = normalizedPartName(part.name);
      return normalized.startsWith(base) || normalized.endsWith(base);
    });
  return fallback === undefined
    ? undefined
    : { buildId: fallback.id, explicitVariant: false, name, iconPath: fallback.iconPath };
}

function colorMatchedPart(part: ComboPart | undefined, characterId: string | undefined): ComboPart | undefined {
  if (part === undefined || part.explicitVariant || characterId === undefined) { return part; }
  const matched = matchedLoadoutVariant(part.buildId, characterId);
  return matched === undefined ? part : { ...part, name: `${matched.name} ${part.name}`, iconPath: matched.iconPath };
}

/** The four part icons, linking into Build. Empty when the result did not record a combo. */
/** A kart part in a Details panel: its name, then its picture (owner 2026-09-29). */
export function partLine(name: string, iconPath: string): HTMLElement {
  return el("span", "ds-part", {},
    el("span", "ds-part__name", {}, name),
    el("img", "ds-part__icon", {
      src: `${GAME_ASSET_BASE}${iconPath}`, alt: "", loading: "lazy", height: "24", "aria-hidden": "true",
    }));
}

function comboCell(parts: readonly (ComboPart | undefined)[]): HTMLElement {
  if (parts.length !== 4 || parts.some((part) => part === undefined)) {
    return el("span", "ds-missing", { "aria-hidden": "true" }, "–");
  }
  const names = parts.map((part) => part!.name).join(" · ");
  const cell = el("a", "ds-combo", {
    href: `/?build=${encodeURIComponent(parts.map((part) => part!.buildId).join(","))}`,
    title: names,
    "aria-label": localized(`Open this combo in Build: ${names}`, `Open deze combo in Build: ${names}`),
  });
  for (const part of parts) {
    cell.append(el("img", "ds-combo__icon", {
      src: `${GAME_ASSET_BASE}${part!.iconPath}`, alt: "", loading: "lazy", height: "18", "aria-hidden": "true",
    }));
  }
  return cell;
}

/** The combo of a loadout that names its parts by id (published results, reference records). */
function loadoutParts4(loadout: Readonly<Record<string, string>> | undefined): (ComboPart | undefined)[] {
  const appearance = loadout?.["characterVariantId"] ?? loadout?.["characterId"];
  return [
    partPresentation(loadout?.["characterId"], loadout?.["characterVariantId"], appearance),
    partPresentation(loadout?.["bodyId"], loadout?.["bodyVariantId"], appearance),
    partPresentation(loadout?.["tireId"], undefined, appearance),
    partPresentation(loadout?.["gliderId"], loadout?.["gliderVariantId"], appearance),
  ];
}

/**
 * The combo as a phone shows it: at the end of the name line, where it needs no grid column of its own
 * (owner 2026-09-28: the name must be readable in full). The desktop column keeps the real link; this
 * copy is hidden from assistive technology and from the tab order so nothing is announced twice.
 */
function phoneCombo(parts: readonly (ComboPart | undefined)[]): HTMLElement | null {
  if (parts.length !== 4 || parts.some((part) => part === undefined)) { return null; }
  const combo = comboCell(parts);
  combo.setAttribute("tabindex", "-1");
  return el("span", "ds-track__phone-combo", { "aria-hidden": "true" }, combo);
}

/** A run's video: a TV with a play button (owner 2026-10-02), in the Evidence cell and in the Details. */
function videoMark(): SVGSVGElement {
  return lineIcon([
    "M8 2.5 12 6l4-3.5",
    "M4 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z",
    "M10 10v6l5-3Z",
  ], "ds-icon ds-video-mark");
}

function videoLink(href: string, label: string): HTMLElement {
  return el("a", "ds-evidence__link", {
    href, target: "_blank", rel: "noreferrer", "aria-label": label, title: label,
  }, videoMark());
}

/** A per-lap reading with the icon that says what it counts; the icon shows only where the column head does not. */
function perLapCell(text: string, iconPath: string, label: string): HTMLElement {
  return el("span", "ds-per-lap", { title: label },
    el("img", "ds-per-lap__icon", {
      src: `${GAME_ASSET_BASE}${iconPath}`, alt: label, loading: "lazy", height: "16",
    }),
    el("span", "ds-per-lap__value", {}, text));
}

const MUSHROOM_ICON = "images/items/icons/014_mushroom.png";

/**
 * Coins gained on each lap (owner 2026-09-28: "coins should show the delta per lap"). A result
 * stores the HUD balance at each lap's end (ADR-0001), so a lap's gain is its balance minus the one
 * before it; the race starts at 0. A lap after a missing balance has no known gain either. The
 * World Record and reference splits already arrive as gains.
 */
export function lapCoinGains(balances: readonly (number | undefined)[]): readonly (number | undefined)[] {
  let previous: number | undefined = 0;
  return balances.map((balance) => {
    if (balance === undefined) { previous = undefined; return undefined; }
    const gain = previous === undefined ? undefined : balance - previous;
    previous = balance;
    return gain;
  });
}

function worldRecordParts(holder: WorldRecordHolder | undefined): (ComboPart | undefined)[] {
  const character = namedPart(holder?.characterName, CHARACTER_PARTS, CHARACTER_COLOR_VARIANTS);
  return [
    character,
    colorMatchedPart(namedPart(holder?.bodyName, BODY_PARTS, BODY_COLOR_VARIANTS), character?.buildId),
    namedPart(holder?.tireName, TIRE_PARTS),
    colorMatchedPart(namedPart(holder?.gliderName, GLIDER_PARTS, GLIDER_COLOR_VARIANTS), character?.buildId),
  ];
}

/** One lap as Details shows it; every reading is optional (a staff record has none of them). */
type DetailLap = Readonly<{ lapNumber: number; timeMs?: number; coinGain?: number; mushrooms?: number }>;

/** Per-lap readings of a reference: the lap times and the per-lap gains/mushrooms, as far as known. */
function referenceLaps(
  lapTimesMs: readonly number[] | undefined,
  coinGains: readonly number[] | undefined,
  mushrooms: readonly number[] | undefined,
): DetailLap[] {
  const count = Math.max(lapTimesMs?.length ?? 0, coinGains?.length ?? 0, mushrooms?.length ?? 0);
  return Array.from({ length: count }, (_, index) => ({
    lapNumber: index + 1,
    ...(lapTimesMs?.[index] === undefined ? {} : { timeMs: lapTimesMs[index] }),
    ...(coinGains?.[index] === undefined ? {} : { coinGain: coinGains[index] }),
    ...(mushrooms?.[index] === undefined ? {} : { mushrooms: mushrooms[index] }),
  }));
}

/** Per-lap values as one compact reading; a 7-lap track states its total instead of seven numbers. */
function patternText(values: readonly (number | undefined)[], segmentCount: number, sum: boolean): string {
  if (values.every((value) => value === undefined)) { return "–"; }
  if (segmentCount > 4) {
    if (sum) {
      return values.some((value) => value === undefined)
        ? "–"
        : String(values.reduce<number>((total, value) => total + value!, 0));
    }
    const finalValue = values[segmentCount - 1];
    if (finalValue === undefined) { return "–"; }
    const highest = Math.max(...values.filter((value): value is number => value !== undefined));
    return `${finalValue} · L${values.findIndex((value) => value === highest) + 1}`;
  }
  return Array.from({ length: segmentCount }, (_, index) =>
    values[index] === undefined ? "–" : String(values[index])).join("-");
}

function relativeWhen(atMs: number | undefined, nowMs: number): Readonly<{ text: string; title: string }> {
  if (atMs === undefined || !Number.isFinite(atMs)) { return { text: "–", title: "" }; }
  const days = Math.max(0, Math.floor((nowMs - atMs) / 86_400_000));
  const text = days < 7 ? `${days}d`
    : days < 35 ? `${Math.floor(days / 7)}w`
      : days < 365 ? `${Math.floor(days / 30)}mo`
        : `${Math.floor(days / 365)}y`;
  return { text, title: new Date(atMs).toLocaleDateString() };
}

function flagNode(flagPath: string | undefined, label: string | undefined): HTMLElement | null {
  if (flagPath === undefined) { return null; }
  return el("img", "ds-flag", {
    src: `${GAME_ASSET_BASE}${flagPath}`, alt: label ?? "", title: label ?? null, loading: "lazy",
    ...(label === undefined ? { "aria-hidden": "true" } : {}),
  });
}

function countryIdForNation(nation: string | undefined): string | undefined {
  const ids: Readonly<Record<string, string>> = {
    australia: "country.au", canada: "country.ca", colombia: "country.co", france: "country.fr",
    germany: "country.de", japan: "country.jp", netherlands: "country.nl", norway: "country.no",
    spain: "country.es", uk: "country.gb", "united kingdom": "country.gb", usa: "country.us",
    "united states": "country.us",
  };
  return nation === undefined ? undefined : ids[nation.trim().toLocaleLowerCase()];
}

/** The cup this track belongs to, and the tracks either side of it inside that cup (W06 grammar). */
function cupNeighbours(trackId: string): Readonly<{
  cupName: string; cupIcon: string;
  previous?: Readonly<{ id: string; name: string }>;
  next?: Readonly<{ id: string; name: string }>;
}> | null {
  for (const cup of CUP_ASSET_MANIFEST) {
    const index = cup.tracks.findIndex((track) => track.id === trackId);
    if (index < 0) { continue; }
    const before = cup.tracks[index - 1];
    const after = cup.tracks[index + 1];
    return {
      cupName: cup.name, cupIcon: cup.iconPath,
      ...(before === undefined ? {} : { previous: { id: before.id, name: before.name } }),
      ...(after === undefined ? {} : { next: { id: after.id, name: after.name } }),
    };
  }
  return null;
}

export function mountTrackBoard(
  root: HTMLElement,
  trackId: string,
  mode: EngineMode,
  options: TrackBoardOptions = {},
): MountedTrackBoard {
  const document = root.ownerDocument;
  const controller = new AbortController();
  const client = options.client ?? createPublicTimeTrialClient();
  const claimClient = options.claimClient ?? createPlayerClaimClient();
  const loadWorldRecords = options.loadWorldRecords ?? fetchWorldRecords;
  const loadReferenceReadings = options.loadReferenceReadings ?? fetchReferenceGhostReadings;
  const now = options.currentTimeMs ?? ((): number => new Date().getTime());
  const language = (): NumberLanguage => productLanguage();
  let engine: EngineMode = mode;
  let disposed = false;

  const asset = trackAsset(trackId);
  const currency = trackCurrency(trackId);
  const lapCount = lapCounts.get(trackId) ?? 3;
  const name = trackNames.get(trackId) ?? asset?.name ?? trackId;
  const neighbours = cupNeighbours(trackId);

  const container = el("section", "ds-root ds-track ds-stack", {
    "data-spectacle": "medium",
    "aria-label": localized(`${name} leaderboard`, `Klassement ${name}`),
  });

  // ---------------------------------------------------------------- hero (one engine selector)
  // The board itself shows the World Record, the leader and the reader's own row; the hero no longer
  // repeats them as figures (owner 02-11: "doesn't add anything and is just a bit of waste of space").
  const selector = engineSelector({
    label: localized("Engine class", "Motorklasse"),
    value: engine,
    size: "lg",
    onChange: (next) => {
      if (next === engine) { return; }
      engine = next;
      options.onEngineChange?.(next);
      void load();
    },
  });
  const hero = artHero({
    spectacle: "medium",
    titleStep: "display-4",
    title: name,
    ...(asset === undefined ? {} : {
      backdrop: `${GAME_ASSET_BASE}${asset.previewPath}`,
      thumb: { src: `${GAME_ASSET_BASE}${asset.previewPath}`, badge: `${GAME_ASSET_BASE}${asset.cup.iconPath}` },
    }),
    eyebrow: [localized(
      asset === undefined ? `${lapCount} laps` : `${asset.cup.name} · ${lapCount} laps`,
      asset === undefined ? `${lapCount} ronden` : `${asset.cup.name} · ${lapCount} ronden`,
    )],
    children: [selector.root],
  });
  container.append(hero);

  // ---------------------------------------------------------------- cup and track navigation (W06)
  const navigation = el("nav", "ds-track__nav", {
    "aria-label": localized("Tracks in this cup", "Circuits in deze beker"),
  });
  /** One link with its full wording and the short one a phone shows on one row (owner 02-11:
   *  "← Prev | All tracks | Next →"); the full wording stays the accessible name. */
  const navLink = (slot: string, href: string, full: string, short: string): HTMLElement =>
    el("a", `ds-link ds-track__nav-${slot}`, { href, "aria-label": full },
      el("span", "ds-track__nav-full", { "aria-hidden": "true" }, full),
      el("span", "ds-track__nav-short", { "aria-hidden": "true" }, short));
  const paintNavigation = (): void => {
    navigation.replaceChildren();
    navigation.append(neighbours?.previous === undefined
      ? el("span", "ds-track__nav-previous", {})
      : navLink("previous", leaderboardHref(neighbours.previous.id, engine),
        `← ${neighbours.previous.name}`, localized("← Previous", "← Vorige")));
    navigation.append(navLink("all", "/?cups=1",
      neighbours === null
        ? localized("All tracks", "Alle circuits")
        : localized(`All tracks · ${neighbours.cupName}`, `Alle circuits · ${neighbours.cupName}`),
      localized("All tracks", "Alle circuits")));
    navigation.append(neighbours?.next === undefined
      ? el("span", "ds-track__nav-next", {})
      : navLink("next", leaderboardHref(neighbours.next.id, engine),
        `${neighbours.next.name} →`, localized("Next →", "Volgende →")));
  };
  paintNavigation();
  container.append(navigation);

  // ---------------------------------------------------------------- board
  const boardSlot = el("div", "ds-track__board", {});
  const boardNote = el("p", "ds-body-s ds-track__note", {});
  const actionSlot = el("div", "ds-track__action", {});
  const technicalSlot = el("div", "ds-track__technical", {});
  container.append(actionSlot, boardNote, boardSlot, technicalSlot);
  root.append(container);

  const columns = (largestRank: number): readonly DataColumn[] => [
    { key: "rank", label: "#", name: localized("Position", "Positie"), align: "rank",
      ch: Math.max(2, formatRank(largestRank, language()).length) },
    { key: "player", label: localized("Player", "Speler"), align: "name" },
    // Combo, mushrooms and coins stay in the row at every width (owner 2026-09-28); on a phone the
    // combo follows the name and the per-lap readings share the last line, each with its own icon.
    // On a phone the combo is shown inside the name line (phoneCombo), so this column is not needed
    // there; the grid then only has to hold the time, the gap and Details. Below 360 px the readings
    // stay under Details.
    { key: "combo", label: localized("Combo", "Combo"), name: localized("Kart combination", "Kartcombinatie"),
      phone: "drop" },
    { key: "mushrooms", label: localized("Mushrooms", "Paddenstoelen"), phone: 3, compact: "drop" },
    { key: "coins", label: currency.label, phone: 3, compact: "drop" },
    { key: "time", label: localized("Time", "Tijd"), align: "num", phone: 2 },
    { key: "gap", label: localized("Gap", "Verschil"), align: "delta", phone: 2, compact: 3 },
    { key: "date", label: localized("Date", "Datum"), phone: "drop", tablet: "drop" },
    // A phone shows the video too (owner 2026-10-02): above Details, in the column Details already
    // sizes, so the time and gap keep their width. Between 600 and 1099 px the row has no room left
    // (the combo would run into the readings); there the video is in the Details.
    { key: "evidence", label: localized("Evidence", "Bewijs"), phone: 2, compact: 2, tablet: "drop" },
    { key: "details", label: localized("Details", "Details"), name: localized("Result details", "Resultaatdetails"), phone: 3, compact: 3 },
  ];

  const mushroomCell = (values: readonly (number | undefined)[]): HTMLElement =>
    perLapCell(patternText(values, lapCount, true), MUSHROOM_ICON, localized("Mushrooms", "Paddenstoelen"));
  const coinCell = (values: readonly (number | undefined)[]): HTMLElement =>
    // Gains per lap; a 7-lap track states the total collected, as mushrooms do.
    perLapCell(patternText(values, lapCount, true), currency.iconPath, currency.label);
  /** What a reference record carries besides its time: its combo and, when known, mushrooms and coins per lap. */
  const referenceExtras = (entry: BenchmarkEntry): Readonly<{
    combo: HTMLElement; mushrooms: HTMLElement; coins: HTMLElement; phoneCombo: HTMLElement | null;
  }> => ({
    combo: comboCell(loadoutParts4(entry.loadout)),
    phoneCombo: phoneCombo(loadoutParts4(entry.loadout)),
    mushrooms: mushroomCell(entry.mushroomsPerLap ?? []),
    coins: coinCell(entry.coinsPerLap ?? []),
  });

  /** A0 row action: a quiet control that reveals the row's own laps, coins, mushrooms and build. */
  const detailsAction = (rowKey: string, body: HTMLElement | null): Readonly<{
    action: HTMLElement | null; detail: DataRow | null;
  }> => {
    if (body === null) { return { action: null, detail: null }; }
    const detailRowId = `${rowKey}-detail`;
    const handle = button({
      label: localized("Details", "Details"),
      variant: "quiet",
      onPress: () => {
        const target = container.querySelector<HTMLElement>(`[data-detail-for="${detailRowId}"]`);
        if (target === null) { return; }
        const open = target.hidden;
        target.hidden = !open;
        handle.control.setAttribute("aria-expanded", open ? "true" : "false");
      },
    });
    handle.control.setAttribute("aria-expanded", "false");
    handle.control.setAttribute("aria-controls", detailRowId);
    return {
      action: handle.root,
      detail: {
        key: detailRowId,
        hidden: true,
        attributes: { "data-detail": "", "data-detail-for": detailRowId, id: detailRowId },
        cells: [body],
      },
    };
  };

  const shareAction = (model: RunShareModel): HTMLElement => {
    const said = el("span", "ds-body-s ds-track-detail__shared", { role: "status" });
    const handle = button({
      label: localized("Share run", "Rit delen"),
      variant: "secondary",
      onPress: () => {
        said.textContent = "";
        void shareRun(document, model, sourceLanguage()).then((sentence) => { said.textContent = sentence; });
      },
    });
    handle.root.setAttribute("data-share-run", "");
    return el("p", "ds-track-detail__share ds-cluster", { "data-gap": "sm" }, handle.root, said);
  };

  /** A shared run's Details, opened once when the board first shows it. */
  let pendingFocus = options.focusResultId;
  const openFocused = (results: readonly PublicTimeTrialResult[]): void => {
    if (pendingFocus === undefined) { return; }
    // The link names the run by its id or its short code; only one result on this board may match.
    const resultId = findRun(results.map((result) => result.resultId), pendingFocus);
    pendingFocus = undefined;
    if (resultId === undefined) { return; }
    const detailRowId = `row-${resultId}-detail`;
    const target = [...container.querySelectorAll<HTMLElement>("[data-detail-for]")]
      .find((node) => node.getAttribute("data-detail-for") === detailRowId);
    if (target === undefined) { return; }
    target.hidden = false;
    [...container.querySelectorAll("[aria-controls]")]
      .find((node) => node.getAttribute("aria-controls") === detailRowId)?.setAttribute("aria-expanded", "true");
    target.scrollIntoView?.({ block: "center" });
  };

  type BoardEntry = Readonly<{ timeMs: number; order: number; row: DataRow; detail: DataRow | null }>;

  const referenceRow = (
    key: string,
    rank: string,
    who: HTMLElement,
    timeMs: number,
    gapMs: number | null,
    extra: Readonly<{
      combo?: HTMLElement; mushrooms?: HTMLElement; coins?: HTMLElement; date?: HTMLElement; evidence?: HTMLElement;
      details?: HTMLElement | null; phoneCombo?: HTMLElement | null;
    }> = {},
  ): DataRow => ({
    key,
    kind: "reference",
    cells: [
      rank,
      // The WR / NG mark in the rank column already says this row takes no position (owner 2026-09-28).
      el("span", "ds-table__name-inner", {}, who, extra.phoneCombo ?? null),
      extra.combo ?? null,
      extra.mushrooms ?? null,
      extra.coins ?? null,
      el("span", "ds-table__num-inner", {}, formatTime(timeMs)),
      gapMs === null ? null : el("span", "ds-delta__value", {
        "data-direction": gapMs < 0 ? "faster" : gapMs > 0 ? "slower" : "even",
      }, formatDelta(gapMs)),
      extra.date ?? null,
      extra.evidence ?? null,
      extra.details ?? null,
    ],
  });

  const paintLoading = (): void => {
    boardNote.textContent = "";
    boardSlot.replaceChildren(panel({
      title: localized("Leaderboard", "Klassement"), titleLevel: 2,
      children: [skeleton(8, localized("Loading the leaderboard…", "Het klassement wordt geladen…"))],
    }));
  };

  const paintError = (): void => {
    boardNote.textContent = "";
    boardSlot.replaceChildren(panel({
      title: localized("Leaderboard", "Klassement"), titleLevel: 2,
      children: [errorState({
        title: localized("The leaderboard could not be loaded.", "Het klassement kon niet worden geladen."),
        body: localized("The connection failed. Try again in a moment.", "De verbinding mislukte. Probeer het zo opnieuw."),
        action: button({
          label: localized("Try again", "Opnieuw proberen"),
          variant: "secondary",
          onPress: () => { void load(); },
        }).root,
      })],
    }));
  };

  const paintBoard = (
    results: readonly PublicTimeTrialResult[],
    ownPlayerId: string | null,
    liveWorldRecords: readonly WorldRecord[],
    readings: readonly ReferenceGhostReading[] = [],
  ): void => {
    const nowMs = now();
    const lang = language();
    const ownResult = ownPlayerId === null
      ? undefined
      : results.find((result) => result.playerId === ownPlayerId);
    const leaderTimeMs = results[0]?.totalTimeMs ?? null;
    const benchmarks: readonly BenchmarkEntry[] = trackBenchmarks(trackId, engine);
    const liveWorldRecord = liveWorldRecords.find((entry) => entry.trackId === trackId && entry.mode === engine);
    // A reference fills only what it is missing from a ghost reading of exactly its time (ADR-0212).
    const withReading = (entry: BenchmarkEntry | undefined): BenchmarkEntry | undefined => {
      const read = readingFor(readings, entry?.kind ?? "nintendo_staff", entry?.timeMs);
      if (entry === undefined || read === undefined) { return entry; }
      const lapTimesMs = filledLaps(entry.lapTimesMs, read.lapTimesMs);
      const coinsPerLap = filledLaps(entry.coinsPerLap, read.coinsPerLap);
      const mushroomsPerLap = filledLaps(entry.mushroomsPerLap, read.mushroomsPerLap);
      return {
        ...entry,
        ...(lapTimesMs === undefined ? {} : { lapTimesMs }),
        ...(coinsPerLap === undefined ? {} : { coinsPerLap }),
        ...(mushroomsPerLap === undefined ? {} : { mushroomsPerLap }),
      };
    };
    const staticWorldRecord = liveWorldRecord === undefined
      ? withReading(benchmarks.find((entry) => entry.kind === "world_record"))
      : undefined;
    const staffGhost = withReading(benchmarks.find((entry) => entry.kind === "nintendo_staff"));
    const worldRecordReading = readingFor(readings, "world_record", liveWorldRecord?.totalTimeMs);
    const ownLaps = new Map(ownResult?.laps.map((lap) => [lap.lapNumber, lap] as const) ?? []);
    /** Details for any row — a Player's result, the World Record or the Nintendo staff ghost (owner
     *  2026-09-28: the references deserve the same details): your PB against it, the kart setup and
     *  the laps with their coins and mushrooms, as far as that row knows them. */
    const detailPanel = (
      totalTimeMs: number,
      compare: boolean,
      parts: readonly (ComboPart | undefined)[],
      laps: readonly DetailLap[],
      videos: readonly Readonly<{ url: string; label: string }>[] = [],
      source?: HTMLElement,
    ): HTMLElement | null => {
      const children: HTMLElement[] = [];
      if (source !== undefined) { children.push(source); }
      for (const video of videos) {
        children.push(el("p", "ds-track-detail__video ds-body-s", {},
          el("a", "ds-link", { href: video.url, target: "_blank", rel: "noreferrer" },
            videoMark(), video.label)));
      }
      if (compare && ownResult !== undefined) {
        const comparison = totalTimeMs - ownResult.totalTimeMs;
        children.push(el("p", "ds-track-detail__comparison ds-body-s", {},
          el("span", "", {}, localized("Compared with your PB", "Vergeleken met jouw PR")),
          el("span", "ds-delta__value ds-data", {
            "data-direction": comparison < 0 ? "faster" : comparison > 0 ? "slower" : "even",
          }, formatDelta(comparison))));
      }
      if (parts.some((part) => part !== undefined)) {
        children.push(el("div", "ds-track-detail__build", {},
          el("span", "ds-label", {}, localized("Kart setup", "Kartcombinatie")),
          el("span", "ds-parts", {}, ...parts.filter((part): part is ComboPart => part !== undefined)
            .map((part) => partLine(part.name, part.iconPath)))));
      }
      if (laps.length > 0) {
        children.push(el("div", "ds-track-detail__laps", {}, ...laps.map((lap) => {
          const mine = ownLaps.get(lap.lapNumber);
          const lapDelta = compare && mine !== undefined && lap.timeMs !== undefined ? lap.timeMs - mine.timeMs : null;
          return el("div", "ds-track-detail__lap", {},
            el("span", "ds-label", {}, localized(`Lap ${lap.lapNumber}`, `Ronde ${lap.lapNumber}`)),
            el("span", "ds-data", {}, lap.timeMs === undefined ? "—" : formatTime(lap.timeMs)),
            lapDelta === null ? null : el("span", "ds-delta__value ds-data", {
              "data-direction": lapDelta < 0 ? "faster" : lapDelta > 0 ? "slower" : "even",
              title: localized("Compared with your lap", "Vergeleken met jouw ronde"),
            }, formatDelta(lapDelta)),
            el("span", "ds-body-s", {}, localized(
              `Coins ${lap.coinGain ?? "—"} · Mushrooms ${lap.mushrooms ?? "—"}`,
              `Munten ${lap.coinGain ?? "—"} · Paddenstoelen ${lap.mushrooms ?? "—"}`,
            )));
        })));
      }
      return children.length === 0 ? null : el("div", "ds-detail ds-track-detail", {}, ...children);
    };
    const referenceDetails = (key: string, entry: BenchmarkEntry) => detailsAction(key, detailPanel(
      entry.timeMs, true, loadoutParts4(entry.loadout),
      referenceLaps(entry.lapTimesMs, entry.coinsPerLap, entry.mushroomsPerLap)));
    const entries: BoardEntry[] = [];
    results.forEach((result, index) => {
      const position = result.rank ?? index + 1;
      const gapMs = leaderTimeMs === null ? null : result.totalTimeMs - leaderTimeMs;
      const laps = [...result.laps].sort((left, right) => left.lapNumber - right.lapNumber);
      const when = relativeWhen(result.resultAtMs, nowMs);
      const platform = sourcePlatform(result.sourceKind);
      const isOwn = result === ownResult;
      const nameCell = el("span", "ds-table__name-inner", {});
      const flag = flagNode(
        countryFlagPath(result.countryId),
        result.countryId === undefined ? undefined : countryNamesById.get(result.countryId),
      );
      if (flag !== null) { nameCell.append(flag); }
      nameCell.append(el("a", "ds-table__name-text", {
        href: `/?player=${encodeURIComponent(result.playerId)}`,
        title: `@${result.playerUsername}`,
        "aria-label": `${result.playerDisplayName}, @${result.playerUsername}`,
      }, result.playerDisplayName));
      if (isOwn) { nameCell.append(youChip(localized("You", "Jij"))); }
      const presentedParts = loadoutParts4(result.loadout);
      const phoneParts = phoneCombo(presentedParts);
      if (phoneParts !== null) { nameCell.append(phoneParts); }
      const coinGains = lapCoinGains(laps.map((lap) => lap.coinsCollected));
      // Which client recorded the result belongs in the Details, not in Evidence (owner 2026-09-29:
      // "the evidence should be only the youtube video button").
      let source: HTMLElement | undefined;
      if (platform !== null) {
        const mark = platformMark(document, platform);
        mark.setAttribute("aria-hidden", "true");
        source = el("p", "ds-track-detail__source ds-body-s", {},
          el("span", "ds-label", {}, localized("Recorded with", "Vastgelegd met")),
          mark,
          el("span", "", {}, PRODUCT_PLATFORM_LABELS[platform]));
      }
      let detailBody = detailPanel(result.totalTimeMs, !isOwn, presentedParts, laps.map((lap, lapIndex) => ({
        lapNumber: lap.lapNumber,
        timeMs: lap.timeMs,
        ...(coinGains[lapIndex] === undefined ? {} : { coinGain: coinGains[lapIndex] }),
        ...(lap.mushroomsUsed === undefined ? {} : { mushrooms: lap.mushroomsUsed }),
      })), result.videoUrl === undefined ? [] : [{
        url: result.videoUrl, label: localized("Watch this run on YouTube", "Bekijk deze rit op YouTube"),
      }], source);
      // Share run (owner 2026-09-29): the run as a picture - track, cup, class, setup, laps with
      // coins and mushrooms - with the link that opens these Details.
      detailBody ??= el("div", "ds-detail ds-track-detail", {});
      detailBody.append(shareAction({
        trackId,
        trackName: name,
        cupName: asset?.cup.name ?? "",
        cupIconPath: asset?.cup.iconPath ?? null,
        trackPreviewPath: asset?.previewPath ?? null,
        mode: engine,
        playerName: result.playerDisplayName,
        rank: position,
        timeMs: result.totalTimeMs,
        parts: presentedParts.filter((part): part is ComboPart => part !== undefined)
          .map((part) => ({ name: part.name, iconPath: part.iconPath })),
        laps: laps.map((lap, lapIndex) => ({
          lapNumber: lap.lapNumber,
          timeMs: lap.timeMs,
          ...(coinGains[lapIndex] === undefined ? {} : { coins: coinGains[lapIndex] }),
          ...(lap.mushroomsUsed === undefined ? {} : { mushrooms: lap.mushroomsUsed }),
        })),
        coinIconPath: currency.iconPath,
        mushroomIconPath: MUSHROOM_ICON,
        url: runShareUrl(document.defaultView?.location.origin ?? "", trackId, engine, result.resultId),
      }));
      if (isOwn) {
        // Your own row: fix it, add a video or retire it right here (owner 2026-09-28), in the same
        // Manage panel the Player page offers. The server decides; this only offers.
        detailBody ??= el("div", "ds-detail ds-track-detail", {});
        attachOwnerTimeTrialManagement(detailBody, result.resultId, {
          buttonLabel: localized("Manage this result", "Dit resultaat beheren"),
          onChanged: () => { void load(); },
        });
      }
      const rowKey = `row-${result.resultId}`;
      const details = detailsAction(rowKey, detailBody);
      entries.push({
        timeMs: result.totalTimeMs,
        order: 2,
        detail: details.detail,
        row: {
          key: rowKey,
          ...(isOwn ? { kind: "you" as const } : {}),
          podium: position,
          cells: [
            formatRank(position, lang),
            nameCell,
            comboCell(presentedParts),
            mushroomCell(laps.map((lap) => lap.mushroomsUsed)),
            coinCell(coinGains),
            el("span", "ds-table__num-inner", { "data-strong": isOwn ? "" : null }, formatTime(result.totalTimeMs)),
            gapMs === null ? null : position === 1
              ? el("span", "ds-delta__value", { "data-direction": "even" }, localized("leader", "koploper"))
              : el("span", "ds-delta__value", {
                "data-direction": gapMs < 0 ? "faster" : gapMs > 0 ? "slower" : "even",
              }, formatDelta(gapMs)),
            el("span", "", { title: when.title }, when.text),
            // Evidence is the Player's own video of this run, as the World Record rows link theirs.
            result.videoUrl === undefined ? null : el("span", "ds-evidence", {},
              videoLink(result.videoUrl, localized(`Watch ${result.playerDisplayName}'s run on YouTube`,
                `Bekijk de rit van ${result.playerDisplayName} op YouTube`))),
            details.action,
          ],
        },
      });
    });

    if (liveWorldRecord !== undefined) {
      const holder = liveWorldRecord.holders[0];
      const nationCountryId = countryIdForNation(holder?.nationName);
      const names = liveWorldRecord.holders.map((entry) => entry.playerName).join(" / ");
      const who = el("span", "ds-ref-name", {});
      const flag = flagNode(countryFlagPath(nationCountryId),
        nationCountryId === undefined ? holder?.nationName : countryNamesById.get(nationCountryId));
      if (flag !== null) { who.append(flag); }
      who.append(el("span", "ds-table__name-text", { title: names }, names));
      const videos = liveWorldRecord.holders.filter((entry) => entry.videoUrl !== undefined);
      const when = relativeWhen(holder?.recordDate === undefined ? undefined : Date.parse(holder.recordDate), nowMs);
      const parts = worldRecordParts(holder);
      const holderLaps = filledLaps(holder?.lapTimesMs, worldRecordReading?.lapTimesMs);
      const holderCoins = filledLaps(holder?.coinsPerLap, worldRecordReading?.coinsPerLap);
      const holderMushrooms = filledLaps(holder?.mushroomsPerLap, worldRecordReading?.mushroomsPerLap);
      // The World Record's video is in its Details too, as a Player's is (owner 2026-10-02).
      const details = detailsAction("row-wr", detailPanel(liveWorldRecord.totalTimeMs, true, parts,
        referenceLaps(holderLaps, holderCoins, holderMushrooms), videos.map((entry) => ({
          url: entry.videoUrl!,
          label: videos.length === 1
            ? localized("Watch the World Record on YouTube", "Bekijk het wereldrecord op YouTube")
            : localized(`Watch ${entry.playerName}'s World Record on YouTube`,
              `Bekijk het wereldrecord van ${entry.playerName} op YouTube`),
        }))));
      entries.push({
        timeMs: liveWorldRecord.totalTimeMs, order: 0, detail: details.detail,
        row: referenceRow("wr", "WR", who, liveWorldRecord.totalTimeMs,
          leaderTimeMs === null ? null : liveWorldRecord.totalTimeMs - leaderTimeMs, {
            details: details.action,
            combo: comboCell(parts),
            phoneCombo: phoneCombo(parts),
            mushrooms: mushroomCell(holderMushrooms ?? []),
            coins: coinCell(holderCoins ?? []),
            date: el("span", "", { title: when.title }, when.text),
            ...(videos.length === 0 ? {} : {
              evidence: el("span", "ds-evidence", {}, ...videos.map((entry) => videoLink(entry.videoUrl!,
                localized(`Open ${entry.playerName} World Record video`, `Open de wereldrecordvideo van ${entry.playerName}`)))),
            }),
          }),
      });
    } else if (staticWorldRecord !== undefined) {
      const who = el("span", "ds-ref-name", {});
      const flag = flagNode(staticWorldRecord.flagPath ?? undefined,
        staticWorldRecord.flagPath === null ? undefined : countryNamesByFlagPath.get(staticWorldRecord.flagPath));
      if (flag !== null) { who.append(flag); }
      who.append(el("span", "ds-table__name-text", { title: staticWorldRecord.name }, staticWorldRecord.name));
      const details = referenceDetails("row-wr", staticWorldRecord);
      entries.push({
        timeMs: staticWorldRecord.timeMs, order: 0, detail: details.detail,
        row: referenceRow("wr", "WR", who, staticWorldRecord.timeMs,
          leaderTimeMs === null ? null : staticWorldRecord.timeMs - leaderTimeMs,
          { ...referenceExtras(staticWorldRecord), details: details.action }),
      });
    }
    if (staffGhost !== undefined) {
      // The NG mark and Nintendo's logo say what this row is; the name is the whole in-game name
      // (at most 10 characters), with nothing added to it (owner 2026-09-28).
      const who = el("span", "ds-ref-name", {},
        el("img", "ds-ref-logo", {
          src: `${GAME_ASSET_BASE}images/system/Nintendo_red_logo.svg`,
          alt: localized("Nintendo staff ghost", "Nintendo-spookrit"), title: localized("Nintendo staff ghost", "Nintendo-spookrit"),
          loading: "lazy",
        }),
        el("span", "ds-table__name-text", { title: staffGhost.name }, staffGhost.name));
      const details = referenceDetails("row-staff", staffGhost);
      entries.push({
        timeMs: staffGhost.timeMs, order: 1, detail: details.detail,
        row: referenceRow("staff", "NG", who, staffGhost.timeMs,
          leaderTimeMs === null ? null : staffGhost.timeMs - leaderTimeMs,
          { ...referenceExtras(staffGhost), details: details.action }),
      });
    }

    entries.sort((left, right) => left.timeMs - right.timeMs || left.order - right.order);
    const rows: DataRow[] = [];
    for (const entry of entries) {
      rows.push(entry.row);
      if (entry.detail !== null) { rows.push(entry.detail); }
    }

    const largestRank = results.reduce((max, result, index) => Math.max(max, result.rank ?? index + 1), 1);
    const referenceCount = entries.filter((entry) => entry.row.kind === "reference").length;
    boardNote.textContent = results.length === 0
      ? ""
      : localized(
        `${results.length} ${results.length === 1 ? "Player" : "Players"}${referenceCount === 0 ? "" : " · WR and Nintendo ghost as references"}`,
        `${results.length} ${results.length === 1 ? "speler" : "spelers"}${referenceCount === 0 ? "" : " · WR en Nintendo-spookrit als referentie"}`,
      );

    boardSlot.replaceChildren(panel({
      title: localized("Leaderboard", "Klassement"),
      titleLevel: 2,
      actions: [engineMark(engine, "md")],
      children: [
        results.length === 0 && entries.length === 0
          ? emptyState({
            title: localized("No published times on this track yet.", "Nog geen gepubliceerde tijden op dit circuit."),
            body: localized(
              "Nothing has been published for this track and engine class. Yours could be the first.",
              "Voor dit circuit en deze motorklasse is nog niets gepubliceerd. De jouwe kan de eerste zijn.",
            ),
          })
          : dataTable({
            caption: localized(`${name} ${engine}cc leaderboard`, `Klassement ${name} ${engine}cc`),
            density: "timing",
            columns: columns(largestRank),
            rows,
          }),
      ],
    }));

    // OD-01 keeps the technical reading of the board; only its jargon heading became plain words.
    technicalSlot.replaceChildren(disclosure({
      summary: localized("Technical details", "Technische details"),
      children: [
        el("p", "ds-body-s", {}, localized(
          `Track id ${trackId} · engine class ${engine}cc · ${lapCount} laps · ${results.length} published results.`,
          `Circuit-id ${trackId} · motorklasse ${engine}cc · ${lapCount} ronden · ${results.length} gepubliceerde resultaten.`,
        )),
        el("p", "ds-body-s", {}, localized(
          "Published results are the verified submissions of claimed Players. Reference rows (World Record, Nintendo staff ghost) are shown for comparison and take no position.",
          "Gepubliceerde resultaten zijn de geverifieerde inzendingen van geclaimde spelers. Referentieregels (wereldrecord, Nintendo-spookrit) staan er ter vergelijking en nemen geen positie in.",
        )),
      ],
    }));
  };

  const paintAction = async (): Promise<void> => {
    const href = `/?post=${encodeURIComponent(trackId)}&mode=${engine}`;
    const signedIn = options.signedIn === undefined ? false : await options.signedIn().catch(() => false);
    if (disposed) { return; }
    if (signedIn) {
      const label = localized(`Post your time · ${engine}cc`, `Plaats je tijd · ${engine}cc`);
      const action = button({ label, variant: "primary", size: "lg", icon: "stopwatch", href });
      actionSlot.replaceChildren(action.root);
      options.onPrimaryAction?.(action.control, href, label);
      return;
    }
    const returnTo = leaderboardHref(trackId, engine);
    actionSlot.replaceChildren(el("p", "ds-body-s ds-track__signin", {},
      el("a", "ds-link", { href: options.signInHref === undefined ? "/?signin=1" : options.signInHref(returnTo) },
        localized("Sign in to record your own time on this track",
          "Meld je aan om je eigen tijd op dit circuit vast te leggen"))));
  };

  let sequence = 0;
  const load = async (): Promise<void> => {
    sequence += 1;
    const current = sequence;
    const requested = engine;
    paintLoading();
    selector.set(engine);
    paintNavigation();
    void paintAction();
    try {
      const [response, claims, liveWorldRecords, readings] = await Promise.all([
        client.leaderboard(trackId, requested, controller.signal),
        claimClient.listMine(controller.signal).catch(() => []),
        loadWorldRecords(controller.signal).catch(() => []),
        loadReferenceReadings(trackId, requested, controller.signal).catch(() => []),
      ]);
      if (disposed || current !== sequence) { return; }
      const ownPlayerId = claims.find((claim) => claim.claimStatus === "verified")?.playerId ?? null;
      paintBoard(response.results, ownPlayerId, liveWorldRecords, readings);
      openFocused(response.results);
    } catch {
      if (disposed || current !== sequence) { return; }
      paintError();
    }
  };

  const ready = load();

  return {
    container,
    ready,
    engine: () => engine,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      controller.abort();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}
