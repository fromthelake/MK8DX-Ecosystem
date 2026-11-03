import assert from 'node:assert/strict';
import test from 'node:test';
import { correctResultFlagBgr, resultGhostNameWhite } from './sharedResultFlagWhite.ts';

test('result flag white uses same-frame neutral glyphs and leaves source pixels intact', () => {
  const width = 340, height = 70;
  const frame = new Uint8Array(width * height * 3);
  const slot = [300, 5, 20, 20];
  for (let y = 9; y < 54; y++) {
    for (let x = 0; x < 235; x++) {
      const at = (y * width + x) * 3;
      frame.set(x < 150 ? [230, 224, 220] : [20, 220, 240], at);
    }
  }
  const before = frame.slice();
  const anchor = resultGhostNameWhite(frame, width, height, slot);
  assert.deepEqual(anchor?.medianBgr, [230, 224, 220]);
  assert.deepEqual(anchor?.gainsBgr, [1.1, 1.1, 1.1]);
  const crop = Uint8Array.from([100, 150, 200, 250, 10, 30]);
  const corrected = correctResultFlagBgr(crop, anchor.gainsBgr);
  assert.deepEqual([...corrected], [110, 165, 220, 255, 11, 33]);
  assert.deepEqual(frame, before);
  assert.deepEqual([...crop], [100, 150, 200, 250, 10, 30]);
});

test('result flag white refuses a missing or non-neutral name row', () => {
  const frame = new Uint8Array(340 * 70 * 3);
  assert.equal(resultGhostNameWhite(frame, 340, 70, [300, 5, 20, 20]), null);
  assert.equal(resultGhostNameWhite(frame, 340, 70, [100, 5, 20, 20]), null);
});
