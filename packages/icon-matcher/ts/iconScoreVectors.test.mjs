// Replays vectors/icon-score-v1.json (Python matcher.py, tools/generate_vectors.py) against
// sharedIconScorer.ts matchIconTensor on the recognition pack's tensors. Decisions must be identical,
// scores within 1e-6; cases flagged boundary/nearTie (within 1e-5 of the 0.80/0.02 gates, or a top-3 gap
// under 1e-6) are reported, not failed, until the score arithmetic is unified (issue #99, divergence 5).
// Needs a materialized pack: MK8DX_RECOGNITION_PACK=<dir> or MK8DX_SHARED_ICON_PACK=<dir>/tensor-pack.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { matchIconTensor } from './sharedIconScorer.ts';

const TOLERANCE = 1e-6;
const doc = JSON.parse(readFileSync(new URL('../vectors/icon-score-v1.json', import.meta.url), 'utf8'));
const packDir = process.env.MK8DX_SHARED_ICON_PACK
  || (process.env.MK8DX_RECOGNITION_PACK ? join(process.env.MK8DX_RECOGNITION_PACK, 'tensor-pack') : null);
const available = Boolean(packDir && existsSync(join(packDir, 'references.json')));

function pinned(spec) {
  const data = readFileSync(join(packDir, spec.file));
  assert.equal(createHash('sha256').update(data).digest('hex'), spec.sha256, spec.file);
  return data;
}
const floats = (data) => new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));

function loadGroups() {
  const manifest = JSON.parse(readFileSync(join(packDir, 'references.json'), 'utf8'));
  assert.equal(manifest.catalogSha256, doc.catalogSha256, 'vectors were generated from another pack');
  const groups = new Map();
  for (const key of Object.keys(doc.tensors)) {
    const spec = manifest.groups[key];
    for (const part of ['rgb', 'mask', 'count']) assert.equal(spec.tensors[part].sha256, doc.tensors[key][part]);
    groups.set(key, { width: spec.size[0], height: spec.size[1], ids: spec.ids, families: spec.families,
      rgb: floats(pinned(spec.tensors.rgb)), mask: new Uint8Array(pinned(spec.tensors.mask)),
      count: floats(pinned(spec.tensors.count)) });
  }
  return groups;
}

const decision = (r) => JSON.stringify([r.status, r.top1Id, r.acceptedId, r.top.map((c) => c.id), r.offset]);
const scores = (r) => [r.score, r.margin, r.familyMargin, ...r.top.map((c) => c.score)];
const close = (a, b) => a.every((x, i) => (x === null) === (b[i] === null)
  && (x === null || Math.abs(x - b[i]) <= TOLERANCE));

test('icon-score-v1 is decision-identical to the Python reference', { skip: !available
  && 'recognition pack not materialized (set MK8DX_RECOGNITION_PACK)' }, () => {
  assert.equal(doc.schema, 'mk8dx.icon-score-vectors.v1');
  const groups = loadGroups();
  const failures = [];
  const reported = [];
  let maxScoreDelta = 0;
  let replays = 0;
  for (const item of doc.cases) {
    const bytes = Buffer.from(item.query, 'base64');
    const query = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) query[i] = bytes[i] / 255;
    for (const [mode, want] of Object.entries(item.expected)) {
      const got = matchIconTensor(query, groups.get(item.group), mode);
      replays++;
      const delta = Math.max(...scores(got).map((x, i) => (x === null ? 0 : Math.abs(x - scores(want)[i]))));
      maxScoreDelta = Math.max(maxScoreDelta, delta);
      if (decision(got) === decision(want) && close(scores(got), scores(want))) continue;
      const entry = `${item.id} ${mode}: python ${decision(want)} ${want.score}/${want.margin}`
        + ` ts ${decision(got)} ${got.score}/${got.margin}`;
      (item.boundary || item.nearTie ? reported : failures).push(entry);
    }
  }
  console.log(`icon-score-v1: ${replays} replays, max |score delta| ${maxScoreDelta.toExponential(2)}`);
  if (reported.length) console.log(`icon-score-v1 boundary differences (issue #99):\n  ${reported.join('\n  ')}`);
  assert.deepEqual(failures, []);
});
