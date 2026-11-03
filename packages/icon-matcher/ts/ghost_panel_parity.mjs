// Select-a-Ghost picker parity: the TS decision against Python's on the recorded vectors.
//   node --experimental-strip-types ghost_panel_parity.mjs <tensor-pack dir> <vectors dir>
// Vectors come from tooling/recognition/ghost_select_parity_vectors.py; only vectors with
// recorded crops are replayed (the crops are Python's own normalized pixels).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { gunzipSync } from 'node:zlib';

register('./ts_resolve_hook.mjs', import.meta.url);
const { decideGhostSelectFrame } = await import('./sharedGhostPanel.ts');
const { partRelationKey } = await import('./sharedPartContext.ts');

const [packDir, vectorsDir] = process.argv.slice(2);
if (!packDir || !vectorsDir) throw new Error('Usage: ghost_panel_parity.mjs <tensor-pack dir> <vectors dir>');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const references = JSON.parse(readFileSync(path.join(packDir, 'references.json'), 'utf8'));
const index = JSON.parse(readFileSync(path.join(vectorsDir, 'index.json'), 'utf8'));
if (references.catalogSha256 !== index.catalogSha256) throw new Error('tensor pack and vectors use other catalogs');
const partNames = JSON.parse(readFileSync(path.join(vectorsDir, 'part-names-v1.json'), 'utf8'));
if (partNames.catalogSha256 !== index.catalogSha256) throw new Error('part names from another catalog');

function group(key) {
  const spec = references.groups[key];
  const read = (tensor) => {
    const data = readFileSync(path.join(packDir, tensor.file));
    if (data.byteLength !== tensor.bytes || sha(data) !== tensor.sha256) throw new Error(`tensor hash: ${tensor.file}`);
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  };
  return { width: spec.size[0], height: spec.size[1], ids: spec.ids, families: spec.families,
    rgb: new Float32Array(read(spec.tensors.rgb)), mask: new Uint8Array(read(spec.tensors.mask)),
    count: new Float32Array(read(spec.tensors.count)) };
}
const familyById = new Map();
for (const spec of Object.values(references.groups)) spec.ids.forEach((id, i) => familyById.set(id, spec.families[i]));
const partForCharacter = new Map(references.context.partForCharacter
  .map(([kind, family, character, part]) => [partRelationKey(kind, family, character), part]));
const refs = { characters: group('characters__ghost_select'), bodies: group('bodies__result'),
  tires: group('tires__result'), gliders: group('gliders__result'), flags: group('flags__result'),
  familyById, partForCharacter, partNames };

const close = (a, b) => Math.abs(a - b) <= 2e-4;
let compared = 0; let differences = 0; let misses = 0; let worst = 0;
for (const vector of index.vectors.filter((v) => v.crops)) {
  const name = vector.name;
  const description = JSON.parse(readFileSync(path.join(vectorsDir, `${name}.description.json`), 'utf8'));
  const want = JSON.parse(readFileSync(path.join(vectorsDir, `${name}.decision.json`), 'utf8'));
  const cropIndex = JSON.parse(readFileSync(path.join(vectorsDir, `${name}.crops.json`), 'utf8'));
  const blob = gunzipSync(readFileSync(path.join(vectorsDir, `${name}.crops.bin.gz`)));
  const source = { crop(field, dx, dy, scale, width, height) {
    const entry = cropIndex[`${field}|${dx}|${dy}|${scale.toFixed(2)}`];
    if (!entry) { misses += 1; return null; }
    const [offset, w, h] = entry;
    if (w !== width || h !== height) throw new Error(`crop size ${name} ${field}`);
    const out = new Float32Array(w * h * 3);
    for (let i = 0; i < out.length; i++) out[i] = blob[offset + i] / 255;
    return out;
  } };
  const got = decideGhostSelectFrame(description, source, refs, want.fieldSemanticsVersion);
  compared += 1;
  const problems = [];
  if (got.reliableColour !== want.reliableColour) problems.push('reliableColour');
  for (const wantField of want.fields) {
    const gotField = got.fields.find((f) => f.field === wantField.field);
    if (!gotField) { problems.push(`${wantField.field}: missing`); continue; }
    for (const key of ['selectedId', 'acceptedId', 'basis']) {
      if (gotField[key] !== wantField[key]) problems.push(`${wantField.field}.${key}: ${gotField[key]} != ${wantField[key]}`);
    }
    worst = Math.max(worst, Math.abs(gotField.score - wantField.score));
    if (!close(gotField.score, wantField.score)) problems.push(`${wantField.field}.score ${gotField.score} != ${wantField.score}`);
    const ids = (f) => f.alternatives.map((a) => a.id).join(',');
    if (ids(gotField) !== ids(wantField)) problems.push(`${wantField.field}.alternatives ${ids(gotField)} != ${ids(wantField)}`);
    const offset = (f) => JSON.stringify(f.evidence?.offset ?? null);
    if (offset(gotField) !== offset(wantField)) problems.push(`${wantField.field}.offset ${offset(gotField)} != ${offset(wantField)}`);
  }
  if (problems.length) { differences += 1; console.log('differs', name, problems.slice(0, 4).join('; ')); }
}
console.log(`vectors=${compared} differences=${differences} cropMisses=${misses} maxScoreDelta=${worst.toExponential(2)}`);
process.exitCode = differences ? 1 : 0;
