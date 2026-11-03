import assert from 'node:assert/strict';
import test from 'node:test';
import { correctCard, parseCardAnchors, parseCardPhotometry } from './sharedCardPresence.ts';

// Same synthetic card as python/tests/test_photometric.py (no private frames).
const DISC = [60, 61, 57]; const DIGIT = [237, 237, 237]; const CARD = [200, 190, 40];
function circle(k) {
  const out = new Uint8Array(33 * 33 * 3);
  for (let y = 0; y < 33; y += 1) for (let x = 0; x < 33; x += 1) {
    let rgb = (x - 16) ** 2 + (y - 16) ** 2 <= 14 ** 2 ? DISC : CARD;
    for (let bar = 0; bar < k; bar += 1) if (y >= 9 && y < 24 && x >= 12 + 4 * bar && x < 14 + 4 * bar) rgb = DIGIT;
    out.set(rgb, (y * 33 + x) * 3);
  }
  return out;
}
const anchors = parseCardAnchors({ schema: 'mk8dx.card-anchors.v1', x: 1018, size: 33, search: 3, threshold: 0.5,
  pitch: { 3: 44 }, slots: { 3: { top: 208 } }, offsets: [0],
  templates: { player: [1, 2, 3].map((k) => Buffer.from(circle(k)).toString('base64')) } });
const photometry = parseCardPhotometry({ schema: 'mk8dx.card-photometry.v1', layouts: {
  3: { fromCharacter: [446.5, 66.5], pitch: 44, disc: DISC, digit: DIGIT } } });
const CHARACTER = [570, 140];
function card() {
  const rgb = new Uint8Array(1280 * 720 * 3);
  for (let i = 0; i < 1280 * 720; i += 1) rgb.set(CARD, i * 3);
  for (const k of [1, 2, 3]) {
    const x = Math.round(CHARACTER[0] + 446.5) - (CHARACTER[0] + 446.5 === 1016.5 ? 1 : 0);
    const y = 140 + 66 + (k - 1) * 44 + (k === 1 ? 0 : 0);
    const tpl = circle(k);
    for (let r = 0; r < 33; r += 1) rgb.set(tpl.subarray(r * 99, (r + 1) * 99), ((y + r) * 1280 + x) * 3);
  }
  return rgb;
}
function camera(rgb, gain, lift, wb) {
  const out = new Uint8Array(rgb.length);
  for (let i = 0; i < rgb.length; i += 1) out[i] = Math.min(255, Math.max(0, Math.floor(rgb[i] * gain * wb[i % 3] + lift + 0.5)));
  return out;
}

test('a darkened cool photo returns to the HDMI colours and HDMI stays as it is', () => {
  const hdmi = card();
  const { rgb, record } = correctCard(camera(hdmi, 0.62, 14, [0.9, 1.0, 1.15]), 1280, 720, CHARACTER, 3, 'player', anchors, photometry);
  assert.equal(record.status, 'corrected'); assert.equal(record.blueClipped, false);
  let worst = 0;
  for (let i = 0; i < rgb.length; i += 1) worst = Math.max(worst, Math.abs(rgb[i] - hdmi[i]));
  assert.ok(worst <= 2, `worst ${worst}`);
  const same = correctCard(hdmi, 1280, 720, CHARACTER, 3, 'player', anchors, photometry);
  assert.equal(same.record.status, 'corrected'); assert.deepEqual(same.rgb, hdmi);
});

test('a flat card is not corrected, a clipped blue white is reported, the other card can lend its correction', () => {
  const flat = new Uint8Array(1280 * 720 * 3).fill(120);
  const none = correctCard(flat, 1280, 720, CHARACTER, 3, 'player', anchors, photometry);
  assert.equal(none.record.status, 'not_corrected');
  const bright = correctCard(camera(card(), 1.25, 0, [1, 1, 1.2]), 1280, 720, CHARACTER, 3, 'player', anchors, photometry);
  assert.equal(bright.record.blueClipped, true);
  const lent = correctCard(flat, 1280, 720, CHARACTER, 3, 'player', anchors, photometry, bright.record);
  assert.equal(lent.record.status, 'corrected'); assert.equal(lent.record.source, 'other_card');
});
