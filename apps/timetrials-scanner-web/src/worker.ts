// Scan-worker: houdt de UI-draad vrij (eis §26). Protocol:
//   main -> worker: init(config) | scan(frames, layout, ...) | stop | frame(single, parity)
//   worker -> main: ready(status) | progress(event) | frame(index,result) | done(result) | error | log
//
// Zelfherstel (iOS Safari, 03/04-09-2026): op iPhone kwam een scan bij een worker binnen die géén engine
// meer had, direct na een geslaagde init (ready ontvangen). Daarom draagt elk scanbericht de engine-config
// mee: heeft deze worker-instantie geen engine, dan initialiseert hij zichzelf alsnog en scant daarna.
// De foutmelding bevat de instantie-id, de init-toestand en het aantal evaluaties van dit script, zodat
// een audit-rapport laat zien of de worker-instantie vers was (script opnieuw gedraaid) of de engine kwijt.
import { Engine, type EngineConfig } from './engine/engine';
import { runFrame } from './engine/pipeline';
import { Scanner } from './engine/scanner';
import { blobToFrame, blobToPreparedFrame, isPortraitSavedImage, type SavedFramePreparation, type SavedFrameCandidatePreparation } from './engine/imageio';
import type { Frame, LayoutProfile } from './engine/types';
import { cv } from './engine/cv';

export type WorkerInbound =
  | { type: 'init'; config: EngineConfig }
  | { type: 'scan'; id: number; frames: Frame[]; layout: LayoutProfile; minimalArtifacts: boolean; wantCanonicalJpeg?: boolean; wantFieldCrops?: boolean; config?: EngineConfig }
  | { type: 'scanBlob'; id: number; blob: Blob; layout: LayoutProfile; wantCanonicalJpeg?: boolean; wantFieldCrops?: boolean; wantOcrCrops?: boolean; copies?: number; framePrep?: SavedFramePreparation; qaOpticalPhotoCandidate?: boolean; config?: EngineConfig }
  | { type: 'frameBlob'; id: number; blob: Blob; layout: LayoutProfile; identityOnly?: boolean; wantCanonicalJpeg?: boolean; wantOcrCrops?: boolean; framePrep?: SavedFrameCandidatePreparation; sparseDualYellowCandidate?: boolean; strictLapSumSeedCandidate?: boolean; researchGameAnchorLapProfileCandidate?: boolean; ghostLapColumnCandidate?: boolean; playerLapColumnCandidate?: boolean; ghostTotalVerticalCandidate?: boolean; characterRescueFamilyGuardCandidate?: boolean; rawRgbCandidate?: boolean; wheelTextConflictReviewCandidate?: boolean; gliderTextConflictReviewCandidate?: boolean; cardBoxAlignCandidate?: boolean; gliderRowUpshiftCandidate?: boolean; wheelTextProposalCandidate?: boolean; kartVariantTextReviewCandidate?: boolean; kartFamilySearchCandidate?: boolean; flagBlueBandReviewCandidate?: boolean; flagChromaticBandReviewCandidate?: boolean; opticalSharpnessReviewCandidate?: boolean; achromaticGapCandidate?: boolean; ownerPresenceCandidate?: boolean; brightnessShortlist440Candidate?: boolean; lapIndexOutlierCandidate?: boolean; lapIndexDuplicateCandidate?: boolean; lapIndexLatticeCandidate?: boolean; config?: EngineConfig }
  | { type: 'realign'; id: number; owner: Record<string, unknown>; charId: string; config?: EngineConfig }
  | { type: 'stop' }
  | { type: 'ping'; id: number };

let engine: Engine | null = null;
let scanner: Scanner | null = null;

// diagnose: is dit een verse instantie (script opnieuw geëvalueerd) of dezelfde instantie zonder engine?
const g = self as unknown as Record<string, unknown> & Worker & { name?: string };
g.__mk8Evals = (Number(g.__mk8Evals) || 0) + 1;
const instanceId = Math.random().toString(36).slice(2, 8);
let initState: 'none' | 'running' | 'ready' | 'failed' | 'lost' = 'none';
let initError = '';
let initPromise: Promise<void> | null = null;
let initCount = 0;

let stalledOnce = false;
let lostOnce = false;
const post = (msg: unknown) => (self as unknown as Worker).postMessage(msg);
const log = (message: string) => post({ type: 'log', message });
const diag = () => `worker ${instanceId}, init ${initState}${initError ? ` (${initError})` : ''}, inits ${initCount}, evaluaties ${g.__mk8Evals}, name '${g.name ?? ''}'`;

// fouten die buiten een bericht om optreden (bv. in een ORT-/Tesseract-subworker) zichtbaar maken in de debug-log
self.addEventListener('error', (ev) => log(`worker onerror: ${(ev as ErrorEvent).message ?? ev}`));
self.addEventListener('unhandledrejection', (ev) => log(`worker unhandledrejection: ${(ev as PromiseRejectionEvent).reason instanceof Error ? (ev as PromiseRejectionEvent).reason.message : String((ev as PromiseRejectionEvent).reason)}`));

async function doInit(config: EngineConfig, why: string): Promise<void> {
  if (initPromise) return initPromise;
  initState = 'running';
  initError = '';
  initCount++;
  initPromise = (async () => {
    try {
      console.log('[worker] init start, reason=', why, 'crossOriginIsolated=', (self as any).crossOriginIsolated, 'threads=', navigator.hardwareConcurrency);
      engine = await Engine.create({ ...config, onStatus: (m) => { console.log('[worker]', m); post({ type: 'status', message: m }); }, onProgress: (p) => post({ type: 'setup_progress', progress: p }) });
      console.log('[worker] init klaar', JSON.stringify(engine.status));
      scanner = new Scanner(engine);
      initState = 'ready';
      if (config.debugLoseEngineAfterInit && !lostOnce) {
        lostOnce = true;
        // testhaak: simuleert de iPhone-situatie (ready gemeld, daarna geen engine meer in de worker)
        setTimeout(() => { engine = null; scanner = null; initState = 'lost'; log('testhaak: engine losgelaten na init'); }, 0);
      }
    } catch (exc) {
      initState = 'failed';
      initError = exc instanceof Error ? `${exc.name}: ${exc.message}` : String(exc);
      throw exc;
    } finally {
      initPromise = null;
    }
  })();
  return initPromise;
}

const handler = async (ev: MessageEvent<WorkerInbound>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      await doInit(msg.config, 'init-bericht');
      post({ type: 'ready', status: engine!.status });
      return;
    }
    if (msg.type === 'stop') {
      scanner?.stop(); // STOP vóór/na init: niets te stoppen
      return;
    }
    if (msg.type === 'ping') {
      // bewaking (audit): leeft deze instantie nog, heeft hij zijn engine nog, hoe groot is de OpenCV-heap
      let cvHeapMb: number | null = null;
      try { cvHeapMb = Math.round(((cv() as any).HEAPU8?.byteLength ?? 0) / 1048576); } catch { cvHeapMb = null; }
      post({ type: 'pong', id: msg.id, diag: { instanceId, initState, initCount, evals: g.__mk8Evals, hasEngine: !!engine, cvHeapMb } });
      return;
    }
    if (!engine || !scanner) {
      // engine ontbreekt: lopende init afwachten, of (config meegestuurd) zelf alsnog initialiseren
      const before = diag();
      if (initPromise) await initPromise.catch(() => undefined);
      else if (msg.config) {
        log(`engine ontbreekt bij ${msg.type} (${before}); opnieuw initialiseren`);
        post({ type: 'status', message: 'engine opnieuw initialiseren' });
        await doInit(msg.config, `herstel bij ${msg.type}`).catch(() => undefined);
      }
      if (!engine || !scanner) {
        // met id, zodat de wachtende scan in de UI faalt i.p.v. eeuwig op 0% blijft staan
        post({ type: 'error', id: (msg as any).id, message: `engine niet geïnitialiseerd (${before}; nu ${diag()})`, fatal: true });
        return;
      }
      log(`engine hersteld (${diag()})`);
    }
    if (msg.type === 'scan' || msg.type === 'scanBlob') {
      if (engine.config.debugStallFirstScan && !stalledOnce) {
        stalledOnce = true;
        return; // nooit antwoorden: de watchdog in de UI moet dit opvangen
      }
      const frames: Frame[] = msg.type === 'scan' ? msg.frames : [];
      if (msg.type === 'scanBlob') {
        if (msg.qaOpticalPhotoCandidate && (msg.copies ?? 1) !== 1)
          throw new Error('QA optical candidate requires one saved image');
        const frame = msg.framePrep ? await blobToPreparedFrame(msg.blob, msg.layout, msg.framePrep) : await blobToFrame(msg.blob, msg.layout);
        const copies = Math.max(1, msg.copies ?? 1);
        for (let i = 0; i < copies; i++) frames.push(frame);
      }
      const id = msg.id;
      const result = await scanner.scan(
        { frames, layout: msg.layout, minimalArtifacts: msg.type === 'scan' ? msg.minimalArtifacts : false, wantCanonicalJpeg: msg.wantCanonicalJpeg, wantFieldCrops: msg.wantFieldCrops,
          wantOcrCrops: msg.type === 'scanBlob' && msg.wantOcrCrops === true,
          qaOpticalPhotoCandidate: msg.type === 'scanBlob' && msg.qaOpticalPhotoCandidate === true },
        (event) => post({ type: 'progress', id, event }),
        (index, frameResult) => post({ type: 'frame', id, index, result: frameResult }),
      );
      post({ type: 'done', id, result });
      return;
    }
    if (msg.type === 'realign') {
      // testhaak (eis §17/§50): realignPartColors op een gegeven owner-uitslag
      const owner = structuredClone(msg.owner) as any;
      engine.deps.kartConfig?.realignPartColors(owner, msg.charId);
      post({ type: 'frameDone', id: msg.id, result: owner });
      return;
    }
    if (msg.type === 'frameBlob') {
      // parity/diagnostiek: één frame, één pipeline-run (= APK scanfile/galerij-route)
      const preparationStarted = performance.now();
      const auto = msg.framePrep === 'portrait-auto' && msg.layout === 'endscreen';
      const firstPrep: SavedFramePreparation | undefined = msg.framePrep === 'portrait-auto' ? 'portrait-center' : msg.framePrep;
      const frame = firstPrep ? await blobToPreparedFrame(msg.blob, msg.layout, firstPrep) : await blobToFrame(msg.blob, msg.layout);
      const options = { layout: msg.layout, identityOnly: !!msg.identityOnly, minimalArtifacts: false, wantCanonicalJpeg: msg.wantCanonicalJpeg, wantOcrCrops: msg.wantOcrCrops,
        sparseDualYellowCandidate: !!msg.sparseDualYellowCandidate,
        strictLapSumSeedCandidate: !!msg.strictLapSumSeedCandidate,
        researchGameAnchorLapProfileCandidate: !!msg.researchGameAnchorLapProfileCandidate,
        ghostLapColumnCandidate: !!msg.ghostLapColumnCandidate,
        playerLapColumnCandidate: !!msg.playerLapColumnCandidate,
        ghostTotalVerticalCandidate: !!msg.ghostTotalVerticalCandidate,
        characterRescueFamilyGuardCandidate: !!msg.characterRescueFamilyGuardCandidate,
        rawRgbCandidate: !!msg.rawRgbCandidate,
        wheelTextConflictReviewCandidate: !!msg.wheelTextConflictReviewCandidate,
        gliderTextConflictReviewCandidate: !!msg.gliderTextConflictReviewCandidate,
        cardBoxAlignCandidate: !!msg.cardBoxAlignCandidate,
        gliderRowUpshiftCandidate: !!msg.gliderRowUpshiftCandidate,
        wheelTextProposalCandidate: !!msg.wheelTextProposalCandidate,
        kartVariantTextReviewCandidate: !!msg.kartVariantTextReviewCandidate,
        kartFamilySearchCandidate: !!msg.kartFamilySearchCandidate,
        flagBlueBandReviewCandidate: !!msg.flagBlueBandReviewCandidate,
        flagChromaticBandReviewCandidate: !!msg.flagChromaticBandReviewCandidate,
        opticalSharpnessReviewCandidate: !!msg.opticalSharpnessReviewCandidate,
        achromaticGapCandidate: !!msg.achromaticGapCandidate,
        brightnessShortlist440Candidate: !!msg.brightnessShortlist440Candidate,
        ownerPresenceCandidate: !!msg.ownerPresenceCandidate,
        lapIndexOutlierCandidate: !!msg.lapIndexOutlierCandidate,
        lapIndexDuplicateCandidate: !!msg.lapIndexDuplicateCandidate,
        lapIndexLatticeCandidate: !!msg.lapIndexLatticeCandidate };
      let result = await runFrame(frame, engine.deps, options, () => undefined, () => false);
      if (auto) {
        const firstStatus = result.status;
        const firstBlockingStage = result.firstBlockingStage;
        const firstRuntimeMs = result.totalRuntimeMs;
        let selected = 'portrait-center';
        if (firstBlockingStage === '01_AutoCardROI' && await isPortraitSavedImage(msg.blob)) {
          const rotated = await blobToFrame(msg.blob, msg.layout);
          result = await runFrame(rotated, engine.deps, options, () => undefined, () => false);
          selected = 'current';
        }
        result.diagnostics.savedFramePreparation = { requested: 'portrait-auto', selected, firstStatus, firstBlockingStage,
          firstRuntimeMs, elapsedMs: Math.round(performance.now() - preparationStarted) };
      }
      post({ type: 'frameDone', id: msg.id, result });
      return;
    }
  } catch (exc) {
    post({ type: 'error', id: (msg as any).id, message: exc instanceof Error ? `${exc.name}: ${exc.message}` : String(exc), stack: exc instanceof Error ? exc.stack : undefined });
  }
};

// Tweede evaluatie van dit script in dezelfde worker (WebKit, zie vite.config worker-opmerking): de eerste
// instantie houdt haar engine en handler; deze instantie mag de handler niet vervangen.
if (Number(g.__mk8Evals) > 1) {
  log(`workerscript opnieuw geëvalueerd (${diag()}); bestaande handler behouden`);
} else {
  self.onmessage = handler;
}
