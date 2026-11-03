/** Opt-in shared engine entry point for RAW optical endscreen photos. */
import { rgbaToBgrMat } from './cv';
import { familyOf } from './cleanAssets';
import { fitYellowPlayerCardEdge, opticalBoxConflict, type OpticalBox } from './opticalCardEdge';
import { runFrame, type PipelineDeps, type RunOptions } from './pipeline';
import type { Frame, FrameResult, OwnerIdentity } from './types';
import type { StageListener } from './runner';

const IDENTITY_KINDS = ['character', 'kart', 'wheel', 'glider', 'flag'] as const;

function reviewNameOnlyCharacterVariant(result: FrameResult): void {
  for (const owner of Object.values(result.kartConfig?.owners ?? {})) {
    const character = owner.character;
    if (!character?.ok || character.reason !== 'lookalike_set_margin'
        || !String(character.id ?? '').startsWith('character_variant.')
        || !character.name_text?.id
        || familyOf(String(character.id)) !== familyOf(character.name_text.id)) continue;
    // The in-game name confirms the family, but cannot resolve its colour.
    character.ok = false;
    character.reason = 'optical_variant_name_family_only';
    character.evidence = `${character.evidence ?? 'clean_assets'}+variant_review`;
  }
}

function preservesConfidentIds(first: FrameResult, second: FrameResult): boolean {
  const before = first.kartConfig?.owners ?? {};
  const after = second.kartConfig?.owners ?? {};
  for (const [owner, identity] of Object.entries(before)) {
    const replacement: OwnerIdentity | undefined = after[owner];
    for (const kind of IDENTITY_KINDS) {
      const accepted = identity[kind];
      if (accepted?.ok && accepted.id && replacement?.[kind]?.id !== accepted.id) return false;
    }
  }
  return true;
}

/**
 * The first pass includes existing strict fallback, in-game badge profile,
 * sparse dual-card recovery and repeated ghost-lap column alignment.
 * A full yellow card edge is tried only when the selected first-pass warp
 * extends beyond an independently detected game-card box. No label, monitor
 * boundary or expected result enters this choice. Both passes use the same
 * shared field readers. This entry point is opt-in; production calls runFrame.
 */
export async function runOpticalEndscreenCandidate(frame: Frame, deps: PipelineDeps,
  options: RunOptions, listener: StageListener, isCancelled: () => boolean): Promise<FrameResult> {
  const matcher = deps.kartConfig;
  const prior = matcher?.characterTextLeftProbe ?? 0;
  if (matcher && options.characterTextLeftProbeCandidate) matcher.characterTextLeftProbe = 12;
  try {
    return await runOpticalEndscreenCandidateInner(frame, deps, options, listener, isCancelled);
  } finally {
    if (matcher) matcher.characterTextLeftProbe = prior;
  }
}

async function runOpticalEndscreenCandidateInner(frame: Frame, deps: PipelineDeps,
  options: RunOptions, listener: StageListener, isCancelled: () => boolean): Promise<FrameResult> {
  if (options.layout !== 'endscreen' || options.researchPlayerCardQuad) {
    throw new Error('Optical candidate requires a raw endscreen without a supplied quad');
  }
  const started = performance.now();
  const common: RunOptions = { ...options, strictLapSumSeedCandidate: true,
    researchGameAnchorLapProfileCandidate: true, sparseDualYellowCandidate: true,
    ghostLapColumnCandidate: true, inlineOpticalCardEdgeCandidate: true,
    inlineOpticalBadgeRowCandidate: options.opticalBadgeRowCandidate !== false,
    kartVariantTextReviewCandidate: true, wheelTextConflictReviewCandidate: true,
    ownerPresenceCandidate: true };
  const finish = (result: FrameResult): FrameResult => {
    reviewNameOnlyCharacterVariant(result);
    result.diagnostics.opticalCandidateOptions = { strictLapSumSeed: true,
      gameAnchorLapProfile: true, sparseDualYellow: true, ghostLapColumn: true,
      inlineCardEdge: true, inlineBadgeRow: options.opticalBadgeRowCandidate !== false,
      kartVariantTextReview: true, wheelTextConflictReview: true,
      ownerPresence: true, nameOnlyCharacterVariantReview: true,
      characterTextLeftProbe: options.characterTextLeftProbeCandidate === true };
    return result;
  };
  const first = await runFrame(frame, deps, common, listener, isCancelled);
  if (first.diagnostics.opticalBadgeRow?.selected) return finish(first);
  if (first.diagnostics.opticalCardEdge && (first.diagnostics.opticalCardEdge.selected
      || first.diagnostics.opticalCardEdge.reason === 'inline_retry_rejected'
      || first.diagnostics.opticalCardEdge.reason === 'inline_retry_error')) {
    first.diagnostics.opticalCardEdge.elapsedMs = performance.now() - started;
    return finish(first);
  }
  const initial = { status: 'abstain', selected: false, firstStatus: first.status,
    elapsedMs: 0, reason: 'no_complete_game_card_evidence' };
  const ordinary = first.diagnostics.quad;
  const players = (first.diagnostics.detections ?? []).filter((item) => item.label === 'player_timetrail_box');
  if (!ordinary || !players.length || isCancelled()) {
    first.diagnostics.opticalCardEdge = { ...initial, elapsedMs: performance.now() - started };
    return finish(first);
  }
  const player = players.reduce((a, b) => a.score >= b.score ? a : b);
  const box: OpticalBox = [player.left * frame.width, player.top * frame.height,
    player.right * frame.width, player.bottom * frame.height];
  const bgr = rgbaToBgrMat(frame.rgba, frame.width, frame.height);
  let fit;
  const fitStart = performance.now();
  try { fit = fitYellowPlayerCardEdge(bgr, box); }
  finally { bgr.delete(); }
  const fitMs = performance.now() - fitStart;
  if (fit.status !== 'candidate' || !fit.quad) {
    first.diagnostics.opticalCardEdge = { ...initial, status: fit.status, fitMs,
      elapsedMs: performance.now() - started, reason: 'incomplete_yellow_game_card_edge' };
    return finish(first);
  }
  const conflict = opticalBoxConflict(box, ordinary, fit.quad);
  if (!conflict.edgeFirst) {
    first.diagnostics.opticalCardEdge = { ...initial, status: fit.status, ...conflict, fitMs,
      elapsedMs: performance.now() - started, reason: 'ordinary_quad_fits_detected_card' };
    return finish(first);
  }
  const second = await runFrame(frame, deps, { ...common, researchPlayerCardQuad: fit.quad,
    researchPlayerCardQuadForce: true }, listener, isCancelled);
  const fieldsPreserved = first.status !== 'valid_decode'
    || (second.status === 'valid_decode' && JSON.stringify(first.fields) === JSON.stringify(second.fields));
  const selected = second.status === 'valid_decode' && fieldsPreserved
    && preservesConfidentIds(first, second)
    && second.diagnostics.seedUsed === 'research_player_card_edge_seed';
  const result = selected ? second : first;
  result.diagnostics.opticalCardEdge = { status: fit.status, selected, firstStatus: first.status,
    secondStatus: second.status, ordinaryOutsideMax: conflict.ordinaryOutsideMax,
    edgeBoxGapMax: conflict.edgeBoxGapMax, fitMs, elapsedMs: performance.now() - started,
    reason: selected ? 'game_card_box_conflict_and_closed_read' : 'retry_rejected' };
  return finish(result);
}
