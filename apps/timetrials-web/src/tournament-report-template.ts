// The night's writing as one file the writer can take away and bring back.
//
// The report writer writes the report; the Director owns the Tournament. Those are two
// people and often two moments, and a night sometimes has to be rebuilt (a
// missing character, a corrected score), which gives the groups and the
// Players new identifiers. So the writing travels as a plain text file keyed
// by *name*, not by identifier: a rebuilt night takes the same file back.
//
// The file is Markdown, and deliberately nothing of our own invention. Bold,
// italic, strike, lists, quotes and links are CommonMark/GFM exactly as any
// Markdown editor writes them, so the file previews correctly anywhere and
// the writer can use a tool they already know. What Markdown has no concept
// of - colour, highlight, size, font, alignment, indent, underline - is
// written as plain HTML, which Markdown has always allowed inline. That is
// the standard answer to "Markdown cannot express this", and it keeps the
// round trip exact: the editor stores that same small HTML subset
// (`tournament-report-markup.ts`).
//
// The section markers are HTML comments, so a Markdown preview hides them and
// no heading of the writer's own can collide with them.

import { localized } from "./product-language.js";
import { sanitizeReportMarkup } from "./tournament-report-markup.js";

export type ReportTemplateFields = Readonly<{
  titleText: string;
  introText: string;
  summaryText: string;
  tracksIntroText: string;
  /** Keyed by the group's name as the report prints it. */
  groupNotes: Readonly<Record<string, string>>;
  /** Keyed by the Player's name as the report prints it. */
  playerNotes: Readonly<Record<string, string>>;
}>;

export type ParsedReportTemplate = Readonly<{
  fields: ReportTemplateFields;
  /** Section markers the file carried that this night does not have. */
  unknownSections: readonly string[];
  /** Lines the parser could not place, with their line numbers. */
  strayLines: readonly Readonly<{ line: number; text: string }>[];
}>;

// ---------------------------------------------------------------- vocabulary

/**
 * The class a writer types and the class the editor stores. A writer should
 * not have to know our prefix, and a file that already carries the stored
 * spelling must still read, so both are accepted and the short one is written.
 */
const CLASS_NAMES: readonly Readonly<{ written: string; stored: string; tag: "span" | "mark" | "p" }>[] = [
  { written: "red", stored: "rt-color-red", tag: "span" },
  { written: "orange", stored: "rt-color-orange", tag: "span" },
  { written: "yellow", stored: "rt-color-yellow", tag: "span" },
  { written: "green", stored: "rt-color-green", tag: "span" },
  { written: "blue", stored: "rt-color-blue", tag: "span" },
  { written: "purple", stored: "rt-color-purple", tag: "span" },
  { written: "gray", stored: "rt-color-gray", tag: "span" },
  { written: "yellow", stored: "rt-bg-yellow", tag: "mark" },
  { written: "green", stored: "rt-bg-green", tag: "mark" },
  { written: "blue", stored: "rt-bg-blue", tag: "mark" },
  { written: "pink", stored: "rt-bg-pink", tag: "mark" },
  { written: "small", stored: "rt-size-s", tag: "span" },
  { written: "big", stored: "rt-size-l", tag: "span" },
  { written: "xl", stored: "rt-size-xl", tag: "span" },
  { written: "serif", stored: "rt-font-serif", tag: "span" },
  { written: "mono", stored: "rt-font-mono", tag: "span" },
  { written: "center", stored: "rt-align-center", tag: "p" },
  { written: "right", stored: "rt-align-right", tag: "p" },
  { written: "indent1", stored: "rt-indent-1", tag: "p" },
  { written: "indent2", stored: "rt-indent-2", tag: "p" },
  { written: "indent3", stored: "rt-indent-3", tag: "p" },
];
/** Dutch words for the same classes, read but never written. */
const CLASS_ALIASES: Readonly<Record<string, string>> = {
  rood: "red", oranje: "orange", geel: "yellow", groen: "green", blauw: "blue", paars: "purple",
  grijs: "gray", grey: "gray", roze: "pink", klein: "small", groot: "big",
  midden: "center", rechts: "right", inspring1: "indent1", inspring2: "indent2", inspring3: "indent3",
};

const STORED_BY_WRITTEN = new Map<string, string>(CLASS_NAMES.map((entry) => [`${entry.tag}:${entry.written}`, entry.stored]));
const WRITTEN_BY_STORED = new Map<string, string>(CLASS_NAMES.map((entry) => [entry.stored, entry.written]));

/** Tags a writer may type straight into the text; the sanitiser has the last word. */
const RAW_TAGS = new Set(["u", "span", "mark", "strong", "em", "s", "b", "i", "a", "br", "p", "ul", "ol", "li", "blockquote"]);

const MARKER = /^\s*<!--\s*MK8DX:([A-Z]+)(?:\s+(.*?))?\s*-->\s*$/;
/** The first spelling of this file ever used, still read so an early file keeps working. */
const LEGACY_MARKER = /^\s*===\s*(.+?)\s*===\s*$/;

const SECTION_TITLE = ["TITLE", "TITEL"];
const SECTION_INTRO = ["INTRO"];
const SECTION_SUMMARY = ["SUMMARY", "SAMENVATTING"];
const SECTION_TRACKS = ["TOPTRACKS", "TOP TRACKS", "TOP BANEN"];
const SECTION_GROUP = ["GROUP", "GROEP"];
const SECTION_PLAYER = ["PLAYER", "SPELER"];

// --------------------------------------------------------- Markdown -> markup

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]!);
}

/** Rewrite a written class into the stored one, for one raw tag. */
function mapClasses(tag: string, source: string): string {
  return source.replace(/class="([^"]*)"/i, (_whole, value: string) => {
    const mapped = value.split(/\s+/).filter(Boolean).map((name) => {
      const canonical = CLASS_ALIASES[name.toLowerCase()] ?? name;
      return STORED_BY_WRITTEN.get(`${tag}:${canonical}`) ?? canonical;
    });
    return `class="${mapped.join(" ")}"`;
  });
}

/** A raw tag at `index`, passed through with its classes translated. */
function rawTagAt(source: string, index: number): Readonly<{ html: string; length: number }> | null {
  const match = /^<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/.exec(source.slice(index));
  if (match === null) { return null; }
  const tag = match[1]!.toLowerCase();
  if (!RAW_TAGS.has(tag)) { return null; }
  return { html: mapClasses(tag, match[0]), length: match[0].length };
}

/** One pass over a line of Markdown, producing inline HTML. */
function inlineToHtml(source: string): string {
  const EMPHASIS: readonly Readonly<{ opener: string; tag: string }>[] = [
    { opener: "**", tag: "strong" }, { opener: "__", tag: "strong" },
    { opener: "~~", tag: "s" }, { opener: "*", tag: "em" }, { opener: "_", tag: "em" },
  ];
  let out = "";
  let plain = "";
  const flush = (): void => { out += escapeHtml(plain); plain = ""; };
  let index = 0;
  while (index < source.length) {
    const character = source[index]!;
    // CommonMark: a backslash escapes any punctuation.
    if (character === "\\" && index + 1 < source.length && /[!-/:-@[-`{-~]/.test(source[index + 1]!)) {
      plain += source[index + 1];
      index += 2;
      continue;
    }
    if (character === "<") {
      const raw = rawTagAt(source, index);
      if (raw !== null) { flush(); out += raw.html; index += raw.length; continue; }
    }
    if (character === "[") {
      const close = source.indexOf("]", index);
      const href = close > index && source[close + 1] === "("
        ? source.slice(close + 2, source.indexOf(")", close + 2) === -1 ? close + 2 : source.indexOf(")", close + 2)).trim()
        : "";
      const end = close > index ? source.indexOf(")", close + 2) : -1;
      if (end > close && /^(https?:\/\/|mailto:)/i.test(href)) {
        flush();
        out += `<a href="${escapeHtml(href).replace(/"/g, "&quot;")}">${inlineToHtml(source.slice(index + 1, close))}</a>`;
        index = end + 1;
        continue;
      }
    }
    const emphasis = EMPHASIS.find((entry) => source.startsWith(entry.opener, index) &&
      source.indexOf(entry.opener, index + entry.opener.length) > index);
    if (emphasis !== undefined) {
      const close = source.indexOf(emphasis.opener, index + emphasis.opener.length);
      flush();
      out += `<${emphasis.tag}>${inlineToHtml(source.slice(index + emphasis.opener.length, close))}</${emphasis.tag}>`;
      index = close + emphasis.opener.length;
      continue;
    }
    plain += character;
    index += 1;
  }
  flush();
  return out;
}

/** A block the writer typed as raw HTML rather than as Markdown. */
function rawBlock(lines: readonly string[]): string | null {
  const first = lines[0]?.trimStart() ?? "";
  if (!/^<(p|ul|ol|blockquote|li)\b/i.test(first)) { return null; }
  return lines.join("\n").replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (whole) => {
    const tag = /^<\/?([a-zA-Z][a-zA-Z0-9]*)/.exec(whole)![1]!.toLowerCase();
    return RAW_TAGS.has(tag) ? mapClasses(tag, whole) : whole;
  });
}

/**
 * The writer's Markdown as the editor's markup. A blank line starts a
 * paragraph, a single new line inside one is a line break, `-` and `1.` make
 * lists, `>` makes a quote, and raw HTML passes through to the sanitiser.
 */
export function shorthandToMarkup(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let index = 0;
  const kindOf = (line: string): "ul" | "ol" | "quote" | "text" | "blank" => {
    if (line.trim().length === 0) { return "blank"; }
    if (/^\s*[-*+]\s+/.test(line)) { return "ul"; }
    if (/^\s*\d+[.)]\s+/.test(line)) { return "ol"; }
    if (/^\s*>\s?/.test(line)) { return "quote"; }
    return "text";
  };
  while (index < lines.length) {
    const kind = kindOf(lines[index]!);
    if (kind === "blank") { index += 1; continue; }
    if (kind === "ul" || kind === "ol") {
      const items: string[] = [];
      while (index < lines.length && kindOf(lines[index]!) === kind) {
        const body = lines[index]!.replace(kind === "ul" ? /^\s*[-*+]\s+/ : /^\s*\d+[.)]\s+/, "");
        items.push(`<li>${inlineToHtml(body)}</li>`);
        index += 1;
      }
      html.push(`<${kind}>${items.join("")}</${kind}>`);
      continue;
    }
    if (kind === "quote") {
      const parts: string[] = [];
      while (index < lines.length && kindOf(lines[index]!) === "quote") {
        parts.push(inlineToHtml(lines[index]!.replace(/^\s*>\s?/, "")));
        index += 1;
      }
      html.push(`<blockquote>${parts.join("<br>")}</blockquote>`);
      continue;
    }
    const run: string[] = [];
    while (index < lines.length && kindOf(lines[index]!) === "text") { run.push(lines[index]!); index += 1; }
    const raw = rawBlock(run);
    if (raw !== null) { html.push(raw); continue; }
    html.push(`<p>${run.map((line) => inlineToHtml(line)).join("<br>")}</p>`);
  }
  // The editor's own sanitiser has the last word, so what is stored here is
  // exactly what the editor would have stored.
  return sanitizeReportMarkup(html.join(""));
}

// --------------------------------------------------------- markup -> Markdown

type Token =
  | Readonly<{ kind: "text"; text: string }>
  | Readonly<{ kind: "open"; tag: string; className: string; href: string }>
  | Readonly<{ kind: "close"; tag: string }>
  | Readonly<{ kind: "br" }>;

/** The stored markup is canonical, so a small scan is enough to read it back. */
function tokenize(markup: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /<\/([a-z]+)>|<([a-z]+)((?:\s+[a-z-]+="[^"]*")*)\s*\/?>|([^<]+)/gi;
  for (const match of markup.matchAll(pattern)) {
    if (match[1] !== undefined) { tokens.push({ kind: "close", tag: match[1].toLowerCase() }); continue; }
    if (match[2] !== undefined) {
      const tag = match[2].toLowerCase();
      if (tag === "br") { tokens.push({ kind: "br" }); continue; }
      const attributes = match[3] ?? "";
      tokens.push({
        kind: "open", tag,
        className: /class="([^"]*)"/i.exec(attributes)?.[1] ?? "",
        href: /href="([^"]*)"/i.exec(attributes)?.[1] ?? "",
      });
      continue;
    }
    if (match[4] !== undefined) { tokens.push({ kind: "text", text: decodeEntities(match[4]) }); }
  }
  return tokens;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** CommonMark escaping: enough that a round trip gives the same text back. */
function escapeMarkdown(value: string): string {
  return value
    .replace(/[\\*_~`[\]<>]/g, (character) => `\\${character}`)
    .replace(/^(\s*)([#>+-])/gm, (_whole, space: string, character: string) => `${space}\\${character}`)
    .replace(/^(\s*)(\d+)([.)])/gm, (_whole, space: string, digits: string, dot: string) => `${space}${digits}\\${dot}`);
}

/** The written spelling of a stored class list, for a raw tag we hand back. */
function writtenClasses(className: string): string {
  return className.split(/\s+/).filter(Boolean).map((name) => WRITTEN_BY_STORED.get(name) ?? name).join(" ");
}

function inlineToMarkdown(tokens: readonly Token[], from: number, until: string | null): Readonly<{ text: string; next: number }> {
  let out = "";
  let index = from;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token.kind === "close") {
      if (until !== null && token.tag === until) { return { text: out, next: index + 1 }; }
      index += 1;
      continue;
    }
    if (token.kind === "text") { out += escapeMarkdown(token.text); index += 1; continue; }
    if (token.kind === "br") { out += "\n"; index += 1; continue; }
    const tag = token.tag;
    if (tag === "strong" || tag === "em" || tag === "s") {
      const opener = tag === "strong" ? "**" : tag === "em" ? "*" : "~~";
      const inner = inlineToMarkdown(tokens, index + 1, tag);
      out += `${opener}${inner.text}${opener}`;
      index = inner.next;
      continue;
    }
    if (tag === "a") {
      const inner = inlineToMarkdown(tokens, index + 1, "a");
      out += `[${inner.text}](${token.href})`;
      index = inner.next;
      continue;
    }
    // Everything Markdown has no word for stays HTML, which Markdown allows.
    if (tag === "u" || tag === "span" || tag === "mark") {
      const inner = inlineToMarkdown(tokens, index + 1, tag);
      const classes = writtenClasses(token.className);
      out += classes.length === 0 && tag !== "u"
        ? inner.text
        : `<${tag}${classes.length === 0 ? "" : ` class="${classes}"`}>${inner.text}</${tag}>`;
      index = inner.next;
      continue;
    }
    index += 1;
  }
  return { text: out, next: index };
}

/** The stored markup as Markdown the writer can edit anywhere. */
export function markupToShorthand(markup: string): string {
  const tokens = tokenize(sanitizeReportMarkup(markup));
  const out: string[] = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token.kind !== "open") { index += 1; continue; }
    if (token.tag === "p" || token.tag === "blockquote") {
      const inner = inlineToMarkdown(tokens, index + 1, token.tag);
      const body = inner.text.trim();
      if (token.tag === "blockquote") {
        out.push(body.split("\n").map((line) => `> ${line}`).join("\n"));
      } else if (token.className.trim().length > 0) {
        // A whole-paragraph class has no Markdown, so the paragraph is HTML.
        out.push(`<p class="${writtenClasses(token.className)}">${body.replace(/\n/g, "<br>")}</p>`);
      } else {
        out.push(body);
      }
      index = inner.next;
      continue;
    }
    if (token.tag === "ul" || token.tag === "ol") {
      const items: string[] = [];
      let cursor = index + 1;
      while (cursor < tokens.length) {
        const next = tokens[cursor]!;
        if (next.kind === "close" && next.tag === token.tag) { cursor += 1; break; }
        if (next.kind === "open" && next.tag === "li") {
          const inner = inlineToMarkdown(tokens, cursor + 1, "li");
          items.push(inner.text.trim());
          cursor = inner.next;
          continue;
        }
        cursor += 1;
      }
      out.push(items.map((item, position) => token.tag === "ul" ? `- ${item}` : `${position + 1}. ${item}`).join("\n"));
      index = cursor;
      continue;
    }
    index += 1;
  }
  return out.join("\n\n");
}

// ------------------------------------------------------------------- the file

/** The explanation the file opens with, as ordinary Markdown. */
export function reportTemplateHelp(): readonly string[] {
  return [
    localized("## How to write in this file", "## Zo schrijf je in dit bestand"),
    "",
    localized(
      "This is an ordinary Markdown file. Any Markdown editor or preview shows it correctly.",
      "Dit is een gewoon Markdown-bestand. Elke Markdown-editor of -preview toont het goed.",
    ),
    localized(
      "Write under a marker line. Leave a section empty to leave that block of the report alone.",
      "Schrijf onder een markeringsregel. Laat een deel leeg om dat blok van het verslag ongemoeid te laten.",
    ),
    "",
    localized("### Markdown, the ordinary way", "### Markdown, de gewone manier"),
    "",
    "```",
    localized("**bold**    *italic*    ~~strike~~", "**vet**    *cursief*    ~~doorgehaald~~"),
    localized("- a bullet", "- een opsomming"),
    localized("1. a numbered item", "1. een genummerd punt"),
    localized("> a quote", "> een citaat"),
    "[mk8dx.example](https://mk8dx.example)",
    localized(`A backslash takes the meaning away: ${"\\"}*this stays a star${"\\"}*.`,
      `Een backslash haalt de betekenis weg: ${"\\"}*dit blijft een sterretje${"\\"}*.`),
    "```",
    "",
    localized(
      "An empty line starts a paragraph. A single new line inside a paragraph is a line break.",
      "Een lege regel begint een alinea. Een enkele nieuwe regel binnen een alinea is een regelafbreking.",
    ),
    "",
    localized("### HTML, for what Markdown has no word for", "### HTML, voor wat Markdown niet kent"),
    "",
    localized(
      "Markdown allows HTML inline, and that is how colour and the rest are written.",
      "Markdown staat HTML toe in de tekst, en zo worden kleur en de rest geschreven.",
    ),
    "",
    "```",
    localized("<u>underlined</u>", "<u>onderstreept</u>"),
    localized("<span class=\"red\">text in red</span>", "<span class=\"red\">tekst in rood</span>"),
    localized("<mark class=\"yellow\">highlighted</mark>", "<mark class=\"yellow\">gemarkeerd</mark>"),
    localized("<span class=\"big\">bigger</span>", "<span class=\"big\">groter</span>"),
    localized("<p class=\"center\">a whole paragraph</p>", "<p class=\"center\">een hele alinea</p>"),
    "```",
    "",
    localized("Text colour: red, orange, yellow, green, blue, purple, gray.", "Tekstkleur: red, orange, yellow, green, blue, purple, gray."),
    localized("Highlight on `<mark>`: yellow, green, blue, pink.", "Markering op `<mark>`: yellow, green, blue, pink."),
    localized("Size and font on `<span>`: small, big, xl, serif, mono.", "Grootte en letter op `<span>`: small, big, xl, serif, mono."),
    localized("Whole paragraph on `<p>`: center, right, indent1, indent2, indent3.", "Hele alinea op `<p>`: center, right, indent1, indent2, indent3."),
    localized(
      "Dutch class words are read too: rood, geel, groen, blauw, paars, grijs, roze, klein, groot, midden, rechts, inspring1.",
      "Nederlandse klassewoorden worden ook gelezen: rood, geel, groen, blauw, paars, grijs, roze, klein, groot, midden, rechts, inspring1.",
    ),
    "",
    localized(
      "Player and group markers are matched by name, so a rebuilt night takes this file back.",
      "Markeringen van spelers en groepen worden op naam gekoppeld, dus een opnieuw opgebouwde avond neemt dit bestand weer aan.",
    ),
  ];
}

export type ReportTemplateInput = Readonly<{
  /** How the file names itself: "TN13 · Toernooi 13". */
  heading: string;
  fields: ReportTemplateFields;
  /** Every group of the night, in reading order, by name. */
  groupNames: readonly string[];
  /** Every Player of the night, in reading order, by name. */
  playerNames: readonly string[];
  generatedAt: Date;
}>;

function marker(name: string, subject?: string): string {
  return `<!-- MK8DX:${name}${subject === undefined ? "" : ` ${subject}`} -->`;
}

function section(name: string, subject: string | undefined, body: string): string {
  return `${marker(name, subject)}\n\n${body}\n`;
}

/** The night's writing as one Markdown file: the explanation, then a block per field. */
export function buildReportTemplate(input: ReportTemplateInput): string {
  const stamp = input.generatedAt.toISOString().slice(0, 16).replace("T", " ");
  // The explanation is ordinary Markdown, so a preview shows it. Everything
  // above the first marker is the file's header and is never imported, which
  // is also why the help may show a marker without becoming one.
  const parts = [
    `# ${input.heading}`,
    "",
    localized(`*MK8DX report file, made ${stamp} UTC.*`, `*MK8DX verslagbestand, gemaakt ${stamp} UTC.*`),
    "",
    ...reportTemplateHelp(),
    "",
    localized(
      "*Everything above the first marker is this explanation and is never imported.*",
      "*Alles boven de eerste markering is deze uitleg en wordt nooit geïmporteerd.*",
    ),
    "",
    section("TITLE", undefined, input.fields.titleText),
    section("INTRO", undefined, markupToShorthand(input.fields.introText)),
    section("SUMMARY", undefined, markupToShorthand(input.fields.summaryText)),
    section("TOPTRACKS", undefined, markupToShorthand(input.fields.tracksIntroText)),
  ];
  for (const name of input.groupNames) {
    parts.push(section("GROUP", name, markupToShorthand(input.fields.groupNotes[name] ?? "")));
  }
  for (const name of input.playerNames) {
    parts.push(section("PLAYER", name, markupToShorthand(input.fields.playerNotes[name] ?? "")));
  }
  return parts.join("\n");
}

type OpenSection =
  | Readonly<{ kind: "title" | "intro" | "summary" | "tracks" }>
  | Readonly<{ kind: "group" | "player"; name: string }>
  | Readonly<{ kind: "unknown"; name: string }>;

function sectionOf(label: string, subject: string): OpenSection {
  const upper = label.trim().toUpperCase();
  if (SECTION_TITLE.includes(upper)) { return { kind: "title" }; }
  if (SECTION_INTRO.includes(upper)) { return { kind: "intro" }; }
  if (SECTION_SUMMARY.includes(upper)) { return { kind: "summary" }; }
  if (SECTION_TRACKS.includes(upper)) { return { kind: "tracks" }; }
  const name = subject.trim();
  if (name.length > 0 && SECTION_GROUP.includes(upper)) { return { kind: "group", name }; }
  if (name.length > 0 && SECTION_PLAYER.includes(upper)) { return { kind: "player", name }; }
  return { kind: "unknown", name: `${upper}${name.length === 0 ? "" : ` ${name}`}` };
}

/** Read a written file back into the draft's fields, keyed by name. */
export function parseReportTemplate(source: string): ParsedReportTemplate {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const collected = new Map<string, string[]>();
  const order: OpenSection[] = [];
  const unknown: string[] = [];
  const stray: Array<{ line: number; text: string }> = [];
  let current: OpenSection | null = null;
  let key = "";
  let inComment = false;
  for (const [position, raw] of lines.entries()) {
    const marked = MARKER.exec(raw);
    if (marked === null && inComment) {
      if (raw.includes("-->")) { inComment = false; }
      continue;
    }
    if (marked === null && /^\s*<!--/.test(raw) && !raw.includes("-->")) { inComment = true; continue; }
    if (marked === null && /^\s*<!--[\s\S]*-->\s*$/.test(raw)) { continue; }
    const legacy = marked === null ? LEGACY_MARKER.exec(raw) : null;
    if (marked !== null || legacy !== null) {
      if (marked !== null) {
        current = sectionOf(marked[1]!, marked[2] ?? "");
      } else {
        const whole = legacy![1]!;
        const split = whole.indexOf(":");
        current = split > 0 ? sectionOf(whole.slice(0, split), whole.slice(split + 1)) : sectionOf(whole, "");
      }
      key = current.kind === "group" || current.kind === "player" || current.kind === "unknown"
        ? `${current.kind}:${current.name}` : current.kind;
      if (current.kind === "unknown") { unknown.push(current.name); continue; }
      order.push(current);
      if (!collected.has(key)) { collected.set(key, []); }
      continue;
    }
    if (current === null) { continue; }
    if (current.kind === "unknown") {
      // Under a marker this night does not have, the writing is real and the
      // writer should be told it was left out.
      if (raw.trim().length > 0) { stray.push({ line: position + 1, text: raw.trim().slice(0, 120) }); }
      continue;
    }
    collected.get(key)!.push(raw);
  }
  const body = (name: string): string => (collected.get(name) ?? []).join("\n").trim();
  const groupNotes: Record<string, string> = {};
  const playerNotes: Record<string, string> = {};
  for (const entry of order) {
    if (entry.kind === "group") { groupNotes[entry.name] = shorthandToMarkup(body(`group:${entry.name}`)); }
    if (entry.kind === "player") { playerNotes[entry.name] = shorthandToMarkup(body(`player:${entry.name}`)); }
  }
  return {
    fields: {
      titleText: body("title").replace(/\\(.)/g, "$1").replace(/\s+/g, " ").trim().slice(0, 160),
      introText: shorthandToMarkup(body("intro")),
      summaryText: shorthandToMarkup(body("summary")),
      tracksIntroText: shorthandToMarkup(body("tracks")),
      groupNotes, playerNotes,
    },
    unknownSections: unknown,
    strayLines: stray,
  };
}

/** A file name a writer recognises: "TN13-Toernooi-13-2026-09-15.md". */
export function reportTemplateFileName(heading: string, generatedAt: Date): string {
  const safe = heading.normalize("NFKD").replace(/[^A-Za-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 60);
  return `${safe === "" ? "verslag" : safe}-${generatedAt.toISOString().slice(0, 10)}.md`;
}
