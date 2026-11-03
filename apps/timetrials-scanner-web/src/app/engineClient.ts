// Hoofddraad-kant van de scan-worker: promise-API + voortgangscallbacks.
import type { EngineConfig, EngineStatus } from '../engine/engine';
import type { Frame, FrameResult, LayoutProfile, ProgressEvent, ScanResult } from '../engine/types';
import type { SavedFramePreparation, SavedFrameCandidatePreparation } from '../engine/imageio';

export interface ScanHandle {
  result: Promise<ScanResult>;
}

export class EngineClient {
  private readonly worker: Worker;
  private nextId = 1;
  private readyPromise: Promise<EngineStatus> | null = null;
  private readonly pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; onProgress?: (e: ProgressEvent) => void; onFrame?: (i: number, r: FrameResult) => void }>();
  onStatus: ((message: string) => void) | null = null;
  onProgress: ((p: { stage: string; fraction: number; loaded: number; total: number }) => void) | null = null;
  onError: ((message: string) => void) | null = null;
  onLog: ((message: string) => void) | null = null;
  /** config van init(); gaat met elk scanbericht mee zodat een worker zonder engine zichzelf kan herstellen */
  private config: EngineConfig | null = null;

  constructor() {
    this.worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent) => this.handle(ev.data);
    this.worker.onerror = (ev) => {
      for (const p of this.pending.values()) p.reject(new Error(ev.message));
      this.pending.clear();
    };
  }

  init(config: EngineConfig): Promise<EngineStatus> {
    if (!this.readyPromise) {
      this.config = config;
      this.readyPromise = new Promise((resolve, reject) => {
        this.pending.set(0, { resolve, reject });
        this.worker.postMessage({ type: 'init', config });
      });
    }
    return this.readyPromise;
  }

  scan(frames: Frame[], layout: LayoutProfile, minimalArtifacts: boolean, onProgress: (e: ProgressEvent) => void, onFrame?: (i: number, r: FrameResult) => void, extra: { wantCanonicalJpeg?: boolean; wantFieldCrops?: boolean } = {}): Promise<ScanResult> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress, onFrame });
      const transfer = frames.map((f) => f.rgba.buffer);
      this.worker.postMessage({ type: 'scan', id, frames, layout, minimalArtifacts, ...extra, config: this.config }, transfer);
    });
  }

  scanBlob(blob: Blob, layout: LayoutProfile, onProgress: (e: ProgressEvent) => void, onFrame?: (i: number, r: FrameResult) => void, extra: { wantCanonicalJpeg?: boolean; wantFieldCrops?: boolean; copies?: number; framePrep?: SavedFramePreparation; qaOpticalPhotoCandidate?: boolean } = {}): Promise<ScanResult> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress, onFrame });
      this.worker.postMessage({ type: 'scanBlob', id, blob, layout, ...extra, config: this.config });
    });
  }

  /** Eén frame door de pipeline (parity/diagnostiek). */
  frameBlob(blob: Blob, layout: LayoutProfile, opts: { identityOnly?: boolean; wantCanonicalJpeg?: boolean; wantOcrCrops?: boolean; framePrep?: SavedFrameCandidatePreparation; sparseDualYellowCandidate?: boolean; strictLapSumSeedCandidate?: boolean; ghostLapColumnCandidate?: boolean; playerLapColumnCandidate?: boolean; ghostTotalVerticalCandidate?: boolean; characterRescueFamilyGuardCandidate?: boolean; rawRgbCandidate?: boolean; wheelTextConflictReviewCandidate?: boolean; gliderTextConflictReviewCandidate?: boolean; cardBoxAlignCandidate?: boolean; gliderRowUpshiftCandidate?: boolean; wheelTextProposalCandidate?: boolean; kartVariantTextReviewCandidate?: boolean; kartFamilySearchCandidate?: boolean; flagBlueBandReviewCandidate?: boolean; flagChromaticBandReviewCandidate?: boolean; opticalSharpnessReviewCandidate?: boolean; achromaticGapCandidate?: boolean; ownerPresenceCandidate?: boolean; brightnessShortlist440Candidate?: boolean; lapIndexOutlierCandidate?: boolean; lapIndexDuplicateCandidate?: boolean; lapIndexLatticeCandidate?: boolean } = {}): Promise<FrameResult> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'frameBlob', id, blob, layout, ...opts, config: this.config });
    });
  }

  stop(): void {
    this.worker.postMessage({ type: 'stop' });
  }

  /** bewaking: antwoordt de worker nog, en met welke instantie/engine-toestand (audit) */
  ping(): Promise<{ instanceId: string; initState: string; initCount: number; evals: number; hasEngine: boolean; cvHeapMb: number | null }> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'ping', id });
    });
  }

  /** worker hard beëindigen (hangende wasm-inferentie is niet te onderbreken); alle wachtenden falen */
  terminate(): void {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('engine terminated'));
    this.pending.clear();
  }

  /** testhaak: realignPartColors in de worker (zelfde matcher/pack als de scan) */
  realign(owner: Record<string, unknown>, charId: string): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'realign', id, owner, charId, config: this.config });
    });
  }

  private handle(msg: any): void {
    switch (msg.type) {
      case 'status':
        this.onStatus?.(msg.message);
        break;
      case 'log':
        this.onLog?.(msg.message);
        break;
      case 'setup_progress':
        this.onProgress?.(msg.progress);
        break;
      case 'ready':
        this.pending.get(0)?.resolve(msg.status);
        this.pending.delete(0);
        break;
      case 'progress':
        this.pending.get(msg.id)?.onProgress?.(msg.event);
        break;
      case 'frame':
        this.pending.get(msg.id)?.onFrame?.(msg.index, msg.result);
        break;
      case 'pong':
        this.pending.get(msg.id)?.resolve(msg.diag);
        this.pending.delete(msg.id);
        break;
      case 'done':
      case 'frameDone':
        this.pending.get(msg.id)?.resolve(msg.result);
        this.pending.delete(msg.id);
        break;
      case 'error': {
        const id = msg.id ?? 0;
        this.onError?.(`${msg.message}${msg.fatal ? ' (fataal)' : ''}`);
        const p = this.pending.get(id);
        if (p) {
          p.reject(new Error(msg.message));
          this.pending.delete(id);
        } else {
          console.error('worker error', msg.message, msg.stack);
          // fout zonder herkenbare aanvrager (bv. engine weg): niemand mag eeuwig blijven wachten
          for (const q of this.pending.values()) q.reject(new Error(msg.message));
          this.pending.clear();
        }
        break;
      }
      default:
        break;
    }
  }
}

export function defaultEngineConfig(provider: 'wasm' | 'webgpu' = 'wasm', textEvidence = true, numThreads?: number): EngineConfig {
  const origin = typeof location !== 'undefined' ? location.origin : '';
  // submap-hosting (bv. /mk8dxscanner/): alle engine-paden onder import.meta.env.BASE_URL
  const base = `${origin}${import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + '/'}`;
  return {
    assetBase: `${base}assets/`,
    cvBase: `${base}cv/`,
    provider,
    numThreads,
    ortWasmPaths: `${base}ort/`,
    textEvidence,
    tesseract: {
      workerPath: `${base}tess/worker.min.js`,
      corePath: `${base}tess/tesseract-core-simd-lstm.wasm.js`,
      langPath: `${base}tessdata`,
      // Every console language: Latin, Japanese, simplified and traditional Chinese,
      // Korean and Cyrillic (tessdata_fast). Latin and Japanese load at start (the
      // name-strip probe); the others load the first time a card needs them.
      scripts: ['latin', 'ja', 'zh', 'ko', 'zh_tw', 'ru'],
      warmupScripts: ['latin', 'ja'],
      // The kart row is tried in Latin first and stops at a confident match, so a
      // Latin card never reaches the other readers; a card printed in another
      // script is read by its own reader (before: Latin only, so ja/ko/zh/ru
      // part names could never match).
      rowScripts: ['latin', 'ja', 'zh', 'ko', 'zh_tw', 'ru'],
      preprocess: 'gray',
      rowVariants: ['gray', 'bin', 'raw', 'textcolour'],
    },
    // The central reader (packages/icon-matcher) decides every field; there is no previous reader
    // to fall back to (removed 2026-10-30).
    sharedIconQa: { assetBase: `${base}shared-icon/`, prefix: 'shared_icon',
      catalogSha256: SHARED_FIELD_CATALOG_SHA256, tireWindow: true, characterText: true,
      flagDistinctive: true, flagTricolor: true, characterColour: true, partText: true,
      tireTextTop3Guard: true, flagWindow: true, photometric: true },
    sharedFieldProduct: { fieldIndexPath: 'field-index.json' },
  };
}

/** Schema-9 catalog the staged shared reference pack must have been built from. */
export const SHARED_FIELD_CATALOG_SHA256 = '2375050f7a332c5bbe89a9109356e07759cc7432f5f804ba004d298c479950c0';

