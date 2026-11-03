// Stages the private shared field reference pack (packages/icon-matcher) into
// public/shared-icon/ for the scanner's product field reader.
//   node tools/stage_shared_fields.mjs --pack <tensor pack dir> --database <Clean Assets database.json>
// Every tensor is checked against references.json before it is copied. The
// pack never enters Git (see .gitignore); queries/manifests of the QA export
// are left behind. field-index.json maps the shared IDs to the scanner's own
// legacy flag and tire indices, so the result card keeps its existing art.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (message) => { console.error(`stage_shared_fields: ${message}`); process.exit(1); };

// --recognition-pack <dir>: the central pack (tooling/recognition/recognition_pack.py)
// supplies every input below; each file used is checked against its manifest.
const recognitionPack = opt('--recognition-pack') ? path.resolve(opt('--recognition-pack')) : null;
let packManifest = null;
if (recognitionPack) {
  packManifest = JSON.parse(await fs.readFile(path.join(recognitionPack, 'manifest.json'), 'utf8').catch(() => fail('recognition pack manifest.json missing')));
  if (packManifest.schema !== 'mk8dx.recognition-pack.v1') fail('unexpected recognition pack schema');
  for (const [name, entry] of Object.entries(packManifest.files)) {
    if (!(name.startsWith('tensor-pack/') || name === 'clean-assets/database.json' || name.startsWith('card-')
      || name.startsWith('lap-circle-') || name.startsWith('part-names-') || name.startsWith('frame-definitions-'))) continue;
    const data = await fs.readFile(path.join(recognitionPack, name)).catch(() => fail(`recognition pack file missing: ${name}`));
    if (data.length !== entry.bytes || sha256(data) !== entry.sha256) fail(`recognition pack file changed: ${name}`);
  }
}
const fromPack = (relative) => (recognitionPack ? path.join(recognitionPack, relative) : undefined);
const pack = path.resolve(fromPack('tensor-pack') ?? opt('--pack') ?? process.env.MK8DX_PRIVATE_SHARED_FIELD_PACK ?? '');
const database = path.resolve(fromPack('clean-assets/database.json') ?? opt('--database') ?? process.env.MK8DX_PRIVATE_CLEAN_ASSETS_DATABASE ?? '');
const root = path.resolve(webRoot, 'public', 'shared-icon');
const PREFIX = 'shared_icon';
const target = path.join(root, PREFIX);

const referencesBytes = await fs.readFile(path.join(pack, 'references.json')).catch(() => fail('references.json missing'));
const references = JSON.parse(referencesBytes.toString('utf8'));
if (references.schema !== 'mk8dx.shared-icon-references.v1') fail('unexpected reference schema');
const databaseBytes = await fs.readFile(database).catch(() => fail('database.json missing'));
if (sha256(databaseBytes) !== references.catalogSha256) fail('database.json is not the pack catalog');

await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(target, { recursive: true });
let bytes = referencesBytes.length;
for (const group of Object.values(references.groups)) {
  for (const tensor of Object.values(group.tensors)) {
    const data = await fs.readFile(path.join(pack, tensor.file));
    if (data.length !== tensor.bytes || sha256(data) !== tensor.sha256) fail(`tensor mismatch ${tensor.file}`);
    await fs.writeFile(path.join(target, tensor.file), data);
    bytes += data.length;
  }
}
await fs.writeFile(path.join(target, 'references.json'), referencesBytes);
// Optional private card anchors for the central card presence and photometric
// correction (tooling/recognition/build_card_anchors.py / build_card_photometry.py).
for (const [flag, file, schema] of [['--card-anchors', 'card-anchors-v1.json', 'mk8dx.card-anchors.v1'],
  ['--card-photometry', 'card-photometry-v1.json', 'mk8dx.card-photometry.v1'],
  // The Select-a-Ghost panel's last look (src/engine/lapCircles.ts).
  ['--lap-circle-templates', 'lap-circle-templates-v1.json', 'mk8dx.lap-circle-templates.v1']]) {
  const source = fromPack(file) ?? opt(flag);
  if (!source) continue;
  const data = await fs.readFile(path.resolve(source)).catch(() => fail(`${file} missing`));
  if (JSON.parse(data.toString('utf8')).schema !== schema) fail(`${file} is not ${schema}`);
  await fs.writeFile(path.join(target, file), data);
  bytes += data.length;
}

// Flags: the scanner's mk8_flags index is keyed by the in-game English name; match it by
// name rather than assume an offset, require all 110, and require the schema-9 country index
// (tools/sync_assets.mjs stages the templates on it, ADR-0214).
const names = JSON.parse(await fs.readFile(path.join(webRoot, 'public', 'assets', 'kart_config', 'names.json'), 'utf8'));
const byName = new Map(Object.entries(names.mk8_flags).map(([index, value]) => [value.uk, Number(index)]));
const db = JSON.parse(databaseBytes.toString('utf8'));
const flagIds = references.groups.flags__result.ids;
const flags = {};
for (const country of db.collections.countries) {
  if (!flagIds.includes(country.id)) continue;
  const index = byName.get(country.names['en-GB']);
  if (index === undefined) fail(`no flag template for ${country.id}`);
  if (index !== country.index) fail(`flag template ${index} for ${country.id} is not its country index ${country.index}; run tools/sync_assets.mjs`);
  flags[country.id] = index;
}
if (Object.keys(flags).length !== flagIds.length || new Set(Object.values(flags)).size !== flagIds.length) {
  fail('flag index mapping is not one-to-one');
}
const tires = Object.fromEntries(references.context.tireByIndex.map(([index, id]) => [id, index]));
const fieldIndex = { schema: 'mk8dx.scanner-field-index.v1', catalogSha256: references.catalogSha256, flags, tires };
await fs.writeFile(path.join(root, 'field-index.json'), JSON.stringify(fieldIndex) + '\n');
// The printed part names of the central Select-a-Ghost picker (mk8dx.part-names.v1, a pack
// component since 0.4.0). Without it the scanner keeps the previous Select-a-Ghost rule.
const partNamesSource = fromPack('part-names-v1.json') ?? opt('--part-names');
let partNames = null;
if (partNamesSource) {
  const data = await fs.readFile(path.resolve(partNamesSource)).catch(() => null);
  if (data) {
    const table = JSON.parse(data.toString('utf8'));
    if (table.schema !== 'mk8dx.part-names.v1' || table.catalogSha256 !== references.catalogSha256) {
      fail('part-names-v1.json is not mk8dx.part-names.v1 of the pack catalog');
    }
    await fs.writeFile(path.join(root, 'part-names-v1.json'), data);
    bytes += data.length;
    partNames = sha256(data);
  } else if (!recognitionPack) {
    fail('part-names-v1.json missing');
  }
}
// The central Select-a-Ghost picker is the only panel decision since the previous evidence rule
// left (2026-10-30): a pack without part names is too old for this scanner.
if (recognitionPack && !partNames) fail('recognition pack has no part-names-v1.json (pack 0.4.0 or later)');
// The Time Trial frame geometry (mk8dx.frame-definitions.v1, a pack component since 0.4.0-20261030;
// CENTRAL_RECOGNITION section 8.6, phase 5). It must describe exactly the geometry files the scanner
// serves (public/assets), so a frame definition and the staged grids can never disagree.
const frameDefinitionsSource = fromPack('frame-definitions-v1.json') ?? opt('--frame-definitions');
let frameDefinitions = null;
if (frameDefinitionsSource) {
  const data = await fs.readFile(path.resolve(frameDefinitionsSource)).catch(() => null);
  if (data) {
    const defs = JSON.parse(data.toString('utf8'));
    if (defs.schema !== 'mk8dx.frame-definitions.v1') fail('frame-definitions-v1.json is not mk8dx.frame-definitions.v1');
    for (const [key, entry] of Object.entries(defs.sources ?? {})) {
      const served = await fs.readFile(path.join(webRoot, 'public', 'assets', entry.path)).catch(() => null);
      if (!served || sha256(served) !== entry.sha256) fail(`frame definitions ${key} differ from public/assets/${entry.path}; run tools/sync_assets.mjs`);
    }
    await fs.writeFile(path.join(webRoot, 'public', 'assets', 'kart_config', 'frame-definitions-v1.json'), data);
    frameDefinitions = sha256(data);
  }
}
if (recognitionPack && packManifest.components?.frameDefinitions && !frameDefinitions) fail('frame-definitions-v1.json missing');
if (packManifest) {
  // Which central pack this build carries (tooling/recognition/central_versions.py reads it).
  await fs.writeFile(path.join(root, 'recognition-pack.json'), JSON.stringify({ schema: 'mk8dx.staged-recognition-pack.v1',
    packId: packManifest.packId, fieldSemanticsVersion: packManifest.fieldSemanticsVersion, catalogSha256: packManifest.catalogSha256 }) + '\n');
}
console.log(JSON.stringify({ target, prefix: PREFIX, packId: packManifest?.packId ?? null, catalogSha256: references.catalogSha256,
  referencesSha256: sha256(referencesBytes), bytes, flags: flagIds.length,
  tires: Object.keys(tires).length, partNamesSha256: partNames, frameDefinitionsSha256: frameDefinitions }, null, 2));
