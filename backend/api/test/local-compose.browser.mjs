import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.MK8DX_TEST_ORIGIN;
if (origin === undefined || !/^http:\/\/(?:127\.0\.0\.1|localhost):[0-9]{2,5}$/.test(origin)) {
  throw new Error("MK8DX_TEST_ORIGIN must be an exact local HTTP origin");
}

const browser = await chromium.launch({ channel: process.env.MK8DX_TEST_BROWSER_CHANNEL ?? "msedge", headless: true });
const routes = ["/", "/?cups=1", "/?tournaments=1", "/?signin=1"];
const widths = [320, 375, 768, 1440];
const errors = [];
try {
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 850 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(`${width}: ${error.name}`));
    for (const route of routes) {
      const response = await page.goto(origin + route, { waitUntil: "networkidle" });
      assert.equal(response?.status(), 200, `${route} at ${width}`);
      assert.match(await page.title(), /MK8DX Time Trials/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false, `${route} overflows at ${width}`);
      assert.ok((await page.locator("main").count()) > 0, `${route} has no main content`);
    }
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "NL", exact: true }).click();
    assert.equal(await page.locator("html").getAttribute("lang"), "nl");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ routes: routes.length, widths, languages: ["en", "nl"], pageErrors: 0 }));
} finally {
  await browser.close();
}
