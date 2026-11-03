/** Centered, contrast-invariant shape evidence on a verified icon crop.
 *
 * This is a ranking arm, never an acceptance decision. Tire shape uses each
 * clean asset's alpha mask; flag pattern keeps all pixels so stripes and
 * emblems remain evidence. Callers choose the crop before this comparison.
 */

import type { IconTensorGroup } from './sharedIconScorer';

export type ShapeRankMode = 'masked_gray_ncc' | 'full_rgb_ncc';

export interface ShapeRank {
  mode: ShapeRankMode;
  top: { id: string; score: number }[];
  margin: number;
}

const gray = (rgb: Float32Array, offset: number): number =>
  0.299 * rgb[offset] + 0.587 * rgb[offset + 1] + 0.114 * rgb[offset + 2];

export function rankIconShape(query: Float32Array, group: IconTensorGroup,
  mode: ShapeRankMode): ShapeRank {
  const pixels = group.width * group.height;
  const count = group.ids.length;
  if (query.length !== pixels * 3 || group.rgb.length !== count * pixels * 3
      || group.mask.length !== count * pixels || count < 2
      || !['masked_gray_ncc', 'full_rgb_ncc'].includes(mode)) {
    throw new Error('Incompatible shape tensor');
  }
  const scores = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    const rgbBase = index * pixels * 3;
    const maskBase = index * pixels;
    let qMean = 0;
    let rMean = 0;
    let n = 0;
    for (let pixel = 0; pixel < pixels; pixel++) {
      if (mode === 'masked_gray_ncc' && group.mask[maskBase + pixel] === 0) continue;
      const offset = pixel * 3;
      if (mode === 'masked_gray_ncc') {
        qMean += gray(query, offset);
        rMean += gray(group.rgb, rgbBase + offset);
        n++;
      } else {
        for (let channel = 0; channel < 3; channel++) {
          qMean += query[offset + channel];
          rMean += group.rgb[rgbBase + offset + channel];
          n++;
        }
      }
    }
    if (!n) { scores[index] = -1; continue; }
    qMean /= n;
    rMean /= n;
    let numerator = 0;
    let qEnergy = 0;
    let rEnergy = 0;
    for (let pixel = 0; pixel < pixels; pixel++) {
      if (mode === 'masked_gray_ncc' && group.mask[maskBase + pixel] === 0) continue;
      const offset = pixel * 3;
      if (mode === 'masked_gray_ncc') {
        const q = gray(query, offset) - qMean;
        const r = gray(group.rgb, rgbBase + offset) - rMean;
        numerator += q * r;
        qEnergy += q * q;
        rEnergy += r * r;
      } else {
        for (let channel = 0; channel < 3; channel++) {
          const q = query[offset + channel] - qMean;
          const r = group.rgb[rgbBase + offset + channel] - rMean;
          numerator += q * r;
          qEnergy += q * q;
          rEnergy += r * r;
        }
      }
    }
    scores[index] = qEnergy * rEnergy > 1e-14
      ? numerator / Math.sqrt(qEnergy * rEnergy) : -1;
  }
  const order = Array.from(scores, (_, index) => index)
    .sort((a, b) => scores[b] - scores[a] || a - b);
  return { mode, margin: scores[order[0]] - scores[order[1]],
    top: order.slice(0, 3).map((index) => ({ id: group.ids[index], score: scores[index] })) };
}
