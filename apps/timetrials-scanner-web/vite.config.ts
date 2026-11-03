import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
const webVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;
import { VitePWA } from 'vite-plugin-pwa';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// COOP/COEP: nodig voor SharedArrayBuffer => multi-threaded ORT-wasm.
// CORP: elk bestand op de eigen origin expliciet toelaten onder require-corp.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

// ONNX Runtime Web wasm-binaries en de Tesseract-core moeten van de eigen
// origin komen (offline/PWA-eis, geen CDN). Dit plugin kopieert ze bij de
// build naar dist/ort en dist/tess en serveert ze in dev vanuit node_modules.
// submap-hosting: MK8_BASE_PATH=/mk8dxscanner/ npx vite build --outDir deploy/mk8dxscanner
const basePath = (process.env.MK8_BASE_PATH ?? '/').replace(/\/?$/, '/');
let resolvedOutDir = path.join(here, 'dist');

function localRuntimeAssets() {
  const ortDist = path.join(here, 'node_modules', 'onnxruntime-web', 'dist');
  const tessCore = path.join(here, 'node_modules', 'tesseract.js-core');
  const tessDist = path.join(here, 'node_modules', 'tesseract.js', 'dist');
  const map: Record<string, string> = {
    '/ort/ort-wasm-simd-threaded.wasm': path.join(ortDist, 'ort-wasm-simd-threaded.wasm'),
    '/ort/ort-wasm-simd-threaded.mjs': path.join(ortDist, 'ort-wasm-simd-threaded.mjs'),
    '/ort/ort-wasm-simd-threaded.jsep.wasm': path.join(ortDist, 'ort-wasm-simd-threaded.jsep.wasm'),
    '/ort/ort-wasm-simd-threaded.jsep.mjs': path.join(ortDist, 'ort-wasm-simd-threaded.jsep.mjs'),
    '/tess/worker.min.js': path.join(tessDist, 'worker.min.js'),
    '/tess/tesseract-core-simd-lstm.wasm.js': path.join(tessCore, 'tesseract-core-simd-lstm.wasm.js'),
    '/tess/tesseract-core-simd-lstm.wasm': path.join(tessCore, 'tesseract-core-simd-lstm.wasm'),
    '/tess/tesseract-core-lstm.wasm.js': path.join(tessCore, 'tesseract-core-lstm.wasm.js'),
    '/tess/tesseract-core-lstm.wasm': path.join(tessCore, 'tesseract-core-lstm.wasm'),
  };
  const mime = (p: string) => (p.endsWith('.wasm') ? 'application/wasm' : p.endsWith('.js') || p.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream');
  // worker-scripts (Tesseract-worker, ORT-pthreads) moeten onder COEP
  // require-corp zelf ook COEP/CORP dragen, anders weigert Chromium ze
  // experimentele modelvarianten (web/experimental/): alleen via dev/preview, nooit in dist/precache
  const experimentalDir = path.resolve(here, 'experimental');
  const serve = async (req: any, res: any, next: any) => {
    const url = (req.url || '').split('?')[0];
    let file = map[url];
    if (!file && url.startsWith('/experimental/') && !url.includes('..')) file = path.join(experimentalDir, url.slice('/experimental/'.length));
    if (!file) return next();
    try {
      const data = await fs.readFile(file);
      res.setHeader('Content-Type', mime(file));
      res.setHeader('Cache-Control', 'no-cache');
      for (const [k, v] of Object.entries(isolationHeaders)) res.setHeader(k, v);
      res.end(data);
    } catch (err) {
      next(err);
    }
  };
  return {
    name: 'mk8-local-runtime-assets',
    configureServer(server: any) {
      server.middlewares.use(serve);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(serve);
    },
    configResolved(config: any) {
      resolvedOutDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const outDir = resolvedOutDir;
      for (const [url, file] of Object.entries(map)) {
        const dst = path.join(outDir, url);
        await fs.mkdir(path.dirname(dst), { recursive: true });
        await fs.copyFile(file, dst);
      }
    },
  };
}



export default defineConfig({
  base: basePath,
  plugins: [
    localRuntimeAssets(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'MK8DX Time Trial Scanner',
        short_name: 'TT Scanner',
        description: 'Mario Kart 8 Deluxe Time Trial scanner (local, offline)',
        display: 'fullscreen',
        // Geen afgedwongen liggende stand meer (ADR-0206): het ghost-detailpaneel is een hoog
        // paneel dat je rechtop leest, en de taak kiest de bron, niet de behuizing.
        background_color: '#080C1C',
        theme_color: '#080C1C',
        start_url: basePath,
        scope: basePath,
        icons: [
          { src: `${basePath}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${basePath}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `${basePath}icons/icon-maskable-192.png`, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: `${basePath}icons/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // het 116 MB ONNX-model + 13 MB opencv + 25 MB ort-jsep: limiet ruim zetten
        maximumFileSizeToCacheInBytes: 200 * 1024 * 1024,
        // `.pack` is the canonical offline bundle for the roughly 1,500 engine
        // reference assets excluded below; omitting it forces the engine onto
        // those intentionally unprecached loose-file fallbacks.
        // shared-icon/**/*.bin: the shared field reader's reference tensors (product default since 0.2.0)
        globPatterns: ['**/*.{js,mjs,css,html,wasm,png,jpg,json,traineddata,onnx,pack}', 'shared-icon/**/*.bin'],
        // de JSEP/WebGPU-runtime (27,8 MB) is alleen nodig bij ?provider=webgpu: niet precachen, wel serveerbaar
        // Engine reference assets live in assets/pack/engine_assets.pack. Keep their loose copies out of
        // the precache, except tire/flag display images: the progress and result UI addresses those
        // directly, so all 132 small files must remain available offline for any recognition result.
        globIgnores: ['**/ort-wasm-simd-threaded.jsep.*', '**/ort-wasm-simd-threaded.jspi.*', '**/ort-wasm-simd-threaded.asyncify.*', 'assets/clean_assets/refs/**', 'assets/clean_assets/masks/**', 'assets/clean_assets/fam/**', 'assets/kart_config/character/**', 'assets/kart_config/body/**', 'assets/kart_config/glider/**', 'assets/grid/**', 'assets/segment_templates/**'],
        // alles ineens precachen; assets zijn versie-vast (manifest hash)
        navigateFallback: `${basePath}index.html`,
        // harness-/diagnosepagina's nooit naar index.html laten vallen (parity-runs op toestellen)
        navigateFallbackDenylist: [/parity\.html/, /cvtest\.html/, /\/audit(\/|$)/],
        // querystrings (bv. ?provider=wasm) mogen de precache-match niet breken
        ignoreURLParametersMatching: [/.*/],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { headers: isolationHeaders, port: 5173, strictPort: true },
  preview: { headers: isolationHeaders, port: 4173, strictPort: true },
  // Worker als één bestand (geen gedeelde chunks): met code-splitting importeerde de ORT-chunk van de
  // worker het worker-entrybestand terug, en WebKit (iOS Safari) voert een module-worker-entry dan een
  // tweede keer uit in dezelfde worker (module-map registreert de entry niet) -> verse `engine = null`,
  // nieuwe onmessage, "engine niet geïnitialiseerd" na een geslaagde init (field report 04-09-2026).
  // versie van de webversie (package.json), zichtbaar in instellingen, debug-tekst en auditrapport
  define: { __MK8_WEB_VERSION__: JSON.stringify(webVersion) },
  worker: { format: 'es', rollupOptions: { output: { inlineDynamicImports: true } } },
  // opencv.js is een CommonJS/UMD-bundel: esbuild zet hem om naar ESM (anders
  // faalt `this.cv = ...` in een module-worker); ORT Web is al ESM.
  optimizeDeps: { exclude: ['onnxruntime-web'], include: ['tesseract.js'] },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 20000,
    rollupOptions: {
      input: { main: path.join(here, 'index.html'), parity: path.join(here, 'parity.html'), cvtest: path.join(here, 'cvtest.html'), audit: path.join(here, 'audit', 'index.html') },
      output: { manualChunks: undefined },
    },
  },
});
