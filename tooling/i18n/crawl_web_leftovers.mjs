// Find English text that a catalog language still shows, by crawling the web product in Japanese, where any
// Latin-script sentence is untranslated English (brand and game names excepted by the catalog's game names).
//
//   node tooling/i18n/crawl_web_leftovers.mjs --base http://127.0.0.1:65260 [--session <profile-switch-url>]
//        [--admin-session <url>] [--language ja]
//
// Visits every route of the responsive gate (signed in when a session link is given, Administration with the
// admin link), collects visible English texts and placeholder/title/aria-label attributes, and merges them into
// apps/timetrials-web/i18n/messages.crawled.json, which extract_web_messages.mjs adds to the source. Run on the QA
// mirror after a catalog build; translate what it adds; repeat until it adds nothing.
// The QA mirror shows real community data, so only normalised keys are stored - numbers and @handles become {0},
// {1}, ... and no raw page text is kept. Review the added keys for display names before committing the file.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../..");
const require = createRequire(join(repositoryRoot, "backend", "api", "package.json"));
const playwright = require("playwright");
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) { options.set(process.argv[index], process.argv[index + 1]); }
const base = options.get("--base") ?? "http://127.0.0.1:65260";
const language = options.get("--language") ?? "ja";
const ROUTES = [
  "/", "/?post=1", "/?leaderboard=track.mario_kart_stadium&mode=150", "/?ranking=timetrials",
  "/?ranking=timetrials&tab=tracks&scope=all", "/?ranking=tournament", "/?records=1", "/?build=1", "/?community=1",
  "/?activity=1", "/?tournaments=1", "/?tournaments=1&stats=open", "/?apps=1", "/?player=player.bas",
  "/?player=player.bas&tab=timetrials", "/?player=player.bas&tab=mastery", "/?compare=player.bas,player.matthijs",
  "/?settings=1", "/?notifications=1", "/?mystats=1", "/?welcome=1",
];
const ADMIN_ROUTES = ["/?admin=overview", "/?admin=claims", "/?admin=tournaments", "/?admin=time-trials", "/?admin=rating"];
const target = join(repositoryRoot, "apps", "timetrials-web", "i18n", "messages.crawled.json");
const known = existsSync(target) ? JSON.parse(readFileSync(target, "utf8")).messages : [];
const found = new Map(known.map((entry) => [entry.key, entry]));
const before = found.size;

async function crawl(session, routes) {
  const browser = await playwright.chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  if (session) { await page.goto(session); await page.waitForLoadState("networkidle"); }
  for (const route of routes) {
    await page.goto(`${base}${route}${route.includes("?") ? "&" : "?"}lang=${language}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1200);
    const texts = await page.evaluate(() => {
      const values = new Set();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.parentElement?.closest("script, style, textarea, [data-no-translate]")) continue;
        values.add((node.nodeValue || "").trim());
      }
      for (const element of document.querySelectorAll("[placeholder], [title], [aria-label]")) {
        for (const name of ["placeholder", "title", "aria-label"]) {
          const value = element.getAttribute(name);
          if (value) values.add(value.trim());
        }
      }
      return [...values];
    });
    for (const text of texts) {
      // English sentences and labels: Latin letters, at least one space or a capitalised word of 4+ letters.
      if (!/[A-Za-z]{2,}/.test(text) || /[぀-ヿ一-鿿]/.test(text)) continue;
      if (!(/ [A-Za-z]/.test(text) || /^[A-Z][a-z]{3,}$/.test(text))) continue;
      if (text.length > 300 || /^https?:/.test(text)) continue;
      let slot = 0;
      const key = text.replace(/@[A-Za-z0-9_.-]+|\d+(?:[.,:]\d+)*/g, (match) => (match.startsWith("@") ? `@{${slot++}}` : `{${slot++}}`));
      if (!found.has(key)) found.set(key, { key, kinds: ["crawl"], places: [route] });
    }
  }
  await browser.close();
}

await crawl(options.get("--session"), ROUTES);
if (options.get("--admin-session")) { await crawl(options.get("--admin-session"), ADMIN_ROUTES); }
const messages = [...found.values()].sort((left, right) => (left.key < right.key ? -1 : 1));
writeFileSync(target, `${JSON.stringify({
  schemaVersion: "mk8dx.web-message-crawl.v1",
  generatedBy: "tooling/i18n/crawl_web_leftovers.mjs",
  note: "English texts a catalog language still showed on the page; game and brand names stay English on purpose.",
  messages,
}, null, 1)}\n`, "utf8");
console.log(JSON.stringify({ added: messages.length - before, total: messages.length }));
