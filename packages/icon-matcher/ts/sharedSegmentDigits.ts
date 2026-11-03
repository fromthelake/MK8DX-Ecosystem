/** The central 7-segment digit matcher (CENTRAL_RECOGNITION section 8.6, phase 2): one
 * specification in Python (segment_digits.py, reference), TypeScript and Java. Moved unchanged
 * from the Web scanner's segments.ts, itself a port of the Android OfflineParityNativePipeline
 * nodes 24/26: colour-coded template images (segments a..g) become point masks, the template
 * slides over the binarized slot with a clamped scale, candidates rank by validity, margin,
 * confidence and lit segments, and the pattern decodes to a digit.
 *
 * Input is the slot's binary patch (0/255, row-major); the caller (the ROI Searcher) cuts the
 * slot and binarizes it. Pure: no OpenCV, no assets.
 */

export interface PointI {
  x: number;
  y: number;
}

export const SEGMENT_KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const;
export type SegmentKey = (typeof SEGMENT_KEYS)[number];

export class SegmentTemplate {
  readonly width: number;
  readonly height: number;
  readonly points: Record<SegmentKey, PointI[]>;

  constructor(width: number, height: number, points: Record<SegmentKey, PointI[]>) {
    this.width = width;
    this.height = height;
    this.points = points;
  }

  scaled(scaleX: number, scaleY: number): SegmentTemplate {
    const dstW = Math.max(1, Math.round(this.width * Math.max(0.05, scaleX)));
    const dstH = Math.max(1, Math.round(this.height * Math.max(0.05, scaleY)));
    const out = {} as Record<SegmentKey, PointI[]>;
    for (const key of SEGMENT_KEYS) {
      const unique = new Map<string, PointI>();
      for (const p of this.points[key] ?? []) {
        const x = Math.max(0, Math.min(dstW - 1, Math.round(p.x * scaleX)));
        const y = Math.max(0, Math.min(dstH - 1, Math.round(p.y * scaleY)));
        unique.set(`${x},${y}`, { x, y });
      }
      out[key] = [...unique.values()];
    }
    return new SegmentTemplate(dstW, dstH, out);
  }
}

function near(r: number, g: number, b: number, tr: number, tg: number, tb: number): boolean {
  return Math.abs(r - tr) <= 1 && Math.abs(g - tg) <= 1 && Math.abs(b - tb) <= 1;
}

function segmentKeyForColor(r: number, g: number, b: number): SegmentKey | null {
  if (near(r, g, b, 255, 0, 0)) return 'a';
  if (near(r, g, b, 0, 255, 0)) return 'b';
  if (near(r, g, b, 0, 0, 255)) return 'c';
  if (near(r, g, b, 255, 255, 0)) return 'd';
  if (near(r, g, b, 255, 0, 255)) return 'e';
  if (near(r, g, b, 0, 255, 255)) return 'f';
  if (near(r, g, b, 255, 128, 0)) return 'g';
  return null;
}

/** A colour-coded template image (segments a..g in fixed RGB colours), RGBA row-major. */
export function segmentTemplateFromRgba(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): SegmentTemplate {
  const masks = {} as Record<SegmentKey, PointI[]>;
  for (const key of SEGMENT_KEYS) masks[key] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const key = segmentKeyForColor(rgba[i], rgba[i + 1], rgba[i + 2]);
      if (key) masks[key].push({ x, y });
    }
  }
  return new SegmentTemplate(width, height, masks);
}

export interface SegmentCandidate {
  values: Record<string, number>;
  states: Record<string, boolean>;
  pattern: string;
  decoded: string;
  valid: boolean;
  onCount: number;
  confidence: number;
  margin: number;
  x: number;
  y: number;
  w: number;
  h: number;
  scaleX: number;
  scaleY: number;
}

const PATTERNS: Record<string, string> = {
  '1111110': '0',
  '0001100': '1',
  '0110111': '2',
  '0011111': '3',
  '1001101': '4',
  '1011011': '5',
  '1111011': '6',
  '0001110': '7',
  '1111111': '8',
  '1011111': '9',
};

export function decodePattern(pattern: string): string {
  return PATTERNS[pattern] ?? '?';
}

export function canonicalSegmentSlotSize(type: 'lap' | 'total', slot: number): [number, number] {
  const punctuation = slot === 2 || slot === 5;
  const width = type === 'total' ? (punctuation ? 8 : 22) : (punctuation ? 7 : 19);
  const height = type === 'total' ? 33 : 27;
  return [width, height];
}

/** binary: 8UC1 Mat-data (0/255) met breedte patchW, hoogte patchH. */
export function bestSegmentCandidate(binary: Uint8Array, patchW: number, patchH: number, base: SegmentTemplate, kind: 'lap' | 'total', slotIndex: number, requiredDigit?: string): SegmentCandidate | null {
  if (patchW <= 0 || patchH <= 0 || base.width <= 0 || base.height <= 0) return null;
  const canonical = canonicalSegmentSlotSize(kind, slotIndex);
  const hintX = patchW / Math.max(1.0, canonical[0]);
  const hintY = patchH / Math.max(1.0, canonical[1]);
  const sx = Math.max(0.85, Math.min(1.0, hintX));
  const sy = Math.max(0.85, Math.min(1.2, hintY));
  const scaled = base.scaled(sx, sy);
  if (scaled.width <= 0 || scaled.height <= 0 || patchW < scaled.width || patchH < scaled.height) return null;
  let best: SegmentCandidate | null = null;
  for (let ty = 0; ty <= patchH - scaled.height; ty++) {
    for (let tx = 0; tx <= patchW - scaled.width; tx++) {
      const candidate = scoreTemplateAt(binary, patchW, patchH, scaled, tx, ty, sx, sy);
      if (requiredDigit && candidate.decoded !== requiredDigit) continue;
      if (!best || compareCandidates(candidate, best) > 0) best = candidate;
    }
  }
  return best;
}

function scoreTemplateAt(binary: Uint8Array, patchW: number, patchH: number, template: SegmentTemplate, tx: number, ty: number, sx: number, sy: number): SegmentCandidate {
  const values: Record<string, number> = {};
  const states: Record<string, boolean> = {};
  let onCount = 0;
  let confidenceSum = 0.0;
  let confidenceCount = 0;
  for (const key of SEGMENT_KEYS) {
    const points = template.points[key];
    let total = 0;
    let on = 0;
    if (points) {
      for (const p of points) {
        const xx = tx + p.x;
        const yy = ty + p.y;
        if (xx >= 0 && xx < patchW && yy >= 0 && yy < patchH) {
          total++;
          if (binary[yy * patchW + xx] > 127) on++;
        }
      }
    }
    const frac = total === 0 ? 0.0 : on / total;
    const state = frac >= 0.35;
    values[key] = frac;
    states[key] = state;
    onCount += state ? 1 : 0;
    confidenceSum += state ? frac : 1.0 - frac;
    confidenceCount++;
  }
  const pattern = SEGMENT_KEYS.map((k) => (states[k] ? '1' : '0')).join('');
  const decoded = decodePattern(pattern);
  return {
    values,
    states,
    pattern,
    decoded,
    valid: decoded !== '?',
    onCount,
    confidence: confidenceCount === 0 ? 0.0 : confidenceSum / confidenceCount,
    margin: segmentMargin(values, states),
    x: tx,
    y: ty,
    w: template.width,
    h: template.height,
    scaleX: sx,
    scaleY: sy,
  };
}

function segmentMargin(values: Record<string, number>, states: Record<string, boolean>): number {
  let activeTotal = 0.0;
  let activeCount = 0;
  let inactiveMax = 0.0;
  for (const key of SEGMENT_KEYS) {
    const value = values[key] ?? 0.0;
    if (states[key]) {
      activeTotal += value;
      activeCount++;
    } else {
      inactiveMax = Math.max(inactiveMax, value);
    }
  }
  const activeMean = activeCount === 0 ? 0.0 : activeTotal / activeCount;
  return activeMean - inactiveMax;
}

function cmpNum(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareCandidates(a: SegmentCandidate, b: SegmentCandidate): number {
  const validCompare = cmpNum(a.valid ? 1 : 0, b.valid ? 1 : 0);
  if (validCompare !== 0) return validCompare;
  const thisMargin = a.valid ? a.margin : -1.0;
  const otherMargin = b.valid ? b.margin : -1.0;
  const marginCompare = cmpNum(thisMargin, otherMargin);
  if (marginCompare !== 0) return marginCompare;
  const confidenceCompare = cmpNum(a.confidence, b.confidence);
  if (confidenceCompare !== 0) return confidenceCompare;
  return cmpNum(a.onCount, b.onCount);
}

/** Fallback zonder sjabloon: dekking per regio (OfflineParityNativePipeline.segmentScores). */
export function segmentScores(binary: Uint8Array, w: number, h: number): Record<string, number> {
  const coverage = (x1: number, y1: number, x2: number, y2: number): number => {
    const left = Math.max(0, Math.min(w - 1, Math.round(w * x1)));
    const top = Math.max(0, Math.min(h - 1, Math.round(h * y1)));
    const right = Math.max(left + 1, Math.min(w, Math.round(w * x2)));
    const bottom = Math.max(top + 1, Math.min(h, Math.round(h * y2)));
    let on = 0;
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        if (binary[y * w + x] !== 0) on++;
      }
    }
    return on / Math.max(1.0, (bottom - top) * (right - left));
  };
  return {
    a: coverage(0.20, 0.03, 0.80, 0.18),
    b: coverage(0.72, 0.12, 0.95, 0.48),
    c: coverage(0.72, 0.52, 0.95, 0.88),
    d: coverage(0.20, 0.82, 0.80, 0.97),
    e: coverage(0.05, 0.52, 0.28, 0.88),
    f: coverage(0.05, 0.12, 0.28, 0.48),
    g: coverage(0.20, 0.42, 0.80, 0.58),
  };
}
