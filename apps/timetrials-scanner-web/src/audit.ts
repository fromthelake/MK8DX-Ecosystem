// Audit-pagina (/audit/): zelfdraaiende checklist van alle scannerstappen op dit toestel,
// met per stap slagen/falen/hangen + tijd, en een kopieerbaar rapport. Geen product-UI, geen upload.
import { EngineClient, defaultEngineConfig } from './app/engineClient';
import type { ProgressEvent } from './engine/types';

interface Step {
  key: string;
  name: string;
  timeoutMs: number;
  run: (log: (s: string) => void) => Promise<string>;
}

// Bekende iOS/WebKit-valkuilen per schakel (bronnen: docs/IPHONE_SAFARI_READINESS.md, "Bekende iOS-valkuilen").
// Wordt bij een rode/hangende stap onder het resultaat gezet en komt in het rapport, zodat het rapport niet
// alleen ja/nee zegt maar ook waar het waarschijnlijk aan ligt.
const HINTS: Record<string, string> = {
  env: `niet geïsoleerd = de host stuurt geen COOP/COEP-headers (dan 1 thread, wel correct); geen OffscreenCanvas = iOS ouder dan 16.4; geen wasm-SIMD of geen SharedArrayBuffer terwijl wel geïsoleerd = Lockdown Mode (wasm/JIT uit) of een oude iOS.`,
  worker: `OffscreenCanvas in workers bestaat op iOS pas sinds 16.4; nested-worker-rendering was in WebKit kapot tot Safari 18.0 (WebKit-blog); Lockdown Mode blokkeert wasm in workers.`,
  sw: `iOS Safari kan de offline-cache na langere inactiviteit weggooien (dan opnieuw ~210 MB downloaden); minder dan ~455 entries = onvolledige precache (upload onvolledig of download afgebroken).`,
  ort4: `ORT-wasm op iOS: bekende meldingen van 'insufficient memory' bij het laden van het model (onnxruntime #22086, iOS 17); de threaded runtime maakt gedeeld wasm-geheugen aan (16 MB, maximum 4 GB) en WebKit geeft gedeeld geheugen bij herladen niet vrij (emscripten #19374): na een paar herlaadbeurten 'Out of memory'. Remedie: tabblad sluiten en Safari opnieuw openen. Onzin-uitvoer i.p.v. 1x300x4 = de SIMD-bug van iOS 16.4 (onnxruntime #15644). WebGPU/JSEP wordt op iOS bewust niet gebruikt (onnxruntime #26827: WebKit 26 loopt daarop vast).`,
  ort1: `zelfde als hierboven; slaagt 1 thread wél en n threads niet, dan open de scanner met ?threads=1 (de app onthoudt dit na een hang).`,
  opencv: `OpenCV.js heeft een eigen wasm-heap (~128 MB, groeit tijdens de scan); op iOS kan memory.grow het tabblad stil laten sluiten in plaats van netjes falen (WebKit 221530 / 269937 'Gigacage'). Faalt dit los van alles = de heap past al niet meer (geheugen van eerdere herlaadbeurten niet vrijgegeven): tabblad sluiten.`,
  pack: `bytes wijken af van de index = verouderde offline-cache of onvolledige upload (Cache wissen, herladen); 404 = submap/hosting.`,
  decode: `createImageBitmap met opties wordt op oudere Safari geweigerd (de app valt terug op createImageBitmap zonder opties); 0x0 of lege pixels = decoder-/OffscreenCanvas-bug in deze iOS-versie. Foto's uit de camerarol (HEIC) worden niet getest; de app decodeert die op dezelfde manier, een fout daar staat in de app-log.`,
  tesseract: `Tesseract.js op iOS: 'call_indirect to a null table entry' op iOS 17 gold voor het legacy-model (OEM 0, naptha #804/#867) — hier wordt LSTM (OEM 1) gebruikt; 'recognize never resolves on mobile' (naptha #510) = geneste worker die niet start (Lockdown Mode, of geheugen: elke taal-worker heeft een eigen wasm-heap). Twee taal-workers (eng + jpn) in de engine.`,
  engine: `alle onderdelen los goed maar samen niet = geheugenplafond van het proces: OpenCV + ORT (model 116 MB in de wasm-heap) + 2x Tesseract; 'Out of memory' bij 'model laden' is het klassieke beeld (zie ORT-uitleg: gedeeld geheugen van eerdere herlaadbeurten). Tabblad sluiten, Safari opnieuw openen, audit nog eens.`,
  watch: `engine weg of andere instantie na een geslaagde init = WebKit beëindigt/herstart de worker onder geheugendruk; 'init none' = script opnieuw gedraaid (verse instantie), 'init lost' = zelfde instantie zonder engine. De app herstelt dit zelf (config reist mee met elk scanbericht).`,
  scan: `'engine niet geïnitialiseerd' met daarin de init-toestand = worker had geen engine (zie bewaking; de worker probeert eerst zelf opnieuw te initialiseren); 'geen lock' = herkenning (niet iOS-specifiek); HANG = inferentie loopt vast: probeer ?threads=1.`,
  scan2: `zelfde als de eerste scan; slaagt de eerste wel en deze niet = geheugen loopt vol tijdens scans (buffers per scan) of de worker is tussendoor beëindigd.`,
  restart: `herstart mislukt met 'Out of memory' = het geheugen van de beëindigde worker komt op iOS niet terug (gedeeld wasm-geheugen); alleen tabblad sluiten helpt dan. Dit is precies de tweede herstellijn van de app; faalt hij hier, dan helpt de app-herstart op dit toestel ook niet.`,
  headroom: `minder dan ~256 MB extra met de engine geladen = het toestel zit op het plafond; scans hebben tijdelijke buffers nodig en de worker sneuvelt dan als eerste. Pagina afgebroken tijdens deze stap = iOS heeft het tabblad gedood (rapport tot hier is bewaard).`,
  wasmmem: `minder dan 1024 MB zonder engine = laag plafond of gelekt geheugen van eerdere herlaadbeurten (tabblad sluiten en opnieuw meten). Op iOS kan de grens ook als stil sluiten van het tabblad verschijnen i.p.v. als fout (WebKit 221530).`,
  camera: `iOS geeft de camera alleen op https en na een tik van de gebruiker (de audit-start telt); 'NotAllowedError' = toestemming geweigerd (Instellingen > Safari > Camera); in de thuisscherm-app moet de toestemming apart gegeven worden.`,
};

interface StepResult {
  key: string;
  name: string;
  status: 'ok' | 'fail' | 'hang' | 'skip';
  ms: number;
  detail: string;
}

const base = `${location.origin}${import.meta.env.BASE_URL}`;
const stepsEl = document.getElementById('steps')!;
const summaryEl = document.getElementById('summary')!;
const reportEl = document.getElementById('report') as HTMLTextAreaElement;
const startBtn = document.getElementById('start') as HTMLButtonElement;
const copyBtn = document.getElementById('copy') as HTMLButtonElement;
const shareBtn = document.getElementById('share') as HTMLButtonElement;
const resetBtn = document.getElementById('reset') as HTMLButtonElement;
const results: StepResult[] = [];
const workerNotes: string[] = []; // log-regels van de engine-worker (herstel, subworker-fouten)
// gebeurtenissen op paginaniveau tijdens de audit: zichtbaarheid (iOS zet de pagina op de achtergrond?),
// paginafouten en onafgehandelde promises (fouten uit bibliotheken die niet via de worker lopen)
const pageEvents: string[] = [];
const auditT0 = performance.now();
const stamp = () => `${((performance.now() - auditT0) / 1000).toFixed(1)}s`;
document.addEventListener('visibilitychange', () => pageEvents.push(`${stamp()} zichtbaarheid: ${document.visibilityState}`));
window.addEventListener('pagehide', () => pageEvents.push(`${stamp()} pagehide`));
window.addEventListener('error', (e) => pageEvents.push(`${stamp()} paginafout: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => pageEvents.push(`${stamp()} unhandledrejection: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`));
const rows = new Map<string, HTMLElement>();

function row(step: Step): HTMLElement {
  const el = document.createElement('div');
  el.className = 'step';
  el.innerHTML = `<div class="ic">◻</div><div><div class="name">${step.name}</div><div class="detail"></div></div><div class="ms"></div>`;
  stepsEl.append(el);
  rows.set(step.key, el);
  return el;
}
function setRow(key: string, cls: string, icon: string, detail: string, ms?: number): void {
  const el = rows.get(key)!;
  el.className = `step ${cls}`;
  (el.querySelector('.ic') as HTMLElement).textContent = icon;
  (el.querySelector('.detail') as HTMLElement).textContent = detail;
  (el.querySelector('.ms') as HTMLElement).textContent = ms === undefined ? '' : `${(ms / 1000).toFixed(1)} s`;
}
const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`HANG na ${ms / 1000} s`)), ms);
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});
const wasmSimd = () => { try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch { return false; } };

// ORT los van de engine-worker, in een eigen weggooi-worker: sessie + 1 inferentie met n threads.
// In een worker (zoals de engine) en na afloop beëindigd, zodat de wasm-heap niet in de pagina achterblijft
// (iPhone-audit 03-09-2026: tweede run gaf 'Out of memory' bij het model omdat de pagina nog twee ORT-heaps vasthield).
function ortDirect(threads: number, log: (s: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./ortprobe.worker.ts', import.meta.url), { type: 'module' });
    const done = (fn: () => void) => { w.terminate(); fn(); };
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'log') log(m.message);
      else if (m.type === 'done') done(() => resolve(m.result));
      else if (m.type === 'error') done(() => reject(new Error(m.message)));
    };
    w.onerror = (e) => done(() => reject(new Error(`worker: ${e.message}`)));
    w.postMessage({ threads, base });
  });
}

// wasm-geheugenprobe in een weggooi-worker: één heap in stappen van 64 MB laten groeien (en aanraken) tot 1 GB of tot een fout
function memProbe(log: (s: string) => void, stepMb = 64, maxMb = 1024): Promise<{ mb: number; err: string }> {
  return new Promise((resolve, reject) => {
    const src = `self.onmessage = () => { const step = ${stepMb * 16}; const max = ${maxMb * 16}; let mem, pages = 0; try { mem = new WebAssembly.Memory({ initial: step, maximum: max }); pages = step; } catch (e) { postMessage({ ok: false, mb: 0, err: String(e) }); return; } let err = ''; while (pages < max) { try { mem.grow(step); pages += step; new Uint8Array(mem.buffer).fill(1, (pages - step) * 65536, pages * 65536); postMessage({ progress: pages / 16 }); } catch (e) { err = String(e); break; } } postMessage({ ok: true, mb: pages / 16, err }); };`;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = (e) => {
      const m = e.data;
      if (m.progress !== undefined) { log(`${m.progress} MB`); return; }
      w.terminate();
      if (!m.ok) reject(new Error(`geen wasm-geheugen: ${m.err}`));
      else resolve({ mb: m.mb, err: m.err });
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(`worker: ${e.message}`)); };
    w.postMessage(1);
  });
}

// één schakel op zichzelf, in een weggooi-worker (src/probe.worker.ts)
function probe(kind: 'opencv' | 'pack' | 'decode' | 'tesseract', log: (s: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./probe.worker.ts', import.meta.url), { type: 'module' });
    const done = (fn: () => void) => { w.terminate(); fn(); };
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'log') log(m.message);
      else if (m.type === 'done') done(() => resolve(m.result));
      else if (m.type === 'error') done(() => reject(new Error(m.message)));
    };
    w.onerror = (e) => done(() => reject(new Error(`worker: ${e.message}`)));
    w.postMessage({ kind, base });
  });
}

const steps: Step[] = [
  { key: 'env', name: 'Omgeving', timeoutMs: 5000, run: async () => {
    const sab = typeof SharedArrayBuffer !== 'undefined';
    const lines = [
      `${navigator.userAgent}`,
      `crossOriginIsolated=${crossOriginIsolated} SharedArrayBuffer=${sab} cores=${navigator.hardwareConcurrency}`,
      `OffscreenCanvas=${typeof OffscreenCanvas !== 'undefined'} createImageBitmap=${typeof createImageBitmap === 'function'} wasmSIMD=${wasmSimd()}`,
      `mediaDevices=${!!navigator.mediaDevices?.getUserMedia} serviceWorker=${'serviceWorker' in navigator} standalone=${(navigator as any).standalone ?? matchMedia('(display-mode: standalone)').matches}`,
      `viewport=${innerWidth}x${innerHeight} dpr=${devicePixelRatio} online=${navigator.onLine}`,
    ];
    if (!crossOriginIsolated) lines.push('LET OP: niet geïsoleerd -> 1 wasm-thread (trager, wel correct)');
    return lines.join('\n');
  } },
  { key: 'worker', name: 'Worker-API’s (OffscreenCanvas, ImageBitmap in een module-worker)', timeoutMs: 10000, run: () => new Promise((resolve, reject) => {
    const src = `self.onmessage = async () => { const r = { offscreen: typeof OffscreenCanvas !== 'undefined', bitmap: typeof createImageBitmap === 'function', sab: typeof SharedArrayBuffer !== 'undefined', isolated: self.crossOriginIsolated, nested: typeof Worker !== 'undefined' }; try { const c = new OffscreenCanvas(4, 4); r.ctx2d = !!c.getContext('2d'); r.toBlob = typeof c.convertToBlob === 'function'; } catch (e) { r.ctx2d = 'ERR ' + e.message; } postMessage(r); };`;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), { type: 'module' });
    w.onmessage = (e) => { w.terminate(); const r = e.data; const s = JSON.stringify(r); if (r.offscreen && r.bitmap && r.ctx2d === true) resolve(s); else reject(new Error('ontbrekende worker-API: ' + s)); };
    w.onerror = (e) => reject(new Error(e.message));
    w.postMessage(1);
  }) },
  { key: 'sw', name: 'Service worker / offline-cache', timeoutMs: 10000, run: async () => {
    if (!('serviceWorker' in navigator)) return 'geen service worker (website werkt, geen offline)';
    const regs = await navigator.serviceWorker.getRegistrations();
    const keys = await caches.keys();
    let entries = 0;
    for (const k of keys) entries += (await (await caches.open(k)).keys()).length;
    const est = (navigator.storage && navigator.storage.estimate) ? await navigator.storage.estimate() : null;
    return `registraties=${regs.map((r) => r.scope).join(',') || 'geen'} cache-entries=${entries}${est ? ` opslag=${Math.round((est.usage ?? 0) / 1048576)} MB` : ''}`;
  } },
  { key: 'ort4', name: 'ONNX Runtime: model laden + 1 inferentie (threads volgens omgeving)', timeoutMs: 90000, run: (log) => ortDirect(crossOriginIsolated ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 4)) : 1, log) },
  { key: 'ort1', name: 'ONNX Runtime: dezelfde inferentie met 1 thread', timeoutMs: 90000, run: (log) => ortDirect(1, log) },
  { key: 'opencv', name: 'OpenCV.js op zichzelf (laden + cvtColor/threshold in een worker)', timeoutMs: 60000, run: (log) => probe('opencv', log) },
  { key: 'pack', name: 'Assetpakket op zichzelf (index + pack + manifest ophalen)', timeoutMs: 60000, run: (log) => probe('pack', log) },
  { key: 'decode', name: 'Beelddecodering op zichzelf (testbeeld → ImageBitmap → pixels in een worker)', timeoutMs: 30000, run: (log) => probe('decode', log) },
  { key: 'tesseract', name: 'Tesseract op zichzelf (geneste worker, eng, één regel lezen)', timeoutMs: 90000, run: (log) => probe('tesseract', log) },
  { key: 'engine', name: 'Scanner-engine starten (OpenCV, assetpakket, model, Tesseract)', timeoutMs: 180000, run: async (log) => {
    const client = new EngineClient();
    client.onStatus = (m) => log(m);
    client.onLog = (m) => { workerNotes.push(m); log(`worker: ${m}`); };
    client.onError = (m) => log(`workerfout: ${m}`);
    (window as any).__auditClient = client;
    const threadsPref = localStorage.getItem('mk8_prefs.engine_threads');
    const cfg = defaultEngineConfig('wasm', true, threadsPref ? parseInt(threadsPref, 10) : undefined);
    const st = await client.init(cfg);
    return `init ${st.totalInitMs} ms (opencv ${st.opencvMs} ms, assets ${st.assetsMs} ms, model ${st.detector.loadMs} ms), threads ${st.detector.numThreads}, provider ${st.detector.actualProvider}, model ${Math.round(st.detector.modelBytes / 1048576)} MB`;
  } },
  { key: 'watch', name: 'Worker-bewaking: 10 s elke 0,5 s pingen na de init (leeft hij, heeft hij zijn engine nog?)', timeoutMs: 30000, run: async (log) => {
    const client = (window as any).__auditClient as EngineClient | undefined;
    if (!client) throw new Error('engine niet gestart');
    const seen: string[] = [];
    let first: any = null;
    let answered = 0;
    let lost = '';
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      let d: any;
      try {
        d = await withTimeout(client.ping(), 3000);
      } catch (e) {
        lost = `ping ${i + 1} onbeantwoord na 3 s (${e instanceof Error ? e.message : e})`;
        break;
      }
      answered++;
      first ??= d;
      const key = `${d.instanceId}/${d.initState}/${d.hasEngine ? 'engine' : 'GEEN engine'}`;
      if (!seen.includes(key)) { seen.push(key); log(`${stamp()} ${key} (${Math.round(performance.now() - t)} ms)`); }
      if (!d.hasEngine) { lost = `engine weg bij ping ${i + 1}: ${key}`; break; }
      if (d.instanceId !== first.instanceId) { lost = `andere worker-instantie bij ping ${i + 1}: ${key} (was ${first.instanceId})`; break; }
      await new Promise((r) => setTimeout(r, 500));
    }
    const summary = `${answered}/20 pings beantwoord; instantie ${first?.instanceId ?? '?'}, init ${first?.initState ?? '?'}, inits ${first?.initCount ?? '?'}, evaluaties ${first?.evals ?? '?'}, OpenCV-heap ${first?.cvHeapMb ?? '?'} MB`;
    if (lost) throw new Error(`${lost} — ${summary}`);
    return summary;
  } },
  { key: 'scan', name: 'Testbeeld scannen via de engine (RESULT 3 laps)', timeoutMs: 120000, run: async (log) => {
    const client = (window as any).__auditClient as EngineClient | undefined;
    if (!client) throw new Error('engine niet gestart');
    const blob = await fetch(`${base}assets/demo_frames/demo_1_zand.jpg`).then((r) => r.blob());
    let lastStage = 'start';
    const t0 = performance.now();
    const res = await client.scanBlob(blob, 'endscreen', (e: ProgressEvent) => { lastStage = `${e.phase} ${Math.round(e.frameProgress)}% (${Math.round((performance.now() - t0) / 100) / 10} s)`; log(lastStage); }, undefined, {});
    if (!res.locked) throw new Error(`geen lock (laatste stap: ${lastStage})`);
    return `lock in ${Math.round(performance.now() - t0)} ms: ${res.fields.player_total ?? '?'} vs ${res.fields.ghost_total ?? '?'}, ${res.framesAnalyzed} frame(s)${workerNotes.length ? `\nworker: ${workerNotes.join(' | ')}` : ''}`;
  } },
  { key: 'scan2', name: 'Tweede scan (warme engine, GHOST 3 laps)', timeoutMs: 120000, run: async (log) => {
    const client = (window as any).__auditClient as EngineClient | undefined;
    if (!client) throw new Error('engine niet gestart');
    const blob = await fetch(`${base}demo_web/ghost_3laps.jpg`).then((r) => r.blob());
    const t0 = performance.now();
    const res = await client.scanBlob(blob, 'ghost_detail', (e: ProgressEvent) => log(`${e.phase} ${Math.round(e.frameProgress)}%`), undefined, {});
    if (!res.locked) throw new Error('geen lock');
    return `lock in ${Math.round(performance.now() - t0)} ms: ghost ${res.fields.ghost_total ?? '?'}`;
  } },
  { key: 'restart', name: 'Engine herstarten in een nieuwe worker + scan (de tweede herstellijn van de app)', timeoutMs: 180000, run: async (log) => {
    const old = (window as any).__auditClient as EngineClient | undefined;
    old?.terminate();
    const client = new EngineClient();
    client.onStatus = (m) => log(m);
    client.onLog = (m) => { workerNotes.push(m); log(`worker: ${m}`); };
    (window as any).__auditClient = client;
    const threadsPref = localStorage.getItem('mk8_prefs.engine_threads');
    const t0 = performance.now();
    const st = await client.init(defaultEngineConfig('wasm', true, threadsPref ? parseInt(threadsPref, 10) : undefined));
    const initMs = Math.round(performance.now() - t0);
    const blob = await fetch(`${base}assets/demo_frames/demo_1_zand.jpg`).then((r) => r.blob());
    const t1 = performance.now();
    const res = await client.scanBlob(blob, 'endscreen', (e: ProgressEvent) => log(`${e.phase} ${Math.round(e.frameProgress)}%`), undefined, {});
    if (!res.locked) throw new Error(`herstart-init ${initMs} ms (model ${st.detector.loadMs} ms), maar geen lock`);
    return `herstart-init ${initMs} ms (model ${st.detector.loadMs} ms), scan-lock in ${Math.round(performance.now() - t1)} ms: ${res.fields.player_total ?? '?'}`;
  } },
  { key: 'camera', name: 'Camera openen (achtercamera, automatisch maximum)', timeoutMs: 20000, run: async () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia ontbreekt');
    const s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 7680 }, height: { ideal: 4320 } } });
    const t = s.getVideoTracks()[0];
    const caps: any = t.getCapabilities ? t.getCapabilities() : {};
    if (caps.width?.max && caps.height?.max) {
      await t.applyConstraints({ width: { exact: caps.width.max }, height: { ideal: caps.height.max } })
        .catch(() => t.applyConstraints({ width: { ideal: caps.width.max }, height: { ideal: caps.height.max } }));
    }
    const st = t.getSettings();
    s.getTracks().forEach((x) => x.stop());
    return `${t.label || 'camera'} ${st.width}x${st.height} facing=${st.facingMode ?? '?'} focus=${(caps.focusMode ?? []).join('/') || '?'} zoom=${caps.zoom ? `${caps.zoom.min}-${caps.zoom.max}` : '-'} torch=${caps.torch ?? '-'}`;
  } },
  { key: 'headroom', name: 'Vrije wasm-ruimte MET engine geladen (extra heap in stappen van 32 MB, tot 256 MB; laatste stappen: op iPhone kan iOS het tabblad hier sluiten)', timeoutMs: 60000, run: async (log) => {
    // De engine (OpenCV + ORT + 2x Tesseract) staat nog in het geheugen na de herstart-test. Hoeveel kan er
    // nog bij? Op iOS is dit de maat die telt. Wordt de pagina hier afgebroken, dan staat het rapport tot
    // deze stap al in localStorage (saveProgress) en toont de pagina dat bij herladen.
    const client = (window as any).__auditClient as EngineClient | undefined;
    if (!client) throw new Error('engine niet gestart');
    const r = await memProbe(log, 32, 256);
    const d = await withTimeout(client.ping(), 5000).catch((e) => ({ err: e instanceof Error ? e.message : String(e) } as any));
    const alive = d.err ? `engine-worker daarna: GEEN antwoord (${d.err})` : `engine-worker daarna: ${d.hasEngine ? 'leeft, engine aanwezig' : 'leeft, GEEN engine meer'} (${d.instanceId}, init ${d.initState})`;
    if (d.err || !d.hasEngine) throw new Error(`${r.mb} MB extra${r.err ? ` (daarna: ${r.err})` : ''}; ${alive}`);
    return `${r.mb} MB extra${r.err ? ` (daarna: ${r.err})` : ' (limiet van de probe niet bereikt)'}; ${alive}`;
  } },
  { key: 'wasmmem', name: 'wasm-geheugen zonder engine: hoe ver kan één heap groeien (stappen van 64 MB, tot 1 GB)', timeoutMs: 60000, run: async (log) => {
    ((window as any).__auditClient as EngineClient | undefined)?.terminate();
    (window as any).__auditClient = undefined;
    await new Promise((r) => setTimeout(r, 1000)); // worker-geheugen laten vrijgeven
    const r = await memProbe(log);
    return `${r.mb} MB${r.err ? ` (daarna: ${r.err})` : ' (limiet van de probe niet bereikt)'}; de hele scanner (pagina + engine: ORT-model, OpenCV, 2x Tesseract) gebruikt op Android 1,0-1,2 GB`;
  } },
];

function report(): string {
  const lines = [`MK8DX TT Scanner audit — versie ${__MK8_WEB_VERSION__} — ${new Date().toISOString()} — ${location.href}`];
  for (const r of results) lines.push(`[${r.status.toUpperCase()}] ${r.name} (${(r.ms / 1000).toFixed(1)} s)\n  ${r.detail.replace(/\n/g, '\n  ')}`);
  lines.push(`-- paginagebeurtenissen tijdens de audit: ${pageEvents.length ? '' : 'geen'}`);
  for (const e of pageEvents.slice(-30)) lines.push(`  ${e}`);
  if (workerNotes.length) {
    lines.push('-- worker-log:');
    for (const n of workerNotes.slice(-30)) lines.push(`  ${n}`);
  }
  let appLog = '';
  try { appLog = localStorage.getItem('mk8_debug_last') ?? ''; } catch { appLog = ''; }
  lines.push(`-- laatste app-log (debug-tekst van de scanner zelf): ${appLog ? '' : 'geen (scanner nog niet gebruikt op dit toestel)'}`);
  if (appLog) for (const l of appLog.split('\n').slice(-60)) lines.push(`  ${l}`);
  return lines.join('\n');
}

const SAVE_KEY = 'mk8_audit_last';
function saveProgress(finished: boolean): void {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ finished, text: report() })); } catch { /* opslag vol of geblokkeerd */ }
}
// vorige (mogelijk afgebroken) audit tonen: als de pagina tijdens een stap is herladen, is dit het enige bewijs
try {
  const prev = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
  if (prev && !prev.finished) {
    summaryEl.textContent = 'De vorige audit is niet afgemaakt (pagina herladen of afgebroken tijdens een stap). Het rapport tot dat moment staat hieronder; kopieer het vóór je opnieuw start.';
    reportEl.value = prev.text;
    copyBtn.disabled = false;
  }
} catch { /* geen vorige audit */ }

async function runAll(): Promise<void> {
  startBtn.disabled = true;
  results.length = 0;
  workerNotes.length = 0;
  (window as any).__auditClient?.terminate();
  stepsEl.innerHTML = '';
  rows.clear();
  for (const s of steps) row(s);
  for (const s of steps) {
    const el = rows.get(s.key)!;
    results.push({ key: s.key, name: s.name, status: 'hang', ms: 0, detail: 'BEZIG toen het rapport werd bewaard (pagina afgebroken tijdens deze stap?)' });
    saveProgress(false);
    results.pop();
    el.className = 'step run';
    (el.querySelector('.ic') as HTMLElement).textContent = '◌';
    const t0 = performance.now();
    const logLines: string[] = [];
    const log = (m: string) => {
      logLines.push(m);
      (el.querySelector('.detail') as HTMLElement).textContent = logLines.slice(-3).join('\n');
      if (s.key === 'headroom' || s.key === 'wasmmem') {
        // geheugenstappen: voortgang meteen bewaren, zodat een door iOS gedood tabblad toch de bereikte MB laat zien
        results.push({ key: s.key, name: s.name, status: 'hang', ms: 0, detail: `BEZIG, laatst bereikt: ${m} (pagina afgebroken tijdens deze stap?)` });
        saveProgress(false);
        results.pop();
      }
    };
    try {
      const detail = await withTimeout(s.run(log), s.timeoutMs);
      const ms = performance.now() - t0;
      results.push({ key: s.key, name: s.name, status: 'ok', ms, detail });
      setRow(s.key, 'ok', '✅', detail, ms);
    } catch (e) {
      const ms = performance.now() - t0;
      const msg = e instanceof Error ? e.message : String(e);
      const hang = /^HANG/.test(msg);
      const detail = `${msg}${logLines.length ? `\nlaatste meldingen: ${logLines.slice(-5).join(' | ')}` : ''}${HINTS[s.key] ? `\nmogelijke oorzaak (iOS/WebKit): ${HINTS[s.key]}` : ''}`;
      results.push({ key: s.key, name: s.name, status: hang ? 'hang' : 'fail', ms, detail });
      setRow(s.key, hang ? 'hang' : 'fail', hang ? '⏳' : '❌', detail, ms);
    }
  }
  const ok = results.filter((r) => r.status === 'ok').length;
  const hang = results.filter((r) => r.status === 'hang');
  const oom = results.some((r) => /out of memory/i.test(r.detail));
  summaryEl.textContent = `${ok}/${results.length} stappen geslaagd.` + (oom ? ' Er is "Out of memory" gemeld: sluit dit tabblad, open Safari opnieuw en draai de audit nog eens (WebKit geeft gedeeld wasm-geheugen bij herladen niet vrij).' : '') + (hang.length ? ` Blijft hangen bij: ${hang.map((h) => h.name).join('; ')}.` : '') + (results.find((r) => r.key === 'ort4' && r.status !== 'ok') && results.find((r) => r.key === 'ort1' && r.status === 'ok') ? ' Advies: 1 thread gebruiken (de app schakelt daar zelf naar over na een hang; of open de scanner met ?threads=1).' : '');
  reportEl.value = report();
  saveProgress(true);
  copyBtn.disabled = false;
  shareBtn.disabled = !(navigator as any).share;
  startBtn.disabled = false;
  const client = (window as any).__auditClient as EngineClient | undefined;
  client?.terminate();
}

startBtn.addEventListener('click', () => void runAll());
copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(reportEl.value);
    copyBtn.textContent = '✔ gekopieerd';
  } catch {
    reportEl.focus();
    reportEl.select();
    copyBtn.textContent = 'selecteer de tekst en kopieer';
  }
});
shareBtn.addEventListener('click', () => void (navigator as any).share?.({ title: 'MK8DX scanner audit', text: reportEl.value }));
resetBtn.addEventListener('click', async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  localStorage.removeItem('mk8_prefs.engine_threads');
  resetBtn.textContent = '✔ cache gewist — herlaad de scanner';
});
