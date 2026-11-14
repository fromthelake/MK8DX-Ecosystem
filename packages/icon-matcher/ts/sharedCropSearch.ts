/**
 * The decision of the Web/Android icon crop search, without pixels (issue #99, phase 3). The Python
 * reference (python/mk8dx_icon_matcher/crop_search.py) holds the whole search, pixel work included,
 * transcribed from the Web scanner's cleanAssets.ts identifyCropSearch and kartConfig.ts matchCard;
 * this module and CropSearch.java replay its decision on the measurements in
 * vectors/crop-search-v1.json. The product still runs its own copy (unifying it is phase 4).
 *
 * A look is one identifyCropSearch call: `box` (fractional x, y, w, h), `search`, `subset`, the nominal
 * crop's rounded score, the per-reference `[id, masksum, minVal, x, y]` of the masked TM_SQDIFF position
 * pass, and the rounded score of the crop at the picked shift. Rounding is Math.round (half up).
 */

export type Candidate = [string, number, number, number, number];

export interface Look {
  scale: number;
  box: [number, number, number, number];
  search: number;
  subset: string[] | null;
  centerScore: number | null;
  candidates: Candidate[];
  shiftedScore: number | null;
}

export interface LookDecision {
  dx: number;
  dy: number;
  score: number;
  shifted: boolean;
  window: [number, number, number, number] | null;
}

export interface FieldCase {
  width: number;
  height: number;
  slot: [number, number, number, number];
  looks: Look[];
}

export const MIN_TEMPLATE_SUM = 24.0;

function clipRect(x: number, y: number, w: number, h: number, width: number, height: number): [number, number, number, number] {
  const cx = Math.max(0, Math.min(width - 1, x));
  const cy = Math.max(0, Math.min(height - 1, y));
  return [cx, cy, Math.max(0, Math.min(w, width - cx)), Math.max(0, Math.min(h, height - cy))];
}

export function searchWindow(x1: number, y1: number, tw: number, th: number, width: number, height: number, search: number): [number, number, number, number] | null {
  const wx1 = Math.max(0, x1 - search);
  const wy1 = Math.max(0, y1 - search);
  const wx2 = Math.min(width, x1 + tw + search);
  const wy2 = Math.min(height, y1 + th + search);
  if (tw < 8 || th < 8 || wy2 - wy1 < th || wx2 - wx1 < tw) return null;
  return [wx1, wy1, wx2, wy2];
}

export function pickPosition(candidates: Candidate[], subset: Set<string> | null): [number, number] | null {
  let bestScore = -Infinity;
  let best: [number, number] | null = null;
  for (const [id, total, minVal, x, y] of candidates) {
    if (total < MIN_TEMPLATE_SUM || (subset !== null && !subset.has(id))) continue;
    const score = 1.0 - minVal / total;
    if (score > bestScore) {
      bestScore = score;
      best = [x, y];
    }
  }
  return best;
}

export function decideSearch(look: Look, width: number, height: number): LookDecision {
  const [bx, by, bw, bh] = look.box;
  const tw = Math.round(bw);
  const th = Math.round(bh);
  const x1 = Math.round(bx);
  const y1 = Math.round(by);
  const [, , nw, nh] = clipRect(x1, y1, tw, th, width, height);
  if (nw <= 0 || nh <= 0) return { dx: 0, dy: 0, score: 0.0, shifted: false, window: null };
  const center = look.centerScore ?? 0.0;
  const window = searchWindow(x1, y1, tw, th, width, height, look.search);
  if (window === null) return { dx: 0, dy: 0, score: center, shifted: false, window: null };
  const picked = pickPosition(look.candidates, look.subset === null ? null : new Set(look.subset));
  if (picked !== null) {
    const dx = window[0] + picked[0] - x1;
    const dy = window[1] + picked[1] - y1;
    if ((dx !== 0 || dy !== 0) && (look.shiftedScore ?? 0.0) >= center) {
      return { dx, dy, score: look.shiftedScore ?? 0.0, shifted: true, window };
    }
  }
  return { dx: 0, dy: 0, score: center, shifted: false, window };
}

export function cropBox(slot: [number, number, number, number], scale: number, dx: number, dy: number): [number, number, number, number] {
  const [x1, y1, slotW, slotH] = slot;
  const cw = Math.max(8, Math.round(slotW * scale));
  const ch = Math.max(8, Math.round(slotH * scale));
  return [Math.round(x1 + (slotW - cw) / 2.0) + dx, Math.round(y1 + (slotH - ch) / 2.0) + dy, cw, ch];
}

export function decideField(field: FieldCase): { scale: number; dx: number; dy: number; score: number; cropBox: [number, number, number, number]; looks: LookDecision[] } {
  const looks = field.looks.map((look) => decideSearch(look, field.width, field.height));
  let best = -1;
  for (let i = 0; i < looks.length; i++) {
    if (best < 0 || looks[i].score > looks[best].score) best = i;
  }
  const scale = field.looks[best].scale;
  const got = looks[best];
  return { scale, dx: got.dx, dy: got.dy, score: got.score, cropBox: cropBox(field.slot, scale, got.dx, got.dy), looks };
}
