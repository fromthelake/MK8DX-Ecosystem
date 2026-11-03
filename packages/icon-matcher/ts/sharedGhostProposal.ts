/** A named, reviewable Ghost choice from already recorded same-frame evidence.
 *
 * Match scores from different arms, text similarity and flag distance are kept
 * separately. None is a calibrated probability. This never accepts a product
 * ID and never reads the old product decision or a label.
 */

export type GhostProposalField = 'character' | 'kart' | 'wheel' | 'glider' | 'flag';

interface VisualTop { id: string; score: number }
interface VisualRead {
  top?: VisualTop[];
  acceptedId?: string | null;
  cropPixelSha256?: string;
  shape_rank_qa?: { mode: string; margin: number;
    cropPixelSha256: string; top: VisualTop[] } | null;
  flag_distinctive_qa?: { top?: { id: string; distance: number }[] } | null;
}
interface Entry {
  shared_icon_qa?: VisualRead;
  part_text_qa?: {
    clue?: { fuzzy?: number } | null;
    chosen?: { id?: string | null; status?: string } | null;
  } | null;
}
interface Loadout {
  characterId: string; characterScore: number;
  kartId: string; kartScore: number;
  gliderId: string; gliderScore: number;
}
export interface GhostProposalOwner {
  joint_loadout_qa?: {
    mode?: 'raw' | 'bounded_luminance' | 'digit_neutral_clahe_low_contrast';
    status?: string;
    top3Loadouts?: Loadout[];
    characterTop3?: VisualTop[];
  } | null;
  character?: Entry;
  kart?: Entry;
  wheel?: Entry;
  glider?: Entry;
  flag?: Entry;
}
export interface GhostProposalCandidate {
  id: string;
  basis: 'raw_accepted' | 'joint' | 'partial_character' | 'tire_text'
    | 'tire_text_low_shape' | 'flag_distinctive' | 'raw_visual'
    | 'shape_ncc' | 'shape_sibling_refine';
  matchScore: number | null;
  textFuzzy: number | null;
  distinctiveDistance: number | null;
  shapeScore?: number | null;
}
export interface GhostFieldProposal {
  status: 'proposed' | 'unavailable';
  proposedId: string | null;
  acceptedId: null;
  reviewRequired: boolean;
  cropPixelSha256: string | null;
  rawAcceptedId: string | null;
  top: GhostProposalCandidate[];
}
export interface GhostProposal {
  schema: 'mk8dx.web-ghost-field-proposal.v2';
  mode: string | null;
  fields: Record<GhostProposalField, GhostFieldProposal>;
}

function makeField(entry: Entry | undefined,
  preferred: readonly GhostProposalCandidate[]): GhostFieldProposal {
  const raw = entry?.shared_icon_qa;
  const candidates: GhostProposalCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of [...preferred,
    ...(raw?.top ?? []).map((item): GhostProposalCandidate => ({ id: item.id,
      basis: 'raw_visual', matchScore: item.score, textFuzzy: null,
      distinctiveDistance: null }))]) {
    if (!candidate.id || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    candidates.push(candidate);
    if (candidates.length === 3) break;
  }
  return { status: candidates.length ? 'proposed' : 'unavailable',
    proposedId: candidates[0]?.id ?? null, acceptedId: null,
    reviewRequired: candidates.length > 0,
    cropPixelSha256: raw?.cropPixelSha256 ?? null,
    rawAcceptedId: raw?.acceptedId ?? null, top: candidates };
}

export function composeGhostProposal(owner: GhostProposalOwner): GhostProposal {
  const joint = owner.joint_loadout_qa;
  const mode = joint?.mode ?? null;
  const loadouts = joint?.status === 'ranked' ? joint.top3Loadouts ?? [] : [];
  const fields = {} as Record<GhostProposalField, GhostFieldProposal>;
  for (const field of ['character', 'kart', 'glider'] as const) {
    const entry = owner[field];
    const raw = entry?.shared_icon_qa;
    const choices: GhostProposalCandidate[] = [];
    if (mode === 'raw' && raw?.acceptedId) {
      choices.push({ id: raw.acceptedId, basis: 'raw_accepted',
        matchScore: raw.top?.find((item) => item.id === raw.acceptedId)?.score ?? null,
        textFuzzy: null, distinctiveDistance: null });
    }
    const idKey = field === 'character' ? 'characterId'
      : field === 'kart' ? 'kartId' : 'gliderId';
    const scoreKey = field === 'character' ? 'characterScore'
      : field === 'kart' ? 'kartScore' : 'gliderScore';
    for (const item of loadouts) {
      choices.push({ id: item[idKey], basis: 'joint', matchScore: item[scoreKey],
        textFuzzy: null, distinctiveDistance: null });
    }
    if (field === 'character') {
      for (const item of joint?.characterTop3 ?? []) {
        choices.push({ id: item.id, basis: 'partial_character',
          matchScore: item.score, textFuzzy: null, distinctiveDistance: null });
      }
    }
    fields[field] = makeField(entry, choices);
  }
  const tireVisual = owner.wheel?.shared_icon_qa;
  const tireShape = tireVisual?.shape_rank_qa?.cropPixelSha256 === tireVisual?.cropPixelSha256
    && tireVisual?.shape_rank_qa?.mode === 'masked_gray_ncc'
    ? tireVisual.shape_rank_qa : null;
  const tireText = owner.wheel?.part_text_qa;
  const tireId = tireText?.chosen?.status === 'accepted' ? tireText.chosen.id : null;
  const tireChoices: GhostProposalCandidate[] = [];
  // A weak shape correlation is evidence of a poor optical crop, not absence
  // of a tire. Keep a strong independent row-text clue first for review.
  if (tireShape && tireShape.top.length && tireShape.top[0].score < 0.55 && tireId) {
    tireChoices.push({ id: tireId, basis: 'tire_text_low_shape',
      matchScore: tireVisual?.top?.find((item) => item.id === tireId)?.score ?? null,
      textFuzzy: tireText?.clue?.fuzzy ?? null, distinctiveDistance: null,
      shapeScore: tireShape.top.find((item) => item.id === tireId)?.score ?? null });
  }
  const closeShapePair = tireShape && tireShape.margin <= 0.02
    ? tireShape.top.slice(0, 2) : [];
  const siblingId = [tireVisual?.acceptedId, tireId].find((id) =>
    id && closeShapePair.some((item) => item.id === id));
  if (siblingId) {
    tireChoices.push({ id: siblingId, basis: 'shape_sibling_refine',
      matchScore: tireVisual?.top?.find((item) => item.id === siblingId)?.score ?? null,
      textFuzzy: siblingId === tireId ? tireText?.clue?.fuzzy ?? null : null,
      distinctiveDistance: null,
      shapeScore: closeShapePair.find((item) => item.id === siblingId)?.score ?? null });
  }
  for (const item of tireShape?.top ?? []) {
    tireChoices.push({ id: item.id, basis: 'shape_ncc', matchScore: null,
      textFuzzy: null, distinctiveDistance: null, shapeScore: item.score });
  }
  if (tireId) {
    tireChoices.push({ id: tireId, basis: 'tire_text',
      matchScore: tireVisual?.top?.find((item) => item.id === tireId)?.score ?? null,
      textFuzzy: tireText?.clue?.fuzzy ?? null, distinctiveDistance: null });
  }
  fields.wheel = makeField(owner.wheel, tireChoices);

  const flag = owner.flag?.shared_icon_qa;
  const flagShape = flag?.shape_rank_qa?.cropPixelSha256 === flag?.cropPixelSha256
    && flag?.shape_rank_qa?.mode === 'full_rgb_ncc' ? flag.shape_rank_qa : null;
  const flagChoices: GhostProposalCandidate[] = [];
  for (const item of flagShape?.top ?? []) {
    flagChoices.push({ id: item.id, basis: 'shape_ncc', matchScore: null,
      textFuzzy: null, distinctiveDistance: null, shapeScore: item.score });
  }
  if (flag?.acceptedId) {
    flagChoices.push({ id: flag.acceptedId, basis: 'raw_accepted',
      matchScore: flag.top?.find((item) => item.id === flag.acceptedId)?.score ?? null,
      textFuzzy: null, distinctiveDistance: null });
  }
  for (const item of flag?.flag_distinctive_qa?.top ?? []) {
    flagChoices.push({ id: item.id, basis: 'flag_distinctive',
      matchScore: flag?.top?.find((raw) => raw.id === item.id)?.score ?? null,
      textFuzzy: null, distinctiveDistance: item.distance });
  }
  fields.flag = makeField(owner.flag, flagChoices);
  return { schema: 'mk8dx.web-ghost-field-proposal.v2', mode, fields };
}
