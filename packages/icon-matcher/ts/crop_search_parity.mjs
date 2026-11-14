// Crop search parity: the TS decision (sharedCropSearch.ts) against Python's records in
// vectors/crop-search-v1.json (tools/generate_crop_search_vectors.py; issue #99 phase 3).
//   node --experimental-strip-types crop_search_parity.mjs <crop-search-v1.json>
// Synthetic cases and real crops from the public test set; real cases must also equal what the Web
// scanner decided on the same canonical card.
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./ts_resolve_hook.mjs', import.meta.url);
const { decideField } = await import('./sharedCropSearch.ts');
const doc = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (doc.schema !== 'mk8dx.crop-search-vectors.v1') throw new Error('not crop-search-v1');
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
let differences = 0;
let real = 0;
for (const c of doc.cases) {
  const got = decideField(c);
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
console.log(`crop search parity cases=${doc.cases.length} real=${real} differences=${differences}`);
process.exitCode = differences ? 1 : 0;
