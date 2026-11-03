// Line formatting for the WordPress exports (tournament-report-wordpress.ts, tournament-report-classic.ts).
//
// The Director copies the whole file and pastes it into the WordPress code editor of a page. The
// exports used to be a few lines of millions of characters; this writes the same document in lines
// of at most about two thousand characters, without changing what any browser builds from it:
//
//   - markup: a line ends only inside a start tag, at the whitespace before its first attribute.
//     An HTML parser treats that newline exactly like the space it replaces, so no text node is
//     added, and text, entities, SVG text and attribute values are untouched;
//   - packed scripts (wordpressSafeScript's one-line base64): the base64 is split into pieces joined
//     back with [].join(''), and each line break sits inside a /* */ comment, so that even if
//     WordPress rewrites line breaks inside a script (it turned raw runtimes into a SyntaxError),
//     the break stays a comment and the string is byte for byte the same;
//   - CSS: a line ends after "}" or ";" outside strings and url(...);
//   - data URLs and other single values are never split; a line holding one may stay long.
//
// No dependencies, so it can also be compiled and run on its own against an existing export.

const PACKED_START = "(function(){try{var _d='";
const PACKED_END = "';var _s='';";
export const WORDPRESS_LINE_TARGET = 2000;
const BASE64_PIECE = 1536;

/** A packed script with its base64 in pieces; any other script is returned as it is. */
export function chunkPackedScript(source: string, piece = BASE64_PIECE): string {
  if (!source.startsWith(PACKED_START)) { return source; }
  const end = source.indexOf(PACKED_END, PACKED_START.length);
  if (end < 0) { return source; }
  const data = source.slice(PACKED_START.length, end);
  if (!/^[A-Za-z0-9+/=]*$/.test(data) || data.length <= piece) { return source; }
  const pieces: string[] = [];
  for (let index = 0; index < data.length; index += piece) { pieces.push(`"${data.slice(index, index + piece)}"`); }
  return `(function(){try{var _d=[/*\n*/${pieces.join(",/*\n*/")}/*\n*/].join('');var _s='';${source.slice(end + PACKED_END.length)}`;
}

/** CSS with line breaks after "}" (and after ";" in a long line), never inside a string or url(). */
export function formatCssLines(css: string, target = WORDPRESS_LINE_TARGET): string {
  let out = "";
  let line = 0;
  let quote: string | null = null;
  let parens = 0;
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index]!;
    out += char;
    line = char === "\n" ? 0 : line + 1;
    if (quote !== null) {
      if (char === "\\") { out += css[index + 1] ?? ""; index += 1; line += 1; continue; }
      if (char === quote) { quote = null; }
      continue;
    }
    if (char === "\"" || char === "'") { quote = char; continue; }
    if (char === "(") { parens += 1; continue; }
    if (char === ")") { parens = Math.max(0, parens - 1); continue; }
    if (parens > 0) { continue; }
    const next = css[index + 1];
    if (next === undefined || next === "\n") { continue; }
    if (char === "}" || (char === ";" && line > target / 2)) { out += "\n"; line = 0; }
  }
  return out;
}

/**
 * The whole export in short lines (see the header). Scripts other than packed ones and the content
 * of pre/textarea are left exactly as they are.
 */
export function formatWordpressLines(html: string, target = WORDPRESS_LINE_TARGET): string {
  let out = "";
  let line = 0;
  let index = 0;
  const push = (text: string): void => {
    out += text;
    const last = text.lastIndexOf("\n");
    line = last < 0 ? line + text.length : text.length - last - 1;
  };
  while (index < html.length) {
    const open = html.indexOf("<", index);
    if (open < 0) { push(html.slice(index)); break; }
    push(html.slice(index, open));
    if (html.startsWith("<!--", open)) {
      const close = html.indexOf("-->", open + 4);
      const end = close < 0 ? html.length : close + 3;
      push(html.slice(open, end));
      index = end;
      continue;
    }
    const name = /^<([A-Za-z][A-Za-z0-9-]*)/.exec(html.slice(open, open + 64));
    if (name === null) { push("<"); index = open + 1; continue; }
    // The end of the start tag, stepping over quoted attribute values.
    let cursor = open + name[0].length;
    let quote: string | null = null;
    for (; cursor < html.length; cursor += 1) {
      const char = html[cursor]!;
      if (quote !== null) { if (char === quote) { quote = null; } continue; }
      if (char === "\"" || char === "'") { quote = char; continue; }
      if (char === ">") { break; }
    }
    let tag = html.slice(open, cursor + 1);
    const afterName = name[0].length;
    // A start tag that would carry the line past the target begins its attributes on a new line.
    // A margin for the tag name that stays on the line before the break.
    if (line + tag.length > target - 80 && /\s/.test(tag[afterName] ?? "")) {
      tag = `${tag.slice(0, afterName)}\n${tag.slice(afterName + 1)}`;
    }
    push(tag);
    index = cursor + 1;
    const element = name[1]!.toLowerCase();
    if (element === "script" || element === "style" || element === "pre" || element === "textarea") {
      const closeAt = html.toLowerCase().indexOf(`</${element}`, index);
      const end = closeAt < 0 ? html.length : closeAt;
      const body = html.slice(index, end);
      push(element === "script" ? chunkPackedScript(body) : element === "style" ? formatCssLines(body, target) : body);
      index = end;
    }
  }
  return out;
}

/** The lines of a file longer than the target, longest first, with what each one starts with. */
export function longLines(text: string, target = WORDPRESS_LINE_TARGET): { line: number; length: number; start: string }[] {
  return text.split("\n").map((content, at) => ({ line: at + 1, length: content.length, start: content.slice(0, 80) }))
    .filter((entry) => entry.length > target).sort((a, b) => b.length - a.length);
}
