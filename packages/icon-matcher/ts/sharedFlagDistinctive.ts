/** Label-free second rank among three visually shortlisted flags.
 *
 * Mirrors Python distinctive_rank. It uses the channels that differ most
 * across these three reference images; acceptance remains a separate gate.
 */
import type { IconTensorGroup } from './sharedIconScorer';

export interface DistinctiveFlagCandidate {
  id: string;
  distance: number;
}

export function distinctiveFlagRank(queryRgb: Float32Array, references: IconTensorGroup,
  ids: string[]): DistinctiveFlagCandidate[] {
  const channels = references.width * references.height * 3;
  if (queryRgb.length !== channels || references.rgb.length !== references.ids.length * channels
      || ids.length !== 3 || new Set(ids).size !== 3) {
    throw new Error('Expected normalized RGB and three distinct flag references');
  }
  const indices = ids.map((id) => references.ids.indexOf(id));
  if (indices.some((index) => index < 0)) throw new Error('Unknown shortlisted flag');
  const distances = [0, 0, 0];
  let weightSum = 0;
  for (let channel = 0; channel < channels; channel++) {
    const values = indices.map((index) => references.rgb[index * channels + channel]);
    const weight = Math.max(...values) - Math.min(...values) + 0.01;
    weightSum += weight;
    for (let candidate = 0; candidate < 3; candidate++) {
      distances[candidate] += Math.abs(values[candidate] - queryRgb[channel]) * weight;
    }
  }
  return ids.map((id, index) => ({ id, distance: distances[index] / weightSum }))
    .sort((left, right) => left.distance - right.distance || ids.indexOf(left.id) - ids.indexOf(right.id));
}
