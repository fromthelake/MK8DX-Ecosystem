/** Source candidate: the Python icon matcher's masked RGB rank on tensors.
 *
 * Acquisition, ROI and cv2.INTER_AREA normalization are upstream. Reference
 * tensors and query tensors must be produced from the same pinned schema-9
 * catalog. This module contains no private assets or product route switch.
 */

export interface IconTensorGroup {
  width: number;
  height: number;
  ids: string[];
  families: string[];
  rgb: Float32Array;
  mask: Uint8Array;
  count: Float32Array;
}

export interface IconTensorMatch {
  status: 'accepted' | 'unknown';
  top1Id: string;
  acceptedId: string | null;
  score: number;
  margin: number;
  familyMargin: number | null;
  offset: [number, number];
  top: { id: string; familyId: string; score: number }[];
}

function scoreAt(query: Float32Array, group: IconTensorGroup, index: number): number {
  const pixels = group.width * group.height;
  const rgbBase = index * pixels * 3;
  const maskBase = index * pixels;
  let distance = 0;
  for (let pixel = 0; pixel < pixels; pixel++) {
    if (group.mask[maskBase + pixel] === 0) continue;
    const offset = pixel * 3;
    const reference = rgbBase + offset;
    distance += Math.abs(group.rgb[reference] - query[offset]);
    distance += Math.abs(group.rgb[reference + 1] - query[offset + 1]);
    distance += Math.abs(group.rgb[reference + 2] - query[offset + 2]);
  }
  return 1 - distance / (group.count[index] * 3 + 1e-6);
}

function shiftedQuery(query: Float32Array, width: number, height: number,
  dx: number, dy: number): Float32Array {
  const shifted = new Float32Array(query.length);
  for (let y = 0; y < height; y++) {
    const sourceY = Math.max(0, Math.min(height - 1, y - dy));
    for (let x = 0; x < width; x++) {
      const sourceX = Math.max(0, Math.min(width - 1, x - dx));
      const target = (y * width + x) * 3;
      const source = (sourceY * width + sourceX) * 3;
      shifted[target] = query[source];
      shifted[target + 1] = query[source + 1];
      shifted[target + 2] = query[source + 2];
    }
  }
  return shifted;
}

function ranked(scores: Float32Array): number[] {
  return Array.from(scores, (_, index) => index)
    .sort((left, right) => scores[right] - scores[left] || left - right);
}

function familyMargin(scores: Float32Array, group: IconTensorGroup, order: number[]): number | null {
  const next = order.find((index) => group.families[index] !== group.families[order[0]]);
  return next === undefined ? null : scores[order[0]] - scores[next];
}

/** Every reference's score at the centre (Python IconMatcher._score, search_radius 0):
 * 'rgb' masked RGB similarity, 'ncc' masked zero-mean correlation over the RGB channels. */
export function scoreIconTensorAll(query: Float32Array, group: IconTensorGroup,
  method: 'rgb' | 'ncc' = 'rgb'): Float64Array {
  const pixels = group.width * group.height;
  const count = group.ids.length;
  if (query.length !== pixels * 3 || group.rgb.length !== count * pixels * 3
      || group.mask.length !== count * pixels || group.count.length !== count || count < 2) {
    throw new Error('Incompatible icon tensor shape');
  }
  const scores = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    if (method === 'rgb') { scores[index] = scoreAt(query, group, index); continue; }
    const rgbBase = index * pixels * 3;
    const maskBase = index * pixels;
    const total = group.count[index] * 3 + 1e-6;
    let refSum = 0;
    let querySum = 0;
    for (let pixel = 0; pixel < pixels; pixel++) {
      if (group.mask[maskBase + pixel] === 0) continue;
      for (let channel = 0; channel < 3; channel++) {
        refSum += group.rgb[rgbBase + pixel * 3 + channel];
        querySum += query[pixel * 3 + channel];
      }
    }
    const refMean = refSum / total;
    const queryMean = querySum / total;
    let numerator = 0;
    let refEnergy = 0;
    let queryEnergy = 0;
    for (let pixel = 0; pixel < pixels; pixel++) {
      if (group.mask[maskBase + pixel] === 0) continue;
      for (let channel = 0; channel < 3; channel++) {
        const a = group.rgb[rgbBase + pixel * 3 + channel] - refMean;
        const b = query[pixel * 3 + channel] - queryMean;
        numerator += a * b;
        refEnergy += a * a;
        queryEnergy += b * b;
      }
    }
    const denominator = Math.sqrt(refEnergy * queryEnergy);
    scores[index] = denominator > 1e-6 ? numerator / Math.max(denominator, 1e-6) : 0;
  }
  return scores;
}

/** One geometrically chosen crop, without per-reference displacement. */
export function matchIconTensorCenter(query: Float32Array, group: IconTensorGroup): IconTensorMatch {
  const pixels = group.width * group.height;
  const count = group.ids.length;
  if (query.length !== pixels * 3 || group.rgb.length !== count * pixels * 3
      || group.mask.length !== count * pixels || group.count.length !== count
      || group.families.length !== count || count < 2) {
    throw new Error('Incompatible icon tensor shape');
  }
  const scores = new Float32Array(count);
  for (let index = 0; index < count; index++) scores[index] = scoreAt(query, group, index);
  const order = ranked(scores);
  const first = order[0];
  const score = scores[first];
  const margin = score - scores[order[1]];
  const status = score >= 0.80 && margin >= 0.02 ? 'accepted' : 'unknown';
  return { status, top1Id: group.ids[first],
    acceptedId: status === 'accepted' ? group.ids[first] : null,
    score, margin, familyMargin: familyMargin(scores, group, order), offset: [0, 0],
    top: order.slice(0, 3).map((index) => ({ id: group.ids[index],
      familyId: group.families[index], score: scores[index] })) };
}

/** Exact Python candidate policy: center, family shortlist, then ±2 px. */
export function matchIconTensor(query: Float32Array, group: IconTensorGroup,
  searchMode: 'center_shortlist' | 'center_then_shortlist' = 'center_shortlist',
  shortlistSize = 8): IconTensorMatch {
  const pixels = group.width * group.height;
  const count = group.ids.length;
  if (query.length !== pixels * 3 || group.rgb.length !== count * pixels * 3
      || group.mask.length !== count * pixels || group.count.length !== count
      || group.families.length !== count || count < 2 || !Number.isInteger(shortlistSize)
      || shortlistSize < 1 || !['center_shortlist', 'center_then_shortlist'].includes(searchMode)) {
    throw new Error('Incompatible icon tensor shape');
  }
  const scores = new Float32Array(count);
  const offsets: [number, number][] = Array.from({ length: count }, () => [0, 0]);
  for (let index = 0; index < count; index++) scores[index] = scoreAt(query, group, index);
  const centerOrder = ranked(scores);
  const centerMargin = scores[centerOrder[0]] - scores[centerOrder[1]];
  if (!(searchMode === 'center_then_shortlist'
        && scores[centerOrder[0]] >= 0.80 && centerMargin >= 0.02)) {
    const families = new Set(centerOrder.slice(0, shortlistSize).map((index) => group.families[index]));
    const selected = centerOrder.filter((index) => families.has(group.families[index]));
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx === 0 && dy === 0) continue;
        const shifted = shiftedQuery(query, group.width, group.height, dx, dy);
        for (const index of selected) {
          const candidate = scoreAt(shifted, group, index);
          if (candidate > scores[index]) {
            scores[index] = candidate;
            offsets[index] = [dx, dy];
          }
        }
      }
    }
  }
  const order = ranked(scores);
  const first = order[0];
  const score = scores[first];
  const margin = score - scores[order[1]];
  const status = score >= 0.80 && margin >= 0.02 ? 'accepted' : 'unknown';
  return { status, top1Id: group.ids[first],
    acceptedId: status === 'accepted' ? group.ids[first] : null,
    score, margin, familyMargin: familyMargin(scores, group, order), offset: offsets[first],
    top: order.slice(0, 3).map((index) => ({ id: group.ids[index],
      familyId: group.families[index], score: scores[index] })) };
}
