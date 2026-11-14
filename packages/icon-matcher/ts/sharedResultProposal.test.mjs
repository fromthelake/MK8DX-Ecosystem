import assert from 'node:assert/strict';
import test from 'node:test';
import { composeResultProposal, nameResultChoice } from './sharedResultProposal.ts';

const read = (kind, top, acceptedId = null, crop = 'a'.repeat(64)) => ({
  schema: 'mk8dx.visual-field-read.v1', kind, profile: 'result',
  catalogSha256: 'b'.repeat(64), cropPixelSha256: crop,
  status: acceptedId ? 'accepted' : 'unknown', top1Id: top[0].id,
  acceptedId, score: top[0].score,
  top,
});
const top = (id, familyId, score) => ({ id, familyId, score });

test('a real-result-style name and part relation replace wrong visual acceptance without hiding scores', () => {
  const visualCharacter = read('characters', [
    top('character.metal_mario', 'character.metal_mario', .827),
    top('character.gold_mario', 'character.gold_mario', .806),
    top('character.wendy', 'character.wendy', .785),
  ], 'character.metal_mario');
  const proposal = composeResultProposal({
    character: { shared_icon_qa: visualCharacter,
      character_text_qa: { clue: { fuzzy: 1 }, chosen: {
        id: 'character.bowser', familyId: 'character.bowser', status: 'accepted',
        evidence: ['exact_name_cross_family'] } } },
    kart: { shared_icon_qa: read('bodies', [
      top('body_variant.buggybud.001_green', 'body.buggybud', .82),
      top('body_variant.buggybud.003_yellow', 'body.buggybud', .8),
    ]), part_text_qa: { clue: { fuzzy: .88 }, chosen: {
      id: 'body_variant.buggybud.003_yellow', familyId: 'body.buggybud',
      status: 'accepted', evidence: ['text_family', 'character_part_relation'] } } },
    flag: { shared_icon_qa: read('flags', [
      top('country.nl', 'country.nl', .81), top('country.lu', 'country.lu', .8),
      top('country.py', 'country.py', .77),
    ]) },
  });
  assert.equal(proposal.fields.character.acceptedId, 'character.bowser');
  assert.equal(proposal.fields.character.selectedId, 'character.bowser');
  assert.equal(proposal.fields.character.top[0].textFuzzy, 1);
  assert.equal(proposal.fields.character.top[0].matchScore, null);
  assert.equal(proposal.fields.character.visualTop3[0].score, .827);
  assert.equal(proposal.fields.kart.acceptedId, 'body_variant.buggybud.003_yellow');
  assert.equal(proposal.fields.kart.top[0].matchScore, .8);
  assert.equal(proposal.fields.flag.proposedId, 'country.nl');
  assert.equal(proposal.fields.flag.selectedId, 'country.nl');
  assert.equal(proposal.fields.flag.acceptedId, null);
  assert.equal(proposal.fields.flag.reviewRequired, true);
});

test('a conflict keeps a named first visual choice for review without retaining raw acceptance', () => {
  const proposal = composeResultProposal({ character: {
    shared_icon_qa: read('characters', [
      top('character.peach', 'character.peach', .91),
      top('character.pink_gold_peach', 'character.pink_gold_peach', .89),
    ], 'character.peach'),
    character_text_qa: { chosen: { id: null, familyId: null,
      status: 'conflict', evidence: ['visual_name_conflict'] } },
  } });
  assert.equal(proposal.fields.character.proposedId, 'character.peach');
  assert.equal(proposal.fields.character.selectedId, 'character.peach');
  assert.equal(proposal.fields.character.acceptedId, null);
  assert.equal(proposal.fields.character.status, 'proposed');
  assert.deepEqual(proposal.fields.character.top.map((item) => item.matchScore), [.91, .89]);
});

test('a same-crop distinctive flag pass reorders only the shortlisted proposal', () => {
  const visual = read('flags', [
    top('country.py', 'country.py', .8921),
    top('country.nl', 'country.nl', .8916),
    top('country.lu', 'country.lu', .8587),
  ]);
  visual.flag_distinctive_qa = { cropPixelSha256: visual.cropPixelSha256,
    top: [{ id: 'country.nl', distance: .099 },
      { id: 'country.py', distance: .155 },
      { id: 'country.lu', distance: .164 }] };
  const proposal = composeResultProposal({ flag: { shared_icon_qa: visual } }).fields.flag;
  assert.equal(proposal.proposedId, 'country.nl');
  assert.equal(proposal.selectedId, 'country.nl');
  assert.equal(proposal.acceptedId, null);
  assert.equal(proposal.top[0].matchScore, .8916);
  assert.equal(proposal.top[0].distinctiveDistance, .099);
  assert.equal(proposal.top[0].basis, 'distinctive');
  assert.equal(proposal.visualTop3[0].id, 'country.py');
  visual.flag_distinctive_qa.cropPixelSha256 = 'c'.repeat(64);
  assert.equal(composeResultProposal({ flag: { shared_icon_qa: visual } })
    .fields.flag.proposedId, 'country.py');
});

test('same-crop tricolour evidence accepts NL and can withhold a conflicting raw acceptance', () => {
  const visual = read('flags', [
    top('country.nl', 'country.nl', .9),
    top('country.py', 'country.py', .89),
    top('country.lu', 'country.lu', .87),
  ]);
  visual.flag_distinctive_qa = { cropPixelSha256: visual.cropPixelSha256,
    top: [{ id: 'country.nl', distance: .08 },
      { id: 'country.lu', distance: .14 },
      { id: 'country.py', distance: .15 }] };
  visual.flag_tricolor_qa = { schema: 'mk8dx.flag-tricolor-evidence.v1',
    status: 'measured', cropPixelSha256: visual.cropPixelSha256,
    acceptedId: 'country.nl' };
  assert.equal(composeResultProposal({ flag: { shared_icon_qa: visual } })
    .fields.flag.acceptedId, 'country.nl');
  visual.acceptedId = 'country.nl';
  visual.status = 'accepted';
  visual.flag_tricolor_qa.acceptedId = null;
  assert.equal(composeResultProposal({ flag: { shared_icon_qa: visual } })
    .fields.flag.acceptedId, null);
  visual.flag_tricolor_qa.cropPixelSha256 = 'c'.repeat(64);
  assert.equal(composeResultProposal({ flag: { shared_icon_qa: visual } })
    .fields.flag.acceptedId, 'country.nl');
});

test('a same-crop LU pattern supplies a named first choice beyond the raw top three', () => {
  const visual = read('flags', [
    top('country.nl', 'country.nl', .832),
    top('country.hr', 'country.hr', .826),
    top('country.py', 'country.py', .821),
  ]);
  visual.flag_distinctive_qa = { cropPixelSha256: visual.cropPixelSha256,
    top: [{ id: 'country.nl', distance: .18 },
      { id: 'country.py', distance: .21 }, { id: 'country.hr', distance: .24 }] };
  visual.shape_rank_qa = { mode: 'full_rgb_ncc', cropPixelSha256: visual.cropPixelSha256,
    top: [{ id: 'country.lu', score: .966 }, { id: 'country.nl', score: .917 }] };
  visual.flag_tricolor_qa = { schema: 'mk8dx.flag-tricolor-evidence.v1',
    status: 'measured', cropPixelSha256: visual.cropPixelSha256,
    acceptedId: null, proposalId: 'country.lu', proposalShapeScore: .966 };
  const field = composeResultProposal({ flag: { shared_icon_qa: visual } }).fields.flag;
  assert.equal(field.proposedId, 'country.lu');
  assert.equal(field.selectedId, 'country.lu');
  assert.equal(field.acceptedId, null);
  assert.equal(field.reviewRequired, true);
  assert.deepEqual(field.top.map((item) => item.id),
    ['country.lu', 'country.nl', 'country.py']);
  assert.equal(field.top[0].shapeScore, .966);
  assert.equal(field.top[0].matchScore, null);
  assert.equal(field.top[0].basis, 'shape_ncc');
  assert.deepEqual(nameResultChoice(field, (id) => new Map([
    ['country.lu', 'Luxemburg'], ['country.nl', 'Nederland'],
    ['country.py', 'Paraguay'],
  ]).get(id) ?? ''), {
    id: 'country.lu', label: 'Luxemburg?', matchScore: null,
    shapeScore: .966, reviewRequired: true,
    alternatives: [
      { id: 'country.nl', label: 'Nederland', matchScore: .832 },
      { id: 'country.py', label: 'Paraguay', matchScore: .821 },
    ],
  });
  assert.deepEqual(field.visualTop3.map((item) => item.id),
    ['country.nl', 'country.hr', 'country.py']);
  visual.shape_rank_qa.cropPixelSha256 = 'c'.repeat(64);
  assert.equal(composeResultProposal({ flag: { shared_icon_qa: visual } })
    .fields.flag.proposedId, 'country.nl');
  visual.shape_rank_qa.cropPixelSha256 = visual.cropPixelSha256;
  visual.flag_tricolor_qa.cropPixelSha256 = 'c'.repeat(64);
  assert.equal(composeResultProposal({ flag: { shared_icon_qa: visual } })
    .fields.flag.proposedId, 'country.nl');
});

test('an exposure rank offers a reviewed flag choice and retains raw visual scores', () => {
  const visual = read('flags', [top('country.py', 'country.py', .805),
    top('country.hr', 'country.hr', .799), top('country.nl', 'country.nl', .791)]);
  visual.flag_exposure_qa = { schema: 'mk8dx.flag-exposure-proposal.v1',
    status: 'measured', cropPixelSha256: visual.cropPixelSha256, gain: 1.38,
    top: [{ id: 'country.nl', score: .91 }, { id: 'country.lu', score: .89 },
      { id: 'country.py', score: .82 }] };
  const field = composeResultProposal({ flag: { shared_icon_qa: visual } }).fields.flag;
  assert.equal(field.proposedId, 'country.nl');
  assert.equal(field.acceptedId, null);
  assert.equal(field.reviewRequired, true);
  assert.deepEqual(field.top.map((item) => item.id),
    ['country.nl', 'country.lu', 'country.py']);
  assert.equal(field.top[0].basis, 'exposure');
  assert.equal(field.top[0].matchScore, null);
  assert.equal(field.top[0].exposureScore, .91);
  assert.equal(field.visualTop3[0].id, 'country.py');
  visual.flag_exposure_qa.cropPixelSha256 = 'c'.repeat(64);
  assert.equal(composeResultProposal({ flag: { shared_icon_qa: visual } })
    .fields.flag.proposedId, 'country.py');
});

test('the tire decision records its distinct window crop and the original selected crop', () => {
  const selected = read('tires', [top('tire.roller', 'tire.roller', .78)], null, 'a'.repeat(64));
  const window = read('tires', [top('tire.azure_roller', 'tire.azure_roller', .84)],
    'tire.azure_roller', 'c'.repeat(64));
  const proposal = composeResultProposal({ wheel: {
    shared_icon_qa: selected, tire_window_qa: window,
    part_text_qa: { cropPixelSha256: window.cropPixelSha256,
      clue: { fuzzy: 1 }, chosen: { id: 'tire.azure_roller',
        familyId: 'tire.azure_roller', status: 'accepted', evidence: ['tire_text'] } },
  } });
  assert.equal(proposal.fields.wheel.cropPixelSha256, window.cropPixelSha256);
  assert.equal(proposal.fields.wheel.selectedCropPixelSha256, selected.cropPixelSha256);
  assert.equal(proposal.fields.wheel.acceptedId, 'tire.azure_roller');
});

test('an unread field has no invented candidate', () => {
  const proposal = composeResultProposal({ character: {
    character_text_qa: { chosen: { id: 'character.bowser',
      status: 'accepted', evidence: ['name_only'] } },
  } });
  assert.ok(Object.values(proposal.fields).every((field) => field.status === 'unavailable'
    && field.proposedId === null && field.selectedId === null
    && field.acceptedId === null && field.top.length === 0));
});

test('a close present flag keeps its first named choice, question mark and alternatives', () => {
  const proposal = composeResultProposal({ flag: { shared_icon_qa: read('flags', [
    top('country.nl', 'country.nl', .864),
    top('country.py', 'country.py', .856),
    top('country.lu', 'country.lu', .844),
  ]) } }).fields.flag;
  const labels = new Map([['country.nl', 'Nederland'],
    ['country.py', 'Paraguay'], ['country.lu', 'Luxemburg']]);
  assert.deepEqual(nameResultChoice(proposal, (id) => labels.get(id) ?? ''), {
    id: 'country.nl', label: 'Nederland?', matchScore: .864,
    reviewRequired: true, alternatives: [
      { id: 'country.py', label: 'Paraguay', matchScore: .856 },
      { id: 'country.lu', label: 'Luxemburg', matchScore: .844 },
    ],
  });
  assert.equal(nameResultChoice(composeResultProposal({}).fields.flag, () => ''), null);
});

test('colour alternatives remain distinguishable when catalog base names coincide', () => {
  const proposal = composeResultProposal({ character: { shared_icon_qa: read('characters', [
    top('character_variant.inkling_boy.070_cyan', 'character.inkling_boy', .829),
    top('character.inkling_boy', 'character.inkling_boy', .823),
    top('character_variant.inkling_boy.069_purple', 'character.inkling_boy', .816),
  ]) } }).fields.character;
  const labels = new Map([
    ['character_variant.inkling_boy.070_cyan', 'Inkling-jongen (cyaan)'],
    ['character.inkling_boy', 'Inkling-jongen (basis)'],
    ['character_variant.inkling_boy.069_purple', 'Inkling-jongen (paars)'],
  ]);
  const named = nameResultChoice(proposal, (id) => labels.get(id) ?? '');
  assert.equal(named?.label, 'Inkling-jongen (cyaan)?');
  assert.equal(proposal.selectedId, 'character_variant.inkling_boy.070_cyan');
  assert.equal(proposal.acceptedId, null);
  assert.deepEqual(named?.alternatives.map((item) => item.label),
    ['Inkling-jongen (basis)', 'Inkling-jongen (paars)']);
});

test('same-crop family colour reorders a close proposal without accepting it', () => {
  const visual = read('characters', [
    top('character_variant.inkling_boy.070_cyan', 'character.inkling_boy', .829),
    top('character.inkling_boy', 'character.inkling_boy', .823),
    top('character_variant.inkling_boy.069_purple', 'character.inkling_boy', .816),
  ]);
  visual.family_colour_qa = { schema: 'mk8dx.family-colour-rank.v1', method: 'oklab',
    familyId: 'character.inkling_boy', status: 'measured', observedPixels: 132,
    cropPixelSha256: visual.cropPixelSha256,
    top: [{ id: 'character.inkling_boy', distance: .15 },
      { id: 'character_variant.inkling_boy.069_purple', distance: .24 },
      { id: 'character_variant.inkling_boy.070_cyan', distance: .32 }] };
  const candidate = composeResultProposal({ character: { shared_icon_qa: visual,
    character_text_qa: { chosen: { id: null, status: 'unknown',
      evidence: ['visual', 'name_family'] } } } }).fields.character;
  assert.equal(candidate.proposedId, 'character.inkling_boy');
  assert.equal(candidate.selectedId, 'character.inkling_boy');
  assert.equal(candidate.acceptedId, null);
  assert.equal(candidate.reviewRequired, true);
  assert.equal(candidate.top[0].matchScore, .823);
  assert.equal(candidate.top[0].familyColourDistance, .15);
  assert.equal(candidate.top[0].basis, 'family_colour');
  assert.equal(candidate.visualTop3[0].id, 'character_variant.inkling_boy.070_cyan');
  visual.family_colour_qa.cropPixelSha256 = 'c'.repeat(64);
  assert.equal(composeResultProposal({ character: { shared_icon_qa: visual } })
    .fields.character.proposedId, 'character_variant.inkling_boy.070_cyan');
});

test('a settled colour variant that the family colour contradicts becomes a reviewed best match', () => {
  // Darkened (75 %) phone photo 2026-10-22: the icon accepted purple at margin .023 and the
  // printed name only named the family; the colour rank put the base first.
  const visual = read('characters', [
    top('character_variant.inkling_boy.069_purple', 'character.inkling_boy', .84),
    top('character_variant.inkling_boy.070_cyan', 'character.inkling_boy', .817),
    top('character.inkling_boy', 'character.inkling_boy', .787),
  ], 'character_variant.inkling_boy.069_purple');
  visual.family_colour_qa = { schema: 'mk8dx.family-colour-rank.v1', method: 'oklab',
    familyId: 'character.inkling_boy', status: 'measured', observedPixels: 132,
    cropPixelSha256: visual.cropPixelSha256,
    top: [{ id: 'character.inkling_boy', distance: .186 },
      { id: 'character_variant.inkling_boy.069_purple', distance: .21 },
      { id: 'character_variant.inkling_boy.070_cyan', distance: .3 }] };
  const named = (evidence) => composeResultProposal({ character: { shared_icon_qa: visual,
    character_text_qa: { chosen: { id: 'character_variant.inkling_boy.069_purple',
      familyId: 'character.inkling_boy', status: 'accepted', evidence } } } }).fields.character;
  for (const owner of [named(['visual', 'name_family']), composeResultProposal({
    character: { shared_icon_qa: visual } }).fields.character]) {
    assert.equal(owner.selectedId, 'character.inkling_boy');
    assert.equal(owner.acceptedId, null);
    assert.equal(owner.reviewRequired, true);
    assert.ok(owner.evidence.includes('family_colour_rank'));
  }
  // A printed name that names the colour itself still settles it.
  const exact = named(['visual_family', 'exact_name']);
  assert.equal(exact.acceptedId, 'character_variant.inkling_boy.069_purple');
});

test('stripes measured too close to call do not veto a settled NL that keeps LU clearly behind', () => {
  // corpus HDMI 2026-10-22: NL accepted at .96, distinctive NL .045 / LU .127,
  // tricolour 'insufficient_separation' had withheld eleven correct NL flags.
  const visual = read('flags', [
    top('country.nl', 'country.nl', .963),
    top('country.lu', 'country.lu', .918),
    top('country.py', 'country.py', .9),
  ], 'country.nl');
  visual.flag_distinctive_qa = { cropPixelSha256: visual.cropPixelSha256,
    top: [{ id: 'country.nl', distance: .045 }, { id: 'country.lu', distance: .127 },
      { id: 'country.py', distance: .2 }] };
  visual.flag_tricolor_qa = { schema: 'mk8dx.flag-tricolor-evidence.v1', status: 'measured',
    cropPixelSha256: visual.cropPixelSha256, acceptedId: null, reason: 'insufficient_separation' };
  const settled = composeResultProposal({ flag: { shared_icon_qa: visual } }).fields.flag;
  assert.equal(settled.acceptedId, 'country.nl');
  assert.ok(settled.evidence.includes('flag_nl_distinctive_settled'));
  // LU close behind NL: still a question.
  visual.flag_distinctive_qa.top[1].distance = .08;
  assert.equal(composeResultProposal({ flag: { shared_icon_qa: visual } }).fields.flag.acceptedId, null);
  // An LU pattern is evidence against NL and keeps its veto.
  visual.flag_distinctive_qa.top[1].distance = .127;
  visual.flag_tricolor_qa.reason = 'lu_pattern_and_stripe_agree';
  assert.equal(composeResultProposal({ flag: { shared_icon_qa: visual } }).fields.flag.acceptedId, null);
});

test('a photo whose white anchor clipped in blue keeps NL and LU under review', () => {
  const visual = read('flags', [top('country.nl', 'country.nl', .95), top('country.lu', 'country.lu', .9),
    top('country.py', 'country.py', .88)], 'country.nl');
  const flag = () => composeResultProposal({ flag: { shared_icon_qa: visual } }).fields.flag;
  assert.equal(flag().acceptedId, 'country.nl');
  visual.photometric_qa = { schema: 'mk8dx.card-photometric.v1', status: 'corrected', blueClipped: true };
  assert.equal(flag().acceptedId, null);
  assert.equal(flag().selectedId, 'country.nl');
  assert.ok(flag().evidence.includes('photometric_blue_clipped'));
  visual.photometric_qa.blueClipped = false;
  assert.equal(flag().acceptedId, 'country.nl');
});

const band = (ratio, decisionId, crop = 'a'.repeat(64)) => ({ schema: 'mk8dx.flag-band-ratio.v1',
  status: 'measured', cropPixelSha256: crop, ratio, decisionId });
const flags = (first, second) => [top(first, first, .91), top(second, second, .9), top('country.py', 'country.py', .86)];

test('the band ratio settles NL and LU, also after a clipped blue anchor', () => {
  const clipped = { schema: 'mk8dx.card-photometric.v1', status: 'corrected', blueClipped: true };
  const nl = composeResultProposal({ flag: { shared_icon_qa: { ...read('flags', flags('country.lu', 'country.nl'), 'country.lu'),
    photometric_qa: clipped, flag_band_ratio_qa: band(.41, 'country.nl') } } }).fields.flag;
  assert.equal(nl.acceptedId, 'country.nl');
  assert.equal(nl.top[0].id, 'country.nl');
  assert.ok(nl.evidence.includes('flag_band_ratio'));
  const lu = composeResultProposal({ flag: { shared_icon_qa: { ...read('flags', flags('country.nl', 'country.lu'), 'country.nl'),
    flag_band_ratio_qa: band(.75, 'country.lu') } } }).fields.flag;
  assert.equal(lu.acceptedId, 'country.lu');
  assert.equal(lu.proposedFamilyId, 'country.lu');
});

test('a band ratio between the flags keeps review; other flags and stale crops are untouched', () => {
  const between = composeResultProposal({ flag: { shared_icon_qa: { ...read('flags', flags('country.nl', 'country.lu'), 'country.nl'),
    flag_band_ratio_qa: band(.65, null) } } }).fields.flag;
  assert.equal(between.acceptedId, null);
  assert.equal(between.selectedId, 'country.nl');
  assert.ok(between.evidence.includes('flag_band_ratio_between'));
  const other = composeResultProposal({ flag: { shared_icon_qa: { ...read('flags', [top('country.fr', 'country.fr', .93),
    top('country.nl', 'country.nl', .8), top('country.lu', 'country.lu', .79)], 'country.fr'),
  flag_band_ratio_qa: band(.41, 'country.nl') } } }).fields.flag;
  assert.equal(other.acceptedId, 'country.fr');
  const stale = composeResultProposal({ flag: { shared_icon_qa: { ...read('flags', flags('country.nl', 'country.lu'), 'country.nl'),
    flag_band_ratio_qa: band(.75, 'country.lu', 'x'.repeat(64)) } } }).fields.flag;
  assert.equal(stale.acceptedId, 'country.nl');
});

test('a Select-a-Ghost character read is valid only for the character', () => {
  const proposal = composeResultProposal({
    character: { shared_icon_qa: { ...read('characters', [top('character.mario', 'character.mario', 0.9)], 'character.mario'), profile: 'ghost_select' } },
    kart: { shared_icon_qa: { ...read('bodies', [top('body.pipe_frame', 'body.pipe_frame', 0.9)], 'body.pipe_frame'), profile: 'ghost_select' } },
  });
  assert.equal(proposal.fields.character.acceptedId, 'character.mario');
  assert.equal(proposal.fields.kart.status, 'unavailable');
});

test('a glider colour that follows the character is proposed, not accepted', () => {
  // combinePart: an accepted character whose catalog colour clashes with the icon (#99).
  const glider = read('gliders', [top('glider.super', 'glider.super', .92),
    top('glider_variant.super.001_blue', 'glider.super', .88)], 'glider.super');
  const chosen = { id: null, familyId: 'glider.super', status: 'conflict',
    evidence: ['visual_family', 'character_colour_conflict_review'],
    visualTop1: 'glider.super', suggestedId: 'glider_variant.super.002_red' };
  const field = composeResultProposal({ glider: { shared_icon_qa: glider,
    part_text_qa: { chosen } } }).fields.glider;
  assert.equal(field.selectedId, 'glider_variant.super.002_red');
  assert.equal(field.acceptedId, null);
  assert.equal(field.reviewRequired, true);
  assert.equal(field.proposedFamilyId, 'glider.super');
  assert.deepEqual(field.top.map((candidate) => candidate.id),
    ['glider_variant.super.002_red', 'glider.super', 'glider_variant.super.001_blue']);
  assert.equal(field.top[0].basis, 'context');
  assert.equal(field.top[0].matchScore, null);
  const plain = composeResultProposal({ glider: { shared_icon_qa: glider,
    part_text_qa: { chosen: { ...chosen, suggestedId: null } } } }).fields.glider;
  assert.equal(plain.selectedId, 'glider.super');
  assert.equal(plain.acceptedId, null);
});
