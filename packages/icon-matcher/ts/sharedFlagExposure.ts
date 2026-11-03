/** Flag-only exposure proposal on the already selected result crop.
 *
 * A contrast-invariant pattern rank chooses the reference used to estimate
 * brightness. No old product answer or label enters the estimate. The adjusted
 * RGB rank is a review proposal, never an automatic acceptance.
 */
import { matchIconTensor, type IconTensorGroup } from './sharedIconScorer';
import type { ShapeRank } from './sharedShapeRank';

export interface FlagExposureProposal {
  schema: 'mk8dx.flag-exposure-proposal.v1';
  status: 'measured' | 'unavailable';
  reason: string;
  gain: number | null;
  referenceId: string | null;
  top: { id: string; score: number }[];
  tricolorBand?: { observed: number; nlReference: number; luReference: number;
    preferredId: string };
}

function upperQuartile(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[Math.round(.75 * (values.length - 1))];
}

function brightness(rgb: Float32Array, start: number, width: number, height: number): number {
  const values: number[] = [];
  for (let pixel = 0; pixel < width * height; pixel++) {
    const at = start + pixel * 3;
    values.push(Math.max(rgb[at], rgb[at + 1], rgb[at + 2]));
  }
  return upperQuartile(values);
}

function medianBand(rgb: Float32Array, width: number, start: number,
  y0: number, y1: number, channel: number): number {
  const values: number[] = [];
  for (let y = y0; y < y1; y++) for (let x = 12; x < 43; x++) {
    values.push(rgb[start + (y * width + x) * 3 + channel]);
  }
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

function tricolorBlueGreen(rgb: Float32Array, start: number, width: number): number {
  const green = medianBand(rgb, width, start, 25, 30, 1)
    / Math.max(.1, medianBand(rgb, width, start, 16, 22, 1));
  const blue = medianBand(rgb, width, start, 25, 30, 2)
    / Math.max(.1, medianBand(rgb, width, start, 16, 22, 2));
  return blue / Math.max(.1, green);
}

export function flagExposureProposal(query: Float32Array, group: IconTensorGroup,
  shape: ShapeRank): FlagExposureProposal {
  const unavailable = (reason: string, gain: number | null = null,
    referenceId: string | null = null): FlagExposureProposal => ({
    schema: 'mk8dx.flag-exposure-proposal.v1', status: 'unavailable', reason,
    gain, referenceId, top: [],
  });
  const pixels = group.width * group.height;
  if (group.width !== 55 || group.height !== 38 || group.ids.length !== 110
      || query.length !== pixels * 3 || group.rgb.length !== group.ids.length * pixels * 3) {
    throw new Error('Expected one result flag crop and 110 references');
  }
  if (shape.mode !== 'full_rgb_ncc' || !shape.top.length) return unavailable('no_pattern_rank');
  const index = group.ids.indexOf(shape.top[0].id);
  if (index < 0) return unavailable('unknown_pattern_reference');
  const observed = brightness(query, 0, group.width, group.height);
  const expected = brightness(group.rgb, index * pixels * 3, group.width, group.height);
  if (!(observed > .1) || !(expected > .1)) return unavailable('insufficient_brightness');
  const gain = Math.min(1.8, expected / observed);
  // A modest exposure difference is already covered by the unmodified rank.
  // An observed upper quartile below 80% of the pattern reference is material.
  if (gain < 1.25) return unavailable('exposure_within_normal_range', gain, shape.top[0].id);
  const corrected = Float32Array.from(query, (value) => Math.min(1, value * gain));
  const rank = matchIconTensor(corrected, group);
  const top = rank.top.map(({ id, score }) => ({ id, score }));
  let tricolorBand: FlagExposureProposal['tricolorBand'];
  if (shape.top[0].id === 'country.lu' && top[0]?.id === 'country.lu'
      && top.some((item) => item.id === 'country.nl')) {
    const nl = group.ids.indexOf('country.nl');
    const lu = group.ids.indexOf('country.lu');
    if (nl >= 0 && lu >= 0) {
      const observed = tricolorBlueGreen(query, 0, group.width);
      const nlReference = tricolorBlueGreen(group.rgb, nl * pixels * 3, group.width);
      const luReference = tricolorBlueGreen(group.rgb, lu * pixels * 3, group.width);
      const preferredId = Math.abs(observed - nlReference) < Math.abs(observed - luReference)
        ? 'country.nl' : 'country.lu';
      tricolorBand = { observed, nlReference, luReference, preferredId };
      if (preferredId === 'country.nl') {
        top.sort((a, b) => (a.id === 'country.nl' ? -1 : b.id === 'country.nl' ? 1 : 0));
      }
    }
  }
  return { schema: 'mk8dx.flag-exposure-proposal.v1', status: 'measured',
    reason: 'pattern_reference_exposure', gain, referenceId: shape.top[0].id,
    top, ...(tricolorBand ? { tricolorBand } : {}) };
}
