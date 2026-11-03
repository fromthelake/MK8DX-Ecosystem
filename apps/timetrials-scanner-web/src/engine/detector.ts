// Port van RfDetrDetector: RF-DETR (3 klassen) via ONNX Runtime Web.
// Model = het ONGEWIJZIGDE app/src/main/assets/model/inference_model.onnx
// (sha256 1ab4350c…46b20, opset 17, 116 MB float32). Preprocessing identiek:
// RGB -> 704x704 (bilineair) -> CHW float, ImageNet mean/std; postprocessing
// identiek: sigmoid per klasse, drempel 0.20, top-40 op score.
import { parseDetections as centralParseDetections } from '../../../../packages/icon-matcher/ts/sharedDetections';
import type * as ortTypes from 'onnxruntime-web';

type OrtModule = typeof ortTypes;

/** ORT Web-bundel: 'wasm' = ort.wasm (14 MB wasm, geen JSEP/WebGPU) — standaard voor de wasm-EP;
 *  'full' = volledige bundel met WebGPU (27,8 MB jsep-wasm). Zonder WebGPU is de kleine bundel
 *  gelijkwaardig (zelfde CPU-kernels), maar kleiner in download en runtime-geheugen. */
let ortModule: OrtModule | null = null;

/** fetch met voortgang (Content-Length uit de response; zonder lengte alleen een eindmelding) */
async function fetchWithProgress(url: string, onProgress?: (loaded: number, total: number) => void, expectedBytes = 0): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`model ontbreekt: ${url} (${r.status})`);
  const total = Number(r.headers.get('content-length') || 0) || expectedBytes;
  if (!r.body || !onProgress) return r.arrayBuffer();
  const reader = r.body.getReader();
  // bekende lengte: rechtstreeks in één buffer schrijven (piek 1x model i.p.v. chunks + kopie = 2x;
  // telt op iPhone, waar de wasm-heaps van ORT/OpenCV/Tesseract al dicht bij de proceslimiet zitten)
  let out: Uint8Array | null = total ? new Uint8Array(total) : null;
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let lastReport = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (out && loaded + value.byteLength <= out.byteLength) out.set(value, loaded);
    else {
      // lengte klopte niet: terugvallen op chunks
      if (out) { chunks.push(out.subarray(0, loaded).slice()); out = null; }
      chunks.push(value);
    }
    loaded += value.byteLength;
    if (loaded - lastReport > 1_000_000) {
      lastReport = loaded;
      onProgress(loaded, Math.max(total, loaded));
    }
  }
  if (out && loaded < out.byteLength) out = out.slice(0, loaded); // korter dan aangekondigd (zeldzaam)
  if (!out) {
    out = new Uint8Array(loaded);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.byteLength;
    }
  }
  onProgress(loaded, loaded);
  return out.buffer as ArrayBuffer;
}
async function loadOrt(full: boolean): Promise<OrtModule> {
  if (!ortModule) ortModule = (full ? await import('onnxruntime-web') : await import('onnxruntime-web/wasm')) as unknown as OrtModule;
  return ortModule;
}
import { cv, f32 } from './cv';
import type { Detection, DetectionResult } from './types';

export const MODEL_SIZE = 704;
export { CLASS_NAMES, DETECT_THRESHOLD } from '../../../../packages/icon-matcher/ts/sharedDetections';
const RFDETR_MEAN = [0.485, 0.456, 0.406];
const RFDETR_STD = [0.229, 0.224, 0.225];

export type ExecutionProvider = 'wasm' | 'webgpu';

export interface DetectorConfig {
  modelUrl: string;
  provider: ExecutionProvider;
  /** pad naar de ort-wasm-bestanden op de eigen origin */
  wasmPaths: string;
  /** 0 = ORT-automatisch (min(4, ceil(hardwareConcurrency/2))); anders min(4, n) zoals de APK */
  numThreads?: number;
  /** 'wasm' (standaard, kleine bundel) of 'full' (JSEP/WebGPU-bundel) */
  ortLib?: 'wasm' | 'full';
  logLevel?: 'verbose' | 'info' | 'warning' | 'error';
  webgpuPowerPreference?: 'high-performance' | 'low-power';
  /** downloadvoortgang van het model (eerste bezoek) */
  onDownload?: (loaded: number, total: number) => void;
  /** verwachte modelgrootte (assets_manifest.json) als de server geen Content-Length geeft */
  expectedBytes?: number;
}

export interface DetectorStatus {
  requestedProvider: ExecutionProvider;
  actualProvider: string;
  fallbackUsed: boolean;
  fallbackReason: string;
  numThreads: number;
  modelBytes: number;
  loadMs: number;
  crossOriginIsolated: boolean;
}

export class RfDetrDetector {
  private session: ortTypes.InferenceSession;
  private ort: OrtModule;
  readonly status: DetectorStatus;
  private readonly inputBuffer = new Float32Array(3 * MODEL_SIZE * MODEL_SIZE);
  private busy: Promise<unknown> = Promise.resolve();

  private constructor(ort: OrtModule, session: ortTypes.InferenceSession, status: DetectorStatus) {
    this.ort = ort;
    this.session = session;
    this.status = status;
  }

  static async create(config: DetectorConfig, modelBytes?: ArrayBuffer): Promise<RfDetrDetector> {
    const started = performance.now();
    const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
    const hw = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
    // APK: intra-op threads = min(4, availableProcessors)
    const autoThreads = config.numThreads === 0;
    const threads = isolated ? (autoThreads ? Math.max(1, Math.min(4, Math.ceil(hw / 2))) : Math.max(1, Math.min(4, config.numThreads ?? hw))) : 1;
    const ort = await loadOrt(config.provider === 'webgpu' || config.ortLib === 'full');
    ort.env.wasm.wasmPaths = config.wasmPaths;
    // numThreads 0 laat ORT zelf kiezen (documentatie: min(4, ceil(hardwareConcurrency/2)))
    ort.env.wasm.numThreads = autoThreads ? 0 : threads;
    ort.env.wasm.proxy = false;
    ort.env.logLevel = config.logLevel ?? 'warning';
    if (config.provider === 'webgpu' && config.webgpuPowerPreference) (ort.env as any).webgpu.powerPreference = config.webgpuPowerPreference;
    const bytes = modelBytes ?? (await fetchWithProgress(config.modelUrl, config.onDownload, config.expectedBytes));
    const buffer = new Uint8Array(bytes);
    const baseOptions: ortTypes.InferenceSession.SessionOptions = {
      graphOptimizationLevel: 'all',
      executionMode: 'sequential',
      enableCpuMemArena: true,
      enableMemPattern: true,
      ...(autoThreads ? {} : { intraOpNumThreads: threads }),
      interOpNumThreads: 1,
    };
    let actual = 'wasm';
    let fallbackUsed = false;
    let fallbackReason = '';
    let session: ortTypes.InferenceSession | null = null;
    if (config.provider === 'webgpu') {
      try {
        session = await ort.InferenceSession.create(buffer, { ...baseOptions, executionProviders: ['webgpu', 'wasm'] });
        actual = 'webgpu(+wasm fallback per node)';
      } catch (err) {
        fallbackUsed = true;
        fallbackReason = err instanceof Error ? err.message : String(err);
        session = null;
      }
    }
    if (!session) {
      session = await ort.InferenceSession.create(buffer, { ...baseOptions, executionProviders: ['wasm'] });
      actual = 'wasm';
    }
    const status: DetectorStatus = {
      requestedProvider: config.provider,
      actualProvider: actual,
      fallbackUsed,
      fallbackReason,
      numThreads: threads,
      modelBytes: bytes.byteLength,
      loadMs: Math.round(performance.now() - started),
      crossOriginIsolated: isolated,
    };
    return new RfDetrDetector(ort, session, status);
  }

  /** bgr: 8UC3 Mat (analyse-ruimte). Gesynchroniseerd zoals de Java-versie. */
  async detect(bgr: any): Promise<DetectionResult> {
    const run = this.busy.then(() => this.detectNow(bgr));
    this.busy = run.catch(() => undefined);
    return run;
  }

  private async detectNow(bgr: any): Promise<DetectionResult> {
    const c = cv();
    const t0 = performance.now();
    // Android: Bitmap.createScaledBitmap(bitmap, 704, 704, filter=true) = bilineair
    const rgb = new c.Mat();
    c.cvtColor(bgr, rgb, c.COLOR_BGR2RGB);
    const resized = new c.Mat();
    c.resize(rgb, resized, new c.Size(MODEL_SIZE, MODEL_SIZE), 0, 0, c.INTER_LINEAR);
    rgb.delete();
    const t1 = performance.now();
    const plane = MODEL_SIZE * MODEL_SIZE;
    const px = resized.data as Uint8Array;
    const input = this.inputBuffer;
    const m0 = RFDETR_MEAN[0], m1 = RFDETR_MEAN[1], m2 = RFDETR_MEAN[2];
    const s0 = RFDETR_STD[0], s1 = RFDETR_STD[1], s2 = RFDETR_STD[2];
    for (let i = 0; i < plane; i++) {
      const b = i * 3;
      input[i] = f32((f32(px[b] / 255.0) - m0) / s0);
      input[plane + i] = f32((f32(px[b + 1] / 255.0) - m1) / s1);
      input[2 * plane + i] = f32((f32(px[b + 2] / 255.0) - m2) / s2);
    }
    resized.delete();
    const t2 = performance.now();
    const tensor = new this.ort.Tensor('float32', input, [1, 3, MODEL_SIZE, MODEL_SIZE]);
    const t3 = performance.now();
    const out = await this.session.run({ input: tensor });
    const t4 = performance.now();
    const dets = out.dets.data as Float32Array;
    const labels = out.labels.data as Float32Array;
    const n = out.dets.dims[1];
    const nc = out.labels.dims[2];
    const detections = parseDetections(dets, labels, n, nc, bgr.cols, bgr.rows);
    const t5 = performance.now();
    return {
      detections,
      timing: {
        resize: Math.round(t1 - t0),
        normalize: Math.round(t2 - t1),
        tensor: Math.round(t3 - t2),
        ort_run: Math.round(t4 - t3),
        parse: Math.round(t5 - t4),
        total: Math.round(t5 - t0),
      },
    };
  }

  async close(): Promise<void> {
    await this.session.release();
  }
}

function sigmoid(v: number): number {
  return f32(1.0 / (1.0 + Math.exp(-v)));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function parseDetections(boxes: Float32Array, logits: Float32Array, count: number, numClasses: number, width: number, height: number): Detection[] {
  // The central post-processing (packages/icon-matcher sharedDetections, the same as Android).
  return centralParseDetections(boxes, logits, count, numClasses, width, height);
}
