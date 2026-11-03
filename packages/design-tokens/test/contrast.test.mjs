// T-TOKENS: contrast on the canonical source, every appearance (ADR-0207 §5, TESTING_STRATEGY §1).
import assert from "node:assert/strict";
import { test } from "node:test";

import { APPEARANCES, color, tokens, webCss, kotlin, scannerCss } from "../generate.mjs";

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const x = lum(hex(a)), y = lum(hex(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (base, top, t) => "#" + hex(base).map((v, i) => Math.round(v * (1 - t) + hex(top)[i] * t).toString(16).padStart(2, "0")).join("");
const hue = (h) => { const [r, g, b] = hex(h).map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; let x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (x * 60 + 360) % 360; };

for (const ap of APPEARANCES) {
  test(`text pairs ≥ minimum in ${ap}`, () => {
    const failures = [];
    for (const [fg, bg, min] of tokens.contrast.text) {
      const r = ratio(color(fg, ap), color(bg, ap));
      if (r < min) failures.push(`${fg} on ${bg}: ${r.toFixed(2)} < ${min}`);
    }
    assert.deepEqual(failures, []);
  });
  test(`tinted chips ≥ 4.5 in ${ap}`, () => {
    const failures = [];
    const t = tokens.semantic.tint[ap] / 100;
    for (const [name] of tokens.contrast.tinted) {
      const c = color(name, ap);
      const bg = mix(color("surface.raised", ap), c, t);
      const r = ratio(c, bg);
      if (r < 4.5) failures.push(`${name} on its ${tokens.semantic.tint[ap]}% tint: ${r.toFixed(2)}`);
    }
    assert.deepEqual(failures, []);
  });
  test(`non-text indicators ≥ 3 in ${ap}`, () => {
    const failures = [];
    for (const [fg, bg, min] of tokens.contrast.nonText) {
      const r = ratio(color(fg, ap), color(bg, ap));
      if (r < min) failures.push(`${fg} on ${bg}: ${r.toFixed(2)} < ${min}`);
    }
    assert.deepEqual(failures, []);
  });
  test(`engine 200 keeps hue distance from the action colour in ${ap}`, () => {
    for (const [a, b, min] of tokens.contrast.hueSeparation) {
      const d = Math.abs(hue(color(a, ap)) - hue(color(b, ap))) % 360;
      assert.ok(Math.min(d, 360 - d) >= min, `${a} vs ${b}: ${Math.min(d, 360 - d).toFixed(0)}°`);
    }
  });
}

test("the frozen engine values are the approved ones", () => {
  assert.equal(color("engine.150", "dark"), "#4DA9FF");
  assert.equal(color("engine.150", "light"), "#1463C9");
  assert.equal(color("engine.200", "dark"), "#FF5C74");
  assert.equal(color("engine.200", "light"), "#BA1F43");
  assert.equal(color("engine.150", "hc"), "#8CC8FF");
  assert.equal(color("engine.200", "hc"), "#FF9AAE");
});

test("semantic colours reference the foundation only (no raw values in the semantic tier)", () => {
  for (const [name, entry] of Object.entries(tokens.semantic.color)) {
    for (const ap of APPEARANCES) assert.match(entry[ap], /^\{palette\./, `${name}.${ap}`);
  }
});

test("adapters contain no CSS or Compose syntax leaking back into the canonical source", () => {
  const raw = JSON.stringify(tokens);
  assert.doesNotMatch(raw, /box-shadow|px;|\.dp\b|\.sp\b|var\(--/);
  assert.match(webCss(), /@layer legacy, tokens, base, components;/);
  assert.match(kotlin(), /object Mk8dxTokens/);
  assert.match(scannerCss(), /--ds-engine-150/);
});
