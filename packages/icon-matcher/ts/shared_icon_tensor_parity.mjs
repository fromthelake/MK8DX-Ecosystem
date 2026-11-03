/** Compare the portable RGB scorer with Python on identical private tensors. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { matchIconTensor } from './sharedIconScorer.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const [manifestArg, candidateArg, outputArg, populationArg] = process.argv.slice(2);
if (!manifestArg || !candidateArg || !outputArg) {
  throw new Error('Usage: node shared_icon_tensor_parity.mjs <private-manifest> <python-report> <new-private-report> [python-population]');
}
const manifestPath = resolve(manifestArg);
const outputPath = resolve(outputArg);
if (outputPath === repo || outputPath.startsWith(repo + sep) || existsSync(outputPath)) {
  throw new Error('Choose a new private output outside Git');
}
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function readPinned(root, spec) {
  if (basename(spec.file) !== spec.file) throw new Error('Tensor path must be a filename');
  const data = readFileSync(resolve(root, spec.file));
  if (data.byteLength !== spec.bytes || hash(data) !== spec.sha256) throw new Error(`Tensor hash mismatch: ${spec.file}`);
  return data;
}
function asFloats(data) {
  const copy = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return new Float32Array(copy);
}
function nearestRank(values, fraction) {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}
function median(values) {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
const manifestBytes = readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes);
const pythonBytes = readFileSync(resolve(candidateArg));
const python = JSON.parse(pythonBytes);
const populationBytes = populationArg ? readFileSync(resolve(populationArg)) : null;
const population = populationBytes ? JSON.parse(populationBytes) : null;
if (manifest.schema !== 'mk8dx.private-shared-icon-tensor-parity.v1'
    || python.schema !== 'mk8dx.private-shared-character-profile-benchmark.v1'
    || manifest.catalogSha256 !== python.catalogSha256
    || manifest.inputSha256.tt !== python.inputSha256.tt
    || manifest.inputSha256.tournament !== python.inputSha256.tournament) {
  throw new Error('Unpaired tensor and Python benchmark inputs');
}
if ((manifest.inputSha256.population !== null) !== (population !== null)
    || (population && (population.schema !== 'mk8dx.private-icon-reference-population-probe.v1'
      || population.catalogSha256 !== manifest.catalogSha256
      || hash(populationBytes) !== manifest.inputSha256.population))) {
  throw new Error('Unpaired reference population');
}
const root = dirname(manifestPath);
const queryBytes = readPinned(root, manifest.queryTensor);
const groups = new Map();
for (const [key, value] of Object.entries(manifest.groups)) {
  groups.set(key, { width: value.size[0], height: value.size[1],
    ids: value.ids, families: value.families,
    rgb: asFloats(readPinned(root, value.tensors.rgb)),
    mask: new Uint8Array(readPinned(root, value.tensors.mask)),
    count: asFloats(readPinned(root, value.tensors.count)) });
}
const oldRows = new Map(python.rows.map((row) => [row.caseId, row]));
const populationRows = new Map((population?.rows ?? []).map((row) => [
  `${row.kind}/${row.profile}/${row.truth}/${row.treatment}`, row]));
const captureQueries = manifest.queries.filter((query) => query.origin === 'capture');
const flagQueries = manifest.queries.filter((query) => query.origin === 'flag_capture');
if (oldRows.size !== 791 || populationRows.size !== (population ? 1376 : 0)
    || captureQueries.length !== (manifest.inputSha256.capture ? 448 : 0)
    || flagQueries.length !== (manifest.flagInputSha256 ? 113 : 0)
    || manifest.queries.length !== 791 + populationRows.size + captureQueries.length + flagQueries.length) {
  throw new Error('Unexpected paired case count');
}
const byProfile = new Map();
const disagreements = [];
for (const query of manifest.queries) {
  const expected = query.origin === 'population' ? populationRows.get(query.caseId)
    : query.origin === 'capture' || query.origin === 'flag_capture' ? query : oldRows.get(query.caseId);
  const cropHash = query.origin === 'population' ? expected?.cropPixelSha256 : expected?.cropSha256;
  if (!expected || expected.profile !== query.profile || cropHash !== query.cropSha256
      || !['population', 'saved_crop', 'capture', 'flag_capture'].includes(query.origin)) {
    throw new Error(`Query provenance mismatch: ${query.caseId}`);
  }
  const group = groups.get(`${query.kind}__${query.profile}`);
  if (!group) throw new Error(`Missing reference tensor: ${query.profile}`);
  const data = queryBytes.subarray(query.offset, query.offset + query.bytes);
  if (data.length !== query.bytes) throw new Error('Query tensor offset outside file');
  const started = performance.now();
  const actual = matchIconTensor(asFloats(data), group, query.searchMode);
  const elapsed = performance.now() - started;
  const pythonResult = query.origin === 'population'
    ? { top1: expected.top1, id: expected.accepted, score: expected.score, margin: expected.margin }
    : query.origin === 'capture' || query.origin === 'flag_capture' ? expected.expected : expected.shortlistCandidate;
  const status = pythonResult.id === null ? 'unknown' : 'accepted';
  const key = `${query.kind}/${query.profile}/${query.origin}`;
  if (!byProfile.has(key)) byProfile.set(key, { count: 0, top1Equal: 0, acceptanceEqual: 0,
    scoreDeltaMax: 0, marginDeltaMax: 0, elapsed: [] });
  const summary = byProfile.get(key);
  summary.count++;
  summary.top1Equal += actual.top1Id === pythonResult.top1 ? 1 : 0;
  summary.acceptanceEqual += actual.acceptedId === pythonResult.id ? 1 : 0;
  summary.scoreDeltaMax = Math.max(summary.scoreDeltaMax, Math.abs(actual.score - pythonResult.score));
  summary.marginDeltaMax = Math.max(summary.marginDeltaMax, Math.abs(actual.margin - pythonResult.margin));
  summary.elapsed.push(elapsed);
  if (actual.top1Id !== pythonResult.top1 || actual.acceptedId !== pythonResult.id
      || actual.status !== status) {
    disagreements.push({ caseId: query.caseId, profile: key,
      pythonTop1: pythonResult.top1, jsTop1: actual.top1Id,
      pythonAccepted: pythonResult.id, jsAccepted: actual.acceptedId,
      pythonScore: pythonResult.score, jsScore: actual.score,
      pythonMargin: pythonResult.margin, jsMargin: actual.margin });
  }
}
const summary = Object.fromEntries([...byProfile].map(([key, data]) => [key,
  { cases: data.count, top1Equal: data.top1Equal, acceptanceEqual: data.acceptanceEqual,
    scoreDeltaMax: data.scoreDeltaMax, marginDeltaMax: data.marginDeltaMax,
    nodeMedianMs: median(data.elapsed), nodeP90Ms: nearestRank(data.elapsed, .9) }]));
const report = { schema: 'mk8dx.private-shared-icon-ts-python-parity.v1',
  tensorManifestSha256: hash(manifestBytes), pythonReportSha256: hash(pythonBytes),
  populationReportSha256: populationBytes ? hash(populationBytes) : null,
  catalogSha256: manifest.catalogSha256, summary, disagreements,
  limits: ['Queries were normalized by Python cv2; browser/Android image decoding is not covered.',
    'Isolated Node timings are not browser, Android or product latencies.',
    'Previously exposed source groups are not an independent accuracy holdout.'] };
writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ sha256: hash(readFileSync(outputPath)), summary,
  disagreements: disagreements.length }) + '\n');
