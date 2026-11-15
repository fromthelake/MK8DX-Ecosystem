// Build the illustrated A2 guide as one self-contained HTML file and one PDF per language.
//
//   node tooling/build_guide_bundle.mjs --output <folder>            # all 15 languages, HTML + PDF
//   node tooling/build_guide_bundle.mjs --output <folder> --only en,nl,ja --html-only
//
// Source: the committed pages docs/install/guide/<lang>.html (made by tooling/build_guide_html.py) with
// guide.css, guide.js and the screenshots in docs/install/guide/img. The bundle inlines all of them (the
// images as data: URIs), so MK8DX_Guide_<lang>.html opens anywhere without other files and without
// internet. The language switcher points at the same file of the other language in the latest release.
// MK8DX_Guide_<lang>.pdf is that page printed by Playwright's Chromium: every computer and device, every
// chapter open, light colours, A4 with page numbers. Japanese, Korean and Chinese need CJK fonts on the
// build machine (Windows has them; on Ubuntu install fonts-noto-cjk); the build fails when a printed CJK
// page falls back to boxes ("tofu"), measured by comparing glyph widths against a missing-glyph probe.
//
// The release workflow attaches the files under version-less names, so
// https://github.com/fromthelake/MK8DX-Ecosystem/releases/latest/download/MK8DX_Guide_en.pdf always works.
// The bundles are generated, not committed: their sources are committed and reviewed.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const guide = join(root, "docs", "install", "guide");
const RELEASE = "https://github.com/fromthelake/MK8DX-Ecosystem/releases/latest/download";
const CJK = new Set(["ja", "ko", "zh-CN", "zh-TW"]);

function parseArgs(argv) {
  const options = { output: null, only: null, htmlOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--output") options.output = resolve(argv[++index]);
    else if (name === "--only") options.only = argv[++index].split(",").map((value) => value.trim()).filter(Boolean);
    else if (name === "--html-only") options.htmlOnly = true;
    else throw new Error(`Unknown option ${name} (use --output <folder> [--only en,nl] [--html-only])`);
  }
  if (!options.output) throw new Error("Give --output <folder>");
  return options;
}

export function languages() {
  return readdirSync(guide).filter((name) => /^[a-z]{2}(-[A-Za-z0-9]+)?\.html$/.test(name))
    .map((name) => name.slice(0, -".html".length)).sort();
}

function dataUri(relative) {
  const path = join(guide, relative);
  if (!existsSync(path)) throw new Error(`The guide refers to a missing file: docs/install/guide/${relative}`);
  const type = relative.endsWith(".png") ? "image/png" : relative.endsWith(".jpg") ? "image/jpeg" : null;
  if (!type) throw new Error(`Unsupported guide asset ${relative}`);
  return `data:${type};base64,${readFileSync(path).toString("base64")}`;
}

/** The page of one language with its stylesheet, script and images inside the file. */
export function bundle(lang, codes = languages()) {
  let page = readFileSync(join(guide, `${lang}.html`), "utf8");
  const css = readFileSync(join(guide, "guide.css"), "utf8");
  const js = readFileSync(join(guide, "guide.js"), "utf8");
  if (/<\/(style|script)/i.test(css + js)) throw new Error("guide.css or guide.js cannot be inlined safely");
  const replaceOnce = (from, to) => {
    if (!page.includes(from)) throw new Error(`${lang}.html no longer contains ${from}`);
    page = page.replace(from, () => to);
  };
  replaceOnce('<link rel="stylesheet" href="guide.css">', `<style>\n${css}</style>`);
  replaceOnce('<script src="guide.js" defer></script>', `<script>\n${js}</script>`);
  page = page.replace(/(src|href)="(img\/[^"]+)"/g, (_, attribute, relative) => `${attribute}="${dataUri(relative)}"`);
  const pattern = new RegExp(`href="(${codes.map((code) => code.replace(/[-]/g, "\\-")).join("|")})\\.html"`, "g");
  page = page.replace(pattern, (_, code) => `href="${RELEASE}/MK8DX_Guide_${code}.html"`);
  const leftover = page.match(/(?:src|href)="(?!data:|https:|#)[^"]*"/);
  if (leftover) throw new Error(`${lang}.html still refers to a local file: ${leftover[0]}`);
  return page;
}

async function printPdf(browser, htmlPath, pdfPath, lang) {
  const context = await browser.newContext({ colorScheme: "light", locale: lang });
  const page = await context.newPage();
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
  await page.evaluate(() => {
    document.querySelector('[data-os="all"]')?.click();
    document.querySelector('[data-device="all"]')?.click();
    document.querySelectorAll("details").forEach((element) => { element.open = true; });
    document.querySelectorAll("img").forEach((image) => { image.loading = "eager"; });
  });
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0));
  await page.evaluate(() => document.fonts.ready);
  if (CJK.has(lang)) {
    // A glyph the fonts lack is drawn as the same box for every character; real CJK glyphs differ.
    // A character the fonts lack is drawn exactly like an unassigned code point (a box, or nothing).
    const result = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 48; canvas.height = 48;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.font = `40px ${getComputedStyle(document.body).fontFamily}`;
      const bitmap = (character) => {
        context.clearRect(0, 0, 48, 48);
        context.fillText(character, 2, 40);
        return Array.from(context.getImageData(0, 0, 48, 48).data).join(",");
      };
      const missing = bitmap("\u{E0FFF}");
      const text = Array.from(new Set((document.querySelector("main") || document.body).innerText
        .match(/[぀-ヿ㐀-鿿가-힯]/g) || [])).slice(0, 200);
      const boxes = text.filter((character) => bitmap(character) === missing).length;
      return { characters: text.length, boxes };
    });
    if (result.characters < 50) throw new Error(`${lang}: too little CJK text found (${result.characters})`);
    if (result.boxes > 0) {
      throw new Error(`${lang}: ${result.boxes} of ${result.characters} CJK characters have no font; install CJK fonts (fonts-noto-cjk)`);
    }
  }
  await page.emulateMedia({ media: "print", colorScheme: "light" });
  await page.pdf({
    path: pdfPath, format: "A4", printBackground: true, preferCSSPageSize: false,
    margin: { top: "16mm", bottom: "18mm", left: "14mm", right: "14mm" },
    displayHeaderFooter: true, headerTemplate: "<span></span>",
    footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#666">MK8DX — <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  });
  await context.close();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const all = languages();
  const chosen = options.only ?? all;
  for (const lang of chosen) if (!all.includes(lang)) throw new Error(`No guide page docs/install/guide/${lang}.html`);
  mkdirSync(options.output, { recursive: true });
  let browser = null;
  if (!options.htmlOnly) {
    const require = createRequire(join(root, "backend", "api", "package.json"));
    browser = await require("playwright").chromium.launch();
  }
  try {
    for (const lang of chosen) {
      const htmlPath = join(options.output, `MK8DX_Guide_${lang}.html`);
      writeFileSync(htmlPath, bundle(lang, all), "utf8");
      if (browser) await printPdf(browser, htmlPath, join(options.output, `MK8DX_Guide_${lang}.pdf`), lang);
      console.log(`MK8DX_Guide_${lang}${browser ? ".html + .pdf" : ".html"}`);
    }
  } finally {
    if (browser) await browser.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message || error); process.exit(1); });
}
