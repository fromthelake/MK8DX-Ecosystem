// Rich text for the night's report.
//
// The report editor stores a small, class-based subset of HTML: paragraphs,
// line breaks, bold, italic, underline, strike, links, lists, block quotes,
// and a fixed palette of colours, highlights, sizes, fonts, alignments and
// indents expressed as classes the stylesheet knows. No inline style survives:
// the hosted page is served under `style-src 'self'`, so a style attribute
// would never render there anyway. Everything else is unwrapped to its text;
// scripts, styles and embeds are dropped with their content.
//
// The same module lives in the web client (apps/timetrials-web/src). Keep the
// two identical: the API sanitises what is saved and published, the client
// sanitises again before it renders, and the editor's preview must show what
// the community will get.

export type ReportMarkupBlock = Readonly<{ html: string; text: string }>;

const ELEMENTS = new Set(["p", "br", "strong", "em", "u", "s", "a", "ul", "ol", "li", "blockquote", "span", "mark"]);
const BLOCKS = new Set(["p", "ul", "ol", "li", "blockquote"]);
const VOID = new Set(["br"]);
const ALIASES: Readonly<Record<string, string>> = {
  b: "strong", i: "em", strike: "s", del: "s", div: "p", h1: "p", h2: "p", h3: "p", h4: "p", h5: "p", h6: "p", font: "span",
};
const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "template", "noscript", "head", "title"]);

export const REPORT_TEXT_COLORS: readonly Readonly<{ name: string; hex: string }>[] = [
  { name: "red", hex: "#d64b2a" }, { name: "orange", hex: "#f97316" }, { name: "yellow", hex: "#d4a017" },
  { name: "green", hex: "#2e9e5b" }, { name: "blue", hex: "#2563eb" }, { name: "purple", hex: "#7c3aed" }, { name: "gray", hex: "#6b7280" },
];
export const REPORT_HIGHLIGHTS: readonly Readonly<{ name: string; hex: string }>[] = [
  { name: "yellow", hex: "#fff2a8" }, { name: "green", hex: "#d5f5e3" }, { name: "blue", hex: "#dbeafe" }, { name: "pink", hex: "#fde2e7" },
];
const INLINE_CLASSES = new Set([
  ...REPORT_TEXT_COLORS.map((entry) => `rt-color-${entry.name}`),
  ...REPORT_HIGHLIGHTS.map((entry) => `rt-bg-${entry.name}`),
  "rt-size-s", "rt-size-l", "rt-size-xl", "rt-font-serif", "rt-font-mono",
]);
const BLOCK_CLASSES = new Set(["rt-align-center", "rt-align-right", "rt-indent-1", "rt-indent-2", "rt-indent-3"]);

type Node = Readonly<{ kind: "text"; text: string }> | { kind: "element"; tag: string; attributes: Readonly<Record<string, string>>; children: Node[] };

const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/giu, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function escapeText(value: string): string {
  return value.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]!);
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    attributes[match[1]!.toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

/** A forgiving parse: unknown closers are ignored, unclosed elements close at the end. */
function parse(source: string): Node[] {
  const root: Node = { kind: "element", tag: "#root", attributes: {}, children: [] };
  const stack: Array<Node & { kind: "element" }> = [root];
  let dropping: string | null = null;
  const letter = (character: string | undefined): boolean =>
    character !== undefined && /[a-zA-Z]/.test(character);
  const nameCharacter = (character: string | undefined): boolean =>
    character !== undefined && /[a-zA-Z0-9]/.test(character);
  const appendText = (value: string): void => {
    if (dropping === null && value.length > 0) {
      stack[stack.length - 1]!.children.push({ kind: "text", text: decodeEntities(value) });
    }
  };
  let cursor = 0;
  while (cursor < source.length) {
    if (source.startsWith("<!--", cursor)) {
      const end = source.indexOf("-->", cursor + 4);
      if (end < 0) { appendText(source.slice(cursor)); break; }
      cursor = end + 3;
      continue;
    }
    if (source[cursor] !== "<") {
      const next = source.indexOf("<", cursor);
      appendText(source.slice(cursor, next < 0 ? source.length : next));
      cursor = next < 0 ? source.length : next;
      continue;
    }
    const start = cursor;
    const closing = source[cursor + 1] === "/";
    cursor += closing ? 2 : 1;
    if (!letter(source[cursor])) { appendText("<"); cursor = start + 1; continue; }
    const nameStart = cursor;
    while (nameCharacter(source[cursor])) cursor += 1;
    const tag = source.slice(nameStart, cursor).toLowerCase();
    const end = source.indexOf(">", cursor);
    if (end < 0) { appendText(source.slice(start)); break; }
    const trailing = source.slice(cursor, end);
    if (closing) {
      if (trailing.trim().length !== 0) { appendText(source.slice(start, end + 1)); cursor = end + 1; continue; }
      cursor = end + 1;
      if (dropping !== null) { if (tag === dropping) dropping = null; continue; }
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index]!.tag === tag) { stack.length = index; break; }
      }
      continue;
    }
    if (trailing.length > 0 && !/\s/.test(trailing[0]!) && trailing !== "/") {
      appendText(source.slice(start, end + 1));
      cursor = end + 1;
      continue;
    }
    const selfClosing = trailing.endsWith("/");
    cursor = end + 1;
    if (dropping !== null) continue;
    if (DROP_WITH_CONTENT.has(tag)) { dropping = selfClosing ? null : tag; continue; }
    const element: Node & { kind: "element" } = { kind: "element", tag, attributes: parseAttributes(trailing), children: [] };
    stack[stack.length - 1]!.children.push(element);
    if (!VOID.has(tag) && !selfClosing) stack.push(element);
  }
  return root.children;
}

function paletteClass(prefix: string, value: string, palette: readonly Readonly<{ name: string; hex: string }>[]): string | null {
  const normalized = value.trim().toLowerCase();
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(normalized);
  const hex = rgb === null
    ? normalized
    : `#${rgb.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
  const entry = palette.find((candidate) => candidate.hex === hex || candidate.name === normalized);
  return entry === undefined ? null : `${prefix}-${entry.name}`;
}

function sizeClass(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (/^[1-7]$/.test(normalized)) {
    const size = Number(normalized);
    return size <= 2 ? "rt-size-s" : size === 3 ? null : size <= 5 ? "rt-size-l" : "rt-size-xl";
  }
  const pixels = /^(\d+(?:\.\d+)?)px$/.exec(normalized);
  if (pixels !== null) {
    const size = Number(pixels[1]);
    return size < 14 ? "rt-size-s" : size <= 17 ? null : size <= 22 ? "rt-size-l" : "rt-size-xl";
  }
  const keywords: Readonly<Record<string, string | null>> = { "x-small": "rt-size-s", small: "rt-size-s", smaller: "rt-size-s", medium: null, large: "rt-size-l", larger: "rt-size-l", "x-large": "rt-size-xl", "xx-large": "rt-size-xl" };
  return normalized in keywords ? keywords[normalized]! : null;
}

function fontClass(value: string): string | null {
  const normalized = value.toLowerCase();
  if (/georgia|times|serif/.test(normalized) && !/sans-serif/.test(normalized)) { return "rt-font-serif"; }
  if (/courier|mono/.test(normalized)) { return "rt-font-mono"; }
  return null;
}

/** The classes an element keeps: its own allowed ones plus what its style or font attributes meant. */
function classesOf(tag: string, attributes: Readonly<Record<string, string>>): string[] {
  const allowed = BLOCKS.has(tag) ? BLOCK_CLASSES : INLINE_CLASSES;
  const classes = new Set<string>();
  for (const name of (attributes["class"] ?? "").split(/\s+/)) { if (allowed.has(name)) { classes.add(name); } }
  const declarations = new Map<string, string>();
  for (const declaration of (attributes["style"] ?? "").split(";")) {
    const [property, ...rest] = declaration.split(":");
    if (property !== undefined && rest.length > 0) { declarations.set(property.trim().toLowerCase(), rest.join(":").trim()); }
  }
  const add = (value: string | null): void => { if (value !== null && allowed.has(value)) { classes.add(value); } };
  const color = declarations.get("color") ?? attributes["color"];
  if (color !== undefined) { add(paletteClass("rt-color", color, REPORT_TEXT_COLORS)); }
  const background = declarations.get("background-color") ?? declarations.get("background");
  if (background !== undefined) { add(paletteClass("rt-bg", background, REPORT_HIGHLIGHTS)); }
  const size = declarations.get("font-size") ?? attributes["size"];
  if (size !== undefined) { add(sizeClass(size)); }
  const font = declarations.get("font-family") ?? attributes["face"];
  if (font !== undefined) { add(fontClass(font)); }
  const align = declarations.get("text-align") ?? attributes["align"];
  if (align !== undefined) { add(align.trim().toLowerCase() === "center" ? "rt-align-center" : align.trim().toLowerCase() === "right" ? "rt-align-right" : null); }
  const margin = declarations.get("margin-left") ?? declarations.get("padding-left");
  if (margin !== undefined) {
    const pixels = /^(\d+(?:\.\d+)?)(px|em)$/.exec(margin.trim().toLowerCase());
    if (pixels !== null) {
      const amount = pixels[2] === "em" ? Number(pixels[1]) * 16 : Number(pixels[1]);
      const level = Math.min(3, Math.max(1, Math.round(amount / 40)));
      if (amount > 0) { add(`rt-indent-${level}`); }
    }
  }
  return [...classes].sort();
}

function linkHref(value: string | undefined): string | null {
  const href = (value ?? "").trim();
  return /^(https?:\/\/|mailto:)/i.test(href) && !/[\s<>"]/.test(href) && href.length <= 2000 ? href : null;
}

function textOf(nodes: readonly Node[]): string {
  return nodes.map((node) => node.kind === "text" ? node.text : node.tag === "br" ? " " : textOf(node.children)).join("");
}

/** Serialise a node to sanitised HTML; disallowed elements unwrap to their content. */
function serialize(node: Node, inList: boolean): string {
  if (node.kind === "text") { return escapeText(node.text); }
  const tag = ALIASES[node.tag] ?? node.tag;
  if (!ELEMENTS.has(tag)) { return node.children.map((child) => serialize(child, inList)).join(""); }
  if (tag === "br") { return "<br>"; }
  if (tag === "li" && !inList) { return node.children.map((child) => serialize(child, inList)).join(""); }
  const inner = node.children.map((child) => serialize(child, tag === "ul" || tag === "ol" ? true : tag === "li" ? false : inList)).join("");
  if ((tag === "ul" || tag === "ol")) {
    // Only items live in a list; loose text becomes an item of its own.
    const items = inner.replace(/^\s+|\s+$/g, "");
    if (items.replace(/<li[^>]*>[\s\S]*?<\/li>/g, "").trim().length > 0) { return `<${tag}><li>${items}</li></${tag}>`; }
    return items.length === 0 ? "" : `<${tag}>${items}</${tag}>`;
  }
  const classes = classesOf(tag, node.attributes);
  const classAttribute = classes.length > 0 ? ` class="${classes.join(" ")}"` : "";
  if (tag === "a") {
    const href = linkHref(node.attributes["href"]);
    if (href === null) { return inner; }
    return `<a href="${escapeAttribute(href)}" rel="noopener" target="_blank"${classAttribute}>${inner}</a>`;
  }
  if (tag === "span" || tag === "mark") {
    if (classes.length === 0 && tag === "span") { return inner; }
    return `<${tag}${classAttribute}>${inner}</${tag}>`;
  }
  if (!BLOCKS.has(tag) && inner.replace(/<br>/g, "").trim().length === 0) { return inner; }
  return `<${tag}${classAttribute}>${inner}</${tag}>`;
}

const BLOCK_START = /^<(p|ul|ol|blockquote)\b/;

/** No element here preserves whitespace, so runs collapse to one space and a block's ends are trimmed. */
function tidy(html: string): string {
  return html.replace(/\s+/g, " ").replace(/^(?: |<br>)+|(?: |<br>)+$/g, "").replace(/(<br>) +/g, "$1");
}

/** Group the sanitised top-level run into blocks: block elements stand alone, inline runs become a paragraph. */
function blocksFrom(nodes: readonly Node[]): ReportMarkupBlock[] {
  const blocks: ReportMarkupBlock[] = [];
  let run: Node[] = [];
  const flush = (): void => {
    if (run.length === 0) { return; }
    const html = tidy(run.map((node) => serialize(node, false)).join(""));
    const text = textOf(run).replace(/\s+/g, " ").trim();
    if (text.length > 0 || html.includes("<br>")) { blocks.push({ html: `<p>${html}</p>`, text }); }
    run = [];
  };
  const isBlock = (node: Node): boolean => node.kind === "element" && ["p", "ul", "ol", "blockquote"].includes(ALIASES[node.tag] ?? node.tag);
  for (const node of nodes) {
    const tag = node.kind === "element" ? (ALIASES[node.tag] ?? node.tag) : "";
    if (node.kind === "element" && tag === "p" && node.children.some(isBlock)) {
      // A paragraph the browser wrapped around a list or another paragraph: its
      // runs and its blocks each stand on their own.
      flush();
      blocks.push(...blocksFrom(node.children));
      continue;
    }
    if (node.kind === "element" && (tag === "p" || tag === "ul" || tag === "ol" || tag === "blockquote")) {
      flush();
      const html = tidy(serialize(node, false));
      if (html.length === 0) { continue; }
      const text = tag === "ul" || tag === "ol"
        ? node.children.filter((child) => child.kind === "element").map((child, index) =>
          `${tag === "ol" ? `${index + 1}.` : "•"} ${textOf((child as Node & { kind: "element" }).children).replace(/\s+/g, " ").trim()}`).join("\n")
        : textOf(node.children).replace(/\s+/g, " ").trim();
      if (text.length > 0 || html.includes("<br>")) { blocks.push({ html, text }); }
      continue;
    }
    if (node.kind === "element" && !ELEMENTS.has(tag) && node.children.some((child) => child.kind === "element" && BLOCK_START.test(serialize(child, false)))) {
      // An unknown wrapper around blocks (a pasted <section>): look through it.
      flush();
      blocks.push(...blocksFrom(node.children));
      continue;
    }
    run.push(node);
  }
  flush();
  return blocks;
}

/** Plain text pasted or typed in the old text boxes: blank lines separate paragraphs. */
function plainTextBlocks(text: string): ReportMarkupBlock[] {
  return text.replace(/\r\n?/g, "\n").split(/\n\s*\n/u)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 0)
    .map((part) => ({ html: `<p>${escapeText(part)}</p>`, text: part }));
}

// Text typed in the old plain boxes is taken literally, "<3" and "<safe>"
// included; only a real HTML element (as the editor or a paste produces) or a
// closing tag switches to markup.
const LOOKS_LIKE_MARKUP = /<\/[a-zA-Z]|<(?:p|div|br|b|strong|i|em|u|s|strike|del|a|ul|ol|li|span|font|mark|blockquote|h[1-6]|script|style|img|section|article|table|iframe)(?:\s|\/|>)/i;

export function reportMarkupBlocks(value: string): readonly ReportMarkupBlock[] {
  const source = value ?? "";
  if (!LOOKS_LIKE_MARKUP.test(source)) { return plainTextBlocks(source); }
  return blocksFrom(parse(source));
}

/** The canonical stored form: sanitised blocks joined, nothing else. */
export function sanitizeReportMarkup(value: string): string {
  return reportMarkupBlocks(value).map((block) => block.html).join("");
}

/** The plain paragraphs a client without markup reads: one per block. */
export function reportMarkupText(value: string): readonly string[] {
  return reportMarkupBlocks(value).map((block) => block.text).filter((text) => text.length > 0);
}

export function reportMarkupHtml(value: string): readonly string[] {
  return reportMarkupBlocks(value).map((block) => block.html);
}
