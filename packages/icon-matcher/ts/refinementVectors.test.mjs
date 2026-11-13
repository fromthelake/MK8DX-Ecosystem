// Replays vectors/refinement-v1.json (Python shape_rank/flag_rank/flag_exposure/family_colour/neutral_chroma,
// tools/generate_rule_vectors.py) against the TypeScript refinements on the recognition pack's tensors.
// Each case carries the upstream inputs Python computed (visual read, shape rank, shortlist), so one
// refinement is replayed at a time. Strings, booleans and nulls must be identical, numbers within 1e-6;
// cases flagged boundary (within 1e-5 of a threshold, or a near tie) are reported, not failed.
// Needs a materialized pack: MK8DX_RECOGNITION_PACK=<dir> or MK8DX_SHARED_ICON_PACK=<dir>/tensor-pack.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { rankCharacterFamilyColour } from './sharedFamilyColour.ts';
import { flagBandRatio } from './sharedFlagBandRatio.ts';
import { distinctiveFlagRank } from './sharedFlagDistinctive.ts';
import { flagExposureProposal } from './sharedFlagExposure.ts';
import { flagTricolorEvidence } from './sharedFlagTricolor.ts';
import { rankNeutralChroma } from './sharedNeutralChroma.ts';
import { rankIconShape } from './sharedShapeRank.ts';

const TOLERANCE = 1e-6;
const doc = JSON.parse(readFileSync(new URL('../vectors/refinement-v1.json', import.meta.url), 'utf8'));
const packDir = process.env.MK8DX_SHARED_ICON_PACK
  || (process.env.MK8DX_RECOGNITION_PACK ? join(process.env.MK8DX_RECOGNITION_PACK, 'tensor-pack') : null);
const available = Boolean(packDir && existsSync(join(packDir, 'references.json')));

// Genuine Python/TypeScript differences, kept visible until the owner decides (issue #99).
const KNOWN_DIVERGENCES = new Map();

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

/** Same JSON shape (an absent key equals none), strings/booleans/null equal, numbers within TOLERANCE. */
function close(got, want, path = '$') {
  if (want === null || typeof want !== 'object') {
    if (typeof want === 'number') {
      return typeof got === 'number' && Math.abs(got - want) <= TOLERANCE ? null : `${path}: ${got} != ${want}`;
    }
    return got === want ? null : `${path}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`;
  }
  if (Array.isArray(want)) {
    if (!Array.isArray(got) || got.length !== want.length) return `${path}: length ${got?.length} != ${want.length}`;
    for (let i = 0; i < want.length; i++) {
      const difference = close(got[i], want[i], `${path}[${i}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (got === null || typeof got !== 'object') return `${path}: ${JSON.stringify(got)} is not an object`;
  const keys = [...new Set([...Object.keys(want), ...Object.keys(got).filter((k) => got[k] !== undefined)])].sort();
  for (const key of keys) {
    if (!(key in want)) return `${path}.${key}: unexpected key`;
    const difference = close(got[key], want[key], `${path}.${key}`);
    if (difference) return difference;
  }
  return null;
}

function run(item, group) {
  const bytes = Buffer.from(item.query, 'base64');
  const query = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) query[i] = bytes[i] / 255;
  const inputs = item.inputs;
  const out = {};
  for (const name of item.refinements) {
    if (name === 'shape') out[name] = rankIconShape(query, group, inputs.shapeMode);
    else if (name === 'distinctive') out[name] = distinctiveFlagRank(query, group, inputs.distinctiveIds);
    else if (name === 'bandRatio') out[name] = flagBandRatio(query);
    else if (name === 'tricolor') {
      out[name] = flagTricolorEvidence(query, group, inputs.rawTopIds, inputs.distinctiveTopId, inputs.shape);
    } else if (name === 'exposure') out[name] = flagExposureProposal(query, group, inputs.shape);
    else if (name === 'familyColour') out[name] = rankCharacterFamilyColour(query, group, inputs.visual);
    else if (name === 'neutralChroma') out[name] = rankNeutralChroma(query, group, inputs.visual);
    else throw new Error(`unknown refinement ${name}`);
  }
  return out;
}

test('refinement-v1 is decision-identical to the Python reference', { skip: !available
  && 'recognition pack not materialized (set MK8DX_RECOGNITION_PACK)' }, () => {
  assert.equal(doc.schema, 'mk8dx.refinement-vectors.v1');
  const groups = loadGroups();
  const failures = [];
  const reported = [];
  let replays = 0;
  for (const item of doc.cases) {
    let difference;
    try {
      const got = run(item, groups.get(item.group));
      difference = close(got, item.expected);
    } catch (error) {
      difference = `threw ${error.message}`;
    }
    replays += item.refinements.length;
    if (KNOWN_DIVERGENCES.has(item.id)) {
      reported.push(`${item.id}: ${difference ? 'differs' : 'now EQUAL'} (${KNOWN_DIVERGENCES.get(item.id)})`);
    } else if (difference) {
      (item.boundary ? reported : failures).push(`${item.id}${item.boundary ? ' [boundary]' : ''}: ${difference}`);
    }
  }
  console.log(`refinement-v1: ${doc.cases.length} cases, ${replays} refinement replays`);
  if (reported.length) console.log(`refinement-v1 reported (issue #99):\n  ${reported.join('\n  ')}`);
  assert.deepEqual(failures, []);
});
