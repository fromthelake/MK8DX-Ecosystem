// The inline editor of the night's report: click a block of the page, write
// in place with a small toolbar, apply or cancel. It is the community's own
// The community's original report editor brought over: the text is edited where the reader will see
// it, with the same formatting choices. Formatting is expressed by a fixed set
// of classes (`tournament-report-markup.ts`); the toolbar's colours, sizes and
// fonts are exactly that palette, so what is chosen here is what survives.
//
// The surface uses the browser's own editing commands only for lists, links,
// undo/redo and clearing. Bold, italic, underline and strike are toggled by
// this module as semantic tags, and colour, highlight, size, font, alignment
// and indent as classes: the page is served under `style-src 'self'`, and the
// browser's own toggles fall back to inline `style` attributes when a mark
// cannot be removed by unwrapping, which the policy then silently drops.
// Doing it here keeps the result deterministic. Nothing is inserted into the
// page that has not been through the sanitiser.

import { localized } from "./product-language.js";
import { REPORT_HIGHLIGHTS, REPORT_TEXT_COLORS, sanitizeReportMarkup } from "./tournament-report-markup.js";

export type InlineEditorOptions = Readonly<{
  /** The stored markup to start from; empty means a fresh paragraph. */
  markup: string;
  label: string;
  maximum: number;
  onApply(markup: string): void;
  /** Apply and store the draft in one go, so the writer need not leave the block. */
  onApplyAndSave?(markup: string): void;
  onCancel(): void;
}>;

type MarkTag = "strong" | "em" | "u" | "s";
type Action =
  | Readonly<{ kind: "command"; command: string; value?: string }>
  | Readonly<{ kind: "mark"; tag: MarkTag }>
  | Readonly<{ kind: "inline"; className: string; group: string }>
  | Readonly<{ kind: "strip"; group: string }>
  | Readonly<{ kind: "block"; className: string | null; group: string }>
  | Readonly<{ kind: "indent"; delta: 1 | -1 }>;
type Tool = Readonly<{ label: string; glyph: string; key?: string; className?: string; action: Action }>;

const command = (command: string, label: string, glyph: string, key?: string): Tool =>
  ({ label, glyph, ...(key === undefined ? {} : { key }), className: command, action: { kind: "command", command } });

const mark = (tag: MarkTag, className: string, label: string, glyph: string, key?: string): Tool =>
  ({ label, glyph, ...(key === undefined ? {} : { key }), className, action: { kind: "mark", tag } });

const MAIN_TOOLS: readonly Tool[] = [
  mark("strong", "bold", "Vet", "B", "Ctrl+B"),
  mark("em", "italic", "Cursief", "I", "Ctrl+I"),
  mark("u", "underline", "Onderstrepen", "U", "Ctrl+U"),
  mark("s", "strikeThrough", "Doorhalen", "S"),
  command("createLink", "Link", "🔗"),
  command("unlink", "Link weghalen", "⛓"),
  command("insertUnorderedList", "Lijst", "•≡"),
  command("insertOrderedList", "Genummerde lijst", "1≡"),
  { label: "Links uitlijnen", glyph: "⫷", className: "justifyLeft", action: { kind: "block", className: null, group: "rt-align-" } },
  { label: "Centreren", glyph: "☰", className: "justifyCenter", action: { kind: "block", className: "rt-align-center", group: "rt-align-" } },
  { label: "Rechts uitlijnen", glyph: "⫸", className: "justifyRight", action: { kind: "block", className: "rt-align-right", group: "rt-align-" } },
  { label: "Uitspringen", glyph: "⇤", className: "outdent", action: { kind: "indent", delta: -1 } },
  { label: "Inspringen", glyph: "⇥", className: "indent", action: { kind: "indent", delta: 1 } },
  command("removeFormat", "Opmaak wissen", "✕"),
  command("undo", "Ongedaan maken", "↶", "Ctrl+Z"),
  command("redo", "Opnieuw", "↷", "Ctrl+Y"),
];

const SIZES: readonly Readonly<{ className: string | null; label: string }>[] = [
  { className: "rt-size-s", label: "S" }, { className: null, label: "M" }, { className: "rt-size-l", label: "L" }, { className: "rt-size-xl", label: "XL" },
];
const FONTS: readonly Readonly<{ className: string | null; label: string }>[] = [
  { className: null, label: localized("Default", "Standaard") }, { className: "rt-font-serif", label: "Serif" }, { className: "rt-font-mono", label: "Mono" },
];
const BLOCK_TAGS = new Set(["P", "LI", "BLOCKQUOTE", "DIV"]);
/** The elements that already mean a mark; the sanitiser folds them to the first. */
const MARK_TAGS: Readonly<Record<MarkTag, readonly string[]>> = { strong: ["STRONG", "B"], em: ["EM", "I"], u: ["U"], s: ["S", "STRIKE", "DEL"] };
const MARK_SHORTCUTS: Readonly<Record<string, MarkTag>> = { b: "strong", i: "em", u: "u" };

/** Where the caret is; restored before every command so a toolbar click does not lose the selection. */
function rememberSelection(surface: HTMLElement, store: { range: Range | null }): void {
  const selection = surface.ownerDocument.defaultView?.getSelection() ?? null;
  if (selection === null || selection.rangeCount === 0) { return; }
  const range = selection.getRangeAt(0);
  if (surface.contains(range.commonAncestorContainer)) { store.range = range.cloneRange(); }
}

function restoreSelection(surface: HTMLElement, store: { range: Range | null }): Range | null {
  const selection = surface.ownerDocument.defaultView?.getSelection() ?? null;
  if (selection === null) { return null; }
  if (store.range !== null) {
    try { selection.removeAllRanges(); selection.addRange(store.range); } catch { /* a stale range after a re-render */ }
  }
  return selection.rangeCount > 0 && surface.contains(selection.getRangeAt(0).commonAncestorContainer) ? selection.getRangeAt(0) : null;
}

/** The block elements (p, li, blockquote) the selection touches, inside the surface. */
function blocksIn(surface: HTMLElement, range: Range): HTMLElement[] {
  const blockOf = (node: Node): HTMLElement | null => {
    let current: Node | null = node;
    while (current !== null && current !== surface) {
      if (current instanceof HTMLElement && BLOCK_TAGS.has(current.tagName)) { return current; }
      current = current.parentNode;
    }
    return null;
  };
  const found = new Set<HTMLElement>();
  const start = blockOf(range.startContainer);
  const end = blockOf(range.endContainer);
  if (start !== null) { found.add(start); }
  if (end !== null) { found.add(end); }
  for (const block of surface.querySelectorAll<HTMLElement>("p, li, blockquote")) {
    if (range.intersectsNode(block) && !range.collapsed) { found.add(block); }
  }
  return [...found];
}

function stripClasses(element: Element, group: string): void {
  for (const name of [...element.classList]) { if (name.startsWith(group)) { element.classList.remove(name); } }
}

function unwrap(element: Element): void { element.replaceWith(...element.childNodes); }

/** The block (p, li, blockquote) a node sits in, or the surface itself for loose text. */
function blockAround(surface: HTMLElement, node: Node): HTMLElement {
  let current: Node | null = node;
  while (current !== null && current !== surface) {
    if (current instanceof HTMLElement && BLOCK_TAGS.has(current.tagName)) { return current; }
    current = current.parentNode;
  }
  return surface;
}

/** The selection cut per block, so a wrapper never spans a paragraph boundary. */
function rangesPerBlock(surface: HTMLElement, range: Range): Range[] {
  const startBlock = blockAround(surface, range.startContainer);
  const endBlock = blockAround(surface, range.endContainer);
  if (startBlock === endBlock) { return [range.cloneRange()]; }
  const blocks = [...surface.querySelectorAll<HTMLElement>("p, li, blockquote")]
    .filter((block) => range.intersectsNode(block) && block.querySelector("p, li, blockquote") === null);
  return blocks.map((block) => {
    const part = range.cloneRange();
    const whole = surface.ownerDocument.createRange();
    whole.selectNodeContents(block);
    if (part.compareBoundaryPoints(Range.START_TO_START, whole) < 0) { part.setStart(whole.startContainer, whole.startOffset); }
    if (part.compareBoundaryPoints(Range.END_TO_END, whole) > 0) { part.setEnd(whole.endContainer, whole.endOffset); }
    return part;
  }).filter((part) => !part.collapsed);
}

function textNodesIn(surface: HTMLElement, range: Range): Text[] {
  const walker = surface.ownerDocument.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
  const found: Text[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Text && node.data.length > 0 && range.intersectsNode(node)) {
      // A node touched only at its edge is not selected.
      const own = surface.ownerDocument.createRange();
      own.selectNodeContents(node);
      if (own.compareBoundaryPoints(Range.END_TO_START, range) < 0 && own.compareBoundaryPoints(Range.START_TO_END, range) > 0) { found.push(node); }
    }
  }
  return found;
}

function markAncestor(surface: HTMLElement, node: Node, tag: MarkTag): HTMLElement | null {
  let outermost: HTMLElement | null = null;
  for (let current = node.parentElement; current !== null && current !== surface; current = current.parentElement) {
    if (MARK_TAGS[tag].includes(current.tagName)) { outermost = current; }
  }
  return outermost;
}

/** Move `node` out of `target` by splitting every element between them; the intermediates are cloned around it so their classes stay. */
function liftOut(node: Node, target: HTMLElement): void {
  let current: Node = node;
  while (current.parentNode !== target.parentNode) {
    const parent = current.parentNode as HTMLElement;
    const after = parent.cloneNode(false) as HTMLElement;
    while (current.nextSibling !== null) { after.append(current.nextSibling); }
    let lifted: Node = current;
    if (parent !== target) { const wrap = parent.cloneNode(false) as HTMLElement; wrap.append(current); lifted = wrap; }
    parent.after(lifted, after);
    if (after.childNodes.length === 0) { after.remove(); }
    if (parent.childNodes.length === 0) { parent.remove(); }
    current = lifted;
  }
}

/** Toggle a mark over the selection: on when any of it is unmarked, off when all of it is. Returns the range to select afterwards. */
function toggleMark(surface: HTMLElement, range: Range, tag: MarkTag): Range | null {
  if (range.collapsed) { return null; }
  const document = surface.ownerDocument;
  const nodes = textNodesIn(surface, range);
  const turnOn = nodes.length === 0 || nodes.some((node) => markAncestor(surface, node, tag) === null);
  const inserted: Node[] = [];
  for (const part of rangesPerBlock(surface, range)) {
    const anchor = part.commonAncestorContainer;
    if (turnOn && markAncestor(surface, anchor, tag) !== null) { continue; }
    const contents = part.extractContents();
    for (const nested of [...contents.querySelectorAll(MARK_TAGS[tag].join(","))]) { unwrap(nested); }
    const wrapper = document.createElement(turnOn ? tag : "span");
    wrapper.append(contents);
    part.insertNode(wrapper);
    if (!turnOn) {
      const target = markAncestor(surface, wrapper, tag);
      if (target !== null) { liftOut(wrapper, target); }
    }
    inserted.push(wrapper);
  }
  if (inserted.length === 0) { return null; }
  const result = document.createRange();
  result.setStartBefore(inserted[0] as Node);
  result.setEndAfter(inserted[inserted.length - 1] as Node);
  // The temporary spans of a removal carry nothing and go.
  for (const wrapper of inserted) { if (wrapper instanceof HTMLElement && wrapper.tagName === "SPAN") { unwrap(wrapper); } }
  // Wrappers emptied by the extraction carry nothing either.
  for (const element of [...surface.querySelectorAll("span, strong, em, u, s, b, i")]) {
    if (element.textContent === "" && element.querySelector("br, img") === null) { element.remove(); }
  }
  surface.normalize();
  return result;
}

export function mountInlineReportEditor(host: HTMLElement, options: InlineEditorOptions): Readonly<{ surface: HTMLElement; destroy(): void }> {
  const document = host.ownerDocument;
  const store: { range: Range | null } = { range: null };
  const shell = document.createElement("div");
  shell.className = "ds-panel report-editor";

  const label = document.createElement("div");
  label.className = "report-editor__label";
  label.textContent = options.label;

  const surface = document.createElement("div");
  surface.className = "report-editor__surface tournament-report__copy";
  surface.setAttribute("contenteditable", "true");
  surface.setAttribute("role", "textbox");
  surface.setAttribute("aria-multiline", "true");
  surface.setAttribute("aria-label", options.label);
  surface.innerHTML = options.markup.length > 0 ? sanitizeReportMarkup(options.markup) : "<p><br></p>";

  const toolbar = document.createElement("div");
  toolbar.className = "report-editor__toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", localized("Formatting", "Opmaak"));

  /** Wrap the selection in a span carrying one class of a group (colour, highlight, size, font). */
  const applyInline = (range: Range, className: string | null, group: string): void => {
    if (range.collapsed) { return; }
    const contents = range.extractContents();
    for (const span of contents.querySelectorAll("span")) { stripClasses(span, group); if (span.classList.length === 0) { span.replaceWith(...span.childNodes); } }
    if (className === null) {
      range.insertNode(contents);
    } else {
      const span = document.createElement("span");
      span.className = className;
      span.append(contents);
      range.insertNode(span);
      range.selectNodeContents(span);
    }
    // Empty wrappers left behind by the extraction carry nothing.
    for (const span of surface.querySelectorAll("span")) { if (span.textContent === "" && span.querySelector("br") === null) { span.remove(); } }
  };

  const apply = (action: Action): void => {
    surface.focus();
    const range = restoreSelection(surface, store);
    if (action.kind === "command") {
      let argument = action.value;
      if (action.command === "createLink") {
        const asked = document.defaultView?.prompt(localized("Paste the link address", "Plak het adres van de link"), "https://") ?? "";
        argument = asked.trim();
        if (!/^(https?:\/\/|mailto:)/i.test(argument)) { return; }
      }
      try { document.execCommand("styleWithCSS", false, "false"); document.execCommand(action.command, false, argument); } catch { /* an unsupported command leaves the text as it was */ }
    } else if (range !== null && action.kind === "mark") {
      const selected = toggleMark(surface, range, action.tag);
      if (selected !== null) {
        const selection = document.defaultView?.getSelection() ?? null;
        if (selection !== null) { try { selection.removeAllRanges(); selection.addRange(selected); } catch { /* left where it was */ } }
      }
    } else if (range !== null && action.kind === "inline") {
      applyInline(range, action.className, action.group);
    } else if (range !== null && action.kind === "strip") {
      applyInline(range, null, action.group);
    } else if (range !== null && action.kind === "block") {
      let blocks = blocksIn(surface, range);
      if (blocks.length === 0) { try { document.execCommand("formatBlock", false, "p"); } catch { /* left as it was */ } blocks = blocksIn(surface, range); }
      for (const block of blocks) { stripClasses(block, action.group); if (action.className !== null) { block.classList.add(action.className); } }
    } else if (range !== null && action.kind === "indent") {
      let blocks = blocksIn(surface, range);
      if (blocks.length === 0) { try { document.execCommand("formatBlock", false, "p"); } catch { /* left as it was */ } blocks = blocksIn(surface, range); }
      for (const block of blocks) {
        const current = [...block.classList].find((name) => name.startsWith("rt-indent-"));
        const level = Math.min(3, Math.max(0, (current === undefined ? 0 : Number(current.slice("rt-indent-".length))) + action.delta));
        stripClasses(block, "rt-indent-");
        if (level > 0) { block.classList.add(`rt-indent-${level}`); }
      }
    }
    rememberSelection(surface, store);
    counter();
  };

  const toolButton = (tool: Tool): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `report-editor__tool report-editor__tool--${tool.className ?? "tool"}`;
    button.title = tool.key === undefined ? tool.label : `${tool.label} (${tool.key})`;
    button.setAttribute("aria-label", tool.label);
    button.textContent = tool.glyph;
    button.addEventListener("mousedown", (event) => { event.preventDefault(); rememberSelection(surface, store); });
    button.addEventListener("click", () => apply(tool.action));
    return button;
  };

  const row = (className: string): HTMLDivElement => { const line = document.createElement("div"); line.className = `report-editor__row ${className}`; return line; };
  const main = row("report-editor__row--main");
  for (const tool of MAIN_TOOLS) { main.append(toolButton(tool)); }

  const group = (title: string): HTMLSpanElement => {
    const wrap = document.createElement("span");
    wrap.className = "report-editor__group";
    const name = document.createElement("span");
    name.className = "report-editor__group-label";
    name.textContent = title;
    wrap.append(name);
    return wrap;
  };
  const swatch = (className: string, name: string, title: string, groupPrefix: string): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `report-editor__swatch ${className}`;
    button.title = `${title} ${name}`;
    button.setAttribute("aria-label", `${title} ${name}`);
    button.addEventListener("mousedown", (event) => { event.preventDefault(); rememberSelection(surface, store); });
    button.addEventListener("click", () => apply({ kind: "inline", className, group: groupPrefix }));
    return button;
  };
  const palette = row("report-editor__row--palette");
  const colours = group(localized("Text colour", "Tekstkleur"));
  for (const colour of REPORT_TEXT_COLORS) { colours.append(swatch(`rt-color-${colour.name}`, colour.name, localized("Text colour", "Tekstkleur"), "rt-color-")); }
  colours.append(toolButton({ label: localized("Default text colour", "Standaard tekstkleur"), glyph: "A", className: "color-default", action: { kind: "strip", group: "rt-color-" } }));
  const highlights = group(localized("Highlight", "Markering"));
  for (const colour of REPORT_HIGHLIGHTS) { highlights.append(swatch(`rt-bg-${colour.name}`, colour.name, localized("Highlight", "Markering"), "rt-bg-")); }
  highlights.append(toolButton({ label: localized("No highlight", "Geen markering"), glyph: "∅", className: "bg-default", action: { kind: "strip", group: "rt-bg-" } }));
  const sizes = group(localized("Size", "Grootte"));
  for (const size of SIZES) {
    sizes.append(toolButton({ label: `${localized("Size", "Grootte")} ${size.label}`, glyph: size.label, className: `size-${size.label.toLowerCase()}`,
      action: size.className === null ? { kind: "strip", group: "rt-size-" } : { kind: "inline", className: size.className, group: "rt-size-" } }));
  }
  const fonts = group(localized("Font", "Lettertype"));
  for (const font of FONTS) {
    fonts.append(toolButton({ label: `${localized("Font", "Lettertype")} ${font.label}`, glyph: font.label, className: `font-${font.label.toLowerCase()}`,
      action: font.className === null ? { kind: "strip", group: "rt-font-" } : { kind: "inline", className: font.className, group: "rt-font-" } }));
  }
  palette.append(colours, highlights, sizes, fonts);
  toolbar.append(main, palette);

  const foot = document.createElement("div");
  foot.className = "report-editor__foot";
  const count = document.createElement("span");
  count.className = "report-editor__count";
  const applyButton = document.createElement("button");
  applyButton.type = "button";
  applyButton.className = "ds-button";
  applyButton.setAttribute("data-variant", "primary");
  applyButton.textContent = localized("Apply", "Toepassen");
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "ds-button";
  cancel.setAttribute("data-variant", "quiet");
  cancel.textContent = localized("Cancel", "Annuleren");
  const hint = document.createElement("p");
  hint.className = "report-editor__hint";
  hint.textContent = localized(
    "Select text and choose a colour, size or font; the report keeps a fixed palette so it reads the same everywhere. Ctrl+Enter applies, Esc cancels.",
    "Selecteer tekst en kies een kleur, grootte of lettertype; het verslag houdt een vast palet zodat het overal hetzelfde leest. Ctrl+Enter past toe, Esc annuleert.",
  );
  foot.append(count, applyButton);
  if (options.onApplyAndSave !== undefined) {
    const applySave = document.createElement("button");
    applySave.type = "button";
    applySave.className = "ds-button";
    applySave.setAttribute("data-variant", "secondary");
    applySave.textContent = localized("Apply and save draft", "Toepassen en concept opslaan");
    applySave.addEventListener("click", () => { if (!applyButton.disabled) { options.onApplyAndSave?.(sanitizeReportMarkup(surface.innerHTML)); } });
    foot.append(applySave);
  }
  foot.append(cancel);

  const counter = (): void => {
    const length = sanitizeReportMarkup(surface.innerHTML).length;
    count.textContent = localized(`${length} / ${options.maximum} characters incl. formatting`, `${length} / ${options.maximum} tekens incl. opmaak`);
    count.classList.toggle("report-editor__count--over", length > options.maximum);
    applyButton.disabled = length > options.maximum;
  };

  surface.addEventListener("input", counter);
  surface.addEventListener("keyup", () => rememberSelection(surface, store));
  surface.addEventListener("mouseup", () => rememberSelection(surface, store));
  surface.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); options.onCancel(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); if (!applyButton.disabled) { options.onApply(sanitizeReportMarkup(surface.innerHTML)); } return; }
    // The browser's own Ctrl+B/I/U would run its execCommand; route them through the same toggle as the buttons.
    const shortcut = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey ? MARK_SHORTCUTS[event.key.toLowerCase()] : undefined;
    if (shortcut !== undefined) { event.preventDefault(); rememberSelection(surface, store); apply({ kind: "mark", tag: shortcut }); }
  });
  // Pasted content arrives as text or as foreign markup; both go through the sanitiser.
  surface.addEventListener("paste", (event) => {
    const data = event.clipboardData;
    if (data === null) { return; }
    const html = data.getData("text/html");
    const text = data.getData("text/plain");
    if (html.length === 0 && text.length === 0) { return; }
    event.preventDefault();
    const cleaned = html.length > 0 ? sanitizeReportMarkup(html) : sanitizeReportMarkup(text);
    try { document.execCommand("insertHTML", false, cleaned); } catch { /* left as it was */ }
    counter();
  });
  applyButton.addEventListener("click", () => options.onApply(sanitizeReportMarkup(surface.innerHTML)));
  cancel.addEventListener("click", () => options.onCancel());

  shell.append(label, toolbar, surface, hint, foot);
  host.replaceChildren(shell);
  counter();
  surface.focus();
  return { surface, destroy: () => { shell.remove(); } };
}
