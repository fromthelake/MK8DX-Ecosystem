// Engine-samenstelling: OpenCV.js + RF-DETR (ORT Web) + grids + 7-seg-
// sjablonen + identiteitsmatchers + tekst-tweede-bewijs. Eén object dat de
// scanner (scanner.ts) en de parity-harness delen.
import { FetchAssetSource, type AssetSource } from './assets';
import { loadCv } from './cv';
import { RfDetrDetector, type DetectorStatus, type ExecutionProvider } from './detector';
import { KartConfigMatcher } from './kartConfig';
import type { PipelineDeps } from './pipeline';
import { LAP_CIRCLE_TEMPLATES_FILE, parseLapCircleTemplates } from './lapCircles';
import { readSegmentTemplate } from './segments';
import { TextEvidence, type Script } from './textEvidence';
import { TesseractRecognizer } from './tesseractRecognizer';

export interface SetupProgress {
  stage: string;
  fraction: number;
  loaded: number;
  total: number;
}

export interface EngineConfig {
  assetBase: string;
  /** Console languages that break a tie in the locale vote, most preferred first (the app's
   *  remembered language; a screen in another language still wins on its own evidence). */
  preferredLocales?: string[];
  /** OpenCV.js-loader + wasm (standaard '/cv/'; bij submap-hosting `${base}cv/`) */
  cvBase?: string;
  provider: ExecutionProvider;
  ortWasmPaths: string;
  /** tekst-tweede-bewijs aan/uit (uit = zoals de APK zonder ML Kit-modules) */
  textEvidence: boolean;
  tesseract: { workerPath: string; corePath: string; langPath: string; scripts: Script[]; rowScripts?: Script[]; warmupScripts?: Script[]; preprocess?: 'raw' | 'gray' | 'grayinv' | 'bin' | 'textcolour'; rowVariants?: ('raw' | 'gray' | 'grayinv' | 'bin' | 'textcolour')[] };
  numThreads?: number;
  /** experimenteel: alternatieve model-URL (bv. gekwantiseerde/ORT-formaat-variant) */
  modelUrl?: string;
  ortLib?: 'wasm' | 'full';
  ortLogLevel?: 'verbose' | 'info' | 'warning' | 'error';
  webgpuPowerPreference?: 'high-performance' | 'low-power';
  onStatus?: (message: string) => void;
  /** eerste-keer-setup: voortgang (fractie 0..1) + bytes van de lopende download */
  onProgress?: (p: SetupProgress) => void;
  /** diagnostiek: onderdelen overslaan om geheugen/laadproblemen te isoleren */
  debugSkip?: { detector?: boolean; kartConfig?: boolean };
  /** testhaak: de eerste scan nooit beantwoorden (simuleert een hangende inferentie, watchdog-test) */
  debugStallFirstScan?: boolean;
  /** testhaak: direct na een geslaagde init de engine in de worker loslaten (simuleert de iPhone-situatie) */
  debugLoseEngineAfterInit?: boolean;
  /** diagnostiek: elke statusregel ook als HTTP-beacon naar deze URL (overleeft een renderer-crash) */
  debugLogUrl?: string;
  /** Private QA only: compare the shared reader on the worker's actual icon crops. */
  sharedIconQa?: { assetBase: string; prefix: string; catalogSha256: string;
    tireWindow?: boolean; characterSlot?: boolean; characterText?: boolean;
    flagDistinctive?: boolean; partText?: boolean; saveSelectedCrops?: boolean;
    toneSuggestion?: boolean; partSubset?: boolean; jointLoadout?: boolean;
    tireTextTop3Guard?: boolean; resultFlagWhite?: boolean; characterColour?: boolean;
    flagTricolor?: boolean; flagWindow?: boolean; photometric?: boolean };
  /** Product route: the shared decision supplies the visible result-card
   * fields (needs sharedIconQa with characterText and partText). A missing or
   * mismatched pack falls back to the previous reader instead of failing. */
  sharedFieldProduct?: { fieldIndexPath: string };
}

export interface EngineStatus {
  detector: DetectorStatus;
  opencvMs: number;
  assetsMs: number;
  textEvidence: boolean;
  totalInitMs: number;
  /** Which reader supplies the visible fields: always the central one (the previous reader is gone). */
  fieldReader?: 'shared';
}

export class Engine {
  config!: EngineConfig;
  private constructor(readonly deps: PipelineDeps, readonly status: EngineStatus, readonly source: AssetSource, readonly recognizer: TesseractRecognizer | null) {}

  static async create(config: EngineConfig): Promise<Engine> {
    // Capability-guard (Safari/iOS < 16.4, oude WebViews): de engine decodeert en encodeert beelden in de
    // worker via OffscreenCanvas; zonder die API is een duidelijke fout beter dan een ReferenceError diep in init.
    if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') {
      throw new Error('browser too old: OffscreenCanvas + createImageBitmap in workers required (Safari/iOS 16.4+, Chrome 69+)');
    }
    const t0 = performance.now();
    const say = (m: string) => {
      config.onStatus?.(m);
      if (config.debugLogUrl) {
        try {
          void fetch(`${config.debugLogUrl}?m=${encodeURIComponent(m)}`, { mode: 'no-cors', keepalive: true });
        } catch {
          /* diagnostiek */
        }
      }
    };
    // gewichten van de setup-stappen (eerste bezoek, ±140 MB): het model domineert
    const W = { opencv: 0.06, pack: 0.05, assets: 0.03, model: 0.78, text: 0.08 };
    let done = 0;
    const progress = (stage: keyof typeof W, frac: number, loaded = 0, total = 0) => {
      config.onProgress?.({ stage, fraction: Math.min(1, done + W[stage] * Math.max(0, Math.min(1, frac))), loaded, total });
    };
    const finish = (stage: keyof typeof W) => {
      done = Math.min(1, done + W[stage]);
      progress(stage, 1);
    };
    progress('opencv', 0);
    say('OpenCV laden');
    await loadCv(config.cvBase ?? '/cv/');
    const t1 = performance.now();
    const source = new FetchAssetSource(config.assetBase);
    finish('opencv');
    progress('pack', 0);
    say('assetpakket laden');
    const pack = await source.loadPack();
    say(pack ? `assetpakket geladen (${pack.entries} bestanden, ${Math.round(pack.bytes / 1048576)} MB)` : 'assetpakket niet beschikbaar — losse bestanden');
    const mem = () => {
      const m = (performance as any).memory;
      return m ? ` heap=${Math.round(m.usedJSHeapSize / 1048576)}MB` : '';
    };
    finish('pack');
    progress('assets', 0);
    say('referentie-assets laden');
    const relGrid = await source.json('grid/new_relative_grid_combined.json');
    const relGridGhostDetail = await source.json('grid/ghost_detail_relative_grid.json');
    say('grids geladen');
    const lapTemplate = await readSegmentTemplate(source, 'segment_templates/template_7segments_17x25.png');
    const totalTemplate = await readSegmentTemplate(source, 'segment_templates/template_7segments_18x29.png');
    say('7-seg-sjablonen geladen');
    const recognizer = config.textEvidence ? new TesseractRecognizer(config.tesseract) : null;
    const textEvidence = new TextEvidence(recognizer);
    // sequentieel laden (geheugenpiek beperken): eerst iconen/matchers, dan het 116 MB-model
    const kartConfig = config.debugSkip?.kartConfig ? null : await KartConfigMatcher.load(source, textEvidence);
    if (kartConfig && config.preferredLocales) kartConfig.preferredLocales = [...config.preferredLocales];
    const fieldReader = 'shared' as const;
    const sharedQa = config.sharedIconQa;
    if (kartConfig && sharedQa) {
      const qaSource = new FetchAssetSource(sharedQa.assetBase);
      const enable = () => kartConfig.enableSharedIconQa(qaSource, sharedQa.prefix,
        sharedQa.catalogSha256, sharedQa.tireWindow ?? false,
        sharedQa.characterSlot ?? false, sharedQa.characterText ?? false,
        sharedQa.flagDistinctive ?? false, sharedQa.partText ?? false,
        sharedQa.saveSelectedCrops ?? false,
        sharedQa.toneSuggestion ?? false,
        sharedQa.partSubset ?? false,
        sharedQa.jointLoadout ?? false,
        sharedQa.tireTextTop3Guard ?? false,
        sharedQa.resultFlagWhite ?? false,
        sharedQa.characterColour ?? false,
        sharedQa.flagTricolor ?? false,
        sharedQa.flagWindow ?? false,
        sharedQa.photometric ?? false);
      if (config.sharedFieldProduct) {
        // No silent fallback: without the central reader the scanner cannot decide a field, so a
        // failed pack load stops the start with that error instead of reading by older rules.
        await enable();
        await kartConfig.enableSharedFieldProduct(qaSource, config.sharedFieldProduct.fieldIndexPath);
      } else {
        await enable();
      }
    }
    console.log(`[engine] veldlezer ${fieldReader}`);
    console.log('[engine] matchers geladen' + mem());
    const t2 = performance.now();
    finish('assets');
    const modelBytesExpected = await source.json<any>('assets_manifest.json').then((mf) => Number(mf?.files?.['model/inference_model.onnx']?.bytes ?? 0)).catch(() => 0);
    progress('model', 0);
    say('model laden');
    const detector = config.debugSkip?.detector
      ? (null as unknown as RfDetrDetector)
      : await RfDetrDetector.create({ modelUrl: config.modelUrl ?? `${config.assetBase}model/inference_model.onnx`, provider: config.provider, wasmPaths: config.ortWasmPaths, numThreads: config.numThreads, ortLib: config.ortLib, logLevel: config.ortLogLevel, webgpuPowerPreference: config.webgpuPowerPreference, onDownload: (loaded, total) => progress('model', total ? (loaded / total) * 0.9 : 0, loaded, total), expectedBytes: modelBytesExpected });
    console.log('[engine] detector geladen' + mem(), detector ? JSON.stringify(detector.status) : 'overgeslagen');
    if (recognizer) {
      finish('model');
      progress('text', 0);
      say('tekstherkenning laden');
      await recognizer.warmup();
    }
    // The Select-a-Ghost panel's last look: the pack's lap-circle templates, when staged.
    const lapCircles = sharedQa
      ? await new FetchAssetSource(sharedQa.assetBase).json(`${sharedQa.prefix}/${LAP_CIRCLE_TEMPLATES_FILE}`)
        .then(parseLapCircleTemplates).catch(() => null)
      : null;
    const deps: PipelineDeps = { detector, relGrid, relGridGhostDetail, lapTemplate, totalTemplate, kartConfig, lapCircles };
    const status: EngineStatus = {
      detector: detector ? detector.status : ({ actualProvider: 'none' } as DetectorStatus),
      opencvMs: Math.round(t1 - t0),
      assetsMs: Math.round(t2 - t1),
      textEvidence: !!recognizer,
      totalInitMs: Math.round(performance.now() - t0),
      fieldReader,
    };
    const engine = new Engine(deps, status, source, recognizer);
    engine.config = config;
    return engine;
  }
}
