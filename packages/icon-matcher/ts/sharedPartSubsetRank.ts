/** Open body/glider ranking: catalog family first, character-related colour next.
 *
 * The characters are same-frame recognizer candidates, never owner labels. A
 * family keeps its base asset or the variant explicitly related to each
 * character. The raw visual read and product acceptance stay separate.
 */
import type { IconTensorGroup } from './sharedIconScorer';
import { partRelationKey, type PartContextReferences } from './sharedPartContext';

export type SubsetPartKind = 'bodies' | 'gliders';
export interface SubsetPartCandidate { id: string; familyId: string; score: number }
export interface SubsetPartRank {
  schema: 'mk8dx.part-subset-rank.v1';
  kind: SubsetPartKind;
  characters: string[];
  subsetSize: number;
  luminanceGain: number;
  top1Id: string;
  score: number;
  margin: number;
  familyMargin: number | null;
  top3: SubsetPartCandidate[];
  familyTop3: { familyId: string; score: number }[];
  variantTop3: SubsetPartCandidate[];
  acceptedId: null;
}

export function rankPartSubset(queryRgb: Float32Array, group: IconTensorGroup,
  kind: SubsetPartKind, characterCandidates: readonly string[],
  context: PartContextReferences): SubsetPartRank {
  const pixels = group.width * group.height;
  const n = group.ids.length;
  if (queryRgb.length !== pixels * 3 || group.rgb.length !== n * pixels * 3
      || group.mask.length !== n * pixels || group.count.length !== n
      || group.families.length !== n || n < 2 || !context.resultMembers.has(kind)) {
    throw new Error('Incompatible part subset reference group');
  }
  const characters = [...new Set(characterCandidates)].slice(0, 3);
  if (!characters.length || characters.some((id) => !context.familyById.has(id)
      && !/^character\.mii_(light|medium|heavy)$/.test(id))) {
    throw new Error('Expected same-frame catalog character candidates');
  }
  const bases = group.ids.filter((id, index) => id === group.families[index]);
  const allowed = new Set<string>();
  for (const character of characters) {
    for (const base of bases) {
      allowed.add(context.partForCharacter.get(partRelationKey(kind, base, character)) ?? base);
    }
  }
  const indices = group.ids.flatMap((id, index) => allowed.has(id) ? [index] : []);
  if (indices.length !== allowed.size || indices.length < 2) {
    throw new Error('Part relation outside pinned catalog');
  }
  let refSum = 0;
  let refCount = 0;
  for (const index of indices) {
    const rgbBase = index * pixels * 3;
    const maskBase = index * pixels;
    refCount += group.count[index];
    for (let pixel = 0; pixel < pixels; pixel++) {
      if (!group.mask[maskBase + pixel]) continue;
      const offset = rgbBase + pixel * 3;
      refSum += group.rgb[offset] + group.rgb[offset + 1] + group.rgb[offset + 2];
    }
  }
  let querySum = 0;
  for (const value of queryRgb) querySum += value;
  const refMean = refSum / Math.max(refCount * 3, 1e-6);
  const queryMean = querySum / queryRgb.length;
  const gain = Math.max(.6, Math.min(2.6, refMean / Math.max(queryMean, 1e-4)));
  const adjusted = new Float32Array(queryRgb.length);
  for (let i = 0; i < queryRgb.length; i++) {
    adjusted[i] = Math.min(1, Math.fround(queryRgb[i] * Math.fround(gain)));
  }
  const scores = new Float32Array(n);
  for (const index of indices) {
    const rgbBase = index * pixels * 3;
    const maskBase = index * pixels;
    let distance = 0;
    for (let pixel = 0; pixel < pixels; pixel++) {
      if (!group.mask[maskBase + pixel]) continue;
      const queryOffset = pixel * 3;
      const refOffset = rgbBase + queryOffset;
      distance += Math.abs(group.rgb[refOffset] - adjusted[queryOffset]);
      distance += Math.abs(group.rgb[refOffset + 1] - adjusted[queryOffset + 1]);
      distance += Math.abs(group.rgb[refOffset + 2] - adjusted[queryOffset + 2]);
    }
    scores[index] = 1 - distance / (group.count[index] * 3 + 1e-6);
  }
  const order = indices.sort((left, right) => scores[right] - scores[left] || left - right);
  const top = (index: number): SubsetPartCandidate => ({ id: group.ids[index],
    familyId: group.families[index], score: scores[index] });
  const distinct = new Set<string>();
  const familyTop3: { familyId: string; score: number }[] = [];
  for (const index of order) {
    const familyId = group.families[index];
    if (distinct.has(familyId)) continue;
    distinct.add(familyId);
    familyTop3.push({ familyId, score: scores[index] });
    if (familyTop3.length === 3) break;
  }
  const winnerFamily = group.families[order[0]];
  const variantTop3 = order.filter((index) => group.families[index] === winnerFamily)
    .slice(0, 3).map(top);
  return { schema: 'mk8dx.part-subset-rank.v1', kind, characters,
    subsetSize: order.length, luminanceGain: gain,
    top1Id: group.ids[order[0]], score: scores[order[0]],
    margin: scores[order[0]] - scores[order[1]],
    familyMargin: familyTop3.length > 1 ? familyTop3[0].score - familyTop3[1].score : null,
    top3: order.slice(0, 3).map(top), familyTop3, variantTop3, acceptedId: null };
}
