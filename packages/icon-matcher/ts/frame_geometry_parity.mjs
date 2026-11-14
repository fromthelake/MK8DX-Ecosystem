// Frame geometry parity: the TS module against Python's records.
//   node --experimental-strip-types frame_geometry_parity.mjs <frame-definitions-v1.json> <vectors.json>
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./ts_resolve_hook.mjs', import.meta.url);
const fg = await import('./sharedFrameGeometry.ts');
const defs = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const doc = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const KINDS = ['character_icon', 'kart_icon', 'wheel_icon', 'glider_icon', 'flag_icon'];
// numbers to 1e-9 and object keys sorted (the public vectors are written with sorted keys)
const canon = (v) => JSON.stringify(v, (_k, x) => (typeof x === 'number' ? Math.round(x * 1e9) / 1e9
  : x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const near = (a, b) => canon(a) === canon(b);
let differences = 0;
for (const c of doc.cases) {
  const panel = fg.panelBox(defs, c.raceKey, c.owner, c.anchor);
  const got = { panel };
  const want = { panel: c.panel };
  if (panel) {
    const [, laps, ghostDetail] = fg.raceAndLaps(c.raceKey);
    got.registerWindow = fg.registerWindow(defs, panel, c.image[0], c.image[1]);
    want.registerWindow = c.registerWindow;
    const right = fg.textRight(defs, panel, ghostDetail);
    got.textRight = right; want.textRight = c.textRight;
    got.ghostNameRight = fg.ghostNameRight(defs, panel); want.ghostNameRight = c.ghostNameRight;
    for (const kind of KINDS) {
      const slot = fg.slotBox(defs, c.owner, kind, laps, panel, c.registration);
      const entry = { deployBox: fg.deployBox(defs, kind, laps, panel.w, panel.h), slot };
      if (slot) {
        entry.searchWindow = fg.searchWindow(defs, kind, slot, c.image[0], c.image[1]);
        entry.textStrip = fg.textStrip(defs, slot, right);
      }
      got[kind] = entry; want[kind] = c.fields[kind];
    }
  }
  if (!near(got, want)) {
    differences++;
    if (differences <= 5) console.log('differs', JSON.stringify(got).slice(0, 400), '\n want', JSON.stringify(want).slice(0, 400));
  }
}
console.log(`frame geometry parity cases=${doc.cases.length} differences=${differences}`);
process.exitCode = differences ? 1 : 0;
