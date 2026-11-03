/** Compare the opt-in TypeScript cue with Python on identical private tensors. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rankNeutralChroma } from './sharedNeutralChroma.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const [manifestArg, outputArg] = process.argv.slice(2);
if (!manifestArg || !outputArg) {
  throw new Error('Usage: node shared_neutral_chroma_parity.mjs <private-manifest> <new-private-report>');
}
const manifestPath = resolve(manifestArg);
const outputPath = resolve(outputArg);
if (outputPath === repo || outputPath.startsWith(repo + sep) || existsSync(outputPath)) {
  throw new Error('Choose a new private output outside Git');
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes);
if (manifest.schema !== 'mk8dx.private-neutral-chroma-parity-input.v1'
    || !Array.isArray(manifest.rows) || manifest.rows.length < 1) {
  throw new Error('Invalid parity input');
}
const readPinned = (spec) => {
  if (basename(spec.file) !== spec.file) throw new Error('Tensor path must be a filename');
  const data = readFileSync(resolve(dirname(manifestPath), spec.file));
  if (data.byteLength !== spec.bytes || hash(data) !== spec.sha256) {
    throw new Error(`Tensor hash mismatch: ${spec.file}`);
  }
  return data;
};
const floats = (bytes) => new Float32Array(bytes.buffer.slice(
  bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const { group: meta } = manifest;
const group = { width: meta.width, height: meta.height, ids: meta.ids,
  families: meta.families, rgb: floats(readPinned(meta.rgb)),
  mask: new Uint8Array(readPinned(meta.mask)),
  count: new Float32Array(meta.ids.length) };
const queries = readPinned(manifest.queries);
const rows = [];
for (const row of manifest.rows) {
  const queryBytes = queries.subarray(row.queryOffset, row.queryOffset + row.queryBytes);
  if (queryBytes.byteLength !== row.queryBytes) throw new Error('Query outside tensor file');
  const read = rankNeutralChroma(floats(queryBytes), group, row.visual);
  const expected = row.pythonReview;
  const comparable = ['status', 'rawTop1Id', 'proposalId', 'rawScore',
    'proposalScore', 'referenceSaturation', 'querySaturation', 'offset'];
  const differences = {};
  for (const key of comparable) {
    if (typeof read[key] === 'number') {
      if (Math.abs(read[key] - expected[key]) > 1e-6) {
        differences[key] = [expected[key], read[key]];
      }
    } else if (Array.isArray(read[key])) {
      if (JSON.stringify(read[key]) !== JSON.stringify(expected[key])) {
        differences[key] = [expected[key], read[key]];
      }
    } else if (read[key] !== expected[key]) {
      differences[key] = [expected[key], read[key]];
    }
  }
  if (read.considered.length !== expected.considered.length
      || read.considered.some((item, index) =>
        item.id !== expected.considered[index]?.id
        || Math.abs(item.referenceSaturation
          - expected.considered[index].referenceSaturation) > 1e-6)) {
    differences.considered = [expected.considered, read.considered];
  }
  rows.push({ caseId: row.caseId, family: row.family, cropSha256: row.cropSha256,
    pythonStatus: expected.status, tsStatus: read.status,
    pythonProposalId: expected.proposalId, tsProposalId: read.proposalId,
    pythonQuerySaturation: expected.querySaturation,
    tsQuerySaturation: read.querySaturation, differences });
}
const disagreements = rows.filter((row) => Object.keys(row.differences).length);
const report = { schema: 'mk8dx.private-neutral-chroma-ts-parity.v1',
  manifestSha256: hash(manifestBytes), catalogSha256: manifest.catalogSha256,
  count: rows.length, exactWithin1e6: rows.length - disagreements.length,
  sameStatus: rows.filter((row) => row.pythonStatus === row.tsStatus).length,
  sameProposal: rows.filter((row) => row.pythonProposalId === row.tsProposalId).length,
  disagreements, rows,
  limits: ['Previously exposed crops, no labels or product-route assertion.',
    'Byte-identical Tensor input after Python/OpenCV crop resize; browser cv.js resize still needs a route gate.'] };
writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ outputPath, sha256: hash(readFileSync(outputPath)),
  count: report.count, exactWithin1e6: report.exactWithin1e6,
  sameStatus: report.sameStatus, sameProposal: report.sameProposal,
  firstDisagreements: disagreements.slice(0, 5) }, null, 2));
