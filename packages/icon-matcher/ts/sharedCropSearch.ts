/**
 * The decision of the Web/Android icon crop search, without pixels (issue #99). The Python reference
 * (python/mk8dx_icon_matcher/crop_search.py) holds the whole search, pixel work included; this module and
 * CropSearch.java hold its decision steps and constants. Since phase 4 the Web scanner (cleanAssets.ts
 * identifyCropSearch, kartConfig.ts matchCard) calls them for every decision; only the pixel work stays
 * in the product. All three replay vectors/crop-search-v1.json: its constants, a case list per helper and
 * whole searches.
 *
 * A look is one identifyCropSearch call: `box` (fractional x, y, w, h), `search`, `subset`, the nominal
 * crop's rounded score, the per-reference `[id, masksum, minVal, x, y]` of the masked TM_SQDIFF position
 * pass, and the rounded score of the crop at the picked shift. Rounding is Math.round (half up).
 */

export type Candidate = [string, number, number, number, number];
export type Box = [number, number, number, number];

export interface Look {
  scale: number;
  box: Box;
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
  slot: Box;
  looks: Look[];
}

export type SearchGroup = 'characters' | 'bodies' | 'gliders';

// The searcher's constants; crop_search.py and CropSearch.java hold the same values and the vectors'
// `constants` record is checked against all three.
export const CHARACTER_SCALES: readonly number[] = [0.94, 0.96, 0.98, 1.0, 1.02, 1.04, 1.06];
export const SEARCH_PX: Readonly<Record<SearchGroup, number>> = { characters: 10, bodies: 6, gliders: 6 };
export const BOOST_MARGIN = 18;
export const BOOST_SAT_MIN = 1.0;
export const BOOST_SAT_MAX = 80.0;
export const BOOST_SAT_TARGET = 90.0;
export const BOOST_MAX_FACTOR = 2.0;
export const WINDOW_GAIN_MIN = 0.6;
export const WINDOW_GAIN_MAX = 1.8;
export const MIN_WINDOW_MEAN = 1e-4;
export const MIN_TEMPLATE_PX = 8;
export const MIN_CROP_PX = 8;
export const MIN_TEMPLATE_SUM = 24.0;

function clipRect(x: number, y: number, w: number, h: number, width: number, height: number): Box {
  const cx = Math.max(0, Math.min(width - 1, x));
  const cy = Math.max(0, Math.min(height - 1, y));
  return [cx, cy, Math.max(0, Math.min(w, width - cx)), Math.max(0, Math.min(h, height - cy))];
}

/** The position pass radius of a group. */
export function searchPx(group: SearchGroup): number {
  return SEARCH_PX[group];
}

/** `[wx1, wy1, wx2, wy2]` the position pass searches, or null when it does not run. */
export function searchWindow(x1: number, y1: number, tw: number, th: number, width: number, height: number, search: number): [number, number, number, number] | null {
  const wx1 = Math.max(0, x1 - search);
  const wy1 = Math.max(0, y1 - search);
  const wx2 = Math.min(width, x1 + tw + search);
  const wy2 = Math.min(height, y1 + th + search);
  if (tw < MIN_TEMPLATE_PX || th < MIN_TEMPLATE_PX || wy2 - wy1 < th || wx2 - wx1 < tw) return null;
  return [wx1, wy1, wx2, wy2];
}

/** The search window's gain towards the references' mean, or null (gain 1) for a dark window. */
export function windowGain(refMean: number, windowMean: number): number | null {
  if (windowMean > MIN_WINDOW_MEAN) return Math.max(WINDOW_GAIN_MIN, Math.min(WINDOW_GAIN_MAX, refMean / windowMean));
  return null;
}

/** Whether a sized reference takes part in the position pass. */
export function votes(id: string, total: number, subset: Set<string> | null): boolean {
  return !(total < MIN_TEMPLATE_SUM || (subset !== null && !subset.has(id)));
}

/** The first strictly highest `1 - minVal / masksum` of the voting references: its top-left in the window. */
export function pickPosition(candidates: Candidate[], subset: Set<string> | null): [number, number] | null {
  let bestScore = -Infinity;
  let best: [number, number] | null = null;
  for (const [id, total, minVal, x, y] of candidates) {
    if (!votes(id, total, subset)) continue;
    const score = 1.0 - minVal / total;
    if (score > bestScore) {
      bestScore = score;
      best = [x, y];
    }
  }
  return best;
}

/** The shift of the picked window position from the nominal crop, or null when it is zero. */
export function pickedShift(window: [number, number, number, number], picked: [number, number], x1: number, y1: number): [number, number] | null {
  const dx = window[0] + picked[0] - x1;
  const dy = window[1] + picked[1] - y1;
  return dx === 0 && dy === 0 ? null : [dx, dy];
}

/** The shifted crop replaces the nominal one when its rounded score is at least as high. */
export function acceptShift(shiftedScore: number, centerScore: number): boolean {
  return shiftedScore >= centerScore;
}

/** `[x, y, w, h]` around a character slot that the ghost-card saturation boost measures and recolours. */
export function boostRegion(slot: Box, width: number, height: number): Box {
  const [x1, y1, slotW, slotH] = slot;
  const roiX = Math.max(0, x1 - BOOST_MARGIN);
  const roiY = Math.max(0, y1 - BOOST_MARGIN);
  return [roiX, roiY, Math.min(width - roiX, slotW + 2 * BOOST_MARGIN), Math.min(height - roiY, slotH + 2 * BOOST_MARGIN)];
}

/** The ghost-card boost's saturation factor for the region's mean saturation, or null (no boost). */
export function boostFactor(meanSat: number): number | null {
  if (meanSat > BOOST_SAT_MIN && meanSat < BOOST_SAT_MAX) return Math.min(BOOST_MAX_FACTOR, BOOST_SAT_TARGET / meanSat);
  return null;
}

/** The fractional `[x, y, w, h]` one look of the character sweep searches, in its source's coordinates. */
export function lookBox(slot: Box, scale: number, roiX = 0, roiY = 0): Box {
  const [x1, y1, slotW, slotH] = slot;
  const w2 = slotW * scale;
  const h2 = slotH * scale;
  return [x1 + (slotW - w2) / 2.0 - roiX, y1 + (slotH - h2) / 2.0 - roiY, w2, h2];
}

/** Whether a look beats the best so far (null: it is the first): the first strictly highest wins. */
export function betterLook(score: number, bestScore: number | null): boolean {
  return bestScore === null || score > bestScore;
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
  const shift = picked === null ? null : pickedShift(window, picked, x1, y1);
  if (shift !== null && acceptShift(look.shiftedScore ?? 0.0, center)) {
    return { dx: shift[0], dy: shift[1], score: look.shiftedScore ?? 0.0, shifted: true, window };
  }
  return { dx: 0, dy: 0, score: center, shifted: false, window };
}

/** The crop the shared reader scores: the slot scaled about its centre, then shifted. */
export function cropBox(slot: Box, scale: number, dx: number, dy: number): Box {
  const [x1, y1, slotW, slotH] = slot;
  const cw = Math.max(MIN_CROP_PX, Math.round(slotW * scale));
  const ch = Math.max(MIN_CROP_PX, Math.round(slotH * scale));
  return [Math.round(x1 + (slotW - cw) / 2.0) + dx, Math.round(y1 + (slotH - ch) / 2.0) + dy, cw, ch];
}

export function decideField(field: FieldCase): { scale: number; dx: number; dy: number; score: number; cropBox: Box; looks: LookDecision[] } {
  const looks = field.looks.map((look) => decideSearch(look, field.width, field.height));
  let best = -1;
  for (let i = 0; i < looks.length; i++) {
    if (betterLook(looks[i].score, best < 0 ? null : looks[best].score)) best = i;
  }
  const scale = field.looks[best].scale;
  const got = looks[best];
  return { scale, dx: got.dx, dy: got.dy, score: got.score, cropBox: cropBox(field.slot, scale, got.dx, got.dy), looks };
}
