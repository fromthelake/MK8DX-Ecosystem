// Build the web product's language catalogs from the translations and Clean Assets game names.
//
//   node tooling/i18n/build_web_catalogs.mjs --clean-assets "<path to the Clean Assets database.json>" [--fill-missing]
//
// Inputs: apps/timetrials-web/i18n/messages.source.json (extract_web_messages.mjs) and
// apps/timetrials-web/i18n/translations/<language>.json ({ language, reviewed, messages: { english: text } }).
// fr-CA and es-419 fall back to fr and es where they have no own translation; game names always come from the
// region's own Clean Assets names. A translation may leave out a placeholder (an English plural suffix, say) but
// never name one the English does not have. Output: apps/timetrials-web/styles/i18n-<language>-<hash>.json and
// apps/timetrials-web/src/i18n-catalog-index.generated.ts. Prints the coverage per language.
// Every web source text needs an entry in each translation file, or that language shows it in English (the
// catalog test fails). --fill-missing adds the English text as a stand-in for the missing ones, to be translated
// later (the file stays reviewed: false).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const webRoot = join(repositoryRoot, "apps", "timetrials-web");
const options = new Map();
const FLAGS = new Set(["--fill-missing"]);
for (let index = 2; index < process.argv.length; index += 1) {
  const name = process.argv[index];
  if (FLAGS.has(name)) { options.set(name, true); continue; }
  options.set(name, process.argv[index + 1]);
  index += 1;
}
const databasePath = options.get("--clean-assets");
if (!databasePath) {
  throw new Error("Usage: build_web_catalogs.mjs --clean-assets <Clean Assets database.json> [--fill-missing]");
}
const fillMissing = options.get("--fill-missing") === true;

// Product language -> Clean Assets names locale; base translation for the regional variants.
export const LANGUAGES = {
  "en-US": { names: "en-US" },
  fr: { names: "fr-FR" }, "fr-CA": { names: "fr-CA", base: "fr" },
  de: { names: "de-DE" },
  es: { names: "es-ES" }, "es-419": { names: "es-419", base: "es" },
  it: { names: "it-IT" }, pt: { names: "pt-PT" }, ru: { names: "ru-RU" },
  ja: { names: "ja-JP" }, ko: { names: "ko-KR" }, "zh-CN": { names: "zh-CN" }, "zh-TW": { names: "zh-TW" },
};
const GAME_COLLECTIONS = ["cups", "tracks", "characters", "vehicleBodies", "vehicleTires", "vehicleGliders", "countries"];

const source = JSON.parse(readFileSync(join(webRoot, "i18n", "messages.source.json"), "utf8"));
const webKeys = new Set(source.messages.map((message) => message.key));
// The other products read the same catalog form from plain files: name, message source, catalog folder.
const PRODUCTS = [
  ["android", "apps/timetrials-android/i18n/messages.source.json", "apps/timetrials-android/app/src/main/assets/i18n"],
  ["livetrial", "apps/timetrials-desktop/i18n/messages.source.json", "apps/timetrials-desktop/dashboard/i18n"],
  ["tournamentLive", "apps/tournament-live/i18n/messages.source.json", "apps/tournament-live/src/live_processor/i18n"],
].map(([name, sourcePath, folder]) => ({
  name,
  keys: new Set(JSON.parse(readFileSync(join(repositoryRoot, sourcePath), "utf8")).messages.map((message) => message.key)),
  folder: join(repositoryRoot, folder),
}));
// One translation pipeline for every product: a translation counts when its English is a key of any.
const keys = new Set([...webKeys, ...PRODUCTS.flatMap((product) => [...product.keys])]);
const database = JSON.parse(readFileSync(databasePath, "utf8"));

function placeholders(text) {
  return new Set((text.match(/\{\d+\}/g) ?? []));
}

function readTranslation(language) {
  const path = join(webRoot, "i18n", "translations", `${language}.json`);
  if (!existsSync(path)) { return null; }
  const document = JSON.parse(readFileSync(path, "utf8"));
  if (document.language !== language) { throw new Error(`${path} is not for ${language}`); }
  return document;
}

function gameNames(namesLocale) {
  const names = {};
  for (const collection of GAME_COLLECTIONS) {
    for (const record of database.collections?.[collection] ?? []) {
      const target = record.names?.[namesLocale];
      if (!target) { continue; }
      for (const english of [record.names?.["en-US"], record.names?.["en-GB"]]) {
        if (english && english !== target) { names[english] = target; }
      }
    }
  }
  return names;
}

// Flat in styles/: the static-web loader (backend/api/src/runtime/static-web.ts) serves one directory level.
const outputDir = join(webRoot, "styles");
for (const stale of readdirSync(outputDir).filter((name) => /^i18n-.+\.json$/.test(name))) { rmSync(join(outputDir, stale)); }

for (const product of PRODUCTS) {
  mkdirSync(product.folder, { recursive: true });
  for (const stale of readdirSync(product.folder)) { rmSync(join(product.folder, stale)); }
}
const files = {};
const report = {};
const problems = [];
const filled = {};
// Web source texts a translation file lacks: a problem, or with --fill-missing an English stand-in.
for (const language of Object.keys(LANGUAGES)) {
  const document = readTranslation(language);
  if (!document) { continue; }
  const missing = [...webKeys].filter((english) => typeof document.messages?.[english] !== "string");
  if (missing.length === 0) { continue; }
  if (!fillMissing) {
    problems.push(`${language}: ${missing.length} source text(s) without translation, first ${JSON.stringify(missing[0])}; ` +
      `add them to i18n/translations/${language}.json or rerun with --fill-missing`);
    continue;
  }
  const messages = { ...document.messages };
  for (const english of missing) { messages[english] = english; }
  document.messages = Object.fromEntries(Object.entries(messages).sort(([left], [right]) => (left < right ? -1 : 1)));
  writeFileSync(join(webRoot, "i18n", "translations", `${language}.json`), `${JSON.stringify(document, null, 1)}\n`, "utf8");
  filled[language] = missing.length;
}
for (const [language, settings] of Object.entries(LANGUAGES)) {
  const own = readTranslation(language);
  const base = settings.base ? readTranslation(settings.base) : null;
  const messages = {};
  for (const document of [base, own]) {
    for (const [english, translated] of Object.entries(document?.messages ?? {})) {
      if (!keys.has(english) || typeof translated !== "string" || translated.trim().length === 0) { continue; }
      const allowed = placeholders(english);
      const unknown = [...placeholders(translated)].filter((placeholder) => !allowed.has(placeholder));
      if (unknown.length > 0) {
        problems.push(`${language}: ${JSON.stringify(english)} -> unknown ${unknown.join(", ")}`);
        continue;
      }
      messages[english] = translated;
    }
  }
  const sorted = Object.entries(messages).sort(([left], [right]) => (left < right ? -1 : 1));
  const names = gameNames(settings.names);
  const catalog = {
    schemaVersion: "mk8dx.web-message-catalog.v1",
    language,
    reviewed: own?.reviewed === true,
    messages: Object.fromEntries(sorted.filter(([english]) => webKeys.has(english))),
    gameNames: names,
  };
  const productCounts = {};
  for (const product of PRODUCTS) {
    const productMessages = sorted.filter(([english]) => product.keys.has(english));
    writeFileSync(join(product.folder, `${language}.json`),
      `${JSON.stringify({ ...catalog, messages: Object.fromEntries(productMessages) })}\n`, "utf8");
    productCounts[product.name] = `${productMessages.length}/${product.keys.size}`;
  }
  const text = `${JSON.stringify(catalog)}\n`;
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 10);
  const name = `i18n-${language}-${hash}.json`;
  writeFileSync(join(outputDir, name), text, "utf8");
  files[language] = `/styles/${name}`;
  report[language] = {
    web: `${Object.keys(catalog.messages).length}/${webKeys.size}`,
    ...productCounts,
    gameNames: Object.keys(names).length,
  };
}

writeFileSync(join(webRoot, "src", "i18n-catalog-index.generated.ts"), [
  "// Generated by tooling/i18n/build_web_catalogs.mjs. Do not edit.",
  "// Language -> catalog file (content-hashed, served from styles/).",
  "export const CATALOG_FILES: Readonly<Record<string, string>> = {",
  ...Object.entries(files).map(([language, file]) => `  ${JSON.stringify(language)}: ${JSON.stringify(file)},`),
  "};",
  "",
].join("\n"), "utf8");

console.log(JSON.stringify({ report, filledWithEnglish: filled, problems: problems.slice(0, 20), problemCount: problems.length }, null, 1));
if (problems.length > 0) { process.exitCode = 1; }
