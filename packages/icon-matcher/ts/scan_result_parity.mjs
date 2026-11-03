// Scan result parity: the TS module against Python's records.
//   node --experimental-strip-types scan_result_parity.mjs [vectors.json]
import { readFileSync } from 'node:fs';
import { composeScanResult } from './sharedScanResult.ts';

const path = process.argv[2] ?? new URL('../vectors/scan-result-v1.json', import.meta.url);
const doc = JSON.parse(readFileSync(path, 'utf8'));
const canon = (value) => JSON.stringify(value, (_key, v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
let differences = 0;
for (const c of doc.cases) {
  const got = composeScanResult(c.consensus, c.lapCount);
  if (canon(got) !== canon(c.result)) {
    differences++;
    if (differences <= 5) console.log('differs', canon(c.consensus).slice(0, 300), '\n got', canon(got).slice(0, 600), '\n want', canon(c.result).slice(0, 600));
  }
}
console.log(`scan result parity cases=${doc.cases.length} differences=${differences}`);
process.exitCode = differences ? 1 : 0;
