// Record what the browser scanner's icon crop search (cleanAssets.ts identifyCropSearch, called by
// kartConfig.ts matchCard) sees and decides on the public test set (packages/assets/test-set), so the
// Python reference (python/mk8dx_icon_matcher/crop_search.py) can be compared with the product on real
// frames (issue #99, phase 3). The scanner runs unchanged: a wrapper around its worker records the
// canonical card frame handed to matchCard and every identifyCropSearch call with its result.
//
// The capture holds canonical frames of the public test set. It is a working file: keep it outside the
// repository. tools/generate_crop_search_vectors.py turns it into vectors that hold numbers only.
//
//   npm ci --ignore-scripts --prefix apps/timetrials-scanner-web
//   npm run sync-assets --prefix apps/timetrials-scanner-web
//   npx --prefix apps/timetrials-scanner-web playwright install chromium
//   node packages/icon-matcher/tools/capture_crop_search_web.mjs <capture.json.gz> [--only <file>]
import { spawn } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const scannerRoot = join(root, 'apps/timetrials-scanner-web');
const setRoot = join(root, 'packages/assets/test-set');
const outputPath = process.argv[2];
if (!outputPath || outputPath.startsWith('--')) throw new Error('usage: capture_crop_search_web.mjs <capture.json.gz> [--only <file>]');
if (resolve(outputPath).startsWith(root)) throw new Error('write the capture outside the repository');
const onlyIndex = process.argv.indexOf('--only');
const only = onlyIndex > 0 ? process.argv[onlyIndex + 1] : null;

// A temporary worker entry (deleted afterwards) loads this before the scanner's own worker module: it wraps
// the two methods, nothing else.
const ENTRY = '__crop_search_capture_worker.ts';
const PATCH_MODULE = '__crop_search_capture_patch.ts';
const PATCH = `// @ts-nocheck
import { CleanAssetsMatcher } from './engine/cleanAssets';
import { KartConfigMatcher } from './engine/kartConfig';
let card = null;
let counter = 0;
const FIELDS = ['character', 'kart', 'glider'];
const keep = (entry) => entry ? {
  id: entry.id ?? null, ok: entry.ok ?? null, reason: entry.reason ?? null, score: entry.score ?? null,
  margin: entry.margin ?? null, margin_ext: entry.margin_ext ?? null, top3: entry.top3 ?? null,
  scale: entry.scale ?? null, dx: entry.dx ?? null, dy: entry.dy ?? null, slot_xywh: entry.slot_xywh ?? null,
  match_xywh: entry.match_xywh ?? null, shared_crop_xywh: entry.shared_icon_qa?.crop_xywh ?? null,
} : null;
const matchCard = KartConfigMatcher.prototype.matchCard;
KartConfigMatcher.prototype.matchCard = async function (canonical, physOwner, raceKey, anchorXY, yellowCard, ...rest) {
  const outer = card;
  card = { canonical, calls: [] };
  const record = { id: ++counter, owner: physOwner, raceKey, yellowCard: !!yellowCard, cols: canonical.cols,
    rows: canonical.rows, channels: canonical.channels(), pixels: canonical.data.slice() };
  try {
    const out = await matchCard.call(this, canonical, physOwner, raceKey, anchorXY, yellowCard, ...rest);
    self.postMessage({ type: 'cropSearchCapture', card: { ...record, calls: card.calls,
      fields: Object.fromEntries(FIELDS.map((field) => [field, keep(out?.[field])])) } });
    return out;
  } finally {
    card = outer;
  }
};
const search = CleanAssetsMatcher.prototype.identifyCropSearch;
CleanAssetsMatcher.prototype.identifyCropSearch = function (imageBgr, bx, by, bw, bh, groupName, subsetIds, searchPx, topk, rawRgb = false, achromaticGap = false) {
  const result = search.apply(this, arguments);
  if (card) {
    card.calls.push({ onCanonical: imageBgr === card.canonical, cols: imageBgr.cols, rows: imageBgr.rows,
      box: [bx, by, bw, bh], group: groupName, subset: subsetIds ? [...subsetIds] : null, search: searchPx, topk,
      rawRgb: !!rawRgb, achromaticGap: !!achromaticGap,
      result: { id: result.id ?? null, family: result.family ?? null, score: result.score ?? null, margin: result.margin ?? null,
        margin_ext: result.margin_ext ?? null, top3: result.top3 ?? null, dx: result.dx ?? 0, dy: result.dy ?? 0 } });
  }
  return result;
};
`;

const freePort = () => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolvePort(port)); });
});

async function startDevServer() {
  const port = await freePort();
  const child = spawn(process.execPath, [join(scannerRoot, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: scannerRoot, stdio: ['ignore', 'ignore', 'inherit'] });
  const base = `http://127.0.0.1:${port}`;
  for (const deadline = Date.now() + 120_000; Date.now() < deadline;) {
    try { if ((await fetch(`${base}/cvtest.html`)).ok) return { base, child }; } catch { /* starting */ }
    if (child.exitCode !== null) throw new Error(`the scanner dev server exited with ${child.exitCode}`);
    await new Promise((done) => setTimeout(done, 500));
  }
  child.kill();
  throw new Error('the scanner dev server did not start within 120 s');
}

const labels = JSON.parse(await readFile(join(setRoot, 'labels.json'), 'utf8'));
const require = createRequire(join(scannerRoot, 'package.json'));
const { chromium } = require('@playwright/test');
await writeFile(join(scannerRoot, 'src', PATCH_MODULE), PATCH);
await writeFile(join(scannerRoot, 'src', ENTRY), `import './${PATCH_MODULE.replace('.ts', '')}';\nimport './worker';\n`);
const server = await startDevServer();
const frames = [];
try {
  let id = 1;
  for (const record of labels.records.filter((entry) => only === null || entry.file === only)) {
    const layout = record.kind === 'ghost_select_panel' ? 'ghost_detail' : 'endscreen';
    const bytes = await readFile(join(setRoot, record.file));
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      if (process.env.MK8DX_CAPTURE_DEBUG) {
        page.on('console', (message) => console.error(`  [page] ${message.text()}`));
        page.on('pageerror', (error) => console.error(`  [page error] ${error}`));
        page.on('worker', (worker) => console.error(`  [worker] ${worker.url()}`));
      }
      page.setDefaultTimeout(300_000);
      await page.goto(`${server.base}/cvtest.html`, { waitUntil: 'load' });
      const cards = await page.evaluate(async ({ b64, requestId, layout: frameLayout, entry }) => {
        const { defaultEngineConfig } = await import('/src/app/engineClient.ts');
        const config = defaultEngineConfig('wasm', true, 4);
        const worker = new Worker(`/src/${entry}`, { type: 'module' });
        const pending = new Map();
        const captured = [];
        worker.onmessage = (event) => {
          const message = event.data;
          if (message.type === 'cropSearchCapture') { captured.push(message.card); return; }
          const waiter = pending.get(message.type === 'ready' ? 0 : message.id ?? 0);
          if (message.type === 'error') waiter?.reject(new Error(message.message));
          else if (['ready', 'done'].includes(message.type)) waiter?.resolve(message);
        };
        const request = (key, value) => new Promise((done, fail) => { pending.set(key, { resolve: done, reject: fail }); worker.postMessage(value); });
        await request(0, { type: 'init', config });
        const data = Uint8Array.from(atob(b64), (character) => character.charCodeAt(0));
        await request(requestId, { type: 'scanBlob', id: requestId, blob: new Blob([data]), layout: frameLayout, copies: 1, config });
        const toB64 = (pixels) => { let s = ''; for (let i = 0; i < pixels.length; i += 0x8000) s += String.fromCharCode(...pixels.subarray(i, i + 0x8000)); return btoa(s); };
        return captured.map((card) => ({ ...card, pixels: toB64(card.pixels) }));
      }, { b64: bytes.toString('base64'), requestId: id, layout, entry: ENTRY });
      if (!cards.length) throw new Error(`${record.file}: the capture wrapper recorded no card`);
      frames.push({ file: record.file, layout, cards });
      console.log(`${record.file}: ${cards.length} card(s), ${cards.reduce((n, card) => n + card.calls.length, 0)} crop searches`);
    } finally {
      await browser.close();
    }
    id += 1;
  }
} finally {
  server.child.kill();
  await rm(join(scannerRoot, 'src', ENTRY), { force: true });
  await rm(join(scannerRoot, 'src', PATCH_MODULE), { force: true });
}
await writeFile(outputPath, gzipSync(JSON.stringify({ schema: 'mk8dx.crop-search-web-capture.v1', frames })));
console.log(`wrote ${frames.length} frame(s) to ${outputPath}`);
