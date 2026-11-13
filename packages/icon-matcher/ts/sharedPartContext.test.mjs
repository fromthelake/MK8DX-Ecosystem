import assert from 'node:assert/strict';
import test from 'node:test';
import { combinePart, partRelationKey } from './sharedPartContext.ts';
import { matchIconTensorCenter } from './sharedIconScorer.ts';

test('the visual scorer exposes the best different-family distance', () => {
  const group = { width: 1, height: 1,
    ids: ['a.red', 'a.blue', 'b.red'], families: ['a', 'a', 'b'],
    rgb: new Float32Array([0.5, 0.5, 0.5, 0.49, 0.49, 0.49, 0.48, 0.48, 0.48]),
    mask: new Uint8Array([1, 1, 1]), count: new Float32Array([1, 1, 1]) };
  const result = matchIconTensorCenter(new Float32Array([0.5, 0.5, 0.5]), group);
  assert.ok(Math.abs(result.familyMargin - 0.02) < 0.00001);
  assert.ok(Math.abs(result.margin - 0.01) < 0.00001);
});

test('opt-in strong tire text cannot accept a candidate outside visual top three', () => {
  const ids = ['tire.gold', 'tire.button', 'tire.slim', 'tire.roller'];
  const refs = {
    familyById: new Map(ids.map((id) => [id, id])),
    resultMembers: new Map([['tires', ids.map((id) => ({ id, familyId: id }))]]),
    partForCharacter: new Map(), tireByIndex: new Map([[1, ids[1]], [4, ids[3]]]),
  };
  const visual = { kind: 'tires', status: 'accepted', top1Id: ids[0], acceptedId: ids[0],
    score: .829, margin: .024, top: ids.slice(0, 3).map((id, rank) =>
      ({ id, familyId: id, score: [.829, .805, .790][rank] })) };
  const character = { id: null, familyId: null, status: 'unknown', evidence: [], visualTop1: '' };
  assert.equal(combinePart('tires', visual, character,
    { id: '1', fuzzy: 1, margin: .57 }, refs, true).id, ids[1]);
  assert.equal(combinePart('tires', visual, character,
    { id: '4', fuzzy: 1, margin: .57 }, refs).id, ids[3]);
  const guarded = combinePart('tires', visual, character,
    { id: '4', fuzzy: 1, margin: .57 }, refs, true);
  assert.equal(guarded.id, null);
  assert.equal(guarded.status, 'conflict');
  assert.deepEqual(guarded.evidence, ['tire_text_outside_visual_top3']);
  assert.equal(guarded.visualTop1, ids[0]);
});

test('a character relation cannot accept an unnamed near-tied glider family', () => {
  const refs = {
    familyById: new Map([['glider.parasol', 'glider.parasol'], ['glider.parachute', 'glider.parachute']]),
    resultMembers: new Map([['gliders', [
      { id: 'glider.parasol', familyId: 'glider.parasol' },
      { id: 'glider.parachute', familyId: 'glider.parachute' }]]]),
    partForCharacter: new Map([[partRelationKey('gliders', 'glider.parasol', 'character.baby'), 'glider.parasol']]),
    tireByIndex: new Map(),
  };
  const visual = { kind: 'gliders', status: 'unknown', top1Id: 'glider.parasol', acceptedId: null,
    score: 0.805, margin: 0.005, familyMargin: 0.005,
    top: [{ id: 'glider.parasol', familyId: 'glider.parasol', score: 0.805 },
      { id: 'glider.parachute', familyId: 'glider.parachute', score: 0.800 }] };
  const character = { id: 'character.baby', familyId: 'character.baby', status: 'accepted',
    evidence: [], visualTop1: 'character.baby' };
  const withheld = combinePart('gliders', visual, character, null, refs);
  assert.equal(withheld.id, null);
  assert.ok(withheld.evidence.includes('weak_family_relation_review'));
  assert.equal(combinePart('gliders', visual, character,
    { id: 'glider.parasol', fuzzy: 1, margin: 0.4 }, refs).id, 'glider.parasol');
  assert.equal(combinePart('gliders', { ...visual, familyMargin: 0.055 },
    character, null, refs).id, 'glider.parasol');
  refs.partForCharacter.set(partRelationKey('bodies', 'body.kart', 'character.baby'), 'body.kart');
  refs.resultMembers.set('bodies', [
    { id: 'body.kart', familyId: 'body.kart' }, { id: 'body.bike', familyId: 'body.bike' }]);
  assert.equal(combinePart('bodies', { ...visual, kind: 'bodies', top1Id: 'body.kart',
    top: [{ id: 'body.kart', familyId: 'body.kart', score: 0.805 },
      { id: 'body.bike', familyId: 'body.bike', score: 0.800 }] }, character, null, refs).id,
  'body.kart');
});

test('glider colour follows the character (issue #99 rules 1-3)', () => {
  const ids = ['glider.blue', 'glider.toad', 'glider.other', 'glider.fourth'];
  const refs = {
    familyById: new Map(ids.map((id) => [id, 'glider.super'])),
    resultMembers: new Map([['gliders', ids.map((id) => ({ id, familyId: 'glider.super' }))]]),
    partForCharacter: new Map([[partRelationKey('gliders', 'glider.super', 'character.toad'), 'glider.toad']]),
    tireByIndex: new Map(),
  };
  const visual = { kind: 'gliders', status: 'accepted', top1Id: 'glider.blue',
    acceptedId: 'glider.blue', score: .875, margin: .027, familyMargin: .2,
    top: ids.map((id, rank) => ({ id, familyId: 'glider.super', score: [.875, .848, .844, .810][rank] })) };
  const character = { id: 'character.toad', familyId: 'character.toad', status: 'accepted',
    evidence: [], visualTop1: 'character.toad' };
  const clue = { id: 'glider.super', fuzzy: 1, margin: .2 };
  const refined = combinePart('gliders', visual, character, clue, refs);
  assert.equal(refined.id, 'glider.toad');
  assert.equal(refined.visualTop1, 'glider.blue');
  assert.ok(refined.evidence.includes('character_part_top3_variant'));
  // rule 2: the catalog colour decides without a printed name too
  assert.equal(combinePart('gliders', visual, character, null, refs).id, 'glider.toad');
  // rule 1: an unaccepted character settles the family only; its catalog colour is the proposal
  const unacceptedCharacter = { ...character, id: null, familyId: null, status: 'unknown' };
  for (const unsettled of [{ ...character, status: 'unknown' }, unacceptedCharacter]) {
    for (const text of [clue, null]) {
      const proposed = combinePart('gliders', visual, unsettled, text, refs);
      assert.equal(proposed.id, null);
      assert.equal(proposed.status, 'family_only');
      assert.equal(proposed.familyId, 'glider.super');
      assert.equal(proposed.suggestedId, 'glider.toad');
      assert.ok(proposed.evidence.includes('glider_colour_needs_character'));
    }
  }
  assert.equal(combinePart('gliders', { ...visual, status: 'unknown', acceptedId: null,
    score: .858, margin: .019 }, unacceptedCharacter, clue, refs).id, null);
  const nobody = combinePart('gliders', visual, { ...unacceptedCharacter, visualTop1: '' }, clue, refs);
  assert.equal(nobody.status, 'family_only');
  assert.equal(nobody.suggestedId, null);
  // a clearly seen colour the character cannot have: catalog colour proposed, review required
  refs.partForCharacter.set(partRelationKey('gliders', 'glider.super', 'character.toad'), 'glider.fourth');
  const clash = combinePart('gliders', visual, character, clue, refs);
  assert.equal(clash.id, null);
  assert.equal(clash.status, 'conflict');
  assert.equal(clash.suggestedId, 'glider.fourth');
  assert.ok(clash.evidence.includes('character_colour_conflict_review'));
  // rule 3: no catalog link, the icon decides
  refs.partForCharacter.clear();
  assert.equal(combinePart('gliders', visual, character, clue, refs).id, 'glider.blue');
});
