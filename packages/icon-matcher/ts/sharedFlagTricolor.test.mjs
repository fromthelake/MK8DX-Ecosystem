import assert from 'node:assert/strict';
import test from 'node:test';
import { flagTricolorEvidence } from './sharedFlagTricolor.ts';

const width = 55;
const height = 38;
const pixels = width * height;
const ids = ['country.nl', 'country.lu', 'country.py',
  ...Array.from({ length: 107 }, (_, index) => `country.test_${index}`)];
const rgb = new Float32Array(ids.length * pixels * 3);
const colours = {
  'country.nl': [[.76, .22, .21], [1, 1, 1], [.02, .35, .64]],
  'country.lu': [[.78, .23, .18], [1, 1, 1], [.22, .58, .84]],
  'country.py': [[.88, .21, .18], [1, 1, 1], [0, .34, .65]],
};
for (let index = 0; index < ids.length; index++) {
  const stripes = colours[ids[index]] ?? [[.4, .3, .2], [.7, .6, .5], [.3, .4, .5]];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const colour = stripes[y < 15 ? 0 : y < 23 ? 1 : 2];
    for (let channel = 0; channel < 3; channel++) {
      rgb[(index * pixels + y * width + x) * 3 + channel] = colour[channel];
    }
    if (ids[index] === 'country.py' && y >= 17 && y < 21 && x >= 24 && x < 31) {
      rgb[(index * pixels + y * width + x) * 3] = .4;
    }
  }
}
const group = { width, height, ids, families: ids, rgb,
  mask: new Uint8Array(ids.length * pixels).fill(1),
  count: new Float32Array(ids.length).fill(pixels) };
const reference = (id) => rgb.subarray(ids.indexOf(id) * pixels * 3,
  (ids.indexOf(id) + 1) * pixels * 3);

test('a Netherlands tricolour can clear the country-specific evidence check', () => {
  const result = flagTricolorEvidence(reference('country.nl'), group,
    ['country.nl', 'country.lu', 'country.py'], 'country.nl');
  assert.equal(result.acceptedId, 'country.nl');
  assert.ok(result.stripeContrast > result.stripeBoundary);
  assert.ok(result.pairAdvantages.every((row) => row.advantage > 0));
});

test('a saturated Luxembourg near-match and a Paraguay emblem cannot become NL', () => {
  const lu = Float32Array.from(reference('country.lu'), (value) =>
    Math.min(1, Math.max(0, .5 + (value - .5) * 1.4)));
  assert.equal(flagTricolorEvidence(lu, group,
    ['country.nl', 'country.lu', 'country.py'], 'country.nl').acceptedId, null);
  assert.equal(flagTricolorEvidence(reference('country.py'), group,
    ['country.nl', 'country.py', 'country.lu'], 'country.nl').acceptedId, null);
  assert.equal(flagTricolorEvidence(reference('country.nl'), group,
    ['country.nl', 'country.lu', 'country.py'], 'country.lu').acceptedId, null);
});

test('blue-channel camera gain does not hide the darker NL blue band', () => {
  const nl = Float32Array.from(reference('country.nl'));
  for (let y = 23; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 3;
    nl[at + 2] = Math.min(1, nl[at + 2] * 1.2);
  }
  const result = flagTricolorEvidence(nl, group,
    ['country.nl', 'country.lu', 'country.py'], 'country.nl');
  assert.equal(result.acceptedId, 'country.nl');
});

test('a decisive LU stripe and independent pattern can change only the first proposal', () => {
  const shape = { mode: 'full_rgb_ncc', margin: .049,
    top: [{ id: 'country.lu', score: .966 }, { id: 'country.nl', score: .917 }] };
  const lu = flagTricolorEvidence(reference('country.lu'), group,
    ['country.nl', 'country.py', 'country.test_0'], 'country.nl', shape);
  assert.equal(lu.proposalId, 'country.lu');
  assert.equal(lu.proposalShapeScore, .966);
  assert.equal(lu.acceptedId, null);
  assert.equal(lu.reason, 'lu_pattern_and_stripe_agree');
  assert.equal(flagTricolorEvidence(reference('country.nl'), group,
    ['country.nl', 'country.py', 'country.test_0'], 'country.nl', shape).proposalId, undefined);
  assert.equal(flagTricolorEvidence(reference('country.py'), group,
    ['country.nl', 'country.py', 'country.test_0'], 'country.nl', shape).proposalId, undefined);
  assert.equal(flagTricolorEvidence(reference('country.lu'), group,
    ['country.nl', 'country.py', 'country.test_0'], 'country.nl').proposalId, undefined);
});
