// Record the canonical card geometry before the crop (issue #99, phase 5): what the browser scanner's
// pipeline.ts computes between the card quad and the 1280x720 canonical card on the public test set
// (packages/assets/test-set). The scanner runs unchanged: a wrapper around its worker records the
// OpenCV calls of stages 17 and 18 (getPerspectiveTransform, gemm, warpPerspective) with their numbers.
// No pixels are recorded. tools/generate_canonical_warp_vectors.py turns the capture into vectors.
//
//   npm ci --ignore-scripts --prefix apps/timetrials-scanner-web
//   npm run sync-assets --prefix apps/timetrials-scanner-web
//   npx --prefix apps/timetrials-scanner-web playwright install chromium
//   node packages/icon-matcher/tools/capture_canonical_warp_web.mjs <capture.json> [--only <file>]
import { spawn } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const scannerRoot = join(root, 'apps/timetrials-scanner-web');
const setRoot = join(root, 'packages/assets/test-set');
const outputPath = process.argv[2];
if (!outputPath || outputPath.startsWith('--')) throw new Error('usage: capture_canonical_warp_web.mjs <capture.json> [--only <file>]');
if (resolve(outputPath).startsWith(root)) throw new Error('write the capture outside the repository');
const onlyIndex = process.argv.indexOf('--only');
const only = onlyIndex > 0 ? process.argv[onlyIndex + 1] : null;

// A temporary worker entry (deleted afterwards) loads this before the scanner's own worker module: once
// OpenCV.js is up it wraps three of its functions, nothing else.
const ENTRY = '__canonical_warp_capture_worker.ts';
const PATCH_MODULE = '__canonical_warp_capture_patch.ts';
const PATCH = `// @ts-nocheck
const calls = [];
const numbers = (mat) => mat ? Array.from(mat.type() === 6 ? mat.data64F : mat.data32F) : null;
// embind looks overloaded functions up again by name (Module[name].overloadTable), so a wrapper carries the
// original's own properties.
const replace = (c, name, make) => { const original = c[name]; c[name] = Object.assign(make(original), original); };
const wrap = (c) => {
  replace(c, 'getPerspectiveTransform', (original) => function (src, dst) {
    const out = original.apply(this, arguments);
    calls.push({ fn: 'getPerspectiveTransform', src: numbers(src), dst: numbers(dst), out: numbers(out) });
    return out;
  });
  replace(c, 'gemm', (original) => function (a, b, alpha, d, beta, out) {
    const result = original.apply(this, arguments);
    if (a.rows === 3 && a.cols === 3 && b.rows === 3 && b.cols === 3) {
      calls.push({ fn: 'gemm', a: numbers(a), b: numbers(b), out: numbers(out) });
    }
    return result;
  });
  replace(c, 'warpPerspective', (original) => function (src, dst, m, size) {
    const result = original.apply(this, arguments);
    calls.push({ fn: 'warpPerspective', srcSize: [src.cols, src.rows], size: [size.width, size.height], m: numbers(m) });
    return result;
  });
};
const timer = setInterval(() => {
  const c = globalThis.cv;
  if (c && typeof c.Mat === 'function' && typeof c.gemm === 'function') { clearInterval(timer); wrap(c); console.log('canonical warp capture: OpenCV wrapped'); }
}, 1);
self.addEventListener('message', (event) => {
  if (event.data?.type === 'scanBlob') calls.length = 0;
});
const post = self.postMessage.bind(self);
let diagnostics = null;
self.postMessage = (message, ...rest) => {
  const d = message?.type === 'frame' ? message.result?.diagnostics : null;
  if (d) diagnostics = { status: message.result.status, quad: d.quad ?? null, seedUsed: d.seedUsed ?? null, antialiasFactor: d.antialiasFactor ?? null,
    yellowPosition: d.yellowPosition ?? null };
  if (message?.type === 'done') { post({ type: 'canonicalWarpCapture', calls: calls.splice(0), diagnostics }); diagnostics = null; }
  return post(message, ...rest);
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
          if (message.type === 'canonicalWarpCapture') { captured.push(message); return; }
          const waiter = pending.get(message.type === 'ready' ? 0 : message.id ?? 0);
          if (message.type === 'error') waiter?.reject(new Error(message.message));
          else if (['ready', 'done'].includes(message.type)) waiter?.resolve(message);
        };
        const request = (key, value) => new Promise((done, fail) => { pending.set(key, { resolve: done, reject: fail }); worker.postMessage(value); });
        await request(0, { type: 'init', config });
        const data = Uint8Array.from(atob(b64), (character) => character.charCodeAt(0));
        await request(requestId, { type: 'scanBlob', id: requestId, blob: new Blob([data]), layout: frameLayout, copies: 1, config });
        return captured;
      }, { b64: bytes.toString('base64'), requestId: id, layout, entry: ENTRY });
      if (cards.length !== 1) throw new Error(`${record.file}: the capture wrapper recorded ${cards.length} scans`);
      const [{ calls, diagnostics }] = cards;
      frames.push({ file: record.file, layout, kind: record.kind, calls, diagnostics });
      console.log(`${record.file}: ${calls.length} recorded calls, seed ${diagnostics.seedUsed}`);
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
await writeFile(outputPath, JSON.stringify({ schema: 'mk8dx.canonical-warp-web-capture.v1', frames }));
console.log(`wrote ${frames.length} frame(s) to ${outputPath}`);
