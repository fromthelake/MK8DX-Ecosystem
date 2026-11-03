// Lap grid parity: the TS module against Python's records.
//   node --experimental-strip-types lap_grid_parity.mjs <frame-definitions-v1.json> <vectors.json>
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./ts_resolve_hook.mjs', import.meta.url);
const { buildDynamicGrid } = await import('./sharedLapGrid.ts');
const defs = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const doc = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const canon = (v) => JSON.stringify(v, (_k, x) => (typeof x === 'number' ? Math.round(x * 1e9) / 1e9
  : x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
let differences = 0;
for (const c of doc.cases) {
  const got = buildDynamicGrid(defs.timeGrids[c.timeGrid], c.raceKey, c.ghostDetail, c.width, c.height, c.detections, c.lapRows, c.nominal);
  if (canon(got) !== canon(c.result)) {
    differences++;
    if (differences <= 3) console.log('differs', c.raceKey, canon(got).slice(0, 400), '\n want', canon(c.result).slice(0, 400));
  }
}
console.log(`lap grid parity cases=${doc.cases.length} differences=${differences}`);
process.exitCode = differences ? 1 : 0;
