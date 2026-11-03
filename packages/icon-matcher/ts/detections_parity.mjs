// Detector post-processing parity: the TS module against Python's records.
//   node --experimental-strip-types detections_parity.mjs [vectors.json]
import { readFileSync } from 'node:fs';
import { cleanLapIndex, parseDetections } from './sharedDetections.ts';

const path = process.argv[2] ?? new URL('../vectors/detections-v1.json', import.meta.url);
const doc = JSON.parse(readFileSync(path, 'utf8'));
let differences = 0;
for (const c of doc.raw) {
  const got = parseDetections(new Float32Array(c.boxes), new Float32Array(c.logits), c.count, c.numClasses, c.width, c.height);
  if (JSON.stringify(got) !== JSON.stringify(c.result)) {
    differences++;
    if (differences <= 3) console.log('raw differs', JSON.stringify(got).slice(0, 300), '\n want', JSON.stringify(c.result).slice(0, 300));
  }
}
for (const c of doc.layouts) {
  const out = cleanLapIndex(c.detections);
  const got = out.map((d) => c.detections.indexOf(d));
  if (JSON.stringify(got) !== JSON.stringify(c.result)) {
    differences++;
    if (differences <= 5) console.log('layout differs', JSON.stringify(got), JSON.stringify(c.result));
  }
}
console.log(`detections parity raw=${doc.raw.length} layouts=${doc.layouts.length} differences=${differences}`);
process.exitCode = differences ? 1 : 0;
