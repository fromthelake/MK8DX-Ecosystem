// Port van OfflineParityPackagedRunner: stap 01 (RF-DETR + ROI), 02
// (adaptieve helderheid/contrast op geel-doel), 03 HSV-masker, 04 grijs,
// 05 CLAHE, 06 adaptive threshold; daarna de pipeline (07..27).
import { AutoCardRoiSelector, Box, GHOST_DETAIL_BADGE_COLUMN_ONLY, Selection, withDetections } from './roi';
import { cv, clampInt, cropClone } from './cv';
import type { RfDetrDetector } from './detector';
import type { Detection, DetectionResult, LayoutProfile } from './types';
import { removeWeakDuplicateLapIndex, removeWeakLapIndexOutlier, removeWeakOffLatticeLapIndex } from './lapIndexOutlier';
import { findLapCircles, lapCircleDetections, type LapCircleTemplates } from './lapCircles';

export interface StageListener {
  (status: 'started' | 'completed', stage: string): void;
}

export const LIVE_REVIEW_STAGE_ORDER = [
  '00_InputImage', '01_AutoCardROI', '02_AutoBrightnessContrast', '03_HSVMask', '04_Grayscale', '05_CLAHE',
  '06_AdaptiveThreshold', '07_FlowJoin', '08_MaskCombine', '09_MaskCleanup', '10_Morphology', '11_CannyEdges',
  '12_HoughLinesP', '13_AngleFilterLines', '14_ClusterLines', '15_QuadSelect', '16_RoiRestore', '17_PerspectiveWarp',
  '18_CanonicalPlayerBoxAlign', '19_RFDetr3ClassDetect', '20_RFDetrLapIndexRefine', '21_RFDetrDynamicLapGrid',
  '24_SevenSegmentOCRProbe', '26_OfflineOCRDecode',
];

export interface RoiStageResult {
  selection: Selection;
  detectionResult: DetectionResult | null;
  yellowReferences: Box[];
  status: string;
  reason: string;
  removedLapIndexOutlier?: Detection | null;
  removedLapIndexDuplicate?: Detection | null;
  removedLapIndexOffLattice?: Detection | null;
  /** Select-a-Ghost second look on a copy with a margin; null when not needed. */
  ghostDetailMarginRetry?: { scale: number; grey: boolean; shape?: boolean; accepted: boolean; lapIndexCount: number; ghostCount: number } | null;
}

/**
 * Select-a-Ghost: a phone photo through the scan guide can show the panel larger
 * than the detector was trained on; its lap badges then score ~0.4 and one goes
 * missing (Vivo, 2026-10-25). When the first look gives no ghost-detail support,
 * the detector looks again at a copy with an edge-replicated margin (panel
 * 1/scale the size) and its detections are mapped back. If that still fails it
 * looks at a grey copy: a bright background shining through the translucent
 * panel (the ghost's character badge behind the lap circles, N64 Royal Raceway)
 * hides the circles in colour but not in grey. Same as the APK.
 */
export const GHOST_DETAIL_MARGIN_SCALE = 1.4;

/** Detect on `bgr` (grey when asked) surrounded by an edge-replicated margin; detections in `bgr`'s normalized space. */
export async function detectWithMargin(bgr: any, detector: RfDetrDetector, scale: number, grey = false): Promise<DetectionResult> {
  const c = cv();
  const width = bgr.cols;
  const height = bgr.rows;
  const padX = Math.round((width * scale - width) / 2);
  const padY = Math.round((height * scale - height) / 2);
  const padded = new c.Mat();
  const source = new c.Mat();
  try {
    if (grey) {
      c.cvtColor(bgr, source, c.COLOR_BGR2GRAY);
      c.cvtColor(source, source, c.COLOR_GRAY2BGR);
    } else {
      bgr.copyTo(source);
    }
    c.copyMakeBorder(source, padded, padY, padY, padX, padX, c.BORDER_REPLICATE);
    const result = await detector.detect(padded);
    const pw = padded.cols;
    const ph = padded.rows;
    const back = (v: number, size: number, pad: number, full: number): number => Math.max(0, Math.min(1, (v * full - pad) / size));
    return {
      ...result,
      detections: result.detections.map((d) => ({
        ...d,
        left: back(d.left, width, padX, pw),
        top: back(d.top, height, padY, ph),
        right: back(d.right, width, padX, pw),
        bottom: back(d.bottom, height, padY, ph),
      })),
    };
  } finally {
    source.delete();
    padded.delete();
  }
}

export function roiRect(box: Box, width: number, height: number): { x: number; y: number; width: number; height: number } {
  const x = clampInt(Math.round(box.left), 0, Math.max(0, width - 1));
  const y = clampInt(Math.round(box.top), 0, Math.max(0, height - 1));
  const right = clampInt(Math.round(box.right), x + 1, width);
  const bottom = clampInt(Math.round(box.bottom), y + 1, height);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

/** Stap 01: detecteren + ROI kiezen (port van runAutoCardRoi). */
export async function runAutoCardRoi(bgr: any, detector: RfDetrDetector, layout: LayoutProfile, sparseDualYellowCandidate = false, lapIndexOutlierCandidate = false, lapIndexDuplicateCandidate = false, lapIndexLatticeCandidate = false, lapCircles: LapCircleTemplates | null = null): Promise<RoiStageResult> {
  const ghostDetailLayout = layout === 'ghost_detail';
  let detectionResult: DetectionResult;
  try {
    detectionResult = await detector.detect(bgr);
  } catch (exc) {
    const msg = exc instanceof Error ? exc.message : String(exc);
    return {
      selection: Selection.blocked('blocked_detector_runtime_error', msg, { candidateCount: 0, playerCount: 0, ghostCount: 0, lapIndexCount: 0 }),
      detectionResult: null,
      yellowReferences: [],
      status: 'blocked_detector_runtime_error',
      reason: msg,
    };
  }
  const duplicate = lapIndexDuplicateCandidate && !ghostDetailLayout
    ? removeWeakDuplicateLapIndex(detectionResult.detections)
    : { detections: detectionResult.detections, removed: null };
  const outlier = lapIndexOutlierCandidate && !ghostDetailLayout
    ? removeWeakLapIndexOutlier(duplicate.detections)
    : { detections: duplicate.detections, removed: null };
  const lattice = lapIndexLatticeCandidate && !ghostDetailLayout
    ? removeWeakOffLatticeLapIndex(outlier.detections)
    : { detections: outlier.detections, removed: null };
  if (duplicate.removed || outlier.removed || lattice.removed) detectionResult = { ...detectionResult, detections: lattice.detections };
  const width = bgr.cols;
  const height = bgr.rows;
  const hasPlayerDetection = detectionResult.detections.some((d) => d.label === 'player_timetrail_box');
  const yellowReferences = !ghostDetailLayout && !hasPlayerDetection ? yellowReferenceBoxes(bgr) : [];
  const yellowReference = yellowReferences.length === 0 ? null : yellowReferences[0];
  const selector = new AutoCardRoiSelector();
  const chooseRoi = (detections: Detection[]): Selection => {
    let selection = ghostDetailLayout
      ? selector.selectGhostDetail(detections, width, height)
      : selector.select(detections, width, height, yellowReferences);
    if (sparseDualYellowCandidate && !ghostDetailLayout && !selection.hasRoi()) {
      selection = selector.selectSparseDualYellowCandidate(detections, width, height, yellowReferences) ?? selection;
    }
    withDetections(selection, detections, width, height);
    const supportCounts = selection.counts;
    // A straight badge column may stand in for the rarely detected ghost box on
    // the Select-a-Ghost panel; the selector only allows it when no player card
    // is seen either (ADR-0203).
    const ghostBadgeColumnRoute = ghostDetailLayout && selection.hasRoi() && selection.candidate !== null && selection.candidate.reason === GHOST_DETAIL_BADGE_COLUMN_ONLY;
    const hasOwnerSupport = ghostDetailLayout ? supportCounts.ghostCount > 0 || ghostBadgeColumnRoute : supportCounts.playerCount > 0 || supportCounts.ghostCount > 0;
    const hasLapIndexSupport = supportCounts.lapIndexCount >= 3 || supportCounts.lapIndexCount === 6 || supportCounts.lapIndexCount === 14;
    const hasYellowPanelSupport = yellowReference !== null && selection.hasRoi() && !selection.fallbackUsed && selection.candidate !== null && selection.candidate.yellowSupportPass;
    const hasSupportedOwnerRoute = hasOwnerSupport || hasYellowPanelSupport;
    if (!selection.hasRoi() || !hasSupportedOwnerRoute || !hasLapIndexSupport) {
      const blocked = Selection.blocked(
        ghostDetailLayout ? 'blocked_missing_ghost_detail_support' : 'blocked_missing_supported_owner_lap_index_route',
        ghostDetailLayout
          ? 'Ghost-detail layout requires a ghost_timetrail_box detection plus at least three lap-index detections.'
          : 'Step 01 requires a supported route from RF-DETR owner-box evidence or image-derived yellow-panel support tied to lap-index geometry before running downstream packaged-image OCR.',
        supportCounts,
      );
      withDetections(blocked, detections, width, height);
      selection = blocked;
    }
    return selection;
  };
  let selection = chooseRoi(detectionResult.detections);
  let ghostDetailMarginRetry: RoiStageResult['ghostDetailMarginRetry'] = null;
  if (ghostDetailLayout && !selection.hasRoi()) {
    const ghostBoxes = detectionResult.detections.filter((d) => d.label === 'ghost_timetrail_box');
    for (const grey of [false, true]) {
      try {
        const retry = await detectWithMargin(bgr, detector, GHOST_DETAIL_MARGIN_SCALE, grey);
        ghostBoxes.push(...retry.detections.filter((d) => d.label === 'ghost_timetrail_box'));
        const retried = chooseRoi(retry.detections);
        ghostDetailMarginRetry = { scale: GHOST_DETAIL_MARGIN_SCALE, grey, accepted: retried.hasRoi(), lapIndexCount: retried.counts.lapIndexCount, ghostCount: retried.counts.ghostCount };
        if (retried.hasRoi()) {
          retried.extraLook = true;
          selection = retried;
          detectionResult = retry;
          break;
        }
      } catch {
        // The first look's result stands.
      }
    }
    // Last look: the lap circles 1-2-3 by shape (lapCircles.ts), with the strongest
    // ghost box any look saw. For the large badge behind the circles (3DS Koopa
    // City, 3DS Alpine Pass, GCN DK Mountain on the Vivo). Same as the APK.
    if (!selection.hasRoi() && lapCircles) {
      try {
        const column = findLapCircles(bgr, lapCircles);
        if (column) {
          const shaped = lapCircleDetections(column, width, height);
          const ghostBox = ghostBoxes.reduce<Detection | null>((best, box) => (best === null || box.score > best.score ? box : best), null);
          if (ghostBox) shaped.push(ghostBox);
          const retried = chooseRoi(shaped);
          ghostDetailMarginRetry = { scale: GHOST_DETAIL_MARGIN_SCALE, grey: true, shape: true, accepted: retried.hasRoi(), lapIndexCount: retried.counts.lapIndexCount, ghostCount: retried.counts.ghostCount };
          if (retried.hasRoi()) {
            retried.extraLook = true;
            selection = retried;
            detectionResult = { detections: shaped, timing: detectionResult.timing };
          }
        }
      } catch {
        // The earlier looks' result stands.
      }
    }
  }
  return { selection, detectionResult, yellowReferences, status: selection.hasRoi() ? 'implemented' : selection.status, reason: selection.reason, removedLapIndexOutlier: outlier.removed, removedLapIndexDuplicate: duplicate.removed, removedLapIndexOffLattice: lattice.removed, ghostDetailMarginRetry };
}

/** Gele referentieboxen (verbonden componenten van het kaart-geel-masker). */
export function yellowReferenceBoxes(bgr: any): Box[] {
  const c = cv();
  const mask = autoCardYellowMask(bgr);
  const labels = new c.Mat();
  const stats = new c.Mat();
  const centroids = new c.Mat();
  try {
    const count = c.connectedComponentsWithStats(mask, labels, stats, centroids);
    const minArea = Math.max(1000, Math.round(bgr.cols * bgr.rows * 0.00025));
    const components: { box: Box; score: number }[] = [];
    const s = stats.data32S as Int32Array;
    for (let i = 1; i < count; i++) {
      const area = s[i * 5 + c.CC_STAT_AREA];
      if (area < minArea) continue;
      const x = s[i * 5 + c.CC_STAT_LEFT];
      const y = s[i * 5 + c.CC_STAT_TOP];
      const bw = s[i * 5 + c.CC_STAT_WIDTH];
      const bh = s[i * 5 + c.CC_STAT_HEIGHT];
      const aspect = bw / Math.max(1.0, bh);
      const aspectScore = Math.max(0.0, 1.0 - Math.abs(aspect - 1.1) / 1.1);
      const score = area / Math.max(1.0, bw * bh) * 4.0 + aspectScore + Math.min(1.0, area / Math.max(1.0, bgr.cols * bgr.rows) * 60.0);
      components.push({ box: new Box(x, y, x + bw, y + bh), score });
    }
    components.sort((a, b) => b.score - a.score);
    return components.slice(0, 8).map((k) => k.box);
  } catch {
    return [];
  } finally {
    mask.delete();
    labels.delete();
    stats.delete();
    centroids.delete();
  }
}

export function autoCardYellowMask(bgr: any): any {
  const c = cv();
  const hsv = new c.Mat();
  const lab = new c.Mat();
  const hsvMask = new c.Mat();
  const labMask = new c.Mat();
  const mask = new c.Mat();
  try {
    c.cvtColor(bgr, hsv, c.COLOR_BGR2HSV);
    c.cvtColor(bgr, lab, c.COLOR_BGR2Lab);
    inRange(hsv, [12, 35, 80], [42, 255, 255], hsvMask);
    inRange(lab, [65, 0, 135], [255, 255, 255], labMask);
    c.bitwise_and(hsvMask, labMask, mask);
    const closeKernel = c.getStructuringElement(c.MORPH_RECT, new c.Size(11, 11));
    const openKernel = c.getStructuringElement(c.MORPH_RECT, new c.Size(5, 5));
    c.morphologyEx(mask, mask, c.MORPH_CLOSE, closeKernel);
    c.morphologyEx(mask, mask, c.MORPH_OPEN, openKernel);
    closeKernel.delete();
    openKernel.delete();
    return mask.clone();
  } finally {
    hsv.delete();
    lab.delete();
    hsvMask.delete();
    labMask.delete();
    mask.delete();
  }
}

export function inRange(src: any, lo: number[], hi: number[], dst: any): void {
  const c = cv();
  const low = new c.Mat(src.rows, src.cols, src.type(), new c.Scalar(...lo));
  const high = new c.Mat(src.rows, src.cols, src.type(), new c.Scalar(...hi));
  c.inRange(src, low, high, dst);
  low.delete();
  high.delete();
}

// ---------------------------------------------------------------- stap 02

export interface BrightnessChoice {
  brightness: number;
  contrast: number;
  score: number;
  edgeDensity: number;
  maskCoverage: number;
  meanLuma: number;
  reason: string;
  yellowError: number | null;
}

interface MeasurementRoi {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  applied: boolean;
  reason: string;
}

function measurementRoiFull(width: number, height: number, reason: string): MeasurementRoi {
  return { x1: 0, y1: 0, x2: width, y2: height, applied: false, reason };
}

function cropMeasurement(image: any, m: MeasurementRoi): any {
  const c = cv();
  return cropClone(image, m.x1, m.y1, Math.max(1, m.x2 - m.x1), Math.max(1, m.y2 - m.y1));
}

function measurementRoi(roiMat: any, selection: Selection): MeasurementRoi {
  if (!selection || !selection.roi || !selection.candidate || !selection.candidate.sourceBox) {
    return measurementRoiFull(roiMat.cols, roiMat.rows, 'missing_lap_index_metadata');
  }
  const candidate = selection.candidate;
  const source = candidate.sourceBox!;
  const lapW = candidate.lapIndexWidth > 0.0 ? candidate.lapIndexWidth : Math.max(1.0, source.width() / 1.3);
  const lapH = candidate.lapIndexHeight > 0.0 ? candidate.lapIndexHeight : Math.max(1.0, source.height() / 7.0);
  const fullLeft = source.left - lapW * 12.0;
  const fullTop = source.top - lapH * 1.4;
  const fullRight = source.right + lapW * 4.7;
  const fullBottom = source.bottom + lapH * 0.15;
  const x1 = clampInt(Math.round(fullLeft - selection.roi.left), 0, Math.max(0, roiMat.cols - 2));
  const y1 = clampInt(Math.round(fullTop - selection.roi.top), 0, Math.max(0, roiMat.rows - 2));
  const x2 = clampInt(Math.round(fullRight - selection.roi.left), x1 + 1, roiMat.cols);
  const y2 = clampInt(Math.round(fullBottom - selection.roi.top), y1 + 1, roiMat.rows);
  if (x2 <= x1 + 2 || y2 <= y1 + 2) return measurementRoiFull(roiMat.cols, roiMat.rows, 'invalid_lap_index_projected_small_box');
  return { x1, y1, x2, y2, applied: true, reason: 'lap_index_projected_small' };
}

const TARGET_HSV = hexToHsvCached('#d1ae3a');
const TARGET_LAB = hexToLabCached('#d1ae3a');

function hexToHsvCached(hex: string): () => number[] {
  let cached: number[] | null = null;
  return () => {
    if (!cached) cached = hexToHsv(hex);
    return cached;
  };
}

function hexToLabCached(hex: string): () => number[] {
  let cached: number[] | null = null;
  return () => {
    if (!cached) cached = hexToLab(hex);
    return cached;
  };
}

export function hexToHsv(hex: string): number[] {
  const c = cv();
  const r = parseInt(hex.substring(1, 3), 16);
  const g = parseInt(hex.substring(3, 5), 16);
  const b = parseInt(hex.substring(5, 7), 16);
  const color = c.matFromArray(1, 1, c.CV_8UC3, [b, g, r]);
  const hsv = new c.Mat();
  c.cvtColor(color, hsv, c.COLOR_BGR2HSV);
  const out = [hsv.data[0], hsv.data[1], hsv.data[2]];
  color.delete();
  hsv.delete();
  return out;
}

export function hexToLab(hex: string): number[] {
  const c = cv();
  const r = parseInt(hex.substring(1, 3), 16);
  const g = parseInt(hex.substring(3, 5), 16);
  const b = parseInt(hex.substring(5, 7), 16);
  const color = c.matFromArray(1, 1, c.CV_8UC3, [b, g, r]);
  const lab = new c.Mat();
  c.cvtColor(color, lab, c.COLOR_BGR2Lab);
  const out = [lab.data[0], lab.data[1], lab.data[2]];
  color.delete();
  lab.delete();
  return out;
}

function yellowError(medianHsv: number[], medianLab: number[]): number {
  const targetHsv = TARGET_HSV();
  const targetLab = TARGET_LAB();
  let hueDelta = Math.abs(medianHsv[0] - targetHsv[0]);
  hueDelta = Math.min(hueDelta, 180.0 - hueDelta) / 90.0;
  const saturationDelta = Math.abs(medianHsv[1] - targetHsv[1]) / 255.0;
  const valueDelta = Math.abs(medianHsv[2] - targetHsv[2]) / 255.0;
  const labBDelta = Math.abs(medianLab[2] - targetLab[2]) / 255.0;
  return hueDelta * 2.0 + saturationDelta * 0.8 + valueDelta * 0.35 + labBDelta * 0.8;
}

function predictedYellowError(bgr: number[]): number {
  const c = cv();
  // Java: (byte) Math.round(v) -> naar byte gecast (wraparound bij >127 is
  // onschadelijk omdat OpenCV weer & 0xff leest); waarden zijn 0..255 geklemd
  const color = c.matFromArray(1, 1, c.CV_8UC3, [Math.round(bgr[0]) & 0xff, Math.round(bgr[1]) & 0xff, Math.round(bgr[2]) & 0xff]);
  const hsv = new c.Mat();
  const lab = new c.Mat();
  c.cvtColor(color, hsv, c.COLOR_BGR2HSV);
  c.cvtColor(color, lab, c.COLOR_BGR2Lab);
  const out = yellowError([hsv.data[0], hsv.data[1], hsv.data[2]], [lab.data[0], lab.data[1], lab.data[2]]);
  color.delete();
  hsv.delete();
  lab.delete();
  return out;
}

function medianFromHistogram(hist: Int32Array, count: number): number {
  if (count <= 0) return 0.0;
  if ((count & 1) === 1) return histogramValueAt(hist, Math.trunc(count / 2) + 1);
  const lo = histogramValueAt(hist, Math.trunc(count / 2));
  const hi = histogramValueAt(hist, Math.trunc(count / 2) + 1);
  return (lo + hi) * 0.5;
}

function histogramValueAt(hist: Int32Array, targetOneBased: number): number {
  let seen = 0;
  for (let i = 0; i < hist.length; i++) {
    seen += hist[i];
    if (seen >= targetOneBased) return i;
  }
  return hist.length - 1;
}

function maskedMedianBgr(bgr: any, mask: any): number[] {
  const pixels = bgr.rows * bgr.cols;
  const d = bgr.data as Uint8Array;
  const m = mask.data as Uint8Array;
  const bH = new Int32Array(256);
  const gH = new Int32Array(256);
  const rH = new Int32Array(256);
  let count = 0;
  for (let i = 0; i < pixels; i++) {
    if (m[i] > 0) {
      const base = i * 3;
      bH[d[base]]++;
      gH[d[base + 1]]++;
      rH[d[base + 2]]++;
      count++;
    }
  }
  return [medianFromHistogram(bH, count), medianFromHistogram(gH, count), medianFromHistogram(rH, count)];
}

function maskedMedianChannel(mat: any, mask: any): number {
  const pixels = mat.rows * mat.cols;
  const d = mat.data as Uint8Array;
  const m = mask.data as Uint8Array;
  const hist = new Int32Array(256);
  let count = 0;
  for (let i = 0; i < pixels; i++) {
    if (m[i] > 0) {
      hist[d[i]]++;
      count++;
    }
  }
  return medianFromHistogram(hist, count);
}

function maskedColorStats(bgr: any, mask: any): { medianHsv: number[]; medianLab: number[] } | null {
  const c = cv();
  const hsv = new c.Mat();
  const lab = new c.Mat();
  try {
    c.cvtColor(bgr, hsv, c.COLOR_BGR2HSV);
    c.cvtColor(bgr, lab, c.COLOR_BGR2Lab);
    const pixels = bgr.rows * bgr.cols;
    const hd = hsv.data as Uint8Array;
    const ld = lab.data as Uint8Array;
    const m = mask.data as Uint8Array;
    const hH = new Int32Array(256);
    const sH = new Int32Array(256);
    const vH = new Int32Array(256);
    const bH = new Int32Array(256);
    let count = 0;
    for (let i = 0; i < pixels; i++) {
      if (m[i] > 0) {
        const base = i * 3;
        hH[hd[base]]++;
        sH[hd[base + 1]]++;
        vH[hd[base + 2]]++;
        bH[ld[base + 2]]++;
        count++;
      }
    }
    if (count <= 0) return null;
    return {
      medianHsv: [medianFromHistogram(hH, count), medianFromHistogram(sH, count), medianFromHistogram(vH, count)],
      medianLab: [0.0, 0.0, medianFromHistogram(bH, count)],
    };
  } finally {
    hsv.delete();
    lab.delete();
  }
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0.0;
  const mid = Math.trunc(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) * 0.5;
}

function scoreBrightnessCandidate(bgr: any, brightness: number, contrast: number, measurement: MeasurementRoi): BrightnessChoice {
  const c = cv();
  const measuredInput = cropMeasurement(bgr, measurement);
  const adjusted = new c.Mat();
  const gray = new c.Mat();
  const edges = new c.Mat();
  let yellow: any = null;
  try {
    const alpha = Math.max(0.05, 1.0 + contrast / 100.0);
    c.convertScaleAbs(measuredInput, adjusted, alpha, brightness);
    c.cvtColor(adjusted, gray, c.COLOR_BGR2GRAY);
    c.Canny(gray, edges, 60, 140);
    yellow = autoCardYellowMask(adjusted);
    const edgeDensity = c.countNonZero(edges) / Math.max(1.0, edges.rows * edges.cols);
    const maskCoverage = c.countNonZero(yellow) / Math.max(1.0, yellow.rows * yellow.cols);
    const meanLuma = c.mean(gray)[0] / 255.0;
    const edgeScore = Math.min(edgeDensity, 0.14) * 9.0;
    const coverageScore = Math.min(maskCoverage, 0.40) * 4.0;
    const lumaPenalty = Math.abs(meanLuma - 0.36) * 0.8;
    let score = edgeScore + coverageScore - lumaPenalty;
    const choice: BrightnessChoice = { brightness, contrast, score, edgeDensity, maskCoverage, meanLuma, reason: '', yellowError: null };
    const stats = maskedColorStats(adjusted, yellow);
    if (stats) {
      const ye = yellowError(stats.medianHsv, stats.medianLab);
      const coveragePenalty = Math.max(0.0, 0.02 - maskCoverage) * 30.0;
      score = -ye * 6.0 + edgeScore * 0.45 + Math.min(maskCoverage, 0.20) * 8.0 - lumaPenalty - coveragePenalty;
      choice.score = score;
      choice.yellowError = ye;
    } else {
      choice.score = -999.0 + edgeScore * 0.1;
    }
    return choice;
  } finally {
    measuredInput.delete();
    adjusted.delete();
    gray.delete();
    edges.delete();
    if (yellow) yellow.delete();
  }
}

interface YellowEstimate {
  brightness: number;
  contrast: number;
  alpha: number;
  beta: number;
  predictedYellowError: number;
}

function estimateYellowTarget(bgr: any, measurement: MeasurementRoi, contrastValues: number[]): YellowEstimate | null {
  const c = cv();
  const measured = cropMeasurement(bgr, measurement);
  let mask: any = null;
  const gray = new c.Mat();
  try {
    mask = autoCardYellowMask(measured);
    const maskCount = c.countNonZero(mask);
    if (maskCount <= 0) return null;
    const yellowBgr = maskedMedianBgr(measured, mask);
    c.cvtColor(measured, gray, c.COLOR_BGR2GRAY);
    maskedMedianChannel(gray, mask);
    const targetBgr = [0x3a, 0xae, 0xd1];
    let best: YellowEstimate | null = null;
    for (const contrast of contrastValues) {
      const alpha = Math.max(0.05, Math.min(3.55, 1.0 + contrast / 100.0));
      const betaParts = [targetBgr[0] - alpha * yellowBgr[0], targetBgr[1] - alpha * yellowBgr[1], targetBgr[2] - alpha * yellowBgr[2]];
      const brightness = Math.round(Math.max(-255.0, Math.min(255.0, medianOf(betaParts))));
      const predicted = [
        Math.max(0.0, Math.min(255.0, yellowBgr[0] * alpha + brightness)),
        Math.max(0.0, Math.min(255.0, yellowBgr[1] * alpha + brightness)),
        Math.max(0.0, Math.min(255.0, yellowBgr[2] * alpha + brightness)),
      ];
      const predictedError = predictedYellowError(predicted);
      const estimate: YellowEstimate = { brightness, contrast, alpha, beta: medianOf(betaParts), predictedYellowError: predictedError };
      if (!best || estimate.predictedYellowError < best.predictedYellowError) best = estimate;
    }
    return best;
  } finally {
    measured.delete();
    if (mask) mask.delete();
    gray.delete();
  }
}

/** Port van selectBrightnessContrast (step02ScoreDownscale: identity-only). */
export function selectBrightnessContrast(roiMat: any, selection: Selection, scoreDownscale: boolean, scoreMaxDim = 220, sweepTrace?: BrightnessChoice[], shortlist440 = false): BrightnessChoice {
  const c = cv();
  const measurement = measurementRoi(roiMat, selection);
  let scoringInput = cropMeasurement(roiMat, measurement);
  const maxDim = Math.max(scoringInput.cols, scoringInput.rows);
  if (scoreDownscale && maxDim > scoreMaxDim) {
    const scale = scoreMaxDim / maxDim;
    const scaled = new c.Mat();
    c.resize(scoringInput, scaled, new c.Size(Math.max(1, Math.round(scoringInput.cols * scale)), Math.max(1, Math.round(scoringInput.rows * scale))), 0, 0, c.INTER_AREA);
    scoringInput.delete();
    scoringInput = scaled;
  }
  const scoringMeasurement = measurementRoiFull(scoringInput.cols, scoringInput.rows, 'scoring_measurement_sample');
  const brightnessValues = [-90, -78, -70, -60, -54, -48, -40, -32, -20, 0, 10];
  const contrastValues = [15, 22, 30, 35, 44, 50, 58, 65];
  const maxAdaptivePredictedYellowError = 0.10;
  try {
    const estimate = estimateYellowTarget(scoringInput, scoringMeasurement, contrastValues);
    // Direct and micro scores are ineligible when this estimate fails its own
    // target-color gate. Skip their OpenCV work; the full sweep below is then
    // the only route that could have supplied a choice.
    if (estimate && estimate.predictedYellowError <= maxAdaptivePredictedYellowError) {
      const direct = scoreBrightnessCandidate(scoringInput, estimate.brightness, estimate.contrast, scoringMeasurement);
      direct.reason = 'adaptive_direct';
      if (direct.yellowError !== null && direct.yellowError <= 0.04 && direct.maskCoverage >= 0.02) {
        return direct;
      }
      const micro: BrightnessChoice[] = [];
      for (let db = -12; db <= 12; db += 4) {
        for (let dc = -8; dc <= 8; dc += 4) {
          const brightness = Math.max(-255, Math.min(255, estimate.brightness + db));
          const contrast = Math.max(-95, Math.min(255, estimate.contrast + dc));
          micro.push(scoreBrightnessCandidate(scoringInput, brightness, contrast, scoringMeasurement));
        }
      }
      // Collections.sort (stabiel) op score aflopend
      micro.sort((a, b) => (b.score > a.score ? 1 : b.score < a.score ? -1 : 0));
      if (micro.length > 0) {
        const bestMicro = micro[0];
        if (bestMicro.yellowError !== null && bestMicro.yellowError <= 0.04 && bestMicro.maskCoverage >= 0.02) {
          bestMicro.reason = 'adaptive_micro_sweep';
          return bestMicro;
        }
      }
    }
    let best: BrightnessChoice | null = null;
    // Small in-game card measurements are already cheap to score in full.
    // The extra coarse sweep also perturbs a separate flag matcher that still
    // reads an OpenCV buffer after release; keep that established path until
    // the flag matcher is independently repaired and qualified.
    if (shortlist440 && Math.max(scoringInput.cols, scoringInput.rows) >= 850) {
      let coarse: any = null;
      try {
        const dim = Math.max(scoringInput.cols, scoringInput.rows);
        if (dim > 440) {
          coarse = new c.Mat();
          const scale = 440 / dim;
          c.resize(scoringInput, coarse, new c.Size(Math.max(1, Math.round(scoringInput.cols * scale)), Math.max(1, Math.round(scoringInput.rows * scale))), 0, 0, c.INTER_AREA);
        }
        const sample = coarse ?? scoringInput;
        const sampleMeasurement = measurementRoiFull(sample.cols, sample.rows, 'scoring_measurement_sample');
        const ranking: BrightnessChoice[] = [];
        for (const brightness of brightnessValues) {
          for (const contrast of contrastValues) {
            ranking.push(scoreBrightnessCandidate(sample, brightness, contrast, sampleMeasurement));
          }
        }
        ranking.sort((a, b) => b.score - a.score);
        for (const choice of ranking.slice(0, 8)) {
          const candidate = scoreBrightnessCandidate(scoringInput, choice.brightness, choice.contrast, scoringMeasurement);
          if (!best || candidate.score > best.score) best = candidate;
        }
      } finally {
        if (coarse) coarse.delete();
      }
    } else {
      for (const brightness of brightnessValues) {
        for (const contrast of contrastValues) {
          const candidate = scoreBrightnessCandidate(scoringInput, brightness, contrast, scoringMeasurement);
          sweepTrace?.push(candidate);
          if (!best || candidate.score > best.score) best = candidate;
        }
      }
    }
    if (!best) {
      best = scoreBrightnessCandidate(scoringInput, -83, 50, scoringMeasurement);
      best.reason = 'fallback_no_candidates';
    } else {
      best.reason = 'full_sweep_fallback';
    }
    return best;
  } finally {
    scoringInput.delete();
  }
}

// ---------------------------------------------------------------- stap 03

export function hsvMaskStage(adjusted: any, choice: BrightnessChoice): any {
  const c = cv();
  let configuredMode = 'Two HEX range';
  let colorA = '#ffd747';
  let colorB = '#fff4d8';
  if (choice.reason === 'full_sweep_fallback') {
    configuredMode = 'Color picker';
    colorA = '#d1ae3a';
    colorB = '';
  }
  const hTol = 18;
  const sTol = 90;
  const vTol = 110;
  let hMin: number;
  let hMax: number;
  let sMin: number;
  let sMax: number;
  let vMin: number;
  let vMax: number;
  if (configuredMode === 'Color picker') {
    const target = hexToHsv(colorA);
    hMin = (target[0] - hTol + 180) % 180;
    hMax = (target[0] + hTol) % 180;
    sMin = Math.max(0, target[1] - sTol);
    sMax = Math.min(255, target[1] + sTol);
    vMin = Math.max(0, target[2] - vTol);
    vMax = Math.min(255, target[2] + vTol);
  } else {
    const hsvA = hexToHsv(colorA);
    const hsvB = hexToHsv(colorB);
    const hueBounds = twoHueBounds(hsvA[0], hsvB[0], hTol);
    hMin = hueBounds[0];
    hMax = hueBounds[1];
    sMin = Math.max(0, Math.min(hsvA[1], hsvB[1]) - sTol);
    sMax = Math.min(255, Math.max(hsvA[1], hsvB[1]) + sTol);
    vMin = Math.max(0, Math.min(hsvA[2], hsvB[2]) - vTol);
    vMax = Math.min(255, Math.max(hsvA[2], hsvB[2]) + vTol);
  }
  const hsv = new c.Mat();
  const mask = new c.Mat();
  c.cvtColor(adjusted, hsv, c.COLOR_BGR2HSV);
  if (hMin <= hMax) {
    inRange(hsv, [hMin, sMin, vMin], [hMax, sMax, vMax], mask);
  } else {
    const low = new c.Mat();
    const high = new c.Mat();
    inRange(hsv, [0, sMin, vMin], [hMax, sMax, vMax], low);
    inRange(hsv, [hMin, sMin, vMin], [179, sMax, vMax], high);
    c.bitwise_or(low, high, mask);
    low.delete();
    high.delete();
  }
  hsv.delete();
  return mask;
}

function twoHueBounds(h1: number, h2: number, pad: number): [number, number] {
  const a = ((h1 % 180) + 180) % 180;
  const b = ((h2 % 180) + 180) % 180;
  const p = Math.max(0, pad);
  const direct = Math.abs(a - b);
  if (direct <= 90) {
    const lo = Math.min(a, b) - p;
    const hi = Math.max(a, b) + p;
    if (lo < 0 || hi > 179) return [((lo % 180) + 180) % 180, ((hi % 180) + 180) % 180];
    return [lo, hi];
  }
  return [((Math.max(a, b) - p) % 180 + 180) % 180, ((Math.min(a, b) + p) % 180 + 180) % 180];
}

// ---------------------------------------------------------------- stappen 02-06 samen

export interface EarlyCvMats {
  roi: any;
  adjusted: any;
  hsvMask: any;
  gray: any;
  clahe: any;
  adaptive: any;
  choice: BrightnessChoice;
}

export function runEarlyCvStages(bgr: any, selection: Selection, scoreDownscale: boolean, listener: StageListener, scoreMaxDim = 220, shortlist440 = false): EarlyCvMats {
  const c = cv();
  const rect = roiRect(selection.roi!, bgr.cols, bgr.rows);
  listener('started', '02_AutoBrightnessContrast');
  const roiMat = cropClone(bgr, rect.x, rect.y, rect.width, rect.height);
  const choice = selectBrightnessContrast(roiMat, selection, scoreDownscale, scoreMaxDim, undefined, shortlist440);
  const alpha = Math.max(0.05, 1.0 + choice.contrast / 100.0);
  const adjusted = new c.Mat();
  c.convertScaleAbs(roiMat, adjusted, alpha, choice.brightness);
  listener('completed', '02_AutoBrightnessContrast');
  listener('started', '03_HSVMask');
  const hsvMask = hsvMaskStage(adjusted, choice);
  listener('completed', '03_HSVMask');
  listener('started', '04_Grayscale');
  const gray = new c.Mat();
  c.cvtColor(adjusted, gray, c.COLOR_BGR2GRAY);
  listener('completed', '04_Grayscale');
  listener('started', '05_CLAHE');
  const clahe = new c.CLAHE(5.9, new c.Size(10, 10));
  const claheOut = new c.Mat();
  clahe.apply(gray, claheOut);
  clahe.delete();
  listener('completed', '05_CLAHE');
  listener('started', '06_AdaptiveThreshold');
  const adaptive = new c.Mat();
  c.adaptiveThreshold(claheOut, adaptive, 255, c.ADAPTIVE_THRESH_GAUSSIAN_C, c.THRESH_BINARY, 29, 6);
  listener('completed', '06_AdaptiveThreshold');
  return { roi: roiMat, adjusted, hsvMask, gray, clahe: claheOut, adaptive, choice };
}

export function detectionsToJson(detections: Detection[]): Detection[] {
  return detections.map((d) => ({ ...d }));
}
