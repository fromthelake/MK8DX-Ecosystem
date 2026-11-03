// The central card ROI selection (CENTRAL_RECOGNITION section 8.6, phase 5): the TypeScript port of
// python/mk8dx_icon_matcher/card_roi.py (the reference) and CardRoi.java, kept equal by the parity
// vectors (tooling/recognition/card_roi_vectors.py, vectors/card-roi-v1.json). The card ROI from the
// RF-DETR detections and the image-derived yellow reference boxes; the Select-a-Ghost panel from its
// badge column and row pitch. Originally the Web scanner's port of the APK's AutoCardRoiSelector:
// box fields are Java floats, so values are rounded with Math.fround at the same places.

const f32 = Math.fround;

/** A detection, normalised 0..1 to the frame (float32 values as the detector gives them). */
export interface Detection {
  label: string;
  score: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const LAP_INDEX_WIDTH_SCALE_BREAKPOINT_PX = 40.0;
const LARGE_LAP_INDEX_WIDTH_SCALE = 1.012;
const SMALL_LAP_INDEX_WIDTH_SCALE = 1.014;
const OWNER_CONSTRAINT_X_MARGIN_RATIO = 0.12;
const OWNER_CONSTRAINT_TOP_MARGIN_RATIO = 0.04;
const OWNER_CONSTRAINT_BOTTOM_MARGIN_RATIO = 0.12;

export const GHOST_DETAIL_LEFT_ROWGAP = -1.0;
export const GHOST_DETAIL_TOP_ROWGAP = -1.0;
export const GHOST_DETAIL_RIGHT_ROWGAP_RACE3 = 5.0;
export const GHOST_DETAIL_RIGHT_ROWGAP_RACE7 = 6.0;
export const GHOST_DETAIL_BOTTOM_ROWGAP = 1.0;

export class Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;

  constructor(left: number, top: number, right: number, bottom: number) {
    left = f32(left);
    top = f32(top);
    right = f32(right);
    bottom = f32(bottom);
    this.left = Math.min(left, right);
    this.top = Math.min(top, bottom);
    this.right = Math.max(left, right);
    this.bottom = Math.max(top, bottom);
  }

  width(): number {
    return f32(Math.max(1.0, f32(this.right - this.left)));
  }

  height(): number {
    return f32(Math.max(1.0, f32(this.bottom - this.top)));
  }

  centerX(): number {
    return f32(f32(this.left + this.right) * 0.5);
  }

  centerY(): number {
    return f32(f32(this.top + this.bottom) * 0.5);
  }

  containsCenter(box: Box): boolean {
    const cx = box.centerX();
    const cy = box.centerY();
    return cx >= this.left && cx <= this.right && cy >= this.top && cy <= this.bottom;
  }

  expanded(dx: number, dy: number): Box {
    return new Box(this.left - dx, this.top - dy, this.right + dx, this.bottom + dy);
  }

  clipped(width: number, height: number): Box {
    return new Box(
      Math.max(0.0, Math.min(f32(width - 1.0), this.left)),
      Math.max(0.0, Math.min(f32(height - 1.0), this.top)),
      Math.max(1.0, Math.min(width, this.right)),
      Math.max(1.0, Math.min(height, this.bottom)),
    );
  }

  quantizedYellowReference(width: number, height: number): Box {
    return this.roundedClamp(width, height);
  }

  roundedClamp(width: number, height: number): Box {
    const qLeft = Math.max(0.0, Math.min(f32(width - 2.0), Math.round(this.left)));
    const qTop = Math.max(0.0, Math.min(f32(height - 2.0), Math.ceil(this.top)));
    const qRight = Math.max(f32(qLeft + 1.0), Math.min(width, Math.round(this.right)));
    const qBottom = Math.max(f32(qTop + 1.0), Math.min(height, Math.round(this.bottom)));
    return new Box(qLeft, qTop, qRight, qBottom);
  }

  toArray(): [number, number, number, number] {
    return [this.left, this.top, this.right, this.bottom];
  }
}

export interface DetectionCounts {
  candidateCount: number;
  playerCount: number;
  ghostCount: number;
  lapIndexCount: number;
}

export class Candidate {
  roi: Box;
  reason: string;
  selectedRoute = '';
  score = 0;
  rfdetrScore = 0;
  lapIndexCount = 0;
  playerLapIndexCount = 0;
  ghostLapIndexCount = 0;
  lapIndexWidth = 0;
  lapIndexHeight = 0;
  rowGap = 0;
  projectedRowCount = 0;
  sourceBox: Box | null = null;
  altRoi: Box | null = null;
  yellowReference: Box | null = null;
  yellowPanelBand: Box | null = null;
  ownerConstraintBox: Box | null = null;
  roiBeforeOwnerConstraint: Box | null = null;
  roiBeforeDualOwnerGroupConstraint: Box | null = null;
  otherLapGroupSourceBox: Box | null = null;
  yellowSupportScore = 0;
  yellowPanelBandOverlap = 0;
  yellowLegacyLeftScore = 0;
  yellowSupportPass = false;
  yellowSupportReason = '';
  ownerConstraintApplied = false;
  ownerConstraintReason = '';
  dualOwnerGroupConstraintApplied = false;
  dualOwnerGroupConstraintReason = '';
  dualOwnerGroupSeparatorY = 0;

  constructor(roi: Box, reason: string) {
    this.roi = roi;
    this.reason = reason;
  }
}

export class Selection {
  readonly roi: Box | null;
  readonly status: string;
  readonly reason: string;
  readonly selectedReason: string;
  readonly fallbackUsed: boolean;
  readonly counts: DetectionCounts;
  readonly candidate: Candidate | null;
  playerOwnerBox: Box | null = null;
  ghostOwnerBox: Box | null = null;
  detections: Detection[] = [];
  frameWidth = 0;
  frameHeight = 0;
  /** Found only by an extra look (runner.ts); its detections then carry on to step 19. */
  extraLook = false;

  private constructor(candidate: Candidate | null, status: string, reason: string, selectedReason: string, fallbackUsed: boolean, counts: DetectionCounts) {
    this.roi = candidate ? candidate.roi : null;
    this.status = status;
    this.reason = reason;
    this.selectedReason = selectedReason;
    this.fallbackUsed = fallbackUsed;
    this.counts = counts;
    this.candidate = candidate;
  }

  static selected(candidate: Candidate, fallbackUsed: boolean, counts: DetectionCounts): Selection {
    return new Selection(candidate, 'implemented', '', candidate.reason, fallbackUsed, counts);
  }

  static blocked(status: string, reason: string, counts: DetectionCounts): Selection {
    return new Selection(null, status, reason, '', false, counts);
  }

  hasRoi(): boolean {
    return this.roi !== null;
  }
}

interface YellowSupport {
  pass: boolean;
  score: number;
  reason: string;
  reference: Box | null;
  panelBand: Box | null;
  panelBandOverlap: number;
  legacyLeftScore: number;
}

function supportFail(reason: string): YellowSupport {
  return { pass: false, score: 0.0, reason, reference: null, panelBand: null, panelBandOverlap: 0, legacyLeftScore: 0 };
}

function supportPass(score: number, reason: string, reference: Box, panelBand: Box, panelBandOverlap: number, legacyLeftScore: number): YellowSupport {
  return { pass: true, score, reason, reference, panelBand, panelBandOverlap, legacyLeftScore };
}

export function median(values: number[]): number {
  if (values.length === 0) return 0.0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.trunc(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) * 0.5;
}

export function detectionBoxPixels(d: Detection, width: number, height: number): Box {
  return new Box(f32(d.left * width), f32(d.top * height), f32(d.right * width), f32(d.bottom * height));
}

export class AutoCardRoiSelector {
  select(detections: Detection[], width: number, height: number, yellowReferences: Box[]): Selection {
    const yellowRefs = yellowReferences ?? [];
    const counts = countDetections(detections);
    const lapBoxes = lapIndexBoxes(detections, width, height);
    const player = bestDetection(detections, 'player_timetrail_box');
    const ghost = bestDetection(detections, 'ghost_timetrail_box');
    const ghostBox = ghost ? detectionBoxPixels(ghost, width, height) : null;
    const playerOwnerBox = player ? detectionBoxPixels(player, width, height) : null;
    if (player) {
      const playerBox = playerOwnerBox!;
      const playerLapBoxes = lapIndexesInside(lapBoxes, playerBox);
      const playerCandidate = projectedRoiFromLapGroup(playerLapBoxes, width, height, 'lap_index_projected_player_ref', player.score, playerBox);
      if (playerCandidate && playerCandidate.lapIndexCount >= 3) {
        playerCandidate.selectedRoute = ghost ? 'player_and_ghost_supported' : 'player_box_supported';
        playerCandidate.playerLapIndexCount = playerCandidate.lapIndexCount;
        playerCandidate.ghostLapIndexCount = ghostBox ? lapIndexesInside(lapBoxes, ghostBox).length : 0;
        playerCandidate.yellowSupportPass = true;
        playerCandidate.yellowSupportReason = 'owner_box_route_does_not_require_yellow_fallback';
        return withOwnerBoxes(Selection.selected(playerCandidate, false, counts), playerOwnerBox, ghostBox);
      }
    }
    if (!player && ghostBox && counts.lapIndexCount > 5) {
      const ghostGroup = lapIndexesInside(lapBoxes, ghostBox);
      const playerGroup = lapIndexesOutside(lapBoxes, ghostBox);
      if (ghostGroup.length >= 2 && playerGroup.length >= 2) {
        const support = evaluateYellowSupport(playerGroup, yellowRefs, width, height);
        if (support.pass) {
          const candidate = projectedRoiFromLapGroup(playerGroup, width, height, 'lap_index_projected_ghost_split_yellow_ref', 0.0, null);
          if (candidate) {
            candidate.selectedRoute = 'ghost_box_lap_split';
            candidate.playerLapIndexCount = playerGroup.length;
            candidate.ghostLapIndexCount = ghostGroup.length;
            candidate.yellowSupportScore = support.score;
            candidate.yellowSupportPass = true;
            candidate.yellowSupportReason = support.reason;
            candidate.yellowReference = support.reference;
            return withOwnerBoxes(Selection.selected(candidate, false, counts), playerOwnerBox, ghostBox);
          }
        }
      }
    }
    if (!player && !ghost && (counts.lapIndexCount === 3 || counts.lapIndexCount === 7)) {
      const support = evaluateYellowSupport(lapBoxes, yellowRefs, width, height);
      if (support.pass) {
        const candidate = projectedRoiFromLapGroup(lapBoxes, width, height, 'lap_index_projected_single_owner_yellow_ref', 0.0, null);
        if (candidate) {
          candidate.selectedRoute = 'lap_index_single_owner_yellow';
          candidate.playerLapIndexCount = candidate.lapIndexCount;
          candidate.ghostLapIndexCount = 0;
          candidate.yellowSupportScore = support.score;
          candidate.yellowSupportPass = true;
          candidate.yellowSupportReason = support.reason;
          candidate.yellowReference = support.reference;
          return withOwnerBoxes(Selection.selected(candidate, false, counts), playerOwnerBox, ghostBox);
        }
      }
    }
    if (!player && !ghost && (counts.lapIndexCount === 6 || counts.lapIndexCount === 14)) {
      const groups = ownerGroupsFromLapIndexes(lapBoxes);
      let best: Candidate | null = null;
      let bestSupport = supportFail('no_lap_index_group_with_yellow_support');
      let bestIndex = -1;
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        if (group.length < 2) continue;
        const support = evaluateYellowSupport(group, yellowRefs, width, height);
        if (!support.pass || support.score <= bestSupport.score) continue;
        let candidate = projectedRoiFromLapGroup(group, width, height, 'lap_index_projected_yellow_ref', 0.0, null);
        if (!candidate) continue;
        candidate = constrainProjectedRoiAwayFromOtherLapGroups(candidate, group, groups, i, width, height);
        best = candidate;
        bestSupport = support;
        bestIndex = i;
      }
      if (best) {
        best.selectedRoute = 'lap_index_dual_owner_yellow';
        best.playerLapIndexCount = best.lapIndexCount;
        best.ghostLapIndexCount = 0;
        for (let i = 0; i < groups.length; i++) {
          if (i !== bestIndex) best.ghostLapIndexCount += groups[i].length;
        }
        best.yellowSupportScore = bestSupport.score;
        best.yellowSupportPass = true;
        best.yellowSupportReason = bestSupport.reason;
        best.yellowReference = bestSupport.reference;
        best.yellowPanelBand = bestSupport.panelBand;
        best.yellowPanelBandOverlap = bestSupport.panelBandOverlap;
        best.yellowLegacyLeftScore = bestSupport.legacyLeftScore;
        return withOwnerBoxes(Selection.selected(best, false, counts), playerOwnerBox, ghostBox);
      }
    }
    return withOwnerBoxes(Selection.blocked(
      'blocked_missing_supported_owner_lap_index_route',
      'Step 01 did not find a general supported route from owner boxes, lap-index grouping, and image-derived yellow panel evidence.',
      counts,
    ), playerOwnerBox, ghostBox);
  }

  /** Opt-in recovery when the detector sees two separated badge rows but no
   * player box. Both the badge columns and the yellow panel are game pixels. */
  selectSparseDualYellowCandidate(detections: Detection[], width: number, height: number, yellowReferences: Box[]): Selection | null {
    if (detections.some((d) => d.label === 'player_timetrail_box')) return null;
    const lapBoxes = lapIndexBoxes(detections, width, height).sort((a, b) => a.centerY() - b.centerY());
    if (lapBoxes.length < 4 || lapBoxes.length > 9) return null;
    if (lapBoxes.length > 7 && detections.some((d) => d.label === 'ghost_timetrail_box')) return null;
    const gaps = lapBoxes.slice(1).map((box, i) => box.centerY() - lapBoxes[i].centerY());
    const largest = Math.max(...gaps);
    const split = gaps.indexOf(largest) + 1;
    const otherGaps = gaps.filter((_, i) => i !== split - 1);
    if ((split < 3 && lapBoxes.length <= 7) || largest < median(otherGaps) * 2.2 || largest < height * 0.05) return null;
    const groups = [lapBoxes.slice(0, split), lapBoxes.slice(split)];
    // Seven supported rows plus one or two weak rows on the other game card
    // can occur when the camera photo is too small for either owner-box class.
    if (lapBoxes.length > 7 && !groups.some((group, i) =>
      group.length === 7 && groups[1 - i].length >= 1 && groups[1 - i].length <= 2)) return null;
    let best: { candidate: Candidate; score: number } | null = null;
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      if (group.length < 3 || !isStraightBadgeColumn(group)) continue;
      const groupGaps = group.slice(1).map((box, j) => box.centerY() - group[j].centerY());
      if (Math.min(...groupGaps) < median(group.map((box) => box.height())) * 0.55
        || Math.max(...groupGaps) > Math.min(...groupGaps) * 1.4) continue;
      const panelRefs = yellowReferences.filter((ref) => {
        const aspect = ref.width() / ref.height();
        return aspect >= 2.2 && aspect <= 4.5;
      });
      const support = evaluateYellowSupport(group, panelRefs, width, height);
      if (!support.pass || support.panelBandOverlap < 0.25) continue;
      let candidate = projectedRoiFromLapGroup(group, width, height, 'lap_index_sparse_dual_yellow_candidate', 0, null);
      if (!candidate) continue;
      candidate = constrainProjectedRoiAwayFromOtherLapGroups(candidate, group, groups, i, width, height);
      if (lapBoxes.length > 7 && support.reference) {
        const ref = support.reference;
        const margin = ref.height() * 0.03;
        candidate = copyCandidateWithRoi(candidate, new Box(
          Math.min(candidate.roi.left, ref.left - margin),
          Math.min(candidate.roi.top, ref.top - margin),
          Math.max(candidate.roi.right, ref.right + margin),
          Math.max(candidate.roi.bottom, ref.bottom + margin),
        ).clipped(width, height));
      }
      candidate.selectedRoute = 'lap_index_sparse_dual_yellow_candidate';
      candidate.playerLapIndexCount = group.length;
      candidate.ghostLapIndexCount = groups[1 - i].length;
      candidate.yellowSupportPass = true;
      candidate.yellowSupportReason = support.reason;
      candidate.yellowSupportScore = support.score;
      candidate.yellowReference = support.reference;
      candidate.yellowPanelBand = support.panelBand;
      candidate.yellowPanelBandOverlap = support.panelBandOverlap;
      if (!best || support.score > best.score) best = { candidate, score: support.score };
    }
    return best ? Selection.selected(best.candidate, false, countDetections(detections)) : null;
  }

  selectGhostDetail(detections: Detection[], width: number, height: number): Selection {
    const counts = countDetections(detections);
    const rawLapBoxes = lapIndexBoxes(detections, width, height);
    const ghost = bestDetection(detections, 'ghost_timetrail_box');
    const ghostBox = ghost ? detectionBoxPixels(ghost, width, height) : null;
    let lapBoxes = rawLapBoxes;
    if (rawLapBoxes.length >= 3) {
      const allCx = rawLapBoxes.map((b) => b.centerX());
      const allW = rawLapBoxes.map((b) => b.width());
      const medCx = median(allCx);
      const medW = median(allW);
      lapBoxes = rawLapBoxes.filter((b) => Math.abs(b.centerX() - medCx) < 1.5 * medW);
    }
    // The detector sometimes reports one badge twice at the same spot, which
    // made eight "badges" and blocked a 7-lap panel as ambiguous (ADR-0203).
    lapBoxes = withoutDuplicateBadges(lapBoxes);
    // The model's ghost_timetrail_box is the ghost's card on the END screen; on
    // the Select-a-Ghost panel it fires only by chance, while the badge column
    // the ROI is projected from is found reliably. A clean, straight badge
    // column stands in for the missing box - only when no player card is seen
    // either, because an end screen in this layout always shows one and must
    // still block and fall back (APK engine overlay, ADR-0203).
    const badgeColumnOnly = !ghost && !bestDetection(detections, 'player_timetrail_box') && lapBoxes.length >= 3 && isStraightBadgeColumn(lapBoxes);
    if ((!ghost && !badgeColumnOnly) || lapBoxes.length < 3) {
      return withOwnerBoxes(Selection.blocked(
        'blocked_missing_ghost_detail_support',
        'Ghost-detail layout requires a ghost_timetrail_box detection plus at least three lap-index detections.',
        counts,
      ), null, ghostBox);
    }
    const widths = lapBoxes.map((b) => b.width());
    const heights = lapBoxes.map((b) => b.height());
    const centersX = lapBoxes.map((b) => b.centerX());
    const centersY = lapBoxes.map((b) => b.centerY()).sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 0; i < centersY.length - 1; i++) gaps.push(centersY[i + 1] - centersY[i]);
    const rowGap = median(gaps);
    const cx = median(centersX);
    if (rowGap < 4.0) {
      return withOwnerBoxes(Selection.blocked('blocked_degenerate_ghost_detail_lap_geometry', 'Ghost-detail lap-index rows are too close together for a stable panel projection.', counts), null, ghostBox);
    }
    const n = lapBoxes.length;
    const lapCountProfile = n >= 5 ? 7 : 3;
    if (n === 4 || n > 7) {
      return withOwnerBoxes(Selection.blocked('blocked_ambiguous_ghost_detail_lap_count', `Ghost-detail lap-index count ${n} does not resolve to a 3-lap or 7-lap panel.`, counts), null, ghostBox);
    }
    const span = centersY[centersY.length - 1] - centersY[0];
    const spanRows = Math.round(span / rowGap) + 1;
    const missingEdgeRows = lapCountProfile - spanRows;
    if (missingEdgeRows < 0) {
      return withOwnerBoxes(Selection.blocked('blocked_degenerate_ghost_detail_lap_geometry', `Ghost-detail lap-index span exceeds the expected ${lapCountProfile}-row lattice.`, counts), null, ghostBox);
    }
    const rightRowGap = lapCountProfile === 7 ? GHOST_DETAIL_RIGHT_ROWGAP_RACE7 : GHOST_DETAIL_RIGHT_ROWGAP_RACE3;
    const roi = ghostDetailRoiForFirstRow(centersY[0], cx, rowGap, lapCountProfile, rightRowGap, width, height);
    const altRoi = missingEdgeRows > 0
      ? ghostDetailRoiForFirstRow(centersY[0] - missingEdgeRows * rowGap, cx, rowGap, lapCountProfile, rightRowGap, width, height)
      : null;
    const candidate = new Candidate(roi, badgeColumnOnly ? GHOST_DETAIL_BADGE_COLUMN_ONLY : 'ghost_detail_lap_badge_projection');
    candidate.selectedRoute = 'ghost_detail_panel';
    const ghostScore = ghost ? ghost.score : 0.0;
    candidate.score = Math.min(2.0, n / 3.0) + ghostScore * 2.0;
    candidate.rfdetrScore = ghostScore;
    candidate.lapIndexCount = n;
    candidate.playerLapIndexCount = 0;
    candidate.ghostLapIndexCount = n;
    candidate.lapIndexWidth = median(widths);
    candidate.lapIndexHeight = median(heights);
    candidate.rowGap = rowGap;
    candidate.sourceBox = bounds(lapBoxes);
    candidate.altRoi = altRoi;
    candidate.yellowSupportPass = true;
    candidate.yellowSupportReason = 'ghost_detail_route_does_not_use_yellow_support';
    return withOwnerBoxes(Selection.selected(candidate, false, counts), null, ghostBox);
  }
}

function ghostDetailRoiForFirstRow(c1y: number, cx: number, rowGap: number, lapCount: number, rightRowGap: number, width: number, height: number): Box {
  const lastRowY = c1y + (lapCount - 1) * rowGap;
  return new Box(
    cx + GHOST_DETAIL_LEFT_ROWGAP * rowGap,
    c1y + GHOST_DETAIL_TOP_ROWGAP * rowGap,
    cx + rightRowGap * rowGap,
    lastRowY + GHOST_DETAIL_BOTTOM_ROWGAP * rowGap,
  ).clipped(width, height);
}

export function withDetections(selection: Selection, detections: Detection[], width: number, height: number): Selection {
  selection.detections = detections;
  selection.frameWidth = width;
  selection.frameHeight = height;
  return selection;
}

function withOwnerBoxes(selection: Selection, playerOwnerBox: Box | null, ghostOwnerBox: Box | null): Selection {
  selection.playerOwnerBox = playerOwnerBox;
  selection.ghostOwnerBox = ghostOwnerBox;
  return selection;
}

export function countDetections(detections: Detection[]): DetectionCounts {
  const counts: DetectionCounts = { candidateCount: detections.length, playerCount: 0, ghostCount: 0, lapIndexCount: 0 };
  for (const d of detections) {
    if (d.label === 'player_timetrail_box') counts.playerCount++;
    else if (d.label === 'ghost_timetrail_box') counts.ghostCount++;
    else if (d.label === 'lap_index') counts.lapIndexCount++;
  }
  return counts;
}

/** One box per badge: boxes whose centres lie within 0.4 badge height are the same badge. */
function withoutDuplicateBadges(boxes: Box[]): Box[] {
  if (boxes.length < 2) return boxes;
  const limit = 0.4 * median(boxes.map((b) => b.height()));
  const kept: Box[] = [];
  for (const box of [...boxes].sort((a, b) => a.centerY() - b.centerY())) {
    const last = kept[kept.length - 1];
    if (last && Math.abs(box.centerY() - last.centerY()) < limit && Math.abs(box.centerX() - last.centerX()) < limit) continue;
    kept.push(box);
  }
  return kept;
}

/** The selection reason when the badge column stood in for the ghost box. */
export const GHOST_DETAIL_BADGE_COLUMN_ONLY = 'ghost_detail_lap_badge_column_only';

/**
 * Whether the badge centres lie on one straight line x(y), within 0.2 badge
 * width RMS and within 8 degrees of vertical - the test the deskew seed uses.
 */
function isStraightBadgeColumn(boxes: Box[]): boolean {
  const meanX = boxes.reduce((s, b) => s + b.centerX(), 0) / boxes.length;
  const meanY = boxes.reduce((s, b) => s + b.centerY(), 0) / boxes.length;
  let sxy = 0;
  let syy = 0;
  for (const b of boxes) {
    sxy += (b.centerY() - meanY) * (b.centerX() - meanX);
    syy += (b.centerY() - meanY) ** 2;
  }
  if (syy <= 0) return false;
  const k = sxy / syy;
  let residual = 0;
  for (const b of boxes) residual += (b.centerX() - (meanX + k * (b.centerY() - meanY))) ** 2;
  return Math.sqrt(residual / boxes.length) <= 0.2 * median(boxes.map((b) => b.width())) && Math.abs((Math.atan(k) * 180) / Math.PI) <= 8.0;
}

function bestDetection(detections: Detection[], label: string): Detection | null {
  let best: Detection | null = null;
  for (const d of detections) {
    if (d.label !== label) continue;
    if (!best || d.score > best.score) best = d;
  }
  return best;
}

function lapIndexBoxes(detections: Detection[], width: number, height: number): Box[] {
  const boxes: Box[] = [];
  for (const d of detections) {
    if (d.label === 'lap_index') {
      const box = detectionBoxPixels(d, width, height);
      if (box.width() >= 2.0 && box.height() >= 2.0) boxes.push(box);
    }
  }
  return boxes;
}

function projectedRoiFromLapGroup(group: Box[], width: number, height: number, reason: string, referenceScore: number, ownerConstraint: Box | null): Candidate | null {
  if (group.length < 2) return null;
  const widths: number[] = [];
  const heights: number[] = [];
  const centersY: number[] = [];
  const x1s: number[] = [];
  const x2s: number[] = [];
  let lapTop = Number.MAX_VALUE;
  let lapBottom = -Number.MAX_VALUE;
  for (const box of group) {
    widths.push(box.width());
    heights.push(box.height());
    centersY.push(box.centerY());
    x1s.push(box.left);
    x2s.push(box.right);
    lapTop = Math.min(lapTop, box.top);
    lapBottom = Math.max(lapBottom, box.bottom);
  }
  centersY.sort((a, b) => a - b);
  const lapW = median(widths);
  const lapH = median(heights);
  let rowGap = lapH * 1.28;
  if (centersY.length >= 2) {
    const gaps: number[] = [];
    for (let i = 0; i < centersY.length - 1; i++) gaps.push(centersY[i + 1] - centersY[i]);
    rowGap = median(gaps);
  }
  const widthScale = lapW > LAP_INDEX_WIDTH_SCALE_BREAKPOINT_PX ? LARGE_LAP_INDEX_WIDTH_SCALE : SMALL_LAP_INDEX_WIDTH_SCALE;
  const effectiveLapW = lapW * widthScale;
  const effectiveLapH = lapH;
  const observedSpan = centersY.length === 0 ? 0.0 : centersY[centersY.length - 1] - centersY[0];
  const projectedRowCount = ownerConstraint === null ? 7.0 : Math.max(2.0, group.length);
  const missingSpan = Math.max(0.0, rowGap * (projectedRowCount - 1.0) - observedSpan);
  const medianX1 = median(x1s);
  const medianX2 = median(x2s);
  const sourceX1 = Math.min(...group.map((b) => b.left));
  const sourceY1 = Math.min(...group.map((b) => b.top));
  const sourceX2 = Math.max(...group.map((b) => b.right));
  const sourceY2 = Math.max(...group.map((b) => b.bottom));
  const cardLeft = medianX1 - effectiveLapW * 16.5;
  const cardTop = lapTop - missingSpan * 0.5 - effectiveLapH * 2.6;
  const cardRight = medianX2 + effectiveLapW * 7.4;
  const cardBottom = lapBottom + missingSpan * 0.5 + effectiveLapH * 0.75;
  const cardW = Math.max(1.0, cardRight - cardLeft);
  const cardH = Math.max(1.0, cardBottom - cardTop);
  let roi = new Box(cardLeft - cardW * 0.02, cardTop - cardH * 0.08, cardRight + cardW * 0.02, cardBottom + cardH * 0.08).clipped(width, height);
  const roiBeforeOwnerConstraint = roi;
  let ownerConstraintBox: Box | null = null;
  if (ownerConstraint) {
    ownerConstraintBox = new Box(
      f32(ownerConstraint.left - f32(ownerConstraint.width() * OWNER_CONSTRAINT_X_MARGIN_RATIO)),
      f32(ownerConstraint.top - f32(ownerConstraint.height() * OWNER_CONSTRAINT_TOP_MARGIN_RATIO)),
      f32(ownerConstraint.right + f32(ownerConstraint.width() * OWNER_CONSTRAINT_X_MARGIN_RATIO)),
      f32(ownerConstraint.bottom + f32(ownerConstraint.height() * OWNER_CONSTRAINT_BOTTOM_MARGIN_RATIO)),
    ).clipped(width, height);
    roi = constrainToOwnerEnvelope(roi, ownerConstraintBox, width, height);
  }
  if (reason === 'lap_index_projected_yellow_ref') {
    roi = roi.quantizedYellowReference(width, height);
  }
  const aspect = roi.width() / Math.max(1.0, roi.height());
  const aspectScore = Math.max(0.0, 1.0 - Math.abs(aspect - 2.25) / 2.25);
  const rfdetrScore = referenceScore;
  const score = Math.min(2.0, group.length / 3.0) + aspectScore + rfdetrScore * 2.0;
  const candidate = new Candidate(roi, reason);
  candidate.score = score;
  candidate.rfdetrScore = rfdetrScore;
  candidate.lapIndexCount = group.length;
  candidate.lapIndexWidth = effectiveLapW;
  candidate.lapIndexHeight = effectiveLapH;
  candidate.rowGap = rowGap;
  candidate.sourceBox = new Box(sourceX1, sourceY1, sourceX2, sourceY2);
  candidate.projectedRowCount = projectedRowCount;
  candidate.ownerConstraintApplied = ownerConstraint !== null;
  candidate.ownerConstraintBox = ownerConstraintBox;
  candidate.roiBeforeOwnerConstraint = roiBeforeOwnerConstraint;
  candidate.ownerConstraintReason = ownerConstraint === null ? '' : 'detected_owner_box_limits_lap_index_projection';
  return candidate;
}

function constrainProjectedRoiAwayFromOtherLapGroups(candidate: Candidate, selectedGroup: Box[], allGroups: Box[][], selectedIndex: number, width: number, height: number): Candidate {
  if (!candidate || selectedGroup.length === 0 || allGroups.length < 2 || selectedIndex < 0) return candidate;
  const selectedBounds = bounds(selectedGroup);
  const selectedCy = selectedBounds.centerY();
  let nearestOther: Box[] | null = null;
  let nearestDistance = Number.MAX_VALUE;
  for (let i = 0; i < allGroups.length; i++) {
    if (i === selectedIndex || allGroups[i].length === 0) continue;
    const otherBounds = bounds(allGroups[i]);
    const distance = Math.abs(otherBounds.centerY() - selectedCy);
    if (!nearestOther || distance < nearestDistance) {
      nearestOther = allGroups[i];
      nearestDistance = distance;
    }
  }
  if (!nearestOther) return candidate;
  const otherBounds = bounds(nearestOther);
  const roi = candidate.roi;
  let constrained = roi;
  let separatorY: number;
  if (selectedBounds.bottom <= otherBounds.top) {
    separatorY = f32(f32(selectedBounds.bottom + otherBounds.top) * 0.5);
    constrained = new Box(roi.left, roi.top, roi.right, Math.min(roi.bottom, separatorY)).clipped(width, height);
  } else if (selectedBounds.top >= otherBounds.bottom) {
    separatorY = f32(f32(otherBounds.bottom + selectedBounds.top) * 0.5);
    constrained = new Box(roi.left, Math.max(roi.top, separatorY), roi.right, roi.bottom).clipped(width, height);
  } else {
    return candidate;
  }
  if (Math.abs(constrained.left - roi.left) < 0.01 && Math.abs(constrained.top - roi.top) < 0.01
    && Math.abs(constrained.right - roi.right) < 0.01 && Math.abs(constrained.bottom - roi.bottom) < 0.01) {
    return candidate;
  }
  const updated = copyCandidateWithRoi(candidate, constrained);
  updated.roiBeforeDualOwnerGroupConstraint = roi;
  updated.dualOwnerGroupConstraintApplied = true;
  updated.dualOwnerGroupConstraintReason = 'selected_lap_index_group_must_not_cross_other_owner_group';
  updated.dualOwnerGroupSeparatorY = separatorY;
  updated.otherLapGroupSourceBox = otherBounds;
  return updated;
}

function copyCandidateWithRoi(source: Candidate, roi: Box): Candidate {
  const copy = new Candidate(roi, source.reason);
  Object.assign(copy, { ...source, roi, reason: source.reason });
  return copy;
}

function constrainToOwnerEnvelope(projected: Box, ownerEnvelope: Box, width: number, height: number): Box {
  const left = Math.max(projected.left, ownerEnvelope.left);
  const top = Math.max(projected.top, ownerEnvelope.top);
  const right = Math.min(projected.right, ownerEnvelope.right);
  const bottom = Math.min(projected.bottom, ownerEnvelope.bottom);
  if (f32(right - left) < f32(ownerEnvelope.width() * 0.45) || f32(bottom - top) < f32(ownerEnvelope.height() * 0.45)) {
    return ownerEnvelope.clipped(width, height);
  }
  return new Box(left, top, right, bottom).clipped(width, height);
}

function lapIndexesInside(lapBoxes: Box[], ownerBox: Box): Box[] {
  const expanded = ownerBox.expanded(f32(ownerBox.width() * 0.08), f32(ownerBox.height() * 0.12));
  return lapBoxes.filter((b) => expanded.containsCenter(b));
}

function lapIndexesOutside(lapBoxes: Box[], ownerBox: Box): Box[] {
  const expanded = ownerBox.expanded(f32(ownerBox.width() * 0.08), f32(ownerBox.height() * 0.12));
  return lapBoxes.filter((b) => !expanded.containsCenter(b));
}

function ownerGroupsFromLapIndexes(lapBoxes: Box[]): Box[][] {
  const sorted = [...lapBoxes].sort((a, b) => a.centerY() - b.centerY());
  if (sorted.length <= 7) return [sorted];
  let splitAt = 1;
  let largestGap = -1.0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = f32(sorted[i + 1].centerY() - sorted[i].centerY());
    if (gap > largestGap) {
      largestGap = gap;
      splitAt = i + 1;
    }
  }
  return [sorted.slice(0, splitAt), sorted.slice(splitAt)];
}

function evaluateYellowSupport(lapGroup: Box[], yellowReferences: Box[], width: number, height: number): YellowSupport {
  if (!lapGroup || lapGroup.length < 2) return supportFail('not_enough_lap_indexes_for_yellow_support');
  if (!yellowReferences || yellowReferences.length === 0) return supportFail('no_image_derived_yellow_reference');
  const groupBox = bounds(lapGroup);
  const groupH = Math.max(1.0, groupBox.height());
  const groupW = Math.max(1.0, groupBox.width());
  const panelBand = new Box(
    Math.max(0.0, groupBox.left - groupW * 12.0),
    Math.max(0.0, groupBox.top - groupW * 1.5),
    Math.min(width, groupBox.right + groupW * 2.0),
    Math.min(height, groupBox.bottom + groupW * 1.5),
  );
  const panelBandArea = Math.max(1.0, panelBand.width() * panelBand.height());
  let best = supportFail('yellow_reference_not_spatially_consistent');
  for (const ref of yellowReferences) {
    const verticalOverlap = overlap1d(groupBox.top - groupH * 0.35, groupBox.bottom + groupH * 0.35, ref.top, ref.bottom)
      / Math.max(1.0, Math.min(groupBox.height() + groupH * 0.70, ref.height()));
    const bandOverlap = overlapArea(panelBand, ref) / panelBandArea;
    const leftDistance = groupBox.left - ref.right;
    const leftScore = ref.centerX() < groupBox.centerX() ? Math.max(0.0, Math.min(1.0, leftDistance / Math.max(1.0, width * 0.18))) : 0.0;
    const aspect = ref.width() / Math.max(1.0, ref.height());
    const aspectScore = Math.max(0.0, 1.0 - Math.abs(aspect - 1.15) / 1.15);
    const edgePenalty = (ref.top < height * 0.03 || ref.bottom > height * 0.97) ? 0.75 : 0.0;
    const bandScore = bandOverlap * 5.0 + verticalOverlap + aspectScore * 0.25 - edgePenalty;
    const leftReferenceScore = verticalOverlap * 2.5 + leftScore + aspectScore - edgePenalty;
    if (bandOverlap >= 0.25 && bandScore > best.score) {
      best = supportPass(bandScore, 'yellow_reference_overlaps_lap_index_panel_band', ref, panelBand, bandOverlap, leftReferenceScore);
    } else if (verticalOverlap >= 0.35 && leftScore > 0.0 && leftReferenceScore > best.score) {
      best = supportPass(leftReferenceScore, 'yellow_reference_left_of_lap_indexes_with_vertical_support', ref, panelBand, bandOverlap, leftReferenceScore);
    }
  }
  return best;
}

function overlapArea(a: Box, b: Box): number {
  return overlap1d(a.left, a.right, b.left, b.right) * overlap1d(a.top, a.bottom, b.top, b.bottom);
}

function overlap1d(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0.0, Math.min(a2, b2) - Math.max(a1, b1));
}

export function bounds(boxes: Box[]): Box {
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
  return new Box(left, top, right, bottom);
}
