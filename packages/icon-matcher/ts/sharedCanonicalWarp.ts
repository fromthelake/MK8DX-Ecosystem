/**
 * The canonical card geometry before the crop (issue #99, phase 5): from the card quad in the frame to
 * the 1280x720 canonical card that the slot and crop search read. The Python reference
 * (python/mk8dx_icon_matcher/canonical_warp.py) documents the steps; this module and CanonicalWarp.java
 * hold the same pure arithmetic in the same order. OpenCV's perspective solve, the matrix products'
 * pixel use and the warps stay in the products; the solved homography (and a panel registration) are
 * inputs. All three replay vectors/canonical-warp-v1.json. Rounding is Math.round (half up).
 */

export type Point = [number, number];
export type Quad = [Point, Point, Point, Point];
export type Rect = [number, number, number, number];
export type Ltrb = [number, number, number, number];
export type Matrix = number[];

export interface TargetBox { box: Ltrb; source: string }
export interface AntialiasPlan { factor: number; reducedW: number; reducedH: number; unscale: Matrix }

export interface WarpCase {
  frame: [number, number];
  quad: Point[];
  seed: string;
  deskewRoi: [number, number, number, number] | null;
  owner: string;
  raceKey: string;
  ghostDetail: boolean;
  race3Content: Ltrb | null;
  race7Content: Ltrb | null;
  homography: Matrix;
  registration: Matrix | null;
}

export interface WarpResult {
  bounds: Rect;
  destination: Quad;
  currentBox: Ltrb;
  target: TargetBox;
  align: [number, number, number, number];
  affine: Matrix;
  composed: Matrix;
  antialias: AntialiasPlan | null;
  final: Matrix;
  warpSource: [number, number];
}

// The constants; canonical_warp.py and CanonicalWarp.java hold the same values and the vectors'
// `constants` record is checked against all three.
export const CANONICAL_SIZE: readonly [number, number] = [1280, 720];
export const PLAYER_BOX_RACE7: readonly number[] = [548.0, 362.0, 1231.0, 661.0];
export const GHOST_BOX_RACE7: readonly number[] = [548.0, 42.0, 1231.0, 349.0];
export const GHOST_DETAIL_BOX_RACE3: readonly number[] = [540.0, 170.0, 782.0, 331.0];
export const GHOST_DETAIL_BOX_RACE7: readonly number[] = [540.0, 120.0, 767.0, 379.0];
export const ANTIALIAS_BELOW_SCALE = 0.5;
export const ANTIALIAS_TARGET_SCALE = 0.8;
export const CONTENT_KEYS: readonly string[] = ['lap_index_boxes_rel', 'total_strip_rel', 'lap_strips_rel'];
export const GHOST_DETAIL_DESKEW_SEED = 'ghost_detail_deskew_seed';

/** `[x, y, w, h]`: floor of the smallest and ceil of the largest corner, clipped to the frame. */
export function boundingRect(quad: Point[], width: number, height: number): Rect {
  let minX = Number.MAX_VALUE;
  let minY = Number.MAX_VALUE;
  let maxX = -Number.MAX_VALUE;
  let maxY = -Number.MAX_VALUE;
  for (const [px, py] of quad) {
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  }
  const x = Math.max(0, Math.min(width - 1, Math.floor(minX)));
  const y = Math.max(0, Math.min(height - 1, Math.floor(minY)));
  const right = Math.max(x + 1, Math.min(width, Math.ceil(maxX)));
  const bottom = Math.max(y + 1, Math.min(height, Math.ceil(maxY)));
  return [x, y, right - x, bottom - y];
}

/** The four corners of a rectangle, clockwise from top-left; right and bottom are `x + w - 1`. */
export function quadFromRect(rect: Rect): Quad {
  const [x, y, w, h] = rect;
  return [[x, y], [x + w - 1, y], [x + w - 1, y + h - 1], [x, y + h - 1]];
}

/** Every corner moved by `(dx, dy)` (the products' Quad.shifted). */
export function shiftedQuad(quad: Point[], dx: number, dy: number): Point[] {
  return quad.map(([px, py]) => [px + dx, py + dy] as Point);
}

/** `[left, top, right, bottom]` around the quad's corners. */
export function quadBox(quad: Point[]): Ltrb {
  let left = Number.MAX_VALUE;
  let top = Number.MAX_VALUE;
  let right = -Number.MAX_VALUE;
  let bottom = -Number.MAX_VALUE;
  for (const [px, py] of quad) {
    left = Math.min(left, px);
    top = Math.min(top, py);
    right = Math.max(right, px);
    bottom = Math.max(bottom, py);
  }
  return [left, top, right, bottom];
}

function appendRel(grid: any, value: any[], boxes: Ltrb[]): void {
  if (value.length === 4 && !Array.isArray(value[0])) {
    const anchor = grid.anchor;
    const ax = anchor ? anchor.x ?? 0.0 : 0.0;
    const ay = anchor ? anchor.y ?? 0.0 : 0.0;
    const x1 = ax + (value[0] ?? 0.0);
    const y1 = ay + (value[1] ?? 0.0);
    const x2 = ax + (value[2] ?? 0.0);
    const y2 = ay + (value[3] ?? 0.0);
    boxes.push([Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)]); // ordered, as the products' BoxD
    return;
  }
  for (const child of value) if (Array.isArray(child)) appendRel(grid, child, boxes);
}

/** The union of an owner grid's lap-index, total and lap strips (anchor plus relative box, each box ordered), or null. */
export function contentExtent(ownerGrid: any): Ltrb | null {
  if (!ownerGrid) return null;
  const boxes: Ltrb[] = [];
  for (const key of CONTENT_KEYS) {
    const value = ownerGrid[key];
    if (Array.isArray(value)) appendRel(ownerGrid, value, boxes);
  }
  if (boxes.length === 0) return null;
  let left = Number.MAX_VALUE;
  let top = Number.MAX_VALUE;
  let right = -Number.MAX_VALUE;
  let bottom = -Number.MAX_VALUE;
  for (const b of boxes) {
    left = Math.min(left, b[0]);
    top = Math.min(top, b[1]);
    right = Math.max(right, b[2]);
    bottom = Math.max(bottom, b[3]);
  }
  return [left, top, right, bottom];
}

/** Where the card lies on the canonical frame. */
export function targetBox(owner: string, raceKey: string, ghostDetail: boolean, race3Content: Ltrb | null,
  race7Content: Ltrb | null): TargetBox {
  if (ghostDetail) {
    const race7 = raceKey === 'race7';
    return { box: [...(race7 ? GHOST_DETAIL_BOX_RACE7 : GHOST_DETAIL_BOX_RACE3)] as Ltrb,
      source: `fixed_ghost_detail_canonical_target_${race7 ? 'race7' : 'race3'}` };
  }
  const race7 = owner === 'ghost' ? GHOST_BOX_RACE7 : PLAYER_BOX_RACE7;
  if (raceKey !== 'race3') return { box: [...race7] as Ltrb, source: 'fixed_race7_canonical_target' };
  if (!race3Content || !race7Content) {
    return { box: [...race7] as Ltrb, source: 'fallback_fixed_race7_missing_relative_grid_content_extent' };
  }
  const left = race7Content[0] - race7[0];
  const top = race7Content[1] - race7[1];
  const right = race7[2] - race7Content[2];
  const bottom = race7[3] - race7Content[3];
  return { box: [race3Content[0] - left, race3Content[1] - top, race3Content[2] + right, race3Content[3] + bottom],
    source: 'derived_from_race3_relative_grid_using_race7_card_content_margins' };
}

/** `[scaleX, scaleY, translateX, translateY]` that map `currentBox` onto `target` (a side under 1 counts as 1). */
export function canonicalAlign(currentBox: Ltrb, target: Ltrb): [number, number, number, number] {
  const sx = Math.max(1.0, target[2] - target[0]) / Math.max(1.0, currentBox[2] - currentBox[0]);
  const sy = Math.max(1.0, target[3] - target[1]) / Math.max(1.0, currentBox[3] - currentBox[1]);
  return [sx, sy, target[0] - currentBox[0] * sx, target[1] - currentBox[1] * sy];
}

export function alignMatrix(align: [number, number, number, number]): Matrix {
  const [sx, sy, tx, ty] = align;
  return [sx, 0.0, tx, 0.0, sy, ty, 0.0, 0.0, 1.0];
}

/** `a x b` for row-major 3x3 matrices, each element summed left to right (OpenCV gemm). */
export function compose(a: Matrix, b: Matrix): Matrix {
  const out: Matrix = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) out.push(a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j]);
  }
  return out;
}

/** The area reduction before a warp that shrinks below 0.5, or null. */
export function antialiasPlan(align: [number, number, number, number], cols: number, rows: number): AntialiasPlan | null {
  const shrink = Math.min(align[0], align[1]);
  if (!(shrink > 0 && shrink < ANTIALIAS_BELOW_SCALE)) return null;
  const factor = shrink / ANTIALIAS_TARGET_SCALE;
  const reducedW = Math.max(1, Math.round(cols * factor));
  const reducedH = Math.max(1, Math.round(rows * factor));
  return { factor, reducedW, reducedH, unscale: [cols / reducedW, 0.0, 0.0, 0.0, rows / reducedH, 0.0, 0.0, 0.0, 1.0] };
}

/** The whole geometry of one card (canonical_warp.canonical_transform). */
export function canonicalTransform(c: WarpCase): WarpResult {
  const [cols, rows] = c.frame;
  let bounds: Rect;
  if (c.seed === GHOST_DETAIL_DESKEW_SEED) {
    const [left, top, roiCols, roiRows] = c.deskewRoi as [number, number, number, number];
    bounds = boundingRect(shiftedQuad(quadFromRect([0, 0, roiCols, roiRows]), left, top), cols, rows);
  } else {
    bounds = boundingRect(c.quad, cols, rows);
  }
  const destination = quadFromRect(bounds);
  const currentBox = quadBox(destination);
  const target = targetBox(c.owner, c.raceKey, !!c.ghostDetail, c.race3Content ?? null, c.race7Content ?? null);
  const align = canonicalAlign(currentBox, target.box);
  const affine = alignMatrix(align);
  let composed = compose(affine, c.homography);
  const antialias = antialiasPlan(align, cols, rows);
  if (antialias) composed = compose(composed, antialias.unscale);
  const final = c.registration ? compose(c.registration, composed) : composed;
  return { bounds, destination, currentBox, target, align, affine, composed, antialias, final,
    warpSource: antialias ? [antialias.reducedW, antialias.reducedH] : [cols, rows] };
}
