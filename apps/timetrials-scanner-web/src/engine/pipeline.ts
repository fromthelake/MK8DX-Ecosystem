// Port van OfflineParityNativePipeline (07..27) + de aanroep vanuit
// OfflineParityPackagedRunner.runLiveBitmap. Zelfde stappen, drempels,
// seed-volgorde, lap-som-logica en node-27-volgorde als de APK.
import { PANEL_RANSAC_THRESHOLD, registerPanel as registerCentralPanel } from '../../../../packages/icon-matcher/ts/sharedPanelRegistration';
import { HOUGH_MIN_LINE_LENGTH_PX, QuadLine as Line, clusterLines, filterAngles, ghostDetailDeskewSeed as centralDeskewSeed,
  selectQuad as centralSelectQuad, shortLineGuard as applyShortLineGuard } from '../../../../packages/icon-matcher/ts/sharedCardQuad';
import { buildDynamicGrid as buildCentralLapGrid, canonicalLapIndexBoxes as centralLapIndexBoxes } from '../../../../packages/icon-matcher/ts/sharedLapGrid';
import type { LapCircleTemplates } from './lapCircles';
import { bgrMatToPngDataUrl } from './imageio';
import { cv, clampInt, f32, rgbaToBgrMat } from './cv';
import type { RfDetrDetector } from './detector';
import type { KartConfigMatcher } from './kartConfig';
import { RACE_KEY_GHOST_DETAIL, RACE_KEY_GHOST_DETAIL7 } from './kartConfig';
import { familyOf } from './cleanAssets';
import { Box, Selection } from './roi';
import { LIVE_REVIEW_STAGE_ORDER, runAutoCardRoi, runEarlyCvStages, inRange, type StageListener } from './runner';
import { GHOST_PANEL_ANCHORS, GHOST_PANEL_ANCHOR_MARGIN } from './ghostPanelReference';
import { applyOwnerPresenceCandidate } from './ownerPresenceCandidate';
import { fitYellowPlayerCardEdge, opticalBoxConflict } from './opticalCardEdge';
import { fitOpticalBadgeRowQuad } from './opticalBadgeRowQuad';
import { fitCanonicalPunctuationShear } from './canonicalPunctuationShear';
import { withholdSparseRecoveryIdentities } from './sparseRecoveryIdentityGuard';
import { SEGMENT_KEYS, SegmentTemplate, bestSegmentCandidate, canonicalSegmentSlotSize, decodePattern, segmentScores } from './segments';
import { lapSumClosure, lapSumComplete, repairGuard } from '../../../../packages/icon-matcher/ts/sharedTimeDecision';
import type { Detection, DetectionResult, FieldDetail, Frame, FrameDiagnostics, FrameResult, IdentityEntry, KartConfigResult, LayoutProfile, OwnerIdentity } from './types';

const CANONICAL_PLAYER_BOX_RACE7 = [548.0, 362.0, 1231.0, 661.0];
const CANONICAL_GHOST_BOX_RACE7 = [548.0, 42.0, 1231.0, 349.0];
const CANONICAL_GHOST_DETAIL_BOX_RACE3 = [540.0, 170.0, 782.0, 331.0];
const CANONICAL_GHOST_DETAIL_BOX_RACE7 = [540.0, 120.0, 767.0, 379.0];
const TIME_RE = /^\d:\d\d\.\d\d\d$/;
const SEGMENT_DIGIT_POSITIONS = [0, 2, 3, 5, 6, 7];

export interface PipelineDeps {
  detector: RfDetrDetector;
  relGrid: any;
  relGridGhostDetail: any;
  lapTemplate: SegmentTemplate;
  totalTemplate: SegmentTemplate;
  kartConfig: KartConfigMatcher | null;
  /** The pack's lap-circle templates for the Select-a-Ghost panel's last look (lapCircles.ts). */
  lapCircles?: LapCircleTemplates | null;
}

export interface RunOptions {
  layout: LayoutProfile;
  identityOnly: boolean;
  /** minimalArtifacts in de APK: camera-frames (true) vs galerij (false) */
  minimalArtifacts: boolean;
  wantCanonicalJpeg?: boolean;
  wantFieldCrops?: boolean;
  wantOcrCrops?: boolean;
  /** Private QA: retain compact icon decisions for each already attempted image warp. */
  qaSeedIdentityTrace?: boolean;
  /** Research only: in-game badge/yellow-panel recovery for blocked dual cards. */
  sparseDualYellowCandidate?: boolean;
  /** Research only: try the next in-game localization seed when lap sums do not close. */
  strictLapSumSeedCandidate?: boolean;
  /** Offline QA only: externally fitted in-game player-card corners in input pixels. */
  researchPlayerCardQuad?: [number, number][];
  /** Offline QA only: bypass the first development guard to measure a proposed quad's full read. */
  researchPlayerCardQuadForce?: boolean;
  /** Offline optical QA: try a research warp only after ordinary game-card seeds fail lap-sum closure. */
  researchQuadAfterBaselineCandidate?: boolean;
  /** Offline optical QA: resolve 3/7 laps from regular badge rows inside game-card boxes. */
  researchGameAnchorLapProfileCandidate?: boolean;
  /** Offline QA only: measured small canonical x-error, dx(y) = slope*y + intercept. */
  researchCanonicalShear?: [number, number];
  /** Opt-in QA: fit a small canonical correction from game punctuation and badge rows. */
  canonicalPunctuationShearCandidate?: boolean;
  /** Read-only direct-capture calibration frame, supplied explicitly by the QA caller. */
  canonicalPunctuationReference?: Frame;
  /** Opt-in optical QA: compare a complete yellow game-card edge inside this seed loop. */
  inlineOpticalCardEdgeCandidate?: boolean;
  /** Opt-in optical QA: allow the RAW badge/part-row/card-rail fallback. */
  opticalBadgeRowCandidate?: boolean;
  /** Opt-in optical QA: run a badge-row seed inside the existing scan. */
  inlineOpticalBadgeRowCandidate?: boolean;
  /** Research only: align ghost-lap digit columns across repeated in-game rows. */
  ghostLapColumnCandidate?: boolean;
  /** Research only: rescue unread player-lap columns with repeated in-game rows. */
  playerLapColumnCandidate?: boolean;
  ghostTotalVerticalCandidate?: boolean;
  characterRescueFamilyGuardCandidate?: boolean;
  /** Research only: score installed icon references without pooled crop brightness gain. */
  rawRgbCandidate?: boolean;
  /** Research only: require review when wheel icon and in-game row text disagree. */
  wheelTextConflictReviewCandidate?: boolean;
  /** Research only: require review when a reliable in-game glider row contradicts the icon family. */
  gliderTextConflictReviewCandidate?: boolean;
  /** Research only: align fallback icon slots to a detected in-game result card. */
  cardBoxAlignCandidate?: boolean;
  /** Research only: retry a weak in-game glider row eight pixels higher. */
  gliderRowUpshiftCandidate?: boolean;
  /** Research only: show the in-game wheel-text ID on conflict while retaining review. */
  wheelTextProposalCandidate?: boolean;
  /** Research only: review a flag whose matched lower band is blue but its selected reference is not. */
  flagBlueBandReviewCandidate?: boolean;
  /** Research only: keep a flag choice under review when stripe color opposes the gray-NCC winner. */
  flagChromaticBandReviewCandidate?: boolean;
  /** Research only: retain names but review every optical identity on a severely defocused Ghost panel. */
  opticalSharpnessReviewCandidate?: boolean;
  achromaticGapCandidate?: boolean;
  /** Research only: family-only kart text cannot certify a colour variant after an uncertain icon match. */
  kartVariantTextReviewCandidate?: boolean;
  /** Research only: propose a kart colour from a second in-game icon search, still requiring review. */
  kartFamilySearchCandidate?: boolean;
  ownerPresenceCandidate?: boolean;
  /** Research only: retry a weak player name with a wider left edge. */
  characterTextLeftProbeCandidate?: boolean;
  /** Research only: shortlist fallback choices at 440 px, then verify at full resolution. */
  brightnessShortlist440Candidate?: boolean;
  /** Research only: reject one weak off-column lap badge amid six strong in-game badges. */
  lapIndexOutlierCandidate?: boolean;
  /** Research only: suppress one duplicate badge when two three-row cards remain. */
  lapIndexDuplicateCandidate?: boolean;
  /** Research only: keep two regular three-lap in-game badge rows over one weak extra. */
  lapIndexLatticeCandidate?: boolean;
  /** A lap sum closed only by a repair counts only when every digit read cleanly. */
  repairConfidenceGuardCandidate?: boolean;
}

export class CancelledError extends Error {
  constructor() {
    super('scan gestopt');
    this.name = 'CancelledError';
  }
}

// ------------------------------------------------------------------ geometrie

interface Pt {
  x: number;
  y: number;
}

class Quad {
  constructor(readonly tl: Pt, readonly tr: Pt, readonly br: Pt, readonly bl: Pt) {}

  shifted(dx: number, dy: number): Quad {
    return new Quad({ x: this.tl.x + dx, y: this.tl.y + dy }, { x: this.tr.x + dx, y: this.tr.y + dy }, { x: this.br.x + dx, y: this.br.y + dy }, { x: this.bl.x + dx, y: this.bl.y + dy });
  }

  points(): Pt[] {
    return [this.tl, this.tr, this.br, this.bl];
  }
}

interface RectI {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Below this warp scale, area-average first until the warp keeps the target scale. */
const ANTIALIAS_BELOW_SCALE = 0.5;
const ANTIALIAS_TARGET_SCALE = 0.8;

const GHOST_DETAIL_DESKEW_SEED = 'ghost_detail_deskew_seed';

/**
 * ghost_detail: the ROI seed turned with the panel (central sharedCardQuad ghostDetailDeskewSeed:
 * the lap-index badge column measures the turn), in ROI-crop coordinates, or null.
 */
function ghostDetailDeskewSeed(selection: Selection, roiBox: Box, cropW: number, cropH: number): { quad: Quad; degrees: number } | null {
  const seed = centralDeskewSeed(selection.detections, selection.frameWidth, selection.frameHeight, roiBox.left,
    roiBox.top, cropW, cropH);
  return seed ? { quad: new Quad(seed.quad[0], seed.quad[1], seed.quad[2], seed.quad[3]), degrees: seed.degrees } : null;
}

function quadFromRect(rect: RectI): Quad {
  return new Quad(
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width - 1, y: rect.y },
    { x: rect.x + rect.width - 1, y: rect.y + rect.height - 1 },
    { x: rect.x, y: rect.y + rect.height - 1 },
  );
}

class BoxD {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;

  constructor(left: number, top: number, right: number, bottom: number) {
    this.left = Math.min(left, right);
    this.top = Math.min(top, bottom);
    this.right = Math.max(left, right);
    this.bottom = Math.max(top, bottom);
  }

  clipped(width: number, height: number): BoxD {
    return new BoxD(Math.max(0, Math.min(width - 1, this.left)), Math.max(0, Math.min(height - 1, this.top)), Math.max(1, Math.min(width, this.right)), Math.max(1, Math.min(height, this.bottom)));
  }

  width(): number {
    return Math.max(1.0, this.right - this.left);
  }

  height(): number {
    return Math.max(1.0, this.bottom - this.top);
  }

  centerX(): number {
    return (this.left + this.right) * 0.5;
  }

  centerY(): number {
    return (this.top + this.bottom) * 0.5;
  }

  toRect(width: number, height: number): RectI {
    const x = Math.max(0, Math.min(width - 1, Math.round(this.left)));
    const y = Math.max(0, Math.min(height - 1, Math.round(this.top)));
    const r = Math.max(x + 1, Math.min(width, Math.round(this.right)));
    const b = Math.max(y + 1, Math.min(height, Math.round(this.bottom)));
    return { x, y, width: r - x, height: b - y };
  }

  toArray(): [number, number, number, number] {
    return [this.left, this.top, this.right, this.bottom];
  }
}

// ------------------------------------------------------------------ masks/lines (07-14)

function cleanupMask(input: any): any {
  const c = cv();
  const binary = new c.Mat();
  const labels = new c.Mat();
  const stats = new c.Mat();
  const centroids = new c.Mat();
  const cleaned = c.Mat.zeros(input.rows, input.cols, c.CV_8UC1);
  try {
    c.threshold(input, binary, 0, 255, c.THRESH_BINARY | c.THRESH_OTSU);
    const count = c.connectedComponentsWithStats(binary, labels, stats, centroids);
    const s = stats.data32S as Int32Array;
    const keep = new Uint8Array(count);
    for (let i = 1; i < count; i++) keep[i] = s[i * 5 + c.CC_STAT_AREA] >= 80 ? 1 : 0;
    const lab = labels.data32S as Int32Array;
    const out = cleaned.data as Uint8Array;
    for (let p = 0; p < lab.length; p++) if (keep[lab[p]]) out[p] = 255;
    const holes = fillHoles(cleaned);
    const fillCoverage = c.countNonZero(holes) / Math.max(1.0, holes.rows * holes.cols);
    if (fillCoverage <= 0.85) holes.copyTo(cleaned);
    holes.delete();
    return cleaned.clone();
  } finally {
    binary.delete();
    labels.delete();
    stats.delete();
    centroids.delete();
    cleaned.delete();
  }
}

function fillHoles(mask: any): any {
  const c = cv();
  const flood = mask.clone();
  const floodMask = c.Mat.zeros(mask.rows + 2, mask.cols + 2, c.CV_8UC1);
  const inverted = new c.Mat();
  const filled = new c.Mat();
  try {
    c.floodFill(flood, floodMask, new c.Point(0, 0), new c.Scalar(255));
    c.bitwise_not(flood, inverted);
    c.bitwise_or(mask, inverted, filled);
    return filled.clone();
  } finally {
    flood.delete();
    floodMask.delete();
    inverted.delete();
    filled.delete();
  }
}

function houghLines(edges: any): Line[] {
  const c = cv();
  const raw = new c.Mat();
  const lines: Line[] = [];
  try {
    c.HoughLinesP(edges, raw, 1.0, Math.PI / 180.0, 35, HOUGH_MIN_LINE_LENGTH_PX, 22.0);
    const d = raw.data32S as Int32Array;
    for (let i = 0; i < raw.rows; i++) lines.push(new Line(d[i * 4], d[i * 4 + 1], d[i * 4 + 2], d[i * 4 + 3]));
    return lines;
  } finally {
    raw.delete();
  }
}

/** The best card quad from the clustered lines (central sharedCardQuad selectQuad), or null. */
function selectQuad(maskRows: number, maskCols: number, clusters: Line[]): Quad | null {
  const quad = centralSelectQuad(maskCols, maskRows, clusters);
  return quad ? new Quad(quad[0], quad[1], quad[2], quad[3]) : null;
}

function boundingRect(quad: Quad, width: number, height: number): RectI {
  let minX = Number.MAX_VALUE;
  let minY = Number.MAX_VALUE;
  let maxX = -Number.MAX_VALUE;
  let maxY = -Number.MAX_VALUE;
  for (const p of quad.points()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const x = Math.max(0, Math.min(width - 1, Math.floor(minX)));
  const y = Math.max(0, Math.min(height - 1, Math.floor(minY)));
  const right = Math.max(x + 1, Math.min(width, Math.ceil(maxX)));
  const bottom = Math.max(y + 1, Math.min(height, Math.ceil(maxY)));
  return { x, y, width: right - x, height: bottom - y };
}

function boxFromQuad(quad: Quad): BoxD {
  let left = Number.MAX_VALUE;
  let top = Number.MAX_VALUE;
  let right = -Number.MAX_VALUE;
  let bottom = -Number.MAX_VALUE;
  for (const p of quad.points()) {
    left = Math.min(left, p.x);
    top = Math.min(top, p.y);
    right = Math.max(right, p.x);
    bottom = Math.max(bottom, p.y);
  }
  return new BoxD(left, top, right, bottom);
}

function boxIou(a: BoxD, b: BoxD): number {
  const intersection = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
    * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return intersection / Math.max(1, a.width() * a.height() + b.width() * b.height() - intersection);
}

// ------------------------------------------------------------------ warp (17/18)

function perspectiveHomography(quad: Quad, bounds: RectI): any {
  const c = cv();
  const p = quad.points();
  const src = c.matFromArray(4, 1, c.CV_32FC2, [p[0].x, p[0].y, p[1].x, p[1].y, p[2].x, p[2].y, p[3].x, p[3].y]);
  const dst = c.matFromArray(4, 1, c.CV_32FC2, [
    bounds.x, bounds.y,
    bounds.x + bounds.width - 1, bounds.y,
    bounds.x + bounds.width - 1, bounds.y + bounds.height - 1,
    bounds.x, bounds.y + bounds.height - 1,
  ]);
  const h = c.getPerspectiveTransform(src, dst);
  src.delete();
  dst.delete();
  return h;
}

function warpFullImageTransform(source: any, homography: any): any {
  const c = cv();
  const warped = new c.Mat();
  c.warpPerspective(source, warped, homography, new c.Size(source.cols, source.rows), c.INTER_LINEAR, c.BORDER_REPLICATE, new c.Scalar());
  return warped;
}

interface YellowSlot {
  position: string | null;
  topScore: number;
  bottomScore: number;
}

function detectYellowPlayerSlot(bgr: any): YellowSlot {
  const c = cv();
  const hsv = new c.Mat();
  const lab = new c.Mat();
  try {
    c.cvtColor(bgr, hsv, c.COLOR_BGR2HSV);
    c.cvtColor(bgr, lab, c.COLOR_BGR2Lab);
    const top = yellowSlotScore(hsv, lab, 0.42, 0.06, 0.98, 0.50);
    const bottom = yellowSlotScore(hsv, lab, 0.42, 0.50, 0.98, 0.93);
    let position: string | null = null;
    if (Math.max(top, bottom) >= 0.08 && Math.abs(top - bottom) >= 0.04) position = top > bottom ? 'top' : 'bottom';
    return { position, topScore: top, bottomScore: bottom };
  } finally {
    hsv.delete();
    lab.delete();
  }
}

function yellowSlotScore(hsv: any, lab: any, rx1: number, ry1: number, rx2: number, ry2: number): number {
  const c = cv();
  const x1 = Math.max(0, Math.min(hsv.cols - 1, Math.round(rx1 * hsv.cols)));
  const y1 = Math.max(0, Math.min(hsv.rows - 1, Math.round(ry1 * hsv.rows)));
  const x2 = Math.max(x1 + 1, Math.min(hsv.cols, Math.round(rx2 * hsv.cols)));
  const y2 = Math.max(y1 + 1, Math.min(hsv.rows, Math.round(ry2 * hsv.rows)));
  const rect = new c.Rect(x1, y1, x2 - x1, y2 - y1);
  const hsvRoi = hsv.roi(rect);
  const labRoi = lab.roi(rect);
  const hsvMask = new c.Mat();
  const labMask = new c.Mat();
  const yellowMask = new c.Mat();
  try {
    const total = Math.max(1, hsvRoi.rows * hsvRoi.cols);
    inRange(hsvRoi, [12, 35, 80], [40, 255, 255], hsvMask);
    inRange(labRoi, [75, 0, 145], [255, 255, 255], labMask);
    c.bitwise_and(hsvMask, labMask, yellowMask);
    return c.countNonZero(yellowMask) / total;
  } finally {
    hsvRoi.delete();
    labRoi.delete();
    hsvMask.delete();
    labMask.delete();
    yellowMask.delete();
  }
}

interface CanonicalAlign {
  currentBox: BoxD;
  targetBox: BoxD;
  scaleX: number;
  scaleY: number;
  translateX: number;
  translateY: number;
  yellowPosition: string | null;
  raceKey: string;
  targetBoxSource: string;
}

function inferStep01RaceKey(selection: Selection | null): string {
  if (!selection || !selection.candidate) return 'race7';
  const candidate = selection.candidate;
  const selectedSupport = Math.max(candidate.lapIndexCount, Math.max(candidate.playerLapIndexCount, candidate.ghostLapIndexCount));
  const totalSupport = selection.counts ? selection.counts.lapIndexCount : 0;
  if (selectedSupport >= 2 && selectedSupport <= 3 && totalSupport <= 8) return 'race3';
  if (selectedSupport >= 5 || totalSupport >= 10) return 'race7';
  return 'race7';
}

function inferGameAnchorLapProfile(selection: Selection | null): string | null {
  if (!selection || !selection.playerOwnerBox || selection.frameWidth <= 0 || selection.frameHeight <= 0) return null;
  const player = selection.playerOwnerBox;
  const ghost = selection.ghostOwnerBox;
  const playerRows: { y: number; score: number }[] = [];
  let ghostCount = 0;
  for (const detection of selection.detections) {
    if (detection.label !== 'lap_index') continue;
    const x = (detection.left + detection.right) * selection.frameWidth * .5;
    const y = (detection.top + detection.bottom) * selection.frameHeight * .5;
    const inPlayer = x >= player.left && x <= player.right && y >= player.top && y <= player.bottom;
    const inGhost = ghost !== null && x >= ghost.left && x <= ghost.right && y >= ghost.top && y <= ghost.bottom;
    if (inPlayer && !inGhost) playerRows.push({ y, score: detection.score });
    if (inGhost && !inPlayer) ghostCount++;
  }
  // The detector may add one weak lap badge beside three or seven clear ones.
  // Use only that score gap; no expected time, asset ID or external label enters
  // the profile choice. Ambiguous groups keep the previous fallback behavior.
  const ordered = [...playerRows].sort((a, b) => b.score - a.score);
  const supportedCount = ordered.length === 4 ? 3 : ordered.length === 8 ? 7 : null;
  const selected = supportedCount !== null
    && ordered[supportedCount - 1].score >= .7
    && ordered[supportedCount].score < .5
    && ordered[supportedCount - 1].score - ordered[supportedCount].score >= .25
      ? ordered.slice(0, supportedCount) : playerRows;
  const rows = selected.map((row) => row.y);
  if (rows.length !== 3 && rows.length !== 7) return null;
  rows.sort((a, b) => a - b);
  const gaps = rows.slice(1).map((y, index) => y - rows[index]);
  const pitch = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  if (pitch <= 0 || Math.max(...gaps) - Math.min(...gaps) > .12 * pitch) return null;
  const pitchToHeight = pitch / player.height();
  if (rows.length === 3 && pitchToHeight >= .14 && pitchToHeight <= .27
      && (!ghost || (ghostCount >= 2 && ghostCount <= 4))) return 'race3';
  if (rows.length === 7 && pitchToHeight >= .07 && pitchToHeight <= .13
      && (!ghost || (ghostCount >= 5 && ghostCount <= 8))) return 'race7';
  return null;
}

// ------------------------------------------------------------------ grid (21)

interface LapMatch {
  detIndex: number;
  rowIndex: number;
  canonical: BoxD;
  detected: BoxD;
  distance: number;
  score: number;
}

interface RowRefinement {
  anchorX: number;
  anchorY: number;
  refinedX: number;
  refinedY: number;
  scaleX: number;
  scaleY: number;
  source: string;
}

interface FieldBox {
  name: string;
  owner: string;
  type: 'lap' | 'total';
  lapIndex: number;
  box: BoxD;
  slots: BoxD[];
}

interface DynamicGrid {
  available: boolean;
  status: string;
  reason: string;
  raceKey: string;
  activeLapCount: number;
  expectedFieldCount: number;
  activeOwners: string[];
  fields: FieldBox[];
  ownerAnchors: Map<string, [number, number]>;
  matchedLapIndexCount: number;
}

function detectionBoxD(d: Detection, width: number, height: number): BoxD {
  return new BoxD(d.left * width, d.top * height, d.right * width, d.bottom * height);
}

class Pipeline {
  private readonly relGrid: any;
  private readonly layout: LayoutProfile;
  constructor(private readonly deps: PipelineDeps, private readonly options: RunOptions) {
    this.layout = options.layout;
    this.relGrid = options.layout === 'ghost_detail' ? deps.relGridGhostDetail : deps.relGrid;
  }

  isGhostDetail(): boolean {
    return this.layout === 'ghost_detail';
  }

  raceOwners(raceKey: string): any {
    const race = this.relGrid ? this.relGrid[raceKey] : null;
    return race ? race.owners ?? null : null;
  }

  ownerGridForRace(raceKey: string, owner: string): any {
    const owners = this.raceOwners(raceKey);
    return owners ? owners[owner] ?? null : null;
  }

  canonicalTargetBox(owner: string, raceKey: string): { box: number[]; source: string } {
    const race7 = owner === 'ghost' ? CANONICAL_GHOST_BOX_RACE7 : CANONICAL_PLAYER_BOX_RACE7;
    if (raceKey !== 'race3') return { box: race7, source: 'fixed_race7_canonical_target' };
    const race3Content = this.ownerContentExtent('race3', owner);
    const race7Content = this.ownerContentExtent('race7', owner);
    if (!race3Content || !race7Content) return { box: race7, source: 'fallback_fixed_race7_missing_relative_grid_content_extent' };
    const leftMargin = race7Content.left - race7[0];
    const topMargin = race7Content.top - race7[1];
    const rightMargin = race7[2] - race7Content.right;
    const bottomMargin = race7[3] - race7Content.bottom;
    return {
      box: [race3Content.left - leftMargin, race3Content.top - topMargin, race3Content.right + rightMargin, race3Content.bottom + bottomMargin],
      source: 'derived_from_race3_relative_grid_using_race7_card_content_margins',
    };
  }

  ownerContentExtent(raceKey: string, owner: string): BoxD | null {
    const ownerGrid = this.ownerGridForRace(raceKey, owner);
    if (!ownerGrid) return null;
    const boxes: BoxD[] = [];
    for (const key of ['lap_index_boxes_rel', 'total_strip_rel', 'lap_strips_rel']) {
      const value = ownerGrid[key];
      if (Array.isArray(value)) appendRelativeBoxArray(ownerGrid, value, boxes);
    }
    if (boxes.length === 0) return null;
    return union(boxes);
  }

  canonicalAlign(warp: any, currentQuad: Quad, selection: Selection | null, gameAnchorLapProfile = false): CanonicalAlign {
    const yellow = this.isGhostDetail() ? { position: null, topScore: 0, bottomScore: 0 } : detectYellowPlayerSlot(warp);
    const owner = this.isGhostDetail() ? 'ghost' : (yellow.position === 'top' ? 'ghost' : 'player');
    const raceKey = (gameAnchorLapProfile ? inferGameAnchorLapProfile(selection) : null) ?? inferStep01RaceKey(selection);
    const targetProfile = this.isGhostDetail()
      ? { box: raceKey === 'race7' ? CANONICAL_GHOST_DETAIL_BOX_RACE7 : CANONICAL_GHOST_DETAIL_BOX_RACE3, source: `fixed_ghost_detail_canonical_target_${raceKey === 'race7' ? 'race7' : 'race3'}` }
      : this.canonicalTargetBox(owner, raceKey);
    const target = targetProfile.box;
    const currentBox = boxFromQuad(currentQuad);
    const targetBox = new BoxD(target[0], target[1], target[2], target[3]);
    const sx = targetBox.width() / Math.max(1.0, currentBox.width());
    const sy = targetBox.height() / Math.max(1.0, currentBox.height());
    const tx = targetBox.left - currentBox.left * sx;
    const ty = targetBox.top - currentBox.top * sy;
    return { currentBox, targetBox, scaleX: sx, scaleY: sy, translateX: tx, translateY: ty, yellowPosition: yellow.position, raceKey, targetBoxSource: targetProfile.source };
  }

  transformRoiDetections(roiDetections: Detection[] | null, frameW: number, frameH: number, fullQuad: Quad, destQuad: Quad, align: CanonicalAlign, canonW: number, canonH: number, registration: number[] | null = null): DetectionResult | null {
    if (!roiDetections || roiDetections.length === 0 || frameW <= 0 || frameH <= 0) return null;
    const c = cv();
    const fp = fullQuad.points();
    const dp = destQuad.points();
    const src = c.matFromArray(4, 1, c.CV_32FC2, [fp[0].x, fp[0].y, fp[1].x, fp[1].y, fp[2].x, fp[2].y, fp[3].x, fp[3].y]);
    const dst = c.matFromArray(4, 1, c.CV_32FC2, [dp[0].x, dp[0].y, dp[1].x, dp[1].y, dp[2].x, dp[2].y, dp[3].x, dp[3].y]);
    const homography = c.getPerspectiveTransform(src, dst);
    const out: Detection[] = [];
    try {
      for (const d of roiDetections) {
        const x1 = d.left * frameW;
        const y1 = d.top * frameH;
        const x2 = d.right * frameW;
        const y2 = d.bottom * frameH;
        const corners = c.matFromArray(4, 1, c.CV_32FC2, [x1, y1, x2, y1, x2, y2, x1, y2]);
        const warped = new c.Mat();
        c.perspectiveTransform(corners, warped, homography);
        const wd = warped.data32F as Float32Array;
        let minX = Number.MAX_VALUE;
        let minY = Number.MAX_VALUE;
        let maxX = -Number.MAX_VALUE;
        let maxY = -Number.MAX_VALUE;
        for (let i = 0; i < 4; i++) {
          let cx = align.scaleX * wd[i * 2] + align.translateX;
          let cy = align.scaleY * wd[i * 2 + 1] + align.translateY;
          if (registration) {
            const r = registration;
            const w = r[6] * cx + r[7] * cy + r[8];
            [cx, cy] = [(r[0] * cx + r[1] * cy + r[2]) / w, (r[3] * cx + r[4] * cy + r[5]) / w];
          }
          minX = Math.min(minX, cx);
          minY = Math.min(minY, cy);
          maxX = Math.max(maxX, cx);
          maxY = Math.max(maxY, cy);
        }
        corners.delete();
        warped.delete();
        minX = Math.max(0.0, Math.min(canonW, minX));
        maxX = Math.max(0.0, Math.min(canonW, maxX));
        minY = Math.max(0.0, Math.min(canonH, minY));
        maxY = Math.max(0.0, Math.min(canonH, maxY));
        if (maxX - minX < 2.0 || maxY - minY < 2.0) continue;
        out.push({ label: d.label, score: d.score, left: f32(minX / canonW), top: f32(minY / canonH), right: f32(maxX / canonW), bottom: f32(maxY / canonH) });
      }
    } finally {
      src.delete();
      dst.delete();
      homography.delete();
    }
    return out.length === 0 ? null : { detections: out, timing: { resize: 0, normalize: 0, tensor: 0, ort_run: 0, parse: 0, total: 0 } };
  }

  /**
   * The registered Select-a-Ghost panel lies on its clean reference, so its lap
   * circles are where the reference has them: no second detection, and every
   * time slot at its reference position (buildDynamicGrid nominal). Detecting
   * them again and extrapolating the total from the lap rows put the total's
   * digits 2-3 px off on HDMI (a 3 read as 1).
   */
  registeredLapIndexDetections(raceKey: string, width: number, height: number): DetectionResult {
    const ownerGrid = this.raceOwners(raceKey)?.ghost;
    const boxes = ownerGrid ? centralLapIndexBoxes(ownerGrid) : [];
    return { registered: true, detections: boxes.map((box) => ({ label: 'lap_index', score: 1, left: f32(box.left / width),
      top: f32(box.top / height), right: f32(box.right / width), bottom: f32(box.bottom / height) })),
    timing: { resize: 0, normalize: 0, tensor: 0, ort_run: 0, parse: 0, total: 0 } };
  }

  /**
   * The digit slots of every active owner: the central lap grid (packages/icon-matcher
   * sharedLapGrid, the same specification as Android and Python; CENTRAL_RECOGNITION section 8.6,
   * phase 5) on this layout's time grid.
   */
  buildDynamicGrid(width: number, height: number, detections: Detection[], lapRows: Detection[], raceKeyIn: string, nominal = false): DynamicGrid {
    const central = buildCentralLapGrid(this.relGrid, raceKeyIn, this.isGhostDetail(), width, height, detections, lapRows, nominal);
    const box = (b: number[]): BoxD => new BoxD(b[0], b[1], b[2], b[3]);
    return {
      available: central.available,
      status: central.status,
      reason: central.reason,
      raceKey: central.raceKey,
      activeLapCount: central.activeLapCount,
      expectedFieldCount: central.expectedFieldCount,
      activeOwners: central.activeOwners,
      fields: central.fields.map((f) => ({ name: f.name, owner: f.owner, type: f.type, lapIndex: f.lapIndex, box: box(f.box),
        slots: f.slots.map(box) })),
      ownerAnchors: new Map(Object.entries(central.ownerAnchors)),
      matchedLapIndexCount: central.matchedLapIndexCount,
    };
  }
}

function appendRelativeBoxArray(ownerGrid: any, arr: any[], boxes: BoxD[]): void {
  if (arr.length === 4 && !Array.isArray(arr[0])) {
    boxes.push(ownerAbsBox(ownerGrid, arr));
    return;
  }
  for (const child of arr) if (Array.isArray(child)) appendRelativeBoxArray(ownerGrid, child, boxes);
}

function ownerAbsBox(ownerGrid: any, rel: number[]): BoxD {
  const anchor = ownerGrid.anchor;
  const ax = anchor ? anchor.x ?? 0.0 : 0.0;
  const ay = anchor ? anchor.y ?? 0.0 : 0.0;
  return new BoxD(ax + (rel[0] ?? 0.0), ay + (rel[1] ?? 0.0), ax + (rel[2] ?? 0.0), ay + (rel[3] ?? 0.0));
}

function union(boxes: BoxD[]): BoxD {
  if (boxes.length === 0) return new BoxD(0, 0, 1, 1);
  let left = Number.MAX_VALUE;
  let top = Number.MAX_VALUE;
  let right = -Number.MAX_VALUE;
  let bottom = -Number.MAX_VALUE;
  for (const b of boxes) {
    left = Math.min(left, b.left);
    top = Math.min(top, b.top);
    right = Math.max(right, b.right);
    bottom = Math.max(bottom, b.bottom);
  }
  return new BoxD(left, top, right, bottom);
}

// ------------------------------------------------------------------ 7-seg (24/26)

interface SlotRead {
  index: number;
  type: string;
  box: BoxD;
  charValue: string;
  pattern: string;
  polarityOwner: string;
  valid: boolean;
  rejectionReason: string;
  confidence: number;
  segmentScores: Record<string, number>;
}

interface FieldRead {
  field: FieldBox;
  slots: SlotRead[];
  physicalAssembled: string;
  semanticFieldName: string;
  semanticOwner: string;
  assembled: string;
  validFormat: boolean;
  rejectionReason: string;
}

interface SlotDetails {
  fields: FieldRead[];
  yellowPlayerSlot: string | null;
  swappedPlayerGhost: boolean;
  lapSumOk: boolean | null;
  lapSumRepairs: any[];
  ghostLapColumnOffsets?: Record<number, { dx: number; dy: number; rows: number }>;
  playerLapColumnOffsets?: Record<number, { dx: number; dy: number; rows: number }>;
  opticalPixelSumProbe?: Record<string, { arithmetic: number; supported: { field: string; pos: number;
    digit: string; confidence: number; margin: number }[];
    considered?: { field: string; pos: number; digit: string; confidence: number | null;
      margin: number | null }[] }>;
}

function slotType(oneBased: number): string {
  if (oneBased === 2) return 'colon';
  if (oneBased === 5) return 'dot';
  return 'digit';
}

function scoreSlot(canonical: any, box: BoxD, slot: SlotRead, polarityOwner: string, kind: 'lap' | 'total', slotIndex: number, lapTemplate: SegmentTemplate, totalTemplate: SegmentTemplate): void {
  const c = cv();
  const rect = box.toRect(canonical.cols, canonical.rows);
  const crop = canonical.roi(new c.Rect(rect.x, rect.y, rect.width, rect.height));
  const gray = new c.Mat();
  const blurred = new c.Mat();
  const binary = new c.Mat();
  try {
    if (crop.channels() === 1) crop.copyTo(gray);
    else c.cvtColor(crop, gray, c.COLOR_BGR2GRAY);
    if (polarityOwner === 'player' && kind === 'lap') c.bitwise_not(gray, gray);
    c.GaussianBlur(gray, blurred, new c.Size(3, 3), 0, 0, c.BORDER_DEFAULT);
    c.threshold(blurred, binary, 0, 255, c.THRESH_BINARY | c.THRESH_OTSU);
    const template = kind === 'total' ? totalTemplate : lapTemplate;
    const data = binary.data as Uint8Array;
    const candidate = template ? bestSegmentCandidate(data, binary.cols, binary.rows, template, kind, slotIndex) : null;
    const scores = candidate === null ? segmentScores(data, binary.cols, binary.rows) : candidate.values;
    slot.segmentScores = { ...scores };
    if (candidate) slot.confidence = candidate.confidence;
    let pattern = '';
    for (const key of SEGMENT_KEYS) pattern += scores[key] >= 0.35 ? '1' : '0';
    slot.pattern = pattern;
    slot.charValue = decodePattern(pattern);
    slot.valid = slot.charValue !== '?';
    if (!slot.valid) slot.rejectionReason = 'unsupported_digit_pattern';
  } finally {
    crop.delete();
    gray.delete();
    blurred.delete();
    binary.delete();
  }
}

function assemble(slots: SlotRead[]): string {
  return slots.map((s) => s.charValue ?? '?').join('');
}

function digitPolarityOwner(canonicalOwner: string, yellowPosition: string | null): string {
  if (yellowPosition === 'top') {
    if (canonicalOwner === 'ghost') return 'player';
    if (canonicalOwner === 'player') return 'ghost';
  }
  return canonicalOwner;
}

function semanticOwner(physicalOwner: string, yellowPosition: string | null): string {
  if (yellowPosition === 'top') {
    if (physicalOwner === 'ghost') return 'player';
    if (physicalOwner === 'player') return 'ghost';
  }
  return physicalOwner;
}

function semanticFieldName(physicalFieldName: string, yellowPosition: string | null): string {
  if (yellowPosition !== 'top') return physicalFieldName;
  if (physicalFieldName.startsWith('player_')) return 'ghost_' + physicalFieldName.substring('player_'.length);
  if (physicalFieldName.startsWith('ghost_')) return 'player_' + physicalFieldName.substring('ghost_'.length);
  return physicalFieldName;
}

function buildSlotDetails(canonical: any, grid: DynamicGrid, ghostDetail: boolean, lapTemplate: SegmentTemplate, totalTemplate: SegmentTemplate, ghostLapColumnCandidate = false, playerLapColumnCandidate = false, ghostTotalVerticalCandidate = false, opticalPixelSumCandidate = false): SlotDetails {
  const yellow = ghostDetail ? { position: null as string | null } : detectYellowPlayerSlot(canonical);
  const details: SlotDetails = { fields: [], yellowPlayerSlot: yellow.position, swappedPlayerGhost: yellow.position === 'top', lapSumOk: null, lapSumRepairs: [] };
  for (const field of grid.fields) {
    const read: FieldRead = { field, slots: [], physicalAssembled: '', semanticFieldName: '', semanticOwner: '', assembled: '', validFormat: false, rejectionReason: '' };
    const polarityOwner = digitPolarityOwner(field.owner, yellow.position);
    for (let i = 0; i < field.slots.length; i++) {
      const type = slotType(i + 1);
      const slot: SlotRead = { index: i + 1, type, box: field.slots[i], charValue: '?', pattern: '', polarityOwner, valid: false, rejectionReason: '', confidence: 0.0, segmentScores: {} };
      if (type === 'digit') {
        scoreSlot(canonical, field.slots[i], slot, polarityOwner, field.type, i + 1, lapTemplate, totalTemplate);
      } else {
        slot.charValue = type === 'colon' ? ':' : '.';
        slot.valid = true;
      }
      read.slots.push(slot);
    }
    read.physicalAssembled = assemble(read.slots);
    read.assembled = read.physicalAssembled;
    read.validFormat = TIME_RE.test(read.assembled);
    if (!read.validFormat) read.rejectionReason = 'invalid_format_or_unknown_digit';
    details.fields.push(read);
  }
  if (ghostLapColumnCandidate) applyGhostLapColumnCandidate(canonical, details, lapTemplate, totalTemplate);
  if (playerLapColumnCandidate) applyPlayerLapColumnCandidate(canonical, details, lapTemplate, totalTemplate);
  applyGuardedFieldFits(canonical, details, lapTemplate, totalTemplate);
  applySemanticDecodedValues(details, yellow.position);
  applyLapSumClosure(details);
  if (playerLapColumnCandidate) applyPlayerTotalColumnRefit(canonical, details, lapTemplate, totalTemplate);
  applyTotalRefit(canonical, details, lapTemplate, totalTemplate);
  if (ghostTotalVerticalCandidate) applyGhostTotalVerticalRefit(canonical, details, lapTemplate, totalTemplate);
  if (opticalPixelSumCandidate) applyOpticalPixelSumRefit(canonical, details, lapTemplate, totalTemplate);
  return details;
}

function compareColumnRank(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

function applyGhostLapColumnCandidate(canonical: any, details: SlotDetails, lapTemplate: SegmentTemplate, totalTemplate: SegmentTemplate): void {
  const rows = details.fields.filter((read) => read.field.type === 'lap' && semanticOwner(read.field.owner, details.yellowPlayerSlot) === 'ghost');
  if (rows.length < 2) return;
  const offsets: Record<number, { dx: number; dy: number; rows: number }> = {};
  for (const index of SEGMENT_DIGIT_POSITIONS.map((position) => position + 1)) {
    const group = rows.filter((read) => read.slots[index - 1]?.type === 'digit');
    if (group.length < 2) continue;
    let best: { rank: number[]; dx: number; dy: number; slots: SlotRead[] } | null = null;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const slots: SlotRead[] = [];
        for (const read of group) {
          const original = read.slots[index - 1];
          const box = original.box;
          const shifted = new BoxD(box.left + dx, box.top + dy, box.right + dx, box.bottom + dy).clipped(canonical.cols, canonical.rows);
          const slot: SlotRead = { index, type: 'digit', box: shifted, charValue: '?', pattern: '', polarityOwner: original.polarityOwner,
            valid: false, rejectionReason: '', confidence: 0, segmentScores: {} };
          scoreSlot(canonical, shifted, slot, slot.polarityOwner, 'lap', index, lapTemplate, totalTemplate);
          slots.push(slot);
        }
        const rank = [slots.filter((slot) => slot.valid).length,
          slots.reduce((sum, slot) => sum + slot.confidence, 0) / slots.length,
          -Math.abs(dx) - Math.abs(dy), -Math.abs(dx), -Math.abs(dy), -dx, -dy];
        if (!best || compareColumnRank(rank, best.rank) > 0) {
          best = { rank, dx, dy, slots };
        }
      }
    }
    if (!best) continue;
    offsets[index] = { dx: best.dx, dy: best.dy, rows: group.length };
    if (best.dx === 0 && best.dy === 0) continue;
    for (let row = 0; row < group.length; row++) {
      group[row].slots[index - 1] = best.slots[row];
    }
  }
  for (const read of rows) {
    read.physicalAssembled = assemble(read.slots);
    read.assembled = read.physicalAssembled;
    read.validFormat = TIME_RE.test(read.assembled);
    read.rejectionReason = read.validFormat ? '' : 'invalid_format_or_unknown_digit';
  }
  details.ghostLapColumnOffsets = offsets;
}

function applyPlayerLapColumnCandidate(canonical: any, details: SlotDetails, lapTemplate: SegmentTemplate, totalTemplate: SegmentTemplate): void {
  const rows = details.fields.filter((read) => read.field.type === 'lap' && semanticOwner(read.field.owner, details.yellowPlayerSlot) === 'player');
  const total = details.fields.find((read) => read.field.type === 'total' && semanticOwner(read.field.owner, details.yellowPlayerSlot) === 'player');
  if (rows.length < 3 || !total?.validFormat || segmentTimeMs(total.assembled) === null
      || rows.filter((read) => !read.validFormat).length < 2) return;
  const offsets: Record<number, { dx: number; dy: number; rows: number }> = {};
  for (const index of SEGMENT_DIGIT_POSITIONS.map((position) => position + 1)) {
    const group = rows.filter((read) => read.slots[index - 1]?.type === 'digit');
    if (group.length !== rows.length || group.filter((read) => read.slots[index - 1].charValue === '?').length < 2) continue;
    let best: { rank: number[]; dx: number; dy: number; slots: SlotRead[] } | null = null;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const slots: SlotRead[] = [];
        for (const read of group) {
          const original = read.slots[index - 1];
          const box = original.box;
          const shifted = new BoxD(box.left + dx, box.top + dy, box.right + dx, box.bottom + dy).clipped(canonical.cols, canonical.rows);
          const slot: SlotRead = { index, type: 'digit', box: shifted, charValue: '?', pattern: '', polarityOwner: original.polarityOwner,
            valid: false, rejectionReason: '', confidence: 0, segmentScores: {} };
          scoreSlot(canonical, shifted, slot, slot.polarityOwner, 'lap', index, lapTemplate, totalTemplate);
          slots.push(slot);
        }
        if (slots.some((slot, row) => !slot.valid || slot.confidence < 0.6
            || (group[row].slots[index - 1].valid && slot.charValue !== group[row].slots[index - 1].charValue))) continue;
        const rank = [slots.reduce((sum, slot) => sum + slot.confidence, 0) / slots.length,
          -Math.abs(dx) - Math.abs(dy), -Math.abs(dx), -Math.abs(dy), -dx, -dy];
        if (!best || compareColumnRank(rank, best.rank) > 0) best = { rank, dx, dy, slots };
      }
    }
    if (!best) continue;
    offsets[index] = { dx: best.dx, dy: best.dy, rows: group.length };
    for (let row = 0; row < group.length; row++) group[row].slots[index - 1] = best.slots[row];
  }
  if (Object.keys(offsets).length === 0) return;
  for (const read of rows) {
    read.physicalAssembled = assemble(read.slots);
    read.assembled = read.physicalAssembled;
    read.validFormat = TIME_RE.test(read.assembled);
    read.rejectionReason = read.validFormat ? '' : 'invalid_format_or_unknown_digit';
  }
  details.playerLapColumnOffsets = offsets;
}

interface FieldFitResult {
  method: string;
  reason: string;
  text: string;
  dx: number;
  validFormat: boolean;
  accepted: boolean;
  unknownCount: number;
  averageConfidence: number;
  slots: SlotRead[];
}

function baselineFit(read: FieldRead): FieldFitResult {
  let unknown = 0;
  for (const ch of read.physicalAssembled) if (ch === '?') unknown++;
  return { method: 'baseline', reason: 'baseline_decode', text: read.physicalAssembled, dx: 0.0, validFormat: read.validFormat, accepted: false, unknownCount: unknown, averageConfidence: averageConfidence(read.slots), slots: [...read.slots] };
}

function compareFit(a: FieldFitResult, b: FieldFitResult): number {
  if (a.validFormat !== b.validFormat) return a.validFormat ? 1 : -1;
  if (a.unknownCount !== b.unknownCount) return b.unknownCount < a.unknownCount ? -1 : 1;
  if (a.averageConfidence !== b.averageConfidence) return a.averageConfidence < b.averageConfidence ? -1 : 1;
  const da = Math.abs(a.dx);
  const db = Math.abs(b.dx);
  return db < da ? -1 : db > da ? 1 : 0;
}

function applyGuardedFieldFits(canonical: any, details: SlotDetails, lapTemplate: SegmentTemplate, totalTemplate: SegmentTemplate): void {
  for (const read of details.fields) {
    if (read.validFormat && !read.physicalAssembled.includes('?')) continue;
    const baseline = baselineFit(read);
    const xShift = bestShiftedField(canonical, read, 'field_x_shift_fit', [0.0, 1.0, 2.0], lapTemplate, totalTemplate);
    if (candidateImproves(baseline, xShift)) {
      applyFieldFitResult(read, xShift);
      continue;
    }
    const rightProjection = bestShiftedField(canonical, read, 'field_x_right_projection_fit', [0.0, 1.0, 2.0, 3.0, -1.0], lapTemplate, totalTemplate);
    if (candidateImproves(baseline, rightProjection)) {
      applyFieldFitResult(read, rightProjection);
      continue;
    }
    // The slot pitch comes from the scale the badge spacing gives; on a photo a
    // small scale error adds up digit by digit across a wide field (the ghost
    // panel's total drifted a whole slot). Same acceptance rule (ADR-0203).
    let stretch: FieldFitResult | null = null;
    for (const candidate of stretchedFieldCandidates(canonical, read, 'field_x_stretch_fit', lapTemplate, totalTemplate)) {
      if (!stretch || compareFit(candidate, stretch) > 0) stretch = candidate;
    }
    if (candidateImproves(baseline, stretch)) applyFieldFitResult(read, stretch!);
  }
}

// Slot pitch factors and shifts tried by the stretch fit (ADR-0203).
// The narrowing factors stay: without them the tilted webcam series lost 3 of
// its 22 exact reads, although a 0.94 squeeze once read a 9 as a clean but
// wrong 4 (the lap sum refused it; the sibling-column refit repairs it).
const FIELD_STRETCH_FACTORS = [1.03, 1.06, 1.09, 1.12, 1.15, 0.97, 0.94];
const FIELD_STRETCH_SHIFTS = [0.0, 1.0, -1.0];
// A refit total digit must read at least this cleanly.
const TOTAL_REFIT_MIN_DIGIT_CONFIDENCE = 0.6;

/** The field's slots spread (or narrowed) about its first slot's left edge, then shifted. */
function stretchedFieldCandidates(canonical: any, read: FieldRead, method: string, lapTemplate: SegmentTemplate, totalTemplate: SegmentTemplate): FieldFitResult[] {
  if (read.slots.length === 0) return [];
  const anchor = read.slots[0].box.left;
  const out: FieldFitResult[] = [];
  for (const factor of FIELD_STRETCH_FACTORS) {
    for (const dx of FIELD_STRETCH_SHIFTS) {
      const boxes = read.slots.map((s) => new BoxD(anchor + (s.box.left - anchor) * factor + dx, s.box.top, anchor + (s.box.right - anchor) * factor + dx, s.box.bottom).clipped(canonical.cols, canonical.rows));
      out.push({ ...evaluateFieldBoxes(canonical, read, method, boxes, lapTemplate, totalTemplate), dx });
    }
  }
  return out;
}

/**
 * When every lap of a card reads validly but the total does not match their
 * sum, the total alone is read again with the stretch and shift fits. A refit
 * is taken only when what it reads from the image is exactly the laps' sum,
 * every digit valid and read with at least TOTAL_REFIT_MIN_DIGIT_CONFIDENCE;
 * nothing is filled in from arithmetic. Recorded as a lap-sum repair (ADR-0203).
 */
function applyTotalRefit(canonical: any, details: SlotDetails, lapTemplate: SegmentTemplate, totalTemplate: SegmentTemplate): void {
  if (details.lapSumOk === true) return;
  let refitted = false;
  for (const owner of ['player', 'ghost']) {
    const keys = ownerFieldsTotalFirst(details, owner);
    if (keys.length < 3 || keys[0].field.type !== 'total') continue;
    const total = keys[0];
    let lapSum = 0;
    const unread: FieldRead[] = [];
    const cleanLaps: FieldRead[] = [];
    for (let i = 1; i < keys.length; i++) {
      const ms = keys[i].validFormat ? segmentTimeMs(keys[i].assembled) : null;
      if (ms === null) {
        unread.push(keys[i]);
        continue;
      }
      lapSum += ms;
      if (digitsReadCleanly(keys[i].slots)) cleanLaps.push(keys[i]);
    }
    if (unread.length > 1) continue;
    const totalMs = segmentTimeMs(total.assembled);
    if (unread.length === 0 && totalMs !== null && totalMs === lapSum) continue;
    // One field is refit: the total to the laps' sum, or a single lap to the
    // total minus the other laps (a lap drifts like the total does), also a lap
    // that did not read at all. Taken only when exactly one field reads its
    // value from the pixels.
    const options: { field: FieldRead; fit: FieldFitResult }[] = [];
    if (unread.length === 0) {
      const totalFit = refitTo(canonical, total, formatSegmentTime(lapSum), 'total_lap_sum_refit', lapTemplate, totalTemplate, []);
      if (totalFit) options.push({ field: total, fit: totalFit });
    }
    if (totalMs !== null && total.validFormat && digitsReadCleanly(total.slots)) {
      for (let i = 1; i < keys.length; i++) {
        const lap = keys[i];
        if (unread.length && lap !== unread[0]) continue;
        const others = lap === unread[0] ? lapSum : lapSum - (segmentTimeMs(lap.assembled) as number);
        const siblings = cleanLaps.filter((f) => f !== lap);
        const lapFit = refitTo(canonical, lap, formatSegmentTime(totalMs - others), 'lap_total_refit', lapTemplate, totalTemplate, siblings);
        if (lapFit) options.push({ field: lap, fit: lapFit });
      }
    }
    if (options.length !== 1) continue;
    const { field, fit } = options[0];
    const from = field.assembled;
    applyFieldFitResult(field, fit);
    details.lapSumRepairs.push({ kind: field === total ? 'total_refit' : 'lap_refit', owner, field: field.field.name, from, to: fit.text, method: fit.method, dx: fit.dx });
    refitted = true;
  }
  if (refitted) details.lapSumOk = fieldsLapSumComplete(details);
}

/** A total's final digit can sit below the nominal slot row. Require two
 * independent vertical pixel reads to agree with clean in-game lap rows. */
function applyGhostTotalVerticalRefit(canonical: any, details: SlotDetails, lapTemplate: SegmentTemplate, totalTemplate: SegmentTemplate): void {
  if (details.lapSumOk === true) return;
  const keys = ownerFieldsTotalFirst(details, 'ghost');
  if (keys.length < 3) return;
  const [total, ...laps] = keys;
  if (total.semanticOwner !== 'ghost' || !total.validFormat
      || laps.some((lap) => lap.semanticOwner !== 'ghost' || !lap.validFormat || !digitsReadCleanly(lap.slots))) return;
  const lapTimes = laps.map((lap) => segmentTimeMs(lap.assembled));
  if (lapTimes.some((ms) => ms === null)) return;
  const expected = formatSegmentTime(lapTimes.reduce<number>((sum, ms) => sum + (ms as number), 0));
  if (!expected || expected === total.assembled) return;
  const wrong = [...expected].flatMap((char, pos) => char !== total.assembled[pos] ? [pos] : []);
  if (wrong.length !== 1 || wrong[0] !== 7) return;
  const original = total.slots[7];
  if (original?.type !== 'digit') return;
  const alternatives: SlotRead[] = [];
  for (const dy of [1, 2]) {
    const box = new BoxD(original.box.left, original.box.top + dy, original.box.right, original.box.bottom + dy).clipped(canonical.cols, canonical.rows);
    const slot: SlotRead = { index: original.index, type: 'digit', box, charValue: '?', pattern: '', polarityOwner: original.polarityOwner,
      valid: false, rejectionReason: '', confidence: 0, segmentScores: {} };
    scoreSlot(canonical, box, slot, slot.polarityOwner, 'total', slot.index, lapTemplate, totalTemplate);
    if (slot.charValue !== expected[7] || slot.confidence < 0.85) return;
    alternatives.push(slot);
  }
  const from = total.assembled;
  total.slots[7] = alternatives[1].confidence >= alternatives[0].confidence ? alternatives[1] : alternatives[0];
  total.physicalAssembled = assemble(total.slots);
  total.assembled = total.physicalAssembled;
  total.validFormat = TIME_RE.test(total.assembled);
  total.rejectionReason = total.validFormat ? '' : 'invalid_format_or_unknown_digit';
  details.lapSumRepairs.push({ kind: 'ghost_total_vertical_refit', owner: 'ghost', field: total.field.name,
    from, to: total.assembled, method: 'ghost_total_vertical_pixel_sum', dy: total.slots[7].box.top - original.box.top });
  details.lapSumOk = fieldsLapSumComplete(details);
}

/** Re-read one total digit at a player-lap column offset only when its pixels
 * also support the exact sum of cleanly read laps. The arithmetic is a gate,
 * never a substitute for a valid segment read from the game image. */
function applyPlayerTotalColumnRefit(canonical: any, details: SlotDetails, lapTemplate: SegmentTemplate, totalTemplate: SegmentTemplate): void {
  const offsets = details.playerLapColumnOffsets;
  if (!offsets) return;
  const rows = details.fields.filter((read) => read.field.type === 'lap' && read.semanticOwner === 'player');
  const total = details.fields.find((read) => read.field.type === 'total' && read.semanticOwner === 'player');
  if (!total?.validFormat || segmentTimeMs(total.assembled) === null || rows.length < 3
      || rows.some((read) => !read.validFormat || !digitsReadCleanly(read.slots))) return;
  const lapTimes = rows.map((read) => segmentTimeMs(read.assembled));
  if (lapTimes.some((ms) => ms === null)) return;
  const lapSum = lapTimes.reduce<number>((sum, ms) => sum + (ms as number), 0);
  const expected = formatSegmentTime(lapSum);
  if (!expected || expected === total.assembled) return;
  const wrong = [...expected].flatMap((char, position) => char !== total.assembled[position] ? [position] : []);
  if (wrong.length !== 1 || !SEGMENT_DIGIT_POSITIONS.includes(wrong[0])) return;
  const position = wrong[0];
  const index = position + 1;
  const offset = offsets[index];
  const original = total.slots[position];
  if (!offset || original?.type !== 'digit') return;
  let best: { slot: SlotRead; dx: number; dy: number } | null = null;
  for (let dy = Math.max(-2, offset.dy - 2); dy <= Math.min(2, offset.dy + 2); dy++) {
    for (let dx = Math.max(-8, offset.dx - 2); dx <= Math.min(8, offset.dx + 2); dx++) {
      const box = original.box;
      const shifted = new BoxD(box.left + dx, box.top + dy, box.right + dx, box.bottom + dy).clipped(canonical.cols, canonical.rows);
      const slot: SlotRead = { index, type: 'digit', box: shifted, charValue: '?', pattern: '', polarityOwner: original.polarityOwner,
        valid: false, rejectionReason: '', confidence: 0, segmentScores: {} };
      scoreSlot(canonical, shifted, slot, slot.polarityOwner, 'total', index, lapTemplate, totalTemplate);
      if (slot.charValue !== expected[position] || slot.confidence < Math.max(0.8, original.confidence + 0.05)) continue;
      if (!best || slot.confidence > best.slot.confidence) best = { slot, dx, dy };
    }
  }
  if (!best) return;
  const from = total.assembled;
  total.slots[position] = best.slot;
  total.physicalAssembled = assemble(total.slots);
  total.assembled = total.physicalAssembled;
  total.validFormat = TIME_RE.test(total.assembled);
  total.rejectionReason = total.validFormat ? '' : 'invalid_format_or_unknown_digit';
  details.lapSumRepairs.push({ kind: 'player_total_column_refit', owner: 'player', field: total.field.name,
    from, to: total.assembled, method: 'player_lap_column_pixel_sum', dx: best.dx, dy: best.dy });
  details.lapSumOk = fieldsLapSumComplete(details);
}

/**
 * The badge column fixes a ghost panel's position, turn and height, but not its
 * width or perspective, so digits far from the badges drift out of their
 * template slots. The panel's constant parts (every ':' and '.', the lap badges,
 * the X button and the magnifier) are found in the canonical near their spot on
 * the clean reference of the same variant (gradient cross-correlation), and one
 * homography through them (RANSAC) maps this canonical onto the reference. The
 * decision (search windows, sub-pixel peak, how many anchors must agree, how far
 * the warp may move the panel) is central (sharedPanelRegistration); the gradient
 * match and findHomography are this scanner's pixel work. h is null when the
 * canonical stays as it was.
 */
function ghostPanelRegistration(canonical: any, raceKey: string): { h: number[] | null; info: Record<string, unknown> } {
  const c = cv();
  const anchors = GHOST_PANEL_ANCHORS[raceKey === 'race7' ? 'race7' : 'race3'];
  const m = GHOST_PANEL_ANCHOR_MARGIN;
  const grad = gradientMagnitude(canonical);
  try {
    return registerCentralPanel(raceKey, anchors.map((a) => a.box), grad.cols, grad.rows, {
      match: (index, [wl, wt, wr, wb]) => {
        const a = anchors[index];
        const [left, top, right, bottom] = a.box;
        const bytes = Uint8Array.from(atob(a.data), (ch) => ch.charCodeAt(0));
        const patchGray = c.matFromArray(a.height, a.width, c.CV_8UC1, Array.from(bytes));
        const patchGrad = gradientMagnitude(patchGray);
        const patch = patchGrad.roi(new c.Rect(m, m, right - left, bottom - top));
        const window = grad.roi(new c.Rect(wl, wt, wr - wl, wb - wt));
        const res = new c.Mat();
        try {
          c.matchTemplate(window, patch, res, c.TM_CCOEFF_NORMED);
          const mm = c.minMaxLoc(res);
          const x = mm.maxLoc.x;
          const y = mm.maxLoc.y;
          const at = (yy: number, xx: number): number | null =>
            (xx < 0 || yy < 0 || xx >= res.cols || yy >= res.rows ? null : res.floatAt(yy, xx));
          return [mm.maxVal, x, y, at(y, x - 1), at(y, x + 1), at(y - 1, x), at(y + 1, x)];
        } finally {
          patchGray.delete();
          patchGrad.delete();
          patch.delete();
          window.delete();
          res.delete();
        }
      },
      homography: (found, reference) => {
        const src = c.matFromArray(found.length, 1, c.CV_32FC2, found.flat());
        const dst = c.matFromArray(reference.length, 1, c.CV_32FC2, reference.flat());
        const inlierMask = new c.Mat();
        const hm = c.findHomography(src, dst, c.RANSAC, PANEL_RANSAC_THRESHOLD, inlierMask);
        src.delete();
        dst.delete();
        const inliers = inlierMask.empty() ? 0 : c.countNonZero(inlierMask);
        inlierMask.delete();
        if (!hm || hm.empty()) {
          hm?.delete();
          return [null, inliers];
        }
        const h = Array.from(hm.data64F as Float64Array);
        hm.delete();
        return [h, inliers];
      },
    });
  } finally {
    grad.delete();
  }
}

/** Gradient magnitude of a grey or BGR image: 3x3 Gaussian, then 3x3 Sobel (CV_32F). */
function gradientMagnitude(image: any): any {
  const c = cv();
  const gray = new c.Mat();
  if (image.channels() === 3) c.cvtColor(image, gray, c.COLOR_BGR2GRAY);
  else image.copyTo(gray);
  const f = new c.Mat();
  gray.convertTo(f, c.CV_32F);
  gray.delete();
  c.GaussianBlur(f, f, new c.Size(3, 3), 0);
  const gx = new c.Mat();
  const gy = new c.Mat();
  c.Sobel(f, gx, c.CV_32F, 1, 0);
  c.Sobel(f, gy, c.CV_32F, 0, 1);
  const mag = new c.Mat();
  c.magnitude(gx, gy, mag);
  f.delete();
  gx.delete();
  gy.delete();
  return mag;
}

/** m:ss.mmm for a time under ten minutes, or null. */
function formatSegmentTime(ms: number): string | null {
  if (ms < 0 || ms >= 600000) return null;
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

function digitsReadCleanly(slots: FieldRead['slots']): boolean {
  return slots.every((s: any) => s.type !== 'digit' || (s.valid && s.confidence >= TOTAL_REFIT_MIN_DIGIT_CONFIDENCE));
}

/**
 * The first fit of a field that reads exactly want, every digit clean; or null.
 * First the slot columns of cleanly read sibling laps of the same card (the lap
 * rows share their digit columns, so this is measured geometry), then the
 * stretch and shift fits.
 */
function refitTo(canonical: any, read: FieldRead, want: string | null, method: string, lapTemplate: SegmentTemplate, totalTemplate: SegmentTemplate, siblings: FieldRead[]): FieldFitResult | null {
  if (want === null || want === read.assembled) return null;
  const candidates: FieldFitResult[] = [];
  for (const sibling of siblings) {
    if (sibling.slots.length !== read.slots.length) continue;
    const boxes = read.slots.map((own, i) => new BoxD(sibling.slots[i].box.left, own.box.top, sibling.slots[i].box.right, own.box.bottom));
    candidates.push(evaluateFieldBoxes(canonical, read, `${method}_sibling_columns`, boxes, lapTemplate, totalTemplate));
  }
  candidates.push(...stretchedFieldCandidates(canonical, read, method, lapTemplate, totalTemplate));
  for (const dx of [1.0, 2.0, 3.0, -1.0, -2.0]) candidates.push(evaluateShiftedField(canonical, read, method, dx, lapTemplate, totalTemplate));
  return candidates.find((c) => c.validFormat && c.text === want && digitsReadCleanly(c.slots)) ?? null;
}

function candidateImproves(baseline: FieldFitResult, candidate: FieldFitResult | null): boolean {
  return candidate !== null && candidate.validFormat && candidate.unknownCount < baseline.unknownCount;
}

function bestShiftedField(canonical: any, read: FieldRead, method: string, dxValues: number[], lapTemplate: SegmentTemplate, totalTemplate: SegmentTemplate): FieldFitResult {
  let best: FieldFitResult | null = null;
  for (const dx of dxValues) {
    const candidate = evaluateShiftedField(canonical, read, method, dx, lapTemplate, totalTemplate);
    if (!best || compareFit(candidate, best) > 0) best = candidate;
  }
  return best ?? baselineFit(read);
}

function evaluateShiftedField(canonical: any, read: FieldRead, method: string, dx: number, lapTemplate: SegmentTemplate, totalTemplate: SegmentTemplate): FieldFitResult {
  const boxes = read.slots.map((original) => new BoxD(original.box.left + dx, original.box.top, original.box.right + dx, original.box.bottom).clipped(canonical.cols, canonical.rows));
  return { ...evaluateFieldBoxes(canonical, read, method, boxes, lapTemplate, totalTemplate), dx };
}

function evaluateFieldBoxes(canonical: any, read: FieldRead, method: string, boxes: BoxD[], lapTemplate: SegmentTemplate, totalTemplate: SegmentTemplate): FieldFitResult {
  const dx = 0;
  const slots: SlotRead[] = [];
  for (let i = 0; i < read.slots.length; i++) {
    const original = read.slots[i];
    const shiftedBox = boxes[i];
    const slot: SlotRead = { index: original.index, type: original.type, box: shiftedBox, charValue: '?', pattern: '', polarityOwner: original.polarityOwner, valid: false, rejectionReason: '', confidence: 0.0, segmentScores: {} };
    if (original.type === 'digit') {
      scoreSlot(canonical, shiftedBox, slot, slot.polarityOwner, read.field.type, slot.index, lapTemplate, totalTemplate);
    } else {
      slot.charValue = original.type === 'colon' ? ':' : '.';
      slot.valid = true;
    }
    slots.push(slot);
  }
  const text = assemble(slots);
  let unknown = 0;
  for (const ch of text) if (ch === '?') unknown++;
  const validFormat = TIME_RE.test(text);
  return { method, dx, text, validFormat, unknownCount: unknown, averageConfidence: averageConfidence(slots), slots, accepted: false, reason: validFormat ? 'candidate_valid_format' : 'candidate_invalid_format' };
}

function applyFieldFitResult(read: FieldRead, result: FieldFitResult): void {
  read.slots = [...result.slots];
  read.physicalAssembled = result.text;
  read.assembled = result.text;
  read.validFormat = result.validFormat;
  read.rejectionReason = result.validFormat ? '' : 'invalid_format_or_unknown_digit';
}

function averageConfidence(slots: SlotRead[]): number {
  let total = 0.0;
  let count = 0;
  for (const s of slots) {
    if (s.type === 'digit') {
      total += s.confidence;
      count++;
    }
  }
  return count === 0 ? 0.0 : total / count;
}

function applySemanticDecodedValues(details: SlotDetails, yellowPosition: string | null): void {
  for (const read of details.fields) {
    read.semanticFieldName = semanticFieldName(read.field.name, yellowPosition);
    read.semanticOwner = semanticOwner(read.field.owner, yellowPosition);
    read.assembled = read.physicalAssembled;
    read.validFormat = TIME_RE.test(read.assembled);
    read.rejectionReason = read.validFormat ? '' : 'invalid_format_or_unknown_digit';
  }
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function replaceCharAt(text: string, pos: number, c: string): string {
  return text.substring(0, pos) + c + text.substring(pos + 1);
}

function formatSegmentValid(text: string | null): boolean {
  if (!text || text.length !== 8 || text.charAt(1) !== ':' || text.charAt(4) !== '.') return false;
  if (!isDigit(text.charAt(0))) return false;
  for (const pos of [2, 3, 5, 6, 7]) if (!isDigit(text.charAt(pos))) return false;
  const seconds = parseInt(text.substring(2, 4), 10);
  return seconds >= 0 && seconds <= 59;
}

function segmentTimeMs(text: string): number | null {
  if (!formatSegmentValid(text)) return null;
  return parseInt(text.substring(0, 1), 10) * 60000 + parseInt(text.substring(2, 4), 10) * 1000 + parseInt(text.substring(5, 8), 10);
}

function ownerFieldsTotalFirst(details: SlotDetails, owner: string): FieldRead[] {
  let total: FieldRead | null = null;
  const laps: FieldRead[] = [];
  for (const read of details.fields) {
    if (read.field.owner !== owner) continue;
    if (read.field.type === 'total') total = read;
    else if (read.field.type === 'lap') laps.push(read);
  }
  laps.sort((a, b) => a.field.lapIndex - b.field.lapIndex);
  if (!total || laps.length < 2) return [];
  for (let i = 0; i < laps.length; i++) if (laps[i].field.lapIndex !== i + 1) return [];
  return [total, ...laps];
}

function lapSumDelta(keys: FieldRead[], replaceIdx: number, replacement: string | null): number | null {
  let total = 0;
  let lapSum = 0;
  for (let i = 0; i < keys.length; i++) {
    const text = i === replaceIdx ? replacement! : keys[i].assembled;
    const ms = segmentTimeMs(text);
    if (ms === null) return null;
    if (i === 0) total = ms;
    else lapSum += ms;
  }
  return lapSum - total;
}

function applyLapSumRepair(read: FieldRead, pos: number, digit: string, kind: string, owner: string, repairs: any[]): void {
  const from = read.assembled;
  const to = replaceCharAt(from, pos, digit);
  read.physicalAssembled = to;
  read.assembled = to;
  read.validFormat = TIME_RE.test(to);
  if (read.validFormat) read.rejectionReason = '';
  if (read.slots.length === to.length) {
    const slot = read.slots[pos];
    if (slot.type === 'digit') {
      slot.charValue = digit;
      slot.valid = true;
      slot.rejectionReason = '';
    }
  }
  repairs.push({ owner, semantic_owner: read.semanticOwner, field: read.field.name, semantic_field: read.semanticFieldName, kind, char_pos: pos, from, to });
}

function applyLapSumClosure(details: SlotDetails): void {
  // The fill/flip decision is the central time decision (packages/icon-matcher sharedTimeDecision,
  // the same rules as Android and Python); this engine applies the chosen repair to its slots.
  const repairs: any[] = [];
  for (const owner of ['player', 'ghost']) {
    const keys = ownerFieldsTotalFirst(details, owner);
    if (keys.length === 0) continue;
    const repair = lapSumClosure(keys.map((read) => read.assembled));
    if (repair) applyLapSumRepair(keys[repair.field], repair.pos, repair.to.charAt(repair.pos), repair.kind, owner, repairs);
  }
  details.lapSumRepairs = repairs;
  details.lapSumOk = fieldsLapSumComplete(details);
}

/** A sum proposes a digit; the digit's own game pixels must independently support it. */
function readOpticalDigitAlternative(canonical: any, slot: SlotRead, kind: 'lap' | 'total',
  digit: string, lapTemplate: SegmentTemplate, totalTemplate: SegmentTemplate): ReturnType<typeof bestSegmentCandidate> {
  const c = cv();
  const rect = slot.box.toRect(canonical.cols, canonical.rows);
  const crop = canonical.roi(new c.Rect(rect.x, rect.y, rect.width, rect.height));
  const gray = new c.Mat();
  const blurred = new c.Mat();
  const binary = new c.Mat();
  try {
    if (crop.channels() === 1) crop.copyTo(gray);
    else c.cvtColor(crop, gray, c.COLOR_BGR2GRAY);
    if (slot.polarityOwner === 'player' && kind === 'lap') c.bitwise_not(gray, gray);
    c.GaussianBlur(gray, blurred, new c.Size(3, 3), 0, 0, c.BORDER_DEFAULT);
    c.threshold(blurred, binary, 0, 255, c.THRESH_BINARY | c.THRESH_OTSU);
    return bestSegmentCandidate(binary.data as Uint8Array, binary.cols, binary.rows,
      kind === 'total' ? totalTemplate : lapTemplate, kind, slot.index, digit);
  } finally {
    crop.delete(); gray.delete(); blurred.delete(); binary.delete();
  }
}

/** Opt-in ambiguity repair after the ordinary single-flip closure abstains. */
function applyOpticalPixelSumRefit(canonical: any, details: SlotDetails,
  lapTemplate: SegmentTemplate, totalTemplate: SegmentTemplate): void {
  if (details.lapSumOk === true || details.lapSumRepairs.length) return;
  details.opticalPixelSumProbe = {};
  for (const owner of ['player', 'ghost']) {
    const keys = ownerFieldsTotalFirst(details, owner);
    if (keys.length < 3 || keys.some((read) => !formatSegmentValid(read.assembled))) continue;
    const arithmetic: { field: number; pos: number; digit: string }[] = [];
    for (let field = 0; field < keys.length; field++) {
      for (const pos of SEGMENT_DIGIT_POSITIONS) {
        for (let d = 0; d <= 9; d++) {
          const digit = String(d);
          if (digit === keys[field].assembled[pos]) continue;
          const replacement = replaceCharAt(keys[field].assembled, pos, digit);
          if (formatSegmentValid(replacement) && lapSumDelta(keys, field, replacement) === 0)
            arithmetic.push({ field, pos, digit });
        }
      }
    }
    if (arithmetic.length < 2 || arithmetic.length > 12) {
      details.opticalPixelSumProbe[owner] = { arithmetic: arithmetic.length, supported: [] };
      continue;
    }
    const considered = arithmetic.map(({ field, pos, digit }) => {
      const read = keys[field];
      const slot = read.slots[pos];
      if (!slot || slot.type !== 'digit') return { read, slot, pos, digit, candidate: null };
      const candidate = readOpticalDigitAlternative(canonical, slot, read.field.type,
        digit, lapTemplate, totalTemplate);
      return { read, slot, pos, digit, candidate };
    });
    const supported = considered.filter((entry): entry is typeof entry & { candidate: NonNullable<typeof entry.candidate> } =>
      !!entry.candidate && entry.candidate.confidence >= .75 && entry.candidate.margin >= .65);
    details.opticalPixelSumProbe[owner] = { arithmetic: arithmetic.length,
      supported: supported.map(({ read, pos, digit, candidate }) => ({ field: read.field.name,
        pos, digit, confidence: candidate.confidence, margin: candidate.margin })),
      considered: considered.map(({ read, pos, digit, candidate }) => ({ field: read.field.name,
        pos, digit, confidence: candidate?.confidence ?? null, margin: candidate?.margin ?? null })) };
    if (supported.length !== 1) continue;
    const { read, slot, pos, digit, candidate } = supported[0];
    const from = read.assembled;
    slot.charValue = digit;
    slot.pattern = candidate.pattern;
    slot.confidence = candidate.confidence;
    slot.segmentScores = { ...candidate.values };
    read.physicalAssembled = replaceCharAt(from, pos, digit);
    read.assembled = read.physicalAssembled;
    read.validFormat = TIME_RE.test(read.assembled);
    read.rejectionReason = read.validFormat ? '' : 'invalid_format_or_unknown_digit';
    details.lapSumRepairs.push({ kind: 'optical_pixel_sum_refit', owner,
      field: read.field.name, from, to: read.assembled, char_pos: pos,
      confidence: candidate.confidence, margin: candidate.margin });
    details.lapSumOk = fieldsLapSumComplete(details);
  }
}

function fieldsLapSumComplete(details: SlotDetails): boolean {
  const owners = ['player', 'ghost'].map((owner) => {
    let total: string | null = null;
    const laps: string[] = [];
    for (const read of details.fields) {
      if (read.field.owner !== owner) continue;
      if (read.field.type === 'total') total = read.assembled;
      else if (read.field.type === 'lap') laps.push(read.assembled);
    }
    return { total, laps };
  });
  return lapSumComplete(owners);
}

// A lap sum that closes only after a repair counts as closed only when every
// digit read at least this cleanly: on a dark translucent ghost card two phone
// photos can repeat the same pair of compensating misreads (6 as 8 in one lap,
// 5 as 3 in the next), and a confirmed repair would lock them. Same rule as the
// APK engine overlay (ADR-0203).

function applyRepairConfidenceGuard(details: SlotDetails): void {
  let min = 1;
  for (const read of details.fields) {
    for (const slot of read.slots) if (slot.type === 'digit') min = Math.min(min, slot.confidence);
  }
  const guard = repairGuard(details.lapSumOk === true, details.lapSumRepairs.length, min);
  if (!guard) return;
  details.lapSumOk = false;
  details.lapSumRepairs.push(guard);
}

function preserveClosedGhostSide(seed: SlotDetails, refined: SlotDetails): void {
  const physicalGhost = seed.yellowPlayerSlot === 'top' ? 'player' : 'ghost';
  const seedRows = ownerFieldsTotalFirst(seed, physicalGhost);
  const refinedRows = ownerFieldsTotalFirst(refined, physicalGhost);
  if (seedRows.length === 0 || lapSumDelta(seedRows, -1, null) !== 0
      || (refinedRows.length > 0 && lapSumDelta(refinedRows, -1, null) === 0)) return;
  const original = new Map(seedRows.map((read) => [read.field.name, read]));
  refined.fields = refined.fields.map((read) => original.get(read.field.name) ?? read);
  refined.lapSumRepairs = [
    ...refined.lapSumRepairs.filter((repair) => repair.owner !== physicalGhost),
    ...seed.lapSumRepairs.filter((repair) => repair.owner === physicalGhost),
  ];
  refined.lapSumOk = fieldsLapSumComplete(refined);
  refined.ghostLapColumnOffsets = undefined;
}

function isReadGood(details: SlotDetails | null): boolean {
  if (!details || details.fields.length === 0) return false;
  if (details.lapSumOk === true) return true;
  let valid = 0;
  for (const f of details.fields) if (f.validFormat) valid++;
  return valid * 2 >= details.fields.length;
}

// ------------------------------------------------------------------ hoofd-run

export async function runFrame(frame: Frame, deps: PipelineDeps, options: RunOptions, listener: StageListener, isCancelled: () => boolean): Promise<FrameResult> {
  const c = cv();
  const started = performance.now();
  const stageTimings: Record<string, number> = {};
  let stageStart = 0;
  const timed: StageListener = (status, stage) => {
    if (status === 'started') stageStart = performance.now();
    else stageTimings[stage] = (stageTimings[stage] ?? 0) + Math.round(performance.now() - stageStart);
    listener(status, stage);
  };
  const checkCancel = () => {
    if (isCancelled()) throw new CancelledError();
  };
  const result: FrameResult = {
    status: 'not_started',
    message: '',
    firstBlockingStage: '',
    raceProfile: '',
    frameValid: false,
    lapSumOk: null,
    lapSumRepairs: 0,
    lapSumRepairList: [],
    expectedFieldCount: 0,
    fields: {},
    fieldDetails: [],
    kartConfig: null,
    stageStatus: {},
    totalRuntimeMs: 0,
    stageTimings,
    diagnostics: {},
  };
  const mats: any[] = [];
  const track = <T>(m: T): T => {
    mats.push(m);
    return m;
  };
  if (deps.kartConfig) {
    deps.kartConfig.textEvidence.captureCrops = !!options.wantOcrCrops;
    deps.kartConfig.textEvidence.crops = [];
  }
  try {
    timed('started', '00_InputImage');
    const bgr = track(rgbaToBgrMat(frame.rgba, frame.width, frame.height));
    timed('completed', '00_InputImage');
    checkCancel();
    timed('started', '01_AutoCardROI');
    const roi = await runAutoCardRoi(bgr, deps.detector, options.layout, options.sparseDualYellowCandidate, options.lapIndexOutlierCandidate, options.lapIndexDuplicateCandidate, options.lapIndexLatticeCandidate, deps.lapCircles ?? null);
    timed('completed', '01_AutoCardROI');
    result.stageStatus['01_AutoCardROI'] = roi.status;
    if (roi.detectionResult) result.diagnostics.detections = roi.detectionResult.detections;
    if (roi.removedLapIndexOutlier) result.diagnostics.lapIndexOutlier = roi.removedLapIndexOutlier;
    if (roi.removedLapIndexDuplicate) result.diagnostics.lapIndexDuplicate = roi.removedLapIndexDuplicate;
    if (roi.removedLapIndexOffLattice) result.diagnostics.lapIndexOffLattice = roi.removedLapIndexOffLattice;
    const selection = roi.selection;
    if (!selection.hasRoi()) {
      result.status = 'blocked';
      result.firstBlockingStage = '01_AutoCardROI';
      result.message = `${selection.status}: ${selection.reason}`;
      result.diagnostics.roi = { box: [0, 0, 0, 0], route: '', reason: selection.reason, status: selection.status, lapIndexCount: selection.counts.lapIndexCount, playerCount: selection.counts.playerCount, ghostCount: selection.counts.ghostCount };
      return result;
    }
    result.diagnostics.roi = { box: selection.roi!.toArray(), route: selection.candidate?.selectedRoute ?? '', reason: selection.selectedReason, status: 'implemented', lapIndexCount: selection.counts.lapIndexCount, playerCount: selection.counts.playerCount, ghostCount: selection.counts.ghostCount };
    checkCancel();
    const early = runEarlyCvStages(bgr, selection, options.identityOnly,
      timed, 220, !!options.brightnessShortlist440Candidate);
    mats.push(early.roi, early.adjusted, early.hsvMask, early.gray, early.clahe, early.adaptive);
    result.diagnostics.brightness = { brightness: early.choice.brightness, contrast: early.choice.contrast, reason: early.choice.reason };
    for (const s of ['02_AutoBrightnessContrast', '03_HSVMask', '04_Grayscale', '05_CLAHE', '06_AdaptiveThreshold']) result.stageStatus[s] = 'implemented';
    checkCancel();
    const pipeline = new Pipeline(deps, options);
    const ghostDetail = pipeline.isGhostDetail();
    const roiBox = selection.roi!;
    // 07/08
    timed('started', '07_FlowJoin');
    timed('completed', '07_FlowJoin');
    timed('started', '08_MaskCombine');
    const combined = track(new c.Mat());
    c.bitwise_and(early.hsvMask, early.adaptive, combined);
    timed('completed', '08_MaskCombine');
    timed('started', '09_MaskCleanup');
    const cleaned = track(cleanupMask(combined));
    timed('completed', '09_MaskCleanup');
    timed('started', '10_Morphology');
    const morphology = track(new c.Mat());
    const kernel = c.getStructuringElement(c.MORPH_RECT, new c.Size(8, 8));
    c.morphologyEx(cleaned, morphology, c.MORPH_CLOSE, kernel, new c.Point(-1, -1), 4, c.BORDER_CONSTANT, c.morphologyDefaultBorderValue());
    kernel.delete();
    timed('completed', '10_Morphology');
    timed('started', '11_CannyEdges');
    const edges = track(new c.Mat());
    c.Canny(morphology, edges, 35, 120);
    timed('completed', '11_CannyEdges');
    timed('started', '12_HoughLinesP');
    const lines = houghLines(edges);
    timed('completed', '12_HoughLinesP');
    timed('started', '13_AngleFilterLines');
    const axisFiltered = filterAngles(lines);
    const lineGuard = applyShortLineGuard(axisFiltered);
    timed('completed', '13_AngleFilterLines');
    timed('started', '14_ClusterLines');
    const clusters = clusterLines(lineGuard.lines);
    timed('completed', '14_ClusterLines');
    for (const s of ['07_FlowJoin', '08_MaskCombine', '09_MaskCleanup', '10_Morphology', '11_CannyEdges', '12_HoughLinesP', '13_AngleFilterLines', '14_ClusterLines']) result.stageStatus[s] = 'implemented';
    checkCancel();
    const geometricQuad = ghostDetail ? null : selectQuad(cleaned.rows, cleaned.cols, clusters);
    const seedQuads: Quad[] = [];
    const seedNames: string[] = [];
    const probe = options.researchPlayerCardQuad;
    const detectedCard = selection.playerOwnerBox;
    const geometricCardOverlap = geometricQuad && detectedCard
      ? boxIou(boxFromQuad(geometricQuad).clipped(cleaned.cols, cleaned.rows),
        new BoxD(detectedCard.left - roiBox.left, detectedCard.top - roiBox.top,
          detectedCard.right - roiBox.left, detectedCard.bottom - roiBox.top))
      : 0;
    const validProbe = probe?.length === 4
      && probe.every((point) => point.length === 2 && point.every(Number.isFinite));
    const bottomTiltDisagreement = geometricQuad && validProbe
      ? Math.abs((probe[2][1] - probe[3][1]) - (geometricQuad.br.y - geometricQuad.bl.y))
      : 0;
    // Keep this independent edge fit in the narrow class where the existing
    // line quad already localizes the same card but gives its lower edge a
    // materially different slope. A distant Hough quad is a separate failure
    // class and small refinements have shown OCR regressions in development.
    const tryResearchQuad = !ghostDetail && detectedCard && validProbe && (options.researchPlayerCardQuadForce
      || (geometricCardOverlap >= 0.75
        && bottomTiltDisagreement >= 0.04 * (detectedCard.bottom - detectedCard.top)));
    const addResearchSeed = () => {
      const local = probe!.map(([x, y]) => ({ x: x - roiBox.left, y: y - roiBox.top }));
      seedQuads.push(new Quad(local[0], local[1], local[2], local[3]));
      seedNames.push('research_player_card_edge_seed');
    };
    if (tryResearchQuad && !options.researchQuadAfterBaselineCandidate) addResearchSeed();
    if (geometricQuad) {
      seedQuads.push(geometricQuad);
      seedNames.push('geometric_quad');
    }
    const playerOwnerBox = ghostDetail ? null : selection.playerOwnerBox;
    if (playerOwnerBox) {
      seedQuads.push(new Quad(
        { x: playerOwnerBox.left - roiBox.left, y: playerOwnerBox.top - roiBox.top },
        { x: playerOwnerBox.right - roiBox.left, y: playerOwnerBox.top - roiBox.top },
        { x: playerOwnerBox.right - roiBox.left, y: playerOwnerBox.bottom - roiBox.top },
        { x: playerOwnerBox.left - roiBox.left, y: playerOwnerBox.bottom - roiBox.top },
      ));
      seedNames.push('player_owner_box_seed');
    }
    if (tryResearchQuad && options.researchQuadAfterBaselineCandidate) addResearchSeed();
    // ghost_detail: a phone photo is rarely level, and the badge ROI below is
    // axis-aligned, so a panel turned by 1-2 degrees pushes the right-hand
    // digits out of their slots. The badge column measures the turn; this seed
    // warps the turned panel upright onto the same ROI rectangle first.
    const deskew = ghostDetail ? ghostDetailDeskewSeed(selection, roiBox, early.adjusted.cols, early.adjusted.rows) : null;
    if (deskew) {
      seedQuads.push(deskew.quad);
      seedNames.push(GHOST_DETAIL_DESKEW_SEED);
      result.diagnostics.ghostDetailDeskewDegrees = deskew.degrees;
    }
    seedQuads.push(quadFromRect({ x: 0, y: 0, width: early.adjusted.cols, height: early.adjusted.rows }));
    seedNames.push('roi_box_guide_seed');
    const ghostDetailAltRoi = ghostDetail && selection.candidate ? selection.candidate.altRoi : null;
    if (ghostDetailAltRoi) {
      seedQuads.push(new Quad(
        { x: ghostDetailAltRoi.left - roiBox.left, y: ghostDetailAltRoi.top - roiBox.top },
        { x: ghostDetailAltRoi.right - roiBox.left, y: ghostDetailAltRoi.top - roiBox.top },
        { x: ghostDetailAltRoi.right - roiBox.left, y: ghostDetailAltRoi.bottom - roiBox.top },
        { x: ghostDetailAltRoi.left - roiBox.left, y: ghostDetailAltRoi.bottom - roiBox.top },
      ));
      seedNames.push('ghost_detail_alt_span_seed');
    }
    if (!ghostDetail && options.inlineOpticalBadgeRowCandidate) {
      const fitStart = performance.now();
      const fit = fitOpticalBadgeRowQuad(bgr, result.diagnostics.detections ?? []);
      const fitMs = performance.now() - fitStart;
      result.diagnostics.opticalBadgeRow = { status: fit.status, selected: false,
        firstStatus: 'pending', fitMs, rowCount: fit.rowCount, badgeCount: fit.badgeCount,
        sideSources: fit.sideSources, reason: 'ordinary_seeds_pending' };
      if (fit.status === 'candidate' && fit.quad) {
        const local = fit.quad.map(([x, y]) => ({ x: x - roiBox.left, y: y - roiBox.top }));
        seedQuads.push(new Quad(local[0], local[1], local[2], local[3]));
        seedNames.push('inline_badge_row_seed');
      }
    }
    let lateOutcome: LateOutcome | null = null;
    type SeedSnapshot = { outcome: LateOutcome; seedName: string; quad: Quad; yellowPosition: string | null;
      textCrops: NonNullable<PipelineDeps['kartConfig']>['textEvidence']['crops'] | null;
      antialiasFactor: number | undefined; stageStatus: Record<string, string> };
    let firstReadable: SeedSnapshot | null = null;
    let badgeFallback: SeedSnapshot | null = null;
    const snapshot = (outcome: LateOutcome, seedName: string, quad: Quad,
      yellowPosition: string | null): SeedSnapshot => ({ outcome, seedName, quad, yellowPosition,
      textCrops: deps.kartConfig ? [...deps.kartConfig.textEvidence.crops] : null,
      antialiasFactor: result.diagnostics.antialiasFactor, stageStatus: { ...result.stageStatus } });
    const restoreSnapshot = (saved: SeedSnapshot) => {
      lateOutcome = saved.outcome;
      result.stageStatus = { ...saved.stageStatus, localization_seed_used: saved.seedName };
      result.diagnostics.seedUsed = saved.seedName;
      result.diagnostics.quad = saved.quad.points().map((point) => [point.x, point.y] as [number, number]);
      result.diagnostics.yellowPosition = saved.yellowPosition;
      result.diagnostics.antialiasFactor = saved.antialiasFactor;
      if (deps.kartConfig && saved.textCrops) deps.kartConfig.textEvidence.crops = saved.textCrops;
    };
    let inlinePreferred: { outcome: LateOutcome; quad: Quad; yellowPosition: string | null;
      textCrops: NonNullable<PipelineDeps['kartConfig']>['textEvidence']['crops'] | null;
      antialiasFactor: number | undefined } | null = null;
    const restoreInlinePreferred = () => {
      if (!inlinePreferred) throw new Error('Missing closed geometric seed');
      lateOutcome = inlinePreferred.outcome;
      if (deps.kartConfig && inlinePreferred.textCrops) deps.kartConfig.textEvidence.crops = inlinePreferred.textCrops;
      result.diagnostics.antialiasFactor = inlinePreferred.antialiasFactor;
      result.stageStatus['localization_seed_used'] = 'geometric_quad';
      result.diagnostics.seedUsed = 'geometric_quad';
      result.diagnostics.quad = inlinePreferred.quad.points().map((p) => [p.x, p.y] as [number, number]);
      result.diagnostics.yellowPosition = inlinePreferred.yellowPosition;
    };
    for (let seedIdx = 0; seedIdx < seedQuads.length; seedIdx++) {
      checkCancel();
      const seedName = seedNames[seedIdx];
      const finalAttempt = seedIdx === seedQuads.length - 1
        || (seedName === 'roi_box_guide_seed' && seedNames.includes('inline_badge_row_seed'));
      const roiQuad = seedQuads[seedIdx];
      timed('started', '15_QuadSelect');
      result.stageStatus['15_QuadSelect'] = seedName === 'geometric_quad' ? 'implemented' : seedName;
      timed('completed', '15_QuadSelect');
      timed('started', '16_RoiRestore');
      // Java: shift met de FLOAT-box (niet de afgeronde crop-rect)
      const fullQuad = roiQuad.shifted(roiBox.left, roiBox.top);
      result.stageStatus['16_RoiRestore'] = 'implemented';
      timed('completed', '16_RoiRestore');
      timed('started', '17_PerspectiveWarp');
      // The deskew seed lands on the upright ROI rectangle itself, so stage 18
      // pins exactly what the axis-aligned seed would have pinned.
      const warpBounds = seedName === GHOST_DETAIL_DESKEW_SEED
        ? boundingRect(quadFromRect({ x: 0, y: 0, width: early.adjusted.cols, height: early.adjusted.rows }).shifted(roiBox.left, roiBox.top), bgr.cols, bgr.rows)
        : boundingRect(fullQuad, bgr.cols, bgr.rows);
      const warpDestinationQuad = quadFromRect(warpBounds);
      const homography = perspectiveHomography(fullQuad, warpBounds);
      const warp = warpFullImageTransform(bgr, homography);
      result.stageStatus['17_PerspectiveWarp'] = 'implemented';
      timed('completed', '17_PerspectiveWarp');
      timed('started', '18_CanonicalPlayerBoxAlign');
      const align = pipeline.canonicalAlign(warp, warpDestinationQuad, selection,
        !!options.researchGameAnchorLapProfileCandidate);
      warp.delete();
      // ÉÉN-resample-canonical: affine(18) x homografie(17) vanaf het rauwe frame
      const affine3 = c.matFromArray(3, 3, c.CV_64F, [align.scaleX, 0.0, align.translateX, 0.0, align.scaleY, align.translateY, 0.0, 0.0, 1.0]);
      let composed = new c.Mat();
      const noSrc3 = new c.Mat(); // gemm's unused third operand; deleted with the others below
      c.gemm(affine3, homography, 1.0, noSrc3, 0.0, composed, 0);
      // A 12 MP photo makes this warp shrink 4x or more, and bilinear sampling
      // then skips most pixels (aliasing breaks the thin seams between
      // segments). Area-average it down first until the warp keeps
      // ANTIALIAS_TARGET_SCALE; the homography is rescaled, so the geometry is
      // the same. Inputs in the validated range stay byte-identical (APK
      // overlay ADR-0203).
      let warpSource = bgr;
      let reduced: any = null;
      const shrink = Math.min(align.scaleX, align.scaleY);
      if (shrink > 0 && shrink < ANTIALIAS_BELOW_SCALE) {
        const factor = shrink / ANTIALIAS_TARGET_SCALE;
        const reducedW = Math.max(1, Math.round(bgr.cols * factor));
        const reducedH = Math.max(1, Math.round(bgr.rows * factor));
        reduced = new c.Mat();
        c.resize(bgr, reduced, new c.Size(reducedW, reducedH), 0, 0, c.INTER_AREA);
        const unscale = c.matFromArray(3, 3, c.CV_64F, [bgr.cols / reducedW, 0, 0, 0, bgr.rows / reducedH, 0, 0, 0, 1]);
        const rescaled = new c.Mat();
        c.gemm(composed, unscale, 1.0, noSrc3, 0.0, rescaled, 0);
        composed.delete();
        unscale.delete();
        composed = rescaled;
        warpSource = reduced;
        result.diagnostics.antialiasFactor = factor;
      }
      // QA isolation: compose a measured post-warp x correction before the
      // single RAW-to-canonical resample. The ordinary route never supplies it.
      const shear = seedName === 'geometric_quad' ? options.researchCanonicalShear : null;
      if (shear) {
        const [slope, intercept] = shear;
        const largestShift = Math.max(Math.abs(intercept), Math.abs(slope * 720 + intercept));
        if (!Number.isFinite(slope) || !Number.isFinite(intercept)
            || Math.abs(slope) > 0.03 || largestShift > 9) {
          throw new Error('Research canonical shear exceeds the bounded geometry probe');
        }
        const correction = c.matFromArray(3, 3, c.CV_64F,
          [1, -slope, -intercept, 0, 1, 0, 0, 0, 1]);
        const corrected = new c.Mat();
        c.gemm(correction, composed, 1.0, noSrc3, 0.0, corrected, 0);
        correction.delete();
        composed.delete();
        composed = corrected;
        result.diagnostics.researchCanonicalShear = { slope, intercept, largestShift };
      }
      const canonical = new c.Mat();
      c.warpPerspective(warpSource, canonical, composed, new c.Size(1280, 720), c.INTER_LINEAR, c.BORDER_REPLICATE, new c.Scalar());
      // The Select-a-Ghost panel laid onto its clean capture through its constant
      // parts (':' '.', badges, X, magnifier), then rendered once more (ADR-0203).
      let registration: number[] | null = null;
      if (ghostDetail) {
        const reg = ghostPanelRegistration(canonical, align.raceKey);
        result.diagnostics.ghostPanelRegistration = reg.info;
        if (reg.h) {
          registration = reg.h;
          const r = c.matFromArray(3, 3, c.CV_64F, reg.h);
          const registered = new c.Mat();
          c.gemm(r, composed, 1.0, noSrc3, 0.0, registered, 0);
          r.delete();
          composed.delete();
          composed = registered;
          c.warpPerspective(warpSource, canonical, composed, new c.Size(1280, 720), c.INTER_LINEAR, c.BORDER_REPLICATE, new c.Scalar());
        }
      }
      // The registered three-lap panel corrected toward HDMI from its own constant
      // elements before anything is read: staff192 and staff76 HDMI unchanged
      // (all fields right), webcam 9 -> 7 accepted wrong and 304 -> 310 right
      // against the same route without it.
      // The seven-lap panel has another layout and is not corrected.
      if (ghostDetail && deps.kartConfig) {
        const record = deps.kartConfig.correctGhostPanelInPlace(registration && align.raceKey !== 'race7' ? canonical : null);
        if (record) result.diagnostics.ghostPanelPhotometric = record;
      }
      if (reduced) reduced.delete();
      noSrc3.delete();
      affine3.delete();
      composed.delete();
      homography.delete();
      result.stageStatus['18_CanonicalPlayerBoxAlign'] = 'implemented';
      timed('completed', '18_CanonicalPlayerBoxAlign');
      // A registered Select-a-Ghost panel places its lap circles itself (step 19
      // skipped). Unregistered, an extra look's lap circles carry on: the panel's
      // second detection (colour, no margin) misses them the same way (runner.ts, as the APK).
      const reused = registration ? pipeline.registeredLapIndexDetections(align.raceKey, canonical.cols, canonical.rows)
        : options.identityOnly || selection.extraLook ? pipeline.transformRoiDetections(selection.detections, selection.frameWidth, selection.frameHeight, fullQuad, warpDestinationQuad, align, canonical.cols, canonical.rows, registration) : null;
      let inlineError = false;
      try {
        lateOutcome = await runLateStages(canonical, deps, options, pipeline, align, finalAttempt, reused, timed, checkCancel, result,
          seedName === GHOST_DETAIL_DESKEW_SEED, seedName === 'inline_badge_row_seed', seedName === 'geometric_quad');
      } catch (exc) {
        if (seedName !== 'inline_optical_card_edge_seed' || !inlinePreferred || exc instanceof CancelledError) throw exc;
        inlineError = true;
      } finally {
        canonical.delete();
      }
      if (inlineError) {
        (result.diagnostics.seedAttempts ??= []).push({ seed: seedName, readOk: false, reason: 'optional_seed_error' });
        const optical = result.diagnostics.opticalCardEdge!;
        optical.selected = false;
        optical.secondStatus = 'error';
        optical.reason = 'inline_retry_error';
        restoreInlinePreferred();
        break;
      }
      if (!lateOutcome) throw new Error('Missing late-stage outcome');
      (result.diagnostics.seedAttempts ??= []).push({
        seed: seedName,
        quad: fullQuad.points().map((p) => [p.x, p.y] as [number, number]),
        align: { scaleX: align.scaleX, scaleY: align.scaleY, translateX: align.translateX, translateY: align.translateY, raceKey: align.raceKey, yellowPosition: align.yellowPosition },
        readOk: lateOutcome.readOk,
        fields: lateOutcome.details ? Object.fromEntries(lateOutcome.details.fields.map((r) => [r.semanticFieldName || r.field.name, r.assembled])) : null,
        opticalPixelSum: lateOutcome.details?.opticalPixelSumProbe ?? null,
        canonicalDetections: lateOutcome.canonicalDetections ?? null,
        gridFields: lateOutcome.gridFields ?? null,
        ...(options.qaSeedIdentityTrace ? { identity: Object.fromEntries(
          Object.entries(lateOutcome.kartConfig?.owners ?? {}).map(([owner, fields]) =>
            [owner, { panelSource: fields.panel_source,
              fields: Object.fromEntries((['character', 'kart', 'wheel', 'glider', 'flag'] as const)
                .map((kind) => {
                  const entry = fields[kind];
                  return [kind, entry ? { id: entry.id ?? null, index: entry.index ?? null,
                    ok: entry.ok ?? false, score: entry.score ?? null,
                    reason: entry.reason ?? null, slot_xywh: entry.slot_xywh ?? null,
                    match_xywh: entry.match_xywh ?? null } : null];
                })) }])) } : {}),
      });
      if (options.inlineOpticalCardEdgeCandidate && seedName === 'geometric_quad'
          && lateOutcome.readOk && lateOutcome.seedLapSumOk === true && detectedCard) {
        const box: [number, number, number, number] = detectedCard.toArray();
        const fitStart = performance.now();
        const fit = fitYellowPlayerCardEdge(bgr, box);
        const fitMs = performance.now() - fitStart;
        const ordinary = fullQuad.points().map((p) => [p.x, p.y] as [number, number]);
        const conflict = fit.status === 'candidate' && fit.quad
          ? opticalBoxConflict(box, ordinary, fit.quad) : null;
        if (conflict?.edgeFirst) {
          inlinePreferred = { outcome: lateOutcome, quad: fullQuad, yellowPosition: align.yellowPosition,
            textCrops: deps.kartConfig ? [...deps.kartConfig.textEvidence.crops] : null,
            antialiasFactor: result.diagnostics.antialiasFactor };
          const local = fit.quad!.map(([x, y]) => ({ x: x - roiBox.left, y: y - roiBox.top }));
          seedQuads.splice(seedIdx + 1, 0, new Quad(local[0], local[1], local[2], local[3]));
          seedNames.splice(seedIdx + 1, 0, 'inline_optical_card_edge_seed');
          result.diagnostics.opticalCardEdge = { status: fit.status, selected: false,
            firstStatus: 'valid_decode', ordinaryOutsideMax: conflict.ordinaryOutsideMax,
            edgeBoxGapMax: conflict.edgeBoxGapMax, fitMs, elapsedMs: 0, reason: 'inline_edge_pending' };
          continue;
        }
      }
      if (seedName === 'inline_optical_card_edge_seed' && inlinePreferred) {
        const fields = (outcome: LateOutcome) => outcome.details
          ? Object.fromEntries(outcome.details.fields.map((field) => [field.semanticFieldName || field.field.name, field.assembled])) : {};
        const oldFields = fields(inlinePreferred.outcome);
        const newFields = fields(lateOutcome);
        const sameFields = Object.keys(oldFields).length === Object.keys(newFields).length
          && Object.entries(oldFields).every(([key, value]) => newFields[key] === value);
        const oldOwners = inlinePreferred.outcome.kartConfig?.owners ?? {};
        const newOwners = lateOutcome.kartConfig?.owners ?? {};
        const sameAcceptedIds = Object.entries(oldOwners).every(([owner, identity]) =>
          (['character', 'kart', 'wheel', 'glider', 'flag'] as const).every((kind) => {
            const old = identity[kind];
            return !old?.ok || !old.id || newOwners[owner]?.[kind]?.id === old.id;
          }));
        const selected = lateOutcome.readOk && lateOutcome.seedLapSumOk === true && sameFields && sameAcceptedIds;
        const optical = result.diagnostics.opticalCardEdge!;
        optical.selected = selected;
        optical.secondStatus = selected ? 'valid_decode' : 'rejected';
        optical.reason = selected ? 'game_card_box_conflict_and_closed_read' : 'inline_retry_rejected';
        if (!selected) {
          restoreInlinePreferred();
          break;
        }
      }
      if (seedName === 'roi_box_guide_seed' && seedNames.includes('inline_badge_row_seed')
          && lateOutcome.seedLapSumOk !== true) {
        badgeFallback = firstReadable ?? snapshot(lateOutcome, seedName, fullQuad, align.yellowPosition);
        const optical = result.diagnostics.opticalBadgeRow!;
        optical.firstStatus = 'partial_decode';
        optical.reason = 'badge_row_pending';
        continue;
      }
      if (seedName === 'inline_badge_row_seed' && badgeFallback) {
        const priorOwners = badgeFallback.outcome.kartConfig?.owners ?? {};
        const nextOwners = lateOutcome.kartConfig?.owners ?? {};
        const identityConflicts = Object.entries(priorOwners).flatMap(([owner, identity]) =>
          (['character', 'kart', 'wheel', 'glider', 'flag'] as const).flatMap((kind) => {
            const old = identity[kind];
            const proposed = nextOwners[owner]?.[kind];
            const nextId = proposed?.id ?? null;
            return old?.ok && old.id && nextId !== old.id
              ? [{ owner, kind, priorId: old.id, proposedId: nextId,
                priorScore: old.score ?? null, proposedScore: proposed?.score ?? null,
                priorTextId: old.text?.id ?? null, priorTextFuzzy: old.text?.fuzzy ?? null,
                proposedTextId: proposed?.text?.id ?? null,
                proposedTextFuzzy: proposed?.text?.fuzzy ?? null }] : [];
          }));
        const sameAcceptedIds = identityConflicts.length === 0;
        // A partial first warp can confidently match the wrong glider icon.
        // Only the newly aligned, independently read in-game glider row may
        // resolve that conflict. Other accepted identities remain protected.
        const textResolvedGliderConflicts = identityConflicts.length > 0
          && identityConflicts.every(({ owner, kind, proposedId, priorTextFuzzy }) => {
            const proposed = nextOwners[owner]?.glider;
            return kind === 'glider' && proposedId && proposed?.ok
              && proposed.text?.id === proposedId
              && (proposed.text.fuzzy ?? 0) >= .8
              && (proposed.text.margin ?? 0) >= .15
              && (priorTextFuzzy ?? 0) < .65;
          });
        const reviewedCharacterConflict = identityConflicts.length === 1
          && identityConflicts[0].kind === 'character'
          && !!identityConflicts[0].proposedId
          && !!nextOwners[identityConflicts[0].owner]?.character?.ok
          && (priorOwners[identityConflicts[0].owner]?.character?.name_text?.fuzzy ?? 0) < .65
          && (nextOwners[identityConflicts[0].owner]?.character?.name_text?.fuzzy ?? 0) < .65;
        const selected = lateOutcome.readOk && lateOutcome.seedLapSumOk === true
          && (sameAcceptedIds || textResolvedGliderConflicts || reviewedCharacterConflict);
        const optical = result.diagnostics.opticalBadgeRow!;
        if (selected && (textResolvedGliderConflicts || reviewedCharacterConflict)) {
          let reviewCount = 0;
          if (reviewedCharacterConflict) {
            const conflict = identityConflicts[0];
            const proposal = nextOwners[conflict.owner]?.character;
            if (proposal) {
              proposal.ok = false;
              proposal.reason = 'badge_row_conflicting_character_review';
              reviewCount++;
            }
          }
          for (const [owner, identity] of Object.entries(nextOwners)) {
            for (const kind of ['character', 'kart', 'wheel', 'glider', 'flag'] as const) {
              const proposal = identity[kind];
              if (!proposal?.ok || !proposal.id || priorOwners[owner]?.[kind]?.ok) continue;
              const text = kind === 'character' ? proposal.name_text : proposal.text;
              if (text?.id === proposal.id && (text.fuzzy ?? 0) >= .8) continue;
              proposal.ok = false;
              proposal.reason = 'badge_row_new_identity_review';
              reviewCount++;
            }
          }
          optical.identityReviewCount = reviewCount;
        }
        optical.selected = selected;
        optical.secondStatus = selected ? 'valid_decode'
          : !lateOutcome.readOk ? 'blocked'
            : lateOutcome.seedLapSumOk !== true ? 'partial_decode' : 'rejected';
        optical.reason = selected ? reviewedCharacterConflict
          ? 'closed_badge_row_read_with_character_review'
          : textResolvedGliderConflicts ? 'closed_badge_row_read_with_glider_text' : 'closed_badge_row_read'
          : !lateOutcome.readOk || lateOutcome.seedLapSumOk !== true ? 'retry_not_closed'
            : !sameAcceptedIds ? 'confident_identity_conflict' : 'retry_rejected';
        if (identityConflicts.length) optical.identityConflicts = identityConflicts;
        if (!selected) {
          restoreSnapshot(badgeFallback);
          break;
        }
      }
      if (lateOutcome.readOk) {
        if (options.strictLapSumSeedCandidate && !finalAttempt && lateOutcome.seedLapSumOk !== true) {
          firstReadable ??= snapshot(lateOutcome, seedName, fullQuad, align.yellowPosition);
          continue;
        }
        result.stageStatus['localization_seed_used'] = seedName;
        result.diagnostics.seedUsed = seedName;
        result.diagnostics.quad = fullQuad.points().map((p) => [p.x, p.y] as [number, number]);
        result.diagnostics.yellowPosition = align.yellowPosition;
        break;
      }
    }
    if (options.strictLapSumSeedCandidate && lateOutcome?.seedLapSumOk !== true && firstReadable) {
      restoreSnapshot(firstReadable);
    }
    if (result.diagnostics.opticalBadgeRow?.reason === 'ordinary_seeds_pending') {
      result.diagnostics.opticalBadgeRow.firstStatus = lateOutcome?.seedLapSumOk === true ? 'valid_decode' : 'partial_decode';
      result.diagnostics.opticalBadgeRow.reason = lateOutcome?.seedLapSumOk === true
        ? 'ordinary_closed' : 'incomplete_game_row_evidence';
    }
    result.raceProfile = lateOutcome?.raceKey ?? '';
    if (lateOutcome?.kartConfig) result.kartConfig = lateOutcome.kartConfig;
    if (lateOutcome?.details) {
      const details = lateOutcome.details;
      if (details.ghostLapColumnOffsets) result.diagnostics.ghostLapColumnOffsets = details.ghostLapColumnOffsets;
      if (details.playerLapColumnOffsets) result.diagnostics.playerLapColumnOffsets = details.playerLapColumnOffsets;
      result.lapSumOk = details.lapSumOk;
      result.lapSumRepairs = details.lapSumRepairs.length;
      result.lapSumRepairList = details.lapSumRepairs;
      let valid = 0;
      for (const read of details.fields) {
        const outputName = read.semanticFieldName || read.field.name;
        result.fields[outputName] = read.assembled;
        if (read.validFormat) valid++;
        result.fieldDetails.push({
          field_name: outputName,
          owner: read.semanticOwner || read.field.owner,
          physical_field: read.field.name,
          physical_owner: read.field.owner,
          field_type: read.field.type,
          lap_index: read.field.lapIndex,
          decoded_value: read.assembled,
          valid_format: read.validFormat,
          field_box: read.field.box.toArray(),
          slots: read.slots.map((s) => ({ slot_index: s.index, slot_type: s.type, box: s.box.toArray(), char: s.charValue, confidence: s.confidence, pattern: s.pattern })),
          crop_png: lateOutcome.fieldCrops?.get(read.field.name),
        });
      }
      result.frameValid = valid === details.fields.length;
      result.expectedFieldCount = lateOutcome.expectedFieldCount > 0 ? lateOutcome.expectedFieldCount : details.fields.length;
    }
    if (options.wantOcrCrops && deps.kartConfig) {
      const te = deps.kartConfig.textEvidence;
      const crops = [];
      for (const cr of te.crops) {
        const canvas = new OffscreenCanvas(cr.width, cr.height);
        canvas.getContext('2d')!.putImageData(new ImageData(cr.rgba as Uint8ClampedArray<ArrayBuffer>, cr.width, cr.height), 0, 0);
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        const png = await new Promise<string>((res) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.readAsDataURL(blob);
        });
        crops.push({ label: cr.label, script: cr.script, text: cr.text, png });
      }
      result.diagnostics.ocr_crops = crops;
    }
    if (lateOutcome?.gridFields) result.diagnostics.gridFields = lateOutcome.gridFields;
    if (lateOutcome?.canonicalDetections) result.diagnostics.canonicalDetections = lateOutcome.canonicalDetections;
    if (lateOutcome?.canonicalJpeg) result.diagnostics.canonical_jpeg = lateOutcome.canonicalJpeg;
    if (options.identityOnly) {
      result.status = lateOutcome?.readOk ? 'implemented' : 'blocked';
      if (!lateOutcome?.readOk) {
        result.firstBlockingStage = firstBlockingStage(result.stageStatus);
        result.message = 'identity-only frame produced no grid';
      }
    } else if (Object.keys(result.fields).length === 0) {
      result.status = 'blocked';
      result.firstBlockingStage = firstBlockingStage(result.stageStatus);
      result.message = 'No Step 26 fields available';
    } else if (result.frameValid && result.lapSumOk === true) {
      result.status = 'valid_decode';
      result.message = 'Step 26 fields and lap sums valid';
    } else {
      result.status = 'partial_decode';
      result.message = 'Step 26 fields incomplete or lap sums inconsistent';
    }
    if (options.sparseDualYellowCandidate) {
      const review = withholdSparseRecoveryIdentities(result);
      if (review) result.diagnostics.sparseRecoveryIdentityReview = review;
    }
    if (options.ownerPresenceCandidate && options.layout === 'endscreen' && !options.identityOnly) {
      result.diagnostics.ownerPresenceCandidate = applyOwnerPresenceCandidate(result);
    }
    return result;
  } catch (exc) {
    if (exc instanceof CancelledError) throw exc;
    result.status = 'error';
    result.message = exc instanceof Error ? exc.message : String(exc);
    result.firstBlockingStage = 'runtime';
    return result;
  } finally {
    for (const m of mats) {
      try {
        m.delete();
      } catch {
        /* al vrijgegeven */
      }
    }
    result.totalRuntimeMs = Math.round(performance.now() - started);
  }
}

function firstBlockingStage(stageStatus: Record<string, string>): string {
  const ordered = ['02_AutoBrightnessContrast', '03_HSVMask', '04_Grayscale', '05_CLAHE', '06_AdaptiveThreshold',
    '07_FlowJoin', '08_MaskCombine', '09_MaskCleanup', '10_Morphology', '11_CannyEdges', '12_HoughLinesP', '13_AngleFilterLines', '14_ClusterLines',
    '15_QuadSelect', '16_RoiRestore', '17_PerspectiveWarp', '18_CanonicalPlayerBoxAlign', '19_RFDetr3ClassDetect', '20_RFDetrLapIndexRefine',
    '21_RFDetrDynamicLapGrid', '22_FixedMK8Grid', '23_TimeTrialEndscreenGate', '24_SevenSegmentOCRProbe', '25_SevenSegmentOCRInspect', '26_OfflineOCRDecode'];
  for (const stage of ordered) {
    const status = stageStatus[stage];
    if (!status || status.startsWith('blocked') || status.startsWith('not_')) return stage;
  }
  return '26_OfflineOCRDecode';
}

interface LateOutcome {
  readOk: boolean;
  raceKey: string;
  details: SlotDetails | null;
  /** Seed routing uses the installed reader, even when an opt-in digit candidate runs. */
  seedLapSumOk?: boolean | null;
  kartConfig: KartConfigResult | null;
  expectedFieldCount: number;
  gridFields?: { name: string; box: [number, number, number, number] }[];
  canonicalDetections?: Detection[];
  canonicalJpeg?: string;
  fieldCrops?: Map<string, string>;
}

async function runLateStages(canonical: any, deps: PipelineDeps, options: RunOptions, pipeline: Pipeline, align: CanonicalAlign, finalAttempt: boolean, reused: DetectionResult | null, timed: StageListener, checkCancel: () => void, result: FrameResult, strictSeed = false, badgeSeed = false, geometricSeed = false): Promise<LateOutcome> {
  const raceKey = align.raceKey;
  const outcome: LateOutcome = { readOk: false, raceKey, details: null, kartConfig: null, expectedFieldCount: 0 };
  timed('started', '19_RFDetr3ClassDetect');
  const detections = reused ?? (await deps.detector.detect(canonical));
  result.stageStatus['19_RFDetr3ClassDetect'] = 'implemented';
  timed('completed', '19_RFDetr3ClassDetect');
  checkCancel();
  timed('started', '20_RFDetrLapIndexRefine');
  const refined = detections.detections.filter((d) => d.label === 'lap_index');
  refined.sort((a, b) => {
    const ya = f32((a.top + a.bottom) * 0.5);
    const yb = f32((b.top + b.bottom) * 0.5);
    return ya < yb ? -1 : ya > yb ? 1 : 0;
  });
  result.stageStatus['20_RFDetrLapIndexRefine'] = 'implemented';
  timed('completed', '20_RFDetrLapIndexRefine');
  timed('started', '21_RFDetrDynamicLapGrid');
  const grid = pipeline.buildDynamicGrid(canonical.cols, canonical.rows, detections.detections, refined, raceKey, detections.registered === true);
  if (!grid.available) {
    if (finalAttempt) {
      result.stageStatus['21_RFDetrDynamicLapGrid'] = grid.status;
      result.stageStatus['24_SevenSegmentOCRProbe'] = 'blocked_missing_dynamic_grid';
      result.stageStatus['26_OfflineOCRDecode'] = 'blocked_missing_slot_details';
      result.message = grid.reason;
    }
    timed('completed', '21_RFDetrDynamicLapGrid');
    return outcome;
  }
  result.stageStatus['21_RFDetrDynamicLapGrid'] = 'implemented';
  outcome.expectedFieldCount = grid.expectedFieldCount;
  outcome.gridFields = grid.fields.map((f) => ({ name: f.name, box: f.box.toArray() }));
  outcome.canonicalDetections = detections.detections;
  timed('completed', '21_RFDetrDynamicLapGrid');
  checkCancel();
  if (geometricSeed && options.canonicalPunctuationShearCandidate && options.canonicalPunctuationReference
      && raceKey === 'race7' && align.yellowPosition === 'bottom') {
    const fitStarted = performance.now();
    const fields = grid.fields.filter((f) => f.type === 'lap').map((f) => ({ owner: f.owner,
      lap: f.lapIndex, left: f.box.left, top: f.box.top }));
    const fit = fitCanonicalPunctuationShear(canonical, options.canonicalPunctuationReference,
      fields, detections.detections);
    result.diagnostics.canonicalPunctuationShear = { ...fit, fitMs: Math.round(performance.now() - fitStarted) };
    if (fit.selected) {
      const c = cv();
      const affine = c.matFromArray(2, 3, c.CV_64F,
        [1, -fit.slope, -fit.intercept, 0, 1, 0]);
      const corrected = new c.Mat();
      try {
        c.warpAffine(canonical, corrected, affine, new c.Size(1280, 720),
          c.INTER_LINEAR, c.BORDER_REPLICATE, new c.Scalar());
        corrected.copyTo(canonical);
      } finally {
        affine.delete(); corrected.delete();
      }
    }
  }
  const ghostDetail = pipeline.isGhostDetail();
  if (options.identityOnly) {
    if (deps.kartConfig) {
      timed('started', '27_KartConfig');
      const yellowPos = ghostDetail ? null : detectYellowPlayerSlot(canonical).position;
      outcome.kartConfig = await runKartConfig(canonical, deps.kartConfig, raceKey, yellowPos, grid, ghostDetail,
        !!options.characterRescueFamilyGuardCandidate, !!options.rawRgbCandidate,
        !!options.wheelTextConflictReviewCandidate, !!options.kartVariantTextReviewCandidate,
        !!options.wheelTextProposalCandidate, !!options.flagBlueBandReviewCandidate, !!options.achromaticGapCandidate,
        !!options.kartFamilySearchCandidate, !!options.gliderTextConflictReviewCandidate,
        !!options.cardBoxAlignCandidate, detections.detections, !!options.gliderRowUpshiftCandidate,
        !!options.flagChromaticBandReviewCandidate, !!options.opticalSharpnessReviewCandidate);
      if (ghostDetail) {
        const total = grid.fields.find((field) => field.name === 'ghost_total');
        await deps.kartConfig.attachSharedToneQa(canonical, outcome.kartConfig?.owners.ghost,
          total ? total.box.toArray().map(Math.round) as [number, number, number, number] : null);
        await deps.kartConfig.attachSharedJointLoadoutQa(canonical, outcome.kartConfig?.owners.ghost,
          total ? total.box.toArray().map(Math.round) as [number, number, number, number] : null);
      }
      timed('completed', '27_KartConfig');
    }
    outcome.readOk = true;
    return outcome;
  }
  timed('started', '24_SevenSegmentOCRProbe');
  const seedDetails = buildSlotDetails(canonical, grid, ghostDetail, deps.lapTemplate, deps.totalTemplate,
    false, false, false, badgeSeed);
  outcome.seedLapSumOk = seedDetails.lapSumOk;
  result.stageStatus['24_SevenSegmentOCRProbe'] = 'implemented_slot_details';
  timed('completed', '24_SevenSegmentOCRProbe');
  // The deskew seed wins only with a closed lap sum: on a photo that is already
  // level the badge fit measures noise, and a readable but slightly wrong read
  // must not push out the axis-aligned seed, which otherwise follows unchanged.
  if (!finalAttempt && (strictSeed ? seedDetails.lapSumOk !== true : !isReadGood(seedDetails))) return outcome;
  timed('started', '26_OfflineOCRDecode');
  result.stageStatus['26_OfflineOCRDecode'] = 'implemented_offline_slot_details';
  const refinedDetails = options.ghostLapColumnCandidate || options.playerLapColumnCandidate || options.ghostTotalVerticalCandidate
    ? buildSlotDetails(canonical, grid, ghostDetail, deps.lapTemplate, deps.totalTemplate,
      !!options.ghostLapColumnCandidate, !!options.playerLapColumnCandidate, !!options.ghostTotalVerticalCandidate,
      badgeSeed)
    : seedDetails;
  // A repeated ghost-column shift is only a rescue. Preserve a closed ordinary
  // read when the shifted digits break its lap/total consistency.
  const details = options.ghostLapColumnCandidate && seedDetails.lapSumOk === true
    && refinedDetails.lapSumOk !== true ? seedDetails : refinedDetails;
  if (options.ghostLapColumnCandidate && details === refinedDetails)
    preserveClosedGhostSide(seedDetails, refinedDetails);
  if (options.repairConfidenceGuardCandidate) applyRepairConfidenceGuard(details);
  outcome.details = details;
  if (badgeSeed && details.lapSumRepairs.some((repair) => repair.kind === 'optical_pixel_sum_refit'))
    outcome.seedLapSumOk = details.lapSumOk;
  // The badge-row retry can only win with a closed read, including its narrow
  // pixel-sum repair. An open read needs no full identity-matcher pass.
  if (badgeSeed && outcome.seedLapSumOk !== true) return outcome;
  if (options.wantFieldCrops) outcome.fieldCrops = await fieldCrops(canonical, details);
  if (options.wantCanonicalJpeg) {
    try {
      outcome.canonicalJpeg = await canonicalJpeg(canonical);
    } catch {
      /* diagnostiek is optioneel */
    }
  }
  timed('completed', '26_OfflineOCRDecode');
  checkCancel();
  if (deps.kartConfig) {
    timed('started', '27_KartConfig');
    outcome.kartConfig = await runKartConfig(canonical, deps.kartConfig, raceKey, details.yellowPlayerSlot, grid, ghostDetail,
      !!options.characterRescueFamilyGuardCandidate, !!options.rawRgbCandidate,
      !!options.wheelTextConflictReviewCandidate, !!options.kartVariantTextReviewCandidate,
      !!options.wheelTextProposalCandidate, !!options.flagBlueBandReviewCandidate, !!options.achromaticGapCandidate,
      !!options.kartFamilySearchCandidate, !!options.gliderTextConflictReviewCandidate,
      !!options.cardBoxAlignCandidate, detections.detections, !!options.gliderRowUpshiftCandidate,
      !!options.flagChromaticBandReviewCandidate, !!options.opticalSharpnessReviewCandidate);
    if (ghostDetail) {
      const total = details.fields.find((read) => read.field.name === 'ghost_total');
      await deps.kartConfig.attachSharedToneQa(canonical, outcome.kartConfig?.owners.ghost,
        total ? total.field.box.toArray().map(Math.round) as [number, number, number, number] : null);
      await deps.kartConfig.attachSharedJointLoadoutQa(canonical, outcome.kartConfig?.owners.ghost,
        total ? total.field.box.toArray().map(Math.round) as [number, number, number, number] : null);
    }
    timed('completed', '27_KartConfig');
  }
  outcome.readOk = true;
  return outcome;
}

/** Variance of the four-neighbour grayscale Laplacian on the in-game Ghost
 * digit/part area. Only the opt-in QA review gate uses this fixed canonical ROI. */
function ghostPanelSharpness(canonical: any): number | null {
  if (canonical.cols < 820 || canonical.rows < 310) return null;
  const data = canonical.data as Uint8Array;
  const stride = canonical.cols * 3;
  const gray = (x: number, y: number) => {
    const i = y * stride + x * 3;
    return (29 * data[i] + 150 * data[i + 1] + 77 * data[i + 2]) / 256;
  };
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 191; y < 309; y++) {
    for (let x = 551; x < 819; x++) {
      const lap = gray(x - 1, y) + gray(x + 1, y) + gray(x, y - 1) + gray(x, y + 1) - 4 * gray(x, y);
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

async function runKartConfig(canonical: any, matcher: KartConfigMatcher, raceKey: string, yellowPlayerSlot: string | null, grid: DynamicGrid, ghostDetail: boolean, guardCrossFamilyRescue = false, rawRgbCandidate = false, wheelTextConflictReviewCandidate = false, kartVariantTextReviewCandidate = false, wheelTextProposalCandidate = false, flagBlueBandReviewCandidate = false, achromaticGapCandidate = false, kartFamilySearchCandidate = false, gliderTextConflictReviewCandidate = false, cardBoxAlignCandidate = false, detections: Detection[] = [], gliderRowUpshiftCandidate = false, flagChromaticBandReviewCandidate = false, opticalSharpnessReviewCandidate = false): Promise<KartConfigResult> {
  const started = performance.now();
  const owners: Record<string, OwnerIdentity> = {};
  const localeSlot: (string | null)[] = [null, null];
  const ownerOrderList = ghostDetail ? ['ghost'] : (yellowPlayerSlot === 'top' ? ['ghost', 'player'] : ['player', 'ghost']);
  const matcherRaceKey = ghostDetail ? (raceKey === 'race7' ? RACE_KEY_GHOST_DETAIL7 : RACE_KEY_GHOST_DETAIL) : raceKey;
  try {
    for (const physOwner of ownerOrderList) {
      const anchor = grid.ownerAnchors.get(physOwner) ?? null;
      const semantic = semanticOwner(physOwner, yellowPlayerSlot);
      const cardLabel = semantic === 'ghost' ? 'ghost_timetrail_box' : 'player_timetrail_box';
      const card = cardBoxAlignCandidate && !anchor ? detections
        .filter((item) => item.label === cardLabel && item.score >= 0.9)
        .sort((a, b) => b.score - a.score)[0] : null;
      const cardBox = card ? [card.left, card.top, card.right, card.bottom] : null;
      const match = await matcher.matchCard(canonical, physOwner, matcherRaceKey, anchor, semantic === 'player', localeSlot, guardCrossFamilyRescue, rawRgbCandidate, wheelTextConflictReviewCandidate, kartVariantTextReviewCandidate, wheelTextProposalCandidate, flagBlueBandReviewCandidate, achromaticGapCandidate, kartFamilySearchCandidate, gliderTextConflictReviewCandidate, false, null, gliderRowUpshiftCandidate, flagChromaticBandReviewCandidate);
      const slot = match.glider?.slot_xywh;
      if (cardBox && slot && match.panel_source === 'static_canonical') {
        const [left, top, right, bottom] = cardBox;
        const centerX = slot[0] + slot[2] / 2;
        const centerY = slot[1] + slot[3] / 2;
        const misplaced = centerX < left * canonical.cols - 8 || centerX > right * canonical.cols + 8
          || centerY < top * canonical.rows - 8 || centerY > bottom * canonical.rows + 8;
        if (misplaced) {
          const aligned = await matcher.matchCard(canonical, physOwner, matcherRaceKey, anchor, semantic === 'player', [...localeSlot], guardCrossFamilyRescue, rawRgbCandidate, wheelTextConflictReviewCandidate, kartVariantTextReviewCandidate, wheelTextProposalCandidate, flagBlueBandReviewCandidate, achromaticGapCandidate, kartFamilySearchCandidate, gliderTextConflictReviewCandidate, true, cardBox, gliderRowUpshiftCandidate, flagChromaticBandReviewCandidate);
          const glider = aligned.glider;
          const row = glider?.text;
          if (aligned.panel_source === 'detected_card_box' && glider?.ok && glider.id && row?.id
              && row.fuzzy >= 0.65 && row.margin >= 0.15
              && familyOf(String(glider.id)) === familyOf(String(row.id))
              && glider.id !== match.glider?.id) {
            match.glider = { ...glider, geometry_source: 'detected_card_box' };
          }
        }
      }
      match.physical_owner = physOwner;
      match.semantic_owner = semantic;
      owners[semantic] = match;
    }
    if (!ghostDetail) await matcher.attachResultFlagWhiteQa(canonical, owners);
    const qaSharpness = ghostDetail && opticalSharpnessReviewCandidate
      ? ghostPanelSharpness(canonical) : null;
    if (qaSharpness != null && qaSharpness < 100) {
      for (const entry of Object.values(owners.ghost ?? {})) {
        if (!entry || typeof entry !== 'object' || !('ok' in entry) || !entry.ok) continue;
        const identity = entry as IdentityEntry;
        identity.proposed_id = identity.id ?? undefined;
        identity.proposed_index = identity.index ?? undefined;
        identity.proposed_name = identity.name;
        identity.review_required = true;
        identity.ok = false;
        identity.reason = 'optical_sharpness_review';
      }
    }
    return { stage: '27_KartConfig', status: 'implemented', race_key: raceKey,
      yellow_player_slot: yellowPlayerSlot, owners, duration_ms: Math.round(performance.now() - started),
      ...(qaSharpness != null ? { qa_sharpness: Math.round(qaSharpness * 10) / 10 } : {}) };
  } catch (exc) {
    // identiteit mag de tijden-read nooit breken
    return { stage: '27_KartConfig', status: `failed_${exc instanceof Error ? exc.name : 'error'}`, race_key: raceKey, yellow_player_slot: yellowPlayerSlot, owners, duration_ms: Math.round(performance.now() - started) };
  }
}

async function fieldCrops(canonical: any, details: SlotDetails): Promise<Map<string, string>> {
  const c = cv();
  const out = new Map<string, string>();
  for (const fr of details.fields) {
    const b = fr.field.box;
    const x = Math.trunc(Math.max(0, b.left - 2));
    const y = Math.trunc(Math.max(0, b.top - 2));
    const w = Math.trunc(Math.min(canonical.cols - x, b.right - b.left + 4));
    const h = Math.trunc(Math.min(canonical.rows - y, b.bottom - b.top + 4));
    if (w < 4 || h < 4) continue;
    const crop = canonical.roi(new c.Rect(x, y, w, h));
    try {
      out.set(fr.field.name, await bgrMatToPngDataUrl(c, crop));
    } catch {
      /* optioneel */
    } finally {
      crop.delete();
    }
  }
  return out;
}

async function canonicalJpeg(canonical: any): Promise<string> {
  const c = cv();
  const rgba = new c.Mat();
  c.cvtColor(canonical, rgba, c.COLOR_BGR2RGBA);
  const canvas = new OffscreenCanvas(rgba.cols, rgba.rows);
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.data), rgba.cols, rgba.rows), 0, 0);
  rgba.delete();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export { LIVE_REVIEW_STAGE_ORDER, clampInt, Box };
export type { FrameDiagnostics, FieldDetail };
