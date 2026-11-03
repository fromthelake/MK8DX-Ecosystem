// Card registration decision parity: the TS module against Python's records.
//   node --experimental-strip-types card_registration_parity.mjs [vectors.json]
import { readFileSync } from 'node:fs';
import { registerCard } from './sharedFrameGeometry.ts';

const path = process.argv[2] ?? new URL('../vectors/card-registration-v1.json', import.meta.url);
const doc = JSON.parse(readFileSync(path, 'utf8'));
const defs = { registration: doc.registration };
let differences = 0;
for (const c of doc.cases) {
  const fineCalls = [];
  const got = registerCard(defs, c.panel, c.window, {
    coarse: (tw, th) => c.coarse[`${tw}x${th}`] ?? [Number.NaN, 0, 0],
    fine: (...args) => { fineCalls.push(args); return c.fine; },
  });
  if (JSON.stringify(got) !== JSON.stringify(c.result) || JSON.stringify(fineCalls) !== JSON.stringify(c.fineCalls)) {
    differences++;
    if (differences <= 5) console.log('differs', JSON.stringify(got), JSON.stringify(c.result));
  }
}
console.log(`card registration parity cases=${doc.cases.length} differences=${differences}`);
process.exitCode = differences ? 1 : 0;
