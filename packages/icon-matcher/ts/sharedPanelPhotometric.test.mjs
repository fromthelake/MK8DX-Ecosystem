import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PANEL_PHOTOMETRY, correctPanel } from './sharedPanelPhotometric.ts';

// Same synthetic panels as python/tests/test_panel_photometric.py (no private frames).
function panelImage(gain = 1, offset = 0, noise = false) {
  const rgb = new Uint8Array(1280 * 720 * 3);
  const value = new Float64Array(3);
  for (let y = 0; y < 720; y += 1) {
    for (let x = 0; x < 1280; x += 1) {
      for (let c = 0; c < 3; c += 1) value[c] = (x * 7 + y * 13 + c * 29) % 200 + 20;
      for (const e of PANEL_PHOTOMETRY.elements) {
        const [x0, y0, x1, y1] = e.box;
        if (x >= x0 && x < x1 && y >= y0 && y < y1) for (let c = 0; c < 3; c += 1) value[c] = e.hdmi[c];
      }
      for (let c = 0; c < 3; c += 1) {
        let v = value[c] * gain + offset;
        if (noise) v += (x * 7 + y * 13 + c * 29) % 11 - 5;
        rgb[(y * 1280 + x) * 3 + c] = Math.min(255, Math.max(0, Math.floor(v + 0.5)));
      }
    }
  }
  return rgb;
}

test('the constants equal the reference document', () => {
  const document = JSON.parse(readFileSync(new URL('../python/mk8dx_icon_matcher/references/panel-photometry-v1.json',
    import.meta.url), 'utf8'));
  assert.equal(document.schema, 'mk8dx.panel-photometry.v1');
  assert.deepEqual(PANEL_PHOTOMETRY.canonical, document.canonical);
  assert.deepEqual(PANEL_PHOTOMETRY.elements, document.elements.map(({ name, box, kind, fraction, hdmi }) =>
    ({ name, box, kind, fraction, hdmi })));
});

test('an HDMI panel maps to itself', () => {
  const { record } = correctPanel(panelImage(), 1280, 720);
  assert.equal(record.status, 'corrected');
  assert.ok(record.residual < 1 && record.gain.every((g) => Math.abs(g - 1) < 0.01));
});

test('a flat photo is left alone', () => {
  const { record } = correctPanel(panelImage(0.1, 100), 1280, 720);
  assert.equal(record.status, 'not_corrected');
  assert.equal(record.reason, 'anchor_span');
});

test('parity vector', () => {
  const { record } = correctPanel(panelImage(0.7, 25, true), 1280, 720);
  assert.equal(record.status, 'corrected');
  assert.deepEqual(record.gain.map((v) => Math.round(v * 1e6) / 1e6), [1.439261, 1.339596, 1.424378]);
  assert.deepEqual(record.offset.map((v) => Math.round(v * 1e6) / 1e6), [-36.344757, -24.484343, -36.657721]);
  assert.equal(record.residual, 2.674);
});
