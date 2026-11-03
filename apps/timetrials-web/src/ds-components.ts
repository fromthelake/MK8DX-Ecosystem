// Design-system components for Checkpoint 1 (docs/design-system/DESIGN_SYSTEM.md §24). Route-independent
// DOM factories styled by styles/ds-components.css. State lives in ARIA attributes; every text comes
// from the caller (the message catalogue), so the components never depend on the legacy DOM-rewrite
// dictionary. Not used by any product route before Phase 4.
import {
  deltaDirection,
  formatDelta,
  formatRank,
  formatTime,
  heroRankStep,
  rankColumnCh,
  type NumberLanguage,
} from "./ds-numeric.js";

type Attributes = Readonly<Record<string, string | null | undefined>>;

// Which document the factories build in. The browser has exactly one, so this is normally the
// global; the web tests drive the product page against their own document object, and the shell is
// built by the same factories, so they have to be told which one to use.
let documentRef: Document | null = null;
export function useDocument(next: Document): void { documentRef = next; }
export function ownerDocument(): Document {
  return documentRef ?? (globalThis as unknown as { document: Document }).document;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  attributes: Attributes = {},
  ...children: readonly (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = ownerDocument().createElement(tag);
  if (className) { node.className = className; }
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== null && value !== undefined) { node.setAttribute(name, value); }
  }
  for (const child of children) {
    if (child !== null && child !== undefined) { node.append(child); }
  }
  return node;
}

let uniqueId = 0;
export function nextId(prefix: string): string {
  uniqueId += 1;
  return `${prefix}-${uniqueId}`;
}

const SVG = "http://www.w3.org/2000/svg";
function svg(viewBox: string, className: string, paths: readonly string[], width?: number, height?: number): SVGSVGElement {
  const node = ownerDocument().createElementNS(SVG, "svg");
  node.setAttribute("viewBox", viewBox);
  node.setAttribute("class", className);
  node.setAttribute("aria-hidden", "true");
  node.setAttribute("focusable", "false");
  node.setAttribute("fill", "none");
  node.setAttribute("stroke", "currentColor");
  node.setAttribute("stroke-linecap", "round");
  node.setAttribute("stroke-linejoin", "round");
  if (width !== undefined) { node.setAttribute("width", String(width)); }
  if (height !== undefined) { node.setAttribute("height", String(height)); }
  for (const d of paths) {
    const path = ownerDocument().createElementNS(SVG, "path");
    path.setAttribute("d", d);
    node.append(path);
  }
  return node;
}

/** A 24-grid line icon in `currentColor` (§17). This is what retired the emoji glyphs. */
export function lineIcon(paths: readonly string[], className = "ds-icon"): SVGSVGElement {
  const node = svg("0 0 24 24", className, paths);
  node.setAttribute("stroke-width", "1.9");
  return node;
}

/** The Time Trial stopwatch (24 grid, 2 px stroke): crown, pusher, dial, hand. */
export function stopwatchIcon(): SVGSVGElement {
  const icon = svg("0 0 24 24", "ds-icon", [
    "M9.5 2.5h5M12 2.5v3", "M18.2 5.8l1.5-1.5",
    "M12 6.5a7.5 7.5 0 1 1 0 15a7.5 7.5 0 1 1 0-15z", "M12 14V9.6",
  ]);
  icon.setAttribute("stroke-width", "2");
  return icon;
}

/** A camera action (24 grid): body, lens and top housing. */
export function cameraIcon(): SVGSVGElement {
  const icon = svg("0 0 24 24", "ds-icon", [
    "M4 7.5h3l1.4-2h7.2l1.4 2h3v11H4z",
    "M12 10a3.25 3.25 0 1 1 0 6.5a3.25 3.25 0 1 1 0-6.5z",
  ]);
  icon.setAttribute("stroke-width", "2");
  return icon;
}

/** One chevron = 150cc, two = 200cc. Decorative; the text always carries the engine. */
export function engineShape(engine: 150 | 200): SVGSVGElement {
  const shape = svg(engine === 200 ? "0 0 16 12" : "0 0 10 12", "ds-engine-shape",
    engine === 200 ? ["M2.5 2l4 4-4 4", "M8.5 2l4 4-4 4"] : ["M2.5 2l4 4-4 4"], engine === 200 ? 14 : 9, 11);
  shape.setAttribute("stroke-width", "2.4");
  return shape;
}

// ---------------------------------------------------------------- identity

export type BrandOptions = Readonly<{
  size?: "full" | "compact" | "mark";
  appearance: "dark" | "light";   // the variant: on Light the neutral stopwatch is ink
  assetBase: string;              // same-origin private asset route, e.g. "/assets/images/brand/"
  label: string;                  // accessible name, e.g. "MK8DX Time Trials"
  markPx?: 16 | 24 | 32 | 40 | 48 | 64 | 128;
  compactIconSrc?: string;
  platform?: string;
}>;

/** Neutral distribution identity built from the committed icon and text. */
export function brandLockup(options: BrandOptions): HTMLElement {
  const px = options.markPx ?? (options.size === "compact" ? 32 : 48);
  const root = el("span", "ds-brand", { role: "img", "aria-label": options.label, "data-size": options.size ?? "full" });
  const sized = (image: HTMLImageElement): HTMLImageElement => {
    image.style.setProperty("width", `${px}px`);
    image.style.setProperty("height", `${px}px`);
    return image;
  };
  root.append(sized(el("img", "ds-brand__mark", {
    src: options.compactIconSrc ?? "/styles/app-icon-192.png",
    alt: "", width: String(px), height: String(px), "data-colour-only": "",
  })), sized(el("img", "ds-brand__mark", {
    src: options.compactIconSrc ?? "/styles/app-icon-192.png",
    alt: "", width: String(px), height: String(px), "data-forced-colors-only": "",
  })));
  if (options.size !== "mark") {
    if (options.size === "compact" && options.platform !== undefined) {
      root.append(el("span", "ds-brand__copy", {},
        el("span", "ds-brand__wordmark", {}, "MK8DX"),
        el("span", "ds-brand__product", {}, "TIME TRIALS"),
        el("span", "ds-brand__platform", {}, options.platform)));
    } else {
      root.append(el("span", "ds-brand__copy", {},
        el("span", "ds-brand__wordmark", {}, "TIME"),
        el("span", "ds-brand__wordmark", {}, "TRIALS")));
    }
  }
  return root;
}

// ---------------------------------------------------------------- actions

export type ButtonVariant = "primary" | "global" | "secondary" | "quiet" | "danger";
export type ButtonOptions = Readonly<{
  label: string;
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: "stopwatch" | "camera";
  href?: string;
  disabledReason?: string;
  loading?: Readonly<{ label: string }>;
  onPress?: () => void;
}>;

export type ButtonHandle = Readonly<{
  root: HTMLElement;      // the button, or a wrapper carrying the disabled reason
  control: HTMLElement;   // the focusable control
  setDisabled(reason: string | null): void;
  setLoading(label: string | null): void;
}>;

/**
 * Buttons (§9). Disabled buttons stay focusable (aria-disabled) and always say why, so keyboard and
 * screen-reader users learn the reason. Primary and the stepped-down global action carry the stopwatch.
 */
export function button(options: ButtonOptions): ButtonHandle {
  const variant = options.variant ?? "secondary";
  const control = options.href === undefined
    ? el("button", "ds-button", { type: "button", "data-variant": variant, "data-size": options.size ?? "md" })
    : el("a", "ds-button", { href: options.href, "data-variant": variant, "data-size": options.size ?? "md" });
  if (variant === "primary") { control.classList.add("ds-slant"); }
  const label = el("span", "ds-button__label", {}, options.label);
  const renderContent = (loadingLabel: string | null): void => {
    control.replaceChildren();
    if (loadingLabel !== null) {
      control.append(el("span", "ds-spinner", { "aria-hidden": "true" }), el("span", "ds-button__label", {}, loadingLabel));
      return;
    }
    if (options.icon === "stopwatch") { control.append(stopwatchIcon()); }
    if (options.icon === "camera") { control.append(cameraIcon()); }
    control.append(label);
  };
  renderContent(null);
  const wrapper = el("span", "ds-button-wrap");
  const reason = el("span", "ds-button-reason", { id: nextId("ds-reason") });
  let disabled = false;
  let busy = false;
  control.addEventListener("click", (event) => {
    if (disabled || busy) { event.preventDefault(); return; }
    options.onPress?.();
  });
  const setDisabled = (why: string | null): void => {
    disabled = why !== null;
    if (why === null) {
      control.removeAttribute("aria-disabled");
      control.removeAttribute("aria-describedby");
      reason.remove();
      return;
    }
    control.setAttribute("aria-disabled", "true");
    reason.textContent = why;
    control.setAttribute("aria-describedby", reason.id);
    wrapper.append(reason);
  };
  const setLoading = (loadingLabel: string | null): void => {
    busy = loadingLabel !== null;
    if (busy) { control.setAttribute("aria-busy", "true"); } else { control.removeAttribute("aria-busy"); }
    renderContent(loadingLabel);
  };
  wrapper.append(control);
  if (options.disabledReason !== undefined) { setDisabled(options.disabledReason); }
  if (options.loading !== undefined) { setLoading(options.loading.label); }
  return { root: wrapper, control, setDisabled, setLoading };
}

/**
 * Two-stage (armed) action: the first press arms and says what the next press does; any change
 * elsewhere (call disarm) cancels. The second press confirms.
 */
export function armedButton(options: Readonly<{
  label: string; armedLabel: string; nextStep: string; onConfirm: () => void; icon?: "stopwatch";
}>): Readonly<{ root: HTMLElement; control: HTMLElement; disarm(): void; armed(): boolean }> {
  const root = el("span", "ds-armed", { "data-armed": "false" });
  const next = el("span", "ds-armed__next", { id: nextId("ds-next"), "aria-live": "polite" });
  let isArmed = false;
  const handle = button({
    label: options.label, variant: "primary", ...(options.icon ? { icon: options.icon } : {}),
    onPress: () => {
      if (!isArmed) {
        isArmed = true;
        root.setAttribute("data-armed", "true");
        handle.control.querySelector(".ds-button__label")!.textContent = options.armedLabel;
        next.textContent = options.nextStep;
        handle.control.setAttribute("aria-describedby", next.id);
        return;
      }
      disarm();
      options.onConfirm();
    },
  });
  const disarm = (): void => {
    isArmed = false;
    root.setAttribute("data-armed", "false");
    handle.control.querySelector(".ds-button__label")!.textContent = options.label;
    next.textContent = "";
    handle.control.removeAttribute("aria-describedby");
  };
  root.append(handle.root, next);
  return { root, control: handle.control, disarm, armed: () => isArmed };
}

// ---------------------------------------------------------------- engine

export function engineMark(engine: 150 | 200, size: "md" | "lg" | "plain" = "md"): HTMLElement {
  return el("span", "ds-engine-mark", { "data-engine": String(engine), "data-size": size }, engineShape(engine), `${engine}cc`);
}

/** Roving-focus radio group shared by EngineSelector, SegmentedControl and pickers. */
function radioGroup<T extends string | number>(
  group: HTMLElement,
  options: readonly Readonly<{ value: T; node: HTMLElement }>[],
  selected: T,
  onChange: (value: T) => void,
): Readonly<{ set(value: T): void; value(): T }> {
  let current = selected;
  const paint = (): void => {
    for (const option of options) {
      const on = option.value === current;
      option.node.setAttribute("aria-checked", on ? "true" : "false");
      option.node.tabIndex = on ? 0 : -1;
    }
  };
  const choose = (value: T, focus: boolean): void => {
    const changed = value !== current;
    current = value;
    paint();
    if (focus) { options.find((option) => option.value === value)?.node.focus(); }
    if (changed) { onChange(value); }
  };
  options.forEach((option, index) => {
    option.node.setAttribute("role", "radio");
    option.node.addEventListener("click", () => choose(option.value, false));
    option.node.addEventListener("keydown", (event) => {
      const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
      if (step !== 0) {
        event.preventDefault();
        choose(options[(index + step + options.length) % options.length]!.value, true);
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        choose(options[event.key === "Home" ? 0 : options.length - 1]!.value, true);
      } else if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        choose(option.value, false);
      }
    });
  });
  group.setAttribute("role", "radiogroup");
  paint();
  return { set: (value) => { current = value; paint(); }, value: () => current };
}

export type EngineSelectorHandle = Readonly<{ root: HTMLElement; set(engine: 150 | 200): void; value(): 150 | 200 }>;

/** EngineSelector (§7): a radio group; selected = engine tint + 3 px underline + ✓ + bold label. */
export function engineSelector(options: Readonly<{
  label: string; value: 150 | 200; onChange: (engine: 150 | 200) => void; size?: "md" | "lg";
}>): EngineSelectorHandle {
  const root = el("div", "ds-engine-selector", { "aria-label": options.label, "data-size": options.size ?? "md" });
  const entries = ([150, 200] as const).map((engine) => {
    const node = el("button", "ds-engine-option", { type: "button", "data-engine": String(engine) }, engineShape(engine), `${engine}cc`);
    root.append(node);
    return { value: engine, node };
  });
  const group = radioGroup<150 | 200>(root, entries, options.value, options.onChange);
  return { root, set: group.set, value: group.value };
}

// ---------------------------------------------------------------- selection

export function segmentedControl<T extends string | number>(options: Readonly<{
  label: string; choices: readonly Readonly<{ value: T; label: string }>[]; value: T; onChange: (value: T) => void;
}>): Readonly<{ root: HTMLElement; set(value: T): void; value(): T }> {
  const root = el("div", "ds-segmented", { "aria-label": options.label });
  const entries = options.choices.map((choice) => {
    const node = el("button", "ds-segment", { type: "button" }, choice.label);
    root.append(node);
    return { value: choice.value, node };
  });
  const group = radioGroup<T>(root, entries, options.value, options.onChange);
  return { root, set: group.set, value: group.value };
}

/**
 * URL-addressable tabs: real links (copyable, openable in a new tab), the current one carrying
 * aria-current="page". A tab that changes the view in place answers `onSelect`; a modified click
 * (new tab, new window) is always left to the browser.
 */
export function tabs(options: Readonly<{
  label: string;
  items: readonly Readonly<{ href: string; label: string; current: boolean; onSelect?: () => void }>[];
}>): HTMLElement {
  const nav = el("nav", "ds-tabs", { "aria-label": options.label });
  for (const item of options.items) {
    const link = el("a", "ds-tab", { href: item.href, "aria-current": item.current ? "page" : null }, item.label);
    if (item.onSelect !== undefined) {
      link.addEventListener("click", (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) { return; }
        event.preventDefault();
        event.stopPropagation();
        item.onSelect?.();
      });
    }
    nav.append(link);
  }
  return nav;
}

/** One toggle chip (the twin of Android's Mk8dxToggleChip): pressed state in ARIA, never colour alone. */
export function toggleChip(options: Readonly<{
  label: string; pressed: boolean; onToggle: () => void; title?: string;
}>): HTMLElement {
  const node = el("button", "ds-filter-chip", {
    type: "button", "aria-pressed": options.pressed ? "true" : "false", title: options.title ?? null,
  }, options.label);
  node.addEventListener("click", options.onToggle);
  return node;
}

/** A chosen value that can be taken out again: the label, and a named remove control. */
export function removableChip(options: Readonly<{
  label: string; removeLabel: string; onRemove: () => void;
}>): HTMLElement {
  const remove = el("button", "ds-removable__remove", { type: "button", "aria-label": options.removeLabel }, "×");
  remove.addEventListener("click", options.onRemove);
  return el("span", "ds-removable", {}, el("span", "ds-removable__label", {}, options.label), remove);
}

export function filterChips(options: Readonly<{
  label: string; chips: readonly Readonly<{ value: string; label: string; pressed: boolean }>[];
  onChange: (pressed: readonly string[]) => void;
}>): HTMLElement {
  const root = el("div", "ds-filter-chips", { role: "group", "aria-label": options.label });
  const state = new Map(options.chips.map((chip) => [chip.value, chip.pressed]));
  for (const chip of options.chips) {
    const node = el("button", "ds-filter-chip", { type: "button", "aria-pressed": chip.pressed ? "true" : "false" }, chip.label);
    node.addEventListener("click", () => {
      const next = !(state.get(chip.value) ?? false);
      state.set(chip.value, next);
      node.setAttribute("aria-pressed", next ? "true" : "false");
      options.onChange([...state].filter(([, on]) => on).map(([value]) => value));
    });
    root.append(node);
  }
  return root;
}

// ---------------------------------------------------------------- status

export type ChipTone = "neutral" | "success" | "warning" | "error" | "info" | "advanced" | "intermediate" | "beginner" | "race-direction" | "combined" | "live";
export function chip(label: string, tone: ChipTone = "neutral"): HTMLElement {
  const node = el("span", "ds-chip", { "data-tone": tone }, label);
  if (tone !== "combined") { node.classList.add("ds-slant"); }
  return node;
}
export function youChip(label: string): HTMLElement {
  return el("span", "ds-you-chip ds-slant", {}, label);
}

/**
 * LiveTag (§4 A4, §24 Status): the one filled tag a running night is allowed. It is `chip`'s Live
 * tone under the catalogue's own name, so there is one implementation and callers do not have to
 * know the tone list. The Android twin is `Mk8dxLiveTag`.
 */
export function liveTag(label: string): HTMLElement {
  return chip(label, "live");
}

/**
 * "Combined 184 · 150cc 122 · 200cc 62" — an engine-independent count, never silently merged (§7).
 *
 * The breakdown is optional because honesty outranks completeness: where today's API returns one
 * summed number and no per-engine split, the value still says it is Combined and carries `note`
 * instead of an invented breakdown. Those gaps are listed in ENGINE_CONTEXT_INVENTORY §6.
 */
export function combinedValue(options: Readonly<{
  label: string; total: string; breakdown?: string; note?: string; wrapTotal?: boolean;
}>): HTMLElement {
  const root = el("span", "ds-combined", {
    "data-wrap-total": options.wrapTotal === true ? "" : null,
  },
    el("span", "", {}, chip(options.label, "combined"), " ", el("span", "ds-data-m", {}, options.total)));
  if (options.breakdown !== undefined) {
    root.append(el("span", "ds-combined__breakdown", {}, options.breakdown));
  } else if (options.note !== undefined) {
    root.append(el("span", "ds-combined__note", {}, options.note));
  }
  return root;
}

/** Hidden ≠ zero: a preference-filtered engine says so and offers a local, unsaved view override. */
export function hiddenByPreference(options: Readonly<{ text: string; showLabel: string; onShow: () => void }>): HTMLElement {
  return el("div", "ds-hidden-pref", {},
    el("p", "ds-hidden-pref__text", {}, options.text),
    button({ label: options.showLabel, variant: "quiet", onPress: options.onShow }).root);
}

export function statusMessage(tone: "info" | "success" | "warning" | "error", text: Node | string): HTMLElement {
  const icon = tone === "success" ? "✓" : tone === "info" ? "i" : "!";
  return el("div", "ds-status", { "data-tone": tone, role: tone === "error" ? "alert" : "status" },
    el("span", "ds-status__icon", { "aria-hidden": "true" }, icon), el("span", "", {}, text));
}

// ---------------------------------------------------------------- data

export type RankRow = Readonly<{
  rank: number;
  name: string;
  timeMs: number;
  deltaMs?: number;
  kind?: "you" | "reference";
  youLabel?: string;
}>;

/** How a column is laid out: a rank numeral, the ellipsising name, an exact number, a bar, or free text. */
export type ColumnAlign = "rank" | "name" | "num" | "delta" | "bar" | "text";
/** Where a cell goes on a phone: a row of the two- (or three-) line row, or dropped (§12). */
export type PhonePlacement = 1 | 2 | 3 | "drop";

export type DataColumn = Readonly<{
  key: string;
  /** What the head shows. A glyph head (🏆) carries its word in `name`. */
  label: string;
  /** Optional phone-only heading when the narrow layout needs a fuller label. */
  phoneLabel?: string;
  name?: string;
  align?: ColumnAlign;
  /** Column width in ch. Numeric columns measure themselves from the dataset when this is absent. */
  ch?: number;
  /** < 600 px placement; the default keeps the desktop column. */
  phone?: PhonePlacement;
  /** ≤ 360 px placement; defaults to `phone`. */
  compact?: PhonePlacement;
  /** The declared column-drop order (section 15): "drop" leaves this column out below the desktop breakpoint. */
  tablet?: "drop";
  sort?: Readonly<{ direction: "ascending" | "descending" | "none"; onSort: () => void; label?: string }>;
}>;

export type DataCell = Node | string | null;

export type DataRow = Readonly<{
  key?: string;
  cells: readonly DataCell[];
  kind?: "you" | "reference";
  /** 1–3 paints the rank colours and the 3 px edge (§15). */
  podium?: number;
  hidden?: boolean;
  attributes?: Readonly<Record<string, string>>;
}>;

const cellText = (cell: DataCell): string =>
  cell === null ? "" : typeof cell === "string" ? cell : (cell.textContent ?? "");

function trackFor(column: DataColumn, index: number): string {
  switch (column.align ?? "text") {
    case "rank": return `calc(var(--ds-col-${index}) * 1ch + 10px)`;
    case "num":
    case "delta": return `calc(var(--ds-col-${index}) * 1ch)`;
    case "name": return "minmax(9ch, 1fr)";
    case "bar": return "minmax(8rem, 1fr)";
    default: return "auto";
  }
}

/**
 * DataTable (§10, §15). One table, any set of columns: numeric columns are sized in `ch` from the
 * widest value in the dataset (so #1 and #99,999 share one column width, one size per table), names
 * ellipsise first, numbers never clip, wrap or abbreviate, and below 600 px the row folds onto two
 * lines (three at ≤ 360 px) instead of scaling anything per value.
 */
export function dataTable(options: Readonly<{
  caption: string;
  columns: readonly DataColumn[];
  rows: readonly DataRow[];
  density?: "normal" | "timing" | "dense";
  /** An extra head row (per-column filters); one node per column, or null. */
  headExtra?: readonly DataCell[];
}>): HTMLElement {
  const table = el("div", "ds-table", {
    role: "table", "aria-label": options.caption, "data-density": options.density ?? "normal",
  });
  const numericKind = (column: DataColumn): boolean =>
    column.align === "num" || column.align === "delta" || column.align === "rank";
  options.columns.forEach((column, index) => {
    if (!numericKind(column)) { return; }
    const widest = options.rows.reduce(
      (max, row) => Math.max(max, cellText(row.cells[index] ?? null).length),
      column.align === "rank" ? 0 : column.label.length,
    );
    table.style.setProperty(`--ds-col-${index}`, String(column.ch ?? Math.max(2, widest)));
  });
  table.style.setProperty("--ds-cols", options.columns.map(trackFor).join(" "));
  // The declared column-drop order: between the tablet and desktop breakpoints the table keeps
  // only the columns that were not dropped, and its template is rebuilt from exactly those.
  table.style.setProperty("--ds-cols-tablet", options.columns
    .map((column, index) => column.tablet === "drop" ? null : trackFor(column, index))
    .filter((track): track is string => track !== null).join(" "));
  const rankIndex = options.columns.findIndex((column) => column.align === "rank");

  // Phone rows (§12): column 1 is the rank for the whole row, column 2 the name on line 1, and
  // everything else gets an explicit column on the line its own definition asked for — line 1
  // continues after the name, lines 2 and 3 start under it. Nothing is auto-placed, so no value can
  // be pushed into an implicit column and off the row.
  const lineOf = (column: DataColumn, compact: boolean): PhonePlacement | "rank" | "name" => {
    if (column.align === "rank") { return "rank"; }
    if (column.align === "name") { return "name"; }
    return compact ? column.compact ?? column.phone ?? 1 : column.phone ?? 1;
  };
  const assign = (compact: boolean): Readonly<{
    columns: readonly (number | null)[]; alone: readonly boolean[]; width: number;
  }> => {
    const next = new Map<number, number>([[1, 3], [2, 2], [3, 2]]);
    const count = new Map<number, number>();
    const lines: (number | null)[] = [];
    let width = 2;
    const columns = options.columns.map((column) => {
      const line = lineOf(column, compact);
      if (line === "rank" || line === "name" || line === "drop") { lines.push(null); return null; }
      lines.push(line);
      count.set(line, (count.get(line) ?? 0) + 1);
      const at = next.get(line) ?? 2;
      next.set(line, at + 1);
      width = Math.max(width, at);
      return at;
    });
    // A value alone on its line takes the whole width rather than a column sized by whatever sits
    // under it on another line — which is what clipped a 16-hour total at 320 px.
    const alone = lines.map((line) => line !== null && count.get(line) === 1);
    return { columns, alone, width };
  };
  const phone = assign(false);
  const compact = assign(true);
  const rankTrack = rankIndex < 0 ? "0px" : `calc(var(--ds-col-${rankIndex}) * 1ch + 8px)`;
  const phoneTemplate = (width: number): string =>
    `${rankTrack} minmax(0, 1fr)${width > 2 ? ` repeat(${width - 2}, auto)` : ""}`;
  table.style.setProperty("--ds-cols-phone", phoneTemplate(phone.width));
  table.style.setProperty("--ds-cols-compact", phoneTemplate(compact.width));

  const placement = (column: DataColumn, index: number): Readonly<Record<string, string | null>> => {
    const phoneLine = lineOf(column, false);
    const compactLine = lineOf(column, true);
    return {
      "data-phone": String(phoneLine),
      "data-phone-col": phone.columns[index] === null ? null : String(phone.columns[index]),
      "data-phone-span": phone.alone[index] === true ? "" : null,
      "data-compact": compactLine === phoneLine ? null : String(compactLine),
      "data-compact-col": compact.columns[index] === null ? null : String(compact.columns[index]),
      "data-compact-span": compact.alone[index] === true ? "" : null,
      "data-tablet": column.tablet ?? null,
    };
  };

  const head = el("div", "ds-table__row", { role: "row", "data-head": "" });
  options.columns.forEach((column, index) => {
    const attributes = {
      role: "columnheader", "data-align": column.align ?? "text", "data-key": column.key,
      "aria-label": column.name ?? null,
      "aria-sort": column.sort === undefined ? null : column.sort.direction,
      ...placement(column, index),
    };
    const cell = el("span", "ds-table__cell ds-table__head-cell", attributes);
    if (column.sort === undefined) {
      cell.append(column.label);
    } else {
      const button = el("button", column.phoneLabel === undefined ? "ds-sort" : "ds-sort ds-sort--phone-label", {
        type: "button", "data-direction": column.sort.direction,
        "aria-label": column.sort.label ?? column.name ?? column.label,
      }, el("span", "ds-sort__label", {}, column.label),
      ...(column.phoneLabel === undefined ? [] : [el("span", "ds-sort__phone-label", {}, column.phoneLabel)]),
      el("span", "ds-sort__mark", { "aria-hidden": "true" },
        column.sort.direction === "ascending" ? "▲" : column.sort.direction === "descending" ? "▼" : "↕"));
      button.addEventListener("click", column.sort.onSort);
      cell.append(button);
    }
    void index;
    head.append(cell);
  });
  table.append(head);
  if (options.headExtra !== undefined) {
    const extra = el("div", "ds-table__row", { role: "row", "data-head": "", "data-head-extra": "" });
    options.columns.forEach((column, index) => {
      extra.append(el("span", "ds-table__cell", {
        role: "columnheader", "data-align": column.align ?? "text", "data-key": column.key,
        ...placement(column, index),
      }, options.headExtra?.[index] ?? null));
    });
    table.append(extra);
  }
  for (const row of options.rows) {
    const node = el("div", "ds-table__row", {
      role: "row",
      "data-kind": row.kind ?? null,
      "data-podium": row.podium !== undefined && row.podium >= 1 && row.podium <= 3 && row.kind !== "reference"
        ? String(row.podium) : null,
      ...(row.attributes ?? {}),
    });
    if (row.hidden === true) { node.hidden = true; }
    options.columns.forEach((column, index) => {
      const align = column.align ?? "text";
      const cell = el("span", `ds-table__cell${
        align === "rank" ? " ds-table__rank" : align === "num" ? " ds-table__num"
          : align === "delta" ? " ds-delta" : align === "name" ? " ds-table__name" : ""}`, {
        role: "cell", "data-align": align, "data-key": column.key, ...placement(column, index),
      }, row.cells[index] ?? null);
      node.append(cell);
    });
    table.append(node);
  }
  return table;
}

/**
 * Ranking table (§10, §15): rank, name, time, gap. A thin reading of `dataTable`, kept because the
 * timing board and the gallery describe exactly these four columns.
 */
export function rankingTable(options: Readonly<{
  caption: string; language: NumberLanguage; rows: readonly RankRow[];
  headers: Readonly<{ rank: string; player: string; time: string; gap: string }>;
  density?: "normal" | "timing";
}>): HTMLElement {
  const largest = options.rows.reduce((max, row) => Math.max(max, row.rank), 1);
  return dataTable({
    caption: options.caption,
    density: options.density ?? "normal",
    columns: [
      { key: "rank", label: options.headers.rank, align: "rank", ch: rankColumnCh(largest, options.language) },
      { key: "player", label: options.headers.player, align: "name" },
      { key: "time", label: options.headers.time, align: "num", phone: 2 },
      { key: "gap", label: options.headers.gap, align: "delta", phone: 2, compact: 3 },
    ],
    rows: options.rows.map((row) => {
      const name = el("span", "ds-table__name-inner", {},
        el("span", "ds-table__name-text", { title: row.name }, row.name));
      if (row.kind === "you" && row.youLabel) { name.append(youChip(row.youLabel)); }
      return {
        ...(row.kind === undefined ? {} : { kind: row.kind }),
        podium: row.rank,
        cells: [
          formatRank(row.rank, options.language),
          name,
          el("span", "ds-table__num-inner", { "data-strong": row.kind === "you" ? "" : null }, formatTime(row.timeMs)),
          row.deltaMs === undefined
            ? null
            : el("span", "ds-delta__value", { "data-direction": deltaDirection(row.deltaMs) }, formatDelta(row.deltaMs)),
        ],
      } satisfies DataRow;
    }),
  });
}

/** A signed gap cell: a true minus, the direction colour and the sign (never colour alone). */
export function deltaValue(milliseconds: number): HTMLElement {
  return el("span", "ds-delta__value", { "data-direction": deltaDirection(milliseconds) }, formatDelta(milliseconds));
}

// ---------------------------------------------------------------- content surfaces

/** Panel (§24 Content): the one grouped surface. A LOW route spends no colour on it. */
export function panel(options: Readonly<{
  title?: string; titleLevel?: 2 | 3 | 4; note?: string; label?: string;
  actions?: readonly HTMLElement[];
  children: readonly (Node | string | null)[];
}>): HTMLElement {
  const root = el("section", "ds-panel", { "aria-label": options.title === undefined ? options.label ?? null : null });
  if (options.title !== undefined) {
    const headingId = nextId("ds-panel-title");
    const heading = el(options.titleLevel === 2 ? "h2" : options.titleLevel === 4 ? "h4" : "h3",
      "ds-panel__title", { id: headingId }, options.title);
    root.setAttribute("aria-labelledby", headingId);
    const header = el("div", "ds-panel__header", {}, heading);
    if (options.actions !== undefined && options.actions.length > 0) {
      header.append(el("div", "ds-panel__actions", {}, ...options.actions));
    }
    root.append(header);
  }
  if (options.note !== undefined) { root.append(el("p", "ds-panel__note", {}, options.note)); }
  for (const child of options.children) { if (child !== null) { root.append(child); } }
  return root;
}

/** StatBlock: a labelled exact number, with an optional note under it. */
export function statBlock(options: Readonly<{
  label: string; value: Node | string; note?: string; size?: "md" | "lg";
}>): HTMLElement {
  const root = el("div", "ds-stat", { "data-size": options.size ?? "md" },
    el("span", "ds-stat__label", {}, options.label),
    el("span", "ds-stat__value", {}, options.value));
  if (options.note !== undefined) { root.append(el("span", "ds-stat__note", {}, options.note)); }
  return root;
}

export function statGrid(blocks: readonly HTMLElement[]): HTMLElement {
  return el("div", "ds-stat-grid", {}, ...blocks);
}

export type PodiumEntry = Readonly<{
  rank: number; name: string; value: string; href?: string; art?: string;
  artShape?: "landscape" | "square"; you?: boolean; youLabel?: string;
}>;

/** PodiumStrip (§15): three compact cells — numeral in the rank colour, art, name, value. */
export function podiumStrip(options: Readonly<{
  label: string; language: NumberLanguage; entries: readonly PodiumEntry[];
}>): HTMLElement {
  const root = el("ol", "ds-podium", { "aria-label": options.label });
  for (const entry of options.entries.slice(0, 3)) {
    const name = entry.href === undefined
      ? el("span", "ds-podium__name", { title: entry.name }, entry.name)
      : el("a", "ds-podium__name", { href: entry.href, title: entry.name }, entry.name);
    const cell = el("li", "ds-podium__cell", { "data-podium": String(entry.rank), "data-kind": entry.you ? "you" : null },
      el("span", "ds-podium__rank", {}, formatRank(entry.rank, options.language)));
    if (entry.art !== undefined) {
      cell.append(el("img", "ds-podium__art", {
        src: entry.art, alt: "", loading: "lazy",
        "data-shape": entry.artShape === "square" ? "square" : null,
      }));
    }
    cell.append(el("span", "ds-podium__copy", {}, name, el("span", "ds-podium__value", {}, entry.value)));
    if (entry.you && entry.youLabel) { cell.append(youChip(entry.youLabel)); }
    root.append(cell);
  }
  return root;
}

/** ProgressBar (§15): 4 px, neutral, and the value is always printed beside it. */
export function valueBar(options: Readonly<{
  label: string; value: string; share: number; tone?: "neutral" | "personal"; colour?: string;
}>): HTMLElement {
  const bar = el("span", "ds-bar", { "aria-hidden": "true" });
  const fill = el("span", "ds-bar__fill", { "data-empty": options.share <= 0 ? "" : null });
  fill.style.setProperty("--ds-bar-share", `${Math.max(0, Math.min(100, options.share))}%`);
  if (options.colour !== undefined) { fill.style.setProperty("--ds-bar-colour", options.colour); }
  bar.append(fill);
  return el("span", "ds-bar-row", { "data-tone": options.tone ?? "neutral", "aria-label": `${options.label}: ${options.value}` },
    bar, el("span", "ds-bar-row__value", {}, options.value));
}

/** A share bar split into named parts; every part prints its own count in the accessible name. */
export function segmentBar(options: Readonly<{
  label: string; total: number;
  parts: readonly Readonly<{ label: string; value: number; tone: "win" | "podium" | "rest" }>[];
}>): HTMLElement {
  const bar = el("span", "ds-split", {
    role: "img",
    "aria-label": `${options.label}: ${options.parts.map((part) => `${part.value} ${part.label}`).join(", ")}`,
  });
  for (const part of options.parts) {
    if (part.value === 0) { continue; }
    const piece = el("span", "ds-split__part", { "data-tone": part.tone });
    piece.style.setProperty("--ds-split-share", `${options.total === 0 ? 0 : (part.value / options.total) * 100}%`);
    piece.title = `${part.label}: ${part.value}`;
    bar.append(piece);
  }
  return bar;
}

/**
 * Chart (§15): one visual language for the counting charts. Grouped bars on tokens, each series
 * named in the legend and each bar carrying its exact value, so colour is never the only cue.
 */
export function barChart(options: Readonly<{
  label: string;
  categories: readonly string[];
  series: readonly Readonly<{ name: string; values: readonly number[] }>[];
  describeBar: (seriesName: string, category: string, value: number) => string;
  averageLine?: Readonly<{ share: number; label: string }>;
  /** Keep bars inside a category close, while making separate category groups unmistakable. */
  groupSpacing?: "default" | "wide";
}>): HTMLElement {
  const highest = Math.max(1, ...options.series.flatMap((series) => [...series.values]));
  const chart = el("div", "ds-chart", {
    role: "img",
    "aria-label": options.label,
    "data-group-spacing": options.groupSpacing === "wide" ? "wide" : null,
  });
  options.categories.forEach((category, index) => {
    const bars = el("div", "ds-chart__bars", {});
    options.series.forEach((series, seriesIndex) => {
      const value = series.values[index] ?? 0;
      const bar = el("span", "ds-chart__bar", {
        "data-series": String((seriesIndex % 3) + 1),
        title: options.describeBar(series.name, category, value),
      });
      bar.style.setProperty("--ds-chart-height", `${Math.round((value / highest) * 100)}%`);
      bars.append(bar);
    });
    chart.append(el("div", "ds-chart__column", {}, bars, el("span", "ds-chart__label", {}, category)));
  });
  const root = el("div", "ds-chart-block", {}, chart);
  if (options.averageLine !== undefined) {
    const rule = el("span", "ds-chart__average", {}, options.averageLine.label);
    rule.style.setProperty("--ds-chart-average", `${options.averageLine.share}%`);
    chart.append(rule);
  }
  root.append(el("ul", "ds-legend", {}, ...options.series.map((series, index) =>
    el("li", "ds-legend__item", {},
      el("span", "ds-legend__swatch", { "data-series": String((index % 3) + 1), "aria-hidden": "true" }),
      el("span", "", {}, series.name)))));
  return root;
}

// ---------------------------------------------------------------- the one line chart (§15, OD-03)

/** The line chart's drawing box, in viewBox units. One set of numbers for every trajectory. */
export const LINE_CHART = { width: 600, height: 180, padX: 18, padY: 20 } as const;

/**
 * Pure geometry for a trajectory (§15): values mapped onto the fixed viewBox, highest at the top.
 * A flat series keeps a range of 1 rather than dividing by zero, and a single value is centred.
 * Deterministic, so a chart drawn twice is the same chart.
 */
export function lineGeometry(
  values: readonly number[],
  width: number = LINE_CHART.width,
  height: number = LINE_CHART.height,
  padX: number = LINE_CHART.padX,
  padY: number = LINE_CHART.padY,
): readonly Readonly<{ x: number; y: number }>[] {
  if (values.length === 0) { return []; }
  const minimum = Math.min(...values);
  const range = Math.max(...values) - minimum || 1;
  const innerWidth = width - 2 * padX;
  const innerHeight = height - 2 * padY;
  const step = values.length === 1 ? 0 : innerWidth / (values.length - 1);
  return values.map((value, index) => ({
    x: values.length === 1 ? padX + innerWidth / 2 : padX + step * index,
    y: padY + innerHeight - ((value - minimum) / range) * innerHeight,
  }));
}

/** The point a pointer at this viewBox x-coordinate is inspecting; outside the padding it clamps. */
export function nearestLinePoint(
  viewBoxX: number,
  count: number,
  width: number = LINE_CHART.width,
  padX: number = LINE_CHART.padX,
): number {
  if (count <= 1) { return 0; }
  const ratio = (viewBoxX - padX) / (width - 2 * padX);
  return Math.min(Math.max(Math.round(ratio * (count - 1)), 0), count - 1);
}

/**
 * LineChart (§15, OD-03): ONE chart style for every trajectory the product draws — the career
 * rating, the Tournament TrueSkill progression, and anything that follows them.
 *
 * Every point carries its own exact value in a `<title>`, the chart carries its range in its
 * accessible name, and the colours are tokens (the two SVGs this replaced painted five hex
 * literals each). Inspection is not hover-only: the chart is focusable and the arrow keys walk the
 * points, so what a mouse can read a keyboard can read too.
 */
export function lineChart(options: Readonly<{
  label: string;
  values: readonly number[];
  /** What one point says when it is inspected or hovered — the exact value, in words. */
  describe: (index: number, value: number) => string;
  /** Vertical rules with a caption; the index is the point the rule sits on. */
  ticks?: readonly Readonly<{ index: number; label: string }>[];
  /** A point that is not an ordinary one (a seed, a start) is marked as well as coloured. */
  kindOf?: (index: number) => "seed" | "normal";
  /** The resting text of the readout under the chart. */
  summary?: string;
  inspectLabel?: string;
}>): HTMLElement {
  const { width, height, padX, padY } = LINE_CHART;
  const points = lineGeometry(options.values, width, height, padX, padY);
  const document = ownerDocument();
  const svgNode = document.createElementNS(SVG, "svg") as SVGSVGElement;
  svgNode.setAttribute("class", "ds-line");
  svgNode.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svgNode.setAttribute("role", "img");
  svgNode.setAttribute("aria-label", options.label);
  svgNode.setAttribute("tabindex", "0");
  if (points.length > 80) { svgNode.setAttribute("data-density", "dense"); }
  if (options.inspectLabel !== undefined) { svgNode.setAttribute("aria-description", options.inspectLabel); }
  for (const tick of options.ticks ?? []) {
    const at = points[tick.index];
    if (at === undefined) { continue; }
    const rule = document.createElementNS(SVG, "line");
    rule.setAttribute("class", "ds-line__tick");
    rule.setAttribute("x1", at.x.toFixed(1));
    rule.setAttribute("x2", at.x.toFixed(1));
    rule.setAttribute("y1", "4");
    rule.setAttribute("y2", String(height - 16));
    svgNode.append(rule);
    const caption = document.createElementNS(SVG, "text");
    caption.setAttribute("class", "ds-line__tick-label");
    caption.setAttribute("x", (at.x + 3).toFixed(1));
    caption.setAttribute("y", String(height - 4));
    caption.textContent = tick.label;
    svgNode.append(caption);
  }
  if (points.length > 1) {
    const path = document.createElementNS(SVG, "polyline");
    path.setAttribute("class", "ds-line__path");
    path.setAttribute("points", points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" "));
    svgNode.append(path);
  }
  points.forEach((point, index) => {
    const dot = document.createElementNS(SVG, "circle");
    const kind = options.kindOf?.(index) ?? "normal";
    dot.setAttribute("class", "ds-line__dot");
    dot.setAttribute("data-kind", kind);
    dot.setAttribute("cx", point.x.toFixed(1));
    dot.setAttribute("cy", point.y.toFixed(1));
    dot.setAttribute("r", kind === "seed" ? "3.6" : points.length > 80 ? "1.5" : "3.6");
    const title = document.createElementNS(SVG, "title");
    title.textContent = options.describe(index, options.values[index] ?? 0);
    dot.append(title);
    svgNode.append(dot);
  });
  const marker = document.createElementNS(SVG, "circle");
  marker.setAttribute("class", "ds-line__marker");
  marker.setAttribute("r", "5.5");
  marker.setAttribute("visibility", "hidden");
  svgNode.append(marker);
  const readout = el("p", "ds-line__readout", { role: "status" }, options.summary ?? "");
  let inspected = -1;
  const inspect = (index: number): void => {
    const point = points[index];
    if (point === undefined) { return; }
    inspected = index;
    marker.setAttribute("cx", point.x.toFixed(1));
    marker.setAttribute("cy", point.y.toFixed(1));
    marker.setAttribute("visibility", "visible");
    readout.textContent = options.describe(index, options.values[index] ?? 0);
  };
  const rest = (): void => {
    inspected = -1;
    marker.setAttribute("visibility", "hidden");
    readout.textContent = options.summary ?? "";
  };
  const fromPointer = (clientX: number): void => {
    const bounds = svgNode.getBoundingClientRect?.();
    if (bounds === undefined || bounds.width <= 0) { return; }
    inspect(nearestLinePoint(((clientX - bounds.left) / bounds.width) * width, points.length, width, padX));
  };
  svgNode.addEventListener("pointermove", (event) => { fromPointer((event as PointerEvent).clientX); });
  svgNode.addEventListener("pointerdown", (event) => { fromPointer((event as PointerEvent).clientX); });
  svgNode.addEventListener("pointerleave", rest);
  svgNode.addEventListener("blur", rest);
  svgNode.addEventListener("keydown", (event) => {
    const key = (event as KeyboardEvent).key;
    const step = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
    if (step !== 0) {
      event.preventDefault();
      inspect(Math.min(Math.max((inspected < 0 ? (step > 0 ? -1 : points.length) : inspected) + step, 0), points.length - 1));
    } else if (key === "Home") { event.preventDefault(); inspect(0); }
    else if (key === "End") { event.preventDefault(); inspect(points.length - 1); }
    else if (key === "Escape") { rest(); }
  });
  return el("div", "ds-line-chart", {}, svgNode, readout);
}

/** A tier chip: the product's own recovered colour, with a readable label on it (never colour alone). */
export function tierChip(label: string, colour: string): HTMLElement {
  const node = el("span", "ds-tier-chip ds-slant", {}, label);
  node.style.setProperty("--ds-tier-colour", colour);
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(colour);
  if (match !== null) {
    const channel = (value: string): number => {
      const encoded = Number.parseInt(value, 16) / 255;
      return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
    };
    const luminance = 0.2126 * channel(match[1]!) + 0.7152 * channel(match[2]!) + 0.0722 * channel(match[3]!);
    node.style.setProperty("--ds-tier-ink", luminance > 0.42 ? "#0B0D12" : "#FFFFFF");
  }
  return node;
}

// ---------------------------------------------------------------- filters (§12)

export type FilterSummaryPart = Readonly<{ label: string; value: string }>;

/** FilterSummary: one line saying what is being shown, and the control that opens the sheet. */
export function filterSummary(options: Readonly<{
  label: string; parts: readonly FilterSummaryPart[]; openLabel: string; onOpen: () => void;
  trailing?: readonly HTMLElement[];
}>): HTMLElement {
  const root = el("div", "ds-filter-summary", { role: "group", "aria-label": options.label });
  for (const part of options.parts) {
    root.append(el("span", "ds-filter-summary__part", {},
      el("span", "ds-filter-summary__label", {}, `${part.label} `),
      el("strong", "ds-filter-summary__value", {}, part.value)));
  }
  const open = button({ label: options.openLabel, variant: "secondary", size: "sm", onPress: options.onOpen });
  root.append(open.root);
  for (const node of options.trailing ?? []) { root.append(node); }
  return root;
}

/** FilterSheet: the dialog sheet that holds the controls the summary describes. */
export function filterSheet(options: Readonly<{
  title: string; body: readonly (Node | string)[]; doneLabel: string; resetLabel?: string; onReset?: () => void;
}>): OverlayHandle {
  let handle: OverlayHandle | null = null;
  const actions: HTMLElement[] = [];
  if (options.resetLabel !== undefined && options.onReset !== undefined) {
    actions.push(button({ label: options.resetLabel, variant: "quiet", onPress: options.onReset }).root);
  }
  actions.push(button({ label: options.doneLabel, variant: "secondary", onPress: () => handle?.close() }).root);
  handle = dialog({ title: options.title, kind: "sheet", body: options.body, actions });
  return handle;
}

// ---------------------------------------------------------------- states (W34)

export function emptyState(options: Readonly<{ title: string; body?: string; action?: HTMLElement }>): HTMLElement {
  const root = el("div", "ds-state", { "data-state": "empty" }, el("p", "ds-state__title", {}, options.title));
  if (options.body !== undefined) { root.append(el("p", "ds-state__body", {}, options.body)); }
  if (options.action !== undefined) { root.append(options.action); }
  return root;
}

export function errorState(options: Readonly<{ title: string; body?: string; action?: HTMLElement }>): HTMLElement {
  const root = el("div", "ds-state", { "data-state": "error", role: "alert" }, el("p", "ds-state__title", {}, options.title));
  if (options.body !== undefined) { root.append(el("p", "ds-state__body", {}, options.body)); }
  if (options.action !== undefined) { root.append(options.action); }
  return root;
}

export function notAuthorisedState(options: Readonly<{ title: string; body: string; action?: HTMLElement }>): HTMLElement {
  const root = el("div", "ds-state", { "data-state": "not-authorised" },
    el("p", "ds-state__title", {}, options.title), el("p", "ds-state__body", {}, options.body));
  if (options.action !== undefined) { root.append(options.action); }
  return root;
}

/** Skeleton: placeholder rows while a table loads; hidden from assistive technology. */
export function skeleton(rows: number, label: string): HTMLElement {
  const root = el("div", "ds-skeleton", { role: "status", "aria-label": label });
  for (let index = 0; index < rows; index += 1) {
    root.append(el("span", "ds-skeleton__row", { "aria-hidden": "true" }));
  }
  return root;
}

/** HeroRank: display type at four fixed steps by digit count (never fluid per value). */
export function heroRank(rank: number, language: NumberLanguage, label: string): HTMLElement {
  return el("span", "ds-hero-rank", { "data-step": heroRankStep(rank), "aria-label": `${label} ${formatRank(rank, language)}` },
    formatRank(rank, language));
}

// ---------------------------------------------------------------- forms

export type TimeInputHandle = Readonly<{
  root: HTMLElement; input: HTMLInputElement; digits(): string; set(digits: string): void;
}>;

/**
 * TimeInput (§13): one real input (numeric keyboard, labelled, six digits M SS mmm) rendered as digit
 * cells. Typing fills from the left; Backspace removes the last digit. The visual cells are hidden
 * from assistive technology; the input announces the formatted value.
 */
export function timeInput(options: Readonly<{
  label: string; digits?: string; size?: "normal" | "compact"; describedBy?: string;
  invalid?: boolean; doubt?: boolean; onInput?: (digits: string) => void;
}>): TimeInputHandle {
  const root = el("span", "ds-time-input", {
    "data-size": options.size ?? "normal",
    "data-invalid": options.invalid ? "" : null,
    "data-doubt": options.doubt ? "" : null,
  });
  const cells = el("span", "ds-time-input__cells", { "aria-hidden": "true" });
  const cellNodes: HTMLElement[] = [];
  const layout = ["d", ":", "d", "d", ".", "d", "d", "d"];
  for (const part of layout) {
    if (part === "d") {
      const cell = el("span", "ds-time-input__cell");
      cellNodes.push(cell);
      cells.append(cell);
    } else {
      cells.append(el("span", "ds-time-input__sep", {}, part));
    }
  }
  // The digits are read back as a time ("1:45.912") through a description; aria-valuetext is not
  // allowed on a text input.
  const spoken = el("span", "ds-visually-hidden", { id: nextId("ds-time") });
  const input = el("input", "ds-time-input__native", {
    type: "text", inputmode: "numeric", autocomplete: "off", spellcheck: "false", maxlength: "6",
    "aria-label": options.label,
    "aria-describedby": [spoken.id, options.describedBy].filter(Boolean).join(" "),
    "aria-invalid": options.invalid ? "true" : null,
  });
  let value = (options.digits ?? "").replace(/\D/g, "").slice(0, 6);
  const paint = (): void => {
    cellNodes.forEach((cell, index) => {
      const digit = value[index];
      cell.textContent = digit ?? "0";
      if (digit === undefined) { cell.setAttribute("data-empty", ""); } else { cell.removeAttribute("data-empty"); }
      if (index === Math.min(value.length, 5)) { cell.setAttribute("data-cursor", ""); } else { cell.removeAttribute("data-cursor"); }
    });
    input.value = value;
    const padded = value.padEnd(6, "0");
    spoken.textContent = `${padded[0]}:${padded.slice(1, 3)}.${padded.slice(3)}`;
  };
  input.addEventListener("input", () => {
    value = input.value.replace(/\D/g, "").slice(0, 6);
    paint();
    options.onInput?.(value);
  });
  paint();
  root.append(cells, input, spoken);
  return { root, input, digits: () => value, set: (digits) => { value = digits.replace(/\D/g, "").slice(0, 6); paint(); } };
}

export function field(options: Readonly<{
  label: string; control: HTMLElement; hint?: string; error?: string; errorId?: string; doubt?: string;
  source?: Readonly<{ kind: "scan" | "edited"; label: string }>;
  labelFor?: string; tag?: HTMLElement;
}>): HTMLElement {
  const label = options.labelFor === undefined
    ? el("span", "ds-field__label", {}, options.label)
    : el("label", "ds-field__label", { for: options.labelFor }, options.label);
  if (options.tag) { label.append(options.tag); }
  if (options.source) { label.append(el("span", "ds-source", { "data-source": options.source.kind }, options.source.label)); }
  const root = el("div", "ds-field", {}, label, options.control);
  if (options.hint) { root.append(el("span", "ds-field__hint", {}, options.hint)); }
  if (options.doubt) { root.append(el("span", "ds-field__doubt", {}, options.doubt)); }
  if (options.error) { root.append(el("span", "ds-field__error", { id: options.errorId ?? null }, options.error)); }
  return root;
}

export function stepper(options: Readonly<{
  label: string; value: number; min: number; max: number; decrementLabel: string; incrementLabel: string;
  format?: (value: number) => string; onChange?: (value: number) => void;
}>): HTMLElement {
  let value = options.value;
  const output = el("output", "ds-stepper__value", { "aria-live": "polite" });
  const minus = el("button", "ds-stepper__button", { type: "button", "aria-label": options.decrementLabel }, "−");
  const plus = el("button", "ds-stepper__button", { type: "button", "aria-label": options.incrementLabel }, "+");
  const paint = (): void => {
    output.textContent = (options.format ?? String)(value);
    minus.toggleAttribute("disabled", value <= options.min);
    plus.toggleAttribute("disabled", value >= options.max);
  };
  const change = (next: number): void => { value = Math.min(options.max, Math.max(options.min, next)); paint(); options.onChange?.(value); };
  minus.addEventListener("click", () => change(value - 1));
  plus.addEventListener("click", () => change(value + 1));
  paint();
  return el("span", "ds-stepper", { role: "group", "aria-label": options.label }, minus, output, plus);
}

export type SetupPart = Readonly<{ kind: string; name: string | null; art?: string; doubt?: string }>;

/** SetupSummary: the four parts as buttons that open the picker; empty and doubtful states. */
export function setupSummary(options: Readonly<{
  label: string; parts: readonly SetupPart[]; emptyName: string; onOpen: (index: number) => void;
}>): HTMLElement {
  const root = el("div", "ds-setup", { role: "group", "aria-label": options.label });
  options.parts.forEach((part, index) => {
    const node = el("button", "ds-setup-part", {
      type: "button", "data-empty": part.name === null ? "" : null, "data-doubt": part.doubt ? "" : null,
    });
    node.append(part.art
      ? el("img", "ds-setup-part__art", { src: part.art, alt: "" })
      : el("span", "ds-setup-part__placeholder", { "aria-hidden": "true" }, "+"));
    node.append(el("span", "ds-setup-part__kind", {}, part.kind), el("span", "ds-setup-part__name", {}, part.name ?? options.emptyName));
    if (part.doubt) { node.append(el("span", "ds-setup-part__doubt", {}, part.doubt)); }
    node.addEventListener("click", () => options.onOpen(index));
    root.append(node);
  });
  return root;
}

/** SetupPicker: a grid of visual options with radio semantics and roving focus. */
export function setupPicker<T extends string>(options: Readonly<{
  label: string; choices: readonly Readonly<{ value: T; label: string; art?: string }>[];
  value: T | null; onChange: (value: T) => void;
}>): HTMLElement {
  const grid = el("div", "ds-picker__grid", { "aria-label": options.label });
  const entries = options.choices.map((choice) => {
    const node = el("button", "ds-picker__option", { type: "button" },
      choice.art ? el("img", "", { src: choice.art, alt: "" }) : null, el("span", "", {}, choice.label));
    grid.append(node);
    return { value: choice.value, node };
  });
  // An empty picker starts on no option at all, never silently on the first one: with the first
  // option as the group's current value, choosing it is a no-op and the person's first choice is
  // lost. The sentinel matches no entry, so the first click is always a change.
  radioGroup<T>(grid, entries, options.value ?? ("" as T), options.onChange);
  if (options.value === null) { entries.forEach((entry, index) => { entry.node.setAttribute("aria-checked", "false"); entry.node.tabIndex = index === 0 ? 0 : -1; }); }
  return el("div", "ds-picker", {}, grid);
}

// ---------------------------------------------------------------- overlays

export type OverlayHandle = Readonly<{ open(): void; close(): void; root: HTMLDialogElement }>;

/**
 * Dialog / Sheet: a modal <dialog> (the platform supplies the focus trap, inert background and
 * Escape); focus goes to the first control on open and returns to the opener on close.
 */
export function dialog(options: Readonly<{
  title: string; body: readonly (Node | string)[]; actions: readonly HTMLElement[]; kind?: "dialog" | "sheet";
  /** Put the action row before the body controls, so its first action receives native autofocus. */
  actionsFirst?: boolean;
}>): OverlayHandle {
  const titleId = nextId("ds-dialog-title");
  const root = el("dialog", "ds-dialog", { "aria-labelledby": titleId, "data-kind": options.kind ?? "dialog", "data-ds-overlay": "" });
  root.classList.add("ds-root");
  const heading = el("h2", "ds-title", { id: titleId }, options.title);
  const actions = el("div", "ds-dialog__actions", {}, ...options.actions);
  const body = options.actionsFirst === true
    ? el("div", "ds-dialog__body", {}, heading, actions, ...options.body)
    : el("div", "ds-dialog__body", {}, heading, ...options.body, actions);
  root.append(body);
  let opener: HTMLElement | null = null;
  // Focus goes back to the opener only if it is still in the dialog (the close event is queued, and
  // the reader may already have moved on).
  root.addEventListener("close", () => {
    const active = ownerDocument().activeElement;
    if (active === null || active === ownerDocument().body || root.contains(active)) { opener?.focus(); }
    opener = null;
  });
  root.addEventListener("click", (event) => { if (event.target === root && options.kind === "sheet") { root.close(); } });
  return {
    root,
    open: () => {
      const live = ownerDocument();
      // Duck-typed on purpose: the web tests drive the factories against their own document, where
      // there is no HTMLElement to be an instance of.
      const active = live.activeElement as unknown as { focus?: () => void } | null;
      opener = active !== null && typeof active.focus === "function" ? active as unknown as HTMLElement : null;
      if (!root.isConnected) { live.body.append(root); }
      const appearance = live.querySelector(".ds-root[data-appearance]")?.getAttribute("data-appearance");
      if (appearance) { root.setAttribute("data-appearance", appearance); }
      root.showModal();
    },
    close: () => root.close(),
  };
}

/**
 * ConfirmDialog: the explicit, keyboard-safe decision boundary used for consequential actions.
 * It is intentionally one-shot: closing by Cancel, Escape or confirmation removes the overlay,
 * while the platform dialog returns focus to the control that opened it.
 */
export function confirmDialog(options: Readonly<{
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  onConfirm: () => void;
}>): OverlayHandle {
  const descriptionId = nextId("ds-confirm-description");
  const description = el("p", "ds-body", { id: descriptionId }, options.description);
  let handle: OverlayHandle;
  const cancel = el("button", "ds-button", { type: "button", "data-variant": "secondary" },
    options.cancelLabel ?? "Cancel");
  const confirm = el("button", "ds-button", {
    type: "button",
    "data-variant": options.tone === "danger" ? "danger" : "primary",
  }, options.confirmLabel);
  cancel.addEventListener("click", () => handle.close());
  confirm.addEventListener("click", () => {
    handle.close();
    options.onConfirm();
  });
  handle = dialog({ title: options.title, body: [description], actions: [cancel, confirm] });
  handle.root.setAttribute("aria-describedby", descriptionId);
  handle.root.addEventListener("close", () => handle.root.remove(), { once: true });
  return handle;
}

export type MenuItem = Readonly<{
  label: string;
  /** A destination keeps the product's link grammar: a real link, openable in a new tab. */
  href?: string;
  tone?: "danger";
  onSelect?: () => void;
}>;

/**
 * Menu button: Enter/Space/ArrowDown open, arrows move, Escape closes and returns focus.
 * An item is a link when it has a destination and a button when it performs an action.
 */
export function menu(options: Readonly<{
  label: string;
  items: readonly MenuItem[];
  /** Replaces the label inside the trigger (an avatar, an icon); the label stays the a11y name. */
  triggerContent?: readonly (Node | string)[];
  triggerClassName?: string;
  align?: "start" | "end";
}>): Readonly<{ root: HTMLElement; trigger: HTMLElement; close(): void }> {
  const listId = nextId("ds-menu");
  const trigger = el("button", options.triggerClassName ?? "ds-button", {
    type: "button", "data-variant": options.triggerClassName === undefined ? "secondary" : null,
    "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": listId,
    "aria-label": options.triggerContent === undefined ? null : options.label,
  }, ...(options.triggerContent ?? [options.label, " ▾"]));
  const list = el("ul", "ds-menu__list", { id: listId, role: "menu", hidden: "", "data-align": options.align ?? "start" });
  const items = options.items.map((item) => {
    const node = item.href === undefined
      ? el("button", "ds-menu__item", { type: "button", role: "menuitem", tabindex: "-1", "data-tone": item.tone ?? null }, item.label)
      : el("a", "ds-menu__item", { href: item.href, role: "menuitem", tabindex: "-1", "data-tone": item.tone ?? null }, item.label);
    node.addEventListener("click", () => { close(true); item.onSelect?.(); });
    list.append(el("li", "", { role: "none" }, node));
    return node;
  });
  const open = (focusIndex: number): void => {
    list.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    items[(focusIndex + items.length) % items.length]?.focus();
  };
  const close = (returnFocus: boolean): void => {
    list.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (returnFocus) { trigger.focus(); }
  };
  trigger.addEventListener("click", () => { if (list.hidden) { open(0); } else { close(false); } });
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); open(0); }
    if (event.key === "ArrowUp") { event.preventDefault(); open(items.length - 1); }
  });
  list.addEventListener("keydown", (event) => {
    const index = items.indexOf(
      ownerDocument().activeElement as HTMLAnchorElement | HTMLButtonElement,
    );
    if (event.key === "Escape") { event.preventDefault(); close(true); }
    else if (event.key === "ArrowDown") { event.preventDefault(); items[(index + 1) % items.length]?.focus(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); items[(index - 1 + items.length) % items.length]?.focus(); }
    else if (event.key === "Home") { event.preventDefault(); items[0]?.focus(); }
    else if (event.key === "End") { event.preventDefault(); items[items.length - 1]?.focus(); }
    else if (event.key === "Tab") { close(false); }
  });
  const root = el("div", "ds-menu", {}, trigger, list);
  root.addEventListener("focusout", (event) => {
    if (!root.contains(event.relatedTarget as Node | null)) { close(false); }
  });
  return { root, trigger, close: () => close(false) };
}

// ------------------------------------------- content surfaces for HIGH/MEDIUM routes (§5, §15, §16)

/**
 * ArtHero (§5, §16): the art strip a MEDIUM route opens with, or the backdrop a HIGH route wears.
 * The art is decorative and blurred behind a shade; the copy never sits on bare art.
 */
export function artHero(options: Readonly<{
  spectacle: "high" | "medium";
  label?: string;
  eyebrow?: readonly (Node | string)[];
  title: Node | string;
  titleId?: string;
  /** §3: display-1 is the Night's own step; nothing else on the product uses it. */
  titleStep?: "display-1" | "display-2" | "display-3" | "display-4";
  titleLevel?: 1 | 2;
  backdrop?: string;
  thumb?: Readonly<{ src: string; badge?: string; shape?: "landscape" | "square" }>;
  children?: readonly (Node | string | null)[];
  aside?: readonly (Node | string | null)[];
}>): HTMLElement {
  const root = el("section", "ds-hero", {
    "data-spectacle": options.spectacle,
    "aria-label": options.label ?? null,
  });
  if (options.backdrop !== undefined) {
    const art = el("img", "ds-hero__backdrop", {
      src: options.backdrop, alt: "", loading: "lazy", decoding: "async", "aria-hidden": "true",
    });
    root.append(el("span", "ds-hero__art", { "aria-hidden": "true" }, art));
  }
  const body = el("div", "ds-hero__body", {});
  if (options.thumb !== undefined) {
    const frame = el("span", "ds-hero__thumb", {
      "aria-hidden": "true",
      "data-shape": options.thumb.shape === "square" ? "square" : null,
    },
      el("img", "ds-hero__thumb-art", { src: options.thumb.src, alt: "", loading: "lazy", width: "192", height: "108" }));
    if (options.thumb.badge !== undefined) {
      frame.append(el("img", "ds-hero__thumb-badge", { src: options.thumb.badge, alt: "", loading: "lazy", width: "28", height: "28" }));
    }
    body.append(frame);
  }
  const copy = el("div", "ds-hero__copy", {});
  if (options.eyebrow !== undefined && options.eyebrow.length > 0) {
    copy.append(el("p", "ds-hero__eyebrow", {}, ...options.eyebrow));
  }
  copy.append(el(options.titleLevel === 2 ? "h2" : "h1", "ds-hero__title", {
    id: options.titleId ?? null,
    "data-step": options.titleStep ?? "display-4",
  }, options.title));
  for (const child of options.children ?? []) { if (child !== null) { copy.append(child); } }
  body.append(copy);
  root.append(body);
  if (options.aside !== undefined && options.aside.length > 0) {
    root.append(el("div", "ds-hero__aside", {},
      ...options.aside.filter((node): node is Node | string => node !== null)));
  }
  return root;
}

/** ArtThumb (§16): 16:9 track art with its cup badge; decorative beside a name that says what it is. */
export function artThumb(options: Readonly<{
  src: string; badge?: string; alt?: string; size?: "sm" | "md";
}>): HTMLElement {
  const decorative = options.alt === undefined || options.alt.length === 0;
  const frame = el("span", "ds-thumb", { "data-size": options.size ?? "md" },
    el("img", "ds-thumb__art", {
      src: options.src, alt: options.alt ?? "", loading: "lazy", width: "192", height: "108",
      "aria-hidden": decorative ? "true" : null,
    }));
  if (options.badge !== undefined) {
    frame.append(el("img", "ds-thumb__badge", {
      src: options.badge, alt: "", loading: "lazy", width: "24", height: "24", "aria-hidden": "true",
    }));
  }
  return frame;
}

/**
 * Disclosure (§24 Content): a collapsed section that keeps its information reachable. The summary
 * says what is inside; nothing is hidden from a keyboard or a screen reader.
 */
export function disclosure(options: Readonly<{
  summary: string; children: readonly (Node | string | null)[]; open?: boolean;
}>): HTMLElement {
  const root = el("details", "ds-disclosure", {});
  if (options.open === true) { (root as HTMLDetailsElement).open = true; }
  root.append(el("summary", "ds-disclosure__summary", {}, options.summary));
  const body = el("div", "ds-disclosure__body", {});
  for (const child of options.children) { if (child !== null) { body.append(child); } }
  root.append(body);
  return root;
}

/** SectionHeader (§24 Content): the head of a shelf or a chapter, in display type on a HIGH route. */
export function sectionLabel(options: Readonly<{
  text: string; level?: 2 | 3 | 4; id?: string; trailing?: readonly (Node | string)[]; note?: string;
}>): HTMLElement {
  const heading = el(options.level === 2 ? "h2" : options.level === 4 ? "h4" : "h3", "ds-section-label__text",
    { id: options.id ?? null }, options.text);
  const root = el("div", "ds-section-label", {}, heading);
  for (const node of options.trailing ?? []) { root.append(node); }
  if (options.note !== undefined) { root.append(el("p", "ds-section-label__note", {}, options.note)); }
  return root;
}

// ---------------------------------------------------------------- boards (§15, §24 Content)

/** One line of a group board: a place, a name, a value, and what marks it. */
export type BoardRow = Readonly<{
  rank: number;
  /** What the rank cell prints when it is not simply the rank: a shared place after a tie. */
  rankText?: string;
  name: Node | string;
  value?: Node | string;
  /** A small mark after the name — the character a Player drove. */
  mark?: Node | null;
  you?: boolean;
  youLabel?: string;
  /** A wash across the whole row; a qualifier row carries where that Player went on to. */
  wash?: string;
  title?: string;
  attributes?: Readonly<Record<string, string>>;
}>;

/**
 * GroupBoard (§24 Content): one group's standing.
 *
 * The group's name in display type, its own colour as the board's top edge and never as the only
 * carrier of anything, the columns the export prints, and the first three in the rank colours
 * (§15, §17: numerals, not medal glyphs). A night being raced, a night that has finished and the
 * published report's index are all drawn by this one component, so the three cannot drift. The
 * Android twin is `Mk8dxGroupBoard`.
 */
export function groupBoard(options: Readonly<{
  title: string;
  /** A unique landmark/table name when two boards intentionally share the same visible title. */
  accessibleTitle?: string;
  titleLevel?: 2 | 3 | 4;
  id?: string;
  meta?: Node | string;
  /** The group's own recovered colour (product data), drawn as the board's edge. */
  accent?: string;
  language: NumberLanguage;
  columns: Readonly<{ rank: string; name: string; value?: string }>;
  rows: readonly BoardRow[];
  /** Beside the title: a LiveTag, a tier chip, a count. */
  header?: readonly (Node | string | null)[];
  children?: readonly (Node | string | null)[];
}>): HTMLElement {
  const root = el("section", "ds-board", {
    id: options.id ?? null,
    "aria-label": options.accessibleTitle ?? null,
  });
  if (options.accent !== undefined) { root.style.setProperty("--ds-board-accent", options.accent); }
  const headingId = nextId("ds-board-title");
  const heading = el(options.titleLevel === 2 ? "h2" : options.titleLevel === 4 ? "h4" : "h3",
    "ds-board__title ds-display-6", { id: headingId }, options.title);
  if (options.accessibleTitle === undefined) { root.setAttribute("aria-labelledby", headingId); }
  const header = el("div", "ds-board__header", {}, heading);
  for (const node of options.header ?? []) { if (node !== null) { header.append(node); } }
  root.append(header);
  if (options.meta !== undefined) { root.append(el("p", "ds-board__meta", {}, options.meta)); }

  const largest = options.rows.reduce((max, row) => Math.max(max, row.rank), 1);
  const grid = el("div", "ds-board__rows", {
    role: "table", "aria-label": options.accessibleTitle ?? options.title,
  });
  grid.style.setProperty("--ds-board-rank", String(rankColumnCh(largest, options.language)));
  const head = el("div", "ds-board__row", { role: "row", "data-head": "" },
    el("span", "ds-board__cell ds-board__rank", { role: "columnheader" }, options.columns.rank),
    el("span", "ds-board__cell ds-board__name", { role: "columnheader" }, options.columns.name));
  if (options.columns.value !== undefined) {
    head.append(el("span", "ds-board__cell ds-board__value", { role: "columnheader" }, options.columns.value));
  }
  grid.append(head);
  for (const row of options.rows) {
    const node = el("div", "ds-board__row", {
      role: "row",
      "data-kind": row.you === true ? "you" : null,
      "data-podium": row.rank >= 1 && row.rank <= 3 ? String(row.rank) : null,
      title: row.title ?? null,
      ...(row.attributes ?? {}),
    });
    if (row.wash !== undefined) { node.style.setProperty("--ds-board-wash", row.wash); node.setAttribute("data-wash", ""); }
    node.append(el("span", "ds-board__cell ds-board__rank ds-data", { role: "cell" },
      row.rankText ?? formatRank(row.rank, options.language)));
    const name = el("span", "ds-board__cell ds-board__name", { role: "cell" },
      el("span", "ds-board__name-text", {}, row.name));
    if (row.you === true && row.youLabel !== undefined) { name.append(youChip(row.youLabel)); }
    if (row.mark !== undefined && row.mark !== null) { name.append(row.mark); }
    node.append(name);
    if (options.columns.value !== undefined) {
      node.append(el("span", "ds-board__cell ds-board__value ds-data", { role: "cell" }, row.value ?? ""));
    }
    grid.append(node);
  }
  root.append(grid);
  for (const child of options.children ?? []) { if (child !== null) { root.append(child); } }
  return root;
}

/**
 * WinnerCard (§24 Content, §5 HIGH): the winner moment of a finished night — the place in the rank
 * colour, who it was and what they scored. The rank colour is never the only cue: the place is a
 * numeral and the word beside it says what it is.
 */
export function winnerCard(options: Readonly<{
  label: string; rank: number; language: NumberLanguage;
  name: Node | string; value?: string; meta?: string; art?: string; href?: string;
}>): HTMLElement {
  const root = el("div", "ds-winner", { "data-podium": String(options.rank) });
  if (options.art !== undefined) {
    root.append(el("img", "ds-winner__art", { src: options.art, alt: "", loading: "lazy", decoding: "async", "aria-hidden": "true" }));
  }
  const copy = el("div", "ds-winner__copy", {},
    el("span", "ds-winner__label", {}, options.label),
    el("span", "ds-winner__name", {}, options.href === undefined
      ? options.name
      : el("a", "ds-winner__link", { href: options.href }, options.name)));
  if (options.value !== undefined) { copy.append(el("span", "ds-winner__value ds-data", {}, options.value)); }
  if (options.meta !== undefined) { copy.append(el("span", "ds-winner__meta", {}, options.meta)); }
  root.append(el("span", "ds-winner__rank ds-data", { "aria-hidden": "true" }, formatRank(options.rank, options.language)), copy);
  return root;
}

/**
 * SectionIndex (§12, §24 Content): the chapters of a long page. It both lists them and says which
 * one the reader is inside, which on a 95,000 px report is the difference between reading and
 * being lost. The caller owns the scroll measurement; this owns the presentation.
 */
export type SectionIndexHandle = Readonly<{
  root: HTMLElement;
  /** Name the chapter the reader is in; `null` clears it. */
  setCurrent(title: string | null, subtitle?: Node | string | null, icon?: string | null): void;
}>;

export function sectionIndex(options: Readonly<{ label: string; jumps?: readonly HTMLElement[] }>): SectionIndexHandle {
  const title = el("strong", "ds-index__title", {});
  const subtitle = el("span", "ds-index__subtitle", {});
  const root = el("div", "ds-index", { role: "navigation", "aria-label": options.label },
    el("div", "ds-index__where", {}, title, subtitle));
  if (options.jumps !== undefined && options.jumps.length > 0) {
    root.append(el("div", "ds-index__jumps", {}, ...options.jumps));
  }
  return {
    root,
    setCurrent(next, next2 = null, icon = null): void {
      title.replaceChildren(next ?? "");
      if (icon !== null && icon !== undefined) {
        title.append(el("img", "ds-index__icon", { src: icon, alt: "", decoding: "async" }));
      }
      subtitle.replaceChildren(next2 ?? "");
      subtitle.hidden = next2 === null || next2 === undefined || next2 === "";
    },
  };
}

/**
 * ShareButton (§24 Actions): one control that hands the page on, with its own status line — what
 * was shared, or that the clipboard took it instead. The picture it shares is the product's own
 * renderer; this is the control around it.
 */
export function shareButton(options: Readonly<{
  label: string; onShare: (say: (message: string) => void) => void; variant?: ButtonVariant;
}>): HTMLElement {
  const note = el("p", "ds-share__note", { role: "status" });
  const say = (message: string): void => { note.textContent = message; };
  const handle = button({
    label: options.label, variant: options.variant ?? "secondary",
    onPress: () => { options.onShare(say); },
  });
  return el("div", "ds-share", {}, handle.root, note);
}

/**
 * StepChevron (§24 Operator): where a procedure stands, as one chevron per step. The current step
 * is named in words as well as marked, and a done step carries a ✓ rather than only a colour.
 */
export function stepChevron(options: Readonly<{
  label: string; steps: readonly string[]; current: number; doneLabel: string; currentLabel: string;
}>): HTMLElement {
  const root = el("ol", "ds-steps", { "aria-label": options.label });
  options.steps.forEach((step, index) => {
    const state = index < options.current ? "done" : index === options.current ? "current" : "todo";
    const item = el("li", "ds-steps__step", {
      "data-state": state,
      "aria-current": state === "current" ? "step" : null,
      title: step,
    });
    item.append(el("span", "ds-steps__mark ds-data", { "aria-hidden": "true" }, state === "done" ? "✓" : String(index)));
    item.append(el("span", "ds-visually-hidden", {}, `${step}${state === "done" ? ` (${options.doneLabel})` : state === "current" ? ` (${options.currentLabel})` : ""}`));
    root.append(item);
  });
  return root;
}

/**
 * JourneyCard (§24 Content): one engine-scoped progress line - what it counts, the exact count out
 * of its total, and the share as a bar. The value is always printed; the bar is never the only cue.
 */
export function journeyCard(options: Readonly<{
  label: string; value: Node | string; share?: number; href?: string; complete?: boolean;
  completeLabel?: string; description?: string; note?: string;
}>): HTMLElement {
  const copy = el("span", "ds-journey__copy", {},
    el("span", "ds-journey__label", {}, options.label),
    el("span", "ds-journey__value ds-data", {}, options.value));
  if (options.complete === true) {
    copy.append(el("span", "ds-journey__done", { "aria-hidden": "true" }, options.completeLabel ?? "✓"));
  }
  const description = options.description ?? `${options.label}: ${copy.textContent ?? ""}`;
  const attributes = {
    "data-complete": options.complete === true ? "" : null,
    "data-target": options.share === undefined ? "" : null,
    "aria-label": description,
  };
  const root = options.href === undefined
    ? el("div", "ds-journey", attributes, copy)
    : el("a", "ds-journey", { ...attributes, href: options.href }, copy);
  if (options.note !== undefined) {
    root.append(el("span", "ds-journey__note", {}, options.note));
  }
  if (options.share !== undefined) {
    const share = Math.max(0, Math.min(100, options.share));
    const bar = el("span", "ds-journey__bar", { "aria-hidden": "true" });
    const fill = el("span", "ds-journey__fill", {});
    fill.style.setProperty("--ds-bar-share", `${share}%`);
    bar.append(fill, el("span", "ds-journey__percentage ds-data", {}, `${Math.round(share)}%`));
    root.append(bar);
  }
  return root;
}

/**
 * FocusTile (§24 Content): one challenge - why it is here, which track, the gap and the next step.
 * Art is decorative; the track name carries the meaning.
 */
export function focusTile(options: Readonly<{
  kind: string; label: string; track: string; origin?: string; href: string;
  art?: Readonly<{ src: string; badge?: string; mode?: 150 | 200 }>;
  headline?: Node | string; delta?: HTMLElement; bullets?: readonly (Node | string)[];
  facts?: readonly Readonly<{ label: string; value: string }>[];
}>): HTMLElement {
  const root = el("a", "ds-focus", { href: options.href, "data-kind": options.kind });
  if (options.art !== undefined) {
    const art = artThumb({
      src: options.art.src,
      ...(options.art.badge === undefined ? {} : { badge: options.art.badge }),
    });
    if (options.art.mode !== undefined) {
      const mark = engineMark(options.art.mode, "md");
      mark.classList.add("ds-focus__engine");
      art.append(mark);
    }
    root.append(art);
  }
  const kindTone: ChipTone = options.kind === "closest"
    ? "info"
    : options.kind === "biggest" ? "warning" : "neutral";
  const kindLabel = chip(options.label, kindTone);
  kindLabel.classList.add("ds-focus__label");
  const body = el("div", "ds-focus__body", {}, kindLabel);
  const name = el("span", "ds-focus__track", {});
  if (options.origin !== undefined) { name.append(el("span", "ds-focus__origin", {}, options.origin), " "); }
  name.append(el("span", "ds-focus__name", { title: options.track }, options.track));
  body.append(name);
  if (options.headline !== undefined) { body.append(el("p", "ds-focus__headline", {}, options.headline)); }
  if (options.facts !== undefined && options.facts.length > 0) {
    body.append(el("span", "ds-focus__facts", {}, ...options.facts.map((fact) =>
      el("span", "ds-focus__fact", {},
        el("span", "ds-focus__fact-label", {}, fact.label),
        el("span", "ds-focus__fact-value ds-data", {}, fact.value)))));
  }
  if (options.delta !== undefined) { body.append(el("p", "ds-focus__delta", {}, options.delta)); }
  if (options.bullets !== undefined && options.bullets.length > 0) {
    body.append(el("p", "ds-focus__bullets", {}, ...options.bullets));
  }
  root.append(body);
  return root;
}

/** StoryCard (§24 Content): one activity line - who, where, which engine, what time, how long ago. */
export function storyCard(options: Readonly<{
  href: string; art?: Readonly<{ src: string; badge?: string }>;
  actor: Node | string; where: string; context?: readonly (Node | string)[];
  marks?: readonly (Node | string)[];
  identityMeta?: string; resultMarks?: readonly (Node | string)[];
  summary?: string;
  value?: string; meta?: string; you?: boolean; youLabel?: string;
  outcome?: "won" | "lost" | "record" | "none";
  delta?: Readonly<{
    value: string; direction: "faster" | "slower" | "even"; title: string;
  }>;
  resultNote?: Readonly<{ value: string; title: string }>;
}>): HTMLElement {
  const root = el("a", "ds-story", {
    href: options.href,
    "data-kind": options.you === true ? "you" : null,
    "data-outcome": options.outcome ?? null,
  });
  if (options.art !== undefined) {
    root.append(artThumb({
      src: options.art.src, size: "sm",
      ...(options.art.badge === undefined ? {} : { badge: options.art.badge }),
    }));
  }
  const identity = el("span", "ds-story__identity", {},
    el("span", "ds-story__actor", {}, options.actor));
  if (options.you === true && options.youLabel !== undefined) { identity.append(youChip(options.youLabel)); }
  if (options.identityMeta !== undefined) {
    identity.append(el("span", "ds-story__identity-meta", {}, options.identityMeta));
  }
  const context = el("span", "ds-story__context", {});
  for (const mark of options.context ?? []) { context.append(mark); }
  context.append(el("span", "ds-story__where", { title: options.where }, options.where));
  const copy = el("span", "ds-story__copy", {}, identity, context);
  if ((options.marks?.length ?? 0) > 0 || options.meta !== undefined) {
    const meta = el("span", "ds-story__meta", {});
    for (const mark of options.marks ?? []) { meta.append(mark); }
    if (options.meta !== undefined) { meta.append(el("span", "ds-story__when", {}, options.meta)); }
    copy.append(meta);
  }
  if (options.summary !== undefined) {
    copy.append(el("span", "ds-story__summary", {}, options.summary));
  }
  root.append(copy);
  if (options.value !== undefined || options.delta !== undefined || options.resultNote !== undefined) {
    const result = el("span", "ds-story__result", {});
    if (options.value !== undefined) {
      result.append(el("span", "ds-story__value ds-data", {}, options.value));
    }
    for (const mark of options.resultMarks ?? []) { result.append(mark); }
    if (options.delta !== undefined) {
      result.append(el("span", "ds-story__delta ds-delta__value ds-data", {
        "data-direction": options.delta.direction,
        title: options.delta.title,
        "aria-label": options.delta.title,
      }, options.delta.value));
    }
    if (options.resultNote !== undefined) {
      result.append(el("span", "ds-story__result-note", {
        title: options.resultNote.title,
        "aria-label": options.resultNote.title,
      }, options.resultNote.value));
    }
    root.append(result);
  }
  return root;
}

/** NotificationItem (§24 Status): one inbox line with its unread dot (never colour alone). */
export function notificationItem(options: Readonly<{
  href?: string; text: string; when: string; unread?: boolean; unreadLabel?: string;
}>): HTMLElement {
  const copy = el("span", "ds-notice__copy", {}, options.text);
  if (options.unread === true && options.unreadLabel !== undefined) {
    copy.append(el("span", "ds-visually-hidden", {}, ` (${options.unreadLabel})`));
  }
  const children: HTMLElement[] = [];
  if (options.unread === true) { children.push(el("span", "ds-notice__dot", { "aria-hidden": "true" })); }
  children.push(copy, el("span", "ds-notice__when", {}, options.when));
  const attributes = { "data-unread": options.unread === true ? "" : null };
  return options.href === undefined
    ? el("div", "ds-notice", attributes, ...children)
    : el("a", "ds-notice", { ...attributes, href: options.href }, ...children);
}

/** Card (§24 Content): a linked block with a title, a line of copy and optional art. */
export function cardLink(options: Readonly<{
  href: string; title: string; body?: string; accent?: boolean;
  art?: Readonly<{ src: string; badge?: string }>; trailing?: Node;
}>): HTMLElement {
  const root = el("a", "ds-card", { href: options.href, "data-accent": options.accent === true ? "" : null });
  if (options.art !== undefined) {
    root.append(artThumb({
      src: options.art.src,
      ...(options.art.badge === undefined ? {} : { badge: options.art.badge }),
    }));
  }
  const copy = el("span", "ds-card__copy", {}, el("span", "ds-card__title", {}, options.title));
  if (options.body !== undefined) { copy.append(el("span", "ds-card__body", {}, options.body)); }
  root.append(copy);
  if (options.trailing !== undefined) { root.append(options.trailing); }
  return root;
}
