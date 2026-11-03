// Port van MainActivity.runScanAnalysis: burst van frames -> per frame de
// pijplijn -> ScanSession-bewijsladder -> lock -> identity-only stemframes
// (max SCAN_IDENTITY_EXTRA_FRAMES, vroege stop bij unanimiteit) -> resultaat.
// Voortgang = echte pipeline-stages (geen tijd-gebaseerde nep-voortgang).
import type { Engine } from './engine';
import { CancelledError, runFrame } from './pipeline';
import { runOpticalEndscreenCandidate } from './opticalPhotoCandidate';
import { LIVE_REVIEW_STAGE_ORDER } from './runner';
import { ScanSession } from './scanSession';
import type { Frame, FrameResult, LayoutProfile, ProgressEvent, ScanResult } from './types';

export const SCAN_BURST_FRAMES = 5;
export const SCAN_BURST_GAP_MS = 150;
export const SCAN_IDENTITY_EXTRA_FRAMES = 3;
/** finish-sprint + vlagmoment (MainActivity: Thread.sleep(750)) */
export const FINISH_HOLD_MS = 750;
/** Tijdlezing op camera- en galerijfoto's: de lap-som-bewaakte seed-, kolom-,
 *  totaal- en badgecontroles. Op 97 historische telefoonfoto's 804/872 →
 *  872/872 exacte tijden, zonder fout gelockte sessie (2026-10-23). */
export const SCAN_TIME_READ_OPTIONS = {
  strictLapSumSeedCandidate: true,
  ghostLapColumnCandidate: true,
  playerLapColumnCandidate: true,
  ghostTotalVerticalCandidate: true,
  lapIndexOutlierCandidate: true,
  lapIndexDuplicateCandidate: true,
  lapIndexLatticeCandidate: true,
  repairConfidenceGuardCandidate: true,
} as const;

export interface ScanRequest {
  frames: Frame[];
  layout: LayoutProfile;
  /** camera-burst (true) of galerij/single frame (false): stuurt step02-downscale bij identity-only */
  minimalArtifacts: boolean;
  wantCanonicalJpeg?: boolean;
  wantFieldCrops?: boolean;
  /** Diagnostics: every OCR crop and its text in diagnostics.ocr_crops (saved images only). */
  wantOcrCrops?: boolean;
  /** QA-only saved image comparison; ordinary callers leave this unset. */
  qaOpticalPhotoCandidate?: boolean;
}

/** Fase-label + totaalvoortgang: port van MainActivity.updateScanProgress. */
export function progressForStage(stage: string, identityOnly: boolean, votesDone: number, votesPlanned: number): { phase: ProgressEvent['phase']; frac: number } {
  const num = stage && stage.length >= 2 ? stage.substring(0, 2) : '';
  if (identityOnly) {
    const base = 0.80 + 0.20 * (votesDone / Math.max(1, votesPlanned));
    const span = 0.20 / Math.max(1, votesPlanned);
    const within = num === '27' ? 0.6 : 0.25;
    return { phase: 'confirm', frac: Math.min(0.995, base + span * within) };
  }
  if (num === '' || num <= '02') return { phase: 'card', frac: 0.10 + (num === '02' ? 0.15 : 0.0) };
  if (num <= '21') {
    let idx: number;
    const n = parseInt(num, 10);
    idx = Number.isNaN(n) ? 0.5 : (n - 3) / 18;
    return { phase: 'slots', frac: 0.25 + 0.25 * Math.max(0, Math.min(1, idx)) };
  }
  if (num <= '26') return { phase: 'read', frac: 0.50 + (num === '26' ? 0.10 : 0.04) };
  return { phase: 'setup', frac: 0.68 };
}

export class Scanner {
  private cancelled = false;
  private running = false;
  private qaPunctuationReference: Frame | null = null;

  constructor(private readonly engine: Engine) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** STOP: annuleert lopende analyse op de eerstvolgende stage-grens en alle volgende frames. */
  stop(): void {
    this.cancelled = true;
  }

  async scan(request: ScanRequest, onProgress: (event: ProgressEvent) => void, onFrame?: (index: number, result: FrameResult) => void): Promise<ScanResult> {
    if (this.running) throw new Error('scan loopt al');
    if (request.qaOpticalPhotoCandidate && (request.layout !== 'endscreen'
        || request.minimalArtifacts || request.frames.length !== 1))
      throw new Error('QA optical candidate requires one saved endscreen image');
    this.running = true;
    this.cancelled = false;
    const frames = request.frames;
    const session = new ScanSession();
    const started = performance.now();
    const timing: ScanResult['timing'] = [];
    const results: FrameResult[] = [];
    const votesPlanned = 1 + SCAN_IDENTITY_EXTRA_FRAMES;
    let votesDone = 0;
    let hardFrames = 0;
    let lockFrame = -1;
    let overall = 0.0;
    let stopped = false;
    const emit = (partial: Partial<ProgressEvent> & { stage: string; attemptIndex: number; identityOnly: boolean; frameProgress: number }) => {
      const p = progressForStage(partial.stage, partial.identityOnly, votesDone, votesPlanned);
      overall = Math.max(overall, p.frac); // hoofdbalk monotoon
      onProgress({
        phase: partial.phase ?? p.phase,
        overallProgress: partial.overallProgress ?? overall,
        attemptIndex: partial.attemptIndex,
        attemptCount: frames.length,
        frameProgress: partial.frameProgress,
        identityOnly: partial.identityOnly,
        difficultFrame: hardFrames > 0,
        stage: partial.stage,
        success: partial.success ?? false,
        failure: partial.failure ?? false,
        timesLocked: session.locked,
        elapsedMs: Math.round(performance.now() - started),
      });
    };
    try {
      emit({ stage: '00_InputImage', attemptIndex: 0, identityOnly: false, frameProgress: 0 });
      for (let i = 0; i < frames.length; i++) {
        if (this.cancelled) {
          stopped = true;
          break;
        }
        const frameNo = i + 1;
        const identityOnly = session.locked;
        emit({ stage: '00_InputImage', attemptIndex: frameNo, identityOnly, frameProgress: 0 });
        const completed = new Set<string>();
        const frameStart = performance.now();
        let prevElapsed = 0;
        const listener = (status: 'started' | 'completed', stage: string) => {
          const elapsed = performance.now() - frameStart;
          timing.push({ frame: frameNo, identityOnly, stage: `${status}:${stage}`, ms: Math.round(elapsed - prevElapsed) });
          prevElapsed = elapsed;
          if (status === 'completed' && LIVE_REVIEW_STAGE_ORDER.includes(stage)) completed.add(stage);
          const framePct = Math.min(100, Math.trunc((100 * completed.size) / LIVE_REVIEW_STAGE_ORDER.length));
          emit({ stage, attemptIndex: frameNo, identityOnly, frameProgress: framePct });
        };
        let result: FrameResult;
        try {
          const options = {
            ...SCAN_TIME_READ_OPTIONS,
            layout: request.layout,
            identityOnly,
            minimalArtifacts: request.minimalArtifacts,
            wantCanonicalJpeg: request.wantCanonicalJpeg,
            wantFieldCrops: request.wantFieldCrops && !session.locked,
            wantOcrCrops: request.wantOcrCrops === true,
          };
          result = request.qaOpticalPhotoCandidate
            ? await runOpticalEndscreenCandidate(frames[i], this.engine.deps,
              { ...options, characterTextLeftProbeCandidate: true,
                canonicalPunctuationShearCandidate: true,
                canonicalPunctuationReference: this.qaPunctuationReference ??=
                  await this.engine.source.image('demo_frames/demo_6_babypark7.jpg') },
              listener, () => this.cancelled)
            : await runFrame(frames[i], this.engine.deps, options, listener, () => this.cancelled);
        } catch (exc) {
          if (exc instanceof CancelledError) {
            stopped = true;
            break;
          }
          throw exc;
        }
        timing.push({ frame: frameNo, identityOnly, stage: 'frame_total', ms: Math.round(performance.now() - frameStart) });
        results.push(result);
        onFrame?.(i, result);
        let justLocked = false;
        if (!session.locked) {
          justLocked = session.update(result.fields, result.lapSumOk === true, result.lapSumRepairs, result.expectedFieldCount);
        }
        session.addIdentityVotes(result.kartConfig);
        if (session.locked) {
          votesDone++;
        } else if (!identityOnly) {
          hardFrames++;
        }
        if (justLocked) lockFrame = i;
        if (session.locked) {
          const identityExtra = i - lockFrame;
          if (identityExtra >= SCAN_IDENTITY_EXTRA_FRAMES) break;
          if (identityExtra >= 1 && session.identitySettled()) break;
        }
      }
      if (!stopped && session.locked) {
        // finish-sprint: hoofdbalk naar 100% + vlagmoment (750 ms, zoals de APK)
        onProgress({ phase: 'finish', overallProgress: 1.0, attemptIndex: Math.min(frames.length, results.length), attemptCount: frames.length, frameProgress: 100, identityOnly: true, difficultFrame: hardFrames > 0, stage: 'finish', success: true, failure: false, timesLocked: true, elapsedMs: Math.round(performance.now() - started) });
        await new Promise((r) => setTimeout(r, FINISH_HOLD_MS));
      } else if (!stopped) {
        onProgress({ phase: 'failed', overallProgress: overall, attemptIndex: results.length, attemptCount: frames.length, frameProgress: 0, identityOnly: false, difficultFrame: hardFrames > 0, stage: 'failed', success: false, failure: true, timesLocked: false, elapsedMs: Math.round(performance.now() - started) });
      }
      const identity = session.identitySnapshot();
      // player-only-frame: zonder ghost-tijdvelden is er geen ghostkaart
      const hasGhostFields = Object.keys(session.lockedFields).some((k) => k.startsWith('ghost_'));
      if (!hasGhostFields) delete identity.ghost;
      return {
        locked: !stopped && session.locked,
        acceptPath: stopped ? '' : session.acceptPath,
        layout: request.layout,
        raceProfile: results.find((r) => r.raceProfile)?.raceProfile ?? '',
        lockedFrameIndex: lockFrame,
        framesAnalyzed: session.framesAnalyzed,
        okFrames: session.okFrames,
        fields: stopped ? {} : { ...session.lockedFields },
        identity: stopped ? {} : identity,
        frames: results,
        timing,
        totalMs: Math.round(performance.now() - started),
        stopped,
      };
    } finally {
      this.running = false;
    }
  }
}
