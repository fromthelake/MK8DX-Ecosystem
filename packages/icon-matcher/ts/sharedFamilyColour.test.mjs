import assert from 'node:assert/strict';
import test from 'node:test';
import { rankCharacterFamilyColour } from './sharedFamilyColour.ts';

test('variant colour uses the common eroded asset alpha, not the crop background', () => {
  const width = 5;
  const height = 5;
  const pixels = width * height;
  const rgb = new Float32Array(2 * pixels * 3);
  const mask = new Uint8Array(2 * pixels);
  for (let member = 0; member < 2; member++) {
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) {
      const pixel = y * width + x;
      mask[member * pixels + pixel] = 1;
      const at = (member * pixels + pixel) * 3;
      rgb.set(member === 0 ? [.8, .1, .1] : [.1, .2, .8], at);
    }
  }
  const group = { width, height, ids: ['red', 'blue'], families: ['same', 'same'],
    rgb, mask, count: new Float32Array([9, 9]) };
  const primary = { status: 'unknown', top1Id: 'red', acceptedId: null,
    score: .82, margin: .005, familyMargin: null, offset: [0, 0],
    top: [{ id: 'red', familyId: 'same', score: .82 },
      { id: 'blue', familyId: 'same', score: .815 }] };
  const query = new Float32Array(pixels * 3);
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) {
    query.set([.1, .2, .8], (y * width + x) * 3);
  }
  const first = rankCharacterFamilyColour(query, group, primary, 1);
  assert.equal(first?.status, 'measured');
  assert.equal(first?.observedPixels, 1);
  assert.equal(first?.top[0].id, 'blue');
  for (let x = 0; x < width; x++) query.set([1, 0, 0], x * 3);
  const changedBackground = rankCharacterFamilyColour(query, group, primary, 1);
  assert.deepEqual(changedBackground?.top, first?.top);
});
