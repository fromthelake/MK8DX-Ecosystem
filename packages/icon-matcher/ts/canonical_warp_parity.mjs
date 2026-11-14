// Canonical warp parity: the TS geometry before the crop (sharedCanonicalWarp.ts) against Python's records
// in vectors/canonical-warp-v1.json (tools/generate_canonical_warp_vectors.py; issue #99 phase 5).
//   node --experimental-strip-types canonical_warp_parity.mjs <canonical-warp-v1.json>
// The constants, the step functions and whole cards; real cards must also equal what the Web scanner
// computed on the public test set.
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./ts_resolve_hook.mjs', import.meta.url);
const cw = await import('./sharedCanonicalWarp.ts');
const doc = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (doc.schema !== 'mk8dx.canonical-warp-vectors.v1') throw new Error('not canonical-warp-v1');
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
let differences = 0;

const constants = {
  canonicalSize: [...cw.CANONICAL_SIZE], playerBoxRace7: [...cw.PLAYER_BOX_RACE7], ghostBoxRace7: [...cw.GHOST_BOX_RACE7],
  ghostDetailBoxRace3: [...cw.GHOST_DETAIL_BOX_RACE3], ghostDetailBoxRace7: [...cw.GHOST_DETAIL_BOX_RACE7],
  antialiasBelowScale: cw.ANTIALIAS_BELOW_SCALE, antialiasTargetScale: cw.ANTIALIAS_TARGET_SCALE,
  contentKeys: [...cw.CONTENT_KEYS],
};
if (canon(constants) !== canon(doc.constants)) {
  differences++;
  console.log('constants differ', canon(constants), '\n want', canon(doc.constants));
}
const helpers = {
  boundingRect: cw.boundingRect, quadFromRect: cw.quadFromRect, shiftedQuad: cw.shiftedQuad, quadBox: cw.quadBox,
  contentExtent: cw.contentExtent, targetBox: cw.targetBox, canonicalAlign: cw.canonicalAlign,
  alignMatrix: cw.alignMatrix, compose: cw.compose, antialiasPlan: cw.antialiasPlan,
};
for (const h of doc.helperCases) {
  const got = helpers[h.fn](...h.args);
  if (canon(got) !== canon(h.expected)) {
    differences++;
    console.log('helper differs', h.fn, canon(h.args), canon(got), 'want', canon(h.expected));
  }
}
let real = 0;
for (const c of doc.cases) {
  const got = cw.canonicalTransform(c);
  let same = canon(got) === canon(c.expected);
  if (c.source !== 'synthetic') {
    real++;
    same = same && ['destination', 'affine', 'composed', 'final', 'warpSource'].every((key) => canon(got[key]) === canon(c.web[key]));
  }
  if (!same) {
    differences++;
    if (differences <= 3) console.log('differs', c.name, canon(got).slice(0, 400), '\n want', canon(c.expected).slice(0, 400));
  }
}
console.log(`canonical warp parity helpers=${doc.helperCases.length} cases=${doc.cases.length} real=${real} differences=${differences}`);
process.exitCode = differences ? 1 : 0;
