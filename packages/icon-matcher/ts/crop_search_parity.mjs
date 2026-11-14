// Crop search parity: the TS decision (sharedCropSearch.ts) against Python's records in
// vectors/crop-search-v1.json (tools/generate_crop_search_vectors.py; issue #99 phases 3 and 4).
//   node --experimental-strip-types crop_search_parity.mjs <crop-search-v1.json>
// The constants and step functions the Web scanner calls, synthetic cases and real crops from the public
// test set; real cases must also equal what the Web scanner decided on the same canonical card.
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./ts_resolve_hook.mjs', import.meta.url);
const cs = await import('./sharedCropSearch.ts');
const doc = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (doc.schema !== 'mk8dx.crop-search-vectors.v1') throw new Error('not crop-search-v1');
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
let differences = 0;

const constants = {
  characterScales: [...cs.CHARACTER_SCALES], searchPx: { ...cs.SEARCH_PX }, boostMargin: cs.BOOST_MARGIN,
  boostSatMin: cs.BOOST_SAT_MIN, boostSatMax: cs.BOOST_SAT_MAX, boostSatTarget: cs.BOOST_SAT_TARGET,
  boostMaxFactor: cs.BOOST_MAX_FACTOR, windowGainMin: cs.WINDOW_GAIN_MIN, windowGainMax: cs.WINDOW_GAIN_MAX,
  minWindowMean: cs.MIN_WINDOW_MEAN, minTemplatePx: cs.MIN_TEMPLATE_PX, minCropPx: cs.MIN_CROP_PX,
  minTemplateSum: cs.MIN_TEMPLATE_SUM,
};
if (canon(constants) !== canon(doc.constants)) {
  differences++;
  console.log('constants differ', canon(constants), '\n want', canon(doc.constants));
}
const helpers = {
  searchPx: cs.searchPx, searchWindow: cs.searchWindow, windowGain: cs.windowGain,
  votes: (id, total, subset) => cs.votes(id, total, subset === null ? null : new Set(subset)),
  pickedShift: cs.pickedShift, acceptShift: cs.acceptShift, boostRegion: cs.boostRegion,
  boostFactor: cs.boostFactor, lookBox: cs.lookBox, betterLook: cs.betterLook, cropBox: cs.cropBox,
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
  const got = cs.decideField(c);
  let same = canon(got) === canon(c.expected);
  if (c.source !== 'synthetic') {
    real++;
    same = same && ['scale', 'dx', 'dy', 'score'].every((key) => got[key] === c.web[key])
      && (c.web.cropBox === null || canon(got.cropBox) === canon(c.web.cropBox));
  }
  if (!same) {
    differences++;
    if (differences <= 3) console.log('differs', c.name, canon(got).slice(0, 400), '\n want', canon(c.expected).slice(0, 400));
  }
}
console.log(`crop search parity helpers=${doc.helperCases.length} cases=${doc.cases.length} real=${real} differences=${differences}`);
process.exitCode = differences ? 1 : 0;
