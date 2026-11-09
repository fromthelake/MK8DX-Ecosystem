// Browser regression for the standalone classic report editor's HTML and CSS
// boundaries. The final three boot calls need the full QA application, so this
// runs the actual source declarations in an otherwise empty document.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(repositoryRoot, "backend/api/package.json"));
const { chromium } = require("playwright");
const source = readFileSync(resolve(repositoryRoot, "apps/timetrials-web/styles/classic-report-export.js"), "utf8");
const boot = source.lastIndexOf("\nbind();");
assert.ok(boot > 0, "classic export boot boundary missing");

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><body data-analytics-view='classic'></body></html>");
  await page.addScriptTag({ content: source.slice(0, boot) });
  const result = await page.evaluate(() => {
    const html = sanitizeClientEditableHtml(
      '<p><font color="#2563eb" face="Georgia" size="5">Safe</font> <strong>bold</strong> ' +
      '<a href="https://example.test">link</a><a href="javascript:alert(1)">bad</a></p>' +
      '<script >window.__classicXss=1</script ><svg onload="window.__classicXss=2"></svg>' +
      '<img src=x onerror="window.__classicXss=3">' +
      '<p onclick="window.__classicXss=4" style="text-align:center;background-image:url(javascript:alert(1))">After</p>',
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    return {
      safeText: host.textContent.includes("Safe bold linkbad") && host.textContent.includes("After"),
      formatting: host.querySelector("strong") !== null && host.querySelector("span[style*='Georgia']") !== null,
      safeLink: host.querySelector('a[href="https://example.test"][rel="noopener"]') !== null,
      activeElements: host.querySelectorAll("script,style,svg,iframe,object,embed,img").length,
      eventHandlers: host.querySelectorAll("[onclick],[onload],[onerror]").length,
      unsafeLinks: host.querySelectorAll('a[href^="javascript:"]').length,
      unsafeStyles: host.querySelectorAll('[style*="url("]').length,
      executed: window.__classicXss ?? 0,
      rejectedCssUrl: safeCssImageUrl("/assets/x');color:red") === "",
      retainedCssUrl: safeCssImageUrl("/assets/images/tracks/000.png") === "/assets/images/tracks/000.png",
    };
  });
  assert.deepEqual(result, {
    safeText: true, formatting: true, safeLink: true, activeElements: 0,
    eventHandlers: 0, unsafeLinks: 0, unsafeStyles: 0, executed: 0,
    rejectedCssUrl: true, retainedCssUrl: true,
  });
  console.log(`classic export sanitizer: Chromium ${browser.version()}, malicious markup removed, formatting retained`);
} finally {
  await browser.close();
}
