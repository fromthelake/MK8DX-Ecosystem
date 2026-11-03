import assert from 'node:assert/strict';
import test from 'node:test';
import { flagBandRatio } from './sharedFlagBandRatio.ts';

const tricolour = (red, blue, gain = 1) => {
  const out = new Float32Array(38 * 55 * 3);
  for (let y = 0; y < 38; y++) {
    const colour = y < 13 ? red : y < 25 ? [1, 1, 1] : blue;
    for (let x = 0; x < 55; x++) for (let c = 0; c < 3; c++) out[(y * 55 + x) * 3 + c] = Math.min(1, colour[c] * gain);
  }
  return out;
};
const NL = (gain) => tricolour([194 / 255, 57 / 255, 55 / 255], [4 / 255, 89 / 255, 164 / 255], gain);
const LU = tricolour([200 / 255, 59 / 255, 45 / 255], [55 / 255, 148 / 255, 213 / 255]);

test('asset tones decide and a common exposure change keeps the ratio', () => {
  assert.equal(flagBandRatio(NL(1)).decisionId, 'country.nl');
  assert.equal(flagBandRatio(LU).decisionId, 'country.lu');
  assert.ok(Math.abs(flagBandRatio(NL(.7)).ratio - flagBandRatio(NL(1)).ratio) < 1e-6);
});

test('a between tone keeps review and a grey crop has no bands', () => {
  const mid = flagBandRatio(tricolour([.78, .22, .2], [.12, .507, .75]));
  assert.equal(mid.status, 'measured');
  assert.equal(mid.decisionId, null);
  assert.equal(flagBandRatio(new Float32Array(38 * 55 * 3).fill(.5)).status, 'unavailable');
});
