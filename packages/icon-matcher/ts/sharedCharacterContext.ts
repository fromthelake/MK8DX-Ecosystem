/** Source-independent character text evidence after a visual field read.
 *
 * Keep the visual top three and crop provenance separately. This mirrors the
 * present-field branch of Python combine_character; presence is upstream.
 */
import type { VisualFieldRead } from './sharedIconFieldResult';

export interface CharacterTextClue {
  id: string;
  fuzzy: number;
  margin?: number;
}

export interface CharacterDecision {
  id: string | null;
  familyId: string | null;
  status: 'accepted' | 'unknown' | 'conflict';
  evidence: string[];
  visualTop1: string;
}

export function combineCharacter(visual: VisualFieldRead, clue: CharacterTextClue | null,
  familyById: ReadonlyMap<string, string>): CharacterDecision {
  if (visual.kind !== 'characters' || !visual.top.length
      || visual.top[0].id !== visual.top1Id
      || (visual.status === 'accepted') !== (visual.acceptedId !== null)) {
    throw new Error('Expected a present character visual read');
  }
  const top = visual.top[0];
  const clueFamily = clue ? familyById.get(clue.id) : undefined;
  const strong = clue && Number.isFinite(clue.fuzzy)
    && Number.isFinite(clue.margin ?? 1)
    && clue.fuzzy >= 0.85 && (clue.margin ?? 1) >= 0.08;
  const observedFamily = visual.acceptedId ? top.familyId : null;
  if (strong && clueFamily === top.familyId) {
    if (visual.status === 'accepted' && clue.id !== top.id
        && clue.id !== top.familyId && clue.fuzzy < 1) {
      // Approximate OCR cannot replace an accepted different colour and then
      // propagate that colour through a character-part catalog relation.
      return { id: null, familyId: top.familyId, status: 'conflict',
        evidence: ['visual_name_variant_conflict'], visualTop1: top.id };
    }
    if (clue.id === top.familyId && top.id !== top.familyId) {
      const base = visual.top.find((candidate) => candidate.id === clue.id);
      if (base && visual.score < 0.80 && top.score - base.score <= 0.015) {
        return { id: clue.id, familyId: top.familyId, status: 'accepted',
          evidence: ['name_base_close_visual'], visualTop1: top.id };
      }
      return { id: visual.acceptedId, familyId: observedFamily, status: visual.status,
        evidence: ['visual', 'name_family'], visualTop1: top.id };
    }
    return { id: clue.id, familyId: top.familyId, status: 'accepted',
      evidence: ['visual_family', 'exact_name'], visualTop1: top.id };
  }
  if (strong && clueFamily) {
    if (clue.fuzzy >= 0.90 && (visual.score < 0.85 || visual.margin < 0.05)) {
      return { id: clue.id, familyId: clueFamily, status: 'accepted',
        evidence: ['exact_name_cross_family', 'visual_disagreement'], visualTop1: top.id };
    }
    return { id: null, familyId: null, status: 'conflict',
      evidence: ['visual_name_conflict'], visualTop1: top.id };
  }
  return { id: visual.acceptedId, familyId: observedFamily, status: visual.status,
    evidence: ['visual'], visualTop1: top.id };
}
