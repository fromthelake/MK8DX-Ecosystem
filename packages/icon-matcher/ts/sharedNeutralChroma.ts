/** Opt-in neutral-reference colour evidence on the shared RGB tensors.
 *
 * The selected crop, visual top three and automatic acceptance remain intact.
 * This is the same bounded cue as the Python result-character reader. It is
 * evaluated only after the shared matcher has selected its alignment.
 */
import type { IconTensorGroup, IconTensorMatch } from './sharedIconScorer';

export interface NeutralChromaReview {
  schema: 'mk8dx.neutral-chroma-review.v1';
  status: 'not_applicable' | 'insufficient_pixels' | 'insufficient_colour'
    | 'measured' | 'alternative';
  rawTop1Id: string;
  proposalId: string;
  rawScore: number;
  proposalScore: number;
  referenceSaturation: number;
  querySaturation: number | null;
  offset: [number, number];
  considered: { id: string; score: number; referenceSaturation: number;
    scoreGap: number }[];
}

const asByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value * 255)));

function hsv(rgb: Float32Array, offset: number): { hue: number; saturation: number } {
  const r = asByte(rgb[offset]);
  const g = asByte(rgb[offset + 1]);
  const b = asByte(rgb[offset + 2]);
  const high = Math.max(r, g, b);
  const low = Math.min(r, g, b);
  const delta = high - low;
  const saturation = high === 0 ? 0 : Math.round(delta * 255 / high);
  if (delta === 0) return { hue: 0, saturation };
  let degrees = high === r ? 60 * (g - b) / delta
    : high === g ? 120 + 60 * (b - r) / delta
      : 240 + 60 * (r - g) / delta;
  if (degrees < 0) degrees += 360;
  return { hue: Math.round(degrees / 2) % 180, saturation };
}

function alignedPixel(query: Float32Array, width: number, height: number,
  x: number, y: number, dx: number, dy: number): number {
  const sourceX = Math.max(0, Math.min(width - 1, x - dx));
  const sourceY = Math.max(0, Math.min(height - 1, y - dy));
  return (sourceY * width + sourceX) * 3;
}

export function rankNeutralChroma(query: Float32Array, group: IconTensorGroup,
  visual: IconTensorMatch): NeutralChromaReview {
  const pixels = group.width * group.height;
  if (query.length !== pixels * 3 || group.rgb.length !== group.ids.length * pixels * 3
      || group.mask.length !== group.ids.length * pixels || !visual.top.length
      || visual.top[0].id !== visual.top1Id || !visual.top.every((item) =>
        group.ids.includes(item.id)) || !visual.offset.every((value) =>
        Number.isInteger(value) && Math.abs(value) <= 2)) {
    throw new Error('Incompatible result-character chroma input');
  }
  const first = visual.top[0];
  const index = new Map(group.ids.map((id, position) => [id, position]));
  const referenceSaturation = (id: string): number => {
    const position = index.get(id)!;
    const maskBase = position * pixels;
    const rgbBase = maskBase * 3;
    let sum = 0;
    let count = 0;
    for (let pixel = 0; pixel < pixels; pixel++) {
      if (!group.mask[maskBase + pixel]) continue;
      sum += hsv(group.rgb, rgbBase + pixel * 3).saturation;
      count++;
    }
    return count ? sum / count / 255 : 0;
  };
  const firstSat = referenceSaturation(first.id);
  const review: NeutralChromaReview = {
    schema: 'mk8dx.neutral-chroma-review.v1', status: 'not_applicable',
    rawTop1Id: first.id, proposalId: first.id, rawScore: first.score,
    proposalScore: first.score, referenceSaturation: firstSat,
    querySaturation: null, offset: [...visual.offset], considered: [],
  };
  if (firstSat > .06) return review;
  const firstPosition = index.get(first.id)!;
  const [dx, dy] = visual.offset;
  let sum = 0;
  let count = 0;
  for (let y = 0; y < group.height; y++) {
    for (let x = 0; x < group.width; x++) {
      const pixel = y * group.width + x;
      if (!group.mask[firstPosition * pixels + pixel]) continue;
      const colour = hsv(query, alignedPixel(query, group.width, group.height,
        x, y, dx, dy));
      if (colour.hue >= 18 && colour.hue <= 36) continue;
      sum += colour.saturation;
      count++;
    }
  }
  if (!count) { review.status = 'insufficient_pixels'; return review; }
  review.querySaturation = sum / count / 255;
  if (review.querySaturation < .12) {
    review.status = 'insufficient_colour';
    return review;
  }
  review.status = 'measured';
  for (const candidate of visual.top.slice(1, 3)) {
    const referenceSat = referenceSaturation(candidate.id);
    const gap = first.score - candidate.score;
    review.considered.push({ id: candidate.id, score: candidate.score,
      referenceSaturation: referenceSat, scoreGap: gap });
    if (referenceSat > .06 && gap <= .02) {
      review.status = 'alternative';
      review.proposalId = candidate.id;
      review.proposalScore = candidate.score;
      break;
    }
  }
  return review;
}
