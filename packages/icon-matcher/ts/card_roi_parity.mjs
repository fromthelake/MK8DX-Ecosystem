// Card ROI parity: a TS card ROI module against Python's records.
//   node --experimental-strip-types card_roi_parity.mjs [vectors.json] [module.ts]
// The module defaults to ./sharedCardRoi.ts; pass the Web scanner's src/engine/roi.ts to compare
// the original port.
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./ts_resolve_hook.mjs', import.meta.url);
const path = process.argv[2] ?? new URL('../vectors/card-roi-v1.json', import.meta.url);
const modulePath = process.argv[3] ? pathToFileURL(process.argv[3]).href : './sharedCardRoi.ts';
const { AutoCardRoiSelector, Box } = await import(modulePath);
const doc = JSON.parse(readFileSync(path, 'utf8'));
const selector = new AutoCardRoiSelector();
const box = (b) => (b ? b.toArray() : null);
const candidateDict = (c) => {
  if (!c) return null;
  const out = {};
  for (const [k, v] of Object.entries(c)) out[k] = v instanceof Box ? v.toArray() : v;
  return out;
};
const selectionDict = (s, ownerBoxes = true) => (s ? {
  status: s.status, reason: s.reason, selectedReason: s.selectedReason, fallbackUsed: s.fallbackUsed, counts: s.counts,
  roi: box(s.roi), candidate: candidateDict(s.candidate),
  playerOwnerBox: ownerBoxes ? box(s.playerOwnerBox) : null, ghostOwnerBox: ownerBoxes ? box(s.ghostOwnerBox) : null,
} : null);
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
let differences = 0;
const check = (label, got, want) => {
  if (canon(got) === canon(want)) return;
  differences++;
  if (differences <= 4) console.log(label, 'differs\n got ', canon(got).slice(0, 600), '\n want', canon(want).slice(0, 600));
};
for (const c of doc.endScreens) {
  const refs = c.yellow.map((r) => new Box(r[0], r[1], r[2], r[3]));
  check('select', selectionDict(selector.select(c.detections, c.width, c.height, refs)), c.select);
  check('sparse', selectionDict(selector.selectSparseDualYellowCandidate(c.detections, c.width, c.height, refs), false), c.sparse);
}
for (const c of doc.ghostDetails) {
  check('ghostDetail', selectionDict(selector.selectGhostDetail(c.detections, c.width, c.height)), c.selectGhostDetail);
}
console.log(`card roi parity end=${doc.endScreens.length} ghost=${doc.ghostDetails.length} differences=${differences}`);
process.exitCode = differences ? 1 : 0;
