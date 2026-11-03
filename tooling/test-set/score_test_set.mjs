// Score the public test set (packages/assets/test-set) with the browser scanner's own saved-photo route (scanBlob):
// every frame's times and the five kart fields per owner are compared with labels.json. Exit 0 only when every
// frame matches; the per-frame report is written to --output (default: a file next to nothing in the repository).
//
//   npm ci --ignore-scripts --prefix apps/timetrials-scanner-web
//   npm run sync-assets --prefix apps/timetrials-scanner-web
//   npx --prefix apps/timetrials-scanner-web playwright install chromium
//   node tooling/test-set/score_test_set.mjs [--output <report.json>]
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const scannerRoot = join(root, "apps/timetrials-scanner-web");
const setRoot = join(root, "packages/assets/test-set");
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex > 0 ? process.argv[outputIndex + 1] : null;
const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex > 0 ? process.argv[onlyIndex + 1] : null;
const FIELDS = ["character", "kart", "wheel", "glider", "flag"];

const freePort = () => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolvePort(port)); });
});

async function startDevServer() {
  const port = await freePort();
  const child = spawn(process.execPath, [join(scannerRoot, "node_modules/vite/bin/vite.js"), "--port", String(port), "--strictPort", "--host", "127.0.0.1"],
    { cwd: scannerRoot, stdio: ["ignore", "ignore", "inherit"] });
  const base = `http://127.0.0.1:${port}`;
  for (const deadline = Date.now() + 120_000; Date.now() < deadline;) {
    try { if ((await fetch(`${base}/cvtest.html`)).ok) { return { base, child }; } } catch { /* starting */ }
    if (child.exitCode !== null) { throw new Error(`the scanner dev server exited with ${child.exitCode}`); }
    await new Promise((done) => setTimeout(done, 500));
  }
  child.kill();
  throw new Error("the scanner dev server did not start within 120 s");
}

/** A label names either a colour variant (`glider_variant.super_glider.007_green`) or only the item
 * (`glider.super_glider`, as the Clean Assets staff records do); an item label accepts every variant of that item. */
function sameItem(label, reading) {
  if (reading === label) { return true; }
  const [kind, item] = label.split(".");
  return typeof reading === "string" && !kind.endsWith("_variant") && reading.startsWith(`${kind}_variant.${item}.`);
}

const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;

/** The expected readout of one record, in the scanner's field names. */
function expected(record) {
  if (record.kind === "ghost_select_panel") {
    const times = { ghost_total: clock(record.totalMs) };
    record.lapTimesMs.forEach((lap, index) => { times[`ghost_lap_${index + 1}`] = clock(lap); });
    return { layout: "ghost_detail", times, identities: record.identities };
  }
  return { layout: "endscreen", times: record.times, identities: record.identities };
}

const labels = JSON.parse(await readFile(join(setRoot, "labels.json"), "utf8"));
const require = createRequire(join(scannerRoot, "package.json"));
const { chromium } = require("@playwright/test");
const server = await startDevServer();
const report = [];
try {
  // A fresh browser per frame: a closed page does not hand its WebAssembly memory back soon enough, and after a few
  // full-size frames the next scanner worker fails to start.
  const openScanner = async (browser) => {
    const page = await browser.newPage();
    if (process.env.MK8DX_TEST_SET_DEBUG) { page.on("console", (message) => console.error(`  [page] ${message.text()}`)); page.on("pageerror", (error) => console.error(`  [page error] ${error}`)); }
    await page.goto(`${server.base}/cvtest.html`, { waitUntil: "load" });
    await page.evaluate(async () => {
      const { defaultEngineConfig } = await import("/src/app/engineClient.ts");
      const config = defaultEngineConfig("wasm", true, 4);
      const worker = new Worker("/src/worker.ts", { type: "module" });
      const pending = new Map();
      worker.onerror = (event) => console.error(`worker error: ${event.message ?? event}`);
      worker.onmessage = (event) => {
        const message = event.data;
        const waiter = pending.get(message.type === "ready" ? 0 : message.id ?? 0);
        if (message.type === "error") { waiter?.reject(new Error(message.message)); } else if (["ready", "done"].includes(message.type)) { waiter?.resolve(message); }
      };
      window.__request = (id, value) => new Promise((resolveRequest, reject) => { pending.set(id, { resolve: resolveRequest, reject }); worker.postMessage(value); });
      window.__config = config;
      await window.__request(0, { type: "init", config });
    });
    return page;
  };
  let id = 1;
  for (const record of labels.records.filter((entry) => only === null || entry.file === only)) {
    const want = expected(record);
    const bytes = await readFile(join(setRoot, record.file));
    const browser = await chromium.launch({ headless: true });
    let timer;
    const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${record.file}: no reading within 180 s`)), 180_000); });
    const page = await Promise.race([openScanner(browser), limit]);
    const got = await Promise.race([limit, page.evaluate(async ({ b64, requestId, layout }) => {
      const data = Uint8Array.from(atob(b64), (character) => character.charCodeAt(0));
      const message = await window.__request(requestId, { type: "scanBlob", id: requestId, blob: new Blob([data]), layout, copies: 1, config: window.__config });
      const frame = message.result.frames[0];
      // Tyres and flags are read as positions in the staged field index; the scanner hands the website their catalog
      // IDs through the same table (src/app/ecosystem.ts idTableFromFieldIndex, ADR-0215).
      const index = await (await fetch("/shared-icon/field-index.json")).json();
      const byPosition = (map) => Object.fromEntries(Object.entries(map ?? {}).map(([catalogId, position]) => [position, catalogId]));
      const positions = { wheel: byPosition(index.tires), flag: byPosition(index.flags) };
      const idOf = (field, entry) => entry?.id ?? (Number.isInteger(entry?.index) ? positions[field]?.[entry.index] ?? null : null);
      return {
        status: frame.status, fields: frame.fields ?? {},
        owners: Object.fromEntries(Object.entries(frame.kartConfig?.owners ?? {}).map(([owner, decided]) => [owner,
          Object.fromEntries(["character", "kart", "wheel", "glider", "flag"].map((field) => [field, idOf(field, decided?.[field])]))])),
      };
    }, { b64: bytes.toString("base64"), requestId: id, layout: want.layout })]).finally(() => clearTimeout(timer));
    await browser.close();
    id += 1;
    const timeMisses = Object.entries(want.times).filter(([field, value]) => got.fields[field] !== value).map(([field]) => field);
    const fieldMisses = Object.entries(want.identities).flatMap(([owner, fields]) => FIELDS
      .filter((field) => fields[field] !== undefined && !sameItem(fields[field], got.owners[owner]?.[field])).map((field) => `${owner}.${field}`));
    const pass = timeMisses.length === 0 && fieldMisses.length === 0;
    if (process.env.MK8DX_TEST_SET_DEBUG) { console.error(JSON.stringify(got.owners)); }
    report.push({ file: record.file, pass, status: got.status, timeMisses, fieldMisses });
    console.log(`${pass ? "PASS" : "FAIL"}  ${record.file}${pass ? "" : `  times: ${timeMisses.join(",") || "-"}  fields: ${fieldMisses.join(",") || "-"}`}`);
  }
} finally {
  server.child.kill();
}
if (outputPath) { await writeFile(outputPath, `${JSON.stringify(report, null, 1)}\n`, "utf8"); }
const passed = report.filter((entry) => entry.pass).length;
console.log(`${passed}/${report.length} frames match their labels`);
process.exit(passed === report.length ? 0 : 1);
