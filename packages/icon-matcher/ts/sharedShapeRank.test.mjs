import assert from 'node:assert/strict';
import test from 'node:test';
import { rankIconShape } from './sharedShapeRank.ts';

test('shape ranking tolerates darker input and ignores a tire background pixel', () => {
  const first = [.1, .1, .1, .8, .8, .8, .2, .2, .2, 0, 0, 0];
  const second = [.8, .8, .8, .1, .1, .1, .7, .7, .7, 0, 0, 0];
  const query = new Float32Array(first.map((value, index) =>
    index >= 9 ? 1 : .25 + .5 * value));
  const group = { width: 2, height: 2,
    ids: ['first', 'second'], families: ['first', 'second'],
    rgb: new Float32Array([...first, ...second]),
    mask: new Uint8Array([1, 1, 1, 0, 1, 1, 1, 0]),
    count: new Float32Array([3, 3]) };
  const ranked = rankIconShape(query, group, 'masked_gray_ncc');
  assert.equal(ranked.top[0].id, 'first');
  assert.ok(ranked.top[0].score > .999);
  assert.ok(ranked.margin > 0);
});

test('flag RGB structure preserves channel order', () => {
  const group = { width: 2, height: 1,
    ids: ['red_left', 'blue_left'], families: ['red_left', 'blue_left'],
    rgb: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0]),
    mask: new Uint8Array([1, 1, 1, 1]), count: new Float32Array([2, 2]) };
  const ranked = rankIconShape(new Float32Array([.8, .1, .1, .1, .1, .8]),
    group, 'full_rgb_ncc');
  assert.equal(ranked.top[0].id, 'red_left');
  assert.ok(ranked.top[0].score > .99);
});
