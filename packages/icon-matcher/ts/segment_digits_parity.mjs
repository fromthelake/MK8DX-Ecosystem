// 7-segment matcher parity: the TS module against Python's records.
//   node --experimental-strip-types segment_digits_parity.mjs <vectors.json>
// Vectors come from tooling/recognition/segment_digit_vectors.py.
import { readFileSync } from 'node:fs';
import { bestSegmentCandidate, segmentScores, segmentTemplateFromRgba, SEGMENT_KEYS } from './sharedSegmentDigits.ts';

const doc = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const templates = {};
for (const [kind, t] of Object.entries(doc.templates)) {
  const rgb = Buffer.from(t.rgb, 'base64');
  const rgba = new Uint8Array(t.width * t.height * 4);
  for (let i = 0; i < t.width * t.height; i++) {
    rgba[i * 4] = rgb[i * 3]; rgba[i * 4 + 1] = rgb[i * 3 + 1]; rgba[i * 4 + 2] = rgb[i * 3 + 2]; rgba[i * 4 + 3] = 255;
  }
  templates[kind] = segmentTemplateFromRgba(rgba, t.width, t.height);
}
const close = (a, b) => Math.abs(a - b) <= 1e-9;
function same(got, want) {
  if (want === null || got === null) return want === got;
  if (got.pattern !== want.pattern || got.decoded !== want.decoded || got.valid !== want.valid
      || got.onCount !== want.onCount || got.x !== want.x || got.y !== want.y || got.w !== want.w || got.h !== want.h) return false;
  if (!close(got.confidence, want.confidence) || !close(got.margin, want.margin)
      || !close(got.scaleX, want.scaleX) || !close(got.scaleY, want.scaleY)) return false;
  return SEGMENT_KEYS.every((k, i) => close(got.values[k], want.values[i]));
}
let differences = 0;
for (const c of doc.cases) {
  const binary = new Uint8Array(Buffer.from(c.binary, 'base64'));
  const best = bestSegmentCandidate(binary, c.width, c.height, templates[c.kind], c.kind, c.slot);
  const bestRequired = c.required ? bestSegmentCandidate(binary, c.width, c.height, templates[c.kind], c.kind, c.slot, c.required) : null;
  const scores = segmentScores(binary, c.width, c.height);
  const ok = same(best, c.best) && same(bestRequired, c.bestRequired)
    && SEGMENT_KEYS.every((k, i) => close(scores[k], c.segmentScores[i]));
  if (!ok) { differences++; if (differences <= 5) console.log('differs', c.id, c.kind, c.slot, best?.decoded, c.best?.decoded); }
}
console.log(`vectors=${doc.cases.length} differences=${differences}`);
process.exitCode = differences ? 1 : 0;
