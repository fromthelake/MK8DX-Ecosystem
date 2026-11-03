/** Open Ghost loadout ranking on one source's selected icon crops.
 *
 * The frame's own tone anchor chooses the character arm. Each part keeps a
 * family from its own image/text evidence, then catalog relations restrict its
 * colour variants for the three same-frame character candidates. No label,
 * paired HDMI result or previous product decision becomes an accepted ID.
 */
import type { IconTensorGroup, IconTensorMatch } from './sharedIconScorer';
import { matchIconTensor } from './sharedIconScorer';
import { partRelationKey, type PartContextReferences } from './sharedPartContext';

export type GhostPartKind = 'bodies' | 'gliders';
export interface GhostLoadoutCandidate {
  characterId: string;
  characterScore: number;
  kartId: string;
  kartScore: number;
  gliderId: string;
  gliderScore: number;
  sumScore: number;
}

function checkQuery(query: Float32Array, group: IconTensorGroup): void {
  if (query.length !== group.width * group.height * 3
      || group.rgb.length !== group.ids.length * query.length
      || group.mask.length !== group.ids.length * group.width * group.height
      || group.count.length !== group.ids.length
      || group.families.length !== group.ids.length || !group.ids.length) {
    throw new Error('Incompatible Ghost crop and reference tensors');
  }
}

function referenceMean(group: IconTensorGroup, indices: readonly number[]): number {
  const pixels = group.width * group.height;
  let total = 0;
  let count = 0;
  for (const index of indices) {
    count += group.count[index];
    const maskBase = index * pixels;
    const rgbBase = index * pixels * 3;
    for (let pixel = 0; pixel < pixels; pixel++) {
      if (!group.mask[maskBase + pixel]) continue;
      const at = rgbBase + pixel * 3;
      total += group.rgb[at] + group.rgb[at + 1] + group.rgb[at + 2];
    }
  }
  return total / Math.max(count * 3, 1e-6);
}

function brighten(query: Float32Array, group: IconTensorGroup,
  indices: readonly number[], floorOne: boolean): { pixels: Float32Array; gain: number } {
  let total = 0;
  for (const value of query) total += value;
  const mean = total / query.length;
  const raw = referenceMean(group, indices) / Math.max(mean, 1e-4);
  const gain = floorOne ? Math.max(1, Math.max(.6, Math.min(2.6, raw)))
    : Math.max(.6, Math.min(2.6, raw));
  const pixels = new Float32Array(query.length);
  for (let i = 0; i < query.length; i++) {
    pixels[i] = Math.min(1, Math.fround(query[i] * Math.fround(gain)));
  }
  return { pixels, gain };
}

/** Prior Python `whole_floor1_shift` arm on the exact character crop. */
export function rankGhostCharacter(query: Float32Array, group: IconTensorGroup,
  mode: 'raw' | 'bounded_luminance' | 'digit_neutral_clahe_low_contrast'):
  { match: IconTensorMatch; luminanceGain: number } {
  checkQuery(query, group);
  if (mode === 'raw' || mode === 'digit_neutral_clahe_low_contrast') {
    return { match: matchIconTensor(query, group), luminanceGain: 1 };
  }
  const adjusted = brighten(query, group,
    group.ids.map((_, index) => index), true);
  return { match: matchIconTensor(adjusted.pixels, group),
    luminanceGain: adjusted.gain };
}

function relatedPart(query: Float32Array, group: IconTensorGroup, kind: GhostPartKind,
  characters: readonly string[], chosenFamily: string,
  context: PartContextReferences):
  { choices: { id: string; familyId: string; score: number }[]; luminanceGain: number } {
  checkQuery(query, group);
  if (!context.resultMembers.has(kind) || characters.length !== 3) {
    throw new Error('Expected three character candidates and catalog part context');
  }
  const bases = group.ids.filter((id, index) => id === group.families[index]);
  const allowed = new Set<string>();
  for (const character of characters) {
    for (const base of bases) {
      allowed.add(context.partForCharacter.get(partRelationKey(kind, base, character)) ?? base);
    }
  }
  const indices = group.ids.flatMap((id, index) => allowed.has(id) ? [index] : []);
  if (indices.length !== allowed.size || !indices.length) {
    throw new Error('Part relation outside pinned catalog');
  }
  const adjusted = brighten(query, group, indices, false);
  const byId = new Map(group.ids.map((id, index) => [id, index]));
  const pixels = group.width * group.height;
  const choices = characters.map((character) => {
    const id = context.partForCharacter.get(partRelationKey(kind, chosenFamily, character))
      ?? chosenFamily;
    const index = byId.get(id);
    if (index === undefined || group.families[index] !== chosenFamily) {
      throw new Error('Character relation left selected part family');
    }
    let distance = 0;
    const maskBase = index * pixels;
    const rgbBase = index * pixels * 3;
    for (let pixel = 0; pixel < pixels; pixel++) {
      if (!group.mask[maskBase + pixel]) continue;
      const at = pixel * 3;
      const ref = rgbBase + at;
      distance += Math.abs(group.rgb[ref] - adjusted.pixels[at]);
      distance += Math.abs(group.rgb[ref + 1] - adjusted.pixels[at + 1]);
      distance += Math.abs(group.rgb[ref + 2] - adjusted.pixels[at + 2]);
    }
    return { id, familyId: chosenFamily,
      score: 1 - distance / (group.count[index] * 3 + 1e-6) };
  });
  return { choices, luminanceGain: adjusted.gain };
}

export function rankGhostLoadouts(characterTop3: readonly { id: string; score: number }[],
  bodyQuery: Float32Array, bodyGroup: IconTensorGroup, bodyFamily: string,
  gliderQuery: Float32Array, gliderGroup: IconTensorGroup, gliderFamily: string,
  context: PartContextReferences):
  { top3: GhostLoadoutCandidate[]; bodyGain: number; gliderGain: number } {
  if (characterTop3.length !== 3 || characterTop3.some((item) => !Number.isFinite(item.score))) {
    throw new Error('Expected three scored same-frame characters');
  }
  const characters = characterTop3.map((item) => item.id);
  const body = relatedPart(bodyQuery, bodyGroup, 'bodies', characters, bodyFamily, context);
  const glider = relatedPart(gliderQuery, gliderGroup, 'gliders', characters,
    gliderFamily, context);
  const top3 = characterTop3.map((item, index) => {
    const kart = body.choices[index];
    const wing = glider.choices[index];
    return { characterId: item.id, characterScore: item.score,
      kartId: kart.id, kartScore: kart.score,
      gliderId: wing.id, gliderScore: wing.score,
      sumScore: item.score + kart.score + wing.score };
  }).sort((left, right) => right.sumScore - left.sumScore);
  return { top3, bodyGain: body.luminanceGain, gliderGain: glider.luminanceGain };
}
