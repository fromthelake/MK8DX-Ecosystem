// Extract the web product's translatable English texts into apps/timetrials-web/i18n/messages.source.json.
//
//   npm ci --prefix tooling/i18n && node tooling/i18n/extract_web_messages.mjs [--check]
//
// Two kinds of text are collected from apps/timetrials-web/src:
//   * every `localized(en, nl)` call: the English argument becomes the key, its interpolations `{0}`, `{1}`, ...
//     in reading order; the Dutch argument is kept beside it as context for translators;
//   * English-only text the code writes to the page: string literals assigned to `textContent`, `placeholder`,
//     `title` or `ariaLabel`, passed to `setAttribute("aria-label" | "title" | "placeholder", ...)`, or as the text
//     argument of the small element helpers — the same text the page translator rewrites for Dutch.
// The result is sorted by key, so a re-run only changes what changed in the code.
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "package.json"));
const tsModule = require("typescript");
const ts = tsModule.default ?? tsModule;

const repositoryRoot = resolve(here, "../..");
const sourceRoot = join(repositoryRoot, "apps", "timetrials-web", "src");
const outputPath = join(repositoryRoot, "apps", "timetrials-web", "i18n", "messages.source.json");
const SKIP_FILES = new Set(["dutch-presentation.generated.ts", "i18n-catalog-index.generated.ts", "ds-gallery.ts"]);
const TEXT_PROPERTIES = new Set(["textContent", "placeholder", "title", "ariaLabel", "innerText"]);
const TEXT_ATTRIBUTES = new Set(["aria-label", "title", "placeholder", "alt"]);

/** The key of an English expression: literals verbatim, interpolations numbered in reading order. */
function keyOf(node) {
  if (ts.isParenthesizedExpression(node)) { return keyOf(node.expression); }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) { return node.text; }
  if (ts.isTemplateExpression(node)) {
    let key = node.head.text;
    node.templateSpans.forEach((span, index) => { key += `{${index}}${span.literal.text}`; });
    return key;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = keyOf(node.left);
    const right = keyOf(node.right);
    if (left === null || right === null) { return null; }
    // Renumber the right side's placeholders after the left side's.
    const offset = (left.match(/\{\d+\}/g) ?? []).length;
    return left + right.replace(/\{(\d+)\}/g, (_, index) => `{${Number(index) + offset}}`);
  }
  return null;
}

/** Literal branches of a conditional or a plain literal: the texts an expression can show. */
function literalTexts(node) {
  if (ts.isParenthesizedExpression(node)) { return literalTexts(node.expression); }
  if (ts.isConditionalExpression(node)) { return [...literalTexts(node.whenTrue), ...literalTexts(node.whenFalse)]; }
  const key = keyOf(node);
  return key === null ? [] : [key];
}

function looksTranslatable(text) {
  const plain = text.replace(/\{\d+\}/g, "").trim();
  // Skip identifiers, class names, URLs, single symbols and numbers.
  return /[A-Za-z]{2,}/.test(plain) && !/^[a-z0-9_.:/#?=&-]+$/.test(plain) && !/^https?:/.test(plain);
}

const messages = new Map();
const skipped = { nonLiteralLocalized: 0 };

function add(key, kind, file, nl) {
  // A localized(en, nl) call is translatable by definition, single lower-case words ("tracks", "cups") included;
  // the identifier filter is for loose literals only.
  const translatable = kind === "localized" ? key !== null && /[A-Za-z]{2,}/.test(key) : key !== null && looksTranslatable(key);
  if (key === null || key.trim().length === 0 || !translatable) { return; }
  const entry = messages.get(key) ?? { key, nl: undefined, kinds: new Set(), places: new Set() };
  if (nl !== undefined && entry.nl === undefined) { entry.nl = nl; }
  entry.kinds.add(kind);
  // File names only: line numbers would change the whole file with every unrelated edit.
  if (entry.places.size < 4) { entry.places.add(file); }
  messages.set(key, entry);
}

for (const name of readdirSync(sourceRoot).sort()) {
  if (!name.endsWith(".ts") || SKIP_FILES.has(name)) { continue; }
  const text = readFileSync(join(sourceRoot, name), "utf8");
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const calleeName = ts.isIdentifier(callee) ? callee.text
        : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      if (calleeName === "localized" && node.arguments.length >= 2) {
        const key = keyOf(node.arguments[0]);
        if (key === null) { skipped.nonLiteralLocalized += 1; }
        add(key, "localized", name, keyOf(node.arguments[1]) ?? undefined);
      } else if (calleeName === "setAttribute" && node.arguments.length === 2
        && ts.isStringLiteral(node.arguments[0]) && TEXT_ATTRIBUTES.has(node.arguments[0].text)) {
        for (const value of literalTexts(node.arguments[1])) { add(value, "attribute", name); }
      } else if ((calleeName === "element" || calleeName === "button") && node.arguments.length >= 1) {
        // The element helpers: element(tag, className, text) and button(text, variant).
        const textArgument = calleeName === "element" ? node.arguments[2] : node.arguments[0];
        if (textArgument !== undefined) {
          for (const value of literalTexts(textArgument)) { add(value, "text", name); }
        }
      }
    } else if (name === "dutch-ui-copy.ts" && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && (node.name.text === "exact" || node.name.text === "phrases") && node.initializer !== undefined) {
      // The Dutch page translator's own dictionary: English-only page text with its Dutch.
      const pairs = ts.isObjectLiteralExpression(node.initializer)
        ? node.initializer.properties.filter(ts.isPropertyAssignment)
          .map((property) => [keyOf(property.name), keyOf(property.initializer)])
        : ts.isArrayLiteralExpression(node.initializer)
          ? node.initializer.elements.filter(ts.isArrayLiteralExpression)
            .map((pair) => [keyOf(pair.elements[0]), keyOf(pair.elements[1])])
          : [];
      for (const [english, dutch] of pairs) { add(english?.trim() ?? null, "dutch-copy", name, dutch ?? undefined); }
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left) && TEXT_PROPERTIES.has(node.left.name.text)) {
      for (const value of literalTexts(node.right)) { add(value, "text", name); }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

// Texts the page still showed in English (crawl_web_leftovers.mjs), already normalised to keys.
const crawledPath = join(repositoryRoot, "apps", "timetrials-web", "i18n", "messages.crawled.json");
try {
  for (const entry of JSON.parse(readFileSync(crawledPath, "utf8")).messages) {
    const existing = messages.get(entry.key);
    if (existing) { existing.kinds.add("crawl"); continue; }
    messages.set(entry.key, { key: entry.key, nl: undefined, kinds: new Set(["crawl"]), places: new Set(["crawl"]) });
  }
} catch { /* no crawl yet */ }

const entries = [...messages.values()]
  .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
  .map((entry) => ({
    key: entry.key,
    ...(entry.nl === undefined ? {} : { nl: entry.nl }),
    kinds: [...entry.kinds].sort(),
    places: [...entry.places].sort(),
  }));
const output = `${JSON.stringify({
  schemaVersion: "mk8dx.web-message-source.v1",
  generatedBy: "tooling/i18n/extract_web_messages.mjs",
  messages: entries,
}, null, 1)}\n`;
if (process.argv.includes("--check")) {
  // CI: the committed message source must match the code, or the catalog test checks stale keys.
  const committed = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "";
  if (committed !== output) {
    console.error(`${relative(repositoryRoot, outputPath)} is out of date: run node tooling/i18n/extract_web_messages.mjs`);
    process.exit(1);
  }
  console.log(JSON.stringify({ upToDate: relative(repositoryRoot, outputPath), messages: entries.length }));
  process.exit(0);
}
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, output, "utf8");
console.log(JSON.stringify({
  messages: entries.length,
  localized: entries.filter((entry) => entry.kinds.includes("localized")).length,
  englishOnly: entries.filter((entry) => !entry.kinds.includes("localized")).length,
  templates: entries.filter((entry) => /\{\d+\}/.test(entry.key)).length,
  ...skipped,
  output: relative(repositoryRoot, outputPath),
}));
