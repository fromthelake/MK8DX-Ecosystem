import assert from 'node:assert/strict';
import test from 'node:test';
import { composeGhostProposal } from './sharedGhostProposal.ts';

const read = (top, acceptedId = null) => ({ top, acceptedId, cropPixelSha256: 'a'.repeat(64) });
const top = (id, score) => ({ id, score });

test('dark Ghost proposes the joint loadout and independently read tire/flag', () => {
  const owner = {
    joint_loadout_qa: { status: 'ranked', mode: 'bounded_luminance',
      top3Loadouts: [{ characterId: 'character.inkling_boy', characterScore: .842,
        kartId: 'body_variant.buggybud.000_blue', kartScore: .806,
        gliderId: 'glider.cloud_glider', gliderScore: .781 }] },
    character: { shared_icon_qa: read([top('character_variant.inkling_boy.069_purple', .843)]) },
    kart: { shared_icon_qa: read([top('body_variant.gla.000_black', .807)]) },
    wheel: { shared_icon_qa: read([top('tire.ancient_tyres', .838)]),
      part_text_qa: { clue: { fuzzy: 1 },
        chosen: { id: 'tire.azure_roller', status: 'accepted' } } },
    glider: { shared_icon_qa: read([top('glider.paraglider', .770)]) },
    flag: { shared_icon_qa: { ...read([top('country.lv', .783), top('country.nl', .772)]),
      flag_distinctive_qa: { top: [{ id: 'country.nl', distance: .226 },
        { id: 'country.lv', distance: .271 }] } } },
  };
  const result = composeGhostProposal(owner);
  assert.deepEqual(['character', 'kart', 'wheel', 'glider', 'flag']
    .map((field) => result.fields[field].proposedId), [
    'character.inkling_boy', 'body_variant.buggybud.000_blue',
    'tire.azure_roller', 'glider.cloud_glider', 'country.nl']);
  assert.equal(result.fields.character.top[0].matchScore, .842);
  assert.equal(result.fields.wheel.top[0].textFuzzy, 1);
  assert.equal(result.fields.flag.top[0].distinctiveDistance, .226);
  assert.ok(Object.values(result.fields).every((field) =>
    field.acceptedId === null && field.reviewRequired));
});

test('normal Ghost preserves an accepted raw first choice', () => {
  const result = composeGhostProposal({
    joint_loadout_qa: { status: 'ranked', mode: 'raw', top3Loadouts: [{
      characterId: 'character.second', characterScore: .87,
      kartId: 'body.second', kartScore: .84,
      gliderId: 'glider.second', gliderScore: .81 }] },
    character: { shared_icon_qa: read([top('character.first', .91)], 'character.first') },
  });
  assert.equal(result.fields.character.proposedId, 'character.first');
  assert.equal(result.fields.character.top[0].basis, 'raw_accepted');
  assert.equal(result.fields.character.top[1].id, 'character.second');
  assert.equal(result.fields.wheel.status, 'unavailable');
});

test('a partial loadout keeps its independently ranked character', () => {
  const result = composeGhostProposal({
    joint_loadout_qa: { status: 'partial', mode: 'digit_neutral_clahe_low_contrast',
      characterTop3: [top('character.morton', .855), top('character.bowser', .792)] },
    character: { shared_icon_qa: read([top('character.inkling_girl', .86)]) },
  });
  assert.equal(result.fields.character.proposedId, 'character.morton');
  assert.deepEqual(result.fields.character.top.map((item) => item.id), [
    'character.morton', 'character.bowser', 'character.inkling_girl']);
  assert.equal(result.fields.kart.proposedId, null);
});

test('shape family narrows tire colour refinement and ranks the same-crop flag', () => {
  const hash = 'a'.repeat(64);
  const result = composeGhostProposal({
    wheel: { shared_icon_qa: { ...read([top('tire.normal_blue', .84)], 'tire.normal_blue'),
      shape_rank_qa: { mode: 'masked_gray_ncc', cropPixelSha256: hash,
        margin: .01, top: [top('tire.normal', .72), top('tire.normal_blue', .71)] } },
    part_text_qa: { clue: { fuzzy: 1 },
      chosen: { id: 'tire.normal', status: 'accepted' } } },
    flag: { shared_icon_qa: { ...read([top('country.bw', .82)], 'country.bw'),
      shape_rank_qa: { mode: 'full_rgb_ncc', cropPixelSha256: hash,
        margin: .04, top: [top('country.jp', .95), top('country.bw', .91)] } } },
  });
  assert.equal(result.schema, 'mk8dx.web-ghost-field-proposal.v2');
  assert.equal(result.fields.wheel.proposedId, 'tire.normal_blue');
  assert.equal(result.fields.wheel.top[0].basis, 'shape_sibling_refine');
  assert.equal(result.fields.wheel.top[0].shapeScore, .71);
  assert.equal(result.fields.flag.proposedId, 'country.jp');
  assert.equal(result.fields.flag.top[0].shapeScore, .95);
  assert.equal(result.fields.flag.acceptedId, null);
});

test('weak optical tire shape retains accepted row text as a review choice', () => {
  const result = composeGhostProposal({
    wheel: { shared_icon_qa: { ...read([top('tire.roller', .79)]),
      shape_rank_qa: { mode: 'masked_gray_ncc', cropPixelSha256: 'a'.repeat(64),
        margin: .09, top: [top('tire.roller', .50),
          top('tire.normal_blue', .41)] } },
    part_text_qa: { clue: { fuzzy: 1 },
      chosen: { id: 'tire.normal_blue', status: 'accepted' } } },
  });
  assert.equal(result.fields.wheel.proposedId, 'tire.normal_blue');
  assert.equal(result.fields.wheel.top[0].basis, 'tire_text_low_shape');
  assert.equal(result.fields.wheel.top[1].id, 'tire.roller');
  assert.equal(result.fields.wheel.acceptedId, null);
});
