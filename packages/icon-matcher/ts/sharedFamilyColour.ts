/** Optional, alpha-limited OKLab rank within the first visual character family.
 * Mirrors Python rank_family_colour_space(metric='oklab'). It only proposes an
 * order; the primary score, other families and automatic acceptance remain.
 */
import type { IconTensorGroup, IconTensorMatch } from './sharedIconScorer';

export interface FamilyColourRank {
  schema: 'mk8dx.family-colour-rank.v1';
  method: 'oklab';
  familyId: string;
  status: 'measured' | 'insufficient_cutout' | 'insufficient_colour';
  observedPixels: number;
  top: { id: string; distance: number }[];
}

function oklab(rgb: Float32Array, at: number): [number, number, number] {
  const linear = (value: number) => value <= .04045 ? value / 12.92
    : ((value + .055) / 1.055) ** 2.4;
  const r = linear(rgb[at]);
  const g = linear(rgb[at + 1]);
  const b = linear(rgb[at + 2]);
  const l = Math.cbrt(Math.max(0, .4122214708 * r + .5363325363 * g + .0514459929 * b));
  const m = Math.cbrt(Math.max(0, .2119034982 * r + .6806995451 * g + .1073969566 * b));
  const s = Math.cbrt(Math.max(0, .0883024619 * r + .2817188376 * g + .6299787005 * b));
  return [1.5 * (.2104542553 * l + .7936177850 * m - .0040720468 * s),
    2.5 * (1.9779984951 * l - 2.4285922050 * m + .4505937099 * s),
    2.5 * (.0259040371 * l + .7827717662 * m - .8086757660 * s)];
}

export function rankCharacterFamilyColour(query: Float32Array, group: IconTensorGroup,
  primary: IconTensorMatch, minPixels = 24): FamilyColourRank | null {
  const { width, height } = group;
  const pixels = width * height;
  if (query.length !== pixels * 3 || group.rgb.length !== group.ids.length * pixels * 3
      || group.mask.length !== group.ids.length * pixels || group.families.length !== group.ids.length
      || !Number.isInteger(minPixels) || minPixels < 1 || !primary.top.length) {
    throw new Error('Incompatible character colour tensors');
  }
  const familyId = primary.top[0].familyId;
  const members = group.ids.map((_, index) => index)
    .filter((index) => group.families[index] === familyId);
  if (members.length < 2) return null;
  const result = (status: FamilyColourRank['status'], observedPixels: number,
    top: FamilyColourRank['top'] = []): FamilyColourRank => ({
    schema: 'mk8dx.family-colour-rank.v1', method: 'oklab', familyId,
    status, observedPixels, top,
  });
  // OpenCV's 3x3 erosion ignores its default outside border for a binary
  // alpha mask. Keep only pixels covered by every family variant.
  const common: number[] = [];
  const spreads: number[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let covered = true;
    for (const member of members) {
      for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1) && covered; yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) {
          if (group.mask[member * pixels + yy * width + xx] === 0) {
            covered = false;
            break;
          }
        }
      }
      if (!covered) break;
    }
    if (!covered) continue;
    const at = y * width + x;
    let spread = 0;
    for (let channel = 0; channel < 3; channel++) {
      const values = members.map((member) => group.rgb[(member * pixels + at) * 3 + channel]);
      spread = Math.max(spread, Math.max(...values) - Math.min(...values));
    }
    common.push(at);
    spreads.push(spread);
  }
  if (common.length < minPixels) return result('insufficient_cutout', common.length);
  const orderedSpread = [...spreads].sort((a, b) => a - b);
  const position = (orderedSpread.length - 1) * .85;
  const lower = Math.floor(position);
  const cutoff = orderedSpread[lower]
    + (orderedSpread[Math.ceil(position)] - orderedSpread[lower]) * (position - lower);
  const area = common.filter((_, index) => spreads[index] >= cutoff);
  if (area.length < minPixels) return result('insufficient_colour', area.length);
  const [dx, dy] = primary.offset;
  const distances = members.map((member) => {
    let sum = 0;
    for (const pixel of area) {
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      const sourceX = Math.max(0, Math.min(width - 1, x - dx));
      const sourceY = Math.max(0, Math.min(height - 1, y - dy));
      const observed = oklab(query, (sourceY * width + sourceX) * 3);
      const reference = oklab(group.rgb, (member * pixels + pixel) * 3);
      sum += Math.abs(reference[0] - observed[0])
        + Math.abs(reference[1] - observed[1]) + Math.abs(reference[2] - observed[2]);
    }
    return { id: group.ids[member], distance: sum / (area.length * 3) };
  });
  distances.sort((a, b) => a.distance - b.distance);
  return result('measured', area.length, distances);
}
