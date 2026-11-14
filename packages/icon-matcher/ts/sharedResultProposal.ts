/** Opt-in result-screen decision from the shared reads on this frame.
 *
 * The selected visual top three and its crop stay intact. A separate name or
 * part-text decision may change the proposed ID; its text similarity is not a
 * calibrated visual score. No old product ID or truth label enters this path.
 */
import type { VisualFieldRead } from './sharedIconFieldResult';
import type { FamilyColourRank } from './sharedFamilyColour';
import type { FlagBandRatio } from './sharedFlagBandRatio';
import { miiSuggestion, type OpenSetMode } from './sharedOpenSet';

export type ResultField = 'character' | 'kart' | 'wheel' | 'glider' | 'flag';
type Decision = { id: string | null; familyId?: string | null;
  status: string; evidence?: string[]; suggestedId?: string | null };
type Context = { chosen?: Decision | null; clue?: { fuzzy?: number } | null;
  chosenBasis?: string; cropPixelSha256?: string };
type ReadWithDistinctive = VisualFieldRead & { flag_distinctive_qa?: {
  cropPixelSha256: string; top: { id: string; distance: number }[] } | null;
  photometric_qa?: { schema: string; status: string; blueClipped?: boolean } | null;
  shape_rank_qa?: { mode: string; cropPixelSha256: string;
    top: { id: string; score: number }[] } | null;
  flag_tricolor_qa?: { schema: 'mk8dx.flag-tricolor-evidence.v1';
    status: 'measured' | 'unavailable'; cropPixelSha256: string;
    acceptedId: string | null; proposalId?: string; reason?: string;
    proposalShapeScore?: number } | null;
  flag_exposure_qa?: { schema: 'mk8dx.flag-exposure-proposal.v1';
    status: 'measured' | 'unavailable'; cropPixelSha256: string;
    gain: number | null; top: { id: string; score: number }[] } | null;
  flag_band_ratio_qa?: (FlagBandRatio & { cropPixelSha256: string }) | null;
  family_colour_qa?: (FamilyColourRank & { cropPixelSha256: string }) | null };
type Entry = Record<string, unknown>;
export type ResultProposalOwner = Partial<Record<ResultField, Entry>>;

export interface ResultProposalCandidate {
  id: string;
  matchScore: number | null;
  textFuzzy: number | null;
  distinctiveDistance: number | null;
  basis: 'context' | 'visual' | 'distinctive' | 'family_colour' | 'shape_ncc' | 'exposure' | 'band_ratio' | 'open_set';
  familyColourDistance?: number;
  shapeScore?: number;
  exposureScore?: number;
}
export interface ResultFieldProposal {
  status: 'accepted' | 'proposed' | 'unavailable';
  proposedId: string | null;
  /** Initial user-editable choice, including a choice that needs review. */
  selectedId: string | null;
  acceptedId: string | null;
  proposedFamilyId: string | null;
  reviewRequired: boolean;
  cropPixelSha256: string | null;
  selectedCropPixelSha256: string | null;
  catalogSha256: string | null;
  contextStatus: string | null;
  evidence: string[];
  top: ResultProposalCandidate[];
  visualTop3: { id: string; familyId: string; score: number }[];
  familyColour: (FamilyColourRank & { cropPixelSha256: string }) | null;
  /** A character without a clear winner: "Mii" proposed or offered beside the best match. */
  openSet?: { id: string; label: string; mode: OpenSetMode; score: number; familyMargin: number | null };
}
export interface ResultProposal {
  schema: 'mk8dx.web-result-field-proposal.v1';
  fields: Record<ResultField, ResultFieldProposal>;
}

export interface NamedResultChoice {
  id: string;
  label: string;
  matchScore: number | null;
  shapeScore?: number;
  exposureScore?: number;
  reviewRequired: boolean;
  alternatives: { id: string; label: string; matchScore: number | null;
    shapeScore?: number; exposureScore?: number }[];
}

/** A present matched field keeps a named choice even when acceptance is held.
 * The caller resolves localized Clean Assets names; matchScore is not a
 * calibrated probability. Absence remains a separate upstream decision.
 */
export function nameResultChoice(field: ResultFieldProposal,
  nameOf: (id: string) => string): NamedResultChoice | null {
  if (!field.proposedId) return null;
  const name = (id: string): string => {
    const value = nameOf(id).trim();
    if (!value) throw new Error(`Missing asset name: ${id}`);
    return value;
  };
  const first = field.top.find((candidate) => candidate.id === field.proposedId);
  if (!first) throw new Error('Named result choice missing from candidate list');
  return { id: field.proposedId,
    label: name(field.proposedId) + (field.reviewRequired ? '?' : ''),
    matchScore: first.matchScore,
    ...(first.shapeScore === undefined ? {} : { shapeScore: first.shapeScore }),
    ...(first.exposureScore === undefined ? {} : { exposureScore: first.exposureScore }),
    reviewRequired: field.reviewRequired,
    alternatives: field.top.filter((candidate) => candidate.id !== field.proposedId)
      .slice(0, 2).map((candidate) => ({ id: candidate.id,
        label: name(candidate.id), matchScore: candidate.matchScore,
        ...(candidate.shapeScore === undefined ? {} : { shapeScore: candidate.shapeScore }),
        ...(candidate.exposureScore === undefined ? {} : { exposureScore: candidate.exposureScore }) })) };
}

const NL_LU_GAP = 0.05;
const BAND_RATIO_GUARD = true;

/** NL and LU differ only in the tone of their blue band. The measured blue to
 * red ratio settles a proposed NL or LU, or keeps it under review when the tone
 * lies between the two flags. */
function bandRatioDecision(field: ResultField, visual: ReadWithDistinctive | undefined,
  out: ResultFieldProposal): ResultFieldProposal {
  const band = visual?.flag_band_ratio_qa;
  if (!(BAND_RATIO_GUARD && field === 'flag' && band?.schema === 'mk8dx.flag-band-ratio.v1'
    && band.status === 'measured' && band.cropPixelSha256 === visual?.cropPixelSha256
    && (out.proposedId === 'country.nl' || out.proposedId === 'country.lu'))) return out;
  const decision = band.decisionId;
  if (decision !== 'country.nl' && decision !== 'country.lu') {
    return { ...out, status: 'proposed', acceptedId: null, reviewRequired: true,
      evidence: [...out.evidence, 'flag_band_ratio_between'] };
  }
  const first = out.top.find((candidate) => candidate.id === decision)
    ?? { id: decision, matchScore: null, textFuzzy: null, distinctiveDistance: null, basis: 'band_ratio' as const };
  return { ...out, status: 'accepted', proposedId: decision, selectedId: decision, acceptedId: decision,
    proposedFamilyId: decision, reviewRequired: false,
    top: [first, ...out.top.filter((candidate) => candidate.id !== decision)].slice(0, 3),
    evidence: [...out.evidence, 'flag_band_ratio'] };
}

/** LU's distinctive distance minus NL's when NL ranks first (LU absent: infinite). */
function luGap(top: { id: string; distance: number }[] | null): number {
  if (!top || top[0].id !== 'country.nl') return -Infinity;
  const lu = top.find((item) => item.id === 'country.lu');
  return lu ? lu.distance - top[0].distance : Infinity;
}

function composeField(field: ResultField, entry: Entry | undefined): ResultFieldProposal {
  const asVisual = (value: unknown): ReadWithDistinctive | undefined =>
    value && typeof value === 'object'
      && (value as Partial<VisualFieldRead>).schema === 'mk8dx.visual-field-read.v1'
      ? value as ReadWithDistinctive : undefined;
  const selected = asVisual(entry?.shared_icon_qa);
  const slot = asVisual(entry?.character_slot_qa);
  const tireWindow = asVisual(entry?.tire_window_qa);
  const context = (field === 'character' ? entry?.character_text_qa
    : field === 'flag' ? undefined : entry?.part_text_qa) as Context | undefined;
  const read = field === 'character' && context?.chosenBasis === 'slot'
    && slot
    ? slot
    : field === 'wheel' && context?.cropPixelSha256
      && tireWindow?.cropPixelSha256 === context.cropPixelSha256
      ? tireWindow : selected;
  const expectedKind = { character: 'characters', kart: 'bodies', wheel: 'tires',
    glider: 'gliders', flag: 'flags' } as const;
  // The Select-a-Ghost panel reads its character with the ghost_select
  // references; every other field, and every result-card field, with result.
  const valid = read?.schema === 'mk8dx.visual-field-read.v1'
    && (read.profile === 'result' || (field === 'character' && read.profile === 'ghost_select'))
    && read.kind === expectedKind[field]
    && Array.isArray(read.top) && read.top.length > 0;
  const visual = valid ? read : undefined;
  const chosen = context?.chosen;
  const rawTop = visual?.top.slice(0, 3) ?? [];
  const distinctive = field === 'flag' && visual
    ? visual.flag_distinctive_qa : null;
  const distinctTop = distinctive && distinctive.cropPixelSha256 === visual?.cropPixelSha256
    && rawTop.length === 3 && distinctive.top?.length === 3
    && distinctive.top.every((candidate) => Number.isFinite(candidate.distance))
    && new Set(distinctive.top.map((candidate) => candidate.id)).size === 3
    && distinctive.top.every((candidate) => rawTop.some((item) => item.id === candidate.id))
    ? distinctive.top : null;
  const rankedTop: { id: string; familyId: string; score: number;
    distinctiveDistance: number | null }[] = distinctTop
    ? distinctTop.map((candidate) => ({ ...rawTop.find((item) => item.id === candidate.id)!,
      distinctiveDistance: candidate.distance }))
    : rawTop.map((item) => ({ ...item, distinctiveDistance: null }));
  let contextAccepted = visual && chosen?.status === 'accepted' && chosen.id
    ? chosen.id : null;
  // A colour the context proposes for review (the body or glider catalog colour of
  // an accepted character); it leads the proposal but is never accepted by itself.
  const contextSuggested = visual && !contextAccepted && typeof chosen?.suggestedId === 'string'
    && chosen.suggestedId ? chosen.suggestedId : null;
  const colour = field === 'character' ? visual?.family_colour_qa : null;
  const colourRank = colour?.schema === 'mk8dx.family-colour-rank.v1'
    && colour.method === 'oklab' && colour.status === 'measured'
    && colour.cropPixelSha256 === visual?.cropPixelSha256
    && colour.familyId === rawTop[0]?.familyId
    && rawTop.length >= 2 && rawTop[1].familyId === colour.familyId
    && colour.top.length >= 2
    && new Set(colour.top.map((item) => item.id)).size === colour.top.length
    && colour.top.every((item) => Number.isFinite(item.distance))
    && rawTop.some((item) => item.id === colour.top[0].id)
    ? colour.top : null;
  let colourTop = visual?.status === 'unknown' && !contextAccepted ? colourRank : null;
  // A colour variant settled by the icon (or by a name that names only the
  // family) while the family-colour rank puts another variant of that family
  // first is not settled: show the colour rank's best match for review.
  let colourDoubt = false;
  if (colourRank && !colourTop) {
    const settled = contextAccepted ?? visual?.acceptedId ?? null;
    const exact = (chosen?.evidence ?? []).includes('exact_name');
    if (settled && !exact && settled !== colourRank[0].id
      && colourRank.some((candidate) => candidate.id === settled)) {
      colourTop = colourRank;
      contextAccepted = null;
      colourDoubt = true;
    }
  }
  if (colourTop) {
    const reordered = [...colourTop.map((candidate) => rankedTop.find((item) => item.id === candidate.id))
      .filter((item): item is typeof rankedTop[number] => Boolean(item)),
    ...rankedTop.filter((item) => !colourTop.some((candidate) => candidate.id === item.id))];
    rankedTop.splice(0, rankedTop.length, ...reordered);
  }
  const visualAccepted = visual?.acceptedId ?? null;
  const tricolor = field === 'flag' && visual?.top1Id === 'country.nl'
    && distinctTop?.[0].id === 'country.nl'
    && visual.flag_tricolor_qa?.schema === 'mk8dx.flag-tricolor-evidence.v1'
    && visual.flag_tricolor_qa.status === 'measured'
    && visual.flag_tricolor_qa.cropPixelSha256 === visual.cropPixelSha256
    ? visual.flag_tricolor_qa : null;
  // Stripes that cannot be measured apart are no evidence against NL: a
  // settled NL whose distinctive rank keeps LU clearly behind stays.
  const nlSettled = !colourDoubt && tricolor !== null && tricolor.acceptedId === null
    && tricolor.reason === 'insufficient_separation' && visualAccepted === 'country.nl'
    && luGap(distinctTop) >= NL_LU_GAP;
  let acceptedId = colourDoubt ? null : nlSettled ? 'country.nl' : tricolor ? tricolor.acceptedId
    : context ? contextAccepted
    : distinctTop && visualAccepted !== distinctTop[0].id ? null : visualAccepted;
  // A photo whose white anchor clipped in blue cannot calibrate the blue tone
  // that separates NL from LU: either flag stays a reviewed best match.
  const photometric = visual?.photometric_qa;
  const blueDoubt = field === 'flag' && (acceptedId === 'country.nl' || acceptedId === 'country.lu')
    && (photometric?.schema === 'mk8dx.card-photometric.v1' || photometric?.schema === 'mk8dx.panel-photometric.v1')
    && photometric.status === 'corrected'
    && photometric.blueClipped === true;
  if (blueDoubt) acceptedId = null;
  const shape = visual?.shape_rank_qa;
  const luShape = tricolor?.proposalId === 'country.lu'
    && shape?.cropPixelSha256 === visual?.cropPixelSha256
    && shape?.mode === 'full_rgb_ncc'
    && shape.top[0]?.id === 'country.lu'
    && shape.top[0].score === tricolor.proposalShapeScore
    ? shape.top[0] : null;
  const exposure = field === 'flag' && !acceptedId && !luShape
    && visual?.flag_exposure_qa?.schema === 'mk8dx.flag-exposure-proposal.v1'
    && visual.flag_exposure_qa.status === 'measured'
    && visual.flag_exposure_qa.cropPixelSha256 === visual.cropPixelSha256
    && visual.flag_exposure_qa.top.length >= 2
    && visual.flag_exposure_qa.top.every((item) => Number.isFinite(item.score))
    ? visual.flag_exposure_qa.top : null;
  const exposedTop = exposure?.[0] && visual?.kind === 'flags'
    ? exposure[0] : null;
  const proposedId = acceptedId ?? (luShape ? 'country.lu'
    : exposedTop?.id ?? contextSuggested ?? rankedTop[0]?.id ?? null);
  const top: ResultProposalCandidate[] = [];
  if (luShape) top.push({ id: 'country.lu', matchScore: null, textFuzzy: null,
    distinctiveDistance: null, basis: 'shape_ncc', shapeScore: luShape.score });
  if (exposedTop) top.push({ id: exposedTop.id, matchScore: null, textFuzzy: null,
    distinctiveDistance: null, basis: 'exposure', exposureScore: exposedTop.score });
  for (const item of exposure?.slice(1) ?? []) {
    if (top.some((candidate) => candidate.id === item.id)) continue;
    top.push({ id: item.id, matchScore: null, textFuzzy: null,
      distinctiveDistance: null, basis: 'exposure', exposureScore: item.score });
  }
  if (exposure) top.splice(3);
  if (proposedId && (contextAccepted || proposedId === contextSuggested)) {
    top.push({ id: proposedId,
      matchScore: rawTop.find((item) => item.id === proposedId)?.score ?? null,
      textFuzzy: context?.clue?.fuzzy ?? null, distinctiveDistance: null,
      basis: 'context' });
  }
  for (const item of rankedTop) {
    if (top.length === 3) break;
    if (top.some((candidate) => candidate.id === item.id)) continue;
    top.push({ id: item.id, matchScore: item.score,
      textFuzzy: item.id === contextAccepted ? context?.clue?.fuzzy ?? null : null,
      distinctiveDistance: item.distinctiveDistance,
      basis: item.id === contextAccepted ? 'context' : distinctTop ? 'distinctive'
        : colourTop?.some((candidate) => candidate.id === item.id) ? 'family_colour' : 'visual',
      ...(colourTop?.find((candidate) => candidate.id === item.id)
        ? { familyColourDistance: colourTop.find((candidate) => candidate.id === item.id)!.distance }
        : {}) });
    if (top.length === 3) break;
  }
  const selectedCrop = selected?.cropPixelSha256 ?? null;
  const out: ResultFieldProposal = { status: !proposedId ? 'unavailable' : acceptedId ? 'accepted' : 'proposed',
    proposedId, selectedId: proposedId, acceptedId,
    proposedFamilyId: chosen?.familyId ?? (luShape ? 'country.lu'
      : exposedTop?.id ?? rankedTop[0]?.familyId ?? null),
    reviewRequired: proposedId !== null && acceptedId === null,
    cropPixelSha256: visual?.cropPixelSha256 ?? null,
    selectedCropPixelSha256: selectedCrop,
    catalogSha256: visual?.catalogSha256 ?? null,
    contextStatus: chosen?.status ?? null,
    evidence: [...(chosen?.evidence ?? []), ...(distinctTop ? ['flag_distinctive_rank'] : []),
      ...(tricolor ? ['flag_tricolor_evidence'] : []),
      ...(nlSettled ? ['flag_nl_distinctive_settled'] : []),
      ...(blueDoubt ? ['photometric_blue_clipped'] : []),
      ...(luShape ? ['flag_lu_pattern'] : []),
      ...(exposedTop ? ['flag_exposure_rank'] : []),
      ...(colourTop ? ['family_colour_rank'] : [])],
    top, visualTop3: rawTop.map(({ id, familyId, score }) => ({ id, familyId, score })),
    familyColour: colourTop ? colour! : null };
  return openSetDecision(field, visual, rawTop, bandRatioDecision(field, visual, out));
}

/** A character the closed set did not accept and without a clear winner: suggest "Mii"
 * (sharedOpenSet.miiSuggestion), never accepted and without a size; the visual top stays the
 * alternatives. */
function openSetDecision(field: ResultField, visual: ReadWithDistinctive | null | undefined,
    rawTop: { id: string; familyId: string; score: number }[], out: ResultFieldProposal): ResultFieldProposal {
  if (field !== 'character' || !visual || out.acceptedId !== null) return out;
  const suggestion = miiSuggestion(visual.profile, rawTop, null);
  if (!suggestion) return out;
  const openSet = { id: suggestion.id, label: suggestion.label, mode: suggestion.mode,
    score: suggestion.score, familyMargin: suggestion.familyMargin };
  const candidate: ResultProposalCandidate = { id: suggestion.id, matchScore: null, textFuzzy: null,
    distinctiveDistance: null, basis: 'open_set' };
  const others = out.top.filter((item) => item.id !== suggestion.id);
  if (suggestion.mode === 'alternative') {
    // beside the best match: second in the list, the best match stays proposed
    return { ...out, top: [...others.slice(0, 1), candidate, ...others.slice(1, 2)],
      evidence: [...out.evidence, `${suggestion.evidence}_alternative`], openSet };
  }
  return { ...out, status: 'proposed', proposedId: suggestion.id, selectedId: suggestion.id,
    proposedFamilyId: suggestion.id, reviewRequired: true, top: [candidate, ...others].slice(0, 3),
    evidence: [...out.evidence, suggestion.evidence], openSet };
}

export function composeResultProposal(owner: ResultProposalOwner): ResultProposal {
  const fields = {} as Record<ResultField, ResultFieldProposal>;
  for (const field of ['character', 'kart', 'wheel', 'glider', 'flag'] as const) {
    fields[field] = composeField(field, owner[field]);
  }
  return { schema: 'mk8dx.web-result-field-proposal.v1', fields };
}
