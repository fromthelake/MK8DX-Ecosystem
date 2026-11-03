import assert from 'node:assert/strict';
import test from 'node:test';
import { flagInset, searchFlagWindow } from './sharedFlagWindow.ts';

// Same synthetic vectors as python/tests/test_flag_window.py and Java FlagWindowTest.
const shifted = (l, t, w) => 0.9 - 0.01 * Math.abs(l - 11) - 0.015 * Math.abs(t - 3) + ((l * 7 + t * 13) % 5) * 0.0005
  - (w === 55 ? 0.05 : 0);
const slot = (l, t, w) => 0.8 - 0.02 * Math.abs(l - 5) - 0.02 * Math.abs(t - 5) + (w === 55 ? 0.01 : 0);

test('the border inset follows the slot height', () => {
  assert.deepEqual([flagInset(38), flagInset(20), flagInset(64)], [2, 2, 4]);
});

test('a better inset position wins and a tight full slot stays', () => {
  const got = searchFlagWindow(65, 48, [5, 5, 55, 38], shifted);
  assert.deepEqual(got.cropXywh, [7, 3, 51, 34]); assert.equal(got.basis, 'window_search');
  assert.equal(got.evaluated, 117); assert.ok(Math.abs(got.score - 0.8615) < 1e-9);
  const stay = searchFlagWindow(65, 48, [5, 5, 55, 38], slot);
  assert.deepEqual(stay.cropXywh, [5, 5, 55, 38]); assert.equal(stay.basis, 'fixed_slot'); assert.equal(stay.evaluated, 113);
});
