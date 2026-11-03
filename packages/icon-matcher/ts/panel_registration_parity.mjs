// Panel registration decision parity: the TS module against Python's records.
//   node --experimental-strip-types panel_registration_parity.mjs [vectors.json]
import { readFileSync } from 'node:fs';
import { registerPanel } from './sharedPanelRegistration.ts';

const path = process.argv[2] ?? new URL('../vectors/panel-registration-v1.json', import.meta.url);
const doc = JSON.parse(readFileSync(path, 'utf8'));
const canon = (v) => JSON.stringify(v, (_k, x) => (typeof x === 'number' ? Number(x.toPrecision(12)) : x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
let differences = 0;
for (const c of doc.cases) {
  let seen = null;
  const got = registerPanel(c.variant, c.boxes, c.imageW, c.imageH, {
    match: (i) => c.matches[i],
    homography: (found) => { seen = found; return [c.homography, c.inliers]; },
  });
  if (canon(got) !== canon(c.result) || canon(seen) !== canon(c.found)) {
    differences++;
    if (differences <= 5) console.log('differs', canon(got).slice(0, 300), '\n want', canon(c.result).slice(0, 300));
  }
}
console.log(`panel registration parity cases=${doc.cases.length} differences=${differences}`);
process.exitCode = differences ? 1 : 0;
