// Build scanner runtime assets from the versioned internal collection.
// The generated directory is a build output; no owner source path is required.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Objects over GitHub's 100 MiB limit are stored as `<sha>.part1`, `<sha>.part2`, ... and joined into the
// (ignored) object file on first use; tooling/assets/shared_asset_source.py does the same.
async function hydrateObject(folder, digest) {
  const target = path.join(folder, digest);
  try { await fs.access(target); return target; } catch { /* stored split, or missing */ }
  const names = (await fs.readdir(folder).catch(() => []))
    .map((name) => [name, new RegExp(`^${digest}\\.part([1-9][0-9]*)$`).exec(name)])
    .filter(([, match]) => match).sort(([, a], [, b]) => Number(a[1]) - Number(b[1])).map(([name]) => name);
  if (!names.length) return target;
  const joined = Buffer.concat(await Promise.all(names.map((name) => fs.readFile(path.join(folder, name)))));
  if (createHash('sha256').update(joined).digest('hex') !== digest) throw new Error(`Split object does not join to its hash: ${digest}`);
  await fs.writeFile(`${target}.joining`, joined);
  await fs.rename(`${target}.joining`, target);
  return target;
}

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetRoot = path.join(webRoot, 'public', 'assets');
const collectionRoot = path.resolve(webRoot, '..', '..', 'packages', 'assets', 'collection');
const manifestFile = process.env.MK8DX_ASSET_MANIFEST || path.join(collectionRoot, 'collection-manifest.v1.json');
const objectsRoot = process.env.MK8DX_ASSET_OBJECTS || path.join(collectionRoot, 'objects');

async function noLinks(p) {
  let current = path.parse(path.resolve(p)).root;
  for (const part of path.resolve(p).slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`Reparse path: ${current}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

await noLinks(manifestFile);
await noLinks(objectsRoot);
await noLinks(targetRoot);
const input = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
if (input.schemaVersion !== 'mk8dx.internal-asset-collection.v1') throw new Error('Unknown asset manifest');
// The staged scan assets of the native scanner (flags on the schema-9 country index, ADR-0214), one group for the
// Web and Android scanners. The Web stages the recognition pack's shared_icon itself (tools/stage_shared_fields.mjs).
const GROUP = 'scan-stage';
const groupFiles = Object.entries(input.files).filter(([key, item]) =>
  key.startsWith(`${GROUP}/`) && item.sourceId === GROUP);
if (groupFiles.length !== input.sources?.[GROUP]?.fileCount || groupFiles.length === 0) {
  throw new Error('Scanner asset group is incomplete');
}
const files = groupFiles.filter(([key]) => !key.startsWith(`${GROUP}/shared_icon/`));
await fs.mkdir(targetRoot, { recursive: true });
const admitted = {};
for (const [key, item] of files.sort(([a], [b]) => a.localeCompare(b))) {
  const relative = key.slice(`${GROUP}/`.length);
  const parts = relative.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.includes('\\'))) {
    throw new Error('Unsafe asset path');
  }
  const digest = item.sha256;
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid asset digest');
  const source = await hydrateObject(path.join(objectsRoot, digest.slice(0, 2)), digest);
  const target = path.join(targetRoot, ...parts);
  await noLinks(source);
  await noLinks(target);
  const payload = await fs.readFile(source);
  if (payload.length !== item.sizeBytes || createHash('sha256').update(payload).digest('hex') !== digest) {
    throw new Error(`Asset identity changed: ${relative}`);
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  // The collection is the source of truth: a file from an older collection version is replaced, not refused.
  const existing = await fs.readFile(target).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing === null || !existing.equals(payload)) await fs.writeFile(target, payload);
  admitted[relative] = { bytes: item.sizeBytes, sha256: digest };
}
// Files an older collection version staged in the directories this tool fills are removed, so the listings below
// name exactly this version's files (shared_icon is staged by stage_shared_fields.mjs and left alone).
const managedDirs = new Set(Object.keys(admitted).map(name => path.posix.dirname(name)));
for (const dir of managedDirs) {
  if (dir === '.' || dir.startsWith('shared_icon')) continue;
  for (const entry of await fs.readdir(path.join(targetRoot, ...dir.split('/')), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isFile() && !(relative in admitted)) await fs.rm(path.join(targetRoot, ...dir.split('/'), entry.name));
  }
}

const listings = {};
for (const relative of [
  'kart_config/character', 'kart_config/body', 'kart_config/tire', 'kart_config/glider',
  'kart_config/mk8_flags', 'clean_assets/disp/characters',
  'clean_assets/disp/bodies', 'clean_assets/disp/gliders',
]) {
  const entries = await fs.readdir(path.join(targetRoot, relative));
  listings[relative] = entries.filter(name => /\.(png|jpg)$/i.test(name)).sort();
}
await fs.writeFile(path.join(targetRoot, 'listings.json'), JSON.stringify(listings));
const packNames = Object.keys(admitted).filter(name =>
  !name.startsWith('model/') && !name.startsWith('demo_frames/') &&
  !name.startsWith('clean_assets/disp/')).sort();
const packDir = path.join(targetRoot, 'pack');
await fs.mkdir(packDir, { recursive: true });
const packFile = await fs.open(path.join(packDir, 'engine_assets.pack'), 'w');
const packHash = createHash('sha256');
const packIndex = {};
let offset = 0;
try {
  for (const name of packNames) {
    const payload = await fs.readFile(path.join(targetRoot, name));
    await packFile.write(payload);
    packHash.update(payload);
    packIndex[name] = [offset, payload.length];
    offset += payload.length;
  }
} finally {
  await packFile.close();
}
await fs.writeFile(path.join(packDir, 'engine_assets.index.json'), JSON.stringify({
  entries: packNames.length, bytes: offset, files: packIndex,
}));
await fs.writeFile(path.join(targetRoot, 'assets_manifest.json'), JSON.stringify({
  schemaVersion: 'mk8dx.local-scanner-assets.v1',
  source: 'reviewed-local-use-assets',
  files: admitted,
  pack: { file: 'pack/engine_assets.pack', entries: packNames.length,
    bytes: offset, sha256: packHash.digest('hex') },
}));
console.log(`Verified ${files.length} local assets; packed ${packNames.length} entries.`);
