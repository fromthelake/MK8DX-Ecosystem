import assert from 'node:assert/strict';
import test from 'node:test';
import { rankNeutralChroma } from './sharedNeutralChroma.ts';

const pixel = (r, g, b) => [r / 255, g / 255, b / 255];
const group = {
  width: 2, height: 1,
  ids: ['white', 'red', 'blue'], families: ['white', 'red', 'blue'],
  rgb: new Float32Array([
    ...pixel(80, 80, 80), ...pixel(80, 80, 80),
    ...pixel(180, 30, 30), ...pixel(180, 30, 30),
    ...pixel(30, 30, 180), ...pixel(30, 30, 180),
  ]),
  mask: new Uint8Array([1, 1, 1, 1, 1, 1]),
  count: new Float32Array([2, 2, 2]),
};
const visual = (top) => ({ top1Id: top[0].id, top, offset: [0, 0],
  score: top[0].score, status: 'unknown', acceptedId: null });
const item = (id, score) => ({ id, familyId: id, score });

test('a neutral visual winner yields a saturated top-three alternative only as a review', () => {
  const read = visual([item('white', .812), item('red', .801), item('blue', .78)]);
  const result = rankNeutralChroma(new Float32Array([
    ...pixel(180, 30, 30), ...pixel(180, 30, 30),
  ]), group, read);
  assert.equal(result.status, 'alternative');
  assert.equal(result.rawTop1Id, 'white');
  assert.equal(result.proposalId, 'red');
  assert.equal(result.referenceSaturation, 0);
  assert.ok(result.querySaturation > .8);
  assert.equal(read.top[0].id, 'white');
  assert.equal(read.acceptedId, null);
});

test('yellow query pixels and distant candidates cannot trigger the alternative', () => {
  const read = visual([item('white', .812), item('red', .781), item('blue', .78)]);
  const yellow = rankNeutralChroma(new Float32Array([
    ...pixel(200, 180, 20), ...pixel(200, 180, 20),
  ]), group, read);
  assert.equal(yellow.status, 'insufficient_pixels');
  assert.equal(yellow.proposalId, 'white');
  const red = rankNeutralChroma(new Float32Array([
    ...pixel(180, 30, 30), ...pixel(180, 30, 30),
  ]), group, read);
  assert.equal(red.status, 'measured');
  assert.equal(red.proposalId, 'white');
});
