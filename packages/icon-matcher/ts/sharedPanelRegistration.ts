// The central Select-a-Ghost panel registration decision (CENTRAL_RECOGNITION section 8.6, phase 5):
// the TypeScript port of python/mk8dx_icon_matcher/panel_registration.py (the reference) and
// PanelRegistration.java, kept equal by the parity vectors (tooling/recognition/
// panel_registration_vectors.py, vectors/panel-registration-v1.json). The product hands in its pixel
// work: the anchor template match (peak and its four neighbours, null at the border) and OpenCV's
// findHomography (RANSAC, 2 px).

export const PANEL_SEARCH_X = 30;
export const PANEL_SEARCH_Y = 12;
const MIN_SCORE = 0.45;
const MIN_ANCHORS = 8;
const MIN_INLIER_SHARE = 0.7;
const MAX_SHIFT = 40.0;
export const PANEL_RANSAC_THRESHOLD = 2.0;

/** [score, x, y, left, right, up, down]: the peak and its neighbours in the match result map. */
export type PanelMatch = [number, number, number, number | null, number | null, number | null, number | null];

export interface PanelRegistrationPixels {
  match(index: number, window: number[]): PanelMatch;
  /** [h (9 numbers, row by row) or null, inlier count]. */
  homography(found: number[][], reference: number[][]): [number[] | null, number];
}

/** [left, top, right, bottom] searched around an anchor's reference box, or null. */
export function anchorWindow(box: number[], imageW: number, imageH: number): number[] | null {
  const [left, top, right, bottom] = box;
  const wl = Math.max(0, left - PANEL_SEARCH_X);
  const wt = Math.max(0, top - PANEL_SEARCH_Y);
  const wr = Math.min(imageW, right + PANEL_SEARCH_X);
  const wb = Math.min(imageH, bottom + PANEL_SEARCH_Y);
  if (wr - wl < (right - left) + 2 || wb - wt < (bottom - top) + 2) return null;
  return [wl, wt, wr, wb];
}

export function subPixelPeak(before: number | null, peak: number, after: number | null): number {
  if (before === null || after === null) return 0.0;
  const den = before - 2.0 * peak + after;
  return den === 0 ? 0.0 : (0.5 * (before - after)) / den;
}

export function registerPanel(variant: string, boxes: number[][], imageW: number, imageH: number,
  pixels: PanelRegistrationPixels): { h: number[] | null; info: Record<string, unknown> } {
  const info: Record<string, unknown> = { variant, anchors: boxes.length, applied: false };
  const found: number[][] = [];
  const reference: number[][] = [];
  boxes.forEach((box, index) => {
    const window = anchorWindow(box, imageW, imageH);
    if (!window) return;
    const [score, x, y, left, right, up, down] = pixels.match(index, window);
    if (score < MIN_SCORE) return;
    const px = x + subPixelPeak(left, score, right);
    const py = y + subPixelPeak(up, score, down);
    found.push([window[0] + px + (box[2] - box[0]) / 2, window[1] + py + (box[3] - box[1]) / 2]);
    reference.push([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]);
  });
  const n = found.length;
  info.found = n;
  if (n < MIN_ANCHORS) {
    info.reason = 'too_few_anchors';
    return { h: null, info };
  }
  const [h, inliers] = pixels.homography(found, reference);
  info.inliers = inliers;
  if (!h || inliers < MIN_ANCHORS || inliers < MIN_INLIER_SHARE * n) {
    info.reason = 'anchors_disagree';
    return { h: null, info };
  }
  let shift = 0.0;
  let sumSq = 0.0;
  for (let i = 0; i < n; i++) {
    const [x, y] = found[i];
    const w = h[6] * x + h[7] * y + h[8];
    const qx = (h[0] * x + h[1] * y + h[2]) / w;
    const qy = (h[3] * x + h[4] * y + h[5]) / w;
    shift = Math.max(shift, Math.hypot(qx - x, qy - y));
    sumSq += (qx - reference[i][0]) * (qx - reference[i][0]) + (qy - reference[i][1]) * (qy - reference[i][1]);
  }
  info.max_shift_px = shift;
  info.rms_px = Math.sqrt(sumSq / n);
  if (shift > MAX_SHIFT) {
    info.reason = 'implausible_shift';
    return { h: null, info };
  }
  info.applied = true;
  return { h: [...h], info };
}
