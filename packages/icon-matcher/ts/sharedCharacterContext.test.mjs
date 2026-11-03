import assert from 'node:assert/strict';
import test from 'node:test';
import { combineCharacter } from './sharedCharacterContext.ts';

test('an approximate colour name conflicts with an accepted visual variant', () => {
  const familyById = new Map([
    ['character.yoshi.black', 'character.yoshi'],
    ['character.yoshi.yellow', 'character.yoshi'],
  ]);
  const visual = { kind: 'characters', status: 'accepted',
    top1Id: 'character.yoshi.black', acceptedId: 'character.yoshi.black',
    score: 0.882, margin: 0.042,
    top: [{ id: 'character.yoshi.black', familyId: 'character.yoshi', score: 0.882 },
      { id: 'character.yoshi.yellow', familyId: 'character.yoshi', score: 0.840 }] };
  assert.deepEqual(combineCharacter(visual, { id: 'character.yoshi.yellow', fuzzy: 0.89 }, familyById),
    { id: null, familyId: 'character.yoshi', status: 'conflict',
      evidence: ['visual_name_variant_conflict'], visualTop1: 'character.yoshi.black' });
  assert.equal(combineCharacter(visual, { id: 'character.yoshi.yellow', fuzzy: 1 }, familyById).id,
    'character.yoshi.yellow');
});
