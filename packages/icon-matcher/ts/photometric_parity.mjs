// Photometric parity: the TS correction against Python records on private card regions.
//   node --experimental-strip-types photometric_parity.mjs <card-anchors.json> <card-photometry.json> <bundle-dir>
// The bundle comes from tooling/recognition/export_photometric_vectors.py.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { applyCorrection, fitCorrection, measureAnchors, parseCardAnchors, parseCardPhotometry } from './sharedCardPresence.ts';

const [anchorsPath, photometryPath, dir] = process.argv.slice(2);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const anchorsRaw = await readFile(anchorsPath);
const photometryRaw = await readFile(photometryPath);
const anchors = parseCardAnchors(JSON.parse(anchorsRaw.toString('utf8')), sha(anchorsRaw));
const photometry = parseCardPhotometry(JSON.parse(photometryRaw.toString('utf8')), sha(photometryRaw));
const bundle = JSON.parse(await readFile(path.join(dir, 'bundle.json'), 'utf8'));
if (bundle.anchorsSha256 !== anchors.sha256 || bundle.photometrySha256 !== photometry.sha256) throw new Error('bundle made with other files');
let differences = 0; let worst = 0;
for (const item of bundle.cases) {
  const region = await readFile(path.join(dir, 'regions', item.region));
  const [x0, y0, w, h] = item.box;
  const rgb = new Uint8Array(1280 * 720 * 3);
  for (let y = 0; y < h; y += 1) rgb.set(region.subarray(y * w * 3, (y + 1) * w * 3), ((y0 + y) * 1280 + x0) * 3);
  const measured = measureAnchors(rgb, 1280, 720, item.character, item.laps, item.owner, anchors, photometry);
  const correction = fitCorrection(measured, item.laps, photometry);
  const want = item.correction;
  let same = measured.status === item.measured.status && correction.status === want.status;
  if (same && measured.status === 'measured') {
    same = JSON.stringify(measured.circles) === JSON.stringify(item.measured.circles)
      && [0, 1, 2].every((c) => measured.disc[c] === item.measured.disc[c] && measured.digit[c] === item.measured.digit[c]);
  }
  if (same && correction.status === 'corrected') {
    for (let c = 0; c < 3; c += 1) {
      worst = Math.max(worst, Math.abs(correction.gain[c] - want.gain[c]), Math.abs(correction.offset[c] - want.offset[c]));
    }
    same = correction.blueClipped === want.blueClipped
      && sha(applyCorrection(new Uint8Array(region), correction)) === item.correctedSha256;
  } else if (same) {
    same = correction.reason === want.reason;
  }
  if (!same) { differences += 1; if (differences <= 5) console.log('differs', item.region, item.owner); }
}
console.log(`cases=${bundle.cases.length} differences=${differences} maxDelta=${worst.toExponential(2)}`);
process.exitCode = differences || worst > 1e-9 ? 1 : 0;
