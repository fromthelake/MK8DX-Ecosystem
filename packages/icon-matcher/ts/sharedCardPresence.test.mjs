import assert from 'node:assert/strict';
import test from 'node:test';
import { cardPresence, parseCardAnchors } from './sharedCardPresence.ts';

// Same synthetic screen as python/tests/test_card_presence.py (no private frames).
function circle(k) {
  const out = new Uint8Array(33 * 33 * 3);
  for (let y = 0; y < 33; y += 1) for (let x = 0; x < 33; x += 1) {
    const inside = (x - 16) ** 2 + (y - 16) ** 2 <= 14 ** 2;
    let rgb = inside ? [48, 50, 56] : [92, 92, 98];
    for (let bar = 0; bar < k; bar += 1) if (y >= 9 && y < 24 && x >= 12 + 4 * bar && x < 14 + 4 * bar) rgb = [245, 245, 245];
    out.set(rgb, (y * 33 + x) * 3);
  }
  return out;
}
const anchors = parseCardAnchors({ schema: 'mk8dx.card-anchors.v1', x: 1018, size: 33, search: 3, threshold: 0.5,
  pitch: { 3: 44, 7: 32 }, slots: { 3: { top: 208, bottom: 441 }, 7: { top: 122, bottom: 424 } }, offsets: [0, -30],
  templates: { ghost: [1, 2, 3].map((k) => Buffer.from(circle(k)).toString('base64')) } });
function screen(circles, y = 208, pitch = 44, dy = 0) {
  const rgb = new Uint8Array(1280 * 720 * 3);
  for (let r = 0; r < 720; r += 1) for (let c = 0; c < 1280; c += 1) {
    rgb.set([(c * 7 + r * 13) % 60 + 120, (c * 11 + r * 5) % 50 + 110, (c * 3 + r * 17) % 40 + 130], (r * 1280 + c) * 3);
  }
  for (const k of circles) {
    const top = y + dy + (k - 1) * pitch; const tpl = circle(k);
    for (let r = 0; r < 33; r += 1) rgb.set(tpl.subarray(r * 99, (r + 1) * 99), ((top + r) * 1280 + 1018) * 3);
  }
  return rgb;
}

test('three circles at a slot are a card, one circle or none is not', () => {
  const got = cardPresence(screen([1, 2, 3], 208, 44, 2), 1280, 720, anchors, 'ghost', 3);
  assert.equal(got.present, true); assert.equal(got.slot, 'top'); assert.equal(got.y, 208); assert.equal(got.circleY, 210);
  assert.equal(cardPresence(screen([1]), 1280, 720, anchors, 'ghost', 3).present, false);
  assert.equal(cardPresence(screen([]), 1280, 720, anchors, 'ghost', 3).present, false);
});

test('the other owner slot is skipped and the 7-lap footer layout is found', () => {
  assert.equal(cardPresence(screen([1, 2, 3]), 1280, 720, anchors, 'ghost', 3, 'top').present, false);
  const seven = cardPresence(screen([1, 2, 3], 394, 32), 1280, 720, anchors, 'ghost', 7);
  assert.equal(seven.slot, 'bottom'); assert.equal(seven.best.offset, -30);
});
