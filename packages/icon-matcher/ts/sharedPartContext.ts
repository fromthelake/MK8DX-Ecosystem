/** Source-independent part text and character evidence after visual ranking.
 *
 * The caller supplies catalog relationships from the same pinned Clean Assets
 * version as the visual references. Preserve the original visual top three.
 * This mirrors the present-field branch of Python combine_part; presence is
 * decided before calling this function.
 */
import type { VisualFieldRead } from './sharedIconFieldResult';
import type { CharacterDecision } from './sharedCharacterContext';

export type PartKind = 'bodies' | 'gliders' | 'tires';
export interface PartTextClue { id: string; fuzzy: number; margin: number }
export interface PartDecision {
  id: string | null;
  familyId: string | null;
  status: 'accepted' | 'unknown' | 'family_only' | 'conflict';
  evidence: string[];
  visualTop1: string;
  /** A colour to propose for review when id is null (the glider colour that
   * follows the character, issue #99); never an accepted value on its own. */
  suggestedId: string | null;
}
export interface PartContextReferences {
  familyById: ReadonlyMap<string, string>;
  resultMembers: ReadonlyMap<PartKind, readonly { id: string; familyId: string }[]>;
  partForCharacter: ReadonlyMap<string, string>;
  tireByIndex: ReadonlyMap<number, string>;
}

export function partRelationKey(kind: PartKind, familyId: string, characterId: string): string {
  return `${kind}\u0000${familyId}\u0000${characterId}`;
}

/** A numeric clue ID (tyre row index): ASCII 0-9 only, in every runtime. OCR text is
 * folded to ASCII digits where it is normalized (sharedNameMatch.normalizeName). */
export function asciiIndex(text: string): boolean {
  return /^[0-9]+$/.test(text);
}

function colourFamily(refs: PartContextReferences, kind: PartKind, family: string): boolean {
  return refs.resultMembers.get(kind)!.filter((item) => item.familyId === family).length > 1;
}

/** The catalog colour of this glider family for this character, if the catalog links them. */
function gliderRelation(refs: PartContextReferences, family: string,
  characterId: string | null | undefined): string | null {
  const relation = characterId
    ? refs.partForCharacter.get(partRelationKey('gliders', family, characterId)) : undefined;
  return relation && refs.familyById.get(relation) === family ? relation : null;
}

export function combinePart(kind: PartKind, visual: VisualFieldRead,
  character: CharacterDecision, clue: PartTextClue | null,
  refs: PartContextReferences, tireTextTop3Guard = false): PartDecision {
  if (visual.kind !== kind || !visual.top.length || visual.top[0].id !== visual.top1Id
      || (visual.status === 'accepted') !== (visual.acceptedId !== null)
      || !refs.resultMembers.has(kind)) {
    throw new Error('Expected a present part visual read and catalog');
  }
  const top = visual.top[0];
  let family = top.familyId;
  const evidence = ['visual_family'];
  const strong = clue !== null && Number.isFinite(clue.fuzzy) && Number.isFinite(clue.margin)
    && clue.fuzzy >= 0.85 && clue.margin >= 0.08;
  const textId = kind === 'tires' && clue && asciiIndex(clue.id)
    ? refs.tireByIndex.get(Number(clue.id)) : clue?.id;
  const textFamily = textId ? refs.familyById.get(textId) : undefined;
  if (clue && !strong && Number.isFinite(clue.fuzzy) && Number.isFinite(clue.margin)
      && clue.fuzzy >= 0.65 && clue.margin >= 0.15
      && textFamily && textFamily !== top.familyId) {
    return { id: null, familyId: top.familyId, status: 'conflict',
      evidence: ['visual_text_conflict_review'], visualTop1: top.id, suggestedId: null };
  }
  if (kind === 'tires' && strong && clue && asciiIndex(clue.id)) {
    const tire = refs.tireByIndex.get(Number(clue.id));
    if (tire && tireTextTop3Guard && !visual.top.slice(0, 3).some((candidate) => candidate.id === tire)) {
      return { id: null, familyId: family, status: 'conflict',
        evidence: ['tire_text_outside_visual_top3'], visualTop1: top.id, suggestedId: null };
    }
    if (tire) return { id: tire, familyId: tire, status: 'accepted',
      evidence: ['tire_text'], visualTop1: top.id, suggestedId: null };
  }
  if (kind === 'tires' && clue && asciiIndex(clue.id)) {
    const tire = refs.tireByIndex.get(Number(clue.id));
    if (tire === top.id && clue.fuzzy >= 0.70 && clue.margin >= 0.30
        && visual.score >= 0.80 && visual.margin >= 0.01) {
      return { id: tire, familyId: tire, status: 'accepted',
        evidence: ['visual_medium_tire_text'], visualTop1: top.id, suggestedId: null };
    }
  }
  if (strong && textFamily) {
    family = textFamily;
    evidence.splice(0, evidence.length, ...(family !== top.familyId
      ? ['exact_text_family'] : ['visual_family', 'text_family']));
  }
  let chosen: string | null = family === top.familyId ? visual.acceptedId : null;
  const strongVisualVariant = visual.status === 'accepted' && family === top.familyId;
  const characterAccepted = Boolean(character.id) && character.status === 'accepted';
  // Glider colour follows the character (issue #99): the catalog colour of an
  // accepted character, or of the suggested character for a review proposal.
  const colour = kind === 'gliders'
    ? gliderRelation(refs, family, characterAccepted ? character.id : character.visualTop1) : null;
  if (kind === 'gliders' && characterAccepted && colour && strongVisualVariant && colour !== chosen) {
    if (visual.top.slice(0, 3).some((candidate) => candidate.id === colour)) {
      // A close colour in the visual top three: the catalog decides.
      chosen = colour;
      evidence.push('character_part_top3_variant');
    } else {
      // The icon clearly shows a colour this character cannot have. Keep the
      // catalog colour as the proposal; the clash usually means the character
      // is wrong, so the field needs review.
      return { id: null, familyId: family, status: 'conflict',
        evidence: [...evidence, 'character_colour_conflict_review'], visualTop1: top.id,
        suggestedId: colour };
    }
  }
  if ((kind === 'bodies' || kind === 'gliders') && character.id && !strongVisualVariant
      && (visual.score >= 0.80 || strong)) {
    const relation = kind === 'gliders' ? (characterAccepted ? colour : null)
      : refs.partForCharacter.get(partRelationKey(kind, family, character.id));
    if (relation) {
      if (kind === 'gliders' && !strong
          && visual.familyMargin !== undefined && visual.familyMargin !== null
          && visual.familyMargin < 0.02) {
        evidence.push('weak_family_relation_review');
      } else {
        chosen = relation;
        evidence.push('character_part_relation');
      }
    }
  }
  if (chosen === null && strong) {
    const members = refs.resultMembers.get(kind)!.filter((item) => item.familyId === family);
    if (members.length === 1) {
      chosen = members[0].id;
      evidence.push('unique_text_family');
    } else if (family === top.familyId && visual.score >= 0.75 && visual.margin >= 0.01) {
      chosen = top.id;
      evidence.push('text_supported_visual_variant');
    }
  }
  const suggestion = kind === 'gliders' && chosen === null ? colour : null;
  if (kind === 'gliders' && chosen !== null && !characterAccepted && colourFamily(refs, kind, family)) {
    // The family is readable and carries the stats, but an unaccepted
    // character cannot settle its colour: accept the family only and propose
    // the suggested character's catalog colour, else the icon's.
    return { id: null, familyId: family, status: 'family_only',
      evidence: [...evidence, 'glider_colour_needs_character',
        ...(colour ? ['character_colour_suggestion'] : [])],
      visualTop1: top.id, suggestedId: colour };
  }
  if (suggestion) evidence.push('character_colour_suggestion');
  if (chosen === null && strong && clue?.id === family) {
    return { id: null, familyId: family, status: 'family_only',
      evidence, visualTop1: top.id, suggestedId: suggestion };
  }
  return { id: chosen, familyId: chosen ? family : null,
    status: chosen ? 'accepted' : 'unknown', evidence, visualTop1: top.id, suggestedId: suggestion };
}
