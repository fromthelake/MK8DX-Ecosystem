// The central lap-row anchor grid (CENTRAL_RECOGNITION section 8.6, phase 5): the TypeScript port of
// python/mk8dx_icon_matcher/lap_grid.py (the reference) and LapGrid.java, kept equal by the parity
// vectors (tooling/recognition/lap_grid_vectors.py). Where every time digit of a Time Trial card is
// cut, from the lap-index badges on the canonical frame and the pack's time grid. Boxes are
// [left, top, right, bottom] pixels; rounding is Math.round.

import { canonicalSegmentSlotSize } from './sharedSegmentDigits';

export const MAX_ANCHOR_DISTANCE_PX = 48.0;
const PLAYER_TOTAL_X = [0, -3, 0, -2, -3, -2, -3, -1, -2];
const GHOST_TOTAL_X = [0, -2, 1, -2, -3, -1, -2, -1, -2];
const LAP_X = [0, -2, -1, -2, -1, -2, -1, -2, 0];

export interface GridDetection { label: string; score: number; left: number; top: number; right: number; bottom: number }

export class GridBox {
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
  clipped(width: number, height: number): GridBox {
    return new GridBox(Math.max(0, Math.min(width - 1, this.left)), Math.max(0, Math.min(height - 1, this.top)),
      Math.max(1, Math.min(width, this.right)), Math.max(1, Math.min(height, this.bottom)));
  }
  width(): number { return Math.max(1.0, this.right - this.left); }
  height(): number { return Math.max(1.0, this.bottom - this.top); }
  centerX(): number { return (this.left + this.right) * 0.5; }
  centerY(): number { return (this.top + this.bottom) * 0.5; }
  asList(): number[] { return [this.left, this.top, this.right, this.bottom]; }
}

export interface LapMatch { detIndex: number; rowIndex: number; canonical: GridBox; detected: GridBox; distance: number; score: number }
interface RowRefinement { anchorX: number; anchorY: number; refinedX: number; refinedY: number; scaleX: number; scaleY: number }
type Sample = [number, number];

export interface GridField { name: string; owner: string; type: 'lap' | 'total'; lapIndex: number; box: number[]; slots: number[][] }
export interface LapGrid {
  available: boolean;
  status: string;
  reason: string;
  raceKey: string;
  activeLapCount: number;
  expectedFieldCount: number;
  activeOwners: string[];
  fields: GridField[];
  ownerAnchors: Record<string, [number, number]>;
  matchedLapIndexCount: number;
  /** Per owner tried: the inferred lap count and its badge matches (diagnostics). */
  ownerMatches: Record<string, { inferredLapCount: number; matches: { rowIndex: number; detIndex: number; distance: number; score: number }[] }>;
}

function ownerAbsBox(ownerGrid: any, rel: any[]): GridBox {
  const anchor = ownerGrid.anchor;
  const ax = anchor ? anchor.x ?? 0.0 : 0.0;
  const ay = anchor ? anchor.y ?? 0.0 : 0.0;
  return new GridBox(ax + (rel[0] ?? 0.0), ay + (rel[1] ?? 0.0), ax + (rel[2] ?? 0.0), ay + (rel[3] ?? 0.0));
}

export function canonicalLapIndexBoxes(ownerGrid: any): GridBox[] {
  const boxes: GridBox[] = [];
  const rels = ownerGrid.lap_index_boxes_rel;
  if (rels) {
    for (const rel of rels) if (Array.isArray(rel)) boxes.push(ownerAbsBox(ownerGrid, rel));
    return boxes;
  }
  const strips = ownerGrid.lap_strips_rel;
  const anchor = ownerGrid.anchor;
  if (!strips || !anchor) return boxes;
  const ax = anchor.x ?? 0.0;
  const ay = anchor.y ?? 0.0;
  for (const rel of strips) {
    if (!Array.isArray(rel) || rel.length < 4) continue;
    const cy = ay + ((rel[1] ?? 0.0) + (rel[3] ?? 0.0)) * 0.5;
    boxes.push(new GridBox(ax - 12.5, cy - 12.5, ax + 12.5, cy + 12.5));
  }
  return boxes;
}

const detectionBox = (d: GridDetection, w: number, h: number): GridBox => new GridBox(d.left * w, d.top * h, d.right * w, d.bottom * h);

export function activeOwnerCandidates(detections: GridDetection[], lapIndexCount: number, ghostDetail: boolean): string[] {
  if (ghostDetail) return ['ghost'];
  const owners: string[] = [];
  for (const owner of ['ghost', 'player']) {
    for (const d of detections) {
      if (d.label !== `${owner}_timetrail_box`) continue;
      const physical = Math.fround((d.top + d.bottom) * 0.5) < 0.5 ? 'ghost' : 'player';
      if (!owners.includes(physical)) owners.push(physical);
    }
  }
  if (owners.length > 0) {
    owners.sort((a, b) => (a === 'ghost' ? 0 : 1) - (b === 'ghost' ? 0 : 1));
    return owners;
  }
  if (lapIndexCount >= 10) return ['ghost', 'player'];
  if (lapIndexCount >= 2) return ['player'];
  return [];
}

interface Candidate { index: number; detection: GridDetection; box: GridBox }

export function matchOwnerLapRows(detections: GridDetection[], ownerGrid: any, width: number, height: number, used: number[]): LapMatch[] {
  const canonical = canonicalLapIndexBoxes(ownerGrid);
  if (canonical.length === 0) return [];
  const available: Candidate[] = [];
  for (let i = 0; i < detections.length; i++) {
    if (used.includes(i)) continue;
    available.push({ index: i, detection: detections[i], box: detectionBox(detections[i], width, height) });
  }
  available.sort((a, b) => b.detection.score - a.detection.score);
  const distinct: Candidate[] = [];
  for (const c of available) {
    if (distinct.some((k) => {
      const ox = Math.max(0, Math.min(c.box.right, k.box.right) - Math.max(c.box.left, k.box.left));
      const oy = Math.max(0, Math.min(c.box.bottom, k.box.bottom) - Math.max(c.box.top, k.box.top));
      return ox >= 0.7 * Math.min(c.box.width(), k.box.width()) && oy >= 0.7 * Math.min(c.box.height(), k.box.height());
    })) continue;
    distinct.push(c);
  }
  distinct.sort((a, b) => {
    const ya = a.box.centerY();
    const yb = b.box.centerY();
    if (ya !== yb) return ya < yb ? -1 : 1;
    return b.detection.score < a.detection.score ? -1 : b.detection.score > a.detection.score ? 1 : 0;
  });
  let bestMatches: LapMatch[] = [];
  let bestDistance = Number.MAX_VALUE;
  let bestScore = -Number.MAX_VALUE;
  const visit = (rowPos: number, minDet: number, current: LapMatch[], distanceSum: number, scoreSum: number): void => {
    if (rowPos >= canonical.length) {
      if (current.length > bestMatches.length
        || (current.length === bestMatches.length && distanceSum < bestDistance - 1e-6)
        || (current.length === bestMatches.length && Math.abs(distanceSum - bestDistance) <= 1e-6 && scoreSum > bestScore)) {
        bestMatches = [...current];
        bestDistance = distanceSum;
        bestScore = scoreSum;
      }
      return;
    }
    visit(rowPos + 1, minDet, current, distanceSum, scoreSum);
    const row = canonical[rowPos];
    for (let detPos = minDet; detPos < distinct.length; detPos++) {
      const c = distinct[detPos];
      const dx = c.box.centerX() - row.centerX();
      const dy = c.box.centerY() - row.centerY();
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > MAX_ANCHOR_DISTANCE_PX) continue;
      current.push({ detIndex: c.index, rowIndex: rowPos + 1, canonical: row, detected: c.box, distance, score: c.detection.score });
      visit(rowPos + 1, detPos + 1, current, distanceSum + distance, scoreSum + c.detection.score);
      current.pop();
    }
  };
  visit(0, 0, [], 0.0, 0.0);
  for (const m of bestMatches) used.push(m.detIndex);
  return bestMatches;
}

export function inferActiveLapCount(matches: LapMatch[], totalLapIndexCount: number): number {
  if (matches.length < 2) return 0;
  let maxRow = 0;
  for (const m of matches) maxRow = Math.max(maxRow, m.rowIndex);
  if (matches.length <= 3 && totalLapIndexCount <= 8) return 3;
  if (matches.length >= 5 || totalLapIndexCount >= 10 || maxRow >= 5) return 7;
  if (maxRow <= 3) return 3;
  return 0;
}

function commonLapCount(counts: Map<string, number>): number {
  let value = 0;
  for (const count of counts.values()) {
    if (!count || count <= 0) return 0;
    if (value === 0) value = count;
    else if (value !== count) return 0;
  }
  return value;
}

function range(values: number[]): number {
  if (values.length === 0) return 0.0;
  let min = Number.MAX_VALUE;
  let max = -Number.MAX_VALUE;
  for (const v of values) { min = Math.min(min, v); max = Math.max(max, v); }
  return max - min;
}

function median(values: number[]): number {
  if (values.length === 0) return 0.0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.trunc(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) * 0.5;
}

function linearEval(samples: Sample[], y: number, fallback: number): number {
  if (samples.length === 0) return fallback;
  if (samples.length >= 2 && range(samples.map((s) => s[0])) > 1.0) {
    let meanX = 0.0;
    let meanY = 0.0;
    for (const [sy, value] of samples) { meanX += sy; meanY += value; }
    meanX /= samples.length;
    meanY /= samples.length;
    let num = 0.0;
    let den = 0.0;
    for (const [sy, value] of samples) { num += (sy - meanX) * (value - meanY); den += (sy - meanX) * (sy - meanX); }
    if (den > 1e-6) {
      const slope = num / den;
      return slope * y + (meanY - slope * meanX);
    }
  }
  return median(samples.map((s) => s[1]));
}

export function buildRowRefinements(ownerGrid: any, matches: LapMatch[]): Map<number, RowRefinement> {
  const out = new Map<number, RowRefinement>();
  if (matches.length === 0) return out;
  const canonY = matches.map((m) => m.canonical.centerY());
  const detY = matches.map((m) => m.detected.centerY());
  let rowSy = 1.0;
  if (matches.length >= 2 && range(canonY) > 1.0) rowSy = Math.max(0.85, Math.min(1.18, range(detY) / Math.max(1.0, range(canonY))));
  const rows = canonicalLapIndexBoxes(ownerGrid);
  if (rows.length === 0) return out;
  const dx: Sample[] = [];
  const dy: Sample[] = [];
  for (const m of matches) {
    dx.push([m.canonical.centerY(), m.detected.centerX() - m.canonical.centerX()]);
    dy.push([m.canonical.centerY(), m.detected.centerY() - m.canonical.centerY()]);
    out.set(m.rowIndex, { anchorX: m.canonical.centerX(), anchorY: m.canonical.centerY(), refinedX: m.detected.centerX(),
      refinedY: m.detected.centerY(), scaleX: 1.0, scaleY: rowSy });
  }
  rows.forEach((can, i) => {
    if (out.has(i + 1)) return;
    out.set(i + 1, { anchorX: can.centerX(), anchorY: can.centerY(), refinedX: can.centerX() + linearEval(dx, can.centerY(), 0.0),
      refinedY: can.centerY() + linearEval(dy, can.centerY(), 0.0), scaleX: 1.0, scaleY: rowSy });
  });
  return out;
}

function segmentOffsetX(owner: string, kind: 'lap' | 'total', slot: number): number {
  if (kind === 'total') return (owner === 'ghost' ? GHOST_TOTAL_X : PLAYER_TOTAL_X)[slot];
  return LAP_X[slot];
}

function segmentOffsetY(owner: string, kind: 'lap' | 'total'): number {
  if (kind === 'total') return owner === 'ghost' ? -4 : -3;
  return owner === 'ghost' ? -4 : -2;
}

export function canonicalSlotBox(ownerGrid: any, rel: any[], owner: string, kind: 'lap' | 'total', slot: number): GridBox {
  const base = ownerAbsBox(ownerGrid, rel);
  const ox = segmentOffsetX(owner, kind, slot);
  const oy = segmentOffsetY(owner, kind);
  const [w, h] = canonicalSegmentSlotSize(kind, slot);
  return new GridBox(base.left + ox, base.top + oy, base.left + ox + w, base.top + oy + h);
}

function totalRefinement(ownerGrid: any, rowRefs: Map<number, RowRefinement>): RowRefinement | null {
  const total = ownerGrid.total_digits_rel;
  if (!total || total.length === 0) return null;
  const anchorRel = total[Math.min(1, total.length - 1)];
  if (!anchorRel) return null;
  const anchor = canonicalSlotBox(ownerGrid, anchorRel, '', 'total', Math.min(2, total.length));
  const dx: Sample[] = [];
  const dy: Sample[] = [];
  const sy: number[] = [];
  for (const ref of rowRefs.values()) {
    dx.push([ref.anchorY, ref.refinedX - ref.anchorX]);
    dy.push([ref.anchorY, ref.refinedY - ref.anchorY]);
    sy.push(ref.scaleY);
  }
  return { anchorX: anchor.centerX(), anchorY: anchor.centerY(), refinedX: anchor.centerX() + linearEval(dx, anchor.centerY(), 0.0),
    refinedY: anchor.centerY() + linearEval(dy, anchor.centerY(), 0.0), scaleX: 1.0, scaleY: sy.length === 0 ? 1.0 : median(sy) };
}

function transformAroundAnchor(box: GridBox, ref: RowRefinement): GridBox {
  const x1 = ref.refinedX + (Math.round(box.left) - ref.anchorX) * ref.scaleX;
  const y1 = ref.refinedY + (Math.round(box.top) - ref.anchorY) * ref.scaleY;
  const x2 = ref.refinedX + (Math.round(box.right) - ref.anchorX) * ref.scaleX;
  const y2 = ref.refinedY + (Math.round(box.bottom) - ref.anchorY) * ref.scaleY;
  return new GridBox(Math.round(Math.min(x1, x2)), Math.round(Math.min(y1, y2)), Math.round(Math.max(x1, x2)), Math.round(Math.max(y1, y2)));
}

function blendX(nominal: GridBox, refined: GridBox, blend: number): GridBox {
  const b = Math.max(0.0, Math.min(1.0, blend));
  return new GridBox(Math.round(nominal.left + (refined.left - nominal.left) * b), refined.top,
    Math.round(nominal.right + (refined.right - nominal.right) * b), refined.bottom);
}

function slotsFromRow(ownerGrid: any, rels: any[], owner: string, kind: 'lap' | 'total', ref: RowRefinement | null,
  width: number, height: number): GridBox[] {
  const slots: GridBox[] = [];
  for (let i = 0; i < rels.length; i++) {
    const rel = rels[i];
    if (!Array.isArray(rel)) continue;
    const canonical = canonicalSlotBox(ownerGrid, rel, owner, kind, i + 1);
    const read = ref === null ? canonical : blendX(canonical, transformAroundAnchor(canonical, ref), 0.5);
    slots.push(read.clipped(width, height));
  }
  return slots;
}

function union(boxes: GridBox[]): GridBox {
  if (boxes.length === 0) return new GridBox(0, 0, 1, 1);
  let l = Number.MAX_VALUE;
  let t = Number.MAX_VALUE;
  let r = -Number.MAX_VALUE;
  let b = -Number.MAX_VALUE;
  for (const x of boxes) { l = Math.min(l, x.left); t = Math.min(t, x.top); r = Math.max(r, x.right); b = Math.max(b, x.bottom); }
  return new GridBox(l, t, r, b);
}

/** The digit slots of every active owner (Python build_dynamic_grid). */
export function buildDynamicGrid(timeGrid: any, raceKeyIn: string, ghostDetail: boolean, width: number, height: number,
  detections: GridDetection[], lapRows: GridDetection[], nominal = false): LapGrid {
  const raceKey = raceKeyIn || 'race7';
  const grid: LapGrid = { available: false, status: 'implemented', reason: '', raceKey, activeLapCount: 0, expectedFieldCount: 0,
    activeOwners: [], fields: [], ownerAnchors: {}, matchedLapIndexCount: 0, ownerMatches: {} };
  const race = timeGrid ? timeGrid[raceKey] : null;
  const ownersRoot = race ? race.owners ?? null : null;
  if (!ownersRoot) {
    grid.status = 'blocked_missing_relative_grid';
    grid.reason = `relative grid did not contain owners for ${raceKey}.`;
    return grid;
  }
  if (lapRows.length < 2) {
    grid.status = 'blocked_insufficient_lap_index_support';
    grid.reason = 'Need at least two native RF-DETR lap-index detections to build dynamic/refined grid.';
    return grid;
  }
  const owners = activeOwnerCandidates(detections, lapRows.length, ghostDetail);
  if (owners.length === 0) {
    grid.status = 'blocked_unresolved_active_ocr_profile';
    grid.reason = 'Could not resolve active player/ghost owner profile from Step 19 owner boxes or lap-index support.';
    return grid;
  }
  const used: number[] = [];
  const matchesByOwner = new Map<string, LapMatch[]>();
  const lapCountByOwner = new Map<string, number>();
  for (const owner of owners) {
    const ownerGrid = ownersRoot[owner];
    if (!ownerGrid) continue;
    const matches = matchOwnerLapRows(lapRows, ownerGrid, width, height, used);
    const inferred = inferActiveLapCount(matches, lapRows.length);
    grid.ownerMatches[owner] = { inferredLapCount: inferred, matches: matches.map((m) => ({ rowIndex: m.rowIndex,
      detIndex: m.detIndex, distance: m.distance, score: m.score })) };
    if (inferred <= 0) continue;
    matchesByOwner.set(owner, matches);
    lapCountByOwner.set(owner, inferred);
    if (matches.length > 0) {
      let sx = 0.0;
      let sy = 0.0;
      for (const m of matches) { sx += m.detected.centerX(); sy += m.detected.centerY(); }
      grid.ownerAnchors[owner] = [sx / matches.length, sy / matches.length];
    }
  }
  if (matchesByOwner.size === 0) {
    grid.status = 'blocked_insufficient_owner_lap_index_support';
    grid.reason = 'No active owner had enough matched lap-index rows to build a scoped dynamic grid.';
    return grid;
  }
  const active = commonLapCount(lapCountByOwner);
  if (active <= 0) {
    grid.status = 'blocked_ambiguous_active_lap_count';
    grid.reason = 'Active owners did not agree on a supported 3-lap or 7-lap OCR profile.';
    return grid;
  }
  grid.available = true;
  grid.activeLapCount = active;
  for (const [owner, matches] of matchesByOwner) {
    const ownerGrid = ownersRoot[owner];
    if (!ownerGrid) continue;
    grid.activeOwners.push(owner);
    grid.matchedLapIndexCount += matches.length;
    const rowRefs = nominal ? new Map<number, RowRefinement>() : buildRowRefinements(ownerGrid, matches);
    if (ghostDetail && rowRefs.size > 0) {
      let sx = 0.0;
      let sy = 0.0;
      for (const ref of rowRefs.values()) { sx += ref.refinedX; sy += ref.refinedY; }
      grid.ownerAnchors[owner] = [sx / rowRefs.size, sy / rowRefs.size];
    }
    for (let lap = 1; lap <= active; lap++) {
      const lapRels = ownerGrid.lap_digits_rel;
      if (!lapRels || lapRels.length < lap) continue;
      const slotRels = lapRels[lap - 1];
      if (!slotRels) continue;
      const slots = slotsFromRow(ownerGrid, slotRels, owner, 'lap', rowRefs.get(lap) ?? null, width, height);
      grid.fields.push({ name: `${owner}_lap_${lap}`, owner, type: 'lap', lapIndex: lap,
        box: union(slots).clipped(width, height).asList(), slots: slots.map((s) => s.asList()) });
    }
    const totalRels = ownerGrid.total_digits_rel;
    if (totalRels) {
      const slots = slotsFromRow(ownerGrid, totalRels, owner, 'total', totalRefinement(ownerGrid, rowRefs), width, height);
      grid.fields.push({ name: `${owner}_total`, owner, type: 'total', lapIndex: 0,
        box: union(slots).clipped(width, height).asList(), slots: slots.map((s) => s.asList()) });
    }
  }
  grid.expectedFieldCount = grid.activeOwners.length * (grid.activeLapCount + 1);
  return grid;
}
