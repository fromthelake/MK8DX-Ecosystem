// Parity-harness (window.mk8Parity): Playwright voert per frame
// runFile(bytes, layout) uit en verzamelt de FrameResult-JSON. Zelfde
// pipeline als de product-UI (worker + engine), geen aparte leesweg.
import { EngineClient, defaultEngineConfig } from './app/engineClient';
import { LANG_CODES, setLanguage, t } from './engine/i18n';
import { blobToFrame } from './engine/imageio';
import type { SavedFramePreparation, SavedFrameCandidatePreparation } from './engine/imageio';
import type { Frame, FrameResult, LayoutProfile, ProgressEvent, ScanResult } from './engine/types';

const log = document.getElementById('log')!;
const say = (m: string) => {
  log.textContent += m + '\n';
};

const params = new URLSearchParams(location.search);
const provider = (params.get('provider') === 'webgpu' ? 'webgpu' : 'wasm') as 'wasm' | 'webgpu';
const textEvidence = params.get('text') !== '0';

const client = new EngineClient();
client.onStatus = (m) => {
  say(m);
  console.log('[parity]', m);
};

const config = defaultEngineConfig(provider, textEvidence);
config.debugSkip = { detector: params.get('nodetector') === '1', kartConfig: params.get('nokart') === '1' };
if (params.get('ocr')) {
  config.tesseract.preprocess = params.get('ocr') as any;
  config.tesseract.rowVariants = [params.get('ocr') as any];
}
if (params.get('variants')) config.tesseract.rowVariants = params.get('variants')!.split(',') as any;
if (params.get('rowja') === '1') config.tesseract.rowScripts = ['latin', 'ja'];
if (params.get('log')) config.debugLogUrl = params.get('log')!;
if (params.get('threads') !== null) config.numThreads = parseInt(params.get('threads')!, 10);
if (params.get('model')) config.modelUrl = `${location.origin}${import.meta.env.BASE_URL}${params.get('model')}`;
if (params.get('ortlib') === 'full') config.ortLib = 'full';
if (params.get('scripts')) config.tesseract.scripts = params.get('scripts')!.split(',') as any;
if (params.get('ortlog')) config.ortLogLevel = params.get('ortlog') as any;
if (params.get('gpupower')) config.webgpuPowerPreference = params.get('gpupower') as any;

if (params.get('noinit') === '1') { (window as any).mk8Parity = { noinit: true }; throw new Error('noinit'); }
const api = {
  ready: client.init(config).then((status) => {
    say('engine klaar: ' + JSON.stringify(status));
    return status;
  }),
  async runFile(bytes: ArrayBuffer, layout: LayoutProfile, opts: { identityOnly?: boolean; wantCanonicalJpeg?: boolean; wantOcrCrops?: boolean; framePrep?: SavedFrameCandidatePreparation; sparseDualYellowCandidate?: boolean; strictLapSumSeedCandidate?: boolean; ghostLapColumnCandidate?: boolean; playerLapColumnCandidate?: boolean; ghostTotalVerticalCandidate?: boolean; characterRescueFamilyGuardCandidate?: boolean; rawRgbCandidate?: boolean; wheelTextConflictReviewCandidate?: boolean; gliderTextConflictReviewCandidate?: boolean; cardBoxAlignCandidate?: boolean; gliderRowUpshiftCandidate?: boolean; wheelTextProposalCandidate?: boolean; kartVariantTextReviewCandidate?: boolean; kartFamilySearchCandidate?: boolean; flagBlueBandReviewCandidate?: boolean; achromaticGapCandidate?: boolean; ownerPresenceCandidate?: boolean; brightnessShortlist440Candidate?: boolean; lapIndexOutlierCandidate?: boolean; lapIndexDuplicateCandidate?: boolean; lapIndexLatticeCandidate?: boolean } = {}): Promise<FrameResult> {
    await api.ready;
    const blob = new Blob([bytes]);
    return client.frameBlob(blob, layout, opts);
  },
  async scanFile(bytes: ArrayBuffer, layout: LayoutProfile, copies = 1, framePrep?: SavedFramePreparation): Promise<ScanResult> {
    await api.ready;
    const blob = new Blob([bytes]);
    return client.scanBlob(blob, layout, () => undefined, undefined, { copies, framePrep });
  },
  memory(): unknown {
    const m = (performance as any).memory;
    return m ? { usedJSHeapSize: m.usedJSHeapSize, totalJSHeapSize: m.totalJSHeapSize, jsHeapSizeLimit: m.jsHeapSizeLimit } : null;
  },
  /** totaal proces-geheugen incl. wasm-heaps van de workers (vereist crossOriginIsolated) */
  async memoryTotal(): Promise<unknown> {
    const f = (performance as any).measureUserAgentSpecificMemory;
    if (typeof f !== 'function') return null;
    const r = await f.call(performance);
    const byType: Record<string, number> = {};
    for (const b of r.breakdown ?? []) for (const t of b.types?.length ? b.types : ['?']) byType[t] = (byType[t] ?? 0) + b.bytes;
    return { bytes: r.bytes, byType };
  },
  /** scan met voortgangsgebeurtenissen + optionele STOP na n ms (tests §25/§28) */
  async scanFrames(frames: { bytes: ArrayBuffer; layout: LayoutProfile }[], stopAfterMs = 0): Promise<{ result: ScanResult; events: ProgressEvent[] }> {
    await api.ready;
    const events: ProgressEvent[] = [];
    const decoded = await Promise.all(frames.map((f) => blobToFrame(new Blob([f.bytes]), f.layout)));
    if (stopAfterMs > 0) setTimeout(() => client.stop(), stopAfterMs);
    const result = await client.scan(decoded, frames[0].layout, true, (e) => events.push(e), undefined, {});
    return { result, events };
  },
  /** ruwe RGBA-frames (bv. staande camera-opname, zonder galerij-rotatie) door de scan-flow */
  async scanRaw(frames: Frame[], layout: LayoutProfile): Promise<ScanResult> {
    await api.ready;
    return client.scan(frames, layout, true, () => undefined, undefined, {});
  },
  async realign(owner: Record<string, unknown>, charId: string): Promise<Record<string, unknown>> {
    await api.ready;
    return client.realign(owner, charId);
  },
  i18n: { t, setLanguage, LANG_CODES },
};

(window as any).mk8Parity = api;
say(`provider=${provider} text=${textEvidence} crossOriginIsolated=${crossOriginIsolated}`);
